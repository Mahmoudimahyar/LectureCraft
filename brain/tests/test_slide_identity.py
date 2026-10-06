"""Slide identity for the lecture view (R2-S1 … R2-S11; docs/engineering/r2-read-api.md 1.1 and 1.2).

Every deck here is synthetic and generated into a pytest temp folder. The lecture view handed to ``enrich`` is a
hand-made stand-in with the fields ``Projector.lecture_view`` returns for its pages; nothing here reads a real course.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lecture_brain import alignment
from lecture_brain import slide_identity as si
from lecture_brain import sourcemap as sm
from lecture_brain.config import TERM, CourseBinding, Settings
from lecture_brain.fixtures.builder import write_slide_pdf, write_synthetic_pptx
from lecture_brain.ownerio.inventory import build_inventory, primary_deck

COURSE = "be505"
LECTURE = "lecture-01"
UNIT = f"materials/lectures/{LECTURE}"

AXES = [(150, 150, 240, 150), (150, 150, 150, 60)]
RISING = [(150, 150, 240, 70), (180, 150, 180, 120), (210, 150, 210, 95)]
PLOT = {"title": "Expression over time", "lines": ["time in hours", "expression level of the reporter"], "strokes": AXES + RISING}
POTENTIAL = ["Resting state sits near minus seventy millivolts", "Sodium channels open and the cell depolarises", "Potassium channels restore the resting state"]
DOSE = {"title": "Dose response", "bullets": ["Half maximal effect at the midpoint", "The slope reflects cooperativity"], "images": [{"seed": 3, "box": (150, 60, 60, 45)}]}
DECK = [
    {"title": "Synthetic Systems Biology", "lines": ["Lecture 4", "Robin Sample"]},  # 1 a plain cover
    {"title": "Learning objectives", "bullets": ["Explain feedback", "Compute a steady state", "Interpret a phase plot"]},  # 2
    {"title": "Action potential", "bullets": POTENTIAL[:1]},  # 3 a reveal in three pages ...
    {"title": "Action potential", "bullets": POTENTIAL[:2]},  # 4
    {"title": "Action potential", "bullets": POTENTIAL},  # 5
    {"title": "Refractory period", "bullets": ["Channels need time before they can open again"]},  # 6
    {**PLOT, "boxes": [(175, 112, 12, 12, "red")]},  # 7 one slide in two states: the highlight ...
    {**PLOT, "boxes": [(205, 88, 12, 12, "red")]},  # 8 ... moves
    DOSE,  # 9 a page ...
    dict(DOSE),  # 10 ... and the same page again
    {},  # 11 blank
    {"title": "Office hours and grading", "bullets": ["Office hours move to Thursday", "Homework 2 is due on Friday"]},  # 12 administrative
    {"images": [{"seed": 5, "box": (30, 20, 190, 140)}]},  # 13 nothing but a picture
    {"title": "Summary", "bullets": ["Feedback shapes speed and stability", "Steady states come from balance"]},  # 14
]
GROUPS = [[1], [2], [3, 4, 5], [6], [7, 8], [9, 10], [11], [12], [13], [14]]
# A presentation of six slides (one hidden, one blank) and the PDF made from it: seven pages, so no page number is a slide number.
PPTX_SLIDES = [
    {"title": "Cell signalling", "bullets": ["Synthetic lecture four"], "layout": "title"},
    {"title": "Backup: receptor table", "bullets": ["Receptor families listed for reference"], "hidden": True},
    {"title": "Second messengers", "bullets": ["Cyclic AMP relays the hormone signal", "Calcium release amplifies the response", "Each messenger is cleared quickly"]},
    {"layout": "blank"},
    {"title": "Kinase cascades", "bullets": ["Each kinase activates many copies of the next"]},
    {"title": "Summary", "bullets": ["Signals are relayed amplified and switched off"]},
]
SIGNALLING = [
    {"title": "Cell signalling", "lines": ["Synthetic lecture four"]},
    {"title": "Second messengers", "bullets": PPTX_SLIDES[2]["bullets"][:1]},
    {"title": "Second messengers", "bullets": PPTX_SLIDES[2]["bullets"][:2]},
    {"title": "Second messengers", "bullets": PPTX_SLIDES[2]["bullets"]},
    {"images": [{"seed": 4, "box": (40, 30, 160, 120)}]},
    {"title": "Kinase cascades", "bullets": PPTX_SLIDES[4]["bullets"]},
    {"title": "Summary", "bullets": PPTX_SLIDES[5]["bullets"]},
]
BLOCK_KEYS = {"state", "reason", "contract", "map_revision", "source", "page_index_base", "page_count", "page_layout", "printed_numbers_established", "pptx", "logical_slides",
              "denominators", "limitations", "override_revision"}
IDENTITY_KEYS = {"page_index", "page_count", "page_label", "printed_slide_number", "pptx", "logical_slide_id", "position", "label", "label_parts"}
ROLE_KEYS = {"value", "state", "uncertain", "forced_requirements", "basis"}
EXCLUDED = ("structural_title_or_section", "administrative", "blank")
INSTRUCTIONAL = ("instructional", "worked_example_or_question", "mixed")


# ---- helpers ------------------------------------------------------------------------------------------
def _map(tmp_path: Path, pages: list[dict] = DECK, name: str = "deck.pdf", **options) -> dict:
    path = tmp_path / name
    write_slide_pdf(path, pages)
    return sm.build_source_map(path, **options)


def _view(page_count: int | None, deck: dict | None = None) -> dict:
    """The part of a lecture view the enricher touches, shaped like ``Projector.lecture_view``: one row per physical page."""
    return {"course_id": COURSE, "lecture_id": LECTURE, "title": "Synthetic lecture", "deck": deck, "page_count": page_count, "display": {"kind": "original_pdf"},
            "slides": [{"page": n, "title": None, "text": None, "text_status": "not_prepared", "concepts": [], "questions": [], "occurrences": [], "transcript_ranges": [], "related": []}
                       for n in range(1, (page_count or 0) + 1)],
            "questions": {"all": []}, "recordings": [], "transcripts": []}


def _enriched(source_map: dict | None, page_count: int | None = None, reason: str | None = None) -> dict:
    view = _view(page_count if page_count is not None else (source_map or {}).get("page_count"))
    assert si.enrich(view, source_map=source_map, reason=reason) is None  # it mutates the view it is handed
    return view


def _row(view: dict, page: int) -> dict:
    row = view["slides"][page - 1]
    assert row["page"] == page
    return row


def _logical(block: dict, page: int) -> dict:
    return next(slide for slide in block["logical_slides"] if page in slide["pages"])


@pytest.fixture()
def course(tmp_path):
    """A read-only style binding over a tiny synthetic course folder: the app's own files are staged outside the course."""
    root = tmp_path / "course"
    (root / UNIT).mkdir(parents=True)
    binding = CourseBinding(COURSE, TERM, root, "Synthetic course", f"tutor-{COURSE}")
    settings = Settings(profile="local", repo=tmp_path, state_dir=tmp_path / "state", planner_root=tmp_path / "planner",
                        planner_config=tmp_path / "planner" / "planner-config.yaml", courses={COURSE: binding}, policy={})
    assert settings.writes_are_staged
    si.forget()  # what an earlier test kept in memory is not this test's
    return settings, root


def _shown(settings: Settings, lecture_id: str = LECTURE) -> tuple[dict, dict | None]:
    """The unit and the deck it is displayed with, read from the course folder as the lecture view reads them."""
    lecture = next(unit for unit in build_inventory(settings.course(COURSE))["lectures"] if unit["lecture_id"] == lecture_id)
    return lecture, primary_deck(lecture)


def _current(settings: Settings, lecture_id: str = LECTURE) -> tuple[dict | None, str | None]:
    lecture, deck = _shown(settings, lecture_id)
    return si.map_for(settings, COURSE, lecture, deck)


def _course_files(root: Path) -> dict[str, tuple[int, int]]:
    return {path.relative_to(root).as_posix(): (path.stat().st_size, path.stat().st_mtime_ns) for path in sorted(root.rglob("*")) if path.is_file()}


def _stored_maps(settings: Settings) -> list[Path]:
    return sorted(settings.app_area(COURSE).rglob("map-o*.json"))


