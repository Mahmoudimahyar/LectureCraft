"""Writer facade over the existing course-owned learning writers (LL008).

``LearningWriter.validate / commit / verify`` for the bound owner only:

* ``Be505StudyIndexWriter`` — the real BE 505 writer (``tools/study_index.py save-attempt``) run as a
  subprocess under the pinned interpreter. Its ``--root`` flag does not redirect writes, so the
  wrapper refuses to run unless the helper file is the bound course's own, unmodified, inspected
  revision. It is never pointed at a fixture.
* ``CoordinatedCourseWriter`` — the coordinated course-local no-clobber procedure used by courses
  that have no save executable (exclusive create under the cooperative learning lock, read back).
* ``StagedOnlyWriter`` — when course writes are not enabled: the candidate is staged and the
  receipt says blocked. Staging is never reported as a canonical save.

The tracking publisher is a different owner with a different lock and is never a learning writer.
Before and after every commit the full-turn sidecar is re-verified by bytes; a non-empty locator
string is not evidence. A saved attempt followed by a stale view stays saved.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import json
import os
import subprocess
from typing import Any, Iterator

from jsonschema import Draft202012Validator, FormatChecker

from .. import contracts as c
from ..capture import CaptureError, CaptureStore
from ..config import Settings
from ..fsutil import ExclusiveConflict, publish_exclusive
from ..ownerio.attempts import learning_view_status, read_attempt_records
from ..ownerio.catalogs import read_families, read_skills
from . import candidate as cand

LOCK_REL = ".agent/course-learning/question-writer.lock"


class WriterBusy(RuntimeError):
    pass


@dataclass
class CommitOutcome:
    status: str  # saved | already_saved | blocked | incomplete
    reason: str | None = None
    dest_rel: str | None = None
    detail: dict = field(default_factory=dict)


@contextmanager
def course_learning_lock(root: Path) -> Iterator[None]:
    """Cooperative non-blocking lock on the course learning-writer lock file.

    Same file and byte-range scheme as the BE 505 helper, so the two exclude each other on this
    host. It does not coordinate other hosts, direct edits or Drive sync; the lock file is never
    deleted or stolen.
    """
    path = root / LOCK_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, "a+b")
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise WriterBusy("Learning writer busy; the candidate stays staged. The lock is never removed or overwritten.") from exc
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


class StagedOnlyWriter:
    writer_id = "staged-only"

    def commit(self, record: dict, data: bytes, staged_path: Path) -> CommitOutcome:
        return CommitOutcome("blocked", "Course writes are not enabled; the candidate is staged for the owning writer, not saved.")


class CoordinatedCourseWriter:
    """Exclusive-create + readback under the course learning lock (courses without a save helper)."""

    writer_id = "coordinated-course-writer"

    def __init__(self, root: Path):
        self.root = root

    def commit(self, record: dict, data: bytes, staged_path: Path) -> CommitOutcome:
        record_id = record["attempt_id"] if record["record_kind"] == "attempt" else record["event_id"]
        rel = f"learning/attempts/{cand.month_of(record['recorded_at'])}/{record_id}.json"
        try:
            with course_learning_lock(self.root):
                try:
                    result = publish_exclusive(self.root / rel, data)
                except ExclusiveConflict:
                    return CommitOutcome("blocked", "Same ID with different bytes; no overwrite", rel, {"conflict": True})
        except WriterBusy as exc:
            return CommitOutcome("blocked", str(exc), rel, {"busy": True})
        return CommitOutcome("saved" if result == "created" else "already_saved", None, rel)


class Be505StudyIndexWriter:
    """The existing BE 505 save path. Only ever runs against the bound live course it belongs to."""

    writer_id = "be505-study-index"

    def __init__(self, root: Path, *, interpreter: Path, helper: Path, helper_sha256: str, timeout: float = 180.0):
        self.root, self.interpreter, self.helper, self.helper_sha256, self.timeout = root, Path(interpreter), Path(helper), helper_sha256, timeout

    def preflight(self) -> str | None:
        if not self.interpreter.is_file():
            return "Pinned writer interpreter is not present"
        if not self.helper.is_file():
            return "Course save helper is not present"
        # The helper writes to its own parent folder regardless of --root: refuse any other target.
        if self.helper.resolve().parents[1] != self.root.resolve():
            return "Save helper does not belong to the bound course root (its --root flag does not redirect writes)"
        if hashlib.sha256(self.helper.read_bytes()).hexdigest() != self.helper_sha256:
            return "Save helper differs from the inspected revision; re-inspect before use"
        return None

    def commit(self, record: dict, data: bytes, staged_path: Path) -> CommitOutcome:
        problem = self.preflight()
        if problem:
            return CommitOutcome("blocked", problem)
        if record["record_kind"] == "attempt" and "question_id" not in record["question"]:
            return CommitOutcome("blocked", "This helper requires question.question_id on attempts; the candidate stays staged")
        record_id = record["attempt_id"] if record["record_kind"] == "attempt" else record["event_id"]
        rel = f"learning/attempts/{cand.month_of(record['recorded_at'])}/{record_id}.json"
        # An existing record is decided by bytes, without starting the helper: its identical-retry path
        # regenerates derived files, and a failure there would hide that the record is already saved.
        existing = self.root / rel
        if existing.is_file():
            if existing.read_bytes() == data:
                return CommitOutcome("already_saved", None, rel, {"helper_started": False})
            return CommitOutcome("blocked", "Same ID with different bytes; no overwrite", rel, {"conflict": True, "helper_started": False})
        argv = [str(self.interpreter), "-B", "-X", "utf8", str(self.helper), "save-attempt", "--candidate", str(staged_path)]
        env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "PATH", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH"}}
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        try:
            done = subprocess.run(argv, cwd=self.root, env=env, capture_output=True, timeout=self.timeout, check=False, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return CommitOutcome("incomplete", "Save helper did not finish; reconcile the existing record before any retry", rel, {"timeout": True})
        except OSError as exc:
            return CommitOutcome("blocked", f"Save helper could not start: {exc}", rel)
        stdout, stderr = done.stdout.decode("utf-8", "replace"), done.stderr.decode("utf-8", "replace")
        detail = {"exit": done.returncode, "stdout": stdout[-2000:], "stderr": stderr[-2000:]}
        if done.returncode == 0:
            try:
                status = json.loads(stdout).get("status")
            except (json.JSONDecodeError, AttributeError):
                status = None
            if status in {"saved", "already_saved"}:
                return CommitOutcome(status, None, rel, detail)
            return CommitOutcome("incomplete", "Save helper exited 0 without a recognised status", rel, detail)
        try:
            error = str(json.loads(stderr or stdout).get("error", ""))
        except (json.JSONDecodeError, AttributeError):
            error = (stderr or stdout).strip()
        if error.startswith("Evidence saved at"):
            return CommitOutcome("saved", "Evidence saved; the owner's derived view needs repair", rel, dict(detail, view_needs_repair=True))
        if "Same ID with different bytes" in error:
            return CommitOutcome("blocked", "Same ID with different bytes; no overwrite", rel, dict(detail, conflict=True))
        if "Learning writer busy" in error:
            return CommitOutcome("blocked", "Learning writer busy; the candidate stays staged", rel, dict(detail, busy=True))
        if "Readback mismatch" in error:
            return CommitOutcome("incomplete", "Owner reported a readback mismatch; preserve staging and inspect the partial write", rel, detail)
        return CommitOutcome("blocked", error[:500] or "Save helper failed without a message", rel, detail)


class WriterFacade:
    def __init__(self, settings: Settings, capture: CaptureStore | None = None):
        self._settings = settings
        self._capture = capture or CaptureStore(settings)
        self._schema = self._load_owner_schema()

    # ---- owner schema (read-only) -----------------------------------------------------------
    def _load_owner_schema(self) -> dict | None:
        for path in (self._settings.planner_root / "protocols" / "schemas" / "course-learning.schema.json",
                     self._settings.repo / ".local" / "academic-reference" / "schemas" / "course-learning.schema.json"):
            if path.is_file():
                try:
                    return json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
        return None

    @property
    def owner_schema_available(self) -> bool:
        return self._schema is not None

    def _schema_errors(self, record: dict) -> list[str]:
        if self._schema is None:
            return []
        validator = Draft202012Validator({"$ref": "#/$defs/evidence_record", "$defs": self._schema["$defs"]}, format_checker=FormatChecker())
        return [e.message for e in validator.iter_errors(record)][:5]

    # ---- writer selection -------------------------------------------------------------------
    def writer_for(self, course_id: str):
        settings = self._settings
        if not settings.course_writes_enabled:
            return StagedOnlyWriter()
        root = settings.course(course_id).root
        if settings.profile == "fixture":
            return CoordinatedCourseWriter(root)  # synthetic roots owned by this workspace
        binding_file = settings.repo / "config" / "local-bindings" / "writers.json"
        binding = json.loads(binding_file.read_text(encoding="utf-8")).get(course_id) if binding_file.is_file() else None
        if not binding:
            return StagedOnlyWriter()  # no inspected, approved writer bound for this course
        if binding.get("kind") == "study_index":
            return Be505StudyIndexWriter(root, interpreter=Path(binding["interpreter"]), helper=Path(binding["helper"]), helper_sha256=binding["helper_sha256"])
        if binding.get("kind") == "coordinated" and binding.get("approved_by_user") is True:
            return CoordinatedCourseWriter(root)
        return StagedOnlyWriter()

    # ---- receipts ---------------------------------------------------------------------------
    def _receipt(self, *, course_id: str, request_id: str, writer_id: str, kind: str, status: str, record_ref: dict | None, view_status: str, capture: dict | None,
                 now: str, reason: str | None) -> dict:
        seed = f"{request_id}|{kind}|{record_ref['record_id'] if record_ref else ''}|{status}"
        receipt = {"contract": "ll.publication/1", "receipt_id": "pub-" + hashlib.sha256(seed.encode()).hexdigest()[:32], "request_id": request_id,
                   "scope": {"course_id": course_id, "term": self._settings.course(course_id).term}, "writer_id": writer_id, "kind": kind, "status": status,
                   "canonical_record": record_ref, "view_status": view_status, "captured_submission": capture, "observed_at": now, "reason": reason[:2000] if reason else None}
        return c.require_valid("publication", receipt)

    def none_publication(self, course_id: str, request_id: str, now: str, reason: str | None = "No assessment was requested in this exchange.",
                         capture: dict | None = None) -> dict:
        """A quick answer yields kind:none / not_requested — never an invented attempt."""
        return self._receipt(course_id=course_id, request_id=request_id, writer_id="none", kind="none", status="not_requested", record_ref=None,
                             view_status="not_applicable", capture=capture, now=now, reason=reason)

    def blocked(self, course_id: str, request_id: str, kind: str, now: str, reason: str, capture: dict | None = None, status: str = "blocked") -> dict:
        return self._receipt(course_id=course_id, request_id=request_id, writer_id=self.writer_for(course_id).writer_id, kind=kind, status=status, record_ref=None,
                             view_status="not_applicable", capture=capture, now=now, reason=reason)

    # ---- validate ---------------------------------------------------------------------------
    def validate_attempt(self, course_id: str, record: dict) -> None:
        root = self._settings.course(course_id).root
        skills = read_skills(root, course_id)["skills"]
        families = read_families(root, course_id)
        existing = read_attempt_records(root, course_id)
        ids = (set(existing["attempts"]) | set(existing["revisions"])) - {record.get("attempt_id")}
        cand.check_attempt(record, course_id=course_id, skills=skills, families=families, existing_ids=ids)
        errors = self._schema_errors(record)
        if errors:
            raise cand.CandidateError("invalid_candidate", "owner schema: " + "; ".join(errors))

    def validate_revision(self, course_id: str, record: dict) -> None:
        root = self._settings.course(course_id).root
        existing = read_attempt_records(root, course_id)
        attempt = existing["attempts"].get(record.get("attempt_id"))
        if attempt is None:
            raise cand.CandidateError("invalid_candidate", "revision names an attempt that does not exist")
        effective = existing["effective"][record["attempt_id"]]
        if effective["conflict"]:
            raise cand.CandidateError("conflicting_revision", "the correction chain is already branched; reconcile it first")
        if record["event_id"] in existing["revisions"]:
            if existing["revisions"][record["event_id"]]["replaces_assessment_id"] != record["replaces_assessment_id"]:
                raise cand.CandidateError("id_in_use", "this revision id already names another record")
        elif record["replaces_assessment_id"] != effective["assessment_id"]:
            raise cand.CandidateError("conflicting_revision", "another revision already replaced that assessment; a second child would branch the chain")
        if record["event_id"] in existing["attempts"]:
            raise cand.CandidateError("id_in_use", "this id already names an attempt")
        skills = read_skills(root, course_id)["skills"]
        cand.check_observations(record["observations"], skills=skills, expected_skill_ids={o["skill_id"] for o in attempt["observations"]})
        parent = attempt if record["replaces_assessment_id"] == record["attempt_id"] else existing["revisions"].get(record["replaces_assessment_id"])
        if parent is None or cand._dt(parent["recorded_at"]) > cand._dt(record["recorded_at"]):
            raise cand.CandidateError("invalid_candidate", "revision must follow its parent in time")
        if not record.get("reason"):
            raise cand.CandidateError("invalid_candidate", "a revision needs a reason")
        errors = self._schema_errors(record)
        if errors:
            raise cand.CandidateError("invalid_candidate", "owner schema: " + "; ".join(errors))

    # ---- commit + verify --------------------------------------------------------------------
    def _publish(self, course_id: str, record: dict, *, kind: str, capture: dict, submission: dict, request_id: str, now: str) -> dict:
        writer = self.writer_for(course_id)
        record_id = record["attempt_id"] if kind == "attempt" else record["event_id"]
        excerpt = record["response_evidence"]["excerpt"] if kind == "attempt" else None
        verify = dict(expect_turn_id=submission["turn_id"], expect_logical_input_id=submission["logical_input_id"])
        try:
            self._capture.verify(course_id, capture, excerpt=excerpt if submission["response"]["text"] else None, **verify)
        except CaptureError as exc:
            return self._receipt(course_id=course_id, request_id=request_id, writer_id=writer.writer_id, kind=kind, status="blocked", record_ref=None,
                                 view_status="not_applicable", capture=None, now=now, reason=f"Captured input could not be verified ({exc.code}); nothing was saved.")
        try:
            (self.validate_attempt if kind == "attempt" else self.validate_revision)(course_id, record)
        except cand.CandidateError as exc:
            return self._receipt(course_id=course_id, request_id=request_id, writer_id=writer.writer_id, kind=kind, status="blocked", record_ref=None,
                                 view_status="not_applicable", capture=capture, now=now, reason=f"{exc.code}: {exc.message}")
        data = cand.serialize(record)
        # Staged candidates are content-addressed: a different proposal for the same id never overwrites an earlier one.
        staged = self._capture.write_record(course_id, submission["session_id"], "proposals", f"{record_id}.{c.sha256_hex(data)[:12]}.candidate", data)
        staged_path = self._settings.write_root(course_id) / staged["path"]
        outcome = writer.commit(record, data, staged_path)
        root = self._settings.course(course_id).root
        status, reason, record_ref, view = outcome.status, outcome.reason, None, "not_applicable"
        if outcome.dest_rel and not isinstance(writer, StagedOnlyWriter):
            dest = root / outcome.dest_rel
            on_disk = dest.read_bytes() if dest.is_file() else None
            if status in {"saved", "already_saved"} and on_disk != data:
                status, reason = "incomplete", "Owner reported a save but the canonical bytes do not read back; reconcile before any retry"
            elif status in {"blocked", "incomplete"} and on_disk == data and not outcome.detail.get("conflict"):
                status, reason = "saved", (reason or "") + " (canonical record verified by readback)"
            if status in {"saved", "already_saved"}:
                try:  # the same captured evidence must still verify immediately after the owner's commit
                    self._capture.verify(course_id, capture, excerpt=excerpt if submission["response"]["text"] else None, **verify)
                except CaptureError as exc:
                    status, reason = "incomplete", f"Record saved but its captured input no longer verifies ({exc.code}); reconcile"
            if status in {"saved", "already_saved"}:
                record_ref = {"record_id": record_id, "artifact": c.artifact_for_bytes(data, outcome.dest_rel, "application/json")}
                view = {"current": "current", "stale": "stale"}.get(learning_view_status(root), "unavailable")
        return self._receipt(course_id=course_id, request_id=request_id, writer_id=writer.writer_id, kind=kind, status=status, record_ref=record_ref, view_status=view,
                             capture=capture, now=now, reason=reason)

    def publish_attempt(self, course_id: str, record: dict, *, capture: dict, submission: dict, request_id: str, now: str) -> dict:
        return self._publish(course_id, record, kind="attempt", capture=capture, submission=submission, request_id=request_id, now=now)

    def publish_revision(self, course_id: str, record: dict, *, capture: dict, submission: dict, request_id: str, now: str) -> dict:
        return self._publish(course_id, record, kind="assessment_revision", capture=capture, submission=submission, request_id=request_id, now=now)

    def reconcile(self, course_id: str, record: dict) -> str:
        """After an uncertain outcome: inspect the canonical identity instead of re-running the writer."""
        record_id = record["attempt_id"] if record["record_kind"] == "attempt" else record["event_id"]
        dest = self._settings.course(course_id).root / "learning" / "attempts" / cand.month_of(record["recorded_at"]) / f"{record_id}.json"
        if not dest.is_file():
            return "absent"
        return "saved_identical" if dest.read_bytes() == cand.serialize(record) else "conflict"
