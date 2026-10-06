"""Shared wire validation for the NEW adapter contracts (contracts/v1).

One schema set (JSON Schema 2020-12) plus the documented cross-field rules. This is not a
dispatcher, authorizer, canonical writer, or a replacement for course-learning-v1. Schemas are
loaded only from the local contracts directory; nothing is ever fetched from a payload URL.
"""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import math
import os
from typing import Any, Iterator

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

MAX_JSON_BYTES = 4_000_000
MAX_MANIFEST_BYTES = 262_144
MAX_BUNDLE_BYTES = 268_435_456
MAX_BUNDLE_FILES = 64
_RESERVED = {"con", "nul", "prn", "aux", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
_SUBMISSION_ACTIVITY = {
    "explain": "explain_back",
    "practice": "practice",
    "diagnose": "diagnostic_answer",
    "review_answer": "review_answer",
}


class ContractError(ValueError):
    """Input cannot be interpreted under the local contract set (fail closed)."""


def contracts_dir() -> Path:
    override = os.environ.get("LL_CONTRACTS_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "contracts" / "index.json").is_file():
            return parent / "contracts"
    raise ContractError("contracts directory not found; set LL_CONTRACTS_DIR")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dump_json(value: Any) -> bytes:
    """Serialize once, deterministically. Receivers verify these exact bytes; they never reserialize."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def parse_json(raw: bytes | str, *, max_bytes: int = MAX_JSON_BYTES) -> Any:
    """Strict JSON: UTF-8 without BOM, no duplicate properties, no non-finite numbers, bounded size."""
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > max_bytes:
        raise ContractError("JSON size limit exceeded")
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ContractError("JSON must be UTF-8 without BOM")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ContractError("JSON is not valid UTF-8") from exc

    def unique(pairs):
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ContractError(f"Duplicate JSON property: {key}")
            result[key] = value
        return result

    def reject_constant(value: str):
        raise ContractError(f"Non-finite JSON value: {value}")

    def finite(value: str) -> float:
        number = float(value)
        if not math.isfinite(number):
            raise ContractError("Non-finite JSON number")
        return number

    try:
        return json.loads(text, object_pairs_hook=unique, parse_constant=reject_constant, parse_float=finite)
    except ContractError:
        raise
    except (json.JSONDecodeError, RecursionError) as exc:
        raise ContractError(f"Malformed JSON: {exc}") from exc


def load_json(path: Path, *, max_bytes: int = MAX_JSON_BYTES) -> Any:
    if path.stat().st_size > max_bytes:
        raise ContractError("JSON size limit exceeded")
    return parse_json(path.read_bytes(), max_bytes=max_bytes)


@lru_cache(maxsize=1)
def _schemas() -> tuple[dict[str, dict], Registry, dict]:
    base = contracts_dir()
    docs = [load_json(p) for p in sorted((base / "v1").glob("*.schema.json"))]
    by_name = {s["$id"].rsplit("/", 1)[-1].removesuffix(".schema.json"): s for s in docs}
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in docs)
    index = load_json(base / "index.json")
    declared = {entry["name"] for entry in index["schemas"]}
    if declared | {"common"} != set(by_name):
        raise ContractError("contracts/index.json does not match the local schema files")
    return by_name, registry, index


def schema_names() -> list[str]:
    return sorted(n for n in _schemas()[0] if n != "common")


def schema(name: str) -> dict:
    schemas = _schemas()[0]
    if name not in schemas or name == "common":
        raise ContractError("Unknown local schema; network retrieval disabled")
    return schemas[name]


def payload_schema_for(action: str) -> str:
    mapping = _schemas()[2]["action_payloads"]
    if action not in mapping:
        raise ContractError(f"Action has no typed payload: {action}")
    return mapping[action]


def _walk(value: Any) -> Iterator[Any]:
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def safe_relative(name: Any) -> bool:
    """Portable relative artifact path: no absolute/drive/backslash/control/traversal/reserved parts."""
    if not isinstance(name, str) or not name or len(name) > 512 or name.startswith("/"):
        return False
    if any(ch in name for ch in "\\:") or any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
        return False
    for part in name.split("/"):
        if part in {"", ".", ".."} or part.endswith((" ", ".")):
            return False
        if part.split(".")[0].lower() in _RESERVED:
            return False
    return True


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def semantic(name: str, v: dict) -> list[str]:
    errors: list[str] = []
    for node in _walk(v):
        if not isinstance(node, dict):
            continue
        if "path" in node and "sha256" in node and not safe_relative(node["path"]):
            errors.append("Unsafe portable relative artifact path")
        kind = node.get("kind")
        if kind == "media" and "start_ms" in node and node["end_ms"] <= node["start_ms"]:
            errors.append("Media interval must be nonempty and ordered")
        if kind == "lines" and "start" in node and node["end"] < node["start"]:
            errors.append("Line range must be ordered")
        if kind == "figure" and "xywh" in node:
            x, y, w, h = node["xywh"]
            if w <= 0 or h <= 0 or x + w > 1 or y + h > 1:
                errors.append("Figure box outside page or empty")
    if name == "request" and v["expires_at"] is not None and _time(v["expires_at"]) <= _time(v["submitted_at"]):
        errors.append("Request expires before submission")
    if name == "bundle":
        names = [a["path"] for a in v["files"]]
        if not safe_relative(v["record_path"]):
            errors.append("Unsafe portable relative artifact path")
        if len({p.casefold() for p in names}) != len(names):
            errors.append("Duplicate/case-colliding bundle paths")
        if v["record_path"] not in names:
            errors.append("Entry record missing from manifest")
        if any(p in {"ready.json", "ready.sig.json"} for p in names):
            errors.append("Manifest/signature cannot hash themselves")
        if sum(a["bytes"] for a in v["files"]) > MAX_BUNDLE_BYTES:
            errors.append("Bundle byte limit exceeded")
    if name in {"submission", "review-item"}:
        q = v["question"]
        if (q["family_id"] is None) != (q["family_revision"] is None):
            errors.append("Family ID/revision must be paired")
    if name == "submission":
        r = v["response"]
        if (v["time_basis"] == "unknown") != (v["occurred_at"] is None):
            errors.append("Unknown occurrence time must remain null")
        if r["text"] is None and not r["attachments"]:
            errors.append("Actual response missing")
        if r["kind"] == "attachment" and not r["attachments"]:
            errors.append("Attachment response needs content")
        if r["kind"] in {"text", "voice_transcript"} and r["text"] is None:
            errors.append("Text/transcript response missing text")
        if r["kind"] == "voice_transcript" and r["transcription_revision"] is None:
            errors.append("Transcript needs revision identity")
    if name == "message" and v["role"] == "learner_question" and v["assessment_disposition"] != "not_assessed":
        errors.append("A submitted help question is not a graded learner attempt")
    if name == "control" and v["command"]["kind"] == "cancel" and v["command"]["target_request_id"] == v["request_id"]:
        errors.append("Cancellation must target an earlier different request")
    if name == "native-result":
        if v["terminal"] != (v["state"] != "completion_unknown"):
            errors.append("Terminal status inconsistent")
        if v["state"] == "completed" and (not v["output_files"] or v["failure_code"] is not None):
            errors.append("Completed result lacks valid output or carries failure")
        if v["state"] == "failed" and v["failure_code"] is None:
            errors.append("Failure requires reason code")
    if name == "publication":
        saved = v["status"] in {"saved", "already_saved"}
        if saved != (v["canonical_record"] is not None):
            errors.append("Canonical reference inconsistent with save status")
        if saved and v["kind"] == "none":
            errors.append("Nonassessment action cannot pretend it published evidence")
        if saved and v["kind"] in {"attempt", "assessment_revision"} and v["captured_submission"] is None:
            errors.append("Full input reference required")
        if v["status"] == "not_requested" and v["kind"] != "none":
            errors.append("Not-requested publication must be none")
    if name == "annotation":
        if v["review_state"] == "confirmed" and v["reviewer_ref"] is None:
            errors.append("Confirmed annotation requires accountable review")
        if v["relation"] in {"displayed_during", "discussed_during"} and v["to"]["locator"]["kind"] != "media":
            errors.append("Timing relationship requires media target")
        if (v["revision"] == 1) != (v["supersedes"] is None):
            errors.append("Annotation revision predecessor required")
    if name == "review-item":
        if v["selection"] == "active" and (v["scheduler_config"] is None or v["question"]["family_id"] is None):
            errors.append("Active assessed item needs family and scheduler")
        if (v["revision"] == 1) != (v["supersedes"] is None):
            errors.append("Review revision predecessor required")
    if name == "review-event":
        if v["apply_schedule"] and (
            v["attempt"] is None
            or v["rating"] is None
            or v["rating_basis"] == "unresolved"
            or v["assistance_before_answer"] != "none_reported"
        ):
            errors.append("No automatic schedule update without supported unassisted observed rating")
        if v["rating_basis"] == "unresolved" and v["rating"] is not None:
            errors.append("Unresolved rating cannot choose score")
    if name == "view":
        paths = [a["path"] for a in v["outputs"]]
        if len(paths) != len(set(paths)):
            errors.append("Duplicate output")
    return errors


_FORMATS = FormatChecker()


def validate(name: str, value: Any) -> list[str]:
    """Return human-readable violations (empty list = valid). Unknown schema raises ContractError."""
    target = schema(name)
    if any(isinstance(x, float) and not math.isfinite(x) for x in _walk(value)):
        return ["Non-finite value in record"]
    registry = _schemas()[1]
    errors = [e.message for e in Draft202012Validator(target, registry=registry, format_checker=_FORMATS).iter_errors(value)]
    return errors if errors else semantic(name, value)


def require_valid(name: str, value: Any) -> Any:
    errors = validate(name, value)
    if errors:
        raise ContractError(f"{name}: " + "; ".join(errors[:5]))
    return value


def validate_payload(request: dict, payload: dict) -> list[str]:
    """Cross-record intent checks only. Bytes, signature, permission and owner revision are separate gates."""
    errors = validate("request", request)
    if errors:
        return errors
    target = payload_schema_for(request["action"])
    errors = validate(target, payload)
    if errors:
        return errors
    if payload["scope"] != request["scope"]:
        errors.append("Payload course/term differs from request")
    if target == "message":
        if payload["request_id"] != request["request_id"] or payload["thread_key"] != request["thread_key"]:
            errors.append("Question request/thread identity mismatch")
        if payload["role"] != "learner_question" or payload["assessment_disposition"] != "not_assessed":
            errors.append("Ask action requires an unassessed learner question")
    if target == "submission":
        if payload["logical_input_id"] != request["logical_input_id"]:
            errors.append("Logical learner input mismatch")
        if payload["interaction"] != _SUBMISSION_ACTIVITY[request["action"]]:
            errors.append("Response activity differs from request")
    if target == "control":
        if payload["request_id"] != request["request_id"]:
            errors.append("Control request identity mismatch")
        if payload["command"]["kind"] != request["action"]:
            errors.append("Control action differs from outer request")
    if target == "resume" and payload["device_id"] != request["device_id"]:
        errors.append("Resume belongs to another device")
    return errors


def artifact(path: Path, relative: str, media_type: str) -> dict:
    data = path.read_bytes()
    return {"path": relative, "sha256": sha256_hex(data), "bytes": len(data), "media_type": media_type}


def artifact_for_bytes(data: bytes, relative: str, media_type: str) -> dict:
    return {"path": relative, "sha256": sha256_hex(data), "bytes": len(data), "media_type": media_type}


def resolve_inside(root: Path, relative: str, *, checked: dict | None = None) -> Path:
    """Resolve a declared relative path under a trusted root, refusing symlinks and escapes.

    ``checked`` is an optional memory for ONE listing of ONE root (pass the same dict for every file of that listing and
    throw it away afterwards): the folders already found link-free and inside the root are not examined again, so a
    folder's files cost one look each instead of one per path component. Every path gets the verdict it gets without
    it: a parent that is a link or leads outside refuses all its files, and a plain file under checked parents resolves
    to ``<parent>/<name>``, which is inside."""
    if not safe_relative(relative):
        raise ContractError("Unsafe portable relative artifact path")
    if checked is None:
        current = root
        for part in relative.split("/"):
            current = current / part
            if current.is_symlink():
                raise ContractError("Symlink in artifact path")
        if not current.resolve().is_relative_to(root.resolve()):
            raise ContractError("Path escapes trusted root")
        return current
    root_resolved = checked.get("")
    if root_resolved is None:
        root_resolved = checked[""] = root.resolve()
    parts = relative.split("/")
    current = root
    for part in parts[:-1]:
        current = current / part
        verdict = checked.get(current)
        if verdict is None:
            verdict = checked[current] = "symlink" if current.is_symlink() else "inside" if current.resolve().is_relative_to(root_resolved) else "escape"
        if verdict == "symlink":
            raise ContractError("Symlink in artifact path")
        if verdict == "escape":
            raise ContractError("Path escapes trusted root")
    leaf = current / parts[-1]
    if leaf.is_symlink():
        raise ContractError("Symlink in artifact path")
    # A regular file is no link of its own; anything else (a folder, which may be a junction, or a missing name) is resolved.
    if not leaf.is_file() and not leaf.resolve().is_relative_to(root_resolved):
        raise ContractError("Path escapes trusted root")
    return leaf


def verify_files(root: Path, bundle: dict) -> list[str]:
    """Check that exactly the declared files exist with declared size and digest."""
    errors = validate("bundle", bundle)
    if errors:
        return errors
    if root.is_symlink():
        return ["Bundle root is a symlink"]
    root = root.resolve()
    listed = {f["path"] for f in bundle["files"]}
    for entry in bundle["files"]:
        try:
            path = resolve_inside(root, entry["path"])
        except ContractError as exc:
            errors.append(str(exc))
            continue
        try:
            if not path.is_file() or path.stat().st_size != entry["bytes"]:
                errors.append("Missing artifact or length mismatch")
                continue
            if sha256_hex(path.read_bytes()) != entry["sha256"]:
                errors.append("Artifact digest mismatch")
        except OSError:
            errors.append("Unreadable artifact")
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() or p.is_symlink()}
    if actual - {"ready.json", "ready.sig.json"} != listed:
        errors.append("Bundle contains missing or unlisted files")
    return errors