def _count_inspections(monkeypatch) -> list[int]:
    """Every page the source map inspects from now on, by number."""
    inspected: list[int] = []
    real = sm._inspect_page
    monkeypatch.setattr(sm, "_inspect_page", lambda page, number, *args, **kwargs: inspected.append(number) or real(page, number, *args, **kwargs))
    return inspected


# ---- 1. the source_map object of the read API (r2-read-api.md 1.1) ----------------------------------------------
def test_the_block_is_the_source_map_object_of_the_read_api(tmp_path):
    source_map = _map(tmp_path)
    block = si.block(source_map)

    assert set(block) == BLOCK_KEYS
    assert block["state"] == "ready" and block["reason"] is None and block["contract"] == "source-map/1"
    assert block["map_revision"] == source_map["map_revision"] and block["override_revision"] == 0
    assert block["source"] == {key: source_map["source"][key] for key in ("source_id", "version_id", "sha256")}
    assert block["page_index_base"] == 1 and block["page_count"] == 14 and block["page_layout"] == "slides"
    assert block["printed_numbers_established"] is False
    assert [slide["pages"] for slide in block["logical_slides"]] == GROUPS  # every page, once, in order
    for slide in block["logical_slides"]:
        assert set(slide) == {"id", "kind", "pages", "title", "role", "grouping"}
        assert set(slide["grouping"]) == {"basis", "state", "confidence", "signals"}
        assert slide["id"] == source_map["pages"][slide["pages"][0] - 1]["logical_slide_id"] and slide["role"] in sm.ROLES
    assert block["limitations"] and all(isinstance(line, str) and line for line in block["limitations"])
    assert any("covered" in line for line in block["limitations"])  # what text extraction cannot tell is always said


def test_the_modules_group_kinds_are_spelled_as_the_read_api_spells_them(tmp_path):
    block = si.block(_map(tmp_path))
    kinds = {tuple(slide["pages"]): slide["kind"] for slide in block["logical_slides"]}
    assert kinds[(3, 4, 5)] == "build_group" and kinds[(7, 8)] == "step_group" and kinds[(9, 10)] == "duplicate_group"
    assert {kind for pages, kind in kinds.items() if len(pages) == 1} == {"single"}
    assert si.KIND_NAMES == {"single": "single", "incremental_build": "build_group", "animation_steps": "step_group", "duplicate": "duplicate_group", "manual_group": "manual_group"}

    build, step, single = _logical(block, 4), _logical(block, 8), _logical(block, 6)
    assert build["grouping"]["basis"] == "inferred" and build["grouping"]["state"] == "generated" and build["grouping"]["confidence"] == "high"
    assert {"adjacent", "same_title", "text_superset"} <= set(build["grouping"]["signals"]) and build["title"] == "Action potential"
    assert step["grouping"]["confidence"] == "medium"  # one slide in several states is never a high-confidence reading
    assert single["grouping"] == {"basis": "page", "state": "generated", "confidence": None, "signals": []}


def test_pages_that_share_something_but_were_not_joined_stay_single_and_say_grouping_is_not_established(tmp_path):
    rows = [f"Row {n}: cell values {n} {n + 1} {n + 2} {n + 3} carried from the row above" for n in range(1, 7)]
    changed = rows[:5] + [rows[5].replace("carried", "corrected")]
    block = si.block(_map(tmp_path, [{"title": "Filling in the table", "lines": rows}, {"title": "Filling in the table", "lines": changed},
                                    {"title": "Closing", "bullets": ["Some unrelated final text there"]}]))
    first, second = block["logical_slides"][0], block["logical_slides"][1]
    assert first["kind"] == second["kind"] == "single" and first["pages"] == [1] and second["pages"] == [2]
    for slide in (first, second):  # uncertain means the page alone; the details say that the grouping was not established
        assert slide["grouping"]["basis"] == "page" and slide["grouping"]["confidence"] == "not_established" and "same_title" in slide["grouping"]["signals"]
    assert block["logical_slides"][2]["grouping"]["confidence"] is None
    assert any("not established" in line for line in block["limitations"])


# ---- 2. identity and role of every page (r2-read-api.md 1.2) ------------------------------------------------------
def test_every_page_gets_an_identity_worded_from_the_map_and_only_from_what_is_known(tmp_path):
    source_map = _map(tmp_path)
    view = _enriched(source_map)

    assert view["source_map"] == si.block(source_map)
    assert [row["page"] for row in view["slides"]] == list(range(1, 15))  # one row per physical page, as before
    for row in view["slides"]:
        identity = row["identity"]
        assert set(identity) == IDENTITY_KEYS and set(row["role"]) == ROLE_KEYS
        assert identity["page_index"] == row["page"] and identity["page_count"] == 14
        assert identity["label"] == sm.describe_page(source_map, row["page"])["label"] and identity["label_parts"] == identity["label"].split(" · ")
        assert identity["label_parts"][0] == f"PDF page {row['page']} of 14"
        assert identity["logical_slide_id"] == _logical(view["source_map"], row["page"])["id"]
        if identity["position"]:  # the structured position and the words of the label never disagree
            assert f"{identity['position']['kind']} {identity['position']['ordinal']} of {identity['position']['of']}" in identity["label_parts"]
            assert identity["position"]["of"] == len(_logical(view["source_map"], row["page"])["pages"])
        # Nothing the file does not establish: no page label, no printed number, no PowerPoint slide on a PDF-only unit.
        assert identity["page_label"] is None and identity["printed_slide_number"] is None and identity["pptx"] is None
        assert "Slide" not in identity["label"] and "PPTX" not in identity["label"] and "PowerPoint" not in identity["label"]
    assert view["source_map"]["pptx"] is None


def test_a_three_page_build_says_build_k_of_3_on_its_pages_and_nowhere_else(tmp_path):
    view = _enriched(_map(tmp_path))
    assert [_row(view, n)["identity"]["label"] for n in (3, 4, 5)] == ["PDF page 3 of 14 · build 1 of 3", "PDF page 4 of 14 · build 2 of 3", "PDF page 5 of 14 · build 3 of 3"]
    assert [_row(view, n)["identity"]["position"] for n in (3, 4, 5)] == [{"ordinal": k, "of": 3, "kind": "build"} for k in (1, 2, 3)]
    assert len({_row(view, n)["identity"]["logical_slide_id"] for n in (3, 4, 5)}) == 1
    for n in (1, 2, 6, 11, 12, 13, 14):
        identity = _row(view, n)["identity"]
        assert identity["position"] is None and identity["label"] == f"PDF page {n} of 14" and "build" not in identity["label"]
    assert not any("build" in _row(view, n)["identity"]["label"] for n in (7, 8, 9, 10))


def test_a_step_group_and_a_copy_group_are_worded_differently_and_neither_is_a_build(tmp_path):
    view = _enriched(_map(tmp_path))
    assert [_row(view, n)["identity"]["label"] for n in (7, 8)] == ["PDF page 7 of 14 · step 1 of 2", "PDF page 8 of 14 · step 2 of 2"]
    assert [_row(view, n)["identity"]["label"] for n in (9, 10)] == ["PDF page 9 of 14 · copy 1 of 2", "PDF page 10 of 14 · copy 2 of 2"]
    assert _row(view, 8)["identity"]["position"] == {"ordinal": 2, "of": 2, "kind": "step"}
    assert _row(view, 10)["identity"]["position"] == {"ordinal": 2, "of": 2, "kind": "copy"}


def test_a_structural_administrative_or_blank_page_forces_nothing_and_stays_in_the_list(tmp_path):
    view = _enriched(_map(tmp_path))
    assert len(view["slides"]) == 14  # a role never removes a page
    for page, value in ((1, "structural_title_or_section"), (11, "blank"), (12, "administrative")):
        role = _row(view, page)["role"]
        assert role["value"] == value and role["forced_requirements"] is False and role["state"] == "generated" and role["basis"], page
    for page in (2, 4, 6, 14):  # objectives, a build page, a content page, a summary keep the ordinary behaviour
        assert _row(view, page)["role"]["forced_requirements"] is True and _row(view, page)["role"]["value"] not in EXCLUDED
    picture = _row(view, 13)["role"]  # sparse text is not evidence of a structural or blank page (R2-S9)
    assert picture["value"] in {"unknown", "instructional"} and picture["forced_requirements"] is True and picture["uncertain"] is True


