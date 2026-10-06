"""R2-Q3 … R2-Q5, R2-Q10: the reader of ``ll.inferred-anchors/1``, its refusal and stale rules, the learner's decisions.

Everything here is synthetic. The unit tests build a tiny catalog and inventory by hand, so each rule is exercised on
its own; the route tests run against the generated fixture course through a small FastAPI app that registers only this
module's routes (the lead wires the same call into ``create_app``).
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lecture_brain import inferred_anchors as ia
from lecture_brain.config import CourseBinding, Settings

COURSE = "syn101"
INDEX_SHA = "1" * 64
DECK_SHA = "a" * 64
ALT_SHA = "b" * 64
L2_SHA = "c" * 64
GUIDANCE = "The synthetic marker answer says the gizmo rotates clockwise because the lever arm is longer on the left side."
RUBRIC = "States that the gizmo rotates clockwise and names the longer lever arm as the cause."
NOW = "2026-10-05T12:00:00Z"


# ---- a tiny synthetic course ----------------------------------------------------------------------------
def make_settings(tmp_path: Path) -> Settings:
    root = tmp_path / "course"
    root.mkdir(parents=True, exist_ok=True)
    binding = CourseBinding(COURSE, "2026-fall", root, "Synthetic 101", f"tutor-{COURSE}")
    return Settings(profile="local", repo=tmp_path, state_dir=tmp_path / "state", planner_root=tmp_path / "planner", planner_config=tmp_path / "planner" / "planner-config.yaml",
                    courses={COURSE: binding}, policy={})


def criterion(question_id: str, n: int, concept: str, wording: str = "Synthetic observable wording.") -> dict:
    return {"criterion_id": f"{question_id}.C{n:02d}", "tag": "core", "action": "explain", "observable": wording, "concept_id": concept, "skill_id": f"syn.skill.{n}", "action_types": ["explain"]}


def make_index() -> dict:
    questions = {
        "SYN-L01-Q01": {"question_id": "SYN-L01-Q01", "version": 2, "collection": "L01", "number": 1, "title": "Synthetic one", "prompt": "Synthetic prompt one.",
                        "criteria": [criterion("SYN-L01-Q01", 1, "syn.concept.a", RUBRIC), criterion("SYN-L01-Q01", 2, "syn.concept.b"), criterion("SYN-L01-Q01", 3, "syn.concept.c")]},
        "SYN-L01-Q02": {"question_id": "SYN-L01-Q02", "version": 1, "collection": "L01", "number": 2, "title": "Synthetic two (no criteria catalogued)", "prompt": "Synthetic prompt two.", "criteria": []},
        "SYN-PS01-Q01": {"question_id": "SYN-PS01-Q01", "version": 1, "collection": "PS01", "number": 1, "title": "Synthetic problem set one", "prompt": "Synthetic prompt three.",
                         "criteria": [criterion("SYN-PS01-Q01", 1, "syn.concept.a")]},
    }
    return {"sha256": INDEX_SHA, "revision": 1, "questions": questions, "concepts": {c: {"concept_id": c, "label": c.rsplit(".", 1)[-1].upper()} for c in ("syn.concept.a", "syn.concept.b", "syn.concept.c")},
            "relationships": []}


def deck(source_id: str, kind: str = "lecture_slides") -> dict:
    return {"source_id": source_id, "kind": kind, "path": f"materials/{source_id}.pdf", "state": "registered_readable", "rendition": "native_pdf", "filename": f"{source_id}.pdf",
            "version_id": "v1", "sha256": None, "disclosure": "open", "registration": "registered"}


def make_inventory() -> dict:
    return {"lectures": [
        {"lecture_id": "lecture-01", "title": "Synthetic lecture 1", "decks": [deck("src-l01-slides"), deck("src-l01-alt")], "extra_materials": [deck("src-l01-sheet", "in_class_question_sheet")],
         "deck_choice": {"source_id": "src-l01-slides"}, "sessions": []},
        {"lecture_id": "lecture-02", "title": "Synthetic lecture 2", "decks": [deck("src-l02-slides")], "extra_materials": [], "deck_choice": {"source_id": "src-l02-slides"}, "sessions": []},
    ], "sessions": [], "other_sources": [deck("src-ps-01", "problem_set")]}


SHAS = {"src-l01-slides": DECK_SHA, "src-l01-alt": ALT_SHA, "src-l02-slides": L2_SHA}
PAGES = {"src-l01-slides": 12, "src-l01-alt": 6, "src-l02-slides": 8}


def context(**overrides) -> dict:
    ctx = {"index": make_index(), "inventory": make_inventory(), "deck_sha256_of": lambda item: SHAS.get(item["source_id"]),
           "guidance_text_of": lambda question_id: GUIDANCE if question_id == "SYN-L01-Q01" else None, "page_count_of": lambda item: PAGES.get(item["source_id"])}
    ctx.update(overrides)
    return ctx


def item(**overrides) -> dict:
    base = {"question_id": "SYN-L01-Q01", "question_version": 2, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "source_sha256": DECK_SHA, "pages": [4, 5], "regions": None,
            "criteria": ["SYN-L01-Q01.C01", "SYN-L01-Q01.C02"], "coverage": "partial", "rationale": "Page 4 draws the lever and page 5 labels both arms; that is what criteria C01 and C02 ask about.",
            "state": "agent_inferred", "verifier": None}
    base.update(overrides)
    return base


def document(items: list, **overrides) -> dict:
    doc = {"contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": "2026-10-05T10:00:00Z", "producer": "claude-session", "question_index_sha256": INDEX_SHA, "items": items}
    doc.update(overrides)
    return doc


def write_raw(settings: Settings, doc, *, raw: bytes | None = None) -> Path:
    path = settings.state_dir / "inferred-anchors" / f"{COURSE}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw if raw is not None else json.dumps(doc).encode("utf-8"))
    return path


def read(settings: Settings, doc, **ctx) -> dict:
    write_raw(settings, doc)
    return ia.load(settings, COURSE, **context(**ctx))


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return make_settings(tmp_path)


# ---- the file as a whole --------------------------------------------------------------------------------
def test_a_course_without_a_file_reads_as_missing_and_holds_nothing(settings):
    loaded = ia.load(settings, COURSE, **context())
    assert loaded["file"] == {"state": "missing", "produced_at": None, "sha256": None, "question_index_matches": None, "producer": None, "reason": None}
    assert loaded["items"] == [] and loaded["stale"] == [] and loaded["rejected_by_verifier"] == [] and loaded["no_candidate"] == []
    assert loaded["refused"] == {"counts": {}, "items": []} and loaded["by_question"] == {}
    assert not (settings.state_dir / "inferred-anchors").exists()  # reading creates nothing


@pytest.mark.parametrize("raw, reason", [
    (b"{not json", "not_json"),
    (b"{" + b" " * 4_000_000 + b"}", "too_large"),
    (json.dumps(["a", "list"]).encode(), "not_an_object"),
    (json.dumps({"contract": "ll.inferred-anchors/2", "course_id": COURSE, "produced_at": "x", "producer": "p", "question_index_sha256": INDEX_SHA, "items": []}).encode(), "unsupported_contract"),
    (json.dumps({"contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": "x", "producer": "p", "question_index_sha256": INDEX_SHA, "items": {"a": 1}}).encode(), "invalid_header"),
    (json.dumps({"contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": "x", "producer": "p", "items": []}).encode(), "invalid_header"),
    (json.dumps({"contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": "x", "producer": "p", "question_index_sha256": INDEX_SHA, "items": [], "no_candidate": "none"}).encode(), "invalid_header"),
], ids=["not-json", "over-the-size-limit", "a-list", "another-contract-version", "items-not-a-list", "no-question-index-hash", "no-candidate-not-a-list"])
def test_a_file_that_cannot_be_read_as_the_contract_is_unreadable_and_nothing_is_taken_from_it(settings, raw, reason):
    write_raw(settings, None, raw=raw)
    loaded = ia.load(settings, COURSE, **context())
    assert loaded["file"]["state"] == "unreadable" and loaded["file"]["reason"] == reason
    assert loaded["file"]["sha256"] == hashlib.sha256(raw).hexdigest()  # which bytes were refused is still stated
    assert loaded["items"] == [] and loaded["by_question"] == {}


def test_a_file_made_for_another_course_is_refused_as_a_whole_and_every_item_is_counted(settings):
    loaded = read(settings, document([item(), item(pages=[7])], course_id="other999"))
    assert loaded["file"]["state"] == "unreadable" and loaded["file"]["reason"] == "course_mismatch"
    assert loaded["items"] == [] and loaded["refused"]["counts"] == {"course_mismatch": 2}


def test_a_byte_order_mark_does_not_make_a_file_unreadable_but_a_duplicate_key_does(settings):
    body = json.dumps(document([item()])).encode("utf-8")
    write_raw(settings, None, raw=b"\xef\xbb\xbf" + body)
    assert ia.load(settings, COURSE, **context())["file"]["state"] == "ok"
    write_raw(settings, None, raw=body[:-1] + b', "course_id": "other999"}')
    assert ia.load(settings, COURSE, **context())["file"]["reason"] == "not_json"


# ---- accepted items --------------------------------------------------------------------------------------
def test_an_accepted_item_keeps_exactly_the_contract_fields_and_gets_a_stable_suggestion_id(settings):
    loaded = read(settings, document([item()]))
    assert loaded["file"] == {"state": "ok", "produced_at": "2026-10-05T10:00:00Z", "sha256": loaded["file"]["sha256"], "question_index_matches": True, "producer": "claude-session", "reason": None}
    (accepted,) = loaded["items"]
    assert set(accepted) == {"suggestion_id", "question_id", "question_version", "lecture_id", "source_id", "source_sha256", "pages", "regions", "criteria", "per_page", "coverage", "rationale", "state",
                             "verifier"}
    assert accepted["pages"] == [4, 5] and accepted["criteria"] == ["SYN-L01-Q01.C01", "SYN-L01-Q01.C02"] and accepted["verifier"] == {"verdict": None, "note": None}
    assert accepted["per_page"] is None  # the producer said nothing page by page, so nothing is said here
    assert accepted["suggestion_id"] == ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5]) and accepted["suggestion_id"].startswith("ia-")
    assert loaded["by_question"]["SYN-L01-Q01"]["items"] == [accepted]
    # the id depends on the question, its version, the deck bytes and the pages — and on nothing else
    again = read(settings, document([item(rationale="Other words about the same pages and criteria C01 and C02.", coverage="main", pages=[5, 4])]))
    assert again["items"][0]["suggestion_id"] == accepted["suggestion_id"] and again["items"][0]["pages"] == [4, 5]
    others = {ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4]), ia.suggestion_id("SYN-L01-Q01", 3, DECK_SHA, [4, 5]), ia.suggestion_id("SYN-L01-Q01", 2, ALT_SHA, [4, 5]),
              ia.suggestion_id("SYN-L01-Q02", 2, DECK_SHA, [4, 5])}
    assert accepted["suggestion_id"] not in others and len(others) == 4


def test_a_version_written_as_text_or_as_a_number_is_the_same_version(settings):
    loaded = read(settings, document([item(question_version="2")]))
    assert len(loaded["items"]) == 1 and loaded["items"][0]["suggestion_id"] == ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])


def test_fields_the_producer_added_are_dropped_and_named_never_passed_on(settings):
    extra = item(confidence="high", per_page=[{"page": 4, "supports": ["SYN-L01-Q01.C01"], "what_is_on_the_page": "SYNTHETIC-PRIVATE-PAGE-NOTE"}], criteria_without_support=["SYN-L01-Q01.C03"])
    loaded = read(settings, document([extra], batch="b1"))
    assert len(loaded["items"]) == 1 and loaded["unknown_fields"] == {"file": ["batch"], "items": ["confidence", "criteria_without_support"], "no_candidate": [], "per_page": ["what_is_on_the_page"]}
    assert "SYNTHETIC-PRIVATE-PAGE-NOTE" not in json.dumps(loaded)


# ---- per-page support (optional; r2-read-api.md 1.4) ---------------------------------------------------------
def test_per_page_support_is_read_as_page_and_criterion_ids_and_nothing_else(settings):
    per_page = [{"page": 5, "supports": ["SYN-L01-Q01.C02", "SYN-L01-Q01.C01"], "what_is_on_the_page": "SYNTHETIC-PRIVATE-PAGE-NOTE", "looked_at": "SYNTHETIC-PRIVATE-LOOK"},
                {"page": 4, "supports": ["SYN-L01-Q01.C01"]}]
    loaded = read(settings, document([item(per_page=per_page)]))
    (accepted,) = loaded["items"]
    assert accepted["per_page"] == [{"page": 4, "supports": ["SYN-L01-Q01.C01"]}, {"page": 5, "supports": ["SYN-L01-Q01.C01", "SYN-L01-Q01.C02"]}]  # by page; ids in the order the item lists its criteria
    assert loaded["refused"]["counts"] == {} and loaded["unknown_fields"]["per_page"] == ["looked_at", "what_is_on_the_page"] and loaded["unknown_fields"]["items"] == []
    assert "SYNTHETIC-PRIVATE" not in json.dumps(loaded)
    assert accepted["suggestion_id"] == ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])  # what a page supports is no part of the suggestion's identity
    # a page may be named as supporting nothing, a page may be left out (then nothing is known about it), and null says nothing at all
    assert read(settings, document([item(per_page=[{"page": 4, "supports": []}])]))["items"][0]["per_page"] == [{"page": 4, "supports": []}]
    assert read(settings, document([item(per_page=None)]))["items"][0]["per_page"] is None


PER_PAGE_REFUSALS = [
    ("words in place of the list", "page 4 shows the lever"),
    ("an empty list", []),
    ("an entry that is not an object", ["page 4"]),
    ("a page the item does not name", [{"page": 9, "supports": ["SYN-L01-Q01.C01"]}]),
    ("a page written as text", [{"page": "4", "supports": ["SYN-L01-Q01.C01"]}]),
    ("a truth value as a page", [{"page": True, "supports": ["SYN-L01-Q01.C01"]}]),
    ("a page listed twice", [{"page": 4, "supports": ["SYN-L01-Q01.C01"]}, {"page": 4, "supports": ["SYN-L01-Q01.C02"]}]),
    ("no list of supported criteria", [{"page": 4}]),
    ("supported criteria that are not a list", [{"page": 4, "supports": "SYN-L01-Q01.C01"}]),
    ("a criterion of the question that the item does not list", [{"page": 4, "supports": ["SYN-L01-Q01.C03"]}]),
    ("a criterion of another question", [{"page": 4, "supports": ["SYN-PS01-Q01.C01"]}]),
    ("a criterion listed twice on one page", [{"page": 4, "supports": ["SYN-L01-Q01.C01", "SYN-L01-Q01.C01"]}]),
    ("a rubric sentence in place of a criterion id", [{"page": 4, "supports": [RUBRIC]}]),
]


@pytest.mark.parametrize("label, per_page", PER_PAGE_REFUSALS, ids=[r[0] for r in PER_PAGE_REFUSALS])
def test_per_page_support_that_does_not_fit_its_own_item_refuses_the_item(settings, label, per_page):
    loaded = read(settings, document([item(pages=[4, 5], per_page=per_page), item(pages=[9])]))
    assert loaded["refused"]["counts"] == {"invalid_per_page": 1}, loaded["refused"]
    assert [i["pages"] for i in loaded["items"]] == [[9]]  # not accepted with the list silently dropped, clipped or completed
    assert RUBRIC not in json.dumps(loaded["refused"]) and "lever" not in json.dumps(loaded["refused"])
    with pytest.raises(ia.InferredAnchorError) as refused:
        ia.store(settings, COURSE, document([item(pages=[4, 5], per_page=per_page)], produced_at="2026-10-06T10:00:00Z"), **context())
    assert refused.value.code == "refused_items"


def test_a_question_with_no_catalogued_criteria_takes_an_empty_list_and_nothing_else(settings):
    loaded = read(settings, document([item(question_id="SYN-L01-Q02", question_version=1, criteria=[], rationale="Pages 4 and 5 show the part of the prompt about the lever."),
                                      item(question_id="SYN-L01-Q02", question_version=1, criteria=["SYN-L01-Q01.C01"], pages=[6])]))
    assert [i["question_id"] for i in loaded["items"]] == ["SYN-L01-Q02"] and loaded["items"][0]["criteria"] == []
    assert loaded["refused"]["counts"] == {"unknown_criterion": 1}


def test_regions_are_bounded_boxes_on_the_named_pages(settings):
    good = [{"page": 4, "box": [0.1, 0.2, 0.6, 0.9]}]
    assert read(settings, document([item(regions=good)]))["items"][0]["regions"] == good
    for bad in ([{"page": 9, "box": [0.1, 0.2, 0.6, 0.9]}], [{"page": 4, "box": [0.6, 0.2, 0.1, 0.9]}], [{"page": 4, "box": [0, 0, 1.5, 1]}], [{"page": 4}], "top half", []):
        loaded = read(settings, document([item(regions=bad)]))
        assert loaded["items"] == [] and loaded["refused"]["counts"] == {"invalid_regions": 1}, bad


# ---- every refusal rule -----------------------------------------------------------------------------------
REFUSALS = [
    ("unknown question", {"question_id": "SYN-L09-Q99"}, "unknown_question"),
    ("unknown lecture", {"lecture_id": "lecture-77"}, "unknown_lecture"),
    ("a deck of another lecture", {"source_id": "src-l02-slides", "source_sha256": L2_SHA}, "source_not_a_deck_of_lecture"),
    ("a file of the unit that is not a deck", {"source_id": "src-l01-sheet"}, "source_not_a_deck_of_lecture"),
    ("a file outside every unit", {"source_id": "src-ps-01"}, "source_not_a_deck_of_lecture"),
    ("no page", {"pages": []}, "no_page"),
    ("page zero", {"pages": [0]}, "invalid_pages"),
    ("a page written as text", {"pages": ["4"]}, "invalid_pages"),
    ("a page listed twice", {"pages": [4, 4]}, "invalid_pages"),
    ("a truth value as a page", {"pages": [True]}, "invalid_pages"),
    ("pages that are not a list", {"pages": "4-5"}, "invalid_pages"),
    ("a page after the last page of the deck", {"pages": [4, 13]}, "page_outside_deck"),
    ("a criterion of another question", {"criteria": ["SYN-L01-Q01.C01", "SYN-PS01-Q01.C01"]}, "unknown_criterion"),
    ("no criterion although the question has some", {"criteria": []}, "no_criteria"),
    ("a criterion listed twice", {"criteria": ["SYN-L01-Q01.C01", "SYN-L01-Q01.C01"]}, "invalid_criteria"),
    ("an empty rationale", {"rationale": ""}, "empty_rationale"),
    ("a rationale of spaces", {"rationale": "  \n "}, "empty_rationale"),
    ("a coverage the format does not have", {"coverage": "whole"}, "outside_vocabulary"),
    ("a state the format does not have", {"state": "human_confirmed"}, "outside_vocabulary"),
    ("a verdict the format does not have", {"state": "agent_reviewed", "verifier": {"verdict": "approved", "note": "fine"}}, "outside_vocabulary"),
    ("reviewed without a verifier", {"state": "agent_reviewed", "verifier": None}, "reviewed_without_verdict"),
    ("reviewed without a verdict", {"state": "agent_reviewed", "verifier": {"verdict": None, "note": "looked"}}, "reviewed_without_verdict"),
    ("a verdict on an item that says it was not checked", {"state": "agent_inferred", "verifier": {"verdict": "upheld", "note": "ok"}}, "verdict_without_review"),
    ("a rationale that reproduces the guidance", {"rationale": f"Page 4 matters. {GUIDANCE}"}, "reproduces_guidance"),
    ("a rationale that reproduces a rubric sentence", {"rationale": f"Supports C01: {RUBRIC.upper()}"}, "reproduces_guidance"),
    ("a verifier note that reproduces the guidance", {"state": "agent_reviewed", "verifier": {"verdict": "upheld", "note": GUIDANCE.replace(",", " ")}}, "reproduces_guidance"),
    ("a missing field", {"source_sha256": ...}, "missing_field"),
    ("a hash that is not a hash", {"source_sha256": "abc"}, "invalid_field"),
]


@pytest.mark.parametrize("label, change, reason", REFUSALS, ids=[r[0] for r in REFUSALS])
def test_an_item_that_breaks_a_rule_is_refused_with_its_reason_and_nothing_is_repaired(settings, label, change, reason):
    bad = item(pages=[8], **{k: v for k, v in change.items() if k != "pages"}) if "pages" not in change else item(**change)
    for key, value in change.items():
        if value is ...:
            del bad[key]
    good = item()
    loaded = read(settings, document([bad, good]))
    assert loaded["refused"]["counts"] == {reason: 1}, loaded["refused"]
    assert [i["pages"] for i in loaded["items"]] == [[4, 5]]  # the good item beside it is unaffected; the bad one is not clipped, completed or guessed
    assert loaded["stale"] == [] and loaded["rejected_by_verifier"] == []
    (entry,) = loaded["refused"]["items"]
    assert entry["list"] == "items" and entry["index"] == 0 and entry["reason"] == reason
    assert GUIDANCE not in json.dumps(loaded["refused"]) and RUBRIC not in json.dumps(loaded["refused"])  # a refusal names ids and fields, never the text


def test_an_entry_that_is_not_an_object_is_refused(settings):
    loaded = read(settings, document(["SYN-L01-Q01 page 4", item()]))
    assert loaded["refused"]["counts"] == {"not_an_object": 1} and len(loaded["items"]) == 1


def test_shared_words_are_not_a_reproduction_and_a_short_guidance_cannot_be_checked(settings):
    words = "The gizmo rotates and the lever arm on the left side is drawn longer on page 4, which criterion C01 asks about."
    assert len(read(settings, document([item(rationale=words)]))["items"]) == 1
    short = context(guidance_text_of=lambda q: "clockwise rotation")
    write_raw(settings, document([item(rationale="Page 4 shows clockwise rotation of the gizmo for criteria C01 and C02.")]))
    assert len(ia.load(settings, COURSE, **short)["items"]) == 1


def test_a_deck_whose_page_count_cannot_be_read_supports_no_page_claim(settings):
    loaded = read(settings, document([item()]), page_count_of=lambda deck_item: None)
    assert loaded["items"] == [] and loaded["refused"]["counts"] == {"page_count_unknown": 1}


def test_two_different_items_for_the_same_pages_of_one_question_are_both_refused_and_an_exact_repeat_counts_once(settings):
    loaded = read(settings, document([item(), item(criteria=["SYN-L01-Q01.C03"], rationale="Page 5 also carries what criterion C03 asks about."), item(pages=[9])]))
    assert [i["pages"] for i in loaded["items"]] == [[9]] and loaded["refused"]["counts"] == {"conflicting_duplicate": 2}
    loaded = read(settings, document([item(), item(), item(pages=[9])]))
    assert [i["pages"] for i in loaded["items"]] == [[4, 5], [9]] and loaded["refused"]["counts"] == {} and loaded["duplicates_collapsed"] == 1


# ---- stale: kept, never a current link --------------------------------------------------------------------
def test_an_item_for_another_question_version_or_other_deck_bytes_is_stale_with_its_reason(settings):
    loaded = read(settings, document([item(question_version=1), item(source_sha256="d" * 64, pages=[6]), item(source_id="src-l01-alt", source_sha256=ALT_SHA, pages=[2]), item(pages=[9])]),
                  deck_sha256_of=lambda deck_item: {"src-l01-slides": DECK_SHA}.get(deck_item["source_id"]))
    assert [i["pages"] for i in loaded["items"]] == [[9]]
    assert [(s["pages"], s["stale_reason"]) for s in loaded["stale"]] == [([4, 5], "question_version_differs"), ([6], "source_bytes_differ"), ([2], "source_unavailable")]
    assert loaded["refused"]["counts"] == {} and all(s["suggestion_id"].startswith("ia-") for s in loaded["stale"])
    assert [s["stale_reason"] for s in loaded["by_question"]["SYN-L01-Q01"]["stale"]] == ["question_version_differs", "source_bytes_differ", "source_unavailable"]


def test_a_stale_item_is_not_judged_by_rules_that_belong_to_the_current_version(settings):
    """Criteria and page bounds of another version or other bytes cannot be checked against today's catalog and deck."""
    loaded = read(settings, document([item(question_version=1, criteria=["SYN-L01-Q01.C09"]), item(source_sha256="d" * 64, pages=[40])]))
    assert loaded["refused"]["counts"] == {} and [s["stale_reason"] for s in loaded["stale"]] == ["question_version_differs", "source_bytes_differ"]


