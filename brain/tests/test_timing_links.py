"""Timing links (experience repair v2, phase 4, R2-T4 … R2-T13): from generated speech to playable slide ranges.

Everything here is invented: an imaginary baking course, a generated "recording" that is only a list of words with made-up
times, and the synthetic fixture workspace. No speech tool runs and no real course is read. What is proven is the plumbing
and its honesty rules — stages, text alignment, one link per occurrence, the fixed selection rule, staleness, the six
no-range states, annotations before suggestions — and not whether a suggestion is right about a real lecture.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from lecture_brain import alignment as al
from lecture_brain import contracts as c
from lecture_brain import derived as d
from lecture_brain import timing_links as tl
from lecture_brain.annotations import AnnotationStore
from lecture_brain.config import load_settings
from lecture_brain.derived import Derived
from lecture_brain.journal import Journal
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.preparation import Preparation

NOW = "2026-10-06T09:00:00Z"
PLANNER = ("University", "Fixture Brain", "planner-config.yaml")
NO_RANGE_STATES = {"recording_unavailable", "no_range_expected", "audio_unprocessed", "association_not_run", "ambiguous", "not_discussed"}
RANGE_KEYS = {"range_id", "recording", "timebase", "start_ms", "end_ms", "relation", "occurrence_index", "occurrences_total", "support", "method", "origin", "review_state", "quality",
              "why", "evidence", "annotation_id"}

# ---- synthetic material: an imaginary baking course ----------------------------------------------------------------------
DECK = {"source_id": "src-syn-deck", "version_id": "v1-deck", "sha256": "d" * 64}
RECORDING = {"source_id": "src-syn-rec", "version_id": "v1-rec", "sha256": "a" * 64}
TRANSCRIPT = {"source_id": "src-syn-transcript", "version_id": "v1-transcript", "sha256": "c" * 64}
YEAST = ("Yeast fermentation", "Yeast converts sugar into carbon dioxide", "Fermentation temperature controls the rate", "Proofing time doubles the dough volume")
PAGES = {
    1: "Bread science\nWeek four overview",
    2: "\n".join(YEAST[:2]), 3: "\n".join(YEAST[:3]), 4: "\n".join(YEAST),
    5: "Gluten network\nKneading aligns the gluten strands\nHydration changes dough elasticity",
    6: "Oven spring\nSteam delays crust formation\nRapid expansion during the first minutes of baking",
    7: "Cooling and storage\nStarch retrogradation causes staling\nFreezing slows staling of the crumb",
    8: "Sourdough starter\nWild lactobacilli acidify the culture\nA feeding schedule keeps the starter active",
    9: "Homework\nSubmit the laboratory report",
}
ROLES = {1: "structural_title_or_section", 9: "administrative"}
SAID = {
    "yeast": ["Yeast fermentation is where we begin: the yeast converts sugar into carbon dioxide gas.",
              "The fermentation temperature controls the rate, so a warm kitchen speeds the yeast up.",
              "Proofing time matters too: a long proofing doubles the dough volume."],
    "gluten": ["Now the gluten network: kneading aligns the gluten strands into long sheets.",
               "Hydration changes the dough elasticity, a wet dough stretches much further.",
               "Without kneading the gluten strands stay tangled and the network is weak."],
    "chatter": ["Is the microphone working for the people at the back today?",
                "Somebody left a green umbrella here last week, please collect it.",
                "The cafeteria closes early tomorrow, by the way."],
    "oven": ["Oven spring happens early: steam delays the crust formation.",
             "That gives rapid expansion during the first minutes of baking.",
             "If there is no steam the crust sets and the oven spring is lost."],
    "yeast_again": ["Remember that the yeast still converts sugar into carbon dioxide inside the hot loaf.",
                    "So the fermentation rate and the temperature decide how much gas the yeast makes."],
    "cooling": ["After baking comes cooling and storage: starch retrogradation causes staling.",
                "Freezing slows the staling of the crumb, a refrigerator speeds it up.",
                "Storage in paper keeps the crust, storage in plastic softens it."],
}
ORDER = ("yeast", "gluten", "chatter", "oven", "yeast_again", "cooling")
LINES = [line for part in ORDER for line in SAID[part]]  # 17 spoken lines; line numbers are 1-based
LINE_OF = {part: (LINES.index(SAID[part][0]) + 1, LINES.index(SAID[part][-1]) + 1) for part in ORDER}
STEP = 10_000
ANOTHER_LECTURE = ["The ledger records every purchase of flour and butter in the first column.", "Invoices are filed by supplier and month in the grey cabinet.",
                   "A trial balance compares the debit and credit totals before closing.", "Depreciation spreads the cost of the mixer across ten years.",
                   "The quarterly tax return is prepared from the sales journal.", "Petty cash is counted on Monday morning by two people."]


def source_map(*, groups=((2, 3, 4),), roles=ROLES, revision="maprev0000000001", pages=PAGES) -> dict:
    """A source map in the shape ``sourcemap.py`` stores (only the fields a consumer reads). Labeled synthetic."""
    grouped = {n: tuple(group) for group in groups for n in group}
    page_rows, slides, done = [], [], set()
    for n in sorted(pages):
        run = grouped.get(n, (n,))
        logical_id = f"ls-syn-p{run[0]}" + (f"-{run[-1]}" if len(run) > 1 else "")
        role = roles.get(n, "instructional")
        page_rows.append({"page": n, "status": "ok", "title": pages[n].splitlines()[0], "text": pages[n], "logical_slide_id": logical_id, "build_index": run.index(n) + 1, "build_count": len(run),
                          "role": {"role": role, "confidence": 0.9, "uncertain": False, "evidence": ["synthetic"], "source": "detector", "forced_requirements": role not in tl.NO_FORCED_ROLES}})
        if run in done:
            continue
        done.add(run)
        slides.append({"logical_slide_id": logical_id, "ordinal": len(slides) + 1, "kind": "incremental_build" if len(run) > 1 else "single", "grouping": "inferred" if len(run) > 1 else "none",
                       "confidence": "high" if len(run) > 1 else None, "pages": list(run), "representative_page": run[-1], "title": pages[run[-1]].splitlines()[0],
                       "role": roles.get(run[-1], "instructional"), "evidence": [{"signals": ["same_heading", "ordered_text_containment"]}] if len(run) > 1 else [], "overrides": []})
    return {"contract": "source-map/1", "map_revision": revision, "source": dict(DECK), "page_index_base": 1, "page_count": len(pages), "pages": page_rows, "logical_slides": slides,
            "overrides": {"revision": 0, "history": []}}


def generation(lines, *, steps=None, name="sp-syn-0001", duration_ms=None, unresolved=()) -> dict:
    """What ``Derived.current`` returns for one recording, made up: every sentence takes its step, words evenly inside it."""
    steps = steps or [STEP] * len(lines)
    segments, cursor = [], 0
    for index, (text, step) in enumerate(zip(lines, steps)):
        words = text.split()
        each = (step - 400) // len(words)
        timed = [{"start_ms": cursor + k * each, "end_ms": cursor + (k + 1) * each - 20, "text": word, "probability": 0.9} for k, word in enumerate(words)]
        segments.append({"index": index, "start_ms": cursor, "end_ms": cursor + len(words) * each, "text": text, "words": timed})
        cursor += step
    duration = duration_ms or cursor
    unresolved = [{"start_ms": a, "end_ms": b, "reason": "repetition_check"} for a, b in unresolved]
    window = {"start_ms": 0, "end_ms": cursor}
    covered = d.covered_intervals(window, unresolved)
    resolved = sum(i["end_ms"] - i["start_ms"] for i in covered)
    return {"course_id": "syn101", "source_id": RECORDING["source_id"], "generation": name, "state": "current", "created_at": NOW, "recording": dict(RECORDING, bytes=1000),
            "producer": {"tool": "synthetic-words", "tool_version": "0", "model": "none", "language": "en", "parameters_sha256": "b" * 64}, "window": window, "duration_ms": duration,
            "coverage_fraction": resolved / duration, "covers_whole_recording": not unresolved and cursor >= duration - 500, "covered_intervals": covered, "unresolved_intervals": unresolved,
            "unresolved_seconds": (cursor - resolved) / 1000, "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [], "segments": segments}


def material(*, lines=LINES, spoken=None, steps=None, pairings=(), smap=None, generated="spoken", transcript="one", duration_ms=None, unresolved=(), recordings=None) -> dict:
    """What ``gather`` hands to ``compose`` for one lecture, made up."""
    if generated == "spoken":
        generated = generation(spoken or lines, steps=steps, duration_ms=duration_ms, unresolved=unresolved)
    transcript_block = {"state": transcript, "source_id": None, "version_id": None, "sha256": None, "lines": []}
    if transcript == "one":
        transcript_block = dict(TRANSCRIPT, state="one", lines=list(lines))
    recording = dict(RECORDING, filename="Synthetic baking lecture.m4a", duration_ms=(generated or {}).get("duration_ms") or duration_ms or len(lines) * STEP, state="registered_readable",
                     readable=True, generated=generated)
    return {"course_id": "syn101", "lecture_id": "lecture-01", "title": "Synthetic baking lecture", "deck": dict(DECK), "slides": tl.slides_from_map(smap or source_map()),
            "transcript": transcript_block, "pairings": [dict(p) for p in pairings], "pairing_notes": [], "recordings": [recording] if recordings is None else recordings}


def everything(doc) -> list[dict]:
    return sorted([*doc["links"], *doc["candidates"]], key=lambda link: (link["start_ms"], link["end_ms"]))


def of_pages(doc, pages, *, key="links", origin="pipeline") -> list[dict]:
    return [link for link in doc[key] if link["support"]["pages"] == list(pages) and link["origin"] == origin]


# ---- stage f: one candidate link per occurrence --------------------------------------------------------------------------
def test_every_occurrence_is_one_link_and_two_visits_stay_two_links_with_the_time_between_them_in_neither():
    doc = tl.compose(material(), now=NOW)
    record = doc["recordings"][0]
    assert record["stage"] == "associated" and record["stages"]["association"]["state"] == "run"
    assert record["stages"]["text_alignment"]["state"] == "accepted" and record["stages"]["windows"]["basis"] == "timed_transcript_lines"
    assert record["stages"]["windows"]["count"] == len(LINES)
    yeast = sorted([link for link in everything(doc) if link["support"]["pages"] == [2, 3, 4] and link["origin"] == "pipeline"], key=lambda link: link["start_ms"])
    assert len(yeast) == 2, "the slide the lecture returned to has two occurrences"
    first, second = yeast
    assert first["end_ms"] <= 3 * STEP and second["start_ms"] >= 12 * STEP  # lines 1-3 and lines 13-14
    assert first["end_ms"] < second["start_ms"] and first["range_id"] != second["range_id"]
    assert (first["evidence"]["occurrence"], second["evidence"]["occurrence"]) == ({"index": 1, "of": 2}, {"index": 2, "of": 2})
    # Nothing overlaps: the minutes between two visits belong to neither.
    pipeline = [link for link in everything(doc) if link["origin"] == "pipeline"]
    assert all(a["end_ms"] <= b["start_ms"] for a, b in itertools.pairwise(pipeline))
    # The digression is nobody's: it is listed as unassigned with its reason, and no link covers it.
    chatter_start, chatter_end = (LINE_OF["chatter"][0] - 1) * STEP, LINE_OF["chatter"][1] * STEP
    assert any(u["reason"] == "weak_evidence" and u["start_ms"] >= chatter_start and u["end_ms"] <= chatter_end for u in doc["unassigned"])
    assert not any(link["start_ms"] < chatter_end - 500 and link["end_ms"] > chatter_start + 500 for link in pipeline)
    # The slide nobody spoke about has neither a link nor a candidate; and ranges are as long as the talk was, not equal shares.
    assert not [link for link in everything(doc) if 8 in link["support"]["pages"]]
    assert len({link["end_ms"] - link["start_ms"] for link in pipeline}) > 1
    assert {u["recording_source_id"] for u in doc["unassigned"]} == {RECORDING["source_id"]}


def test_a_link_binds_recording_time_slide_method_and_three_separate_qualities_and_never_says_displayed():
    doc = tl.compose(material(), now=NOW)
    assert doc["links"], "the synthetic lecture yields shown links"
    for link in everything(doc):
        assert link["recording"] == RECORDING and link["timebase"] == "original_source_start"
        assert 0 <= link["start_ms"] < link["end_ms"] <= len(LINES) * STEP
        assert link["deck"] == DECK and link["relation"] == "discussed_during" and link["annotation_id"] is None
        assert set(link["quality"]) == {"acoustic", "association", "group_mapping"}
        assert all(set(link["quality"][name]) == {"state", "basis"} and link["quality"][name]["basis"] for name in link["quality"])
        assert link["quality"]["acoustic"]["state"] == "generated_unreviewed" and link["review_state"] == "generated"
        assert not {"confidence", "score", "quality_score"} & set(link)  # no combined figure exists
        if link["origin"] == "pipeline":
            assert link["quality"]["association"]["state"] == "candidate"
            assert link["method"] == {"name": "lexical-sequence", "version": "2"} == dict(zip(("name", "version"), al.SEQUENCE_METHOD.split("/")))
            assert link["logical_slide"]["map_revision"] == "maprev0000000001" and link["logical_slide"]["id"].startswith("ls-syn-p")
            assert link["evidence"]["shape"] in {"sustained_clear", "brief_or_close"} and link["evidence"]["terms"]
            assert set(link["evidence"]["baseline"]) >= {"same_slide", "other_slide", "unassigned"}
    assert len({link["range_id"] for link in everything(doc)}) == len(everything(doc))


# What a learner reads under "Qualities" is the Brain's sentence, verbatim. An identifier there (a generation id, a digest, a
# method name with its version, a field name) is noise to them; the identifiers stay in the structured fields beside it.
_IDENTIFIER = re.compile(r"sp-[a-z0-9]+-|[0-9a-f]{12,}|[a-z]+(?:_[a-z]+)+|[a-z-]+/\d+|@")


def test_the_quality_sentences_are_plain_words_and_the_identifiers_stay_in_the_structured_fields():
    stated = [pairing([6, 7], [LINE_OF["oven"]]), pairing([5], [LINE_OF["gluten"]], basis="course_locator")]
    produced = dict(generation(LINES), producer={"tool": "faster-whisper", "tool_version": "1.2.1", "model": "Systran/faster-whisper-base.en@3d3d5dee26484f91867d81cb899cfcf72b96be6c",
                                                 "language": "en", "parameters_sha256": "b" * 64})
    doc = tl.compose(material(pairings=stated, generated=produced), now=NOW)
    links = everything(doc)
    assert {link["origin"] for link in links} == {"pipeline", "reviewed_source_map"} and any(len(link["support"]["pages"]) > 1 and link["origin"] == "pipeline" for link in links)
    for link in links:
        for name, facet in link["quality"].items():
            assert not _IDENTIFIER.search(facet["basis"]), (name, facet["basis"])
        assert not _IDENTIFIER.search(link["why"])
        acoustic = link["quality"]["acoustic"]["basis"]
        assert "faster-whisper, model base.en" in acoustic and "obody has listened" in acoustic
    # nothing was dropped: the same facts are still data
    assert doc["recordings"][0]["stages"]["generated"]["generation"] == "sp-syn-0001"
    assert all(link["method"]["name"] and link["method"]["version"] for link in links)
    hinted = [link for link in links if link["origin"] == "pipeline" and link["evidence"]["hint_bases"]]
    assert hinted and all("the course's study map" in link["quality"]["association"]["basis"] or "source locator" in link["quality"]["association"]["basis"] for link in hinted)
    segments_only = tl.compose(material(transcript="none", generated=produced), now=NOW)
    assert all("generated segments" in link["quality"]["acoustic"]["basis"] and not _IDENTIFIER.search(link["quality"]["acoustic"]["basis"]) for link in everything(segments_only))


def test_a_build_group_link_is_group_level_and_has_no_time_per_build():
    doc = tl.compose(material(), now=NOW)
    (group, *_) = of_pages(doc, [2, 3, 4])
    assert group["support"] == {"scope": "build_group", "pages": [2, 3, 4], "builds": None, "group_kind": "incremental_build"}
    assert group["quality"]["group_mapping"]["state"] == "generated" and "inferred" in group["quality"]["group_mapping"]["basis"]
    (single, *_) = of_pages(doc, [5])
    assert single["support"]["scope"] == "page" and single["support"]["builds"] is None
    assert not any(key in link for link in everything(doc) for key in ("builds", "build_ranges", "per_build"))


def test_a_title_page_is_matched_like_any_other_page_and_its_supported_interval_is_a_link():
    """R2-T9: a no-forced-requirement role lowers a prior and excludes nothing."""
    opening = ["Welcome to bread science: this is the week four overview of bread science.", "The week four overview lists everything we bake in bread science this week."]
    doc = tl.compose(material(lines=[*opening, *LINES]), now=NOW)
    title = of_pages(doc, [1])
    assert title and title[0]["start_ms"] < STEP and title[0]["relation"] == "discussed_during" and title[0]["evidence"]["role"] == "structural_title_or_section"


# ---- stage b: text alignment ---------------------------------------------------------------------------------------------
def test_times_reach_transcript_lines_only_through_the_accepted_mapping_and_an_unaligned_line_never_gets_one():
    spoken = list(LINES)
    spoken[4] = "Meanwhile somebody opened every window because the room was getting far too warm."  # line 5 of the transcript was said in other words
    doc = tl.compose(material(spoken=spoken), now=NOW)
    mapping = doc["recordings"][0]["stages"]["text_alignment"]
    assert mapping["state"] == "accepted" and mapping["reason"] is None
    assert mapping["method"] == {"name": "anchored-token-alignment", "version": "2"} and mapping["transcript"] == TRANSCRIPT
    assert mapping["generation"] == "sp-syn-0001" and mapping["lines_total"] == len(LINES) and mapping["lines_aligned"] == len(LINES) - 1
    rows = {row["line"]: row for row in mapping["lines"]}
    assert rows[5]["status"] != "aligned" and rows[5]["start_ms"] is None and rows[5]["end_ms"] is None and rows[5]["total"] > 0
    for number, row in rows.items():
        if row["status"] == "aligned":
            assert (number - 1) * STEP <= row["start_ms"] < row["end_ms"] <= number * STEP and row["matched"] >= 2
        else:
            assert row["start_ms"] is None and row["end_ms"] is None
    aligned = [rows[n] for n in sorted(rows) if rows[n]["status"] == "aligned"]
    assert all(a["end_ms"] <= b["start_ms"] for a, b in itertools.pairwise(aligned))  # times never run backwards against line order
    # Line 5 has no time anywhere in the document: not in the per-line table, not as a window, not as a line time.
    assert 5 not in {row["line"] for row in doc["line_times"]} and len(doc["line_times"]) == len(LINES) - 1
    assert all(set(row) == {"recording_source_id", "transcript_source_id", "line", "start_ms", "end_ms", "matched", "total"} for row in doc["line_times"])
    assert doc["recordings"][0]["stages"]["windows"]["count"] == len(LINES) - 1
    # The transcript is an input: the document names its bytes and carries none of its wording as a rewrite.
    assert doc["inputs"]["transcript"] == TRANSCRIPT and doc["inputs"]["text_alignment_version"] == al.TEXT_METHOD


def test_a_generated_text_that_does_not_correspond_is_refused_as_a_whole_and_matching_falls_back_to_segments_and_says_so():
    doc = tl.compose(material(lines=ANOTHER_LECTURE, spoken=LINES), now=NOW)  # the unit's transcript is of some other lecture
    stages = doc["recordings"][0]["stages"]
    assert stages["text_alignment"]["state"] == "refused" and stages["text_alignment"]["reason"] and stages["text_alignment"]["reason_code"]
    assert stages["text_alignment"]["lines_aligned"] == 0 and stages["text_alignment"]["lines"] == [] and doc["line_times"] == []
    assert stages["windows"]["basis"] == "generated_segments" and "refused" in stages["windows"]["why"]
    assert stages["hints"]["used"] == 0
    assert doc["links"], "the recording is still matched against the slides, from the generated segments"
    assert all(link["evidence"]["transcript_lines"] == [] for link in everything(doc))
    assert all("generated segments" in link["quality"]["acoustic"]["basis"] for link in everything(doc) if link["origin"] == "pipeline")


@pytest.mark.parametrize("transcript,state", [("none", "no_transcript"), ("several", "not_run")])
def test_without_exactly_one_original_transcript_no_line_is_timed_and_the_reason_is_stated(transcript, state):
    doc = tl.compose(material(transcript=transcript), now=NOW)
    stages = doc["recordings"][0]["stages"]
    assert stages["text_alignment"]["state"] == state and doc["line_times"] == [] and stages["windows"]["basis"] == "generated_segments"
    assert (stages["text_alignment"]["reason_code"] == "several_transcripts") == (transcript == "several")
    assert doc["inputs"]["transcript"] is None and doc["links"]


def test_a_recording_without_generated_timing_is_audio_unprocessed_and_yields_nothing():
    doc = tl.compose(material(generated=None), now=NOW)
    record = doc["recordings"][0]
    assert record["stage"] == "audio_unprocessed" and record["stages"]["generated"] == {"state": "none", "generation": None}
    assert record["stages"]["association"]["state"] == "not_run" and record["stages"]["association"]["cause"] == "no_generated_timing"
    assert record["stages"]["text_alignment"]["state"] == "not_run"
    assert doc["links"] == [] and doc["candidates"] == [] and doc["unassigned"] == [] and doc["inputs"]["recordings"] == [dict(RECORDING, generation=None)]


def test_a_lecture_without_slide_text_or_without_a_recording_states_that_stage():
    no_deck = material()
    no_deck.update(deck=None, slides=tl.slides_from_pages([]))
    doc = tl.compose(no_deck, now=NOW)
    assert doc["recordings"][0]["stage"] == "processed" and doc["recordings"][0]["stages"]["association"] == {
        "state": "not_run", "cause": "no_slide_text", "method": {"name": "lexical-sequence", "version": "2"}, "occurrences": 0, "unassigned": 0, "unassigned_ms": 0}
    assert doc["links"] == [] and doc["inputs"]["map_revision"] is None and doc["inputs"]["deck"] is None
    nothing = tl.compose(material(recordings=[]), now=NOW)
    assert nothing["recordings"] == [] and nothing["links"] == [] and nothing["inputs"]["recordings"] == []


def test_pages_without_a_source_map_are_one_slide_each_and_say_so():
    plain = material()
    plain["slides"] = tl.slides_from_pages([PAGES[n] for n in sorted(PAGES)])
    doc = tl.compose(plain, now=NOW)
    assert doc["inputs"]["map_revision"] is None and doc["recordings"][0]["stages"]["slides"] == {"basis": "page_per_slide", "count": 9, "map_revision": None}
    assert doc["links"] and all(link["support"]["scope"] == "page" and len(link["support"]["pages"]) == 1 for link in everything(doc) if link["origin"] == "pipeline")
    assert all(link["quality"]["group_mapping"]["state"] == "none" for link in everything(doc) if link["origin"] == "pipeline")


# ---- stages e and g: what the course itself states ----------------------------------------------------------------------
def pairing(pages, line_ranges, basis="course_study_map", **extra) -> dict:
    return dict({"pages": list(pages), "line_ranges": [list(r) for r in line_ranges], "basis": basis, "label": "synthetic row", "refs": [{"row": 1}]}, **extra)


def test_a_course_stated_pairing_becomes_one_section_link_per_timed_stretch_and_only_where_its_lines_have_times():
    spoken = list(LINES)
    spoken[10] = "Then someone asked whether the exam would cover the history of the bakery guilds."  # line 11 was said in other words: it gets no time
    stated = [pairing([6, 7], [LINE_OF["oven"], LINE_OF["cooling"]]),          # lines 10-12 and 15-17: two stretches, the return to the yeast lies between them
              pairing([8], [[40, 60]]),                                         # lines the transcript does not have: nothing to time
              pairing([5], [LINE_OF["gluten"]], basis="course_locator")]
    doc = tl.compose(material(spoken=spoken, pairings=stated), now=NOW)
    sections = sorted(of_pages(doc, [6, 7], origin="reviewed_source_map"), key=lambda link: link["start_ms"])
    assert len(sections) == 2, "one link per contiguous timed stretch; the 20 seconds about another slide between them belong to neither"
    rows = {row["line"]: row for row in doc["recordings"][0]["stages"]["text_alignment"]["lines"]}
    first, second = sections
    assert rows[11]["status"] != "aligned" and rows[10]["status"] == rows[12]["status"] == "aligned"
    assert (first["start_ms"], first["end_ms"]) == (rows[10]["start_ms"], rows[12]["end_ms"])  # measured ends of timed lines; the untimed line 11 moved no boundary
    assert (second["start_ms"], second["end_ms"]) == (rows[15]["start_ms"], rows[17]["end_ms"])
    for link in sections:
        assert link["support"] == {"scope": "section", "pages": [6, 7], "builds": None, "group_kind": None}  # the stated pages, whole: no share of the time per page
        assert link["method"] == {"name": "course-stated-lines", "version": "1"} and link["relation"] == "discussed_during" and link["review_state"] == "generated"
        assert link["quality"]["association"]["state"] == "course_stated" and link["logical_slide"] is None and link["selection"]["shown"] is True
    assert first["evidence"]["transcript_lines"] == [[10, 12]] and first["evidence"]["lines_timed"] == 2 and first["evidence"]["lines_spoken"] == 3
    assert not of_pages(doc, [8], origin="reviewed_source_map")
    assert len(of_pages(doc, [5], origin="reviewed_source_map")) == 1
    stage = doc["recordings"][0]["stages"]["course_stated"]
    assert stage == {"pairings": 3, "pairings_timed": 2, "links": 3, "pairings_without_timed_lines": 1}


def test_a_stated_line_range_with_a_long_untimed_stretch_inside_is_two_links_and_the_gap_belongs_to_neither():
    spoken, steps = list(LINES), [STEP] * len(LINES)
    spoken[4] = "For the next while the projector was broken and everybody waited for a technician to arrive and repair it."  # line 5: other words, 45 seconds
    steps[4] = 45_000
    doc = tl.compose(material(spoken=spoken, steps=steps, pairings=[pairing([5], [LINE_OF["gluten"]])]), now=NOW)
    rows = {row["line"]: row for row in doc["recordings"][0]["stages"]["text_alignment"]["lines"]}
    assert rows[5]["status"] != "aligned" and rows[6]["start_ms"] - rows[4]["end_ms"] > tl.SECTION_RULE["max_gap_ms"] == 30_000
    first, second = sorted(of_pages(doc, [5], origin="reviewed_source_map"), key=lambda link: link["start_ms"])
    assert (first["start_ms"], first["end_ms"], first["evidence"]["transcript_lines"]) == (rows[4]["start_ms"], rows[4]["end_ms"], [[4, 4]])
    assert (second["start_ms"], second["end_ms"], second["evidence"]["transcript_lines"]) == (rows[6]["start_ms"], rows[6]["end_ms"], [[6, 6]])
    assert doc["section_rule"] == tl.SECTION_RULE and doc["recordings"][0]["stages"]["course_stated"]["links"] == 2


def test_two_statements_that_time_the_same_stretch_for_the_same_pages_are_one_link():
    """A study-map row and a catalog locator often state overlapping line ranges. Where they give the same pages the
    same stretch of audio, the learner gets one range that names both statements, not the same range twice."""
    row = pairing([5], [LINE_OF["gluten"]], label="row three")
    locator = pairing([5], [LINE_OF["gluten"], [40, 60]], basis="course_locator", label="SYN-Q2", refs=[{"question_id": "SYN-Q2"}])  # its second range names lines the file lacks
    wider = pairing([5, 6], [LINE_OF["gluten"]], label="row four")  # other pages: another statement, another link
    doc = tl.compose(material(pairings=[row, locator, wider]), now=NOW)
    (one,) = of_pages(doc, [5], origin="reviewed_source_map")
    assert one["evidence"]["bases"] == ["course_locator", "course_study_map"] and one["evidence"]["labels"] == ["row three", "SYN-Q2"]
    assert one["evidence"]["stated_line_ranges"] == [list(LINE_OF["gluten"]), [40, 60]] and one["evidence"]["transcript_lines"] == [list(LINE_OF["gluten"])]
    assert len(of_pages(doc, [5, 6], origin="reviewed_source_map")) == 1
    assert doc["recordings"][0]["stages"]["course_stated"] == {"pairings": 3, "pairings_timed": 3, "links": 2, "pairings_without_timed_lines": 0}
    assert len({link["range_id"] for link in doc["links"]}) == len(doc["links"])
    # On a page, two sections with the same stretch are shown once: the statement that names the fewest pages. (Page 8 is
    # never spoken about, so it has no suggestion of its own; on page 5 the suggestion with these very ends stands for both.)
    result = enriched(material(pairings=[pairing([8], [LINE_OF["gluten"]], label="row three"), pairing([6, 8], [LINE_OF["gluten"]], label="row four")]))
    sections = [r for r in slide(result, 8)["ranges"] if r["support"]["scope"] == "section"]
    assert len(sections) == 1 and sections[0]["support"]["pages"] == [8] and (sections[0]["occurrence_index"], sections[0]["occurrences_total"]) == (1, 1)
    assert [r["support"]["pages"] for r in slide(result, 6)["ranges"] if r["support"]["scope"] == "section"] == [[6, 8]]
    assert result["timing"]["summary"]["ranges"] == len({r["range_id"] for row_ in result["slides"] for r in row_["ranges"]})


def test_pairings_are_deduplicated_and_reach_the_engine_only_with_line_windows():
    twice = [pairing([5], [LINE_OF["gluten"]]), pairing([5], [LINE_OF["gluten"]], basis="course_locator", refs=[{"question_id": "SYN-Q1"}])]
    doc = tl.compose(material(pairings=twice), now=NOW)
    hints = doc["recordings"][0]["stages"]["hints"]
    assert hints["stated"] == 2 and hints["distinct"] == 1 and hints["used"] == 1 and hints["usable"] is True
    assert len(of_pages(doc, [5], origin="reviewed_source_map")) == 1
    assert of_pages(doc, [5], origin="reviewed_source_map")[0]["evidence"]["bases"] == ["course_locator", "course_study_map"]
    assert doc["inputs"]["hints_digest"] == tl.compose(material(pairings=twice[:1] + [dict(twice[1])]), now=NOW)["inputs"]["hints_digest"]
    assert doc["inputs"]["hints_digest"] != tl.compose(material(), now=NOW)["inputs"]["hints_digest"]
    refused = tl.compose(material(lines=ANOTHER_LECTURE, spoken=LINES, pairings=twice), now=NOW)
    hints = refused["recordings"][0]["stages"]["hints"]
    assert hints["usable"] is False and hints["used"] == 0 and "line" in hints["why"]
    assert not [link for link in refused["links"] if link["origin"] == "reviewed_source_map"]  # no line has a time, so no section has one


# ---- stage h: the selection rule -----------------------------------------------------------------------------------------
def candidate(duration_ms, same_slide, *, slide_id="ls-x", lines=None) -> dict:
    return {"start_ms": 1000, "end_ms": 1000 + duration_ms, "logical_slide": {"id": slide_id, "map_revision": "m"}, "support": {"scope": "page", "pages": [3], "builds": None},
            "evidence": {"baseline": {"same_slide": same_slide, "other_slide": 0.0, "unassigned": 1 - same_slide}, "transcript_lines": [lines] if lines else []}}


def test_the_selection_rule_is_fixed_stated_and_exact_at_its_boundaries():
    assert tl.SELECTION["version"] == "selection/1" and tl.SELECTION["min_duration_ms"] == 8000 and tl.SELECTION["min_baseline_same_slide"] == 0.5
    assert tl.select(candidate(8000, 0.5), [])["shown"] is True
    assert tl.select(candidate(7999, 1.0), [])["shown"] is False                 # too short, however well the baseline agrees
    assert tl.select(candidate(8000, 0.4999), [])["shown"] is False               # long enough, the baseline lands elsewhere
    assert tl.select(candidate(600_000, 0.0), [])["shown"] is False
    inside = [{"pages": [3, 4], "line_ranges": [[20, 40]], "slide_ids": ["ls-x"], "basis": "course_study_map"}]
    assert tl.select(candidate(8000, 0.0, lines=[20, 40]), inside)["shown"] is True      # inside a course-stated pairing that names this slide
    assert tl.select(candidate(7999, 0.0, lines=[20, 40]), inside)["shown"] is False     # … and still too short
    assert tl.select(candidate(8000, 0.0, lines=[19, 40]), inside)["shown"] is False     # one line outside the stated range
    assert tl.select(candidate(8000, 0.0, lines=[20, 40], slide_id="ls-other"), inside)["shown"] is False  # the pairing names another slide
    assert tl.select(candidate(8000, 0.0), inside)["shown"] is False                     # windows without line numbers cannot lie inside a pairing
    decision = tl.select(candidate(9000, 0.25, lines=[21, 22]), inside)
    assert decision == {"shown": True, "rule": "selection/1", "duration_ms": 9000, "long_enough": True, "baseline_same_slide": 0.25, "baseline_agrees": False,
                        "inside_course_stated_pairing": True}


def test_what_is_shown_and_what_stays_a_candidate_follows_the_rule_recorded_in_the_document():
    steps = [STEP] * len(LINES)
    for line in range(LINE_OF["oven"][0], LINE_OF["oven"][1] + 1):
        steps[line - 1] = 2_500  # the oven slide is spoken about for 7.5 seconds in all
    doc = tl.compose(material(steps=steps), now=NOW)
    assert doc["selection"] == tl.SELECTION and doc["inputs"]["selection_version"] == "selection/1"
    oven = [link for link in everything(doc) if link["support"]["pages"] == [6]]
    assert len(oven) == 1 and oven[0] in doc["candidates"] and oven[0]["selection"]["shown"] is False and oven[0]["selection"]["long_enough"] is False
    for link in doc["links"]:
        assert link["selection"]["shown"] is True
    for link in doc["candidates"]:
        assert link["selection"]["shown"] is False and link["origin"] == "pipeline"
    for link in everything(doc):
        if link["origin"] == "pipeline":
            assert link["selection"] == tl.select(link, [])
    stage = doc["recordings"][0]["stages"]["selection"]
    assert stage == {"rule": "selection/1", "shown": len(of_pages_all(doc, "links")), "candidates": len(doc["candidates"])}


def of_pages_all(doc, key) -> list[dict]:
    return [link for link in doc[key] if link["origin"] == "pipeline"]


# ---- the document ---------------------------------------------------------------------------------------------------------
def test_the_document_names_its_inputs_and_carries_both_measured_summaries():
    doc = tl.compose(material(pairings=[pairing([5], [LINE_OF["gluten"]])]), now=NOW)
    assert doc["contract"] == "timing-links/1" and doc["builder_version"] == tl.BUILDER_VERSION and doc["built_at"] == NOW
    assert (doc["course_id"], doc["lecture_id"]) == ("syn101", "lecture-01")
    assert set(doc["inputs"]) == {"deck", "map_revision", "transcript", "recordings", "text_alignment_version", "method_versions", "hints_digest", "selection_version"}
    assert doc["inputs"]["recordings"] == [dict(RECORDING, generation="sp-syn-0001")] and doc["inputs"]["deck"] == DECK and doc["inputs"]["map_revision"] == "maprev0000000001"
    assert doc["inputs"]["method_versions"] == {"alignment": al.ALIGNMENT_VERSION, "sequence": al.SEQUENCE_METHOD, "baseline": al.BASELINE_METHOD, "course_stated": "course-stated-lines/1",
                                                "builder": tl.BUILDER_VERSION}
    summary = doc["recordings"][0]["summaries"]
    assert set(summary) == {"sequence", "baseline", "agreement"}
    assert summary["sequence"]["method"] == al.SEQUENCE_METHOD and summary["baseline"]["method"] == al.BASELINE_METHOD
    assert summary["sequence"]["windows"] == summary["baseline"]["windows"] == len(LINES)  # the same windows for both
    for name in ("sequence", "baseline"):
        assert summary[name]["assigned"] + summary[name]["unassigned"] == len(LINES) and summary[name]["slides"] == 7
    assert set(summary["agreement"]) == {"same_slide", "different_slides", "sequence_only", "baseline_only"}
    assert len(doc["links_revision"]) == 64


def test_the_document_is_deterministic_and_its_revision_does_not_depend_on_the_clock():
    first = tl.compose(material(pairings=[pairing([6, 7], [LINE_OF["oven"]])]), now=NOW)
    again = tl.compose(material(pairings=[pairing([6, 7], [LINE_OF["oven"]])]), now=NOW)
    assert c.dump_json(first) == c.dump_json(again)
    later = tl.compose(material(pairings=[pairing([6, 7], [LINE_OF["oven"]])]), now="2027-01-01T00:00:00Z")
    assert later["links_revision"] == first["links_revision"] and later["built_at"] != first["built_at"]
    assert tl.compose(material(), now=NOW)["links_revision"] != first["links_revision"]


# ---- currentness ----------------------------------------------------------------------------------------------------------
def test_a_document_is_current_only_for_its_inputs_and_says_which_one_differs():
    doc = tl.compose(material(), now=NOW)
    same = tl.evaluate(doc, copy.deepcopy(doc["inputs"]))
    assert same["state"] == "current" and same["differs"] == [] and same["stale_recordings"] == [] and same["links"] == doc["links"]
    changes = {
        "recording_sha256": lambda i: i["recordings"][0].update(sha256="e" * 64),
        "generation": lambda i: i["recordings"][0].update(generation="sp-syn-0002"),
        "transcript": lambda i: i["transcript"].update(sha256="f" * 64),
        "text_alignment_version": lambda i: i.update(text_alignment_version="anchored-token-alignment/3"),
        "map_revision": lambda i: i.update(map_revision="maprev0000000002"),
        "deck": lambda i: i["deck"].update(sha256="9" * 64),
        "method_versions": lambda i: i["method_versions"].update(sequence="lexical-sequence/3"),
        "hints_digest": lambda i: i.update(hints_digest="0" * 64),
        "selection_version": lambda i: i.update(selection_version="selection/2"),
    }
    for name, change in changes.items():
        now = copy.deepcopy(doc["inputs"])
        change(now)
        stale = tl.evaluate(doc, now)
        assert stale["state"] == "stale" and stale["differs"] == [name], name
        assert stale["links"] == [] and stale["candidates"] == [] and stale["line_times"] == [], name  # a stale document yields no ranges and no line times
        assert stale["withheld"] == {"links": len(doc["links"]), "candidates": len(doc["candidates"])}
        assert stale["stale_recordings"] == [RECORDING["source_id"]]
    assert tl.evaluate(None, doc["inputs"])["state"] == "missing"
    gone = copy.deepcopy(doc["inputs"])
    gone["recordings"] = []
    assert tl.evaluate(doc, gone)["differs"] == ["recordings"]


# ---- enrich: ranges, the six states, the timing block --------------------------------------------------------------------
def view(*, pages=9, recordings="one", sessions="one", duration_ms=None) -> dict:
    """The parts of ``Projector.lecture_view`` this enricher reads, made up."""
    rows = [] if recordings == "none" else [dict(RECORDING, filename="Synthetic baking lecture.m4a", state="registered_readable", duration_ms=duration_ms or len(LINES) * STEP)]
    if recordings == "unreadable":
        rows[0]["state"] = "registered_missing_on_disk"
    return {"course_id": "syn101", "lecture_id": "lecture-01", "deck": dict(DECK), "recordings": rows,
            "sessions": [] if sessions == "none" else [{"session_id": "2026-09-01", "state": "transcript_and_recording"}],
            "slides": [{"page": n, "title": PAGES[n].splitlines()[0], "occurrences": [], "transcript_ranges": []} for n in range(1, pages + 1)]}


def enriched(mat=None, *, smap=None, the_view=None, links="built", generated="from_material", annotations=None) -> dict:
    mat = mat or material(smap=smap)
    doc = tl.compose(mat, now=NOW)
    if links == "built":
        links = tl.evaluate(doc, copy.deepcopy(doc["inputs"]))
    if generated == "from_material":
        generated = {r["source_id"]: r["generated"] for r in mat["recordings"]}
    return tl.enrich(the_view or view(), source_map=smap or source_map(), links=links, generated=generated, annotations=annotations)


def slide(result, page) -> dict:
    return result["slides"][page - 1]


def assert_exactly_one_of_ranges_or_state(result):
    for row in result["slides"]:
        assert (row["no_range"] is None) == bool(row["ranges"]), row["page"]
        if row["no_range"] is not None:
            assert set(row["no_range"]) == {"state", "text", "detail"} and row["no_range"]["state"] in NO_RANGE_STATES and row["no_range"]["text"]
        for item in row["ranges"]:
            assert set(item) == RANGE_KEYS and set(item["support"]) == {"scope", "pages", "builds"} and set(item["evidence"]) == {"transcript_lines", "terms", "shape"}
            assert set(item["quality"]) == {"acoustic", "association", "group_mapping"} and item["start_ms"] < item["end_ms"]
        starts = [item["start_ms"] for item in row["ranges"] if item["annotation_id"] is None]
        assert starts == sorted(starts)


def test_ranges_of_a_page_are_its_logical_slides_links_earliest_first_with_occurrence_numbers():
    result = enriched()
    assert_exactly_one_of_ranges_or_state(result)
    for page in (2, 3, 4):  # every build of the group shows the same two group-level ranges; no build has a range of its own
        ranges = slide(result, page)["ranges"]
        assert [(r["occurrence_index"], r["occurrences_total"]) for r in ranges] == [(1, 2), (2, 2)]
        assert all(r["support"] == {"scope": "build_group", "pages": [2, 3, 4], "builds": None} for r in ranges)
        assert [(r["range_id"], r["start_ms"], r["end_ms"]) for r in ranges] == [(r["range_id"], r["start_ms"], r["end_ms"]) for r in slide(result, 2)["ranges"]]
    (gluten,) = slide(result, 5)["ranges"]
    assert gluten["origin"] == "pipeline" and gluten["review_state"] == "generated" and gluten["annotation_id"] is None and gluten["relation"] == "discussed_during"
    assert gluten["method"] == {"name": "lexical-sequence", "version": "2"} and gluten["evidence"]["transcript_lines"] == [list(LINE_OF["gluten"])]
    assert gluten["recording"] == RECORDING and gluten["timebase"] == "original_source_start" and (gluten["occurrence_index"], gluten["occurrences_total"]) == (1, 1)


def test_not_discussed_only_when_the_whole_recording_was_processed_and_matched_and_nothing_was_found():
    result = enriched()
    assert slide(result, 8)["ranges"] == [] and slide(result, 8)["no_range"]["state"] == "not_discussed"
    # A page that needs no range says so, without a warning, when nothing was found for it.
    assert slide(result, 1)["no_range"]["state"] == "no_range_expected" and slide(result, 9)["no_range"]["state"] == "no_range_expected"
    assert slide(result, 1)["no_range"]["detail"]["role"] == "structural_title_or_section"
    assert_exactly_one_of_ranges_or_state(result)


def test_audio_unprocessed_when_nothing_was_generated_or_only_a_part_in_which_nothing_was_found():
    nothing = enriched(material(generated=None))
    assert slide(nothing, 5)["no_range"]["state"] == "audio_unprocessed" and slide(nothing, 5)["no_range"]["detail"]["processed"] == []
    assert slide(nothing, 1)["no_range"]["state"] == "no_range_expected"  # nothing is missing on a title page
    assert nothing["timing"]["stage"] == "audio_unprocessed" and nothing["timing"]["recordings"][0]["generated"] is None
    assert_exactly_one_of_ranges_or_state(nothing)
    # Six sentences of a much longer recording were transcribed: slides outside them are not "not discussed".
    part = enriched(material(lines=LINES[:6], duration_ms=600_000), the_view=view(duration_ms=600_000))
    assert slide(part, 5)["ranges"] and slide(part, 7)["no_range"]["state"] == "audio_unprocessed"
    assert slide(part, 7)["no_range"]["detail"]["processed"] == [[RECORDING["source_id"], 0, 60_000]] and slide(part, 7)["no_range"]["detail"]["reason"] == "partly_processed"
    assert part["timing"]["stage"] == "associated" and part["timing"]["recordings"][0]["generated"]["covers_whole_recording"] is False
    # Text withheld inside the recording leaves it not wholly covered as well.
    withheld = enriched(material(unresolved=[(65_000, 69_000)]))
    assert slide(withheld, 8)["no_range"]["state"] == "audio_unprocessed"
    assert withheld["timing"]["recordings"][0]["generated"]["unresolved_intervals"] == [[65_000, 69_000]] and withheld["timing"]["recordings"][0]["generated"]["unresolved_ms"] == 4_000


def test_association_not_run_with_its_cause_when_timing_exists_but_no_result_under_the_current_inputs():
    mat = material()
    doc = tl.compose(mat, now=NOW)
    generated = {RECORDING["source_id"]: mat["recordings"][0]["generated"]}
    missing = tl.enrich(view(), source_map=source_map(), links=tl.evaluate(None, doc["inputs"]), generated=generated)
    assert slide(missing, 5)["no_range"]["state"] == "association_not_run" and slide(missing, 5)["no_range"]["detail"]["cause"] == "not_run"
    assert missing["timing"]["stage"] == "processed" and missing["timing"]["recordings"][0]["association"]["state"] == "not_run"
    assert missing["timing"]["recordings"][0]["text_alignment"]["state"] == "not_run"
    changed = copy.deepcopy(doc["inputs"])
    changed["map_revision"] = "maprev0000000002"
    stale = tl.enrich(view(), source_map=source_map(revision="maprev0000000002"), links=tl.evaluate(doc, changed), generated=generated)
    for page in (2, 5, 6, 7, 8):
        assert slide(stale, page)["ranges"] == [] and slide(stale, page)["no_range"]["state"] == "association_not_run", page
        assert slide(stale, page)["no_range"]["detail"] == {"cause": "inputs_changed", "differs": ["map_revision"]}
    association = stale["timing"]["recordings"][0]["association"]
    assert association["state"] == "stale" and association["cause"] == "inputs_changed" and association["ranges"] == 0
    assert stale["timing"]["summary"]["ranges"] == 0 and slide(stale, 1)["no_range"]["state"] == "no_range_expected"
    assert_exactly_one_of_ranges_or_state(stale)
    # Called without a document at all (nothing was ever built) it is the same state, never "not discussed".
    bare = tl.enrich(view(), source_map=None, links=None, generated=generated)
    assert slide(bare, 8)["no_range"]["state"] == "association_not_run"


def test_ambiguous_lists_the_candidates_that_were_not_good_enough_to_show():
    steps = [STEP] * len(LINES)
    for line in range(LINE_OF["oven"][0], LINE_OF["oven"][1] + 1):
        steps[line - 1] = 2_500
    mat = material(steps=steps)
    result = enriched(mat)
    oven = slide(result, 6)
    assert oven["ranges"] == [] and oven["no_range"]["state"] == "ambiguous"
    (listed,) = oven["no_range"]["detail"]["candidates"]
    assert set(listed) >= {"range_id", "recording_source_id", "start_ms", "end_ms", "why_not_shown"} and listed["end_ms"] - listed["start_ms"] < 8000
    assert "shorter" in listed["why_not_shown"]
    assert_exactly_one_of_ranges_or_state(result)


def test_a_title_page_with_a_candidate_is_ambiguous_because_something_was_found_for_it():
    """``no_range_expected`` means nothing was found. A candidate that was not good enough to show is something."""
    opening = ["Welcome to bread science: this is the week four overview of bread science.", "The week four overview lists everything we bake in bread science this week."]
    lines = [*opening, *LINES]
    mat = material(lines=lines, steps=[3_000, 3_000] + [STEP] * len(LINES))  # six seconds about the title page: a candidate, not a range
    result = enriched(mat, the_view=view(duration_ms=6_000 + len(LINES) * STEP))
    title = slide(result, 1)
    assert title["ranges"] == [] and title["no_range"]["state"] == "ambiguous" and len(title["no_range"]["detail"]["candidates"]) == 1
    assert slide(result, 9)["no_range"]["state"] == "no_range_expected"  # the page for which nothing at all was found
    assert_exactly_one_of_ranges_or_state(result)


def test_recording_unavailable_is_stated_first_whatever_the_role_of_the_page():
    for the_view, reason in ((view(recordings="none", sessions="none"), "no_session_linked"), (view(recordings="none"), "no_recording_in_session"),
                             (view(recordings="unreadable"), "recording_unreadable")):
        result = tl.enrich(the_view, source_map=source_map(), links=None, generated={})
        assert {row["no_range"]["state"] for row in result["slides"]} == {"recording_unavailable"}  # the title page included
        assert slide(result, 1)["no_range"]["detail"]["reason"] == reason
        assert result["timing"]["stage"] == "no_recording" and result["timing"]["summary"]["pages_without_range"] == 9
        assert result["timing"]["summary"]["pages_no_range_expected"] == 0


def test_the_six_states_come_from_six_different_causes():
    seen = {slide(enriched(), 8)["no_range"]["state"], slide(enriched(), 1)["no_range"]["state"], slide(enriched(material(generated=None)), 5)["no_range"]["state"],
            slide(tl.enrich(view(), source_map=source_map(), links=None, generated={RECORDING["source_id"]: generation(LINES)}), 5)["no_range"]["state"],
            slide(tl.enrich(view(recordings="none"), source_map=source_map(), links=None, generated={}), 5)["no_range"]["state"]}
    steps = [2_500 if LINE_OF["oven"][0] <= n <= LINE_OF["oven"][1] else STEP for n in range(1, len(LINES) + 1)]
    seen.add(slide(enriched(material(steps=steps)), 6)["no_range"]["state"])
    assert seen == NO_RANGE_STATES


def annotation(annotation_id, page, start_ms, end_ms, *, review_state="confirmed", basis="manual_review", relation="discussed_during") -> dict:
    return {"contract": "ll.annotation/1", "annotation_id": annotation_id, "scope": {"course_id": "syn101", "term": "2026-fall"}, "revision": 1, "supersedes": None, "relation": relation,
            "from": dict(DECK, locator={"kind": "page", "page": page, "printed_label": None}),
            "to": dict(RECORDING, locator={"kind": "media", "start_ms": start_ms, "end_ms": end_ms, "origin": "original_source_start"}),
            "review_state": review_state, "basis": basis, "support": [], "reviewer_ref": None if review_state == "suggested" else "learner", "created_at": NOW}


def listed(record) -> dict:
    """One annotation the way ``Projector.lecture_view`` lists it under ``slides[].occurrences``."""
    return {"annotation_id": record["annotation_id"], "revision": record["revision"], "review_state": record["review_state"], "basis": record["basis"], "relation": record["relation"],
            "artifact": None, "record": record, "source": record["to"], "start_ms": record["to"]["locator"]["start_ms"], "end_ms": record["to"]["locator"]["end_ms"]}


def test_a_learners_link_comes_first_keeps_its_times_and_outranks_the_suggestion_for_the_same_occurrence():
    gluten_start = (LINE_OF["gluten"][0] - 1) * STEP
    mine = annotation("ann-syn-p5", 5, gluten_start + 4_000, gluten_start + 21_000)
    elsewhere = annotation("ann-syn-p8", 8, 150_000, 158_000)
    the_view = view()
    the_view["slides"][4]["occurrences"] = [listed(mine)]
    the_view["slides"][7]["occurrences"] = [listed(elsewhere)]
    result = enriched(the_view=the_view)
    (only,) = slide(result, 5)["ranges"]  # the overlapping suggestion is not shown beside the learner's own range
    assert (only["start_ms"], only["end_ms"]) == (gluten_start + 4_000, gluten_start + 21_000)
    assert only["origin"] == "manual" and only["review_state"] == "human_confirmed" and only["annotation_id"] == "ann-syn-p5"
    assert only["quality"]["association"]["state"] == "human_confirmed" and only["support"] == {"scope": "page", "pages": [5], "builds": None}
    assert slide(result, 8)["no_range"] is None and slide(result, 8)["ranges"][0]["annotation_id"] == "ann-syn-p8"
    # On a page with both, the learner's link is listed before the suggestions that it does not replace.
    before = annotation("ann-syn-p2", 2, 100_000, 104_000)
    the_view = view()
    the_view["slides"][1]["occurrences"] = [listed(before)]
    ranges = slide(enriched(the_view=the_view), 2)["ranges"]
    assert [r["annotation_id"] for r in ranges] == ["ann-syn-p2", None, None] and ranges[1]["start_ms"] < ranges[0]["start_ms"]
    summary = enriched(the_view=the_view)["timing"]["summary"]
    assert summary["human_confirmed"] == 1 and summary["generated"] == summary["ranges"] - 1 and summary["agent_reviewed"] == 0
    assert_exactly_one_of_ranges_or_state(result)


def test_a_rejected_annotation_suppresses_the_matching_suggestion_and_only_that_one():
    gluten_start = (LINE_OF["gluten"][0] - 1) * STEP
    rejected = annotation("ann-syn-rejected", 5, gluten_start, gluten_start + 3 * STEP, review_state="rejected")
    result = enriched(annotations=[rejected])
    assert slide(result, 5)["ranges"] == [] and slide(result, 5)["no_range"]["state"] in NO_RANGE_STATES - {"ambiguous", "recording_unavailable"}
    assert slide(result, 5)["no_range"]["detail"]["rejected_suggestions"] == 1
    assert len(slide(result, 2)["ranges"]) == 2 and slide(result, 6)["ranges"]  # other pages keep theirs
    untouched = enriched()
    assert len(slide(untouched, 5)["ranges"]) == 1
    # A rejection of other audio on the same page suppresses nothing.
    other = annotation("ann-syn-rejected-2", 5, 160_000, 168_000, review_state="rejected")
    assert len(slide(enriched(annotations=[other]), 5)["ranges"]) == 1


def test_a_recorded_display_claim_made_from_text_alone_is_shown_as_discussion():
    """An earlier pipeline stored cue-file suggestions as ``displayed_during`` without anyone looking at frames (R2-T7)."""
    old = annotation("sug-syn-p8", 8, 150_000, 158_000, review_state="suggested", basis="transcript_only", relation="displayed_during")
    seen = annotation("ann-syn-seen", 8, 120_000, 126_000, basis="visual_and_transcript", relation="displayed_during")
    the_view = view()
    the_view["slides"][7]["occurrences"] = [listed(old), listed(seen)]
    ranges = {r["annotation_id"]: r for r in slide(enriched(the_view=the_view), 8)["ranges"]}
    assert ranges["sug-syn-p8"]["relation"] == "discussed_during" and ranges["sug-syn-p8"]["origin"] == "pipeline" and ranges["sug-syn-p8"]["review_state"] == "generated"
    assert ranges["ann-syn-seen"]["relation"] == "displayed_during" and ranges["ann-syn-seen"]["review_state"] == "human_confirmed"


def test_a_section_link_appears_on_every_page_the_course_names_with_section_scope():
    result = enriched(material(pairings=[pairing([5, 7, 8], [LINE_OF["oven"]])]))
    for page in (5, 7, 8):
        sections = [r for r in slide(result, page)["ranges"] if r["support"]["scope"] == "section"]
        assert len(sections) == 1 and sections[0]["support"]["pages"] == [5, 7, 8] and sections[0]["origin"] == "reviewed_source_map"
        assert sections[0]["method"] == {"name": "course-stated-lines", "version": "1"} and (sections[0]["occurrence_index"], sections[0]["occurrences_total"]) == (1, 1)
    assert len({tuple((r["start_ms"], r["end_ms"]) for r in slide(result, page)["ranges"] if r["support"]["scope"] == "section") for page in (5, 7, 8)}) == 1  # the same stretch, not a share each
    assert slide(result, 8)["no_range"] is None  # the course's own statement is a range for the page nobody matched by wording
    assert_exactly_one_of_ranges_or_state(result)


def test_the_timing_block_is_spelled_as_the_read_api_states():
    result = enriched(material(pairings=[pairing([5], [LINE_OF["gluten"]])]))
    timing = result["timing"]
    assert set(timing) == {"stage", "recordings", "summary"} and timing["stage"] == "associated"
    (row,) = timing["recordings"]
    assert set(row) == {"source_id", "filename", "duration_ms", "generated", "text_alignment", "association"}
    assert set(row["generated"]) == {"generation", "text_origin", "review_state", "covered_intervals", "unresolved_intervals", "unresolved_ms", "coverage_fraction", "covers_whole_recording"}
    assert row["generated"]["covered_intervals"] == [[0, len(LINES) * STEP]] and row["generated"]["covers_whole_recording"] is True
    assert row["text_alignment"] == {"state": "accepted", "reason": None, "lines_aligned": len(LINES), "lines_total": len(LINES), "method": {"name": "anchored-token-alignment", "version": "2"}}
    association = row["association"]
    assert set(association) == {"state", "cause", "method", "built_at", "ranges", "unassigned_ms", "inputs"}
    assert association["state"] == "current" and association["cause"] is None and association["built_at"] == NOW and association["method"] == {"name": "lexical-sequence", "version": "2"}
    assert association["inputs"] == {"recording_sha256": RECORDING["sha256"], "generation": "sp-syn-0001", "map_revision": "maprev0000000001", "method_version": "2"}
    assert association["unassigned_ms"] > 0
    summary = timing["summary"]
    assert set(summary) == {"pages", "pages_with_range", "pages_no_range_expected", "pages_without_range", "ranges", "human_confirmed", "agent_reviewed", "generated"}
    with_range = sum(1 for row_ in result["slides"] if row_["ranges"])
    assert summary["pages"] == 9 and summary["pages_with_range"] == with_range and summary["pages_no_range_expected"] == 2
    assert summary["pages_with_range"] + summary["pages_no_range_expected"] + summary["pages_without_range"] == 9
    distinct = {r["range_id"] for row_ in result["slides"] for r in row_["ranges"]}
    # association.ranges counts the stored links; page 5 lists the gluten stretch once although a suggestion and the course's section both have it
    assert summary["ranges"] == len(distinct) == association["ranges"] - 1 and summary["generated"] == len(distinct) and summary["human_confirmed"] == 0
    assert result["revisions"]["timing_links"] == [{"recording_source_id": RECORDING["source_id"], "links_revision": tl.compose(
        material(pairings=[pairing([5], [LINE_OF["gluten"]])]), now=NOW)["links_revision"]}]


def test_links_made_for_one_deck_give_no_range_on_the_pages_of_another():
    """The learner may display another file of the unit for one request. Page 5 of that file is not page 5 of the deck the
    links were made for."""
    mat = material()
    doc = tl.compose(mat, now=NOW)
    other = view()
    other["deck"] = {"source_id": "src-syn-other-deck", "version_id": "v1-other", "sha256": "7" * 64}
    result = tl.enrich(other, source_map=None, links=tl.evaluate(doc, doc["inputs"]), generated={RECORDING["source_id"]: mat["recordings"][0]["generated"]})
    assert all(row["ranges"] == [] and row["no_range"]["state"] == "association_not_run" for row in result["slides"])
    assert result["timing"]["recordings"][0]["association"]["state"] == "not_run" and result["timing"]["summary"]["ranges"] == 0 and result["revisions"]["timing_links"] == []
    assert result["timing"]["recordings"][0]["generated"]["generation"] == "sp-syn-0001"  # what is known about the recording itself stays


def test_with_two_recordings_only_the_one_whose_timing_changed_loses_its_ranges():
    second = dict(RECORDING, source_id="src-syn-rec-2", version_id="v1-rec-2", sha256="e" * 64)
    first_row = material()["recordings"][0]
    second_row = dict(first_row, **second, filename="Synthetic baking lecture, second session.m4a", generated=generation(LINES[:6], name="sp-syn-b"))
    mat = material(recordings=[first_row, second_row])
    doc = tl.compose(mat, now=NOW)
    assert {link["recording"]["source_id"] for link in doc["links"]} == {RECORDING["source_id"], "src-syn-rec-2"}
    now = copy.deepcopy(doc["inputs"])
    now["recordings"][1]["generation"] = "sp-syn-c"  # the second recording was transcribed again
    links = tl.evaluate(doc, now)
    assert links["state"] == "stale" and links["differs"] == ["generation"] and links["stale_recordings"] == ["src-syn-rec-2"]
    assert links["links"] and {link["recording"]["source_id"] for link in links["links"]} == {RECORDING["source_id"]}
    assert links["withheld"]["links"] == sum(1 for link in doc["links"] if link["recording"]["source_id"] == "src-syn-rec-2")
    the_view = view()
    the_view["recordings"].append(dict(second, filename="Synthetic baking lecture, second session.m4a", state="registered_readable", duration_ms=60_000))
    result = tl.enrich(the_view, source_map=source_map(), links=links, generated={RECORDING["source_id"]: first_row["generated"], "src-syn-rec-2": generation(LINES[:6], name="sp-syn-c")})
    states = {row["source_id"]: row["association"]["state"] for row in result["timing"]["recordings"]}
    assert states == {RECORDING["source_id"]: "current", "src-syn-rec-2": "stale"}
    assert {r["recording"]["source_id"] for r in slide(result, 5)["ranges"]} == {RECORDING["source_id"]}  # the first recording's range is still served
    assert slide(result, 8)["no_range"]["state"] == "association_not_run" and slide(result, 8)["no_range"]["detail"] == {"cause": "inputs_changed", "differs": ["generation"]}
    assert result["timing"]["stage"] == "processed"  # both recordings are transcribed whole; one of them is not matched under the current inputs
    assert result["revisions"]["timing_links"] == [{"recording_source_id": RECORDING["source_id"], "links_revision": doc["links_revision"]}]


def test_enrich_reads_the_served_source_map_shape_and_the_views_own_roles_too():
    """After ``slide_identity.enrich`` the view carries identity and role per slide; that spelling is read as well."""
    the_view = view()
    stored = source_map()
    for row, page in zip(the_view["slides"], stored["pages"]):
        row["identity"] = {"logical_slide_id": page["logical_slide_id"]}
        row["role"] = {"value": page["role"]["role"], "forced_requirements": page["role"]["forced_requirements"]}
    served = {"state": "ready", "map_revision": stored["map_revision"], "logical_slides": [{"id": s["logical_slide_id"], "kind": "build_group" if len(s["pages"]) > 1 else "single",
                                                                                           "pages": s["pages"], "role": s["role"]} for s in stored["logical_slides"]]}
    mat = material()
    doc = tl.compose(mat, now=NOW)
    result = tl.enrich(the_view, source_map=served, links=tl.evaluate(doc, doc["inputs"]), generated={RECORDING["source_id"]: mat["recordings"][0]["generated"]})
    assert slide(result, 1)["no_range"]["state"] == "no_range_expected" and len(slide(result, 3)["ranges"]) == 2 and slide(result, 8)["no_range"]["state"] == "not_discussed"


# ---- on disk: build, read, status, routes, command (the synthetic fixture workspace, read-only profile) -------------------
@pytest.fixture()
def local(workspace, tmp_path):
    """The read-only profile over the generated synthetic workspace: app files go to a shadow folder in the state directory."""
    return load_settings("local", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "private-state")


@pytest.fixture()
def journal(local, clock):
    j = Journal.open(local.journal_path, clock=clock, synced_roots=[])
    yield j
    j.close()


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def unit(settings, lecture_id="lecture-01", course="be505") -> dict:
    lecture = next(l for l in build_inventory(settings.course(course))["lectures"] if l["lecture_id"] == lecture_id)
    items = [i for s in lecture["sessions"] for i in s["items"]]
    return {"lecture": lecture, "recording": next(i for i in items if i["kind"] == "lecture_recording"),
            "transcript": next(i for i in items if i["kind"] == "lecture_transcript" and i["filename"].endswith(".txt"))}


def transcript_lines(settings, lecture_id="lecture-01", course="be505") -> list[str]:
    return (settings.course(course).root / unit(settings, lecture_id, course)["transcript"]["path"]).read_text(encoding="utf-8").splitlines()


def import_generation(settings, journal, out: Path, lines, *, name="gen-0001", step_ms=2_400, lecture_id="lecture-01", course="be505", created_at=NOW) -> dict:
    """A labeled synthetic producer: the sentences given, with invented word times, imported through the tested importer."""
    item = unit(settings, lecture_id, course)["recording"]
    _, sha256 = Preparation(settings, converter=None).identity_of(course, item)
    segments = []
    for index, text in enumerate(lines):
        words = text.split()
        each = (step_ms - 200) // len(words)
        start = index * step_ms
        segments.append({"index": index, "clip_start_ms": start, "clip_end_ms": start + len(words) * each, "text": text,
                         "words": [{"clip_start_ms": start + k * each, "clip_end_ms": start + (k + 1) * each - 10, "text": word} for k, word in enumerate(words)]})
    window = (0, len(lines) * step_ms)
    document = {"contract": "ll.derived-segments/1", "course_id": course, "source_id": item["source_id"], "generation": name, "time_base": "clip_relative", "clip_offset_ms": 0,
                "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [], "segments": segments}
    out.mkdir(parents=True, exist_ok=True)
    data = c.dump_json(document)
    (out / "segments.json").write_bytes(data)
    from lecture_brain.annotations import media_duration_ms

    manifest = {"contract": "ll.derived-manifest/1", "status": "complete", "kind": "speech_timing", "course_id": course, "generation": name, "created_at": created_at,
                "consumer_version": d.CONSUMER_VERSION, "recording": {"source_id": item["source_id"], "sha256": sha256, "bytes": item["bytes"],
                                                                     "duration_ms": media_duration_ms(settings.course(course).root / item["path"])},
                "producer": {"tool": "synthetic-fixture-producer", "tool_version": "0.0.0", "model": "none-synthetic", "language": "en", "parameters_sha256": "b" * 64},
                "window": {"start_ms": window[0], "end_ms": window[1]}, "time_base": "clip_relative", "clip_offset_ms": 0, "input_fingerprint": "0" * 64, "segments_path": "segments.json",
                "outputs": [c.artifact_for_bytes(data, "segments.json", "application/json")], "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": []}
    manifest["input_fingerprint"] = d.fingerprint_of(manifest)
    (out / "manifest.json").write_bytes(c.dump_json(manifest))
    result = Derived(settings, journal, now=lambda: NOW).import_generation(out, course_id=course)
    assert result["status"] == "imported", result
    return result


def links_path(settings, lecture_id="lecture-01", course="be505") -> Path:
    return settings.app_area(course) / "timing-links" / f"{lecture_id}.json"


def test_build_writes_one_private_document_and_nothing_into_any_course(local, journal, tmp_path):
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    roots = {course: binding.root for course, binding in local.courses.items()}
    before = {course: tree(root) for course, root in roots.items()}
    planner_before = tree(local.planner_root)
    transcript_sha = hashlib.sha256((roots["be505"] / unit(local)["transcript"]["path"]).read_bytes()).hexdigest()

    doc = tl.build(local, "be505", "lecture-01", journal=journal, now=lambda: NOW)

    path = links_path(local)
    assert path.is_file() and path.is_relative_to(local.state_dir) and not any(path.is_relative_to(root) for root in roots.values())
    assert c.parse_json(path.read_bytes()) == doc and c.dump_json(doc) == path.read_bytes()
    assert {course: tree(root) for course, root in roots.items()} == before and tree(local.planner_root) == planner_before
    assert not [p for p in path.parent.iterdir() if p.name != "lecture-01.json"], "written whole or not at all: no temporary file is left"
    record = doc["recordings"][0]
    assert record["stage"] == "associated" and record["stages"]["generated"]["generation"] == "gen-0001"
    mapping = record["stages"]["text_alignment"]
    assert mapping["state"] == "accepted" and mapping["lines_aligned"] == mapping["lines_total"] == 24
    assert doc["transcript_check"] == {"source_id": unit(local)["transcript"]["source_id"], "sha256_before": transcript_sha, "sha256_after": transcript_sha, "unchanged": True}
    assert doc["inputs"]["transcript"]["sha256"] == transcript_sha and doc["inputs"]["map_revision"] and doc["inputs"]["recordings"][0]["generation"] == "gen-0001"
    assert record["stages"]["slides"]["basis"] == "source_map" and record["stages"]["slides"]["count"] == 4
    assert doc["links"] and {page for link in doc["links"] for page in link["support"]["pages"]} <= {1, 2, 3, 4}
    assert all(link["end_ms"] <= 60_000 for link in everything(doc))
    receipts = journal.receipts(kind="timing-build")
    assert len(receipts) == 1 and receipts[0]["payload"]["lecture_id"] == "lecture-01" and receipts[0]["payload"]["links_revision"] == doc["links_revision"]
    assert receipts[0]["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    # The same inputs and the same clock give the same bytes; another clock gives the same revision.
    assert tl.build(local, "be505", "lecture-01", now=lambda: NOW) == doc and path.read_bytes() == c.dump_json(doc)
    assert tl.build(local, "be505", "lecture-01", now=lambda: "2027-01-01T00:00:00Z")["links_revision"] == doc["links_revision"]
    with pytest.raises(tl.TimingLinksError) as refused:
        tl.build(local, "be505", "lecture-99", now=lambda: NOW)
    assert refused.value.code == "unknown_lecture"
    with pytest.raises(tl.TimingLinksError):
        tl.build(local, "be505", "../lecture-01", now=lambda: NOW)


def test_a_lecture_without_generated_timing_builds_a_document_that_says_audio_unprocessed(local):
    doc = tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    assert [r["stage"] for r in doc["recordings"]] == ["audio_unprocessed"] and doc["links"] == []
    nothing = tl.build(local, "be505", "lecture-03", now=lambda: NOW)  # no session is linked to this unit
    assert nothing["recordings"] == [] and nothing["links"] == []
    read = tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))
    assert read["state"] == "current"


def test_read_is_missing_then_current_then_stale_when_the_timing_is_generated_again(local, journal, tmp_path):
    lines = transcript_lines(local)
    assert tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))["state"] == "missing"
    import_generation(local, journal, tmp_path / "out" / "gen-0001", lines[:12])
    built = tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    current = tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))
    assert current["state"] == "current" and current["links"] == built["links"] and current["links_revision"] == built["links_revision"]
    assert path_bytes_unchanged_by_read(local, built)
    # A generation that resolves more of the recording replaces the served one: the links made from the older one are stale.
    import_generation(local, journal, tmp_path / "out" / "gen-0002", lines, name="gen-0002", created_at="2026-10-06T10:00:00Z")
    stale = tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))
    assert stale["state"] == "stale" and stale["differs"] == ["generation"] and stale["links"] == [] and stale["withheld"]["links"] == len(built["links"])
    rebuilt = tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    assert rebuilt["inputs"]["recordings"][0]["generation"] == "gen-0002" and rebuilt["links_revision"] != built["links_revision"]
    assert tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))["state"] == "current"
    # A damaged file is not served as anything.
    links_path(local).write_bytes(b'{"contract": "timing-links/1", ')
    damaged = tl.read(local, "be505", "lecture-01", current_inputs=tl.current_inputs(local, "be505", "lecture-01"))
    assert damaged["state"] == "missing" and damaged["reason"] == "unreadable"


def path_bytes_unchanged_by_read(settings, built) -> bool:
    return links_path(settings).read_bytes() == c.dump_json(built)


def test_annotations_survive_every_rebuild_and_come_first_in_the_lecture_view(local, journal, tmp_path):
    """The fixture course carries reviewed links (``ann-l01-s02-o1-displayed`` is confirmed). A rebuild neither deletes
    nor downgrades them, and the reader puts them before the suggestions."""
    from lecture_brain.projections import Projector

    store = AnnotationStore(local)
    kept_before = {path.name: path.read_bytes() for area in store._areas("be505") if area.is_dir() for path in sorted(area.iterdir()) if path.is_file()}
    confirmed = store.load("be505")["current"]["ann-l01-s02-o1-displayed"]["record"]
    assert confirmed["review_state"] == "confirmed" and confirmed["from"]["locator"]["page"] == 2
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    for _ in range(2):
        tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    assert {path.name: path.read_bytes() for area in store._areas("be505") if area.is_dir() for path in sorted(area.iterdir()) if path.is_file()} == kept_before
    projector = Projector(local, journal, annotations=store, preparation=Preparation(local, store, converter=None, now=lambda: NOW), now=lambda: NOW)
    the_view = tl.enrich_view(local, "be505", "lecture-01", projector.lecture_view("be505", "lecture-01"))
    ranges = the_view["slides"][1]["ranges"]
    assert ranges[0]["annotation_id"] == "ann-l01-s02-o1-displayed" and ranges[0]["review_state"] == "human_confirmed"
    interval = confirmed["to"]["locator"]
    assert (ranges[0]["start_ms"], ranges[0]["end_ms"]) == (interval["start_ms"], interval["end_ms"])
    assert not any(r["annotation_id"] is None and r["support"]["scope"] != "section" and r["start_ms"] < interval["end_ms"] and r["end_ms"] > interval["start_ms"] for r in ranges)
    assert the_view["timing"]["stage"] == "associated" and the_view["timing"]["summary"]["human_confirmed"] >= 1
    assert the_view["timing"]["recordings"][0]["association"]["state"] == "current"
    # A rejection stored by the learner is read with the document and suppresses the suggestion it matches. (Lecture 02
    # of the fixture has no reviewed link, so its suggestions are on screen.)
    import_generation(local, journal, tmp_path / "out" / "gen-l02", transcript_lines(local, "lecture-02"), name="gen-l02", step_ms=4_000, lecture_id="lecture-02")
    tl.build(local, "be505", "lecture-02", now=lambda: NOW)
    the_view = tl.enrich_view(local, "be505", "lecture-02", projector.lecture_view("be505", "lecture-02"))
    suggestion = next(r for row in the_view["slides"] for r in row["ranges"] if r["annotation_id"] is None and r["origin"] == "pipeline")
    page = suggestion["support"]["pages"][0]
    deck = the_view["deck"]
    recording = the_view["recordings"][0]
    rejected = {"contract": "ll.annotation/1", "annotation_id": "ann-test-rejected", "scope": {"course_id": "be505", "term": "2026-fall"}, "revision": 1, "supersedes": None,
                "relation": "discussed_during", "from": {"source_id": deck["source_id"], "version_id": deck["version_id"], "sha256": deck["sha256"],
                                                         "locator": {"kind": "page", "page": page, "printed_label": None}},
                "to": {"source_id": recording["source_id"], "version_id": recording["version_id"], "sha256": recording["sha256"],
                       "locator": {"kind": "media", "start_ms": suggestion["start_ms"], "end_ms": suggestion["end_ms"], "origin": "original_source_start"}},
                "review_state": "rejected", "basis": "manual_review", "support": [recording["artifact"]], "reviewer_ref": "learner", "created_at": NOW}
    assert store.propose("be505", c.dump_json(rejected))["status"] == "saved"
    tl.build(local, "be505", "lecture-02", now=lambda: NOW)  # a rebuild makes the same suggestion again; the rejection still outranks it
    assert suggestion["range_id"] in {link["range_id"] for link in tl.read(local, "be505", "lecture-02", current_inputs=tl.current_inputs(local, "be505", "lecture-02"))["links"]}
    again = tl.enrich_view(local, "be505", "lecture-02", projector.lecture_view("be505", "lecture-02"))
    assert suggestion["range_id"] not in {r["range_id"] for row in again["slides"] for r in row["ranges"]}
    assert again["slides"][page - 1]["no_range"] is None or again["slides"][page - 1]["no_range"]["detail"]["rejected_suggestions"] == 1
    assert (store.area("be505") / "ann-test-rejected.r1.json").is_file()


def test_course_stated_pairs_are_read_from_the_course_and_never_written_back(local, journal, tmp_path):
    """The fixture catalog and study notes are whatever the generator made; the reader must cope with either having
    pairings or none, name what it found, and leave the course untouched."""
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    before = tree(local.course("be505").root)
    gathered = tl.gather(local, "be505", "lecture-01")
    assert tree(local.course("be505").root) == before
    assert gathered["transcript"]["state"] == "one" and len(gathered["transcript"]["lines"]) == 24 and gathered["slides"]["basis"] == "source_map"
    assert all(set(p) >= {"pages", "line_ranges", "basis"} and p["basis"] in {"course_study_map", "course_locator"} for p in gathered["pairings"])
    assert isinstance(gathered["pairing_notes"], list)
    assert tl.inputs_of(gathered) == tl.current_inputs(local, "be505", "lecture-01")


def keys_of(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in keys_of(item)}
    return {key for item in value for key in keys_of(item)} if isinstance(value, list) else set()


def test_status_lists_every_lecture_and_recording_with_its_stage_and_extrapolates_nothing(local, journal, tmp_path):
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    report = tl.status(local, "be505")
    assert set(report) >= {"course_id", "allowance", "resume_command", "lectures", "summary"} and report["course_id"] == "be505"
    inventory = build_inventory(local.course("be505"))
    assert [row["lecture_id"] for row in report["lectures"]] == [l["lecture_id"] for l in inventory["lectures"]]
    by_id = {row["lecture_id"]: row for row in report["lectures"]}
    first = by_id["lecture-01"]
    assert first["stage"] == "associated" and first["title"]
    (recording,) = first["recordings"]
    assert set(recording) == {"source_id", "filename", "duration_ms", "generated", "text_alignment", "association", "queue"}
    assert recording["generated"]["generation"] == "gen-0001" and recording["generated"]["covered_intervals"] == [[0, 57_600]] and recording["generated"]["unresolved_ms"] == 0
    assert recording["association"]["state"] == "current" and recording["association"]["ranges"] > 0 and recording["text_alignment"]["state"] == "accepted"
    assert set(recording["queue"]) == {"state", "chunks_done", "chunks_total", "seconds_covered"}  # as r2-read-api.md spells it; the runner reports no queue position
    second = by_id["lecture-02"]
    assert second["stage"] == "audio_unprocessed" and second["recordings"][0]["generated"] is None and second["recordings"][0]["association"]["state"] == "not_run"
    assert by_id["lecture-03"]["stage"] == "no_recording" and by_id["lecture-03"]["recordings"] == []
    assert report["summary"]["lectures"] == len(inventory["lectures"]) and report["summary"]["recordings"] == sum(len(row["recordings"]) for row in report["lectures"])
    assert report["summary"]["stages"]["associated"] == 1 and report["summary"]["covered_ms"] == 57_600
    assert report["allowance"] is None or set(report["allowance"]) == {"ceiling_seconds", "used_seconds", "remaining_seconds"}
    assert "speech-run" in report["resume_command"]
    assert not {"estimated", "eta", "expected_seconds", "projected", "remaining_time"} & keys_of(report)  # measured values only
    # A document made for an older generation is reported stale, not current.
    import_generation(local, journal, tmp_path / "out" / "gen-0002", transcript_lines(local) + ["One more synthetic sentence at the very end."], name="gen-0002", step_ms=2_390,
                      created_at="2026-10-06T10:00:00Z")
    stale = {row["lecture_id"]: row for row in tl.status(local, "be505")["lectures"]}["lecture-01"]
    assert stale["stage"] == "processed" and stale["recordings"][0]["association"]["state"] == "stale" and stale["recordings"][0]["association"]["cause"] == "inputs_changed"
    with pytest.raises(tl.TimingLinksError):
        tl.status(local, "no-such-course")


def test_the_two_routes_read_the_course_and_rebuild_one_lecture(local, journal, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from lecture_brain.projections import Projector

    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    preparation = Preparation(local, converter=None, now=lambda: NOW)
    runtime = SimpleNamespace(settings=local, journal=journal, preparation=preparation, now=lambda: NOW,
                              projector=Projector(local, journal, preparation=preparation, now=lambda: NOW))
    app = FastAPI()
    tl.register(app, runtime, lambda fn: fn())
    declared = {(method, route.path) for route in app.routes for method in getattr(route, "methods", set()) if method not in {"HEAD", "OPTIONS"}}
    assert {("GET", "/api/courses/{course_id}/timing"), ("POST", "/api/courses/{course_id}/lectures/{lecture_id}/timing/build")} <= declared
    client = TestClient(app)
    before = tree(local.course("be505").root)
    listing = client.get("/api/courses/be505/timing")
    assert listing.status_code == 200 and {row["lecture_id"]: row["stage"] for row in listing.json()["lectures"]}["lecture-01"] == "partly_processed"  # 57.6 of 60 seconds, not matched yet
    built = client.post("/api/courses/be505/lectures/lecture-01/timing/build")
    assert built.status_code == 200 and set(built.json()) == {"stage", "recordings", "summary"} and built.json()["stage"] == "associated"
    assert built.json()["summary"]["ranges"] > 0 and links_path(local).is_file()
    assert {row["lecture_id"]: row["stage"] for row in client.get("/api/courses/be505/timing").json()["lectures"]}["lecture-01"] == "associated"
    assert client.get("/api/courses/nope/timing").status_code == 404 and client.post("/api/courses/be505/lectures/lecture-99/timing/build").status_code == 404
    assert client.post("/api/courses/nope/lectures/lecture-01/timing/build").status_code == 404
    assert tree(local.course("be505").root) == before
    assert [r["payload"]["lecture_id"] for r in journal.receipts(kind="timing-build")] == ["lecture-01"]


def test_the_commands_build_one_or_all_lectures_and_print_the_status(local, journal, tmp_path, capsys):
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    tl.cli_register(sub)
    assert tl.cli_run(parser.parse_args(["timing-build", "--course", "be505", "--lecture", "lecture-01"]), local) == 0
    one = json.loads(capsys.readouterr().out)
    assert [row["lecture_id"] for row in one["built"]] == ["lecture-01"] and one["built"][0]["links"] > 0 and one["built"][0]["stage"] == "associated"
    assert links_path(local).is_file() and not links_path(local, "lecture-02").exists()
    assert tl.cli_run(parser.parse_args(["timing-build", "--course", "be505", "--all"]), local) == 0
    everything_built = json.loads(capsys.readouterr().out)
    every_lecture = [lecture["lecture_id"] for lecture in build_inventory(local.course("be505"))["lectures"]]  # the fixture course grows; "all" means all of them
    assert [row["lecture_id"] for row in everything_built["built"]] == every_lecture and every_lecture[:4] == ["lecture-01", "lecture-02", "lecture-03", "lecture-04"]
    assert links_path(local, "lecture-02").is_file() and all(links_path(local, lecture_id).is_file() for lecture_id in every_lecture)
    assert tl.cli_run(parser.parse_args(["timing-status", "--course", "be505"]), local) == 0
    assert json.loads(capsys.readouterr().out)["summary"]["stages"]["associated"] == 1
    assert tl.cli_run(parser.parse_args(["timing-build", "--course", "be505", "--lecture", "lecture-99"]), local) == 1
    assert tl.cli_run(parser.parse_args(["timing-build", "--course", "nope", "--all"]), local) == 2
    with pytest.raises(SystemExit):
        parser.parse_args(["timing-build", "--course", "be505"])  # one lecture or all of them must be said
    with pytest.raises(SystemExit):
        parser.parse_args(["timing-build", "--course", "be505", "--lecture", "lecture-01", "--all"])


# ---- closing round: what the independent review found --------------------------------------------------------------------
def corrected_map(author) -> dict:
    """A stored map in which correction r1 joined pages 6 and 7. The history keeps the author the way ``sourcemap``
    stores it: an object ``{kind, ref}`` (older records: the bare word)."""
    stored = source_map(groups=((2, 3, 4), (6, 7)))
    joined = next(s for s in stored["logical_slides"] if s["pages"] == [6, 7])
    joined.update(grouping="override", kind="manual_group", confidence=None, evidence=[], overrides=[1])
    stored["overrides"] = {"contract": "source-map-override/1", "revision": 1, "problems": [], "history": [
        {"revision": 1, "type": "group", "op": {"type": "group", "pages": [6, 7], "kind": "manual_group"}, "author": author, "reason": "synthetic correction", "created_at": NOW,
         "supersedes": None, "replaces": [], "status": "applied", "in_force": True, "reverted_by": None}]}
    return stored


@pytest.mark.parametrize("author,state", [({"kind": "learner", "ref": None}, "human_confirmed"), ({"kind": "agent", "ref": "synthetic-agent"}, "agent_reviewed"),
                                          ({"kind": "agent", "ref": None, "learner_authority": True}, "human_confirmed"), ("learner", "human_confirmed"), ("agent", "agent_reviewed"),
                                          (None, "generated")])
def test_a_grouping_correction_is_read_with_its_author_and_the_links_of_that_group_say_who_made_it(author, state):
    stored = corrected_map(author)
    joined = next(s for s in tl.slides_from_map(stored)["logical_slides"] if s["pages"] == [6, 7])
    assert joined["group_mapping"]["state"] == state and "correction 1" in joined["group_mapping"]["basis"] and joined["kind"] == "manual_group"
    doc = tl.compose(material(smap=stored), now=NOW)
    group = [link for link in everything(doc) if link["support"]["pages"] == [6, 7] and link["origin"] == "pipeline"]
    assert group and all(link["quality"]["group_mapping"]["state"] == state and link["support"]["scope"] == "build_group" for link in group)
    result = enriched(material(smap=stored), smap=stored)
    assert_exactly_one_of_ranges_or_state(result)
    assert slide(result, 6)["ranges"] and [r["range_id"] for r in slide(result, 6)["ranges"]] == [r["range_id"] for r in slide(result, 7)["ranges"]]
    # A group the detector inferred stays "generated" beside it: a correction elsewhere confirms nothing about pages 2-4.
    assert next(s for s in tl.slides_from_map(stored)["logical_slides"] if s["pages"] == [2, 3, 4])["group_mapping"]["state"] == "generated"


def test_the_served_source_map_block_is_read_for_its_grouping_state_too():
    """``slide_identity`` serves ``grouping`` as an object ``{basis, state, …}``; that spelling must not break the reader."""
    served = {"state": "ready", "map_revision": "maprev0000000001", "page_count": 9, "logical_slides": [
        {"id": "ls-syn-p6-7", "kind": "manual_group", "pages": [6, 7], "role": "instructional", "grouping": {"basis": "override", "state": "human_confirmed", "confidence": None, "signals": []}},
        {"id": "ls-syn-p5", "kind": "single", "pages": [5], "role": "instructional", "grouping": {"basis": "page", "state": "generated", "confidence": None, "signals": []}}]}
    block = tl.slides_from_map(served)
    by_pages = {tuple(s["pages"]): s for s in block["logical_slides"]}
    assert by_pages[(6, 7)]["group_mapping"]["state"] == "human_confirmed" and by_pages[(5,)]["group_mapping"]["state"] == "generated"
    assert block["map_revision"] == "maprev0000000001" and block["page_count"] == 9


@pytest.mark.parametrize("author,op,state", [("learner", {"type": "group", "pages": [2, 3], "kind": "manual_group"}, "human_confirmed"),
                                             ("agent", {"type": "group", "pages": [1, 2], "kind": "incremental_build"}, "agent_reviewed")])
def test_after_a_grouping_correction_of_the_real_source_map_everything_still_builds_and_reads(local, journal, tmp_path, author, op, state):
    """The correction is made through ``sourcemap.apply_override`` itself, so the stored history has the shape that
    module writes. Before the fix every entry point below raised ``TypeError: unhashable type: 'dict'``."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from lecture_brain import sourcemap
    from lecture_brain.ownerio.inventory import primary_deck
    from lecture_brain.projections import Projector

    lecture_id = "lecture-02"
    import_generation(local, journal, tmp_path / "out" / "gen-l02", transcript_lines(local, lecture_id), name="gen-l02", step_ms=4_000, lecture_id=lecture_id)
    before = tl.build(local, "be505", lecture_id, now=lambda: NOW)
    lecture = unit(local, lecture_id)["lecture"]
    deck = primary_deck(lecture)
    course_before = tree(local.course("be505").root)
    sourcemap.apply_override(local, "be505", deck, op, author=author, reason="synthetic correction for a test", lecture=lecture, now=NOW)
    stored = sourcemap.load_or_build(local, "be505", deck, lecture=lecture)
    assert isinstance(stored["overrides"]["history"][0]["author"], dict), "the shape this test is about"
    joined = next(s for s in tl.slides_from_map(stored)["logical_slides"] if s["pages"] == op["pages"])
    assert joined["group_mapping"]["state"] == state
    stale = tl.read(local, "be505", lecture_id, current_inputs=tl.current_inputs(local, "be505", lecture_id))
    assert stale["state"] == "stale" and stale["differs"] == ["map_revision"] and stale["links"] == []  # the map changed: the earlier suggestions are not current
    rebuilt = tl.build(local, "be505", lecture_id, now=lambda: NOW)
    assert rebuilt["inputs"]["map_revision"] == stored["map_revision"] != before["inputs"]["map_revision"]
    assert all(link["quality"]["group_mapping"]["state"] == state for link in everything(rebuilt) if link["support"]["pages"] == op["pages"] and link["origin"] == "pipeline")
    preparation = Preparation(local, converter=None, now=lambda: NOW)
    projector = Projector(local, journal, preparation=preparation, now=lambda: NOW)
    the_view = tl.enrich_view(local, "be505", lecture_id, projector.lecture_view("be505", lecture_id), preparation=preparation)
    assert the_view["timing"]["stage"] == "associated" and the_view["timing"]["recordings"][0]["association"]["state"] == "current"
    assert {row["lecture_id"]: row["stage"] for row in tl.status(local, "be505")["lectures"]}[lecture_id] == "associated"
    app = FastAPI()
    tl.register(app, SimpleNamespace(settings=local, journal=journal, preparation=preparation, now=lambda: NOW, projector=projector), lambda fn: fn())
    client = TestClient(app)
    assert client.get("/api/courses/be505/timing").status_code == 200
    assert client.post(f"/api/courses/be505/lectures/{lecture_id}/timing/build").status_code == 200
    assert tree(local.course("be505").root) == course_before  # the correction and the links live in the app's private area


