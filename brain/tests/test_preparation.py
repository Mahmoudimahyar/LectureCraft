"""LL014 / LL015: updater receipt handoff and the bounded all-lecture preparation/alignment pipeline."""
from __future__ import annotations

import hashlib
import sys
import textwrap
from pathlib import Path

import pytest

from lecture_brain.annotations import AnnotationStore
from lecture_brain.fixtures import content
from lecture_brain.journal import Journal
from lecture_brain.ownerio.inventory import build_inventory
from lecture_brain.preparation import Preparation, align_lines_to_slides, parse_cues
from lecture_brain.updater import consume_receipts, latest_verified_receipt

NOW = "2026-10-04T12:00:00Z"


@pytest.fixture()
def prep(settings):
    return Preparation(settings, converter=None, now=lambda: NOW)


@pytest.fixture()
def journal(settings, clock):
    j = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    yield j
    j.close()


def _lecture(settings, course, lecture_id):
    return next(l for l in build_inventory(settings.course(course))["lectures"] if l["lecture_id"] == lecture_id)


# ---- matcher --------------------------------------------------------------------------------------
def _synthetic_lecture():
    lecture = content.BE505_LECTURES[0]
    slides = [s["title"] + "\n" + "\n".join(s["bullets"]) for s in lecture["slides"]]
    lines = [line for s in lecture["slides"] for line in s["lines"]] + [line for r in lecture["revisits"] for line in r["lines"]]
    truth, line = {}, 1
    for page, slide in enumerate(lecture["slides"], start=1):
        for _ in slide["lines"]:
            truth[line] = page
            line += 1
    revisit_lines = []
    for revisit in lecture["revisits"]:
        for _ in revisit["lines"]:
            truth[line] = revisit["slide"]
            revisit_lines.append(line)
            line += 1
    return slides, lines, truth, revisit_lines


def test_matcher_segments_a_lecture_in_slide_order_with_well_formed_boundaries():
    """Mechanics only: monotone order, well-formed non-overlapping segments, and section starts within one line on a
    clean synthetic lecture. No accuracy figure is asserted here: suggestion quality (QT04: 95% precision on at least
    100 adjudicated real cases, including repeats) is unmeasured until reviewed real material exists."""
    slides, lines, truth, revisit_lines = _synthetic_lecture()
    segments = align_lines_to_slides(slides, lines)
    sequential = [seg for seg in segments if seg["kind"] == "sequential"]
    assert [seg["page"] for seg in sequential] == [1, 2, 3, 4]  # monotone order
    true_starts = {1: 1, 2: 7, 3: 13, 4: 19}
    assert all(abs(seg["start_line"] - true_starts[seg["page"]]) <= 1 for seg in sequential)  # a section start is off by at most one line
    assert all(seg["start_line"] <= seg["end_line"] for seg in segments)
    covered = [n for seg in segments for n in range(seg["start_line"], seg["end_line"] + 1)]
    assert len(covered) == len(set(covered)) and set(covered) <= set(truth)  # no line is claimed twice or invented
    # Every line of the in-order part that is assigned at all is assigned to its own slide or the neighbouring one.
    assert all(abs(seg["page"] - truth[n]) <= 1 for seg in sequential for n in range(seg["start_line"], seg["end_line"] + 1) if n not in revisit_lines)


def test_matcher_offers_a_weakly_worded_revisit_as_a_second_occurrence_of_its_slide():
    """The lecturer says "remember the origin slide again" and goes on in words that barely overlap that slide. The
    spoken reference to an earlier slide by its title is the evidence: the lines are offered as a second occurrence of
    that slide, and the last section no longer swallows them."""
    slides, lines, truth, revisit_lines = _synthetic_lecture()
    segments = align_lines_to_slides(slides, lines)
    predicted = {n: seg["page"] for seg in segments for n in range(seg["start_line"], seg["end_line"] + 1)}
    assert [predicted.get(n) for n in revisit_lines] == [truth[n] for n in revisit_lines]
    revisit = [seg for seg in segments if seg["kind"] == "revisit"]
    assert [(seg["page"], seg["start_line"], seg["end_line"], seg["basis"]) for seg in revisit] == [(2, revisit_lines[0], revisit_lines[-1], "title_reference")]
    last = [seg for seg in segments if seg["kind"] == "sequential"][-1]
    assert (last["page"], last["end_line"]) == (4, revisit_lines[0] - 1)  # the last section ends where the lecturer left it
    covered = [n for seg in segments for n in range(seg["start_line"], seg["end_line"] + 1)]
    assert len(covered) == len(set(covered))


