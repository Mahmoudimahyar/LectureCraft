"""R1-Q1/Q1b/Q2/Q4/Q5: the question bank, the three question scopes of a lecture, originals and renditions, deck choice.

The synthetic catalog holds the shapes found in a real one: a collection that names no slide, comma-listed slides, a
transcript-only locator, a question sheet that sorts before the deck, a question whose original is a .docx, and a
lecture unit with no collection at all. Counts are taken from the fixture catalog, not written into the code under test.
"""
from __future__ import annotations

import json
import shutil

import pytest

from lecture_brain.fixtures import content
from lecture_brain.journal import Journal
from lecture_brain.preparation import Preparation
from lecture_brain.projections import Projector

NOW = "2026-10-05T12:00:00Z"
ANSWERS = [q["answer"] for q in content.BE505_QUESTIONS]


@pytest.fixture()
def projector(settings, clock):
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    prep.prepare_course("be505")
    yield Projector(settings, journal, preparation=prep, now=lambda: NOW)
    journal.close()


def by_collection():
    out: dict[str, list[str]] = {}
    for q in content.BE505_QUESTIONS:
        out.setdefault(q["collection"], []).append(q["question_id"])
    return out


# ---- the bank ---------------------------------------------------------------------------------------
def test_the_bank_lists_every_catalogued_question_under_its_collection_with_real_totals(projector):
    bank = projector.questions_view("be505", limit=200)
    expected = by_collection()
    assert bank["total"] == len(content.BE505_QUESTIONS) == bank["matching"]
    assert {c["collection"]: c["count"] for c in bank["collections"]} == {k: len(v) for k, v in expected.items()}
    assert sorted(q["question_id"] for q in bank["items"]) == sorted(q["question_id"] for q in content.BE505_QUESTIONS)
    lectures = {l["lecture_id"]: l for l in bank["lectures"]}
    assert lectures["lecture-01"]["collections"] == ["L01"] and lectures["lecture-01"]["count"] == len(expected["L01"])
    # the sheet's own collection belongs to the same unit, as a separate collection
    assert lectures["lecture-04"]["collections"] == ["L04", "L04-class"] and lectures["lecture-04"]["count"] == len(expected["L04"]) + len(expected["L04-class"])
    # a unit with no catalogued collection shows the gap; nothing is generated for it
    assert lectures["lecture-03"]["count"] == 0 and "No question collection" in lectures["lecture-03"]["gap"]
    # problem-set collections are in the bank without being attached to a lecture
    assert next(c for c in bank["collections"] if c["collection"] == "PS01")["lecture_ids"] == []


def test_lists_page_through_the_whole_set_and_always_state_the_true_total(projector):
    seen, offset = [], 0
    while True:
        page = projector.questions_view("be505", offset=offset, limit=4)
        assert page["total"] == len(content.BE505_QUESTIONS) and len(page["items"]) <= 4
        seen += [q["question_id"] for q in page["items"]]
        if page["next_offset"] is None:
            break
        offset = page["next_offset"]
    assert len(seen) == len(set(seen)) == len(content.BE505_QUESTIONS)


def test_filters_and_search_work_on_the_whole_collection_not_on_a_loaded_page(projector):
    only = projector.questions_view("be505", lecture_id="lecture-04", limit=1)
    assert only["matching"] == 3 and only["total"] == len(content.BE505_QUESTIONS) and len(only["items"]) == 1
    assert projector.questions_view("be505", collection="PS03")["matching"] == 1
    assert [q["question_id"] for q in projector.questions_view("be505", text="BE505-L01-Q04")["items"]] == ["BE505-L01-Q04"]  # findable by id
    assert projector.questions_view("be505", text="inducer")["matching"] >= 2
    unresolved = projector.questions_view("be505", anchor="no_slide", lecture_id="lecture-01")
    assert [q["question_id"] for q in unresolved["items"]] == ["BE505-L01-Q04"]
    assert projector.questions_view("be505", origin="course_source")["matching"] == sum(1 for q in content.BE505_QUESTIONS if q["origin"] == "course_source")


def test_nothing_is_silently_cut_when_a_catalog_is_large(projector, settings):
    """The old Review list stopped at 40 and the server at 200. A catalog of 260 questions is listed in full."""
    path = settings.course("be505").root / "learning" / "question-index.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    template = doc["questions"][0]
    doc["questions"] += [dict(template, question_id=f"BE505-L01-X{n:03d}", number=100 + n, title=f"Synthetic filler {n}") for n in range(260 - len(doc["questions"]))]
    path.write_text(json.dumps(doc), encoding="utf-8")
    review = projector.review_view("be505")
    assert review["available_total"] == len(review["available_questions"]) == 260 - len(review["items"])
    assert projector.questions_view("be505", limit=50)["total"] == 260
    assert projector.questions_view("be505", lecture_id="lecture-01", limit=500)["matching"] == len(by_collection()["L01"]) + 260 - len(content.BE505_QUESTIONS)


