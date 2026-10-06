"""Experience repair v2, phase 4: the ONE resumable offline transcription runner.

Everything here is synthetic. No speech model runs and no real recording is read: the supervisor launches a clearly
LABELLED fake worker (``fake_speech_worker.py``) that follows the worker protocol and fabricates deterministic words
from clock positions. What is proven is the runner — the durable allowance, the frozen queue, chunk planning and
merging, resumption, stopping, source conflicts, and publication through the application importer.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

from lecture_brain.derived import Derived
from lecture_brain.journal import Journal
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.speech import chunks as ch
from lecture_brain.speech import runner as rn
from lecture_brain.speech.ledger import Allowance, LedgerRefused

FAKE_WORKER = Path(__file__).with_name("fake_speech_worker.py")
# The lease is longer than one refresh can be held up on a loaded machine (a file that cannot be replaced is retried for 1.2 s before the refresh gives up
# for this look): at 1.5 s a single held-up refresh ended a run in about one of ten fresh processes while other work ran on this machine.
FAST = {"poll_seconds": 0.02, "heartbeat_seconds": 0.1, "lease_seconds": 3.0, "stall_seconds": 30.0, "terminate_wait_seconds": 0.5}
GRANT = "synthetic-test-grant-1"
L1 = "be505/src-lecture-01-recording"  # 60 s synthetic tone, registered in the fixture course index


# ---- the chunk plan and the merge (pure) ------------------------------------------------------------------------------
def test_the_chunk_plan_is_fixed_windows_of_media_time_with_a_small_overlap_and_a_partial_last_chunk():
    assert ch.plan_chunks(60_000, 25_000, 2_000) == [{"index": 0, "start_ms": 0, "end_ms": 27_000}, {"index": 1, "start_ms": 25_000, "end_ms": 52_000},
                                                     {"index": 2, "start_ms": 50_000, "end_ms": 60_000}]  # the last chunk is partial: 10 s
    assert ch.plan_chunks(6_000, 25_000, 2_000) == [{"index": 0, "start_ms": 0, "end_ms": 6_000}]  # shorter than one chunk
    assert ch.plan_chunks(27_000, 25_000, 2_000) == [{"index": 0, "start_ms": 0, "end_ms": 27_000}]  # no extra chunk for a tail the overlap already covers
    assert [c["end_ms"] for c in ch.plan_chunks(27_001, 25_000, 2_000)] == [27_000, 27_001]
    real = ch.plan_chunks(5_818_965, 600_000, 5_000)  # a 97-minute recording in ten-minute windows
    assert len(real) == 10 and real[0] == {"index": 0, "start_ms": 0, "end_ms": 605_000} and real[-1] == {"index": 9, "start_ms": 5_400_000, "end_ms": 5_818_965}
    assert all(later["start_ms"] + 5_000 == earlier["end_ms"] for earlier, later in zip(real, real[1:]))  # every neighbour pair overlaps by exactly 5 s
    for bad in ((0, 25_000, 2_000), (60_000, 500, 0), (60_000, 25_000, -1), (60_000, 25_000, 13_000)):
        with pytest.raises(ValueError):
            ch.plan_chunks(*bad)


def chunk(plan, index, words, *, decoded_ms=None, end_of_stream=False, per_segment=3):
    """A chunk result as a worker writes it: words in chunk-LOCAL seconds, grouped into segments, plus the chunk offset."""
    entry = plan[index]
    rows = [{"text": text, "start": start, "end": end, "probability": probability} for text, start, end, probability in words]
    segments = [{"start": rows[i]["start"], "end": rows[min(i + per_segment, len(rows)) - 1]["end"], "text": " ".join(r["text"] for r in rows[i:i + per_segment]),
                 "words": rows[i:i + per_segment]} for i in range(0, len(rows), per_segment)]
    return {"index": index, "offset_ms": entry["start_ms"], "end_ms": entry["end_ms"], "decoded_ms": entry["end_ms"] - entry["start_ms"] if decoded_ms is None else decoded_ms,
            "end_of_stream": end_of_stream, "segments": segments}


def merged_words(merged) -> list[tuple]:
    return [(w["text"], w["start_ms"], w["end_ms"]) for s in merged["segments"] for w in s.get("words", [])]


def test_merging_keeps_each_overlap_word_from_exactly_one_chunk_by_its_midpoint_and_applies_each_offset_once():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)  # overlaps [25, 27] s and [50, 52] s; the dividing lines are 26 s and 51 s
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("b", 24.0, 24.4, 0.1), ("early", 25.2, 25.6, 0.1), ("late", 26.2, 26.6, 0.1)])
    second = chunk(plan, 1, [("early", 0.2, 0.6, 0.2), ("late", 1.2, 1.6, 0.2), ("c", 10.0, 10.5, 0.2), ("edge", 25.9, 26.3, 0.2)])  # local seconds; the chunk starts at 25 s
    third = chunk(plan, 2, [("edge", 0.9, 1.3, 0.3), ("d", 5.0, 5.5, 0.3)], end_of_stream=True)

    merged = ch.merge_prefix(plan, [first, second, third], duration_ms=60_000, tolerance_ms=500)

    # "early" (midpoint 25.4 s) is before the 26 s line: kept from the first chunk. "late" (26.4 s) is after it: kept from the second.
    # "edge" has its midpoint at 51.1 s, after the 51 s line: kept from the third chunk only.
    assert merged_words(merged) == [("a", 1_000, 1_500), ("b", 24_000, 24_400), ("early", 25_200, 25_600), ("late", 26_200, 26_600), ("c", 35_000, 35_500), ("edge", 50_900, 51_300),
                                    ("d", 55_000, 55_500)]
    by_text = {w["text"]: w for s in merged["segments"] for w in s["words"]}
    assert by_text["early"]["probability"] == 0.1 and by_text["late"]["probability"] == 0.2 and by_text["edge"]["probability"] == 0.3
    assert merged["window"] == {"start_ms": 0, "end_ms": 60_000} and merged["complete"] is True and merged["chunks"] == 3
    assert merged["stats"]["words_in"] == 10 and merged["stats"]["words"] == 7 and merged["stats"]["dropped_overlap_words"] == 3 and merged["stats"]["dropped_out_of_bounds_words"] == 0
    # Segments come out ordered, numbered from 0, in the importer's shape, with clip time equal to recording time (offset 0).
    assert [s["index"] for s in merged["segments"]] == list(range(len(merged["segments"])))
    assert all(s["clip_start_ms"] < s["clip_end_ms"] and s["text"] for s in merged["segments"])
    assert [s["clip_start_ms"] for s in merged["segments"]] == sorted(s["clip_start_ms"] for s in merged["segments"])
    assert merged["segments"][0]["text"] == "a b early" and merged["segments"][1]["text"] == "late c"  # a segment cut by the line keeps only its own words
    # The same inputs give the same result, byte for byte.
    assert json.dumps(ch.merge_prefix(plan, [first, second, third], duration_ms=60_000, tolerance_ms=500), sort_keys=True) == json.dumps(merged, sort_keys=True)


def test_a_processed_prefix_ends_where_its_last_chunk_ends_and_is_never_called_complete():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("late", 26.2, 26.6, 0.1)])
    second = chunk(plan, 1, [("late", 1.2, 1.6, 0.2), ("c", 10.0, 10.5, 0.2)])

    one = ch.merge_prefix(plan, [first], duration_ms=60_000, tolerance_ms=500)
    # With only the first chunk, everything it heard up to its end is kept: nothing else has those 27 seconds yet.
    assert merged_words(one) == [("a", 1_000, 1_500), ("late", 26_200, 26_600)] and one["window"] == {"start_ms": 0, "end_ms": 27_000} and one["complete"] is False
    two = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert merged_words(two) == [("a", 1_000, 1_500), ("late", 26_200, 26_600), ("c", 35_000, 35_500)] and two["window"]["end_ms"] == 52_000 and two["complete"] is False
    assert {w["text"]: w["probability"] for s in two["segments"] for w in s["words"]}["late"] == 0.2  # now owned by the second chunk
    with pytest.raises(ValueError):
        ch.merge_prefix(plan, [second], duration_ms=60_000, tolerance_ms=500)  # a prefix is contiguous from the first chunk
    with pytest.raises(ValueError):
        ch.merge_prefix(plan, [], duration_ms=60_000, tolerance_ms=500)


def test_silence_is_a_completed_chunk_without_words_and_words_outside_the_bounds_are_dropped_and_counted():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    first = chunk(plan, 0, [("before", -2.0, -1.5, 0.1), ("a", 1.0, 1.5, 0.1), ("pause", 3.0, 3.0, 0.1), ("far", 80.0, 80.5, 0.1)])  # one zero-length word, two impossible ones
    silent = chunk(plan, 1, [])
    last = chunk(plan, 2, [("d", 5.0, 5.5, 0.3), ("tail", 9.8, 10.3, 0.3), ("beyond", 12.0, 12.4, 0.3)], end_of_stream=True)  # the recording ends 10 s into this chunk

    merged = ch.merge_prefix(plan, [first, silent, last], duration_ms=60_000, tolerance_ms=500)

    assert merged_words(merged) == [("a", 1_000, 1_500), ("pause", 3_000, 3_000), ("d", 55_000, 55_500), ("tail", 59_800, 60_300)]  # within the stated 500 ms tolerance of the end
    assert merged["stats"]["dropped_out_of_bounds_words"] == 3 and merged["stats"]["zero_length_words"] == 1 and merged["stats"]["words"] == 4
    assert merged["complete"] is True and merged["window"] == {"start_ms": 0, "end_ms": 60_000} and merged["stats"]["silent_chunks"] == 1
    everything_silent = ch.merge_prefix(plan, [chunk(plan, 0, []), chunk(plan, 1, []), chunk(plan, 2, [], end_of_stream=True)], duration_ms=60_000, tolerance_ms=500)
    assert everything_silent["segments"] == [] and everything_silent["complete"] is True and everything_silent["window"]["end_ms"] == 60_000


def test_a_boundary_word_the_two_decodings_time_differently_is_kept_exactly_once():
    """Neighbouring chunks decode their overlap independently, so the same word gets slightly different times in each.
    A bare midpoint rule then keeps it twice (each chunk sees it on its own side of the middle) or not at all."""
    plan = ch.plan_chunks(60_000, 25_000, 2_000)  # overlap [25, 27] s, its middle at 26 s
    for left_time, right_time in (((25.70, 26.20), (25.80, 26.30)), ((25.80, 26.30), (25.70, 26.20))):  # by midpoints alone: published twice; published never
        first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("before", 25.10, 25.40, 0.1), ("same", *left_time, 0.1)])
        second = chunk(plan, 1, [("before", 0.12, 0.42, 0.2), ("Same,", round(right_time[0] - 25, 3), round(right_time[1] - 25, 3), 0.2), ("c", 10.0, 10.5, 0.2)])
        merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
        assert [w[0].lower().strip(",") for w in merged_words(merged)] == ["a", "before", "same", "c"], (left_time, right_time)
        assert merged["stats"]["overlap_matched_words"] == 2 and merged["stats"]["overlap_boundaries_spliced"] == 1 and merged["stats"]["overlap_boundaries_at_midpoint"] == 0
        assert merged["stats"]["dropped_overlap_words"] == 2 and merged["stats"]["words"] == 4  # one copy of each matched word went, nothing else
    assert ch.MATCH_TOLERANCE_MS == 250 and "matched word" in ch.OVERLAP_RULE


def test_the_overlap_is_spliced_at_a_word_both_decodings_agree_on_and_at_its_middle_only_when_none_matches():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    # Each decoding spells one word its own way, on its own side of the 26 s middle: by midpoints alone BOTH spellings would be published.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("gonna", 25.75, 26.05, 0.1), ("anchor", 26.30, 26.60, 0.1), ("tail", 26.70, 26.95, 0.1)])
    second = chunk(plan, 1, [("going", 0.90, 1.20, 0.2), ("anchor", 1.36, 1.66, 0.2), ("tale", 1.72, 1.97, 0.2), ("c", 10.0, 10.5, 0.2)])
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "gonna", "anchor", "tale", "c"]  # the first chunk up to the agreed word, the second from it on
    assert {w["text"]: w["probability"] for s in merged["segments"] for w in s["words"]}["anchor"] == 0.2  # its middle (26.48 s) lies after 26 s: the second chunk's copy
    assert merged["stats"]["overlap_matched_words"] == 1 and merged["stats"]["dropped_overlap_words"] == 3

    # A word said twice: the copy that is near in time is the same word, the other one is not.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("very", 25.45, 25.65, 0.1), ("very", 25.75, 25.95, 0.1), ("good", 26.30, 26.60, 0.1)])
    second = chunk(plan, 1, [("very", 0.78, 0.98, 0.2), ("good", 1.33, 1.63, 0.2), ("c", 10.0, 10.5, 0.2)])  # this chunk begins after the first "very"
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "very", "very", "good", "c"] and merged["stats"]["overlap_matched_words"] == 2

    # Nothing in the overlap is the same word in both: the middle of the overlap decides, and the result says so.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("x", 25.2, 25.6, 0.1), ("y", 26.2, 26.6, 0.1)])
    second = chunk(plan, 1, [("p", 0.3, 0.7, 0.2), ("q", 1.3, 1.7, 0.2), ("c", 10.0, 10.5, 0.2)])
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "x", "q", "c"]
    assert merged["stats"]["overlap_matched_words"] == 0 and merged["stats"]["overlap_boundaries_spliced"] == 0 and merged["stats"]["overlap_boundaries_at_midpoint"] == 1
    # The same word too far apart in time (more than the stated tolerance) is not taken for the same word.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("far", 25.20, 25.50, 0.1)])
    second = chunk(plan, 1, [("far", 1.30, 1.60, 0.2), ("c", 10.0, 10.5, 0.2)])  # 26.30 s: more than a second later
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "far", "far", "c"] and merged["stats"]["overlap_matched_words"] == 0


def test_withheld_text_is_cut_at_the_splice_and_the_merge_states_what_is_covered():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    # The first chunk loops from 8 s to 25.5 s and then hears two words; the second chunk hears the same two words and goes on.
    first = {"index": 0, "offset_ms": 0, "end_ms": 27_000, "decoded_ms": 27_000,
             "segments": [spoken(1.0, "a real sentence here"), loop_segment(8.0, 25.5), {"start": 26.0, "end": 26.9, "text": "back again", "compression_ratio": 1.2,
                                                                                      "words": [{"text": "back", "start": 26.0, "end": 26.3}, {"text": "again", "start": 26.5, "end": 26.9}]}]}
    second = {"index": 1, "offset_ms": 25_000, "end_ms": 52_000, "decoded_ms": 27_000,
              "segments": [{"start": 1.03, "end": 1.93, "text": "back again", "compression_ratio": 1.2, "words": [{"text": "back", "start": 1.03, "end": 1.33}, {"text": "again", "start": 1.52, "end": 1.93}]},
                           loop_segment(10.0, 20.0)]}  # 35 s .. 45 s of the recording
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4)
    assert [w[0] for w in merged_words(merged)] == "a real sentence here back again".split()
    by_text = {w["text"]: w for s in merged["segments"] for w in s["words"]}
    assert (by_text["back"]["start_ms"], by_text["again"]["end_ms"]) == (26_030, 26_930)  # both from the second chunk: the splice is at "back", whose middle lies after 26 s
    # Each withheld run is unresolved from the accepted text before it to the accepted text after it: in the first chunk from the end of "here"
    # (2.5 s) to the start of "back" (26 s); in the second from the end of "again" (26.93 s) to the end of its audio, because nothing follows its loop.
    assert merged["unresolved"] == [{"start_ms": 2_500, "end_ms": 26_000, "reason": "repetition_check_failed"}, {"start_ms": 26_930, "end_ms": 52_000, "reason": "repetition_check_failed"}]
    # Covered is exactly the processed stretch minus what was withheld; the two never overlap and together they are the window.
    assert merged["covered"] == [{"start_ms": 0, "end_ms": 2_500}, {"start_ms": 26_000, "end_ms": 26_930}]
    assert merged["stats"]["unresolved_ms"] == 48_570 and merged["stats"]["covered_ms"] == 3_430 and merged["window"] == {"start_ms": 0, "end_ms": 52_000}
    assert not [w for w in merged_words(merged) if any(i["start_ms"] < (w[1] + w[2]) / 2 < i["end_ms"] for i in merged["unresolved"])]  # no published word lies in unresolved time
    assert ch.subtract_intervals({"start_ms": 0, "end_ms": 10}, []) == [{"start_ms": 0, "end_ms": 10}]
    assert ch.subtract_intervals({"start_ms": 0, "end_ms": 10}, [{"start_ms": 0, "end_ms": 10}]) == []
    assert ch.subtract_intervals({"start_ms": 5, "end_ms": 20}, [{"start_ms": 0, "end_ms": 7}, {"start_ms": 9, "end_ms": 11}, {"start_ms": 18, "end_ms": 30}]) == [
        {"start_ms": 7, "end_ms": 9}, {"start_ms": 11, "end_ms": 18}]


def collapsed_loop(at: float | None, *, word="okay,", count=20) -> dict:
    """A repetition loop whose copies all sit at ONE instant, or carry no time at all: the failing segment has no span of its own."""
    stamp = {} if at is None else {"start": at, "end": at}
    return {**stamp, "text": " ".join([word] * count), "compression_ratio": 31.9, "words": [{"text": word, **stamp, "probability": 0.9} for _ in range(count)]}


def test_time_around_withheld_text_is_unresolved_from_the_accepted_text_before_it_to_the_accepted_text_after_it():
    """What a recogniser emits around a repetition loop cannot be read as silence. Where text is withheld, nothing is
    known from the end of the accepted text before it to the start of the accepted text after it — whatever times the
    failing segments carry themselves: a span, one instant for every copy, an end before the start, or no time at all.
    (A failing run without a span of its own used to leave NO unresolved time: the recording read as fully covered.)"""
    plan = ch.plan_chunks(60_000, 25_000, 2_000)

    def alone(*segments) -> dict:
        return ch.merge_prefix(plan, [{"index": 0, "offset_ms": 0, "end_ms": 27_000, "decoded_ms": 27_000, "segments": list(segments)}], duration_ms=60_000, tolerance_ms=500,
                               repetition_threshold=2.4)

    before, after = spoken(1.0, "a real sentence here"), spoken(20.0, "and it goes on")  # "here" ends at 2.5 s; "and" starts at 20 s
    for name, middle in (("a loop with a span of its own", [loop_segment(8.0, 12.0)]), ("every copy at one instant", [collapsed_loop(12.0)]), ("no times at all", [collapsed_loop(None)]),
                         ("an end before the start", [{**loop_segment(12.0, 12.0), "end": 9.0}]), ("two failing segments in a row", [collapsed_loop(9.0), loop_segment(11.0, 13.0)])):
        merged = alone(before, *middle, after)
        assert merged["unresolved"] == [{"start_ms": 2_500, "end_ms": 20_000, "reason": "repetition_check_failed"}], name
        assert [w[0] for w in merged_words(merged)] == "a real sentence here and it goes on".split(), name
        assert merged["covered"] == [{"start_ms": 0, "end_ms": 2_500}, {"start_ms": 20_000, "end_ms": 27_000}] and merged["stats"]["unresolved_ms"] == 17_500, name
        assert merged["stats"]["withheld_repetition_words"] >= 20 and merged["stats"]["withheld_repetition_runs"] == 1 and merged["stats"]["withheld_runs_without_time"] == 0, name
        assert not [w for w in merged_words(merged) if 2_500 < (w[1] + w[2]) / 2 < 20_000], name  # no published word lies in unresolved time
    # No accepted text before the withheld text in its chunk: unresolved from the chunk's start. None after it: to the end of the chunk's audio.
    assert alone(collapsed_loop(12.0), after)["unresolved"] == [{"start_ms": 0, "end_ms": 20_000, "reason": "repetition_check_failed"}]
    assert alone(before, collapsed_loop(12.0))["unresolved"] == [{"start_ms": 2_500, "end_ms": 27_000, "reason": "repetition_check_failed"}]
    nothing_else = alone(collapsed_loop(12.0))
    assert nothing_else["unresolved"] == [{"start_ms": 0, "end_ms": 27_000, "reason": "repetition_check_failed"}] and nothing_else["covered"] == [] and nothing_else["stats"]["covered_ms"] == 0
    # In a later chunk "the chunk's start" is where that chunk starts supplying the recording (here the middle of an overlap neither chunk heard a word in).
    first = {"index": 0, "offset_ms": 0, "end_ms": 27_000, "decoded_ms": 27_000, "segments": [before, after]}  # its last word ends at 21.5 s
    second = {"index": 1, "offset_ms": 25_000, "end_ms": 52_000, "decoded_ms": 27_000, "segments": [collapsed_loop(3.0), spoken(10.0, "speech goes on again")]}  # 35 s of the recording
    both = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4)
    assert both["unresolved"] == [{"start_ms": 26_000, "end_ms": 35_000, "reason": "repetition_check_failed"}] and both["stats"]["overlap_boundaries_at_midpoint"] == 1
    # Withheld text between two accepted words that touch stands for no time: nothing is unresolved, and the merge says that it withheld a run without time.
    def said(text: str, start: float, end: float) -> dict:
        return {"start": start, "end": end, "text": text, "compression_ratio": 1.2, "words": [{"text": text, "start": start, "end": end, "probability": 0.9}]}

    touching = alone(said("one", 1.0, 2.0), collapsed_loop(2.0), said("two", 2.0, 3.0))
    assert touching["unresolved"] == [] and [w[0] for w in merged_words(touching)] == ["one", "two"]
    assert (touching["stats"]["withheld_repetition_runs"], touching["stats"]["withheld_runs_without_time"], touching["stats"]["withheld_repetition_words"]) == (1, 1, 20)
    assert "accepted text" in ch.UNRESOLVED_RULE


def test_an_overlap_in_which_only_one_chunk_has_accepted_text_is_supplied_by_that_chunk():
    """No word of an overlap can match when one of the two chunks has no accepted text there at all: it heard nothing,
    or what it heard is withheld. The bare middle then dropped the other chunk's words on the far side of it."""
    plan = ch.plan_chunks(60_000, 25_000, 2_000)  # overlap [25, 27] s, its middle at 26 s

    def seams(merged) -> tuple:
        return tuple(merged["stats"][key] for key in ("overlap_boundaries_spliced", "overlap_boundaries_one_sided", "overlap_boundaries_at_midpoint", "dropped_overlap_words"))

    # 1. The later chunk has nothing in the overlap: the earlier chunk's words on both sides of the middle are published.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("x", 25.2, 25.6, 0.1), ("y", 26.2, 26.6, 0.1)])
    merged = ch.merge_prefix(plan, [first, chunk(plan, 1, [("c", 10.0, 10.5, 0.2)])], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "x", "y", "c"] and seams(merged) == (0, 1, 0, 0)
    # 2. The earlier chunk has nothing in the overlap: the later chunk's words there are published.
    later = chunk(plan, 1, [("p", 0.3, 0.7, 0.2), ("q", 1.3, 1.7, 0.2), ("c", 10.0, 10.5, 0.2)])
    merged = ch.merge_prefix(plan, [chunk(plan, 0, [("a", 1.0, 1.5, 0.1)]), later], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "p", "q", "c"] and seams(merged) == (0, 1, 0, 0)
    # 3. The earlier chunk's text in the overlap is WITHHELD (a loop up to its end): the later chunk's accepted words there are published, and the
    #    unresolved time ends where the later chunk takes over. No stretch is reported unresolved while words of it are published.
    looping = {"index": 0, "offset_ms": 0, "end_ms": 27_000, "decoded_ms": 27_000, "segments": [spoken(1.0, "a real sentence here"), loop_segment(22.0, 26.9)]}
    merged = ch.merge_prefix(plan, [looping, later], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4)
    assert [w[0] for w in merged_words(merged)] == "a real sentence here p q c".split() and seams(merged) == (0, 1, 0, 0)
    assert merged["unresolved"] == [{"start_ms": 2_500, "end_ms": 25_000, "reason": "repetition_check_failed"}]
    assert merged["covered"] == [{"start_ms": 0, "end_ms": 2_500}, {"start_ms": 25_000, "end_ms": 52_000}]
    # 4. A word that straddles the edge of the overlap is whole in one chunk and cut short in the other; it is still published once.
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("x", 25.2, 25.6, 0.1), ("lon", 26.7, 27.0, 0.1)])  # the beginning of a word, at the very end of this chunk
    second = chunk(plan, 1, [("longer", 1.7, 2.5, 0.2), ("c", 10.0, 10.5, 0.2)])  # the whole word, 26.7 s .. 27.5 s: its middle lies past the overlap
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "x", "longer", "c"] and seams(merged) == (0, 1, 0, 1)
    first = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("before", 24.4, 25.2, 0.1)])  # the whole word; its middle lies before the overlap
    second = chunk(plan, 1, [("fore", 0.0, 0.2, 0.2), ("q", 1.3, 1.7, 0.2), ("c", 10.0, 10.5, 0.2)])  # its tail, at the very start of this chunk
    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "before", "q", "c"] and seams(merged) == (0, 1, 0, 1)
    # 5. Neither chunk has anything in the overlap: its middle divides them, and nothing is dropped.
    merged = ch.merge_prefix(plan, [chunk(plan, 0, [("a", 1.0, 1.5, 0.1)]), chunk(plan, 1, [("c", 10.0, 10.5, 0.2)])], duration_ms=60_000, tolerance_ms=500)
    assert [w[0] for w in merged_words(merged)] == ["a", "c"] and seams(merged) == (0, 0, 1, 0)
    assert "only one" in ch.OVERLAP_RULE