THREE_SLIDES = ["Enzyme kinetics\nMichaelis constant and maximum velocity", "Membrane transport\nChannels pumps and gradients", "Signal cascades\nKinase phosphorylation amplification"]
IN_ORDER = ["Enzyme kinetics start with the Michaelis constant.", "Maximum velocity is reached when the enzyme is saturated.",
            "Membrane transport uses channels and pumps.", "Gradients drive transport across the membrane.",
            "Signal cascades amplify through kinase phosphorylation.", "Each kinase phosphorylation step amplifies the signal."]


def _pages(slides, lines):
    segments = align_lines_to_slides(slides, lines)
    return segments, {n: (seg["page"], seg["kind"], seg.get("basis")) for seg in segments for n in range(seg["start_line"], seg["end_line"] + 1)}


def test_a_spoken_reference_back_to_an_earlier_slide_starts_a_revisit_in_other_material_too():
    """Not the fixture's wording: another subject, another phrasing, and a follow-up line with no word of the slide."""
    lines = IN_ORDER + ["Let us go back to the membrane slide for a moment.", "This is the part people usually get wrong in the exam.", "Now something entirely unrelated about parking permits."]
    segments, pages = _pages(THREE_SLIDES, lines)
    assert pages[7] == (2, "revisit", "title_reference") and pages[8] == (2, "revisit", "title_reference")
    assert 9 not in pages  # the revisit does not run on over lines that have nothing to do with that slide
    assert [seg["page"] for seg in segments if seg["kind"] == "sequential"] == [1, 2, 3] and pages[6][0] == 3
    # A revisit found by wording alone, with no spoken reference, still says which kind of evidence it rests on.
    clear = IN_ORDER + ["Enzyme kinetics and the Michaelis constant matter here too.", "The enzyme maximum velocity and Michaelis constant once more."]
    assert _pages(THREE_SLIDES, clear)[1][7] == (1, "revisit", "similarity") and _pages(THREE_SLIDES, clear)[1][8] == (1, "revisit", "similarity")


def test_a_title_word_alone_a_cue_alone_or_a_look_ahead_never_starts_a_revisit():
    """The reference needs the word "slide", a back-pointing cue and a title word of exactly one EARLIER slide. Anything
    less stays with the section being taught, or stays unresolved. (Found on real lectures: without the word "slide",
    ordinary uses of "back"/"again" next to an everyday title word were taken for revisits.)"""
    cases = {
        "cue, no title word": IN_ORDER + ["Let us go back to the slide for a moment.", "Each kinase step amplifies the signal further."],
        "cue and title word, but no slide is mentioned": IN_ORDER + ["Remember that membrane proteins come back again here.", "Each kinase step amplifies the signal further."],
        "everyday talk that happens to share a title word": IN_ORDER + ["So it does not come back, the membrane I mean, again and again.", "Each kinase step amplifies the signal further."],
        "the current slide's own title": IN_ORDER + ["Again, signal cascades are the point of this slide.", "Each kinase step amplifies the signal further."],
        "title word, slide, no cue": IN_ORDER + ["The membrane slide has more detail than this one.", "Each kinase step amplifies the signal further."],
        "a word shared by two titles": (["Membrane transport\nChannels and pumps", "Membrane potential\nIons and voltage", "Signal cascades\nKinase phosphorylation amplification"],
                                        ["Membrane transport uses channels and pumps.", "Pumps and channels move solutes.", "The membrane potential comes from ions and voltage.", "Voltage follows the ion gradients.",
                                         "Signal cascades amplify through kinase phosphorylation.", "Each kinase phosphorylation step amplifies the signal.", "Go back to the membrane slide again.", "This part is examined."]),
    }
    for name, value in cases.items():
        slides, lines = value if isinstance(value, tuple) else (THREE_SLIDES, value)
        segments, _ = _pages(slides, lines)
        assert not [seg for seg in segments if seg.get("basis") == "title_reference"], name
    # A promise to return later names an earlier slide but does not go there.
    promise = IN_ORDER + ["We will return to the enzyme kinetics slide later in the course.", "Each kinase step amplifies the signal further."]
    assert not [seg for seg in _pages(THREE_SLIDES, promise)[0] if seg.get("basis") == "title_reference"]
    # When two titles share a word, the word that only one of them has still identifies the slide.
    slides, lines = cases["a word shared by two titles"]
    lines = lines[:6] + ["Go back to the membrane transport slide again.", "This part is examined."]
    assert _pages(slides, lines)[1][7] == (1, "revisit", "title_reference")
    # A look ahead ("we will come back to… later", before that slide was shown) is not a revisit either.
    ahead = [IN_ORDER[0], "We will come back to the signal cascades slide later again.", IN_ORDER[1], *IN_ORDER[2:]]
    assert not [seg for seg in _pages(THREE_SLIDES, ahead)[0] if seg["kind"] == "revisit"]