# ---- three scopes in a lecture ------------------------------------------------------------------------
def test_a_question_without_a_slide_anchor_is_still_a_lecture_question(projector):
    view = projector.lecture_view("be505", "lecture-01")
    everything = {q["question_id"]: q for q in view["questions"]["all"]}
    assert set(everything) == set(by_collection()["L01"])
    q04 = everything["BE505-L01-Q04"]
    assert q04["slide_anchor"] == "none" and q04["anchor_state"] == "unresolved" and "companion hierarchy" in q04["locator_text"]
    assert all("BE505-L01-Q04" not in [q["question_id"] for q in s["questions"]] for s in view["slides"])  # no false slide claim
    on_slide_2 = next(q for q in view["slides"][1]["questions"] if q["question_id"] == "BE505-L01-Q01")
    assert on_slide_2["basis"] == "stated" and "slide 2" in on_slide_2["why"].lower()  # page basis of this collection is not reviewed
    assert view["questions"]["gap"] is None and view["questions"]["collections"][0]["collection"] == "L01"


def test_listed_slides_stay_a_list_and_transcript_lines_are_not_slides(projector):
    view = projector.lecture_view("be505", "lecture-04")
    per_slide = {s["page"]: [q["question_id"] for q in s["questions"]] for s in view["slides"]}
    assert per_slide == {1: ["BE505-L04-Q01"], 2: [], 3: ["BE505-L04-Q01"]}  # "Slides 1, 3" is not slides 1-3; "Transcript 3-5" is not slide 3
    assert view["slides"][0]["questions"][0]["basis"] == "exact"  # this collection's page basis is recorded as reviewed
    everything = {q["question_id"]: q for q in view["questions"]["all"]}
    assert set(everything) == set(by_collection()["L04"]) | set(by_collection()["L04-class"])
    lines = [a for a in everything["BE505-L04-Q02"]["anchors"] if a["kind"] == "transcript_lines"]
    assert lines and lines[0]["ranges"] == [[3, 5]] and everything["BE505-L04-Q02"]["slide_anchor"] == "none"
    assert lines[0]["source_id"] is None and lines[0]["resolution"] == "no_transcript_linked_to_unit"
    sheet = next(a for a in everything["BE505-L04-CLASS-Q01"]["anchors"] if a["kind"] == "pages")
    assert sheet["source_id"] == "src-lecture-04-in-class-questions" and sheet["pages"] == [1]
    # a page of the question sheet is a page of that file, not a slide of the lecture deck
    assert sheet["on_displayed_deck"] is False and everything["BE505-L04-CLASS-Q01"]["slide_anchor"] == "none"
    assert all(a["on_displayed_deck"] for a in everything["BE505-L04-Q01"]["anchors"] if a["kind"] == "pages") and everything["BE505-L04-Q01"]["slide_anchor"] == "named"


def test_related_questions_are_separate_from_the_lectures_own(projector):
    view = projector.lecture_view("be505", "lecture-04")
    related = {q["question_id"]: q for q in view["questions"]["related_by_relationship"]}
    assert set(related) == {"BE505-PS03-Q01"}
    via = related["BE505-PS03-Q01"]["via"]
    assert via == [{"question_id": "BE505-L04-Q01", "relation": "diagnostic_prerequisite", "direction": "from_lecture_question", "automatic_credit": False}]
    assert "BE505-PS03-Q01" not in [q["question_id"] for q in view["questions"]["all"]]
    # concepts of a slide come from the questions and skills the catalog anchors there, each with its basis
    assert view["slides"][0]["concepts"] and all(c["basis"] for c in view["slides"][0]["concepts"])
    assert all("concept_ids" in q for q in view["questions"]["all"])  # lets the client group "related concepts" without a second authority


def test_a_lecture_without_a_collection_shows_the_gap(projector):
    view = projector.lecture_view("be505", "lecture-03")
    assert view["questions"]["all"] == [] and "No question collection" in view["questions"]["gap"]


# ---- displayed deck -----------------------------------------------------------------------------------
def test_the_deck_is_the_lecture_slides_source_and_the_sheet_is_a_related_source(projector):
    view = projector.lecture_view("be505", "lecture-04")
    assert view["deck"]["source_id"] == "src-lecture-04-slides" and view["page_count"] == 3
    assert view["deck_choice"]["state"] == "selected" and view["deck_choice"]["basis"] == "index_kind"
    assert [m["source_id"] for m in view["other_materials"]] == ["src-lecture-04-in-class-questions"]
    row = next(l for l in projector.course_view("be505")["lectures"] if l["lecture_id"] == "lecture-04")
    assert row["deck"]["source_id"] == "src-lecture-04-slides" and row["title"] == "Fixture Lecture 04 - Induction lab"
    assert row["questions"] == {"count": 3, "collections": ["L04", "L04-class"]}