# ---- closing round, major 1: speech the transcript has no timed line for -------------------------------------------------
def outside(doc) -> list[dict]:
    return [u for u in doc["unassigned"] if u["reason"] == "speech_without_timed_line"]


@pytest.mark.parametrize("kept,page,missing", [(LINES[:12], 7, (13, 17)),                                              # the transcript stops early: lines 13-17 are not in it
                                               (LINES[:LINE_OF["oven"][0] - 1] + LINES[LINE_OF["oven"][1]:], 6, LINE_OF["oven"])])  # the transcript skips a stretch
def test_speech_the_transcript_has_no_line_for_is_listed_as_unassigned_and_is_never_nothing_was_said(kept, page, missing):
    """The windows of an accepted text alignment are the timed transcript lines. What the recording says outside every
    one of them was not compared with any slide, so a page spoken only there must not read "not discussed" (R2-T9)."""
    mat = material(lines=kept, spoken=LINES)
    doc = tl.compose(mat, now=NOW)
    record = doc["recordings"][0]
    assert record["stages"]["text_alignment"]["state"] == "accepted" and record["stages"]["text_alignment"]["lines_aligned"] == len(kept)
    first, last = (missing[0] - 1) * STEP, missing[1] * STEP  # where the sentences the transcript lacks were said
    (stretch,) = outside(doc)
    words = [w for segment in mat["recordings"][0]["generated"]["segments"] for w in segment["words"] if first <= w["start_ms"] < last]
    assert (stretch["start_ms"], stretch["end_ms"], stretch["words"]) == (words[0]["start_ms"], words[-1]["end_ms"], len(words))  # measured word times, nothing rounded outwards
    assert stretch["between"] == [] and stretch["best"] is None and stretch["transcript_lines"] == [] and stretch["recording_source_id"] == RECORDING["source_id"]
    assert doc["speech_outside"] == [{"recording_source_id": RECORDING["source_id"], "start_ms": stretch["start_ms"], "end_ms": stretch["end_ms"], "words": len(words), "within": None}]
    assert doc["speech_outside_rule"] == tl.SPEECH_OUTSIDE_RULE
    assert not any(link["start_ms"] < stretch["end_ms"] and stretch["start_ms"] < link["end_ms"] for link in everything(doc))
    association = record["stages"]["association"]
    assert association["all_speech_windowed"] is False
    assert record["stages"]["windows"]["speech_outside"] == {"intervals": 1, "ms": stretch["end_ms"] - stretch["start_ms"], "words": len(words)}
    assert association["unassigned_ms"] == sum(u["end_ms"] - u["start_ms"] for u in doc["unassigned"]) and association["unassigned"] == len(doc["unassigned"])
    result = enriched(mat)
    assert_exactly_one_of_ranges_or_state(result)
    state = slide(result, page)["no_range"]
    assert state["state"] == "audio_unprocessed" and state["detail"]["reason"] == "speech_without_timed_line", "never not_discussed: the talk about this page is in the stretch nobody matched"
    assert "nothing was said" not in state["text"] and "whole recording was processed and matched" not in state["text"]
    assert state["detail"]["not_matched"] == [[RECORDING["source_id"], stretch["start_ms"], stretch["end_ms"]]]
    assert not any(row["no_range"] and row["no_range"]["state"] == "not_discussed" for row in result["slides"])