def test_a_chunk_result_the_merge_could_not_read_is_named_before_anything_is_merged():
    """The supervisor's acceptance check let through results whose inside the merge then failed on (a number where the
    list of words belongs, a text where the decoding record belongs): an error in every later run instead of one
    refused result. What the merge and the publication read of a chunk result has a shape, and that shape is checked."""
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    good = chunk(plan, 0, [("a", 1.0, 1.5, 0.1), ("b", 3.0, 3.5, 0.1), ("c", 5.0, 5.5, 0.1), ("d", 7.0, 7.5, 0.1)])  # two segments

    def second_segment(**change) -> dict:
        return {**good, "segments": [good["segments"][0], {**good["segments"][1], **change}]}

    for fine in (good, {**good, "decoding": None}, {**good, "decoding": {"pass": "primary", "policy": "any"}}, second_segment(words=None), second_segment(words=[]), second_segment(text=None)):
        assert ch.result_problem(fine) is None, fine
    for bad, phrase in (({**good, "segments": "none"}, "list of segments"), ({**good, "segments": [good["segments"][0], "odd"]}, "segment 1 is not an object"), (second_segment(words=5), "segment 1: words"),
                        (second_segment(words={"text": "x"}), "segment 1: words"), (second_segment(words=[{"text": "x"}, "odd"]), "segment 1: a word"), (second_segment(text=7), "segment 1: text"),
                        ({**good, "decoding": "made by a later worker that writes this field differently"}, "decoding")):
        problem = ch.result_problem(bad)
        assert isinstance(problem, str) and phrase in problem, (bad, problem)
    # What the merge has always tolerated stays tolerated: times that are no numbers, words without a text, a word without times.
    tolerated = second_segment(start="soon", words=[{"text": None, "start": None, "end": "x"}, {"start": 1.0, "end": 1.2}, {"text": "kept", "start": 5.0, "end": 5.5}])
    assert ch.result_problem(tolerated) is None
    assert [w[0] for w in merged_words(ch.merge_prefix(plan, [tolerated], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4))] == ["a", "b", "c", "kept"]


# ---- output of a repetition loop is not text of the recording ---------------------------------------------------------
def loop_segment(start: float, end: float, *, word="okay,", count=20, ratio: float | None = 31.9) -> dict:
    """What a recogniser emits when it falls into a repetition loop: one word over and over, most copies with no duration."""
    return {"start": start, "end": end, "text": " ".join([word] * count), "words": [{"text": word, "start": start, "end": start, "probability": 0.9} for _ in range(count)],
            **({} if ratio is None else {"compression_ratio": ratio})}


def spoken(start: float, text: str, *, ratio=1.7) -> dict:
    return {"start": start, "end": start + 2.0, "text": text, "compression_ratio": ratio,
            "words": [{"text": word, "start": start + i * 0.4, "end": start + i * 0.4 + 0.3, "probability": 0.9} for i, word in enumerate(text.split())]}


def test_text_that_fails_the_repetition_check_is_withheld_and_its_time_is_reported_as_unresolved():
    plan = ch.plan_chunks(60_000, 25_000, 2_000)
    first = {"index": 0, "offset_ms": 0, "end_ms": 27_000, "decoded_ms": 27_000,
             "segments": [spoken(1.0, "a real sentence here"), loop_segment(8.0, 12.0), loop_segment(15.0, 19.0), loop_segment(22.0, 26.9)]}
    second = {"index": 1, "offset_ms": 25_000, "end_ms": 52_000, "decoded_ms": 27_000, "segments": [spoken(1.5, "speech goes on again"), spoken(10.0, "and it is fine")]}

    # The check itself: the recogniser's own measure above its own threshold, or one word making up half of a longer segment.
    assert ch.repetition_check_failed(loop_segment(0, 4), 2.4) and ch.repetition_check_failed(loop_segment(0, 4, ratio=None), 2.4)
    assert ch.repetition_check_failed(spoken(0, "dense text", ratio=2.5), 2.4) and not ch.repetition_check_failed(spoken(0, "a real sentence here"), 2.4)
    assert not ch.repetition_check_failed({"start": 0, "end": 1, "text": "yes yes yes", "words": [{"text": "yes"}] * 3}, 2.4)  # short repeats are ordinary speech
    assert not ch.repetition_check_failed(loop_segment(0, 4, count=7, ratio=None), 2.4) and ch.repetition_check_failed(loop_segment(0, 4, count=8, ratio=None), 2.4)
    stats = ch.repetition_stats(first["segments"], 2.4)
    assert stats == {"segments": 4, "words": 64, "failed_segments": 3, "failed_words": 60, "failed_seconds": 18.9}  # 8.0 s .. 26.9 s: the gaps inside the loop belong to it
    assert ch.needs_second_pass(stats) and not ch.needs_second_pass(ch.repetition_stats(second["segments"], 2.4))
    one_bad_window = [*(spoken(t, "ten ordinary words that fill up a segment of real talk") for t in range(0, 300, 3)), loop_segment(300.0, 320.0)]
    assert not ch.needs_second_pass(ch.repetition_stats(one_bad_window, 2.4))  # 20 of 1020 words in 20 s: withheld at the merge, not worth a second pass
    assert ch.needs_second_pass(ch.repetition_stats([*one_bad_window, loop_segment(330.0, 395.0)], 2.4))  # more than a minute is

    merged = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4)

    assert [w[0] for w in merged_words(merged)] == "a real sentence here speech goes on again and it is fine".split()
    # ONE interval for the three failing segments in a row: from the end of the accepted text before them (2.5 s) to where this chunk's share of the
    # recording ends. Nothing accepted follows in the chunk, and the next chunk — the only one with accepted text in the overlap — supplies from 25 s on.
    assert merged["unresolved"] == [{"start_ms": 2_500, "end_ms": 25_000, "reason": "repetition_check_failed"}]
    assert merged["stats"]["withheld_repetition_segments"] == 3 and merged["stats"]["withheld_repetition_words"] == 60 and merged["stats"]["unresolved_ms"] == 22_500
    assert merged["stats"]["withheld_repetition_runs"] == 1 and merged["stats"]["overlap_boundaries_one_sided"] == 1
    assert merged["stats"]["words"] == 12 and merged["stats"]["words_in"] == 72 and merged["window"]["end_ms"] == 52_000
    # As the last chunk of a prefix the interval runs to the end of the chunk's audio.
    alone = ch.merge_prefix(plan, [first], duration_ms=60_000, tolerance_ms=500, repetition_threshold=2.4)
    assert alone["unresolved"] == [{"start_ms": 2_500, "end_ms": 27_000, "reason": "repetition_check_failed"}] and [w[0] for w in merged_words(alone)] == "a real sentence here".split()
    # Without a threshold nothing is checked and nothing is withheld.
    unchecked = ch.merge_prefix(plan, [first, second], duration_ms=60_000, tolerance_ms=500)
    assert unchecked["unresolved"] == [] and unchecked["stats"]["unresolved_ms"] == 0 and unchecked["stats"]["withheld_repetition_segments"] == 0


