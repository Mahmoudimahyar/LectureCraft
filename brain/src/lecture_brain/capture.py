"""Immutable full-turn capture (Capture.freeze / Capture.verify).

Layout (the existing operational run role; never ``learning/attempts/``):

    .agent/course-learning/runs/<run-id>/
        turns/<turn-id>.json          exact question shown + actual learner input   (immutable)
        messages/<message-id>.json    learner question or delivered tutor text      (immutable)
        attachments/<sha256>          necessary evidence bytes, content addressed   (immutable)
        receipts/<receipt-id>.json    assessment/writer identity and outcomes
        proposals/<proposal-id>.json  uncommitted assessment/diagnostic proposals

The learner snapshot is frozen and read back before any inference. Later tutor text is a separate
record. A locator is trusted only after its bytes are re-read and hashed here; a non-empty string
is not proof.
"""
from __future__ import annotations

from pathlib import Path
import hashlib
import re
from typing import Any

from . import contracts as c
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive

RUNS_PREFIX = ".agent/course-learning/runs/"
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$")


class CaptureError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class CaptureConflict(CaptureError):
    def __init__(self, message: str):
        super().__init__("capture_conflict", message)


def safe_name(identifier: str) -> str:
    """Filename for a contract id. Ids may contain ':' (not portable), so those are digested."""
    if _SAFE.match(identifier) and not identifier.endswith(".") and c.safe_relative(identifier):
        return identifier
    return "x-" + hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:40]