def test_a_transcript_that_accounts_for_all_recognised_speech_leaves_nothing_outside_and_keeps_not_discussed():
    doc = tl.compose(material(), now=NOW)
    assert outside(doc) == [] and doc["recordings"][0]["stages"]["association"]["all_speech_windowed"] is True
    assert doc["recordings"][0]["stages"]["windows"]["speech_outside"] == {"intervals": 0, "ms": 0, "words": 0}
    # Fillers between two lines are not speech about anything: a stretch without one content word is not listed.
    spoken = list(LINES)
    spoken.insert(6, "um so and the")
    quiet = tl.compose(material(spoken=spoken, steps=[STEP] * 6 + [2_000] + [STEP] * (len(LINES) - 6)), now=NOW)
    assert outside(quiet) == [] and quiet["recordings"][0]["stages"]["association"]["all_speech_windowed"] is True
    # A line said in other words has no time. Its speech lies inside the suggestion that bridges it: it is kept with measured word
    # times and the range it lies in, is not listed a second time as unassigned, and still nothing reads not_discussed.
    other = list(LINES)
    other[10] = "Then someone asked whether the exam would cover the history of the bakery guilds."
    mat = material(spoken=other)
    said = tl.compose(mat, now=NOW)
    (stretch,) = said["speech_outside"]
    (oven,) = of_pages(said, [6])
    assert 100_000 <= stretch["start_ms"] < stretch["end_ms"] <= 110_000 and stretch["within"] == {"kind": "range", "range_id": oven["range_id"]}
    assert outside(said) == [] and said["recordings"][0]["stages"]["association"]["all_speech_windowed"] is False
    pieces = sorted((piece["start_ms"], piece["end_ms"]) for piece in [*everything(said), *said["unassigned"]] if piece.get("origin", "pipeline") == "pipeline")
    assert all(first[1] <= second[0] for first, second in zip(pieces, pieces[1:])), "suggested ranges and unassigned intervals never overlap"
    state = slide(enriched(mat), 8)["no_range"]
    assert state["state"] == "audio_unprocessed" and state["detail"]["reason"] == "transcript_lines_without_time" and state["detail"]["not_matched"] == []
    assert state["text"].startswith("The recording is transcribed, but 1 transcript line could not be given a time and 0:0") and state["detail"]["coverage"][0]["lines_without_time"] == 1
    assert state["detail"]["coverage"][0]["speech_without_timed_line_ms"] == stretch["end_ms"] - stretch["start_ms"]
    # Stale links withhold these intervals with everything else.
    changed = copy.deepcopy(said["inputs"])
    changed["map_revision"] = "maprev0000000002"
    assert tl.evaluate(said, changed)["speech_outside"] == [] and tl.evaluate(said, copy.deepcopy(said["inputs"]))["speech_outside"] == said["speech_outside"]
    # With windows of generated segments (no usable transcript) every recognised word is in a window already.
    segments = tl.compose(material(transcript="none"), now=NOW)
    assert outside(segments) == [] and segments["recordings"][0]["stages"]["association"]["all_speech_windowed"] is True


