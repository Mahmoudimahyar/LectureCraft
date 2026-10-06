"""The durable allowance ledger for speech processing: cumulative wall time under one grant, never reset.

One small JSON file (``<state_dir>/speech/allowance.json``):

* a reservation with its start time is written BEFORE any work is launched;
* while the work runs the reservation's heartbeat is refreshed, together with a lease: the time until which a worker
  may still be running if this process dies without another word;
* on completion the reservation is settled with the measured wall time;
* a reservation found open at the next start is settled conservatively, from its start to the end of its lease —
  never less than start .. last heartbeat.

The total only grows. It is not reset by a retry, by a new queue or by deleting work files. A missing ledger is
created only when the caller says nothing was ever done under the grant; an unreadable ledger, another grant, or a
total below what the journal already recorded is refused rather than replaced. The ceiling written at creation is not
raised by a later, larger number.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import time
from typing import Any, Callable
import uuid

from ..fsutil import replace_atomic

DOCUMENT = "speech-allowance/1"
_EPSILON = 1e-6


class LedgerRefused(Exception):
    """The ledger cannot be used as it is. ``code`` is the stable reason; nothing was written."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def write_json(path: Path, value: Any) -> None:
    """Atomic replace that survives a reader holding the file open for an instant (Windows refuses the rename then)."""
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
    for attempt in range(60):
        try:
            replace_atomic(path, data)
            return
        except PermissionError:
            time.sleep(0.02)
    replace_atomic(path, data)


