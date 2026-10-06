"""Alignment engine (experience repair v2, phase 4): validated text alignment and the window→logical-slide sequence model.

Everything here is invented text about an imaginary water-works course. No real course material, no real timestamps.
Mechanics and failure behaviour only: suggestion quality on real lectures is a separate, measured question.
"""
from __future__ import annotations

import itertools
import random

import pytest

from lecture_brain import alignment as al
from lecture_brain.preparation import align_lines_to_slides


# ---- synthetic material ------------------------------------------------------------------------------
def slide(slide_id, pages, title, body, role="instructional", **extra):
    return dict({"slide_id": slide_id, "pages": pages, "title": title, "text": title + "\n" + body, "role": role}, **extra)


SLIDES = [
    slide("s1", [1], "Urban water systems", "Course overview and logistics", role="structural"),
    slide("s2", [2], "Reservoir storage", "Dams hold seasonal runoff\nStorage capacity and drawdown curves"),
    slide("s3", [3], "Filtration", "Sand beds remove suspended particles\nBackwashing restores the filter media"),
    slide("s4", [4], "Disinfection", "Chlorine dose and contact time\nUltraviolet lamps inactivate pathogens"),
    slide("s5", [5], "Distribution network", "Pumps maintain pressure in the mains\nElevated tanks buffer peak demand"),
    slide("s6", [6], "Leak detection", "Acoustic sensors locate pipe bursts\nNight flow analysis estimates losses"),
]
SPEECH = {
    "s1": ["Welcome to urban water systems: this overview covers the course logistics.",
           "Logistics first, then the course overview lists every week of urban water systems."],
    "s2": ["A reservoir gives us storage, so the dams can hold the seasonal runoff until the dry months.",
           "Look at the drawdown curves: storage capacity falls every summer and the reservoir refills in spring.",
           "So the dams and their storage capacity decide how much runoff we can keep."],
    "s3": ["Filtration comes next: the stream passes through sand beds that remove the suspended particles.",
           "When the filter media clogs, backwashing pushes upward and restores the sand beds.",
           "Particles stay in the filter until the backwashing cycle carries them away."],
    "s4": ["For disinfection we choose a chlorine dose and give it enough contact time.",
           "Ultraviolet lamps are the alternative: they inactivate pathogens without adding chlorine.",
           "Pathogens survive when the contact time is too short or the chlorine dose is too low."],
    "s5": ["The distribution network relies on pumps that maintain pressure in the mains.",
           "Elevated tanks buffer the peak demand in the morning, so the pumps can run steadily.",
           "If pressure in the mains drops, the elevated tanks empty during peak demand."],
    "s6": ["Leak detection uses acoustic sensors that locate pipe bursts by their sound.",
           "Night flow analysis estimates the losses because almost nobody is awake at three in the morning.",
           "Acoustic sensors and night flow together tell us where the pipe bursts and losses are."],
}
# A return to the reservoir material in other words; nobody says "slide", "back" or "again".
RESERVOIR_RETURN = ["The dams matter here too: without seasonal runoff in the reservoir the storage capacity is gone.",
                    "Drawdown curves for the reservoir show the storage we lost."]
CHATTER = ["Okay, is the microphone working for the people online today?", "Somebody left a blue umbrella here last week, please collect it.",
           "The cafeteria closes early on Friday, by the way.", "My laptop is updating, give me a second.", "Did anyone watch the football game yesterday evening?",
           "Please sign the attendance sheet before you leave.", "The projector bulb was replaced this morning."]
STEP = 10.0


def windows_of(*parts):
    """``"s3"`` → that slide's spoken lines; a list → those sentences as they are. Ten seconds per sentence."""
    texts = [t for part in parts for t in (SPEECH[part] if isinstance(part, str) else part)]
    return [{"start": i * STEP, "end": (i + 1) * STEP, "text": text} for i, text in enumerate(texts)]


def run(windows, slides=SLIDES, **kwargs):
    return al.align_windows_to_slides(windows, slides, acoustic="generated_unreviewed", **kwargs)


def summary(result):
    return [(o["slide_id"], o["start"], o["end"]) for o in result["occurrences"]]


# ---- sequence model: order, skips, repeats, jumps ----------------------------------------------------
def test_slides_spoken_in_order_become_one_occurrence_each_with_real_boundaries():
    result = run(windows_of("s2", "s3", "s4", "s5", "s6"))
    assert summary(result) == [("s2", 0.0, 30.0), ("s3", 30.0, 60.0), ("s4", 60.0, 90.0), ("s5", 90.0, 120.0), ("s6", 120.0, 150.0)]
    assert result["unassigned"] == []
    assert [o["transition"] for o in result["occurrences"]] == ["start", "advance", "advance", "advance", "advance"]
    assert all(o["method"] == al.SEQUENCE_METHOD and o["margin"] > 0 and o["score"] > 0 and not o["revisit"] for o in result["occurrences"])
    assert result["assignments"] == ["s2"] * 3 + ["s3"] * 3 + ["s4"] * 3 + ["s5"] * 3 + ["s6"] * 3


def test_a_skipped_slide_gets_no_interval_and_the_skip_is_named():
    result = run(windows_of("s2", "s3", "s6"))
    assert summary(result) == [("s2", 0.0, 30.0), ("s3", 30.0, 60.0), ("s6", 60.0, 90.0)]
    last = result["occurrences"][-1]
    assert last["transition"] == "skip_forward" and last["skipped_slide_ids"] == ["s4", "s5"]
    states = {s["slide_id"]: s for s in result["slides"]}
    assert states["s4"]["occurrences"] == 0 and states["s4"]["state"] == "no_match_in_these_windows"
    assert states["s5"]["occurrences"] == 0 and states["s6"]["state"] == "linked"


def test_a_return_to_an_earlier_slide_is_a_second_occurrence_without_anyone_saying_slide():
    windows = windows_of("s2", "s3", "s4", RESERVOIR_RETURN, "s5")
    assert not any(word in " ".join(RESERVOIR_RETURN).lower() for word in ("slide", "back", "again", "return"))
    result = run(windows)
    assert summary(result) == [("s2", 0.0, 30.0), ("s3", 30.0, 60.0), ("s4", 60.0, 90.0), ("s2", 90.0, 110.0), ("s5", 110.0, 140.0)]
    first, _, _, second, after = result["occurrences"]
    assert (first["occurrence"], first["revisit"]) == (1, False)
    assert (second["occurrence"], second["revisit"], second["transition"]) == (2, True, "back")
    assert first["of"] == second["of"] == 2
    assert (first["occurrence_id"], second["occurrence_id"]) == ("s2#1", "s2#2")  # each occurrence can be addressed on its own
    assert result["version"] == al.ALIGNMENT_VERSION
    assert after["transition"] == "skip_forward"  # from the revisited slide the lecture moves on past slides it already covered
    assert next(s for s in result["slides"] if s["slide_id"] == "s2")["occurrences"] == 2


def test_disjoint_occurrences_of_one_slide_are_never_merged_into_one_interval():
    result = run(windows_of("s2", "s3", "s4", RESERVOIR_RETURN))
    mine = [o for o in result["occurrences"] if o["slide_id"] == "s2"]
    assert [(o["start"], o["end"]) for o in mine] == [(0.0, 30.0), (90.0, 110.0)]
    covered = sorted((o["start"], o["end"]) for o in result["occurrences"])
    assert all(a[1] <= b[0] for a, b in itertools.pairwise(covered))  # no two occurrences overlap
    assert not any(o["slide_id"] == "s2" and o["start"] < 90.0 < o["end"] for o in result["occurrences"])  # nothing bridges the other slides


def test_a_backward_jump_to_a_slide_not_yet_shown_is_followed():
    result = run(windows_of("s2", "s3", "s5", "s4"))
    assert [o["slide_id"] for o in result["occurrences"]] == ["s2", "s3", "s5", "s4"]
    assert result["occurrences"][2]["transition"] == "skip_forward" and result["occurrences"][2]["skipped_slide_ids"] == ["s4"]
    jump = result["occurrences"][3]
    assert jump["transition"] == "back" and jump["revisit"] is False and jump["occurrence"] == 1


# ---- sequence model: abstention ----------------------------------------------------------------------
def test_unrelated_chatter_between_slides_is_returned_unassigned_with_a_reason():
    result = run(windows_of("s2", CHATTER[:4], "s3"))
    assert summary(result) == [("s2", 0.0, 30.0), ("s3", 70.0, 100.0)]
    assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(30.0, 70.0, "weak_evidence")]
    assert result["assignments"][3:7] == [None] * 4
    assert result["occurrences"][1]["transition"] == "advance"  # the chatter is not counted as a slide


def test_nothing_is_spread_evenly_when_no_window_supports_any_slide():
    result = run(windows_of(CHATTER, CHATTER[:3]))
    assert result["occurrences"] == [] and result["assignments"] == [None] * 10
    assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(0.0, 100.0, "weak_evidence")]
    assert all(s["occurrences"] == 0 for s in result["slides"])
    assert result["summary"] == {"windows": 10, "assigned": 0, "unassigned": 10, "slides": 6, "slides_linked": 0}


def test_one_real_match_in_a_long_stretch_of_other_talk_keeps_its_own_short_interval():
    result = run(windows_of(CHATTER[:5], "s4", CHATTER[5:], CHATTER[:4]))
    assert summary(result) == [("s4", 50.0, 80.0)]
    assert [(u["start"], u["end"]) for u in result["unassigned"]] == [(0.0, 50.0), (80.0, 140.0)]


@pytest.mark.parametrize("count", [1, 2, 3])
def test_even_one_or_two_unrelated_sentences_between_two_slides_are_left_unassigned(count):
    """Short stretches too: leaving and re-entering a slide costs the decoder more than two unrelated sentences are
    worth, so it passes through them — but a sentence that shares nothing with a slide is never reported as its talk."""
    result = run(windows_of("s2", CHATTER[:count], "s3"))
    gap_end = 30.0 + STEP * count
    assert summary(result) == [("s2", 0.0, 30.0), ("s3", gap_end, gap_end + 30.0)]
    assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(30.0, gap_end, "weak_evidence")]
    assert result["assignments"] == ["s2"] * 3 + [None] * count + ["s3"] * 3
    assert result["occurrences"][1]["transition"] == "advance"


@pytest.mark.parametrize("count", [1, 2])
def test_unrelated_sentences_inside_one_slides_talk_split_it_into_two_occurrences(count):
    result = run(windows_of("s2", CHATTER[:count], RESERVOIR_RETURN))
    gap_end = 30.0 + STEP * count
    assert summary(result) == [("s2", 0.0, 30.0), ("s2", gap_end, gap_end + 20.0)]  # not one continuous interval
    assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(30.0, gap_end, "weak_evidence")]
    second = result["occurrences"][1]
    assert (second["transition"], second["revisit"], second["occurrence"], second["of"]) == ("resume", False, 2, 2)