def test_the_standalone_worker_carries_the_same_repetition_check_as_the_merge(repo):
    """The worker must run without the app, so it has its own copy of the check. The two copies must never disagree:
    the worker decides on a second pass with it, the merge decides what is withheld with it."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("speech_worker_copy", repo / "brain" / "src" / "lecture_brain" / "speech" / "worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)  # its top level imports the standard library only
    cases = [loop_segment(0, 4), loop_segment(0, 4, ratio=None), loop_segment(0, 4, count=7, ratio=None), loop_segment(0, 4, count=8, ratio=None), spoken(0, "a real sentence here"),
             spoken(0, "dense text", ratio=2.5), spoken(0, "exactly at it", ratio=2.4), {"start": 0, "end": 1, "text": "", "words": []}, {"start": 0, "end": 1, "text": "no words"},
             {"start": 0, "end": 2, "text": "x", "compression_ratio": True, "words": [{"text": None}, {"start": 1}, "odd"]}]
    for case in cases:
        assert worker.repetition_check_failed(case, 2.4) == ch.repetition_check_failed(case, 2.4), case
    for group in (cases[:3], cases, [spoken(t, "ten ordinary words that fill up a segment of real talk") for t in range(0, 90, 3)] + [loop_segment(90.0, 155.0)], []):
        assert worker.repetition_stats(group, 2.4) == ch.repetition_stats(group, 2.4)
        assert worker.needs_second_pass(worker.repetition_stats(group, 2.4)) == ch.needs_second_pass(ch.repetition_stats(group, 2.4))
    assert worker.REPETITION_MIN_WORDS == ch.REPETITION_MIN_WORDS


# ---- the allowance ledger ---------------------------------------------------------------------------------------------
class Clock:
    def __init__(self, start: float = 1_000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def test_the_allowance_is_reserved_before_work_settled_after_it_and_never_goes_down(tmp_path):
    clock, path = Clock(), tmp_path / "speech" / "allowance.json"
    ledger = Allowance(path, clock=clock)
    with pytest.raises(LedgerRefused) as refused:
        ledger.open(grant_id=GRANT, ceiling_seconds=100, may_create=False)  # work files exist and the ledger does not: never start from zero
    assert refused.value.code == "ledger_missing" and not path.exists()
    ledger.open(grant_id=GRANT, ceiling_seconds=100, may_create=True)
    assert (ledger.used_seconds, ledger.remaining_seconds) == (0.0, 100.0)

    ledger.reserve("run-1", lease_seconds=30)
    on_disk = json.loads(path.read_text(encoding="utf-8"))  # durable BEFORE any work is launched
    assert on_disk["open"]["run_id"] == "run-1" and on_disk["open"]["started_at"] == 1_000.0 and on_disk["open"]["lease_until"] == 1_030.0 and on_disk["used_seconds"] == 0.0
    clock.advance(10)
    ledger.heartbeat(lease_seconds=30)
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["open"]["heartbeat_at"] == 1_010.0 and on_disk["open"]["lease_until"] == 1_040.0
    clock.advance(2.5)
    assert ledger.settle(12.5) == 12.5
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["open"] is None and on_disk["used_seconds"] == 12.5 and on_disk["settled"][-1]["how"] == "completed" and on_disk["settled"][-1]["seconds"] == 12.5

    ledger.reserve("run-2", lease_seconds=30)
    clock.advance(7)
    assert ledger.settle(7.0) == 19.5
    # A new process (a retry, a restart) continues from the durable total.
    again = Allowance(path, clock=clock)
    again.open(grant_id=GRANT, ceiling_seconds=100, may_create=False)
    assert (again.used_seconds, again.remaining_seconds) == (19.5, 80.5)
    for wrong in (-1.0, float("nan")):
        again.reserve("run-3", lease_seconds=30)
        with pytest.raises(ValueError):
            again.settle(wrong)  # time is only ever added
        assert again.settle(0.0) == 19.5
    # The ceiling written at the start is not raised by editing the binding; a smaller one is honoured.
    again.open(grant_id=GRANT, ceiling_seconds=500, may_create=False)
    assert again.ceiling_seconds == 100 and again.remaining_seconds == 80.5
    again.open(grant_id=GRANT, ceiling_seconds=50, may_create=False)
    assert again.ceiling_seconds == 50 and again.remaining_seconds == 30.5
    # Another grant does not get a fresh allowance by itself, and a ledger that lost time against the journal is refused.
    with pytest.raises(LedgerRefused) as refused:
        Allowance(path, clock=clock).open(grant_id="another-grant", ceiling_seconds=100, may_create=True)
    assert refused.value.code == "grant_mismatch"
    with pytest.raises(LedgerRefused) as refused:
        Allowance(path, clock=clock).open(grant_id=GRANT, ceiling_seconds=100, may_create=False, floor_seconds=25.0)
    assert refused.value.code == "ledger_behind_journal"
    path.write_text("{ not json", encoding="utf-8")
    with pytest.raises(LedgerRefused) as refused:
        Allowance(path, clock=clock).open(grant_id=GRANT, ceiling_seconds=100, may_create=True)
    assert refused.value.code == "ledger_unreadable" and path.read_text(encoding="utf-8") == "{ not json"  # never replaced by a fresh one


def test_a_reservation_left_open_by_a_dead_run_is_settled_conservatively_on_restart(tmp_path):
    clock, path = Clock(), tmp_path / "allowance.json"
    ledger = Allowance(path, clock=clock)
    ledger.open(grant_id=GRANT, ceiling_seconds=100, may_create=True)
    ledger.reserve("run-1", lease_seconds=30)
    clock.advance(20)
    ledger.heartbeat(lease_seconds=30)  # last sign of life at +20 s; its worker may run on until the lease ends at +50 s
    clock.advance(5)  # ... the supervisor dies; a new one starts 5 s later

    fresh = Allowance(path, clock=clock)
    fresh.open(grant_id=GRANT, ceiling_seconds=100, may_create=False)
    assert fresh.used_seconds == 0.0 and fresh.open_reservation["run_id"] == "run-1"
    assert fresh.seconds_until_lease_ends() == pytest.approx(25.0)  # a new worker must not start while the old one may still be alive
    clock.advance(25)
    entry = fresh.recover()
    assert entry["how"] == "recovered_conservative" and entry["run_id"] == "run-1" and entry["seconds"] == 50.0  # start .. end of lease, never less than start .. last heartbeat (20 s)
    assert fresh.used_seconds == 50.0 and fresh.open_reservation is None and fresh.recover() is None
    assert json.loads(path.read_text(encoding="utf-8"))["used_seconds"] == 50.0


# ---- the runner, with the labelled fake worker ------------------------------------------------------------------------
class Ticking:
    """A clock that never repeats a value, so receipts written one after another have a definite order."""

    def __init__(self, start: float = 1_800_000_000.0):
        self.t = start

    def __call__(self) -> float:
        self.t += 0.001
        return self.t


SHOWCASE = "be505/src-lecture-05-recording"  # the recording of the fixture's showcase unit (be505 lecture-05)
OVER_THE_FIXTURE_AS_BUILT = frozenset({"test_the_runner_takes_in_every_recording_of_the_fixture_as_it_is_built"})


def take_out_the_showcase_recording(workspace: Path) -> None:
    """Remove the showcase unit's recording from one test's private copy of the synthetic workspace: the file, its
    entry in the synthetic course index, and — because the index is only trusted while its bytes match the
    publication marker — the marker's pin of the index. Everything else of the unit stays."""
    from lecture_brain.fixtures.builder import SHOWCASE_RECORDING_ID

    root = workspace / "University" / "BE 505"
    index_path, marker_path = root / ".agent" / "source-index.json", root / ".agent" / "course-tracking" / "publication.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    entry = next(source for source in index["sources"] if source["source_id"] == SHOWCASE_RECORDING_ID)
    (root / entry["current_path"]).unlink()
    index["sources"] = [{**source, "related_source_ids": [other for other in source["related_source_ids"] if other != SHOWCASE_RECORDING_ID]}
                        for source in index["sources"] if source["source_id"] != SHOWCASE_RECORDING_ID]
    index["coverage"]["included_paths"] = [path for path in index["coverage"]["included_paths"] if path != entry["current_path"]]
    data = json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8")
    index_path.write_bytes(data)
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    marker["files"][".agent/source-index.json"] = hashlib.sha256(data).hexdigest()
    marker_path.write_text(json.dumps(marker, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture()
def workspace(workspace, request) -> Path:
    """The scenarios of this module were written for FOUR synthetic recordings (60 s and 45 s in BE 505, 6 s each in
    BE 562 and DS 551: seven chunks of 25 s): their counts, orders and flows are exact. The fixture's showcase unit
    brings a fifth, longer recording; it is taken out of the test's own copy of the workspace, so each scenario
    stays the one it describes. The tests named in ``OVER_THE_FIXTURE_AS_BUILT`` run over the workspace as it is built."""
    if request.node.name not in OVER_THE_FIXTURE_AS_BUILT:
        take_out_the_showcase_recording(workspace)
    return workspace


@pytest.fixture()
def journal(settings):
    j = Journal.open(settings.journal_path, clock=Ticking(), synced_roots=[])
    yield j
    j.close()


@pytest.fixture()
def control(tmp_path, monkeypatch):
    """Sets what the labelled fake worker does in the next run (see fake_speech_worker.py)."""
    path = tmp_path / "fake-control.json"

    def set_control(**values) -> None:
        path.write_text(json.dumps({"log": str(tmp_path / "fake.log"), **values}), encoding="utf-8")

    set_control()
    monkeypatch.setenv("LL_FAKE_SPEECH_CONTROL", str(path))
    return set_control


def fake_binding(tmp_path, **over) -> dict:
    """A binding for tests: this Python as the 'speech interpreter', a folder of LABELLED placeholder model files."""
    model = tmp_path / "fake-model"
    model.mkdir(exist_ok=True)
    for name in ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt"):
        (model / name).write_text("LABELLED PLACEHOLDER: not a speech model\n", encoding="utf-8")
    return {"interpreter": sys.executable, "model_dir": str(model), "threads": 4, "workers": 1, "ceiling_seconds": 14_400, "grant_id": GRANT, "overlap_seconds": 2,
            "safety_margin_seconds": 0.5, "publish_every_chunks": 1, **over}


def make_runner(settings, journal, tmp_path, **over) -> rn.SpeechRunner:
    return rn.SpeechRunner(settings, journal, binding=fake_binding(tmp_path, **over), worker_script=FAKE_WORKER, timings=rn.Timings(**FAST))


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def private_files(settings) -> dict[str, str]:
    return {name: digest for name, digest in tree(settings.state_dir).items() if not name.startswith("journal.sqlite")}


def speech_dir(settings) -> Path:
    return settings.state_dir / "speech"


def queue_items(settings) -> dict[str, dict]:
    return {item["key"]: item for item in json.loads((speech_dir(settings) / "queue.json").read_text(encoding="utf-8"))["items"]}


def ledger_doc(settings) -> dict:
    return json.loads((speech_dir(settings) / "allowance.json").read_text(encoding="utf-8"))


def fake_log(tmp_path) -> list[str]:
    path = tmp_path / "fake.log"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def recordings(settings) -> dict[str, dict]:
    found = {}
    for course_id, binding in settings.courses.items():
        for session in build_inventory(binding)["sessions"]:
            for item in session["items"]:
                if item["kind"] == "lecture_recording":
                    found[f"{course_id}/{item['source_id']}"] = dict(item, course_id=course_id, root=binding.root, lecture_ids=session["linked_lecture_ids"])
    return found


def words_of(current) -> list[tuple]:
    return [(w["text"], w["start_ms"], w["end_ms"]) for s in current["segments"] for w in s.get("words", [])]


def receipts(journal, kind="speech-run") -> list[dict]:
    return [r["payload"] for r in journal.receipts(kind=kind)]


def test_one_run_freezes_the_queue_transcribes_every_recording_in_chunks_and_publishes_through_the_importer(settings, journal, tmp_path, control):
    materials_before = {cid: tree(binding.root / "materials") for cid, binding in settings.courses.items()}
    listed = recordings(settings)
    second = next(key for key in listed if key.startswith("be505/unreg-"))  # 45 s, identified by its bytes
    runner = make_runner(settings, journal, tmp_path)

    result = runner.run(chunk_seconds=25)

    assert result["state"] == "completed" and result["outcome"] == "ran" and result["reason"] is None, result
    assert result["chunks_completed"] == 7 and result["media_seconds"] == pytest.approx(27 + 27 + 10 + 27 + 20 + 6 + 6)  # 60 s as 3 chunks, 45 s as 2, two 6 s recordings
    assert {cid: tree(binding.root / "materials") for cid, binding in settings.courses.items()} == materials_before  # the recordings and every other material are only read
    # The frozen queue: every recording of every configured course, in course and lecture order, with its identity.
    items = queue_items(settings)
    assert list(items) == [L1, second, "be562/src-lecture-01-audio", next(key for key in listed if key.startswith("ds551/"))] and set(items) == set(listed)
    for key, item in items.items():
        path = listed[key]["root"] / listed[key]["path"]
        assert item["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest() and item["bytes"] == path.stat().st_size and item["lecture_ids"] == listed[key]["lecture_ids"]
        assert item["state"] == "complete" and item["chunks_done"] == item["chunks_total"] and item["reason"] is None and len(item["work_id"]) == 12
    assert items[L1]["version_id"] == listed[L1]["version_id"] and items[L1]["duration_ms"] == 60_000 and items[L1]["chunks_total"] == 3
    assert items[second]["version_id"].startswith("disk-") and items[second]["chunks_total"] == 2
    # Chunk results are kept under short folder names.
    work = speech_dir(settings) / "work" / items[L1]["work_id"]
    assert sorted(p.name for p in work.iterdir()) == ["chunk-0000.json", "chunk-0001.json", "chunk-0002.json"]
    stored = json.loads((work / "chunk-0001.json").read_text(encoding="utf-8"))
    assert stored["offset_ms"] == 25_000 and stored["labelled_double"] is True and stored["segments"][0]["words"][0]["start"] == pytest.approx(1.3)  # chunk-local seconds

    # What a reader gets: the whole recording, each fabricated word exactly once, in recording time, labelled as generated and as a double.
    derived = Derived(settings, journal)
    current = derived.current("be505", "src-lecture-01-recording")
    assert words_of(current) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)]
    by_text = {w["text"]: w for s in current["segments"] for w in s["words"]}
    assert by_text["w13"]["probability"] == 0.2 and by_text["w25"]["probability"] == 0.2  # each overlap word came from the chunk its midpoint belongs to
    assert current["window"] == {"start_ms": 0, "end_ms": 60_000} and current["covers_whole_recording"] is True and current["review_state"] == "generated_unreviewed"
    assert current["producer"]["tool"] == "labelled-fake-speech-worker" and current["generation"].startswith(f"sp-{items[L1]['work_id']}-p0003-")  # short id, chunk count, content digest
    provenance = current["provenance"]
    assert provenance["origin"] == "speech_runner" and provenance["labelled_double"] is True and provenance["complete"] is True and provenance["grant_id"] == GRANT
    assert provenance["chunking"] == {"chunk_ms": 25_000, "overlap_ms": 2_000, "chunks_total": 3, "chunks_merged": 3, "rule": ch.OVERLAP_RULE}
    assert provenance["merge"]["overlap_boundaries_spliced"] == 2 and provenance["merge"]["overlap_matched_words"] == 2 and provenance["merge"]["overlap_boundaries_at_midpoint"] == 0
    assert provenance["runner"] == rn.RUNNER_VERSION and provenance["publication"]["merge_policy"] == rn.MERGE_POLICY and provenance["covers_whole_recording"] is True
    assert provenance["covered_intervals"] == [{"start_ms": 0, "end_ms": 60_000}] and provenance["unresolved_intervals"] == []
    assert current["covered_intervals"] == [{"start_ms": 0, "end_ms": 60_000}] and current["unresolved_seconds"] == 0.0 and current["coverage_fraction"] == 1.0
    assert [c["index"] for c in provenance["chunks"]] == [0, 1, 2] and provenance["chunks"][1]["sha256"] == hashlib.sha256((work / "chunk-0001.json").read_bytes()).hexdigest()
    assert provenance["counts"]["words"] == 30 and provenance["merge"]["dropped_overlap_words"] == 2 and provenance["producer_statuses"]["timing_generated"] == "GENERATED_UNREVIEWED"
    assert provenance["bound_to"]["disk_sha256"] == items[L1]["sha256"]
    # Earlier prefixes are separate immutable generations; the newest is the one served.
    states = {g["generation"][:-9]: (g["state"], g["window"]["end_ms"], g["covers_whole_recording"]) for r in derived.status("be505")["recordings"] if r["source_id"] == "src-lecture-01-recording"
              for g in r["generations"]}  # without the digest suffix
    work_id = items[L1]["work_id"]
    assert states == {f"sp-{work_id}-p0001": ("superseded", 27_000, False), f"sp-{work_id}-p0002": ("superseded", 52_000, False), f"sp-{work_id}-p0003": ("current", 60_000, True)}
    assert derived.current("be505", second.split("/")[1])["covers_whole_recording"] is True and derived.current("ds551", items[list(items)[3]]["source_id"])["window"]["end_ms"] == 6_000

    # The allowance was charged, the run left one receipt, and every publication is an importer receipt.
    ledger = ledger_doc(settings)
    assert ledger["grant_id"] == GRANT and ledger["open"] is None and 0 < ledger["used_seconds"] == result["allowance"]["used_after"] and len(ledger["settled"]) == 1
    assert result["allowance"]["used_before"] == 0.0 and result["wall_seconds"] == pytest.approx(ledger["used_seconds"])
    ran = receipts(journal)
    assert [(r["outcome"], r["state"], r["chunks_completed"], r["grant_id"]) for r in ran] == [("ran", "completed", 7, GRANT)]
    assert ran[0]["allowance"]["used_after"] == ledger["used_seconds"]
    assert [r["outcome"] for r in receipts(journal, "derived-import")] == ["imported"] * 7 and journal.counts()["jobs"] == 0
    assert [line for line in fake_log(tmp_path) if line.startswith("start")] == [f"start {items[key]['work_id']} {n}" for key in items for n in range(items[key]["chunks_total"])]

    status = runner.status()
    assert status["allowance"]["used_seconds"] == ledger["used_seconds"] and status["allowance"]["remaining_seconds"] == pytest.approx(14_400 - ledger["used_seconds"])
    assert status["allowance"]["grant_id"] == GRANT and status["allowance"]["ceiling_seconds"] == 14_400
    row = next(r for r in status["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_covered"], row["duration_seconds"], row["chunks_done"], row["chunks_total"], row["last_error"]) == ("complete", 60.0, 60.0, 3, 3, None)
    assert status["courses"]["be505"]["totals"]["complete"] == 2 and status["courses"]["be572"]["recordings"] == [] and status["totals"]["recordings"] == 4
    assert (row["seconds_processed"], row["seconds_published"], row["coverage_fraction"], row["covers_whole_recording"]) == (60.0, 60.0, 1.0, True)
    assert row["covered_intervals"] == [{"start_ms": 0, "end_ms": 60_000}] and row["unresolved_intervals"] == [] and row["unresolved_seconds"] == 0.0 and status["pause"] is None
    assert status["totals"]["states"] == {"queued": 0, "partial": 0, "complete": 4, "complete_with_unresolved": 0, "source_conflict": 0, "failed": 0, "not_in_frozen_queue": 0}
    assert "speech-run" in status["resume_command"] and "--profile fixture" in status["resume_command"] and "estimate" not in json.dumps(status).lower()


def test_the_runner_takes_in_every_recording_of_the_fixture_as_it_is_built(settings, journal, tmp_path, control):
    """The other scenarios of this module run over the four recordings they were written for (see the ``workspace``
    fixture above). The fixture as it is built has one more — the recording of its showcase unit — and the same
    runner freezes, transcribes and publishes it like any other: nothing here knows the fixture's recordings by
    number. What the showcase recording must yield is computed from the file itself, not written down."""
    import wave

    listed = recordings(settings)
    assert SHOWCASE in listed and len(listed) == 5 and listed[SHOWCASE]["registration"] == listed[L1]["registration"]  # registered in the course index, like lecture 01
    with wave.open(str(listed[SHOWCASE]["root"] / listed[SHOWCASE]["path"]), "rb") as audio:
        duration_ms = int(round(audio.getnframes() * 1000 / audio.getframerate()))
    plan = ch.plan_chunks(duration_ms, 25_000, 2_000)
    assert duration_ms > 60_000 and len(plan) > 3  # longer than any recording of the other scenarios

    done = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)

    assert (done["state"], done["outcome"], done["chunks_completed"]) == ("completed", "ran", 7 + len(plan)), done
    items = queue_items(settings)
    assert set(items) == set(listed) and list(items).index(L1) < list(items).index(SHOWCASE) < list(items).index("be562/src-lecture-01-audio")  # course order, then session order
    assert {item["state"] for item in items.values()} == {"complete"} and done["remaining"] == {"recordings": 0, "chunks": 0, "source_conflict": 0, "failed": 0}
    item = items[SHOWCASE]
    assert (item["duration_ms"], item["chunks_total"], item["chunks_done"], item["published_chunks"]) == (duration_ms, len(plan), len(plan), len(plan))
    assert item["lecture_ids"] == listed[SHOWCASE]["lecture_ids"] and item["sha256"] == hashlib.sha256((listed[SHOWCASE]["root"] / listed[SHOWCASE]["path"]).read_bytes()).hexdigest()
    current = Derived(settings, journal).current("be505", "src-lecture-05-recording")
    assert current["generation"] == item["published_generation"] and current["window"] == {"start_ms": 0, "end_ms": duration_ms} and current["covers_whole_recording"] is True
    assert words_of(current) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range((duration_ms - 700) // 2_000 + 1)]  # each fabricated word once, across every boundary
    assert current["provenance"]["labelled_double"] is True and current["provenance"]["merge"]["overlap_boundaries_spliced"] == len(plan) - 1
    status = make_runner(settings, journal, tmp_path).status()
    assert status["totals"]["recordings"] == 5 and status["totals"]["states"]["complete"] == 5 and status["courses"]["be505"]["totals"]["complete"] == 3
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "no_change"


def test_a_run_with_nothing_to_do_writes_one_no_change_receipt_and_nothing_else(settings, journal, tmp_path, control):
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "completed"
    private_before, used = private_files(settings), ledger_doc(settings)["used_seconds"]
    starts = len(fake_log(tmp_path))
    known = {r["receipt_id"] for r in journal.receipts()}

    again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)

    assert again["state"] == "no_change" and again["outcome"] == "no_change" and again["chunks_completed"] == 0 and again["wall_seconds"] == 0.0
    new = [r for r in journal.receipts() if r["receipt_id"] not in known]
    assert [(r["kind"], r["payload"]["outcome"]) for r in new] == [("speech-run", "no_change")]
    assert private_files(settings) == private_before and ledger_doc(settings)["used_seconds"] == used and len(fake_log(tmp_path)) == starts  # no worker was launched

    # A new queue over the same chunk files: the progress is found again on disk, the same generations are recognised
    # as already stored (byte for byte), no worker starts and no time is spent.
    derived = Derived(settings, journal)
    stores_before = {cid: tree(derived.store_dir(cid)) for cid in settings.courses if derived.store_dir(cid).exists()}
    (speech_dir(settings) / "queue.json").unlink()
    refrozen = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert refrozen["state"] == "completed" and refrozen["chunks_completed"] == 0 and refrozen["wall_seconds"] == 0.0 and refrozen["queue"]["created"] is True
    assert [p["status"] for p in refrozen["published"]] == ["reused"] * 4 and all(p["complete"] for p in refrozen["published"])
    assert {item["state"] for item in queue_items(settings).values()} == {"complete"} and ledger_doc(settings)["used_seconds"] == used and len(fake_log(tmp_path)) == starts
    assert {cid: tree(derived.store_dir(cid)) for cid in settings.courses if derived.store_dir(cid).exists()} == stores_before
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "no_change"


def test_a_supervisor_killed_mid_chunk_is_resumed_without_redoing_finished_chunks_and_its_time_is_still_counted(workspace, settings, journal, tmp_path, control):
    """A REAL kill: the supervisor runs as its own process (the command line), is killed while the fake worker is inside
    the second chunk, and a new run picks up from the chunk files on disk."""
    binding_file = tmp_path / "speech-binding.json"
    binding_file.write_text(json.dumps({**fake_binding(tmp_path), "worker_script": str(FAKE_WORKER), "timings": FAST}), encoding="utf-8")
    control(hang_at=1)  # chunk 0 finishes at once; the worker then stays busy inside chunk 1
    env = {**os.environ, "LL_FIXTURE_ROOT": str(workspace), "LL_SPEECH_BINDING": str(binding_file)}
    command = [sys.executable, "-m", "lecture_brain", "--profile", "fixture", "--state-dir", str(settings.state_dir), "speech-run", "--chunk-seconds", "25"]
    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.time() + 60
        while not any(line.endswith(" 1") and line.startswith("start") for line in fake_log(tmp_path)):
            assert process.poll() is None, process.communicate()
            assert time.time() < deadline, "the fake worker never reached the second chunk"
            time.sleep(0.05)
        time.sleep(0.3)  # at least one heartbeat with the worker inside the chunk
        process.kill()
    finally:
        process.wait(timeout=30)
        for stream in (process.stdout, process.stderr):
            stream.close()
    left = ledger_doc(settings)
    assert left["open"] is not None and left["used_seconds"] == 0.0  # the reservation was written before the work and is still open
    orphan_result = speech_dir(settings) / "run" / "result.json"
    waited_until = time.time() + 30
    while not orphan_result.exists():  # the orphaned worker notices that its lease is no longer refreshed and ends by itself
        assert time.time() < waited_until, "the orphaned worker did not stop when its lease ended"
        time.sleep(0.05)
    assert json.loads(orphan_result.read_text(encoding="utf-8"))["ended"] == "lease_lost"
    survived = left["open"]["heartbeat_at"] - left["open"]["started_at"]
    work_id = queue_items(settings)[L1]["work_id"]
    assert (speech_dir(settings) / "work" / work_id / "chunk-0000.json").is_file() and not (speech_dir(settings) / "work" / work_id / "chunk-0001.json").exists()

    control()  # the next worker behaves
    result = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)

    assert result["state"] == "completed" and result["chunks_completed"] == 6, result  # seven chunks in all; the first was already done
    log = fake_log(tmp_path)
    assert log.count(f"start {work_id} 0") == 1 and log.count(f"done {work_id} 0") == 1  # not redone
    assert log.count(f"start {work_id} 1") == 2 and log.count(f"done {work_id} 1") == 1  # the interrupted chunk was done again, once
    ledger = ledger_doc(settings)
    recovered, completed = ledger["settled"]
    assert recovered["how"] == "recovered_conservative" and recovered["seconds"] >= survived > 0 and completed["how"] == "completed"
    assert ledger["open"] is None and ledger["used_seconds"] == pytest.approx(recovered["seconds"] + completed["seconds"])
    assert result["allowance"]["used_before"] == pytest.approx(recovered["seconds"]) and result["allowance"]["recovered_seconds"] == pytest.approx(recovered["seconds"])
    assert words_of(Derived(settings, journal).current("be505", "src-lecture-01-recording")) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)]


def test_a_resource_failure_pauses_the_queue_sets_nothing_aside_and_later_runs_stay_paused(settings, journal, tmp_path, control):
    """The owner's words: pause safely at a resource failure and retain the remaining queue. A failure the worker
    reports (memory, model, runtime) is the machine's, not the recording's: no chunk is counted as failed, no recording
    is set aside, and a wrapper that repeats the command starts no worker until the owner says to go on."""
    control(fail_at=1)
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["reason"], first["chunks_completed"]) == ("paused", "worker_failed", 1), first
    assert "FAKE resource failure" in first["detail"] and "--retry-failed" in first["detail"] and first["resume_command"].endswith("speech-run --retry-failed")
    item = queue_items(settings)[L1]
    assert item["state"] == "partial" and item["chunks_done"] == 1 and "FAKE resource failure" in item["last_error"]
    assert item["failures"] == {} and item["resource_failures"] == {"1": 1}  # not an attempt that counts against the recording
    assert (first["pause"]["reason"], first["pause"]["worker_reason"], first["pause"]["recording"], first["pause"]["chunk"]) == ("resource_failure", "worker_failed", L1, 1)
    assert first["remaining"] == {"recordings": 4, "chunks": 6, "source_conflict": 0, "failed": 0}  # the whole queue is retained
    derived = Derived(settings, journal)
    prefix = derived.current("be505", "src-lecture-01-recording")
    assert prefix["window"] == {"start_ms": 0, "end_ms": 27_000} and prefix["covers_whole_recording"] is False and prefix["provenance"]["complete"] is False  # a part is never called complete
    used_first = ledger_doc(settings)["used_seconds"]
    assert used_first > 0 and receipts(journal)[-1]["state"] == "paused" and receipts(journal)[-1]["pause"]["recording"] == L1

    # Run after run: paused. No worker, no charge, nothing set aside, and each run says how to continue.
    starts = len(fake_log(tmp_path))
    for _ in range(3):
        again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (again["state"], again["outcome"], again["reason"], again["chunks_completed"], again["wall_seconds"]) == ("paused", "no_change", "resource_failure", 0, 0.0), again
        assert "--retry-failed" in again["detail"] and again["resume_command"].endswith("--retry-failed") and again["pause"]["recording"] == L1
    assert ledger_doc(settings)["used_seconds"] == used_first and len(fake_log(tmp_path)) == starts and len(ledger_doc(settings)["settled"]) == 1
    assert {item["state"] for item in queue_items(settings).values()} == {"partial", "queued"}
    status = make_runner(settings, journal, tmp_path).status()
    row = next(r for r in status["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_covered"], row["chunks_done"], row["resource_failures"]) == ("partial", 27.0, 1, {"1": 1}) and "FAKE resource failure" in row["last_error"]
    assert status["pause"]["recording"] == L1 and status["resume_argv"][-1] == "--retry-failed" and status["totals"]["states"]["failed"] == 0

    # The owner continues while the cause persists for that one recording: it is tried LAST, so the others are done; then the queue pauses again.
    work_id = queue_items(settings)[L1]["work_id"]
    control(fail_at=1, only_work=work_id)
    third = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert (third["state"], third["reason"], third["chunks_completed"]) == ("paused", "worker_failed", 4), third
    assert third["resumed_after_pause"]["recording"] == L1 and third["pause"]["chunk"] == 1 and third["remaining"]["failed"] == 0
    states = {key: item["state"] for key, item in queue_items(settings).items()}
    assert states[L1] == "partial" and sorted(v for k, v in states.items() if k != L1) == ["complete"] * 3
    assert queue_items(settings)[L1]["resource_failures"] == {"1": 2} and queue_items(settings)[L1]["failures"] == {}
    started = [line for line in fake_log(tmp_path)[starts:] if line.startswith("start")]
    assert started[-1] == f"start {work_id} 1" and len(started) == 5 and not any(line.startswith(f"start {work_id}") for line in started[:-1])
    assert ledger_doc(settings)["used_seconds"] > used_first and len(ledger_doc(settings)["settled"]) == 2

    # With the cause gone it is finished from the chunk the failure happened in.
    control()
    log_before = len(fake_log(tmp_path))
    fourth = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert fourth["state"] == "completed" and fourth["chunks_completed"] == 2 and queue_items(settings)[L1]["state"] == "complete" and fourth["pause"] is None
    assert [line for line in fake_log(tmp_path)[log_before:] if line.startswith("start")] == [f"start {work_id} 1", f"start {work_id} 2"]
    assert "resource_failures" not in queue_items(settings)[L1] and make_runner(settings, journal, tmp_path).status()["pause"] is None
    assert derived.current("be505", "src-lecture-01-recording")["covers_whole_recording"] is True
    assert [r["state"] for r in receipts(journal)] == ["paused"] * 5 + ["completed"]

    # A worker that dies without a word names no cause: that IS counted against the chunk it was in, and twice sets the recording aside.
    control(die_at=0)
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("chunk-*.json"):
        path.unlink()  # a new queue and no work files: work to do again (the allowance is not reset by this; see the ceiling test)
    used = ledger_doc(settings)["used_seconds"]
    died = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (died["state"], died["reason"], died["pause"]) == ("failed", "worker_died", None) and ledger_doc(settings)["used_seconds"] > used
    assert queue_items(settings)[L1]["failures"] == {"0": 1} and queue_items(settings)[L1]["state"] == "queued"
    died = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (died["state"], died["reason"]) == ("failed", "worker_died") and (queue_items(settings)[L1]["state"], queue_items(settings)[L1]["reason"]) == ("failed", "chunk_failed")