def test_a_title_reference_ends_when_the_lecture_returns_to_its_section():
    lines = IN_ORDER[:4] + ["Remember the enzyme slide again.", "Signal cascades amplify through kinase phosphorylation.", "Each kinase phosphorylation step amplifies the signal."]
    segments, pages = _pages(THREE_SLIDES, lines)
    assert pages[5] == (1, "revisit", "title_reference")
    assert pages[6][:2] == (3, "sequential") and pages[7][:2] == (3, "sequential")


def test_matcher_marks_a_clear_out_of_order_revisit_as_its_own_segment():
    slides = ["Enzyme kinetics\nMichaelis constant and maximum velocity", "Membrane transport\nChannels pumps and gradients", "Signal cascades\nKinase phosphorylation amplification"]
    lines = ["Enzyme kinetics start with the Michaelis constant.", "Maximum velocity is reached when the enzyme is saturated.",
             "Membrane transport uses channels and pumps.", "Gradients drive transport across the membrane.",
             "Signal cascades amplify through kinase phosphorylation.", "Each kinase phosphorylation step amplifies the signal.",
             "Back to enzyme kinetics: the Michaelis constant again.", "The enzyme maximum velocity and Michaelis constant once more."]
    segments = align_lines_to_slides(slides, lines)
    revisit = [seg for seg in segments if seg["kind"] == "revisit"]
    # Found by its wording: the speaker never says "slide", so this is not reported as a spoken slide reference.
    assert revisit == [{"page": 1, "start_line": 7, "end_line": 8, "score": revisit[0]["score"], "margin": revisit[0]["margin"], "kind": "revisit", "basis": "similarity"}]


def test_matcher_abstains_on_unrelated_text_instead_of_guessing():
    segments = align_lines_to_slides(["Thermodynamics of ideal gases", "Entropy and the second law"], ["The cat sat quietly.", "A recipe needs flour.", "Trains leave at noon."])
    assert segments == []


def test_cue_parser_reads_vtt_and_srt(tmp_path):
    vtt = tmp_path / "a.vtt"
    vtt.write_text("WEBVTT\n\n00:00:01.000 --> 00:00:04.500\nFirst line\n\n00:00:04.500 --> 00:00:09.000\nSecond line\n", encoding="utf-8")
    srt = tmp_path / "a.srt"
    srt.write_text("1\n00:00:01,000 --> 00:00:04,500\nFirst line\n\n2\n01:00:00,000 --> 01:00:02,000\nLate line\n", encoding="utf-8")
    assert parse_cues(vtt) == [{"start_ms": 1000, "end_ms": 4500, "text": "First line"}, {"start_ms": 4500, "end_ms": 9000, "text": "Second line"}]
    assert parse_cues(srt)[1] == {"start_ms": 3600000, "end_ms": 3602000, "text": "Late line"}


