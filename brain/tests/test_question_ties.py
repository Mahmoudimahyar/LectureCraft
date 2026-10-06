"""R2-Q2 … R2-Q8, R2-Q10: questions tied to the pages and logical slides of a lecture (pure enrichment of a lecture view).

A small synthetic lecture is built by hand: a twelve-page deck with two build groups, a catalog whose questions show
every kind of tie, and a suggestions file read through the real reader. Nothing here comes from a course.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from lecture_brain import inferred_anchors as ia
from lecture_brain import question_ties as qt
from lecture_brain.config import CourseBinding, Settings
from lecture_brain.ownerio.question_links import build_question_bank

COURSE = "syn202"
INDEX_SHA = "2" * 64
DECK_SHA, ALT_SHA, L2_SHA = "a" * 64, "b" * 64, "c" * 64
RUBRIC_MARKER = "SYNTHETIC-RUBRIC-MARKER"
GUIDANCE_MARKER = "SYNTHETIC-GUIDANCE-MARKER"
NOW = "2026-10-05T12:00:00Z"
UNKNOWN = {"state": "unknown", "assistance": None, "prior_exposure": "unknown", "attempts": 0, "last_at": None}
CONCEPTS = ("alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "filler")


# ---- the synthetic lecture -----------------------------------------------------------------------------------
def source(source_id: str, kind: str = "lecture_slides") -> dict:
    return {"source_id": source_id, "kind": kind, "path": f"materials/{source_id}.pdf", "state": "registered_readable", "rendition": "native_pdf", "filename": f"{source_id}.pdf",
            "version_id": "v1", "sha256": None, "disclosure": "open", "registration": "registered"}


def make_inventory() -> dict:
    session = {"session_id": "s1", "items": [dict(source("src-l01-transcript", "lecture_transcript"), rendition="native_text")]}
    return {"lectures": [
        {"lecture_id": "lecture-01", "title": "Synthetic lecture 1", "decks": [source("src-l01-slides"), source("src-l01-alt")], "extra_materials": [], "deck_choice": {"source_id": "src-l01-slides"}, "sessions": [session]},
        {"lecture_id": "lecture-02", "title": "Synthetic lecture 2", "decks": [source("src-l02-slides")], "extra_materials": [], "deck_choice": {"source_id": "src-l02-slides"}, "sessions": []},
    ], "sessions": [session], "other_sources": [source("src-ps-01", "problem_set")]}


def question(question_id: str, collection: str, number: int, concepts: list[str], locator: str, source_id: str = "src-l01-slides", version: int = 1) -> dict:
    return {"question_id": question_id, "version": version, "collection": collection, "number": number, "title": f"Synthetic {question_id}", "prompt": f"Synthetic prompt of {question_id}.",
            "prompt_in_index": True, "origin": "generated_practice", "topic": "t.topic", "family_id": None, "family_revision": None, "page": None,
            "criteria": [{"criterion_id": f"{question_id}.C{n:02d}", "tag": "core", "action": "explain", "observable": f"{RUBRIC_MARKER} states the expected point number {n} of {question_id} in full.",
                          "concept_id": f"t.concept.{concept}", "skill_id": f"t.skill.{concept}", "action_types": ["explain"]} for n, concept in enumerate(concepts, start=1)],
            "source_refs": [{"source_id": source_id, "locator": locator}]}


COARSE = "lecture scientific content; exact mapping in companion source map"


def make_index(fillers: int = 0) -> dict:
    rows = [
        question("T-L01-Q01", "L01", 1, ["alpha"], "Slides 5, 9-11; transcript 2-4"),   # one page AND a page range AND transcript lines
        question("T-L01-Q02", "L01X", 1, ["beta"], "Slides 3"),                           # a collection whose page basis is not reviewed
        question("T-L01-Q03", "L01", 3, ["beta"], "Slides 2-4, 8"),                       # a whole build group, and one page outside it
        question("T-L01-Q04", "L01", 4, ["alpha", "beta", "gamma"], COARSE),              # coarse: suggested on the last build only
        question("T-L01-Q05", "L01", 5, ["delta"], COARSE),                               # every candidate rejected by the verifying pass
        question("T-L01-Q06", "L01", 6, ["delta"], COARSE),                               # no item at all
        question("T-L01-Q07", "L01", 7, ["delta"], COARSE),                               # examined, no page found
        question("T-L01-Q08", "L01", 8, ["delta"], COARSE),                               # an item made for other deck bytes
        question("T-L01-Q09", "L01", 9, ["epsilon"], "Slides 6"),                         # a course anchor AND a suggestion on the same slide
        question("T-L01-Q10", "L01", 10, ["delta"], "Transcript 50-60"),                  # anchored to lines only
        question("T-L01-Q11", "L01", 11, ["delta"], COARSE),                              # suggested on another deck of the unit
        question("T-L01-Q12", "L01", 12, ["delta"], COARSE),                              # suggestion rejected by the learner
        question("T-L01-Q13", "L01", 13, ["zeta"], COARSE),                               # suggestion confirmed by the learner; lists every criterion
        question("T-L01-Q14", "L01", 14, ["eta"], "Slides 1"),                            # anchored on a title page
        question("T-PS01-Q01", "PS01", 1, ["theta"], "page 1, Question 1", "src-ps-01"),  # a problem-set question: no lecture membership
        question("T-PS01-Q02", "PS01", 2, ["alpha"], "page 2", "src-ps-01"),
        question("T-L02-Q01", "L02", 1, ["alpha", "beta"], "Slides 1", "src-l02-slides"),
    ]
    rows += [question(f"T-PS02-Q{n:02d}", "PS02", n, ["filler"], "page 1", "src-ps-01") for n in range(1, fillers + 1)]
    return {"sha256": INDEX_SHA, "revision": 1, "questions": {q["question_id"]: q for q in rows},
            "concepts": {f"t.concept.{name}": {"concept_id": f"t.concept.{name}", "label": name.capitalize()} for name in CONCEPTS}, "relationships": []}


SOURCE_MAP = {"state": "ready", "reason": None, "contract": "source-map/1", "map_revision": "0123456789abcdef", "page_count": 12,
              "logical_slides": [{"id": "ls-syn-p1", "kind": "single", "pages": [1]}, {"id": "ls-syn-p2-4", "kind": "build_group", "pages": [2, 3, 4]}, {"id": "ls-syn-p5", "kind": "single", "pages": [5]},
                                 {"id": "ls-syn-p6-7", "kind": "build_group", "pages": [6, 7]}, *({"id": f"ls-syn-p{p}", "kind": "single", "pages": [p]} for p in range(8, 13))]}


def suggestion(question_id: str, pages: list[int], criteria: list[int], **more) -> dict:
    base = {"question_id": question_id, "question_version": 1, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "source_sha256": DECK_SHA, "pages": pages, "regions": None,
            "criteria": [f"{question_id}.C{n:02d}" for n in criteria], "coverage": "partial", "rationale": f"Synthetic rationale: the named pages show what the listed criteria of {question_id} ask about.",
            "state": "agent_inferred", "verifier": None}
    base.update(more)
    return base


def make_suggestions() -> dict:
    return {"contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": NOW, "producer": "claude-session", "question_index_sha256": INDEX_SHA, "items": [
        suggestion("T-L01-Q04", [4], [1, 2]),
        suggestion("T-L01-Q05", [9], [1], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Synthetic note: the page shares words only."}),
        suggestion("T-L01-Q08", [5], [1], source_sha256="d" * 64),
        suggestion("T-L01-Q09", [6, 7], [1], coverage="main", state="agent_reviewed", verifier={"verdict": "upheld", "note": "Synthetic note: both builds checked."}),
        suggestion("T-L01-Q11", [2], [1], source_id="src-l01-alt", source_sha256=ALT_SHA),
        suggestion("T-L01-Q12", [12], [1]),
        suggestion("T-L01-Q13", [12], [1], coverage="main"),
        suggestion("T-PS01-Q01", [10], [1]),
    ], "no_candidate": [{"question_id": "T-L01-Q07", "question_version": 1, "why": "Synthetic reason: the material was spoken and is on no page.", "verifier": {"confirmed": True, "note": None}}]}


class Lecture:
    """Everything the lead's wiring hands to ``enrich``, built for the synthetic course."""

    def __init__(self, tmp_path: Path, *, suggestions: dict | None | bool = True, fillers: int = 0, decide: bool = True, strict: bool = True):
        root = tmp_path / "course"
        root.mkdir(parents=True, exist_ok=True)
        self.settings = Settings(profile="local", repo=tmp_path, state_dir=tmp_path / "state", planner_root=tmp_path / "planner", planner_config=tmp_path / "planner" / "planner-config.yaml",
                                 courses={COURSE: CourseBinding(COURSE, "2026-fall", root, "Synthetic 202", f"tutor-{COURSE}")}, policy={})
        self.index = make_index(fillers)
        self.inventory = make_inventory()
        self.bank = build_question_bank(self.index, self.inventory, reviewed_collections=("L01",))
        self.context = {"index": self.index, "inventory": self.inventory, "deck_sha256_of": lambda item: {"src-l01-slides": DECK_SHA, "src-l01-alt": ALT_SHA, "src-l02-slides": L2_SHA}.get(item["source_id"]),
                        "guidance_text_of": lambda question_id: f"{GUIDANCE_MARKER} the expected answer text kept by the assessor for {question_id}.", "page_count_of": lambda item: 12}
        if suggestions is True:
            suggestions = make_suggestions()
        if suggestions:
            ia.store(self.settings, COURSE, suggestions, strict=strict, **self.context)
        self.inferred = ia.load(self.settings, COURSE, **self.context)
        if suggestions and decide:
            for item in self.inferred["items"]:
                if item["question_id"] in {"T-L01-Q12", "T-L01-Q13"}:
                    ia.decide(self.settings, COURSE, item["suggestion_id"], "rejected" if item["question_id"] == "T-L01-Q12" else "confirmed", at=NOW, suggestion=item)
        self.decisions = ia.decisions(self.settings, COURSE)

    def view(self, lecture_id: str = "lecture-01", deck: str | None = "src-l01-slides", pages: int = 12) -> dict:
        """The part of ``Projector.lecture_view`` this enrichment reads: deck identity, one slide per page with the page's
        concepts as the projection lists them, and the lecture's catalogued questions."""
        concepts: dict[int, dict[str, dict]] = {}
        for link in self.bank["questions"].values():
            for anchor in link["anchors"]:
                if anchor["kind"] == "pages" and anchor.get("source_id") == deck:
                    for page in anchor["pages"]:
                        for criterion in self.index["questions"][link["question_id"]]["criteria"]:
                            concept = self.index["concepts"][criterion["concept_id"]]
                            concepts.setdefault(page, {})[concept["concept_id"]] = {"concept_id": concept["concept_id"], "label": concept["label"], "basis": "question source reference"}
        slides = [{"page": p, "title": f"Synthetic page {p}", "text": None, "concepts": sorted(concepts.get(p, {}).values(), key=lambda x: x["label"]), "questions": []} for p in range(1, pages + 1)]
        slides[0]["role"] = {"value": "structural_title_or_section", "state": "generated", "uncertain": False, "forced_requirements": False, "basis": ["synthetic"]}
        own = self.bank["lectures"][lecture_id]["question_ids"]
        rows = [dict(self.bank["questions"][q], prompt=self.index["questions"][q]["prompt"]) for q in own]
        return {"course_id": COURSE, "lecture_id": lecture_id, "deck": {"source_id": deck, "version_id": "v1", "sha256": DECK_SHA} if deck else None, "page_count": pages if deck else None,
                "slides": slides if deck else [], "questions": {"all": rows, "related_by_relationship": [], "gap": None}}

    def enriched(self, *, source_map: dict | None = SOURCE_MAP, **more) -> dict:
        kwargs = {"bank": self.bank, "index": self.index, "source_map": source_map, "inferred": self.inferred, "decisions": self.decisions}
        kwargs.update(more)
        return qt.enrich(self.view(), **kwargs)