# ---- closing round, major 2 and the rejection findings -------------------------------------------------------------------
def sections_of(result, page) -> list[dict]:
    return [r for r in slide(result, page)["ranges"] if r["support"]["scope"] == "section"]


def test_a_rejection_on_one_page_leaves_the_courses_section_range_on_the_other_pages_it_names():
    """A section link is the course's own statement about several pages. The learner who rejects it on the page they
    are looking at has judged that page, not the others."""
    mat = material(pairings=[pairing([5, 7, 8], [LINE_OF["oven"]])])
    (section,) = of_pages(tl.compose(mat, now=NOW), [5, 7, 8], origin="reviewed_source_map")
    rejected = annotation("ann-syn-rejected-section", 8, section["start_ms"], section["end_ms"], review_state="rejected")
    result = enriched(mat, annotations=[rejected])
    assert sections_of(result, 8) == [] and len(sections_of(result, 5)) == 1 and len(sections_of(result, 7)) == 1
    assert sections_of(result, 5)[0]["range_id"] == section["range_id"]
    state = slide(result, 8)["no_range"]
    assert state["detail"]["rejected_suggestions"] == 1 and state["state"] != "ambiguous"
    assert "rejected" in state["text"] and "nothing was found for this page" not in state["text"], "something was found for this page and the learner said no"
    assert_exactly_one_of_ranges_or_state(result)
    # A build group is one logical slide: a rejection on one of its builds is about the slide, so it holds on all three.
    yeast = of_pages(tl.compose(material(), now=NOW), [2, 3, 4])[0]
    on_build = annotation("ann-syn-rejected-build", 3, yeast["start_ms"], yeast["end_ms"], review_state="rejected")
    builds = enriched(annotations=[on_build])
    assert [len(slide(builds, page)["ranges"]) for page in (2, 3, 4)] == [1, 1, 1] and len(slide(enriched(), 2)["ranges"]) == 2


