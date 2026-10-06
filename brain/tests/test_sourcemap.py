"""The versioned source map (Phase 3): page identity, logical slides and builds, content roles, overrides.

Every document here is synthetic and generated into a pytest temp folder. Nothing is written to a course folder:
the map, its cache and the override revisions live in the app's own area.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pypdf
import pytest

from lecture_brain import sourcemap as sm
from lecture_brain.config import TERM, CourseBinding, Settings
from lecture_brain.fixtures.builder import add_inline_image, set_picture_decode, write_slide_pdf, write_synthetic_pptx
from lecture_brain.ownerio.inventory import build_inventory

COURSE = "be505"


# ---- helpers ------------------------------------------------------------------------------------------
def _deck(tmp_path: Path, pages: list[dict], name: str = "deck.pdf", **options) -> Path:
    path = tmp_path / name
    write_slide_pdf(path, pages, **options)
    return path


def _groups(source_map: dict) -> list[list[int]]:
    return [slide["pages"] for slide in source_map["logical_slides"]]


def _slide_of(source_map: dict, page: int) -> dict:
    return next(slide for slide in source_map["logical_slides"] if page in slide["pages"])


def _page(source_map: dict, page: int) -> dict:
    record = source_map["pages"][page - 1]
    assert record["page"] == page
    return record


def _roles(source_map: dict) -> list[str]:
    return [page["role"]["role"] for page in source_map["pages"]]


REVEAL = [
    {"title": "Roadmap of the unit", "bullets": ["Membranes then signals then networks"]},
    {"title": "Action potential", "bullets": ["Resting state sits near minus seventy millivolts"]},
    {"title": "Action potential", "bullets": ["Resting state sits near minus seventy millivolts", "Sodium channels open and the cell depolarises"]},
    {"title": "Action potential", "bullets": ["Resting state sits near minus seventy millivolts", "Sodium channels open and the cell depolarises",
                                              "Potassium channels restore the resting state"]},
    {"title": "Refractory period", "bullets": ["Channels need time before they can open again"]},
]
DERIVATION = [
    {"title": "Why a potential exists", "bullets": ["Unequal ion concentrations across a membrane"]},
    {"title": "Deriving the Nernst potential", "lines": ["Step 1: write the electrochemical balance", "RT ln(Co/Ci) = zFE"]},
    {"title": "Deriving the Nernst potential", "lines": ["Step 2: solve for the potential", "E = (RT/zF) ln(Co/Ci)"]},
    {"title": "Deriving the Nernst potential", "lines": ["Step 3: insert numbers at body temperature", "E = 61 mV log10(Co/Ci)"]},
]


@pytest.fixture()
def course(tmp_path):
    """A read-only style binding over a tiny synthetic course folder: the app's files are staged outside the course."""
    root = tmp_path / "course"
    (root / "materials/lectures/lecture-01").mkdir(parents=True)
    binding = CourseBinding(COURSE, TERM, root, "Synthetic course", f"tutor-{COURSE}")
    settings = Settings(profile="local", repo=tmp_path, state_dir=tmp_path / "state", planner_root=tmp_path / "planner",
                        planner_config=tmp_path / "planner" / "planner-config.yaml", courses={COURSE: binding}, policy={})
    assert settings.writes_are_staged
    return settings, root


def _lecture(settings: Settings) -> dict:
    return build_inventory(settings.course(COURSE))["lectures"][0]


def _item(settings: Settings, filename: str = "Deck.pdf") -> dict:
    return next(deck for deck in _lecture(settings)["decks"] if deck["filename"] == filename)


def _course_files(root: Path) -> dict[str, tuple[int, int]]:
    return {path.relative_to(root).as_posix(): (path.stat().st_size, path.stat().st_mtime_ns) for path in sorted(root.rglob("*")) if path.is_file()}


# ---- 1. page inspection ---------------------------------------------------------------------------------
def test_page_inspection_states_the_index_base_and_records_text_title_images_and_size(tmp_path):
    picture = {"seed": 1, "box": (150, 60, 60, 45)}
    path = _deck(tmp_path, [
        {"title": "Membrane transport", "bullets": ["Channels pass ions down a gradient", "Pumps spend energy"]},
        {"title": "Sodium potassium pump", "bullets": ["Three sodium out", "Two potassium in"], "images": [picture]},
        {"title": "A second look", "bullets": ["The same picture again with other words"], "images": [picture, {"seed": 2, "box": (20, 110, 60, 45)}]},
    ])
    source_map = sm.build_source_map(path)

    assert source_map["contract"] == sm.SOURCE_MAP_VERSION == "source-map/1"
    assert source_map["page_index_base"] == 1 and source_map["page_count"] == 3
    assert [page["page"] for page in source_map["pages"]] == [1, 2, 3]
    assert source_map["source"]["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert source_map["inspection"]["status"] == "complete"
    assert re.fullmatch(r"[0-9a-f]{16}", source_map["map_revision"])

    first, second, third = source_map["pages"]
    assert first["status"] == "ok" and first["title"] == "Membrane transport"
    assert "Pumps spend energy" in first["text"] and first["word_count"] >= 10
    assert first["image_count"] == 0 and first["images"] == []
    assert first["size"] == {"width_pt": 720.0, "height_pt": 540.0, "rotation": 0}
    assert first["pdf_label"] is None and first["printed_number"] is None  # the file defines no labels; no number is printed

    assert second["image_count"] == 1
    image = second["images"][0]
    assert re.fullmatch(r"[0-9a-f]{64}", image["sha256"]) and image["bytes"] > 0 and (image["width"], image["height"]) == (64, 48)
    assert len(image["box"]) == 4 and all(0.0 <= value <= 1.0 for value in image["box"])
    # The digest identifies the picture, not its position: the same picture on another page has the same digest.
    assert image["sha256"] in {entry["sha256"] for entry in third["images"]} and third["image_count"] == 2


def test_inspection_is_bounded_and_an_unread_page_stays_in_the_inventory_as_unknown(tmp_path):
    path = _deck(tmp_path, [{"title": f"Topic {n}", "bullets": [f"Content of page {n} with a few words"]} for n in range(1, 5)])

    capped = sm.build_source_map(path, limits=sm.Limits(max_pages=2))
    assert capped["page_count"] == 4 and len(capped["pages"]) == 4
    assert [page["status"] for page in capped["pages"]] == ["ok", "ok", "unknown", "unknown"]
    assert capped["pages"][2]["reason"] == "page_limit" and capped["pages"][2]["role"]["role"] == "unknown"
    assert capped["inspection"]["status"] == "partial" and len(capped["logical_slides"]) == 4

    ticks = iter(range(0, 1000, 10))
    slow = sm.build_source_map(path, limits=sm.Limits(max_seconds=15), clock=lambda: float(next(ticks)))
    assert len(slow["pages"]) == 4 and slow["pages"][0]["status"] == "ok"
    assert slow["pages"][-1]["status"] == "unknown" and slow["pages"][-1]["reason"] == "time_limit"

    too_large = sm.build_source_map(path, limits=sm.Limits(max_bytes=100))
    assert too_large["inspection"] == {**too_large["inspection"], "status": "not_inspected", "reason": "byte_limit"}
    assert too_large["pages"] == [] and too_large["page_count"] is None and too_large["logical_slides"] == []


def test_the_time_bound_is_also_checked_inside_a_page_that_takes_long(tmp_path):
    heavy = [(20 + (n % 200), 40 + n // 200, 21 + (n % 200), 140) for n in range(1500)]  # thousands of drawing operators on one page
    path = _deck(tmp_path, [{"title": "Light page", "bullets": ["A few words only"]}, {"title": "Heavy page", "strokes": heavy}, {"title": "Last page", "bullets": ["A few words only"]}])
    calls = {"n": 0}

    def clock() -> float:  # in time when a page starts; out of time the first time the clock is looked at inside the heavy page
        calls["n"] += 1
        return 0.0 if calls["n"] <= 3 else 1000.0

    source_map = sm.build_source_map(path, limits=sm.Limits(max_seconds=60), clock=clock)
    assert [(page["status"], page["reason"]) for page in source_map["pages"]] == [("ok", None), ("unknown", "time_limit"), ("unknown", "time_limit")]
    assert source_map["inspection"]["status"] == "partial" and source_map["inspection"]["transient"] is True
    assert len(source_map["logical_slides"]) == 3 and _page(source_map, 2)["role"]["role"] == "unknown"
    assert sm.build_source_map(path)["inspection"]["status"] == "complete"


def test_a_page_that_cannot_be_read_is_unknown_and_is_never_dropped(tmp_path, monkeypatch):
    path = _deck(tmp_path, [{"title": f"Topic {n}", "bullets": [f"Content of page {n} with a few words"]} for n in range(1, 4)])
    original = pypdf.PageObject.extract_text

    def failing(self, *args, **kwargs):
        text = original(self, *args, **kwargs)
        if "Topic 2" in text:
            raise ValueError("synthetic extraction failure")
        return text

    monkeypatch.setattr(pypdf.PageObject, "extract_text", failing)
    source_map = sm.build_source_map(path)
    assert [page["status"] for page in source_map["pages"]] == ["ok", "unknown", "ok"]
    broken = _page(source_map, 2)
    assert broken["reason"] == "unreadable" and broken["role"]["role"] == "unknown" and broken["text"] == ""
    assert _groups(source_map) == [[1], [2], [3]] and sm.resolve(source_map, "page=2")["status"] == "page"
    assert sm.summary(source_map)["pages_unknown"] == 1


def test_a_heading_set_in_two_sizes_on_one_line_is_read_whole(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"title_parts": [("E.", 21), ("coli measurements", 26)], "bullets": ["Cell volume near one cubic micron", "Division every twenty minutes"]},
        {"title": "Yeast measurements", "bullets": ["A larger cell with a nucleus"]},
    ]))
    assert _page(source_map, 1)["title"] == "E. coli measurements" and _page(source_map, 2)["title"] == "Yeast measurements"


def test_a_heading_that_wraps_onto_a_second_line_at_one_size_is_read_whole(tmp_path):
    paragraph = [(20, 40 + 9 * n, f"Sentence {n} of a paragraph that fills the page at one size.") for n in range(8)]
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"texts": [(30, 60, "Systems biology of the"), (30, 72, "bacterial cell cycle")]},  # a cover: two lines, one size, nothing else
        {"texts": paragraph},  # running text at one size has no heading set apart: its first line stands in
        {"title": "Yeast measurements", "bullets": ["A larger cell with a nucleus"]},
    ]))
    assert _page(source_map, 1)["title"] == "Systems biology of the bacterial cell cycle"
    assert _page(source_map, 2)["title"] == "Sentence 0 of a paragraph that fills the page at one size."
    assert _page(source_map, 1)["role"]["role"] == "structural_title_or_section"
    # A short list at one size is a list, not a heading that wraps: its first line stands in and the page is content.
    listed = sm.build_source_map(_deck(tmp_path, [OPENING, {"bullets": ["Membranes keep charge apart", "Channels let ions cross"]}, CLOSING], name="listed.pdf"))
    assert _page(listed, 2)["title"] == "- Membranes keep charge apart" and _page(listed, 2)["role"]["role"] == "instructional"


def test_a_file_that_is_not_a_pdf_gives_an_explicit_state_not_an_exception(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.4 synthetic bytes that are not a document")
    source_map = sm.build_source_map(path)
    assert source_map["inspection"]["status"] == "unreadable" and source_map["pages"] == [] and source_map["page_count"] is None


# ---- 2. PPTX inspection ---------------------------------------------------------------------------------
PPTX_SLIDES = [
    {"title": "Cell signalling", "bullets": ["Synthetic lecture four"], "layout": "title"},
    {"title": "Backup: receptor table", "bullets": ["Receptor families listed for reference"], "hidden": True},
    {"title": "Second messengers", "bullets": ["Cyclic AMP relays the hormone signal", "Calcium release amplifies the response", "Each messenger is cleared quickly"]},
    {"layout": "blank"},
    {"title": "Kinase cascades", "bullets": ["Each kinase activates many copies of the next"]},
    {"title": "Summary", "bullets": ["Signals are relayed amplified and switched off"]},
]


def test_pptx_inspection_reads_slide_ids_order_titles_text_hidden_flag_and_layout(tmp_path):
    path = tmp_path / "deck.pptx"
    write_synthetic_pptx(path, PPTX_SLIDES)
    inspected = sm.inspect_pptx(path)
    assert inspected["status"] == "ok" and inspected["slide_count"] == 6
    slides = inspected["slides"]
    assert [slide["ordinal"] for slide in slides] == [1, 2, 3, 4, 5, 6]
    assert len({slide["slide_id"] for slide in slides}) == 6 and all(isinstance(slide["slide_id"], int) for slide in slides)
    assert slides[2]["slide_id"] != slides[2]["ordinal"]  # the id is the file's own slide id, not a position
    assert [slide["title"] for slide in slides] == ["Cell signalling", "Backup: receptor table", "Second messengers", None, "Kinase cascades", "Summary"]
    assert [slide["hidden"] for slide in slides] == [False, True, False, False, False, False]
    assert slides[0]["layout"] == "Title Slide" and slides[3]["layout"] == "Blank"
    assert "Calcium release amplifies the response" in slides[2]["text"] and slides[3]["text"] == ""


def test_a_file_that_is_not_a_presentation_is_reported_unreadable(tmp_path):
    path = tmp_path / "placeholder.pptx"
    path.write_bytes(b"PK\x03\x04 synthetic placeholder: not a real presentation\n")
    inspected = sm.inspect_pptx(path)
    assert inspected["status"] == "unreadable" and inspected["slides"] == [] and inspected["slide_count"] is None
    assert sm.inspect_pptx(path, limits=sm.Limits(max_pptx_bytes=10))["status"] == "not_inspected"


# ---- 3. logical slides ----------------------------------------------------------------------------------
def test_a_three_page_reveal_is_one_logical_slide_with_builds_one_to_three(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, REVEAL))
    assert _groups(source_map) == [[1], [2, 3, 4], [5]]
    group = _slide_of(source_map, 3)
    assert group["kind"] == "incremental_build" and group["grouping"] == "inferred" and group["representative_page"] == 4
    assert [(_page(source_map, n)["build_index"], _page(source_map, n)["build_count"]) for n in (2, 3, 4)] == [(1, 3), (2, 3), (3, 3)]
    assert len({_page(source_map, n)["logical_slide_id"] for n in (2, 3, 4)}) == 1
    # Evidence names the pages and the signals that carried the decision.
    assert [entry["pages"] for entry in group["evidence"]] == [[2, 3], [3, 4]]
    assert {"adjacent", "same_title", "text_superset"} <= set(group["evidence"][0]["signals"])
    # Nothing is collapsed: every page is still in the inventory and separately addressable.
    assert len(source_map["pages"]) == 5 and [sm.resolve(source_map, f"page={n}")["page"] for n in (2, 3, 4)] == [2, 3, 4]
    assert _slide_of(source_map, 1)["kind"] == "single" and _page(source_map, 1)["build_count"] == 1


def test_the_same_heading_over_different_derivation_steps_is_not_merged(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, DERIVATION))
    assert _groups(source_map) == [[1], [2], [3], [4]]
    assert {slide["kind"] for slide in source_map["logical_slides"]} == {"single"}
    pair = next(entry for entry in source_map["pairs"] if entry["pages"] == [2, 3])
    assert pair["decision"] != "join" and "same_title" in pair["signals"] and "text_superset" not in pair["signals"]


def test_a_long_page_that_changes_one_value_of_the_earlier_page_is_a_new_step_not_a_build(tmp_path):
    rows = [f"Row {n}: cell values {n} {n + 1} {n + 2} {n + 3} carried from the row above" for n in range(1, 7)]
    changed = rows[:5] + [rows[5].replace("carried", "corrected")]  # same length, one word differs: not a superset
    source_map = sm.build_source_map(_deck(tmp_path, [{"title": "Filling in the table", "lines": rows}, {"title": "Filling in the table", "lines": changed},
                                                     {"title": "Filling in the table", "lines": changed + ["Row 7: the final cell holds the answer"]}]))
    assert _groups(source_map) == [[1], [2, 3]]
    pair = next(entry for entry in source_map["pairs"] if entry["pages"] == [1, 2])
    assert pair["decision"] == "uncertain" and pair["measures"]["removed"] == 1 and pair["measures"]["added"] == 1 and "text_superset" not in pair["signals"]
    assert _slide_of(source_map, 1)["grouping"] == "uncertain" and _slide_of(source_map, 2)["kind"] == "incremental_build"


def test_a_topic_repeated_on_a_non_adjacent_page_is_never_merged(tmp_path):
    roadmap = {"title": "Roadmap", "bullets": ["Membranes", "Signals", "Networks"]}
    source_map = sm.build_source_map(_deck(tmp_path, [
        roadmap,
        {"title": "Membranes", "bullets": ["A bilayer keeps charge apart"]},
        roadmap,
        {"title": "Signals", "bullets": ["A ligand binds a receptor"]},
    ]))
    assert _groups(source_map) == [[1], [2], [3], [4]]
    assert _slide_of(source_map, 3)["repeats_title_of"] == [1] and _slide_of(source_map, 3)["kind"] == "single"


OPENING = {"title": "Opening", "bullets": ["Some unrelated introduction text here"]}
CLOSING = {"title": "Closing", "bullets": ["Some unrelated final text there"]}


def _pair(source_map: dict, first: int) -> dict | None:
    return next((entry for entry in source_map["pairs"] if entry["pages"] == [first, first + 1]), None)


def test_a_rearranged_or_reworded_line_is_not_a_build_even_when_every_word_recurs(tmp_path):
    cases = {
        # one derivation step rearranged into the next: the same tokens, another line
        "rearranged": [OPENING, {"title": "Solving for x", "lines": ["a x = c - b"]}, {"title": "Solving for x", "lines": ["x = (c - b) / a"]}, CLOSING],
        # three arrangements of one law; the last two even hold exactly the same tokens
        "rate_law": [OPENING, {"title": "Rate law", "lines": ["v = k [A] [B]"]}, {"title": "Rate law", "lines": ["k = v / ([A] [B])"]}, {"title": "Rate law", "lines": ["[B] = v / (k [A])"]}],
        # a short page whose words all happen to occur in a different later page under the same heading
        "scattered": [OPENING, {"title": "Glycolysis", "lines": ["ATP is produced"]},
                      {"title": "Glycolysis", "lines": ["Net yield is two ATP per glucose", "NADH is also produced and pyruvate is the end product"]}, CLOSING],
        # the same under different headings
        "other_heading": [OPENING, {"title": "Step one", "lines": ["the cell divides"]}, {"title": "Then", "lines": ["step one the cell grows, then the cell divides again"]}],
        # a callout sentence replaced by another sentence that re-uses its words
        "replaced": [OPENING, {"title": "Reading the plot", "lines": ["The curve rises with the dose", "Note the plateau begins near the top"]},
                     {"title": "Reading the plot", "lines": ["The curve rises with the dose", "Near the top the plateau begins, note the dose there"]}, CLOSING],
    }
    for name, pages in cases.items():
        source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}.pdf"))
        assert all(len(group) == 1 for group in _groups(source_map)), (name, _groups(source_map))
        for pair in source_map["pairs"]:
            assert pair["decision"] != "join" and "text_superset" not in pair["signals"] and "identical_text" not in pair["signals"], (name, pair)
        assert all("build" not in sm.describe_page(source_map, page["page"])["label"] for page in source_map["pages"]), name
    # Under the same heading the pair is not silently dropped: it is reported as uncertain, and the reason says what was compared.
    rearranged = sm.build_source_map(tmp_path / "rearranged.pdf")
    pair = _pair(rearranged, 2)
    assert pair["decision"] == "uncertain" and "same_words_other_lines" in pair["signals"] and any("lines" in reason for reason in pair["reasons"])
    assert pair["measures"]["removed"] == 0 and pair["measures"]["lines_kept"] < pair["measures"]["lines"][0]
    assert _slide_of(rearranged, 2)["grouping"] == "uncertain"


