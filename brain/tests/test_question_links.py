"""R1-Q1/Q3/Q5/Q6: collection membership, typed anchors, deck choice and the guidance join (pure read-side functions)."""
from __future__ import annotations

import json

import pytest

from lecture_brain.ownerio import OwnerReadError
from lecture_brain.ownerio.catalogs import read_answer_guidance, read_guidance
from lecture_brain.ownerio.inventory import choose_deck
from lecture_brain.ownerio.question_links import parse_locator


# ---- typed anchors (R1-Q3) -------------------------------------------------------------------------
def ranges(parsed, kind, target=None):
    target = target or ("cited" if kind == "pages" else "unit_transcript")
    return [a["ranges"] for a in parsed["anchors"] if a["kind"] == kind and a.get("target", "cited") == target]


def test_a_page_list_and_transcript_lines_are_separate_anchor_types():
    parsed = parse_locator("Slides 7, 9-14; transcript 34-145")
    assert ranges(parsed, "pages") == [[[7, 7], [9, 14]]]
    assert ranges(parsed, "transcript_lines") == [[[34, 145]]]
    pages = next(a for a in parsed["anchors"] if a["kind"] == "pages")
    assert pages["pages"] == [7, 9, 10, 11, 12, 13, 14]  # 8 is not named: a list is never widened into a range
    assert parsed["qualifiers"] == [] and parsed["state"] == "resolved"


def test_every_listed_page_after_a_comma_is_kept():
    parsed = parse_locator("Slides 17-19, 26; transcript 151-223, 295-322")
    assert ranges(parsed, "pages") == [[[17, 19], [26, 26]]]
    assert ranges(parsed, "transcript_lines") == [[[151, 223], [295, 322]]]


def test_trailing_notes_are_kept_verbatim_as_qualifiers():
    parsed = parse_locator("Slides 3-6; transcript 17-59; calculation tutor-created")
    assert ranges(parsed, "pages") == [[[3, 6]]]
    assert parsed["qualifiers"] == ["calculation tutor-created"]
    parsed = parse_locator("Slides 9-11; transcript 60-80, 90-99 (in-class question)")
    assert ranges(parsed, "transcript_lines") == [[[60, 80], [90, 99]]] and parsed["qualifiers"] == ["in-class question"]


def test_a_transcript_only_locator_names_no_slide():
    parsed = parse_locator("Transcript 454-460, 646-664 (in-class question)")
    assert ranges(parsed, "pages") == [] and ranges(parsed, "transcript_lines") == [[[454, 460], [646, 664]]]
    assert parsed["state"] == "resolved"  # it is anchored, just not to a slide


def test_a_page_of_another_named_source_is_not_a_slide_of_the_deck():
    parsed = parse_locator("In-class question PDF page 2 plus Q3 relationship; slides 12-13; transcript 5-9")
    assert ranges(parsed, "pages", "in_class_question_sheet") == [[[2, 2]]]
    assert ranges(parsed, "pages") == [[[12, 13]]]
    assert parsed["qualifiers"] == ["plus Q3 relationship"]


def test_page_and_question_number_of_the_cited_file():
    parsed = parse_locator("page 1, Question 1")
    assert ranges(parsed, "pages") == [[[1, 1]]] and parsed["qualifiers"] == ["Question 1"]


def test_a_coarse_locator_stays_unresolved_and_keeps_its_wording():
    text = "lecture scientific content; exact mapping in companion hierarchy/source map"
    parsed = parse_locator(text)
    assert parsed["anchors"] == [] and parsed["state"] == "unresolved" and parsed["text"] == text
    assert parsed["qualifiers"] == ["lecture scientific content", "exact mapping in companion hierarchy/source map"]


@pytest.mark.parametrize("text", ["Slides 7-145x; transcript 3", "Slides 9-3", "Slides 0-2", "Slides 2-9999"])
def test_a_malformed_or_implausible_list_is_not_guessed(text):
    parsed = parse_locator(text)
    assert ranges(parsed, "pages") == []
    assert parsed["unparsed"]  # reported, not silently dropped and not partly used


def test_a_structured_locator_from_the_catalog_is_passed_through():
    assert parse_locator(None)["state"] == "unresolved"
    assert parse_locator("")["state"] == "unresolved"


# ---- displayed deck (R1-Q5) ------------------------------------------------------------------------
def deck(source_id, kind="lecture_slides", *, registered=True, name=None, pdf=True, state=None, size=1000):
    return {"source_id": source_id, "kind": kind, "kind_basis": "owner_index" if registered else "folder_convention", "registration": "registered" if registered else "unregistered",
            "rendition": "native_pdf" if pdf else "needs_rendition", "state": state or ("registered_readable" if registered else "present_unindexed"),
            "filename": name or f"{source_id}.pdf", "bytes": size}


def test_the_lecture_slides_source_is_shown_not_the_question_sheet_that_sorts_first():
    sheet = deck("src-sheet", "in_class_question_sheet", name="05- questions.pdf", size=10)
    slides = deck("src-slides", name="Lecture 05.pdf", size=9000)
    choice = choose_deck([sheet, slides])
    assert choice["source_id"] == "src-slides" and choice["state"] == "selected" and choice["basis"] == "index_kind"
    assert choice["related_source_ids"] == ["src-sheet"]
    # neither order nor size decides
    assert choose_deck([slides, sheet])["source_id"] == "src-slides"
    assert choose_deck([dict(sheet, bytes=10**9), slides])["source_id"] == "src-slides"