def test_the_same_occurrence_means_most_of_the_suggestion_not_any_touch():
    gluten_start = (LINE_OF["gluten"][0] - 1) * STEP
    (suggestion,) = slide(enriched(), 5)["ranges"]
    assert suggestion["end_ms"] - suggestion["start_ms"] > 20_000
    # A two-second rejection that touches the suggestion by under a second is about other audio.
    touching = annotation("ann-syn-touch", 5, suggestion["start_ms"] - 1_500, suggestion["start_ms"] + 500, review_state="rejected")
    assert [r["range_id"] for r in slide(enriched(annotations=[touching]), 5)["ranges"]] == [suggestion["range_id"]]
    # A one-second link of the learner's own does not make a thirty-second suggestion disappear from the page.
    the_view = view()
    the_view["slides"][4]["occurrences"] = [listed(annotation("ann-syn-one-second", 5, gluten_start + 1_000, gluten_start + 2_000))]
    ranges = slide(enriched(the_view=the_view), 5)["ranges"]
    assert [r["annotation_id"] for r in ranges] == ["ann-syn-one-second", None] and ranges[1]["range_id"] == suggestion["range_id"]
    # A rejection of exactly the suggested stretch removes it, and the page says what happened instead of "nothing was found".
    exact = annotation("ann-syn-exact", 5, suggestion["start_ms"], suggestion["end_ms"], review_state="rejected")
    state = slide(enriched(annotations=[exact]), 5)["no_range"]
    assert state["state"] == "not_discussed" and state["detail"] == {"rejected_suggestions": 1}
    assert state["text"] == "The one suggestion for this page was rejected; nothing else was found for it in the recording."


