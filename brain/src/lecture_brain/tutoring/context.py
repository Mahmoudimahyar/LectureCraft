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
from ..preparation import current_identity

MAX_SPAN_CHARS = 6000


def _all_items(inventory: dict):
    for lecture in inventory["lectures"]:
        yield from lecture["decks"]
        yield from lecture["extra_materials"]
    for session in inventory["sessions"]:
        yield from session["items"]
    yield from inventory["other_sources"]


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

    supplied_sources, spans, source_problems = [], [], []
    for source in sources[: int(policy["default_top_source_spans"])]:
        item = _find_item(inventory, source["source_id"])
        if item is not None and item["disclosure"] == "restricted_solution":
            continue  # answer keys are never shown as ordinary source context
        if item is not None and item.get("path"):
            current_version, current_sha = current_identity(root, item)
            if current_sha is not None and current_sha != source["sha256"]:
                # Never present today's text under the label of the version the learner cited.
                source_problems.append(f"{item['filename']} changed since it was cited (cited {source['version_id']}, now {current_version}); it was not used. Open the slide again and re-ask.")
                continue
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
            if not question["prompt_in_index"] and question.get("source_path") and question.get("page"):
                # The learner answered from the original page; the tutor must read that same page, not only a pointer to it.
                original = next((i for i in _all_items(inventory) if i.get("path") == question["source_path"]), None)
                if original is not None and original["disclosure"] != "restricted_solution":
                    locator = {"kind": "page", "page": int(question["page"]), "printed_label": None}
                    version_id, sha256 = current_identity(root, original)
                    text = read_span(root, original, locator)
                    already = any(s["source_id"] == original["source_id"] and s["locator"] == locator for s in supplied_sources)
                    if text and sha256 and not already:
                        ref = {"source_id": original["source_id"], "version_id": version_id, "sha256": sha256, "locator": locator}
                        supplied_sources.append(ref)
                        spans.append({"index": len(spans), "source": ref, "filename": original["filename"], "text": text})
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
    return receipt, {"instruction_text": instruction_text, "spans": spans, "attempts": attempt_summaries, "rubric": rubric, "assessor_guidance": guidance,
                     "source_problems": source_problems}


def question_version_for(settings: Settings, course_id: str, question_id: str | None) -> int | None:
    """The version the course's own question index gives this question (None when there is no index or no such id)."""
    if question_id is None:
        return None
    try:
        index = read_question_index(settings.course(course_id).root, course_id)
    except OwnerReadError:  # an unreadable index is reported by the catalog views; the owner's writer still validates the candidate
        return None
    question = (index or {}).get("questions", {}).get(question_id)
    version = question.get("version") if question else None
    return version if isinstance(version, int) else None


def family_for(settings: Settings, course_id: str, family_id: str | None, family_revision: int | None) -> dict | None:
    if family_id is None or family_revision is None:
        return None
    return read_families(settings.course(course_id).root, course_id).get((family_id, family_revision))