def test_the_allowance_accumulates_across_runs_pauses_at_the_ceiling_and_is_never_reset(settings, journal, tmp_path, control):
    control(delay_seconds=0.4)
    limits = {"ceiling_seconds": 3.0, "safety_margin_seconds": 1.2}

    first = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)

    assert first["state"] == "ceiling_reached" and 0 < first["chunks_completed"] < 7, first  # seven chunks at 0.4 s do not fit in 3 s minus the margin
    used = ledger_doc(settings)["used_seconds"]
    assert 0 < used <= 3.0 and first["allowance"]["used_after"] == used and first["allowance"]["remaining_seconds"] == pytest.approx(3.0 - used)
    left = [key for key, item in queue_items(settings).items() if item["state"] in {"queued", "partial"}]
    assert left and first["remaining"]["chunks"] == 7 - first["chunks_completed"]  # the queue is kept
    # Less than the safety margin is left: the next runs start no worker at all, and say so.
    done_before = len(fake_log(tmp_path))
    for _ in range(2):
        again = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
        assert again["state"] == "ceiling_reached" and again["chunks_completed"] == 0 and again["wall_seconds"] == 0.0
    assert ledger_doc(settings)["used_seconds"] == used and len(fake_log(tmp_path)) == done_before
    assert [key for key, item in queue_items(settings).items() if item["state"] in {"queued", "partial"}] == left
    assert [(r["outcome"], r["state"]) for r in receipts(journal)] == [("ran", "ceiling_reached"), ("no_change", "ceiling_reached"), ("no_change", "ceiling_reached")]
    # A bigger number in the binding does not raise the ceiling of this grant, and another grant id is not a fresh allowance.
    assert make_runner(settings, journal, tmp_path, ceiling_seconds=14_400, safety_margin_seconds=1.2).run(chunk_seconds=25)["state"] == "ceiling_reached"
    other = make_runner(settings, journal, tmp_path, grant_id="another-grant").run(chunk_seconds=25)
    assert (other["state"], other["reason"]) == ("refused", "grant_mismatch")
    # Deleting the queue and the work files makes work to do again; it does not give time back.
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("chunk-*.json"):
        path.unlink()
    assert make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)["state"] == "ceiling_reached" and ledger_doc(settings)["used_seconds"] == used
    assert (speech_dir(settings) / "queue.json").is_file()  # a new frozen queue, the same ledger
    # Without the ledger the runner refuses rather than start from zero: because work exists, and because the journal remembers.
    ledger_bytes = (speech_dir(settings) / "allowance.json").read_bytes()
    (speech_dir(settings) / "allowance.json").unlink()
    refused = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
    assert (refused["state"], refused["reason"]) == ("refused", "ledger_missing") and not (speech_dir(settings) / "allowance.json").exists()
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("*"):
        if path.is_file():
            path.unlink()
    refused = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
    assert (refused["state"], refused["reason"]) == ("refused", "ledger_missing")  # the journal's receipts still show time was used under this grant
    assert receipts(journal)[-1]["outcome"] == "refused" and receipts(journal)[-1]["reason"] == "ledger_missing"
    # An older copy of the ledger is refused too.
    stale = json.loads(ledger_bytes)
    stale.update(used_seconds=0.0, settled=[])
    (speech_dir(settings) / "allowance.json").write_text(json.dumps(stale), encoding="utf-8")
    refused = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
    assert (refused["state"], refused["reason"]) == ("refused", "ledger_behind_journal")
    (speech_dir(settings) / "allowance.json").write_bytes(ledger_bytes)
    assert make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)["state"] == "ceiling_reached"


def test_run_bounds_stop_new_chunks_and_a_later_run_continues(settings, journal, tmp_path, control):
    one = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, max_chunks=2)
    assert (one["state"], one["chunks_completed"]) == ("max_chunks_reached", 2) and one["remaining"]["chunks"] == 5
    item = queue_items(settings)[L1]
    assert item["state"] == "partial" and item["chunks_done"] == 2
    row = next(r for r in make_runner(settings, journal, tmp_path).status()["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_covered"], row["duration_seconds"], row["chunks_done"], row["chunks_total"]) == ("partial", 52.0, 60.0, 2, 3)
    assert Derived(settings, journal).current("be505", "src-lecture-01-recording")["covers_whole_recording"] is False
    # A wall-time bound: no new chunk starts after it; the chunk that is running may finish.
    control(delay_seconds=0.6)
    two = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, max_seconds=1.5)
    assert two["state"] == "max_seconds_reached" and 1 <= two["chunks_completed"] < 5, two
    # The frozen chunk size is kept: asking for another one later is reported, not applied.
    control()
    three = make_runner(settings, journal, tmp_path).run(chunk_seconds=10)
    assert three["state"] == "completed" and three["chunks_completed"] == 5 - two["chunks_completed"] and three["queue"]["chunk_seconds"] == 25.0
    assert "frozen" in three["queue"]["note"] and queue_items(settings)[L1]["chunks_total"] == 3
    # What was frozen has one identity for as long as the queue is worked off.
    identity = make_runner(settings, journal, tmp_path).status()["queue"]["identity_sha256"]
    assert len(identity) == 64 and one["queue"]["identity_sha256"] == two["queue"]["identity_sha256"] == three["queue"]["identity_sha256"] == identity
    assert [r["state"] for r in receipts(journal)] == ["max_chunks_reached", "max_seconds_reached", "completed"]
    assert len(ledger_doc(settings)["settled"]) == 3 and ledger_doc(settings)["used_seconds"] == pytest.approx(sum(r["wall_seconds"] for r in receipts(journal)))


def test_a_stop_file_prevents_a_start_and_stops_a_running_child_cleanly(settings, journal, tmp_path, control):
    stop = speech_dir(settings) / "STOP"
    stop.parent.mkdir(parents=True, exist_ok=True)
    stop.write_text("stop requested by the owner", encoding="utf-8")
    refused = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (refused["state"], refused["reason"], refused["chunks_completed"]) == ("stopped", "stop_file_present", 0)
    assert not (speech_dir(settings) / "allowance.json").exists() and fake_log(tmp_path) == []  # nothing was started or charged
    stop.unlink()

    control(hang_at=1)  # the worker stays inside the second chunk until it is stopped

    def request_stop() -> None:
        while not any(line.startswith("start") and line.endswith(" 1") for line in fake_log(tmp_path)):
            time.sleep(0.02)
        stop.write_text("stop", encoding="utf-8")

    watcher = threading.Thread(target=request_stop, daemon=True)
    watcher.start()
    stopped = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    watcher.join(timeout=10)
    assert (stopped["state"], stopped["reason"], stopped["chunks_completed"]) == ("stopped", "stop_file", 1), stopped
    item = queue_items(settings)[L1]
    assert item["state"] == "partial" and item["chunks_done"] == 1  # the finished chunk is kept, and published as a prefix
    assert Derived(settings, journal).current("be505", "src-lecture-01-recording")["window"]["end_ms"] == 27_000
    ledger = ledger_doc(settings)
    assert ledger["open"] is None and ledger["used_seconds"] > 0 and ledger["settled"][-1]["how"] == "completed"
    worker_result = json.loads((speech_dir(settings) / "run" / "result.json").read_text(encoding="utf-8")) if (speech_dir(settings) / "run" / "result.json").exists() else {"ended": "terminated"}
    assert worker_result["ended"] in {"stop", "terminated"}
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "stopped"  # the file is still there

    stop.unlink()
    control()
    resumed = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert resumed["state"] == "completed" and resumed["chunks_completed"] == 6
    assert [(r["outcome"], r["state"]) for r in receipts(journal)] == [("refused", "stopped"), ("ran", "stopped"), ("refused", "stopped"), ("ran", "completed")]


def test_a_changed_recording_is_a_source_conflict_that_is_skipped_while_the_rest_continues(settings, journal, tmp_path, control):
    from lecture_brain.fixtures.builder import write_wav

    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, max_chunks=1)
    assert first["state"] == "max_chunks_reached", first
    listed = recordings(settings)
    second = next(key for key in listed if key.startswith("be505/unreg-"))
    frozen = queue_items(settings)
    served_before = Derived(settings, journal).current("be505", "src-lecture-01-recording")["generation"]
    # Both BE 505 recordings change on disk after the queue was frozen: one registered (its index is not updated), one identified by its bytes.
    write_wav(listed[L1]["root"] / listed[L1]["path"], [(0, 60)])
    write_wav(listed[second]["root"] / listed[second]["path"], [(0, 45)])
    # A recording appears that the frozen queue does not know, and one that it knows goes missing.
    new_session = settings.course("be505").root / "materials" / "sessions" / "2026-09-29-lecture"
    write_wav(new_session / "Fixture Lec 9 Sep 29.wav", [(0, 6)])
    gone = next(key for key in listed if key.startswith("ds551/"))
    (listed[gone]["root"] / listed[gone]["path"]).unlink()

    result = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)

    assert result["state"] == "completed" and result["chunks_completed"] == 1, result  # only the BE 562 recording was still workable
    items = queue_items(settings)
    assert (items[L1]["state"], items[L1]["reason"]) == ("source_conflict", "bytes_changed") and (items[second]["state"], items[second]["reason"]) == ("source_conflict", "bytes_changed")
    assert items[L1]["sha256"] == frozen[L1]["sha256"] and items[L1]["chunks_done"] == 1  # the frozen identity and the work done for it are kept
    assert (items[gone]["state"], items[gone]["reason"]) == ("failed", "media_missing") and items["be562/src-lecture-01-audio"]["state"] == "complete"
    assert result["remaining"]["source_conflict"] == 2 and result["remaining"]["failed"] == 1
    log = [line for line in fake_log(tmp_path) if line.startswith("start")]
    assert log == [f"start {items[L1]['work_id']} 0", f"start {items['be562/src-lecture-01-audio']['work_id']} 0"]
    # What was published for the old bytes is no longer served for the changed file.
    derived = Derived(settings, journal)
    assert derived.current("be505", "src-lecture-01-recording") is None
    assert {g["generation"]: g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == "src-lecture-01-recording" for g in r["generations"]} == {served_before: "stale"}
    status = make_runner(settings, journal, tmp_path).status()
    be505 = {r["source_id"]: r for r in status["courses"]["be505"]["recordings"]}
    assert be505["src-lecture-01-recording"]["state"] == "source_conflict" and be505["src-lecture-01-recording"]["seconds_covered"] == 27.0
    newcomer = next(r for r in be505.values() if r["state"] == "not_in_frozen_queue")
    assert newcomer["filename"] == "Fixture Lec 9 Sep 29.wav" and newcomer["chunks_done"] == 0 and newcomer["seconds_covered"] == 0.0
    missing = status["courses"]["ds551"]["recordings"][0]
    assert (missing["state"], missing["reason"], missing["listed_now"]) == ("failed", "media_missing", False)
    assert status["totals"]["states"] == {"queued": 0, "partial": 0, "complete": 1, "complete_with_unresolved": 0, "source_conflict": 2, "failed": 1, "not_in_frozen_queue": 1}
    # A conflict is not forever: when the frozen bytes are back, the work continues where it stopped.
    listed_path = listed[gone]["root"] / listed[gone]["path"]
    write_wav(listed_path, [(0, 6)])
    assert hashlib.sha256(listed_path.read_bytes()).hexdigest() == frozen[gone]["sha256"]
    back = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert back["state"] == "completed" and back["chunks_completed"] == 1 and queue_items(settings)[gone]["state"] == "complete"


def test_priority_items_come_first_and_a_course_filter_limits_a_run(settings, journal, tmp_path, control):
    listed = recordings(settings)
    ds551 = next(key for key in listed if key.startswith("ds551/"))
    for bad, reason in (({"priority": ["be505/src-never-listed"]}, "unknown_priority"), ({"priority": ["no-slash"]}, "unknown_priority"), ({"courses": ["not-a-course"]}, "unknown_course")):
        refused = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, **bad)
        assert (refused["state"], refused["reason"]) == ("refused", reason)
    assert not (speech_dir(settings) / "queue.json").exists()

    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, priority=[ds551], max_chunks=1)
    assert first["state"] == "max_chunks_reached" and list(queue_items(settings))[0] == ds551 and queue_items(settings)[ds551]["state"] == "complete"
    assert list(queue_items(settings))[1:] == [key for key in listed if key != ds551]  # then course and lecture order
    only = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be562"])
    assert only["state"] == "completed" and only["chunks_completed"] == 1 and only["remaining"]["chunks"] == 5  # BE 505 is still to do, outside this run's selection
    # A later priority moves an item to the front of that run only; the frozen queue keeps its order.
    second = next(key for key in listed if key.startswith("be505/unreg-"))
    order_before = list(queue_items(settings))
    later = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, priority=[second], max_chunks=1)
    items = queue_items(settings)
    assert later["chunks_completed"] == 1 and items[second]["chunks_done"] == 1 and items[L1]["chunks_done"] == 0 and list(items) == order_before


def test_a_run_is_refused_without_a_usable_binding_and_only_one_run_holds_the_lock(settings, journal, tmp_path, control):
    def refused(**over):
        return make_runner(settings, journal, tmp_path, **over).run(chunk_seconds=25)

    missing = rn.SpeechRunner(settings, journal, binding=None, worker_script=FAKE_WORKER, timings=rn.Timings(**FAST)).run(chunk_seconds=25)
    assert (missing["state"], missing["reason"]) == ("refused", "no_binding")
    for over, reason in (({"interpreter": str(tmp_path / "no-such-python.exe")}, "interpreter_missing"), ({"model_dir": str(tmp_path / "no-model")}, "model_missing"),
                         ({"threads": 8}, "binding_invalid"), ({"workers": 2}, "binding_invalid"), ({"ceiling_seconds": 14_401}, "binding_invalid"),
                         ({"ceiling_seconds": 0}, "binding_invalid"), ({"grant_id": ""}, "binding_invalid")):
        result = refused(**over)
        assert (result["state"], result["reason"]) == ("refused", reason), over
    incomplete = fake_binding(tmp_path)
    (tmp_path / "fake-model" / "model.bin").unlink()  # a model directory that lost a file: nothing is downloaded to complete it
    assert rn.SpeechRunner(settings, journal, binding=incomplete, worker_script=FAKE_WORKER, timings=rn.Timings(**FAST)).run(chunk_seconds=25)["reason"] == "model_missing"
    assert not (speech_dir(settings) / "queue.json").exists() and not (speech_dir(settings) / "allowance.json").exists() and fake_log(tmp_path) == []
    assert [(r["outcome"], r["state"]) for r in receipts(journal)] == [("refused", "refused")] * 9
    # One supervisor at a time: while a run holds the lock, another is refused and touches nothing.
    with rn.RunLock(speech_dir(settings) / "run.lock") as held:
        assert held.acquired
        busy = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (busy["state"], busy["reason"]) == ("refused", "already_running")
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, max_chunks=1)["state"] == "max_chunks_reached"


def test_status_before_any_run_lists_every_recording_without_a_queue_and_never_hashes_or_writes(settings, journal, tmp_path):
    before = private_files(settings)
    status = rn.status(settings)  # no binding in the fixture profile: the status still answers
    assert status["queue"]["exists"] is False and status["allowance"] == {"grant_id": None, "ceiling_seconds": None, "used_seconds": 0.0, "remaining_seconds": None,
                                                                         "in_flight_seconds": 0.0, "open_reservation": None, "ledger": "not_created"}
    rows = [r for course in status["courses"].values() for r in course["recordings"]]
    assert len(rows) == 4 and {r["state"] for r in rows} == {"not_in_frozen_queue"} and {r["reason"] for r in rows} == {"queue_not_created"}
    assert all(r["seconds_covered"] == 0.0 and r["chunks_done"] == 0 and r["duration_seconds"] > 0 for r in rows)
    assert set(status["courses"]) == set(settings.courses) and status["binding"]["status"] == "no_binding"
    assert private_files(settings) == before and not speech_dir(settings).exists() and journal.receipts(kind="speech-run") == []