# ---- closing round, the smaller findings ---------------------------------------------------------------------------------
def test_an_unconfigured_course_is_refused_with_the_modules_own_error(local):
    for call in (lambda: tl.build(local, "nope", "lecture-01", now=lambda: NOW), lambda: tl.read(local, "nope", "lecture-01", current_inputs=None),
                 lambda: tl.current_inputs(local, "nope", "lecture-01"), lambda: tl.status(local, "nope")):
        with pytest.raises(tl.TimingLinksError) as refused:
            call()
        assert refused.value.code == "unknown_course"


def test_a_stored_document_that_no_longer_matches_its_own_revision_is_not_served(local, journal, tmp_path):
    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    built = tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    inputs = tl.current_inputs(local, "be505", "lecture-01")
    assert tl.read(local, "be505", "lecture-01", current_inputs=inputs)["state"] == "current"
    stored = json.loads(links_path(local).read_text(encoding="utf-8"))
    stored["links"][0]["start_ms"] += 5_000  # the inputs block still matches; the links are no longer the ones that were built
    links_path(local).write_bytes(c.dump_json(stored))
    altered = tl.read(local, "be505", "lecture-01", current_inputs=inputs)
    assert altered["state"] == "missing" and altered["reason"] == "revision_mismatch" and altered["links"] == [] and altered["line_times"] == []
    assert tl.build(local, "be505", "lecture-01", now=lambda: NOW)["links_revision"] == built["links_revision"]
    assert tl.read(local, "be505", "lecture-01", current_inputs=inputs)["state"] == "current"