@pytest.fixture()
def lecture(tmp_path) -> Lecture:
    return Lecture(tmp_path)


def ties(view: dict, page: int) -> list[tuple]:
    return [(t["question_id"], t["tie"], t["where"], t["support_pages"], t["other_pages"]) for t in view["slides"][page - 1]["question_ties"]]


def row(view: dict, question_id: str) -> dict:
    return next(q for q in view["questions"]["all"] if q["question_id"] == question_id)


# ---- the course's own anchors (R2-Q2) --------------------------------------------------------------------------
def test_a_locator_naming_one_page_a_range_and_transcript_lines_ties_every_page_and_keeps_lines_as_lines(lecture):
    view = lecture.enriched()
    on = {s["page"] for s in view["slides"] if any(t["question_id"] == "T-L01-Q01" for t in s["question_ties"])}
    assert on == {5, 9, 10, 11}  # every listed page, the page between the single one and the range is not invented, and lines 2-4 are not pages 2-4
    for page in sorted(on):
        tie = next(t for t in view["slides"][page - 1]["question_ties"] if t["question_id"] == "T-L01-Q01")
        assert (tie["tie"], tie["where"], tie["support_pages"]) == ("exact", "on_this_page", [page])
        assert tie["other_pages"] == sorted(on - {page}) and tie["transcript_lines"] == [[2, 4]]
        assert (tie["criteria_supported"], tie["criteria_total"], tie["coverage"], tie["state"], tie["verdict"], tie["rationale"], tie["suggestion_id"], tie["learner_decision"]) == (None,) * 8
        assert (tie["collection"], tie["number"], tie["title"], tie["prompt"], tie["prompt_in_index"]) == ("L01", 1, "Synthetic T-L01-Q01", "Synthetic prompt of T-L01-Q01.", True)
    (whole,) = row(view, "T-L01-Q01")["ties"]
    assert whole == {"tie": "exact", "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [5, 9, 10, 11], "logical_slide_ids": ["ls-syn-p5", "ls-syn-p9", "ls-syn-p10", "ls-syn-p11"],
                     "transcript_lines": [[2, 4]], "criteria_supported": None, "criteria_total": None, "criteria": None, "coverage": None, "state": None, "verdict": None, "verdict_note": None,
                     "rationale": None, "regions": None, "suggestion_id": None, "learner_decision": None, "on_displayed_deck": True,
                     "granularity": "page", "from": "course_locator", "catalog_field": "locator", "section": None}
    assert row(view, "T-L01-Q01")["no_link"] is None


def test_a_question_anchored_to_transcript_lines_only_has_a_course_anchor_and_is_on_no_slide(lecture):
    view = lecture.enriched()
    assert not [s["page"] for s in view["slides"] if any(t["question_id"] == "T-L01-Q10" for t in s["question_ties"])]
    (lines,) = row(view, "T-L01-Q10")["ties"]
    assert (lines["tie"], lines["pages"], lines["logical_slide_ids"], lines["transcript_lines"], lines["on_displayed_deck"]) == ("exact", [], [], [[50, 60]], False)
    assert lines["source_id"] == "src-l01-transcript" and row(view, "T-L01-Q10")["no_link"] is None


# ---- where, inside a build group (R2-Q6, R2-S3) ------------------------------------------------------------------
def test_each_row_in_a_build_group_says_this_page_elsewhere_in_the_sequence_or_group_level(lecture):
    view = lecture.enriched()
    assert ties(view, 2) == [("T-L01-Q03", "exact", "group_level", [2, 3, 4], [8]), ("T-L01-Q02", "stated", "elsewhere_in_sequence", [3], []), ("T-L01-Q04", "agent_inferred", "elsewhere_in_sequence", [4], [])]
    assert ties(view, 3) == [("T-L01-Q03", "exact", "group_level", [2, 3, 4], [8]), ("T-L01-Q02", "stated", "on_this_page", [3], []), ("T-L01-Q04", "agent_inferred", "elsewhere_in_sequence", [4], [])]
    assert ties(view, 4) == [("T-L01-Q03", "exact", "group_level", [2, 3, 4], [8]), ("T-L01-Q02", "stated", "elsewhere_in_sequence", [3], []), ("T-L01-Q04", "agent_inferred", "on_this_page", [4], [])]
    assert ties(view, 8) == [("T-L01-Q03", "exact", "on_this_page", [8], [2, 3, 4])]  # outside the group the same tie is an ordinary page tie
    assert row(view, "T-L01-Q03")["ties"][0]["logical_slide_ids"] == ["ls-syn-p2-4", "ls-syn-p8"]


def test_support_first_shown_on_a_later_build_is_never_presented_as_on_an_earlier_one(lecture):
    view = lecture.enriched()
    for page in (2, 3):
        late = next(t for t in view["slides"][page - 1]["question_ties"] if t["question_id"] == "T-L01-Q04")
        assert late["where"] == "elsewhere_in_sequence" and late["support_pages"] == [4] and page not in late["support_pages"]
        assert "this page" not in late["why"].replace("not this page", "") and "page 4" in late["why"]
    assert all(t["where"] != "on_this_page" or s["page"] in t["support_pages"] for s in view["slides"] for t in s["question_ties"])
    assert all(t["where"] != "group_level" or len(t["support_pages"]) >= 2 for s in view["slides"] for t in s["question_ties"])


@pytest.mark.parametrize("page, members, named, expected", [
    (3, [3], [3], ("on_this_page", [3])),                          # an ordinary page
    (3, [3], [3, 9], ("on_this_page", [3])),                       # other pages of the tie are outside the logical slide
    (2, [2, 3, 4], [2, 3], ("on_this_page", [2, 3])),              # part of a group, this page among them
    (4, [2, 3, 4], [2, 3], ("elsewhere_in_sequence", [2, 3])),     # the last build is not named: support stays on the earlier ones
    (2, [2, 3, 4], [4], ("elsewhere_in_sequence", [4])),           # only the last build is named: never "on this page" for an earlier one
    (2, [2, 3, 4], [4, 3, 2, 8], ("group_level", [2, 3, 4])),      # every member named, in any order
    (6, [6, 7], [6, 7], ("group_level", [6, 7])),                  # a group of two is a group
])
def test_where_a_tie_sits_relative_to_the_selected_page(page, members, named, expected):
    assert qt.where_of(page, members, named) == expected


def test_enriching_changes_the_view_only(lecture):
    view = lecture.view()
    before = copy.deepcopy((lecture.bank, lecture.index, lecture.inferred, lecture.decisions, SOURCE_MAP))
    kept = {key: copy.deepcopy(value) for key, value in view.items() if key not in {"slides", "questions"}}
    old_slides = copy.deepcopy(view["slides"])
    assert qt.enrich(view, bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=lecture.inferred, decisions=lecture.decisions) is view
    assert (lecture.bank, lecture.index, lecture.inferred, lecture.decisions, SOURCE_MAP) == before
    assert {key: value for key, value in view.items() if key not in {"slides", "questions"}} == kept
    added = {"question_ties", "section_ties", "related_questions", "related_questions_total"}
    assert [{k: v for k, v in s.items() if k not in added} for s in view["slides"]] == old_slides and all(added <= set(s) for s in view["slides"])  # what was there before stays as it was
    assert json.loads(json.dumps(view)) == view  # plain data, ready to be sent


def test_without_a_source_map_every_page_is_its_own_logical_slide(lecture):
    for nothing in (None, {"state": "unavailable", "reason": "not_built"}):
        view = lecture.enriched(source_map=nothing)
        assert ties(view, 2) == [("T-L01-Q03", "exact", "on_this_page", [2], [3, 4, 8])]
        assert ties(view, 3) == [("T-L01-Q03", "exact", "on_this_page", [3], [2, 4, 8]), ("T-L01-Q02", "stated", "on_this_page", [3], [])]
        assert ties(view, 4) == [("T-L01-Q03", "exact", "on_this_page", [4], [2, 3, 8]), ("T-L01-Q04", "agent_inferred", "on_this_page", [4], [])]
        assert row(view, "T-L01-Q03")["ties"][0]["logical_slide_ids"] == []  # no id exists, so none is made up


