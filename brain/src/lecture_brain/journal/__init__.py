"""Local nonsynced transactional work journal (LL007).

SQLite in WAL mode on the Brain PC's local disk only. Holds admissions, jobs, leases, dispatch
attempts, receipts and activity events for the supervisor. It is operational state, never an
academic record store, and it must not live on Drive or inside a course folder.

Guarantees implemented here:
* atomic, idempotent admission keyed by request id + manifest digest (different bytes conflict);
* compare-and-swap claims with a monotonically increasing lease token (fencing);
* at most one active job per native thread;
* restart recovery that never blindly retries work that may have reached the native runtime;
* generation fencing on cancellation so a late result cannot publish as current.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum, StrEnum
from pathlib import Path
import json
import os
import time
import uuid
from typing import Any, Callable, Iterable, Iterator

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from . import schema as t

Clock = Callable[[], float]


class JournalError(RuntimeError):
    pass


class StaleLease(JournalError):
    """The caller's lease token is no longer the current one (fenced)."""


class UnsafeJournalLocation(JournalError):
    """The journal path is on synced/course storage; a live SQLite/WAL must stay local."""


class JobState(StrEnum):
    RECEIVED = "RECEIVED"
    VALIDATED = "VALIDATED"
    READY = "READY"
    CLAIMED = "CLAIMED"
    RUNNING = "RUNNING"
    STAGED = "STAGED"
    COMMIT_PENDING = "COMMIT_PENDING"
    SUCCEEDED = "SUCCEEDED"
    WAITING_SYNC = "WAITING_SYNC"
    WAITING_SOURCE = "WAITING_SOURCE"
    WAITING_USER = "WAITING_USER"
    WAITING_REVIEW = "WAITING_REVIEW"
    QUOTA_WAIT = "QUOTA_WAIT"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    FAILED_RETRYABLE = "FAILED_RETRYABLE"
    FAILED_FINAL = "FAILED_FINAL"
    UNCERTAIN_COMPLETION = "UNCERTAIN_COMPLETION"
    CANCELLED = "CANCELLED"
    SUPERSEDED = "SUPERSEDED"


S = JobState
TERMINAL = frozenset({S.SUCCEEDED, S.FAILED_FINAL, S.CANCELLED, S.SUPERSEDED})
WAITING = frozenset({S.WAITING_SYNC, S.WAITING_SOURCE, S.WAITING_USER, S.WAITING_REVIEW, S.QUOTA_WAIT, S.AUTH_REQUIRED})
#: States in which a native thread is considered occupied (one turn per thread).
THREAD_BUSY = frozenset({S.CLAIMED, S.RUNNING, S.STAGED, S.COMMIT_PENDING, S.UNCERTAIN_COMPLETION})
_PAUSES = {S.WAITING_SOURCE, S.WAITING_USER, S.WAITING_REVIEW, S.QUOTA_WAIT, S.AUTH_REQUIRED}
_LEGAL: dict[JobState, frozenset[JobState]] = {
    S.CLAIMED: frozenset({S.RUNNING, S.READY, S.CANCELLED, S.SUPERSEDED, S.FAILED_FINAL, *_PAUSES}),
    S.RUNNING: frozenset({S.STAGED, S.SUCCEEDED, S.FAILED_RETRYABLE, S.FAILED_FINAL, S.UNCERTAIN_COMPLETION, S.CANCELLED, S.SUPERSEDED, *_PAUSES}),
    S.STAGED: frozenset({S.COMMIT_PENDING, S.SUCCEEDED, S.FAILED_RETRYABLE, S.FAILED_FINAL, S.CANCELLED, S.SUPERSEDED, S.WAITING_REVIEW, S.WAITING_USER}),
    S.COMMIT_PENDING: frozenset({S.SUCCEEDED, S.STAGED, S.FAILED_FINAL, S.WAITING_REVIEW, S.UNCERTAIN_COMPLETION}),
    S.UNCERTAIN_COMPLETION: frozenset({S.READY, S.STAGED, S.SUCCEEDED, S.FAILED_FINAL, S.CANCELLED, S.SUPERSEDED, S.WAITING_USER}),
}
_SYNCED_PARTS = {"my drive", "shared drives", "google drive", "dropbox", "icloud drive", "iclouddrive"}