def test_the_denominators_add_up_to_the_page_count_and_unknown_is_never_counted_as_excluded(tmp_path):
    block = si.block(_map(tmp_path))
    figures = block["denominators"]
    assert set(figures) == {"raw", "instructional", "by_role", "uncertain", "excluded"}
    assert figures["raw"] == block["page_count"] == 14 and set(figures["by_role"]) == set(sm.ROLES)
    assert sum(figures["by_role"].values()) == 14
    assert figures["instructional"] == sum(figures["by_role"][role] for role in INSTRUCTIONAL)
    assert figures["excluded"] == sum(figures["by_role"][role] for role in EXCLUDED) == 3  # the cover, the blank page, the administrative page
    assert figures["uncertain"] == figures["by_role"]["objectives_or_summary"] + figures["by_role"]["unknown"]
    assert figures["instructional"] + figures["uncertain"] + figures["excluded"] == figures["raw"]
    assert figures["by_role"]["objectives_or_summary"] == 2 and figures["by_role"]["unknown"] >= 0

    # A deck whose only odd page is one of unknown role: it is listed as uncertain, and nothing is excluded.
    unknown = si.block(_map(tmp_path, [DECK[5], {"boxes": [(100, 80, 40, 30, "teal")]}, DECK[13]], name="unknown.pdf"))["denominators"]
    assert unknown["by_role"]["unknown"] == 1 and unknown["excluded"] == 0 and unknown["uncertain"] == 2 and unknown["raw"] == 3


def test_a_deep_link_page_n_keeps_meaning_physical_page_n_whatever_the_grouping(tmp_path):
    path = tmp_path / "deck.pdf"
    write_slide_pdf(path, DECK)
    regrouped = sm.build_source_map(path, overrides=[{"op": {"type": "split", "before_page": 5}, "author": {"kind": "learner", "ref": None}, "reason": "page 5 is its own slide"},
                                                      {"op": {"type": "group", "pages": [1, 2]}, "author": {"kind": "learner", "ref": None}, "reason": "one opening"}])
    for source_map in (sm.build_source_map(path), regrouped):
        view = _enriched(source_map)
        assert len(view["slides"]) == 14
        for index, row in enumerate(view["slides"], start=1):  # ?page=N is row N, and row N says it is page N
            assert row["page"] == index == row["identity"]["page_index"] and row["identity"]["label"].startswith(f"PDF page {index} of 14")
            assert row["identity"]["logical_slide_id"] in {slide["id"] for slide in view["source_map"]["logical_slides"] if index in slide["pages"]}
    assert _row(_enriched(regrouped), 5)["identity"]["label"] == "PDF page 5 of 14"
    assert _row(_enriched(regrouped), 2)["identity"]["label"] == "PDF page 2 of 14 · part 2 of 2"
    assert _row(_enriched(regrouped), 2)["identity"]["position"] == {"ordinal": 2, "of": 2, "kind": "part"}


# ---- 3. no map: the view is still complete and says why -------------------------------------------------------------
@pytest.mark.parametrize("reason", ["no_deck", "not_a_pdf", "unreadable", "not_built"])
def test_with_no_map_the_view_is_still_complete_and_says_why(reason):
    view = _view(6)
    before = {key: value for key, value in view.items() if key != "slides"}
    si.enrich(view, source_map=None, reason=reason)

    block = view["source_map"]
    assert set(block) == BLOCK_KEYS and block["state"] == "unavailable" and block["reason"] == reason
    assert block["logical_slides"] == [] and block["map_revision"] is None and block["pptx"] is None and block["override_revision"] is None
    assert block["page_count"] == 6 and block["page_index_base"] == 1 and block["printed_numbers_established"] is False
    assert block["denominators"] == {"raw": 6, "instructional": None, "by_role": None, "uncertain": None, "excluded": None}  # nothing was classified: no figure is made up
    assert block["limitations"] and all(isinstance(line, str) for line in block["limitations"])
    assert {key: view[key] for key in before} == before and len(view["slides"]) == 6
    for row in view["slides"]:
        identity, role = row["identity"], row["role"]
        assert set(identity) == IDENTITY_KEYS and set(role) == ROLE_KEYS
        assert identity["label"] == f"PDF page {row['page']} of 6" and identity["label_parts"] == [identity["label"]]
        assert identity["page_index"] == row["page"] and identity["page_count"] == 6
        # Never an invented grouping, number or role.
        assert identity["logical_slide_id"] is None and identity["position"] is None and identity["printed_slide_number"] is None and identity["pptx"] is None
        assert role["value"] == "unknown" and role["forced_requirements"] is True and role["state"] is None and role["uncertain"] is True and role["basis"]


def test_a_view_without_pages_and_a_missing_reason_are_both_handled_explicitly():
    empty = _view(None)
    si.enrich(empty, source_map=None, reason="no_deck")
    assert empty["slides"] == [] and empty["source_map"]["page_count"] is None and empty["source_map"]["denominators"]["raw"] is None
    with pytest.raises(ValueError):
        si.enrich(_view(2), source_map=None)  # no map and no reason: the caller has to say why
    with pytest.raises(ValueError):
        si.enrich(_view(2), source_map=None, reason="because")


def test_a_view_that_lists_other_pages_than_the_mapped_file_holds_invents_nothing_for_them(tmp_path):
    source_map = _map(tmp_path, DECK[:5], name="short.pdf")
    view = _enriched(source_map, page_count=7)  # e.g. page text prepared for other bytes of the deck
    assert _row(view, 4)["identity"]["label"] == "PDF page 4 of 5 · build 2 of 3"
    for page in (6, 7):
        identity = _row(view, page)["identity"]
        assert identity["label"] == f"PDF page {page}" and identity["logical_slide_id"] is None and identity["position"] is None and identity["page_count"] == 5
        assert _row(view, page)["role"]["value"] == "unknown"
    assert any("7" in line and "5" in line for line in view["source_map"]["limitations"])


# ---- 4. the map of the displayed deck: reasons, memory, the request bound, building ahead ---------------------------
def test_map_for_returns_the_map_of_the_displayed_deck_and_writes_nothing_into_the_course_folder(course):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    before = _course_files(root)
    lecture, deck = _shown(settings)

    source_map, reason = si.map_for(settings, COURSE, lecture, deck)
    assert reason is None and source_map["page_count"] == 14 and source_map["source"]["source_id"] == deck["source_id"]
    assert [slide["pages"] for slide in source_map["logical_slides"]] == GROUPS
    assert _course_files(root) == before
    [stored] = _stored_maps(settings)  # the map is kept in the app's own area, outside the course
    assert not stored.is_relative_to(root) and stored.is_relative_to(settings.state_dir)


def test_map_for_says_why_there_is_no_map(course):
    settings, root = course
    lecture, deck = _shown(settings)
    assert deck is None and si.map_for(settings, COURSE, lecture, deck) == (None, "no_deck")

    write_synthetic_pptx(root / UNIT / "Deck.pptx", PPTX_SLIDES)  # a presentation alone: shown through a rendition, never mapped as pages
    lecture, deck = _shown(settings)
    assert deck["filename"] == "Deck.pptx" and si.map_for(settings, COURSE, lecture, deck) == (None, "not_a_pdf")
    (root / UNIT / "Deck.pptx").unlink()

    (root / UNIT / "Deck.pdf").write_bytes(b"%PDF-1.4 synthetic bytes that are not a document")
    assert _current(settings) == (None, "unreadable")

    write_slide_pdf(root / UNIT / "Deck.pdf", DECK[:3])
    lecture, deck = _shown(settings)
    (root / UNIT / "Deck.pdf").unlink()  # gone after the unit was listed
    assert si.map_for(settings, COURSE, lecture, deck) == (None, "unreadable")
    assert _stored_maps(settings) == [] or all(not path.is_relative_to(root) for path in _stored_maps(settings))


