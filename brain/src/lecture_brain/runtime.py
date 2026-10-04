"""Assembly of the resident Brain process: journal, coordinator, projections and the supervisor loop.

The supervisor is an ordinary deterministic loop. It wakes on a bounded rescan interval (or an
explicit hint when a bundle manifest arrives), admits verified bundles, runs runnable jobs and
goes back to waiting. It makes no model call while idle and installs nothing: it runs only while
the user has started ``lecture-brain serve``.
"""
from __future__ import annotations

from datetime import datetime, timezone
import threading
import time
from typing import Any, Callable

from .annotations import AnnotationStore
from .config import Settings
from .coordinator import Coordinator, iso
from .journal import Journal, JobState as S, TERMINAL
from .maintenance import Maintenance
from .native import select_adapter
from .preparation import Preparation
from .projections import Projector
from .retention import Retention
from .transport.pairing import PairingRegistry
from .updater import consume_receipts


class Runtime:
    def __init__(self, settings: Settings, *, clock: Callable[[], float] = time.time):
        self.settings = settings
        self.clock = clock
        self.journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[] if settings.profile == "fixture" else settings.synced_roots)
        self.pairing = PairingRegistry(self.journal)
        self.adapter = select_adapter(settings, journal=self.journal)
        self.annotations = AnnotationStore(settings)
        self.preparation = Preparation(settings, self.annotations, now=self.now)
        self.coordinator = Coordinator(settings, journal=self.journal, pairing=self.pairing, adapter=self.adapter, clock=clock)
        self.maintenance = Maintenance(settings, self.journal, coordinator=self.coordinator)
        self.retention = Retention(settings, self.journal)
        self.projector = Projector(settings, self.journal, annotations=self.annotations, reviews=self.coordinator.reviews, resume=self.coordinator.resume,
                                   preparation=self.preparation, capabilities=lambda: self.maintenance.capabilities(self.adapter), rejections=self.coordinator.scanner.rejections, now=self.now)
        self.coordinator.internal_handlers["inventory-refresh"] = self._prepare_handler
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_tick: dict[str, Any] | None = None

    def now(self) -> str:
        return iso(self.clock())

    # ---- internal work ---------------------------------------------------------------------------
    def _prepare_handler(self, job: dict) -> dict[str, Any]:
        """One bounded preparation batch for a course; unfinished units are re-queued, never dropped."""
        report = self.preparation.prepare_course(job["course_id"], max_units=4)
        if report["remaining_unprepared"]:
            self.journal.enqueue_internal(workflow="WF02", course_id=job["course_id"], thread_key=f"prep-{job['course_id']}", priority=4,
                                          input_digest=f"{job['input_digest'][:40]}-cont-{report['remaining_unprepared']:04d}"[:64].ljust(64, "0"),
                                          detail={"kind": "inventory-refresh", "reason": "continuation of a bounded preparation batch", "needs_native": False})
        return report

    # ---- lifecycle -------------------------------------------------------------------------------
    def startup(self) -> dict[str, Any]:
        with self._lock:
            recovered = self.journal.recover_after_restart()
            self.maintenance.guard_native_identity()
            receipts = consume_receipts(self.settings, self.journal)
            return {"recovered": recovered, "updater": {"run": receipts["run"], "queued": len(receipts["queued"])}}

    def tick(self) -> dict[str, Any]:
        with self._lock:
            summary = self.coordinator.tick()
            summary["at"] = self.now()
            self.last_tick = summary
            return summary

    def has_runnable_work(self) -> bool:
        return bool(self.journal.jobs(states=[S.READY, S.CLAIMED, S.RUNNING, S.FAILED_RETRYABLE], limit=1))

    def nudge(self) -> None:
        """A filesystem/transport event is only a hint: it wakes the loop, which re-verifies everything."""
        self._wake.set()

    def _loop(self) -> None:
        idle_rounds = 0
        while not self._stop.is_set():
            try:
                self.tick()
                if idle_rounds % 8 == 0:
                    with self._lock:
                        consume_receipts(self.settings, self.journal)
            except Exception as exc:  # noqa: BLE001 - one failing round must not end the supervisor
                self.journal.add_receipt(kind="supervisor-error", job_id=None, payload={"error": str(exc)[:500], "at": self.now()})
            active = self.has_runnable_work()
            idle_rounds = 0 if active else idle_rounds + 1
            interval = float(self.settings.policy["active_rescan_seconds" if active else "idle_rescan_seconds"])
            self._wake.wait(timeout=0.2 if active else interval)
            self._wake.clear()

    def start_supervisor(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="ll-supervisor", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
        self.journal.close()

    # ---- convenience for the API ---------------------------------------------------------------
    def with_lock(self, fn: Callable[[], Any]) -> Any:
        with self._lock:
            return fn()

    def pending_counts(self) -> dict[str, int]:
        jobs = self.journal.jobs()
        return {"open": sum(1 for j in jobs if j["state"] not in TERMINAL), "total": len(jobs)}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
