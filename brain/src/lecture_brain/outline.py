"""One typed read model for Course, Lecture and Slide scopes, plus an outline that is expanded on demand (R1-G1…G4).

Canonical objects — topic, concept, skill, question family, question, criterion — are counted once by id. The outline
is a presentation of them: a row has an *instance id* (the path that led to it), so one concept under two topics is
one canonical node shown on two branches. Children are returned one level at a time, bounded, and a node already on
the path is not expanded again. Question-to-question relations are cross-links kept with the owner's labels; they are
never tree edges and never credit. Criterion wording is not part of this model (it is shown with feedback only).
"""
from __future__ import annotations

from typing import Any

OUTLINE_VERSION = "outline/1"
MAX_CHILDREN = 200
MAX_DEPTH = 6
_ORDER = {"topic": 0, "concept": 1, "skill": 2, "question": 3, "criterion": 4}


class OutlineModel:
    def __init__(self, catalogs: dict, bank: dict) -> None:
        index = catalogs["questions"] or {"questions": {}, "concepts": {}, "relationships": []}
        self.topics: dict[str, dict] = catalogs["skills"]["topics"]
        self.skills: dict[str, dict] = catalogs["skills"]["skills"]
        self.concepts: dict[str, dict] = index["concepts"]
        self.questions: dict[str, dict] = index["questions"]
        self.families = catalogs["families"]
        self.relationships: list[dict] = index["relationships"]
        self.bank = bank
        self.criteria: dict[str, dict] = {}
        for question in self.questions.values():
            for number, criterion in enumerate(question.get("criteria") or [], start=1):
                self.criteria[criterion["criterion_id"]] = {"criterion_id": criterion["criterion_id"], "question_id": question["question_id"], "number": number,
                                                           "skill_id": criterion.get("skill_id"), "concept_id": criterion.get("concept_id"),
                                                           "action_types": list(criterion.get("action_types") or []), "tag": criterion.get("tag")}
        self.canonical_counts = {"topic": len(self.topics), "concept": len(self.concepts), "skill": len(self.skills), "question_family": len(self.families),
                                 "question": len(self.questions), "criterion": len(self.criteria), "question_relationship": len(self.relationships)}

    # ---- identity ---------------------------------------------------------------------------------------
    def kind_of(self, node_id: str) -> str | None:
        for kind, table in (("topic", self.topics), ("concept", self.concepts), ("skill", self.skills), ("question", self.questions), ("criterion", self.criteria)):
            if node_id in table:
                return kind
        return None

    def label_of(self, node_id: str) -> str:
        kind = self.kind_of(node_id)
        if kind == "topic":
            return self.topics[node_id].get("label") or node_id
        if kind == "concept":
            return self.concepts[node_id]["label"]
        if kind == "skill":
            return self.skills[node_id].get("performance_target") or node_id
        if kind == "question":
            return self.questions[node_id].get("title") or node_id
        criterion = self.criteria[node_id]
        return f"Criterion {criterion['number']} of {criterion['question_id']}" + (f" ({', '.join(criterion['action_types'])})" if criterion["action_types"] else "")

    # ---- scope ------------------------------------------------------------------------------------------
    def scope(self, text: str, deck_source_id_of: Any) -> dict[str, Any]:
        """``course`` | ``lecture:<id>`` | ``slide:<lecture>:<page>`` → the questions in scope and why."""
        parts = (text or "course").split(":")
        if parts == ["course"]:
            return {"kind": "course", "question_ids": None, "basis": "catalog", "note": "Everything in this course's catalogs."}
        if parts[0] in {"lecture", "slide"} and len(parts) >= 2 and parts[1] in self.bank["lectures"]:
            lecture = self.bank["lectures"][parts[1]]
            own = list(lecture["question_ids"])
            unanchored = sorted(q for q in own if self.bank["questions"][q]["slide_anchor"] == "none")
            if parts[0] == "lecture" and len(parts) == 2:
                return {"kind": "lecture", "lecture_id": parts[1], "question_ids": set(own), "basis": "collection_membership", "gap": lecture["gap"], "collections": lecture["collections"],
                        "questions_without_slide_anchor": unanchored,
                        "note": "Questions of the collections the course catalog ties to this unit's files. Membership is not a slide anchor."}
            if parts[0] == "slide" and len(parts) == 3 and parts[2].isdigit():
                page, deck = int(parts[2]), deck_source_id_of(parts[1])
                anchored = sorted(q for q in own if any(a["kind"] == "pages" and a["source_id"] == deck and page in a["pages"] for a in self.bank["questions"][q]["anchors"]))
                concepts = {c["concept_id"] for q in anchored for c in self.questions[q].get("criteria") or [] if c.get("concept_id")}
                related = sorted(q for q in own if q not in anchored and any(c.get("concept_id") in concepts for c in self.questions[q].get("criteria") or []))
                return {"kind": "slide", "lecture_id": parts[1], "page": page, "question_ids": set(anchored), "basis": "typed_anchor", "anchored_questions": anchored,
                        "related_questions": related, "questions_without_slide_anchor": unanchored,
                        "note": ("Questions whose catalog locator names this slide. Related questions share a concept and are listed apart." if anchored else
                                 "No question in the course record names this slide. The lecture's own questions are in its lecture scope.")}
        raise ValueError(f"Unknown scope {text!r}")

    # ---- hierarchy --------------------------------------------------------------------------------------
    def _in_scope(self, scope: dict) -> tuple[set[str] | None, set[str] | None, set[str] | None]:
        if scope["question_ids"] is None:
            return None, None, None
        if "concept_ids" in scope and "skill_ids" in scope:  # R2: a scope resolved by ``concept_graph.resolve_scope`` states its filter; nothing is derived again
            return scope["question_ids"], scope["concept_ids"], scope["skill_ids"]
        questions = scope["question_ids"]
        criteria = [c for q in questions for c in self.questions[q].get("criteria") or []]
        return questions, {c["concept_id"] for c in criteria if c.get("concept_id")}, {c["skill_id"] for c in criteria if c.get("skill_id")}

    def children(self, node_id: str | None, scope: dict) -> list[tuple[str, str]]:
        """(child id, relation) of one node in the hierarchy subset, in a stable order. Cross-links are not children."""
        questions, concepts, skills = self._in_scope(scope)
        criteria = scope.get("criterion_ids")  # R2: set only by a resolved slide scope whose support names single criteria; ``None`` leaves every criterion in
        if node_id is None:
            topics = [t for t in self.topics if concepts is None or any(t in self.concepts[c].get("topic_ids", []) for c in concepts if c in self.concepts)
                      or any(t in self.skills[s].get("topic_ids", []) for s in (skills or ()) if s in self.skills and self.skills[s].get("concept_id") not in self.concepts)]
            return [(t, "root") for t in sorted(topics, key=lambda t: (self.label_of(t).lower(), t))]
        kind = self.kind_of(node_id)
        if kind == "topic":
            out = [(c, "topic_includes_concept") for c, concept in self.concepts.items() if node_id in concept.get("topic_ids", []) and (concepts is None or c in concepts)]
            out += [(s, "topic_includes_skill") for s, skill in self.skills.items() if skill.get("concept_id") not in self.concepts and node_id in skill.get("topic_ids", [])
                    and (skills is None or s in skills)]
        elif kind == "concept":
            out = [(s, "concept_assessed_as_skill") for s, skill in self.skills.items() if skill.get("concept_id") == node_id and (skills is None or s in skills)]
        elif kind == "skill":
            out = [(q, "skill_assessed_by_question") for q, question in self.questions.items() if (questions is None or q in questions)
                   and any(c.get("skill_id") == node_id and (criteria is None or c["criterion_id"] in criteria) for c in question.get("criteria") or [])]
        elif kind == "question":
            out = [(c["criterion_id"], "question_has_criterion") for c in self.questions[node_id].get("criteria") or [] if criteria is None or c["criterion_id"] in criteria]
        else:
            out = []
        return sorted(out, key=lambda pair: (_ORDER[self.kind_of(pair[0]) or "criterion"], self.label_of(pair[0]).lower() if self.kind_of(pair[0]) != "criterion" else "", pair[0]))

    def rows(self, scope: dict, parent: str | None, *, limit: int = MAX_CHILDREN, decorate: Any = None) -> dict[str, Any]:
        path = [p for p in (parent or "").split(">") if p]
        # The parent path must be a real walk from a root, without visiting an id twice and without exceeding the depth bound.
        valid = len(path) <= MAX_DEPTH and len(set(path)) == len(path)
        previous: str | None = None
        for step in path:
            valid = valid and step in {child for child, _ in self.children(previous, scope)}
            previous = step
        pairs = self.children(path[-1] if path else None, scope) if valid else []
        limit = max(1, min(int(limit), MAX_CHILDREN))
        rows = []
        for child, relation in pairs[:limit]:
            kind = self.kind_of(child)
            repeated = child in path
            row = {"instance_id": ">".join([*path, child]), "node_id": child, "kind": kind, "label": self.label_of(child), "relation": relation, "depth": len(path),
                   "repeated_on_path": repeated, "has_children": (not repeated) and len(path) + 1 < MAX_DEPTH and bool(self.children(child, scope))}
            if kind == "criterion":
                criterion = self.criteria[child]
                row.update(question_id=criterion["question_id"], skill_id=criterion["skill_id"], on_parent_skill=len(path) >= 2 and criterion["skill_id"] == path[-2])
            if decorate:
                row.update(decorate(child, kind) or {})
            rows.append(row)
        return {"rows": rows, "total_children": len(pairs), "truncated": len(pairs) > limit, "parent": parent or None}

    # ---- one node ---------------------------------------------------------------------------------------
    def parents(self, node_id: str) -> list[dict]:
        kind = self.kind_of(node_id)
        ids: list[str] = []
        if kind == "concept":
            ids = list(self.concepts[node_id].get("topic_ids", []))
        elif kind == "skill":
            skill = self.skills[node_id]
            ids = [skill["concept_id"]] if skill.get("concept_id") in self.concepts else list(skill.get("topic_ids", []))
        elif kind == "question":
            ids = sorted({c["skill_id"] for c in self.questions[node_id].get("criteria") or [] if c.get("skill_id") in self.skills})
        elif kind == "criterion":
            ids = [self.criteria[node_id]["question_id"]]
        return [{"node_id": i, "kind": self.kind_of(i), "label": self.label_of(i)} for i in ids if self.kind_of(i)]

    def questions_of(self, node_id: str) -> list[str]:
        kind = self.kind_of(node_id)
        if kind == "question":
            return [node_id]
        if kind == "criterion":
            return [self.criteria[node_id]["question_id"]]
        key = {"concept": "concept_id", "skill": "skill_id"}.get(kind or "")
        if key:
            return sorted(q for q, question in self.questions.items() if any(c.get(key) == node_id for c in question.get("criteria") or []))
        concepts = {c for c, concept in self.concepts.items() if node_id in concept.get("topic_ids", [])}
        return sorted(q for q, question in self.questions.items() if any(c.get("concept_id") in concepts for c in question.get("criteria") or []))

    def skills_of(self, node_id: str) -> list[str]:
        kind = self.kind_of(node_id)
        if kind == "skill":
            return [node_id]
        if kind == "criterion":
            return [s for s in [self.criteria[node_id]["skill_id"]] if s in self.skills]
        if kind == "question":
            return sorted({c["skill_id"] for c in self.questions[node_id].get("criteria") or [] if c.get("skill_id") in self.skills})
        if kind == "concept":
            return sorted(s for s, skill in self.skills.items() if skill.get("concept_id") == node_id)
        return sorted(s for s, skill in self.skills.items() if node_id in skill.get("topic_ids", []))

    def links(self, node_id: str) -> list[dict]:
        """Question-to-question relations touching this node's questions, with the owner's label and no credit."""
        mine = set(self.questions_of(node_id)) if self.kind_of(node_id) in {"question", "criterion"} else set()
        out = []
        for rel in self.relationships:
            for here, other, direction in ((rel["from_question"], rel["to_question"], "from_this"), (rel["to_question"], rel["from_question"], "to_this")):
                if here in mine and other in self.questions:
                    out.append({"relation": rel["relation"], "other": other, "other_label": self.label_of(other), "direction": direction, "rationale": rel.get("rationale"),
                                "automatic_credit": bool(rel.get("automatic_credit", False)), "scope": "question_to_question"})
        return out