def read_json(path: Path) -> Any:
    """The file's JSON, ``None`` when there is no file. Raises ``ValueError`` when it cannot be read as JSON."""
    for attempt in range(60):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except PermissionError:  # a writer is replacing it this instant
            time.sleep(0.02)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(str(exc)) from None
    raise ValueError("the file stayed locked")


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Allowance:
    def __init__(self, path: Path, *, clock: Callable[[], float] = time.time):
        self.path = Path(path)
        self._clock = clock
        self._doc: dict[str, Any] | None = None
        self._ceiling: float | None = None

    # ---- reading ----------------------------------------------------------------------------------------------------
    @staticmethod
    def peek(path: Path) -> dict[str, Any] | None:
        """The ledger as it is on disk, for a status readback. ``None`` when there is none; ``{"unreadable": ...}`` when damaged."""
        try:
            document = read_json(Path(path))
        except ValueError as exc:
            return {"unreadable": str(exc)[:200]}
        if document is None:
            return None
        return document if Allowance._valid(document) else {"unreadable": "not a speech allowance ledger"}

    @staticmethod
    def _valid(document: Any) -> bool:
        used = document.get("used_seconds") if isinstance(document, dict) else None
        return (isinstance(document, dict) and document.get("document") == DOCUMENT and isinstance(document.get("grant_id"), str)
                and isinstance(used, (int, float)) and not isinstance(used, bool) and math.isfinite(used) and used >= 0
                and isinstance(document.get("ceiling_seconds"), (int, float)) and isinstance(document.get("settled"), list)
                and (document.get("open") is None or isinstance(document.get("open"), dict)))

    @property
    def used_seconds(self) -> float:
        return float(self._require()["used_seconds"])

    @property
    def ceiling_seconds(self) -> float:
        self._require()
        return self._ceiling  # type: ignore[return-value]

    @property
    def remaining_seconds(self) -> float:
        return max(0.0, self.ceiling_seconds - self.used_seconds)

    @property
    def open_reservation(self) -> dict[str, Any] | None:
        return self._require()["open"]

    def _require(self) -> dict[str, Any]:
        if self._doc is None:
            raise RuntimeError("the ledger was not opened")
        return self._doc

    # ---- opening ----------------------------------------------------------------------------------------------------
    def open(self, *, grant_id: str, ceiling_seconds: float, may_create: bool, floor_seconds: float = 0.0) -> dict[str, Any]:
        """Load the ledger for this grant, or create it when the caller vouches that nothing was done under the grant yet.

        ``floor_seconds`` is the largest total another durable record (the journal's run receipts) already shows for
        the grant: a ledger below it is an older copy and is refused."""
        try:
            document = read_json(self.path)
        except ValueError as exc:
            raise LedgerRefused("ledger_unreadable", f"The allowance ledger cannot be read ({exc}); it is not replaced by a fresh one.") from None
        if document is None:
            if not may_create or floor_seconds > _EPSILON:
                raise LedgerRefused("ledger_missing", "The allowance ledger is missing although work was already done under this grant; the runner does not start from zero. Restore the ledger.")
            now = self._clock()
            document = {"document": DOCUMENT, "grant_id": grant_id, "ceiling_seconds": ceiling_seconds, "used_seconds": 0.0, "open": None, "settled": [],
                        "created_at": _iso(now), "updated_at": _iso(now)}
            write_json(self.path, document)
        elif not self._valid(document):
            raise LedgerRefused("ledger_unreadable", "The allowance ledger is not a speech allowance ledger; it is not replaced by a fresh one.")
        if document["grant_id"] != grant_id:
            raise LedgerRefused("grant_mismatch", f"The ledger belongs to grant {document['grant_id']!r}; the binding names {grant_id!r}. Another grant does not get a fresh allowance by itself.")
        if float(document["used_seconds"]) + _EPSILON < floor_seconds:
            raise LedgerRefused("ledger_behind_journal", f"The ledger shows {document['used_seconds']} s used; the journal already recorded {floor_seconds} s under this grant.")
        self._doc = document
        self._ceiling = min(float(document["ceiling_seconds"]), float(ceiling_seconds))  # never raised by a later, larger number
        return document

    # ---- writing ----------------------------------------------------------------------------------------------------
    def _write(self, document: dict[str, Any]) -> None:
        if float(document["used_seconds"]) + _EPSILON < float(self._require()["used_seconds"]):
            raise RuntimeError("the allowance total can only grow")
        document["updated_at"] = _iso(self._clock())
        write_json(self.path, document)
        self._doc = document

    def reserve(self, run_id: str, *, lease_seconds: float) -> dict[str, Any]:
        """Open a reservation NOW, durably, before the caller launches any work."""
        document = dict(self._require())
        if document["open"] is not None:
            raise RuntimeError("a reservation is already open; recover it first")
        now = self._clock()
        document["open"] = {"reservation_id": uuid.uuid4().hex[:16], "run_id": run_id, "started_at": now, "heartbeat_at": now, "lease_until": now + lease_seconds, "pid": os.getpid()}
        self._write(document)
        return document["open"]

    def heartbeat(self, *, lease_seconds: float) -> None:
        document = dict(self._require())
        if document["open"] is None:
            raise RuntimeError("no reservation is open")
        now = self._clock()
        document["open"] = {**document["open"], "heartbeat_at": now, "lease_until": now + lease_seconds}
        self._write(document)

    def _close(self, seconds: float, how: str) -> dict[str, Any]:
        document = dict(self._require())
        reservation = document["open"]
        entry = {"reservation_id": reservation["reservation_id"], "run_id": reservation["run_id"], "started_at": reservation["started_at"], "heartbeat_at": reservation["heartbeat_at"],
                 "ended_at": self._clock(), "seconds": seconds, "how": how}
        document["open"] = None
        document["settled"] = [*document["settled"], entry]
        document["used_seconds"] = float(document["used_seconds"]) + seconds
        self._write(document)
        return entry

    def settle(self, seconds: float) -> float:
        """Close the open reservation with the wall time the work actually took. Returns the new total."""
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0:
            raise ValueError("settled time must be a finite number that is not negative")
        if self._require()["open"] is None:
            raise RuntimeError("no reservation is open")
        self._close(float(seconds), "completed")
        return self.used_seconds

    def seconds_until_lease_ends(self) -> float:
        """How long a worker of the open reservation may still be alive. A new worker must not start before that."""
        reservation = self._require()["open"]
        return 0.0 if reservation is None else max(0.0, float(reservation["lease_until"]) - self._clock())

    def recover(self) -> dict[str, Any] | None:
        """Settle a reservation left open by a run that ended without settling: start .. end of its lease."""
        reservation = self._require()["open"]
        if reservation is None:
            return None
        started, heartbeat, lease = float(reservation["started_at"]), float(reservation["heartbeat_at"]), float(reservation["lease_until"])
        return self._close(max(0.0, lease - started, heartbeat - started), "recovered_conservative")