def test_the_commands_run_the_same_runner_and_print_the_status(workspace, settings, tmp_path, monkeypatch, capsys, control):
    from lecture_brain import cli

    binding_file = tmp_path / "speech-binding.json"
    binding_file.write_text(json.dumps({**fake_binding(tmp_path), "worker_script": str(FAKE_WORKER), "timings": FAST}), encoding="utf-8")
    monkeypatch.setenv("LL_FIXTURE_ROOT", str(workspace))
    monkeypatch.setenv("LL_SPEECH_BINDING", str(binding_file))
    base = ["--profile", "fixture", "--state-dir", str(settings.state_dir)]

    def run(*args):
        code = cli.main([*base, *args])
        return code, json.loads(capsys.readouterr().out)

    code, before = run("speech-status")
    assert code == 0 and before["queue"]["exists"] is False and before["binding"]["status"] == "ok" and before["allowance"]["grant_id"] == GRANT
    code, first = run("speech-run", "--chunk-seconds", "25", "--priority", L1, "--max-chunks", "2", "--max-seconds", "300")
    assert code == 0 and (first["state"], first["chunks_completed"]) == ("max_chunks_reached", 2)
    code, status = run("speech-status")
    row = next(r for r in status["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert code == 0 and (row["state"], row["seconds_covered"], row["chunks_done"]) == ("partial", 52.0, 2) and status["allowance"]["used_seconds"] > 0
    assert status["resume_argv"][1:4] == ["-m", "lecture_brain", "--profile"] and status["resume_argv"][-1] == "speech-run" and str(settings.state_dir) in status["resume_argv"]
    code, rest = run("speech-run", "--course", "be505", "--course", "be562")
    assert code == 0 and rest["state"] == "completed" and rest["chunks_completed"] == 4
    code, refused = run("speech-run", "--course", "not-a-course")
    assert code == 1 and refused["reason"] == "unknown_course"
    code, done = run("speech-run")
    assert code == 0 and done["state"] == "completed" and done["chunks_completed"] == 1  # DS 551 was outside the earlier selection
    code, idle = run("speech-run")
    assert code == 0 and idle["state"] == "no_change"
    # Outside the fixture profile the binding comes from the private binding file only; here there is none for the real-folder profile.
    opened = Journal.open(settings.journal_path, synced_roots=[])
    try:
        assert [r["payload"]["state"] for r in opened.receipts(kind="speech-run")] == ["max_chunks_reached", "completed", "refused", "completed", "no_change"]
    finally:
        opened.close()


def test_the_real_worker_is_a_standalone_script_and_nothing_in_the_app_imports_a_speech_library(repo):
    """The supervisor launches the worker with another interpreter; the app's own environment has no speech packages
    and must not need any. The worker must not depend on the app either."""
    import ast

    package = repo / "brain" / "src" / "lecture_brain"
    speech_libraries = {"faster_whisper", "ctranslate2", "av", "numpy", "torch", "whisper"}
    for path in package.rglob("*.py"):
        tree_ = ast.parse(path.read_text(encoding="utf-8"))
        imported = {alias.name.split(".")[0] for node in ast.walk(tree_) if isinstance(node, ast.Import) for alias in node.names}
        imported |= {node.module.split(".")[0] for node in ast.walk(tree_) if isinstance(node, ast.ImportFrom) and node.module and node.level == 0}
        relative = any(isinstance(node, ast.ImportFrom) and node.level > 0 for node in ast.walk(tree_))
        if path.name == "worker.py" and path.parent.name == "speech":
            assert not relative and "lecture_brain" not in imported, "the worker must run without the app"
            assert {"faster_whisper", "av", "numpy"} <= imported
        else:
            assert not (imported & speech_libraries), path
    probe = subprocess.run([sys.executable, "-c", "import sys, lecture_brain.speech.runner, lecture_brain.derived; print(sorted(m for m in sys.modules if m.split('.')[0] in "
                            "{'faster_whisper', 'ctranslate2', 'av', 'numpy', 'torch'}))"], capture_output=True, text=True, check=True)
    assert probe.stdout.strip() == "[]"
    assert rn.INFERENCE_SETTINGS == {"language": "en", "task": "transcribe", "beam_size": 5, "best_of": 1, "temperature": 0.0, "word_timestamps": True, "vad_filter": False,
                                     "condition_on_previous_text": True, "compression_ratio_threshold": 2.4, "log_prob_threshold": -1.0, "no_speech_threshold": 0.6}
    assert rn.MAX_THREADS == 4 and rn.WORKERS == 1 and rn.MAX_CEILING_SECONDS == 14_400
    environment = rn.child_environment({"PATH": "x", "PYTHONPATH": "leak", "PYTHONHOME": "leak", "VIRTUAL_ENV": "leak", "__PYVENV_LAUNCHER__": "leak"}, threads=4, temp_dir=Path("t"))
    assert environment["HF_HUB_OFFLINE"] == "1" and environment["TRANSFORMERS_OFFLINE"] == "1" and environment["PYTHONDONTWRITEBYTECODE"] == "1" and environment["OMP_NUM_THREADS"] == "4"
    assert not ({"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"} & set(environment)) and environment["PATH"] == "x"


def test_the_ceiling_is_a_hard_bound_while_a_chunk_is_running_and_a_silent_worker_is_stopped(settings, journal, tmp_path, control):
    control(hang_at=0)  # the worker never leaves the first chunk
    limits = {"ceiling_seconds": 2.0, "safety_margin_seconds": 0.6}
    hard = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
    assert (hard["state"], hard["reason"], hard["chunks_completed"]) == ("ceiling_reached", "hard_ceiling", 0), hard
    used = ledger_doc(settings)["used_seconds"]
    assert 1.0 < used <= 2.0 and hard["allowance"]["used_after"] == used  # the child was stopped before the ceiling, not after it
    assert not list((speech_dir(settings) / "work").rglob("chunk-*.json")) and queue_items(settings)[L1]["state"] == "queued"  # the interrupted chunk left nothing; the queue is kept
    again = make_runner(settings, journal, tmp_path, **limits).run(chunk_seconds=25)
    assert (again["state"], again["chunks_completed"], again["wall_seconds"]) == ("ceiling_reached", 0, 0.0) and ledger_doc(settings)["used_seconds"] == used


def test_a_worker_that_goes_silent_is_stopped_by_its_supervisor_and_counted_as_a_failed_chunk(settings, journal, tmp_path, control):
    control(mute_at=1)  # inside the second chunk: no heartbeat, deaf to the stop file and the lease
    runner = rn.SpeechRunner(settings, journal, binding=fake_binding(tmp_path), worker_script=FAKE_WORKER, timings=rn.Timings(**{**FAST, "stall_seconds": 0.8}))
    stalled = runner.run(chunk_seconds=25)
    assert (stalled["state"], stalled["reason"], stalled["chunks_completed"]) == ("failed", "worker_stalled", 1), stalled
    item = queue_items(settings)[L1]
    assert item["state"] == "partial" and item["failures"] == {"1": 1} and "no heartbeat" in item["last_error"]
    assert ledger_doc(settings)["open"] is None and ledger_doc(settings)["used_seconds"] >= 0.8  # the time it was silent is charged too
    # A runtime that cannot even start is a resource failure: the run is charged, no chunk and no recording is blamed, and the queue is paused.
    control(startup_error=True)
    used = ledger_doc(settings)["used_seconds"]
    broken = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (broken["state"], broken["reason"], broken["chunks_completed"]) == ("paused", "worker_startup_failed", 0) and "cannot start" in broken["detail"], broken
    assert broken["pause"]["recording"] is None and broken["pause"]["worker_reason"] == "worker_startup_failed" and ledger_doc(settings)["used_seconds"] > used
    used = ledger_doc(settings)["used_seconds"]
    for _ in range(2):  # a wrapper that repeats the command is not charged for one start-up after another
        idle = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (idle["state"], idle["reason"], idle["wall_seconds"]) == ("paused", "resource_failure", 0.0)
    assert queue_items(settings)[L1]["failures"] == {"1": 1} and queue_items(settings)[L1]["state"] == "partial" and ledger_doc(settings)["used_seconds"] == used
    control()
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "paused"  # the cause is gone, but only the owner says to go on
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)["state"] == "completed" and queue_items(settings)[L1]["failures"] == {"1": 1}


def test_a_chunk_caught_in_a_repetition_loop_is_decoded_once_more_and_what_still_fails_is_withheld_not_published(settings, journal, tmp_path, control):
    assert rn.SECOND_PASS_SETTINGS == {"condition_on_previous_text": False, "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]} and rn.REPETITION_THRESHOLD == 2.4
    derived = Derived(settings, journal)

    # 1. The first pass of the second chunk loops; the second pass the job asks for gives the words.
    control(loop_chunks=[1], second_pass_fixes=True)
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be505"])
    assert first["state"] == "completed" and first["chunks_completed"] == 5, first
    items = queue_items(settings)
    job = json.loads((speech_dir(settings) / "run" / "job.json").read_text(encoding="utf-8"))
    assert job["second_pass_settings"] == rn.SECOND_PASS_SETTINGS and job["decoding_policy"] == rn.DECODING_POLICY and job["settings"] == rn.INFERENCE_SETTINGS
    stored = json.loads((speech_dir(settings) / "work" / items[L1]["work_id"] / "chunk-0001.json").read_text(encoding="utf-8"))
    assert stored["decoding"]["pass"] == "second" and stored["decoding"]["policy"] == rn.DECODING_POLICY and stored["decoding"]["primary"]["failed_words"] == 40
    current = derived.current("be505", "src-lecture-01-recording")
    assert words_of(current) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)] and current["provenance"]["unresolved_intervals"] == []
    assert current["provenance"]["decoding"]["chunks_kept_from_second_pass"] == 1 and [c["decoding_pass"] for c in current["provenance"]["chunks"]] == ["primary", "second", "primary"]
    assert all(r["unresolved_seconds"] == 0.0 for r in make_runner(settings, journal, tmp_path).status()["courses"]["be505"]["recordings"])

    # 2. The loop survives the second pass: the chunk counts as processed, its text is withheld, its time is reported unresolved.
    be562 = "be562/src-lecture-01-audio"
    control(loop_chunks=[0], only_work=items[be562]["work_id"])
    second = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be562"])
    assert second["state"] == "completed" and second["chunks_completed"] == 1
    # Every chunk is merged ("complete"), and still the recording is not covered at all: the chunk holds nothing but withheld text, so nothing in
    # it is known. (The loop's own times, 1 s .. 5 s, are not what is unresolved: no accepted text bounds it, so the whole chunk is.)
    assert [(p["unresolved_seconds"], p["covered_seconds"], p["withheld_repetition_words"], p["words"], p["complete"], p["covers_whole_recording"]) for p in second["published"]] == [
        (6.0, 0.0, 40, 0, True, False)]
    stored = json.loads((speech_dir(settings) / "work" / items[be562]["work_id"] / "chunk-0000.json").read_text(encoding="utf-8"))
    assert stored["decoding"]["pass"] == "primary" and stored["decoding"]["second"]["failed_words"] == 40 and stored["decoding"]["second_pass_sha256"] == rn.SECOND_PASS_SHA256
    quiet = derived.current("be562", "src-lecture-01-audio")
    assert quiet["segments"] == [] and quiet["window"] == {"start_ms": 0, "end_ms": 6_000} and "okay" not in json.dumps(quiet["segments"])
    assert quiet["provenance"]["unresolved_intervals"] == [{"start_ms": 0, "end_ms": 6_000, "reason": "repetition_check_failed"}]
    assert quiet["provenance"]["merge"]["withheld_repetition_words"] == 40 and quiet["provenance"]["counts"]["words"] == 0 and quiet["provenance"]["decoding"]["merge_policy"] == "withhold-repetition-3"
    assert quiet["provenance"]["publication"]["unresolved_rule"] == ch.UNRESOLVED_RULE and quiet["provenance"]["merge"]["withheld_repetition_runs"] == 1
    # The reader does not take the withheld six seconds for covered speech or for silence: they are unresolved, and the recording is not whole.
    assert quiet["unresolved_intervals"] == [{"start_ms": 0, "end_ms": 6_000, "reason": "repetition_check_failed"}] and quiet["unresolved_seconds"] == 6.0
    assert quiet["covered_intervals"] == [] and quiet["covers_whole_recording"] is False
    assert quiet["coverage_fraction"] == 0.0 and quiet["processed_fraction"] == pytest.approx(1.0) and quiet["provenance"]["covers_whole_recording"] is False
    assert quiet["provenance"]["decoding"]["chunks_decoded_twice"] == 1 and quiet["provenance"]["decoding"]["chunks_kept_from_second_pass"] == 0
    assert quiet["provenance"]["decoding"]["second_pass_sha256"] == rn.SECOND_PASS_SHA256 and quiet["provenance"]["decoding"]["chunks_with_other_second_pass"] == []
    assert quiet["provenance"]["chunks"][0]["second_pass_sha256"] == rn.SECOND_PASS_SHA256 and quiet["provenance"]["chunks"][0]["selection"]["kept"] == "primary"
    assert queue_items(settings)[be562]["state"] == "complete_with_unresolved"  # every chunk is published, but this is not plain complete
    status = make_runner(settings, journal, tmp_path).status()
    row = status["courses"]["be562"]["recordings"][0]
    assert (row["state"], row["seconds_processed"], row["seconds_published"], row["seconds_covered"], row["unresolved_seconds"]) == ("complete_with_unresolved", 6.0, 6.0, 0.0, 6.0)
    assert row["covered_intervals"] == quiet["covered_intervals"] and row["unresolved_intervals"] == quiet["unresolved_intervals"]
    assert row["coverage_fraction"] == 0.0 and row["covers_whole_recording"] is False and status["totals"]["unresolved_seconds"] == 6.0
    assert status["totals"]["states"]["complete_with_unresolved"] == 1 and status["courses"]["be562"]["totals"]["complete"] == 0
    assert status["courses"]["be562"]["totals"]["unresolved_seconds"] == 6.0 and status["courses"]["be562"]["totals"]["seconds_covered"] == 0.0 and "withheld" in status["note"]
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be562"])["state"] == "no_change"  # nothing to do again: it is finished, just not whole

    # 3. A chunk on disk that is mostly loop output and was made WITHOUT this policy (an older worker) is not a finished chunk: it is done again.
    ds551 = next(key for key in items if key.startswith("ds551/"))
    source_id, work = items[ds551]["source_id"], speech_dir(settings) / "work" / items[ds551]["work_id"]
    control(loop_chunks=[0], only_work=items[ds551]["work_id"])
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["ds551"])["state"] == "completed"
    older = json.loads((work / "chunk-0000.json").read_text(encoding="utf-8"))
    del older["decoding"]
    (work / "chunk-0000.json").write_text(json.dumps(older), encoding="utf-8")
    withheld = derived.current("ds551", source_id)["generation"]
    control(loop_chunks=[0], second_pass_fixes=True, only_work=items[ds551]["work_id"])
    redone = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["ds551"])
    assert redone["state"] == "completed" and redone["chunks_completed"] == 1 and fake_log(tmp_path).count(f"start {items[ds551]['work_id']} 0") == 2
    again = derived.current("ds551", source_id)
    assert again["generation"] != withheld and words_of(again) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(3)] and again["provenance"]["unresolved_intervals"] == []
    assert {g["generation"]: g["state"] for r in derived.status("ds551")["recordings"] if r["source_id"] == source_id for g in r["generations"]} == {withheld: "superseded", again["generation"]: "current"}
    assert make_runner(settings, journal, tmp_path).status()["courses"]["ds551"]["recordings"][0]["unresolved_seconds"] == 0.0
    # An ordinary chunk without the policy field stays what it is: finished. Nothing is redone and nothing is published again.
    plain = speech_dir(settings) / "work" / items[L1]["work_id"] / "chunk-0000.json"
    document = json.loads(plain.read_text(encoding="utf-8"))
    del document["decoding"]
    plain.write_text(json.dumps(document), encoding="utf-8")
    control()
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "no_change"


def test_a_recording_whose_audio_cannot_be_decoded_is_its_own_problem_and_the_rest_of_the_queue_goes_on(settings, journal, tmp_path, control):
    control(decode_error_at=1)  # the second chunk of BOTH BE 505 recordings cannot be decoded
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["chunks_completed"]) == ("completed", 4), first  # the first chunk of each, and the two short recordings: the run itself did not fail
    items = queue_items(settings)
    second_key = next(key for key in items if key.startswith("be505/unreg-"))
    for key in (L1, second_key):
        assert items[key]["state"] == "partial" and items[key]["chunks_done"] == 1 and items[key]["failures"] == {"1": 1} and "cannot be decoded" in items[key]["last_error"]
    assert [line for line in fake_log(tmp_path) if line.startswith("start")].count(f"start {items[L1]['work_id']} 2") == 0  # nothing after the chunk that failed
    assert first["remaining"] == {"recordings": 2, "chunks": 3, "source_conflict": 0, "failed": 0}
    # Still undecodable on the next run: both are set aside, visibly, and later runs have nothing left to do.
    again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (again["state"], again["chunks_completed"]) == ("completed", 0) and again["remaining"] == {"recordings": 0, "chunks": 0, "source_conflict": 0, "failed": 2}
    row = next(r for r in make_runner(settings, journal, tmp_path).status()["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["reason"], row["seconds_covered"], row["chunks_done"]) == ("failed", "chunk_failed", 27.0, 1) and "cannot be decoded" in row["last_error"]
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "no_change"
    control()
    fixed = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert (fixed["state"], fixed["chunks_completed"]) == ("completed", 3) and {item["state"] for item in queue_items(settings).values()} == {"complete"}


def test_with_real_course_folders_the_runner_writes_only_below_the_private_state_directory(workspace, tmp_path, control, monkeypatch):
    """The read-only profile used for real course folders: after a whole run the course and planner folders are
    byte-identical, everything the runner made is below the private state directory, and a caller that passes no
    journal still leaves its receipts in the app's one journal."""
    from lecture_brain.config import load_settings

    settings = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "private-state")
    courses_before = {cid: tree(binding.root) for cid, binding in settings.courses.items()}
    planner_before = tree(settings.planner_root)

    runner = rn.SpeechRunner(settings, None, binding=fake_binding(tmp_path, state_dir=str(tmp_path / "private-state")), worker_script=FAKE_WORKER, timings=rn.Timings(**FAST))
    result = runner.run(chunk_seconds=25)

    assert result["state"] == "completed" and result["chunks_completed"] == 7 and result["receipt_id"], result
    assert {cid: tree(binding.root) for cid, binding in settings.courses.items()} == courses_before and tree(settings.planner_root) == planner_before
    private = tmp_path / "private-state"
    assert speech_dir(settings).is_relative_to(private) and Derived(settings).store_dir("be505").is_relative_to(private)
    assert Derived(settings).current("be505", "src-lecture-01-recording")["covers_whole_recording"] is True
    assert str(private) in " ".join(runner.status()["resume_argv"]) and "--profile local" in runner.status()["resume_command"]
    opened = Journal.open(settings.journal_path, synced_roots=settings.synced_roots)
    try:
        assert [(r["payload"]["outcome"], r["payload"]["state"]) for r in opened.receipts(kind="speech-run")] == [("ran", "completed")]
        assert [r["payload"]["outcome"] for r in opened.receipts(kind="derived-import")] == ["imported"] * 7 and opened.counts()["jobs"] == 0
    finally:
        opened.close()
    # Outside the fixture profile the binding is the private file only, and keys that exist for tests are not honoured there.
    private_binding = tmp_path / "speech.json"
    private_binding.write_text(json.dumps({**fake_binding(tmp_path), "worker_script": str(FAKE_WORKER), "timings": FAST}), encoding="utf-8")
    monkeypatch.setattr(rn, "binding_path", lambda _settings: private_binding)
    monkeypatch.setenv("LL_SPEECH_BINDING", str(tmp_path / "ignored-outside-the-fixture-profile.json"))
    loaded = rn.load_binding(settings)
    assert loaded["grant_id"] == GRANT and "worker_script" not in loaded and "timings" not in loaded
    private_binding.unlink()
    assert rn.load_binding(settings) is None and rn.SpeechRunner(settings, None).status()["binding"]["status"] == "no_binding"


def test_the_package_functions_are_the_same_runner_and_load_it_only_when_called(settings, journal, tmp_path, control, monkeypatch):
    import lecture_brain.speech as speech

    binding_file = tmp_path / "speech-binding.json"
    binding_file.write_text(json.dumps({**fake_binding(tmp_path), "worker_script": str(FAKE_WORKER), "timings": FAST}), encoding="utf-8")
    monkeypatch.setenv("LL_SPEECH_BINDING", str(binding_file))
    assert speech.status(settings)["binding"]["status"] == "ok"
    done = speech.run(settings, journal, chunk_seconds=25, max_chunks=1)
    assert done["state"] == "max_chunks_reached" and speech.status(settings)["totals"]["states"]["partial"] == 1
    loaded = subprocess.run([sys.executable, "-c", "import sys, lecture_brain.speech, lecture_brain.derived; print('lecture_brain.speech.runner' in sys.modules)"],
                            capture_output=True, text=True, check=True)
    assert loaded.stdout.strip() == "False"  # importing the importer (as the lecture view does) does not load the supervisor


# ---- the REAL worker script, run with labelled stub modules instead of a speech runtime ------------------------------
STUB_LAUNCHER = Path(__file__).with_name("stubs") / "real_worker_with_stubs.py"
STUB_RATE = 200  # samples per second of the made-up audio: enough for the worker's arithmetic, small enough for lists


class RealWorker:
    """Launches ``lecture_brain/speech/worker.py`` itself (through the labelled launcher that puts the stub modules on
    its import path) on a hand-written job file, as the supervisor would."""

    def __init__(self, tmp_path: Path, monkeypatch):
        from lecture_brain.fixtures.builder import write_wav

        self.base = tmp_path / "real-worker"
        self.model = self.base / "model"
        self.model.mkdir(parents=True)
        for name in ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt"):
            (self.model / name).write_text("LABELLED PLACEHOLDER: not a speech model\n", encoding="utf-8")
        self.media = self.base / "synthetic-60s.wav"
        write_wav(self.media, [(0, 60)])
        self.other = self.base / "synthetic-6s.wav"
        write_wav(self.other, [(0, 6)])
        self.plan = ch.plan_chunks(60_000, 25_000, 2_000)
        self.control_path = self.base / "stub-control.json"
        monkeypatch.setenv("LL_STUB_SPEECH_CONTROL", str(self.control_path))

    def jobs(self, media: Path, work_id: str, plan: list[dict], folder: Path, sha256: str | None = None) -> list[dict]:
        return [{"work_id": work_id, "media_path": str(media), "sha256": sha256 or hashlib.sha256(media.read_bytes()).hexdigest(), "bytes": media.stat().st_size, "index": entry["index"],
                 "start_ms": entry["start_ms"], "end_ms": entry["end_ms"], "last": entry["index"] == len(plan) - 1, "out_path": str(folder / work_id / f"chunk-{entry['index']:04d}.json")}
                for entry in plan]

    def run(self, name: str, *, jobs=None, control=None, lease_in=60.0, stop=False, deadline_in=600.0, hard_stop_in=None, edits=None, heartbeat_refused=False) -> dict:
        folder = self.base / name
        folder.mkdir()
        record = folder / "stub-record.jsonl"
        self.control_path.write_text(json.dumps({"record": str(record), **(control or {})}), encoding="utf-8")
        paths = {key: folder / f"{key}.json" for key in ("heartbeat", "lease", "result")}
        if heartbeat_refused:
            paths["heartbeat"].mkdir()  # a folder where the heartbeat file belongs: every attempt to put the file there is refused by the system
        if stop:
            (folder / "STOP").write_text("stop", encoding="utf-8")
        paths["lease"].write_text(json.dumps({"until": time.time() + lease_in}), encoding="utf-8")
        job = {"document": "speech-job/1", "run_id": name, "model_dir": str(self.model), "cpu_threads": 4, "num_workers": 1, "device": rn.DEVICE, "compute_type": rn.COMPUTE_TYPE,
               "sample_rate_hz": STUB_RATE, "settings": dict(rn.INFERENCE_SETTINGS), "settings_sha256": "0" * 64, "model_bin_sha256": None, "decoding_policy": rn.DECODING_POLICY,
               "second_pass_settings": dict(rn.SECOND_PASS_SETTINGS), "second_pass_sha256": rn.SECOND_PASS_SHA256,
               "heartbeat_path": str(paths["heartbeat"]), "lease_path": str(paths["lease"]), "stop_path": str(folder / "STOP"), "result_path": str(paths["result"]),
               "not_after_epoch": time.time() + deadline_in, "hard_stop_epoch": None if hard_stop_in is None else time.time() + hard_stop_in,
               "jobs": self.jobs(self.media, "work00000001", self.plan, folder) if jobs is None else jobs(folder), **(edits or {})}
        (folder / "job.json").write_text(json.dumps(job), encoding="utf-8")
        done = subprocess.run([sys.executable, "-B", str(STUB_LAUNCHER), "--job", str(folder / "job.json")], capture_output=True, text=True, timeout=120)
        calls = [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()] if record.exists() else []
        return {"code": done.returncode, "result": json.loads(paths["result"].read_text(encoding="utf-8")) if paths["result"].exists() else None, "calls": calls, "folder": folder,
                "chunks": {path.parent.name + "/" + path.name: json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.rglob("chunk-*.json"))},
                "heartbeat": json.loads(paths["heartbeat"].read_text(encoding="utf-8")) if paths["heartbeat"].is_file() else None, "output": done.stdout + done.stderr}


@pytest.fixture()
def real_worker(tmp_path, monkeypatch) -> RealWorker:
    return RealWorker(tmp_path, monkeypatch)