def test_a_persons_link_to_a_recording_that_is_gone_is_kept_and_said_but_not_offered_to_play():
    mine = annotation("ann-syn-p5", 5, 34_000, 51_000)
    gone = view(recordings="unreadable")
    gone["slides"][4]["occurrences"] = [listed(mine)]
    result = tl.enrich(gone, source_map=source_map(), links=None, generated={})
    row = slide(result, 5)
    assert row["ranges"] == [] and row["no_range"]["state"] == "recording_unavailable"
    assert row["no_range"]["detail"]["links_without_recording"] == [{"annotation_id": "ann-syn-p5", "recording_source_id": RECORDING["source_id"], "start_ms": 34_000, "end_ms": 51_000,
                                                                     "review_state": "human_confirmed"}]
    assert "kept" in row["no_range"]["text"] and gone["slides"][4]["occurrences"] == [listed(mine)], "the record itself is untouched"
    assert "links_without_recording" not in slide(result, 6)["no_range"]["detail"]
    assert_exactly_one_of_ranges_or_state(result)
    # No recording listed at all (its file was removed from the session): the same.
    none = view(recordings="none")
    none["slides"][4]["occurrences"] = [listed(mine)]
    assert slide(tl.enrich(none, source_map=source_map(), links=None, generated={}), 5)["ranges"] == []
    # With the recording there, it is the first range as before.
    there = view()
    there["slides"][4]["occurrences"] = [listed(mine)]
    assert slide(enriched(the_view=there), 5)["ranges"][0]["annotation_id"] == "ann-syn-p5"