def test_a_second_read_is_served_from_memory_until_the_bytes_or_the_corrections_change(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    loads: list[int] = []
    real = sm.load_or_build
    monkeypatch.setattr(sm, "load_or_build", lambda *args, **kwargs: loads.append(1) or real(*args, **kwargs))

    first, _ = si.map_for(settings, COURSE, lecture, deck)
    after_first = len(loads)
    assert after_first >= 1
    second, _ = si.map_for(settings, COURSE, lecture, deck)
    assert second is first and len(loads) == after_first  # no stored JSON was read again

    # A correction recorded by anyone through the source map is a new revision: the next read sees it.
    sm.apply_override(settings, COURSE, deck, {"type": "split", "before_page": 5}, author="learner", reason="Page 5 starts a new slide")
    third, _ = si.map_for(settings, COURSE, lecture, deck)
    assert third["overrides"]["revision"] == 1 and third["map_revision"] != first["map_revision"]
    seen = len(loads)
    assert si.map_for(settings, COURSE, lecture, deck)[0] is third and len(loads) == seen

    # Other bytes under the same path are another file: another map.
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK[:6])
    fourth, reason = _current(settings)
    assert reason is None and fourth["page_count"] == 6 and fourth["source"]["sha256"] != first["source"]["sha256"] and fourth["overrides"]["revision"] == 0