def test_the_real_worker_script_writes_chunk_results_the_merge_and_the_supervisor_accept(real_worker):
    """No test double of the worker here: the script the speech interpreter runs is executed as it is. Only the three
    third-party modules are LABELLED STUBS (no model, no decoding, no recognition; see tests/stubs/speech_runtime)."""
    done = real_worker.run("plain")

    assert done["code"] == 0 and done["result"]["ended"] == "completed" and done["result"]["jobs_done"] == 3, done["output"]
    assert done["result"]["document"] == "speech-worker-result/1" and done["result"]["conflicts"] == [] and done["result"]["chunk_errors"] == []
    assert done["result"]["labelled_double"] is True and done["result"]["tool"] == "labelled-stub-speech-runtime"  # the stub declares itself; the worker labels everything it writes
    assert done["heartbeat"]["phase"] == "chunk_done" and done["heartbeat"]["job"] == 2 and done["heartbeat"]["tool"] == "labelled-stub-speech-runtime"
    # One model, on the CPU, int8, one worker, the job's four threads, local files only, from the explicit directory.
    model = [call for call in done["calls"] if call["call"] == "model"]
    assert model == [{"call": "model", "model_dir": str(real_worker.model), "kwargs": {"device": "cpu", "compute_type": "int8", "cpu_threads": 4, "num_workers": 1, "local_files_only": True}}]
    # Each chunk was decoded for exactly its own range of the recording (the stub checks every sample sits at its own time) and transcribed once with the job's settings.
    passes = [(call["offset_ms"], call["length_ms"], call["pass"]) for call in done["calls"] if call["call"] == "transcribe"]
    assert passes == [(0, 27_000, "primary"), (25_000, 27_000, "primary"), (50_000, 10_000, "primary")]
    assert all(call["options"] == rn.INFERENCE_SETTINGS for call in done["calls"] if call["call"] == "transcribe")
    chunks = [done["chunks"][f"work00000001/chunk-{n:04d}.json"] for n in range(3)]
    sha256, size = hashlib.sha256(real_worker.media.read_bytes()).hexdigest(), real_worker.media.stat().st_size
    for index, (document, entry) in enumerate(zip(chunks, real_worker.plan)):
        assert document["document"] == "speech-chunk/1" and (document["work_id"], document["index"], document["offset_ms"], document["end_ms"]) == ("work00000001", index, entry["start_ms"], entry["end_ms"])
        assert document["decoded_ms"] == entry["end_ms"] - entry["start_ms"] and document["recording"] == {"sha256": sha256, "bytes": size} and document["settings_sha256"] == "0" * 64
        assert document["settings"] == rn.INFERENCE_SETTINGS and document["labelled_double"] is True and document["runtime"]["tool"] == "labelled-stub-speech-runtime"
        assert document["runtime"]["device"] == "cpu" and document["runtime"]["compute_type"] == "int8" and document["runtime"]["threads"] == 4 and document["runtime"]["workers"] == 1
        assert document["decoding"] == {"policy": rn.DECODING_POLICY, "pass": "primary", "repetition_threshold": 2.4, "second": None, "second_pass_sha256": None, "selection": None,
                                        "primary": document["decoding"]["primary"]} and document["decoding"]["primary"]["failed_words"] == 0
        assert document["decode"]["output_sample_rate"] == STUB_RATE and document["decode"]["gap_samples"] == 0 and document["decode"]["requested_original_range_seconds"] == [entry["start_ms"] / 1000, entry["end_ms"] / 1000]
        assert document["word_count"] == sum(len(s["words"]) for s in document["segments"]) and document["segment_count"] == len(document["segments"]) and rn._TIME.match(document["completed_at"])
    assert [c_["end_of_stream"] for c_ in chunks] == [False, False, False]  # the last chunk ends exactly with the recording: every sample asked for was there
    assert chunks[1]["segments"][0]["words"][0] == {"text": "w13", "start": 1.3, "end": 1.7, "probability": 0.5}  # chunk-LOCAL seconds: 26.3 s of the recording
    # What the worker wrote is what the merge takes: every fabricated word exactly once, at its time in the recording.
    merged = ch.merge_prefix(real_worker.plan, chunks, duration_ms=60_000, tolerance_ms=500, repetition_threshold=rn.REPETITION_THRESHOLD)
    assert merged_words(merged) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)] and merged["complete"] and merged["unresolved"] == []

    # A recording whose container says more than its audio holds: the last chunk ends early, says so, and is still a finished chunk.
    longer = ch.plan_chunks(63_000, 25_000, 2_000)
    short = real_worker.run("ends-early", jobs=lambda folder: real_worker.jobs(real_worker.media, "work00000002", longer, folder)[2:])
    last = short["chunks"]["work00000002/chunk-0002.json"]
    assert short["result"]["ended"] == "completed" and (last["end_ms"], last["decoded_ms"], last["end_of_stream"]) == (63_000, 10_000, True)
    # A container whose first timestamp is not zero: recording time still starts at zero.
    shifted = real_worker.run("origin", control={"origin_seconds": 1.5}, jobs=lambda folder: real_worker.jobs(real_worker.media, "work00000003", real_worker.plan, folder)[1:2])
    moved = shifted["chunks"]["work00000003/chunk-0001.json"]
    assert shifted["result"]["ended"] == "completed" and moved["decode"]["media_origin_seconds"] == 1.5 and moved["decoded_ms"] == 27_000
    assert moved["segments"][0]["words"][0]["text"] == "w13" and moved["segments"][0]["words"][0]["start"] == 1.3


def test_the_real_worker_script_stops_refuses_and_reports_as_the_supervisor_expects(real_worker):
    def ended(done) -> tuple:
        return done["code"], done["result"]["ended"], done["result"]["jobs_done"], sorted(done["chunks"])

    # Stopping: the deadline (between chunks), the stop file, a lease nobody refreshes, the hard stop at the ceiling.
    assert ended(real_worker.run("deadline", deadline_in=-1.0)) == (0, "deadline", 0, [])
    assert ended(real_worker.run("stop-file", stop=True)) == (0, "stop", 0, [])
    assert ended(real_worker.run("lease-gone", lease_in=-5.0)) == (4, "lease_lost", 0, [])
    assert ended(real_worker.run("hard-stop", hard_stop_in=-1.0)) == (0, "hard_ceiling", 0, [])
    # Inside a chunk: the lease runs out while segments are still coming; the interrupted chunk leaves no result.
    inside = real_worker.run("lease-inside", lease_in=3.0, control={"seconds_per_segment": 1.3})
    assert ended(inside) == (4, "lease_lost", 0, []) and [call["offset_ms"] for call in inside["calls"] if call["call"] == "transcribe"] == [0]  # it was inside the first chunk
    inside = real_worker.run("hard-stop-inside", hard_stop_in=3.0, control={"seconds_per_segment": 1.3})
    assert ended(inside) == (0, "hard_ceiling", 0, []) and [call["offset_ms"] for call in inside["calls"] if call["call"] == "transcribe"] == [0]
    # A step that passes no checkpoint (here: a model that takes twenty seconds to load) does not outlive a lost lease either: the watchdog ends the process.
    began = time.monotonic()
    stuck = real_worker.run("lease-in-model-load", lease_in=2.5, control={"model_load_seconds": 20}, edits={"watchdog_grace_seconds": 0.5})
    assert ended(stuck) == (4, "lease_lost", 0, []) and stuck["result"]["by"] == "watchdog" and time.monotonic() - began < 15, stuck["output"]

    # The recording is not the frozen bytes: a conflict for that recording, the others go on.
    def two_recordings(folder, **over):
        return [*real_worker.jobs(real_worker.media, "work00000001", real_worker.plan, folder, **over), *real_worker.jobs(real_worker.other, "work00000002", ch.plan_chunks(6_000, 25_000, 2_000), folder)]

    conflict = real_worker.run("conflict", jobs=lambda folder: two_recordings(folder, sha256="f" * 64))
    assert ended(conflict) == (0, "completed", 1, ["work00000002/chunk-0000.json"]) and conflict["result"]["conflicts"] == ["work00000001"]
    # Audio that cannot be decoded: that recording's chunk is reported and its other chunks skipped; the others go on.
    undecodable = real_worker.run("undecodable", control={"undecodable": [real_worker.media.name]}, jobs=two_recordings)
    assert ended(undecodable) == (0, "completed", 1, ["work00000002/chunk-0000.json"])
    assert [(e["position"], e["work_id"], e["index"]) for e in undecodable["result"]["chunk_errors"]] == [(0, "work00000001", 0)] and "undecodable" in undecodable["result"]["chunk_errors"][0]["error"]
    # Missing audio is never padded: a hole inside the range, and a hole at its END while the stream goes on, are decoding errors, not short chunks.
    for name, hole in (("hole-inside", [[10.0, 12.0]]), ("hole-at-the-end", [[25.0, 28.0]])):
        gap = real_worker.run(name, control={"missing_audio": hole})
        assert ended(gap) == (0, "completed", 0, []) and len(gap["result"]["chunk_errors"]) == 1 and "nothing is padded" in gap["result"]["chunk_errors"][0]["error"], name
    small = real_worker.run("small-hole", control={"missing_audio": [[10.0, 10.5]]})  # half a second is within the stated tolerance
    assert ended(small)[:3] == (0, "completed", 3) and small["chunks"]["work00000001/chunk-0000.json"]["decode"]["gap_samples"] == STUB_RATE // 2
    # A failure of the runtime while a chunk is transcribed: reported with the chunk it happened in, exit code 2, nothing written for that chunk.
    broken = real_worker.run("out-of-memory", control={"error_offsets": [25]})
    assert ended(broken) == (2, "error", 1, ["work00000001/chunk-0000.json"]) and broken["result"]["error_job"] == 1 and "MemoryError" in broken["result"]["error"] and "phase" not in broken["result"]

    # Limits are the worker's own, whatever a job says: threads are capped; anything but CPU, int8 and one worker is refused before a model is loaded.
    capped = real_worker.run("threads-16", edits={"cpu_threads": 16}, deadline_in=-1.0)
    assert [call["kwargs"]["cpu_threads"] for call in capped["calls"] if call["call"] == "model"] == [4]
    for name, edits in (("gpu", {"device": "cuda"}), ("two-workers", {"num_workers": 2}), ("float16", {"compute_type": "float16"}), ("model-pin", {"model_bin_sha256": "a" * 64}),
                        ("other-second-pass", {"second_pass_sha256": "b" * 64})):
        refused = real_worker.run(name, edits=edits)
        assert (refused["code"], refused["result"]["ended"], refused["result"]["phase"], refused["result"]["error_job"]) == (2, "error", "startup", None), name
        assert refused["calls"] == [] and refused["chunks"] == {}, name  # no model was constructed
    (real_worker.model / "tokenizer.json").unlink()
    incomplete = real_worker.run("model-incomplete")
    assert incomplete["result"]["phase"] == "startup" and "nothing is downloaded" in incomplete["result"]["error"] and incomplete["calls"] == []


def test_a_heartbeat_the_real_worker_cannot_write_is_skipped_and_is_nobodys_failure(real_worker):
    """Seen on this machine under load with the labelled fake worker: for most of a second the heartbeat file could
    not be replaced (something else had it open), the write raised and the worker was gone. In the real worker the
    same refusal was an error of the runtime at startup or inside a chunk (the queue pauses), and at the step that
    verifies the recording it was caught as a "source conflict" of that recording. A heartbeat is only a sign of
    life: one that cannot be written is skipped and the next one is tried as usual. The supervisor ends a worker
    whose heartbeat stays silent; the worker does not end itself, pause the queue or blame a recording over it."""
    began = time.monotonic()
    done = real_worker.run("heartbeat-refused", heartbeat_refused=True)

    assert done["result"] is not None and (done["code"], done["result"]["ended"], done["result"]["jobs_done"]) == (0, "completed", 3), done["output"]
    assert done["result"]["conflicts"] == [] and done["result"]["chunk_errors"] == [] and sorted(done["chunks"]) == [f"work00000001/chunk-{n:04d}.json" for n in range(3)]
    assert done["heartbeat"] is None and (done["folder"] / "heartbeat.json").is_dir() and not list(done["folder"].glob(".tmp-*"))  # nothing written, nothing left lying around
    assert done["output"].count("heartbeat not written") == 1, done["output"]  # said once in the worker's log, not at every beat
    assert time.monotonic() - began < 30  # the work is not held up by the sign of life it could not give
    merged = ch.merge_prefix(real_worker.plan, [done["chunks"][f"work00000001/chunk-{n:04d}.json"] for n in range(3)], duration_ms=60_000, tolerance_ms=500,
                             repetition_threshold=rn.REPETITION_THRESHOLD)
    assert merged_words(merged) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)] and merged["complete"]


def test_the_real_worker_keeps_the_pass_with_more_accepted_words_and_records_which_and_why(real_worker, repo):
    """The proof's settings are the primary pass. The second pass runs only when the first fails the repetition check,
    never replaces a first pass that kept more accepted words, and leaves its identity in the chunk it was used on."""
    def first_chunk(name, **control):
        done = real_worker.run(name, control=control, jobs=lambda folder: real_worker.jobs(real_worker.media, "work00000001", real_worker.plan, folder)[:1])
        assert done["code"] == 0 and done["result"]["ended"] == "completed", done["output"]
        return done["chunks"]["work00000001/chunk-0000.json"], [call for call in done["calls"] if call["call"] == "transcribe"]

    ordinary = [f"w{j}" for j in range(14)]  # the words of the first 27 s

    def texts(document) -> list[str]:
        return [word["text"] for segment in document["segments"] for word in segment["words"]]

    # 1. The first pass loops; the second gives the words: it is kept, with the reason and the identity of what was used.
    fixed, calls = first_chunk("fixes", loop_offsets=[0], second_pass="fixes")
    assert [call["pass"] for call in calls] == ["primary", "second"] and calls[0]["options"] == rn.INFERENCE_SETTINGS
    assert calls[1]["options"] == {**rn.INFERENCE_SETTINGS, **rn.SECOND_PASS_SETTINGS}  # no conditioning on previous text, the temperature ladder; everything else the proof's
    assert texts(fixed) == ordinary and fixed["decoding"]["pass"] == "second" and fixed["decoding"]["second_pass_sha256"] == rn.SECOND_PASS_SHA256
    assert fixed["decoding"]["selection"] == {"rule": "most-accepted-words-1", "kept": "second", "primary_accepted_words": 0, "second_accepted_words": 14,
                                              "why": "the second pass keeps 14 accepted words, the first pass 0"}
    assert fixed["decoding"]["primary"]["failed_words"] == 40 and fixed["decoding"]["second"]["failed_words"] == 0 and fixed["decoding"]["second"]["settings"] == rn.SECOND_PASS_SETTINGS
    # 2. Half of the first pass is good text, the rest loops; the second pass loses the loop but keeps only two words. It does NOT replace the first.
    partial, calls = first_chunk("few", partial_loop_offsets=[0], second_pass="few")
    assert [call["pass"] for call in calls] == ["primary", "second"] and partial["decoding"]["pass"] == "primary" and texts(partial)[:7] == ordinary[:7] and "okay," in texts(partial)
    assert partial["decoding"]["selection"]["kept"] == "primary" and partial["decoding"]["selection"]["primary_accepted_words"] == 7 and partial["decoding"]["selection"]["second_accepted_words"] == 2
    assert "does not replace the first" in partial["decoding"]["selection"]["why"] and partial["decoding"]["second_pass_sha256"] == rn.SECOND_PASS_SHA256  # used on this chunk, though not kept
    assert partial["decoding"]["second"]["failed_words"] == 0 and partial["decoding"]["primary"]["failed_words"] == 40  # by failed text alone the second pass would have won
    # 3. The same first pass, and a second pass that gives everything: more accepted words, so it is kept.
    better, _ = first_chunk("better", partial_loop_offsets=[0], second_pass="fixes")
    assert better["decoding"]["pass"] == "second" and texts(better) == ordinary and better["decoding"]["selection"]["why"] == "the second pass keeps 14 accepted words, the first pass 7"
    # 4. Both passes loop: the first pass stands (its text is withheld later, at the merge). 5. The second pass fails: the first stands and the failure is recorded.
    both, _ = first_chunk("loops", loop_offsets=[0], second_pass="loops")
    assert both["decoding"]["pass"] == "primary" and both["decoding"]["selection"]["kept"] == "primary" and "first pass stands" in both["decoding"]["selection"]["why"]
    failed, _ = first_chunk("raises", loop_offsets=[0], second_pass="raises")
    assert failed["decoding"]["pass"] == "primary" and "LABELLED STUB" in failed["decoding"]["second"]["error"] and failed["decoding"]["selection"]["kept"] == "primary"
    assert failed["decoding"]["second_pass_sha256"] == rn.SECOND_PASS_SHA256
    # 6. An ordinary chunk is decoded once and names no second-pass identity.
    plain, calls = first_chunk("plain-one")
    assert [call["pass"] for call in calls] == ["primary"] and plain["decoding"]["second_pass_sha256"] is None and plain["decoding"]["selection"] is None

    # The identity is the digest of the second-pass settings and the selection rule, computed alike by supervisor and worker: editing either changes it.
    import importlib.util

    spec = importlib.util.spec_from_file_location("speech_worker_identity", repo / "brain" / "src" / "lecture_brain" / "speech" / "worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    assert worker.second_pass_digest(rn.SECOND_PASS_SETTINGS) == rn.SECOND_PASS_SHA256 == rn.second_pass_identity(rn.SECOND_PASS_SETTINGS) and worker.SELECTION_RULE == rn.SECOND_PASS_SELECTION
    assert rn.second_pass_identity({**rn.SECOND_PASS_SETTINGS, "temperature": [0.0, 0.2]}) != rn.SECOND_PASS_SHA256
    assert worker.choose_pass({"words": 10, "failed_words": 4, "failed_seconds": 9.0}, {"words": 6, "failed_words": 0, "failed_seconds": 0.0})[0] == "second"  # equal accepted words, less failed text
    assert worker.choose_pass({"words": 10, "failed_words": 4, "failed_seconds": 9.0}, {"words": 10, "failed_words": 4, "failed_seconds": 9.0})[0] == "primary"
    assert worker.choose_pass({"words": 10, "failed_words": 3, "failed_seconds": 9.0}, {"words": 6, "failed_words": 0, "failed_seconds": 0.0})[0] == "primary"


def test_the_supervisor_runs_the_real_worker_script_end_to_end_with_labelled_stubs(settings, journal, tmp_path, monkeypatch):
    """Supervisor and REAL worker script together (the three speech modules are labelled stubs): a resource failure the
    worker reports pauses the queue; continued, a chunk whose first pass loops is decoded once more; what is published
    is every fabricated word once, labelled a double from the chunk file to the reader."""
    monkeypatch.setattr(rn, "SAMPLE_RATE_HZ", STUB_RATE)  # the made-up audio is a short list per chunk, not 16,000 samples a second
    control_path, record = tmp_path / "stub-control.json", tmp_path / "stub-record.jsonl"
    monkeypatch.setenv("LL_STUB_SPEECH_CONTROL", str(control_path))

    def stub(**values) -> None:
        control_path.write_text(json.dumps({"record": str(record), **values}), encoding="utf-8")

    def runner() -> rn.SpeechRunner:
        return rn.SpeechRunner(settings, journal, binding=fake_binding(tmp_path), worker_script=STUB_LAUNCHER, timings=rn.Timings(**FAST))

    stub(error_offsets=[25])  # the runtime "runs out of memory" in the first chunk that starts at 25 s
    first = runner().run(chunk_seconds=25)
    assert (first["state"], first["reason"], first["chunks_completed"]) == ("paused", "worker_failed", 1), first
    assert "MemoryError" in first["detail"] and (first["pause"]["recording"], first["pause"]["chunk"]) == (L1, 1) and queue_items(settings)[L1]["failures"] == {}
    job = json.loads((speech_dir(settings) / "run" / "job.json").read_text(encoding="utf-8"))
    assert job["second_pass_sha256"] == rn.SECOND_PASS_SHA256 and job["hard_stop_epoch"] > job["not_after_epoch"] and job["sample_rate_hz"] == STUB_RATE
    assert json.loads((speech_dir(settings) / "run" / "result.json").read_text(encoding="utf-8"))["labelled_double"] is True
    assert runner().run(chunk_seconds=25)["state"] == "paused"

    stub(loop_offsets=[25], second_pass="fixes")  # the cause is gone; the chunks that start at 25 s loop on their first pass
    second = runner().run(chunk_seconds=25, retry_failed=True)
    assert (second["state"], second["chunks_completed"], second["pause"]) == ("completed", 6, None), second
    assert {item["state"] for item in queue_items(settings).values()} == {"complete"}
    current = Derived(settings, journal).current("be505", "src-lecture-01-recording")
    assert words_of(current) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)] and current["covers_whole_recording"] is True and current["unresolved_intervals"] == []
    provenance = current["provenance"]
    assert provenance["labelled_double"] is True and provenance["note"].startswith("LABELLED DOUBLE") and current["producer"]["tool"] == "labelled-stub-speech-runtime"
    assert [(c_["decoding_pass"], c_["second_pass_sha256"], c_["second_pass_identity_from"]) for c_ in provenance["chunks"]] == [
        ("primary", None, "second_pass_not_used"), ("second", rn.SECOND_PASS_SHA256, "stated_by_worker"), ("primary", None, "second_pass_not_used")]
    assert provenance["chunks"][1]["selection"]["kept"] == "second" and provenance["decoding"]["chunks_decoded_twice"] == 1 and provenance["decoding"]["chunks_with_other_second_pass"] == []
    assert provenance["runtime"]["threads"] == 4 and provenance["runtime"]["workers"] == 1 and provenance["runtime"]["device"] == "cpu" and provenance["runtime"]["compute_type"] == "int8"
    calls = [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()]
    assert all(call["kwargs"] == {"device": "cpu", "compute_type": "int8", "cpu_threads": 4, "num_workers": 1, "local_files_only": True} for call in calls if call["call"] == "model")
    assert sum(1 for call in calls if call["call"] == "transcribe" and call["pass"] == "second") == 2  # the second chunk of both BE 505 recordings, nothing else

    # The stop file reaches the real worker inside a chunk; the finished chunks stay, the interrupted one leaves nothing.
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("chunk-*.json"):
        path.unlink()
    stub(seconds_per_segment=0.4)
    record.unlink()
    stop = speech_dir(settings) / "STOP"

    def request_stop() -> None:
        while not record.exists() or sum(1 for line in record.read_text(encoding="utf-8").splitlines() if '"transcribe"' in line) < 2:
            time.sleep(0.02)
        stop.write_text("stop", encoding="utf-8")

    watcher = threading.Thread(target=request_stop, daemon=True)
    watcher.start()
    stopped = runner().run(chunk_seconds=25)
    watcher.join(timeout=20)
    assert (stopped["state"], stopped["reason"], stopped["chunks_completed"]) == ("stopped", "stop_file", 1), stopped
    work = speech_dir(settings) / "work" / queue_items(settings)[L1]["work_id"]
    assert sorted(p.name for p in work.iterdir()) == ["chunk-0000.json"] and ledger_doc(settings)["open"] is None


