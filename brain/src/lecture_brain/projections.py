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

from . import concept_graph, inferred_anchors, question_ties, slide_identity, timing_links
from . import contracts as c
from .annotations import AnnotationStore, media_duration_ms, precision_of
from .config import Settings
from .evidence import EvidenceReader, CONDITIONS, CONDITIONS_VERSION, condition_of, facet_of, facet_summary, load_facet_mapping
from .outline import OUTLINE_VERSION, OutlineModel
from .fsutil import replace_atomic
from .journal import Journal, JobState as S, TERMINAL
from .ownerio import OwnerReadError, study_maps
from .ownerio.attempts import learning_view_status, read_attempt_records
from .ownerio.catalogs import read_families, read_guidance, read_question_index, read_skills
from .ownerio.inventory import build_inventory, other_materials, primary_deck
from .ownerio.inventory import request_memo as inventory_request_memo
from .ownerio.question_links import build_question_bank, parse_locator
from .ownerio.renditions import compare_rendition, load_rendition_checks, record_rendition_check
from .preparation import Preparation, file_sha256
from .resume import ResumeStore
from .review import ReviewStore

_CAPTURE = re.compile(r"^Lecture Learning capture (?P<path>\S+) sha256:(?P<sha>[a-f0-9]{64}) bytes:(?P<bytes>\d+) turn:(?P<turn>\S+)$")
MAX_TRANSCRIPT_LINES = 20000
GENERATOR = "lecture-brain-projections"


def _pages_in(locator: str) -> set[int]:
    """Pages of the cited file that a catalog locator names, as written: a list stays a list (see ``parse_locator``)."""
    return {page for anchor in parse_locator(locator)["anchors"] if anchor["kind"] == "pages" and anchor["target"] == "cited" for page in anchor["pages"]}


