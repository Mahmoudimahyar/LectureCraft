"""Read the owners' learning catalogs: skills, question families and (where present) the question index.

Identifiers, relation labels and ``automatic_credit: false`` are returned exactly as the owner wrote
them. Question containment is not converted into a concept prerequisite here or anywhere else.
"""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any

from ..contracts import sha256_hex
from . import OwnerReadError, parse_owner_json, parse_owner_yaml, read_owner_bytes, require_identity

CONTRACT = "course-learning-v1"


def read_skills(root: Path, course_id: str) -> dict[str, Any]:
    data = read_owner_bytes(root / "learning" / "skills.yaml", what="learning/skills.yaml")
    doc = parse_owner_yaml(data, what="learning/skills.yaml")
    require_identity(doc, course_id, what="learning/skills.yaml", contract=CONTRACT)
    topics = {t["topic_id"]: t for t in doc.get("topics") or []}
    skills: dict[str, dict] = {}
    for skill in doc.get("skills") or []:
        if skill["skill_id"] in skills:
            raise OwnerReadError("invalid_record", f"duplicate skill id {skill['skill_id']!r}")
        skills[skill["skill_id"]] = skill
    return {"revision": doc.get("revision"), "sha256": sha256_hex(data), "topics": topics, "skills": skills}


def read_families(root: Path, course_id: str) -> dict[tuple[str, int], dict]:
    data = read_owner_bytes(root / "learning" / "question-families.yaml", what="learning/question-families.yaml")
    doc = parse_owner_yaml(data, what="learning/question-families.yaml")
    require_identity(doc, course_id, what="learning/question-families.yaml", contract=CONTRACT)
    families: dict[tuple[str, int], dict] = {}
    for family in doc.get("families") or []:
        key = (family["family_id"], int(family["revision"]))
        if key in families:
            raise OwnerReadError("invalid_record", f"duplicate family revision {key!r}")
        families[key] = family
    return families


def families_digest(root: Path) -> str:
    return sha256_hex(read_owner_bytes(root / "learning" / "question-families.yaml", what="learning/question-families.yaml"))


def _with_usable_prompt(question: dict) -> dict:
    """Some entries (problem sets, in-class questions) carry no wording: the owner marks the original page as
    authoritative. Readers still need a string. It is a pointer to that original — never invented wording — and
    ``prompt_in_index`` tells every consumer which kind it is."""
    question = dict(question)
    question["prompt_in_index"] = isinstance(question.get("prompt"), str) and bool(question["prompt"].strip())
    if not question["prompt_in_index"]:
        where = question.get("source_path") or question.get("bank_path")
        location = ""
        if where:
            location = f" ({Path(where).name}" + (f", page {question['page']}" if question.get("page") else "") + ")"
        status = str(question.get("prompt_status") or "").strip()
        question["prompt"] = (f"{question.get('title') or question['question_id']} — the exact wording, givens and figures are in the original source{location}."
                              + (f" {status}" if status else ""))
    return question


def read_question_index(root: Path, course_id: str) -> dict[str, Any] | None:
    """BE 505-style question index when a course has one; ``None`` otherwise (other courses do not)."""
    path = root / "learning" / "question-index.json"
    if not path.is_file():
        return None
    data = read_owner_bytes(path, what="learning/question-index.json")
    doc = parse_owner_json(data, what="learning/question-index.json")
    require_identity(doc, course_id, what="learning/question-index.json")
    questions = {q["question_id"]: _with_usable_prompt(q) for q in doc.get("questions") or []}
    concepts = {c["concept_id"]: c for c in doc.get("concepts") or []}
    return {"contract_version": doc.get("contract_version"), "revision": doc.get("revision"), "sha256": sha256_hex(data), "questions": questions,
            "concepts": concepts, "relationships": list(doc.get("relationships") or []), "policy": doc.get("policy") or {}}


_QUESTION_MAP = re.compile(r"^lecture-\d{2}-question-map-v\d+\.json$")


GUIDANCE_ADAPTER = "question-map-guidance/2"


def read_guidance(root: Path, questions: dict[str, dict]) -> dict[str, Any]:
    """Assessor guidance joined to the question catalog by the owner's entry id (R1-Q6).

    An entry is used only when it names exactly one catalogued question and its revision applies: the entry's own
    ``version`` when it has one, else the map file's. An entry with two identifiers that disagree, a second entry for
    the same question, an entry for no catalogued question and an entry for another revision are reported and not
    used. The diagnostics carry ids and file names only, never guidance text.
    """
    review = root / "work" / "lecture-review"
    entries: dict[str, dict] = {}
    errors: list[dict] = []
    seen: dict[str, str] = {}
    refused: set[str] = set()
    files = 0
    if not review.is_dir():
        return {"adapter": GUIDANCE_ADAPTER, "files": 0, "entries": {}, "errors": []}
    for path in sorted(review.iterdir()):
        if not path.is_file() or not _QUESTION_MAP.match(path.name):
            continue
        files += 1
        doc = parse_owner_json(read_owner_bytes(path, what=path.name), what=path.name)
        for raw in doc.get("questions") or []:
            if not isinstance(raw, dict) or not raw.get("answer"):
                continue
            ids = {str(raw[k]) for k in ("id", "question_id") if raw.get(k)}
            entry_id = str(raw.get("id") or raw.get("question_id") or "")

            def refuse(code: str, detail: str, entry_id: str = entry_id, name: str = path.name) -> None:
                errors.append({"code": code, "entry_id": entry_id, "file": name, "detail": detail})
                refused.add(entry_id)
                entries.pop(entry_id, None)

            if len(ids) != 1:
                refuse("conflicting_identifiers" if ids else "missing_identifier", "the entry does not name exactly one question")
                continue
            if entry_id in seen:
                refuse("duplicate_entry", f"also present in {seen[entry_id]}")
                continue
            seen[entry_id] = path.name
            question = questions.get(entry_id)
            if question is None:
                refuse("unknown_question", "no catalogued question has this id")
                continue
            version, basis = (raw["version"], "entry") if raw.get("version") is not None else (doc.get("version"), "file")
            if version is not None and question.get("version") is not None and str(version) != str(question["version"]):
                refuse("revision_mismatch", f"guidance is for version {version}, the question is at version {question['version']}")
                continue
            if entry_id not in refused:
                entries[entry_id] = {"question_id": entry_id, "answer": str(raw["answer"]), "file": path.name, "version": version,
                                     "version_basis": basis if version is not None else "none_stated"}
    return {"adapter": GUIDANCE_ADAPTER, "files": files, "entries": entries, "errors": errors}


def read_answer_guidance(root: Path, question_id: str, questions: dict[str, dict] | None = None) -> str | None:
    """Restricted read of owner-kept answer guidance for one question.

    Only the tutoring context selector (assessment) and an explicit, recorded reveal call this.
    It is never included in browse views, search indexes or client payloads by default.
    """
    if questions is None:
        raw = parse_owner_json(read_owner_bytes(root / "learning" / "question-index.json", what="learning/question-index.json"), what="learning/question-index.json")
        questions = {q["question_id"]: q for q in raw.get("questions") or []}
    entry = read_guidance(root, questions)["entries"].get(question_id)
    return entry["answer"] if entry else None