def test_equal_candidates_are_offered_for_a_local_choice(settings, clock):
    root = settings.course("be505").root
    unit = root / "materials/lectures/lecture-03"
    original = next(unit.glob("*.pdf"))
    shutil.copy(next((root / "materials/lectures/lecture-01").glob("*.pdf")), unit / "Another reading.pdf")
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    prep.prepare_course("be505")
    projector = Projector(settings, journal, preparation=prep, now=lambda: NOW)
    try:
        view = projector.lecture_view("be505", "lecture-03")
        assert view["deck"] is None and view["display"]["kind"] == "choose_deck" and view["deck_choice"]["state"] == "unresolved"
        names = sorted(c["filename"] for c in view["deck_choice"]["candidates"])
        assert names == sorted(["Another reading.pdf", original.name])
        chosen = next(c for c in view["deck_choice"]["candidates"] if c["filename"] == "Another reading.pdf")
        picked = projector.lecture_view("be505", "lecture-03", deck=chosen["source_id"])
        assert picked["deck"]["filename"] == "Another reading.pdf" and picked["display"]["kind"] == "original_pdf" and picked["page_count"] >= 2
        assert picked["deck_choice"]["basis"] == "this_request" and original.name in [m["filename"] for m in picked["other_materials"]]
        assert projector.lecture_view("be505", "lecture-03", deck="src-lecture-01-slides")["deck"] is None  # a file of another unit cannot be chosen
        coverage = next(l for l in prep.coverage()["courses"]["be505"]["lectures"] if l["lecture_id"] == "lecture-03")
        assert coverage["disposition"].startswith("no_source") and "candidate" in coverage["disposition"]
    finally:
        journal.close()


# ---- original, rendition, and what never leaves the Brain ------------------------------------------------
def test_a_question_whose_original_cannot_be_displayed_offers_the_original_and_a_checked_copy(projector, settings):
    view = projector.question_view("be505", "BE505-PS03-Q01")
    assert view["prompt_in_index"] is False and view["collection"] == "PS03" and view["lecture_ids"] == []
    assert view["original"]["source_id"] == "src-ps-03-brief" and view["original"]["available"] is True and view["original"]["displayable"] is False
    assert view["display_rendition"] is None  # not offered as a rendition before the two files were compared
    assert view["related_copy"]["source_id"] == "src-ps-03-working-pdf" and view["related_copy"]["index_relation"] is True
    assert view["criteria_authorship"] == "tutor_authored"

    outcome = projector.verify_rendition("be505", "BE505-PS03-Q01")
    assert outcome["result"] == "match" and outcome["score"] >= 0.9 and "not compared" in outcome["scope"]
    view = projector.question_view("be505", "BE505-PS03-Q01")
    assert view["display_rendition"]["source_id"] == "src-ps-03-working-pdf" and view["display_rendition"]["label"] == "Display rendition" and view["display_rendition"]["page"] == 1
    assert view["original"]["source_id"] == "src-ps-03-brief"  # the original stays the authoritative, openable file

    # the check is bound to the bytes compared: a changed copy is no longer a verified rendition
    copy = settings.course("be505").root / "materials/assignments/ps-03/Fixture PS03 blank.pdf"
    copy.write_bytes(copy.read_bytes() + b"\n%% changed\n")
    assert projector.question_view("be505", "BE505-PS03-Q01")["display_rendition"] is None


def test_a_copy_with_different_wording_is_not_accepted(projector, settings):
    from lecture_brain.fixtures.builder import write_pdf

    copy = settings.course("be505").root / "materials/assignments/ps-03/Fixture PS03 blank.pdf"
    write_pdf(copy, [{"title": "Unrelated handout", "bullets": ["Completely different wording about ribosomes and membranes.", "Nothing here matches the assignment text at all.",
                                                              "Kinetics, diffusion, osmosis, gradients, vesicles, cytoskeleton."], "figure": "ring"}])
    outcome = projector.verify_rendition("be505", "BE505-PS03-Q01")
    assert outcome["result"] == "mismatch" and projector.question_view("be505", "BE505-PS03-Q01")["display_rendition"] is None


def test_guidance_resolves_for_every_entry_and_never_reaches_a_question_view(projector, settings):
    from lecture_brain.ownerio.catalogs import read_answer_guidance

    bank = projector.questions_view("be505", limit=200)
    # Two map files: the first holds every question that names no map of its own, the showcase unit (lecture-05) has its companion map. No question is in both.
    assert bank["guidance"] == {"adapter": "question-map-guidance/2", "files": 2, "resolved": len(content.BE505_QUESTIONS), "errors": []}
    root = settings.course("be505").root
    assert all(read_answer_guidance(root, q["question_id"]) == q["answer"] for q in content.BE505_QUESTIONS)
    payloads = [bank, projector.lecture_view("be505", "lecture-01"), projector.lecture_view("be505", "lecture-04"), projector.review_view("be505"), projector.search_index("be505"),
                projector.course_view("be505"), *[projector.question_view("be505", q["question_id"]) for q in content.BE505_QUESTIONS]]
    text = json.dumps(payloads)
    assert not [a for a in ANSWERS if a in text]
    assert '"answer"' not in text and "observable" not in text  # neither guidance nor rubric wording in question-only views