def test_an_unrelated_sentence_at_the_edge_is_not_attached_and_lends_no_weight():
    result = run(windows_of("s2", [SPEECH["s6"][0]], CHATTER[:1]))
    last = result["occurrences"][-1]
    assert (last["slide_id"], last["start"], last["end"]) == ("s6", 30.0, 40.0)
    assert last["support"]["weight"] <= 1.0 and last["support"]["shape"] == "brief_or_close"  # one sentence stays one sentence
    assert result["assignments"][-1] is None and result["unassigned"][-1]["reason"] == "weak_evidence"
    leading = run(windows_of(CHATTER[:1], "s2"))
    assert summary(leading) == [("s2", 10.0, 40.0)] and leading["assignments"][0] is None


def test_sentences_without_any_content_word_are_not_bridged_however_many_there_are():
    """"So what do we do?" has no word the matcher counts, so it costs the decoder nothing to carry any number of such
    sentences along inside a slide. They share nothing with the slide either: the occurrence ends before them."""
    fillers = ["So what do we do?", "Why is that so?", "And then what?", "Is it?", "Who did it?", "How so?"]
    assert all(al.score_candidates([{"text": text}], SLIDES)["weights"] == [0.0] for text in fillers)
    for count in (1, 6):
        result = run(windows_of(SPEECH["s2"][:2], fillers[:count], RESERVOIR_RETURN))
        resumed = 20.0 + STEP * count
        assert summary(result) == [("s2", 0.0, 20.0), ("s2", resumed, resumed + 20.0)]
        assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(20.0, resumed, "weak_evidence")]
        assert result["occurrences"][1]["transition"] == "resume"


def test_no_window_inside_an_occurrence_is_without_wording_of_its_own_for_that_slide():
    rng = random.Random(11)
    index = {s["slide_id"]: i for i, s in enumerate(SLIDES)}
    absorbed_by_the_decoder = 0
    for _ in range(60):
        parts = []
        for _ in range(rng.randint(2, 6)):
            parts.append(rng.choice(["s2", "s3", "s4", "s5", "s6"]) if rng.random() < 0.6 else rng.sample(CHATTER, rng.randint(1, 3)))
        windows = windows_of(*parts)
        result = run(windows)
        scores = al.score_candidates(windows, SLIDES)
        states, _ = al.decode(scores["emissions"], scores["weights"], al.sequence_params())
        for w, slide_id in enumerate(result["assignments"]):
            if slide_id is not None:
                assert scores["components"]["lexical"][w][index[slide_id]] > 0
        absorbed_by_the_decoder += sum(1 for w, s in enumerate(states) if s is not None and scores["components"]["lexical"][w][s] == 0)
    assert absorbed_by_the_decoder > 0  # the cases above really contain what the rule is for


def test_a_long_run_on_one_everyday_word_stays_below_the_occurrence_threshold():
    """One word of a page ("pressure") in sentence after sentence about other things: the decoder does settle on that
    page — each sentence is worth a little more there than unassigned — and the occurrence threshold returns it."""
    thin = ["My blood pressure rises every time the parking office sends another angry letter.",
            "There is real pressure on everybody this month because the grant report is late.",
            "Peer pressure made me buy that ridiculous orange bicycle helmet last weekend.",
            "The landlord keeps up the pressure about the broken garden fence and the hedge.",
            "Under pressure my cousin once baked forty lemon tarts for a village wedding.",
            "Journalists put pressure on the mayor about the missing festival budget again."]
    windows = [{"start": 3000.0 + i * STEP, "end": 3000.0 + (i + 1) * STEP, "text": text} for i, text in enumerate(thin)]
    scores = al.score_candidates(windows, SLIDES)
    decoded, _ = al.decode(scores["emissions"], scores["weights"], al.sequence_params(), initial="anywhere")
    assert decoded.count(4) >= 4  # the distribution page, by the decoder's own choice
    result = run(windows)
    assert result["occurrences"] == [] and result["assignments"] == [None] * 6
    assert {u["reason"] for u in result["unassigned"]} == {"weak_evidence"}
    best = result["unassigned"][-1]["best"]
    assert best["slide_id"] == "s5" and al.sequence_params()["unassigned_score"] < best["score"] < al.sequence_params()["min_occurrence_score"]


def test_a_single_word_counts_for_an_eighth_of_a_sentence_and_cannot_carry_an_occurrence_alone():
    windows = windows_of(CHATTER[:2], ["Filtration."], CHATTER[2:4])
    scores = al.score_candidates(windows, SLIDES)
    assert scores["weights"][2] == 1 / al.sequence_params()["full_weight_tokens"] == 0.125 and scores["emissions"][2][2] > 0.3
    result = run(windows)
    assert result["occurrences"] == [] and result["unassigned"][0]["best"]["slide_id"] == "s3"  # named as the best guess, not linked
    said_more = run(windows_of(CHATTER[:2], ["Filtration.", "Sand beds, backwashing."], CHATTER[2:4]))
    assert summary(said_more) == [("s3", 20.0, 40.0)]


def test_windows_without_words_are_unassigned_and_empty_inputs_are_explicit():
    silent = [{"start": 0.0, "end": 30.0, "text": ""}, {"start": 30.0, "end": 60.0, "text": "   "}]
    assert run(silent)["occurrences"] == [] and run(silent)["unassigned"][0]["reason"] == "weak_evidence"
    assert run([])["occurrences"] == [] and run([])["unassigned"] == []
    nothing = run(windows_of("s2"), slides=[])
    assert nothing["occurrences"] == [] and nothing["assignments"] == [None] * 3


def test_two_slides_the_text_cannot_tell_apart_are_reported_as_ambiguous_between_them():
    twins = [SLIDES[1], dict(SLIDES[2], slide_id="s3a", pages=[3]), dict(SLIDES[2], slide_id="s3b", pages=[4]), SLIDES[3]]
    result = run(windows_of("s2", "s3", "s4"), slides=twins)
    assert [o["slide_id"] for o in result["occurrences"]] == ["s2", "s4"]
    assert [(u["start"], u["end"], u["reason"], u["between"]) for u in result["unassigned"]] == [(30.0, 60.0, "ambiguous", ["s3a", "s3b"])]
    states = {s["slide_id"]: s["state"] for s in result["slides"]}
    assert states["s3a"] == states["s3b"] == "ambiguous_only"
    # The lecture moved on through one of the twins: the next slide is an advance, and the twins were not "skipped".
    assert (result["occurrences"][1]["transition"], result["occurrences"][1]["skipped_slide_ids"]) == ("advance", [])


def test_a_return_after_talk_that_was_ambiguous_between_other_slides_is_a_revisit_not_a_resume():
    twins = [SLIDES[1], dict(SLIDES[2], slide_id="s3a", pages=[3]), dict(SLIDES[2], slide_id="s3b", pages=[4]), SLIDES[3]]
    result = run(windows_of("s2", "s3", RESERVOIR_RETURN), slides=twins)
    assert [o["slide_id"] for o in result["occurrences"]] == ["s2", "s2"]
    assert [(u["reason"], u["between"]) for u in result["unassigned"]] == [("ambiguous", ["s3a", "s3b"])]
    second = result["occurrences"][1]
    assert (second["transition"], second["revisit"], second["occurrence"], second["of"]) == ("return", True, 2, 2)  # other slides were discussed in between
    # After plain unrelated talk the same slide simply resumes.
    plain = run(windows_of("s2", CHATTER[:4], RESERVOIR_RETURN), slides=twins)
    assert [(o["transition"], o["revisit"]) for o in plain["occurrences"]] == [("start", False), ("resume", False)]


def test_slide_ids_must_be_unique_and_a_page_belongs_to_one_logical_slide():
    with pytest.raises(ValueError, match="s2"):
        run(windows_of("s2"), slides=[SLIDES[1], dict(SLIDES[2], slide_id="s2")])
    texts = [s["text"] for s in SLIDES[:4]]
    with pytest.raises(ValueError, match="page 2"):
        al.logical_slides_from_pages(texts, groups=[{"slide_id": "a", "pages": [1, 2]}, {"slide_id": "b", "pages": [2, 3]}])
    with pytest.raises(ValueError, match="p4"):
        al.logical_slides_from_pages(texts, groups=[{"slide_id": "p4", "pages": [1, 2]}])  # collides with the id of the ungrouped page 4


def test_when_many_slides_fit_equally_the_interval_is_weak_evidence_not_a_list_of_names():
    clones = [dict(SLIDES[2], slide_id=f"c{i}", pages=[i]) for i in range(1, 6)]
    result = run(windows_of("s3"), slides=clones)
    assert result["occurrences"] == [] and [(u["reason"], u["between"]) for u in result["unassigned"]] == [("weak_evidence", [])]
    assert all(s["state"] == "no_match_in_these_windows" for s in result["slides"])


def test_a_long_silence_splits_an_interval_instead_of_being_bridged():
    later = [{"start": 600.0 + i * STEP, "end": 600.0 + (i + 1) * STEP, "text": text} for i, text in enumerate(RESERVOIR_RETURN)]
    result = run(windows_of("s2") + later)
    assert summary(result) == [("s2", 0.0, 30.0), ("s2", 600.0, 620.0)]  # not one interval of ten minutes
    second = result["occurrences"][1]
    assert (second["transition"], second["revisit"], second["occurrence"], second["of"]) == ("resume", False, 2, 2)


def _lined(rows):
    return [{"lines": [n, n], "start": start, "end": end, "text": text} for n, (start, end, text) in enumerate(rows, start=1)]


def test_an_untimed_line_between_two_timed_lines_far_apart_does_not_bridge_them():
    """Lines as ``windows_from_lines`` gives them: some timed, some not. The hour between the two timed lines belongs
    to no interval, and the line whose time is unknown is kept apart from both instead of gluing them together."""
    windows = _lined([(0.0, 10.0, SPEECH["s2"][0]), (None, None, SPEECH["s2"][1]), (3600.0, 3610.0, SPEECH["s2"][2])])
    result = al.align_windows_to_slides(windows, SLIDES, acoustic="generated_unreviewed")
    assert [(o["slide_id"], o["start"], o["end"], o["lines"], o["timed_windows"]) for o in result["occurrences"]] == [
        ("s2", 0.0, 10.0, [1, 1], 1), ("s2", None, None, [2, 2], 0), ("s2", 3600.0, 3610.0, [3, 3], 1)]
    assert result["assignments"] == ["s2"] * 3  # what the lines are about is unchanged; only the intervals are kept honest
    without = al.align_windows_to_slides([windows[0], windows[2]], SLIDES, acoustic="generated_unreviewed")
    assert [(o["start"], o["end"]) for o in without["occurrences"]] == [(0.0, 10.0), (3600.0, 3610.0)]
    # several untimed lines in the gap, and an unassigned stretch, are held to the same rule
    longer = _lined([(0.0, 10.0, SPEECH["s2"][0]), (None, None, SPEECH["s2"][1]), (None, None, SPEECH["s2"][2]), (900.0, 910.0, RESERVOIR_RETURN[0]), (912.0, 920.0, RESERVOIR_RETURN[1])])
    assert [(o["start"], o["end"], o["lines"]) for o in al.align_windows_to_slides(longer, SLIDES)["occurrences"]] == [(0.0, 10.0, [1, 1]), (None, None, [2, 3]), (900.0, 920.0, [4, 5])]
    chatter = _lined([(0.0, 10.0, CHATTER[0]), (None, None, CHATTER[1]), (3600.0, 3610.0, CHATTER[2])])
    assert [(u["start"], u["end"], u["lines"]) for u in al.align_windows_to_slides(chatter, SLIDES)["unassigned"]] == [(0.0, 10.0, [1, 1]), (None, None, [2, 2]), (3600.0, 3610.0, [3, 3])]