def test_a_build_that_draws_the_same_lines_in_another_order_is_still_a_build(tmp_path):
    first = [(20, 60, "Resting state sits near minus seventy millivolts"), (20, 80, "Sodium channels open and the cell depolarises")]
    later = [(20, 100, "Potassium channels restore the resting state"), first[1], first[0]]  # one line added, the earlier two drawn afterwards
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {"title": "Action potential", "texts": first}, {"title": "Action potential", "texts": later}, CLOSING]))
    assert _groups(source_map) == [[1], [2, 3], [4]]
    group = _slide_of(source_map, 2)
    assert group["kind"] == "incremental_build" and group["confidence"] == "high" and group["cumulative"] is True
    assert {"text_superset", "text_in_place", "same_title"} <= set(group["evidence"][0]["signals"])


def test_text_in_place_is_read_from_where_the_text_stands_not_from_how_it_is_painted(tmp_path):
    first = [(20, 60, "Resting state sits near minus seventy millivolts"), (20, 80, "Sodium channels open and the cell depolarises")]
    later = [(20, 100, "Potassium channels restore the resting state"), first[1], first[0]]
    # The later page dims the earlier lines (another colour) and draws them after the new one: the same words at the same places.
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {"title": "Action potential", "texts": first},
                                                     {"title": "Action potential", "texts": later, "text_colour": "slate"}, CLOSING]))
    pair = _pair(source_map, 2)
    assert pair["relation"] == "text_superset" and pair["kind"] == "incremental_build" and pair["confidence"] == "high"
    assert "text_in_place" in pair["signals"] and pair["measures"]["lines_kept"] < pair["measures"]["lines"][0]  # by place, not by the order of the lines
    assert _groups(source_map) == [[1], [2, 3], [4]]
    # The same lines moved down the page are not in place: with their order changed as well, nothing establishes a build.
    moved = [(20, 100, "Potassium channels restore the resting state"), (20, 120, first[1][2]), (20, 140, first[0][2])]
    apart = sm.build_source_map(_deck(tmp_path, [OPENING, {"title": "Action potential", "texts": first}, {"title": "Action potential", "texts": moved}, CLOSING], name="moved.pdf"))
    assert _groups(apart) == [[1], [2], [3], [4]] and _pair(apart, 2)["decision"] == "uncertain" and "text_in_place" not in _pair(apart, 2)["signals"]
    # Only the colour of the text changes: the same slide in another state, not a copy.
    recoloured = sm.build_source_map(_deck(tmp_path, [OPENING, {**PROSE}, {**PROSE, "text_colour": "red"}, CLOSING], name="recoloured.pdf"))
    pair = _pair(recoloured, 2)
    assert pair["relation"] == "identical_text_visual_change" and pair["kind"] == "animation_steps" and "page_identical" not in pair["signals"]


def test_a_line_that_only_grows_at_its_end_is_a_build_of_lower_confidence(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {"title": "Running totals", "lines": ["Sum of the first values: 2 5"]},
                                                     {"title": "Running totals", "lines": ["Sum of the first values: 2 5 9 14"]}, CLOSING]))
    assert _groups(source_map) == [[1], [2, 3], [4]]
    pair = _pair(source_map, 2)
    assert pair["relation"] == "text_superset" and pair["confidence"] == "medium" and pair["measures"]["lines_extended"] == 1
    assert "text_in_place" not in pair["signals"]


# ---- 3b. drawings: compared, not counted --------------------------------------------------------------------
AXES = [(150, 150, 240, 150), (150, 150, 150, 60)]
RISING = [(150, 150, 240, 70), (180, 150, 180, 120), (210, 150, 210, 95)]
FALLING = [(150, 70, 240, 150), (170, 90, 170, 150), (230, 140, 230, 150)]
PLOT = {"title": "Expression over time", "lines": ["time in hours", "expression level of the reporter"]}


def test_identical_text_over_a_different_drawing_is_not_a_duplicate(tmp_path):
    # Same heading and axis labels, two different line plots with the same number of strokes.
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {**PLOT, "strokes": AXES + RISING}, {**PLOT, "strokes": AXES + FALLING}, CLOSING]))
    assert _groups(source_map) == [[1], [2], [3], [4]]
    pair = _pair(source_map, 2)
    assert pair["decision"] == "uncertain" and {"identical_text", "drawing_changed"} <= set(pair["signals"]) and "page_identical" not in pair["signals"]
    assert any("drawing" in reason for reason in pair["reasons"]) and pair["measures"]["drawing"] == {"shapes": [5, 5], "common": 2}
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4"
    assert _page(source_map, 2)["drawing"]["visual_sha256"] != _page(source_map, 3)["drawing"]["visual_sha256"]


def test_a_drawing_that_grows_is_a_build_and_one_that_changes_is_an_animation_step(tmp_path):
    base = {**PLOT, "strokes": AXES + RISING}
    source_map = sm.build_source_map(_deck(tmp_path, [
        OPENING,
        base,
        {**base, "boxes": [(175, 112, 12, 12, "red")]},  # the same page plus a highlight: a build
        {**base, "boxes": [(205, 88, 12, 12, "red")]},  # the highlight moved: nothing was added, something changed
        {**base, "boxes": [(205, 88, 12, 12, "teal")]},  # the highlight recoloured
        CLOSING,
    ]))
    assert _groups(source_map) == [[1], [2, 3, 4, 5], [6]]
    grows, moved, recoloured = (_pair(source_map, n) for n in (2, 3, 4))
    assert grows["relation"] == "identical_text_drawing_grows" and grows["kind"] == "incremental_build" and grows["confidence"] == "high"
    assert {"identical_text", "text_in_place", "drawing_contained"} <= set(grows["signals"])
    for pair in (moved, recoloured):
        assert pair["relation"] == "identical_text_visual_change" and pair["kind"] == "animation_steps" and pair["confidence"] == "medium"
        assert "drawing_changed" in pair["signals"] and pair["measures"]["drawing"] == {"shapes": [6, 6], "common": 5}
    group = _slide_of(source_map, 3)
    # The group is not called a build or a copy, its confidence is not high, and the last page is not said to show everything.
    assert group["kind"] == "animation_steps" and group["confidence"] == "medium" and group["cumulative"] is False
    assert sm.describe_page(source_map, 4)["label"] == "PDF page 4 of 6 · step 3 of 4"
    assert sm.summary(source_map)["groups"] == {"incremental_build": 0, "duplicate": 0, "animation_steps": 1, "manual_group": 0}
    # What a page's text shows is taken from the embedded text; the map says that visibility was not established.
    assert source_map["text_basis"]["visible_text_established"] is False and group["text_visibility"] == "not_established"

    only_build = sm.build_source_map(_deck(tmp_path, [OPENING, base, {**base, "boxes": [(175, 112, 12, 12, "red")]}, CLOSING], name="grows.pdf"))
    assert _slide_of(only_build, 2)["kind"] == "incremental_build" and _slide_of(only_build, 2)["cumulative"] is True
    assert sm.describe_page(only_build, 3)["label"] == "PDF page 3 of 4 · build 2 of 2"


def test_pages_that_draw_exactly_the_same_are_a_duplicate_also_without_a_picture(tmp_path):
    same = {**PLOT, "strokes": AXES + RISING, "boxes": [(175, 112, 12, 12, "red")]}
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, same, dict(same), CLOSING]))
    pair = _pair(source_map, 2)
    assert pair["relation"] == "identical" and pair["kind"] == "duplicate" and pair["confidence"] == "high" and "page_identical" in pair["signals"]
    assert _page(source_map, 2)["drawing"]["visual_sha256"] == _page(source_map, 3)["drawing"]["visual_sha256"]
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · copy 2 of 2"


PROSE = {"title": "Reading the gel", "lines": ["Lane one holds the ladder and lane two the uncut plasmid", "Lane three shows two bands after the digest"]}


def test_a_cover_lifted_from_the_same_text_is_a_build_and_a_cover_laid_over_it_is_a_step(tmp_path):
    covers = [(20, 60, 100, 8, (255, 255, 255)), (20, 73, 100, 8, (255, 255, 255))]  # two boxes in the paint of the paper, drawn over the text
    # The same text at the same places; the earlier page lays two covers over it, the later page none: the later page shows all of the earlier and more.
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {**PROSE, "boxes": covers}, PROSE, CLOSING]))
    pair = _pair(source_map, 2)
    assert pair["decision"] == "join" and pair["relation"] == "identical_text_cover_removed" and pair["kind"] == "incremental_build" and pair["confidence"] == "high"
    assert pair["measures"]["drawing"] == {"shapes": [0, 0], "common": 0} and pair["measures"]["covers"] == [2, 0]
    assert {"identical_text", "text_in_place", "cover_removed"} <= set(pair["signals"]) and "page_identical" not in pair["signals"]
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · build 2 of 2" and _slide_of(source_map, 2)["cumulative"] is True
    # The text of the covered page is the embedded text: the map does not claim to know what the boxes hide. It does say that the
    # page paints two fills in the paint of its background, which is where that limitation is most likely to matter.
    assert _page(source_map, 2)["word_count"] == _page(source_map, 3)["word_count"] and _slide_of(source_map, 2)["text_visibility"] == "not_established"
    assert [_page(source_map, n)["drawing"]["fills_in_background_paint"] for n in (2, 3)] == [2, 0] and _page(source_map, 2)["drawing"]["shapes_beyond_template"] == 0
    assert source_map["text_basis"] == {"source": "embedded_text", "visible_text_established": False, "note": source_map["text_basis"]["note"]}
    # A page whose text is all of one size has no heading set apart; how much text it holds is counted all the same.
    plain = [(20, 50 + 12 * n, line) for n, line in enumerate(["Lane one holds the ladder", "Lane two holds the uncut plasmid", "Lane three shows two bands after the digest"])]
    untitled = sm.build_source_map(_deck(tmp_path, [OPENING, {"texts": plain, "boxes": covers}, {"texts": plain}, CLOSING], name="untitled.pdf"))
    assert _pair(untitled, 2)["relation"] == "identical_text_cover_removed" and _pair(untitled, 2)["kind"] == "incremental_build"
    assert _pair(untitled, 2)["confidence"] == "high"  # a slide's worth of text, not a heading alone

    # A cover outlined in the paper's paint is still a cover; one with a visible outline is a frame somebody drew.
    white = (255, 255, 255)
    outlined = sm.build_source_map(_deck(tmp_path, [OPENING, {**PROSE, "boxes": [(20, 60, 100, 8, white, white)]}, {**PROSE, "boxes": [(20, 60, 100, 8, white, "red")]}, CLOSING],
                                         name="outlined.pdf"))
    assert [(_page(outlined, n)["drawing"]["fills_in_background_paint"], _page(outlined, n)["drawing"]["shapes_beyond_template"]) for n in (2, 3)] == [(1, 0), (0, 1)]

    # The other way round the later page may hide what the earlier page showed: one slide in two states, not a build.
    laid = sm.build_source_map(_deck(tmp_path, [OPENING, PROSE, {**PROSE, "boxes": covers}, CLOSING], name="laid.pdf"))
    pair = _pair(laid, 2)
    assert pair["relation"] == "identical_text_visual_change" and pair["kind"] == "animation_steps" and pair["confidence"] == "medium"
    assert "cover_added" in pair["signals"] and sm.describe_page(laid, 3)["label"] == "PDF page 3 of 4 · step 2 of 2" and _slide_of(laid, 2)["cumulative"] is False


CITED = {"title": "Oscillations in the circuit", "lines": ["Adapted from a synthetic article about a fast and tunable gene oscillator, volume four, pages one to nine"]}


def test_the_same_heading_and_caption_over_another_picture_are_two_slides_however_long_the_caption(tmp_path):
    # Found on a real deck in the visual check: one heading and one long citation line over two different pictures were two slides.
    # A picture is compared by its bytes, so "another picture" is a fact — unlike drawing operations, which can differ for the same drawing.
    box = (60, 80, 120, 90)
    pictures = sm.build_source_map(_deck(tmp_path, [OPENING, {**CITED, "images": [{"seed": 1, "box": box}]}, {**CITED, "images": [{"seed": 2, "box": box}]}, CLOSING]))
    pair = _pair(pictures, 2)
    assert _groups(pictures) == [[1], [2], [3], [4]] and pair["decision"] == "uncertain" and any("picture" in reason for reason in pair["reasons"])
    assert {"identical_text", "text_in_place"} <= set(pair["signals"]) and "step" not in sm.describe_page(pictures, 3)["label"]
    more = {**CITED, "lines": [*CITED["lines"], "The period shortens as the inducer rises"]}
    grown = sm.build_source_map(_deck(tmp_path, [OPENING, {**CITED, "images": [{"seed": 1, "box": box}]}, {**more, "images": [{"seed": 2, "box": box}]}, CLOSING], name="grown.pdf"))
    assert _groups(grown) == [[1], [2], [3], [4]] and any("picture" in reason for reason in _pair(grown, 2)["reasons"])


def test_what_carries_a_join_when_most_of_the_drawing_reads_as_different(tmp_path):
    more = {**CITED, "lines": [*CITED["lines"], "The period shortens as the inducer rises"]}
    # A slide's worth of the same text, in the same order: one slide in two states, at medium and never a build or a copy —
    # different drawing operations are weak evidence (the same shapes are written with other operators under a transparency group).
    same_text = sm.build_source_map(_deck(tmp_path, [OPENING, {**CITED, "strokes": AXES + RISING}, {**CITED, "strokes": AXES + FALLING}, CLOSING], name="same-text.pdf"))
    grown = sm.build_source_map(_deck(tmp_path, [OPENING, {**CITED, "strokes": AXES + RISING}, {**more, "strokes": AXES + FALLING}, CLOSING], name="grown.pdf"))
    for source_map, relation in ((same_text, "identical_text_visual_change"), (grown, "text_superset_visual_change")):
        pair = _pair(source_map, 2)
        assert pair["relation"] == relation and pair["kind"] == "animation_steps" and pair["confidence"] == "medium" and "drawing_changed" in pair["signals"]
        assert pair["measures"]["drawing"] == {"shapes": [5, 5], "common": 2}
        assert _slide_of(source_map, 2)["cumulative"] is False and sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · step 2 of 2"
    # A caption's worth of text does not carry it: a heading and a label can stand over two different figures.
    short = {"title": "Expression over time", "lines": ["time in hours"]}
    caption = sm.build_source_map(_deck(tmp_path, [OPENING, {**short, "strokes": AXES + RISING}, {**PLOT, "strokes": AXES + FALLING}, CLOSING], name="caption.pdf"))
    pair = _pair(caption, 2)
    assert pair["decision"] == "uncertain" and "text_superset" in pair["signals"] and any("drawing" in reason for reason in pair["reasons"])
    assert _groups(caption) == [[1], [2], [3], [4]]
    # The same picture (by its bytes) on both pages does carry it, also under little text: the page was laid out again around the picture.
    # (Here the picture is moved as well, so that not one mark of the earlier page is on the later page.)
    vouched = sm.build_source_map(_deck(tmp_path, [OPENING, {**short, "strokes": RISING, "images": [{"seed": 7, "box": (150, 60, 60, 45)}]},
                                                  {**PLOT, "strokes": FALLING, "images": [{"seed": 7, "box": (150, 50, 60, 45)}]}, CLOSING], name="vouched.pdf"))
    pair = _pair(vouched, 2)
    assert pair["relation"] == "text_superset_visual_change" and pair["kind"] == "animation_steps" and "images_identical" in pair["signals"]
    assert pair["measures"]["drawing"] == {"shapes": [4, 4], "common": 0} and pair["confidence"] == "medium"
    # When most of the drawing is kept and a part of it changes, the growing text is one slide in two states whatever its length.
    kept = sm.build_source_map(_deck(tmp_path, [OPENING, {**short, "strokes": AXES + RISING}, {**PLOT, "strokes": AXES + RISING[:2] + FALLING[:1]}, CLOSING], name="kept.pdf"))
    pair = _pair(kept, 2)
    assert pair["relation"] == "text_superset_visual_change" and pair["measures"]["drawing"] == {"shapes": [5, 5], "common": 4}


def test_a_cover_laid_while_something_is_added_makes_a_step_not_a_build(tmp_path):
    # A fill in the paper's paint that the earlier page does not have may hide something of the earlier page. The later page is then
    # not known to show all that the earlier page shows — which is what "build" and "cumulative" say — so the pair is one slide in two states.
    white = (255, 255, 255)
    first = {"title": "Cell volume", "lines": ["Given the dimensions of the cell from the figure", "The volume is about one cubic micron"]}
    grown = {**first, "lines": [*first["lines"], "The mass follows from the density of water"], "strokes": [(20, 110, 120, 110)]}
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, first, {**grown, "boxes": [(20, 110, 100, 12, white)]}, CLOSING]))
    pair = _pair(source_map, 2)
    assert pair["relation"] == "text_superset_visual_change" and pair["kind"] == "animation_steps" and pair["confidence"] == "medium"
    assert "cover_added" in pair["signals"] and pair["measures"]["covers"] == [0, 1] and _slide_of(source_map, 2)["cumulative"] is False
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · step 2 of 2"
    # The same text, a box in the paper's paint laid over the old curve, and a new curve drawn: not a build either.
    curve = {**PLOT, "strokes": AXES + RISING}
    redrawn = sm.build_source_map(_deck(tmp_path, [OPENING, curve, {**curve, "strokes": AXES + RISING + FALLING[:1], "boxes": [(150, 60, 95, 95, white)]}, CLOSING], name="redrawn.pdf"))
    pair = _pair(redrawn, 2)
    assert pair["relation"] == "identical_text_visual_change" and pair["kind"] == "animation_steps" and pair["confidence"] == "medium" and "cover_added" in pair["signals"]
    assert _slide_of(redrawn, 2)["cumulative"] is False
    # Without the cover both are builds: everything of the earlier page is on the later page, and more.
    plain = sm.build_source_map(_deck(tmp_path, [OPENING, first, grown, CLOSING], name="plain.pdf"))
    assert _pair(plain, 2)["relation"] == "text_superset" and _pair(plain, 2)["kind"] == "incremental_build" and _pair(plain, 2)["confidence"] == "high"
    added = sm.build_source_map(_deck(tmp_path, [OPENING, curve, {**curve, "strokes": AXES + RISING + FALLING[:1]}, CLOSING], name="added.pdf"))
    assert _pair(added, 2)["relation"] == "identical_text_drawing_grows" and _slide_of(added, 2)["cumulative"] is True
    # A box with an outline somebody drew is a shape, not a cover: adding a framed formula is still a build.
    framed = sm.build_source_map(_deck(tmp_path, [OPENING, first, {**grown, "boxes": [(20, 110, 100, 12, white, "red")]}, CLOSING], name="framed.pdf"))
    assert _pair(framed, 2)["relation"] == "text_superset" and _pair(framed, 2)["kind"] == "incremental_build" and "cover_added" not in _pair(framed, 2)["signals"]


