"""Versioned resume checkpoints and multi-device conflicts (LL031).

A checkpoint is a non-performance device record: where the learner stopped, on which source
version, with which draft. It is never learning evidence. Continuity is decided by explicit
lineage (``parent_checkpoint``), never by comparing device clocks. Two heads that do not descend
from one another are shown as a conflict with both drafts preserved; choosing one is a deliberate
act recorded as a resolution, and the other draft is still kept.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import contracts as c
from .capture import safe_name
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive


class ResumeError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class ResumeStore:
    def __init__(self, settings: Settings):
        self._settings = settings

    def area(self, course_id: str) -> Path:
        return self._settings.app_area(course_id) / "resume"

    def _rel(self, course_id: str, path: Path) -> str:
        return path.relative_to(self._settings.write_root(course_id)).as_posix()

    def save_checkpoint(self, course_id: str, record_bytes: bytes, draft_bytes: bytes | None = None) -> dict[str, Any]:
        try:
            record = c.parse_json(record_bytes)
        except c.ContractError as exc:
            raise ResumeError("invalid_checkpoint", str(exc)) from exc
        errors = c.validate("resume", record)
        if errors:
            raise ResumeError("invalid_checkpoint", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise ResumeError("identity_mismatch", "checkpoint belongs to another course")
        draft = record["cursor"]["draft"]
        if draft is not None:
            if draft_bytes is None or c.sha256_hex(draft_bytes) != draft["sha256"] or len(draft_bytes) != draft["bytes"]:
                raise ResumeError("draft_mismatch", "the checkpoint's draft bytes were not supplied or do not match")
            publish_exclusive(self.area(course_id) / "drafts" / draft["sha256"], draft_bytes)  # every draft version is kept
        path = self.area(course_id) / safe_name(record["device_id"]) / f"{safe_name(record['checkpoint_id'])}.json"
        try:
            result = publish_exclusive(path, record_bytes)
        except ExclusiveConflict as exc:
            raise ResumeError("checkpoint_conflict", "this checkpoint id already exists with different content") from exc
        return {"status": "saved" if result == "created" else "already_saved", "artifact": c.artifact_for_bytes(record_bytes, self._rel(course_id, path), "application/json")}

    def read_draft(self, course_id: str, sha256: str) -> bytes | None:
        path = self.area(course_id) / "drafts" / sha256
        return path.read_bytes() if path.is_file() and c.sha256_hex(path.read_bytes()) == sha256 else None

    def resolve(self, course_id: str, *, chosen_checkpoint_id: str, set_aside: list[str], resolution_id: str, at: str) -> None:
        """Record a deliberate choice between competing heads. Set-aside drafts are retained, not deleted."""
        data = c.dump_json({"resolution_id": resolution_id, "chosen": chosen_checkpoint_id, "set_aside": sorted(set_aside), "at": at})
        publish_exclusive(self.area(course_id) / "resolutions" / f"{safe_name(resolution_id)}.json", data)

    def state(self, course_id: str) -> dict[str, Any]:
        checkpoints: dict[str, dict] = {}
        area = self.area(course_id)
        if area.is_dir():
            for device_dir in sorted(p for p in area.iterdir() if p.is_dir() and p.name not in {"drafts", "resolutions"}):
                for path in sorted(device_dir.glob("*.json")):
                    data = path.read_bytes()
                    try:
                        record = c.parse_json(data)
                    except c.ContractError:
                        continue
                    if c.validate("resume", record):
                        continue
                    checkpoints[record["checkpoint_id"]] = {"record": record, "artifact": c.artifact_for_bytes(data, self._rel(course_id, path), "application/json")}
        set_aside: set[str] = set()
        resolutions = area / "resolutions"
        if resolutions.is_dir():
            for path in resolutions.glob("*.json"):
                try:
                    set_aside |= set(c.parse_json(path.read_bytes())["set_aside"])
                except (c.ContractError, KeyError):
                    continue
        parents = {entry["record"]["parent_checkpoint"]["record_id"] for entry in checkpoints.values() if entry["record"]["parent_checkpoint"]}
        heads = [e for cid, e in checkpoints.items() if cid not in parents and cid not in set_aside]
        heads.sort(key=lambda e: (e["record"]["device_id"], e["record"]["sequence"]))

        def view(entry: dict) -> dict:
            record = entry["record"]
            return {"checkpoint_id": record["checkpoint_id"], "device_id": record["device_id"], "session_id": record["session_id"], "sequence": record["sequence"],
                    "cursor": record["cursor"], "updated_at": record["updated_at"], "parent": record["parent_checkpoint"]["record_id"] if record["parent_checkpoint"] else None,
                    "artifact": entry["artifact"], "autoplay": False}

        if len(heads) <= 1:
            return {"course_id": course_id, "current": view(heads[0]) if heads else None, "conflict": None, "checkpoints": len(checkpoints)}
        return {"course_id": course_id, "current": None, "checkpoints": len(checkpoints),
                "conflict": {"heads": [view(h) for h in heads],
                             "note": "Competing checkpoints from different lineages. Device clocks are not used to pick one; both drafts are kept until you choose."}}