def test_a_file_made_against_another_question_index_is_listed_as_made_for_an_earlier_catalog(settings):
    loaded = read(settings, document([item(), item(pages=[9], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Only shared words."}), item(question_id="SYN-GONE-Q01")],
                                     question_index_sha256="9" * 64, no_candidate=[{"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "Spoken only.", "verifier": {"confirmed": True, "note": None}}]))
    assert loaded["file"]["state"] == "made_for_earlier_catalog" and loaded["file"]["question_index_matches"] is False
    assert loaded["items"] == [] and loaded["rejected_by_verifier"] == [] and loaded["no_candidate"] == []
    assert [s["stale_reason"] for s in loaded["stale"]] == ["earlier_catalog", "earlier_catalog"] and loaded["refused"]["counts"] == {"unknown_question": 1}
    assert loaded["stale_no_candidate"] == [{"question_id": "SYN-PS01-Q01", "question_version": 1, "stale_reason": "earlier_catalog"}]


def test_without_a_readable_question_index_nothing_is_called_earlier_or_unknown(settings):
    """No catalog, no comparison: the file is not said to be older than a catalog nobody read, and no question is called unknown."""
    record = {"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "Spoken only.", "verifier": {"confirmed": True, "note": None}}
    loaded = read(settings, document([item(), item(question_id="SYN-GONE-Q01", pages=[9]), item(pages=[0])], no_candidate=[record]), index=None)
    assert loaded["file"]["state"] == "catalog_unavailable" and loaded["file"]["question_index_matches"] is None
    assert loaded["items"] == [] and loaded["no_candidate"] == [] and [s["stale_reason"] for s in loaded["stale"]] == ["catalog_unavailable", "catalog_unavailable"]
    assert loaded["refused"]["counts"] == {"invalid_pages": 1}  # what is wrong in itself is still refused
    assert loaded["stale_no_candidate"] == [{"question_id": "SYN-PS01-Q01", "question_version": 1, "stale_reason": "catalog_unavailable"}]
    assert ia.readback(loaded, index=None)["stale_by_reason"] == {"catalog_unavailable": 3}


# ---- the verifying pass -----------------------------------------------------------------------------------
def test_upheld_and_narrowed_items_are_links_and_a_rejected_item_is_kept_for_audit_only(settings):
    upheld = item(state="agent_reviewed", verifier={"verdict": "upheld", "note": "Both pages checked."})
    narrowed = item(pages=[7], criteria=["SYN-L01-Q01.C03"], state="agent_reviewed", verifier={"verdict": "narrowed", "note": "Page 8 dropped."}, rationale="Page 7 shows what criterion C03 asks about.")
    rejected = item(pages=[9], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Only shared vocabulary."})
    loaded = read(settings, document([upheld, narrowed, rejected]))
    assert [(i["pages"], i["state"], i["verifier"]["verdict"]) for i in loaded["items"]] == [([4, 5], "agent_reviewed", "upheld"), ([7], "agent_reviewed", "narrowed")]
    assert [(i["pages"], i["verifier"]) for i in loaded["rejected_by_verifier"]] == [([9], {"verdict": "rejected", "note": "Only shared vocabulary."})]
    assert all(i["verifier"]["verdict"] != "rejected" for i in loaded["items"])
    assert [i["pages"] for i in loaded["by_question"]["SYN-L01-Q01"]["rejected_by_verifier"]] == [[9]]


# ---- examined, no page found (D77) ------------------------------------------------------------------------
def test_no_candidate_records_are_read_with_the_same_care(settings):
    records = [
        {"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "The material was spoken; no page of the deck shows it.", "verifier": {"confirmed": True, "note": "Checked all pages."}},
        {"question_id": "SYN-L01-Q02", "question_version": 1, "why": "Nothing found.", "verifier": None},                       # not confirmed by a second pass
        {"question_id": "SYN-L09-Q99", "question_version": 1, "why": "Nothing found.", "verifier": {"confirmed": True, "note": None}},  # unknown question
        {"question_id": "SYN-L01-Q01", "question_version": 1, "why": "Nothing found.", "verifier": {"confirmed": True, "note": None}},  # another version
        {"question_id": "SYN-L01-Q01", "question_version": 2, "why": " ", "verifier": {"confirmed": True, "note": None}},               # no reason
        {"question_id": "SYN-L01-Q01", "question_version": 2, "why": GUIDANCE, "verifier": {"confirmed": True, "note": None}},          # the reason quotes guidance
        {"question_id": "SYN-L01-Q01", "question_version": 2, "why": "Nothing found.", "verifier": {"confirmed": "yes", "note": None}},  # not a truth value
    ]
    loaded = read(settings, document([], no_candidate=records))
    assert loaded["no_candidate"] == [
        {"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "The material was spoken; no page of the deck shows it.", "verifier": {"confirmed": True, "note": "Checked all pages."}},
        {"question_id": "SYN-L01-Q02", "question_version": 1, "why": "Nothing found.", "verifier": {"confirmed": False, "note": None}}]
    assert loaded["by_question"]["SYN-PS01-Q01"]["no_candidate"]["verifier"]["confirmed"] is True
    assert loaded["stale_no_candidate"] == [{"question_id": "SYN-L01-Q01", "question_version": 1, "stale_reason": "question_version_differs"}]
    assert loaded["refused"]["counts"] == {"unknown_question": 1, "empty_why": 1, "reproduces_guidance": 1, "outside_vocabulary": 1}
    assert {e["list"] for e in loaded["refused"]["items"]} == {"no_candidate"}
    # a file without the list reads exactly as before
    assert read(settings, document([item()]))["no_candidate"] == []


# ---- store ------------------------------------------------------------------------------------------------
def test_store_writes_the_contract_and_nothing_else_inside_the_private_state_area(settings):
    doc = document([item(confidence="high", per_page=[{"page": 4, "supports": ["SYN-L01-Q01.C01"], "what_is_on_the_page": "SYNTHETIC-PRIVATE-PAGE-NOTE"}, {"page": 5, "supports": ["SYN-L01-Q01.C02"]}])], batch="b1")
    result = ia.store(settings, COURSE, doc, **context())
    path = settings.state_dir / "inferred-anchors" / f"{COURSE}.json"
    assert result["status"] == "stored" and result["path"] == f"inferred-anchors/{COURSE}.json" and result["history"] is None
    assert result["accepted"] == 1 and result["refused"] == {} and result["dropped_fields"] == {"file": ["batch"], "items": ["confidence"], "no_candidate": [], "per_page": ["what_is_on_the_page"]}
    written = json.loads(path.read_text(encoding="utf-8"))
    assert set(written) == {"contract", "course_id", "produced_at", "producer", "question_index_sha256", "items"}
    assert set(written["items"][0]) == {"question_id", "question_version", "lecture_id", "source_id", "source_sha256", "pages", "regions", "criteria", "per_page", "coverage", "rationale", "state",
                                        "verifier"}
    # what each page supports is kept, as page and criterion ids only: the producer's note about the page stays out of the file
    assert written["items"][0]["per_page"] == [{"page": 4, "supports": ["SYN-L01-Q01.C01"]}, {"page": 5, "supports": ["SYN-L01-Q01.C02"]}]
    assert b"SYNTHETIC-PRIVATE-PAGE-NOTE" not in path.read_bytes()
    assert ia.load(settings, COURSE, **context())["items"][0]["per_page"] == written["items"][0]["per_page"]
    assert result["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest() == ia.load(settings, COURSE, **context())["file"]["sha256"]
    assert ia.load(settings, COURSE, **context())["items"][0]["suggestion_id"] == ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])
    assert sorted(p.relative_to(settings.state_dir).as_posix() for p in settings.state_dir.rglob("*") if p.is_file()) == [f"inferred-anchors/{COURSE}.json"]


def test_store_keeps_the_previous_file_as_a_numbered_history_copy(settings):
    first = ia.store(settings, COURSE, document([item()]), **context())
    assert ia.store(settings, COURSE, document([item()]), **context())["status"] == "unchanged"  # the same content writes nothing and keeps no copy
    second = ia.store(settings, COURSE, document([item(), item(pages=[9])], produced_at="2026-10-06T10:00:00Z"), **context())
    third = ia.store(settings, COURSE, document([item(pages=[9])], produced_at="2026-10-07T10:00:00Z"), **context())
    history = settings.state_dir / "inferred-anchors" / "history"
    assert (second["history"], third["history"]) == (f"inferred-anchors/history/{COURSE}.0001.json", f"inferred-anchors/history/{COURSE}.0002.json")
    assert hashlib.sha256((history / f"{COURSE}.0001.json").read_bytes()).hexdigest() == first["sha256"]
    assert hashlib.sha256((history / f"{COURSE}.0002.json").read_bytes()).hexdigest() == second["sha256"]
    assert [i["pages"] for i in ia.load(settings, COURSE, **context())["items"]] == [[9]]
    assert not [p for p in (settings.state_dir / "inferred-anchors").iterdir() if p.name.startswith(".tmp-")]


def test_store_refuses_what_the_reader_would_refuse_and_then_writes_nothing(settings):
    ia.store(settings, COURSE, document([item()]), **context())
    before = (settings.state_dir / "inferred-anchors" / f"{COURSE}.json").read_bytes()
    with pytest.raises(ia.InferredAnchorError) as refused:
        ia.store(settings, COURSE, document([item(), item(pages=[40])], produced_at="2026-10-06T10:00:00Z"), **context())
    assert refused.value.code == "refused_items" and refused.value.detail["counts"] == {"page_outside_deck": 1}
    for bad, code in ((document([item()], course_id="other999"), "course_mismatch"), (document([item()], contract="ll.inferred-anchors/9"), "unsupported_contract"), (["not", "a", "document"], "not_an_object")):
        with pytest.raises(ia.InferredAnchorError) as whole:
            ia.store(settings, COURSE, bad, **context())
        assert whole.value.code == code
    with pytest.raises(ia.InferredAnchorError) as huge:  # a file the reader could not read back is not written either
        ia.store(settings, COURSE, document([item(rationale="Synthetic filler about page 4. " * 140_000)]), **context())
    assert huge.value.code == "too_large"
    assert (settings.state_dir / "inferred-anchors" / f"{COURSE}.json").read_bytes() == before and not (settings.state_dir / "inferred-anchors" / "history").exists()
    # the producer may keep refused entries on purpose: they are written as given and refused again on every read
    loose = ia.store(settings, COURSE, document([item(), item(pages=[40])], produced_at="2026-10-06T10:00:00Z"), strict=False, **context())
    assert loose["status"] == "stored" and loose["refused"] == {"page_outside_deck": 1}
    assert ia.load(settings, COURSE, **context())["refused"]["counts"] == {"page_outside_deck": 1}


def test_a_course_id_can_never_name_a_path_outside_the_state_area(settings, tmp_path):
    for bad in ("../escape", "a/b", "", "..", "C:evil", "other999"):
        settings.courses[bad] = settings.courses[COURSE]  # even a binding that carries such a name does not make it a file name
        for call in (lambda: ia.store(settings, bad, document([item()], course_id=bad), **context()), lambda: ia.load(settings, bad, **context()),
                     lambda: ia.decide(settings, bad, "ia-" + "0" * 16, "confirmed", at=NOW), lambda: ia.decisions(settings, bad)):
            if bad == "other999":
                continue
            with pytest.raises(ia.InferredAnchorError) as refused:
                call()
            assert refused.value.code == "unknown_course"
        del settings.courses[bad]
    with pytest.raises(ia.InferredAnchorError) as unbound:
        ia.store(settings, "other999", document([item()], course_id="other999"), **context())  # a well-formed name that is not a bound course
    assert unbound.value.code == "unknown_course"
    assert not settings.state_dir.exists() and not (tmp_path / "escape.json").exists()


# ---- the learner's own decisions --------------------------------------------------------------------------
def test_a_decision_is_one_immutable_record_per_revision(settings):
    ia.store(settings, COURSE, document([item()]), **context())
    sid = ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])
    assert ia.decisions(settings, COURSE) == {}
    first = ia.decide(settings, COURSE, sid, "confirmed", at=NOW, suggestion=ia.load(settings, COURSE, **context())["items"][0])
    folder = settings.state_dir / "inferred-anchors" / "decisions" / COURSE
    assert first["status"] == "recorded" and first["revision"] == 1 and first["decision"] == "confirmed"
    record = json.loads((folder / f"{sid}.r1.json").read_text(encoding="utf-8"))
    assert record == {"contract": "inferred-anchor-decision/1", "course_id": COURSE, "suggestion_id": sid, "revision": 1, "supersedes": None, "decision": "confirmed", "author": "learner",
                      "decided_at": NOW, "suggestion": {"question_id": "SYN-L01-Q01", "question_version": 2, "lecture_id": "lecture-01", "source_id": "src-l01-slides", "source_sha256": DECK_SHA, "pages": [4, 5]}}
    assert "rationale" not in json.dumps(record)
    first_bytes = (folder / f"{sid}.r1.json").read_bytes()
    assert ia.decide(settings, COURSE, sid, "confirmed", at="2026-10-05T12:05:00Z")["status"] == "unchanged"  # saying the same thing again is not a new decision
    second = ia.decide(settings, COURSE, sid, "rejected", at="2026-10-05T12:10:00Z")
    third = ia.decide(settings, COURSE, sid, "cleared", at="2026-10-05T12:20:00Z")
    assert (second["revision"], third["revision"]) == (2, 3) and sorted(p.name for p in folder.iterdir()) == [f"{sid}.r1.json", f"{sid}.r2.json", f"{sid}.r3.json"]
    assert (folder / f"{sid}.r1.json").read_bytes() == first_bytes  # history is never rewritten
    assert json.loads((folder / f"{sid}.r2.json").read_text(encoding="utf-8"))["supersedes"] == {"revision": 1, "sha256": hashlib.sha256(first_bytes).hexdigest()}
    current = ia.decisions(settings, COURSE)
    assert set(current) == {sid} and current[sid]["decision"] == "cleared" and current[sid]["revision"] == 3 and current[sid]["decided_at"] == "2026-10-05T12:20:00Z"
    assert current[sid]["suggestion"]["pages"] == [4, 5]  # what the decision was about travels with every revision


def test_a_second_different_record_with_the_same_revision_is_refused_never_last_write_wins(settings):
    sid = "ia-" + "1" * 16
    ia.decide(settings, COURSE, sid, "confirmed", at=NOW)
    path = settings.state_dir / "inferred-anchors" / "decisions" / COURSE / f"{sid}.r1.json"
    before = path.read_bytes()
    rival = dict(json.loads(before), decision="rejected", decided_at="2026-10-05T12:30:00Z")
    with pytest.raises(ia.InferredAnchorError) as conflict:
        ia.put_decision(settings, COURSE, rival)
    assert conflict.value.code == "conflict" and path.read_bytes() == before and ia.decisions(settings, COURSE)[sid]["decision"] == "confirmed"
    assert ia.put_decision(settings, COURSE, json.loads(before))["status"] == "already_saved"  # the same record again is a retry, not a conflict
    # a writer that read revision 1 and lost the race to revision 2 is told so
    ia.decide(settings, COURSE, sid, "rejected", at="2026-10-05T12:40:00Z")
    with pytest.raises(ia.InferredAnchorError) as stale:
        ia.decide(settings, COURSE, sid, "cleared", at="2026-10-05T12:50:00Z", expected_revision=1)
    assert stale.value.code == "conflict" and ia.decisions(settings, COURSE)[sid]["decision"] == "rejected"
    # a record that does not follow the chain is refused as well
    with pytest.raises(ia.InferredAnchorError):
        ia.put_decision(settings, COURSE, dict(rival, revision=5, supersedes={"revision": 4, "sha256": "0" * 64}))
    with pytest.raises(ia.InferredAnchorError):
        ia.put_decision(settings, COURSE, dict(rival, revision=3, supersedes={"revision": 2, "sha256": "0" * 64}))


@pytest.mark.parametrize("sid, decision", [("ia-" + "1" * 16, "approved"), ("ia-" + "1" * 16, ""), ("ia-xyz", "confirmed"), ("../ia-1111111111111111", "confirmed"), ("ia-" + "A" * 16, "confirmed")])
def test_a_decision_outside_the_vocabulary_or_for_a_malformed_id_is_refused(settings, sid, decision):
    with pytest.raises(ia.InferredAnchorError):
        ia.decide(settings, COURSE, sid, decision, at=NOW)
    assert not (settings.state_dir / "inferred-anchors").exists()


def test_clearing_where_nothing_was_decided_records_nothing(settings):
    outcome = ia.decide(settings, COURSE, "ia-" + "2" * 16, "cleared", at=NOW)
    assert outcome["status"] == "unchanged" and outcome["revision"] == 0 and outcome["decision"] is None and ia.decisions(settings, COURSE) == {}


def test_regenerating_the_suggestions_does_not_erase_decisions_and_a_vanished_suggestion_is_orphaned(settings):
    ia.store(settings, COURSE, document([item(), item(pages=[9])]), **context())
    kept, gone = ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5]), ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [9])
    loaded = ia.load(settings, COURSE, **context())
    for entry in loaded["items"]:
        ia.decide(settings, COURSE, entry["suggestion_id"], "confirmed" if entry["suggestion_id"] == kept else "rejected", at=NOW, suggestion=entry)
    # a new producing pass: the first item again with other words, the second one no longer proposed, a new one added
    ia.store(settings, COURSE, document([item(rationale="New words about pages 4 and 5 and criteria C01 and C02."), item(pages=[11])], produced_at="2026-10-06T10:00:00Z"), **context())
    current = ia.decisions(settings, COURSE)
    assert {k: v["decision"] for k, v in current.items()} == {kept: "confirmed", gone: "rejected"}
    report = ia.readback(ia.load(settings, COURSE, **context()), index=make_index(), decisions=current)["decisions"]
    assert report["confirmed"] == 1 and report["rejected"] == 1 and report["cleared"] == 0
    assert report["orphaned"] == [{"suggestion_id": gone, "decision": "rejected", "revision": 1, "decided_at": NOW, "question_id": "SYN-L01-Q01", "lecture_id": "lecture-01", "source_id": "src-l01-slides", "pages": [9]}]
    assert [d["suggestion_id"] for d in report["on_stale"]] == []
    # the deck changes: the confirmed suggestion is no longer current, the learner's record stays and says what it was for
    stale = ia.load(settings, COURSE, **context(deck_sha256_of=lambda deck_item: "e" * 64))
    report = ia.readback(stale, index=make_index(), decisions=ia.decisions(settings, COURSE))["decisions"]
    assert [d["suggestion_id"] for d in report["on_stale"]] == [kept] and [d["suggestion_id"] for d in report["orphaned"]] == [gone]


def test_the_reader_reports_a_confirmation_beside_an_item_the_verifying_pass_later_rejected(settings):
    """The reader sorts by the file alone: a rejected item is in the audit list whatever the learner decided, and the
    learner's record stays and is reported beside it. What is shown is decided where ties are made
    (``question_ties.enrich``): there the learner's confirmation stands (R2-Q5)."""
    ia.store(settings, COURSE, document([item()]), **context())
    sid = ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])
    ia.decide(settings, COURSE, sid, "confirmed", at=NOW, suggestion=ia.load(settings, COURSE, **context())["items"][0])
    ia.store(settings, COURSE, document([item(state="agent_reviewed", verifier={"verdict": "rejected", "note": "Only shared vocabulary."})], produced_at="2026-10-06T10:00:00Z"), **context())
    loaded = ia.load(settings, COURSE, **context())
    assert loaded["items"] == [] and [i["suggestion_id"] for i in loaded["rejected_by_verifier"]] == [sid]
    report = ia.readback(loaded, index=make_index(), decisions=ia.decisions(settings, COURSE))["decisions"]
    assert report["confirmed"] == 1 and [d["suggestion_id"] for d in report["on_rejected_by_verifier"]] == [sid] and report["orphaned"] == [] and report["on_stale"] == []


def test_a_damaged_decision_chain_is_reported_and_only_its_verified_part_counts(settings):
    sid = "ia-" + "3" * 16
    ia.decide(settings, COURSE, sid, "confirmed", at=NOW)
    ia.decide(settings, COURSE, sid, "rejected", at="2026-10-05T13:00:00Z")
    folder = settings.state_dir / "inferred-anchors" / "decisions" / COURSE
    tampered = dict(json.loads((folder / f"{sid}.r2.json").read_text(encoding="utf-8")), supersedes={"revision": 1, "sha256": "f" * 64})
    (folder / f"{sid}.r2.json").write_text(json.dumps(tampered), encoding="utf-8")
    (folder / "ia-4444444444444444.r1.json").write_text("{broken", encoding="utf-8")
    (folder / "notes.txt").write_text("not a record", encoding="utf-8")
    state = ia.decision_state(settings, COURSE)
    assert state["current"][sid]["decision"] == "confirmed" and state["current"][sid]["revision"] == 1
    assert sorted((p["code"], p["suggestion_id"]) for p in state["problems"]) == [("broken_revision_chain", sid), ("invalid_decision_file", "ia-4444444444444444")]
    with pytest.raises(ia.InferredAnchorError) as blocked:
        ia.decide(settings, COURSE, sid, "cleared", at="2026-10-05T14:00:00Z")
    assert blocked.value.code == "conflict"


def test_a_decision_record_not_made_by_the_learner_is_refused_and_is_no_decision(settings):
    sid = "ia-" + "7" * 16
    record = {"contract": "inferred-anchor-decision/1", "course_id": COURSE, "suggestion_id": sid, "revision": 1, "supersedes": None, "decision": "confirmed", "author": "agent_review",
              "decided_at": NOW, "suggestion": None}
    with pytest.raises(ia.InferredAnchorError) as refused:
        ia.put_decision(settings, COURSE, record)
    assert refused.value.code == "invalid_decision" and not (settings.state_dir / "inferred-anchors").exists()
    folder = settings.state_dir / "inferred-anchors" / "decisions" / COURSE
    folder.mkdir(parents=True)
    (folder / f"{sid}.r1.json").write_text(json.dumps(record), encoding="utf-8")  # put there by hand: reported, and it decides nothing
    state = ia.decision_state(settings, COURSE)
    assert state["current"] == {} and [(p["code"], p["suggestion_id"]) for p in state["problems"]] == [("invalid_decision_file", sid)]
    assert ia.put_decision(settings, COURSE, dict(record, author="learner", suggestion_id="ia-" + "8" * 16))["status"] == "recorded"


def test_a_number_too_long_to_read_makes_a_file_unreadable_and_a_decision_file_a_reported_problem(settings):
    """A private file that cannot be parsed is an answer ("unreadable"), not a crash of every view of the course."""
    for raw in (b'{"contract": "ll.inferred-anchors/1", "course_id": "syn101", "produced_at": ' + b"9" * 5000 + b', "items": []}', b"[" * 200_000):
        write_raw(settings, None, raw=raw)
        loaded = ia.load(settings, COURSE, **context())
        assert (loaded["file"]["state"], loaded["file"]["reason"], loaded["items"]) == ("unreadable", "not_json", []) and loaded["file"]["sha256"] == hashlib.sha256(raw).hexdigest()
    sid = "ia-" + "5" * 16
    ia.decide(settings, COURSE, sid, "confirmed", at=NOW)
    folder = settings.state_dir / "inferred-anchors" / "decisions" / COURSE
    (folder / "ia-6666666666666666.r1.json").write_bytes(b'{"revision": ' + b"9" * 5000 + b"}")
    (folder / "ia-6666666666666667.r1.json").write_bytes(b"[" * 200_000)
    state = ia.decision_state(settings, COURSE)
    assert state["current"][sid]["decision"] == "confirmed"
    assert [(p["code"], p["suggestion_id"]) for p in state["problems"]] == [("invalid_decision_file", "ia-6666666666666666"), ("invalid_decision_file", "ia-6666666666666667")]
    assert ia.decide(settings, COURSE, sid, "rejected", at="2026-10-05T13:00:00Z")["revision"] == 2  # one damaged file does not stop the other decisions


def _link_directory(link: Path, target: Path) -> bool:
    """A directory link that needs no privilege: a junction on Windows, a symlink elsewhere."""
    if sys.platform == "win32":
        return subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True).returncode == 0
    os.symlink(target, link, target_is_directory=True)
    return True


def test_nothing_is_read_or_written_through_a_link_that_leaves_the_state_area(settings, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    with pytest.raises(ia.InferredAnchorError) as barrier:
        ia._inside_state(settings, outside / "anything.json")
    assert barrier.value.code == "unsafe_path"
    assert ia._inside_state(settings, settings.state_dir / "inferred-anchors" / f"{COURSE}.json") == settings.state_dir / "inferred-anchors" / f"{COURSE}.json"
    # the area itself replaced by a directory link that leads elsewhere
    (outside / f"{COURSE}.json").write_text(json.dumps(document([item()])), encoding="utf-8")
    settings.state_dir.mkdir(parents=True)
    assert _link_directory(settings.state_dir / "inferred-anchors", outside), "could not create a directory link on this machine"
    before = sorted(p.name for p in outside.iterdir())
    for call in (lambda: ia.load(settings, COURSE, **context()), lambda: ia.store(settings, COURSE, document([item(pages=[9])]), **context()),
                 lambda: ia.decide(settings, COURSE, "ia-" + "9" * 16, "confirmed", at=NOW), lambda: ia.decisions(settings, COURSE)):
        with pytest.raises(ia.InferredAnchorError) as refused:
            call()
        assert refused.value.code == "unsafe_path"
    assert sorted(p.name for p in outside.iterdir()) == before


# ---- small rules that had no test of their own --------------------------------------------------------------
def test_eight_consecutive_words_of_protected_text_are_a_reproduction_and_seven_are_not():
    protected = "one two three four five six seven eight nine ten eleven twelve"
    assert ia.REPRODUCTION_RUN == 8 and ia.REPRODUCTION_SHORTEST == 5
    assert ia.reproduces("As said: three four five six seven eight nine ten, and so on.", protected)       # eight in a row
    assert not ia.reproduces("As said: three four five six seven eight nine, and so on.", protected)      # seven in a row
    assert not ia.reproduces("three four five six, then seven eight nine ten eleven", protected)          # nine of its words, never eight in a row
    # protected text of five to seven words: quoting it whole is a reproduction, a part of it is not
    short = "alpha beta gamma delta epsilon"
    assert ia.reproduces("It says: Alpha, beta gamma delta epsilon.", short) and not ia.reproduces("It says alpha beta gamma delta.", short)
    seven = "alpha beta gamma delta epsilon zeta eta"
    assert ia.reproduces("so alpha beta gamma delta epsilon zeta eta then", seven) and not ia.reproduces("so alpha beta gamma delta epsilon zeta then", seven)
    # under five words nothing can be told from ordinary wording
    assert not ia.reproduces("alpha beta gamma delta", "alpha beta gamma delta")


def test_a_reproduction_is_found_through_invisible_and_wide_characters(settings):
    soft = GUIDANCE.replace("gizmo", "giz­mo").replace("lever", "le­ver")                    # soft hyphens inside words
    zero = GUIDANCE.replace("rotates", "rot​ates").replace("lever", "le‍ver")                 # zero-width characters inside words
    wide = "".join(chr(ord(ch) + 0xFEE0) if "!" <= ch <= "~" else ch for ch in GUIDANCE)               # full-width letters
    for disguised in (soft, zero, wide):
        assert disguised != GUIDANCE and ia.reproduces(disguised, GUIDANCE)
        loaded = read(settings, document([item(rationale=f"Page 4 matters. {disguised}"), item(pages=[9])]))
        assert loaded["refused"]["counts"] == {"reproduces_guidance": 1} and [i["pages"] for i in loaded["items"]] == [[9]]


def test_a_region_id_is_a_short_id_and_never_free_text(settings):
    named = [{"page": 4, "box": [0.1, 0.2, 0.6, 0.9], "region_id": "r1"}]
    assert read(settings, document([item(regions=named)]))["items"][0]["regions"] == named
    for bad in ("the top half of the page", GUIDANCE, "r 1", "", 7):
        loaded = read(settings, document([item(regions=[dict(named[0], region_id=bad)])]))
        assert loaded["items"] == [] and loaded["refused"]["counts"] == {"invalid_regions": 1}, bad
        assert GUIDANCE not in json.dumps(loaded)


def test_text_written_where_an_id_belongs_is_never_repeated_in_a_refusal_or_the_readback(settings):
    prose = "SYNTHETIC-SENTENCE states the expected point in full"
    doc = document([item(pages=[2], criteria=[prose]), item(pages=[3], lecture_id=prose), item(pages=[6], question_id=prose), item(pages=[7], source_id=prose), item()],
                   no_candidate=[{"question_id": prose, "question_version": 1, "why": "Nothing found.", "verifier": None}])
    loaded = read(settings, doc)
    assert loaded["refused"]["counts"] == {"unknown_criterion": 1, "unknown_lecture": 1, "unknown_question": 2, "source_not_a_deck_of_lecture": 1} and len(loaded["items"]) == 1
    assert "SYNTHETIC-SENTENCE" not in json.dumps(loaded["refused"]) and "SYNTHETIC-SENTENCE" not in json.dumps(ia.readback(loaded, index=make_index()))
    assert [r["question_id"] for r in loaded["refused"]["items"]] == ["SYN-L01-Q01", "SYN-L01-Q01", None, "SYN-L01-Q01", None]
    # a value that has the form of an id is still named, so a wrong id can be found
    loaded = read(settings, document([item(pages=[2], criteria=["SYN-L01-Q01.C09", "SYN-L01-Q01.C01"]), item(pages=[3], question_id="SYN-L09-Q99"), item(pages=[6], lecture_id="lecture-77")]))
    assert [(r["reason"], r["question_id"], r["detail"]) for r in loaded["refused"]["items"]] == [
        ("unknown_criterion", "SYN-L01-Q01", "1 of 2 listed ids are not criteria of the question: SYN-L01-Q01.C09"), ("unknown_question", "SYN-L09-Q99", ""), ("unknown_lecture", "SYN-L01-Q01", "lecture-77")]


def test_the_same_pages_on_two_decks_with_equal_bytes_are_two_links_that_share_one_identity(settings):
    """The identity of a suggestion is the question, its version, the deck bytes and the pages; two files with the same bytes are two places."""
    same = {"deck_sha256_of": lambda deck_item: DECK_SHA if deck_item["source_id"] in {"src-l01-slides", "src-l01-alt"} else SHAS.get(deck_item["source_id"])}
    sid = ia.suggestion_id("SYN-L01-Q01", 2, DECK_SHA, [4, 5])
    loaded = read(settings, document([item(), item(source_id="src-l01-alt")]), **same)
    assert [(i["source_id"], i["suggestion_id"]) for i in loaded["items"]] == [("src-l01-slides", sid), ("src-l01-alt", sid)] and loaded["refused"]["counts"] == {}
    # two different claims about the same pages of the SAME deck are still not chosen between
    loaded = read(settings, document([item(), item(source_id="src-l01-alt"), item(source_id="src-l01-alt", coverage="main")]), **same)
    assert [i["source_id"] for i in loaded["items"]] == ["src-l01-slides"] and loaded["refused"]["counts"] == {"conflicting_duplicate": 2}


def test_strict_store_refuses_a_document_made_for_another_question_index_and_keeps_the_current_file(settings):
    ia.store(settings, COURSE, document([item()]), **context())
    path = settings.state_dir / "inferred-anchors" / f"{COURSE}.json"
    before = path.read_bytes()
    older = document([item(), item(pages=[9])], question_index_sha256="9" * 64, produced_at="2026-10-06T10:00:00Z")
    with pytest.raises(ia.InferredAnchorError) as refused:
        ia.store(settings, COURSE, older, **context())
    assert refused.value.code == "made_for_earlier_catalog"
    with pytest.raises(ia.InferredAnchorError) as unchecked:  # no readable catalog: nothing could be checked, so nothing replaces the current file
        ia.store(settings, COURSE, document([item(), item(pages=[9])], produced_at="2026-10-06T10:00:00Z"), **context(index=None))
    assert unchecked.value.code == "catalog_unavailable"
    assert path.read_bytes() == before and not (settings.state_dir / "inferred-anchors" / "history").exists()
    # written on purpose it reads as what it is: every item stale, none a link
    loose = ia.store(settings, COURSE, older, strict=False, **context())
    assert (loose["status"], loose["file_state"], loose["accepted"], loose["stale"]) == ("stored", "made_for_earlier_catalog", 0, 2)


def test_store_says_whether_the_guidance_was_compared(settings):
    assert ia.store(settings, COURSE, document([item()]), **context())["guidance_check"] == "guidance_and_criteria"
    assert ia.store(settings, COURSE, document([item(pages=[9])]), **context(guidance_text_of=None))["guidance_check"] == "criteria_only"
    without = context()
    del without["guidance_text_of"]  # a caller that hands over the catalog and says nothing about guidance: only the rubric wording was compared, and the result says so
    assert ia.store(settings, COURSE, document([item(pages=[11])]), **without)["guidance_check"] == "criteria_only"


# ---- readback ---------------------------------------------------------------------------------------------
def test_an_unconfirmed_no_candidate_record_does_not_count_a_question_as_inspected(settings):
    """D77: "examined, no page found" reads as inspected only once the verifying pass confirmed it."""
    records = [{"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "Nothing found on any page.", "verifier": None},
               {"question_id": "SYN-L01-Q02", "question_version": 1, "why": "Nothing found on any page.", "verifier": {"confirmed": False, "note": "Not looked at yet."}}]
    loaded = read(settings, document([], no_candidate=records))
    assert [r["verifier"]["confirmed"] for r in loaded["no_candidate"]] == [False, False]
    rows = {r["collection"]: r for r in ia.readback(loaded, index=make_index())["by_collection"]}
    assert (rows["PS01"]["questions_inspected_no_support"], rows["PS01"]["questions_without_suggestion"]) == (0, 1)
    assert (rows["L01"]["questions_inspected_no_support"], rows["L01"]["questions_without_suggestion"]) == (0, 2)
    records[0]["verifier"] = {"confirmed": True, "note": None}
    rows = {r["collection"]: r for r in ia.readback(read(settings, document([], no_candidate=records)), index=make_index())["by_collection"]}
    assert (rows["PS01"]["questions_inspected_no_support"], rows["PS01"]["questions_without_suggestion"]) == (1, 0) and rows["L01"]["questions_inspected_no_support"] == 0


def test_the_readback_counts_what_was_accepted_refused_stale_and_rejected_per_collection(settings):
    doc = document([
        item(),                                                                                                             # accepted
        item(pages=[7], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Only shared vocabulary."}),          # kept for audit
        item(pages=[40]),                                                                                                   # refused
        item(question_version=1, pages=[2]),                                                                                # stale
        item(question_id="SYN-L01-Q02", question_version=1, criteria=[], pages=[3], state="agent_reviewed", verifier={"verdict": "rejected", "note": "Nothing on the page."}),
    ], no_candidate=[{"question_id": "SYN-PS01-Q01", "question_version": 1, "why": "Spoken only.", "verifier": {"confirmed": True, "note": None}}])
    back = ia.readback(read(settings, doc), index=make_index())
    assert set(back) >= {"file", "accepted", "refused", "stale", "rejected_by_verifier", "by_collection"}
    assert back["file"] == {"state": "ok", "produced_at": "2026-10-05T10:00:00Z", "sha256": back["file"]["sha256"], "question_index_matches": True}
    assert (back["accepted"], back["stale"], back["rejected_by_verifier"], back["no_candidate"]) == (1, 1, 2, 1) and back["refused"] == {"page_outside_deck": 1}
    assert back["stale_by_reason"] == {"question_version_differs": 1}
    assert back["by_collection"] == [
        {"collection": "L01", "questions": 2, "accepted": 1, "stale": 1, "rejected_by_verifier": 2, "refused": 1, "questions_with_suggestion": 1, "questions_inspected_no_support": 1, "questions_without_suggestion": 0},
        {"collection": "PS01", "questions": 1, "accepted": 0, "stale": 0, "rejected_by_verifier": 0, "refused": 0, "questions_with_suggestion": 0, "questions_inspected_no_support": 1, "questions_without_suggestion": 0}]
    assert back["refused_items"] == [{"list": "items", "index": 2, "question_id": "SYN-L01-Q01", "reason": "page_outside_deck", "detail": "page 40 of 12"}]
    assert back["decisions"] == {"confirmed": 0, "rejected": 0, "cleared": 0, "orphaned": [], "on_stale": [], "on_rejected_by_verifier": [], "problems": []}
    text = json.dumps(back)
    assert "rationale" not in text and "Only shared vocabulary" not in text and GUIDANCE not in text and RUBRIC not in text  # counts and ids, no prose


def test_the_readback_of_a_course_without_a_file_lists_every_collection_as_without_suggestion(settings):
    back = ia.readback(ia.load(settings, COURSE, **context()), index=make_index())
    assert back["file"] == {"state": "missing", "produced_at": None, "sha256": None, "question_index_matches": None} and back["accepted"] == 0 and back["refused"] == {}
    assert [(c["collection"], c["questions"], c["questions_without_suggestion"]) for c in back["by_collection"]] == [("L01", 2, 2), ("PS01", 1, 1)]


# ---- routes, on the generated fixture course ---------------------------------------------------------------
def _tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


@pytest.fixture()
def fixture_app(workspace, tmp_path, clock):
    """The read-only profile on a copy of the synthetic workspace: app state is private, course folders are only read."""
    from lecture_brain.config import load_settings
    from lecture_brain.runtime import Runtime

    real = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "private-state")
    runtime = Runtime(real, clock=clock)
    app = FastAPI()
    ia.register(app, runtime, runtime.with_lock)
    try:
        yield real, runtime, TestClient(app)
    finally:
        runtime.journal.close()


def _fixture_document(real, runtime) -> dict:
    ctx = ia.course_context(real, "be505")
    lecture = next(l for l in ctx["inventory"]["lectures"] if l["lecture_id"] == "lecture-01")
    slides = next(d for d in lecture["decks"] if d["source_id"] == "src-lecture-01-slides")
    sha = ctx["deck_sha256_of"](slides)
    def entry(question_id, pages, **more):
        return {"question_id": question_id, "question_version": 1, "lecture_id": "lecture-01", "source_id": "src-lecture-01-slides", "source_sha256": sha, "pages": pages, "regions": None,
                "criteria": [f"{question_id}.C01"], "coverage": "partial", "rationale": "Synthetic: the named pages show the parts this criterion asks about.", "state": "agent_inferred", "verifier": None, **more}
    return {"contract": "ll.inferred-anchors/1", "course_id": "be505", "produced_at": NOW, "producer": "claude-session", "question_index_sha256": ctx["index"]["sha256"],
            "items": [entry("BE505-L01-Q04", [2, 3]), entry("BE505-PS01-Q01", [4]), entry("BE505-L01-Q04", [400])],
            "no_candidate": [{"question_id": "BE505-PS01-Q02", "question_version": 1, "why": "Synthetic: nothing on any page of the deck.", "verifier": {"confirmed": True, "note": None}}]}


def test_the_routes_are_exactly_the_two_of_the_read_api(fixture_app):
    _, _, client = fixture_app
    routes = {(method, route.path) for route in client.app.routes for method in getattr(route, "methods", set()) if route.path.startswith("/api/")}
    assert routes == {("GET", "/api/courses/{course_id}/inferred-anchors"), ("POST", "/api/courses/{course_id}/suggestions/{suggestion_id}/decision")}


def test_readback_route_reports_the_file_of_a_course_and_no_guidance(fixture_app):
    from lecture_brain.fixtures import content

    real, runtime, client = fixture_app
    assert client.get("/api/courses/be505/inferred-anchors").json()["file"]["state"] == "missing"
    assert client.get("/api/courses/nope/inferred-anchors").status_code == 404
    ia.store(real, "be505", _fixture_document(real, runtime), strict=False)  # the default context reads the catalog, the inventory, the deck bytes and the guidance itself
    response = client.get("/api/courses/be505/inferred-anchors")
    back = response.json()
    assert response.status_code == 200 and back["course_id"] == "be505" and back["file"]["state"] == "ok" and back["file"]["question_index_matches"] is True
    assert (back["accepted"], back["stale"], back["rejected_by_verifier"], back["no_candidate"]) == (2, 0, 0, 1) and back["refused"] == {"page_outside_deck": 1}
    rows = {c["collection"]: c for c in back["by_collection"]}
    assert set(rows) == {q["collection"] for q in content.BE505_QUESTIONS}
    assert rows["L01"]["questions_with_suggestion"] == 1 and rows["PS01"]["questions_with_suggestion"] == 1 and rows["PS01"]["questions_inspected_no_support"] == 1
    assert rows["L01"]["questions"] == sum(1 for q in content.BE505_QUESTIONS if q["collection"] == "L01")
    assert not [q["answer"] for q in content.BE505_QUESTIONS if q["answer"] in response.text]


def test_a_rationale_that_reproduces_the_fixture_guidance_is_refused_through_the_default_context(fixture_app):
    from lecture_brain.fixtures import content

    real, runtime, client = fixture_app
    doc = _fixture_document(real, runtime)
    doc["items"] = doc["items"][:1]
    doc["items"][0]["rationale"] = "Pages 2 and 3. " + next(q["answer"] for q in content.BE505_QUESTIONS if q["question_id"] == "BE505-L01-Q04")
    with pytest.raises(ia.InferredAnchorError) as refused:
        ia.store(real, "be505", doc)
    assert refused.value.detail["counts"] == {"reproduces_guidance": 1} and client.get("/api/courses/be505/inferred-anchors").json()["file"]["state"] == "missing"


def test_the_default_context_identifies_a_deck_by_its_bytes_so_a_changed_file_makes_its_suggestions_stale(fixture_app):
    """A producer records the hash of the bytes it inspected. The course index may still declare the old version after
    the file changed on disk; the suggestion is stale all the same, and it is a link again when the bytes are back."""
    real, runtime, client = fixture_app
    doc = _fixture_document(real, runtime)
    doc["items"] = doc["items"][:2]
    ia.store(real, "be505", doc)
    ctx = ia.course_context(real, "be505")
    slides = next(d for l in ctx["inventory"]["lectures"] if l["lecture_id"] == "lecture-01" for d in l["decks"] if d["source_id"] == "src-lecture-01-slides")
    path = real.course("be505").root / slides["path"]
    original = path.read_bytes()
    assert ctx["deck_sha256_of"](slides) == hashlib.sha256(original).hexdigest() == doc["items"][0]["source_sha256"]
    assert ia.guidance_reader(real.course("be505").root, ctx["index"])("BE505-L01-Q04") and ia.guidance_reader(real.course("be505").root, None) is None
    try:
        path.write_bytes(original + b"\n% synthetic change after the suggestions were made\n")
        loaded = ia.load(real, "be505", **ia.course_context(real, "be505"))
        assert loaded["items"] == [] and [s["stale_reason"] for s in loaded["stale"]] == ["source_bytes_differ", "source_bytes_differ"]
        assert client.get("/api/courses/be505/inferred-anchors").json()["stale_by_reason"] == {"source_bytes_differ": 2}
    finally:
        path.write_bytes(original)
    assert len(ia.load(real, "be505", **ia.course_context(real, "be505"))["items"]) == 2


def test_decision_route_records_the_learners_choice_in_private_state_only(fixture_app, workspace):
    real, runtime, client = fixture_app
    before = {cid: _tree(b.root) for cid, b in real.courses.items()}
    ia.store(real, "be505", _fixture_document(real, runtime), strict=False)
    loaded = ia.load(real, "be505", **ia.course_context(real, "be505"))
    sid = next(i["suggestion_id"] for i in loaded["items"] if i["question_id"] == "BE505-L01-Q04")
    url = f"/api/courses/be505/suggestions/{sid}/decision"
    accepted = client.post(url, json={"decision": "confirmed"})
    assert accepted.status_code == 200 and accepted.json() == {"course_id": "be505", "suggestion_id": sid, "decision": "confirmed", "revision": 1, "status": "recorded",
                                                              "decided_at": runtime.now(), "question_id": "BE505-L01-Q04"}
    assert client.post(url, json={"decision": "confirmed"}).json()["status"] == "unchanged"
    assert client.post(url, json={"decision": "rejected"}).json()["revision"] == 2
    assert client.get("/api/courses/be505/inferred-anchors").json()["decisions"]["rejected"] == 1
    assert client.post(url, json={"decision": "cleared"}).json() == {"course_id": "be505", "suggestion_id": sid, "decision": "cleared", "revision": 3, "status": "recorded",
                                                                    "decided_at": runtime.now(), "question_id": "BE505-L01-Q04"}
    # what cannot be decided
    assert client.post(url, json={"decision": "approved"}).status_code == 400
    assert client.post(url, json=["confirmed"]).status_code == 400
    assert client.post(url, content=b"{not json", headers={"content-type": "application/json"}).status_code == 400
    assert client.post("/api/courses/be505/suggestions/ia-0000000000000000/decision", json={"decision": "confirmed"}).status_code == 404  # no such suggestion is on screen
    assert client.post("/api/courses/be505/suggestions/not-an-id/decision", json={"decision": "confirmed"}).status_code == 404
    assert client.post(f"/api/courses/nope/suggestions/{sid}/decision", json={"decision": "confirmed"}).status_code == 404
    assert client.post("/api/courses/be505/suggestions/ia-0000000000000000/decision", json={"decision": "cleared"}).json()["status"] == "unchanged"  # nothing to clear, nothing written
    # everything written is under the private state area; the course folders are byte-identical
    folder = real.state_dir / "inferred-anchors" / "decisions" / "be505"
    assert sorted(p.name for p in folder.iterdir()) == [f"{sid}.r1.json", f"{sid}.r2.json", f"{sid}.r3.json"]
    assert {cid: _tree(b.root) for cid, b in real.courses.items()} == before


def test_a_decision_made_before_the_suggestions_were_regenerated_can_still_be_cleared(fixture_app):
    real, runtime, client = fixture_app
    doc = _fixture_document(real, runtime)
    ia.store(real, "be505", doc, strict=False)
    sid = ia.load(real, "be505", **ia.course_context(real, "be505"))["items"][0]["suggestion_id"]
    assert client.post(f"/api/courses/be505/suggestions/{sid}/decision", json={"decision": "rejected"}).status_code == 200
    regenerated = copy.deepcopy(doc)
    regenerated["items"] = regenerated["items"][1:2]
    ia.store(real, "be505", regenerated)
    back = client.get("/api/courses/be505/inferred-anchors").json()
    assert [d["suggestion_id"] for d in back["decisions"]["orphaned"]] == [sid]
    assert client.post(f"/api/courses/be505/suggestions/{sid}/decision", json={"decision": "confirmed"}).status_code == 404  # it is no longer a suggestion
    assert client.post(f"/api/courses/be505/suggestions/{sid}/decision", json={"decision": "cleared"}).json()["revision"] == 2


def test_the_decision_route_refuses_an_expected_revision_that_is_not_a_whole_number_and_reports_a_lost_race(fixture_app):
    real, runtime, client = fixture_app
    ia.store(real, "be505", _fixture_document(real, runtime), strict=False)
    sid = ia.load(real, "be505", **ia.course_context(real, "be505"))["items"][0]["suggestion_id"]
    url = f"/api/courses/be505/suggestions/{sid}/decision"
    for malformed in ("0", True, 0.5, [0], {"revision": 0}):
        assert client.post(url, json={"decision": "confirmed", "expected_revision": malformed}).status_code == 400, malformed
    assert ia.decisions(real, "be505") == {}  # a body that was refused decided nothing
    assert client.post(url, json={"decision": "confirmed", "expected_revision": 0}).json()["revision"] == 1
    assert client.post(url, json={"decision": "rejected", "expected_revision": 0}).status_code == 409  # the page that sent this had not seen revision 1
    assert client.post(url, json={"decision": "rejected", "expected_revision": 1}).json()["revision"] == 2


def test_a_confirmation_the_checking_pass_later_contradicted_can_still_be_changed_and_a_rejected_item_cannot_be_confirmed_anew(fixture_app):
    """An item the checking pass rejected is on screen only while the learner's own confirmation of it stands (R2-Q5)."""
    real, runtime, client = fixture_app
    doc = _fixture_document(real, runtime)
    doc["items"] = doc["items"][:2]
    ia.store(real, "be505", doc)
    kept, never = (ia.suggestion_id(i["question_id"], 1, i["source_sha256"], i["pages"]) for i in doc["items"])

    def post(sid: str, decision: str):
        return client.post(f"/api/courses/be505/suggestions/{sid}/decision", json={"decision": decision})

    assert post(kept, "confirmed").status_code == 200
    later = copy.deepcopy(doc)
    later["produced_at"] = "2026-10-06T09:00:00Z"
    for entry in later["items"]:
        entry.update(state="agent_reviewed", verifier={"verdict": "rejected", "note": "Synthetic note: the pages share words only."})
    ia.store(real, "be505", later)
    back = client.get("/api/courses/be505/inferred-anchors").json()
    assert back["accepted"] == 0 and back["rejected_by_verifier"] == 2 and [d["suggestion_id"] for d in back["decisions"]["on_rejected_by_verifier"]] == [kept]
    # rejected by the checking pass and never confirmed: it is not on screen, so there is nothing to decide about
    assert post(never, "confirmed").status_code == 404 and post(never, "rejected").status_code == 404
    # confirmed earlier: the learner's link is still there, so the learner can say it again, or reject it; once rejected only taking the decision back remains
    assert post(kept, "confirmed").json()["status"] == "unchanged"
    changed = post(kept, "rejected")
    assert changed.status_code == 200 and (changed.json()["decision"], changed.json()["revision"]) == ("rejected", 2)
    assert post(kept, "confirmed").status_code == 404
    assert post(kept, "cleared").json()["revision"] == 3