def test_growing_text_whose_drawing_could_not_be_compared_is_a_step_never_a_firm_build(tmp_path):
    first = {**PROSE, "strokes": AXES + RISING}
    second = {**PROSE, "lines": [*PROSE["lines"], "The insert runs in the fourth lane"], "strokes": AXES + FALLING}  # the text grows, the figure is another one
    path = _deck(tmp_path, [OPENING, first, second, CLOSING])
    compared = _pair(sm.build_source_map(path), 2)
    assert compared["relation"] == "text_superset_visual_change" and compared["kind"] == "animation_steps" and compared["confidence"] == "medium"
    limited = sm.build_source_map(path, limits=sm.Limits(max_marks_per_page=3))  # the marks of a page are not all kept: the drawings are not compared
    pair = _pair(limited, 2)
    # Knowing less never gives the stronger claim: not a build, not high, and the last page is not said to show everything.
    assert "drawing_not_compared" in pair["signals"] and pair["relation"] == "text_superset_drawing_not_compared"
    assert pair["kind"] == "animation_steps" and pair["confidence"] == "medium" and _slide_of(limited, 2)["cumulative"] is False
    assert sm.describe_page(limited, 3)["label"] == "PDF page 3 of 4 · step 2 of 2"


def test_pages_on_which_the_deck_prints_different_slide_numbers_are_not_joined_when_its_numbers_count_slides(tmp_path):
    def page(n: int, printed: int, **extra) -> dict:
        return {"title": f"Topic {'ABCDEFGH'[n - 1]}", "bullets": [f"A statement for page {'abcdefgh'[n - 1]} only and nothing else"], "printed": printed, **extra}

    same = {"title": "Dose response", "lines": PROSE["lines"], "strokes": AXES + RISING}
    changed = {**same, "boxes": [(175, 112, 12, 12, "red")]}
    # This deck numbers slides, not pages: the two builds of "Topic B" both print 2. The two "Dose response" pages print 5 and 6.
    by_slide = [page(1, 1), page(2, 2), {**page(2, 2), "bullets": [page(2, 2)["bullets"][0], "A second statement revealed afterwards"]}, page(4, 3), page(5, 4),
                {**same, "printed": 5}, {**changed, "printed": 6}, page(8, 7)]
    source_map = sm.build_source_map(_deck(tmp_path, by_slide))
    assert source_map["printed_numbers"]["established"] is True and source_map["printed_numbers"]["evidence"]["repeats"] == 1
    assert source_map["printed_numbers"]["numbers_count_slides"] is True
    assert _groups(source_map) == [[1], [2, 3], [4], [5], [6], [7], [8]]
    pair = _pair(source_map, 6)
    assert pair["decision"] == "uncertain" and any("different slide numbers" in reason for reason in pair["reasons"]) and "printed_numbers_differ" in pair["signals"]
    assert sm.describe_page(source_map, 7)["label"] == "PDF page 7 of 8 · Slide 6"
    # A deck that numbers every page says nothing by printing another number on the next page: there the same pair is a build.
    by_page = [page(n, n) for n in range(1, 6)] + [{**same, "printed": 6}, {**changed, "printed": 7}, page(8, 8)]
    numbered = sm.build_source_map(_deck(tmp_path, by_page, name="by-page.pdf"))
    assert numbered["printed_numbers"]["established"] is True and numbered["printed_numbers"]["numbers_count_slides"] is False
    assert _groups(numbered)[5] == [6, 7] and _pair(numbered, 6)["relation"] == "identical_text_drawing_grows"


def test_a_heading_whose_figure_appears_on_the_next_page_is_a_build_only_when_the_heading_stays_in_place(tmp_path):
    heading = {"title": "Lac operon"}
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, heading, {**heading, "strokes": AXES + RISING}, CLOSING]))
    pair = _pair(source_map, 2)
    # Everything the earlier page draws is on the later page, where it was, and a drawing is added: a build, but of a heading only — medium.
    assert pair["relation"] == "identical_text_drawing_grows" and pair["kind"] == "incremental_build" and pair["confidence"] == "medium"
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · build 2 of 2"
    # The same words set somewhere else on the page (a section page in another layout) are not a build.
    moved = sm.build_source_map(_deck(tmp_path, [OPENING, {"texts": [(90, 90, "Lac operon")]}, {**heading, "strokes": AXES + RISING}, CLOSING], name="moved.pdf"))
    assert _groups(moved) == [[1], [2], [3], [4]] and _pair(moved, 2)["decision"] == "uncertain" and "text_in_place" not in _pair(moved, 2)["signals"]


def test_identical_text_whose_drawing_could_not_be_compared_is_a_step_never_a_copy(tmp_path):
    same = {**PROSE, "strokes": AXES + RISING}
    path = _deck(tmp_path, [OPENING, same, dict(same), CLOSING])
    assert _pair(sm.build_source_map(path), 2)["kind"] == "duplicate"  # compared mark for mark: the pages draw the same
    # With a bound so low that the marks of a page are not all kept, the drawings are not compared ...
    limited = sm.build_source_map(path, limits=sm.Limits(max_marks_per_page=3))
    assert _page(limited, 2)["drawing"]["marks_compared"] is False
    changed = sm.build_source_map(_deck(tmp_path, [OPENING, same, {**PROSE, "strokes": AXES + FALLING}, CLOSING], name="changed.pdf"), limits=sm.Limits(max_marks_per_page=3))
    pair = _pair(changed, 2)
    # ... and equal text alone is then one slide in two states at most: not "identical", not a copy, not high.
    assert pair["relation"] == "identical_text_drawing_not_compared" and pair["kind"] == "animation_steps" and pair["confidence"] == "medium"
    assert "drawing_not_compared" in pair["signals"] and pair["measures"]["drawing"] is None and "page_identical" not in pair["signals"]
    assert sm.describe_page(changed, 3)["label"] == "PDF page 3 of 4 · step 2 of 2"
    # The digest of everything a page draws does not depend on the bound, so pages that draw exactly the same are still a copy.
    assert _pair(limited, 2)["kind"] == "duplicate" and "page_identical" in _pair(limited, 2)["signals"]


def test_a_fill_that_covers_the_page_is_a_background_and_not_a_drawing(tmp_path):
    paper = (250, 246, 235)
    source_map = sm.build_source_map(_deck(tmp_path, [
        {**OPENING, "background": paper},
        {"title": "Part 2", "background": paper},  # a divider on its own background fill
        {"title": "Part 3", "boxes": [(100, 80, 40, 30, "teal")]},  # a divider with a box drawn on it
        {"background": paper},  # nothing but a background
        {"boxes": [(100, 80, 40, 30, "teal")]},  # nothing but a box
    ]))
    assert [_page(source_map, n)["drawing"]["paint_operations"] for n in (2, 3, 4, 5)] == [1, 1, 1, 1]  # each paints one shape; what it is decides
    assert [_page(source_map, n)["drawing"]["shapes_beyond_template"] for n in (2, 3, 4, 5)] == [0, 1, 0, 1]
    assert _roles(source_map)[1:] == ["structural_title_or_section", "instructional", "blank", "unknown"]
    assert _page(source_map, 3)["role"]["uncertain"] is True and _page(source_map, 3)["role"]["forced_requirements"] is True
    # A background is still part of what a page draws: two pages that differ only in it are not a copy of each other.
    pair = _pair(sm.build_source_map(_deck(tmp_path, [OPENING, PROSE, {**PROSE, "background": paper}, CLOSING], name="background.pdf")), 2)
    assert pair["kind"] != "duplicate" and "page_identical" not in pair["signals"]


def test_a_fill_in_the_paint_of_the_background_shows_nothing_and_is_not_a_drawing(tmp_path):
    paper, black = (250, 246, 235), (0, 0, 0)
    whole_page = [(0, 0), (254, 0), (254, 190.5), (0, 190.5)]  # a background written as four straight sides instead of a rectangle
    rule = [(20, 34, 234, 34)]  # a line under the heading on every page: part of the template
    body = [{"title": f"Topic {n}", "bullets": [f"A statement about topic number {n} and nothing else"], "background": paper, "strokes": rule} for n in range(1, 6)]
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"title": "Synthetic Systems Biology", "background": paper, "strokes": rule, "boxes": [(15, 30, 225, 8, paper)]},  # 1 the cover hides the rule under a box in the paper's paint
        *body,  # 2-6
        {"title": "Part 2", "background": paper, "strokes": rule, "boxes": [(100, 80, 40, 30, "teal")]},  # 7 a box in another paint is a drawing
        {"title": "Part 3", "polygons": [(whole_page, paper)], "strokes": rule},  # 8 the same background, written as a polygon
        {"background": paper, "polygons": [(whole_page, black)], "strokes": rule},  # 9 a black end page: a second background over the first
    ]))
    assert source_map["template"]["template_marks"] >= 1  # the rule
    assert [_page(source_map, n)["drawing"]["shapes_beyond_template"] for n in (1, 2, 7, 8, 9)] == [0, 0, 1, 0, 0]
    assert _roles(source_map)[0] == "structural_title_or_section" and _page(source_map, 1)["role"]["forced_requirements"] is False
    assert _roles(source_map)[6:] == ["instructional", "structural_title_or_section", "blank"]
    assert _page(source_map, 7)["role"]["uncertain"] is True
    # On a page that paints no background the paper is white: a white box alone shows nothing, a box in any other paint does.
    bare = sm.build_source_map(_deck(tmp_path, [OPENING, {"boxes": [(100, 80, 40, 30, (255, 255, 255))]}, {"boxes": [(100, 80, 40, 30, paper)]}, CLOSING], name="bare.pdf"))
    assert _roles(bare)[1:3] == ["blank", "unknown"]
    # Such a fill is still compared: a page with the box and a page without it do not draw the same.
    assert _page(bare, 2)["drawing"]["visual_sha256"] != sm.build_source_map(_deck(tmp_path, [OPENING, {}, CLOSING], name="empty.pdf"))["pages"][1]["drawing"]["visual_sha256"]


def test_a_picture_whose_bytes_cannot_be_read_is_never_evidence_that_two_pages_are_equal(tmp_path, monkeypatch):
    same = {"title": "Scanned figure", "lines": ["The same words on both pages"], "images": [{"seed": 3, "box": (150, 60, 60, 45)}]}
    path = _deck(tmp_path, [OPENING, same, dict(same), CLOSING])
    assert _pair(sm.build_source_map(path), 2)["kind"] == "duplicate"
    monkeypatch.setattr(sm, "_stream_bytes", lambda obj: None)  # as if the parser no longer handed out the stored bytes
    source_map = sm.build_source_map(path)
    image = _page(source_map, 2)["images"][0]
    assert image["digest_basis"] == "name_and_size" and image["bytes"] is None and image["template"] is False
    pair = _pair(source_map, 2)
    assert pair["decision"] == "uncertain" and any("could not be read" in reason for reason in pair["reasons"])
    assert "images_identical" not in pair["signals"] and "page_identical" not in pair["signals"]
    assert _groups(source_map) == [[1], [2], [3], [4]]


def test_identical_adjacent_pages_are_a_duplicate_group(tmp_path):
    same = {"title": "Dose response", "bullets": ["Half maximal effect at the midpoint", "The slope reflects cooperativity"], "images": [{"seed": 3, "box": (150, 60, 60, 45)}]}
    source_map = sm.build_source_map(_deck(tmp_path, [{"title": "Receptors", "bullets": ["Ligands bind with a measurable affinity"]}, same, dict(same),
                                                     {"title": "Antagonists", "bullets": ["They shift the curve to the right"]}]))
    assert _groups(source_map) == [[1], [2, 3], [4]]
    group = _slide_of(source_map, 2)
    assert group["kind"] == "duplicate" and group["evidence"][0]["relation"] == "identical"
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 4 · copy 2 of 2"


def test_weak_or_disagreeing_signals_keep_the_pages_separate_and_say_so(tmp_path):
    grown = ["Promoters recruit the polymerase", "Repressors block the promoter"]
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"title": "Gene regulation"},  # only a heading ...
        {"title": "Gene regulation", "bullets": grown},  # ... then the heading with content: a section page or a first build?
        {"title": "Operon logic", "bullets": ["Lactose present and glucose absent"], "images": [{"seed": 1, "box": (150, 60, 60, 45)}]},
        {"title": "Operon logic", "bullets": ["Lactose present and glucose absent", "Then the operon is transcribed"], "images": [{"seed": 2, "box": (150, 60, 60, 45)}]},
    ]))
    assert _groups(source_map) == [[1], [2], [3], [4]]
    heading_only = next(entry for entry in source_map["pairs"] if entry["pages"] == [1, 2])
    assert heading_only["decision"] == "uncertain" and any("heading" in reason for reason in heading_only["reasons"])
    picture_changed = next(entry for entry in source_map["pairs"] if entry["pages"] == [3, 4])
    assert picture_changed["decision"] == "uncertain" and any("picture" in reason for reason in picture_changed["reasons"])
    for page in (1, 2, 3, 4):
        slide = _slide_of(source_map, page)
        assert slide["grouping"] == "uncertain" and slide["uncertain_reasons"] and slide["kind"] == "single"
    assert sm.summary(source_map)["uncertain_pairs"] == 2


def test_a_heading_page_joins_the_next_page_only_under_the_same_heading_with_its_own_picture(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"title": "Feedback motifs", "images": [{"seed": 1, "box": (150, 60, 60, 45)}]},  # the heading and its picture ...
        {"title": "Feedback motifs", "bullets": ["Negative loops speed the response", "Positive loops can lock a state"], "images": [{"seed": 1, "box": (150, 60, 60, 45)}]},
        {"title": "Cascade", "images": [{"seed": 2, "box": (150, 60, 60, 45)}]},  # ... but here the next page has another heading
        {"title": "Amplification by stages", "lines": ["Each stage of the cascade multiplies the signal"], "images": [{"seed": 2, "box": (150, 60, 60, 45)}]},
    ]))
    assert _groups(source_map) == [[1, 2], [3], [4]]
    first = _slide_of(source_map, 1)
    assert first["kind"] == "incremental_build" and first["confidence"] == "medium" and {"same_title", "images_identical"} <= set(first["evidence"][0]["signals"])
    other = next(entry for entry in source_map["pairs"] if entry["pages"] == [3, 4])
    assert other["decision"] == "uncertain" and "same_title" not in other["signals"]


# ---- 4. numbering --------------------------------------------------------------------------------------
def test_pdf_page_labels_that_differ_from_the_index_are_kept_as_a_separate_identity(tmp_path):
    pages = [{"title": f"Front matter {n}", "bullets": ["Introductory words for this page"]} for n in (1, 2)]
    pages += [{"title": f"Body topic {n}", "bullets": [f"Substantive statement number {n} of the body"]} for n in range(1, 5)]
    source_map = sm.build_source_map(_deck(tmp_path, pages, page_labels={1: ("r", None, 1), 3: ("D", None, 1)}))
    assert source_map["pdf_labels"]["defined"] is True and source_map["pdf_labels"]["differ_from_index"] is True
    assert [page["pdf_label"] for page in source_map["pages"]] == ["i", "ii", "1", "2", "3", "4"]
    assert [page["page"] for page in source_map["pages"]] == [1, 2, 3, 4, 5, 6]
    described = sm.describe_page(source_map, 3)
    assert described["label"] == "PDF page 3 of 6 · PDF label 1" and described["pdf_label"] == "1"
    assert sm.resolve(source_map, "page=3")["page"] == 3  # an address is the physical index, never the label
    assert all(page["printed_number"] is None for page in source_map["pages"])  # a label is not a printed slide number


def test_printed_numbers_that_skip_and_repeat_are_established_with_their_evidence(tmp_path):
    printed = [1, 2, 3, 5, 6, 6, 8]
    pages = [{"title": f"Concept {n}", "bullets": [f"A statement that belongs to concept {n} only"], "printed": number, "footer": "Synthetic course - week 2"}
             for n, number in enumerate(printed, start=1)]
    pages[5] = {"title": "Concept 5", "bullets": ["A statement that belongs to concept 5 only", "A second statement revealed afterwards"], "printed": 6, "footer": "Synthetic course - week 2"}
    source_map = sm.build_source_map(_deck(tmp_path, pages))

    numbers = source_map["printed_numbers"]
    assert numbers["established"] is True and numbers["evidence"]["method"] == "consistent_number_sequence"
    assert numbers["evidence"]["pages_with_number"] == 7 and numbers["evidence"]["repeats"] == 1
    assert numbers["evidence"]["skips"] == [[3, 5], [6, 8]]
    assert [page["printed_number"] for page in source_map["pages"]] == printed
    assert sm.describe_page(source_map, 4)["label"] == "PDF page 4 of 7 · Slide 5"  # page 4 prints 5: index and number differ
    # The number repeated on consecutive pages supports the build; both builds keep the number the deck prints.
    assert _groups(source_map)[4] == [5, 6] and "printed_number_repeat" in _slide_of(source_map, 5)["evidence"][0]["signals"]
    assert _slide_of(source_map, 5)["printed_numbers"] == [6]
    assert sm.describe_page(source_map, 6)["label"] == "PDF page 6 of 7 · build 2 of 2 · Slide 6"


def test_without_grounded_printed_numbers_the_label_says_only_page_x_of_n(tmp_path):
    pages = [{"title": "Dosing", "bullets": ["Start at dose 40"]}, {"title": "Clearance", "bullets": ["Half life near 12"]},
             {"title": "Gain", "bullets": ["Loop gain around 7"]}, {"title": "Delay", "bullets": ["Transport delay of 3"]}]
    # Numbers that end a page but jump about (40, 12, 7, 3), and a constant one (the year in a footer), establish nothing.
    for name, deck in (("content.pdf", pages), ("footer.pdf", [dict(page, footer="Synthetic course - Fall 2026") for page in pages])):
        source_map = sm.build_source_map(_deck(tmp_path, deck, name=name))
        assert source_map["printed_numbers"]["established"] is False and source_map["printed_numbers"]["evidence"]["method"] == "consistent_number_sequence"
        assert all(page["printed_number"] is None for page in source_map["pages"])
        described = sm.describe_page(source_map, 2)
        assert described["label"] == "PDF page 2 of 4" and described["printed_number"] is None and "Slide" not in described["label"]


def test_numbers_in_the_body_text_are_never_worded_as_slide_numbers(tmp_path):
    def topic(n: int, **extra) -> dict:
        return {"title": f"Topic {'ABCDEFGHIJKL'[n - 1]}", "bullets": [f"A statement for page {'abcdefghijkl'[n - 1]} only and nothing else"], **extra}

    decks = {
        # a caption that ends every page and counts up by one
        "figure_by_one": [topic(n, lines=[f"See Figure {n + 2}"]) for n in range(1, 6)],
        # eight of twelve pages end with a figure reference that grows by twos and fours
        "figure_sparse": [topic(n, **({"lines": [f"Adapted from Figure {2 * n + 3}"]} if n % 3 else {})) for n in range(1, 13)],
        # the last bullet ends with a growing year, or with a growing measurement
        "years": [{"title": f"Era {'ABCDE'[n]}", "bullets": [f"A discovery {'abcde'[n]} was reported in {1950 + 4 * n}"]} for n in range(5)],
        "doses": [{"title": f"Dose {'ABCDE'[n]}", "bullets": [f"Sample {'abcde'[n]} measured at dose {10 * (n + 1)}"]} for n in range(5)],
        # a number that stands alone and counts up by one, but in the body of the page (a step counter), not in its margin
        "step_counter": [topic(n, texts=[(200, 95, str(n))]) for n in range(1, 7)],
        # a number that stands alone in the corner of every page but leaps ahead each time (a date, a room, a count): no near-unit steps
        "leaping_corner": [topic(n, printed=value) for n, value in enumerate((3, 9, 14, 22, 31, 40), start=1)],
        # a number in the corner of only two pages
        "two_pages": [topic(n, **({"printed": n} if n <= 2 else {})) for n in range(1, 7)],
    }
    for name, pages in decks.items():
        source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}.pdf"))
        assert source_map["printed_numbers"]["established"] is False, (name, source_map["printed_numbers"])
        assert all(page["printed_number"] is None for page in source_map["pages"]), name
        assert sm.describe_page(source_map, 2)["label"] == f"PDF page 2 of {len(pages)}", name