def test_an_untimed_line_between_two_timed_lines_close_together_stays_in_their_interval():
    windows = _lined([(0.0, 10.0, SPEECH["s2"][0]), (None, None, SPEECH["s2"][1]), (12.0, 20.0, SPEECH["s2"][2])])
    result = al.align_windows_to_slides(windows, SLIDES)
    assert [(o["slide_id"], o["start"], o["end"], o["lines"], o["timed_windows"]) for o in result["occurrences"]] == [("s2", 0.0, 20.0, [1, 3], 2)]
    for limit, pieces in ((30.0, 1), (1.0, 3)):  # the stated gap is the parameter, nothing else
        assert len(al.align_windows_to_slides(windows, SLIDES, params={"max_gap_seconds": limit})["occurrences"]) == pieces


def test_plural_and_singular_forms_count_as_the_same_term():
    pair = [slide("a", [1], "Pump", "Valve and pipe"), slide("b", [2], "Tank", "Lamp and sensor")]
    scores = al.score_candidates([{"text": "The pumps, valves and pipes were replaced."}], pair)
    assert scores["components"]["lexical"][0][0] > 0.3 and scores["components"]["lexical"][0][1] == 0
    spoken = al.score_candidates([{"text": "Sand filters need backwashing."}], [slide("a", [1], "Figure", "")], vocabulary={"a": ["sand filter"]})
    assert spoken["components"]["vocabulary"][0][0] > 0


def test_neighbouring_windows_tip_a_sentence_that_fits_two_slides_and_cannot_create_support_where_it_has_none():
    mixed = "The pumps keep pressure while the sand settles."  # two words of the distribution page, one of the filtration page
    windows = windows_of([SPEECH["s3"][0], SPEECH["s3"][1], mixed, SPEECH["s3"][2]])
    scores = al.score_candidates(windows, SLIDES)
    lexical, context, emission = (scores["components"]["lexical"][2], scores["components"]["context"][2], scores["emissions"][2])
    assert 0 < lexical[2] < lexical[4]  # on its own wording the sentence leans to the distribution page …
    assert context[2] > context[4] and emission[2] > emission[4]  # … said between filtration sentences it counts for filtration
    alone = al.score_candidates(windows_of([mixed]), SLIDES)["emissions"][0]
    assert alone[2] < alone[4]
    # A sentence with nothing of its own for a slide gets nothing from its neighbours either.
    between = al.score_candidates(windows_of([SPEECH["s3"][0], CHATTER[1], SPEECH["s3"][1]]), SLIDES)
    assert between["components"]["context"][1][2] == 0 and between["emissions"][1][2] == 0


# ---- logical slides, roles, quality ------------------------------------------------------------------
def test_a_build_group_is_one_logical_slide_and_gets_one_interval_not_one_per_page():
    builds = ["Filtration", "Filtration\nSand beds remove suspended particles", "Filtration\nSand beds remove suspended particles\nBackwashing restores the filter media"]
    logical = al.logical_slides_from_pages(
        [SLIDES[1]["text"], *builds, SLIDES[3]["text"]],
        groups=[{"slide_id": "g-filtration", "pages": [2, 3, 4], "grouping": "inferred_build_group"}])
    assert [(s["slide_id"], s["pages"]) for s in logical] == [("p1", [1]), ("g-filtration", [2, 3, 4]), ("p5", [5])]
    assert logical[1]["title"] == "Filtration" and logical[1]["text"].count("Sand beds") == 1  # repeated build lines are not counted three times
    result = run(windows_of("s2", "s3", "s4"), slides=logical)
    assert [(o["slide_id"], o["pages"], o["start"], o["end"]) for o in result["occurrences"]] == [("p1", [1], 0.0, 30.0), ("g-filtration", [2, 3, 4], 30.0, 60.0), ("p5", [5], 60.0, 90.0)]
    assert result["occurrences"][1]["quality"]["grouping"] == "inferred_build_group"
    assert result["occurrences"][0]["quality"]["grouping"] == "single_page"


def test_a_structural_title_has_a_lower_prior_but_real_speech_over_it_stays_discoverable():
    result = run(windows_of("s1", "s2", "s3"))
    assert summary(result)[0] == ("s1", 0.0, 20.0) and result["occurrences"][0]["role"] == "structural"
    assert result["occurrences"][0]["support"]["role_prior"] < 0
    # The same words on a title page and on a teaching page: the teaching page is preferred, the title page is not zero.
    pair = [slide("title", [1], "Filtration", "Sand beds remove suspended particles", role="structural"), slide("teach", [2], "Filtration", "Sand beds remove suspended particles")]
    scores = al.score_candidates(windows_of("s3"), pair)
    for row in scores["emissions"]:
        assert 0 < row[0] < row[1]
    # Without any speech about it, the title page gets no interval at all.
    assert "s1" not in [o["slide_id"] for o in run(windows_of("s2", "s3"))["occurrences"]]
    # Role names are read as words: "instructional" contains the letters of "structural" and is not one.
    p = al.sequence_params()
    roles = [slide("a", [1], "Filtration", "Sand beds", role="instructional"), slide("b", [2], "Filtration", "Sand beds", role="structural_title"),
             slide("c", [3], "Filtration", "Sand beds", role="blank"), slide("d", [4], "Filtration", "Sand beds", role="worked_example")]
    assert al.score_candidates(windows_of("s3"), roles)["priors"] == [0.0, p["prior_structural"], p["prior_blank"], 0.0]
    assert p["prior_blank"] < p["prior_structural"] < 0


def test_quality_keeps_acoustic_association_and_grouping_apart_and_never_says_confirmed():
    result = run(windows_of("s2", "s3", [SPEECH["s6"][0]]))
    for occurrence in result["occurrences"]:
        assert set(occurrence["quality"]) == {"acoustic", "association", "grouping"}
        assert occurrence["quality"]["acoustic"] == "generated_unreviewed"
        # One label for every link this module makes. Measured once on real lectures, a two-step label (longer and
        # clearer against shorter or closer) did not put the more reliable links in the upper step, so none is offered.
        assert occurrence["quality"]["association"] == "candidate"
        assert set(occurrence["support"]) >= {"lexical", "context", "vocabulary", "hint", "role_prior", "weight", "shape"}
    # How much there is and how clear it is stays readable as a description of the evidence, not as a grade.
    assert result["occurrences"][0]["support"]["shape"] == "sustained_clear"
    assert result["occurrences"][-1]["slide_id"] == "s6" and result["occurrences"][-1]["support"]["shape"] == "brief_or_close"  # one sentence only
    untimed = al.align_windows_to_slides([{"lines": [n, n], "text": w["text"]} for n, w in enumerate(windows_of("s2", "s3"), start=1)], SLIDES, acoustic="untimed_transcript_lines")
    assert [(o["slide_id"], o["start"], o["end"], o["lines"]) for o in untimed["occurrences"]] == [("s2", None, None, [1, 3]), ("s3", None, None, [4, 6])]
    assert untimed["occurrences"][0]["quality"]["acoustic"] == "untimed_transcript_lines"


# ---- hints and vocabulary ----------------------------------------------------------------------------
def test_a_hint_resolves_an_ambiguous_case_and_is_named_in_the_support():
    twins = [SLIDES[1], dict(SLIDES[2], slide_id="s3a", pages=[3]), dict(SLIDES[2], slide_id="s3b", pages=[4]), SLIDES[3]]
    hint = {"slide_ids": ["s3b"], "time_ranges": [[30.0, 60.0]], "basis": "catalog_locator"}
    result = run(windows_of("s2", "s3", "s4"), slides=twins, hints=[hint])
    assert [o["slide_id"] for o in result["occurrences"]] == ["s2", "s3b", "s4"] and result["unassigned"] == []
    supported = result["occurrences"][1]["support"]
    assert supported["hint"] > 0 and supported["hint_bases"] == ["catalog_locator"]
    assert result["occurrences"][0]["support"]["hint"] == 0 and result["occurrences"][0]["support"]["hint_bases"] == []
    assert result["occurrences"][1]["quality"]["association"] == "candidate"  # a hint is support, not confirmation
    by_lines = al.align_windows_to_slides([{"lines": [n, n], "text": w["text"]} for n, w in enumerate(windows_of("s2", "s3", "s4"), start=1)], twins,
                                          hints=[{"slide_ids": ["s3b"], "line_ranges": [[4, 6]], "basis": "catalog_locator"}])
    assert [o["slide_id"] for o in by_lines["occurrences"]] == ["s2", "s3b", "s4"]


def test_a_wrong_hint_does_not_override_strong_contrary_evidence():
    wrong = {"slide_ids": ["s6"], "time_ranges": [[30.0, 60.0]], "basis": "catalog_locator"}
    result = run(windows_of("s2", "s4", "s5"), hints=[wrong])
    assert summary(result) == [("s2", 0.0, 30.0), ("s4", 30.0, 60.0), ("s5", 60.0, 90.0)]
    assert "s6" not in result["assignments"]
    # The same where the wrongly named slide does share a word with the speech, so the hint really is counted for it.
    disinfection = ["For disinfection we choose a chlorine dose and give it enough contact time.",
                    "Ultraviolet lamps run day and night: they inactivate pathogens without adding chlorine.",
                    "Pathogens survive the night when the contact time is too short or the chlorine dose is too low."]
    windows = windows_of("s2", disinfection, "s5")
    scores = al.score_candidates(windows, SLIDES, hints=[wrong])
    assert scores["components"]["hint"][4][5] == 1.0 and scores["components"]["lexical"][4][5] > 0  # "night" is on the leak-detection page
    result = run(windows, hints=[wrong])
    assert summary(result) == [("s2", 0.0, 30.0), ("s4", 30.0, 60.0), ("s5", 60.0, 90.0)] and "s6" not in result["assignments"]