# ---- kinds stay kinds (R2-Q5) -------------------------------------------------------------------------------------
def test_a_course_anchor_and_a_suggestion_for_the_same_question_on_one_slide_are_both_listed_course_anchor_first(lecture):
    view = lecture.enriched()
    assert ties(view, 6) == [("T-L01-Q09", "exact", "on_this_page", [6], []), ("T-L01-Q09", "agent_inferred", "group_level", [6, 7], [])]
    assert ties(view, 7) == [("T-L01-Q09", "exact", "elsewhere_in_sequence", [6], []), ("T-L01-Q09", "agent_inferred", "group_level", [6, 7], [])]
    assert [(t["tie"], t["pages"]) for t in row(view, "T-L01-Q09")["ties"]] == [("exact", [6]), ("agent_inferred", [6, 7])]
    suggested = view["slides"][5]["question_ties"][1]
    assert (suggested["state"], suggested["verdict"], suggested["coverage"], suggested["learner_decision"]) == ("agent_reviewed", "upheld", "main", None)


def test_the_four_kinds_are_distinct_values_and_no_rebuild_turns_one_into_another(lecture, tmp_path):
    view = lecture.enriched()
    kinds: dict[str, set[str]] = {}
    for slide in view["slides"]:
        for tie in slide["question_ties"]:
            kinds.setdefault(tie["question_id"], set()).add(tie["tie"])
        assert {r["tie"] for r in slide["related_questions"]} <= {"concept_related"}
        assert not {r["question_id"] for r in slide["related_questions"]} & {t["question_id"] for t in slide["question_ties"]}  # tied here, so not merely related here
    assert kinds == {"T-L01-Q01": {"exact"}, "T-L01-Q02": {"stated"}, "T-L01-Q03": {"exact"}, "T-L01-Q04": {"agent_inferred"}, "T-L01-Q09": {"exact", "agent_inferred"},
                     "T-L01-Q13": {"agent_inferred"}, "T-L01-Q14": {"exact"}, "T-PS01-Q01": {"agent_inferred"}}
    assert {t["tie"] for q in view["questions"]["all"] for t in q["ties"]} == {"exact", "stated", "agent_inferred"}
    # building again, enriching an already enriched view, and regenerating the suggestions file all give the same kinds
    assert lecture.enriched() == view
    again = qt.enrich(copy.deepcopy(view), bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=lecture.inferred, decisions=lecture.decisions)
    assert again == view
    regenerated = make_suggestions()
    regenerated["produced_at"] = "2026-10-06T09:00:00Z"
    for item in regenerated["items"]:
        if item["state"] == "agent_inferred":
            item.update(state="agent_reviewed", verifier={"verdict": "upheld", "note": "Synthetic note: checked."})
    ia.store(lecture.settings, COURSE, regenerated, **lecture.context)
    rebuilt = qt.enrich(lecture.view(), bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=ia.load(lecture.settings, COURSE, **lecture.context),
                        decisions=ia.decisions(lecture.settings, COURSE))
    assert [(t["question_id"], t["tie"]) for s in rebuilt["slides"] for t in s["question_ties"]] == [(t["question_id"], t["tie"]) for s in view["slides"] for t in s["question_ties"]]
    checked = next(t for t in rebuilt["slides"][3]["question_ties"] if t["question_id"] == "T-L01-Q04")
    assert (checked["tie"], checked["state"], checked["verdict"]) == ("agent_inferred", "agent_reviewed", "upheld")  # checked by a second pass is still agent work


def test_a_suggestion_the_learner_confirmed_stays_a_suggestion_with_the_learners_decision_beside_it(lecture):
    view = lecture.enriched()
    (confirmed,) = view["slides"][11]["question_ties"]
    assert (confirmed["question_id"], confirmed["tie"], confirmed["state"], confirmed["verdict"], confirmed["learner_decision"]) == ("T-L01-Q13", "agent_inferred", "agent_inferred", None, "confirmed")
    assert [(t["tie"], t["learner_decision"]) for t in row(view, "T-L01-Q13")["ties"]] == [("agent_inferred", "confirmed")]
    # the decision survives a regenerated file that proposes the same pages again with other words
    regenerated = make_suggestions()
    next(i for i in regenerated["items"] if i["question_id"] == "T-L01-Q13")["rationale"] = "Synthetic rationale, second pass: page 12 shows what criterion C01 asks about."
    ia.store(lecture.settings, COURSE, regenerated, **lecture.context)
    rebuilt = qt.enrich(lecture.view(), bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=ia.load(lecture.settings, COURSE, **lecture.context),
                        decisions=ia.decisions(lecture.settings, COURSE))
    assert [(t["question_id"], t["tie"], t["learner_decision"]) for t in rebuilt["slides"][11]["question_ties"]] == [("T-L01-Q13", "agent_inferred", "confirmed")]