def test_a_number_printed_at_one_place_in_the_page_margin_is_established_wherever_that_place_is(tmp_path):
    pages = [{"title": f"Concept {n}", "bullets": [f"A statement that belongs to concept {n} only"], "printed": n + 3, "printed_xy": (232, 6)} for n in range(1, 7)]
    source_map = sm.build_source_map(_deck(tmp_path, pages))
    evidence = source_map["printed_numbers"]["evidence"]
    assert source_map["printed_numbers"]["established"] is True and evidence["position"] == "page_margin" and evidence["margin"] == "top"
    assert evidence["pages_with_number"] == 6 and evidence["steps_of_at_most_one"] == 5 and 0.0 <= evidence["from_top"] <= 0.12
    assert [page["printed_number"] for page in source_map["pages"]] == [4, 5, 6, 7, 8, 9]
    assert sm.describe_page(source_map, 2)["label"] == "PDF page 2 of 6 · Slide 5"
    assert _page(source_map, 2)["title"] == "Concept 2"  # the number is not taken for the heading


def test_a_counter_that_repeats_over_different_slides_is_not_a_slide_number(tmp_path):
    # A section or part counter printed alone in the corner: it stands at one place, never runs backwards and never leaps —
    # but where it repeats, the pages are different slides, so it does not count slides.
    sections = [_topic(n, printed=(n - 1) // 5 + 1) for n in range(1, 16)]  # 1 on five slides, 2 on five, 3 on five
    shared = ["Shared words that every page of this part carries along with it"]
    similar = [{"title": f"Heading {'ABCDEFGHIJKLMNO'[n]}", "lines": [*shared, f"and a few words of page {'abcdefghijklmno'[n]} alone"], "printed": n // 5 + 1} for n in range(15)]
    for name, pages in (("sections", sections), ("similar", similar)):
        source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}.pdf"))
        assert source_map["printed_numbers"]["established"] is False and source_map["printed_numbers"]["numbers_count_slides"] is False, (name, source_map["printed_numbers"])
        assert all(page["printed_number"] is None for page in source_map["pages"]), name
        assert sm.describe_page(source_map, 8)["label"] == "PDF page 8 of 15", name
        assert all(len(group) == 1 for group in _groups(source_map)), (name, _groups(source_map))  # and it joins nothing
        assert not any("printed_number_repeat" in pair["signals"] for pair in source_map["pairs"]), name


def test_two_values_in_the_corner_do_not_establish_printed_numbers(tmp_path):
    def build(title: str, lines: int, printed: int) -> dict:
        return {"title": title, "bullets": [f"Statement {'abc'[i]} about {title.lower()} and nothing else" for i in range(lines)], "printed": printed}

    # Two slides of three builds each, numbered 1 and 2: the repeats are those of a slide number, yet two values are not a sequence.
    source_map = sm.build_source_map(_deck(tmp_path, [build("Membranes", n, 1) for n in (1, 2, 3)] + [build("Channels", n, 2) for n in (1, 2, 3)]))
    assert source_map["printed_numbers"]["established"] is False and all(page["printed_number"] is None for page in source_map["pages"])
    assert "Slide" not in sm.describe_page(source_map, 5)["label"]
    assert _groups(source_map) == [[1, 2, 3], [4, 5, 6]]  # the builds are found by their text all the same
    # With a third slide the same numbers are a sequence.
    three = sm.build_source_map(_deck(tmp_path, [build("Membranes", n, 1) for n in (1, 2, 3)] + [build("Channels", n, 2) for n in (1, 2, 3)] + [build("Pumps", 1, 3)], name="three.pdf"))
    assert three["printed_numbers"]["established"] is True and three["printed_numbers"]["evidence"]["repeats_under_one_heading"] == 4
    assert sm.describe_page(three, 5)["label"] == "PDF page 5 of 7 · build 2 of 3 · Slide 2"


def test_pdf_labels_are_a_grouping_signal_only_when_several_of_them_count(tmp_path):
    def labelled(numbers: list[int] | None = None, prefix: str | None = None) -> dict:
        return {n: ("D", prefix, value) for n, value in enumerate(numbers or [1, 1, 2, 2, 3, 3], start=1)}

    # Six different steps under one heading: a label that names the author's frame would make each pair of them one slide.
    pages = [{"title": "Deriving the result", "lines": [f"Step {'abcdef'[n]}: {words}"]} for n, words in enumerate(
        ["write the balance of forces", "divide by the mass", "integrate over time", "insert the initial speed", "solve for the height", "check the units"])]
    cases = {
        "counting": (labelled(), True, [[1, 2], [3, 4], [5, 6]]),  # three numbers that never run backwards: the frames of an overlay deck
        "two_values": (labelled([1, 1, 1, 2, 2, 2]), False, [[n] for n in range(1, 7)]),  # two distinct labels are not a count
        "backwards": (labelled([3, 3, 2, 2, 1, 1]), False, [[n] for n in range(1, 7)]),  # numbers that run backwards do not count frames
        "prefixed": (labelled(prefix="A-"), False, [[n] for n in range(1, 7)]),  # "A-1", "A-1", "A-2": not plain numbers
    }
    for name, (labels, signal, groups) in cases.items():
        source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}.pdf", page_labels=labels))
        assert source_map["pdf_labels"]["repeat"] is True and source_map["pdf_labels"]["repeat_is_a_signal"] is signal, (name, source_map["pdf_labels"])
        assert _groups(source_map) == groups, (name, _groups(source_map))
        assert any("pdf_label_repeat" in pair["signals"] for pair in source_map["pairs"]) is signal, name


def test_a_constant_pdf_page_label_is_not_a_grouping_signal(tmp_path):
    pages = [*DERIVATION, {"images": [{"seed": 1, "box": (40, 30, 160, 120)}]}, {"images": [{"seed": 2, "box": (40, 30, 160, 120)}]}]
    source_map = sm.build_source_map(_deck(tmp_path, pages, page_labels={1: (None, "Deck", None)}))  # a prefix-only range: every page is labelled "Deck"
    assert [page["pdf_label"] for page in source_map["pages"]] == ["Deck"] * 6
    assert source_map["pdf_labels"] == {"defined": True, "differ_from_index": True, "repeat": True, "repeat_is_a_signal": False, "distinct": 1}
    assert _groups(source_map) == [[1], [2], [3], [4], [5], [6]]  # the derivation steps and the two different pictures stay apart
    assert not any("pdf_label_repeat" in pair["signals"] for pair in source_map["pairs"])
    assert "build" not in sm.describe_page(source_map, 3)["label"]


def test_a_frame_label_repeated_on_consecutive_pages_supports_a_group(tmp_path):
    # The way overlay decks are labelled: every page of one frame carries the frame's number.
    labels = {1: ("D", None, 1), 2: ("D", None, 2), 3: ("D", None, 2), 4: ("D", None, 2), 5: ("D", None, 3), 6: ("D", None, 4)}
    pages = [OPENING, *DERIVATION[1:], CLOSING, {"title": "Appendix", "bullets": ["One more page so that four frames exist"]}]
    source_map = sm.build_source_map(_deck(tmp_path, pages, page_labels=labels))
    assert [page["pdf_label"] for page in source_map["pages"]] == ["1", "2", "2", "2", "3", "4"]
    assert source_map["pdf_labels"]["repeat_is_a_signal"] is True and source_map["pdf_labels"]["distinct"] == 4
    assert _groups(source_map) == [[1], [2, 3, 4], [5], [6]]
    group = _slide_of(source_map, 3)
    # The author's frame, not a reveal: the steps replace one another, so the group is not called an incremental build.
    assert group["kind"] == "animation_steps" and group["confidence"] == "medium" and group["cumulative"] is False
    assert all("pdf_label_repeat" in entry["signals"] and entry["relation"] == "same_authored_slide" for entry in group["evidence"])
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 6 · step 2 of 3 · PDF label 2"


def test_an_upright_reading_is_a_document_whose_printed_number_is_a_page_number_and_whose_dense_text_gets_no_slide_role(tmp_path):
    def prose(topic: str) -> str:  # 200 words of running text; every line names the page's own topic, so no line repeats across pages
        return " ".join(f"The {topic} step {n} refines each {topic} value." for n in range(1, 26))

    topics = ["filtering", "estimation", "sampling", "regression", "smoothing", "calibration"]
    headings = ["Review", "Methods", "Example estimates", "Results", "Discussion", "References"]
    pages = [{"title": heading, "lines": [prose(topic), f"A) first {topic} item", f"B) second {topic} item", f"C) third {topic} item"], "printed": 100 + n}
             for n, (heading, topic) in enumerate(zip(headings, topics), start=1)]
    source_map = sm.build_source_map(_deck(tmp_path, pages, page_format=(215.9, 279.4), orientation="portrait"))
    assert source_map["page_layout"] == {"kind": "document", "landscape_pages": 0, "upright_pages": 6}
    assert source_map["printed_numbers"]["established"] is True and _page(source_map, 2)["printed_number"] == 102
    assert sm.describe_page(source_map, 2)["label"] == "PDF page 2 of 6 · printed page 102"  # a page number of a reading is not a slide number
    for page in source_map["pages"]:  # "Review", "Example ...", a lettered list: none of it is read as a slide role on a dense page
        assert page["role"]["role"] == "instructional" and "running text" in page["role"]["evidence"][0], page["role"]
    assert sm.summary(source_map)["page_layout"] == "document"
    assert sm.build_source_map(_deck(tmp_path, REVEAL, name="slides.pdf"))["page_layout"]["kind"] == "slides"


# ---- 5. PPTX identity only when the alignment supports it -------------------------------------------------
def _signalling_pdf(tmp_path: Path) -> Path:
    messengers = PPTX_SLIDES[2]["bullets"]
    return _deck(tmp_path, [
        {"title": "Cell signalling", "lines": ["Synthetic lecture four"]},
        {"title": "Second messengers", "bullets": messengers[:1]},
        {"title": "Second messengers", "bullets": messengers[:2]},
        {"title": "Second messengers", "bullets": messengers},
        {"images": [{"seed": 4, "box": (40, 30, 160, 120)}]},
        {"title": "Kinase cascades", "bullets": PPTX_SLIDES[4]["bullets"]},
        {"title": "Summary", "bullets": PPTX_SLIDES[5]["bullets"]},
    ])


def test_pptx_slide_identity_comes_from_a_sequence_alignment_not_from_the_page_number(tmp_path):
    deck = tmp_path / "deck.pptx"
    write_synthetic_pptx(deck, PPTX_SLIDES)
    ids = {slide["ordinal"]: slide["slide_id"] for slide in sm.inspect_pptx(deck)["slides"]}
    source_map = sm.build_source_map(_signalling_pdf(tmp_path), pptx_path=deck)

    alignment = source_map["pptx"]["alignment"]
    assert alignment["status"] == "supported" and alignment["method"] == "text_title_sequence_alignment"
    assert [page["pptx"]["ordinal"] if page["pptx"] else None for page in source_map["pages"]] == [1, 3, 3, 3, None, 5, 6]
    assert _page(source_map, 3)["pptx"]["slide_id"] == ids[3] and _page(source_map, 3)["pptx"]["evidence"]["title_equal"] is True
    # The picture-only page has nothing to align on: it stays unmatched instead of being given slide 4 by position.
    assert alignment["unmatched_pages"] == [5] and alignment["unmatched_slides"] == [2, 4]
    assert source_map["pptx"]["hidden_slides"] == [2] and source_map["pptx"]["slide_count"] == 6
    assert alignment["page_equals_ordinal_everywhere"] is False
    assert _groups(source_map) == [[1], [2, 3, 4], [5], [6], [7]]
    assert _slide_of(source_map, 2)["pptx_slides"] == [{"slide_id": ids[3], "ordinal": 3}]
    assert sm.describe_page(source_map, 3)["label"] == "PDF page 3 of 7 · build 2 of 3 · PPTX slide 3"
    assert sm.describe_page(source_map, 5)["label"] == "PDF page 5 of 7"


def test_a_presentation_whose_text_does_not_align_gives_no_slide_identity(tmp_path):
    other = tmp_path / "other.pptx"
    write_synthetic_pptx(other, [{"title": f"Unrelated heading {n}", "bullets": [f"Different vocabulary entirely for item {n}"]} for n in range(1, 8)])
    source_map = sm.build_source_map(_signalling_pdf(tmp_path), pptx_path=other)
    assert source_map["pptx"]["alignment"]["status"] == "not_supported"
    assert all(page["pptx"] is None for page in source_map["pages"])
    assert "PPTX" not in sm.describe_page(source_map, 2)["label"]
    assert sm.build_source_map(_signalling_pdf(tmp_path))["pptx"] is None  # and without a presentation nothing is claimed at all


def test_one_matched_page_is_not_a_sequence_alignment(tmp_path):
    deck = tmp_path / "deck.pptx"
    write_synthetic_pptx(deck, [{"title": f"Slide heading {n}", "bullets": [f"Body words for item {n}"]} for n in range(1, 6)]
                         + [{"title": "Reading list", "bullets": ["Notes for lecture 4 are posted with the reading list"]}])
    # A two-page PDF whose only text is three words that one slide happens to contain.
    source_map = sm.build_source_map(_deck(tmp_path, [{"lines": ["Lecture 4 notes"]}, {"images": [{"seed": 1, "box": (40, 30, 160, 120)}]}]), pptx_path=deck)
    alignment = source_map["pptx"]["alignment"]
    assert alignment["status"] == "not_supported" and alignment["candidate_matches"] == 1 and alignment["matched_pages"] == 0
    assert all(page["pptx"] is None for page in source_map["pages"]) and sm.describe_page(source_map, 1)["label"] == "PDF page 1 of 2"

    # Two matched pages are not enough either, and three pages that all fall on one slide of a longer presentation are not a sequence.
    two = sm.build_source_map(_deck(tmp_path, [{"title": f"Slide heading {n}", "bullets": [f"Body words for item {n}"]} for n in (2, 4)], name="two.pdf"), pptx_path=deck)
    assert two["pptx"]["alignment"]["status"] == "not_supported" and two["pptx"]["alignment"]["candidate_matches"] == 2 and two["pptx"]["alignment"]["minimum_matched_pages"] == 3
    assert all(page["pptx"] is None for page in two["pages"])
    words = ["Notes for lecture 4", "Notes for lecture 4 are posted", "Notes for lecture 4 are posted with the reading list"]
    one_slide = sm.build_source_map(_deck(tmp_path, [{"title": "Reading list", "lines": [line]} for line in words], name="one-slide.pdf"), pptx_path=deck)
    assert one_slide["pptx"]["alignment"]["candidate_matches"] == 3 and one_slide["pptx"]["alignment"]["status"] == "not_supported"
    assert all(page["pptx"] is None for page in one_slide["pages"]) and "PPTX" not in sm.describe_page(one_slide, 2)["label"]


# ---- 6. regions on a handout page ------------------------------------------------------------------------
def test_a_handout_page_gets_addressable_regions_when_they_are_evident(tmp_path):
    grid = [{"seed": seed, "box": box} for seed, box in ((1, (20, 40, 80, 60)), (2, (115, 40, 80, 60)), (3, (20, 120, 80, 60)), (4, (115, 120, 80, 60)))]
    path = _deck(tmp_path, [{"lines": ["Handout for week 3"], "images": grid}], page_format=(215.9, 279.4), orientation="portrait")
    source_map = sm.build_source_map(path)
    regions = _page(source_map, 1)["regions"]
    assert [region["region_id"] for region in regions] == ["r1", "r2", "r3", "r4"] and {region["source"] for region in regions} == {"auto"}
    assert regions[0]["box"][0] < regions[1]["box"][0] and regions[0]["box"][1] < regions[2]["box"][1]  # reading order: across, then down
    assert source_map["region_box_units"] == "fraction_of_page_from_top_left"
    resolved = sm.resolve(source_map, "page=1#r3")
    assert resolved["status"] == "region" and resolved["page"] == 1 and resolved["region"]["region_id"] == "r3"
    assert sm.describe_page(source_map, 1, region="r3")["label"] == "PDF page 1 of 1 · region 3 of 4"
    assert sm.resolve(source_map, "page=1#r9")["status"] == "unknown"
    assert len(source_map["logical_slides"]) == 1 and sm.summary(source_map)["regions"] == {"pages_with_regions": 1, "regions": 4}
    # A correction with an empty list says the page is not a handout after all; the detected regions are then gone.
    cleared = sm.build_source_map(path, overrides=[{"revision": 1, "op": {"type": "regions", "page": 1, "regions": []}, "reason": "One poster, not four slides"}])
    assert _page(cleared, 1)["regions"] == [] and cleared["map_revision"] != source_map["map_revision"]


def test_equal_figure_panels_on_one_page_of_a_reading_are_not_handout_regions(tmp_path):
    grid = [{"seed": seed, "box": box} for seed, box in ((1, (20, 40, 80, 60)), (2, (115, 40, 80, 60)), (3, (20, 120, 80, 60)), (4, (115, 120, 80, 60)))]
    pages = [{"title": f"Section {n}", "lines": [f"Synthetic paragraph number {n} of a reading about membranes."]} for n in range(1, 6)]
    pages[2]["images"] = grid
    source_map = sm.build_source_map(_deck(tmp_path, pages, page_format=(215.9, 279.4), orientation="portrait"))
    assert all(page["regions"] == [] for page in source_map["pages"]) and _page(source_map, 3)["image_count"] == 4


def test_equal_pictures_on_an_ordinary_slide_are_not_taken_for_a_handout_until_an_override_says_so(tmp_path, course):
    settings, root = course
    row = [{"seed": seed, "box": (20 + 75 * n, 70, 65, 49)} for n, seed in enumerate((1, 2, 3))]
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", [{"title": "Three micrographs", "bullets": ["Compare the three panels"], "images": row},
                                                                     {"title": "Next topic", "bullets": ["Something else entirely here"]}])
    item = _item(settings)
    assert _page(sm.load_or_build(settings, COURSE, item), 1)["regions"] == []
    boxes = [[0.05, 0.3, 0.33, 0.7], [0.36, 0.3, 0.64, 0.7], [0.67, 0.3, 0.95, 0.7]]
    updated = sm.apply_override(settings, COURSE, item, {"type": "regions", "page": 1, "regions": [{"box": box, "label": f"Panel {n}"} for n, box in enumerate(boxes, start=1)]},
                                author="learner", reason="Each panel is discussed on its own")
    regions = _page(updated, 1)["regions"]
    assert [(region["region_id"], region["source"], region["label"]) for region in regions] == [("r1", "override", "Panel 1"), ("r2", "override", "Panel 2"), ("r3", "override", "Panel 3")]
    assert sm.resolve(updated, "page=1#r2")["region"]["box"] == boxes[1]