class CaptureStore:
    def __init__(self, settings: Settings):
        self._settings = settings

    def run_rel(self, session_id: str) -> str:
        return f"{RUNS_PREFIX}ll-{safe_name(session_id)}"

    def _publish(self, course_id: str, rel: str, data: bytes, media_type: str = "application/json") -> dict:
        root = self._settings.write_root(course_id)
        try:
            publish_exclusive(root / rel, data)
        except ExclusiveConflict as exc:
            raise CaptureConflict(f"{rel}: same identity, different bytes") from exc
        return c.artifact_for_bytes(data, rel, media_type)

    # ---- freeze ------------------------------------------------------------------------------
    def freeze_submission(self, course_id: str, submission_bytes: bytes, attachments: dict[str, bytes] | None = None) -> dict:
        """Persist the exact submitted bytes exclusively and read them back. Returns the artifact reference."""
        try:
            record = c.parse_json(submission_bytes)
        except c.ContractError as exc:
            raise CaptureError("invalid_submission", str(exc)) from exc
        errors = c.validate("submission", record)
        if errors:
            raise CaptureError("invalid_submission", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise CaptureError("identity_mismatch", "submission belongs to another course")
        run = self.run_rel(record["session_id"])
        provided = attachments or {}
        for artifact in [*record["question"]["attachments"], *record["response"]["attachments"]]:
            data = provided.get(artifact["path"])
            if data is None:
                continue  # input is still retained; verification will block assessment
            if c.sha256_hex(data) != artifact["sha256"] or len(data) != artifact["bytes"]:
                raise CaptureError("attachment_mismatch", f"attachment {artifact['path']} does not match its declared digest")
            self._publish(course_id, f"{run}/attachments/{artifact['sha256']}", data, artifact["media_type"])
        return self._publish(course_id, f"{run}/turns/{safe_name(record['turn_id'])}.json", submission_bytes)

    def freeze_message(self, course_id: str, session_id: str, message_bytes: bytes) -> dict:
        try:
            record = c.parse_json(message_bytes)
        except c.ContractError as exc:
            raise CaptureError("invalid_message", str(exc)) from exc
        errors = c.validate("message", record)
        if errors:
            raise CaptureError("invalid_message", "; ".join(errors[:3]))
        if record["scope"]["course_id"] != course_id:
            raise CaptureError("identity_mismatch", "message belongs to another course")
        return self._publish(course_id, f"{self.run_rel(session_id)}/messages/{safe_name(record['message_id'])}.json", message_bytes)

    def write_record(self, course_id: str, session_id: str, folder: str, record_id: str, data: bytes) -> dict:
        """Receipts and proposals: immutable operational records beside the turn."""
        if folder not in {"receipts", "proposals", "context"}:
            raise CaptureError("unsafe_locator", f"unknown run folder {folder}")
        return self._publish(course_id, f"{self.run_rel(session_id)}/{folder}/{safe_name(record_id)}.json", data)

    def write_or_existing(self, course_id: str, session_id: str, folder: str, record_id: str, data: bytes) -> dict:
        """For records regenerated when a job resumes (context receipts): the first write stands."""
        try:
            return self.write_record(course_id, session_id, folder, record_id, data)
        except CaptureConflict:
            rel = f"{self.run_rel(session_id)}/{folder}/{safe_name(record_id)}.json"
            return c.artifact_for_bytes((self._settings.write_root(course_id) / rel).read_bytes(), rel, "application/json")

    def read_message(self, course_id: str, session_id: str, message_id: str) -> tuple[dict, dict]:
        rel = f"{self.run_rel(session_id)}/messages/{safe_name(message_id)}.json"
        data = (self._settings.write_root(course_id) / rel).read_bytes()
        return c.parse_json(data), c.artifact_for_bytes(data, rel, "application/json")

    # ---- verify ------------------------------------------------------------------------------
    def _resolve(self, course_id: str, rel: str) -> Path:
        if not isinstance(rel, str) or not rel.startswith(RUNS_PREFIX) or not c.safe_relative(rel):
            raise CaptureError("unsafe_locator", "locator is not an allowed course-relative run path")
        try:
            return c.resolve_inside(self._settings.write_root(course_id), rel)
        except c.ContractError as exc:
            raise CaptureError("unsafe_locator", str(exc)) from exc

    def read(self, course_id: str, artifact: dict) -> bytes:
        path = self._resolve(course_id, artifact["path"])
        if not path.is_file():
            raise CaptureError("missing_snapshot", f"{artifact['path']} is not present")
        data = path.read_bytes()
        if len(data) != artifact["bytes"] or c.sha256_hex(data) != artifact["sha256"]:
            raise CaptureError("hash_mismatch", f"{artifact['path']} bytes differ from the recorded digest")
        return data

    def verify(self, course_id: str, artifact: dict, *, expect_turn_id: str | None = None, expect_logical_input_id: str | None = None, excerpt: str | None = None) -> dict[str, Any]:
        """Re-read and check a frozen submission. Raises :class:`CaptureError`; never repairs or substitutes."""
        data = self.read(course_id, artifact)
        try:
            record = c.parse_json(data)
        except c.ContractError as exc:
            raise CaptureError("invalid_submission", str(exc)) from exc
        if c.validate("submission", record):
            raise CaptureError("invalid_submission", "frozen record no longer validates")
        if record["scope"]["course_id"] != course_id or record["scope"]["term"] != self._settings.course(course_id).term:
            raise CaptureError("identity_mismatch", "snapshot belongs to another course/term")
        if expect_turn_id is not None and record["turn_id"] != expect_turn_id:
            raise CaptureError("identity_mismatch", "snapshot is a different turn")
        if expect_logical_input_id is not None and record["logical_input_id"] != expect_logical_input_id:
            raise CaptureError("identity_mismatch", "snapshot is a different logical learner input")
        run = artifact["path"].rsplit("/turns/", 1)[0]
        for attachment in [*record["question"]["attachments"], *record["response"]["attachments"]]:
            path = self._resolve(course_id, f"{run}/attachments/{attachment['sha256']}")
            if not path.is_file():
                raise CaptureError("missing_attachment", f"attachment {attachment['path']} bytes were not captured")
            blob = path.read_bytes()
            if c.sha256_hex(blob) != attachment["sha256"] or len(blob) != attachment["bytes"]:
                raise CaptureError("hash_mismatch", f"attachment {attachment['path']} bytes differ from the recorded digest")
        if excerpt is not None and excerpt not in (record["response"]["text"] or ""):
            raise CaptureError("excerpt_not_in_original", "the excerpt is not contained in the captured response")
        return record