def test_a_recording_whose_every_chunk_is_withheld_is_processed_but_neither_covered_nor_complete(settings, journal, tmp_path, control):
    """Every chunk of the recording loops and the second pass does not help. The run itself is fine and every chunk is
    published — but the reader and the status must not show sixty covered seconds without a word in them."""
    control(loop_chunks=[0, 1, 2])
    result = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be505"])
    assert result["state"] == "completed" and result["chunks_completed"] == 5
    assert queue_items(settings)[L1]["state"] == "complete_with_unresolved" and queue_items(settings)[L1]["unresolved_seconds"] == 60.0
    current = Derived(settings, journal).current("be505", "src-lecture-01-recording")
    assert current["segments"] == [] and current["window"] == {"start_ms": 0, "end_ms": 60_000}
    # No chunk holds any accepted text: nothing of the recording is known, from its first millisecond to its last.
    assert current["unresolved_intervals"] == [{"start_ms": 0, "end_ms": 60_000, "reason": "repetition_check_failed"}] and current["unresolved_seconds"] == 60.0
    assert current["covered_intervals"] == []
    assert current["coverage_fraction"] == 0.0 and current["processed_fraction"] == 1.0 and current["covers_whole_recording"] is False
    status = make_runner(settings, journal, tmp_path).status()
    row = next(r for r in status["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_processed"], row["seconds_covered"], row["unresolved_seconds"], row["covers_whole_recording"]) == ("complete_with_unresolved", 60.0, 0.0, 60.0, False)
    assert row["covered_intervals"] == current["covered_intervals"] and row["unresolved_intervals"] == current["unresolved_intervals"]
    assert status["courses"]["be505"]["totals"]["complete"] == 0 and status["courses"]["be505"]["totals"]["complete_with_unresolved"] == 2
    derived_row = next(r for r in Derived(settings, journal).status("be505")["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert derived_row["covers_whole_recording"] is False and derived_row["unresolved_seconds"] == 60.0 and Derived(settings, journal).status("be505")["totals"]["whole_recording_covered"] == 0
    assert rn.MERGE_POLICY in sys.modules["lecture_brain.derived"].SERVED_MERGE_POLICIES  # what the runner publishes is what the reader serves


def test_silent_chunks_and_words_outside_the_bounds_come_through_the_runner_and_the_importer(settings, journal, tmp_path, control):
    control(silent_chunks=[1])  # the fake worker finds no word in the second chunk of each recording
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be505"])["state"] == "completed"
    current = Derived(settings, journal).current("be505", "src-lecture-01-recording")
    # Silence is a finished chunk without words: nothing fails, nothing is unresolved, and the time it supplies simply has no text. What its
    # neighbours heard in the two overlaps (w13 before it, w25 after it) is published: the silent chunk has nothing there, so they supply the overlaps.
    assert [w[0] for w in words_of(current)] == [f"w{j}" for j in (*range(14), *range(25, 30))] and current["covers_whole_recording"] is True and current["unresolved_intervals"] == []
    merge = current["provenance"]["merge"]
    assert (merge["silent_chunks"], merge["overlap_boundaries_one_sided"], merge["overlap_boundaries_at_midpoint"], merge["dropped_overlap_words"]) == (1, 2, 0, 0)
    assert queue_items(settings)[L1]["state"] == "complete"
    control(out_of_bounds=True)  # one word before each chunk and one far past its end
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be562"])["state"] == "completed"
    short = Derived(settings, journal).current("be562", "src-lecture-01-audio")
    assert words_of(short) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(3)] and short["provenance"]["merge"]["dropped_out_of_bounds_words"] == 2
    assert all(0 <= w[1] <= w[2] <= 6_000 for w in words_of(short)) and short["covers_whole_recording"] is True


def test_outside_the_fixture_profile_a_grant_has_one_ledger_in_the_state_directory_its_binding_names(workspace, settings, journal, tmp_path, control):
    """The ledger is a file in the state directory. A grant that could be used from any state directory would get a
    fresh allowance, and a second worker, in each of them."""
    from lecture_brain.config import load_settings

    planner = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    bound, other = tmp_path / "state-a", tmp_path / "state-b"
    limits = {"ceiling_seconds": 3.0, "safety_margin_seconds": 1.2}

    def runner(where: Path, **over) -> rn.SpeechRunner:
        local = load_settings("local", env={}, planner_config=planner, state_dir=where)
        return rn.SpeechRunner(local, None, binding={**fake_binding(tmp_path, **limits), "state_dir": str(bound), **over}, worker_script=FAKE_WORKER, timings=rn.Timings(**FAST))

    control(delay_seconds=0.4)
    first = runner(bound).run(chunk_seconds=25)
    assert first["state"] == "ceiling_reached" and first["chunks_completed"] > 0, first
    used = json.loads((bound / "speech" / "allowance.json").read_text(encoding="utf-8"))["used_seconds"]
    starts = len(fake_log(tmp_path))

    # The same grant, another state directory: refused. No second ledger, no queue, no worker.
    refused = runner(other).run(chunk_seconds=25)
    assert (refused["state"], refused["reason"], refused["wall_seconds"]) == ("refused", "state_dir_not_bound", 0.0) and str(bound) in refused["detail"], refused
    assert not (other / "speech").exists() and len(fake_log(tmp_path)) == starts
    status = runner(other).status()
    assert status["binding"]["status"] == "state_dir_not_bound" and status["allowance"]["ledger"] == "not_created" and status["queue"]["exists"] is False
    # A binding that names no state directory runs nothing outside the fixture profile.
    unnamed = runner(bound, state_dir=None).run(chunk_seconds=25)
    assert (unnamed["state"], unnamed["reason"]) == ("refused", "state_dir_not_bound") and "does not name state_dir" in unnamed["detail"]
    assert runner(bound, state_dir="  ").run(chunk_seconds=25)["reason"] == "binding_invalid"
    # Where it is bound, the allowance is exactly where it was: nothing was given back and nothing was started.
    again = runner(bound).run(chunk_seconds=25)
    assert (again["state"], again["chunks_completed"]) == ("ceiling_reached", 0) and again["allowance"]["used_before"] == used and len(fake_log(tmp_path)) == starts
    assert runner(bound).status()["binding"]["status"] == "ok" and runner(bound).status()["binding"]["state_dir"] == str(bound)
    # A path that is not absolute names another directory in every copy of the working tree: outside the fixture profile it binds nothing
    # (see test_outside_the_fixture_profile_the_bound_state_directory_is_an_absolute_path), also when it happens to point at the right place.
    import dataclasses

    moved = dataclasses.replace(load_settings("local", env={}, planner_config=planner, state_dir=bound), repo=tmp_path)  # as if the repository were tmp_path
    for named in ("state-a", "state-b"):
        relative = rn.SpeechRunner(moved, None, binding={**fake_binding(tmp_path, **limits), "state_dir": named}, worker_script=FAKE_WORKER, timings=rn.Timings(**FAST)).status()
        assert relative["binding"]["status"] == "state_dir_not_bound" and "absolute" in relative["binding"]["detail"]
    # The fixture profile needs no state directory in its test binding; one that is named is held to all the same.
    elsewhere = make_runner(settings, journal, tmp_path, state_dir=str(other)).run(chunk_seconds=25)
    assert (elsewhere["state"], elsewhere["reason"]) == ("refused", "state_dir_not_bound") and not speech_dir(settings).exists()
    control()
    assert make_runner(settings, journal, tmp_path, state_dir=str(settings.state_dir)).run(chunk_seconds=25, max_chunks=1)["state"] == "max_chunks_reached"


def test_other_publication_code_gives_other_generations_and_never_a_conflict_with_stored_ones(settings, journal, tmp_path, control, monkeypatch):
    """A generation id used to be derived from the chunk digests and the merge policy only. After any edit that changed
    the published bytes, the same id came out with other bytes: every publication was refused as a conflict and every
    recording set aside. The id is now a digest of the published content itself."""
    def run(**arguments) -> dict:
        return make_runner(settings, journal, tmp_path).run(chunk_seconds=25, **arguments)

    def published() -> dict[str, str]:
        return {key: item["published_generation"] for key, item in queue_items(settings).items()}

    def store_trees() -> dict[str, str]:
        return {f"{cid}/{name}": digest for cid in settings.courses if derived.store_dir(cid).exists() for name, digest in tree(derived.store_dir(cid)).items()}

    assert run()["state"] == "completed"
    derived = Derived(settings, journal)
    before, stored_before = published(), store_trees()

    # The publication code is edited (here: its version) and the queue is frozen anew over the same chunk files.
    monkeypatch.setattr(rn, "RUNNER_VERSION", "speech-runner-edited")
    (speech_dir(settings) / "queue.json").unlink()
    again = run()
    assert (again["state"], again["chunks_completed"], again["wall_seconds"]) == ("completed", 0, 0.0), again
    assert [(p["status"], p["reason"]) for p in again["published"]] == [("imported", None)] * 4 and again["remaining"]["failed"] == 0
    after = published()
    assert all(after[key] != before[key] and after[key].rsplit("-", 1)[0] == before[key].rsplit("-", 1)[0] for key in before)  # the same recording and chunk count, another content
    assert {item["state"] for item in queue_items(settings).values()} == {"complete"}
    assert {name: digest for name, digest in store_trees().items() if name in stored_before} == stored_before  # what was stored is still there, byte for byte
    current = derived.current("be505", "src-lecture-01-recording")
    assert current["generation"] == after[L1] and current["provenance"]["runner"] == "speech-runner-edited"  # the same coverage: the newest is the latest publication
    listed = {g["generation"]: g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == "src-lecture-01-recording" for g in r["generations"]}
    assert listed[after[L1]] == "current" and listed[before[L1]] == "superseded" and "invalid" not in listed.values()
    assert run()["state"] == "no_change"
    # Without a new queue too: what is published whole by other code than this is published again, once.
    monkeypatch.setattr(rn, "RUNNER_VERSION", "speech-runner-edited-again")
    third = run()
    assert (third["state"], third["chunks_completed"]) == ("completed", 0) and [p["status"] for p in third["published"]] == ["imported"] * 4 and published() != after
    assert derived.current("be505", "src-lecture-01-recording")["provenance"]["runner"] == "speech-runner-edited-again" and run()["state"] == "no_change"

    # A queue written by the runner before it kept these fields (as the one of the first real runs) is read, and its recordings are published again by this code.
    queue_path = speech_dir(settings) / "queue.json"
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    for item in queue["items"]:
        for key in ("published_identity", "published_inputs", "published_window_end_ms", "unresolved_intervals"):
            del item[key]
        item["published_policy"] = "withhold-repetition-1"
        if item["key"] == "be562/src-lecture-01-audio":
            item["unresolved_seconds"] = 4.0  # that runner stated the total it withheld, called the recording "complete" and kept no intervals
    queue_path.write_text(json.dumps(queue), encoding="utf-8")
    old_status = make_runner(settings, journal, tmp_path).status()
    row = next(r for r in old_status["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_covered"], row["covered_intervals"], row["unresolved_intervals"]) == ("complete", 60.0, [{"start_ms": 0, "end_ms": 60_000}], [])
    row = old_status["courses"]["be562"]["recordings"][0]  # read as what it is: not plain complete, four seconds not covered, the intervals unknown until it is published again
    assert (row["state"], row["seconds_covered"], row["unresolved_seconds"], row["covered_intervals"], row["unresolved_intervals"], row["covers_whole_recording"]) == (
        "complete_with_unresolved", 2.0, 4.0, None, None, False)
    assert old_status["totals"]["states"]["complete"] == 3 and old_status["totals"]["states"]["complete_with_unresolved"] == 1
    older = run()
    assert older["state"] == "completed" and [p["status"] for p in older["published"]] == ["reused"] * 4  # the same content as is stored: the same generation, nothing new
    assert all("published_identity" in item and item["unresolved_intervals"] == [] for item in queue_items(settings).values())

    # A publication the importer refuses is a failed run with the recordings set aside and the reason shown; --retry-failed clears it.
    real_import = Derived.import_prepared
    monkeypatch.setattr(Derived, "import_prepared", lambda self, **arguments: {"status": "rejected", "reused": False, "reason": "store_write_failed", "detail": "SYNTHETIC refusal made by this test"})
    monkeypatch.setattr(rn, "RUNNER_VERSION", "speech-runner-edited-once-more")
    refused = run()
    assert (refused["state"], refused["reason"], refused["chunks_completed"]) == ("failed", "publish_rejected", 0) and refused["remaining"]["failed"] == 4, refused
    item = queue_items(settings)[L1]
    assert (item["state"], item["reason"]) == ("failed", "publish_rejected") and "store_write_failed" in item["last_error"] and "SYNTHETIC refusal" in item["last_error"]
    assert derived.current("be505", "src-lecture-01-recording")["provenance"]["runner"] == "speech-runner-edited-again"  # what was published before is still served
    still = run(retry_failed=True)  # the cause persists: tried again, refused again, visibly
    assert (still["state"], still["reason"]) == ("failed", "publish_rejected") and queue_items(settings)[L1]["reason"] == "publish_rejected"
    monkeypatch.setattr(Derived, "import_prepared", real_import)
    cleared = run(retry_failed=True)
    assert cleared["state"] == "completed" and [p["status"] for p in cleared["published"]] == ["imported"] * 4
    item = queue_items(settings)[L1]
    assert (item["state"], item["reason"], item["last_error"], item["failures"]) == ("complete", None, None, {})
    assert derived.current("be505", "src-lecture-01-recording")["provenance"]["runner"] == "speech-runner-edited-once-more"


def test_a_result_the_supervisor_does_not_accept_is_a_failed_attempt_with_its_reason_not_a_silent_redo(settings, journal, tmp_path, control):
    """The worker wrote a result two seconds short of the range without saying the recording ended. The supervisor does
    not take it — and must say so: counted, shown, and after the second time the recording is set aside. It used to be
    done again on every run, with no error anywhere and the allowance charged each time."""
    control(short_chunks=[1])
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["chunks_completed"]) == ("completed", 4), first  # the first chunk of the two long recordings, and the two short recordings
    items = queue_items(settings)
    second_key = next(key for key in items if key.startswith("be505/unreg-"))
    for key in (L1, second_key):
        assert (items[key]["state"], items[key]["chunks_done"], items[key]["failures"]) == ("partial", 1, {"1": 1})
        assert "the worker's result was not accepted" in items[key]["last_error"] and "without having reached the end of the recording" in items[key]["last_error"]
    assert "25000 ms of the 27000 ms" in items[L1]["last_error"] and first["remaining"] == {"recordings": 2, "chunks": 3, "source_conflict": 0, "failed": 0}
    work_id = items[L1]["work_id"]
    row = next(r for r in make_runner(settings, journal, tmp_path).status()["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert row["state"] == "partial" and "not accepted" in row["last_error"]

    again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)  # the same again: set aside
    assert (again["state"], again["chunks_completed"]) == ("completed", 0) and again["remaining"] == {"recordings": 0, "chunks": 0, "source_conflict": 0, "failed": 2}
    assert (queue_items(settings)[L1]["state"], queue_items(settings)[L1]["reason"], queue_items(settings)[L1]["failures"]) == ("failed", "chunk_failed", {"1": 2})
    used, starts = ledger_doc(settings)["used_seconds"], [line for line in fake_log(tmp_path) if line.startswith("start")]
    assert starts.count(f"start {work_id} 1") == 2 and starts.count(f"start {work_id} 2") == 1  # the chunk after it was written once and is not done again
    for _ in range(2):  # a wrapper that repeats the command until nothing changes ends here: no worker, no charge
        assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25)["state"] == "no_change"
    assert ledger_doc(settings)["used_seconds"] == used and [line for line in fake_log(tmp_path) if line.startswith("start")] == starts

    control()
    fixed = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert (fixed["state"], fixed["chunks_completed"]) == ("completed", 2) and {item["state"] for item in queue_items(settings).values()} == {"complete"}
    assert [line for line in fake_log(tmp_path) if line.startswith("start")][len(starts):] == [f"start {work_id} 1", f"start {queue_items(settings)[second_key]['work_id']} 1"]
    assert words_of(Derived(settings, journal).current("be505", "src-lecture-01-recording")) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)]


def test_however_a_run_ends_its_reservation_is_settled_and_it_leaves_a_receipt(settings, journal, tmp_path, control, monkeypatch):
    """An interpreter that cannot be executed, an error inside the supervision loop, an interrupt from the keyboard:
    each used to leave the reservation open (a lease wait and a full lease charge at the next run) and no receipt."""
    def settled() -> dict:
        document = ledger_doc(settings)
        assert document["open"] is None
        return document

    # 1. The configured interpreter exists but is not a program.
    not_a_program = tmp_path / "not-an-interpreter.exe"
    not_a_program.write_text("LABELLED PLACEHOLDER: not a program\n", encoding="utf-8")
    launch = make_runner(settings, journal, tmp_path, interpreter=str(not_a_program)).run(chunk_seconds=25)
    assert (launch["state"], launch["outcome"], launch["reason"], launch["chunks_completed"]) == ("failed", "ran", "worker_launch_failed", 0), launch
    assert "could not be started" in launch["detail"] and launch["receipt_id"] and launch["pause"] is None
    assert len(settled()["settled"]) == 1 and settled()["settled"][0]["how"] == "completed" and launch["allowance"]["used_after"] == settled()["used_seconds"] < 1.0
    assert (receipts(journal)[-1]["state"], receipts(journal)[-1]["reason"]) == ("failed", "worker_launch_failed")
    assert all(item["failures"] == {} and item["state"] == "queued" for item in queue_items(settings).values())  # no chunk and no recording is to blame

    # 2. Something goes wrong inside the supervision loop while the worker is running.
    real_publish = rn.SpeechRunner._publish

    def failing_publish(self, queue, binding, item, report):
        if item["chunks_done"]:
            raise RuntimeError("SYNTHETIC failure inside the supervision loop")
        return real_publish(self, queue, binding, item, report)

    monkeypatch.setattr(rn.SpeechRunner, "_publish", failing_publish)
    control(delay_seconds=0.2)
    broken = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (broken["state"], broken["outcome"], broken["reason"]) == ("failed", "ran", "internal_error") and "SYNTHETIC failure" in broken["detail"], broken
    assert broken["allowance"]["recovered_seconds"] == 0.0 and broken["wall_seconds"] > 0 and broken["receipt_id"]
    assert len(settled()["settled"]) == 2 and broken["allowance"]["used_after"] == settled()["used_seconds"]
    assert (receipts(journal)[-1]["state"], receipts(journal)[-1]["reason"], receipts(journal)[-1]["allowance"]["used_after"]) == ("failed", "internal_error", settled()["used_seconds"])
    chunk_files = sorted((speech_dir(settings) / "work").rglob("chunk-*.json"))
    time.sleep(0.6)
    assert sorted((speech_dir(settings) / "work").rglob("chunk-*.json")) == chunk_files  # the child was stopped with the run: nothing is written after it
    monkeypatch.setattr(rn.SpeechRunner, "_publish", real_publish)

    # 3. An interrupt from the keyboard while a chunk is running: settled, receipted, and raised again.
    real_read = rn.read_json

    def interrupting_read(path):
        if Path(path).name == "heartbeat.json" and any(line.startswith("start") for line in fake_log(tmp_path)[log_before:]):
            raise KeyboardInterrupt()
        return real_read(path)

    control(hang_at=1)
    log_before = len(fake_log(tmp_path))
    monkeypatch.setattr(rn, "read_json", interrupting_read)
    with pytest.raises(KeyboardInterrupt):
        make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    monkeypatch.setattr(rn, "read_json", real_read)
    assert len(settled()["settled"]) == 3 and settled()["settled"][-1]["how"] == "completed"
    last = receipts(journal)[-1]
    assert (last["state"], last["outcome"], last["reason"]) == ("stopped", "ran", "interrupted") and last["allowance"]["used_after"] == settled()["used_seconds"]

    # The next run starts at once (no lease to wait out, nothing to recover) and finishes the queue.
    control()
    began = time.monotonic()
    done = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert done["state"] == "completed" and done["allowance"]["recovered_seconds"] == 0.0 and time.monotonic() - began < FAST["lease_seconds"] + 10
    assert {item["state"] for item in queue_items(settings).values()} == {"complete"} and [s["how"] for s in settled()["settled"]] == ["completed"] * 4