# ---- 7. content roles ------------------------------------------------------------------------------------
ROLE_DECK = [
    {"title": "Synthetic Systems Biology", "lines": ["Lecture 4", "Robin Sample"]},  # 1 plain cover
    {"title": "Learning objectives", "bullets": ["Explain feedback", "Compute a steady state", "Interpret a phase plot"]},  # 2
    {"title": "Negative feedback", "bullets": ["The output suppresses its own production", "This shortens the response time"]},  # 3
    {"images": [{"seed": 5, "box": (30, 20, 190, 140)}]},  # 4 picture only
    {"lines": ["dN/dt = r N (1 - N/K)"]},  # 5 equation only
    {"title": "Plasmid map", "figure": "ring"},  # 6 drawing with a short title
    {},  # 7 blank
    {"title": "Example: steady state of a repressor", "lines": ["Given a = 4 and b = 2, find x where a/(1 + x) = b x"]},  # 8
    {"title": "Clicker question", "lines": ["Which change shortens the response time?", "A) stronger feedback", "B) weaker feedback", "C) slower decay"]},  # 9
    {"title": "Office hours and grading", "bullets": ["Office hours move to Thursday", "Homework 2 is due on Friday"]},  # 10
    {"title": "Summary", "bullets": ["Feedback shapes speed and stability", "Steady states come from balance"]},  # 11
    {"title": "Part 2"},  # 12 section divider
]


def test_content_roles_are_classified_with_evidence_and_never_remove_a_page(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, ROLE_DECK))
    roles = _roles(source_map)
    assert roles[0] == "structural_title_or_section" and roles[1] == "objectives_or_summary" and roles[2] == "instructional"
    assert roles[6] == "blank" and roles[7] == "worked_example_or_question" and roles[8] == "worked_example_or_question"
    assert roles[9] == "administrative" and roles[10] == "objectives_or_summary" and roles[11] == "structural_title_or_section"
    assert set(roles) <= set(sm.ROLES)
    for page in source_map["pages"]:
        role = page["role"]
        assert role["evidence"] and 0.0 <= role["confidence"] <= 1.0 and role["source"] == "auto"
    assert len(source_map["pages"]) == 12 and len(source_map["logical_slides"]) == 12  # a role never changes the inventory


def test_a_heading_that_only_sounds_like_a_question_or_like_administration_is_not_taken_for_one(tmp_path):
    body = ["A substantive statement about the topic", "A second statement that adds a detail"]
    source_map = sm.build_source_map(_deck(tmp_path, [
        {"title": "Feedback in cells", "bullets": body},
        {"title": "Examples of feedback in cells", "bullets": body},  # illustrations of a concept, not a worked example
        {"title": "Problems with open loop control", "bullets": body},  # a topic, not a problem to solve
        {"title": "Problem sets", "bullets": ["One set every two weeks", "Hand in on paper"]},  # course administration
        {"title": "Example 2: closing the loop", "bullets": body},
        {"title": "Questions?"},  # a closing page
    ]))
    assert _roles(source_map) == ["instructional", "instructional", "instructional", "administrative", "worked_example_or_question", "structural_title_or_section"]

    # Topic headings that merely contain a keyword keep their forced requirements and stay in the instructional denominator.
    topics = sm.build_source_map(_deck(tmp_path, [
        {"title": "Feedback in cells", "bullets": body},
        {"title": "Tumor grading and staging", "bullets": ["Grade reflects how abnormal the cells look", "Stage reflects how far the tumor has spread"]},
        {"title": "Exercise and oxygen uptake", "bullets": ["Uptake rises with workload until a plateau", "The plateau defines the maximal uptake"]},
        {"title": "Review of probability", "bullets": ["A density integrates to one", "Independence means the joint factorises"]},
        {"title": "Overview of the immune system", "bullets": ["Innate responses act within hours", "Adaptive responses take days to build"]},
        {"title": "Grading", "bullets": ["Homework counts for forty percent", "The final exam counts for sixty percent"]},
        {"title": "Exercise 3", "bullets": ["Compute the uptake at the plateau", "State the units of your answer"]},
        {"title": "Review of last lecture", "bullets": ["Membranes separate charge", "Channels let ions cross"]},
    ], name="topics.pdf"))
    assert _roles(topics) == ["instructional", "instructional", "instructional", "instructional", "instructional", "administrative", "worked_example_or_question", "objectives_or_summary"]
    assert all(page["role"]["forced_requirements"] for page in topics["pages"][:5])
    assert sm.summary(topics)["denominators"]["instructional_logical_slides"] == 6


def test_a_page_with_little_text_but_a_picture_drawing_or_equation_is_never_blank_or_structural(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, ROLE_DECK))
    for number in (4, 5, 6):
        role = _page(source_map, number)["role"]
        assert role["role"] in {"instructional", "unknown"}, (number, role)
        assert role["forced_requirements"] is True  # sparse text is no reason to drop the normal study flow
    assert _page(source_map, 4)["word_count"] == 0 and _page(source_map, 4)["image_count"] == 1
    assert any("picture" in line for line in _page(source_map, 4)["role"]["evidence"])
    assert any("equation" in line for line in _page(source_map, 5)["role"]["evidence"])
    assert any("drawing" in line for line in _page(source_map, 6)["role"]["evidence"])


def test_equation_like_text_without_an_equals_sign_is_not_structural(tmp_path):
    formulas = ["A + B -> C", "E + S <-> ES -> E + P", "Km >> [S]", "p < 0.05", "v / (k [A])", "c - b"]
    source_map = sm.build_source_map(_deck(tmp_path, [ROLE_DECK[0], *({"lines": [formula]} for formula in formulas), ROLE_DECK[2]]))
    for number, formula in enumerate(formulas, start=2):
        role = _page(source_map, number)["role"]
        assert role["role"] == "instructional" and role["forced_requirements"] is True, (formula, role)
        assert any("equation" in line for line in role["evidence"]), (formula, role)
    assert sm.summary(source_map)["denominators"]["no_forced_requirement_logical_slides"] == 1  # the cover only
    # Ordinary short headings are not mistaken for formulas: a dash, a date range or an ampersand is punctuation.
    plain = sm.build_source_map(_deck(tmp_path, [ROLE_DECK[0], {"title": "Part 2 - Membranes"}, {"title": "Weeks 3 - 5"}, {"title": "Questions & answers"}, {"title": "Q/A"},
                                                {"title": "Before/after"}, ROLE_DECK[2]], name="plain.pdf"))
    assert _roles(plain)[1:6] == ["structural_title_or_section"] * 5


def test_a_small_diagram_or_an_inline_image_counts_as_content(tmp_path):
    curve = [(150, 150), (160, 148), (170, 140), (180, 120), (190, 100), (200, 85), (210, 78), (220, 75), (230, 74)]
    filler = [{"title": f"Filler {n}", "bullets": [f"Unrelated statement number {n} with a few more words"]} for n in range(1, 4)]
    path = _deck(tmp_path, [
        OPENING,
        {"title": "Free body diagram", "strokes": [(150, 100, 220, 100), (150, 100, 150, 60)]},  # 2 heading and a two-stroke diagram
        {"title": "Dose response curve", "polylines": [curve]},  # 3 heading and one curve
        {"strokes": [(150, 100, 220, 100), (150, 100, 150, 60)]},  # 4 only a two-stroke diagram
        {},  # 5 becomes a page whose only content is an inline image
        {"title": "Part 2"},  # 6 a plain divider stays structural
        {},  # 7 a blank page stays blank
        *filler,
    ])
    add_inline_image(path, 5)
    source_map = sm.build_source_map(path)
    assert source_map["inspection"]["status"] == "complete"
    for number in (2, 3):
        role = _page(source_map, number)["role"]
        assert role["role"] == "instructional" and role["forced_requirements"] is True and role["uncertain"] is True, (number, role)
        assert any("drawing" in line for line in role["evidence"]) and not any("no picture" in line for line in role["evidence"])
    for number in (4, 5):
        role = _page(source_map, number)["role"]
        assert role["role"] == "unknown" and role["forced_requirements"] is True, (number, role)
    assert _page(source_map, 2)["drawing"]["shapes_beyond_template"] == 2 and _page(source_map, 3)["drawing"]["shapes_beyond_template"] == 1
    inline = _page(source_map, 5)
    assert inline["image_count"] == 1 and inline["images"][0]["digest_basis"] == "inline_bytes" and (inline["images"][0]["width"], inline["images"][0]["height"]) == (16, 16)
    assert any("picture" in line for line in inline["role"]["evidence"])
    assert _roles(source_map)[5:7] == ["structural_title_or_section", "blank"]


def test_expressions_without_a_sign_of_their_own_are_read_as_formulas_too(tmp_path):
    formulas = ["P(A | B)", "O(n log n)", "dN/dt", "X ~ N(0, 1)", "f(x)", "E[X]", "k_cat / K_m", "argmax L(theta)", "Var(X) Cov(X, Y)"]
    source_map = sm.build_source_map(_deck(tmp_path, [ROLE_DECK[0], *({"lines": [formula]} for formula in formulas), ROLE_DECK[2]]))
    for number, formula in enumerate(formulas, start=2):
        role = _page(source_map, number)["role"]
        assert role["role"] == "instructional" and role["forced_requirements"] is True and role["uncertain"] is True, (formula, role)
        assert any("equation" in line for line in role["evidence"]), (formula, role)
    # A bracket after a word and a space, a slash between words, an abbreviation: headings, not formulas.
    headings = ["Hepatitis B (HBV)", "Part 2 (continued)", "Type I (fast) fibres", "Day and night", "Input / output", "Vitamin D", "RNA polymerase II"]
    plain = sm.build_source_map(_deck(tmp_path, [ROLE_DECK[0], *({"title": heading} for heading in headings), ROLE_DECK[2]], name="plain.pdf"))
    assert _roles(plain)[1:-1] == ["structural_title_or_section"] * len(headings)


def test_a_first_page_that_shows_a_drawing_is_a_cover_only_on_a_course_header_and_then_as_an_uncertain_reading(tmp_path):
    arrow = [(150, 60, 150, 150), (140, 140, 150, 150), (160, 140, 150, 150)]
    rest = [{"title": "Second", "bullets": ["Some unrelated text that follows the first page"]}, CLOSING]
    # A deck that starts with content: a word that also occurs on covers (a season, a year, "unit 1") is no evidence of a cover.
    content = [{"title": "Free fall", "lines": ["A ball dropped from rest"]}, {"title": "Spring and mass", "lines": ["Restoring force grows with stretch"]},
               {"title": "The 1953 double helix"}, {"title": "Motor unit 1 recruitment"}]
    for n, first in enumerate(content):
        role = _page(sm.build_source_map(_deck(tmp_path, [{**first, "strokes": arrow}, *rest], name=f"content-{n}.pdf")), 1)["role"]
        assert role["role"] == "instructional" and role["forced_requirements"] is True and role["uncertain"] is True, (first, role)
    # A course header beside a drawing reads as a cover, but as an uncertain one: it is counted among the readings that deserve a look.
    covers = [{"title": "Systems Biology", "lines": ["Lecture 4", "Fall 2026"]}, {"title": "Signals and Systems", "lines": ["Department of Biomedical Engineering"]}]
    for n, first in enumerate(covers):
        source_map = sm.build_source_map(_deck(tmp_path, [{**first, "strokes": arrow}, *rest], name=f"cover-{n}.pdf"))
        role = _page(source_map, 1)["role"]
        assert role["role"] == "structural_title_or_section" and role["uncertain"] is True and any("drawing" in line for line in role["evidence"]), (first, role)
        assert sm.summary(source_map)["denominators"]["no_forced_requirement_uncertain_logical_slides"] == 1
        # Without the drawing the same page is a plain cover.
        plain = _page(sm.build_source_map(_deck(tmp_path, [first, *rest], name=f"plain-{n}.pdf")), 1)["role"]
        assert plain["role"] == "structural_title_or_section" and plain["uncertain"] is False


def test_text_painted_in_the_paint_of_the_paper_is_counted_because_the_page_does_not_show_it(tmp_path):
    white = (255, 255, 255)
    source_map = sm.build_source_map(_deck(tmp_path, [OPENING, {**PROSE, "text_colour": white}, PROSE, CLOSING]))
    unseen, shown = _page(source_map, 2), _page(source_map, 3)
    assert unseen["word_count"] == shown["word_count"]  # the file holds the same words on both pages ...
    assert unseen["drawing"]["text_runs_in_background_paint"] >= 2 and shown["drawing"]["text_runs_in_background_paint"] == 0  # ... and says where they are not seen
    assert "text_runs_in_background_paint" in source_map["text_basis"]["note"] and source_map["text_basis"]["visible_text_established"] is False
    # The reveal is one slide in two states; the note on the relation says that a difference on screen was not established by reading the file.
    pair = _pair(source_map, 2)
    assert pair["relation"] == "identical_text_visual_change" and pair["kind"] == "animation_steps" and any("not established" in note for note in pair["notes"])
    # On a picture, white text is seen: nothing is counted there. Nor on a page that paints a dark background.
    dark = sm.build_source_map(_deck(tmp_path, [{**PROSE, "background_image": 2, "title_colour": white, "text_colour": white},
                                                {**PROSE, "background": "ink", "title_colour": white, "text_colour": white}], name="dark.pdf"))
    assert [_page(dark, n)["drawing"]["text_runs_in_background_paint"] for n in (1, 2)] == [0, 0]
    # Text in the paint of a background the page itself paints is counted like white on paper: here the body lines, and on the
    # second page the heading alone (ink on an ink background).
    same = sm.build_source_map(_deck(tmp_path, [{**PROSE, "background": "teal", "text_colour": "teal"}, {**PROSE, "background": "ink", "text_colour": white}], name="same.pdf"))
    assert _page(same, 1)["drawing"]["text_runs_in_background_paint"] >= 2 and _page(same, 2)["drawing"]["text_runs_in_background_paint"] == 1


def test_the_same_picture_bytes_shown_another_way_are_another_picture(tmp_path):
    same = {"title": "Stained section", "lines": ["The same words on both pages"], "images": [{"seed": 3, "box": (150, 60, 60, 45)}]}
    path = _deck(tmp_path, [OPENING, same, dict(same), CLOSING])
    assert _pair(sm.build_source_map(path), 2)["kind"] == "duplicate"
    set_picture_decode(path, 3, (1, 0, 1, 0, 1, 0))  # page 3 now shows the picture inverted: the stored bytes are the same, the picture is not
    source_map = sm.build_source_map(path)
    first, second = _page(source_map, 2)["images"][0], _page(source_map, 3)["images"][0]
    assert first["bytes"] == second["bytes"] and first["sha256"] != second["sha256"] and second["digest_basis"] == "stream_bytes"
    pair = _pair(source_map, 2)
    assert pair["kind"] != "duplicate" and "page_identical" not in pair["signals"] and "images_identical" not in pair["signals"]
    assert pair["decision"] == "uncertain" and any("picture" in reason for reason in pair["reasons"])
    assert "copy" not in sm.describe_page(source_map, 3)["label"]


def _topic(n: int, **extra) -> dict:
    letter = "abcdefghijklmnop"[n - 1]
    return {"title": f"Topic {letter.upper()}", "bullets": [f"A statement for page {letter} only, with enough further words that the page is plainly content"], **extra}


def test_a_figure_that_most_pages_show_in_the_body_of_the_page_is_not_taken_for_the_template(tmp_path):
    cover = {"title": "Walking through the pathway", "lines": ["Synthetic course notes"]}
    figures = {
        "picture": {"images": [{"seed": 4, "box": (40, 50, 170, 120)}]},  # one figure the deck walks through, on five of six pages
        "drawing": {"strokes": [(60, 150, 200, 150), (60, 150, 60, 60), (60, 150, 200, 70), (110, 150, 110, 118), (160, 150, 160, 92)]},
        "grid": {"strokes": [(60, y, 200, y) for y in (70, 100, 130)] + [(x, 60, x, 150) for x in (90, 130, 170)]},  # nothing but straight lines along the axes
    }
    for name, figure in figures.items():
        for steps in (4, 10):  # a short deck, and a longer one in which the figure is on eleven of twelve pages
            pages = [cover, *({"title": f"Step {n}", **figure} for n in range(1, steps + 1)), dict(figure)]
            source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}-{steps}.pdf"))
            for number in range(2, steps + 2):
                role = _page(source_map, number)["role"]
                assert role["role"] == "instructional" and role["forced_requirements"] is True and role["uncertain"] is True, (name, steps, number, role)
                assert any(("picture" if name == "picture" else "drawing") in line for line in role["evidence"]) and not any("no picture" in line for line in role["evidence"])
            alone = _page(source_map, steps + 2)["role"]
            assert alone["role"] == "unknown" and alone["forced_requirements"] is True, (name, steps, alone)
            assert source_map["template"]["template_images"] == 0 and source_map["template"]["template_marks"] == 0, (name, steps, source_map["template"])
            assert sm.summary(source_map)["denominators"]["no_forced_requirement_logical_slides"] == 1, (name, steps)  # the cover only


def test_what_most_pages_carry_in_their_margins_or_as_their_background_is_still_the_template(tmp_path):
    logo = {"seed": 9, "box": (226, 5, 20, 15)}  # a small picture in the top right corner
    furniture = {"images": [logo], "strokes": [(16, 34, 238, 34), (16, 178, 238, 178)], "boxes": [(0, 182, 254, 8.5, "teal")]}  # a rule under the heading, a footer rule and band
    panel = {"boxes": [(20, 45, 214, 125, (240, 240, 240), "slate"), *furniture["boxes"]]}  # ... and a framed panel behind the body of every page
    for name, extra in (("margins", furniture), ("panel", {**furniture, **panel})):
        pages = [*(_topic(n, **extra) for n in range(1, 8)), {"title": "Part 2", **extra}, dict(extra)]
        source_map = sm.build_source_map(_deck(tmp_path, pages, name=f"{name}.pdf"))
        assert source_map["template"]["template_images"] == 1 and source_map["template"]["template_marks"] >= 4, (name, source_map["template"])
        divider, empty = _page(source_map, 8), _page(source_map, 9)
        assert divider["role"]["role"] == "structural_title_or_section" and divider["drawing"]["shapes_beyond_template"] == 0, (name, divider["role"])
        assert empty["role"]["role"] == "blank" and empty["image_count"] == 1, (name, empty["role"])
        assert _page(source_map, 2)["role"]["role"] == "instructional"
    # A figure in the body of one page of such a deck is content like anywhere else.
    pages = [*(_topic(n, **furniture) for n in range(1, 8)), {"title": "Force balance", **furniture, "strokes": [*furniture["strokes"], (150, 100, 220, 100), (150, 100, 150, 60)]}]
    one = _page(sm.build_source_map(_deck(tmp_path, pages, name="one.pdf")), 8)
    assert one["role"]["role"] == "instructional" and one["drawing"]["shapes_beyond_template"] == 2


