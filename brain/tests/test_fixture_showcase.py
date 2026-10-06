"""The fixture profile's ONE synthetic showcase unit for amendment R2: be505 lecture-05.

Everything is invented and labelled synthetic. The unit exists so that every R2 state can be seen on screen and driven
in a browser test through the real Brain: page identity (a build, a step group, every role), the four kinds of
question tie and the line a question gets when nothing was found, recording ranges (a return to an earlier page, a
course-stated section) and the reasons a page has none. These tests read the unit the way the web app does — through
``Projector.lecture_view`` and the app's routes — and pin that the four earlier units are left as they were.

What is NOT shown here by anything: that speech was recognised (the "generated" words are the invented talk), that an
agent pass proposed or checked a link, or that a lexical match is about the page it names.
"""
from __future__ import annotations

import dataclasses
import json
import shutil
from types import SimpleNamespace
import wave

import pytest
from fastapi.testclient import TestClient

from lecture_brain import inferred_anchors
from lecture_brain.api import create_app
from lecture_brain.config import load_settings
from lecture_brain.derived import Derived
from lecture_brain.fixtures import builder, content, state
from lecture_brain.ownerio import study_maps
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.runtime import Runtime

COURSE, LECTURE = "be505", "lecture-05"
RECORDING = "src-lecture-05-recording"
# The four earlier units as they were before the showcase unit was added: pages of the displayed deck, and the questions of the lecture.
EARLIER = {
    "lecture-01": (4, ["BE505-L01-Q01", "BE505-L01-Q02", "BE505-L01-Q03", "BE505-L01-Q04"]),
    "lecture-02": (3, ["BE505-L02-Q01"]),
    "lecture-03": (2, []),
    "lecture-04": (3, ["BE505-L04-CLASS-Q01", "BE505-L04-Q01", "BE505-L04-Q02"]),
}
ROLES = {1: "structural_title_or_section", 2: "objectives_or_summary", 3: "instructional", 4: "instructional", 5: "instructional", 6: "instructional", 7: "instructional",
         8: "instructional", 9: "instructional", 10: "instructional", 11: "administrative", 12: "worked_example_or_question", 13: "instructional", 14: "objectives_or_summary"}
POSITIONS = {4: "build 1 of 3", 5: "build 2 of 3", 6: "build 3 of 3", 7: "step 1 of 2", 8: "step 2 of 2"}
SCHEDULE = {row["line"]: row for row in content.showcase_schedule()}
UNRESOLVED = content.showcase_unresolved()
Q1, Q2, Q3, Q4, PRACTICE, CLASS = ("BE505-L05-Q01", "BE505-L05-Q02", "BE505-L05-Q03", "BE505-L05-Q04", "BE505-L05-PRACTICE-Q01", "BE505-L05-CLASS-Q01")


def start(line: int) -> int:
    return SCHEDULE[line]["start_ms"]


def end(line: int) -> int:
    return SCHEDULE[line]["end_ms"]


def fixture_settings(template, base):
    """A private copy of the generated workspace with its own state folder, as ``conftest.settings`` makes one."""
    workspace = base / "ws"
    shutil.copytree(template, workspace)
    config = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    config.write_text(config.read_text(encoding="utf-8").replace(template.as_posix(), workspace.as_posix()), encoding="utf-8")
    return load_settings("fixture", env={}, planner_config=config, state_dir=base / "state")


@pytest.fixture(scope="module")
def showcase(tmp_path_factory, _fixture_template):
    """One workspace for the module: every lecture view before the state is installed, the install, every view after."""
    settings = fixture_settings(_fixture_template, tmp_path_factory.mktemp("showcase"))
    runtime = Runtime(settings, clock=lambda: 1_800_000_000.0)
    runtime.startup()
    try:
        units = [*EARLIER, LECTURE]
        before = {unit: runtime.projector.lecture_view(COURSE, unit) for unit in units}
        installed = state.install(settings, now=runtime.now, journal=runtime.journal, preparation=runtime.preparation)
        after = {unit: runtime.projector.lecture_view(COURSE, unit) for unit in units}
        yield SimpleNamespace(settings=settings, runtime=runtime, before=before, installed=installed, after=after, view=after[LECTURE])
    finally:
        runtime.journal.close()


def pages(view: dict) -> dict[int, dict]:
    return {slide["page"]: slide for slide in view["slides"]}


def ties(slide: dict, question_id: str, kind: str = "question_ties") -> list[dict]:
    return [tie for tie in slide[kind] if tie["question_id"] == question_id]


def one(rows: list[dict]) -> dict:
    assert len(rows) == 1, rows
    return rows[0]