def test_a_registered_deck_wins_over_an_unregistered_copy_beside_it():
    choice = choose_deck([deck("unreg-1", registered=False, name="A annotated.pdf"), deck("src-slides", name="B.pdf")])
    assert choice["source_id"] == "src-slides" and choice["basis"] == "index_kind"


def test_a_file_that_cannot_be_displayed_does_not_hide_a_readable_deck():
    empty = deck("src-empty", state="registered_empty", name="A.pdf")
    usable = deck("unreg-2", registered=False, name="B.pdf")
    assert choose_deck([empty, usable])["source_id"] == "unreg-2"
    pptx = deck("unreg-3", registered=False, pdf=False, name="A.pptx")
    choice = choose_deck([pptx, usable])
    assert choice["source_id"] == "unreg-2" and choice["basis"] == "only_displayable_candidate"


def test_equal_candidates_are_an_unresolved_choice_not_the_first_file():
    a, b = deck("unreg-a", registered=False, name="A reading.pdf"), deck("unreg-b", registered=False, name="B reading.pdf")
    choice = choose_deck([a, b])
    assert choice["state"] == "unresolved" and choice["source_id"] is None
    assert choice["candidate_source_ids"] == ["unreg-a", "unreg-b"]
    # an explicit reference (a question or a transcript relation naming one of them) decides
    named = choose_deck([a, b], referenced={"unreg-b"})
    assert (named["source_id"], named["state"], named["basis"]) == ("unreg-b", "selected", "explicit_reference")
    # a local override decides and says so; an override naming a file outside the unit is ignored
    assert choose_deck([a, b], override="unreg-a")["basis"] == "local_override"
    assert choose_deck([a, b], override="src-elsewhere")["state"] == "unresolved"


def test_a_unit_with_one_file_or_none():
    assert choose_deck([])["state"] == "none"
    only = choose_deck([deck("unreg-x", registered=False)])
    assert only["source_id"] == "unreg-x" and only["basis"] == "only_candidate"
    # a registered non-slide file alone is not presented as a slide deck
    info = choose_deck([deck("src-info", "lecture_information")])
    assert info["state"] == "none" and info["related_source_ids"] == ["src-info"]


# ---- assessor guidance join (R1-Q6) ----------------------------------------------------------------
def write_map(root, name, questions, version=1):
    path = root / "work" / "lecture-review" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": version, "questions": questions}), encoding="utf-8")


INDEX = {"Q-1": {"question_id": "Q-1", "version": 1}, "Q-2": {"question_id": "Q-2", "version": 1}, "Q-3": {"question_id": "Q-3", "version": 2}}


def test_guidance_is_joined_by_the_owners_entry_id(tmp_path):
    write_map(tmp_path, "lecture-03-question-map-v1.json", [{"id": "Q-1", "version": "1", "answer": "synthetic answer one"}, {"id": "Q-2", "answer": "synthetic answer two"}])
    guidance = read_guidance(tmp_path, INDEX)
    assert set(guidance["entries"]) == {"Q-1", "Q-2"} and guidance["errors"] == []
    assert guidance["entries"]["Q-2"]["version_basis"] == "file"  # no version on the entry: the file's version applies
    assert read_answer_guidance(tmp_path, "Q-1", INDEX) == "synthetic answer one"
    assert read_answer_guidance(tmp_path, "Q-3", INDEX) is None  # nothing is invented for a question without an entry


def test_the_older_question_id_key_is_still_accepted(tmp_path):
    write_map(tmp_path, "lecture-01-question-map-v1.json", [{"question_id": "Q-1", "answer": "synthetic"}])
    assert read_answer_guidance(tmp_path, "Q-1", INDEX) == "synthetic"


def test_conflicting_duplicate_unknown_and_wrong_revision_entries_are_explicit_errors(tmp_path):
    write_map(tmp_path, "lecture-03-question-map-v1.json", [
        {"id": "Q-1", "question_id": "Q-2", "answer": "which one?"},      # two identifiers that disagree
        {"id": "Q-9", "answer": "no such question"},                       # unknown
        {"id": "Q-3", "version": "1", "answer": "for an older revision"},  # question is at version 2
        {"id": "Q-2", "answer": "first"}])
    write_map(tmp_path, "lecture-04-question-map-v1.json", [{"id": "Q-2", "answer": "second"}])
    guidance = read_guidance(tmp_path, INDEX)
    codes = sorted((e["code"], e["entry_id"]) for e in guidance["errors"])
    assert codes == [("conflicting_identifiers", "Q-1"), ("duplicate_entry", "Q-2"), ("revision_mismatch", "Q-3"), ("unknown_question", "Q-9")]
    assert guidance["entries"] == {}  # none of these is used: a doubtful answer key is worse than none
    assert all("answer" not in e for e in guidance["errors"])  # diagnostics never carry guidance text


def test_an_unreadable_map_is_an_error_not_silence(tmp_path):
    path = tmp_path / "work" / "lecture-review" / "lecture-03-question-map-v1.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(OwnerReadError):
        read_guidance(tmp_path, INDEX)