def test_white_lines_over_a_background_that_is_a_picture_are_a_drawing_not_a_cover(tmp_path):
    white = (255, 255, 255)
    diagram = [(150, 100, 220, 100), (150, 100, 150, 60), (150, 100, 200, 140)]
    dark = {"background_image": 2, "title_colour": white, "text_colour": white}  # a dark theme whose background is one picture over the whole page
    pages = [
        _topic(1, **dark),
        {"title": "Free body diagram", **dark, "strokes": diagram, "stroke_colour": white},  # 2 a heading and a diagram in white lines
        {**dark, "strokes": diagram, "stroke_colour": white},  # 3 only the diagram
        {"title": "Part 2", **dark},  # 4 a divider
        dict(dark),  # 5 nothing but the background
        *(_topic(n, **dark) for n in range(6, 10)),
    ]
    source_map = sm.build_source_map(_deck(tmp_path, pages))
    assert source_map["template"]["template_images"] == 1  # the background picture is on every page and covers it: template
    heading, alone, divider, empty = (_page(source_map, n) for n in (2, 3, 4, 5))
    assert heading["role"]["role"] == "instructional" and heading["role"]["forced_requirements"] is True and any("drawing" in line for line in heading["role"]["evidence"])
    assert alone["role"]["role"] == "unknown" and alone["role"]["forced_requirements"] is True
    for page in (heading, alone):  # what lies under the white paint is a picture, not paper: the lines are seen, they hide nothing
        assert page["drawing"]["shapes_beyond_template"] == 3 and page["drawing"]["fills_in_background_paint"] == 0
    assert divider["role"]["role"] == "structural_title_or_section" and empty["role"]["role"] == "blank"
    # On bare paper the same white lines show nothing: such a page is still blank, and they are counted as fills in the paper's paint.
    bare = sm.build_source_map(_deck(tmp_path, [OPENING, {"strokes": diagram, "stroke_colour": white}, CLOSING], name="bare-lines.pdf"))
    assert _page(bare, 2)["role"]["role"] == "blank" and _page(bare, 2)["drawing"]["fills_in_background_paint"] == 3


def test_a_plain_cover_is_structural_and_carries_no_forced_requirement(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, ROLE_DECK))
    cover = _page(source_map, 1)["role"]
    assert cover["role"] == "structural_title_or_section" and cover["forced_requirements"] is False
    policy = sm.role_policy("structural_title_or_section")
    assert policy == {"teach_back": False, "generated_practice": False, "concept_requirement": False, "missing_match_warning": False,
                      "offer": ["next_content", "whole_lecture"]}
    assert sm.role_policy("blank")["teach_back"] is False and sm.role_policy("administrative")["missing_match_warning"] is False
    for role in ("instructional", "worked_example_or_question", "objectives_or_summary", "mixed", "unknown"):
        assert sm.role_policy(role)["teach_back"] is True and sm.role_policy(role)["offer"] == []
    described = sm.describe_page(source_map, 1)
    assert described["role"] == "structural_title_or_section" and described["forced_requirements"] is False


def test_raw_pages_logical_slides_and_instructional_denominators_are_reported_separately(tmp_path):
    pages = ROLE_DECK[:3] + REVEAL[1:4] + ROLE_DECK[3:]
    summary = sm.summary(sm.build_source_map(_deck(tmp_path, pages)))
    assert summary["raw_pages"] == 15 and summary["logical_slides"] == 13
    assert summary["groups"] == {"incremental_build": 1, "duplicate": 0, "animation_steps": 0, "manual_group": 0} and summary["pages_in_groups"] == 3
    denominators = summary["denominators"]
    assert denominators["raw_pages"] == 15 and denominators["logical_slides"] == 13
    assert denominators["no_forced_requirement_logical_slides"] == 4  # cover, blank page, administrative page, section divider
    assert denominators["objectives_or_summary_logical_slides"] == 2
    # Counted once per logical slide, by the role of the page that shows the whole slide — the reveal counts once, not three times.
    assert denominators["instructional_logical_slides"] + denominators["unknown_role_logical_slides"] == 7
    assert sum(summary["roles"]["pages"].values()) == 15 and sum(summary["roles"]["logical_slides"].values()) == 13
    assert summary["roles"]["pages"]["blank"] == 1 and summary["roles"]["logical_slides"]["blank"] == 1
    # A structural reading the detector is unsure of is counted apart, so that leaving it out of a denominator is a visible choice.
    assert denominators["no_forced_requirement_uncertain_logical_slides"] == 0

    unsure = sm.summary(sm.build_source_map(_deck(tmp_path, [ROLE_DECK[2], {"title": "Cells sense a change and then adapt to it"}, ROLE_DECK[2]], name="statement.pdf")))
    assert unsure["denominators"]["no_forced_requirement_logical_slides"] == 1 and unsure["denominators"]["no_forced_requirement_uncertain_logical_slides"] == 1


# ---- 8. labels ------------------------------------------------------------------------------------------
def test_labels_word_only_what_is_known(tmp_path):
    source_map = sm.build_source_map(_deck(tmp_path, REVEAL))
    described = sm.describe_page(source_map, 3)
    assert described["label"] == "PDF page 3 of 5 · build 2 of 3" and described["parts"] == ["PDF page 3 of 5", "build 2 of 3"]
    assert described["page"] == 3 and described["page_count"] == 5 and described["build_index"] == 2 and described["build_count"] == 3
    assert described["logical_slide_id"] == _page(source_map, 3)["logical_slide_id"] and described["kind"] == "incremental_build"
    assert sm.describe_page(source_map, 1)["label"] == "PDF page 1 of 5"
    with pytest.raises(sm.SourceMapError) as error:
        sm.describe_page(source_map, 6)
    assert error.value.code == "page_out_of_range"


# ---- 9. cache, invalidation and replacement ---------------------------------------------------------------
def test_the_map_is_cached_in_the_app_area_and_nothing_is_written_to_the_course_folder(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    before = _course_files(root)
    opened = []
    real_reader = sm.PdfReader
    monkeypatch.setattr(sm, "PdfReader", lambda *args, **kwargs: opened.append(1) or real_reader(*args, **kwargs))

    item = _item(settings)
    first = sm.load_or_build(settings, COURSE, item)
    second = sm.load_or_build(settings, COURSE, item)
    assert first == second and len(opened) == 1  # the second call is served from the cache
    assert first["cache"]["key"] == {"sha256": first["source"]["sha256"], "map_version": sm.SOURCE_MAP_VERSION, "overrides_revision": 0}
    assert first["source"]["source_id"] == item["source_id"] and _groups(first) == [[1], [2, 3, 4], [5]]

    area = settings.app_area(COURSE) / "source-map" / item["source_id"]
    cached = sorted(path.relative_to(area).as_posix() for path in area.rglob("*.json"))
    assert cached == [f"{first['source']['sha256'][:16]}/map-o0000.json"]
    assert not area.is_relative_to(root) and _course_files(root) == before

    sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="agent", reason="The roadmap is taught, not just shown")
    assert _course_files(root) == before


def test_a_transient_inspection_failure_is_retried_and_does_not_become_the_map_of_the_source(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    healthy_groups = [[1], [2, 3, 4], [5]]
    real_page, real_reader = sm._inspect_page, sm.PdfReader

    # (a) one page fails to be read once (an I/O error, not a property of the bytes)
    def flaky(page, number, *args, **kwargs):
        if number >= 3:
            raise OSError("synthetic transient read failure")
        return real_page(page, number, *args, **kwargs)

    monkeypatch.setattr(sm, "_inspect_page", flaky)
    first = sm.load_or_build(settings, COURSE, item)
    assert [page["status"] for page in first["pages"]] == ["ok", "ok", "unknown", "unknown", "unknown"] and first["pages"][2]["reason"] == "read_error"
    assert first["inspection"]["status"] == "partial" and first["inspection"]["transient"] is True and first["inspection"]["retry"] == "automatic"
    assert first["cache"] is None and not list((settings.app_area(COURSE) / "source-map").rglob("map-o*.json"))  # nothing of it is kept
    assert sm.summary(first)["inspection_transient"] is True
    monkeypatch.setattr(sm, "_inspect_page", real_page)
    second = sm.load_or_build(settings, COURSE, item)
    assert second["inspection"]["status"] == "complete" and second["inspection"]["transient"] is False and _groups(second) == healthy_groups
    assert second["inspection"]["retry"] == "on_request" and second["cache"] is not None
    assert sm.load_or_build(settings, COURSE, item) == second

    # (b) the clock runs past the time bound once (a busy machine), on a call that asked for a fresh inspection: the settled map is left as it was
    limited = sm.load_or_build(settings, COURSE, item, refresh=True, clock=iter(float(n) for n in range(0, 10**6, 1000)).__next__)
    assert limited["inspection"]["status"] == "partial" and {page["reason"] for page in limited["pages"]} == {"time_limit"} and limited["inspection"]["transient"] is True
    assert limited["cache"] is None
    again = sm.load_or_build(settings, COURSE, item)
    assert again == second and _groups(again) == healthy_groups

    # (c) the file cannot be opened once (locked, or a hiccup of a streamed folder): nothing is kept, corrections still work afterwards
    monkeypatch.setattr(sm, "PdfReader", lambda *args, **kwargs: (_ for _ in ()).throw(PermissionError("synthetic: the file is locked")))
    locked = sm.load_or_build(settings, COURSE, item, refresh=True)
    assert locked["inspection"]["status"] == "unavailable" and locked["inspection"]["reason"] == "read_error" and locked["inspection"]["transient"] is True
    assert locked["page_count"] is None and locked["cache"] is None
    monkeypatch.setattr(sm, "PdfReader", real_reader)
    assert sm.load_or_build(settings, COURSE, item)["inspection"]["status"] == "complete"
    corrected = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="learner", reason="Taught, not just shown")
    assert corrected["overrides"]["revision"] == 1 and _groups(corrected) == healthy_groups


def test_a_passing_failure_is_never_kept_however_often_it_happens(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    opened = []
    real_reader, real_page = sm.PdfReader, sm._inspect_page
    monkeypatch.setattr(sm, "PdfReader", lambda *args, **kwargs: opened.append(1) or real_reader(*args, **kwargs))
    stored = settings.app_area(COURSE) / "source-map"

    def slow() -> float:  # every look at the clock is a long time after the last one
        slow.now += 1000.0
        return slow.now

    slow.now = 0.0
    maps = [sm.load_or_build(settings, COURSE, item, clock=slow) for _ in range(6)]
    assert len(opened) == 6  # every call looked at the file again: a map cut short is not the map of the source, however often that happens
    assert [m["inspection"]["attempts"] for m in maps] == [1, 2, 3, 4, 5, 6]  # counted for the caller, who decides how often to ask
    assert all(m["inspection"]["retry"] == "automatic" and m["inspection"]["transient"] is True and m["cache"] is None for m in maps)
    assert all(len(m["pages"]) == 5 and m["inspection"]["status"] == "partial" and sm.summary(m)["pages_unknown"] == 5 for m in maps)
    assert not list(stored.rglob("map-o*.json"))

    # A correction made meanwhile belongs to the bytes: it is recorded, and still no map is kept.
    def flaky(page, number, *args, **kwargs):
        raise OSError("synthetic transient read failure")

    monkeypatch.setattr(sm, "_inspect_page", flaky)
    corrected = sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="learner", reason="Page 4 is a new slide")
    assert corrected["overrides"]["revision"] == 1 and corrected["inspection"]["transient"] is True and corrected["cache"] is None
    assert not list(stored.rglob("map-o*.json")) and len(list(stored.rglob("r0001.json"))) == 1
    monkeypatch.setattr(sm, "_inspect_page", real_page)

    before = len(opened)
    healthy = sm.load_or_build(settings, COURSE, item)  # the next call on a healthy machine gives the map; nobody has to ask for a rebuild
    assert len(opened) == before + 1 and healthy["inspection"]["status"] == "complete" and healthy["inspection"]["transient"] is False
    assert healthy["inspection"]["attempts"] == 1 and healthy["inspection"]["retry"] == "on_request" and healthy["cache"] is not None
    assert _groups(healthy) == [[1], [2, 3], [4], [5]] and healthy["overrides"]["revision"] == 1
    # A complete map is inspected again only when that is asked for, and the result is the same map.
    assert sm.load_or_build(settings, COURSE, item) == healthy and len(opened) == before + 1
    assert sm.load_or_build(settings, COURSE, item, refresh=True)["map_revision"] == healthy["map_revision"] and len(opened) == before + 2


def test_a_presentation_that_cannot_be_read_just_now_does_not_settle_the_map_without_it(course, monkeypatch):
    import pptx
    from pptx.exc import PackageNotFoundError

    settings, root = course
    unit = root / "materials/lectures/lecture-01"
    (unit / "Deck.pdf").write_bytes(_signalling_pdf(root.parent).read_bytes())
    write_synthetic_pptx(unit / "Deck.pptx", PPTX_SLIDES)
    lecture, item = _lecture(settings), _item(settings)
    stored = settings.app_area(COURSE) / "source-map"
    real_presentation = pptx.Presentation

    # (a) the presentation is locked, or goes away for a moment, while the PDF is read without trouble
    for error in (PermissionError("synthetic: the file is locked"), PackageNotFoundError("synthetic: the package is not there just now")):
        monkeypatch.setattr(pptx, "Presentation", lambda *args, error=error, **kwargs: (_ for _ in ()).throw(error))
        first = sm.load_or_build(settings, COURSE, item, lecture=lecture)
        assert first["inspection"]["status"] == "complete" and all(page["status"] == "ok" for page in first["pages"])  # the pages were read
        assert first["pptx"]["status"] == "unavailable" and first["pptx"]["reason"] == "read_error" and first["pptx"]["transient"] is True
        assert all(page["pptx"] is None for page in first["pages"])
        # ... but the map is not settled: slide identity may come with the next call, so nothing is kept
        assert first["inspection"]["transient"] is True and first["inspection"]["retry"] == "automatic" and first["cache"] is None
        assert sm.summary(first)["inspection_transient"] is True and not list(stored.rglob("map-o*.json"))
    monkeypatch.setattr(pptx, "Presentation", real_presentation)
    second = sm.load_or_build(settings, COURSE, item, lecture=lecture)
    assert second["pptx"]["alignment"]["status"] == "supported" and second["pptx"]["transient"] is False
    assert second["inspection"]["transient"] is False and second["cache"] is not None and sum(1 for page in second["pages"] if page["pptx"]) == 6

    # (b) the clock runs out after the pages were read, before the presentation is opened
    state = {"late": False}
    real_numbers = sm._detect_printed_numbers
    monkeypatch.setattr(sm, "_detect_printed_numbers", lambda pages: (state.update(late=True), real_numbers(pages))[1])
    late = sm.load_or_build(settings, COURSE, item, lecture=lecture, refresh=True, clock=lambda: 10.0**6 if state["late"] else 0.0)
    assert late["inspection"]["status"] == "complete" and late["pptx"]["status"] == "not_inspected" and late["pptx"]["reason"] == "time_limit"
    assert late["inspection"]["transient"] is True and late["cache"] is None and all(page["pptx"] is None for page in late["pages"])
    monkeypatch.setattr(sm, "_detect_printed_numbers", real_numbers)
    assert sm.load_or_build(settings, COURSE, item, lecture=lecture) == second  # the settled map was left as it was

    # (c) a presentation that is not one is a property of its bytes: that map is settled
    (unit / "Deck.pptx").write_bytes(b"PK\x03\x04 synthetic placeholder: not a real presentation\n")
    damaged = sm.load_or_build(settings, COURSE, _item(settings), lecture=_lecture(settings))
    assert damaged["pptx"]["status"] == "unreadable" and damaged["pptx"]["transient"] is False
    assert damaged["inspection"]["transient"] is False and damaged["cache"] is not None


def test_a_page_the_parser_cannot_read_is_a_property_of_the_bytes_and_is_cached(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    original = pypdf.PageObject.extract_text

    def failing(self, *args, **kwargs):
        text = original(self, *args, **kwargs)
        if "Refractory" in text:
            raise ValueError("synthetic extraction failure")
        return text

    monkeypatch.setattr(pypdf.PageObject, "extract_text", failing)
    opened = []
    real_reader = sm.PdfReader
    monkeypatch.setattr(sm, "PdfReader", lambda *args, **kwargs: opened.append(1) or real_reader(*args, **kwargs))
    first = sm.load_or_build(settings, COURSE, item)
    assert first["pages"][4]["status"] == "unknown" and first["pages"][4]["reason"] == "unreadable"
    assert first["inspection"]["status"] == "partial" and first["inspection"]["transient"] is False and first["inspection"]["retry"] == "on_request"
    assert sm.load_or_build(settings, COURSE, item) == first and len(opened) == 1


def test_a_damaged_cache_file_is_rebuilt_and_a_cache_that_cannot_be_written_does_not_fail_the_read(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    cached = settings.app_area(COURSE) / "source-map" / item["source_id"] / base["source"]["sha256"][:16] / "map-o0000.json"
    data = json.loads(cached.read_text(encoding="utf-8"))
    assert re.fullmatch(r"[0-9a-f]{64}", data["cache"]["content_sha256"])
    data["pages"][0]["printed_number"] = 99  # an edit, or a damaged file: the stored digest no longer matches the content
    cached.write_text(json.dumps(data), encoding="utf-8")
    again = sm.load_or_build(settings, COURSE, item)
    assert again == base and again["pages"][0]["printed_number"] is None and "Slide" not in sm.describe_page(again, 1)["label"]

    cached.unlink()
    monkeypatch.setattr(sm, "replace_atomic", lambda path, data: (_ for _ in ()).throw(PermissionError("synthetic: another reader holds the file")))
    unsaved = sm.load_or_build(settings, COURSE, item)
    assert unsaved["map_revision"] == base["map_revision"] and not cached.exists()


def test_an_oversized_file_is_refused_before_it_is_read_and_the_time_bound_covers_the_presentations(tmp_path, course, monkeypatch):
    settings, root = course
    path = root / "materials/lectures/lecture-01/Deck.pdf"
    write_slide_pdf(path, REVEAL)
    hashed = []
    real_hash = sm._file_sha256
    monkeypatch.setattr(sm, "_file_sha256", lambda p: hashed.append(p) or real_hash(p))
    too_large = sm.build_source_map(path, limits=sm.Limits(max_bytes=100))
    assert too_large["inspection"]["reason"] == "byte_limit" and too_large["source"]["sha256"] is None and too_large["source"]["bytes"] == path.stat().st_size
    stored = sm.load_or_build(settings, COURSE, _item(settings), limits=sm.Limits(max_bytes=100))
    assert stored["inspection"]["reason"] == "byte_limit" and stored["cache"] is None and hashed == []
    assert not (settings.app_area(COURSE) / "source-map").exists()

    deck = tmp_path / "deck.pptx"
    write_synthetic_pptx(deck, PPTX_SLIDES)
    ticks = iter(float(n) for n in range(0, 10**6, 10))
    partial = sm.inspect_pptx(deck, limits=sm.Limits(max_seconds=25), clock=lambda: next(ticks))
    assert partial["truncated"] is True and partial["reason"] == "time_limit" and 0 < len(partial["slides"]) < 6 and partial["slide_count"] == 6

    # Inside a map: the pages were read in time, the clock then runs out, and the presentation is not attempted.
    state = {"late": False}
    real_numbers = sm._detect_printed_numbers
    monkeypatch.setattr(sm, "_detect_printed_numbers", lambda pages: (state.update(late=True), real_numbers(pages))[1])
    source_map = sm.build_source_map(_signalling_pdf(tmp_path), pptx_path=deck, clock=lambda: 10.0**6 if state["late"] else 0.0)
    assert source_map["inspection"]["status"] == "complete" and all(page["status"] == "ok" for page in source_map["pages"])
    assert source_map["pptx"]["status"] == "not_inspected" and source_map["pptx"]["reason"] == "time_limit" and source_map["pptx"]["alignment"]["status"] == "not_attempted"
    assert all(page["pptx"] is None for page in source_map["pages"])
    # The pages are all read, yet the map says that another attempt may give more (slide identity): it is not a settled map.
    assert source_map["inspection"]["transient"] is True and source_map["pptx"]["transient"] is True


def test_a_replaced_source_gets_a_new_map_and_reports_what_no_longer_applies(course):
    settings, root = course
    deck = root / "materials/lectures/lecture-01/Deck.pdf"
    write_slide_pdf(deck, REVEAL)
    item = _item(settings)
    sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="learner", reason="Page 4 starts a new slide")
    old = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="agent", reason="The roadmap is taught")
    old_ids = [slide["logical_slide_id"] for slide in old["logical_slides"]]
    assert old["overrides"]["revision"] == 2

    write_slide_pdf(deck, [REVEAL[0], *DERIVATION])  # the file is replaced: other bytes under the same path
    new = sm.load_or_build(settings, COURSE, _item(settings))
    assert new["source"]["sha256"] != old["source"]["sha256"] and new["map_revision"] != old["map_revision"]
    assert new["overrides"]["revision"] == 0 and new["overrides"]["history"] == []  # old corrections are not silently re-used
    assert not set(old_ids) & {slide["logical_slide_id"] for slide in new["logical_slides"]}

    [previous] = new["other_source_versions"]
    assert previous["sha256"] == old["source"]["sha256"] and previous["map_revision"] == old["map_revision"]
    assert set(old_ids) <= set(previous["logical_slide_ids_not_applicable"])
    assert [(entry["revision"], entry["type"], entry["status"]) for entry in previous["overrides_not_applied"]] == [
        (1, "split", "not_applied_source_replaced"), (2, "role", "not_applied_source_replaced")]
    # Page 1 is the same content in both versions, so the role correction is offered for re-application — not applied.
    assert previous["overrides_not_applied"][1]["same_content_at_these_pages"] is True
    assert previous["overrides_not_applied"][0]["same_content_at_these_pages"] is False
    assert _page(new, 1)["role"]["source"] == "auto"

    stale = sm.resolve(new, old_ids[1])
    assert stale["status"] == "stale_source_version" and stale["logical_slide_ids"] == []
    assert sm.resolve(new, "page=2")["status"] == "page"  # a physical page of the current version is always addressable
    assert sm.summary(new)["other_source_versions"] == 1
    assert sm.summary(new)["pages_content_sha256"] != sm.summary(old)["pages_content_sha256"]

    # The earlier version's history is kept: putting the old bytes back restores its map and its corrections.
    write_slide_pdf(deck, REVEAL)
    restored = sm.load_or_build(settings, COURSE, _item(settings))
    assert restored["source"]["sha256"] == old["source"]["sha256"] and restored["overrides"]["revision"] == 2
    assert _groups(restored) == _groups(old) and len(restored["other_source_versions"]) == 1
    assert sm.summary(restored)["pages_content_sha256"] == sm.summary(old)["pages_content_sha256"]