def leaves(value, path: str = ""):
    if isinstance(value, dict):
        for key in sorted(value):
            yield from leaves(value[key], f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from leaves(item, f"{path}[{index}]")
    else:
        yield path, value


def differences(before: dict, after: dict) -> list[tuple]:
    """Every leaf of two views that is not the same: ``(path, before, after)``."""
    was, now = (dict(leaves(json.loads(json.dumps(view, default=str)))) for view in (before, after))
    return [(path, was.get(path), now.get(path)) for path in sorted(set(was) | set(now)) if was.get(path) != now.get(path)]


# ---- the unit, and the units beside it --------------------------------------------------------------------------------
def test_the_fixture_has_one_more_unit_and_the_four_earlier_units_are_as_they_were(showcase):
    inventory = build_inventory(showcase.settings.course(COURSE))
    assert [unit["lecture_id"] for unit in inventory["lectures"]] == [*EARLIER, LECTURE]
    assert showcase.view["title"] == "Fixture Lecture 05 - R2 showcase" and showcase.view["page_count"] == 14 and len(showcase.view["slides"]) == 14
    assert showcase.view["deck"]["source_id"] == "src-lecture-05-slides" and showcase.view["display"]["kind"] == "original_pdf"
    for unit, (page_count, question_ids) in EARLIER.items():
        for view in (showcase.before[unit], showcase.after[unit]):
            assert view["page_count"] == page_count and len(view["slides"]) == page_count, unit
            assert sorted(row["question_id"] for row in view["questions"]["all"]) == question_ids, unit
        # Installing the showcase state changes two things in another unit, both because a course has ONE suggestions file: the
        # revision of that file, and — for a question without any link — the reason: there is a file now, and it holds no item for it.
        changed = {path: (was, now) for path, was, now in differences(showcase.before[unit], showcase.after[unit])}
        assert changed.pop(".revisions.inferred_anchors_sha256") == (None, showcase.installed["anchors"]["sha256"]), unit
        assert all(path.endswith(".no_link.reason") and change == ("no_file", "no_item") for path, change in changed.items()), (unit, changed)
        assert len(changed) == (1 if unit == "lecture-01" else 0), "only the one question of lecture-01 whose locator names no page"
    assert sorted(row["question_id"] for row in showcase.view["questions"]["all"]) == sorted([Q1, Q2, Q3, Q4, PRACTICE, CLASS])
    assert [(row["collection"], row["count"], row["page_basis_reviewed"]) for row in showcase.view["questions"]["collections"]] == [("L05", 4, True), ("L05-class", 1, False), ("L05-practice", 1, False)]


def test_the_files_of_the_unit_are_labelled_synthetic_and_are_what_a_course_folder_holds(showcase):
    from pypdf import PdfReader

    root = showcase.settings.course(COURSE).root
    show = content.SHOWCASE
    deck = PdfReader(str(root / "materials/lectures" / show["unit"] / show["deck"]))
    assert len(deck.pages) == 14 and all(content.FIXTURE_NOTE in (page.extract_text() or "") for page in deck.pages), "every page says it is a synthetic fixture"
    session = root / "materials/sessions" / f"{show['session']}-lecture"
    assert sorted(path.name for path in session.iterdir()) == [show["transcript"], show["recording"]], "one recording and ONE transcript: a plain text file without times"
    lines = (session / show["transcript"]).read_text(encoding="utf-8").splitlines()
    assert lines == [SCHEDULE[n]["text"] for n in sorted(SCHEDULE)] and len(lines) == 41 and not any("-->" in line for line in lines)
    with wave.open(str(session / show["recording"]), "rb") as audio:
        assert audio.getnframes() / audio.getframerate() == 150.0
    assert end(41) <= 150_000 and UNRESOLVED[1] - UNRESOLVED[0] == 8000, "the talk fits the recording; the withheld stretch is eight seconds"
    # The course's own study note: three rows a reader takes, one it must skip, bound to the unit's files by their bytes.
    record = study_maps.read_study_maps(root, build_inventory(showcase.settings.course(COURSE)))["lectures"][LECTURE]
    assert [(row["pages"], row["transcript_ranges"]) for row in record["rows"]] == [([3, 4, 5, 6], [[3, 17]]), ([7, 8], [[18, 23]]), ([12], [[38, 40]])]
    assert [(row["row"], row["reason"], row["text"]) for row in record["skipped"]] == [(4, "pages_cell_not_numeric", "see the handout")]
    assert record["deck"]["bytes_verified"] and record["deck"]["source_id"] == "src-lecture-05-slides" and record["transcript"]["bytes_verified"]
    assert record["question_map"]["question_ids"] == [Q1, Q2, Q3, Q4], "the unit's companion question map lists its collection L05 and nothing else"
    # The output of the fixture's speech double lies beside the course folders, says what it is, and is complete (manifest present).
    speech = builder.showcase_speech_root(showcase.settings.planner_config.parents[2])
    manifest = json.loads((speech / "manifest.json").read_text(encoding="utf-8"))
    assert "synthetic" in manifest["producer"]["tool"] and "synthetic" in manifest["producer"]["model"] and manifest["recording"]["source_id"] == RECORDING
    assert not speech.resolve().is_relative_to(root.resolve()) and not speech.resolve().is_relative_to(showcase.settings.state_dir.resolve())
    segments = json.loads((speech / "segments.json").read_text(encoding="utf-8"))["segments"]
    spoken = [SCHEDULE[n] for n in sorted(SCHEDULE) if SCHEDULE[n]["generated"] is not None]
    assert [(s["clip_start_ms"], s["clip_end_ms"], s["text"]) for s in segments] == [(row["start_ms"], row["end_ms"], row["generated"]) for row in spoken]
    assert sum(1 for row in spoken if row["generated"] != row["text"]) == 2 and len(spoken) == 39, "two lines are garbled and two are withheld"
    assert all(not (word["clip_start_ms"] < UNRESOLVED[1] and word["clip_end_ms"] > UNRESOLVED[0]) for s in segments for word in s["words"]), "no word lies in the withheld stretch"


def test_the_catalogs_with_the_showcase_entries_still_validate_against_the_owner_schema(showcase, owner_learning_schema):
    """Fixture fidelity: the generated skills and families (each skill once per family) are what the course's own schema accepts."""
    import yaml
    from jsonschema import Draft202012Validator, FormatChecker

    root = showcase.settings.course(COURSE).root
    for name, definition in (("learning/skills.yaml", "skills"), ("learning/question-families.yaml", "families")):
        validator = Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": owner_learning_schema["$defs"]}, format_checker=FormatChecker())
        assert [error.message for error in validator.iter_errors(yaml.safe_load((root / name).read_text(encoding="utf-8")))] == [], name


def test_before_the_state_is_installed_the_unit_has_no_timing_and_no_suggestion(showcase):
    view = showcase.before[LECTURE]
    assert view["timing"]["stage"] == "audio_unprocessed" and view["timing"]["recordings"][0]["generated"] is None
    assert not any(slide["ranges"] for slide in view["slides"])
    assert {slide["page"]: slide["no_range"]["state"] for slide in view["slides"]} == {page: "no_range_expected" if page in (1, 11) else "audio_unprocessed" for page in range(1, 15)}
    assert not [tie for slide in view["slides"] for tie in slide["question_ties"] if tie["tie"] == "agent_inferred"]
    rows = {row["question_id"]: row for row in view["questions"]["all"]}
    assert all(rows[q]["no_link"] == {"state": "no_suggestion", "reason": "no_file"} for q in (Q2, Q3, Q4, CLASS))
    assert view["questions"]["counts"] == {"all": 6, "course_anchor": 2, "agent_inferred": 0, "without_link": 4, "course_section": 3, "course_anchor_with_suggestion": 0}


# ---- R2-S: identity and role of every page ---------------------------------------------------------------------------------
def test_the_source_map_words_the_build_the_step_group_and_the_role_of_every_page(showcase):
    view = showcase.view
    assert view["source_map"]["state"] == "ready" and view["source_map"]["page_count"] == 14 and view["source_map"]["printed_numbers_established"] is False
    by_page = pages(view)
    for page, slide in by_page.items():
        parts = [f"PDF page {page} of 14", *([POSITIONS[page]] if page in POSITIONS else [])]
        assert slide["identity"]["label_parts"] == parts and slide["identity"]["label"] == " · ".join(parts), page
        assert slide["identity"]["printed_slide_number"] is None and slide["identity"]["pptx"] is None, "nothing the file does not establish is worded"
        assert slide["role"]["value"] == ROLES[page] and slide["role"]["state"] == "generated", page
        assert slide["role"]["forced_requirements"] is (page not in (1, 11)), "only the cover and the administrative page force nothing"
        assert slide["role"]["uncertain"] is (page == 10), page
    assert [by_page[page]["identity"]["position"] for page in (4, 5, 6)] == [{"ordinal": n, "of": 3, "kind": "build"} for n in (1, 2, 3)]
    assert [by_page[page]["identity"]["position"] for page in (7, 8)] == [{"ordinal": n, "of": 2, "kind": "step"} for n in (1, 2)]
    assert all(by_page[page]["identity"]["position"] is None for page in (1, 2, 3, 9, 10, 11, 12, 13, 14))
    assert len({by_page[page]["identity"]["logical_slide_id"] for page in (4, 5, 6)}) == 1 and len({by_page[page]["identity"]["logical_slide_id"] for page in (7, 8)}) == 1
    # A page with a figure or a formula is kept as content although its text is sparse.
    assert "equation" in by_page[10]["role"]["basis"][0] and all("drawing" in by_page[page]["role"]["basis"][0] for page in (3, 9, 13))
    logical = {tuple(slide["pages"]): slide for slide in view["source_map"]["logical_slides"]}
    assert len(logical) == 11 and sorted(page for group in logical for page in group) == list(range(1, 15)), "every page stays addressable, in exactly one logical slide"
    assert logical[(4, 5, 6)]["kind"] == "build_group" and logical[(4, 5, 6)]["grouping"]["basis"] == "inferred" and logical[(4, 5, 6)]["grouping"]["confidence"] == "high"
    assert logical[(7, 8)]["kind"] == "step_group" and logical[(7, 8)]["grouping"]["confidence"] == "medium", "equal text over a changed drawing is never more than a medium reading"
    assert {"text_superset", "same_title"} <= set(logical[(4, 5, 6)]["grouping"]["signals"]) and {"identical_text", "drawing_changed"} <= set(logical[(7, 8)]["grouping"]["signals"])
    assert all(slide["grouping"]["state"] == "generated" for slide in logical.values()), "nobody has looked: a group is a proposal"
    assert all(slide["kind"] == "single" for group, slide in logical.items() if len(group) == 1)
    denominators = view["source_map"]["denominators"]
    assert (denominators["raw"], denominators["instructional"], denominators["excluded"], denominators["uncertain"]) == (14, 10, 2, 2)
    assert denominators["by_role"]["worked_example_or_question"] == 1 and denominators["by_role"]["objectives_or_summary"] == 2


# ---- R2-Q: questions tied to pages --------------------------------------------------------------------------------------
def test_exact_stated_section_and_suggested_ties_are_kept_apart_on_the_pages(showcase):
    by_page = pages(showcase.view)
    # exact: the reviewed collection's locator names the three builds and, separately, transcript lines
    for page in (4, 5, 6):
        tie = one(ties(by_page[page], Q1))
        assert (tie["tie"], tie["granularity"], tie["from"], tie["where"], tie["support_pages"], tie["transcript_lines"]) == ("exact", "page", "course_locator", "group_level", [4, 5, 6], [[9, 17]])
        assert tie["criteria_supported"] is None and tie["state"] is None and tie["suggestion_id"] is None
    # stated: a collection without a reviewed page basis
    tie = one(ties(by_page[12], PRACTICE))
    assert (tie["tie"], tie["where"], tie["support_pages"], tie["from"]) == ("stated", "on_this_page", [12], "course_locator")
    # section: the course's study map places questions in a range of pages; it is listed apart and is never a page tie
    for page in (3, 4, 5, 6):
        sections = {tie["question_id"]: tie for tie in by_page[page]["section_ties"]}
        assert set(sections) == {Q1, Q2} and all(tie["granularity"] == "section" and tie["tie"] == "stated" and tie["from"] == "course_study_map" for tie in sections.values())
        assert sections[Q1]["section"] == {"page_ranges": [[3, 6]], "label": "The reporter gene and its construct", "row": 1, "scope": "all"} and sections[Q2]["section"]["scope"] == "part"
    assert by_page[3]["question_ties"] == [], "a section statement that covers page 3 does not tie a question to page 3"
    for page in (7, 8):
        assert one(by_page[page]["section_ties"])["question_id"] == Q3 and by_page[page]["section_ties"][0]["section"]["scope"] is None
    assert all(not by_page[page]["section_ties"] for page in (1, 2, 9, 10, 11, 12, 13, 14))
    # suggested, not yet checked, partial: the third build carries two of the three criteria, the second build one, the first none of its own
    expected = {4: ("elsewhere_in_sequence", 2), 5: ("on_this_page", 1), 6: ("on_this_page", 2)}
    for page, (where, here) in expected.items():
        tie = one(ties(by_page[page], Q2))
        assert (tie["tie"], tie["state"], tie["verdict"], tie["coverage"], tie["where"], tie["support_pages"]) == ("agent_inferred", "agent_inferred", None, "partial", where, [5, 6])
        assert (tie["criteria_supported"], tie["criteria_total"], tie["criteria_supported_here"]) == (2, 3, here), page
        assert [row["pages"] for row in tie["criteria"]] == [[5, 6], [6]] and tie["learner_decision"] is None and tie["rationale"].startswith("Synthetic fixture")
    assert "1 of the 2 criteria" in one(ties(by_page[5], Q2))["why"] and "not yet checked" in one(ties(by_page[5], Q2))["why"]
    # suggested and checked: upheld on both steps of the page
    for page in (7, 8):
        tie = one(ties(by_page[page], Q3))
        assert (tie["tie"], tie["state"], tie["verdict"], tie["coverage"], tie["where"], tie["support_pages"]) == ("agent_inferred", "agent_reviewed", "upheld", "main", "group_level", [7, 8])
        assert (tie["criteria_supported"], tie["criteria_total"], tie["criteria_supported_here"]) == (1, 1, None), "the producer made no page-by-page statement"
    # narrowed by the checking pass: one page, one of two criteria
    tie = one(ties(by_page[10], Q4))
    assert (tie["tie"], tie["state"], tie["verdict"], tie["coverage"], tie["where"]) == ("agent_inferred", "agent_reviewed", "narrowed", "partial", "on_this_page")
    assert (tie["criteria_supported"], tie["criteria_total"]) == (1, 2) and "narrowed" in tie["verdict_note"]
    # rejected by the checking pass: no link on the page it named, and nowhere else
    assert by_page[13]["question_ties"] == [] and not [tie for slide in by_page.values() for tie in slide["question_ties"] if tie["verdict"] == "rejected"]
    assert not [tie for slide in by_page.values() for kind in ("question_ties", "section_ties") for tie in slide[kind] if tie["question_id"] == CLASS]
    tied = {page: sorted(tie["question_id"] for tie in slide["question_ties"]) for page, slide in by_page.items() if slide["question_ties"]}
    assert tied == {4: [Q1, Q2], 5: [Q1, Q2], 6: [Q1, Q2], 7: [Q3], 8: [Q3], 10: [Q4], 12: [PRACTICE]}, "a cover, an agenda and an administrative page carry no forced question"


def test_the_lecture_question_list_says_what_was_inspected_and_found_without_support(showcase):
    block = showcase.view["questions"]
    rows = {row["question_id"]: row for row in block["all"]}
    assert block["counts"] == {"all": 6, "course_anchor": 2, "agent_inferred": 3, "without_link": 1, "course_section": 3, "course_anchor_with_suggestion": 0}
    assert rows[CLASS]["no_link"] == {"state": "inspected_no_support", "reason": content.SHOWCASE_NO_CANDIDATE[0]["why"]} and rows[CLASS]["ties"] == []
    # Its wording lives only in the original sheet: the row says where to read it and carries no question text of its own.
    assert rows[CLASS]["prompt_in_index"] is False and "original source (05 - Fixture in-class questions.pdf)" in rows[CLASS]["prompt"]
    assert rows[CLASS]["original"]["source_id"] == "src-lecture-05-in-class-questions" and rows[CLASS]["original"]["displayable"] is True and rows[CLASS]["anchors"] == []
    assert all(rows[q]["no_link"] is None for q in (Q1, Q2, Q3, Q4, PRACTICE))
    assert rows[Q4]["suggestion_history"]["rejected_by_verifier"] == 1 and [tie["pages"] for tie in rows[Q4]["ties"]] == [[10]], "the rejected candidate is counted and is not a link"
    assert [(tie["tie"], tie["granularity"], tie["pages"]) for tie in rows[Q1]["ties"]] == [("exact", "page", [4, 5, 6]), ("stated", "section", [3, 4, 5, 6])]
    assert [(tie["tie"], tie["granularity"], tie["pages"], tie["state"]) for tie in rows[Q2]["ties"]] == [("stated", "section", [3, 4, 5, 6], None), ("agent_inferred", "page", [5, 6], "agent_inferred")]
    assert [(tie["tie"], tie["pages"]) for tie in rows[PRACTICE]["ties"]] == [("stated", [12])]
    # Criteria are counted and named by identity; their wording, the guidance and any expected answer are not in the view.
    text = json.dumps(showcase.view, default=str)
    mine = [q for q in content.BE505_QUESTIONS if q["question_id"] in rows]
    assert len(mine) == 6 and all(q["criteria"] for q in mine), "every question of the unit has criteria"
    assert not [q["answer"] for q in mine if q["answer"] in text] and not [k[2] for q in mine for k in q["criteria"] if k[2] in text]


# ---- R2-T: recording ranges and the reasons a page has none -------------------------------------------------------------------
def spans(slide: dict, scope: str | None = None) -> list[tuple]:
    return [(r["start_ms"], r["end_ms"], r["support"]["scope"], r["support"]["pages"], r["evidence"]["transcript_lines"]) for r in slide["ranges"] if scope is None or r["support"]["scope"] == scope]


def test_ranges_follow_the_talk_with_a_return_to_page_three_and_a_course_stated_section(showcase):
    by_page = pages(showcase.view)
    section = (start(3), end(17), "section", [3, 4, 5, 6], [[3, 17]])
    # page 3 is talked about twice: two disjoint occurrences, never merged into one interval; the second is the return near the end
    assert spans(by_page[3]) == [(start(3), end(8), "page", [3], [[3, 8]]), section, (start(33), end(36), "page", [3], [[33, 36]])]
    own = [r for r in by_page[3]["ranges"] if r["support"]["scope"] == "page"]
    assert [(r["occurrence_index"], r["occurrences_total"]) for r in own] == [(1, 2), (2, 2)] and all(r["origin"] == "pipeline" for r in own)
    # the build is one logical slide: one range for the group on each of its pages, with no minute split among the builds
    build = (start(9), end(17), "build_group", [4, 5, 6], [[9, 17]])
    for page in (4, 5, 6):
        assert spans(by_page[page]) == [section, build], page
    assert len({r["range_id"] for page in (4, 5, 6) for r in by_page[page]["ranges"] if r["support"]["scope"] == "build_group"}) == 1
    assert all(r["support"]["builds"] is None for page in (4, 5, 6) for r in by_page[page]["ranges"])
    for page in (7, 8):
        assert spans(by_page[page]) == [(start(18), end(23), "build_group", [7, 8], [[18, 23]])], page
    assert spans(by_page[10]) == [(start(24), end(26), "page", [10], [[24, 26]])], "the two lines whose time is unresolved add nothing to the range"
    assert spans(by_page[12]) == [(start(37), end(41), "page", [12], [[37, 41]]), (start(38), end(40), "section", [12], [[38, 40]])]
    # what a section range is: the course's own pairing of lines with pages, timed through the lines
    stated = one([r for r in by_page[3]["ranges"] if r["support"]["scope"] == "section"])
    assert stated["origin"] == "reviewed_source_map" and stated["quality"]["association"]["state"] == "course_stated" and stated["method"]["name"] == "course-stated-lines"
    every = [r for slide in by_page.values() for r in slide["ranges"]]
    assert every and all(r["relation"] == "discussed_during" and r["review_state"] == "generated" and r["recording"]["source_id"] == RECORDING and r["annotation_id"] is None for r in every)
    assert all(r["quality"]["acoustic"]["state"] == "generated_unreviewed" for r in every), "generated is not reviewed"
    # nothing is laid over the withheld stretch or over the talk about an umbrella, and nothing reaches past the last spoken line
    small_talk = (start(29), end(32))
    assert not [r for r in every if r["start_ms"] < UNRESOLVED[1] and r["end_ms"] > UNRESOLVED[0]]
    assert not [r for r in every if r["start_ms"] < small_talk[1] and r["end_ms"] > small_talk[0]] and max(r["end_ms"] for r in every) == end(41)


def test_a_page_without_a_range_says_which_of_the_reasons_applies(showcase):
    by_page = pages(showcase.view)
    states = {page: slide["no_range"]["state"] for page, slide in by_page.items() if slide["no_range"]}
    assert states == {1: "no_range_expected", 2: "ambiguous", 9: "audio_unprocessed", 11: "no_range_expected", 13: "audio_unprocessed", 14: "audio_unprocessed"}
    assert all((slide["no_range"] is None) == bool(slide["ranges"]) for slide in by_page.values())
    # the agenda was mentioned for under five seconds: a possible match, not shown as the page's range
    candidate = one(by_page[2]["no_range"]["detail"]["candidates"])
    assert (candidate["kind"], candidate["start_ms"], candidate["end_ms"]) == ("occurrence", start(1), end(2)) and "shorter than 8 seconds" in candidate["why_not_shown"]
    # the page the talk skipped and the two pages it never reached: not "not discussed" while eight seconds of the recording are unresolved
    for page in (9, 13, 14):
        detail = by_page[page]["no_range"]["detail"]
        assert detail["reason"] == "partly_processed" and detail["processed"] == [[RECORDING, 0, UNRESOLVED[0]], [RECORDING, UNRESOLVED[1], 150_000]], page
    assert by_page[1]["no_range"]["detail"] == {"role": "structural_title_or_section"} and by_page[11]["no_range"]["detail"] == {"role": "administrative"}
    # One recording has one reason for every page nothing was found for, so a single view holds at most three of the six
    # states. The fixture course as a whole shows a fourth: the units without a recording.
    elsewhere = {slide["no_range"]["state"] for unit in EARLIER for slide in showcase.after[unit]["slides"] if slide["no_range"]}
    assert "recording_unavailable" in elsewhere and len(set(states.values()) | elsewhere) >= 4


def test_the_timing_stage_states_what_is_generated_what_is_unresolved_and_how_the_text_was_aligned(showcase):
    timing = showcase.view["timing"]
    recording = one(timing["recordings"])
    assert timing["stage"] == "associated" and recording["source_id"] == RECORDING and recording["duration_ms"] == 150_000
    generated = recording["generated"]
    assert generated["text_origin"] == "generated_speech_text" and generated["review_state"] == "generated_unreviewed" and generated["generation"].startswith("fx-showcase-")
    assert generated["unresolved_intervals"] == [list(UNRESOLVED)] and generated["unresolved_ms"] == 8000 and generated["covers_whole_recording"] is False
    assert generated["covered_intervals"] == [[0, UNRESOLVED[0]], [UNRESOLVED[1], 150_000]] and generated["coverage_fraction"] == pytest.approx(142 / 150)
    alignment = recording["text_alignment"]
    assert (alignment["state"], alignment["reason"], alignment["lines_total"], alignment["lines_aligned"]) == ("accepted", None, 41, 37)
    assert recording["association"]["state"] == "current" and recording["association"]["cause"] is None and recording["association"]["inputs"]["generation"] == generated["generation"]
    summary = timing["summary"]
    assert (summary["pages"], summary["pages_with_range"], summary["pages_no_range_expected"], summary["pages_without_range"]) == (14, 8, 2, 4)
    assert summary["human_confirmed"] == 0 and summary["agent_reviewed"] == 0 and summary["generated"] == summary["ranges"] == 8, "eight distinct ranges, every one of them generated"
    # the stored links document: which lines got a time, and that the course transcript was only read
    document = json.loads((showcase.settings.app_area(COURSE) / "timing-links" / f"{LECTURE}.json").read_text(encoding="utf-8"))
    counts = one(document["recordings"])["stages"]["text_alignment"]["counts"]
    assert counts == {"aligned": 37, "too_few_matches": 2, "outside_generated_window": 2, "empty": 0}
    timed = {row["line"]: (row["start_ms"], row["end_ms"]) for row in document["line_times"]}
    assert sorted(set(SCHEDULE) - set(timed)) == [14, 21, 27, 28], "the two garbled and the two withheld lines have no time anywhere"
    assert all(start(line) <= begin < finish <= end(line) for line, (begin, finish) in timed.items()), "a line's time lies where the line is spoken in the synthetic talk"
    assert document["transcript_check"]["unchanged"] is True
    assert [(u["start_ms"], u["end_ms"], u["reason"]) for u in document["unassigned"] if u["reason"] == "weak_evidence"] == [(start(29), end(32), "weak_evidence")]
    # what the importer stored says of itself that it is synthetic
    current = Derived(showcase.settings, showcase.runtime.journal, preparation=showcase.runtime.preparation).current(COURSE, RECORDING)
    assert "synthetic" in current["producer"]["tool"] and current["provenance"]["origin"] == "synthetic_fixture" and content.FIXTURE_NOTE in current["provenance"]["note"]


# ---- the state itself --------------------------------------------------------------------------------------------------
def test_the_state_goes_in_through_the_apps_own_doors_once(showcase):
    done = showcase.installed
    assert done["status"] == "installed" and (done["course_id"], done["lecture_id"]) == (COURSE, LECTURE)
    assert done["generation"]["status"] == "imported" and done["anchors"]["status"] == "stored" and done["timing"]["stage"] == "associated"
    assert (done["anchors"]["accepted"], done["anchors"]["rejected_by_verifier"], done["anchors"]["no_candidate"]) == (3, 1, 1)
    journal = showcase.runtime.journal
    imports = [r for r in journal.receipts(kind="derived-import") if r["payload"]["source_id"] == RECORDING]
    assert [r["payload"]["outcome"] for r in imports] == ["imported"], "the generation came in through the importer, which left its receipt"
    receipts = (len(journal.receipts(kind="derived-import")), len(journal.receipts(kind="timing-build")))
    assert receipts[1] >= 1
    stored = inferred_anchors.anchors_path(showcase.settings, COURSE).read_bytes()
    assert json.loads(stored)["producer"] == state.ANCHORS_PRODUCER and "synthetic" in state.ANCHORS_PRODUCER
    # A second call finds everything in place: nothing is imported, stored or built again.
    again = state.install(showcase.settings, now=showcase.runtime.now, journal=journal, preparation=showcase.runtime.preparation)
    assert again["status"] == "unchanged" and again["timing"]["links_revision"] == done["timing"]["links_revision"]
    assert (len(journal.receipts(kind="derived-import")), len(journal.receipts(kind="timing-build"))) == receipts
    assert inferred_anchors.anchors_path(showcase.settings, COURSE).read_bytes() == stored
    assert not (inferred_anchors.anchors_path(showcase.settings, COURSE).parent / "history").exists(), "the file was written once"


def test_any_profile_but_the_fixture_profile_is_refused_before_anything_is_read(showcase, tmp_path):
    for profile in ("local", "live", "pilot"):
        other = dataclasses.replace(showcase.settings, profile=profile, state_dir=tmp_path / profile)
        with pytest.raises(state.FixtureStateError) as refused:
            state.install(other, now="2026-10-06T12:00:00Z")
        assert refused.value.code == "fixture_profile_only"
        assert not (tmp_path / profile).exists(), "nothing was written"


def test_the_state_can_be_installed_without_a_running_app_and_is_then_found_by_one(settings, clock):
    """A command or a script may install it with nothing but the settings and a time; an app started afterwards finds it in place."""
    done = state.install(settings, now="2026-10-06T12:00:00Z")
    assert done["status"] == "installed" and done["installed_at"] == "2026-10-06T12:00:00Z" and done["timing"]["stage"] == "associated"
    runtime = Runtime(settings, clock=clock)
    runtime.startup()
    try:
        assert state.install(settings, now=runtime.now, journal=runtime.journal, preparation=runtime.preparation)["status"] == "unchanged"
        view = runtime.projector.lecture_view(COURSE, LECTURE)
        assert view["timing"]["stage"] == "associated" and view["questions"]["counts"]["agent_inferred"] == 3
        # What the note names is checked, not believed: with the links document gone, the next call builds it again.
        (settings.app_area(COURSE) / "timing-links" / f"{LECTURE}.json").unlink()
        again = state.install(settings, now=runtime.now, journal=runtime.journal, preparation=runtime.preparation)
        assert again["status"] == "installed" and again["generation"]["status"] == "already_stored" and again["anchors"]["status"] == "unchanged"
        assert again["timing"]["links_revision"] == done["timing"]["links_revision"], "the same inputs give the same links"
    finally:
        runtime.journal.close()


def test_a_suggestions_file_somebody_else_stored_is_left_alone(settings, clock):
    runtime = Runtime(settings, clock=clock)
    runtime.startup()
    try:
        document = dict(state.suggestions_document(settings), producer="another-producer (synthetic test)", items=[], no_candidate=[])
        inferred_anchors.store(settings, COURSE, document)
        theirs = inferred_anchors.anchors_path(settings, COURSE).read_bytes()
        done = state.install(settings, now=runtime.now, journal=runtime.journal, preparation=runtime.preparation)
        assert done["anchors"] == {"status": "kept_other_file", "sha256": inferred_anchors.c.sha256_hex(theirs), "producer": "another-producer (synthetic test)"}
        assert inferred_anchors.anchors_path(settings, COURSE).read_bytes() == theirs and done["timing"]["stage"] == "associated"
    finally:
        runtime.journal.close()


def test_the_showcase_is_reachable_through_the_app_as_the_web_client_reads_it(showcase):
    client = TestClient(create_app(showcase.runtime, extra_hosts={"testserver"}))
    served = client.get(f"/api/courses/{COURSE}/lectures/{LECTURE}")
    assert served.status_code == 200
    view = served.json()
    assert [slide["identity"]["label"] for slide in view["slides"]] == [slide["identity"]["label"] for slide in showcase.view["slides"]]
    assert view["questions"]["counts"] == showcase.view["questions"]["counts"] and view["timing"]["stage"] == "associated"
    assert [[(r["start_ms"], r["end_ms"]) for r in slide["ranges"]] for slide in view["slides"]] == [[(r["start_ms"], r["end_ms"]) for r in slide["ranges"]] for slide in showcase.view["slides"]]
    readback = client.get(f"/api/courses/{COURSE}/inferred-anchors").json()
    assert readback["file"]["state"] == "ok" and readback["file"]["question_index_matches"] is True and (readback["accepted"], readback["rejected_by_verifier"]) == (3, 1)
    timing = client.get(f"/api/courses/{COURSE}/timing").json()
    assert {unit["lecture_id"]: unit["stage"] for unit in timing["lectures"]}[LECTURE] == "associated"
    source_map = client.get(f"/api/courses/{COURSE}/lectures/{LECTURE}/source-map").json()
    assert source_map["state"] == "ready" and len(source_map["pages"]) == 14