# ---- pipeline -------------------------------------------------------------------------------------
def test_timed_suggestions_come_only_from_a_real_cue_file(prep, settings):
    result = prep.prepare_lecture("be505", _lecture(settings, "be505", "lecture-02"))
    assert result["stages"]["rendition"]["status"] == "original" and result["stages"]["slide_text"]["pages"] == 3
    assert result["stages"]["transcript"]["timing"] == "cue_file" and result["stages"]["alignment"]["timed_segments"] >= 2
    links = [e["record"] for e in AnnotationStore(settings).load("be505")["current"].values() if e["record"]["annotation_id"].startswith("sug-lecture-02")]
    media = [r for r in links if r["relation"] == "displayed_during"]
    assert media and all(r["review_state"] == "suggested" and r["reviewer_ref"] is None and r["basis"] == "transcript_only" for r in links)
    first = next(r for r in media if r["from"]["locator"]["page"] == 1)
    assert first["to"]["locator"]["start_ms"] == 0 and 12000 <= first["to"]["locator"]["end_ms"] <= 16000  # from the cue times, not invented
    # The unregistered recording is referenced by bytes that were actually hashed.
    recording = settings.course("be505").root / "materials/sessions/2026-09-08-lecture/Fixture Lec 2 Sep 8.wav"
    assert first["to"]["sha256"] == hashlib.sha256(recording.read_bytes()).hexdigest() and first["to"]["source_id"].startswith("unreg-")


def test_untimed_transcript_yields_line_links_but_no_invented_timestamps(prep, settings):
    root = settings.course("be505").root
    (root / "materials/sessions/2026-09-08-lecture/Fixture Lec 2 Sep 8.vtt").unlink()
    result = prep.prepare_lecture("be505", _lecture(settings, "be505", "lecture-02"))
    assert result["stages"]["transcript"]["timing"] == "untimed" and result["stages"]["alignment"]["timed_segments"] == 0
    links = [e["record"] for e in AnnotationStore(settings).load("be505")["current"].values() if e["record"]["annotation_id"].startswith("sug-lecture-02")]
    assert links and {r["relation"] for r in links} == {"explained_by"} and all(r["to"]["locator"]["kind"] == "lines" for r in links)


def test_confirmed_links_survive_reprocessing_and_runs_are_incremental(prep, settings):
    store = AnnotationStore(settings)
    before = {k: v["artifact"]["sha256"] for k, v in store.load("be505")["current"].items()}
    first = prep.prepare_lecture("be505", _lecture(settings, "be505", "lecture-01"))
    assert first["suggestions"]["kept_existing"] >= 4  # reviewed links were recognised and left alone
    after = store.load("be505")["current"]
    assert all(after[k]["artifact"]["sha256"] == sha for k, sha in before.items())
    assert not any(k.startswith("sug-lecture-01") and after[k]["record"]["from"]["locator"]["page"] in {1, 2, 3, 4} and after[k]["record"]["relation"] == "explained_by" for k in after)
    again = prep.prepare_lecture("be505", _lecture(settings, "be505", "lecture-01"))
    assert again.get("unchanged") is True


def test_every_unit_gets_an_honest_disposition(prep, settings):
    states = {}
    for course in ("be505", "be572", "cs542", "ds551"):
        prep.prepare_course(course)
    coverage = prep.coverage()
    for course, data in coverage["courses"].items():
        for row in data["lectures"]:
            states[(course, row["lecture_id"])] = row
    assert coverage["totals"]["lecture_units"] == 12 and len(states) == 12  # the denominator never shrinks
    assert states[("be562", "lecture-01")]["disposition"] == "not_processed"  # not run yet: visible, not hidden
    assert states[("be505", "lecture-01")]["disposition"] == "links_reviewed" and states[("be505", "lecture-01")]["pages_confirmed"] == 4
    assert states[("be505", "lecture-02")]["disposition"] == "links_pending_review" and states[("be505", "lecture-02")]["pages_suggested"] >= 2
    assert states[("be505", "lecture-03")]["disposition"].startswith("slides_ready_no_alignment") and "not guessed" in states[("be505", "lecture-03")]["stages"]["transcript"]["reason"]
    assert states[("be572", "lecture-01")]["disposition"].startswith("no_source") and "empty" in states[("be572", "lecture-01")]["disposition"]
    assert states[("be572", "lecture-02")]["disposition"].startswith("blocked") and "converter" in states[("be572", "lecture-02")]["disposition"]
    assert states[("cs542", "lecture-01")]["disposition"].startswith("blocked")
    assert states[("ds551", "lecture-01")]["stages"]["transcript"]["status"] == "no_source"