def test_items_rejected_by_the_verifier_or_by_the_learner_are_never_ties(lecture):
    view = lecture.enriched()
    everywhere = [t for s in view["slides"] for t in s["question_ties"]] + [t for q in view["questions"]["all"] for t in q["ties"]]
    assert not [t for t in everywhere if t.get("verdict") == "rejected" or t.get("learner_decision") == "rejected"]
    assert "T-L01-Q05" not in [t["question_id"] for t in view["slides"][8]["question_ties"]]   # the verifier rejected page 9
    assert "T-L01-Q12" not in [t["question_id"] for t in view["slides"][11]["question_ties"]]  # the learner rejected page 12
    assert row(view, "T-L01-Q05")["ties"] == [] and row(view, "T-L01-Q12")["ties"] == []
    rejected = row(view, "T-L01-Q12")
    assert rejected["no_link"] == {"state": "no_suggestion", "reason": "rejected_by_learner"}
    (kept,) = rejected["suggestion_history"]["rejected_by_learner"]  # still in the history, so the learner can take the rejection back
    assert kept == {"suggestion_id": ia.suggestion_id("T-L01-Q12", 1, DECK_SHA, [12]), "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [12], "learner_decision": "rejected"}
    # taking it back makes it an ordinary suggestion again
    ia.decide(lecture.settings, COURSE, kept["suggestion_id"], "cleared", at="2026-10-05T13:00:00Z")
    cleared = lecture.enriched(decisions=ia.decisions(lecture.settings, COURSE))
    assert [(t["question_id"], t["learner_decision"]) for t in cleared["slides"][11]["question_ties"]] == [("T-L01-Q12", None), ("T-L01-Q13", "confirmed")]
    assert row(cleared, "T-L01-Q12")["no_link"] is None


# ---- criteria, never wording (R2-Q4, R2-Q10) ---------------------------------------------------------------------
def test_a_suggested_link_counts_the_criteria_it_supports_and_never_words_the_whole_answer(lecture):
    view = lecture.enriched()
    part = next(t for t in view["slides"][3]["question_ties"] if t["question_id"] == "T-L01-Q04")
    assert (part["criteria_supported"], part["criteria_total"], part["coverage"]) == (2, 3, "partial")
    assert part["criteria"] == [
        {"criterion_id": "T-L01-Q04.C01", "number": 1, "label": "Criterion 1 of 3", "concept_id": "t.concept.alpha", "concept_label": "Alpha", "skill_id": "t.skill.alpha", "action_types": ["explain"],
         "pages": None},
        {"criterion_id": "T-L01-Q04.C02", "number": 2, "label": "Criterion 2 of 3", "concept_id": "t.concept.beta", "concept_label": "Beta", "skill_id": "t.skill.beta", "action_types": ["explain"],
         "pages": None}]
    assert part["criteria_supported_here"] is None  # the producer made no page-by-page statement for this item, so none is made here
    assert part["rationale"].startswith("Synthetic rationale") and part["suggestion_id"] == ia.suggestion_id("T-L01-Q04", 1, DECK_SHA, [4])
    every = view["slides"][11]["question_ties"][0]  # lists the question's only criterion, on its principal page
    assert (every["criteria_supported"], every["criteria_total"], every["coverage"]) == (1, 1, "main")
    for tie in (part, every):
        assert not [w for w in ("whole", "entire", "complete", "answers", "teaches", "all of") if w in tie["why"].lower()], tie["why"]
    assert "not yet checked" in part["why"] and "confirmed" in every["why"]
    assert "checked by a second" in view["slides"][5]["question_ties"][1]["why"] and "confirmed" not in view["slides"][5]["question_ties"][1]["why"]


def test_no_criterion_wording_guidance_or_expected_answer_is_anywhere_in_the_output(lecture):
    text = json.dumps(lecture.enriched(), ensure_ascii=False)
    assert RUBRIC_MARKER not in text and GUIDANCE_MARKER not in text and '"observable"' not in text and '"answer"' not in text
    assert "expected point" not in text and "expected answer" not in text
    assert "T-L01-Q04.C01" in text  # criteria are named by identity


# ---- other decks, other bytes, other lectures (R2-Q7, R2-S11) --------------------------------------------------------
def test_a_suggestion_for_another_deck_or_for_other_deck_bytes_is_not_a_tie_on_this_deck(lecture):
    view = lecture.enriched()
    assert not [s["page"] for s in view["slides"] for t in s["question_ties"] if t["question_id"] in {"T-L01-Q11", "T-L01-Q08"}]
    (elsewhere,) = row(view, "T-L01-Q11")["ties"]
    assert (elsewhere["tie"], elsewhere["source_id"], elsewhere["pages"], elsewhere["logical_slide_ids"], elsewhere["on_displayed_deck"]) == ("agent_inferred", "src-l01-alt", [2], [], False)
    assert row(view, "T-L01-Q11")["no_link"] is None  # it has a suggested link; it just is not on the deck being shown
    stale = row(view, "T-L01-Q08")
    assert stale["ties"] == [] and stale["no_link"] == {"state": "no_suggestion", "reason": "stale"} and stale["suggestion_history"]["stale"] == 1
    # shown with the other deck of the unit, the same suggestion is a tie there and the first deck's suggestions are not
    other = lecture.view(deck="src-l01-alt", pages=6)
    other["deck"]["sha256"] = ALT_SHA
    qt.enrich(other, bank=lecture.bank, index=lecture.index, source_map=None, inferred=lecture.inferred, decisions=lecture.decisions)
    assert [(s["page"], t["question_id"], t["tie"]) for s in other["slides"] for t in s["question_ties"]] == [(2, "T-L01-Q11", "agent_inferred")]
    assert row(other, "T-L01-Q11")["ties"][0]["on_displayed_deck"] is True and row(other, "T-L01-Q04")["ties"][0]["on_displayed_deck"] is False
    assert row(other, "T-L01-Q01")["ties"][0]["on_displayed_deck"] is False  # the course's own page anchor names the other file


def test_whether_a_suggestion_is_current_is_the_readers_verdict_and_the_view_only_matches_the_deck(lecture):
    """The reader compares a suggestion with the bytes on disk. The identity a view prints for its deck may be the one
    the course index declares, so it is not used for a second, different verdict here."""
    view = lecture.view()
    view["deck"]["sha256"] = "e" * 64
    qt.enrich(view, bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=lecture.inferred, decisions=lecture.decisions)
    assert [(t["question_id"], t["tie"]) for t in view["slides"][3]["question_ties"] if t["tie"] == "agent_inferred"] == [("T-L01-Q04", "agent_inferred")]
    # once the reader finds other bytes on disk, nothing of that deck is a suggested tie any more
    moved = ia.load(lecture.settings, COURSE, **dict(lecture.context, deck_sha256_of=lambda item: "e" * 64))
    after = qt.enrich(lecture.view(), bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=moved, decisions=lecture.decisions)
    assert not [t for s in after["slides"] for t in s["question_ties"] if t["tie"] == "agent_inferred"]
    assert row(after, "T-L01-Q04")["no_link"] == {"state": "no_suggestion", "reason": "stale"} and row(after, "T-L01-Q04")["suggestion_history"]["stale"] == 1
    assert [t["tie"] for t in after["slides"][4]["question_ties"]] == ["exact"]  # the course's own anchors are untouched


def test_a_problem_set_question_without_lecture_membership_can_carry_a_suggested_link_on_a_lecture_deck(lecture):
    view = lecture.enriched()
    assert lecture.bank["questions"]["T-PS01-Q01"]["lecture_ids"] == []
    assert ties(view, 10) == [("T-L01-Q01", "exact", "on_this_page", [10], [5, 9, 11]), ("T-PS01-Q01", "agent_inferred", "on_this_page", [10], [])]
    suggested = view["slides"][9]["question_ties"][1]
    assert (suggested["collection"], suggested["number"], suggested["criteria_supported"], suggested["criteria_total"]) == ("PS01", 1, 1, 1)
    assert "T-PS01-Q01" not in [q["question_id"] for q in view["questions"]["all"]]  # All lecture questions stays the lecture's catalogued set
    assert view["questions"]["counts"]["all"] == len(lecture.bank["lectures"]["lecture-01"]["question_ids"]) == 14


# ---- a question without a link says which of two things is true (R2-Q3, D77) -----------------------------------------
def test_no_link_is_inspected_no_support_or_no_suggestion_with_its_recorded_reason(lecture, tmp_path):
    view = lecture.enriched()
    assert row(view, "T-L01-Q05")["no_link"] == {"state": "inspected_no_support", "reason": "Synthetic note: the page shares words only."}   # every candidate rejected by the checking pass
    assert row(view, "T-L01-Q07")["no_link"] == {"state": "inspected_no_support", "reason": "Synthetic reason: the material was spoken and is on no page."}  # examined, no page found (D77)
    assert row(view, "T-L01-Q06")["no_link"] == {"state": "no_suggestion", "reason": "no_item"}
    assert row(view, "T-L01-Q08")["no_link"] == {"state": "no_suggestion", "reason": "stale"}
    assert [q["question_id"] for q in view["questions"]["all"] if q["no_link"] is None] == ["T-L01-Q01", "T-L01-Q03", "T-L01-Q04", "T-L01-Q09", "T-L01-Q10", "T-L01-Q11", "T-L01-Q13", "T-L01-Q14", "T-L01-Q02"]
    assert row(view, "T-L01-Q05")["suggestion_history"] == {"stale": 0, "rejected_by_verifier": 1, "rejected_by_learner": [], "decisions_not_shown": []}

    # no suggestions file for the course: the reason is that, for every question without a course anchor — also when the caller passes nothing at all
    bare = Lecture(tmp_path / "bare", suggestions=None)
    for inferred in (bare.inferred, None):
        without = qt.enrich(bare.view(), bank=bare.bank, index=bare.index, source_map=SOURCE_MAP, inferred=inferred, decisions={})
        assert {q["question_id"]: q["no_link"] for q in without["questions"]["all"] if q["no_link"]} == {
            f"T-L01-Q{n:02d}": {"state": "no_suggestion", "reason": "no_file"} for n in (4, 5, 6, 7, 8, 11, 12, 13)}

    # a file that exists and cannot be read is not "none produced yet": the reason says so
    broken = bare.settings.state_dir / "inferred-anchors" / f"{COURSE}.json"
    broken.parent.mkdir(parents=True, exist_ok=True)
    broken.write_text("{not json", encoding="utf-8")
    unreadable = qt.enrich(bare.view(), bank=bare.bank, index=bare.index, source_map=SOURCE_MAP, inferred=ia.load(bare.settings, COURSE, **bare.context), decisions={})
    assert row(unreadable, "T-L01-Q04")["no_link"] == {"state": "no_suggestion", "reason": "file_unreadable"} and row(unreadable, "T-L01-Q01")["no_link"] is None

    # a record that nobody confirmed does not make a question "inspected"; a file made for an earlier catalog is stale as a whole
    loose = make_suggestions()
    loose["no_candidate"][0]["verifier"] = None
    unconfirmed = Lecture(tmp_path / "loose", suggestions=loose)
    assert row(unconfirmed.enriched(), "T-L01-Q07")["no_link"] == {"state": "no_suggestion", "reason": "no_item"}
    old = make_suggestions()
    old["question_index_sha256"] = "9" * 64
    earlier = Lecture(tmp_path / "old", suggestions=old, decide=False, strict=False).enriched()
    assert earlier["questions"]["counts"]["agent_inferred"] == 0 and not [t for s in earlier["slides"] for t in s["question_ties"] if t["tie"] == "agent_inferred"]
    assert row(earlier, "T-L01-Q04")["no_link"] == {"state": "no_suggestion", "reason": "stale"} and row(earlier, "T-L01-Q06")["no_link"] == {"state": "no_suggestion", "reason": "no_item"}
    assert row(earlier, "T-L01-Q07")["no_link"] == {"state": "no_suggestion", "reason": "stale"}


def test_the_counts_partition_the_lectures_catalogued_questions(lecture):
    view = lecture.enriched()
    counts = view["questions"]["counts"]
    assert counts == {"all": 14, "course_anchor": 6, "agent_inferred": 3, "without_link": 5, "course_section": 0}
    assert counts["all"] == len(view["questions"]["all"]) == counts["course_anchor"] + counts["agent_inferred"] + counts["without_link"]
    assert counts["without_link"] == sum(1 for q in view["questions"]["all"] if q["no_link"] is not None)
    assert counts["course_anchor"] == sum(1 for q in view["questions"]["all"] if any(t["tie"] in {"exact", "stated"} for t in q["ties"]))
    assert all(set(q) >= {"ties", "no_link", "evidence", "suggestion_history"} for q in view["questions"]["all"])


# ---- concept-related (R2-Q5, R2-Q6) -----------------------------------------------------------------------------------
def test_related_questions_share_a_concept_with_what_the_logical_slide_supports_and_are_not_tied_to_it(lecture):
    view = lecture.enriched()
    alpha = [{"concept_id": "t.concept.alpha", "label": "Alpha", "basis": "page_concepts"}]
    assert view["slides"][4]["related_questions"] == [
        {"question_id": "T-L01-Q04", "collection": "L01", "number": 4, "title": "Synthetic T-L01-Q04", "prompt_in_index": True, "tie": "concept_related", "via_concepts": alpha, "lecture_ids": ["lecture-01"], "evidence": UNKNOWN},
        {"question_id": "T-L02-Q01", "collection": "L02", "number": 1, "title": "Synthetic T-L02-Q01", "prompt_in_index": True, "tie": "concept_related", "via_concepts": alpha, "lecture_ids": ["lecture-02"], "evidence": UNKNOWN},
        {"question_id": "T-PS01-Q02", "collection": "PS01", "number": 2, "title": "Synthetic T-PS01-Q02", "prompt_in_index": True, "tie": "concept_related", "via_concepts": alpha, "lecture_ids": [], "evidence": UNKNOWN}]
    assert view["slides"][4]["related_questions_total"] == 3
    # in a build group the list is that of the logical slide: the same on every build, each question once, and a suggested link's criteria count as support
    group = [view["slides"][p - 1]["related_questions"] for p in (2, 3, 4)]
    assert group[0] == group[1] == group[2]
    assert [(r["question_id"], [c["label"] for c in r["via_concepts"]]) for r in group[0]] == [("T-L01-Q01", ["Alpha"]), ("T-L02-Q01", ["Alpha", "Beta"]), ("T-PS01-Q02", ["Alpha"])]
    assert len({r["question_id"] for r in group[0]}) == len(group[0])
    # gamma is a criterion of the suggested question that the suggestion does not list: it is not supported here
    assert "t.concept.gamma" not in {c["concept_id"] for r in group[0] for c in r["via_concepts"]}
    # a slide whose only concept belongs to no other question relates nothing
    assert view["slides"][6]["related_questions"] == [] and view["slides"][6]["related_questions_total"] == 0


def test_related_questions_are_capped_at_thirty_and_the_total_is_reported(tmp_path):
    lecture = Lecture(tmp_path, fillers=35)
    filler = {"concept_id": "t.concept.filler", "label": "Filler"}
    view = lecture.enriched(concepts_of_page=lambda page: [filler] if page == 11 else [])
    related = view["slides"][10]["related_questions"]
    assert len(related) == qt.RELATED_CAP == 30 and view["slides"][10]["related_questions_total"] == 35
    assert [r["question_id"] for r in related] == [f"T-PS02-Q{n:02d}" for n in range(1, 31)] and all(r["via_concepts"] == [dict(filler, basis="page_concepts")] for r in related)
    assert view["slides"][0]["related_questions"] == [] and view["slides"][0]["related_questions_total"] == 0


def test_the_concepts_of_a_page_can_be_supplied_by_the_caller(lecture):
    view = lecture.enriched(concepts_of_page=lambda page: ["t.concept.theta"] if page == 1 else [])
    assert [(r["question_id"], r["via_concepts"]) for r in view["slides"][0]["related_questions"]] == [("T-PS01-Q01", [{"concept_id": "t.concept.theta", "label": "Theta", "basis": "page_concepts"}])]
    assert view["slides"][4]["related_questions"] == []  # the caller's list replaces the view's own concept list
    # a suggested link still contributes the concepts of the criteria it lists
    assert [r["question_id"] for r in view["slides"][3]["related_questions"]] == ["T-L01-Q01", "T-L02-Q01", "T-PS01-Q02"]


# ---- structural pages, evidence, odd views ---------------------------------------------------------------------------
def test_a_page_with_a_no_forced_requirement_role_still_lists_its_ties(lecture):
    view = lecture.enriched()
    assert view["slides"][0]["role"]["forced_requirements"] is False
    assert ties(view, 1) == [("T-L01-Q14", "exact", "on_this_page", [1], [])]
    assert view["questions"]["counts"]["all"] == 14  # and the lecture's questions stay reachable from it


def test_evidence_comes_from_the_injected_reader_and_is_unknown_without_one(lecture):
    plain = lecture.enriched()
    assert plain["slides"][4]["question_ties"][0]["evidence"] == UNKNOWN and row(plain, "T-L01-Q01")["evidence"] == UNKNOWN
    assert plain["slides"][4]["question_ties"][0]["evidence"] is not row(plain, "T-L01-Q01")["evidence"]  # separate objects: one row's evidence is not another's
    asked: list[str] = []

    def evidence_of(question_id: str) -> dict:
        asked.append(question_id)
        return {"state": "assisted", "assistance": "solution_shown", "prior_exposure": "seen", "attempts": 1, "last_at": "2026-09-20T15:00:00Z", "question_id": question_id}

    view = lecture.enriched(evidence_of=evidence_of)
    assert view["slides"][4]["question_ties"][0]["evidence"]["question_id"] == "T-L01-Q01" and view["slides"][4]["related_questions"][0]["evidence"]["question_id"] == "T-L01-Q04"
    assert row(view, "T-L01-Q06")["evidence"]["state"] == "assisted" and set(asked) >= {q["question_id"] for q in view["questions"]["all"]}


def test_a_lecture_without_a_deck_or_without_a_catalog_is_enriched_without_inventing_anything(lecture, tmp_path):
    view = lecture.view(deck=None)
    qt.enrich(view, bank=lecture.bank, index=lecture.index, source_map=None, inferred=lecture.inferred, decisions=lecture.decisions)
    assert view["slides"] == [] and view["questions"]["counts"] == {"all": 14, "course_anchor": 6, "agent_inferred": 3, "without_link": 5, "course_section": 0}
    assert not [t for q in view["questions"]["all"] for t in q["ties"] if t["on_displayed_deck"]]
    empty = {"course_id": COURSE, "lecture_id": "lecture-09", "deck": None, "slides": [], "questions": {"all": [], "related_by_relationship": [], "gap": "none"}}
    qt.enrich(empty, bank={"questions": {}, "lectures": {}, "collections": []}, index=None, source_map=None, inferred=None, decisions=None)
    assert empty["questions"]["counts"] == {"all": 0, "course_anchor": 0, "agent_inferred": 0, "without_link": 0, "course_section": 0}


def test_questions_related_by_a_catalog_relationship_carry_the_same_three_fields(lecture):
    view = lecture.view()
    view["questions"]["related_by_relationship"] = [dict(lecture.bank["questions"]["T-PS01-Q01"], prompt="Synthetic prompt of T-PS01-Q01.", via=[])]
    qt.enrich(view, bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=lecture.inferred, decisions=lecture.decisions)
    (related,) = view["questions"]["related_by_relationship"]
    assert [(t["tie"], t["source_id"], t["pages"], t["on_displayed_deck"]) for t in related["ties"]] == [("stated", "src-ps-01", [1], False), ("agent_inferred", "src-l01-slides", [10], True)]
    assert related["no_link"] is None and related["evidence"] == UNKNOWN and view["questions"]["counts"]["all"] == 14  # counted are the lecture's own questions only


# ---- what each page supports (r2-read-api.md 1.4) -----------------------------------------------------------------------
def per_page_suggestions() -> dict:
    doc = make_suggestions()
    doc["no_candidate"] = []
    doc["items"] = [
        # two builds of the group of pages 2-4, each carrying a different criterion; the build between them is not named
        suggestion("T-L01-Q04", [2, 4], [1, 2], per_page=[{"page": 2, "supports": ["T-L01-Q04.C01"]}, {"page": 4, "supports": ["T-L01-Q04.C02"]}]),
        # both builds of the group of pages 6-7 are named; only the second one carries the criterion
        suggestion("T-L01-Q12", [6, 7], [1], per_page=[{"page": 6, "supports": []}, {"page": 7, "supports": ["T-L01-Q12.C01"]}]),
        # the producer said what page 11 supports and nothing about page 12
        suggestion("T-L01-Q05", [11, 12], [1], per_page=[{"page": 11, "supports": ["T-L01-Q05.C01"]}]),
        # nothing was said page by page
        suggestion("T-L01-Q13", [9, 10], [1]),
        # two pages far apart, each carrying one criterion about a different concept (Alpha on page 1, Beta on page 12)
        suggestion("T-L02-Q01", [1, 12], [1, 2], per_page=[{"page": 1, "supports": ["T-L02-Q01.C01"]}, {"page": 12, "supports": ["T-L02-Q01.C02"]}]),
    ]
    return doc


def suggested_on(view: dict, page: int, question_id: str) -> dict:
    return next(t for t in view["slides"][page - 1]["question_ties"] if t["question_id"] == question_id and t["tie"] == "agent_inferred")


def test_a_page_that_carries_one_criterion_of_a_link_says_so_and_never_reads_like_the_page_for_all_of_them(tmp_path):
    lecture = Lecture(tmp_path, suggestions=per_page_suggestions(), decide=False)
    view = lecture.enriched()
    first, between, last = (suggested_on(view, page, "T-L01-Q04") for page in (2, 3, 4))
    assert [(t["where"], t["support_pages"], t["criteria_supported"], t["criteria_total"], t["criteria_supported_here"]) for t in (first, between, last)] == [
        ("on_this_page", [2, 4], 2, 3, 1),            # this build carries criterion 1 only
        ("elsewhere_in_sequence", [2, 4], 2, 3, 2),   # not this page: the count is that of the two builds the link names
        ("on_this_page", [2, 4], 2, 3, 1)]            # this build carries criterion 2 only
    assert [(c["criterion_id"], c["pages"]) for c in first["criteria"]] == [("T-L01-Q04.C01", [2]), ("T-L01-Q04.C02", [4])]  # which page carries which criterion, by identity
    assert "1 of the 2 criteria" in first["why"] and "1 of the 2 criteria" in last["why"] and "criteria the link lists" not in between["why"]
    # every member of a group named: still counted page by page, so the first build does not borrow what only the second one shows
    assert [(suggested_on(view, page, "T-L01-Q12")["where"], suggested_on(view, page, "T-L01-Q12")["criteria_supported_here"]) for page in (6, 7)] == [("group_level", 0), ("group_level", 1)]
    assert "none of the" in suggested_on(view, 6, "T-L01-Q12")["why"] and "criteria the link lists" not in suggested_on(view, 7, "T-L01-Q12")["why"]
    # what was not said is not known: a page the list leaves out, and an item without the list
    assert (suggested_on(view, 11, "T-L01-Q05")["criteria_supported_here"], suggested_on(view, 12, "T-L01-Q05")["criteria_supported_here"]) == (1, None)
    assert suggested_on(view, 9, "T-L01-Q13")["criteria_supported_here"] is None and suggested_on(view, 9, "T-L01-Q13")["criteria"][0]["pages"] is None
    assert "criteria the link lists" not in suggested_on(view, 12, "T-L01-Q05")["why"] + suggested_on(view, 9, "T-L01-Q13")["why"]
    # course anchors name pages, not criteria; the lecture's own row lists the pages per criterion and has no "here"
    assert all(t["criteria_supported_here"] is None for s in view["slides"] for t in s["question_ties"] if t["tie"] != "agent_inferred")
    (whole,) = row(view, "T-L01-Q04")["ties"]
    assert [(c["criterion_id"], c["pages"]) for c in whole["criteria"]] == [("T-L01-Q04.C01", [2]), ("T-L01-Q04.C02", [4])] and "criteria_supported_here" not in whole
    for slide in view["slides"]:
        for tie in slide["question_ties"]:
            if tie["tie"] == "agent_inferred" and tie["criteria_supported_here"] is not None:
                assert tie["criteria_supported_here"] <= tie["criteria_supported"] <= tie["criteria_total"]
            assert not [w for w in ("whole", "entire", "complete", "answers", "teaches", "all of") if w in tie["why"].lower()], tie["why"]
    assert RUBRIC_MARKER not in json.dumps(view) and GUIDANCE_MARKER not in json.dumps(view)


def test_a_concept_counts_as_supported_only_on_the_page_that_carries_its_criterion(tmp_path):
    """Related questions follow what THIS logical slide supports: a criterion the link places on another page lends its concept to that page only."""
    view = Lecture(tmp_path, suggestions=per_page_suggestions(), decide=False).enriched()
    assert (suggested_on(view, 1, "T-L02-Q01")["criteria_supported_here"], suggested_on(view, 12, "T-L02-Q01")["criteria_supported_here"]) == (1, 1)
    first = {r["question_id"]: [(c["label"], c["basis"]) for c in r["via_concepts"]] for r in view["slides"][0]["related_questions"]}
    last = {r["question_id"]: [(c["label"], c["basis"]) for c in r["via_concepts"]] for r in view["slides"][11]["related_questions"]}
    assert first == {"T-L01-Q01": [("Alpha", "suggested_link")], "T-L01-Q04": [("Alpha", "suggested_link")], "T-PS01-Q02": [("Alpha", "suggested_link")]}   # Alpha is carried by page 1
    assert last == {"T-L01-Q02": [("Beta", "suggested_link")], "T-L01-Q03": [("Beta", "suggested_link")], "T-L01-Q04": [("Beta", "suggested_link")]}      # Beta by page 12, and Alpha is not
    # the criterion of the link on pages 11-12 was placed on page 11: its concept (Delta) is not lent to page 12, about which nothing was said
    assert "Delta" not in {label for row_ in last.values() for label, _ in row_}


# ---- section ties from the course's own study maps (D78; r2-read-api.md 1.2 and 1.4) -----------------------------------------
def section(ranges=((1, 8),), *, row_number: int = 1, label: str = "Synthetic section one", scope: str | None = "all", source_id: str = "src-l01-slides", deck_state: str = "current",
            lines=((10, 40),)) -> dict:
    """One row of ``ownerio.study_maps.section_ties`` for a question, written by hand."""
    return {"lecture_id": "lecture-01", "source_id": source_id, "pages": [p for a, b in ranges for p in range(a, b + 1)], "page_ranges": [list(r) for r in ranges],
            "transcript_ranges": [list(r) for r in lines], "row": row_number, "label": label, "scope": scope, "map_sha256": "f" * 64, "deck_state": deck_state, "on_displayed_deck": True,
            "deck_bytes_verified": False, "as_written": "Q (synthetic)", "number_basis": "lecture_collections"}


def make_sections() -> dict[str, list[dict]]:
    return {
        "T-L01-Q01": [section(((5, 11),), row_number=2, label="Synthetic section two")],                                    # also anchored to pages by the course
        "T-L01-Q04": [section(((2, 5),), scope="part")],                                                                    # also carries a suggested link
        "T-L01-Q06": [section(), section(((10, 10), (12, 12)), row_number=3, label="Synthetic section three", scope=None)],   # nothing else; named by two rows
        "T-L01-Q07": [section(deck_state="stale")],                                                                         # a map made for other deck bytes
        "T-L01-Q10": [section(((1, 3),), source_id="src-l01-alt")],                                                         # a map bound to the unit's other deck
    }


NO_SUGGESTION = {"criteria_supported": None, "criteria_total": None, "criteria": None, "coverage": None, "state": None, "verdict": None, "verdict_note": None, "rationale": None, "regions": None,
                 "suggestion_id": None, "learner_decision": None}


def test_a_study_map_row_is_a_section_tie_listed_apart_and_never_a_page_tie(lecture):
    plain = lecture.enriched()
    view = lecture.enriched(section_ties=make_sections())
    # nothing about pages changed: an eight-page section adds no row to any page's own list and no course anchor
    assert [s["question_ties"] for s in view["slides"]] == [s["question_ties"] for s in plain["slides"]]
    assert [(s["related_questions"], s["related_questions_total"]) for s in view["slides"]] == [(s["related_questions"], s["related_questions_total"]) for s in plain["slides"]]
    assert view["questions"]["counts"] == {"all": 14, "course_anchor": 6, "agent_inferred": 3, "without_link": 5, "course_section": 4}
    assert {q["question_id"]: q["no_link"] for q in view["questions"]["all"]} == {q["question_id"]: q["no_link"] for q in plain["questions"]["all"]}
    # its own list per page: the pages inside the stated range, in catalog order, a question once per row that names the page
    assert {s["page"]: [(t["question_id"], t["section"]["row"]) for t in s["section_ties"]] for s in view["slides"]} == {
        1: [("T-L01-Q06", 1)], 2: [("T-L01-Q04", 1), ("T-L01-Q06", 1)], 3: [("T-L01-Q04", 1), ("T-L01-Q06", 1)], 4: [("T-L01-Q04", 1), ("T-L01-Q06", 1)],
        5: [("T-L01-Q01", 2), ("T-L01-Q04", 1), ("T-L01-Q06", 1)], 6: [("T-L01-Q01", 2), ("T-L01-Q06", 1)], 7: [("T-L01-Q01", 2), ("T-L01-Q06", 1)], 8: [("T-L01-Q01", 2), ("T-L01-Q06", 1)],
        9: [("T-L01-Q01", 2)], 10: [("T-L01-Q01", 2), ("T-L01-Q06", 3)], 11: [("T-L01-Q01", 2)], 12: [("T-L01-Q06", 3)]}
    on_slide = view["slides"][0]["section_ties"][0]
    assert on_slide == {"question_id": "T-L01-Q06", "collection": "L01", "number": 6, "title": "Synthetic T-L01-Q06", "prompt": "Synthetic prompt of T-L01-Q06.", "prompt_in_index": True,
                        "tie": "stated", "granularity": "section", "from": "course_study_map", "catalog_field": None,
                        "section": {"page_ranges": [[1, 8]], "label": "Synthetic section one", "row": 1, "scope": "all"},
                        "where": None, "support_pages": [], "other_pages": [], "transcript_lines": [[10, 40]], **NO_SUGGESTION, "criteria_supported_here": None,
                        "why": "The course's study map places this question in the section on pages 1 to 8; it names no single page.", "evidence": UNKNOWN}
    assert "pages 10 and 12" in view["slides"][11]["section_ties"][0]["why"]
    # the lecture's row: page anchors of the course, then its section statements, then suggestions
    assert [(t["tie"], t["granularity"], t["from"]) for t in row(view, "T-L01-Q01")["ties"]] == [("exact", "page", "course_locator"), ("stated", "section", "course_study_map")]
    assert [(t["tie"], t["granularity"], t["from"]) for t in row(view, "T-L01-Q04")["ties"]] == [("stated", "section", "course_study_map"), ("agent_inferred", "page", "inferred_anchor_file")]
    only = row(view, "T-L01-Q06")
    assert only["ties"] == [
        {"tie": "stated", "granularity": "section", "from": "course_study_map", "catalog_field": None, "section": {"page_ranges": [[1, 8]], "label": "Synthetic section one", "row": 1, "scope": "all"},
         "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [1, 2, 3, 4, 5, 6, 7, 8], "logical_slide_ids": ["ls-syn-p1", "ls-syn-p2-4", "ls-syn-p5", "ls-syn-p6-7", "ls-syn-p8"],
         "transcript_lines": [[10, 40]], **NO_SUGGESTION, "on_displayed_deck": True},
        {"tie": "stated", "granularity": "section", "from": "course_study_map", "catalog_field": None, "section": {"page_ranges": [[10, 10], [12, 12]], "label": "Synthetic section three", "row": 3, "scope": None},
         "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [10, 12], "logical_slide_ids": ["ls-syn-p10", "ls-syn-p12"],
         "transcript_lines": [[10, 40]], **NO_SUGGESTION, "on_displayed_deck": True}]
    assert only["no_link"] == {"state": "no_suggestion", "reason": "no_item"}  # a section is where to look, not a link to a page: the line about page links still shows
    # a map made for other deck bytes states nothing current; a map bound to the other deck is a statement about that deck and sits on no page of this one
    assert row(view, "T-L01-Q07")["ties"] == [] and row(view, "T-L01-Q07")["no_link"]["state"] == "inspected_no_support"
    (lines, elsewhere) = row(view, "T-L01-Q10")["ties"]
    assert (lines["granularity"], lines["pages"]) == ("page", []) and (elsewhere["granularity"], elsewhere["source_id"], elsewhere["on_displayed_deck"], elsewhere["logical_slide_ids"]) == ("section", "src-l01-alt", False, [])
    assert not [s["page"] for s in view["slides"] for t in s["section_ties"] if t["question_id"] in {"T-L01-Q07", "T-L01-Q10"}]
    # kinds and granularities stay what they are, in both lists, also when the enriched view is enriched again
    for slide in view["slides"]:
        assert all((t["granularity"], t["section"]) == ("page", None) and t["from"] in {"course_locator", "inferred_anchor_file"} for t in slide["question_ties"])
        assert all((t["tie"], t["granularity"], t["from"], t["where"]) == ("stated", "section", "course_study_map", None) for t in slide["section_ties"])
    assert all(t["from"] == ("inferred_anchor_file" if t["tie"] == "agent_inferred" else "course_study_map" if t["granularity"] == "section" else "course_locator")
               for q in view["questions"]["all"] for t in q["ties"])
    again = qt.enrich(copy.deepcopy(view), bank=lecture.bank, index=lecture.index, source_map=SOURCE_MAP, inferred=lecture.inferred, decisions=lecture.decisions, section_ties=make_sections())
    assert again == view and json.loads(json.dumps(view)) == view
    assert RUBRIC_MARKER not in json.dumps(view) and GUIDANCE_MARKER not in json.dumps(view)


def test_without_study_maps_every_page_has_an_empty_section_list_and_nothing_is_counted(lecture):
    for nothing in (None, {}, {"T-L01-Q06": []}, {"T-UNKNOWN-Q99": [section()]}):
        view = lecture.enriched(section_ties=nothing)
        assert all(s["section_ties"] == [] for s in view["slides"]) and view["questions"]["counts"]["course_section"] == 0
        assert not [t for q in view["questions"]["all"] for t in q["ties"] if t["granularity"] != "page"]


def test_a_section_is_listed_on_the_pages_inside_its_range_and_not_on_the_rest_of_a_build_sequence(lecture):
    """A section is a range of physical pages. Builds 2-4 and 6-7 each reach over one of its ends: the pages outside the range do not list it."""
    view = lecture.enriched(section_ties={"T-L01-Q06": [section(((3, 6),))]})
    assert [s["page"] for s in view["slides"] if [t for t in s["section_ties"] if t["question_id"] == "T-L01-Q06"]] == [3, 4, 5, 6]
    assert row(view, "T-L01-Q06")["ties"][0]["logical_slide_ids"] == ["ls-syn-p2-4", "ls-syn-p5", "ls-syn-p6-7"]  # the row names the logical slides the range touches


def test_section_ties_do_not_move_a_question_between_the_three_counted_kinds(lecture):
    """course_anchor + agent_inferred + without_link stays the partition of the lecture's rows; course_section is counted beside it."""
    everything = {q: [section(((1, 12),))] for q in lecture.bank["lectures"]["lecture-01"]["question_ids"]}
    counts = lecture.enriched(section_ties=everything)["questions"]["counts"]
    assert counts == {"all": 14, "course_anchor": 6, "agent_inferred": 3, "without_link": 5, "course_section": 14}
    assert counts["all"] == counts["course_anchor"] + counts["agent_inferred"] + counts["without_link"]


# ---- the learner's decision and a regenerated file (R2-Q5) ---------------------------------------------------------------
def regenerate(lecture: Lecture, change) -> dict:
    """Store a later suggestions file made from the fixture's one by ``change(items)`` and enrich with it and the decisions on disk."""
    doc = make_suggestions()
    doc["produced_at"] = "2026-10-06T09:00:00Z"
    doc["items"] = change(doc["items"])
    ia.store(lecture.settings, COURSE, doc, **lecture.context)
    lecture.inferred = ia.load(lecture.settings, COURSE, **lecture.context)
    lecture.decisions = ia.decisions(lecture.settings, COURSE)
    return doc


def test_a_link_the_learner_confirmed_stays_when_a_later_checking_pass_rejects_it(lecture):
    confirmed_id = ia.suggestion_id("T-L01-Q13", 1, DECK_SHA, [12])
    note = "Synthetic note: page 12 only shares words with the criterion."
    regenerate(lecture, lambda items: [dict(i, state="agent_reviewed", verifier={"verdict": "rejected", "note": note}) if i["question_id"] == "T-L01-Q13" else i for i in items])
    assert [i["suggestion_id"] for i in lecture.inferred["by_question"]["T-L01-Q13"]["rejected_by_verifier"]] == [confirmed_id] and lecture.decisions[confirmed_id]["decision"] == "confirmed"
    view = lecture.enriched()
    (kept,) = [t for t in view["slides"][11]["question_ties"] if t["question_id"] == "T-L01-Q13"]
    assert (kept["tie"], kept["state"], kept["verdict"], kept["verdict_note"], kept["learner_decision"], kept["suggestion_id"]) == ("agent_inferred", "agent_reviewed", "rejected", note, "confirmed", confirmed_id)
    assert "rejected" in kept["why"] and "You confirmed" in kept["why"] and "checked by a second agent pass." not in kept["why"]  # both facts are said; it is not worded as endorsed
    assert [(t["tie"], t["verdict"], t["learner_decision"]) for t in row(view, "T-L01-Q13")["ties"]] == [("agent_inferred", "rejected", "confirmed")] and row(view, "T-L01-Q13")["no_link"] is None
    assert view["questions"]["counts"] == {"all": 14, "course_anchor": 6, "agent_inferred": 3, "without_link": 5, "course_section": 0}
    # an item the checking pass rejected and the learner never confirmed is no link, exactly as before
    assert "T-L01-Q05" not in [t["question_id"] for s in view["slides"] for t in s["question_ties"]] and row(view, "T-L01-Q05")["ties"] == []
    assert not [t for s in view["slides"] for t in s["question_ties"] if t["verdict"] == "rejected" and t["learner_decision"] != "confirmed"]
    # the caller can decide the other way: then the rejection wins, and the row still says what the learner had decided
    other = lecture.enriched(confirmed_outranks_verifier=False)
    assert "T-L01-Q13" not in [t["question_id"] for s in other["slides"] for t in s["question_ties"]]
    assert row(other, "T-L01-Q13")["ties"] == [] and row(other, "T-L01-Q13")["no_link"] == {"state": "inspected_no_support", "reason": note}
    assert row(other, "T-L01-Q13")["suggestion_history"]["decisions_not_shown"] == [
        {"suggestion_id": confirmed_id, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [12], "learner_decision": "confirmed", "reason": "rejected_by_verifier"}]
    assert row(view, "T-L01-Q13")["suggestion_history"]["decisions_not_shown"] == []
    # once the learner takes the confirmation back, nothing keeps the rejected item on screen
    ia.decide(lecture.settings, COURSE, confirmed_id, "cleared", at="2026-10-06T10:00:00Z")
    cleared = lecture.enriched(decisions=ia.decisions(lecture.settings, COURSE))
    assert "T-L01-Q13" not in [t["question_id"] for s in cleared["slides"] for t in s["question_ties"]]
    assert row(cleared, "T-L01-Q13")["no_link"] == {"state": "inspected_no_support", "reason": note}
    assert row(cleared, "T-L01-Q13")["suggestion_history"] == {"stale": 0, "rejected_by_verifier": 1, "rejected_by_learner": [], "decisions_not_shown": []}


def test_a_decision_whose_suggestion_is_no_longer_a_current_link_is_listed_in_the_row_with_the_reason(lecture):
    confirmed_id, rejected_id = ia.suggestion_id("T-L01-Q13", 1, DECK_SHA, [12]), ia.suggestion_id("T-L01-Q12", 1, DECK_SHA, [12])

    def later(items: list[dict]) -> list[dict]:
        out = []
        for entry in items:
            if entry["question_id"] == "T-L01-Q13":   # the checking pass kept another page than the one the learner confirmed
                out.append(dict(entry, pages=[11], state="agent_reviewed", verifier={"verdict": "narrowed", "note": "Synthetic note: page 11 kept."}))
            elif entry["question_id"] == "T-L01-Q12":  # no longer proposed; the checking pass rejected another page for it
                out.append(dict(entry, pages=[11], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Synthetic note: shared words only."}))
            else:
                out.append(entry)
        return out

    regenerate(lecture, later)
    view = lecture.enriched()
    narrowed = row(view, "T-L01-Q13")
    assert [(t["pages"], t["verdict"], t["learner_decision"]) for t in narrowed["ties"]] == [([11], "narrowed", None)]  # a decision about pages 12 is not carried over to page 11
    assert narrowed["suggestion_history"]["decisions_not_shown"] == [
        {"suggestion_id": confirmed_id, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [12], "learner_decision": "confirmed", "reason": "not_in_file"}]
    dropped = row(view, "T-L01-Q12")
    assert dropped["ties"] == [] and dropped["no_link"]["state"] == "inspected_no_support"
    assert dropped["suggestion_history"] == {"stale": 0, "rejected_by_verifier": 1, "rejected_by_learner": [], "decisions_not_shown": [
        {"suggestion_id": rejected_id, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [12], "learner_decision": "rejected", "reason": "not_in_file"}]}
    assert not [t for s in view["slides"] for t in s["question_ties"] if t["suggestion_id"] in {confirmed_id, rejected_id}]  # neither is a link
    # the deck's bytes change: the decisions stay on record and the row says their suggestions were made for other bytes
    regenerate(lecture, lambda items: items)
    moved = ia.load(lecture.settings, COURSE, **dict(lecture.context, deck_sha256_of=lambda item: "e" * 64))
    stale = lecture.enriched(inferred=moved)
    assert [(d["suggestion_id"], d["learner_decision"], d["reason"]) for d in row(stale, "T-L01-Q13")["suggestion_history"]["decisions_not_shown"]] == [(confirmed_id, "confirmed", "stale")]
    assert [(d["suggestion_id"], d["learner_decision"], d["reason"]) for d in row(stale, "T-L01-Q12")["suggestion_history"]["decisions_not_shown"]] == [(rejected_id, "rejected", "stale")]
    # a cleared decision is no decision and is listed nowhere
    ia.decide(lecture.settings, COURSE, confirmed_id, "cleared", at="2026-10-06T10:00:00Z")
    assert row(lecture.enriched(inferred=moved, decisions=ia.decisions(lecture.settings, COURSE)), "T-L01-Q13")["suggestion_history"]["decisions_not_shown"] == []


def test_what_the_learner_rejected_is_listed_in_one_order_whatever_the_order_of_the_file(tmp_path):
    def build(where: Path, pages_in_file: list[list[int]]) -> list[list[int]]:
        doc = make_suggestions()
        doc["items"] = [suggestion("T-L01-Q06", pages, [1]) for pages in pages_in_file]
        lecture = Lecture(where, suggestions=doc, decide=False)
        for item in lecture.inferred["items"]:
            ia.decide(lecture.settings, COURSE, item["suggestion_id"], "rejected", at=NOW, suggestion=item)
        view = lecture.enriched(decisions=ia.decisions(lecture.settings, COURSE))
        return [d["pages"] for d in row(view, "T-L01-Q06")["suggestion_history"]["rejected_by_learner"]]

    assert build(tmp_path / "a", [[12], [9], [10, 11]]) == build(tmp_path / "b", [[10, 11], [12], [9]]) == [[9], [10, 11], [12]]


# ---- small rules that had no test ---------------------------------------------------------------------------------------
def test_a_source_map_that_is_not_ready_groups_nothing_even_when_it_lists_groups(lecture):
    view = lecture.enriched(source_map=dict(SOURCE_MAP, state="unavailable", reason="unreadable"))
    assert ties(view, 2) == [("T-L01-Q03", "exact", "on_this_page", [2], [3, 4, 8])] and row(view, "T-L01-Q03")["ties"][0]["logical_slide_ids"] == []
    assert ties(view, 7) == [("T-L01-Q09", "agent_inferred", "on_this_page", [7], [6])]


def custom(index: dict, lecture_id: str = "lecture-01") -> dict:
    """A bare lecture view over a hand-made index, enriched with nothing but the course's own anchors."""
    bank = build_question_bank(index, make_inventory(), reviewed_collections=("L01",))
    view = {"course_id": COURSE, "lecture_id": lecture_id, "deck": {"source_id": "src-l01-slides", "version_id": "v1", "sha256": DECK_SHA},
            "slides": [{"page": p, "title": f"Synthetic page {p}", "concepts": []} for p in range(1, 13)],
            "questions": {"all": [dict(bank["questions"][q]) for q in bank["lectures"][lecture_id]["question_ids"]], "related_by_relationship": [dict(q) for q in bank["questions"].values() if not q["lecture_ids"]]}}
    return qt.enrich(view, bank=bank, index=index, source_map=None, inferred=None, decisions=None)


def test_transcript_lines_of_another_unit_do_not_travel_with_a_page_tie():
    index = make_index()
    index["questions"]["T-L01-Q15"] = dict(question("T-L01-Q15", "L01", 15, ["delta"], "Slides 5"), source_refs=[
        {"source_id": "src-l01-slides", "locator": "Slides 5"}, {"source_id": "src-l02-slides", "locator": "Transcript 7-9"}])
    view = custom(index)
    two = sorted(row(view, "T-L01-Q15")["ties"], key=lambda t: str(t["lecture_id"]))
    assert [(t["lecture_id"], t["pages"], t["transcript_lines"]) for t in two] == [("lecture-01", [5], []), ("lecture-02", [], [[7, 9]])]
    assert next(t for t in view["slides"][4]["question_ties"] if t["question_id"] == "T-L01-Q15")["transcript_lines"] == []  # lines of lecture 2 are not lines of this page's lecture


def test_the_page_a_question_is_printed_on_is_told_apart_from_a_locator(lecture):
    """The catalog's ``page`` field says where the question itself is printed; a locator says where its content is."""
    index = make_index()
    index["questions"]["T-PS01-Q03"] = dict(question("T-PS01-Q03", "PS01", 3, ["delta"], "page 1", "src-ps-01"), page=2, source_path="materials/src-ps-01.pdf")
    index["questions"]["T-L01-Q16"] = dict(question("T-L01-Q16", "L01", 16, ["delta"], COARSE), page=7, source_path="materials/src-l01-slides.pdf")
    view = custom(index)
    printed = next(q for q in view["questions"]["related_by_relationship"] if q["question_id"] == "T-PS01-Q03")
    assert [(t["tie"], t["source_id"], t["pages"], t["from"], t["catalog_field"]) for t in printed["ties"]] == [
        ("stated", "src-ps-01", [1], "course_locator", "locator"), ("stated", "src-ps-01", [2], "course_locator", "page")]
    on_deck = next(t for t in view["slides"][6]["question_ties"] if t["question_id"] == "T-L01-Q16")
    assert (on_deck["tie"], on_deck["catalog_field"], on_deck["where"]) == ("exact", "page", "on_this_page") and "printed" in on_deck["why"]
    assert all(t["catalog_field"] == "locator" for s in lecture.enriched()["slides"] for t in s["question_ties"] if t["tie"] != "agent_inferred")
    assert all(t["catalog_field"] is None for s in lecture.enriched()["slides"] for t in s["question_ties"] if t["tie"] == "agent_inferred")


def test_a_related_question_says_whether_its_concept_comes_from_the_page_or_only_from_a_suggested_link(lecture):
    view = lecture.enriched()
    by_question = {r["question_id"]: {c["label"]: c["basis"] for c in r["via_concepts"]} for r in view["slides"][1]["related_questions"]}
    # on pages 2-4 Beta is a concept of the pages' own anchors; Alpha is there only because an unchecked suggestion lists a criterion about it
    assert by_question == {"T-L01-Q01": {"Alpha": "suggested_link"}, "T-L02-Q01": {"Alpha": "suggested_link", "Beta": "page_concepts"}, "T-PS01-Q02": {"Alpha": "suggested_link"}}
    assert {c["basis"] for r in view["slides"][4]["related_questions"] for c in r["via_concepts"]} == {"page_concepts"}


# ---- the real projection of the generated fixture course ----------------------------------------------------------------
def test_the_fixture_lecture_view_is_enriched_as_the_lead_will_wire_it(settings, clock):
    from lecture_brain.fixtures import content
    from lecture_brain.journal import Journal
    from lecture_brain.ownerio.inventory import build_inventory
    from lecture_brain.preparation import Preparation
    from lecture_brain.projections import Projector

    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    try:
        prep = Preparation(settings, converter=None, now=lambda: NOW)
        prep.prepare_course("be505")
        projector = Projector(settings, journal, preparation=prep, now=lambda: NOW)
        inventory = build_inventory(settings.course("be505"))
        catalogs = projector._catalogs("be505")
        bank = projector._bank("be505", catalogs, inventory)
        context = ia.course_context(settings, "be505", deck_sha256_of=lambda item: projector._bytes_sha("be505", item))
        slides = next(d for l in inventory["lectures"] if l["lecture_id"] == "lecture-01" for d in l["decks"] if d["source_id"] == "src-lecture-01-slides")
        entry = {"lecture_id": "lecture-01", "source_id": "src-lecture-01-slides", "source_sha256": context["deck_sha256_of"](slides), "regions": None, "coverage": "partial",
                 "rationale": "Synthetic: the named pages show the parts this criterion asks about.", "state": "agent_inferred", "verifier": None, "question_version": 1}
        ia.store(settings, "be505", {"contract": "ll.inferred-anchors/1", "course_id": "be505", "produced_at": NOW, "producer": "claude-session", "question_index_sha256": context["index"]["sha256"], "items": [
            dict(entry, question_id="BE505-L01-Q04", pages=[2, 3], criteria=["BE505-L01-Q04.C01"]), dict(entry, question_id="BE505-PS01-Q01", pages=[4], criteria=["BE505-PS01-Q01.C01"])]})

        def enriched(lecture_id: str) -> dict:
            view = projector.lecture_view("be505", lecture_id)
            return qt.enrich(view, bank=bank, index=catalogs["questions"], source_map=view.get("source_map"), inferred=ia.load(settings, "be505", **context),
                             decisions=ia.decisions(settings, "be505"))

        four = enriched("lecture-04")  # "Slides 1, 3; transcript 4-9": a reviewed page list and a separate line map
        per_page = {s["page"]: [(t["question_id"], t["tie"], t["where"], t["transcript_lines"]) for t in s["question_ties"]] for s in four["slides"]}
        assert per_page == {1: [("BE505-L04-Q01", "exact", "on_this_page", [[4, 9]])], 2: [], 3: [("BE505-L04-Q01", "exact", "on_this_page", [[4, 9]])]}
        assert four["questions"]["counts"] == {"all": 3, "course_anchor": 3, "agent_inferred": 0, "without_link": 0, "course_section": 0}
        one = enriched("lecture-01")
        coarse = next(q for q in one["questions"]["all"] if q["question_id"] == "BE505-L01-Q04")
        assert [(t["tie"], t["pages"], t["criteria_supported"], t["criteria_total"], t["on_displayed_deck"]) for t in coarse["ties"]] == [("agent_inferred", [2, 3], 1, 1, True)] and coarse["no_link"] is None
        assert [(t["question_id"], t["tie"]) for t in one["slides"][3]["question_ties"]] == [("BE505-PS01-Q01", "agent_inferred")]
        assert ("BE505-L01-Q04", "agent_inferred") in [(t["question_id"], t["tie"]) for t in one["slides"][1]["question_ties"]]
        assert ("BE505-L01-Q01", "stated") in [(t["question_id"], t["tie"]) for t in one["slides"][1]["question_ties"]]
        assert one["questions"]["counts"]["all"] == len(one["questions"]["all"]) == sum(1 for q in content.BE505_QUESTIONS if q["collection"] == "L01")
        assert one["questions"]["counts"]["without_link"] == 0 and one["questions"]["counts"]["agent_inferred"] == 1
        text = json.dumps([four, one])
        assert not [q["answer"] for q in content.BE505_QUESTIONS if q["answer"] in text] and '"answer"' not in text and "observable" not in text
        assert not [k[2] for q in content.BE505_QUESTIONS for k in q["criteria"] if k[2] in text]
    finally:
        journal.close()


def test_rows_of_the_study_map_reader_reach_the_lecture_view_as_section_ties(settings, clock):
    """The seam between ``ownerio.study_maps.section_ties`` and ``enrich``, on a synthetic study note written into the generated course."""
    from lecture_brain.journal import Journal
    from lecture_brain.ownerio import study_maps
    from lecture_brain.ownerio.inventory import build_inventory
    from lecture_brain.preparation import Preparation
    from lecture_brain.projections import Projector

    root = settings.course("be505").root
    header = ["Concept", "Slide pages", "Transcript lines", "Diagnostic", "Summary"]
    rows = [["Synthetic topic one", "2-3", "1-4", "Q1 all", "synthetic note"], ["Synthetic topic two", "4", "5-6", "Q4 all", "synthetic note"]]
    note = root / "work" / "lecture-review" / "lecture-01-source-map.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text("# Synthetic study note\n\n" + "\n".join(["| " + " | ".join(header) + " |", "|" + "---|" * len(header), *("| " + " | ".join(r) + " |" for r in rows)]) + "\n", encoding="utf-8")
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    try:
        prep = Preparation(settings, converter=None, now=lambda: NOW)
        prep.prepare_course("be505")
        projector = Projector(settings, journal, preparation=prep, now=lambda: NOW)
        inventory = build_inventory(settings.course("be505"))
        catalogs = projector._catalogs("be505")
        bank = projector._bank("be505", catalogs, inventory)
        sections = study_maps.section_ties(study_maps.read_study_maps(root, inventory), bank)
        assert sorted(sections) == ["BE505-L01-Q01", "BE505-L01-Q04"] and all(row_["deck_state"] == "current" for rows_ in sections.values() for row_ in rows_)
        view = projector.lecture_view("be505", "lecture-01")
        plain = qt.enrich(copy.deepcopy(view), bank=bank, index=catalogs["questions"], source_map=view.get("source_map"), inferred=None, decisions=None)
        qt.enrich(view, bank=bank, index=catalogs["questions"], source_map=view.get("source_map"), inferred=None, decisions=None, section_ties=sections)
        listed = {s["page"]: [(t["question_id"], t["tie"], t["granularity"], t["section"]["page_ranges"], t["section"]["label"], t["section"]["scope"], t["transcript_lines"]) for t in s["section_ties"]]
                  for s in view["slides"] if s["section_ties"]}
        assert listed == {2: [("BE505-L01-Q01", "stated", "section", [[2, 3]], "Synthetic topic one", "all", [[1, 4]])], 3: [("BE505-L01-Q01", "stated", "section", [[2, 3]], "Synthetic topic one", "all", [[1, 4]])],
                          4: [("BE505-L01-Q04", "stated", "section", [[4, 4]], "Synthetic topic two", "all", [[5, 6]])]}
        assert [s["question_ties"] for s in view["slides"]] == [s["question_ties"] for s in plain["slides"]]  # the pages' own lists are what they were
        assert view["questions"]["counts"] == dict(plain["questions"]["counts"], course_section=2)
        coarse = next(q for q in view["questions"]["all"] if q["question_id"] == "BE505-L01-Q04")
        assert [(t["tie"], t["granularity"], t["from"], t["pages"]) for t in coarse["ties"]] == [("stated", "section", "course_study_map", [4])]
        assert coarse["no_link"] == {"state": "no_suggestion", "reason": "no_file"}  # the section says where to look; no page link exists and the row says why
    finally:
        journal.close()
