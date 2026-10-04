"""Generated views for the client (WF10): inventory, lecture, concept tree, gaps, history, review, activity.

Every function here is a pure read of the owners' records plus the app's own operational
sidecars. Views add no assessment facts, no mastery numbers and no second authority: a concept
tree is a projection of catalog ids and labelled relations; a gap entry points at the effective
observation that produced it; zero attempts is "not assessed". Stale owner views are reported as
stale rather than hidden.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import hashlib
import re
from typing import Any

import yaml

from . import contracts as c
from .annotations import AnnotationStore, media_duration_ms, precision_of
from .config import Settings
from .fsutil import replace_atomic
from .journal import Journal, JobState as S, TERMINAL
from .ownerio import OwnerReadError
from .ownerio.attempts import learning_view_status, read_attempt_records
from .ownerio.catalogs import read_families, read_question_index, read_skills
from .ownerio.inventory import build_inventory
from .preparation import Preparation
from .resume import ResumeStore
from .review import ReviewStore

_SLIDES = re.compile(r"(?i)\b(?:slides?|pages?|pdf pages?)\s+(\d+)(?:\s*[-–]\s*(\d+))?")
_CAPTURE = re.compile(r"^Lecture Learning capture (?P<path>\S+) sha256:(?P<sha>[a-f0-9]{64}) bytes:(?P<bytes>\d+) turn:(?P<turn>\S+)$")
MAX_TRANSCRIPT_LINES = 20000
GENERATOR = "lecture-brain-projections"


def _pages_in(locator: str) -> set[int]:
    pages: set[int] = set()
    for match in _SLIDES.finditer(locator or ""):
        start, end = int(match.group(1)), int(match.group(2) or match.group(1))
        if 0 < start <= end <= start + 200:
            pages |= set(range(start, end + 1))
    return pages


class Projector:
    def __init__(self, settings: Settings, journal: Journal, *, annotations: AnnotationStore | None = None, reviews: ReviewStore | None = None, resume: ResumeStore | None = None,
                 preparation: Preparation | None = None, capabilities: Any = None, rejections: Any = None, now: Any = None):
        self.settings, self.journal = settings, journal
        self.annotations = annotations or AnnotationStore(settings)
        self.reviews = reviews or ReviewStore(settings)
        self.resume = resume or ResumeStore(settings)
        self.preparation = preparation or Preparation(settings, self.annotations)
        self._capabilities = capabilities or (lambda: {})
        self._rejections = rejections or (lambda: [])
        self._now = now or (lambda: "1970-01-01T00:00:00Z")

    # ---- shared readers ------------------------------------------------------------------------
    def _catalogs(self, course_id: str) -> dict[str, Any]:
        root = self.settings.course(course_id).root
        out: dict[str, Any] = {"skills": {"skills": {}, "topics": {}}, "families": {}, "questions": None, "problems": []}
        for key, reader in (("skills", read_skills), ("families", read_families), ("questions", read_question_index)):
            try:
                out[key] = reader(root, course_id)
            except OwnerReadError as exc:
                out["problems"].append({"catalog": key, "code": exc.code, "detail": exc.message})
        return out

    def _records(self, course_id: str) -> dict[str, Any]:
        try:
            return read_attempt_records(self.settings.course(course_id).root, course_id)
        except OwnerReadError as exc:
            return {"attempts": {}, "revisions": {}, "effective": {}, "problems": [{"code": exc.code}]}

    # ---- workspace -----------------------------------------------------------------------------
    def workspace_view(self) -> dict[str, Any]:
        coverage = self.preparation.coverage()
        courses = []
        for course_id, binding in sorted(self.settings.courses.items()):
            row: dict[str, Any] = {"course_id": course_id, "display_name": binding.display_name, "binding": binding.status, "problem": binding.problem}
            if binding.usable:
                inventory = build_inventory(binding)
                records = self._records(course_id)
                attempts = len(records["attempts"])
                due = [r for r in self.reviews.due_view(course_id, now=self._now()) if r["is_due"]]
                dispositions = Counter(l["disposition"].split(":")[0] for l in coverage["courses"][course_id]["lectures"])
                row.update(lecture_units=len(inventory["lectures"]), sessions=len(inventory["sessions"]), index_status=inventory["index"]["status"],
                           recorded_attempts=attempts, assessed_label="Not assessed" if attempts == 0 else f"{attempts} recorded attempt{'s' if attempts != 1 else ''}",
                           due_items=len(due), preparation=dict(dispositions),
                           pending_requests=len(self.journal.jobs(course_id=course_id, states=[s for s in S if s not in TERMINAL])))
            courses.append(row)
        return {"profile": self.settings.profile, "fixture_label": self.settings.fixture_label, "term": "2026-fall", "generated_at": self._now(),
                "binding_revision": self.settings.binding_revision, "capabilities": self._capabilities(), "courses": courses,
                "coverage_totals": coverage["totals"], "writes_are_staged": self.settings.writes_are_staged}

    # ---- course --------------------------------------------------------------------------------
    def course_view(self, course_id: str) -> dict[str, Any]:
        binding = self.settings.course(course_id)
        inventory = build_inventory(binding)
        coverage = {l["lecture_id"]: l for l in self.preparation.coverage()["courses"][course_id]["lectures"]}

        def session(s: dict) -> dict:
            return {"session_id": s["session_id"], "date": s["date"], "state": s["state"], "linked_lecture_ids": s["linked_lecture_ids"],
                    "items": [{k: i[k] for k in ("source_id", "kind", "filename", "state", "registration", "bytes", "media_type")} for i in s["items"]]}

        lectures = []
        for lecture in inventory["lectures"]:
            deck = lecture["decks"][0] if lecture["decks"] else None
            cov = coverage.get(lecture["lecture_id"], {})
            rendition = ((cov.get("stages") or {}).get("rendition") or {})
            displayable = bool(deck) and (deck["rendition"] == "native_pdf" and deck["state"] in {"registered_readable", "present_unindexed"} or rendition.get("status") == "rendition")
            lectures.append({"lecture_id": lecture["lecture_id"], "title": lecture["title"], "session_link": lecture["session_link"],
                             "deck": ({k: deck[k] for k in ("source_id", "state", "registration", "rendition", "filename", "bytes")} if deck else None),
                             "displayable": displayable, "sessions": [session(s) for s in lecture["sessions"]], "disposition": cov.get("disposition", "not_processed"),
                             "pages": cov.get("pages"), "pages_confirmed": cov.get("pages_confirmed", 0), "pages_suggested": cov.get("pages_suggested", 0),
                             "pages_unresolved": cov.get("pages_unresolved")})
        records = self._records(course_id)
        return {"course_id": course_id, "display_name": binding.display_name, "index": inventory["index"], "lectures": lectures,
                "unlinked_sessions": [session(s) for s in inventory["unlinked_sessions"]],
                "other_sources": [{k: i[k] for k in ("source_id", "kind", "filename", "state", "registration", "rendition", "disclosure", "bytes", "media_type", "source_date")} for i in inventory["other_sources"]],
                "recorded_attempts": len(records["attempts"]), "learning_view_status": learning_view_status(binding.root),
                "enumeration_truncated": inventory["enumeration_truncated"]}

    # ---- lecture -------------------------------------------------------------------------------
    def lecture_view(self, course_id: str, lecture_id: str) -> dict[str, Any] | None:
        binding = self.settings.course(course_id)
        root = binding.root
        inventory = build_inventory(binding)
        lecture = next((l for l in inventory["lectures"] if l["lecture_id"] == lecture_id), None)
        if lecture is None:
            return None
        items = {i["source_id"]: i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]}
        items.update({i["source_id"]: i for s in inventory["sessions"] for i in s["items"]})
        items.update({i["source_id"]: i for i in inventory["other_sources"]})
        state = self.preparation.state(course_id, lecture_id) or {}
        stages = state.get("stages", {})
        deck = lecture["decks"][0] if lecture["decks"] else None
        display: dict[str, Any] = {"kind": "unavailable", "reason": "No slide deck file is present for this lecture unit."}
        if deck is not None:
            rendition = stages.get("rendition", {})
            if deck["rendition"] == "native_pdf" and deck["state"] in {"registered_readable", "present_unindexed"}:
                display = {"kind": "original_pdf", "content": f"sources/{course_id}/{deck['source_id']}/content", "note": "Original PDF, shown unchanged."}
            elif rendition.get("status") == "rendition":
                display = {"kind": "rendition_pdf", "content": f"files/{course_id}/{rendition['path']}", "note": rendition["note"]}
            else:
                display = {"kind": "unavailable", "reason": rendition.get("reason") or f"The deck is {deck['state'].replace('_', ' ')}."}
        try:
            texts = c.parse_json((self.preparation.prepared_dir(course_id, lecture_id) / "slides-text.json").read_bytes())["pages"]
        except (OSError, c.ContractError, KeyError):
            texts = None
        catalogs = self._catalogs(course_id)
        questions = (catalogs["questions"] or {}).get("questions", {})
        concepts = (catalogs["questions"] or {}).get("concepts", {})
        skills = catalogs["skills"]["skills"]
        page_concepts: dict[int, dict[str, dict]] = {}
        page_questions: dict[int, list[dict]] = {}
        if deck is not None:
            for question in questions.values():
                pages = set()
                for ref in question.get("source_refs", []):
                    if ref.get("source_id") == deck["source_id"]:
                        pages |= _pages_in(ref.get("locator", ""))
                for page in pages:
                    page_questions.setdefault(page, []).append({"question_id": question["question_id"], "title": question.get("title"), "family_id": question.get("family_id")})
                    for criterion in question.get("criteria", []):
                        concept = concepts.get(criterion.get("concept_id"))
                        if concept:
                            page_concepts.setdefault(page, {})[concept["concept_id"]] = {"concept_id": concept["concept_id"], "label": concept["label"], "basis": "question source reference"}
            for skill in skills.values():
                for ref in skill.get("source_refs", []):
                    if ref.get("source_id") == deck["source_id"] and skill.get("concept_id") in concepts:
                        for page in _pages_in(ref.get("locator", "")):
                            concept = concepts[skill["concept_id"]]
                            page_concepts.setdefault(page, {}).setdefault(concept["concept_id"], {"concept_id": concept["concept_id"], "label": concept["label"], "basis": "skill source reference"})

        loaded = self.annotations.load(course_id)
        slides_links: dict[int, dict[str, list]] = {}
        line_times: dict[str, list[dict]] = {}
        for entry in loaded["current"].values():
            record = entry["record"]
            frm, to = record["from"], record["to"]
            common = {"annotation_id": record["annotation_id"], "revision": record["revision"], "review_state": record["review_state"], "basis": record["basis"],
                      "relation": record["relation"], "artifact": entry["artifact"], "record": record}
            if deck is not None and frm["source_id"] == deck["source_id"] and frm["locator"]["kind"] == "page" and record["review_state"] != "rejected":
                bucket = slides_links.setdefault(frm["locator"]["page"], {"occurrences": [], "transcript_ranges": [], "related": []})
                target = items.get(to["source_id"])
                if to["locator"]["kind"] == "media":
                    bucket["occurrences"].append(dict(common, source=to, start_ms=to["locator"]["start_ms"], end_ms=to["locator"]["end_ms"]))
                elif to["locator"]["kind"] == "lines":
                    bucket["transcript_ranges"].append(dict(common, source=to, start=to["locator"]["start"], end=to["locator"]["end"]))
                else:
                    bucket["related"].append(dict(common, to=to, precision=precision_of(record), filename=target["filename"] if target else None, kind=target["kind"] if target else None,
                                                  disclosure=target["disclosure"] if target else "open", available=bool(target and target["path"])))
            if record["relation"] == "discussed_during" and frm["locator"]["kind"] == "lines" and record["review_state"] != "rejected":
                line_times.setdefault(frm["source_id"], []).append({"annotation_id": record["annotation_id"], "review_state": record["review_state"], "start": frm["locator"]["start"],
                                                                    "end": frm["locator"]["end"], "start_ms": to["locator"]["start_ms"], "end_ms": to["locator"]["end_ms"], "recording_source_id": to["source_id"]})
        page_count = len(texts) if texts is not None else None
        pages = range(1, (page_count or 0) + 1)
        slides = []
        for page in pages:
            links = slides_links.get(page, {"occurrences": [], "transcript_ranges": [], "related": []})
            text = texts[page - 1] if texts else None
            slides.append({"page": page, "title": (text or "").splitlines()[0][:120] if text else None, "text": text, "text_status": "extracted" if text else "no_text_layer",
                           "concepts": sorted(page_concepts.get(page, {}).values(), key=lambda x: x["label"]), "questions": page_questions.get(page, []),
                           "occurrences": sorted(links["occurrences"], key=lambda o: o["start_ms"]), "transcript_ranges": sorted(links["transcript_ranges"], key=lambda o: o["start"]),
                           "related": links["related"]})
        recordings, transcripts = [], []
        for session in lecture["sessions"]:
            for item in session["items"]:
                base = {"source_id": item["source_id"], "version_id": item["version_id"], "sha256": item["sha256"], "filename": item["filename"], "media_type": item["media_type"],
                        "state": item["state"], "registration": item["registration"], "session_id": session["session_id"], "bytes": item["bytes"]}
                if item["kind"] == "lecture_recording" and item["path"]:
                    recordings.append(dict(base, content=f"sources/{course_id}/{item['source_id']}/content", duration_ms=media_duration_ms(root / item["path"])))
                elif item["kind"] == "lecture_transcript" and item["path"] and item["rendition"] == "native_text":
                    try:
                        lines = (root / item["path"]).read_text(encoding="utf-8-sig", errors="replace").splitlines()[:MAX_TRANSCRIPT_LINES]
                    except OSError:
                        lines = []
                    times = sorted(line_times.get(item["source_id"], []), key=lambda t: t["start"])
                    transcripts.append(dict(base, lines=lines, line_times=times, timing="annotated" if times else "untimed",
                                            timing_note=None if times else "This transcript has no verified timing: line references only, no playback highlight."))
        return {"course_id": course_id, "lecture_id": lecture_id, "title": lecture["title"], "session_link": lecture["session_link"],
                "deck": ({"source_id": deck["source_id"], "version_id": deck["version_id"], "sha256": deck["sha256"], "filename": deck["filename"], "state": deck["state"],
                          "registration": deck["registration"], "rendition": deck["rendition"]} if deck else None),
                "display": display, "page_count": page_count, "slides": slides, "recordings": recordings, "transcripts": transcripts,
                "sessions": [{"session_id": s["session_id"], "state": s["state"]} for s in lecture["sessions"]], "preparation": stages,
                "link_conflicts": [{"conflict_id": x["conflict_id"], "annotation_id": x["annotation_id"], "proposed": x["proposed"], "current": x["current"]} for x in loaded["conflicts"]]}

    # ---- questions -----------------------------------------------------------------------------
    def question_view(self, course_id: str, question_id: str) -> dict[str, Any] | None:
        catalogs = self._catalogs(course_id)
        index = catalogs["questions"]
        if not index or question_id not in index["questions"]:
            return None
        question = index["questions"][question_id]
        family = catalogs["families"].get((question.get("family_id"), question.get("family_revision")))
        records = self._records(course_id)
        evidence = []
        for attempt_id, attempt in records["attempts"].items():
            if attempt["question"].get("question_id") == question_id or attempt["question"].get("family_id") == question.get("family_id"):
                effective = records["effective"][attempt_id]
                evidence.append({"attempt_id": attempt_id, "recorded_at": attempt["recorded_at"], "assessment_id": effective["assessment_id"],
                                 "outcomes": {o["skill_id"]: o["outcome"] for o in effective["observations"]}, "link_scope": "same question" if attempt["question"].get("question_id") == question_id else "same family"})
        return {"course_id": course_id, "question_id": question_id, "version": question.get("version"), "title": question.get("title"), "prompt": question["prompt"],
                "collection": question.get("collection"), "origin": question.get("origin"), "source_refs": question.get("source_refs", []), "page": question.get("page"),
                "family": {"family_id": family["family_id"], "revision": family["revision"], "skill_ids": family["skill_ids"]} if family else None,
                "rubric_available": family is not None, "criteria_count": len(question.get("criteria", [])),
                "criteria_note": "Criteria and answer guidance are used for assessment and shown with feedback, not before your attempt.",
                "relationships": [r for r in index["relationships"] if question_id in (r["from_question"], r["to_question"])],
                "evidence": sorted(evidence, key=lambda e: e["recorded_at"], reverse=True), "answer_guidance": "restricted"}

    # ---- concept structure (projection of owner catalogs) ----------------------------------------
    def concepts_view(self, course_id: str) -> dict[str, Any]:
        catalogs = self._catalogs(course_id)
        skills, topics = catalogs["skills"]["skills"], catalogs["skills"]["topics"]
        index = catalogs["questions"] or {"questions": {}, "concepts": {}, "relationships": []}
        records = self._records(course_id)
        by_skill: dict[str, Counter] = {}
        for effective in records["effective"].values():
            for obs in effective["observations"]:
                by_skill.setdefault(obs["skill_id"], Counter())[obs["outcome"]] += 1
        nodes: dict[str, dict] = {}
        edges: list[dict] = []

        def node(node_id: str, node_type: str, label: str, **extra: Any) -> None:
            nodes.setdefault(node_id, {"id": node_id, "type": node_type, "label": label, "course_id": course_id, **extra})

        for topic in topics.values():
            node(topic["topic_id"], "topic", topic.get("label") or topic["topic_id"])
        for concept in index["concepts"].values():
            node(concept["concept_id"], "concept", concept["label"], aliases=concept.get("aliases", []))
            for topic_id in concept.get("topic_ids", []):
                edges.append({"from": topic_id, "to": concept["concept_id"], "relation": "topic_includes_concept", "provenance": "question index"})
        for skill in skills.values():
            evidence = dict(by_skill.get(skill["skill_id"], {}))
            node(skill["skill_id"], "skill", skill.get("performance_target") or skill["skill_id"], ability=skill.get("ability"), evidence_by_outcome=evidence,
                 assessed=bool(evidence), mapping="mapped" if skill.get("concept_id") in index["concepts"] else "system_mapping_incomplete")
            if skill.get("concept_id") in index["concepts"]:
                edges.append({"from": skill["concept_id"], "to": skill["skill_id"], "relation": "concept_assessed_as_skill", "provenance": "skills catalog"})
            else:
                for topic_id in skill.get("topic_ids", []):
                    edges.append({"from": topic_id, "to": skill["skill_id"], "relation": "topic_includes_skill", "provenance": "skills catalog"})
        for (family_id, revision), family in catalogs["families"].items():
            fid = f"{family_id}@r{revision}"
            node(fid, "question_family", family.get("prompt_template", family_id)[:140], family_id=family_id, revision=revision, origin=family.get("origin"))
            for skill_id in family.get("skill_ids", []):
                edges.append({"from": skill_id, "to": fid, "relation": "skill_practiced_by_family", "provenance": "question families catalog"})
        for question in index["questions"].values():
            node(question["question_id"], "question", question.get("title") or question["question_id"], collection=question.get("collection"))
            edges.append({"from": f"{question.get('family_id')}@r{question.get('family_revision')}", "to": question["question_id"], "relation": "family_instance", "provenance": "question index"})
        for rel in index["relationships"]:  # owner labels kept verbatim; containment is between questions, never a concept prerequisite
            edges.append({"from": rel["from_question"], "to": rel["to_question"], "relation": rel["relation"], "provenance": "question index", "rationale": rel.get("rationale"),
                          "automatic_credit": rel.get("automatic_credit", False), "scope": "question_to_question"})
        for link in self._shared_links(course_id):
            node(link["concept_id"], "shared_concept", link["label"], cross_course=True)
            edges.append({"from": link["concept_id"], "to": link["skill_id"], "relation": f"shared_{link['relation']}", "provenance": "shared-learning overlay (reviewed)",
                          "automatic_credit": False, "other_courses": link["other_courses"]})
        edges = [e for e in edges if e["from"] in nodes and e["to"] in nodes]
        children = {e["to"] for e in edges if e["relation"] in {"topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill", "skill_practiced_by_family", "family_instance"}}
        roots = sorted(n for n, v in nodes.items() if v["type"] in {"topic", "shared_concept"} or (v["type"] in {"concept", "skill"} and n not in children))
        return {"course_id": course_id, "nodes": nodes, "edges": edges, "roots": roots, "catalog_problems": catalogs["problems"],
                "note": "A projection of the course's own catalogs. Repeated appearances refer to one id. Relations keep the owner's labels; none grants automatic credit."}

    def _shared_links(self, course_id: str) -> list[dict]:
        path = self.settings.planner_root / "shared-learning" / "concepts.yaml"
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}
        except (OSError, yaml.YAMLError):
            return []
        out = []
        for concept in doc.get("concepts") or []:
            links = [l for l in concept.get("links") or [] if isinstance(l, dict)]
            for link in links:
                if link.get("course_id") == course_id and link.get("skill_id"):
                    out.append({"concept_id": concept.get("concept_id"), "label": concept.get("label") or concept.get("concept_id"), "skill_id": link["skill_id"],
                                "relation": link.get("relation", "related"), "other_courses": sorted({l["course_id"] for l in links if l.get("course_id") and l["course_id"] != course_id})})
        return out

    @staticmethod
    def neighborhood(view: dict, node_id: str, *, depth: int = 2, limit: int = 60) -> dict[str, Any]:
        """Bounded expansion around one node. Cycles and repeated identities are visited once."""
        if node_id not in view["nodes"]:
            return {"center": node_id, "nodes": {}, "edges": [], "truncated": False}
        seen, frontier, edges, truncated = {node_id}, [node_id], [], False
        for _ in range(depth):
            nxt = []
            for edge in view["edges"]:
                for a, b in ((edge["from"], edge["to"]), (edge["to"], edge["from"])):
                    if a in frontier:
                        if edge not in edges:
                            edges.append(edge)
                        if b not in seen:
                            if len(seen) >= limit:
                                truncated = True
                                continue
                            seen.add(b)
                            nxt.append(b)
            frontier = nxt
        return {"center": node_id, "nodes": {n: view["nodes"][n] for n in seen}, "edges": [e for e in edges if e["from"] in seen and e["to"] in seen], "truncated": truncated}

    # ---- progress and gaps ----------------------------------------------------------------------
    def gaps_view(self, course_id: str) -> dict[str, Any]:
        catalogs = self._catalogs(course_id)
        records = self._records(course_id)
        episodes: dict[str, list[dict]] = {}
        for attempt_id, attempt in records["attempts"].items():
            effective = records["effective"][attempt_id]
            for obs in effective["observations"]:
                episodes.setdefault(obs["skill_id"], []).append({
                    "attempt_id": attempt_id, "assessment_id": effective["assessment_id"], "revised": len(effective["chain"]) > 1, "conflict": effective["conflict"],
                    "outcome": obs["outcome"], "assistance": obs["assistance"], "reference_access": obs["reference_access"], "confidence": obs["assessment_confidence"],
                    "analysis": obs["analysis"], "missing_or_incorrect": obs["missing_or_incorrect"], "error_types": obs["error_types"], "recorded_at": attempt["recorded_at"],
                    "occurred_at": attempt["occurred_at"], "time_basis": attempt["time_basis"], "mode": attempt["mode"], "evidence_kind": attempt["evidence_kind"],
                    "question_prompt": attempt["question"]["prompt"], "question_id": attempt["question"].get("question_id")})
        rows = []
        for skill_id, skill in catalogs["skills"]["skills"].items():
            history = sorted(episodes.get(skill_id, []), key=lambda e: (e["recorded_at"], e["attempt_id"]))
            observed = [e for e in history if e["outcome"] != "not_observed"]
            latest = observed[-1] if observed else None
            if not history:
                status = "not_assessed"
            elif latest is None:
                status = "not_observed_only"
            elif latest["outcome"] in {"partial", "not_demonstrated"}:
                status = "current_gap"
            elif latest["outcome"] == "uncertain":
                status = "uncertain"
            else:
                status = "demonstrated_latest"
            gap = None
            if status == "current_gap":
                gap = {"observed": {k: latest[k] for k in ("attempt_id", "assessment_id", "outcome", "missing_or_incorrect", "error_types", "analysis", "assistance", "reference_access", "recorded_at", "time_basis", "confidence")},
                       "cause_status": "hypothesis_only", "note": "The observation is what was seen in this response. Its cause is not established; a possible prerequisite is context, not proof."}
            rows.append({
                "skill_id": skill_id, "label": skill.get("performance_target") or skill_id, "ability": skill.get("ability"), "topic_ids": skill.get("topic_ids", []),
                "concept_id": skill.get("concept_id"), "status": status, "episodes": len(history), "latest": latest, "gap": gap,
                "counterevidence": [{k: e[k] for k in ("attempt_id", "outcome", "assistance", "recorded_at")} for e in observed[:-1] if latest and e["outcome"] != latest["outcome"]],
                "unaided_demonstrated": sum(1 for e in history if e["outcome"] == "demonstrated" and e["assistance"] == "none" and e["reference_access"] == "none" and e["evidence_kind"] == "observed_response"),
                "study": {"priority": skill.get("priority"), "priority_reason": skill.get("priority_reason"), "need_basis": skill.get("need_basis"), "study_decision": skill.get("study_decision"),
                          "note": "Priority and study decision are planning choices, not competence measurements."},
                "history": history,
            })
        summary = Counter(r["status"] for r in rows)
        view_status = learning_view_status(self.settings.course(course_id).root)
        return {"course_id": course_id, "skills": rows, "summary": {"skills": len(rows), **summary}, "recorded_attempts": len(records["attempts"]),
                "assessment_revisions": len(records["revisions"]), "owner_view_status": view_status, "record_problems": records["problems"], "catalog_problems": catalogs["problems"],
                "notes": ["Zero records means not assessed, not zero ability.", "No mastery percentage, forgetting curve or exam probability is computed.",
                          "The owner's learning-state view is stale; original attempts shown here remain the evidence." if view_status == "stale" else "Evidence shown comes from the original attempt records."]}

    # ---- history -------------------------------------------------------------------------------
    def history_view(self, course_id: str) -> dict[str, Any]:
        records = self._records(course_id)
        attempts = []
        for attempt_id, attempt in records["attempts"].items():
            effective = records["effective"][attempt_id]
            match = _CAPTURE.match(attempt["response_evidence"]["locator"])
            capture = {"path": match["path"], "sha256": match["sha"], "bytes": int(match["bytes"]), "media_type": "application/json"} if match else None
            full_text = None
            if capture is not None:
                path = self.settings.write_root(course_id) / capture["path"]
                if path.is_file() and c.sha256_hex(path.read_bytes()) == capture["sha256"]:
                    full_text = c.parse_json(path.read_bytes())["response"]["text"]
                else:
                    capture = dict(capture, unavailable=True)
            attempts.append({
                "attempt_id": attempt_id, "session_id": attempt["session_id"], "recorded_at": attempt["recorded_at"], "occurred_at": attempt["occurred_at"], "time_basis": attempt["time_basis"],
                "mode": attempt["mode"], "evidence_kind": attempt["evidence_kind"], "question": attempt["question"],
                "response": {"excerpt": attempt["response_evidence"]["excerpt"], "full_text": full_text,
                             "availability": "full_capture" if full_text is not None else ("capture_unavailable" if capture else "excerpt_only"), "capture": capture},
                "original_observations": attempt["observations"], "effective": effective,
                "revisions": [{"event_id": e, "reason": records["revisions"][e]["reason"], "recorded_at": records["revisions"][e]["recorded_at"]} for e in effective["chain"][1:]],
                "artifact": {"path": attempt["_path"], "sha256": attempt["_sha256"], "bytes": attempt["_bytes"], "media_type": "application/json"}})
        attempts.sort(key=lambda a: (a["recorded_at"], a["attempt_id"]), reverse=True)
        conversations = []
        runs = self.settings.runs_area(course_id)
        if runs.is_dir():
            for run in sorted(runs.iterdir()):
                entries = []
                for path in sorted((run / "messages").glob("*.json")) if (run / "messages").is_dir() else []:
                    try:
                        m = c.parse_json(path.read_bytes())
                        entries.append({"kind": m["role"], "at": m["created_at"], "text": m["text"], "request_id": m["request_id"], "disposition": m["assessment_disposition"], "sources": m["sources"]})
                    except (c.ContractError, KeyError):
                        continue
                for path in sorted((run / "turns").glob("*.json")) if (run / "turns").is_dir() else []:
                    try:
                        t = c.parse_json(path.read_bytes())
                        entries.append({"kind": "submission", "at": t["captured_at"], "text": t["response"]["text"], "prompt": t["question"]["prompt"], "interaction": t["interaction"],
                                        "turn_id": t["turn_id"], "conditions": t["conditions"], "occurred_at": t["occurred_at"], "time_basis": t["time_basis"]})
                    except (c.ContractError, KeyError):
                        continue
                if entries:
                    conversations.append({"run_id": run.name, "entries": sorted(entries, key=lambda e: e["at"])})
        return {"course_id": course_id, "attempts": attempts, "conversations": conversations, "record_problems": records["problems"],
                "note": "Regrades are shown as revisions of the same attempt, never as new answers. Older attempts may only have an excerpt; nothing is reconstructed."}

    # ---- review --------------------------------------------------------------------------------
    def review_view(self, course_id: str) -> dict[str, Any]:
        records = self._records(course_id)
        rows = self.reviews.due_view(course_id, now=self._now(), effective_observations=lambda attempt_id: (records["effective"].get(attempt_id) or {}).get("observations"))
        items = self.reviews.items(course_id)["current"]
        for row in rows:
            row["artifact"] = items[row["item_id"]]["artifact"]
        selected = {r["question"]["question_id"] for r in rows if r["question"]["question_id"]}
        catalogs = self._catalogs(course_id)
        available = []
        for question in ((catalogs["questions"] or {}).get("questions") or {}).values():
            if question["question_id"] not in selected:
                available.append({"question_id": question["question_id"], "title": question.get("title"), "prompt": question["prompt"], "origin": question.get("origin"),
                                  "family_id": question.get("family_id"), "family_revision": question.get("family_revision"), "source_refs": question.get("source_refs", [])})
        return {"course_id": course_id, "items": rows, "due_count": sum(1 for r in rows if r["is_due"]), "available_questions": available[:200],
                "default_session_size": int(self.settings.policy["review_default_max_items"]),
                "note": "Existing course questions are offered first. Saving an item does not schedule it; a due date is a suggestion, not evidence of forgetting."}

    # ---- activity ------------------------------------------------------------------------------
    def activity_view(self, *, limit: int = 100) -> dict[str, Any]:
        jobs = []
        for job in self.journal.jobs(limit=limit):
            admission = self.journal.admission(job["request_id"]) if job["request_id"] else None
            receipts = self.journal.receipts(job["job_id"])
            kinds = Counter(r["kind"] for r in receipts)
            publication = next((r["payload"] for r in reversed(receipts) if r["kind"] == "publication"), None)
            dispatches = [d for d in self.journal.dispatches(job["job_id"]) if d["state"] != "not_sent"]
            state = job["state"]
            native = ("Not needed" if not job["detail"].get("needs_native") else
                      {S.READY: "Queued", S.CLAIMED: "Queued", S.RUNNING: "Running", S.WAITING_USER: "Waiting for you", S.AUTH_REQUIRED: "Connection not verified / sign-in needed",
                       S.QUOTA_WAIT: "Quota wait", S.UNCERTAIN_COMPLETION: "Completion unknown", S.FAILED_FINAL: "Failed", S.FAILED_RETRYABLE: "Retry scheduled",
                       S.CANCELLED: "Cancelled", S.SUPERSEDED: "Superseded", S.WAITING_SYNC: "Waiting for an earlier request"}.get(state, "Completed" if dispatches else "Not started"))
            actions = []
            if state not in TERMINAL and job["request_id"]:
                actions.append("cancel")
            if state in {S.UNCERTAIN_COMPLETION, S.STAGED, S.COMMIT_PENDING}:
                actions.append("check_status")
            if state in {S.UNCERTAIN_COMPLETION, S.AUTH_REQUIRED, S.QUOTA_WAIT, S.WAITING_REVIEW}:
                actions.append("retry")
            jobs.append({
                "job_id": job["job_id"], "request_id": job["request_id"], "course_id": job["course_id"], "workflow": job["workflow"], "action": admission["action"] if admission else job["detail"].get("kind"),
                "depth": admission["depth"] if admission else None, "logical_input_id": admission["logical_input_id"] if admission else None, "state": str(state),
                "reason": job["waiting_reason"], "cancel_requested": job["cancel_requested"], "generation": job["generation"], "created_at": job["created_at"], "updated_at": job["updated_at"],
                "phases": {"input": "Captured on the Brain" if kinds["capture"] else ("Received by Brain" if admission else "Internal task"),
                           "transport": "Admitted (complete, signed bundle)" if admission else "Not applicable", "native": native,
                           "answer": "Late result kept, not shown as current" if kinds["late-result"] else ("Available" if kinds["output"] else "None yet"),
                           "publication": (f"{publication['kind']}: {publication['status']}" if publication else ("Not assessed in this exchange" if kinds["output"] and admission and admission["action"] == "ask" else "None")),
                           "publication_reason": publication["reason"] if publication else None},
                "dispatches": len(dispatches), "actions": actions})
        return {"jobs": jobs, "counts": self.journal.counts(), "rejections": self._rejections(), "supervisor": {"paused": bool(self.journal.get_value("supervisor-paused", False))},
                "note": "Each line is a separate fact: captured, admitted, native turn, answer, course save. None of them implies the next."}

    # ---- search index (client-side, bounded; no solutions) ---------------------------------------
    def search_index(self, course_id: str) -> dict[str, Any]:
        binding = self.settings.course(course_id)
        inventory = build_inventory(binding)
        entries, unindexed = [], []
        for lecture in inventory["lectures"]:
            entries.append({"type": "lecture", "title": lecture["title"], "text": lecture["title"], "ref": {"lecture_id": lecture["lecture_id"]}})
            try:
                texts = c.parse_json((self.preparation.prepared_dir(course_id, lecture["lecture_id"]) / "slides-text.json").read_bytes())["pages"]
            except (OSError, c.ContractError, KeyError):
                texts = None
            if texts is None:
                unindexed.append({"what": lecture["title"], "reason": "slide text not prepared or not displayable"})
            else:
                for page, text in enumerate(texts, start=1):
                    if text:
                        entries.append({"type": "slide", "title": f"{lecture['title']} — slide {page}", "text": text[:1500], "ref": {"lecture_id": lecture["lecture_id"], "page": page}})
            for session in lecture["sessions"]:
                for item in session["items"]:
                    if item["kind"] == "lecture_transcript" and item["path"] and item["rendition"] == "native_text":
                        try:
                            lines = (binding.root / item["path"]).read_text(encoding="utf-8-sig", errors="replace").splitlines()[:MAX_TRANSCRIPT_LINES]
                        except OSError:
                            continue
                        for number, line in enumerate(lines, start=1):
                            if line.strip():
                                entries.append({"type": "transcript", "title": f"{lecture['title']} — transcript line {number}", "text": line[:500],
                                                "ref": {"lecture_id": lecture["lecture_id"], "source_id": item["source_id"], "line": number}})
        catalogs = self._catalogs(course_id)
        index = catalogs["questions"] or {"questions": {}, "concepts": {}}
        for question in index["questions"].values():
            entries.append({"type": "question", "title": question.get("title") or question["question_id"], "text": question["prompt"][:1500], "ref": {"question_id": question["question_id"]}})
        for concept in index["concepts"].values():
            entries.append({"type": "concept", "title": concept["label"], "text": " ".join([concept["label"], *concept.get("aliases", [])]), "ref": {"node_id": concept["concept_id"]}})
        for skill in catalogs["skills"]["skills"].values():
            entries.append({"type": "skill", "title": skill.get("performance_target") or skill["skill_id"], "text": skill.get("performance_target") or "", "ref": {"node_id": skill["skill_id"]}})
        for item in inventory["other_sources"]:
            if item["disclosure"] == "restricted_solution":
                continue  # answer keys are never searchable or listed in client payloads
            if item["filename"]:
                entries.append({"type": "source", "title": item["filename"], "text": f"{item['filename']} {item['kind']}", "ref": {"source_id": item["source_id"]}})
        return {"course_id": course_id, "display_name": binding.display_name, "entries": entries, "unindexed": unindexed, "max_results": 50,
                "note": "Search runs on this bounded index in the browser. Text without a verified locator opens its source context, not an invented page or time."}

    # ---- file views with ll.view records (for the Drive transport) -------------------------------
    def write_views(self, course_id: str, generation: int) -> list[dict]:
        """Publish the course views as files plus view records. Loopback clients may also call the methods directly."""
        area = self.settings.app_area(course_id) / "views"
        root = self.settings.course(course_id).root
        generator = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        inputs = []
        for rel in (".agent/source-index.json", "learning/skills.yaml", "learning/question-families.yaml", "learning/question-index.json"):
            if (root / rel).is_file():
                inputs.append(c.artifact(root / rel, rel, "application/octet-stream"))
        records = []
        for kind, name, builder in (("inventory", "course", lambda: self.course_view(course_id)), ("concept_tree", "concepts", lambda: self.concepts_view(course_id)),
                                    ("gaps", "gaps", lambda: self.gaps_view(course_id)), ("history", "history", lambda: self.history_view(course_id)),
                                    ("due", "review", lambda: self.review_view(course_id))):
            data = c.dump_json(builder())
            replace_atomic(area / f"{name}.json", data)
            record = {"contract": "ll.view/1", "view_id": f"view-{course_id}-{name}-g{generation}", "scope": {"course_id": course_id, "term": self.settings.course(course_id).term},
                      "kind": kind, "inputs": inputs, "outputs": [c.artifact_for_bytes(data, f"views/{name}.json", "application/json")],
                      "generator": {"name": GENERATOR, "revision": generator, "policy": self.settings.policy_revision}, "generation": generation, "created_at": self._now(),
                      "contains_new_assessment_facts": False}
            c.require_valid("view", record)
            replace_atomic(area / f"{name}.view.json", c.dump_json(record))
            records.append(record)
        return records
