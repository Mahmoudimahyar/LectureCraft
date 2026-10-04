"""Read genuine attempts and assessment revisions (course-learning-v1) and compute effective observations.

Original attempts are never edited. A revision replaces the observations for the same skills in a
single non-branching chain; a branch is surfaced as a conflict, not resolved by picking one.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import hashlib
import re
from typing import Any

from ..contracts import sha256_hex
from . import OwnerReadError, parse_owner_json, read_owner_bytes

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DIGEST_LINE = re.compile(r"Input digest: `([a-f0-9]{64})`")


def learning_input_digest(root: Path) -> str:
    """The owner's view-input digest (course_learning.py): reproducible from raw bytes alone."""
    names = ["learning/skills.yaml", "learning/question-families.yaml", "planning/requirements.yaml", ".agent/source-index.json"]
    attempts = root / "learning" / "attempts"
    if attempts.is_dir():
        names += [p.relative_to(root).as_posix() for p in attempts.glob("*/*.json") if p.is_file()]
    digest = hashlib.sha256()
    for name in sorted(names):
        digest.update(name.encode("utf-8") + b"\0" + hashlib.sha256((root / name).read_bytes()).digest())
    return digest.hexdigest()


def learning_view_status(root: Path) -> str:
    """``current`` | ``stale`` | ``unavailable`` for the owner's generated learning-state.md."""
    try:
        text = (root / "learning-state.md").read_text(encoding="utf-8-sig")
    except OSError:
        return "unavailable"
    match = _DIGEST_LINE.search(text)
    if not match:
        return "unavailable"
    try:
        return "current" if match.group(1) == learning_input_digest(root) else "stale"
    except OSError:
        return "unavailable"


def _record_month(recorded_at: str) -> str | None:
    try:
        return datetime.fromisoformat(recorded_at.replace("Z", "+00:00")).strftime("%Y-%m")
    except (ValueError, AttributeError):
        return None


def read_attempt_records(root: Path, course_id: str) -> dict[str, Any]:
    attempts: dict[str, dict] = {}
    revisions: dict[str, dict] = {}
    problems: list[dict] = []
    base = root / "learning" / "attempts"
    if base.is_dir():
        for month_dir in sorted(base.iterdir()):
            if not month_dir.is_dir() or month_dir.is_symlink() or not _MONTH.match(month_dir.name):
                problems.append({"code": "unrecognised_artifact", "path": month_dir.relative_to(root).as_posix()})
                continue
            for path in sorted(month_dir.iterdir()):
                rel = path.relative_to(root).as_posix()
                if not path.is_file() or path.is_symlink() or path.suffix != ".json":
                    problems.append({"code": "unrecognised_artifact", "path": rel})
                    continue
                try:
                    data = read_owner_bytes(path, what=rel)
                    record = parse_owner_json(data, what=rel)
                except OwnerReadError as exc:
                    problems.append({"code": exc.code, "path": rel, "detail": exc.message})
                    continue
                kind = record.get("record_kind")
                record_id = record.get("attempt_id") if kind == "attempt" else record.get("event_id")
                if kind not in {"attempt", "assessment_revision"} or not record_id or record.get("course_id") != course_id:
                    problems.append({"code": "invalid_record", "path": rel})
                    continue
                if path.stem != record_id or _record_month(record.get("recorded_at", "")) != month_dir.name:
                    problems.append({"code": "misfiled", "path": rel})
                if record_id in attempts or record_id in revisions:
                    problems.append({"code": "duplicate_id", "path": rel})
                    continue
                enriched = dict(record, _path=rel, _sha256=sha256_hex(data), _bytes=len(data))
                (attempts if kind == "attempt" else revisions)[record_id] = enriched

    children: dict[str, list[str]] = {}
    for event_id, revision in revisions.items():
        if revision.get("attempt_id") not in attempts:
            problems.append({"code": "orphan_revision", "path": revision["_path"]})
            continue
        children.setdefault(revision["replaces_assessment_id"], []).append(event_id)

    effective: dict[str, dict] = {}
    for attempt_id, attempt in attempts.items():
        chain = [attempt_id]
        conflict = False
        current = attempt_id
        seen = {attempt_id}
        while True:
            next_ids = sorted(children.get(current, []))
            if not next_ids:
                break
            if len(next_ids) > 1:
                conflict = True
                problems.append({"code": "branched_chain", "attempt_id": attempt_id, "parent": current, "branches": next_ids})
                break
            nxt = next_ids[0]
            if nxt in seen:
                problems.append({"code": "cyclic_chain", "attempt_id": attempt_id})
                conflict = True
                break
            seen.add(nxt)
            chain.append(nxt)
            current = nxt
        last = attempts[attempt_id] if current == attempt_id else revisions[current]
        original_skills = {o["skill_id"] for o in attempt.get("observations", [])}
        if current != attempt_id and {o["skill_id"] for o in last.get("observations", [])} != original_skills:
            problems.append({"code": "revision_skill_set_differs", "attempt_id": attempt_id, "event_id": current})
            conflict = True
        effective[attempt_id] = {"assessment_id": current, "observations": last.get("observations", []), "chain": chain, "conflict": conflict,
                                 "assessed_at": last.get("recorded_at")}
    return {"attempts": attempts, "revisions": revisions, "effective": effective, "problems": problems}