def test_a_failure_of_the_moment_is_never_remembered(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    real_reader = sm.PdfReader

    def locked(*args, **kwargs):
        raise OSError("synthetic: the file is locked just now")

    monkeypatch.setattr(sm, "PdfReader", locked)
    assert si.map_for(settings, COURSE, lecture, deck) == (None, "unreadable")
    assert si.map_for(settings, COURSE, lecture, deck) == (None, "unreadable")
    monkeypatch.setattr(sm, "PdfReader", real_reader)
    source_map, reason = si.map_for(settings, COURSE, lecture, deck)
    assert reason is None and source_map["page_count"] == 14 and source_map["inspection"]["status"] == "complete"


def test_a_map_cut_short_is_served_as_partial_and_is_tried_again_on_the_next_read(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    real_page = sm._inspect_page

    def flaky(page, number, *args, **kwargs):
        if number >= 12:
            raise OSError("synthetic transient read failure")
        return real_page(page, number, *args, **kwargs)

    monkeypatch.setattr(sm, "_inspect_page", flaky)
    partial, reason = si.map_for(settings, COURSE, lecture, deck)
    assert reason is None and partial["inspection"]["status"] == "partial" and partial["inspection"]["transient"] is True
    view = _enriched(partial)
    assert len(view["slides"]) == 14 and _row(view, 13)["identity"]["label"] == "PDF page 13 of 14" and _row(view, 13)["role"]["value"] == "unknown"
    assert view["source_map"]["state"] == "ready" and any("could not be inspected" in line for line in view["source_map"]["limitations"])
    assert view["source_map"]["denominators"]["by_role"]["unknown"] == 3 and view["source_map"]["denominators"]["excluded"] == 2  # unknown is never excluded

    monkeypatch.setattr(sm, "_inspect_page", real_page)
    whole, reason = si.map_for(settings, COURSE, lecture, deck)
    assert reason is None and whole["inspection"]["status"] == "complete" and whole is not partial
    assert _row(_enriched(whole), 12)["role"]["value"] == "administrative"


def test_a_first_build_over_the_request_bound_waits_for_the_preparation_step(course, monkeypatch):
    assert (si.REQUEST_BUILD_MAX_BYTES, si.REQUEST_BUILD_MAX_PAGES) == (8 * 1024 * 1024, 120)  # the bound, as stated
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    inspected = _count_inspections(monkeypatch)

    monkeypatch.setattr(si, "REQUEST_BUILD_MAX_PAGES", 5)  # the deck has 14 pages
    assert si.map_for(settings, COURSE, lecture, deck) == (None, "not_built")
    assert inspected == [] and _stored_maps(settings) == []  # no page was inspected and nothing was stored
    assert si.map_for(settings, COURSE, lecture, deck) == (None, "not_built")
    view = _view(14)
    si.enrich(view, source_map=None, reason="not_built")
    assert view["source_map"]["reason"] == "not_built" and _row(view, 4)["identity"]["label"] == "PDF page 4 of 14"

    counts = si.prebuild(settings, COURSE)
    assert (counts["lectures"], counts["built"], counts["already_built"], counts["pages"]) == (1, 1, 0, 14)
    assert sorted(set(inspected)) == list(range(1, 15)) and len(_stored_maps(settings)) == 1
    inspected.clear()
    si.forget()
    source_map, reason = si.map_for(settings, COURSE, lecture, deck)  # now it is there: read from the store, nothing inspected
    assert reason is None and source_map["page_count"] == 14 and inspected == []
    again = si.prebuild(settings, COURSE)
    assert (again["built"], again["already_built"]) == (0, 1) and inspected == []

    # The byte bound holds the same way, and a deck within both bounds is mapped during the request.
    monkeypatch.setattr(si, "REQUEST_BUILD_MAX_PAGES", 120)
    monkeypatch.setattr(si, "REQUEST_BUILD_MAX_BYTES", 100)
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK[:6])
    assert _current(settings) == (None, "not_built") and inspected == []
    monkeypatch.setattr(si, "REQUEST_BUILD_MAX_BYTES", 8 * 1024 * 1024)
    small, reason = _current(settings)
    assert reason is None and small["page_count"] == 6 and sorted(inspected) == [1, 2, 3, 4, 5, 6]


def test_prebuild_counts_every_unit_can_be_narrowed_to_one_and_writes_only_in_the_apps_area(course):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    for name in ("lecture-02", "lecture-03", "lecture-04"):
        (root / "materials/lectures" / name).mkdir()
    write_synthetic_pptx(root / "materials/lectures/lecture-02/Deck.pptx", PPTX_SLIDES)
    (root / "materials/lectures/lecture-04/Deck.pdf").write_bytes(b"%PDF-1.4 synthetic bytes that are not a document")
    before = _course_files(root)

    counts = si.prebuild(settings, COURSE)
    assert {key: counts[key] for key in ("course_id", "lectures", "built", "already_built", "no_deck", "not_a_pdf", "unreadable", "not_built", "pages")} == {
        "course_id": COURSE, "lectures": 4, "built": 1, "already_built": 0, "no_deck": 1, "not_a_pdf": 1, "unreadable": 1, "not_built": 0, "pages": 14}
    assert [(row["lecture_id"], row["state"]) for row in counts["items"]] == [(LECTURE, "built"), ("lecture-02", "not_a_pdf"), ("lecture-03", "no_deck"), ("lecture-04", "unreadable")]
    assert counts["items"][0]["page_count"] == 14 and counts["items"][0]["map_revision"] and isinstance(counts["seconds"], float)
    assert _course_files(root) == before

    one = si.prebuild(settings, COURSE, lecture_id=LECTURE)
    assert (one["lectures"], one["built"], one["already_built"]) == (1, 0, 1)
    with pytest.raises(ValueError):
        si.prebuild(settings, COURSE, lecture_id="lecture-99")


def test_a_powerpoint_slide_is_named_only_on_a_page_the_map_matched_and_never_by_position(course):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", SIGNALLING)
    write_synthetic_pptx(root / UNIT / "Deck.pptx", PPTX_SLIDES)  # six slides, one hidden, one blank: its order is not the page order
    lecture, deck = _shown(settings)
    assert deck["filename"] == "Deck.pdf"  # the PDF is what is displayed; the presentation is its companion
    source_map, reason = si.map_for(settings, COURSE, lecture, deck)
    view = _enriched(source_map)

    companion = next(item for item in lecture["decks"] if item["filename"] == "Deck.pptx")
    assert view["source_map"]["pptx"] == {"source_id": companion["source_id"], "state": "supported", "matched_pages": 6}
    ordinals = [(_row(view, n)["identity"]["pptx"] or {}).get("ordinal") for n in range(1, 8)]
    assert ordinals == [1, 3, 3, 3, None, 5, 6]  # page 2 is slide 3; the picture-only page 5 is matched to nothing
    matched = _row(view, 3)["identity"]
    assert set(matched["pptx"]) == {"slide_id", "ordinal", "match_basis", "match_state"} and matched["pptx"]["match_basis"] == "text_title_sequence_alignment"
    assert matched["pptx"]["match_state"] == "generated" and isinstance(matched["pptx"]["slide_id"], int)
    assert matched["label"] == "PDF page 3 of 7 · build 2 of 3 · PPTX slide 3" and matched["page_index"] == 3
    assert _row(view, 5)["identity"]["label"] == "PDF page 5 of 7" and _row(view, 5)["identity"]["pptx"] is None
    assert all(row["identity"]["printed_slide_number"] is None for row in view["slides"])

    # A presentation that does not align lends nothing: the deck says a file exists, no page says a slide.
    write_synthetic_pptx(root / UNIT / "Deck.pptx", [{"title": f"Unrelated heading {n}", "bullets": [f"Different vocabulary entirely for item {n}"]} for n in range(1, 8)])
    other = _enriched(_current(settings)[0])
    assert other["source_map"]["pptx"]["state"] == "not_supported" and other["source_map"]["pptx"]["matched_pages"] == 0
    assert all(row["identity"]["pptx"] is None and "PPTX" not in row["identity"]["label"] for row in other["slides"])
    assert any("PowerPoint" in line for line in other["source_map"]["limitations"])

    # And with no presentation in the unit, no PowerPoint field anywhere.
    (root / UNIT / "Deck.pptx").unlink()
    alone = _enriched(_current(settings)[0])
    assert alone["source_map"]["pptx"] is None and all(row["identity"]["pptx"] is None for row in alone["slides"])
    assert not any("PowerPoint" in line for line in alone["source_map"]["limitations"])


def test_a_printed_number_is_shown_only_where_the_deck_establishes_one(tmp_path):
    printed = [1, 2, 3, 5, 6, 6, 8]
    pages = [{"title": f"Concept {n}", "bullets": [f"A statement that belongs to concept {n} only"], "printed": number, "footer": "Synthetic course - week 2"}
             for n, number in enumerate(printed, start=1)]
    pages[5] = {"title": "Concept 5", "bullets": ["A statement that belongs to concept 5 only", "A second statement revealed afterwards"], "printed": 6, "footer": "Synthetic course - week 2"}
    view = _enriched(_map(tmp_path, pages))
    assert view["source_map"]["printed_numbers_established"] is True
    assert [row["identity"]["printed_slide_number"] for row in view["slides"]] == [{"value": number, "basis": "printed_on_page"} for number in printed]
    assert _row(view, 4)["identity"]["label"] == "PDF page 4 of 7 · Slide 5" and _row(view, 4)["identity"]["page_index"] == 4  # the index and the printed number differ
    assert _row(view, 6)["identity"]["label"] == "PDF page 6 of 7 · build 2 of 2 · Slide 6"

    labelled = _enriched(_map(tmp_path, [{"title": f"Body topic {n}", "bullets": [f"Substantive statement number {n} of the body"]} for n in range(1, 5)], name="labels.pdf"))
    assert all(row["identity"]["page_label"] is None for row in labelled["slides"])
    path = tmp_path / "front.pdf"
    write_slide_pdf(path, [{"title": f"Body topic {n}", "bullets": [f"Substantive statement number {n} of the body"]} for n in range(1, 5)], page_labels={1: ("r", None, 1), 3: ("D", None, 1)})
    front = _enriched(sm.build_source_map(path))
    assert [row["identity"]["page_label"] for row in front["slides"]] == ["i", "ii", "1", "2"]  # a label as the file writes it, never used as the index
    assert _row(front, 3)["identity"]["label"] == "PDF page 3 of 4 · PDF label 1" and _row(front, 3)["identity"]["printed_slide_number"] is None


# ---- 5. the same identity for the other consumers (R2-S1) -----------------------------------------------------------
def test_the_aligner_gets_the_maps_logical_slides_with_their_groups_and_roles(tmp_path):
    source_map = _map(tmp_path)
    block = si.block(source_map)
    texts = [page["text"] for page in source_map["pages"]]
    slides = si.alignment_slides(source_map, texts)

    assert [slide["slide_id"] for slide in slides] == [logical["id"] for logical in block["logical_slides"]]
    assert [slide["pages"] for slide in slides] == GROUPS
    assert [slide["role"] for slide in slides] == [logical["role"] for logical in block["logical_slides"]]
    assert [slide["grouping"] for slide in slides] == [logical["kind"] for logical in block["logical_slides"]]
    build = slides[2]
    assert build["title"] == "Action potential" and POTENTIAL[2] in build["text"] and build["text"].count(POTENTIAL[0]) == 1  # a build does not count its first line three times
    assert si.alignment_slides(source_map, None) == slides  # without page text of its own, the text the map read

    # The list is what the aligner takes: an occurrence names a logical slide of the map and its member pages.
    spoken = ["so the resting state sits near minus seventy millivolts", "then sodium channels open and the cell depolarises", "and potassium channels restore the resting state"]
    result = alignment.align_windows_to_slides(alignment.windows_from_lines(spoken), slides, initial="anywhere")
    assert [row["slide_id"] for row in result["slides"]] == [slide["slide_id"] for slide in slides]
    assert result["occurrences"] and all(occurrence["slide_id"] == build["slide_id"] and occurrence["pages"] == [3, 4, 5] for occurrence in result["occurrences"])
    assert result["occurrences"][0]["quality"]["grouping"] == "build_group"

    # Page text that is shorter or longer than the mapped file drops no logical slide and invents no group.
    assert [slide["pages"] for slide in si.alignment_slides(source_map, texts[:4])] == GROUPS
    longer = si.alignment_slides(source_map, texts + ["An extra page of text"])
    assert [slide["pages"] for slide in longer] == GROUPS + [[15]] and longer[-1]["slide_id"] == "p15" and longer[-1]["role"] == "unknown"
    # With no map every page is its own slide of unknown role, exactly as the aligner makes them itself.
    assert si.alignment_slides(None, ["first page", "second page"]) == alignment.logical_slides_from_pages(["first page", "second page"])
    assert si.alignment_slides(None, None) == []


def test_a_page_its_logical_slide_and_its_label_resolve_the_same_way_for_every_consumer(tmp_path):
    path = tmp_path / "deck.pdf"
    write_slide_pdf(path, DECK)
    source_map = sm.build_source_map(path)
    view = _enriched(source_map)
    group = _row(view, 4)["identity"]["logical_slide_id"]

    for page in range(1, 15):  # one answer, whoever asks
        assert si.logical_slide_of(source_map, page) == _row(view, page)["identity"]["logical_slide_id"]
        assert si.label_for(source_map, page) == _row(view, page)["identity"]["label"]
        assert page in si.pages_of(source_map, si.logical_slide_of(source_map, page))
    assert si.pages_of(source_map, group) == [3, 4, 5] and si.label_for(source_map, 4) == "PDF page 4 of 14 · build 2 of 3"
    assert si.logical_slide_of(source_map, 99) is None and si.logical_slide_of(source_map, 0) is None and si.label_for(source_map, 99) == "PDF page 99"
    assert si.pages_of(source_map, "ls-0000000000-p3-5") == [] and si.pages_of(source_map, "nonsense") == [] and si.pages_of(source_map, None) == []
    # No map: no logical slide is invented; a page is still named, and the aligner's own page ids still resolve.
    assert si.logical_slide_of(None, 4) is None and si.label_for(None, 4) == "PDF page 4" and si.pages_of(None, "p4") == [4] and si.pages_of(None, group) == []

    # After a regrouping an id issued earlier still answers with the pages it named; the pages now belong to other slides.
    split = sm.build_source_map(path, overrides=[{"op": {"type": "split", "before_page": 5}, "author": {"kind": "learner", "ref": None}, "reason": "page 5 is its own slide"}])
    assert si.pages_of(split, group) == [3, 4, 5] and si.logical_slide_of(split, 5) != group and si.logical_slide_of(split, 4) != group
    assert si.pages_of(split, si.logical_slide_of(split, 4)) == [3, 4] and si.label_for(split, 4) == "PDF page 4 of 14 · build 2 of 2"


# ---- 6. the routes: the stored map, and a learner's correction ------------------------------------------------------
BASE = f"/api/courses/{COURSE}/lectures/{LECTURE}/source-map"
OVERRIDES = f"{BASE}/overrides"


def _app(settings: Settings) -> FastAPI:
    app = FastAPI()
    si.register(app, SimpleNamespace(settings=settings), lambda fn: fn())
    return app


@pytest.fixture()
def client(course):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    return TestClient(_app(settings))


def _labels(settings: Settings, pages: tuple[int, ...]) -> list[str]:
    """The labels a lecture view shows on its next read."""
    view = _enriched(_current(settings)[0])
    return [_row(view, page)["identity"]["label"] for page in pages]


def test_the_module_registers_one_read_and_one_state_changing_route(course):
    app = _app(course[0])
    declared = {(method, route.path) for route in app.routes for method in getattr(route, "methods", set()) if method not in {"HEAD", "OPTIONS"}}
    mine = {(method, path) for method, path in declared if "source-map" in path}
    assert mine == {("GET", "/api/courses/{course_id}/lectures/{lecture_id}/source-map"), ("POST", "/api/courses/{course_id}/lectures/{lecture_id}/source-map/overrides")}


def test_the_stored_map_of_the_displayed_deck_is_served_with_its_override_history(course, client):
    settings, root = course
    body = client.get(BASE).json()
    # The lecture view's source_map object, spelled the same, and beside it what only this route carries.
    assert set(body) == BLOCK_KEYS | {"course_id", "lecture_id", "deck", "pages", "overrides", "override_problems", "map"}
    assert {key: body[key] for key in BLOCK_KEYS} == si.block(_current(settings)[0]) and body["state"] == "ready"
    assert (body["course_id"], body["lecture_id"]) == (COURSE, LECTURE) and body["deck"]["filename"] == "Deck.pdf"
    assert body["overrides"] == [] and body["override_problems"] == [] and body["override_revision"] == 0
    assert [row["page"] for row in body["pages"]] == list(range(1, 15)) and all(set(row) == {"page", "identity", "role"} for row in body["pages"])
    view = _enriched(_current(settings)[0])  # every page as the lecture view shows it
    assert [(row["identity"], row["role"]) for row in body["pages"]] == [(row["identity"], row["role"]) for row in view["slides"]]
    assert body["pages"][3]["identity"]["label"] == "PDF page 4 of 14 · build 2 of 3"
    # The full stored map, in the source map's own spelling.
    assert body["map"]["contract"] == "source-map/1" and len(body["map"]["pages"]) == 14 and body["map"]["map_revision"] == body["map_revision"]
    assert body["map"]["overrides"]["revision"] == 0 and body["map"]["overrides"]["history"] == [] and body["map"]["logical_slides"][2]["kind"] == "incremental_build"

    assert client.get(f"/api/courses/unknown/lectures/{LECTURE}/source-map").status_code == 404
    assert client.get(f"/api/courses/{COURSE}/lectures/lecture-99/source-map").status_code == 404
    (root / "materials/lectures/lecture-02").mkdir()  # a unit without a deck is not an error: it has no map, and says why
    empty = client.get(f"/api/courses/{COURSE}/lectures/lecture-02/source-map")
    assert empty.status_code == 200 and empty.json()["map"] is None and empty.json()["deck"] is None
    assert empty.json()["state"] == "unavailable" and empty.json()["reason"] == "no_deck" and empty.json()["pages"] == [] and empty.json()["overrides"] == []
    assert empty.json()["page_count"] is None and empty.json()["denominators"]["raw"] is None  # this route lists no pages of a deck it has no map of


def test_a_learner_split_or_regroup_changes_the_labels_on_the_next_read_and_survives_a_rebuild(course, client):
    settings, root = course
    assert _labels(settings, (3, 4, 5)) == ["PDF page 3 of 14 · build 1 of 3", "PDF page 4 of 14 · build 2 of 3", "PDF page 5 of 14 · build 3 of 3"]
    before = _course_files(root)

    response = client.post(OVERRIDES, json={"op": "split_before", "pages": [5], "reason": "Page 5 starts a new slide"})
    assert response.status_code == 200
    block = response.json()  # the new source_map object
    assert set(block) == BLOCK_KEYS and block["state"] == "ready" and block["override_revision"] == 1
    assert _logical(block, 4)["pages"] == [3, 4] and _logical(block, 4)["kind"] == "build_group"
    assert _logical(block, 5)["kind"] == "single" and _logical(block, 5)["grouping"] == {"basis": "override", "state": "human_confirmed", "confidence": None, "signals": []}
    assert _labels(settings, (3, 4, 5)) == ["PDF page 3 of 14 · build 1 of 2", "PDF page 4 of 14 · build 2 of 2", "PDF page 5 of 14"]

    regroup = client.post(OVERRIDES, json={"op": "group", "pages": [1, 2], "reason": "The cover and the objectives are one opening"}).json()
    assert regroup["override_revision"] == 2 and _logical(regroup, 2)["kind"] == "manual_group" and _logical(regroup, 2)["grouping"]["basis"] == "override"
    assert _labels(settings, (1, 2)) == ["PDF page 1 of 14 · part 1 of 2", "PDF page 2 of 14 · part 2 of 2"]
    named = client.post(OVERRIDES, json={"op": "group", "pages": [6, 7, 8], "value": "step_group", "reason": "Three states of one slide"}).json()
    assert _logical(named, 6)["kind"] == "step_group" and _logical(named, 6)["grouping"]["state"] == "human_confirmed"
    assert _labels(settings, (6, 8)) == ["PDF page 6 of 14 · step 1 of 3", "PDF page 8 of 14 · step 3 of 3"]

    # The history says who, why and what was there before; the corrections live in the app's area, never in the course.
    history = client.get(BASE).json()["overrides"]
    assert [(entry["revision"], entry["type"], entry["status"], entry["author"]["kind"]) for entry in history] == [
        (1, "split", "applied", "learner"), (2, "group", "applied", "learner"), (3, "group", "applied", "learner")]
    assert history[0]["reason"] == "Page 5 starts a new slide" and history[1]["supersedes"]["revision"] == 1
    assert _course_files(root) == before

    # A rebuild inspects the file again and keeps every correction.
    rebuilt = si.prebuild(settings, COURSE, refresh=True)
    assert rebuilt["built"] == 1
    si.forget()
    assert _labels(settings, (3, 4, 5)) == ["PDF page 3 of 14 · build 1 of 2", "PDF page 4 of 14 · build 2 of 2", "PDF page 5 of 14"]
    assert _labels(settings, (2, 8)) == ["PDF page 2 of 14 · part 2 of 2", "PDF page 8 of 14 · step 3 of 3"]
    assert client.get(BASE).json()["override_revision"] == 3

    # Undo is a further revision: page 5 is a build of its slide again, and the history keeps both.
    undone = client.post(OVERRIDES, json={"op": "revert", "value": [1], "reason": "It is the third build after all"}).json()
    assert undone["override_revision"] == 4 and _logical(undone, 5)["pages"] == [3, 4, 5]
    assert _labels(settings, (5,)) == ["PDF page 5 of 14 · build 3 of 3"]
    assert [entry["status"] for entry in client.get(BASE).json()["overrides"]] == ["reverted", "applied", "applied", "applied"]


def test_a_role_set_by_the_learner_is_said_to_be_theirs_and_moves_only_the_figures_that_depend_on_roles(course, client):
    settings, _ = course
    before = client.get(BASE).json()["denominators"]
    block = client.post(OVERRIDES, json={"op": "role", "pages": [13], "value": "structural_title_or_section", "reason": "A decorative divider"}).json()
    after = block["denominators"]
    assert after["raw"] == before["raw"] == 14 and after["excluded"] == before["excluded"] + 1 and after["uncertain"] == before["uncertain"] - 1
    assert after["instructional"] == before["instructional"] and sum(after["by_role"].values()) == 14
    row = _row(_enriched(_current(settings)[0]), 13)
    assert row["role"]["value"] == "structural_title_or_section" and row["role"]["state"] == "human_confirmed" and row["role"]["forced_requirements"] is False
    assert row["role"]["uncertain"] is False and row["identity"]["label"] == "PDF page 13 of 14"  # still in the list, still page 13
    untouched = _row(_enriched(_current(settings)[0]), 12)["role"]
    assert untouched["state"] == "generated"  # a generated role is never worded as reviewed or confirmed

    number = client.post(OVERRIDES, json={"op": "printed_number", "pages": [6], "value": 4, "reason": "The page prints 4 in its corner"})
    assert number.status_code == 200
    assert _row(_enriched(_current(settings)[0]), 6)["identity"]["printed_slide_number"] == {"value": 4, "basis": "correction"}


def test_a_refusal_is_an_explicit_4xx_with_the_modules_reason_and_records_nothing(course, client, monkeypatch):
    settings, root = course
    refused = [
        ({"op": "group", "pages": [3, 5], "reason": "not next to each other"}, "adjacent"),
        ({"op": "group", "pages": [3, 4], "value": "pile", "reason": "an unknown kind"}, "kind"),
        ({"op": "group", "pages": [3, 4], "value": ["build_group"], "reason": "a kind that is not a word"}, "kind"),
        ({"op": "regions", "pages": [3], "value": "left half", "reason": "regions that are not boxes"}, "regions"),
        ({"op": "printed_number", "pages": [3], "value": "seven", "reason": "a number that is a word"}, "printed_number"),
        ({"op": "split_before", "pages": [5]}, "reason"),
        ({"op": "split_before", "pages": [5], "reason": "   "}, "reason"),
        ({"op": "split_before", "pages": [4, 5], "reason": "two pages"}, "one page"),
        ({"op": "split", "pages": [99], "reason": "no such page"}, "page"),
        ({"op": "split", "pages": "5", "reason": "pages is not a list"}, "pages"),
        ({"op": "merge", "pages": [1, 2], "reason": "an unknown operation"}, "op"),
        ({"op": "role", "pages": [3], "value": "boring", "reason": "an unknown role"}, "role"),
        ({"op": "role", "pages": [3, 4], "value": "blank", "reason": "two pages at once"}, "one page"),
        ({"op": "revert", "value": [7], "reason": "no such revision"}, "revert"),
    ]
    for body, word in refused:
        response = client.post(OVERRIDES, json=body)
        assert response.status_code == 422, body
        answer = response.json()
        assert answer["code"] == "invalid_override" and isinstance(answer["detail"], str) and word in answer["detail"], (body, answer)
    for content in (b"not json", b"[1, 2]"):
        malformed = client.post(OVERRIDES, content=content, headers={"content-type": "application/json"})
        assert malformed.status_code == 400 and isinstance(malformed.json()["detail"], str)
    assert client.get(BASE).json()["override_revision"] == 0
    assert list(settings.app_area(COURSE).rglob("r0*.json")) == []

    assert client.post(f"/api/courses/unknown/lectures/{LECTURE}/source-map/overrides", json={"op": "split", "pages": [2], "reason": "x"}).status_code == 404
    assert client.post(f"/api/courses/{COURSE}/lectures/lecture-99/source-map/overrides", json={"op": "split", "pages": [2], "reason": "x"}).status_code == 404

    # A deck without a map cannot be corrected, and the answer says which of the four reasons applies.
    (root / "materials/lectures/lecture-02").mkdir()
    no_deck = client.post(f"/api/courses/{COURSE}/lectures/lecture-02/source-map/overrides", json={"op": "split", "pages": [2], "reason": "x"})
    assert no_deck.status_code == 409 and no_deck.json()["code"] == "no_deck" and isinstance(no_deck.json()["detail"], str)
    write_slide_pdf(root / "materials/lectures/lecture-02/Deck.pdf", DECK[:6])
    monkeypatch.setattr(si, "REQUEST_BUILD_MAX_PAGES", 3)
    inspected = _count_inspections(monkeypatch)
    waiting = client.post(f"/api/courses/{COURSE}/lectures/lecture-02/source-map/overrides", json={"op": "split", "pages": [2], "reason": "x"})
    assert waiting.status_code == 409 and waiting.json()["code"] == "not_built" and inspected == []  # a correction never starts a long build inside a request


def test_an_agent_correction_never_overrides_a_learner_one(course, client):
    settings, _ = course
    lecture, deck = _shown(settings)
    assert client.post(OVERRIDES, json={"op": "split_before", "pages": [5], "reason": "I looked: page 5 is another slide"}).status_code == 200
    for op in ({"type": "group", "pages": [3, 4, 5]}, {"type": "group", "pages": [4, 5]}, {"type": "revert", "revisions": [1]}):
        with pytest.raises(sm.SourceMapError) as error:
            sm.apply_override(settings, COURSE, deck, op, author="agent", reason="The text of page 5 contains the text of page 4", lecture=lecture)
        assert error.value.code == "learner_correction_in_force", op
    assert _labels(settings, (4, 5)) == ["PDF page 4 of 14 · build 2 of 2", "PDF page 5 of 14"]
    assert client.get(BASE).json()["override_revision"] == 1

    # What the learner did not fix stays open to an agent, and is shown as the agent's reading, not as the learner's.
    sm.apply_override(settings, COURSE, deck, {"type": "role", "page": 13, "role": "instructional"}, author="agent", reason="A figure that is taught", lecture=lecture)
    assert _row(_enriched(_current(settings)[0]), 13)["role"] == {**_row(_enriched(_current(settings)[0]), 13)["role"], "value": "instructional", "state": "agent_reviewed"}
    # The learner's later word takes its place.
    assert client.post(OVERRIDES, json={"op": "role", "pages": [13], "value": "worked_example_or_question", "reason": "It is the worked example"}).status_code == 200
    role = _row(_enriched(_current(settings)[0]), 13)["role"]
    assert role["value"] == "worked_example_or_question" and role["state"] == "human_confirmed"


def test_a_deck_with_other_bytes_gets_a_new_map_and_the_old_page_labels_are_not_reused(course, client):
    settings, root = course
    client.post(OVERRIDES, json={"op": "split_before", "pages": [5], "reason": "Page 5 starts a new slide"})
    client.post(OVERRIDES, json={"op": "role", "pages": [13], "value": "structural_title_or_section", "reason": "A decorative divider"})
    old = _enriched(_current(settings)[0])
    old_ids = {slide["id"] for slide in old["source_map"]["logical_slides"]}
    assert _row(old, 4)["identity"]["label"] == "PDF page 4 of 14 · build 2 of 2" and old["source_map"]["override_revision"] == 2

    write_slide_pdf(root / UNIT / "Deck.pdf", [DECK[0], *DECK[5:]])  # the file is replaced: ten pages, other bytes, the same path
    new = _enriched(_current(settings)[0])
    block = new["source_map"]
    assert block["page_count"] == 10 and block["source"]["sha256"] != old["source_map"]["source"]["sha256"] and block["map_revision"] != old["source_map"]["map_revision"]
    assert block["override_revision"] == 0 and not old_ids & {slide["id"] for slide in block["logical_slides"]}
    # Page 4 is now the second state of the plot: its label is read from the new bytes, not carried over from the old page 4.
    assert _row(new, 4)["identity"]["label"] == "PDF page 4 of 10 · step 2 of 2" and _row(new, 4)["identity"]["logical_slide_id"] not in old_ids
    # The picture is page 9 now; the role the learner gave page 13 of the old file is not moved onto any page of the new one.
    assert _row(new, 9)["role"]["value"] == "unknown" and all(row["role"]["state"] == "generated" for row in new["slides"])
    assert any("not carried over" in line for line in block["limitations"])
    for old_id in old_ids:
        assert si.pages_of(_current(settings)[0], old_id) == []  # an id of the old bytes names no page of the new file
    body = client.get(BASE).json()
    [earlier] = body["map"]["other_source_versions"]
    assert earlier["sha256"] == old["source_map"]["source"]["sha256"] and [entry["status"] for entry in earlier["overrides_not_applied"]] == ["not_applied_source_replaced"] * 2

    # The earlier version keeps its corrections: with the old bytes back, they apply again.
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    restored = _enriched(_current(settings)[0])
    assert restored["source_map"]["override_revision"] == 2 and _row(restored, 4)["identity"]["label"] == "PDF page 4 of 14 · build 2 of 2"
    assert _row(restored, 13)["role"]["state"] == "human_confirmed"


# ---- 7. who established a grouping: a correction next to a group confirms nothing about it ---------------------------
def _correction(kind: str, op: dict, reason: str, **signature) -> dict:
    return {"op": op, "author": {"kind": kind, "ref": None, **signature}, "reason": reason}


def _stored(source_map: dict, pages: list[int]) -> dict:
    return next(slide for slide in source_map["logical_slides"] if slide["pages"] == pages)


@pytest.mark.parametrize(("author", "said"), [("learner", "human_confirmed"), ("agent", "agent_reviewed")])
def test_a_group_that_a_split_leaves_behind_is_still_only_the_detectors_reading(tmp_path, author, said):
    path = tmp_path / "deck.pdf"
    write_slide_pdf(path, DECK)
    split = sm.build_source_map(path, overrides=[_correction(author, {"type": "split", "before_page": 5}, "page 5 is its own slide")])
    left = _stored(split, [3, 4])
    assert left["grouping"] == "inferred" and left["overrides"] == [1]  # the source map lists the cut at the edge of the group it left

    block = si.block(split)
    behind, cut_off = _logical(block, 4), _logical(block, 5)
    # Nobody said that pages 3 and 4 are one slide: the correction beside them confirms nothing about them.
    assert behind["pages"] == [3, 4] and behind["kind"] == "build_group"
    assert behind["grouping"]["basis"] == "inferred" and behind["grouping"]["state"] == "generated" and behind["grouping"]["confidence"] == "high"
    assert {"adjacent", "same_title", "text_superset"} <= set(behind["grouping"]["signals"])
    assert si.grouping_state(split, left) == "generated"
    # The page that was cut off stands alone on the correction, and says whose correction it is.
    assert cut_off["grouping"] == {"basis": "override", "state": said, "confidence": None, "signals": []}
    assert si.grouping_state(split, _stored(split, [5])) == said
    for slide in block["logical_slides"]:  # a state other than generated is only ever said of a grouping a correction made
        assert slide["grouping"]["state"] == "generated" or slide["grouping"]["basis"] == "override", slide


def test_a_group_is_confirmed_only_by_whoever_joined_its_pages(tmp_path):
    path = tmp_path / "deck.pdf"
    write_slide_pdf(path, DECK)
    agent_join = _correction("agent", {"type": "group", "pages": [3, 4], "kind": "incremental_build"}, "the second page adds one line to the first")
    learner_cut = _correction("learner", {"type": "split", "before_page": 5}, "page 5 is its own slide")

    mixed = sm.build_source_map(path, overrides=[agent_join, learner_cut])
    assert _stored(mixed, [3, 4])["grouping"] == "override" and _stored(mixed, [3, 4])["overrides"] == [1, 2]  # the agent's join and the learner's cut at its edge
    block = si.block(mixed)
    # The learner said where page 5 starts; that pages 3 and 4 are one slide is still the agent's word alone.
    assert _logical(block, 4)["grouping"]["basis"] == "override" and _logical(block, 4)["grouping"]["state"] == "agent_reviewed"
    assert _logical(block, 5)["grouping"] == {"basis": "override", "state": "human_confirmed", "confidence": None, "signals": []}
    assert si.grouping_state(mixed, _stored(mixed, [3, 4])) == "agent_reviewed"
    # The same when the learner's correction beside it is a group of the next pages: it joins those, not these.
    beside = sm.build_source_map(path, overrides=[agent_join, _correction("learner", {"type": "group", "pages": [5, 6]}, "the last build and the next page are one slide")])
    assert _stored(beside, [3, 4])["overrides"] == [1, 2] and _logical(si.block(beside), 3)["grouping"]["state"] == "agent_reviewed"
    assert _logical(si.block(beside), 6)["pages"] == [5, 6] and _logical(si.block(beside), 6)["grouping"]["state"] == "human_confirmed"
    assert _logical(si.block(beside), 8)["pages"] == [7, 8] and _logical(si.block(beside), 8)["grouping"] == _logical(si.block(_map(tmp_path, name="plain.pdf")), 8)["grouping"]

    # A join the learner made is the learner's, whoever cut beside it; so is one an agent recorded on the learner's say.
    learner_join = _correction("learner", {"type": "group", "pages": [3, 4], "kind": "incremental_build"}, "these two are one slide")
    agent_cut = _correction("agent", {"type": "split", "before_page": 3}, "the objectives end before page 3")
    theirs = sm.build_source_map(path, overrides=[learner_join, agent_cut])
    assert _logical(si.block(theirs), 3)["grouping"]["state"] == "human_confirmed"
    on_their_say = sm.build_source_map(path, overrides=[_correction("agent", {"type": "group", "pages": [1, 2]}, "the learner asked for one opening", learner_authority=True)])
    assert _logical(si.block(on_their_say), 2)["grouping"] == {"basis": "override", "state": "human_confirmed", "confidence": None, "signals": ["override"]}

    # A correction of something else on a page of a group (its role) says nothing about the grouping.
    role = sm.build_source_map(path, overrides=[_correction("learner", {"type": "role", "page": 4, "role": "worked_example_or_question"}, "a worked example")])
    assert _logical(si.block(role), 4)["pages"] == [3, 4, 5] and _logical(si.block(role), 4)["grouping"]["state"] == "generated"
    assert _row(_enriched(role), 4)["role"]["state"] == "human_confirmed"


# ---- 8. closing round: what the index declares, a file the source map never reads, the groups for the aligner ---------
def test_the_identity_the_index_declares_for_the_same_bytes_is_never_served_from_an_older_read(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    actual = si.map_for(settings, COURSE, lecture, deck)[0]["source"]["sha256"]

    # The index is behind the file: it declares other bytes under this source id, so the version is named from the disk.
    behind = dict(deck, registration="registered", version_id="v1-000000000000", sha256="0" * 64)
    stale, _ = si.map_for(settings, COURSE, lecture, behind)
    assert stale["source"]["version_id"].startswith("disk-") and stale["source"]["index_sha256_matches"] is False
    # The index catches up: the same file, now declared as these bytes under a new version id.
    caught_up = dict(behind, version_id="v2-aaaaaaaaaaaa", sha256=actual)
    current, reason = si.map_for(settings, COURSE, lecture, caught_up)
    assert reason is None and current["source"]["sha256"] == actual
    assert current["source"]["version_id"] == "v2-aaaaaaaaaaaa" and current["source"]["index_sha256_matches"] is True
    assert si.block(current)["source"] == {"source_id": deck["source_id"], "version_id": "v2-aaaaaaaaaaaa", "sha256": actual}
    assert [slide["pages"] for slide in current["logical_slides"]] == GROUPS  # the same bytes: the same pages and groups

    loads: list[int] = []
    real = sm.load_or_build
    monkeypatch.setattr(sm, "load_or_build", lambda *args, **kwargs: loads.append(1) or real(*args, **kwargs))
    assert si.map_for(settings, COURSE, lecture, caught_up)[0] is current and loads == []  # and that answer is the one kept in memory


def test_a_file_over_the_source_maps_own_size_bound_is_not_promised_a_map(course):
    settings, root = course
    write_slide_pdf(root / UNIT / "Deck.pdf", DECK)
    lecture, deck = _shown(settings)
    tight = sm.Limits(max_bytes=100)  # the deck is larger than the source map reads at all

    assert si.map_for(settings, COURSE, lecture, deck, limits=tight) == (None, "not_built")
    counts = si.prebuild(settings, COURSE, limits=tight)  # ... and the preparation step does not build it either, and says why
    assert (counts["built"], counts["already_built"], counts["not_built"]) == (0, 0, 1) and _stored_maps(settings) == []
    assert counts["items"][0]["state"] == "not_built" and counts["items"][0]["detail"] == "byte_limit"
    # So the sentence a learner reads does not say that the preparation step will build it whatever the file is.
    text = si.unavailable_block("not_built")["limitations"][0]
    assert "preparation step" in text and "size bound" in text and "never mapped" in text

    built = si.prebuild(settings, COURSE)  # within the bound it is built, and nothing needs saying
    assert (built["built"], built["not_built"]) == (1, 0) and built["items"][0]["detail"] is None
    (root / "materials/lectures/lecture-02").mkdir()
    (root / "materials/lectures/lecture-02/Deck.pdf").write_bytes(b"%PDF-1.4 synthetic bytes that are not a document")
    other = si.prebuild(settings, COURSE, lecture_id="lecture-02")["items"][0]
    assert other["state"] == "unreadable" and isinstance(other["detail"], str) and other["detail"]  # the source map's own word for what is wrong


def test_the_groups_for_the_aligner_are_the_maps_logical_slides(tmp_path):
    source_map = _map(tmp_path)
    texts = [page["text"] for page in source_map["pages"]]
    groups = si.alignment_groups(source_map)

    assert [group["pages"] for group in groups] == GROUPS and all(set(group) == {"slide_id", "pages", "grouping", "role", "title"} for group in groups)
    assert [(group["slide_id"], group["grouping"], group["role"]) for group in groups] == [(slide["id"], slide["kind"], slide["role"]) for slide in si.block(source_map)["logical_slides"]]
    # Handed to the aligner with the page texts, they give exactly the list alignment_slides returns.
    assert alignment.logical_slides_from_pages(texts, groups=groups) == si.alignment_slides(source_map, texts)
    assert si.alignment_groups(None) == []
