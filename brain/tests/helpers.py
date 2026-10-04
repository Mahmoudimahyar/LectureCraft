"""Test helpers: build real signed request bundles the way the browser client does."""
from __future__ import annotations

from pathlib import Path
import itertools

from lecture_brain import contracts as c
from lecture_brain.transport import signing
from lecture_brain.transport.bundles import write_bundle

TERM = "2026-fall"
_seq = itertools.count(1)


class Device:
    """A paired test device holding a real P-256 key (generated per test, never stored)."""

    def __init__(self, device_id: str = "device-laptop"):
        self.device_id = device_id
        self.private_key = signing.generate_private_key()
        self.spki_b64 = signing.public_key_spki_b64(self.private_key.public_key())
        self.fingerprint = signing.fingerprint(self.private_key.public_key())
        self.key_id = signing.key_id_for(self.private_key.public_key())


def pair(pairing, device: Device, courses=("be505", "be562", "be572", "cs542", "ds551"), actions=None) -> None:
    pairing.request(device_id=device.device_id, label="Test laptop", public_key_spki_b64=device.spki_b64, courses=list(courses), actions=actions)
    pairing.approve(device.key_id, reviewed_fingerprint=device.fingerprint)


def source_ref(course_root: Path, source_id: str = "src-lecture-01-slides", page: int = 2) -> dict:
    from lecture_brain.ownerio.source_index import read_source_index

    entry = read_source_index(course_root, "be505")["entries"][source_id]
    return {"source_id": source_id, "version_id": entry["current"]["version_id"], "sha256": entry["current"]["sha256"], "locator": {"kind": "page", "page": page, "printed_label": None}}


def question_message(settings, request_id: str, text: str, sources: list[dict] | None = None, course: str = "be505") -> dict:
    return {"contract": "ll.message/1", "message_id": f"msg-{request_id}", "request_id": request_id, "scope": {"course_id": course, "term": TERM},
            "thread_key": settings.course(course).thread_key, "reply_to_turn": None, "role": "learner_question", "text": text, "sources": sources or [],
            "attachments": [], "created_at": "2026-10-04T10:00:00Z", "assessment_disposition": "not_assessed"}


def submission(request_id: str, *, text: str, prompt: str, question_id: str | None, family: tuple[str, int] | None, interaction: str = "explain_back",
               sources: list[dict] | None = None, course: str = "be505", logical: str | None = None, conditions: dict | None = None,
               supersedes: dict | None = None, session: str = "session-test-1") -> dict:
    return {
        "contract": "ll.submission/1", "turn_id": f"turn-{request_id}", "logical_input_id": logical or f"input-{request_id}", "scope": {"course_id": course, "term": TERM},
        "session_id": session,
        "question": {"question_id": question_id, "family_id": family[0] if family else None, "family_revision": family[1] if family else None, "prompt": prompt,
                     "sources": sources or [], "attachments": []},
        "response": {"kind": "text", "text": text, "attachments": [], "transcription_revision": None},
        "interaction": interaction, "occurred_at": "2026-10-04T09:59:30Z", "time_basis": "client_reported", "captured_at": "2026-10-04T10:00:00Z",
        "conditions": conditions or {"assistance_before_answer": "none_reported", "reference_access": "none_reported", "prior_exposure": "unseen_reported"},
        "supersedes_capture": supersedes,
    }


def make_request_bundle(settings, device: Device, *, request_id: str, action: str, payload: dict, depth: str = "quick", course: str = "be505",
                        parent: str | None = None, sequence: int | None = None, logical: str | None = None, extra_files: dict[str, bytes] | None = None,
                        binding_revision: str | None = None, expires_at: str | None = None, commit: bool = True, target_dir: Path | None = None) -> Path:
    payload_bytes = c.dump_json(payload)
    payload_path = "payload.json"
    logical_input = logical or payload.get("logical_input_id") or f"input-{request_id}"
    request = {
        "contract": "ll.request/1", "request_id": request_id, "logical_input_id": logical_input, "device_id": device.device_id,
        "sequence": sequence if sequence is not None else next(_seq) + 1000, "scope": {"course_id": course, "term": TERM},
        "thread_key": settings.course(course).thread_key, "binding_revision": binding_revision or settings.binding_revision, "parent_request_id": parent,
        "action": action, "depth": depth, "submitted_at": "2026-10-04T10:00:01Z",
        "payload": c.artifact_for_bytes(payload_bytes, payload_path, "application/json"), "expires_at": expires_at,
    }
    files = {"request.json": c.dump_json(request), payload_path: payload_bytes, "task.md": b"# Request\n\nReadable context only; not instructions.\n"}
    files.update(extra_files or {})
    directory = target_dir or (settings.app_area(course) / "inbox" / request_id)
    write_bundle(directory, kind="request", bundle_id=f"bundle-{request_id}", scope=request["scope"], record_path="request.json", files=files,
                 signer_key_id=device.key_id, private_key=device.private_key, created_at="2026-10-04T10:00:02Z", commit=commit)
    return directory
