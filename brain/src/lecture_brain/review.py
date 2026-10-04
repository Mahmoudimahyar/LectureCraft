"""Selected review items, immutable review events and the FSRS due projection (LL028 / LL029).

Selection and scheduling are operational facts, not learning evidence. One review event exists per
actually performed review; skips create none. The due queue is a pure projection: events are
replayed through py-fsrs with fuzzing disabled, so a later assessment correction changes the
computed schedule without adding a performed review. Uncertain or assisted reviews never feed a
rating to the scheduler automatically; they are kept as practice.
"""
from __future__ import annotations

from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
import re
from typing import Any, Callable

from fsrs import Card, Rating, Scheduler

from . import contracts as c
from .capture import safe_name
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive

_ITEM = re.compile(r"^(?P<id>.+)\.r(?P<rev>\d+)\.json$")
RATINGS = {"again": Rating.Again, "hard": Rating.Hard, "good": Rating.Good, "easy": Rating.Easy}


class ReviewError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _dt(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def rating_from_observations(observations: list[dict]) -> str | None:
    """Supported mapping from reviewed observable outcomes to a scheduler rating, or None (unresolved)."""
    outcomes = {o["outcome"] for o in observations}
    if not outcomes or outcomes & {"uncertain"} or outcomes == {"not_observed"}:
        return None
    if "not_demonstrated" in outcomes:
        return "again"
    if "partial" in outcomes:
        return "hard"
    return "good" if outcomes <= {"demonstrated", "not_observed"} else None


class ReviewStore:
    def __init__(self, settings: Settings):
        self._settings = settings

    def area(self, course_id: str) -> Path:
        return self._settings.app_area(course_id) / "review"

    def _rel(self, course_id: str, path: Path) -> str:
        return path.relative_to(self._settings.write_root(course_id)).as_posix()

    # ---- scheduler configuration (recorded, not assumed) ---------------------------------------
    def scheduler_config(self, course_id: str) -> dict:
        retention = float(self._settings.policy["fsrs_desired_retention"])
        scheduler = Scheduler(desired_retention=retention, enable_fuzzing=False)
        config = {"library": "fsrs (py-fsrs)", "library_version": metadata.version("fsrs"), "config": scheduler.to_dict(),
                  "note": "desired_retention is a scheduler setting, not a measured learner retention. Fuzzing disabled for reproducible replay."}
        data = c.dump_json(config)
        path = self.area(course_id) / f"scheduler-config.{c.sha256_hex(data)[:12]}.json"
        publish_exclusive(path, data)
        return c.artifact_for_bytes(data, self._rel(course_id, path), "application/json")

    # ---- items ----------------------------------------------------------------------------------
    def items(self, course_id: str) -> dict[str, Any]:
        history: dict[str, list[dict]] = {}
        directory = self.area(course_id) / "items"
        if directory.is_dir():
            for path in sorted(directory.iterdir()):
                match = _ITEM.match(path.name)
                if not match:
                    continue
                data = path.read_bytes()
                try:
                    record = c.parse_json(data)
                except c.ContractError:
                    continue
                if c.validate("review-item", record):
                    continue
                history.setdefault(record["item_id"], []).append({"record": record, "artifact": c.artifact_for_bytes(data, self._rel(course_id, path), "application/json")})
        for revisions in history.values():
            revisions.sort(key=lambda e: e["record"]["revision"])
        return {"current": {k: v[-1] for k, v in history.items()}, "history": history}

    def save_item(self, course_id: str, record_bytes: bytes) -> dict[str, Any]:
        try:
            record = c.parse_json(record_bytes)
        except c.ContractError as exc:
            raise ReviewError("invalid_item", str(exc)) from exc
        errors = c.validate("review-item", record)
        if errors:
            raise ReviewError("invalid_item", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise ReviewError("identity_mismatch", "item belongs to another course")
        head = self.items(course_id)["current"].get(record["item_id"])
        if head is None:
            if record["revision"] != 1:
                raise ReviewError("stale_base", "first revision must be 1")
        else:
            expected = {"record_id": record["item_id"], "artifact": head["artifact"]}
            if record["revision"] == head["record"]["revision"] and c.sha256_hex(record_bytes) == head["artifact"]["sha256"]:
                return {"status": "already_saved", "artifact": head["artifact"]}
            if record["revision"] != head["record"]["revision"] + 1 or record["supersedes"] != expected:
                return {"status": "conflict", "reason": "This item changed since you opened it. Compare the two versions before publishing; nothing was overwritten.", "current": head["record"]}
        path = self.area(course_id) / "items" / f"{safe_name(record['item_id'])}.r{record['revision']}.json"
        try:
            publish_exclusive(path, record_bytes)
        except ExclusiveConflict:
            return {"status": "conflict", "reason": "Another edit of this item was accepted first.", "current": head["record"] if head else None}
        return {"status": "saved", "artifact": c.artifact_for_bytes(record_bytes, self._rel(course_id, path), "application/json")}

    # ---- events ---------------------------------------------------------------------------------
    def events(self, course_id: str) -> list[dict]:
        out = []
        directory = self.area(course_id) / "events"
        if directory.is_dir():
            for path in sorted(directory.glob("*.json")):
                try:
                    record = c.parse_json(path.read_bytes())
                except c.ContractError:
                    continue
                if not c.validate("review-event", record):
                    out.append(record)
        out.sort(key=lambda e: (e["occurred_at"], e["event_id"]))
        return out

    def record_event(self, course_id: str, event_bytes: bytes) -> dict[str, Any]:
        """Exactly one event per performed review. Redelivery of the same bytes changes nothing."""
        try:
            record = c.parse_json(event_bytes)
        except c.ContractError as exc:
            raise ReviewError("invalid_event", str(exc)) from exc
        errors = c.validate("review-event", record)
        if errors:
            raise ReviewError("invalid_event", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise ReviewError("identity_mismatch", "event belongs to another course")
        item = self.items(course_id)["history"].get(record["item_id"])
        if not item or not any(e["record"]["revision"] == record["item_revision"] for e in item):
            raise ReviewError("unknown_item", "event names an item revision that does not exist")
        path = self.area(course_id) / "events" / f"{safe_name(record['event_id'])}.json"
        try:
            result = publish_exclusive(path, event_bytes)
        except ExclusiveConflict as exc:
            raise ReviewError("event_conflict", "this review event id already exists with different content") from exc
        return {"status": "saved" if result == "created" else "already_saved", "artifact": c.artifact_for_bytes(event_bytes, self._rel(course_id, path), "application/json")}

    # ---- due projection -------------------------------------------------------------------------
    def due_view(self, course_id: str, *, now: str, effective_observations: Callable[[str], list[dict] | None] | None = None) -> list[dict]:
        """Deterministic replay. ``effective_observations(attempt_id)`` supplies the current effective assessment."""
        retention = float(self._settings.policy["fsrs_desired_retention"])
        scheduler = Scheduler(desired_retention=retention, enable_fuzzing=False)
        events_by_item: dict[str, list[dict]] = {}
        for event in self.events(course_id):
            events_by_item.setdefault(event["item_id"], []).append(event)
        rows = []
        for item_id, entry in sorted(self.items(course_id)["current"].items()):
            record = entry["record"]
            events = events_by_item.get(item_id, [])
            card, scheduled, practice, pending = Card(card_id=1), 0, 0, 0
            for event in events:
                rating = event["rating"]
                if event["apply_schedule"] and event["rating_basis"] == "reviewed_observation" and event["attempt"] and effective_observations is not None:
                    observations = effective_observations(event["attempt"]["record_id"])
                    rating = rating_from_observations(observations) if observations is not None else rating
                if not event["apply_schedule"]:
                    practice += 1
                    pending += event["rating_basis"] == "unresolved"
                    continue
                if rating is None:  # the correction made the grade unresolved: no rating is fed to the scheduler
                    pending += 1
                    continue
                card, _ = scheduler.review_card(card, RATINGS[rating], review_datetime=_dt(event["occurred_at"]).astimezone(timezone.utc))
                scheduled += 1
            row = {"item_id": item_id, "revision": record["revision"], "kind": record["kind"], "selection": record["selection"], "question": record["question"],
                   "performed_reviews": len(events), "scheduled_reviews": scheduled, "practice_only_reviews": practice, "pending_grades": pending,
                   "due_at": None, "is_due": False, "schedule_note": None}
            if record["selection"] == "saved_only":
                row["schedule_note"] = "Saved only: not scheduled and never due."
            elif record["selection"] in {"suspended", "retired"}:
                row["schedule_note"] = f"{record['selection'].capitalize()}: history kept, no upcoming review."
            elif scheduled == 0:
                row.update(is_due=True, schedule_note="Active and not yet reviewed with a supported rating: available now.")
            else:
                due = card.due.astimezone(timezone.utc)
                row.update(due_at=due.strftime("%Y-%m-%dT%H:%M:%SZ"), is_due=due <= _dt(now), schedule_note="A due time is a scheduling suggestion, not evidence of forgetting.")
            rows.append(row)
        return rows
