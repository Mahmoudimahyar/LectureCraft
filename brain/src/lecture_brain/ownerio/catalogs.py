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


def read_question_index(root: Path, course_id: str) -> dict[str, Any] | None:
    """BE 505-style question index when a course has one; ``None`` otherwise (other courses do not)."""
    path = root / "learning" / "question-index.json"
    if not path.is_file():
        return None
    data = read_owner_bytes(path, what="learning/question-index.json")
    doc = parse_owner_json(data, what="learning/question-index.json")
    require_identity(doc, course_id, what="learning/question-index.json")
    questions = {q["question_id"]: q for q in doc.get("questions") or []}
    concepts = {c["concept_id"]: c for c in doc.get("concepts") or []}
    return {"contract_version": doc.get("contract_version"), "revision": doc.get("revision"), "sha256": sha256_hex(data), "questions": questions,
            "concepts": concepts, "relationships": list(doc.get("relationships") or []), "policy": doc.get("policy") or {}}


_QUESTION_MAP = re.compile(r"^lecture-\d{2}-question-map-v\d+\.json$")


def read_answer_guidance(root: Path, question_id: str) -> str | None:
    """Restricted read of owner-kept answer guidance for one question.

    Only the tutoring context selector (assessment) and an explicit, recorded reveal call this.
    It is never included in browse views, search indexes or client payloads by default.
    """
    review = root / "work" / "lecture-review"
    if not review.is_dir():
        return None
    for path in sorted(review.iterdir()):
        if not path.is_file() or not _QUESTION_MAP.match(path.name):
            continue
        doc = parse_owner_json(read_owner_bytes(path, what=path.name), what=path.name)
        for question in doc.get("questions") or []:
            if question.get("question_id") == question_id and question.get("answer"):
                return str(question["answer"])
    return None