def test_the_status_reports_the_lecture_ids_the_inventory_links_now_and_keeps_the_frozen_copy(settings, journal, tmp_path, control):
    """Sessions get linked to lectures after a queue was frozen too. A status that repeats the frozen copy would keep
    reporting no lecture for those recordings for the life of the queue."""
    assert make_runner(settings, journal, tmp_path).run(chunk_seconds=25, max_chunks=1)["state"] == "max_chunks_reached"
    listed = recordings(settings)
    assert any(entry["lecture_ids"] for entry in listed.values())  # the fixture links at least one session to a lecture
    queue_path = speech_dir(settings) / "queue.json"
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    identity = rn.queue_identity(queue)
    for item in queue["items"]:
        item["lecture_ids"] = []  # as a queue frozen before the sessions were linked
    queue_path.write_text(json.dumps(queue), encoding="utf-8")
    frozen_bytes = queue_path.read_bytes()

    status = make_runner(settings, journal, tmp_path).status()

    rows = {row["key"]: row for course in status["courses"].values() for row in course["recordings"]}
    assert set(rows) == set(listed)
    for key, row in rows.items():
        assert row["lecture_ids"] == listed[key]["lecture_ids"] and row["lecture_ids_from"] == "current_inventory" and row["lecture_ids_frozen"] == []
    assert queue_path.read_bytes() == frozen_bytes and status["queue"]["identity_sha256"] == identity  # a readback: the frozen queue is not rewritten, and what was frozen is the same queue
    # A recording that is not listed any more has only its frozen copy, and the row says so.
    gone = next(key for key in listed if key.startswith("ds551/"))
    (listed[gone]["root"] / listed[gone]["path"]).unlink()
    row = next(row for row in make_runner(settings, journal, tmp_path).status()["courses"]["ds551"]["recordings"])
    assert (row["lecture_ids"], row["lecture_ids_from"], row["listed_now"]) == ([], "frozen_queue", False)


# ---- closing round: what an independent review of the fixed runner still found ----------------------------------------
def test_text_withheld_from_a_loop_whose_copies_sit_at_one_instant_leaves_unresolved_time_in_reader_and_status(settings, journal, tmp_path, control):
    """Through worker, supervisor, importer and reader: a failing segment without a span of its own (every copy at one
    instant) used to be withheld without any unresolved time — the recording read ``complete``, fully covered."""
    control(collapsed_loop_chunks=[1])  # in the second chunk of each recording the words w18..w22 are replaced by twenty copies of one word at 36.3 s
    result = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, courses=["be505"])
    assert result["state"] == "completed" and result["chunks_completed"] == 5, result
    current = Derived(settings, journal).current("be505", "src-lecture-01-recording")
    assert [w[0] for w in words_of(current)] == [f"w{j}" for j in (*range(18), *range(23, 30))] and current["provenance"]["merge"]["withheld_repetition_words"] == 20
    # Unresolved from the end of w17 (34.7 s) to the start of w23 (46.3 s): where the five missing words were said.
    assert current["unresolved_intervals"] == [{"start_ms": 34_700, "end_ms": 46_300, "reason": "repetition_check_failed"}] and current["unresolved_seconds"] == 11.6
    assert current["covers_whole_recording"] is False and current["coverage_fraction"] == pytest.approx(48.4 / 60)
    row = next(r for r in make_runner(settings, journal, tmp_path).status()["courses"]["be505"]["recordings"] if r["source_id"] == "src-lecture-01-recording")
    assert (row["state"], row["seconds_covered"], row["unresolved_seconds"], row["covers_whole_recording"]) == ("complete_with_unresolved", 48.4, 11.6, False)
    assert row["unresolved_intervals"] == current["unresolved_intervals"] and queue_items(settings)[L1]["state"] == "complete_with_unresolved"


@pytest.mark.parametrize("shape,phrase", [("words_number", "segment 1: words is not a list"), ("decoding_text", "the decoding record is not an object")])
def test_a_result_with_an_inside_no_merge_can_read_is_a_failed_attempt_and_the_queue_goes_on(shape, phrase, settings, journal, tmp_path, control):
    """Well addressed, complete, made from the right bytes under the right settings — and unreadable inside. The
    supervisor accepted such a result, the merge failed on it, and every later run ended ``internal_error`` before any
    job was started: the whole queue stood still. It is a refused result like any other: counted, shown, bounded."""
    control(odd_chunks=[1], odd_shape=shape)
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["reason"], first["chunks_completed"]) == ("completed", None, 4), first  # the first chunk of the two long recordings, and the two short ones
    items = queue_items(settings)
    second_key = next(key for key in items if key.startswith("be505/unreg-"))
    for key in (L1, second_key):
        assert (items[key]["state"], items[key]["chunks_done"], items[key]["failures"]) == ("partial", 1, {"1": 1})
        assert "the worker's result was not accepted" in items[key]["last_error"] and phrase in items[key]["last_error"]
    assert {items[key]["state"] for key in items if key not in (L1, second_key)} == {"complete"} and ledger_doc(settings)["open"] is None

    again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)  # the same again: both are set aside, visibly
    assert (again["state"], again["reason"], again["chunks_completed"]) == ("completed", None, 0) and again["remaining"] == {"recordings": 0, "chunks": 0, "source_conflict": 0, "failed": 2}
    assert (queue_items(settings)[L1]["state"], queue_items(settings)[L1]["reason"], queue_items(settings)[L1]["failures"]) == ("failed", "chunk_failed", {"1": 2})
    used = ledger_doc(settings)["used_seconds"]
    for _ in range(2):  # and then nothing is started any more
        idle = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (idle["state"], idle["wall_seconds"]) == ("no_change", 0.0)
    assert ledger_doc(settings)["used_seconds"] == used and [r["reason"] for r in receipts(journal)] == [None] * 4  # never an internal error

    control()  # a healthy worker, and the owner says to try again
    fixed = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert (fixed["state"], fixed["chunks_completed"]) == ("completed", 2) and {item["state"] for item in queue_items(settings).values()} == {"complete"}
    assert words_of(Derived(settings, journal).current("be505", "src-lecture-01-recording")) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)]


def test_chunk_results_that_cannot_be_merged_set_their_recording_aside_and_the_other_recordings_go_on(settings, journal, tmp_path, control, monkeypatch):
    """The backstop behind the acceptance check: whatever makes the merge of ONE recording fail is that recording's
    problem — set aside with the reason, tried again by the next run — and never an error that ends the run."""
    listed = recordings(settings)
    broken = hashlib.sha256(f"{L1}/{hashlib.sha256((listed[L1]['root'] / listed[L1]['path']).read_bytes()).hexdigest()}".encode("utf-8")).hexdigest()[:12]  # the work id of L1
    real_merge = ch.merge_prefix

    def failing_merge(plan, results, **arguments):
        if results[0].get("work_id") == broken:
            raise TypeError("SYNTHETIC: a chunk result this merge cannot read")
        return real_merge(plan, results, **arguments)

    monkeypatch.setattr(ch, "merge_prefix", failing_merge)
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["reason"], first["chunks_completed"]) == ("failed", "publish_rejected", 7), first  # every chunk was transcribed; one recording could not be published
    items = queue_items(settings)
    assert items[L1]["work_id"] == broken and (items[L1]["state"], items[L1]["reason"], items[L1]["chunks_done"], items[L1]["published_chunks"]) == ("failed", "publish_rejected", 3, 0)
    assert "could not be merged" in items[L1]["last_error"] and "SYNTHETIC" in items[L1]["last_error"] and "TypeError" in items[L1]["last_error"]
    assert {item["state"] for key, item in items.items() if key != L1} == {"complete"} and ledger_doc(settings)["open"] is None
    assert Derived(settings, journal).current("be505", "src-lecture-01-recording") is None
    refused = [p for p in first["published"] if p["status"] == "failed"]
    assert refused and all((p["source_id"], p["reason"]) == ("src-lecture-01-recording", "merge_failed") for p in refused)
    used = ledger_doc(settings)["used_seconds"]
    again = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)  # the next run tries the publication once more: no worker, no charge, the same answer
    assert (again["state"], again["reason"], again["chunks_completed"], again["wall_seconds"]) == ("failed", "publish_rejected", 0, 0.0) and ledger_doc(settings)["used_seconds"] == used
    monkeypatch.setattr(ch, "merge_prefix", real_merge)
    mended = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (mended["state"], mended["chunks_completed"]) == ("completed", 0) and [(p["status"], p["chunks"]) for p in mended["published"]] == [("imported", 3)]
    item = queue_items(settings)[L1]
    assert (item["state"], item["reason"], item["last_error"]) == ("complete", None, None) and ledger_doc(settings)["used_seconds"] == used
    assert words_of(Derived(settings, journal).current("be505", "src-lecture-01-recording")) == [(f"w{j}", j * 2_000 + 300, j * 2_000 + 700) for j in range(30)]


def test_a_generation_id_stands_for_the_bytes_that_are_stored_whatever_code_assembled_them(settings, journal, tmp_path, control, monkeypatch):
    """The id's suffix was a digest of segments, provenance, producer and window. The stored bytes are also decided by
    how a generation is ASSEMBLED and by the consumer version it is written for: after an edit of either the same id
    came out with other bytes — refused as a conflict, every recording set aside, not cleared by ``--retry-failed`` —
    and after a new consumer version nothing was served and nothing could be published. The suffix is now a digest of
    the assembled generation itself."""
    import lecture_brain.derived as dv

    def run(**arguments) -> dict:
        return make_runner(settings, journal, tmp_path).run(chunk_seconds=25, **arguments)

    def published() -> dict[str, str]:
        return {key: item["published_generation"] for key, item in queue_items(settings).items()}

    def served() -> dict | None:
        return Derived(settings, journal).current("be505", "src-lecture-01-recording")

    assert run()["state"] == "completed"
    derived = Derived(settings, journal)
    before = published()

    # 1. The assembly is edited (here: one more file in every generation) and the queue is frozen anew over the same chunk files.
    real_assembly = rn.assemble_generation
    monkeypatch.setattr(rn, "assemble_generation", lambda **arguments: real_assembly(**arguments, extra_files={"note.txt": (b"SYNTHETIC: a file a later edit of the assembly adds\n", "text/plain")}))
    (speech_dir(settings) / "queue.json").unlink()
    again = run()
    assert (again["state"], again["reason"], again["chunks_completed"]) == ("completed", None, 0), again
    assert [(p["status"], p["reason"]) for p in again["published"]] == [("imported", None)] * 4 and again["remaining"]["failed"] == 0
    after = published()
    assert all(after[key] != before[key] and after[key].rsplit("-", 1)[0] == before[key].rsplit("-", 1)[0] for key in before)  # the same recording and chunk count, other bytes: another id
    assert (derived.store_dir("be505") / "src-lecture-01-recording" / after[L1] / "note.txt").is_file() and served()["generation"] == after[L1]
    assert run()["state"] == "no_change"
    monkeypatch.setattr(rn, "assemble_generation", real_assembly)

    # 2. A new consumer version. What is stored was written for the old one and is not served; the SAME queue publishes it again for this consumer.
    monkeypatch.setattr(dv, "CONSUMER_VERSION", "derived-consumer-2")
    assert served() is None
    bumped = run()
    assert (bumped["state"], bumped["chunks_completed"], bumped["wall_seconds"]) == ("completed", 0, 0.0) and [(p["status"], p["reason"]) for p in bumped["published"]] == [("imported", None)] * 4, bumped
    current = served()
    assert current is not None and current["consumer_version"] == "derived-consumer-2" and current["generation"] == published()[L1] and current["generation"] not in (before[L1], after[L1])
    assert {item["state"] for item in queue_items(settings).values()} == {"complete"} and run()["state"] == "no_change"

    # 3. A stored generation that was damaged afterwards does not stand in the way of publishing the same content: a stored generation is never
    #    replaced or repaired, so the content goes into the next name, once, and that one is served.
    damaged_id = published()[L1]
    (derived.store_dir("be505") / "src-lecture-01-recording" / damaged_id / "segments.json").write_bytes(b"{}")
    assert served() is None  # the only generation written for this consumer is damaged: nothing is served
    (speech_dir(settings) / "queue.json").unlink()
    repaired = run()
    assert (repaired["state"], repaired["reason"]) == ("completed", None), repaired
    by_source = {p["source_id"]: p["status"] for p in repaired["published"]}
    assert by_source["src-lecture-01-recording"] == "imported" and sorted(by_source.values()) == ["imported", "reused", "reused", "reused"]
    fresh = published()[L1]
    assert fresh != damaged_id and fresh.rsplit("-", 1)[0] == damaged_id.rsplit("-", 1)[0] and served()["generation"] == fresh
    listed = {g["generation"]: g["state"] for r in derived.status("be505")["recordings"] if r["source_id"] == "src-lecture-01-recording" for g in r["generations"]}
    assert listed[damaged_id] == "invalid" and listed[fresh] == "current"
    (speech_dir(settings) / "queue.json").unlink()
    settled = run()  # the same content once more: the same second name, nothing new
    assert settled["state"] == "completed" and [p["status"] for p in settled["published"]] == ["reused"] * 4 and published()[L1] == fresh


def test_outside_the_fixture_profile_the_bound_state_directory_is_an_absolute_path(workspace, tmp_path, control):
    """A state directory named relative to the repository is another directory in every copy of the working tree: the
    same private binding in a copied tree opened a second ledger, and a second allowance, under the same grant."""
    import dataclasses

    from lecture_brain.config import load_settings

    planner = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    limits = {"ceiling_seconds": 3.0, "safety_margin_seconds": 1.2}

    def runner(tree: Path, named: str) -> rn.SpeechRunner:
        local = dataclasses.replace(load_settings("local", env={}, planner_config=planner, state_dir=tree / ".local" / "state" / "real-local"), repo=tree)  # the repository the command runs from
        return rn.SpeechRunner(local, None, binding={**fake_binding(tmp_path, **limits), "state_dir": named}, worker_script=FAKE_WORKER, timings=rn.Timings(**FAST))

    control(delay_seconds=0.4)
    tree_a, tree_b = tmp_path / "tree-a", tmp_path / "tree-b"
    for tree_ in (tree_a, tree_b):  # the binding as it was spelled: relative to whichever tree the command runs from
        refused = runner(tree_, ".local/state/real-local").run(chunk_seconds=25)
        assert (refused["state"], refused["reason"], refused["wall_seconds"]) == ("refused", "state_dir_not_bound", 0.0) and "absolute" in refused["detail"], refused
        assert not (tree_ / ".local" / "state" / "real-local" / "speech").exists()
        assert runner(tree_, ".local/state/real-local").status()["binding"]["status"] == "state_dir_not_bound"
    assert fake_log(tmp_path) == []
    # Named absolutely, the grant has its ledger in tree A only: the copy is refused and nothing is started there.
    bound = str(tree_a / ".local" / "state" / "real-local")
    first = runner(tree_a, bound).run(chunk_seconds=25)
    assert first["state"] == "ceiling_reached" and first["chunks_completed"] > 0, first
    starts = len(fake_log(tmp_path))
    copy = runner(tree_b, bound).run(chunk_seconds=25)
    assert (copy["state"], copy["reason"]) == ("refused", "state_dir_not_bound") and len(fake_log(tmp_path)) == starts
    assert not (tree_b / ".local" / "state" / "real-local" / "speech").exists() and (tree_a / ".local" / "state" / "real-local" / "speech" / "allowance.json").is_file()
    assert runner(tree_a, bound).run(chunk_seconds=25)["state"] == "ceiling_reached" and runner(tree_a, bound).status()["binding"]["status"] == "ok"


def test_a_lease_that_cannot_be_refreshed_for_a_moment_does_not_end_the_run(settings, journal, tmp_path, control, monkeypatch):
    """Seen on this machine under load: for more than a second the lease file could not be replaced (another process
    had it open), the refresh raised, and the run ended ``failed/internal_error`` with the worker stopped inside a
    chunk — although the lease written before was still good. A refresh that fails is tried again at the next look;
    the run gives up only when no refresh went through for a whole lease."""
    real_write = rn.write_json
    refused = {"left": 0, "count": 0}

    def flaky_write(path, value):
        if Path(path).name == "lease.json" and refused["left"] > 0 and any(line.startswith("start") for line in fake_log(tmp_path)[log_before:]):
            refused["left"] -= 1
            refused["count"] += 1
            raise PermissionError(5, "SYNTHETIC: access is denied, as when another process has the file open")
        return real_write(path, value)

    monkeypatch.setattr(rn, "write_json", flaky_write)
    timings = rn.Timings(**{**FAST, "lease_seconds": 4.0})

    def run() -> dict:
        return rn.SpeechRunner(settings, journal, binding=fake_binding(tmp_path), worker_script=FAKE_WORKER, timings=timings).run(chunk_seconds=25)

    control(delay_seconds=0.25)
    log_before, refused["left"] = len(fake_log(tmp_path)), 4  # four refreshes in a row fail while the worker is inside a chunk
    done = run()
    assert (done["state"], done["reason"], done["chunks_completed"]) == ("completed", None, 7) and refused["count"] == 4, done
    assert ledger_doc(settings)["open"] is None and {item["state"] for item in queue_items(settings).values()} == {"complete"}

    # No refresh goes through for a whole lease: a worker that looks at its lease has stopped by itself by then (``worker_lease_lost``); here it
    # does not look, so it is the supervisor that gives up. Either way the child is stopped and the time that passed is settled.
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("chunk-*.json"):
        path.unlink()
    control(mute_at=0)
    timings = rn.Timings(**{**FAST, "lease_seconds": 0.6})
    log_before, refused["left"] = len(fake_log(tmp_path)), 10_000
    lost = run()
    assert (lost["state"], lost["outcome"], lost["reason"]) == ("failed", "ran", "internal_error") and "PermissionError" in lost["detail"], lost
    assert ledger_doc(settings)["open"] is None and lost["allowance"]["used_after"] == ledger_doc(settings)["used_seconds"] and receipts(journal)[-1]["reason"] == "internal_error"


def test_a_worker_that_keeps_dying_without_a_word_pauses_the_queue_at_the_second_recording(settings, journal, tmp_path, control):
    """A worker that dies or stalls without saying why is counted against the chunk it was in: it may be that
    recording's audio. When the same happens in the NEXT recording with no chunk finished in between, the cause is the
    machine: the queue pauses, and a wrapper that repeats the command does not set recording after recording aside."""
    control(die_at=0)  # every recording: the worker dies in its first chunk, without a result
    first = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (first["state"], first["reason"], first["pause"]) == ("failed", "worker_died", None) and queue_items(settings)[L1]["failures"] == {"0": 1}
    second = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (second["state"], second["reason"], second["pause"]) == ("failed", "worker_died", None)
    assert (queue_items(settings)[L1]["state"], queue_items(settings)[L1]["reason"]) == ("failed", "chunk_failed")  # twice in the same chunk: that recording is set aside
    third = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)  # and now the next recording, at once
    items = queue_items(settings)
    next_key = list(items)[1]
    assert (third["state"], third["reason"], third["chunks_completed"]) == ("paused", "worker_died", 0), third
    assert (third["pause"]["reason"], third["pause"]["worker_reason"], third["pause"]["recording"], third["pause"]["chunk"]) == ("resource_failure", "worker_died", next_key, 0)
    assert "--retry-failed" in third["detail"] and third["resume_command"].endswith("--retry-failed")
    assert items[next_key]["failures"] == {} and items[next_key]["state"] == "queued" and items[next_key]["resource_failures"] == {"0": 1}  # not counted against it
    assert [item["state"] for item in items.values()].count("failed") == 1
    used, starts = ledger_doc(settings)["used_seconds"], len(fake_log(tmp_path))
    for _ in range(3):  # run after run: paused, no worker, no charge, nothing more set aside
        idle = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (idle["state"], idle["reason"], idle["wall_seconds"]) == ("paused", "resource_failure", 0.0)
    assert ledger_doc(settings)["used_seconds"] == used and len(fake_log(tmp_path)) == starts
    assert [item["state"] for item in queue_items(settings).values()].count("failed") == 1 and len(ledger_doc(settings)["settled"]) == 3

    # The cause is gone and the owner says go on: everything is done, the recording that had been set aside included.
    control()
    done = make_runner(settings, journal, tmp_path).run(chunk_seconds=25, retry_failed=True)
    assert (done["state"], done["chunks_completed"], done["pause"]) == ("completed", 7, None) and {item["state"] for item in queue_items(settings).values()} == {"complete"}
    assert all("resource_failures" not in item for item in queue_items(settings).values())

    # A recording whose own audio kills the worker is that recording's problem: the others go on, and nothing pauses.
    (speech_dir(settings) / "queue.json").unlink()
    for path in (speech_dir(settings) / "work").rglob("chunk-*.json"):
        path.unlink()
    control(die_at=0, only_work=items[L1]["work_id"])
    for _ in range(2):
        died = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
        assert (died["state"], died["reason"], died["pause"]) == ("failed", "worker_died", None)
    assert queue_items(settings)[L1]["state"] == "failed" and queue_items(settings)[L1]["work_id"] == items[L1]["work_id"]
    rest = make_runner(settings, journal, tmp_path).run(chunk_seconds=25)
    assert (rest["state"], rest["chunks_completed"], rest["pause"]) == ("completed", 4, None)
    assert sorted(item["state"] for item in queue_items(settings).values()) == ["complete", "complete", "complete", "failed"]