# ---- 10. overrides ---------------------------------------------------------------------------------------
def test_a_manual_split_is_a_new_revision_with_history_and_an_alias_for_the_old_id(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    group_id = _page(base, 2)["logical_slide_id"]

    split = sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="learner", reason="Page 4 is a new slide, not a third build",
                              now="2026-10-05T20:00:00Z")
    assert _groups(split) == [[1], [2, 3], [4], [5]] and split["map_revision"] != base["map_revision"]
    assert split["overrides"]["revision"] == 1 and split["cache"]["key"]["overrides_revision"] == 1
    [entry] = split["overrides"]["history"]
    assert entry["revision"] == 1 and entry["supersedes"] is None and entry["author"] == {"kind": "learner", "ref": None}
    assert entry["reason"] == "Page 4 is a new slide, not a third build" and entry["created_at"] == "2026-10-05T20:00:00Z" and entry["status"] == "applied"
    assert _slide_of(split, 2)["kind"] == "incremental_build" and _slide_of(split, 2)["grouping"] == "inferred" and _slide_of(split, 4)["kind"] == "single"
    assert _slide_of(split, 4)["grouping"] == "override" and (_page(split, 3)["build_index"], _page(split, 3)["build_count"]) == (2, 2)

    # The id that named pages 2-4 is retired, not lost: it resolves to the slides that now hold those pages.
    current_ids = [_page(split, n)["logical_slide_id"] for n in (2, 4)]
    assert group_id not in {slide["logical_slide_id"] for slide in split["logical_slides"]}
    alias = next(entry for entry in split["aliases"] if entry["alias"] == group_id)
    assert alias["pages"] == [2, 3, 4] and alias["retired_by_revision"] == 1 and alias["resolves_to"] == current_ids and alias["primary"] == current_ids[0]
    resolved = sm.resolve(split, group_id)
    assert resolved["status"] == "alias" and resolved["logical_slide_ids"] == current_ids and resolved["logical_slide_id"] == current_ids[0] and resolved["pages"] == [2, 3, 4]

    # Revisions are immutable files that chain by number and bytes; the earlier map stays cached.
    directory = settings.app_area(COURSE) / "source-map" / item["source_id"] / base["source"]["sha256"][:16]
    first_file = directory / "overrides" / "r0001.json"
    first_bytes = first_file.read_bytes()
    again = sm.apply_override(settings, COURSE, item, {"type": "split", "pages": [2]}, author="agent", reason="Page 2 stands alone as well")
    assert _groups(again) == [[1], [2], [3], [4], [5]] and again["overrides"]["revision"] == 2
    second = json.loads((directory / "overrides" / "r0002.json").read_text(encoding="utf-8"))
    assert second["contract"] == "source-map-override/1" and second["supersedes"] == {"revision": 1, "sha256": hashlib.sha256(first_bytes).hexdigest()}
    assert second["author"]["kind"] == "agent" and second["source"]["sha256"] == base["source"]["sha256"]
    assert first_file.read_bytes() == first_bytes
    assert {path.name for path in directory.glob("map-o*.json")} == {"map-o0000.json", "map-o0001.json", "map-o0002.json"}
    assert sm.resolve(again, group_id)["logical_slide_ids"] == [_page(again, n)["logical_slide_id"] for n in (2, 3, 4)]


def test_a_manual_group_joins_pages_and_a_revert_restores_them_as_a_further_revision(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", DERIVATION)
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    singles = [_page(base, n)["logical_slide_id"] for n in (2, 3, 4)]

    grouped = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3, 4]}, author="learner", reason="One derivation shown in three steps")
    assert _groups(grouped) == [[1], [2, 3, 4]]
    group = _slide_of(grouped, 3)
    assert group["kind"] == "manual_group" and group["grouping"] == "override" and group["overrides"] == [1]
    assert sm.describe_page(grouped, 3)["label"] == "PDF page 3 of 4 · part 2 of 3"
    for old in singles:
        resolved = sm.resolve(grouped, old)
        assert resolved["status"] == "alias" and resolved["logical_slide_id"] == group["logical_slide_id"]
    assert sm.summary(grouped)["groups"]["manual_group"] == 1

    reverted = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [1]}, author="learner", reason="They are separate steps after all")
    assert _groups(reverted) == _groups(base) and reverted["overrides"]["revision"] == 2
    assert [(entry["revision"], entry["type"], entry["status"]) for entry in reverted["overrides"]["history"]] == [(1, "group", "reverted"), (2, "revert", "applied")]
    assert reverted["overrides"]["history"][1]["replaces"] == [1]
    assert sm.resolve(reverted, singles[0])["status"] == "current"
    assert sm.resolve(reverted, group["logical_slide_id"])["logical_slide_ids"] == singles  # the group's id still resolves


def test_reverting_a_revert_puts_the_original_correction_back_in_force(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)

    def statuses(source_map: dict) -> list[tuple]:
        return [(entry["revision"], entry["type"], entry["status"]) for entry in source_map["overrides"]["history"]]

    one = sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="learner", reason="Page 4 is a new slide")
    two = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [1]}, author="learner", reason="Undo the split")
    three = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [2]}, author="learner", reason="Undo the undo: the split was right")
    assert _groups(one) == [[1], [2, 3], [4], [5]] and _groups(two) == [[1], [2, 3, 4], [5]]
    assert _groups(three) == _groups(one)  # the map shows what the history says
    assert statuses(three) == [(1, "split", "applied"), (2, "revert", "reverted"), (3, "revert", "applied")]
    assert _slide_of(three, 4)["grouping"] == "override" and _slide_of(three, 4)["overrides"] == [1]
    # A revision that is not in force cannot be reverted again: such a record would be "applied" and change nothing.
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [2]}, author="learner", reason="Once more")
    assert error.value.code == "invalid_override" and "not in force" in error.value.message
    four = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [1]}, author="learner", reason="No split after all")
    # The history says what the undo of the undo did: it put revision 1 back in force.
    assert three["overrides"]["history"][2]["restores"] == [1] and three["overrides"]["history"][0]["in_force"] is True
    assert three["overrides"]["history"][1]["reverted_by"] == 3 and three["overrides"]["history"][1]["in_force"] is False
    assert _groups(four) == _groups(two) and statuses(four) == [(1, "split", "reverted"), (2, "revert", "reverted"), (3, "revert", "applied"), (4, "revert", "applied")]
    assert four["overrides"]["history"][0]["reverted_by"] == 4 and four["overrides"]["history"][2]["restores"] == []  # what r3 restored has since been undone
    # Every id any of these revisions issued still resolves.
    for source_map in (one, two, three):
        for slide in source_map["logical_slides"]:
            assert sm.resolve(four, slide["logical_slide_id"])["status"] in {"current", "alias"}


def test_an_agent_correction_cannot_displace_a_learner_correction(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 3}, author="learner", reason="I checked: page 3 is a different slide")
    sm.apply_override(settings, COURSE, item, {"type": "role", "page": 2, "role": "worked_example_or_question"}, author="learner", reason="This is the worked example")
    refused = [{"type": "group", "pages": [2, 3]}, {"type": "group", "pages": [2, 3, 4]}, {"type": "role", "page": 2, "role": "instructional"}, {"type": "revert", "revisions": [1]}]
    for op in refused:
        with pytest.raises(sm.SourceMapError) as error:
            sm.apply_override(settings, COURSE, item, op, author="agent", reason="The text of page 3 contains the text of page 2")
        assert error.value.code == "learner_correction_in_force", op
    current = sm.load_or_build(settings, COURSE, item)
    assert current["overrides"]["revision"] == 2 and _groups(current) == [[1], [2], [3, 4], [5]] and _page(current, 2)["role"]["role"] == "worked_example_or_question"
    # What the learner did not fix stays open to the agent, and the learner can always change their own correction.
    agent = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="agent", reason="The roadmap is taught")
    assert agent["overrides"]["revision"] == 3 and _page(agent, 1)["role"]["role"] == "instructional"
    learner = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3, 4]}, author="learner", reason="One slide after all")
    assert _groups(learner) == [[1], [2, 3, 4], [5]] and learner["overrides"]["history"][0]["status"] == "superseded"
    # The same rule holds when records are applied directly: an agent record that contradicts a learner record in force is reported, not applied.
    direct = sm.build_source_map(root / item["path"], overrides=[
        {"op": {"type": "split", "before_page": 3}, "author": {"kind": "learner", "ref": None}, "reason": "checked"},
        {"op": {"type": "group", "pages": [2, 3]}, "author": {"kind": "agent", "ref": None}, "reason": "text superset"}])
    assert _groups(direct) == [[1], [2], [3, 4], [5]]
    assert direct["overrides"]["problems"] == [{"code": "learner_correction_in_force", "revision": 2, "message": direct["overrides"]["problems"][0]["message"]}]
    assert [entry["status"] for entry in direct["overrides"]["history"]] == ["applied", "refused"]


def test_an_agent_may_record_a_correction_over_the_learners_only_on_the_learners_say(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 3}, author="learner", reason="Page 3 is a different slide")
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3, 4]}, author="agent", reason="Text superset")
    assert error.value.code == "learner_correction_in_force" and "r1" in error.value.message and "learner" in error.value.message
    # The call says the learner asked for it: the record is the agent's, it carries that authority, and it takes the learner's place.
    asked = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3, 4]}, author="agent", author_ref="session-1", learner_authority=True,
                              reason="The learner said in the session: these three pages are one slide")
    assert _groups(asked) == [[1], [2, 3, 4], [5]]
    entry = asked["overrides"]["history"][1]
    assert entry["author"] == {"kind": "agent", "ref": "session-1", "learner_authority": True} and entry["replaces"] == [1] and entry["status"] == "applied"
    assert asked["overrides"]["history"][0]["status"] == "superseded"
    # A correction made on the learner's say is protected like the learner's own.
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="agent", reason="Page 4 looks different")
    assert error.value.code == "learner_correction_in_force" and "r2" in error.value.message
    assert sm.load_or_build(settings, COURSE, item)["overrides"]["revision"] == 2


SEPARATE = [OPENING, {"title": "Alpha", "bullets": ["First statement of the alpha page only"]}, {"title": "Beta", "bullets": ["Another statement for the beta page"]}, CLOSING]


def _statuses(source_map: dict) -> list[tuple]:
    return [(entry["revision"], entry["type"], entry["status"]) for entry in source_map["overrides"]["history"]]


def _refused(settings: Settings, item: dict, op: dict, **author) -> str:
    """The message of the refusal an agent's correction meets (nothing is recorded)."""
    before = sm.load_or_build(settings, COURSE, item)["overrides"]["revision"]
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, op, reason="The agent reads the pages this way", **(author or {"author": "agent"}))
    assert error.value.code == "learner_correction_in_force", op
    assert sm.load_or_build(settings, COURSE, item)["overrides"]["revision"] == before
    return error.value.message


def test_an_agent_cannot_record_again_what_the_learner_undid_with_a_revert(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", SEPARATE)
    item = _item(settings)

    def agent(op: dict) -> dict:
        return sm.apply_override(settings, COURSE, item, op, author="agent", reason="The agent reads the pages this way")

    def learner_undoes(revision: int) -> dict:
        return sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [revision]}, author="learner", reason="No: I looked, that is wrong")

    # A grouping: the agent joins two pages, the learner undoes it. The same join is then the learner's to make, in any spelling.
    assert _groups(agent({"type": "group", "pages": [2, 3]})) == [[1], [2, 3], [4]]
    assert _groups(learner_undoes(1)) == [[1], [2], [3], [4]]
    for op in ({"type": "group", "pages": [2, 3]}, {"type": "group", "pages": [2, 3], "kind": "duplicate"}, {"type": "group", "pages": [2, 3, 4]}, {"type": "group", "pages": [1, 2, 3]}):
        assert "r2" in _refused(settings, item, op)  # the refusal names the learner's revert
    # A role and a printed number: after the learner's undo the page's role and number are not the agent's to set again.
    assert _page(agent({"type": "role", "page": 2, "role": "blank"}), 2)["role"]["role"] == "blank"
    assert _page(learner_undoes(3), 2)["role"]["source"] == "auto"
    for role in ("blank", "structural_title_or_section"):
        assert "r4" in _refused(settings, item, {"type": "role", "page": 2, "role": role})
    assert sm.describe_page(agent({"type": "printed_number", "page": 2, "printed_number": 41}), 2)["label"] == "PDF page 2 of 4 · Slide 41"
    assert _page(learner_undoes(5), 2)["printed_number"] is None
    assert "r6" in _refused(settings, item, {"type": "printed_number", "page": 2, "printed_number": 41})
    # ... nor is the learner's revert itself the agent's to undo.
    assert "r2" in _refused(settings, item, {"type": "revert", "revisions": [2]})

    current = sm.load_or_build(settings, COURSE, item)
    assert _groups(current) == [[1], [2], [3], [4]] and _page(current, 2)["role"]["source"] == "auto" and sm.describe_page(current, 2)["label"] == "PDF page 2 of 4"
    assert _statuses(current) == [(1, "group", "reverted"), (2, "revert", "applied"), (3, "role", "reverted"), (4, "revert", "applied"), (5, "printed_number", "reverted"), (6, "revert", "applied")]
    # What the learner did not speak about stays open to the agent: another boundary, another page, the same boundary read the learner's way.
    assert _groups(agent({"type": "group", "pages": [3, 4]})) == [[1], [2], [3, 4]]
    assert _page(agent({"type": "role", "page": 3, "role": "worked_example_or_question"}), 3)["role"]["role"] == "worked_example_or_question"
    assert agent({"type": "split", "before_page": 3})["overrides"]["revision"] == 9
    # On the learner's say the agent may record it, and the learner always may.
    asked = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 2, "role": "blank"}, author="agent", learner_authority=True, reason="The learner said: page 2 is empty")
    assert _page(asked, 2)["role"]["role"] == "blank"
    own = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3]}, author="learner", reason="One slide after all")
    assert _groups(own) == [[1], [2, 3], [4]]


def test_the_learners_undo_of_their_own_correction_is_protected_like_any_other_word_of_theirs(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", SEPARATE)
    item = _item(settings)
    sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3]}, author="learner", reason="One slide")
    undone = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [1]}, author="learner", reason="Changed my mind: two slides")
    assert _groups(undone) == [[1], [2], [3], [4]]
    assert "r2" in _refused(settings, item, {"type": "revert", "revisions": [2]})
    assert "r2" in _refused(settings, item, {"type": "group", "pages": [2, 3]})  # the same join by another road
    assert _groups(sm.load_or_build(settings, COURSE, item)) == [[1], [2], [3], [4]]