def test_a_hint_alone_never_creates_a_link_over_speech_that_shares_nothing_with_the_slide():
    """A known source map is shown on its own authority by whoever holds it. Here it may strengthen what the wording
    says about a slide; it cannot turn unrelated talk into an occurrence of this method."""
    for hinted_until in (65.0, 69.0, 70.0, 75.0):
        hint = {"slide_ids": ["s6"], "time_ranges": [[30.0, hinted_until]], "basis": "catalog_locator"}
        windows = windows_of("s2", CHATTER[:4], "s3")
        result = run(windows, hints=[hint])
        assert summary(result) == [("s2", 0.0, 30.0), ("s3", 70.0, 100.0)]
        assert [(u["start"], u["end"], u["reason"]) for u in result["unassigned"]] == [(30.0, 70.0, "weak_evidence")]
        assert result["occurrences"][1]["transition"] == "advance"  # nothing "went back" from a slide nobody spoke about
        scores = al.score_candidates(windows, SLIDES, hints=[hint])
        assert all(scores["components"]["hint"][w][5] == 0 and scores["emissions"][w][5] == 0 for w in range(3, 7))
    by_lines = [{"lines": [n, n], "text": w["text"]} for n, w in enumerate(windows_of("s2", CHATTER[:4], "s3"), start=1)]
    untimed = al.align_windows_to_slides(by_lines, SLIDES, hints=[{"slide_ids": ["s6"], "line_ranges": [[4, 7]], "basis": "catalog_locator"}])
    assert [o["slide_id"] for o in untimed["occurrences"]] == ["s2", "s3"]


def test_vocabulary_tied_to_a_slide_supports_it_when_the_page_has_almost_no_text():
    figures = [slide("fa", [1], "Figure 2", ""), slide("fb", [2], "Figure 3", "")]
    talk = ["In the flocculation basin the coagulation chemicals bind the fine clay.", "Coagulation needs gentle mixing in the flocculation basin.",
            "The anaerobic digester handles sludge digestion over several weeks.", "Sludge digestion in the digester produces methane."]
    assert run(windows_of(talk), slides=figures)["occurrences"] == []  # the pages alone say nothing
    vocabulary = {"fa": ["coagulation", "flocculation basin"], "fb": ["sludge digestion", {"label": "anaerobic digester", "aliases": ["digester"]}]}
    result = run(windows_of(talk), slides=figures, vocabulary=vocabulary)
    assert summary(result) == [("fa", 0.0, 20.0), ("fb", 20.0, 40.0)]
    assert all(o["support"]["vocabulary"] > 0 for o in result["occurrences"])


# ---- decoder -----------------------------------------------------------------------------------------
def _brute_force(emissions, weights, params, initial):
    """Plain O(states²) Viterbi over the module's own transition costs: the reference the fast decoder must equal."""
    n = len(emissions[0])
    states = [("A", s) for s in range(n)] + [("U", s) for s in range(n)] + [("U", -1)]
    theta = params["unassigned_score"]
    score = {state: float("-inf") for state in states}
    score[("U", -1)] = 0.0
    for row, weight in zip(emissions, weights):
        nxt = {}
        for state in states:
            emit = weight * (row[state[1]] if state[0] == "A" else theta)
            nxt[state] = emit + max(score[prev] - al.transition_cost(prev, state, params, initial=initial) for prev in states)
        score = nxt
    return max(score.values())


@pytest.mark.parametrize("initial", ["deck_start", "anywhere"])
def test_the_fast_decoder_finds_the_same_optimum_as_plain_viterbi(initial):
    rng = random.Random(505)
    params = al.sequence_params()
    for _ in range(40):
        n, length = rng.randint(1, 7), rng.randint(1, 12)
        emissions = [[round(rng.choice([0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5]) * rng.random(), 4) for _ in range(n)] for _ in range(length)]
        weights = [rng.choice([0.25, 0.5, 1.0]) for _ in range(length)]
        states, total = al.decode(emissions, weights, params, initial=initial)
        assert len(states) == length and all(s is None or 0 <= s < n for s in states)
        assert total == pytest.approx(_brute_force(emissions, weights, params, initial), abs=1e-9)
        # the reported path really has the reported score
        path = [("U", -1)]
        for s in states:
            last = path[-1][1]
            path.append(("A", s) if s is not None else ("U", last))
        replay = sum(w * (row[st[1]] if st[0] == "A" else params["unassigned_score"]) - al.transition_cost(prev, st, params, initial=initial)
                     for row, w, prev, st in zip(emissions, weights, path, path[1:]))
        assert replay == pytest.approx(total, abs=1e-9)