def _ranges_text(ranges: list[list[int]]) -> str:
    return ", ".join(str(a) if a == b else f"{a}–{b}" for a, b in ranges)


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
        self._hashes: dict[str, str] = {}  # path|size|mtime -> sha256, for files compared as bytes
        self._mapping: dict[str, Any] | None = None
        self._catalog_memo: dict[tuple[str, str], tuple[tuple, Any]] = {}  # (course, catalog) -> ((size, mtime_ns), parsed)
        self._generated_memo: dict[tuple[str, str], Any] | None = None  # generated speech of the recordings of the request in progress

    # ---- shared readers ------------------------------------------------------------------------
    def _catalogs(self, course_id: str) -> dict[str, Any]:
        """The owner's catalogs, parsed once per version of their bytes: a file is read again as soon as its size or
        modification time differs (parsing the YAML catalogs took about a second of every lecture request)."""
        root = self.settings.course(course_id).root
        out: dict[str, Any] = {"skills": {"skills": {}, "topics": {}}, "families": {}, "questions": None, "problems": []}
        for key, reader, name in (("skills", read_skills, "skills.yaml"), ("families", read_families, "question-families.yaml"), ("questions", read_question_index, "question-index.json")):
            try:
                stat = (root / "learning" / name).stat()
                stamp: tuple | None = (stat.st_size, stat.st_mtime_ns)
            except OSError:
                stamp = None
            cached = self._catalog_memo.get((course_id, key))
            if stamp is not None and cached is not None and cached[0] == stamp:
                out[key] = cached[1]
                continue
            try:
                out[key] = reader(root, course_id)
                if stamp is not None:
                    self._catalog_memo[(course_id, key)] = (stamp, out[key])
            except OwnerReadError as exc:
                self._catalog_memo.pop((course_id, key), None)
                out["problems"].append({"catalog": key, "code": exc.code, "detail": exc.message})
        return out

    def _bank(self, course_id: str, catalogs: dict | None = None, inventory: dict | None = None) -> dict[str, Any]:
        """Every catalogued question with its collection, lecture membership, typed anchors and source actions (read side only)."""
        binding = self.settings.course(course_id)
        inventory = inventory or build_inventory(binding)
        catalogs = catalogs or self._catalogs(course_id)
        items = {i["source_id"]: i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]}
        items.update({i["source_id"]: i for i in inventory["other_sources"]})
        checks = {}
        for original_id, check in load_rendition_checks(self.settings.state_dir, course_id).items():
            original, copy = items.get(original_id), items.get(check.get("rendition_source_id"))
            # A recorded comparison counts only for the exact bytes that were compared (hashed from the files, not taken from the index).
            if original and copy and self._bytes_sha(course_id, original) == check.get("original_sha256") and self._bytes_sha(course_id, copy) == check.get("rendition_sha256"):
                checks[original_id] = check
        return build_question_bank(catalogs["questions"], inventory, reviewed_collections=binding.reviewed_collections, rendition_checks=checks)

    @staticmethod
    def _question_row(link: dict, question: dict) -> dict[str, Any]:
        """One question for a list: identity, why it is here, where it points. Never criteria wording or guidance."""
        return {**{k: link[k] for k in ("question_id", "version", "collection", "number", "title", "origin", "topic", "prompt_in_index", "family_id", "family_revision", "criteria_count",
                                        "criteria_authorship", "lecture_ids", "membership", "anchors", "anchor_state", "slide_anchor", "locator_text", "qualifiers", "unparsed",
                                        "original", "display_rendition", "related_copy")},
                "prompt": question["prompt"], "concept_ids": sorted({k["concept_id"] for k in question.get("criteria") or [] if k.get("concept_id")})}

    def questions_view(self, course_id: str, *, collection: str | None = None, lecture_id: str | None = None, text: str | None = None, origin: str | None = None,
                       anchor: str | None = None, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        """The course question bank: real totals, filters over the whole set, one page of rows (R1-Q1, R1-Q1b)."""
        binding = self.settings.course(course_id)
        inventory = build_inventory(binding)
        catalogs = self._catalogs(course_id)
        bank = self._bank(course_id, catalogs, inventory)
        index = (catalogs["questions"] or {}).get("questions", {})
        needle = (text or "").strip().lower()
        wanted = set(bank["lectures"].get(lecture_id, {}).get("question_ids", [])) if lecture_id else None
        rows = []
        for collection_row in bank["collections"]:
            for question_id in collection_row["question_ids"]:
                link, question = bank["questions"][question_id], index[question_id]
                if collection and str(link["collection"]) != collection or wanted is not None and question_id not in wanted or origin and link["origin"] != origin:
                    continue
                if anchor == "slide_named" and link["slide_anchor"] != "named" or anchor == "no_slide" and link["slide_anchor"] != "none" or anchor == "unresolved" and link["anchor_state"] != "unresolved":
                    continue
                if needle and needle not in f"{question_id} {link['title'] or ''} {question['prompt']}".lower():
                    continue
                rows.append(self._question_row(link, question))
        offset, limit = max(0, int(offset)), max(1, min(int(limit), 500))
        page = rows[offset:offset + limit]
        own = self._own_ties_of(course_id, [row["question_id"] for row in page], catalogs, inventory=inventory, bank=bank)
        for row in page:  # R2: the card says the question's links wherever it appears, the bank included
            row.update(own.get(row["question_id"]) or {"ties": None, "no_link": None, "suggestion_history": None})
        titles = {l["lecture_id"]: l["title"] for l in inventory["lectures"]}
        try:
            guidance = read_guidance(binding.root, index)
            guidance_summary = {"adapter": guidance["adapter"], "files": guidance["files"], "resolved": len(guidance["entries"]), "errors": guidance["errors"]}
        except OwnerReadError as exc:
            guidance_summary = {"adapter": None, "files": 0, "resolved": 0, "errors": [{"code": exc.code, "entry_id": None, "file": None, "detail": exc.message}]}
        return {"course_id": course_id, "links_version": bank["links_version"], "total": bank["total"], "matching": len(rows), "offset": offset, "limit": limit,
                "next_offset": offset + limit if offset + limit < len(rows) else None, "items": page,
                "collections": [{k: c[k] for k in ("collection", "count", "lecture_ids", "cited_source_ids", "origins", "without_wording", "slide_named", "anchor_unresolved", "page_basis_reviewed")}
                                for c in bank["collections"]],
                "lectures": [{"lecture_id": lid, "title": titles.get(lid), "collections": row["collections"], "count": len(row["question_ids"]), "gap": row["gap"]} for lid, row in bank["lectures"].items()],
                "guidance": guidance_summary, "catalog_problems": catalogs["problems"], "note": bank["note"]}

    def verify_rendition(self, course_id: str, question_id: str) -> dict[str, Any]:
        """Compare a question's related copy with its original and keep the outcome, bound to both files' bytes (app-local)."""
        binding = self.settings.course(course_id)
        inventory = build_inventory(binding)
        link = self._bank(course_id, inventory=inventory)["questions"].get(question_id)
        copy = link and (link["related_copy"] or link["display_rendition"])
        if not link or not link["original"] or not copy:
            return {"result": "not_applicable", "reason": "This question has no original with a separate related copy."}
        items = {i["source_id"]: i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]}
        items.update({i["source_id"]: i for i in inventory["other_sources"]})
        original, rendition = items[link["original"]["source_id"]], items[copy["source_id"]]
        outcome = compare_rendition(binding.root / original["path"], binding.root / rendition["path"], page=copy["page"] or 1)
        return record_rendition_check(self.settings.state_dir, course_id, original=original, rendition=rendition, original_sha256=self._bytes_sha(course_id, original),
                                      rendition_sha256=self._bytes_sha(course_id, rendition), outcome=outcome, checked_at=self._now())

    def _bytes_sha(self, course_id: str, item: dict) -> str | None:
        try:
            return file_sha256(self.settings.course(course_id).root / item["path"], self._hashes) if item.get("path") else None
        except OSError:
            return None

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
                           catalogued_questions=len(((self._catalogs(course_id)["questions"] or {}).get("questions")) or {}),
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
        coverage = {l["lecture_id"]: l for l in self.preparation.coverage(only=course_id)["courses"][course_id]["lectures"]}
        bank = self._bank(course_id, inventory=inventory)

        def session(s: dict) -> dict:
            return {"session_id": s["session_id"], "date": s["date"], "state": s["state"], "linked_lecture_ids": s["linked_lecture_ids"],
                    "items": [{k: i[k] for k in ("source_id", "kind", "filename", "state", "registration", "bytes", "media_type")} for i in s["items"]]}

        lectures = []
        for lecture in inventory["lectures"]:
            deck = primary_deck(lecture)
            cov = coverage.get(lecture["lecture_id"], {})
            rendition = ((cov.get("stages") or {}).get("rendition") or {})
            displayable = bool(deck) and (deck["rendition"] == "native_pdf" and deck["state"] in {"registered_readable", "present_unindexed"} or rendition.get("status") == "rendition")
            lectures.append({"lecture_id": lecture["lecture_id"], "title": lecture["title"], "session_link": lecture["session_link"], "session_link_evidence": lecture.get("session_link_evidence"),
                             "deck": ({k: deck[k] for k in ("source_id", "state", "registration", "rendition", "filename", "bytes")} if deck else None),
                             "displayable": displayable, "other_materials_count": len(other_materials(lecture)),
                             "deck_choice": {"state": lecture["deck_choice"]["state"], "basis": lecture["deck_choice"]["basis"], "candidates": len(lecture["deck_choice"]["candidate_source_ids"])},
                             "questions": {"count": len(bank["lectures"][lecture["lecture_id"]]["question_ids"]), "collections": bank["lectures"][lecture["lecture_id"]]["collections"]},
                             "sessions": [session(s) for s in lecture["sessions"]], "disposition": cov.get("disposition", "not_processed"),
                             "pages": cov.get("pages"), "pages_confirmed": cov.get("pages_confirmed", 0), "pages_suggested": cov.get("pages_suggested", 0),
                             "pages_unresolved": cov.get("pages_unresolved")})
        records = self._records(course_id)
        return {"course_id": course_id, "display_name": binding.display_name, "index": inventory["index"], "lectures": lectures,
                "unlinked_sessions": [session(s) for s in inventory["unlinked_sessions"]],
                "other_sources": [{k: i[k] for k in ("source_id", "kind", "filename", "state", "registration", "rendition", "disclosure", "bytes", "media_type", "source_date")} for i in inventory["other_sources"]],
                "recorded_attempts": len(records["attempts"]), "learning_view_status": learning_view_status(binding.root),
                "question_bank": {"total": bank["total"], "collections": [{"collection": c["collection"], "count": c["count"], "lecture_ids": c["lecture_ids"]} for c in bank["collections"]]},
                "enumeration_truncated": inventory["enumeration_truncated"]}

    # ---- lecture -------------------------------------------------------------------------------
    def lecture_view(self, course_id: str, lecture_id: str, *, deck: str | None = None) -> dict[str, Any] | None:
        outer = self._generated_memo
        self._generated_memo = {} if outer is None else outer
        try:
            with inventory_request_memo():
                return self._lecture_view(course_id, lecture_id, deck=deck)
        finally:
            self._generated_memo = outer

    def _lecture_view(self, course_id: str, lecture_id: str, *, deck: str | None = None) -> dict[str, Any] | None:
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
        requested = deck
        choice = dict(lecture["deck_choice"])
        deck = primary_deck(lecture)
        if requested and requested != (deck or {}).get("source_id") and requested in {d["source_id"] for d in lecture["decks"]}:
            # A choice made for this request only (the learner picked among the unit's files); stored nowhere by this read.
            deck = next(d for d in lecture["decks"] if d["source_id"] == requested)
            choice.update(state="selected", basis="this_request", source_id=requested)
        choice["candidates"] = [{"source_id": d["source_id"], "filename": d["filename"], "bytes": d["bytes"], "registration": d["registration"], "rendition": d["rendition"], "state": d["state"]}
                                for d in lecture["decks"] if d["source_id"] in choice["candidate_source_ids"]]
        display: dict[str, Any] = {"kind": "unavailable", "reason": "No slide deck file is present for this lecture unit."}
        if deck is None and choice["state"] == "unresolved":
            display = {"kind": "choose_deck", "reason": f"This unit holds {len(choice['candidates'])} candidate files and the course index does not say which one is the lecture deck."}
        if deck is not None:
            rendition = stages.get("rendition", {}) if choice["basis"] != "this_request" else {}
            if deck["rendition"] == "native_pdf" and deck["state"] in {"registered_readable", "present_unindexed"}:
                display = {"kind": "original_pdf", "content": f"sources/{course_id}/{deck['source_id']}/content", "note": "Original PDF, shown unchanged."}
            elif rendition.get("status") == "rendition":
                display = {"kind": "rendition_pdf", "content": f"files/{course_id}/{rendition['path']}", "note": rendition["note"]}
            else:
                display = {"kind": "unavailable", "reason": rendition.get("reason") or f"The deck is {deck['state'].replace('_', ' ')}."}
        try:
            if choice["basis"] == "this_request":
                stored = c.parse_json((self.preparation.prepared_dir(course_id, lecture_id) / "other" / f"{deck['source_id']}.json").read_bytes())
                texts = stored["pages"] if stored.get("sha256") == self.preparation.identity_of(course_id, deck)[1] else None
            else:
                stored = c.parse_json((self.preparation.prepared_dir(course_id, lecture_id) / "slides-text.json").read_bytes())
                texts = stored["pages"] if deck is not None and stored.get("deck_source_id", deck["source_id"]) == deck["source_id"] else None
        except (OSError, c.ContractError, KeyError):
            texts = None
        prepared = texts is not None
        if texts is None and display["kind"] == "original_pdf":
            # Not prepared yet: the deck can still be read. Count its pages so navigation works; text arrives with preparation.
            try:
                from pypdf import PdfReader

                texts = [""] * len(PdfReader(str(root / deck["path"])).pages)
            except Exception:  # noqa: BLE001 - an unreadable PDF is shown as unavailable text, not a crash
                texts = None
        catalogs = self._catalogs(course_id)
        questions = (catalogs["questions"] or {}).get("questions", {})
        concepts = (catalogs["questions"] or {}).get("concepts", {})
        skills = catalogs["skills"]["skills"]
        bank = self._bank(course_id, catalogs, inventory)
        mine = bank["lectures"][lecture_id]
        page_concepts: dict[int, dict[str, dict]] = {}
        page_questions: dict[int, list[dict]] = {}
        if deck is not None:
            for link in bank["questions"].values():
                question = questions[link["question_id"]]
                for anchor in link["anchors"]:
                    if anchor["kind"] != "pages" or anchor["source_id"] != deck["source_id"]:
                        continue
                    stated = _ranges_text(anchor["ranges"])
                    why = (f"The course record names slide {stated} of this deck." if anchor["basis"] == "exact" else
                           f"The course record names slide {stated}; this collection's slide numbers are not yet confirmed as page numbers.")
                    for page in anchor["pages"]:
                        page_questions.setdefault(page, []).append({"question_id": link["question_id"], "title": link["title"], "family_id": link["family_id"],
                                                                    "family_revision": link["family_revision"], "prompt": question["prompt"], "prompt_in_index": link["prompt_in_index"],
                                                                    "collection": link["collection"], "basis": anchor["basis"], "why": why})
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
        own = set(mine["question_ids"])
        related: dict[str, dict] = {}
        for rel in (catalogs["questions"] or {}).get("relationships", []):
            for inside, outside, direction in ((rel["from_question"], rel["to_question"], "from_lecture_question"), (rel["to_question"], rel["from_question"], "to_lecture_question")):
                if inside in own and outside not in own and outside in bank["questions"]:
                    row = related.setdefault(outside, dict(self._question_row(bank["questions"][outside], questions[outside]), via=[]))
                    row["via"].append({"question_id": inside, "relation": rel["relation"], "direction": direction, "automatic_credit": bool(rel.get("automatic_credit", False))})
        lecture_questions = {
            "collections": [{k: c_[k] for k in ("collection", "count", "page_basis_reviewed", "slide_named", "anchor_unresolved", "without_wording")} for c_ in bank["collections"] if c_["collection"] in mine["collections"]],
            "all": [self._question_row(bank["questions"][q], questions[q]) for q in mine["question_ids"]], "gap": mine["gap"],
            "related_by_relationship": [related[k] for k in sorted(related)],
            "note": "All lecture questions come from the collections the course catalog ties to this unit's files. A slide is named only where the catalog names one."}

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
            slides.append({"page": page, "title": (text or "").splitlines()[0][:120] if text else None, "text": text or None,
                           "text_status": "extracted" if text else ("no_text_layer" if prepared else "not_prepared"),
                           "concepts": sorted(page_concepts.get(page, {}).values(), key=lambda x: x["label"]), "questions": page_questions.get(page, []),
                           "occurrences": sorted(links["occurrences"], key=lambda o: o["start_ms"]), "transcript_ranges": sorted(links["transcript_ranges"], key=lambda o: o["start"]),
                           "related": links["related"]})
        deck_identity = self.preparation.identity_of(course_id, deck) if deck else (None, None)
        recordings, transcripts = [], []
        for session in lecture["sessions"]:
            for item in session["items"]:
                version_id, sha256 = self.preparation.identity_of(course_id, item)
                base = {"source_id": item["source_id"], "version_id": version_id, "sha256": sha256, "filename": item["filename"], "media_type": item["media_type"],
                        "state": item["state"], "registration": item["registration"], "session_id": session["session_id"], "bytes": item["bytes"]}
                if item["kind"] == "lecture_recording" and item["path"]:
                    # The file itself as a citable artifact: a link the learner creates names it as its support.
                    artifact = ({"path": item["path"], "sha256": sha256, "bytes": item["bytes"], "media_type": item["media_type"] or "application/octet-stream"}
                                if sha256 and item["bytes"] else None)
                    recordings.append(dict(base, content=f"sources/{course_id}/{item['source_id']}/content", duration_ms=media_duration_ms(root / item["path"]), artifact=artifact,
                                           generated_text=self._generated_text(course_id, item["source_id"])))
                elif item["kind"] == "lecture_transcript" and item["path"] and item["rendition"] == "native_text":
                    try:
                        lines = (root / item["path"]).read_text(encoding="utf-8-sig", errors="replace").splitlines()[:MAX_TRANSCRIPT_LINES]
                    except OSError:
                        lines = []
                    times = sorted(line_times.get(item["source_id"], []), key=lambda t: t["start"])
                    transcripts.append(dict(base, lines=lines, line_times=times, timing="annotated" if times else "untimed",
                                            timing_note=None if times else "This transcript has no verified timing: line references only, no playback highlight."))
        view = {"course_id": course_id, "lecture_id": lecture_id, "title": lecture["title"], "session_link": lecture["session_link"], "session_link_evidence": lecture.get("session_link_evidence"),
                "deck": ({"source_id": deck["source_id"], "version_id": deck_identity[0], "sha256": deck_identity[1], "filename": deck["filename"], "state": deck["state"],
                          "registration": deck["registration"], "rendition": deck["rendition"]} if deck else None),
                "deck_choice": choice, "questions": lecture_questions,
                # Four separate facts about timing; none implies another (R1-T2).
                "timing_summary": {"reviewed_links": sum(1 for s_ in slides for o in s_["occurrences"] if o["review_state"] == "confirmed"),
                                   "suggested_links": sum(1 for s_ in slides for o in s_["occurrences"] if o["review_state"] != "confirmed"),
                                   "text_match_suggestions": sum(1 for s_ in slides for r in s_["transcript_ranges"] if r["review_state"] != "confirmed"),
                                   "generated_text_recordings": sum(1 for r in recordings if r["generated_text"]), "scheduled_preparation": "not_active"},
                "display": display, "page_count": page_count, "slides": slides, "recordings": recordings, "transcripts": transcripts,
                "sessions": [{"session_id": s["session_id"], "state": s["state"]} for s in lecture["sessions"]], "preparation": stages,
                "other_materials": other_materials(dict(lecture, deck_choice=choice)),
                "link_conflicts": [{"conflict_id": x["conflict_id"], "annotation_id": x["annotation_id"], "proposed": x["proposed"], "current": x["current"]} for x in loaded["conflicts"]]}
        return self._enrich_r2(view, course_id=course_id, lecture_id=lecture_id, lecture=lecture, deck=deck, inventory=inventory, catalogs=catalogs, bank=bank)

    def _enrich_r2(self, view: dict[str, Any], *, course_id: str, lecture_id: str, lecture: dict, deck: dict | None, inventory: dict, catalogs: dict, bank: dict) -> dict[str, Any]:
        """Amendment R2: slide identity, then question ties, then timing links, each by its own module (docs/engineering/r2-read-api.md,
        section 4). Every step reads; none writes. A damaged private file of one step never breaks reading the lecture."""
        root = self.settings.course(course_id).root
        source_map, reason = slide_identity.map_for(self.settings, course_id, lecture, deck)
        slide_identity.enrich(view, source_map=source_map, reason=reason)
        index = catalogs["questions"]
        inferred = inferred_anchors.load(self.settings, course_id, index=index, inventory=inventory, deck_sha256_of=lambda item: self._bytes_sha(course_id, item),
                                         guidance_text_of=inferred_anchors.guidance_reader(root, index))
        try:  # the course's own study maps (D78): coarse, course-stated placements, listed apart from page ties
            maps = study_maps.read_study_maps(root, inventory, sha_of=lambda path: file_sha256(path, self._hashes))
            sections = study_maps.section_ties(maps, bank)
            map_digests = {lecture_key: record["source"]["sha256"] for lecture_key, record in maps["lectures"].items()}
        except Exception:  # noqa: BLE001 - an unreadable note is reported by its own readback, never by a broken lecture
            sections, map_digests = None, {}
        reader = EvidenceReader(self._records(course_id))
        question_ties.enrich(view, bank=bank, index=index, source_map=view.get("source_map"), inferred=inferred, decisions=inferred_anchors.decisions(self.settings, course_id),
                             evidence_of=reader.question, section_ties=sections)
        ready = view["source_map"].get("state") == "ready"
        view.setdefault("revisions", {}).update(
            deck_sha256=(view.get("deck") or {}).get("sha256"), map_revision=view["source_map"].get("map_revision") if ready else None,
            question_index_sha256=(index or {}).get("sha256"), inferred_anchors_sha256=inferred["file"]["sha256"], study_map_sha256=map_digests.get(lecture_id),
            evidence_revision=reader.revision)
        generated = {r["source_id"]: self._derived_current(course_id, r["source_id"]) for r in view.get("recordings") or []}
        try:
            held = self.annotations.current_records(course_id)  # the service's one store: a revision file is read once
        except Exception:  # noqa: BLE001 - a damaged annotation folder must not hide the suggestions; it is reported by its own view
            held = []
        view = timing_links.enrich_view(self.settings, course_id, lecture_id, view, preparation=self.preparation, source_map=source_map, generated=generated, annotations=held)
        view["revisions"].setdefault("timing_links", [])
        return view

    # ---- questions -----------------------------------------------------------------------------
    def question_view(self, course_id: str, question_id: str) -> dict[str, Any] | None:
        catalogs = self._catalogs(course_id)
        index = catalogs["questions"]
        if not index or question_id not in index["questions"]:
            return None
        question = index["questions"][question_id]
        family = catalogs["families"].get((question.get("family_id"), question.get("family_revision")))
        records = self._records(course_id)
        link = self._bank(course_id, catalogs)["questions"][question_id]
        evidence = []
        for attempt_id, attempt in records["attempts"].items():
            if attempt["question"].get("question_id") == question_id or attempt["question"].get("family_id") == question.get("family_id"):
                effective = records["effective"][attempt_id]
                evidence.append({"attempt_id": attempt_id, "recorded_at": attempt["recorded_at"], "assessment_id": effective["assessment_id"],
                                 "outcomes": {o["skill_id"]: o["outcome"] for o in effective["observations"]}, "link_scope": "same question" if attempt["question"].get("question_id") == question_id else "same family"})
        return {"course_id": course_id, "question_id": question_id, "version": question.get("version"), "title": question.get("title"), "prompt": question["prompt"],
                "prompt_in_index": question["prompt_in_index"], "prompt_status": question.get("prompt_status"),
                "collection": question.get("collection"), "origin": question.get("origin"), "source_refs": question.get("source_refs", []), "page": question.get("page"),
                "family": {"family_id": family["family_id"], "revision": family["revision"], "skill_ids": family["skill_ids"]} if family else None,
                "rubric_available": family is not None, "criteria_count": len(question.get("criteria", [])),
                "criteria_note": "Criteria and answer guidance are used for assessment and shown with feedback, not before your attempt.",
                **{k: link[k] for k in ("lecture_ids", "membership", "anchors", "anchor_state", "slide_anchor", "locator_text", "qualifiers", "unparsed", "original", "display_rendition",
                                        "related_copy", "criteria_authorship", "source_note", "number")},
                "relationships": [r for r in index["relationships"] if question_id in (r["from_question"], r["to_question"])],
                "evidence": sorted(evidence, key=lambda e: e["recorded_at"], reverse=True), "answer_guidance": "restricted",
                **self._own_ties(course_id, question_id, catalogs)}

    def _own_ties(self, course_id: str, question_id: str, catalogs: dict) -> dict[str, Any]:
        """The question's own links for its page (R2): ``ties``, ``no_link`` and ``suggestion_history`` as the lecture lists
        state them, whatever lecture (or none) its collection belongs to. All three are ``None`` when they cannot be
        read; the page then falls back to the catalog's anchors and never shows a broken view."""
        return self._own_ties_of(course_id, [question_id], catalogs).get(question_id) or {"ties": None, "no_link": None, "suggestion_history": None}

    def _own_ties_of(self, course_id: str, question_ids: list[str], catalogs: dict, *, inventory: dict | None = None, bank: dict | None = None) -> dict[str, dict[str, Any]]:
        """:meth:`_own_ties` for several questions in one pass (a page of the bank). Empty when nothing could be read."""
        try:
            binding = self.settings.course(course_id)
            inventory = inventory if inventory is not None else build_inventory(binding)
            index = catalogs["questions"]
            bank = bank if bank is not None else self._bank(course_id, catalogs)
            inferred = inferred_anchors.load(self.settings, course_id, index=index, inventory=inventory, deck_sha256_of=lambda item: self._bytes_sha(course_id, item),
                                             guidance_text_of=inferred_anchors.guidance_reader(binding.root, index))
            try:
                maps = study_maps.read_study_maps(binding.root, inventory, sha_of=lambda path: file_sha256(path, self._hashes))
                sections = study_maps.section_ties(maps, bank)
            except Exception:  # noqa: BLE001 - an unreadable study note costs the section ties, not the page
                sections = None
            found = question_ties.ties_for_many(question_ids, bank=bank, index=index, inferred=inferred, decisions=inferred_anchors.decisions(self.settings, course_id), section_ties=sections)
            decks = {lecture["lecture_id"]: (primary_deck(lecture) or {}).get("source_id") for lecture in inventory["lectures"]}
            for entry in found.values():
                for tie in entry["ties"] or []:  # pages of that lecture's own slides open in the lecture; a page of another file opens as a file
                    tie["on_lecture_deck"] = bool(tie.get("lecture_id")) and tie.get("source_id") is not None and decks.get(tie["lecture_id"]) == tie["source_id"]
            return found
        except Exception:  # noqa: BLE001 - a damaged private file of this step never breaks reading the questions
            return {}

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
            # Criteria are objects of the catalog too. Their wording stays out of browse views; identity and bindings are kept.
            for number, criterion in enumerate(question.get("criteria") or [], start=1):
                node(criterion["criterion_id"], "criterion", f"Criterion {number} of {question['question_id']}", question_id=question["question_id"], skill_id=criterion.get("skill_id"),
                     concept_id=criterion.get("concept_id"), action_types=list(criterion.get("action_types") or []))
                edges.append({"from": question["question_id"], "to": criterion["criterion_id"], "relation": "question_has_criterion", "provenance": "question index"})
                if criterion.get("skill_id"):
                    edges.append({"from": criterion["skill_id"], "to": criterion["criterion_id"], "relation": "skill_assessed_by_criterion", "provenance": "question index"})
            edges.append({"from": f"{question.get('family_id')}@r{question.get('family_revision')}", "to": question["question_id"], "relation": "family_instance", "provenance": "question index"})
        for rel in index["relationships"]:  # owner labels kept verbatim; containment is between questions, never a concept prerequisite
            edges.append({"from": rel["from_question"], "to": rel["to_question"], "relation": rel["relation"], "provenance": "question index", "rationale": rel.get("rationale"),
                          "automatic_credit": rel.get("automatic_credit", False), "scope": "question_to_question"})
        for link in self._shared_links(course_id):
            node(link["concept_id"], "shared_concept", link["label"], cross_course=True)
            edges.append({"from": link["concept_id"], "to": link["skill_id"], "relation": f"shared_{link['relation']}", "provenance": "shared-learning overlay (reviewed)",
                          "automatic_credit": False, "other_courses": link["other_courses"]})
        edges = [e for e in edges if e["from"] in nodes and e["to"] in nodes]
        children = {e["to"] for e in edges if e["relation"] in {"topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill", "skill_practiced_by_family", "family_instance",
                                                                 "question_has_criterion", "skill_assessed_by_criterion"}}
        roots = sorted(n for n, v in nodes.items() if v["type"] in {"topic", "shared_concept"} or (v["type"] in {"concept", "skill"} and n not in children))
        return {"course_id": course_id, "nodes": nodes, "edges": edges, "roots": roots, "catalog_problems": catalogs["problems"],
                "note": "A projection of the course's own catalogs. Repeated appearances refer to one id. Relations keep the owner's labels; none grants automatic credit."}

    def _generated_text(self, course_id: str, source_id: str) -> dict[str, Any] | None:
        """Speech text generated elsewhere and imported from a verified manifest. Its times belong to that text only."""
        current = self._derived_current(course_id, source_id)
        if current is None:
            return None
        return {**{k: current[k] for k in ("generation", "created_at", "window", "duration_ms", "coverage_fraction", "covers_whole_recording", "text_origin", "review_state", "establishes", "note")},
                **{k: current.get(k) for k in ("covered_intervals", "unresolved_intervals", "unresolved_seconds", "processed_fraction")},
                "producer": {k: current["producer"].get(k) for k in ("tool", "model", "language")},
                "segments": [{"start_ms": s["start_ms"], "end_ms": s["end_ms"], "text": s["text"]} for s in current["segments"][:4000]], "segments_total": len(current["segments"])}

    def _derived_current(self, course_id: str, source_id: str) -> dict[str, Any] | None:
        """The generation served for a recording, read once per request (it is a megabyte of words for a long lecture)."""
        from .derived import Derived

        memo = self._generated_memo
        key = (course_id, source_id)
        if memo is not None and key in memo:
            return memo[key]
        try:
            current = Derived(self.settings, self.journal, preparation=self.preparation).current(course_id, source_id)
        except Exception:  # noqa: BLE001 - a damaged derived store must never break reading a lecture
            current = None
        if memo is not None:
            memo[key] = current
        return current

    def _facet_mapping(self) -> dict[str, Any]:
        if self._mapping is None:
            self._mapping = load_facet_mapping(self.settings.repo)
        return self._mapping

    def _outline(self, course_id: str) -> tuple[OutlineModel, dict, dict, dict]:
        binding = self.settings.course(course_id)
        inventory = build_inventory(binding)
        catalogs = self._catalogs(course_id)
        bank = self._bank(course_id, catalogs, inventory)
        decks = {l["lecture_id"]: (primary_deck(l) or {}).get("source_id") for l in inventory["lectures"]}
        return OutlineModel(catalogs, bank), bank, decks, catalogs

    def outline_view(self, course_id: str, *, scope: str = "course", parent: str | None = None, limit: int = 200) -> dict[str, Any]:
        """One level of the typed outline for a scope (R1-G1…G4). Raises ``ValueError`` for a scope that does not exist."""
        model, bank, decks, catalogs = self._outline(course_id)
        support = None
        parts = scope.split(":")
        if parts[0] == "slide" and len(parts) == 3 and parts[1] in bank["lectures"] and parts[2].isdigit():
            # What the page's logical slide supports comes from the same enriched lecture view the workspace shows (R2-C8).
            support = concept_graph.slide_support_from_lecture_view(self.lecture_view(course_id, parts[1]) or {}, int(parts[2]))
        resolved = concept_graph.resolve_scope(model, scope, decks.get, support)
        skills = {r["skill_id"]: r for r in self.gaps_view(course_id)["skills"]}
        reader = EvidenceReader(self._records(course_id), model)

        def decorate(node_id: str, kind: str | None) -> dict:
            extra = {"evidence": reader.compact(node_id), **concept_graph.node_support(resolved, node_id)}
            if kind == "skill":
                row = skills[node_id]
                return {"status": row["status"], "facet": row["facet"]["facet"] or row["facet"]["state"], "episodes": row["episodes"], **extra}
            if kind == "question":
                link = bank["questions"][node_id]
                return {"collection": link["collection"], "slide_anchor": link["slide_anchor"], "prompt_in_index": link["prompt_in_index"], **extra}
            if kind in {"topic", "concept"}:
                return {**concept_graph.node_counts(model, resolved, node_id), **extra}
            return extra

        page = model.rows(resolved, parent, limit=limit, decorate=decorate)
        public = concept_graph.public_scope(resolved)
        public["questions_in_scope"] = len(resolved["question_ids"]) if resolved["question_ids"] is not None else model.canonical_counts["question"]
        return {"course_id": course_id, "outline_version": OUTLINE_VERSION, "scope": public, "canonical_counts": model.canonical_counts, **page, "catalog_problems": catalogs["problems"],
                "note": "An outline of the course's own catalogs. One object can appear on several branches; it is counted once. Relations between questions are links, not branches, and grant no credit."}

    def outline_node(self, course_id: str, node_id: str) -> dict[str, Any] | None:
        """Sources, Questions and Evidence of one catalog object."""
        model, bank, _decks, catalogs = self._outline(course_id)
        kind = model.kind_of(node_id)
        if kind is None:
            return None
        gaps = self.gaps_view(course_id)
        skills = {r["skill_id"]: r for r in gaps["skills"]}
        index = (catalogs["questions"] or {}).get("questions", {})
        node: dict[str, Any] = {"node_id": node_id, "kind": kind, "label": model.label_of(node_id)}
        if kind == "criterion":
            node.update({k: model.criteria[node_id][k] for k in ("question_id", "skill_id", "concept_id", "action_types", "number")})
        elif kind == "skill":
            node.update(ability=model.skills[node_id].get("ability"), facet=skills[node_id]["facet"])
        elif kind == "question":
            node.update(collection=bank["questions"][node_id]["collection"], lecture_ids=bank["questions"][node_id]["lecture_ids"])
        question_ids = model.questions_of(node_id)
        sources: list[dict] = []
        for skill_id in model.skills_of(node_id):
            for ref in model.skills[skill_id].get("source_refs") or []:
                locator = ref.get("locator") if isinstance(ref.get("locator"), str) else ""
                sources.append({"source_id": ref.get("source_id"), "basis": "skill source reference", "from": skill_id, "locator_text": locator, "pages": sorted(_pages_in(locator))})
        for question_id in question_ids:
            for anchor in bank["questions"][question_id]["anchors"]:
                sources.append({"source_id": anchor.get("source_id"), "basis": f"question anchor ({anchor['basis']})", "from": question_id, "kind": anchor["kind"], "ranges": anchor["ranges"],
                                "lecture_id": anchor.get("lecture_id")})
        evidence_skills = [{"skill_id": s_, "label": skills[s_]["label"], "status": skills[s_]["status"], "facet": skills[s_]["facet"]["facet"] or skills[s_]["facet"]["state"],
                            "episodes": skills[s_]["episodes"], "observations_by_condition": skills[s_]["observations_by_condition"], "unaided_demonstrated": skills[s_]["unaided_demonstrated"]}
                           for s_ in model.skills_of(node_id) if s_ in skills]
        evidence: dict[str, Any] = {"unit": "skill", "rules": gaps["rules"], "skills": evidence_skills[:60], "skills_total": len(evidence_skills)}
        if kind == "criterion":
            evidence.update(criterion_observations=0, note="No attempt records an observation for this criterion itself. Evidence is recorded on its skill, shown here.")
        out = {"course_id": course_id, "outline_version": OUTLINE_VERSION, "node": node, "parents": model.parents(node_id), "sources": sources[:80], "sources_total": len(sources),
               "questions": [self._question_row(bank["questions"][q], index[q]) for q in question_ids[:50]], "questions_total": len(question_ids), "evidence": evidence,
               "links": model.links(node_id)}
        # R2: openable source pages, the evidence state of every observation, and the questions with their own evidence.
        inventory = build_inventory(self.settings.course(course_id))
        unit_of = {item["source_id"]: lecture["lecture_id"] for lecture in inventory["lectures"] for item in [*lecture["decks"], *lecture["extra_materials"]]}
        detail = concept_graph.node_detail(model, node_id, course_id=course_id, evidence=EvidenceReader(self._records(course_id), model),
                                           sources_of=concept_graph.catalog_sources(model, deck_source_id_of=_decks.get, lecture_of_source=unit_of.get))
        if detail is not None:
            r1_rows = {row["question_id"]: row for row in out["questions"]}
            out.update(sources=[{"kind": "pages", **row} for row in detail["sources"]], sources_total=detail["sources_total"],
                       questions=[{**r1_rows.get(row["question_id"], {}), **row} for row in detail["questions"]], questions_total=detail["questions_total"],
                       evidence={**out["evidence"], **detail["evidence"]}, definition=detail["definition"])
        return out

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
                recorded = condition_of(obs, attempt)
                episodes.setdefault(obs["skill_id"], []).append({
                    "condition": recorded["condition"], "condition_reasons": recorded["reasons"], "prior_exposure": recorded["prior_exposure"], "qualifying_unaided": recorded["qualifying_unaided"],
                    "attempt_id": attempt_id, "assessment_id": effective["assessment_id"], "revised": len(effective["chain"]) > 1, "conflict": effective["conflict"],
                    "outcome": obs["outcome"], "assistance": obs["assistance"], "reference_access": obs["reference_access"], "confidence": obs["assessment_confidence"],
                    "analysis": obs["analysis"], "missing_or_incorrect": obs["missing_or_incorrect"], "error_types": obs["error_types"], "recorded_at": attempt["recorded_at"],
                    "occurred_at": attempt["occurred_at"], "time_basis": attempt["time_basis"], "mode": attempt["mode"], "evidence_kind": attempt["evidence_kind"],
                    "question_prompt": attempt["question"]["prompt"], "question_id": attempt["question"].get("question_id")})
        rows = []
        mapping = self._facet_mapping()
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
            else:  # demonstrated: say under which recorded condition, never an undifferentiated "shown"
                status = {"unaided": "demonstrated_unaided", "assisted": "demonstrated_assisted", "prior_exposure": "demonstrated_after_exposure",
                          "conditions_unknown": "demonstrated_conditions_unknown"}[latest["condition"]]
            gap = None
            if status == "current_gap":
                gap = {"observed": {k: latest[k] for k in ("attempt_id", "assessment_id", "outcome", "missing_or_incorrect", "error_types", "analysis", "assistance", "reference_access", "recorded_at", "time_basis", "confidence")},
                       "cause_status": "hypothesis_only", "note": "The observation is what was seen in this response. Its cause is not established; a possible prerequisite is context, not proof."}
            rows.append({
                "skill_id": skill_id, "label": skill.get("performance_target") or skill_id, "ability": skill.get("ability"), "topic_ids": skill.get("topic_ids", []),
                "concept_id": skill.get("concept_id"), "status": status, "episodes": len(history), "latest": latest, "gap": gap,
                "counterevidence": [{k: e[k] for k in ("attempt_id", "outcome", "assistance", "recorded_at", "condition")} for e in observed[:-1] if latest and e["outcome"] != latest["outcome"]],
                "unaided_demonstrated": sum(1 for e in history if e["qualifying_unaided"]),
                "observations_by_condition": {c_: sum(1 for e in observed if e["condition"] == c_) for c_ in CONDITIONS},
                "facet": facet_of(skill, mapping),
                "study": {"priority": skill.get("priority"), "priority_reason": skill.get("priority_reason"), "need_basis": skill.get("need_basis"), "study_decision": skill.get("study_decision"),
                          "note": "Priority and study decision are planning choices, not competence measurements."},
                "history": history,
            })
        summary = Counter(r["status"] for r in rows)
        view_status = learning_view_status(self.settings.course(course_id).root)
        criteria = sum(len(q.get("criteria") or []) for q in ((catalogs["questions"] or {}).get("questions") or {}).values())
        with_criterion = sum(1 for a in records["attempts"].values() if a.get("criterion_observations") or any(o.get("criterion_id") for o in records["effective"][a["attempt_id"]]["observations"]))
        return {"course_id": course_id, "skills": rows, "summary": {"skills": len(rows), **summary}, "recorded_attempts": len(records["attempts"]),
                "facets": facet_summary(rows, mapping), "rules": {"evidence_conditions": CONDITIONS_VERSION, "facet_mapping": mapping["mapping_version"]},
                "criterion_evidence": {"criteria_in_catalog": criteria, "attempts_with_criterion_observations": with_criterion,
                                       "note": ("The catalog lists criteria; the recorded attempts carry observations per skill only. A listed criterion is not an assessed criterion."
                                                if not with_criterion else "Some attempts carry observations per criterion; the rest are recorded per skill only.")},
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
                available.append({"question_id": question["question_id"], "title": question.get("title"), "prompt": question["prompt"], "prompt_in_index": question["prompt_in_index"],
                                  "origin": question.get("origin"), "collection": question.get("collection"),
                                  "family_id": question.get("family_id"), "family_revision": question.get("family_revision"), "source_refs": question.get("source_refs", [])})
        return {"course_id": course_id, "items": rows, "due_count": sum(1 for r in rows if r["is_due"]), "available_questions": available, "available_total": len(available),
                "default_session_size": int(self.settings.policy["review_default_max_items"]), "scheduler_config": self.reviews.scheduler_config(course_id),
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
                        entries.append({"type": "slide", "title": f"{lecture['title']} — PDF page {page}", "text": text[:1500], "ref": {"lecture_id": lecture["lecture_id"], "page": page}})
            other_dir = self.preparation.prepared_dir(course_id, lecture["lecture_id"]) / "other"
            for item in [*lecture["decks"], *lecture["extra_materials"]] if other_dir.is_dir() else []:
                if item["disclosure"] == "restricted_solution":
                    continue
                try:
                    stored = c.parse_json((other_dir / f"{item['source_id']}.json").read_bytes())
                except (OSError, c.ContractError):
                    continue
                if stored.get("sha256") != self.preparation.identity_of(course_id, item)[1]:
                    unindexed.append({"what": item["filename"], "reason": "the file changed since its text was prepared"})
                    continue
                for page, text in enumerate(stored.get("pages") or [], start=1):
                    if text:
                        entries.append({"type": "source", "title": f"{item['filename']} — page {page}", "text": text[:1500], "ref": {"source_id": item["source_id"], "page": page}})
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
        # Sessions the course index links to no lecture: searchable as the source itself, never attached to a guessed lecture.
        for session in inventory["unlinked_sessions"]:
            for item in session["items"]:
                if item["kind"] != "lecture_transcript" or not item["path"] or item["rendition"] != "native_text" or item["disclosure"] == "restricted_solution":
                    continue
                try:
                    lines = (binding.root / item["path"]).read_text(encoding="utf-8-sig", errors="replace").splitlines()[:MAX_TRANSCRIPT_LINES]
                except OSError:
                    continue
                for number, line in enumerate(lines, start=1):
                    if line.strip():
                        entries.append({"type": "source", "title": f"Session {session['date']} transcript — line {number}", "text": line[:500],
                                        "ref": {"source_id": item["source_id"], "line": number}})
        catalogs = self._catalogs(course_id)
        index = catalogs["questions"] or {"questions": {}, "concepts": {}}
        for question in index["questions"].values():
            entries.append({"type": "question", "title": question.get("title") or question["question_id"], "text": f"{question['question_id']} {question['prompt']}"[:1500],
                            "prompt_in_index": question["prompt_in_index"], "ref": {"question_id": question["question_id"]}})
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