def test_what_the_learner_put_back_in_force_stands_against_an_agent_like_the_learners_own_correction(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", SEPARATE)
    item = _item(settings)

    def record(op: dict, author: str) -> dict:
        return sm.apply_override(settings, COURSE, item, op, author=author, reason="As read")

    # The agent groups, the agent takes it back, the learner undoes the taking back: the group now stands on the learner's word.
    record({"type": "group", "pages": [2, 3]}, "agent")
    record({"type": "revert", "revisions": [1]}, "agent")
    restored = record({"type": "revert", "revisions": [2]}, "learner")
    assert _groups(restored) == [[1], [2, 3], [4]] and restored["overrides"]["history"][2]["restores"] == [1]
    for op in ({"type": "revert", "revisions": [1]}, {"type": "split", "before_page": 3}, {"type": "split", "pages": [2]}, {"type": "group", "pages": [3, 4]}, {"type": "revert", "revisions": [3]}):
        assert "r3" in _refused(settings, item, op)
    assert _groups(sm.load_or_build(settings, COURSE, item)) == [[1], [2, 3], [4]]


def test_the_learners_latest_word_wins_over_an_agent_record_made_before_it(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", SEPARATE)
    item = _item(settings)

    def record(op: dict, author: str) -> dict:
        return sm.apply_override(settings, COURSE, item, op, author=author, reason="As read")

    record({"type": "group", "pages": [2, 3]}, "learner")  # r1
    record({"type": "revert", "revisions": [1]}, "learner")  # r2: two slides
    assert _groups(record({"type": "split", "before_page": 3}, "agent")) == [[1], [2], [3], [4]]  # r3 agrees with the learner's undo and is recorded
    back = record({"type": "revert", "revisions": [2]}, "learner")  # r4: the learner's group is back, and it is the later word on that boundary
    assert _groups(back) == [[1], [2, 3], [4]] and back["overrides"]["history"][3]["restores"] == [1]
    assert _slide_of(back, 2)["overrides"] == [1] and sm.describe_page(back, 3)["label"] == "PDF page 3 of 4 · part 2 of 2"
    # A role: while the learner's undo holds the role of the page is not the agent's to set; the learner's role, put back, holds again.
    record({"type": "role", "page": 4, "role": "objectives_or_summary"}, "learner")  # r5
    record({"type": "revert", "revisions": [5]}, "learner")  # r6
    assert "r6" in _refused(settings, item, {"type": "role", "page": 4, "role": "blank"})
    assert _page(record({"type": "revert", "revisions": [6]}, "learner"), 4)["role"]["role"] == "objectives_or_summary"


def test_an_agent_cannot_change_the_kind_the_learner_gave_a_group(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", SEPARATE)
    item = _item(settings)
    grouped = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [2, 3], "kind": "incremental_build"}, author="learner", reason="Page 3 adds to page 2")
    assert sm.describe_page(grouped, 3)["label"] == "PDF page 3 of 4 · build 2 of 2"
    assert "r1" in _refused(settings, item, {"type": "group", "pages": [2, 3], "kind": "duplicate"})
    assert sm.describe_page(sm.load_or_build(settings, COURSE, item), 3)["label"] == "PDF page 3 of 4 · build 2 of 2"


def test_the_same_rules_hold_for_records_applied_directly_and_a_record_without_an_author_is_not_the_learners(tmp_path):
    path = _deck(tmp_path, SEPARATE)
    learner, agent = {"kind": "learner", "ref": None}, {"kind": "agent", "ref": None}
    redone = sm.build_source_map(path, overrides=[
        {"op": {"type": "group", "pages": [2, 3]}, "author": agent, "reason": "one slide"},
        {"op": {"type": "revert", "revisions": [1]}, "author": learner, "reason": "No: two slides"},
        {"op": {"type": "group", "pages": [2, 3]}, "author": agent, "reason": "one slide, again"}])
    assert _groups(redone) == [[1], [2], [3], [4]] and _statuses(redone) == [(1, "group", "reverted"), (2, "revert", "applied"), (3, "group", "refused")]
    assert [(problem["code"], problem["revision"]) for problem in redone["overrides"]["problems"]] == [("learner_correction_in_force", 3)]
    assert "r2" in redone["overrides"]["problems"][0]["message"]
    # A record that does not say who made it (a hand-written file, a caller that left the author out) never takes the place of the learner's.
    for author in ({}, {"author": None}, {"author": "someone"}, {"author": {"ref": "x"}}):
        unsigned = sm.build_source_map(_deck(tmp_path, REVEAL, name="reveal.pdf"), overrides=[
            {"op": {"type": "split", "before_page": 3}, "author": learner, "reason": "I checked"},
            {"op": {"type": "group", "pages": [2, 3]}, "reason": "no author at all", **author}])
        assert _groups(unsigned) == [[1], [2], [3, 4], [5]] and _statuses(unsigned) == [(1, "split", "applied"), (2, "group", "refused")], author
    # Without a learner's correction in its way such a record is applied as before.
    alone = sm.build_source_map(_deck(tmp_path, REVEAL, name="reveal.pdf"), overrides=[{"op": {"type": "split", "before_page": 3}, "reason": "no author"}])
    assert _groups(alone) == [[1], [2], [3, 4], [5]] and _statuses(alone) == [(1, "split", "applied")]


def test_a_regions_correction_keeps_region_addresses_stable(course):
    settings, root = course
    grid = [{"seed": seed, "box": box} for seed, box in ((1, (20, 40, 80, 60)), (2, (115, 40, 80, 60)), (3, (20, 120, 80, 60)), (4, (115, 120, 80, 60)))]
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", [{"lines": ["Handout for week 3"], "images": grid}], page_format=(215.9, 279.4), orientation="portrait")
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    boxes = {region["region_id"]: region["box"] for region in _page(base, 1)["regions"]}
    assert list(boxes) == ["r1", "r2", "r3", "r4"]

    # Three of the four boxes, listed in another order: an id keeps naming the box it named before.
    updated = sm.apply_override(settings, COURSE, item, {"type": "regions", "page": 1, "regions": [{"box": boxes[key]} for key in ("r4", "r1", "r2")]},
                                author="learner", reason="Three slides, read in this order")
    regions = _page(updated, 1)["regions"]
    assert [(region["region_id"], region["order"]) for region in regions] == [("r4", 1), ("r1", 2), ("r2", 3)]
    assert sm.resolve(updated, "page=1#r2")["region"]["box"] == boxes["r2"] and sm.resolve(updated, "page=1#r4")["region"]["box"] == boxes["r4"]
    assert sm.describe_page(updated, 1, region="r2")["label"] == "PDF page 1 of 1 · region 3 of 3"
    # The region that is gone still answers: the page address stays valid, and the answer says the region was retired and where it was.
    retired = sm.resolve(updated, "page=1#r3")
    assert retired["status"] == "region_retired" and retired["page"] == 1 and retired["region"]["box"] == boxes["r3"] and retired["region"]["retired_by_revision"] == 1
    assert [entry["region_id"] for entry in _page(updated, 1)["retired_regions"]] == ["r3"]
    assert sm.resolve(updated, "page=1#r9")["status"] == "unknown"
    with pytest.raises(sm.SourceMapError) as error:
        sm.describe_page(updated, 1, region="r3")
    assert error.value.code == "region_retired"

    # A box that was never there gets a new id; the retired id is not handed out again.
    new_box = [0.1, 0.7, 0.9, 0.95]
    again = sm.apply_override(settings, COURSE, item, {"type": "regions", "page": 1, "regions": [{"box": boxes["r1"]}, {"box": new_box}]}, author="learner", reason="Two after all")
    assert [region["region_id"] for region in _page(again, 1)["regions"]] == ["r1", "r5"]
    assert sm.resolve(again, "page=1#r5")["region"]["box"] == new_box and sm.resolve(again, "page=1#r3")["status"] == "region_retired"
    assert sorted(entry["region_id"] for entry in _page(again, 1)["retired_regions"]) == ["r2", "r3", "r4"]
    # A box that is redrawn a little larger is a new region; the old address names the region that now covers its place.
    left, top, right, bottom = boxes["r1"]
    redrawn = sm.apply_override(settings, COURSE, item, {"type": "regions", "page": 1, "regions": [{"box": [left, top, right + 0.02, bottom + 0.02]}]}, author="learner", reason="Wider")
    assert [region["region_id"] for region in _page(redrawn, 1)["regions"]] == ["r6"]
    old = sm.resolve(redrawn, "page=1#r1")
    assert old["status"] == "region_retired" and old["region"]["resolves_to"] == "r6" and old["region"]["box"] == boxes["r1"]
    assert sm.resolve(redrawn, "page=1#r3")["region"]["resolves_to"] is None  # nothing is drawn where r3 was
    # Undoing the corrections brings the detected regions back under the ids they always had.
    undone = sm.apply_override(settings, COURSE, item, {"type": "revert", "revisions": [1, 2, 3]}, author="learner", reason="Four slides after all")
    assert {region["region_id"]: region["box"] for region in _page(undone, 1)["regions"]} == boxes
    assert [entry["region_id"] for entry in _page(undone, 1)["retired_regions"]] == ["r5", "r6"]


def test_role_and_printed_number_corrections_are_overrides_that_keep_the_automatic_value(course):
    settings, root = course
    pages = [{"title": f"Concept {n}", "bullets": [f"A statement that belongs to concept {n} only"], "printed": n} for n in range(1, 6)]
    pages[0] = {"title": "Signals and noise", "printed": 1}
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", pages)
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    assert _page(base, 1)["role"]["role"] == "structural_title_or_section" and _page(base, 3)["printed_number"] == 3

    updated = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="learner", reason="The lecturer teaches from this page")
    updated = sm.apply_override(settings, COURSE, item, {"type": "printed_number", "page": 3, "printed_number": 12}, author="agent", reason="The page prints 12 in the corner")
    updated = sm.apply_override(settings, COURSE, item, {"type": "printed_number", "page": 4, "printed_number": None}, author="agent", reason="No number is printed on this page")
    role = _page(updated, 1)["role"]
    assert role["role"] == "instructional" and role["source"] == "override" and role["automatic"]["role"] == "structural_title_or_section"
    assert role["forced_requirements"] is True and role["override_revision"] == 1
    assert _page(updated, 3)["printed_number"] == 12 and _page(updated, 3)["printed_number_source"] == "override"
    assert _page(updated, 4)["printed_number"] is None and _page(updated, 5)["printed_number"] == 5
    assert sm.describe_page(updated, 3)["label"] == "PDF page 3 of 5 · Slide 12" and sm.describe_page(updated, 4)["label"] == "PDF page 4 of 5"
    assert len(updated["pages"]) == 5 and sm.summary(updated)["overrides_revision"] == 3
    # A later correction of the same page names the earlier one it replaces.
    final = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "objectives_or_summary"}, author="learner", reason="It lists the goals")
    assert final["overrides"]["history"][3]["replaces"] == [1] and final["overrides"]["history"][0]["status"] == "superseded"
    assert _page(final, 1)["role"]["role"] == "objectives_or_summary"


def test_an_invalid_correction_is_refused_and_nothing_is_recorded(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    refused = [
        ({"type": "group", "pages": [2, 4]}, "learner", "not adjacent"),
        ({"type": "group", "pages": [5, 6]}, "learner", "page 6 does not exist"),
        ({"type": "group", "pages": [3]}, "learner", "one page is not a group"),
        ({"type": "split", "before_page": 1}, "learner", "nothing precedes page 1"),
        ({"type": "role", "page": 2, "role": "decorative"}, "learner", "unknown role"),
        ({"type": "printed_number", "page": 2, "printed_number": "seventeen"}, "learner", "not a number"),
        ({"type": "regions", "page": 2, "regions": [{"box": [0.5, 0.1, 0.2, 0.9]}]}, "learner", "box is inside out"),
        ({"type": "revert", "revisions": [3]}, "learner", "no such revision"),
        ({"type": "merge", "pages": [2, 3]}, "learner", "unknown type"),
        ({"type": "role", "page": 2, "role": "blank"}, "robot", "unknown author"),
        ({"type": "role", "page": 2, "role": "blank"}, "learner", "   "),
    ]
    for op, author, reason in refused:
        with pytest.raises(sm.SourceMapError) as error:
            sm.apply_override(settings, COURSE, item, op, author=author, reason=reason)
        assert error.value.code == "invalid_override", (op, author, reason)
    current = sm.load_or_build(settings, COURSE, item)
    assert current["overrides"]["revision"] == 0 and _groups(current) == [[1], [2, 3, 4], [5]]
    assert not list((settings.app_area(COURSE) / "source-map").rglob("r0001.json"))


def test_a_damaged_revision_chain_is_reported_and_nothing_is_added_on_top_of_it(course, monkeypatch):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    sm.apply_override(settings, COURSE, item, {"type": "split", "before_page": 4}, author="learner", reason="Page 4 is a new slide")
    two = sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "instructional"}, author="learner", reason="Taught, not just shown")
    directory = settings.app_area(COURSE) / "source-map" / item["source_id"] / two["source"]["sha256"][:16] / "overrides"
    second = directory / "r0002.json"
    original = second.read_bytes()
    second.write_bytes(original.replace(b'"instructional"', b'"blank"'))  # r0001 is intact; r0002 is edited ...
    (directory / "r0003.json").write_bytes(json.dumps({"contract": "source-map-override/1", "revision": 3, "supersedes": {"revision": 2, "sha256": hashlib.sha256(original).hexdigest()},
                                                       "source": {"sha256": two["source"]["sha256"]}, "op": {"type": "split", "pages": [2]}}).encode())  # ... so r0003 no longer follows it
    damaged = sm.load_or_build(settings, COURSE, item)
    assert damaged["overrides"]["revision"] == 2 and damaged["overrides"]["problems"] == [{"code": "broken_revision_chain", "revision": 3}]
    assert _groups(damaged) == [[1], [2, 3], [4], [5]] and _page(damaged, 1)["role"]["role"] == "blank"  # what the verified files say, and no further
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "split", "pages": [3]}, author="learner", reason="One more")
    assert error.value.code == "override_chain_broken" and not (directory / "r0004.json").exists()

    # Two writers taking the same revision number: the second is told, and nothing is overwritten.
    (directory / "r0003.json").unlink()
    monkeypatch.setattr(sm, "publish_exclusive", lambda path, data: (_ for _ in ()).throw(sm.ExclusiveConflict(path.name)))
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "split", "pages": [3]}, author="learner", reason="One more")
    assert error.value.code == "override_conflict"


def test_a_missing_or_empty_file_has_an_explicit_state_and_cannot_be_corrected(course):
    settings, root = course
    deck = root / "materials/lectures/lecture-01/Deck.pdf"
    write_slide_pdf(deck, REVEAL)
    item = _item(settings)
    deck.write_bytes(b"")
    empty = sm.load_or_build(settings, COURSE, item)
    assert empty["inspection"] == {**empty["inspection"], "status": "unavailable", "reason": "empty"} and empty["pages"] == [] and empty["source"]["sha256"] is None
    deck.unlink()
    missing = sm.load_or_build(settings, COURSE, item)
    assert missing["inspection"]["reason"] == "missing" and missing["source"]["source_id"] == item["source_id"] and sm.summary(missing)["raw_pages"] is None
    assert not (settings.app_area(COURSE) / "source-map").exists()  # nothing is cached for a file that was not read
    with pytest.raises(sm.SourceMapError) as error:
        sm.apply_override(settings, COURSE, item, {"type": "role", "page": 1, "role": "blank"}, author="learner", reason="No page to correct")
    assert error.value.code == "source_unavailable"


def test_old_deep_links_still_resolve_after_the_mapping_changes(course):
    settings, root = course
    write_slide_pdf(root / "materials/lectures/lecture-01/Deck.pdf", REVEAL)
    item = _item(settings)
    base = sm.load_or_build(settings, COURSE, item)
    links = {page["page"]: page["logical_slide_id"] for page in base["pages"]}
    sm.apply_override(settings, COURSE, item, {"type": "split", "pages": [3]}, author="learner", reason="Page 3 is its own slide")
    final = sm.apply_override(settings, COURSE, item, {"type": "group", "pages": [4, 5]}, author="learner", reason="Pages 4 and 5 belong together")
    assert _groups(final) == [[1], [2], [3], [4, 5]]
    for page, old_id in links.items():
        by_page = sm.resolve(final, f"page={page}")
        assert by_page["status"] == "page" and by_page["page"] == page and by_page["logical_slide_id"] == _page(final, page)["logical_slide_id"]
        by_id = sm.resolve(final, old_id)
        assert by_id["status"] in {"current", "alias"} and _page(final, page)["logical_slide_id"] in by_id["logical_slide_ids"]
    assert sm.resolve(final, 4)["page"] == 4 and sm.resolve(final, "4")["page"] == 4
    assert sm.resolve(final, "page=99")["status"] == "unknown" and sm.resolve(final, "not-an-id")["status"] == "unknown"
    assert sm.resolve(final, links[1])["status"] == "current"
    # An id this source version never issued is not passed off as an earlier grouping; the pages its name spells are still given.
    never = f"ls-{final['source']['sha256'][:10]}-p1-5"
    unissued = sm.resolve(final, never)
    assert unissued["status"] == "unissued" and unissued["pages"] == [1, 2, 3, 4, 5] and "never issued" in unissued["reason"]
    assert unissued["logical_slide_ids"] == [slide["logical_slide_id"] for slide in final["logical_slides"]]
    # Applying the corrections directly to a freshly built map gives the same result as the stored revisions.
    records = final["overrides"]["history"]
    direct = sm.build_source_map(root / item["path"], source=final["source"], overrides=records)
    assert _groups(direct) == _groups(final) and direct["map_revision"] == final["map_revision"]


def test_a_pptx_of_the_same_unit_is_used_as_the_companion_and_a_pptx_alone_has_no_pages(course):
    settings, root = course
    unit = root / "materials/lectures/lecture-01"
    (unit / "Deck.pdf").write_bytes(_signalling_pdf(root.parent).read_bytes())
    write_synthetic_pptx(unit / "Deck.pptx", PPTX_SLIDES)
    lecture = _lecture(settings)
    paired = sm.load_or_build(settings, COURSE, _item(settings), lecture=lecture)
    assert paired["pptx"]["alignment"]["status"] == "supported" and paired["pptx"]["source"]["source_id"] == _item(settings, "Deck.pptx")["source_id"]
    assert sm.load_or_build(settings, COURSE, _item(settings))["pptx"] is None  # without the unit there is no companion to align with

    alone = sm.load_or_build(settings, COURSE, _item(settings, "Deck.pptx"))
    assert alone["inspection"]["status"] == "pptx_only" and alone["pages"] == [] and alone["logical_slides"] == []
    assert [slide["ordinal"] for slide in alone["pptx"]["slides"]] == [1, 2, 3, 4, 5, 6] and alone["pptx"]["hidden_slides"] == [2]
    assert sm.summary(alone)["pptx"]["slide_count"] == 6 and sm.summary(alone)["raw_pages"] is None


def test_with_several_presentations_in_a_unit_only_the_one_that_aligns_lends_its_slide_ids(course):
    settings, root = course
    unit = root / "materials/lectures/lecture-01"
    (unit / "Deck.pdf").write_bytes(_signalling_pdf(root.parent).read_bytes())
    write_synthetic_pptx(unit / "Deck.pptx", PPTX_SLIDES)
    write_synthetic_pptx(unit / "Another topic.pptx", [{"title": f"Unrelated heading {n}", "bullets": [f"Different vocabulary entirely for item {n}"]} for n in range(1, 8)])
    source_map = sm.load_or_build(settings, COURSE, _item(settings), lecture=_lecture(settings))
    matching = _item(settings, "Deck.pptx")["source_id"]
    assert source_map["pptx"]["source"]["source_id"] == matching and source_map["pptx"]["alignment"]["status"] == "supported"
    assert sorted((entry["alignment"], entry["used"], entry["matched_pages"]) for entry in source_map["pptx"]["candidates"]) == [("not_supported", False, 0), ("supported", True, 6)]
    assert [page["pptx"]["ordinal"] if page["pptx"] else None for page in source_map["pages"]] == [1, 3, 3, 3, None, 5, 6]
    directory = settings.app_area(COURSE) / "source-map" / _item(settings)["source_id"] / source_map["source"]["sha256"][:16]
    [cached] = list(directory.glob("map-o0000*.json"))
    assert re.fullmatch(r"map-o0000-c[0-9a-f]{8}\.json", cached.name)  # the presentations that were tried are part of the cache key


def test_every_page_of_the_generated_fixture_decks_is_in_exactly_one_logical_slide(settings):
    checked = 0
    for course_id, binding in settings.courses.items():
        for lecture in build_inventory(binding)["lectures"]:
            for deck in lecture["decks"]:
                if deck["rendition"] != "native_pdf" or deck["state"] not in {"registered_readable", "present_unindexed"}:
                    continue
                source_map = sm.build_source_map(binding.root / deck["path"])
                pages = [page["page"] for page in source_map["pages"]]
                assert pages == list(range(1, len(pypdf.PdfReader(str(binding.root / deck["path"])).pages) + 1))
                assert sorted(n for slide in source_map["logical_slides"] for n in slide["pages"]) == pages
                assert all(sm.resolve(source_map, page["logical_slide_id"])["status"] == "current" for page in source_map["pages"])
                checked += 1
    assert checked >= 5