class AdmissionOutcome(Enum):
    ADMITTED = "admitted"
    DUPLICATE = "duplicate"
    CONFLICT = "conflict"


@dataclass(frozen=True)
class Admission:
    outcome: AdmissionOutcome
    job_id: str | None
    reason: str | None = None


def _volume_label(path: Path) -> str | None:
    if os.name != "nt":
        return None
    try:
        import ctypes

        buf = ctypes.create_unicode_buffer(261)
        root = path.anchor or str(path)
        if ctypes.windll.kernel32.GetVolumeInformationW(ctypes.c_wchar_p(root), buf, 261, None, None, None, None, 0):
            return buf.value
    except (OSError, AttributeError, ValueError):
        return None
    return None


def assert_local_nonsynced(path: Path, synced_roots: Iterable[Path] = ()) -> None:
    resolved = path.resolve()
    for root in synced_roots:
        if resolved.is_relative_to(Path(root).resolve()):
            raise UnsafeJournalLocation(f"Journal must not live inside a course/planner root: {root}")
    lowered = [p.lower() for p in resolved.parts]
    if any(p in _SYNCED_PARTS or p.startswith("onedrive") for p in lowered):
        raise UnsafeJournalLocation("Journal path is inside a synced folder; use local application data")
    label = (_volume_label(resolved) or "").lower()
    if "google drive" in label:
        raise UnsafeJournalLocation("Journal path is on a Google Drive volume; use local application data")