@pytest.mark.parametrize("initial", ["deck_start", "anywhere"])
@pytest.mark.parametrize("overrides", [{}, {"cost_skip_cap": 0.05, "cost_back_cap": 0.02, "cost_enter_unassigned": 0.02, "cost_leave_unassigned": 0.01}])
def test_the_fast_decoder_equals_plain_viterbi_on_a_long_deck_where_the_capped_jump_costs_decide(initial, overrides):
    """Real decks have seventy to ninety pages. Beyond eleven slides forward and twenty-one back the jump cost stops
    growing, and the fast decoder takes a different branch there: these problems are built so that branch wins."""
    n = 40
    params = al.sequence_params(overrides)
    theta = params["unassigned_score"]
    states = [("A", s) for s in range(n)] + [("U", s) for s in range(n)] + [("U", -1)]
    cost = {(a, b): al.transition_cost(a, b, params, initial=initial) for a in states for b in states}

    def plain(emissions, weights):
        score = {state: float("-inf") for state in states}
        score[("U", -1)] = 0.0
        for row, weight in zip(emissions, weights):
            score = {state: weight * (row[state[1]] if state[0] == "A" else theta) + max(score[prev] - cost[prev, state] for prev in states) for state in states}
        return max(score.values())

    def replay(decoded, emissions, weights):
        path = [("U", -1)]
        for s in decoded:
            path.append(("A", s) if s is not None else ("U", path[-1][1]))
        return sum(w * (row[st[1]] if st[0] == "A" else theta) - cost[prev, st] for row, w, prev, st in zip(emissions, weights, path, path[1:]))

    # One hand-made path first: slide 3, then thirty-three slides on, then thirty back.
    emissions = [[0.9 if s == peak else 0.0 for s in range(n)] for peak in (2, 35, 5)]
    decoded, total = al.decode(emissions, [1.0, 1.0, 1.0], params, initial=initial)
    assert decoded == [2, 35, 5] and total == pytest.approx(plain(emissions, [1.0, 1.0, 1.0]), abs=1e-9)

    rng = random.Random(4040)
    far_forward = far_back = unassigned = 0
    for problem in range(60):
        length = rng.randint(2, 9)
        emissions = [[round(rng.choice([-0.06, -0.03, 0.0, 0.0, 0.0, 0.02, 0.05]) * rng.random(), 4) for _ in range(n)] for _ in range(length)]
        for i, row in enumerate(emissions):
            if problem % 2 and rng.random() < 0.8:  # the talk swings between the two ends of the deck
                row[rng.randrange(0, 8) if (i + problem // 2) % 2 else rng.randrange(30, n)] = round(rng.uniform(0.3, 0.9), 4)
            elif rng.random() < 0.8:  # one page clearly spoken about, anywhere in the deck
                row[rng.randrange(n)] = round(rng.uniform(0.15, 0.9), 4)
        weights = [rng.choice([0.0, 0.25, 0.5, 1.0, 1.0]) for _ in range(length)]
        decoded, total = al.decode(emissions, weights, params, initial=initial)
        assert len(decoded) == length and all(s is None or 0 <= s < n for s in decoded)
        assert total == pytest.approx(plain(emissions, weights), abs=1e-9)
        assert replay(decoded, emissions, weights) == pytest.approx(total, abs=1e-9)  # the reported path really has the reported score
        visited = [s for s in decoded if s is not None]
        far_forward += sum(1 for a, b in itertools.pairwise(visited) if b - a >= 12)
        far_back += sum(1 for a, b in itertools.pairwise(visited) if a - b >= 22)
        unassigned += decoded.count(None)
    assert far_forward >= 5 and far_back >= 5 and unassigned >= 5  # the capped branches and UNASSIGNED were all on winning paths


FILLER = [slide(f"f{i}", [i], title, body) for i, (title, body) in enumerate([
    ("Aquifer recharge", "Infiltration ponds refill the groundwater table"), ("Well drilling", "Boreholes need casing and a gravel pack"),
    ("Coagulation chemistry", "Alum neutralises the charge on fine clay"), ("Sedimentation basins", "Settling velocity sets the basin depth"),
    ("Membrane desalination", "Reverse osmosis rejects dissolved salt"), ("Sludge dewatering", "Belt presses squeeze the digested solids"),
    ("Corrosion control", "Orthophosphate coats old lead joints"), ("Meter calibration", "Turbine meters drift at low velocity"),
    ("Tariff design", "Block rates reward frugal households"), ("Stormwater culverts", "Culvert sizing follows the design rainfall"),
    ("Sewer gradients", "Self-cleansing slope avoids grit deposits"), ("Aeration lagoons", "Blowers feed oxygen to the microbes"),
    ("Nutrient removal", "Denitrification strips nitrate in the anoxic zone"), ("Effluent standards", "Permits cap ammonia and phosphorus")], start=1)]
LONG_DECK = FILLER + [dict(s, pages=[14 + n]) for n, s in enumerate(SLIDES, start=1)]  # twenty slides; leak detection is the last


def test_a_clip_from_the_middle_of_a_recording_is_not_charged_for_starting_late_in_the_deck():
    """A lecture starts near the top of its deck; a chunk cut from its fiftieth minute does not. Unless the caller
    says otherwise, the deck-start cost applies only when the windows begin at the beginning of the recording."""
    clip = [{"start": 3000.0, "end": 3010.0, "text": SPEECH["s6"][1]}, {"start": 3010.0, "end": 3020.0, "text": CHATTER[0]}]
    result = run(clip, slides=LONG_DECK)
    assert summary(result) == [("s6", 3000.0, 3010.0)]
    assert result["initial"]["mode"] == "anywhere" and "3000" in result["initial"]["basis"]
    # What the start cost does when it is applied to such a clip — the reason it must not be the silent default here.
    charged = run(clip, slides=LONG_DECK, initial="deck_start")
    assert charged["occurrences"] == [] and charged["initial"] == {"mode": "deck_start", "basis": "given"}
    # The same words at the start of a recording, and windows without any time (a whole transcript), keep the prior.
    opening = [dict(w, start=w["start"] - 3000.0, end=w["end"] - 3000.0) for w in clip]
    assert run(opening, slides=LONG_DECK)["initial"]["mode"] == "deck_start"
    untimed = [{"lines": [n, n], "text": w["text"]} for n, w in enumerate(clip, start=1)]
    assert al.align_windows_to_slides(untimed, LONG_DECK)["initial"]["mode"] == "deck_start"
    assert al.align_windows_to_slides(untimed, LONG_DECK, initial="anywhere")["initial"] == {"mode": "anywhere", "basis": "given"}
    assert run([], slides=LONG_DECK)["initial"]["mode"] == "deck_start"
    with pytest.raises(ValueError):
        run(clip, slides=LONG_DECK, initial="somewhere")


def test_transition_costs_grow_with_distance_and_going_back_costs_more_than_moving_on():
    p = al.sequence_params()
    cost = lambda a, b: al.transition_cost(("A", a), ("A", b), p)  # noqa: E731
    assert cost(3, 3) == 0
    assert 0 < cost(3, 4) < cost(3, 5) < cost(3, 7)
    assert cost(3, 2) > cost(3, 4) and cost(9, 2) >= cost(3, 2)
    assert al.transition_cost(("A", 3), ("U", 3), p) > 0 and al.transition_cost(("U", 3), ("A", 3), p) > 0
    assert al.transition_cost(("A", 3), ("U", 2), p) == float("inf")  # UNASSIGNED remembers where the lecture was


def test_the_frozen_costs_have_their_stated_values_and_the_decoder_leaves_a_slide_for_three_empty_windows_not_two():
    p = al.sequence_params()
    cost = lambda a, b: al.transition_cost(("A", a), ("A", b), p)  # noqa: E731
    assert cost(3, 4) == pytest.approx(0.03) and cost(3, 7) == pytest.approx(0.03 + 3 * 0.02) and cost(3, 30) == pytest.approx(0.03 + 0.20)  # flat from eleven slides on
    assert cost(3, 2) == pytest.approx(0.12) and cost(9, 2) == pytest.approx(0.12 + 6 * 0.005) and cost(39, 2) == pytest.approx(0.12 + 0.10)  # flat from twenty-one slides back
    assert al.transition_cost(("A", 3), ("U", 3), p) == pytest.approx(0.08) and al.transition_cost(("U", 3), ("A", 3), p) == pytest.approx(0.08)
    assert al.transition_cost(("U", 3), ("A", 4), p) == pytest.approx(0.08 + 0.03)
    assert al.transition_cost(("U", -1), ("A", 4), p) == pytest.approx(4 * 0.02) and al.transition_cost(("U", -1), ("A", 4), p, initial="anywhere") == 0
    # Leaving and re-entering a slide costs 0.16; a window is worth 0.07 unassigned. So the decoder itself carries two
    # windows that say nothing for the slide and lets go of three: keeping the two out of an occurrence is the reporting
    # rule's job (tested above), not the decoder's.
    strong, empty = [0.0, 0.0, 0.6, 0.0], [0.0] * 4
    assert al.decode([strong, empty, empty, strong], [1.0] * 4, p)[0] == [2, 2, 2, 2]
    assert al.decode([strong, empty, empty, empty, strong], [1.0] * 5, p)[0] == [2, None, None, None, 2]


def test_the_background_correction_is_switched_off_and_would_only_act_on_twenty_windows_or_more():
    windows = windows_of("s2", "s3", "s4", "s5", "s6", "s2", "s3")  # 21 windows
    plain = al.score_candidates(windows, SLIDES)["components"]["lexical"]
    assert al.sequence_params()["background_factor"] == 0.0 and al.sequence_params()["full_shared_terms"] == 1  # both options are off
    assert plain == al.score_candidates(windows, SLIDES, params={"background_factor": 0.0})["components"]["lexical"]
    switched_on = al.score_candidates(windows, SLIDES, params={"background_factor": 1.0})["components"]["lexical"]
    assert switched_on != plain and all(a <= b for lowered, row in zip(switched_on, plain) for a, b in zip(lowered, row))
    few = windows[:19]
    assert al.score_candidates(few, SLIDES, params={"background_factor": 1.0})["components"]["lexical"] == al.score_candidates(few, SLIDES)["components"]["lexical"]


# ---- windows -----------------------------------------------------------------------------------------
def test_windows_from_lines_keep_line_numbers_and_skip_blank_and_speaker_label_lines():
    lines = ["[Speaker 1]", SPEECH["s2"][0], "", "[Speaker 2]", SPEECH["s2"][1], "", "Speaker 3:", SPEECH["s3"][0]]
    windows = al.windows_from_lines(lines)
    assert [(w["lines"], w["text"]) for w in windows] == [([2, 2], SPEECH["s2"][0]), ([5, 5], SPEECH["s2"][1]), ([8, 8], SPEECH["s3"][0])]
    assert all(w["start"] is None and w["end"] is None for w in windows)
    timed = al.windows_from_lines(lines, {"accepted": True, "lines": [{"line": 2, "status": "aligned", "span": {"start": 4.0, "end": 9.5}},
                                                                    {"line": 5, "status": "too_few_matches", "span": None}, {"line": 8, "status": "aligned", "span": {"start": 15.0, "end": 21.0}}]})
    assert [(w["lines"], w["start"], w["end"]) for w in timed] == [([2, 2], 4.0, 9.5), ([5, 5], None, None), ([8, 8], 15.0, 21.0)]
    assert [w["lines"] for w in al.windows_from_lines(lines, {"accepted": False, "lines": []})] == [[2, 2], [5, 5], [8, 8]]  # a rejected mapping gives no time to anything


def test_an_occurrence_built_from_partly_timed_lines_uses_only_times_that_exist():
    windows = [{"lines": [1, 1], "start": None, "end": None, "text": SPEECH["s2"][0]}, {"lines": [2, 2], "start": 12.0, "end": 19.0, "text": SPEECH["s2"][1]},
               {"lines": [3, 3], "start": None, "end": None, "text": SPEECH["s2"][2]}, {"lines": [4, 4], "start": None, "end": None, "text": SPEECH["s3"][0]},
               {"lines": [5, 5], "start": None, "end": None, "text": SPEECH["s3"][1]}]
    result = al.align_windows_to_slides(windows, SLIDES)
    assert [(o["slide_id"], o["start"], o["end"], o["lines"], o["timed_windows"]) for o in result["occurrences"]] == [("s2", 12.0, 19.0, [1, 3], 1), ("s3", None, None, [4, 5], 0)]


def test_windows_from_segments_merge_short_segments_but_never_across_a_long_silence():
    segments = [{"start_seconds": 0.0, "end_seconds": 2.0, "text": " Okay."}, {"start_seconds": 2.2, "end_seconds": 7.0, "text": SPEECH["s2"][0]},
                {"start_seconds": 7.1, "end_seconds": 12.0, "text": SPEECH["s2"][1]}, {"start_seconds": 60.0, "end_seconds": 61.0, "text": " Right."},
                {"start_seconds": 61.2, "end_seconds": 66.0, "text": SPEECH["s3"][0]}]
    windows = al.windows_from_segments(segments, min_tokens=8, max_seconds=30.0, max_gap_seconds=5.0)
    assert [(w["start"], w["end"]) for w in windows] == [(0.0, 7.0), (7.1, 12.0), (60.0, 66.0)]
    assert windows[0]["text"].startswith("Okay.") and "segments" in windows[0] and windows[0]["segments"] == [0, 1]
    shifted = al.windows_from_segments(segments, min_tokens=8, max_seconds=30.0, max_gap_seconds=5.0, offset_seconds=100.0)
    assert (shifted[0]["start"], shifted[-1]["end"]) == (100.0, 166.0)


# ---- validated text alignment ------------------------------------------------------------------------
TRANSCRIPT = [line for key in ("s2", "s3", "s4", "s5", "s6") for line in SPEECH[key]]  # 15 lines
_NOISE = ["basically", "right", "okay", "something", "actually", "kind", "thing", "well"]


def speak(lines, *, start=100.0, noise=0.0, seed=7, replace=None):
    """Generated words for these (line_number, text) pairs: 0.3 s a word, half a second between lines.

    ``noise`` drops, swaps and inserts words the way a recogniser would. ``replace`` maps a line number to the words
    "heard" instead. Returns the words and, per line number, the true (start, end) of that line in the audio.
    """
    rng = random.Random(seed)
    words, truth, t = [], {}, start
    for number, text in lines:
        spoken = (replace or {}).get(number)
        begin = t
        for raw in (spoken.split() if spoken is not None else text.split()):
            roll = rng.random()
            if spoken is None and roll < noise * 0.4:
                t += 0.3  # the word was said, the recogniser missed it
                continue
            heard = rng.choice(_NOISE) if spoken is None and roll < noise * 0.8 else raw
            words.append({"text": " " + heard, "start": round(t, 2), "end": round(t + 0.28, 2)})
            t += 0.3
            if spoken is None and roll > 1 - noise * 0.2:
                words.append({"text": " " + rng.choice(_NOISE), "start": round(t, 2), "end": round(t + 0.28, 2)})
                t += 0.3
        truth[number] = (begin, t)
        t += 0.5
    return words, truth


def numbered(lines, first=1):
    return list(enumerate(lines, start=first))


def test_text_alignment_accepts_a_noisy_recognition_of_the_same_text_and_times_stay_true():
    words, truth = speak(numbered(TRANSCRIPT), noise=0.25)
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is True and result["reason"] is None and result["method"] == al.TEXT_METHOD
    assert 0.5 <= result["match_ratio"] < 1.0
    aligned = [row for row in result["lines"] if row["status"] == "aligned"]
    assert len(aligned) >= 13 and result["counts"]["aligned"] == len(aligned)
    for row in aligned:
        begin, end = truth[row["line"]]
        assert row["span"]["start"] >= begin - 0.01 and row["span"]["end"] <= end + 0.01  # never wider than the line really was
        assert row["span"]["start"] - begin <= 1.5 and end - row["span"]["end"] <= 2.0
        assert 0 < row["matched"] <= row["total"] and 0 < row["confidence"] <= 1
    spans = [row["span"] for row in aligned]
    assert all(a["end"] <= b["start"] for a, b in itertools.pairwise(spans))  # monotone, no overlap
    assert result["quality"] == {"acoustic": "generated_unreviewed", "text_alignment": "token_match_validated"}


def test_text_alignment_of_identical_text_times_every_line():
    words, truth = speak(numbered(TRANSCRIPT))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] and result["match_ratio"] == 1.0 and result["counts"] == {"aligned": 15, "too_few_matches": 0, "outside_generated_window": 0, "empty": 0}
    for row in result["lines"]:
        assert (row["span"]["start"], row["matched"], row["unmatched_head"], row["unmatched_tail"]) == (pytest.approx(truth[row["line"]][0], abs=0.01), row["total"], 0, 0)
    assert result["coverage"]["lines"] == 1.0 and result["coverage"]["generated_tokens"] == 1.0


def test_text_alignment_rejects_unrelated_text_and_gives_no_times():
    other = ["Fold the egg whites into the batter slowly so the sponge keeps its air.", "Bake the sponge for twenty minutes and let it cool on a rack before icing.",
             "Whip the cream with a spoon of sugar until it holds soft peaks.", "Slice the strawberries and layer them between the sponge and the cream."]
    words, _ = speak(numbered(other))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is False and result["reason_code"] in {"no_ordered_match", "low_match_ratio", "low_generated_coverage"} and result["reason"]
    assert all(row["span"] is None and row["status"] != "aligned" and row.get("bracket") is None for row in result["lines"])
    assert result["counts"]["aligned"] == 0 and result["quality"]["text_alignment"] == "rejected"
    assert al.windows_from_lines(TRANSCRIPT, result)[0]["start"] is None


def test_text_alignment_rejects_a_heavy_paraphrase_that_shares_the_vocabulary_but_not_the_wording():
    reworded = [" ".join(sorted(line.replace(",", "").replace(":", "").replace(".", "").split(), key=str.lower)) for line in TRANSCRIPT]
    words, _ = speak(numbered(reworded))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is False and result["counts"]["aligned"] == 0


# The same nine sentences said in other words, twice: once keeping only scattered phrases, once keeping most of them.
HEAVY_PARAPHRASE = [
    "Because rivers swell after the rains, engineers build a reservoir whose dams keep that seasonal runoff for later.",
    "Summer empties much of the storage; spring brings it back, as drawdown curves of any reservoir will show.",
    "In the end the storage capacity behind the dams limits the runoff that can be kept.",
    "Then the stream meets filtration, and sand beds take the suspended particles out of it.",
    "A clogged filter media is cleared by backwashing, which restores the sand beds from below.",
    "The particles wait in the filter for the backwashing cycle to remove them.",
    "Disinfection means picking a chlorine dose and allowing sufficient contact time.",
    "Without adding chlorine, ultraviolet lamps can also inactivate the pathogens.",
    "If the chlorine dose is low or the contact time short, some pathogens survive."]
LIGHT_REWORDING = [
    "Seasonal runoff is held by the dams, and that storage is what a reservoir gives us in dry months.",
    "Every summer the storage capacity falls, the reservoir refills in spring: see the drawdown curves.",
    "How much runoff we keep is decided by the storage capacity of the dams.",
    "Next comes filtration, where suspended particles are removed as the stream passes sand beds.",
    "Backwashing pushes upward to restore the sand beds whenever the filter media clogs.",
    "Until the backwashing cycle carries them away, the particles stay in the filter.",
    "A chlorine dose with enough contact time is what we choose for disinfection.",
    "The alternative is ultraviolet lamps, which inactivate pathogens and add no chlorine.",
    "Too short a contact time or too low a chlorine dose lets pathogens survive."]


def test_a_reworded_paraphrase_with_a_few_shared_phrases_is_refused_by_the_coverage_threshold():
    """Unlike the shuffled words above, this one does share runs of words with the transcript, so anchors exist and
    the refusal is the acceptance threshold's doing: without it the mapping would be accepted and lines timed."""
    words, _ = speak(numbered(HEAVY_PARAPHRASE))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is False and result["reason_code"] == "low_generated_coverage"
    assert result["generated"]["matched_tokens"] > 0 and result["coverage"]["generated_tokens"] < al.text_params()["min_generated_coverage"]
    assert result["counts"]["aligned"] == 0 and all(row["span"] is None for row in result["lines"])
    without = al.align_text(words, TRANSCRIPT, params={"min_generated_coverage": 0})
    assert without["accepted"] is True and without["counts"]["aligned"] >= 1  # what the threshold is there to stop


def test_a_light_rewording_is_accepted_at_the_margin_and_every_time_it_gives_lies_inside_the_spoken_sentence():
    """Where the line is drawn: sentence by sentence in the same order with most phrases kept. Few lines are timed —
    only those with half their words in order — and none of those times leaves the sentence that was really spoken."""
    words, truth = speak(numbered(LIGHT_REWORDING))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is True and 0.5 <= result["match_ratio"] < 0.6 and 0.5 <= result["coverage"]["generated_tokens"] < 0.7
    aligned = [row for row in result["lines"] if row["status"] == "aligned"]
    assert 1 <= len(aligned) <= 5
    for row in aligned:
        begin, end = truth[row["line"]]
        assert begin - 0.01 <= row["span"]["start"] < row["span"]["end"] <= end + 0.01
        assert row["matched"] * 2 >= row["total"]


def test_a_different_talk_that_shares_stock_sentences_is_refused_by_the_match_ratio():
    stock = ["Right, any more questions before we carry on with this part?", "Okay, let us take a short break and continue in ten minutes from now.",
             "Please remember that the assignment is due on Thursday at noon sharp."]
    cake = ["Fold the egg whites into the batter slowly so the sponge keeps its air.", "Bake the sponge for twenty minutes and let it cool on a rack before icing.",
            "Whip the cream with a spoon of sugar until it holds soft peaks.", "Slice the strawberries and layer them between the sponge and the cream.",
            "Dust the top with icing sugar just before serving so it does not dissolve.", "Keep the finished cake in the fridge and eat it within two days."]
    transcript = [TRANSCRIPT[0], stock[0], TRANSCRIPT[1], TRANSCRIPT[2], stock[1], TRANSCRIPT[3], TRANSCRIPT[4], stock[2], TRANSCRIPT[5]]
    words, _ = speak(numbered([cake[0], stock[0], cake[1], cake[2], stock[1], cake[3], cake[4], stock[2], cake[5]]))
    result = al.align_text(words, transcript)
    assert result["accepted"] is False and result["reason_code"] == "low_match_ratio" and result["match_ratio"] < al.text_params()["min_match_ratio"]
    assert result["counts"]["aligned"] == 0 and all(row["span"] is None for row in result["lines"])
    # Only the three stock sentences are matched: the words between them ("the", "and", "it" occur in both talks) are
    # not picked up one by one, because a gap is filled only when the fill explains a fair share of it.
    stock_tokens = sum(len(al.norm_tokens(sentence)) for sentence in stock)
    assert result["generated"]["matched_tokens"] == stock_tokens
    assert al.align_text(words, transcript, params={"min_gap_fill_fraction": 0})["generated"]["matched_tokens"] > stock_tokens
    # Without the ratio threshold the mapping is accepted and three lines of another lecture's transcript receive times.
    without = al.align_text(words, transcript, params={"min_match_ratio": 0})
    assert without["accepted"] is True and [row["line"] for row in without["lines"] if row["status"] == "aligned"] == [2, 5, 8]


def test_a_line_whose_words_are_found_spread_over_three_times_its_length_gets_no_span():
    aside = ("by the way the vending machine on the second floor has been broken since Monday and nobody from facilities has come to look at it yet "
             "which is a pity")
    line = TRANSCRIPT[6].split()
    interrupted = " ".join(line[:len(line) // 2]) + " " + aside + " " + " ".join(line[len(line) // 2:])
    words, _ = speak(numbered(TRANSCRIPT[4:9], first=5), replace={7: interrupted})
    result = al.align_text(words, TRANSCRIPT)
    rows = {row["line"]: row for row in result["lines"]}
    assert result["accepted"] and rows[6]["status"] == rows[8]["status"] == "aligned"
    assert (rows[7]["status"], rows[7]["span"], rows[7]["matched"]) == ("too_few_matches", None, rows[7]["total"])  # every word found, but not as one line
    loose = al.align_text(words, TRANSCRIPT, params={"max_line_stretch": 1e9})["lines"][6]
    assert loose["status"] == "aligned" and loose["span"]["end"] - loose["span"]["start"] > 12.0  # the span the rule refuses: thirteen words over twelve seconds


def test_three_matching_words_without_matching_neighbours_do_not_give_a_line_a_time():
    """"Carry on then" is recognised at the head of a chunk and happens to be most of a short transcript line two lines
    earlier — close enough to have been spoken, so only the lack of company around it tells it from a real match."""
    transcript = TRANSCRIPT[:6] + ["Carry on then, everyone."] + TRANSCRIPT[6:]  # the short line is line 7
    words, _ = speak([(0, "carry on then")] + numbered(transcript[8:12], first=9), start=700.0)
    result = al.align_text(words, transcript)
    rows = {row["line"]: row for row in result["lines"]}
    assert result["accepted"] and [rows[n]["status"] for n in range(9, 13)] == ["aligned"] * 4
    assert (rows[7]["status"], rows[7]["span"], rows[7]["matched"]) == ("outside_generated_window", None, 0)
    assert result["transcript"]["first_line"] == 9
    lonely = al.align_text(words, transcript, params={"support_min_neighbours": 0})["lines"][6]
    assert lonely["status"] == "aligned" and lonely["span"]["start"] == 700.0  # the wrong time the rule prevents
    assert al.align_text(words, transcript, params={"max_tokens_per_second": 1e9})["lines"][6]["span"] is None  # not the speech-rate rule's doing


def _misheard(first, last):
    """Lines ``first..last`` with every third word (counted across the lines) recognised as something else: two words
    in three still match in order, and no run of three does, so nothing anchors the stretch from inside."""
    heard, k = {}, 0
    for number in range(first, last + 1):
        out = []
        for word in TRANSCRIPT[number - 1].split():
            out.append("blip" if k % 3 == 1 else word)
            k += 1
        heard[number] = " ".join(out)
    return heard


def test_exact_fill_between_anchors_is_bounded_in_length_and_in_proportion():
    # In length: up to eighty tokens without an anchor are filled exactly; a longer stretch is left without times.
    words, _ = speak(numbered(TRANSCRIPT), replace=_misheard(4, 8))
    rows = {row["line"]: row for row in al.align_text(words, TRANSCRIPT)["lines"]}
    assert sum(rows[n]["total"] for n in range(4, 9)) <= al.text_params()["max_gap_tokens"]
    assert all(rows[n]["status"] == "aligned" and rows[n]["matched"] < rows[n]["total"] for n in range(4, 9))
    words, _ = speak(numbered(TRANSCRIPT), replace=_misheard(4, 10))
    result = al.align_text(words, TRANSCRIPT)
    rows = {row["line"]: row for row in result["lines"]}
    assert sum(rows[n]["total"] for n in range(4, 11)) > al.text_params()["max_gap_tokens"]
    assert result["accepted"] and [(rows[n]["status"], rows[n]["matched"], rows[n]["span"], rows[n]["window_basis"]) for n in range(5, 10)] == [("too_few_matches", 0, None, "between_matched_tokens")] * 5
    assert rows[3]["status"] == rows[11]["status"] == "aligned"
    unbounded = {row["line"]: row for row in al.align_text(words, TRANSCRIPT, params={"max_gap_tokens": 10 ** 9})["lines"]}
    assert all(unbounded[n]["status"] == "aligned" for n in range(4, 11))
    # In proportion: a transcript line that was never spoken is not matched word by word against the two words
    # recognised in its place, although both occur in it in that order.
    unspoken = "The pressure and the flow in a pump curve meet where the system curve crosses it."
    transcript = TRANSCRIPT[:3] + [unspoken] + TRANSCRIPT[3:6]
    words, _ = speak(numbered(transcript[:3]) + [(0, "pump meet")] + numbered(transcript[4:7], first=5))
    row = al.align_text(words, transcript)["lines"][3]
    assert (row["status"], row["matched"], row["span"], row["window_basis"]) == ("too_few_matches", 0, None, "between_matched_tokens")
    assert al.align_text(words, transcript, params={"max_gap_ratio": 1e9})["lines"][3]["matched"] == 2


def test_text_alignment_rejects_a_shared_opening_sentence_followed_by_a_different_lecture():
    other = [TRANSCRIPT[0], "Fold the egg whites into the batter slowly so the sponge keeps its air.", "Bake the sponge for twenty minutes and let it cool on a rack before icing.",
             "Whip the cream with a spoon of sugar until it holds soft peaks.", "Slice the strawberries and layer them between the sponge and the cream.",
             "Dust the top with icing sugar just before serving so it does not dissolve."]
    words, _ = speak(numbered(other))
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is False and result["reason_code"] == "low_generated_coverage" and result["counts"]["aligned"] == 0


def test_no_time_is_transferred_to_a_line_outside_the_generated_window():
    words, truth = speak(numbered(TRANSCRIPT[4:8], first=5), start=600.0)
    result = al.align_text(words, TRANSCRIPT)
    assert result["accepted"] is True
    status = {row["line"]: row["status"] for row in result["lines"]}
    assert [status[n] for n in range(5, 9)] == ["aligned"] * 4
    assert all(status[n] == "outside_generated_window" for n in [1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15])
    window = result["generated"]["window"]
    assert (window["start"], window["end"]) == (words[0]["start"], words[-1]["end"])
    for row in result["lines"]:
        if row["status"] == "aligned":
            assert window["start"] <= row["span"]["start"] < row["span"]["end"] <= window["end"]
            assert row["span"]["start"] == pytest.approx(truth[row["line"]][0], abs=0.01)
        else:
            assert row["span"] is None and row.get("bracket") is None
    assert (result["transcript"]["first_line"], result["transcript"]["last_line"]) == (5, 8)


def test_a_line_the_recogniser_missed_gets_no_span_and_times_are_not_interpolated_over_it():
    garbled = {6: "purple monkey dishwasher lantern velvet octopus trombone gravel umbrella cactus marble pigeon"}
    words, truth = speak(numbered(TRANSCRIPT[2:9], first=3), replace=garbled)
    result = al.align_text(words, TRANSCRIPT)
    rows = {row["line"]: row for row in result["lines"]}
    assert result["accepted"] and rows[6]["status"] == "too_few_matches" and rows[6]["span"] is None
    assert rows[6]["bracket"] is None  # several seconds lie between its neighbours: nothing is interpolated
    assert rows[5]["status"] == rows[7]["status"] == "aligned"
    assert rows[5]["span"]["end"] <= truth[5][1] + 0.01 and rows[7]["span"]["start"] >= truth[7][0] - 0.01  # the neighbours do not grow into the gap


def test_a_short_unmatched_line_between_aligned_neighbours_gets_a_bracket_only_within_the_stated_gap():
    transcript = TRANSCRIPT[:3] + ["Okay, moving on."] + TRANSCRIPT[3:6]
    words, truth = speak(numbered(transcript), replace={4: "came booting gone"})
    result = al.align_text(words, transcript)
    row = result["lines"][3]
    assert row["status"] == "too_few_matches" and row["span"] is None
    assert row["bracket"]["basis"] == "between_aligned_neighbours"
    assert row["bracket"]["start"] == result["lines"][2]["span"]["end"] and row["bracket"]["end"] == result["lines"][4]["span"]["start"]
    assert row["bracket"]["end"] - row["bracket"]["start"] <= al.text_params()["max_bridge_seconds"]
    assert truth[4][0] >= row["bracket"]["start"] - 0.01 and truth[4][1] <= row["bracket"]["end"] + 0.51


def test_a_repeated_sentence_is_timed_where_it_was_said_not_where_it_first_appears():
    refrain = "Remember that clean drinking supply is the purpose of every single step."
    transcript = TRANSCRIPT[:2] + [refrain] + TRANSCRIPT[2:8] + [refrain] + TRANSCRIPT[8:11]  # lines 3 and 10 are the same sentence
    words, truth = speak(numbered(transcript[8:12], first=9), start=900.0)
    result = al.align_text(words, transcript)
    rows = {row["line"]: row for row in result["lines"]}
    assert result["accepted"] and rows[10]["status"] == "aligned" and rows[10]["span"]["start"] == pytest.approx(truth[10][0], abs=0.01)
    assert rows[3]["status"] == "outside_generated_window" and rows[3]["span"] is None


def test_a_phrase_that_also_occurs_far_away_in_the_transcript_gets_no_time_there():
    """The recognised chunk opens with a stock phrase whose only written counterpart is a short line much earlier in the
    transcript. Nobody can speak the lines in between in no time, so that line is outside the chunk, however well it matches."""
    stock = "Right, any more questions before we carry on with this?"
    transcript = TRANSCRIPT[:1] + [stock] + TRANSCRIPT[1:]  # the stock phrase is line 2
    said = [(0, stock)] + numbered(transcript[9:13], first=10)
    words, truth = speak(said, start=1200.0)
    result = al.align_text(words, transcript)
    rows = {row["line"]: row for row in result["lines"]}
    assert result["accepted"] and [rows[n]["status"] for n in range(10, 14)] == ["aligned"] * 4
    assert rows[2]["status"] == "outside_generated_window" and rows[2]["span"] is None
    assert all(rows[n]["span"] is None for n in range(1, 10))
    assert (result["transcript"]["first_line"], result["transcript"]["last_line"]) == (10, 13)
    # The ten recognised words that matched nothing sit right before line 10. Whether they were line 9 cannot be known:
    # that line is reported as unmatched next to recognised speech (an estimate, named as one), the lines before it as outside.
    assert (rows[9]["status"], rows[9]["window_basis"]) == ("too_few_matches", "unmatched_speech_at_edge")
    assert all(rows[n]["status"] == "outside_generated_window" for n in range(1, 9))
    # The same holds after the chunk: a stock phrase recognised at its end is not sent to a line near the end of the transcript.
    transcript = TRANSCRIPT[:14] + [stock] + TRANSCRIPT[14:]  # now line 15
    words, _ = speak(numbered(transcript[2:6], first=3) + [(0, stock)], start=300.0)
    late = {row["line"]: row for row in al.align_text(words, transcript)["lines"]}
    assert [late[n]["status"] for n in range(3, 7)] == ["aligned"] * 4 and late[15]["status"] == "outside_generated_window" and late[15]["span"] is None


def test_text_alignment_respects_gaps_in_what_was_transcribed():
    first, truth_a = speak(numbered(TRANSCRIPT[0:3], first=1), start=0.0)
    second, truth_b = speak(numbered(TRANSCRIPT[9:12], first=10), start=300.0)
    covered = [(0.0, first[-1]["end"]), (300.0, second[-1]["end"])]
    result = al.align_text(first + second, TRANSCRIPT, covered=covered)
    status = [row["status"] for row in result["lines"]]
    assert result["accepted"] and status[:3] == ["aligned"] * 3 and status[9:12] == ["aligned"] * 3
    assert status[3:9] == ["outside_generated_window"] * 6 and status[12:] == ["outside_generated_window"] * 3  # spoken while nothing was transcribed
    assert all(row["span"] is None and row["bracket"] is None for row in result["lines"][3:9])
    assert result["generated"]["covered_basis"] == "given" and len(result["generated"]["stretches"]) == 2
    assert [(s["first_line"], s["last_line"], s["unmatched_head_tokens"], s["unmatched_tail_tokens"]) for s in result["generated"]["stretches"]] == [(1, 3, 0, 0), (10, 12, 0, 0)]


def test_without_a_stated_coverage_a_long_silence_between_words_is_not_taken_as_processed_audio():
    first, _ = speak(numbered(TRANSCRIPT[0:3], first=1), start=0.0)
    second, _ = speak(numbered(TRANSCRIPT[9:12], first=10), start=300.0)
    result = al.align_text(first + second, TRANSCRIPT)
    status = [row["status"] for row in result["lines"]]
    assert result["accepted"] and status[:3] == ["aligned"] * 3 and status[9:12] == ["aligned"] * 3
    assert status[3:9] == ["outside_generated_window"] * 6  # nothing says the five minutes in between were ever processed
    generated = result["generated"]
    assert generated["covered_basis"] == "word_extent" and generated["covered"] == [[0.0, first[-1]["end"]], [300.0, second[-1]["end"]]]
    assert first[-1]["end"] < 30.0 and generated["window"] == {"start": 0.0, "end": second[-1]["end"]}
    # When the caller states that the whole stretch was processed, the same lines are "not matched", not "not processed".
    given = al.align_text(first + second, TRANSCRIPT, covered=[(0.0, 400.0)])
    assert given["generated"]["covered_basis"] == "given" and given["generated"]["covered"] == [[0.0, 400.0]]
    assert [(row["status"], row["window_basis"]) for row in given["lines"][3:9]] == [("too_few_matches", "between_matched_tokens")] * 6
    assert all(row["span"] is None for row in given["lines"][3:9])
    assert al.text_params()["max_silence_seconds"] == 30.0


def test_a_garbled_line_at_the_edge_of_the_processed_audio_is_unmatched_not_unprocessed():
    garbled = {5: "purple monkey dishwasher lantern velvet octopus trombone gravel umbrella cactus marble pigeon",
               9: "walrus teapot corduroy meteor pickle harmonica gazebo parsnip lighthouse biscuit origami tundra"}
    words, _ = speak(numbered(TRANSCRIPT[4:9], first=5), start=600.0, replace=garbled)
    for covered in ([(600.0, words[-1]["end"])], None):
        result = al.align_text(words, TRANSCRIPT, covered=covered)
        rows = {row["line"]: row for row in result["lines"]}
        assert result["accepted"] and [(rows[n]["status"], rows[n]["window_basis"]) for n in (6, 7, 8)] == [("aligned", "matched_tokens")] * 3
        # Their audio was processed: words were recognised there, they just are not these lines. No time is given.
        assert [(rows[n]["status"], rows[n]["span"], rows[n]["bracket"], rows[n]["window_basis"]) for n in (5, 9)] == [("too_few_matches", None, None, "unmatched_speech_at_edge")] * 2
        # The lines beyond them have no recognised speech left to account for them.
        assert all(rows[n]["status"] == "outside_generated_window" and rows[n]["window_basis"] is None for n in (1, 2, 3, 4, 10, 11, 12, 13, 14, 15))
        stretch = result["generated"]["stretches"][0]
        assert (stretch["unmatched_head_tokens"], stretch["unmatched_tail_tokens"], stretch["first_line"], stretch["last_line"]) == (12, 12, 6, 8)
        assert result["counts"] == {"aligned": 3, "too_few_matches": 2, "outside_generated_window": 10, "empty": 0}
    # Two unmatched words next to the first line do not account for a whole line.
    words, _ = speak([(0, "hello everyone")] + numbered(TRANSCRIPT[5:9], first=6), start=600.0)
    rows = {row["line"]: row for row in al.align_text(words, TRANSCRIPT)["lines"]}
    assert rows[5]["status"] == "outside_generated_window" and rows[6]["status"] == "aligned"


def test_words_outside_the_stated_processed_audio_are_not_used():
    words, _ = speak(numbered(TRANSCRIPT[:6]), start=100.0)
    result = al.align_text(words, TRANSCRIPT, covered=[(0.0, 5.0)])
    assert result["accepted"] is False and result["reason_code"] == "too_few_generated_tokens"
    assert result["generated"]["words_outside_covered"] == len(words) and result["generated"]["words"] == 0
    assert result["counts"]["aligned"] == 0 and all(row["span"] is None for row in result["lines"])
    # A stray word far past the processed stretch is dropped and counted; the rest is used and nothing is timed out there.
    end = words[-1]["end"]
    stray = words + [{"text": " leftover", "start": end + 50.0, "end": end + 50.3}]
    result = al.align_text(stray, TRANSCRIPT, covered=[(100.0, end)])
    assert result["accepted"] and result["generated"]["words_outside_covered"] == 1 and result["counts"]["aligned"] == 6
    assert result["generated"]["window"] == {"start": words[0]["start"], "end": end}
    assert al.align_text(words, TRANSCRIPT)["generated"]["words_outside_covered"] == 0


def test_touching_processed_chunks_are_one_stretch_and_a_line_across_their_seam_is_timed():
    words, truth = speak(numbered(TRANSCRIPT[:6]), start=0.0)
    seam = round((truth[3][0] + truth[3][1]) / 2, 2)  # in the middle of line 3
    end = words[-1]["end"]
    result = al.align_text(words, TRANSCRIPT, covered=[(seam, end), (0.0, seam)])
    assert result["generated"]["covered"] == [[0.0, end]]
    row = result["lines"][2]
    assert row["status"] == "aligned" and row["span"]["start"] < seam < row["span"]["end"]
    # A real hole between two chunks is kept, and the line cut by it gets no span across the hole.
    apart = al.align_text(words, TRANSCRIPT, covered=[(0.0, seam), (seam + 1.0, end)])
    assert len(apart["generated"]["covered"]) == 2 and apart["generated"]["words_outside_covered"] >= 1
    cut = apart["lines"][2]
    assert cut["span"] is None or not (cut["span"]["start"] < seam < cut["span"]["end"])


def test_text_alignment_handles_speaker_labels_blank_lines_and_too_little_input():
    transcript = ["[Speaker 1]", TRANSCRIPT[0], "", "[Speaker 2]", TRANSCRIPT[1], "", "[Speaker 1]", TRANSCRIPT[2]]
    words, _ = speak([(2, TRANSCRIPT[0]), (5, TRANSCRIPT[1]), (8, TRANSCRIPT[2])])
    result = al.align_text(words, transcript)
    assert [row["status"] for row in result["lines"]] == ["empty", "aligned", "empty", "empty", "aligned", "empty", "empty", "aligned"]
    few = al.align_text(words[:4], transcript)
    assert few["accepted"] is False and few["reason_code"] == "too_few_generated_tokens"
    assert al.align_text([], transcript)["accepted"] is False and al.align_text(words, [])["accepted"] is False


def test_words_from_timing_reads_the_producer_shape_and_applies_the_clip_offset():
    timing = {"clip_offset_seconds": 100.0, "actual_duration_seconds": 30.0, "status": "GENERATED_UNREVIEWED",
              "segments": [{"segment_id": "s1", "start_seconds": 1.0, "end_seconds": 2.0, "text": " Hello there",
                            "words": [{"word_id": "w1", "text": " Hello", "start_seconds": 1.0, "end_seconds": 1.4, "probability": 0.9},
                                      {"word_id": "w2", "text": " there", "start_seconds": 1.5, "end_seconds": 2.0, "probability": 0.5}]}]}
    words = al.words_from_timing(timing)
    assert words == [{"word_id": "w1", "text": " Hello", "start": 101.0, "end": 101.4, "probability": 0.9}, {"word_id": "w2", "text": " there", "start": 101.5, "end": 102.0, "probability": 0.5}]
    assert al.covered_from_timing(timing) == [(100.0, 130.0)]


# ---- baseline and benchmark --------------------------------------------------------------------------
def test_the_baseline_wrapper_runs_the_existing_lexical_matcher_on_the_same_windows():
    windows = windows_of("s2", "s3", "s4")
    wrapped = al.baseline_assignments(windows, SLIDES)
    direct = align_lines_to_slides([s["text"] for s in SLIDES], [w["text"] for w in windows])
    expected = [None] * len(windows)
    for segment in direct:
        for line in range(segment["start_line"], segment["end_line"] + 1):
            expected[line - 1] = SLIDES[segment["page"] - 1]["slide_id"]
    assert wrapped["assignments"] == expected and wrapped["segments"] == direct and wrapped["method"] == al.BASELINE_METHOD


def test_unrelated_talk_next_to_a_slide_is_left_unassigned_where_the_existing_matcher_absorbs_it():
    """Characterisation of the difference that matters to the product rule "never merged into a neighbour to look
    complete". The existing matcher segments every line onto some slide and keeps a segment whose average clears its
    threshold, so unrelated sentences beside a slide's sentences ride along. If that matcher changes, update its half."""
    windows = windows_of("s2", CHATTER[:4], "s3")
    assert al.align_windows_to_slides(windows, SLIDES)["assignments"] == ["s2"] * 3 + [None] * 4 + ["s3"] * 3
    absorbed = al.baseline_assignments(windows, SLIDES)["assignments"][3:7]
    assert all(a in {"s2", "s3"} for a in absorbed)


def test_cross_check_reports_how_far_the_existing_matcher_supports_each_occurrence_without_deciding_anything():
    windows = windows_of("s2", CHATTER[:4], "s3", RESERVOIR_RETURN)
    result = al.align_windows_to_slides(windows, SLIDES, acoustic="generated_unreviewed")
    checked = al.cross_check_with_baseline(result, windows, SLIDES)
    assert [o["slide_id"] for o in checked["occurrences"]] == [o["slide_id"] for o in result["occurrences"]] == ["s2", "s3", "s2"]
    for before, after in zip(result["occurrences"], checked["occurrences"]):
        assert {k: v for k, v in after.items() if k != "support"} == {k: v for k, v in before.items() if k != "support"}  # nothing else is touched
        assert after["support"]["baseline"]["method"] == al.BASELINE_METHOD
        assert 0 <= after["support"]["baseline"]["same_slide"] <= 1 and 0 <= after["support"]["baseline"]["other_slide"] <= 1
    assert checked["occurrences"][0]["support"]["baseline"] == {"method": al.BASELINE_METHOD, "same_slide": 1.0, "other_slide": 0.0, "unassigned": 0.0}
    assert "baseline" not in result["occurrences"][0]["support"]  # the input is not modified
    summary_row = checked["baseline_cross_check"]
    assert summary_row["windows_assigned_by_both_to_the_same_slide"] + summary_row["windows_assigned_by_both_to_different_slides"] + summary_row["windows_assigned_by_sequence_only"] == result["summary"]["assigned"]
    assert summary_row["windows_assigned_by_baseline_only"] == 4  # the chatter the existing matcher absorbed
    assert checked["assignments"] == result["assignments"] and checked["unassigned"] == result["unassigned"]


def test_benchmark_scores_both_methods_on_identical_inputs_against_labelled_spans():
    windows = windows_of("s2", "s3", "s4", RESERVOIR_RETURN, CHATTER[:4], "s5")
    labels = [{"slide_ids": ["s2"], "windows": [[0, 2]]}, {"slide_ids": ["s3"], "windows": [[3, 5]]}, {"slide_ids": ["s4"], "windows": [[6, 8]]},
              {"slide_ids": ["s2"], "windows": [[9, 10]], "kind": "revisit"}, {"slide_ids": [], "windows": [[11, 14]], "kind": "unrelated"}, {"slide_ids": ["s5"], "windows": [[15, 17]]}]
    report = al.benchmark(windows, SLIDES, labels)
    assert set(report["methods"]) == {"sequence", "lexical_baseline"}
    assert report["inputs"] == {"windows": 18, "slides": 6, "labels": 6, "labelled_windows": 14, "unrelated_windows": 4, "revisit_labels": 1, "hints_given": 0, "vocabulary_given": False}
    seq, base = report["methods"]["sequence"], report["methods"]["lexical_baseline"]
    for method in (seq, base):
        assert set(method) >= {"window_agreement", "precision_when_assigned", "abstention_on_labelled", "boundary_error", "revisit_recall", "false_assignment_on_unrelated", "abstention"}
        assert method["window_agreement"]["n"] == 14 and method["false_assignment_on_unrelated"]["n"] == 4 and method["revisit_recall"]["n"] == 1
    assert seq["window_agreement"] == {"n": 14, "agree": 14, "other_slide": 0, "abstained": 0, "rate": 1.0}
    assert seq["revisit_recall"] == {"n": 1, "found": 1, "rate": 1.0}
    assert seq["false_assignment_on_unrelated"] == {"n": 4, "assigned": 0, "rate": 0.0}
    assert seq["boundary_error"]["mean_start"] == 0.0 and seq["boundary_error"]["mean_end"] == 0.0 and seq["boundary_error"]["missed"] == 0
    assert seq["abstention"] == {"n": 18, "unassigned": 4, "rate": round(4 / 18, 4)}
    assert report["assignments"]["sequence"][9:11] == ["s2", "s2"] and len(report["assignments"]["lexical_baseline"]) == 18


def test_benchmark_labels_may_name_several_slides_and_be_given_as_line_ranges():
    lines = [w["text"] for w in windows_of("s2", "s3", "s4")]
    windows = al.windows_from_lines(lines)
    labels = [{"slide_ids": ["s2", "s3"], "lines": [[1, 6]]}, {"slide_ids": ["s6"], "lines": [[7, 9]]}]  # the second label is wrong on purpose
    seq = al.benchmark(windows, SLIDES, labels)["methods"]["sequence"]
    assert seq["window_agreement"] == {"n": 9, "agree": 6, "other_slide": 3, "abstained": 0, "rate": round(6 / 9, 4)}
    assert seq["precision_when_assigned"] == {"n": 9, "agree": 6, "rate": round(6 / 9, 4)}
    assert seq["boundary_error"]["missed"] == 1
