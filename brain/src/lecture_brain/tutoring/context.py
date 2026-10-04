"""Bounded context selection with a receipt of what was actually supplied (ll.context/1).

Course instructions are read as instructions; request and source text are data and never become
operating policy. The receipt documents the supplied inputs — it does not prove the native thread
is blind to its own history (``native_history_blind`` is always false).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from pypdf import PdfReader

from .. import contracts as c
from ..config import Settings
from ..ownerio import OwnerReadError
from ..ownerio.attempts import read_attempt_records
from ..ownerio.catalogs import read_answer_guidance, read_families, read_question_index
from ..ownerio.inventory import build_inventory

MAX_SPAN_CHARS = 6000


def _find_item(inventory: dict, source_id: str) -> dict | None:
    for lecture in inventory["lectures"]:
        for item in [*lecture["decks"], *lecture["extra_materials"]]:
            if item["source_id"] == source_id:
                return item
    for session in inventory["sessions"]:
        for item in session["items"]:
            if item["source_id"] == source_id:
                return item
    for item in inventory["other_sources"]:
        if item["source_id"] == source_id:
            return item
    return None


def read_span(root: Path, item: dict, locator: dict) -> str | None:
    """Text of one bounded source span, or None when no text can be read for it."""
    if not item or not item.get("path"):
        return None
    path = root / item["path"]
    if not path.is_file():
        return None
    try:
        if locator["kind"] in {"page", "figure"} and path.suffix.lower() == ".pdf":
            reader = PdfReader(str(path))
            page = locator["page"]
            if 1 <= page <= len(reader.pages):
                return (reader.pages[page - 1].extract_text() or "").strip()[:MAX_SPAN_CHARS] or None
            return None
        if locator["kind"] == "lines" and path.suffix.lower() in {".txt", ".md"}:
            lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
            return "\n".join(lines[locator["start"] - 1: locator["end"]])[:MAX_SPAN_CHARS] or None
    except Exception:  # noqa: BLE001 - an unreadable span is reported as unavailable, never guessed
        return None
    return None


def _instruction_artifacts(settings: Settings, course_id: str) -> tuple[list[dict], str]:
    root = settings.course(course_id).root
    artifacts, texts = [], []
    for rel, base, label in (("AGENTS.md", root, "AGENTS.md"), ("learning-strategy.md", root, "learning-strategy.md"),
                             ("protocols/tutoring-policy.md", settings.planner_root, "planner/protocols/tutoring-policy.md")):
        path = base / rel
        if path.is_file():
            data = path.read_bytes()
            artifacts.append(c.artifact_for_bytes(data, label, "text/markdown"))
            texts.append(f"--- {label} ---\n{data.decode('utf-8-sig', 'replace')[:8000]}")
    if not artifacts:
        data = b"No course instruction file was readable; default tutoring rules in the task apply.\n"
        artifacts.append(c.artifact_for_bytes(data, "builtin/no-course-instructions.txt", "text/plain"))
        texts.append(data.decode())
    return artifacts, "\n\n".join(texts)


def select_context(settings: Settings, *, request: dict, sources: list[dict], skill_ids: list[str], question_id: str | None, for_assessment: bool,
                   prior_exposure: str | None, now: str) -> tuple[dict, dict[str, Any]]:
    """Return (context receipt record, material for the prompt)."""
    course_id = request["scope"]["course_id"]
    root = settings.course(course_id).root
    policy = settings.policy
    budget = int(policy["default_context_character_budget"])
    inventory = build_inventory(settings.course(course_id))
    instructions, instruction_text = _instruction_artifacts(settings, course_id)
    budget -= len(instruction_text)

    supplied_sources, spans = [], []
    for source in sources[: int(policy["default_top_source_spans"])]:
        item = _find_item(inventory, source["source_id"])
        if item is not None and item["disclosure"] == "restricted_solution":
            continue  # answer keys are never shown as ordinary source context
        text = read_span(root, item, source["locator"]) if item else None
        if text and budget - len(text) > 0:
            budget -= len(text)
            supplied_sources.append(source)
            spans.append({"index": len(spans), "source": source, "filename": item["filename"], "text": text})
        elif item is not None:
            supplied_sources.append(source)
            spans.append({"index": len(spans), "source": source, "filename": item["filename"], "text": None})

    attempts_refs, attempt_summaries = [], []
    try:
        records = read_attempt_records(root, course_id)
        relevant = []
        for attempt_id, attempt in records["attempts"].items():
            effective = records["effective"][attempt_id]
            hits = [o for o in effective["observations"] if o["skill_id"] in skill_ids]
            if hits:
                relevant.append((attempt["recorded_at"], attempt_id, attempt, effective, hits))
        relevant.sort(reverse=True)
        for _, attempt_id, attempt, effective, hits in relevant[: int(policy["default_top_effective_attempts"])]:
            attempts_refs.append({"record_id": attempt_id, "artifact": {"path": attempt["_path"], "sha256": attempt["_sha256"], "bytes": attempt["_bytes"], "media_type": "application/json"}})
            attempt_summaries.append({"attempt_id": attempt_id, "effective_assessment_id": effective["assessment_id"], "recorded_at": attempt["recorded_at"],
                                      "observations": [{k: o[k] for k in ("skill_id", "outcome", "assistance", "reference_access")} for o in hits]})
    except OwnerReadError:
        pass

    rubric, guidance = [], None
    if for_assessment and question_id:
        index = read_question_index(root, course_id)
        question = index["questions"].get(question_id) if index else None
        if question:
            rubric = [{"criterion_id": k["criterion_id"], "skill_id": k["skill_id"], "observable": k["observable"]} for k in question["criteria"]]
        guidance = read_answer_guidance(root, question_id)  # assessor-only material; never echoed to the client
    exposure = {"seen_solution": "yes", "unseen_reported": "no_known_exposure"}.get(prior_exposure or "", "unknown")
    receipt = {
        "contract": "ll.context/1", "context_id": f"ctx-{request['request_id']}"[:128], "request_id": request["request_id"], "scope": request["scope"],
        "instructions": instructions, "sources": supplied_sources, "effective_attempts": attempts_refs, "known_solution_exposure": exposure,
        "native_history_blind": False, "created_at": now, "policy_revision": settings.policy_revision,
        "selection_note": ("Pinned request sources first, then the newest effective attempts for the intended skills. Tool restrictions are prompt-level only and are not an OS/tool sandbox."
                           + (" Assessor guidance was supplied to the tutor for grading and withheld from the client." if guidance else "")),
    }
    c.require_valid("context", receipt)
    return receipt, {"instruction_text": instruction_text, "spans": spans, "attempts": attempt_summaries, "rubric": rubric, "assessor_guidance": guidance}


def family_for(settings: Settings, course_id: str, family_id: str | None, family_revision: int | None) -> dict | None:
    if family_id is None or family_revision is None:
        return None
    return read_families(settings.course(course_id).root, course_id).get((family_id, family_revision))
