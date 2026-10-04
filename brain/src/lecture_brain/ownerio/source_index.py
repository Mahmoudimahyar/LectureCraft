"""Read the owner's published source index (course-tracking-v1) without consuming a mixed bundle."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..contracts import sha256_hex
from . import OwnerReadError, parse_owner_json, read_owner_bytes, require_identity

INDEX_REL = ".agent/source-index.json"
MARKER_REL = ".agent/course-tracking/publication.json"


def _version(v: dict) -> dict:
    return {"version_id": v["version_id"], "sha256": v.get("sha256"), "availability": v.get("availability"), "observed_at": v.get("observed_at"),
            "planning_review": v.get("planning_review")}


def read_source_index(root: Path, course_id: str) -> dict[str, Any]:
    """Return the published index, verified against its publication marker.

    The five-file tracking bundle is replaced non-atomically by the owner's publisher, so the index
    is only trusted when its bytes hash to the value pinned by the marker, and the marker is
    unchanged after the read. A mismatch means "unavailable for now", never "new data".
    """
    marker_path = root / ".agent" / "course-tracking" / "publication.json"
    index_path = root / ".agent" / "source-index.json"
    marker_bytes = read_owner_bytes(marker_path, what=MARKER_REL)
    marker = parse_owner_json(marker_bytes, what=MARKER_REL)
    if not isinstance(marker, dict) or marker.get("contract_version") != "course-tracking-publication-v1":
        raise OwnerReadError("unsupported_contract", "publication marker is not course-tracking-publication-v1")
    require_identity(marker, course_id, what=MARKER_REL)
    pinned = (marker.get("files") or {}).get(INDEX_REL)
    index_bytes = read_owner_bytes(index_path, what=INDEX_REL)
    digest = sha256_hex(index_bytes)
    if pinned != digest:
        raise OwnerReadError("mixed_bundle", "source index bytes do not match the publication marker; do not consume a mixed snapshot")
    if read_owner_bytes(marker_path, what=MARKER_REL) != marker_bytes:
        raise OwnerReadError("changed_while_reading", "publication changed while reading; retry a fresh read")
    index = parse_owner_json(index_bytes, what=INDEX_REL)
    require_identity(index, course_id, what=INDEX_REL, contract="course-tracking-v1")
    if index.get("record_state") != "live":
        raise OwnerReadError("not_live", f"source index record_state is {index.get('record_state')!r}")

    entries: dict[str, dict] = {}
    for raw in index.get("sources", []):
        versions = [_version(v) for v in raw.get("versions", [])]
        current = next((v for v in versions if v["version_id"] == raw.get("current_version_id")), None)
        if current is None:
            raise OwnerReadError("invalid_record", f"source {raw.get('source_id')!r} has no current version entry")
        if raw["source_id"] in entries:
            raise OwnerReadError("invalid_record", f"duplicate source id {raw['source_id']!r}")
        entries[raw["source_id"]] = {
            "source_id": raw["source_id"], "role": raw.get("role"), "kind": raw.get("kind"), "path": raw.get("current_path"),
            "original_filename": raw.get("original_filename"), "origin_id": raw.get("origin_id"), "source_date": raw.get("source_date"),
            "related_source_ids": list(raw.get("related_source_ids") or []), "current": current,
            "historical_versions": [v for v in versions if v["version_id"] != current["version_id"]],
        }
    coverage = index.get("coverage") or {}
    return {"course_id": course_id, "term": index["term"], "revision": index.get("revision"), "index_sha256": digest, "as_of": marker.get("as_of"),
            "local_scope_status": coverage.get("local_scope_status"), "checked_at": coverage.get("checked_at"), "entries": entries}