class Journal:
    def __init__(self, engine: sa.Engine, path: Path, clock: Clock):
        self._engine = engine
        self.path = path
        self._clock = clock

    # ---- lifecycle -------------------------------------------------------------------------
    @classmethod
    def open(cls, path: Path, *, clock: Clock = time.time, synced_roots: Iterable[Path] = ()) -> "Journal":
        path = Path(path)
        assert_local_nonsynced(path, synced_roots)
        path.parent.mkdir(parents=True, exist_ok=True)
        engine = sa.create_engine(f"sqlite:///{path.as_posix()}", connect_args={"timeout": 30, "check_same_thread": False}, poolclass=sa.pool.NullPool)

        @sa.event.listens_for(engine, "connect")
        def _connect(dbapi_connection, _record):  # noqa: ANN001
            dbapi_connection.isolation_level = None  # we issue BEGIN ourselves
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA synchronous=FULL")
            cursor.close()

        @sa.event.listens_for(engine, "begin")
        def _begin(conn):  # noqa: ANN001
            conn.exec_driver_sql("BEGIN IMMEDIATE")

        journal = cls(engine, path, clock)
        journal._migrate()
        return journal

    def close(self) -> None:
        self._engine.dispose()

    def _alembic(self) -> Config:
        cfg = Config()
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
        return cfg

    def head_revision(self) -> str:
        return ScriptDirectory.from_config(self._alembic()).get_current_head() or ""

    def schema_revision(self) -> str | None:
        with self._engine.connect() as conn:
            if not sa.inspect(conn).has_table("alembic_version"):
                return None
            return conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()

    def _migrate(self) -> None:
        cfg = self._alembic()
        known = {rev.revision for rev in ScriptDirectory.from_config(cfg).walk_revisions()}
        current = self.schema_revision()
        if current is not None and current not in known:
            raise JournalError(f"Journal schema {current!r} is newer than this build understands; restore or upgrade the app")
        if current == self.head_revision():
            return
        with self._engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")

    def pragma(self, name: str) -> Any:
        with self._engine.connect() as conn:
            return conn.exec_driver_sql(f"PRAGMA {name}").scalar()

    @contextmanager
    def tx(self) -> Iterator[sa.Connection]:
        """One IMMEDIATE write transaction."""
        with self._engine.begin() as conn:
            yield conn

    def now(self) -> float:
        return self._clock()

    # ---- helpers ---------------------------------------------------------------------------
    def _event(self, conn: sa.Connection, kind: str, *, job_id: str | None = None, request_id: str | None = None, **detail: Any) -> None:
        conn.execute(t.events.insert().values(job_id=job_id, request_id=request_id, kind=kind, detail=json.dumps(detail, sort_keys=True), at=self.now()))

    @staticmethod
    def _row(row: sa.Row | None) -> dict | None:
        if row is None:
            return None
        data = dict(row._mapping)
        for key in ("detail", "payload", "courses", "actions"):
            if key in data and isinstance(data[key], str):
                data[key] = json.loads(data[key])
        if "state" in data and data["state"] in JobState.__members__:
            data["state"] = JobState(data["state"])
        return data

    def _job(self, conn: sa.Connection, job_id: str) -> dict:
        row = self._row(conn.execute(sa.select(t.jobs).where(t.jobs.c.job_id == job_id)).first())
        if row is None:
            raise JournalError(f"Unknown job {job_id}")
        return row

    # ---- admission -------------------------------------------------------------------------
    def admit(self, request: dict, *, manifest_sha256: str, bundle_ref: str, workflow: str, priority: int, detail: dict | None = None) -> Admission:
        """Atomically admit a verified request bundle. Same id + same bytes → the original admission."""
        rid = request["request_id"]
        with self.tx() as conn:
            existing = conn.execute(sa.select(t.admissions.c.manifest_sha256).where(t.admissions.c.request_id == rid)).first()
            if existing is not None:
                job_id = conn.execute(sa.select(t.jobs.c.job_id).where(t.jobs.c.request_id == rid)).scalar()
                if existing.manifest_sha256 == manifest_sha256:
                    self._event(conn, "duplicate_admission", job_id=job_id, request_id=rid)
                    return Admission(AdmissionOutcome.DUPLICATE, job_id)
                self._event(conn, "request_conflict", request_id=rid, reason="same request id, different bytes", offered=manifest_sha256, admitted=existing.manifest_sha256)
                return Admission(AdmissionOutcome.CONFLICT, None, "same request id, different bytes")
            clash = conn.execute(
                sa.select(t.admissions.c.request_id).where(t.admissions.c.device_id == request["device_id"], t.admissions.c.sequence == request["sequence"])
            ).scalar()
            if clash is not None:
                self._event(conn, "request_conflict", request_id=rid, reason="device sequence reused", other=clash)
                return Admission(AdmissionOutcome.CONFLICT, None, "device sequence reused by another request")
            now = self.now()
            conn.execute(
                t.admissions.insert().values(
                    request_id=rid, manifest_sha256=manifest_sha256, logical_input_id=request["logical_input_id"], device_id=request["device_id"],
                    sequence=request["sequence"], course_id=request["scope"]["course_id"], term=request["scope"]["term"], thread_key=request["thread_key"],
                    action=request["action"], depth=request["depth"], parent_request_id=request["parent_request_id"], bundle_ref=bundle_ref,
                    submitted_at=request["submitted_at"], expires_at=request["expires_at"], admitted_at=now,
                )
            )
            state, reason = S.READY, None
            parent = request["parent_request_id"]
            if parent is not None:
                parent_row = conn.execute(sa.select(t.jobs.c.job_id, t.jobs.c.state).where(t.jobs.c.request_id == parent)).first()
                parent_state = parent_row.state if parent_row else None
                if parent_state == S.WAITING_USER:
                    # The learner's real answer to a waiting question arrived: the parent is answered, not failed.
                    conn.execute(t.jobs.update().where(t.jobs.c.job_id == parent_row.job_id).values(state=S.SUCCEEDED, waiting_reason=None, updated_at=now))
                    self._event(conn, "state", job_id=parent_row.job_id, request_id=parent, frm=S.WAITING_USER, to=S.SUCCEEDED, reason=f"answered by {rid}")
                elif parent_state != S.SUCCEEDED:
                    state, reason = S.WAITING_SYNC, f"parent:{parent}"
            job_id = uuid.uuid4().hex
            conn.execute(
                t.jobs.insert().values(
                    job_id=job_id, request_id=rid, workflow=workflow, course_id=request["scope"]["course_id"], thread_key=request["thread_key"], state=state,
                    priority=priority, generation=1, lease_token=0, attempts=0, waiting_reason=reason, cancel_requested=False, input_digest=manifest_sha256,
                    detail=json.dumps(detail or {}, sort_keys=True), created_at=now, updated_at=now,
                )
            )
            self._event(conn, "admitted", job_id=job_id, request_id=rid, state=state, workflow=workflow)
            return Admission(AdmissionOutcome.ADMITTED, job_id)

    def enqueue_internal(self, *, workflow: str, course_id: str, thread_key: str, priority: int, input_digest: str, detail: dict | None = None) -> str | None:
        """Create a supervisor-originated job (preparation, projection). Deduplicated on workflow+digest."""
        with self.tx() as conn:
            existing = conn.execute(
                sa.select(t.jobs.c.job_id).where(t.jobs.c.workflow == workflow, t.jobs.c.input_digest == input_digest, t.jobs.c.request_id.is_(None), t.jobs.c.state.notin_([S.FAILED_FINAL, S.CANCELLED, S.SUPERSEDED]))
            ).scalar()
            if existing:
                return None
            now = self.now()
            job_id = uuid.uuid4().hex
            conn.execute(
                t.jobs.insert().values(
                    job_id=job_id, request_id=None, workflow=workflow, course_id=course_id, thread_key=thread_key, state=S.READY, priority=priority, generation=1,
                    lease_token=0, attempts=0, cancel_requested=False, input_digest=input_digest, detail=json.dumps(detail or {}, sort_keys=True), created_at=now, updated_at=now,
                )
            )
            self._event(conn, "enqueued_internal", job_id=job_id, workflow=workflow)
            return job_id

    # ---- claiming and leases ---------------------------------------------------------------
    def claim(self, owner: str, *, lease_seconds: float = 120.0, aging_seconds: float = 3600.0, workflows: Iterable[str] | None = None,
              exclude_workflows: Iterable[str] = ()) -> dict | None:
        """Compare-and-swap claim of the most urgent runnable job whose native thread is free."""
        now = self.now()
        with self.tx() as conn:
            # One native turn per thread. Deterministic jobs (controls, notes, link corrections) do not occupy a
            # native thread and are never held back by one; a job without the flag is treated as thread-exclusive.
            def exclusive(detail: str) -> bool:
                return bool(json.loads(detail or "{}").get("needs_native", True))

            busy = {r.thread_key for r in conn.execute(sa.select(t.jobs.c.thread_key, t.jobs.c.detail).where(t.jobs.c.state.in_(list(THREAD_BUSY)))) if exclusive(r.detail)}
            query = sa.select(t.jobs).where(
                sa.or_(t.jobs.c.state == S.READY, sa.and_(t.jobs.c.state == S.FAILED_RETRYABLE, t.jobs.c.next_attempt_at <= now))
            )
            if workflows is not None:
                query = query.where(t.jobs.c.workflow.in_(list(workflows)))
            excluded = list(exclude_workflows)
            if excluded:
                query = query.where(t.jobs.c.workflow.notin_(excluded))
            candidates = [self._row(r) for r in conn.execute(query)]
            candidates = [c for c in candidates if not c["detail"].get("needs_native", True) or c["thread_key"] not in busy]
            if not candidates:
                return None

            def urgency(job: dict) -> tuple[int, float]:
                aged = now - job["created_at"] >= aging_seconds
                return (min(job["priority"], 1) if aged else job["priority"], job["created_at"])

            chosen = min(candidates, key=urgency)
            token = chosen["lease_token"] + 1
            updated = conn.execute(
                t.jobs.update()
                .where(t.jobs.c.job_id == chosen["job_id"], t.jobs.c.state == chosen["state"], t.jobs.c.lease_token == chosen["lease_token"])
                .values(state=S.CLAIMED, lease_owner=owner, lease_token=token, lease_expires_at=now + lease_seconds, next_attempt_at=None, updated_at=now)
            )
            if updated.rowcount != 1:  # lost the race inside the same instant; caller simply tries again
                return None
            self._event(conn, "claimed", job_id=chosen["job_id"], owner=owner, lease_token=token)
            return self._job(conn, chosen["job_id"])

    def heartbeat(self, job_id: str, lease_token: int, lease_seconds: float = 120.0) -> None:
        with self.tx() as conn:
            done = conn.execute(
                t.jobs.update().where(t.jobs.c.job_id == job_id, t.jobs.c.lease_token == lease_token).values(lease_expires_at=self.now() + lease_seconds)
            )
            if done.rowcount != 1:
                raise StaleLease(f"Lease {lease_token} for {job_id} is no longer current")

    def acquire_for_reconcile(self, job_id: str, owner: str, lease_seconds: float = 120.0) -> dict:
        """Take a fresh lease on a staged/uncertain job without changing its state."""
        with self.tx() as conn:
            job = self._job(conn, job_id)
            if job["state"] not in {S.STAGED, S.COMMIT_PENDING, S.UNCERTAIN_COMPLETION}:
                raise JournalError(f"Job {job_id} is {job['state']}, not awaiting reconciliation")
            now = self.now()
            if job["lease_owner"] and job["lease_expires_at"] and job["lease_expires_at"] > now and job["lease_owner"] != owner:
                raise JournalError("Job is leased by another live worker; do not steal the lock")
            token = job["lease_token"] + 1
            conn.execute(t.jobs.update().where(t.jobs.c.job_id == job_id).values(lease_owner=owner, lease_token=token, lease_expires_at=now + lease_seconds, updated_at=now))
            self._event(conn, "reconcile_lease", job_id=job_id, owner=owner, lease_token=token)
            return self._job(conn, job_id)

    def transition(self, job_id: str, lease_token: int, to_state: JobState, *, waiting_reason: str | None = None, detail: dict | None = None) -> dict:
        to_state = JobState(to_state)
        with self.tx() as conn:
            job = self._job(conn, job_id)
            if job["lease_token"] != lease_token:
                raise StaleLease(f"Lease {lease_token} for {job_id} is fenced by {job['lease_token']}")
            if to_state not in _LEGAL.get(job["state"], frozenset()):
                raise JournalError(f"Illegal transition {job['state']} → {to_state}")
            values: dict[str, Any] = {"state": to_state, "updated_at": self.now(), "waiting_reason": waiting_reason}
            if to_state in TERMINAL or to_state in WAITING or to_state in {S.READY, S.FAILED_RETRYABLE}:
                values.update(lease_owner=None, lease_expires_at=None)
            if detail:
                values["detail"] = json.dumps({**job["detail"], **detail}, sort_keys=True)
            conn.execute(t.jobs.update().where(t.jobs.c.job_id == job_id).values(**values))
            self._event(conn, "state", job_id=job_id, request_id=job["request_id"], frm=job["state"], to=to_state, reason=waiting_reason)
            if to_state in TERMINAL and job["request_id"]:
                self._settle_children(conn, job["request_id"], to_state)
            return self._job(conn, job_id)

    def _settle_children(self, conn: sa.Connection, parent_request_id: str, parent_state: JobState) -> None:
        children = conn.execute(
            sa.select(t.jobs.c.job_id)
            .select_from(t.jobs.join(t.admissions, t.jobs.c.request_id == t.admissions.c.request_id))
            .where(t.admissions.c.parent_request_id == parent_request_id, t.jobs.c.state == S.WAITING_SYNC)
        ).scalars().all()
        for child in children:
            if parent_state == S.SUCCEEDED:
                conn.execute(t.jobs.update().where(t.jobs.c.job_id == child).values(state=S.READY, waiting_reason=None, updated_at=self.now()))
                self._event(conn, "state", job_id=child, frm=S.WAITING_SYNC, to=S.READY, reason="parent succeeded")
            else:
                reason = f"parent {parent_request_id} ended {parent_state}; choose how to continue"
                conn.execute(t.jobs.update().where(t.jobs.c.job_id == child).values(state=S.WAITING_USER, waiting_reason=reason, updated_at=self.now()))
                self._event(conn, "state", job_id=child, frm=S.WAITING_SYNC, to=S.WAITING_USER, reason=reason)

    def resume_waiting(self, job_id: str, *, expected: JobState, reason: str) -> dict:
        """Explicitly reopen a paused job (user answered, auth restored, source arrived, quota reset)."""
        with self.tx() as conn:
            job = self._job(conn, job_id)
            if job["state"] != expected or expected not in WAITING | {S.UNCERTAIN_COMPLETION}:
                raise JournalError(f"Job {job_id} is {job['state']}; expected paused state {expected}")
            conn.execute(t.jobs.update().where(t.jobs.c.job_id == job_id).values(state=S.READY, waiting_reason=None, lease_owner=None, lease_expires_at=None, updated_at=self.now()))
            self._event(conn, "state", job_id=job_id, request_id=job["request_id"], frm=job["state"], to=S.READY, reason=reason)
            return self._job(conn, job_id)

    def fail_retryable(self, job_id: str, lease_token: int, *, reason: str, max_retries: int, backoff_seconds: float) -> JobState:
        with self.tx() as conn:
            job = self._job(conn, job_id)
            if job["lease_token"] != lease_token:
                raise StaleLease(f"Lease {lease_token} for {job_id} is fenced")
            attempts = job["attempts"] + 1
            now = self.now()
            if attempts > max_retries:
                state, next_at = S.FAILED_FINAL, None
            else:
                state, next_at = S.FAILED_RETRYABLE, now + backoff_seconds * (2 ** (attempts - 1))
            conn.execute(
                t.jobs.update().where(t.jobs.c.job_id == job_id).values(state=state, attempts=attempts, next_attempt_at=next_at, waiting_reason=reason, lease_owner=None, lease_expires_at=None, updated_at=now)
            )
            self._event(conn, "state", job_id=job_id, request_id=job["request_id"], frm=job["state"], to=state, reason=reason, attempts=attempts)
            if state == S.FAILED_FINAL and job["request_id"]:
                self._settle_children(conn, job["request_id"], state)
            return state

    def reap_expired_leases(self) -> int:
        """Expired claims return to READY; expired runs that reached the native runtime become uncertain."""
        now = self.now()
        count = 0
        with self.tx() as conn:
            rows = conn.execute(sa.select(t.jobs).where(t.jobs.c.state.in_([S.CLAIMED, S.RUNNING]), t.jobs.c.lease_expires_at < now)).all()
            for row in rows:
                job = self._row(row)
                count += 1
                self._recover_one(conn, job, cause="lease expired")
        return count

    def _recover_one(self, conn: sa.Connection, job: dict, *, cause: str) -> str:
        dispatched = conn.execute(sa.select(sa.func.count()).select_from(t.dispatches).where(t.dispatches.c.job_id == job["job_id"], t.dispatches.c.generation == job["generation"], t.dispatches.c.state == "submitted")).scalar()
        if job["state"] == S.RUNNING and dispatched:
            new, bucket = S.UNCERTAIN_COMPLETION, "uncertain"
        else:
            new, bucket = S.READY, "requeued"
        conn.execute(t.jobs.update().where(t.jobs.c.job_id == job["job_id"]).values(state=new, lease_owner=None, lease_expires_at=None, waiting_reason=cause if new != S.READY else None, updated_at=self.now()))
        self._event(conn, "state", job_id=job["job_id"], request_id=job["request_id"], frm=job["state"], to=new, reason=cause)
        return bucket

    def recover_after_restart(self) -> dict[str, int]:
        report = {"requeued": 0, "uncertain": 0, "staged_for_reconcile": 0}
        with self.tx() as conn:
            for row in conn.execute(sa.select(t.jobs).where(t.jobs.c.state.in_([S.CLAIMED, S.RUNNING]))).all():
                report[self._recover_one(conn, self._row(row), cause="supervisor restart")] += 1
            staged = conn.execute(sa.select(t.jobs.c.job_id).where(t.jobs.c.state.in_([S.STAGED, S.COMMIT_PENDING]))).scalars().all()
            for job_id in staged:
                conn.execute(t.jobs.update().where(t.jobs.c.job_id == job_id).values(lease_owner=None, lease_expires_at=None))
                self._event(conn, "needs_reconcile", job_id=job_id, reason="supervisor restart")
                report["staged_for_reconcile"] += 1
        return report

    # ---- cancellation and generations ------------------------------------------------------
    def request_cancel(self, request_id: str) -> JobState:
        """Cancellation requested ≠ terminal. Not-started work cancels; started work is fenced."""
        with self.tx() as conn:
            row = conn.execute(sa.select(t.jobs).where(t.jobs.c.request_id == request_id)).first()
            if row is None:
                raise JournalError(f"No job for request {request_id}")
            job = self._row(row)
            state = job["state"]
            now = self.now()
            if state in TERMINAL:
                return state
            if state in WAITING or state in {S.READY, S.FAILED_RETRYABLE}:
                conn.execute(t.jobs.update().where(t.jobs.c.job_id == job["job_id"]).values(state=S.CANCELLED, cancel_requested=True, lease_owner=None, lease_expires_at=None, updated_at=now))
                self._event(conn, "state", job_id=job["job_id"], request_id=request_id, frm=state, to=S.CANCELLED, reason="cancelled before native work")
                self._settle_children(conn, request_id, S.CANCELLED)
                return S.CANCELLED
            values: dict[str, Any] = {"cancel_requested": True, "updated_at": now}
            if state != S.COMMIT_PENDING:  # a commit in flight is never fenced mid-write
                values["generation"] = job["generation"] + 1
            conn.execute(t.jobs.update().where(t.jobs.c.job_id == job["job_id"]).values(**values))
            self._event(conn, "cancel_requested", job_id=job["job_id"], request_id=request_id, state=state, fenced=state != S.COMMIT_PENDING)
            return state

    def supersede_generation(self, job_id: str, reason: str) -> int:
        """Fence the current generation (source/rubric/provider policy changed). Returns the new generation."""
        with self.tx() as conn:
            job = self._job(conn, job_id)
            generation = job["generation"] + 1
            conn.execute(t.jobs.update().where(t.jobs.c.job_id == job_id).values(generation=generation, updated_at=self.now()))
            self._event(conn, "generation_fenced", job_id=job_id, generation=generation, reason=reason)
            return generation

    def is_current_generation(self, job_id: str, generation: int) -> bool:
        return self.job(job_id)["generation"] == generation

    # ---- dispatch attempts and receipts ----------------------------------------------------
    def record_dispatch(self, job_id: str, lease_token: int, *, dispatch_id: str, adapter: str, native_thread_id: str | None, native_turn_id: str | None) -> None:
        with self.tx() as conn:
            job = self._job(conn, job_id)
            if job["lease_token"] != lease_token:
                raise StaleLease(f"Lease {lease_token} for {job_id} is fenced")
            conn.execute(
                t.dispatches.insert().values(dispatch_id=dispatch_id, job_id=job_id, generation=job["generation"], adapter=adapter, native_thread_id=native_thread_id,
                                             native_turn_id=native_turn_id, state="submitted", started_at=self.now())
            )
            self._event(conn, "dispatch_submitted", job_id=job_id, request_id=job["request_id"], dispatch_id=dispatch_id, adapter=adapter)

    def complete_dispatch(self, dispatch_id: str, *, state: str, native_turn_id: str | None = None, result_ref: str | None = None, failure_code: str | None = None) -> dict:
        with self.tx() as conn:
            values: dict[str, Any] = {"state": state, "observed_at": self.now(), "result_ref": result_ref, "failure_code": failure_code}
            if native_turn_id is not None:
                values["native_turn_id"] = native_turn_id
            done = conn.execute(t.dispatches.update().where(t.dispatches.c.dispatch_id == dispatch_id).values(**values))
            if done.rowcount != 1:
                raise JournalError(f"Unknown dispatch {dispatch_id}")
            row = self._row(conn.execute(sa.select(t.dispatches).where(t.dispatches.c.dispatch_id == dispatch_id)).first())
            self._event(conn, "dispatch_observed", job_id=row["job_id"], dispatch_id=dispatch_id, state=state, failure_code=failure_code)
            return row

    def dispatches(self, job_id: str | None = None) -> list[dict]:
        query = sa.select(t.dispatches).order_by(t.dispatches.c.started_at)
        if job_id:
            query = query.where(t.dispatches.c.job_id == job_id)
        with self._engine.connect() as conn:
            return [self._row(r) for r in conn.execute(query)]

    def add_receipt(self, *, kind: str, job_id: str | None, generation: int | None = None, ref: str | None = None, sha256: str | None = None, payload: dict | None = None,
                    receipt_id: str | None = None) -> str:
        receipt_id = receipt_id or uuid.uuid4().hex
        with self.tx() as conn:
            exists = conn.execute(sa.select(t.receipts.c.receipt_id).where(t.receipts.c.receipt_id == receipt_id)).first()
            if exists is None:
                conn.execute(t.receipts.insert().values(receipt_id=receipt_id, job_id=job_id, kind=kind, generation=generation, ref=ref, sha256=sha256,
                                                        payload=json.dumps(payload or {}, sort_keys=True), created_at=self.now()))
                self._event(conn, "receipt", job_id=job_id, receipt_kind=kind, receipt_id=receipt_id)
        return receipt_id

    def receipts(self, job_id: str | None = None, kind: str | None = None) -> list[dict]:
        query = sa.select(t.receipts).order_by(t.receipts.c.created_at)
        if job_id:
            query = query.where(t.receipts.c.job_id == job_id)
        if kind:
            query = query.where(t.receipts.c.kind == kind)
        with self._engine.connect() as conn:
            return [self._row(r) for r in conn.execute(query)]

    # ---- reads ------------------------------------------------------------------------------
    def job(self, job_id: str) -> dict:
        with self._engine.connect() as conn:
            return self._job(conn, job_id)

    def job_for_request(self, request_id: str) -> dict | None:
        with self._engine.connect() as conn:
            return self._row(conn.execute(sa.select(t.jobs).where(t.jobs.c.request_id == request_id)).first())

    def admission(self, request_id: str) -> dict | None:
        with self._engine.connect() as conn:
            return self._row(conn.execute(sa.select(t.admissions).where(t.admissions.c.request_id == request_id)).first())

    def admissions_for_input(self, logical_input_id: str) -> list[dict]:
        with self._engine.connect() as conn:
            return [self._row(r) for r in conn.execute(sa.select(t.admissions).where(t.admissions.c.logical_input_id == logical_input_id).order_by(t.admissions.c.admitted_at))]

    def jobs(self, *, states: Iterable[JobState] | None = None, course_id: str | None = None, limit: int | None = None) -> list[dict]:
        query = sa.select(t.jobs).order_by(t.jobs.c.created_at.desc())
        if states is not None:
            query = query.where(t.jobs.c.state.in_(list(states)))
        if course_id:
            query = query.where(t.jobs.c.course_id == course_id)
        if limit:
            query = query.limit(limit)
        with self._engine.connect() as conn:
            return [self._row(r) for r in conn.execute(query)]

    def events(self, job_id: str | None = None, *, request_id: str | None = None, limit: int | None = None) -> list[dict]:
        query = sa.select(t.events).order_by(t.events.c.id)
        if job_id:
            query = query.where(t.events.c.job_id == job_id)
        if request_id:
            query = query.where(t.events.c.request_id == request_id)
        if limit:
            query = query.limit(limit)
        with self._engine.connect() as conn:
            return [self._row(r) for r in conn.execute(query)]

    def active_count(self, workflows: Iterable[str] | None = None) -> int:
        query = sa.select(sa.func.count()).select_from(t.jobs).where(t.jobs.c.state.in_([S.CLAIMED, S.RUNNING]))
        if workflows is not None:
            query = query.where(t.jobs.c.workflow.in_(list(workflows)))
        with self._engine.connect() as conn:
            return conn.execute(query).scalar() or 0

    def counts(self) -> dict[str, Any]:
        with self._engine.connect() as conn:
            by_state = {row[0]: row[1] for row in conn.execute(sa.select(t.jobs.c.state, sa.func.count()).group_by(t.jobs.c.state))}
            return {
                "jobs": sum(by_state.values()),
                "by_state": by_state,
                # Dispatches that actually reached a runtime (refusals before send are not model requests).
                "dispatches": conn.execute(sa.select(sa.func.count()).select_from(t.dispatches).where(t.dispatches.c.state != "not_sent")).scalar() or 0,
                "admissions": conn.execute(sa.select(sa.func.count()).select_from(t.admissions)).scalar() or 0,
            }

    # ---- small key/value state (pause flags, scan cursors, quota notes) ---------------------
    def set_value(self, key: str, value: Any) -> None:
        text = json.dumps(value, sort_keys=True)
        with self.tx() as conn:
            updated = conn.execute(t.kv.update().where(t.kv.c.key == key).values(value=text, updated_at=self.now()))
            if updated.rowcount == 0:
                conn.execute(t.kv.insert().values(key=key, value=text, updated_at=self.now()))

    def get_value(self, key: str, default: Any = None) -> Any:
        with self._engine.connect() as conn:
            value = conn.execute(sa.select(t.kv.c.value).where(t.kv.c.key == key)).scalar()
        return default if value is None else json.loads(value)


__all__ = [
    "Admission", "AdmissionOutcome", "Journal", "JournalError", "JobState", "StaleLease", "UnsafeJournalLocation",
    "TERMINAL", "WAITING", "THREAD_BUSY", "assert_local_nonsynced",
]