def test_batches_are_bounded_and_the_rest_stays_counted(prep):
    report = prep.prepare_course("be505", max_units=1)
    assert report["processed"] == ["lecture-01"] and report["remaining_unprepared"] == 4 and report["lecture_units"] == 5
    report = prep.prepare_course("be505", max_units=5)
    assert report["processed"] == ["lecture-02", "lecture-03", "lecture-04", "lecture-05"] and report["unchanged"] == 1 and report["remaining_unprepared"] == 0


def test_office_deck_rendition_is_versioned_and_never_touches_the_original(settings, tmp_path):
    double = tmp_path / "fake_soffice.py"
    double.write_text(textwrap.dedent('''
        """LABELED TEST DOUBLE of an office converter CLI: writes a small real PDF next to the copied input."""
        import sys
        from pathlib import Path
        from fpdf import FPDF
        out = Path(sys.argv[sys.argv.index("--outdir") + 1])
        pdf = FPDF(); pdf.add_page(); pdf.set_font("helvetica", size=14); pdf.cell(0, 10, "Converted rendition page"); pdf.output(str(out / "deck.pdf"))
    '''), encoding="utf-8")
    launcher = tmp_path / "soffice.cmd"
    launcher.write_text(f'@"{sys.executable}" "{double}" %*\r\n', encoding="utf-8")
    original = settings.course("cs542").root / "materials/lectures/lecture-01/Fixture 542 Lecture 01.pptx"
    before = original.read_bytes()
    prep = Preparation(settings, converter=launcher, now=lambda: NOW)
    result = prep.prepare_lecture("cs542", _lecture(settings, "cs542", "lecture-01"))
    rendition = result["stages"]["rendition"]
    assert rendition["status"] == "rendition" and rendition["of_sha256"] == hashlib.sha256(before).hexdigest() and "Static PDF rendition" in rendition["note"]
    assert (settings.write_root("cs542") / rendition["path"]).read_bytes().startswith(b"%PDF")
    assert rendition["of_sha256"][:16] in rendition["path"]  # versioned by the original's bytes
    assert original.read_bytes() == before and result["stages"]["slide_text"]["pages"] == 1


# ---- updater receipts -------------------------------------------------------------------------------
def test_updater_receipts_queue_downstream_work_once_per_published_index(settings, journal):
    receipt = latest_verified_receipt(settings)
    assert receipt["run"].endswith("-source-refresh") and set(receipt["courses"]) == set(settings.courses)
    first = consume_receipts(settings, journal)
    assert len(first["queued"]) == 5 and all(j["workflow"] == "WF02" for j in journal.jobs())
    assert consume_receipts(settings, journal)["queued"] == []  # same published index: nothing new
    # Our own generated exports never retrigger ingestion.
    Preparation(settings, converter=None, now=lambda: NOW).prepare_course("be505")
    assert consume_receipts(settings, journal)["queued"] == []
    assert len(journal.jobs()) == 5


def test_mixed_bundle_is_not_consumed_and_no_updater_is_run(settings, journal):
    index = settings.course("be562").root / ".agent/source-index.json"
    index.write_text(index.read_text(encoding="utf-8") + " ", encoding="utf-8")
    report = consume_receipts(settings, journal)
    assert report["courses"]["be562"]["index"] == "unavailable:mixed_bundle"
    assert "be562" not in {q["course_id"] for q in report["queued"]} and len(report["queued"]) == 4
    assert not (settings.planner_root / "automation/course-tracking/runs").joinpath("new").exists()


def test_missing_receipts_do_not_block_the_app_or_fabricate_a_run(settings, journal):
    import shutil

    shutil.rmtree(settings.planner_root / "automation")
    report = consume_receipts(settings, journal)
    assert report["run"] is None and "not run from here" in report["note"]
    assert len(report["queued"]) == 5  # the published index itself is still the trigger for downstream work