def test_a_deck_without_any_slide_text_says_no_adequate_method_not_that_matching_has_yet_to_run():
    blank = source_map()
    for page in blank["pages"]:
        page["text"] = ""  # a scanned deck: pages, titles from elsewhere, no text layer
    mat = material(smap=blank)
    doc = tl.compose(mat, now=NOW)
    assert doc["recordings"][0]["stages"]["association"]["cause"] == "no_slide_text"
    result = tl.enrich(view(), source_map=blank, links=tl.evaluate(doc, copy.deepcopy(doc["inputs"])), generated={RECORDING["source_id"]: mat["recordings"][0]["generated"]})
    state = slide(result, 5)["no_range"]
    assert state["state"] == "association_not_run" and state["detail"] == {"cause": "no_adequate_method", "differs": [], "reason": "no_slide_text"}
    assert "no readable text" in state["text"] and "has not run" not in state["text"]
    association = result["timing"]["recordings"][0]["association"]
    assert association["state"] == "not_run" and association["cause"] == "no_adequate_method"
    # Nothing built yet stays "not run": running it would help.
    waiting = tl.enrich(view(), source_map=source_map(), links=None, generated={RECORDING["source_id"]: generation(LINES)})
    assert slide(waiting, 5)["no_range"]["detail"]["cause"] == "not_run" and "has not run" in slide(waiting, 5)["no_range"]["text"]


def test_a_page_never_lists_the_same_stretch_twice():
    """A suggestion for the page and a course-stated section can have the very same ends (the section's lines are the
    occurrence's lines). The page shows the suggestion, which already names the course's pairing in its basis."""
    mat = material(pairings=[pairing([5], [LINE_OF["gluten"]])])
    doc = tl.compose(mat, now=NOW)
    (suggestion,), (section,) = of_pages(doc, [5]), of_pages(doc, [5], origin="reviewed_source_map")
    assert (suggestion["start_ms"], suggestion["end_ms"]) == (section["start_ms"], section["end_ms"]), "the case this test is about"
    ranges = slide(enriched(mat), 5)["ranges"]
    assert [r["range_id"] for r in ranges] == [suggestion["range_id"]] and "The course's own record" in ranges[0]["quality"]["association"]["basis"]
    assert ranges[0]["why"].endswith("The course's own record places these transcript lines with this page as well.") and ranges[0]["origin"] == "pipeline"
    assert "course's own record" not in slide(enriched(), 5)["ranges"][0]["why"]  # without the statement the sentence is not there
    assert len(doc["links"]) == len({link["range_id"] for link in doc["links"]})  # both stay in the document


def test_the_times_of_aligned_lines_reach_the_transcript_of_the_lecture_view_and_no_other_line_gets_one():
    spoken = list(LINES)
    spoken[10] = "Then someone asked whether the exam would cover the history of the bakery guilds."  # line 11 was said in other words
    mat = material(spoken=spoken)
    the_view = view()
    by_hand = {"annotation_id": "ann-syn-lines", "review_state": "confirmed", "start": 4, "end": 4, "start_ms": 30_500, "end_ms": 39_000, "recording_source_id": RECORDING["source_id"]}
    the_view["transcripts"] = [dict(TRANSCRIPT, filename="Synthetic transcript.txt", lines=list(LINES), line_times=[dict(by_hand)], timing="annotated"),
                               dict(TRANSCRIPT, source_id="src-syn-other-transcript", filename="Another file.txt", lines=[], line_times=[], timing="untimed")]
    result = enriched(mat, the_view=the_view)
    own, other = result["transcripts"]
    assert own["line_times"] == [by_hand], "a person's line link is not replaced or rewritten"
    rows = {row["line"]: row for row in own["generated_line_times"]}
    assert sorted(rows) == [n for n in range(1, len(LINES) + 1) if n != 11] and set(rows[1]) == {"line", "start_ms", "end_ms", "recording_source_id", "review_state", "method"}
    stored = {row["line"]: row for row in tl.compose(mat, now=NOW)["line_times"]}
    assert all((rows[n]["start_ms"], rows[n]["end_ms"], rows[n]["recording_source_id"]) == (stored[n]["start_ms"], stored[n]["end_ms"], RECORDING["source_id"]) for n in rows)
    assert rows[1]["review_state"] == "generated" and rows[1]["method"] == {"name": "anchored-token-alignment", "version": "2"}
    assert own["text_alignment"] == [{"recording_source_id": RECORDING["source_id"], "state": "accepted", "reason": None, "lines_aligned": len(LINES) - 1, "lines_total": len(LINES),
                                      "method": {"name": "anchored-token-alignment", "version": "2"}}]
    assert other["generated_line_times"] == [] and other["text_alignment"] == []
    # Stale links give no line a time.
    doc = tl.compose(mat, now=NOW)
    changed = copy.deepcopy(doc["inputs"])
    changed["transcript"] = dict(changed["transcript"], sha256="9" * 64)
    stale_view = view()
    stale_view["transcripts"] = [dict(TRANSCRIPT, filename="Synthetic transcript.txt", lines=list(LINES), line_times=[], timing="untimed")]
    stale = tl.enrich(stale_view, source_map=source_map(), links=tl.evaluate(doc, changed), generated={RECORDING["source_id"]: mat["recordings"][0]["generated"]})
    assert stale["transcripts"][0]["generated_line_times"] == [] and stale["transcripts"][0]["text_alignment"] == []


def test_the_slide_input_is_the_one_slide_identity_builds_from_the_same_map():
    from lecture_brain import slide_identity

    stored = corrected_map({"kind": "learner", "ref": None})
    mine = tl.slides_from_map(stored)["logical_slides"]
    theirs = slide_identity.alignment_slides(stored)
    keys = ("slide_id", "pages", "title", "text", "role")  # everything the engine scores with
    assert [{k: row[k] for k in keys} for row in mine] == [{k: row[k] for k in keys} for row in theirs]
    assert [row["grouping"] for row in mine] == [row["grouping"] for row in theirs]


def test_the_queue_row_carries_what_the_speech_runner_reports_and_no_invented_position(local, journal, tmp_path, monkeypatch):
    from lecture_brain import speech

    source_id = unit(local)["recording"]["source_id"]
    other = unit(local, "lecture-02")["recording"]["source_id"]
    report = {"allowance": {"ceiling_seconds": 14_400, "used_seconds": 100, "remaining_seconds": 14_300, "ledger": "ok"}, "resume_command": "python -m lecture_brain speech-run",
              "courses": {"be505": {"recordings": [{"source_id": other, "state": "complete", "chunks_done": 2, "chunks_total": 2, "seconds_covered": 60.0},
                                                   {"source_id": source_id, "state": "queued", "chunks_done": 0, "chunks_total": 3, "seconds_covered": 0.0}]}}}
    monkeypatch.setattr(speech, "status", lambda settings: report)
    rows = {r["source_id"]: r["queue"] for lecture in tl.status(local, "be505")["lectures"] for r in lecture["recordings"]}
    assert rows[source_id] == {"state": "queued", "chunks_done": 0, "chunks_total": 3, "seconds_covered": 0.0}
    assert rows[other] == {"state": "complete", "chunks_done": 2, "chunks_total": 2, "seconds_covered": 60.0}, "a finished recording has no place in a queue"


def test_a_page_cut_free_by_a_learner_and_by_an_agent_is_only_agent_reviewed_as_the_map_itself_says():
    """The weakest author decides, exactly as ``slide_identity.grouping_state`` words the map: a correction an agent
    took part in was not confirmed by a person, and an author nobody recorded confirms nothing."""
    learner, agent = {"author": {"kind": "learner", "ref": None}}, {"author": {"kind": "agent", "ref": "review"}}
    slide = {"grouping": "override", "overrides": [1, 2], "pages": [4], "kind": "single"}
    assert tl._grouping_state(slide, {1: learner, 2: agent}) == "agent_reviewed"
    assert tl._grouping_state(slide, {1: learner, 2: learner}) == "human_confirmed"
    assert tl._grouping_state(slide, {1: learner, 2: {"author": None}}) == "generated"
    assert tl._grouping_state(dict(slide, overrides=[]), {}) == "generated"


def test_the_course_readback_can_leave_out_the_transcription_queue_and_then_never_asks_the_runner(local, journal, tmp_path, monkeypatch):
    """Study only needs stages and ranges per lecture; the runner's queue readback walks every course and is asked for
    only where it is shown (Settings)."""
    import lecture_brain.speech as speech

    def refuse(*_args, **_kwargs):
        raise AssertionError("the transcription runner's readback was asked for although it was not wanted")

    full = tl.status(local, "be505")
    monkeypatch.setattr(speech, "status", refuse)
    lean = tl.status(local, "be505", queue=False)
    assert lean["allowance"] is None and lean["resume_command"] is None and lean["queue_included"] is False and full["queue_included"] is True
    assert [row["lecture_id"] for row in lean["lectures"]] == [row["lecture_id"] for row in full["lectures"]]
    assert all(recording["queue"] is None for lecture in lean["lectures"] for recording in lecture["recordings"])
    assert [lecture["stage"] for lecture in lean["lectures"]] == [lecture["stage"] for lecture in full["lectures"]]
