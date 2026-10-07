"""R2-T6: the optional private benchmark record of an installation, and the statement every suggestion carries.

Everything here is invented. The record written by these tests is a labelled synthetic one in a temporary state
directory; no real benchmark is read and no number here measures a method. What is proven: the file is read strictly and
never repaired, a suggestion is called benchmarked only when the record names exactly its method name and version, the
lexical baseline and a method without a record say so, and a person's own link or the course's own statement is not a
method's suggestion at all.
"""
from __future__ import annotations

import copy
import json

import pytest

from lecture_brain import alignment as al
from lecture_brain import benchmark_record as br
from lecture_brain import timing_links as tl
from lecture_brain.config import load_settings
from lecture_brain.journal import Journal
from test_timing_links import (LINE_OF, NOW, PLANNER, annotation, import_generation, listed, material, pairing, slide, source_map, transcript_lines, view)

SEQUENCE = {"name": "lexical-sequence", "version": "2"}
BASELINE = {"name": "lexical-monotone-baseline", "version": "preparation.align_lines_to_slides"}


def record(**over) -> dict:
    """A LABELLED SYNTHETIC record in the contract's shape. Its figures are made up."""
    base = {"contract": "ll.alignment-benchmark/1", "method": dict(SEQUENCE), "baseline": {"name": "lexical-monotone-baseline"},
            "compared_on": "synthetic labelled windows of an imaginary baking course", "labelled_windows": 120, "result": "not_clearly_better",
            "thresholds_fixed_before_reading_answers": True, "produced_at": "2026-10-06T08:00:00Z", "note": "LABELLED SYNTHETIC: written by a test, measures nothing."}
    return {**base, **over}


def present(**over) -> dict:
    return br.parse(json.dumps(record(**over)).encode("utf-8"))


@pytest.fixture()
def local(workspace, tmp_path):
    return load_settings("local", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "private-state")


@pytest.fixture()
def journal(local, clock):
    j = Journal.open(local.journal_path, clock=clock, synced_roots=[])
    yield j
    j.close()


def write_record(settings, document) -> bytes:
    path = br.path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = document if isinstance(document, bytes) else json.dumps(document, indent=1).encode("utf-8")
    path.write_bytes(data)
    return data


# ---- the file ------------------------------------------------------------------------------------------------------------
def test_the_record_lives_in_the_state_directory_and_without_it_nothing_is_stated_or_written(local):
    assert br.path(local) == local.state_dir / "benchmarks" / "alignment.json"
    assert br.read(local) == {"state": "absent", "detail": None, "record": None, "sha256": None}
    assert not br.path(local).parent.exists()  # reading creates nothing


def test_a_valid_record_is_read_as_it_is_written(local):
    data = write_record(local, record())
    readback = br.read(local)
    assert readback["state"] == "present" and readback["detail"] is None and readback["sha256"] == br.c.sha256_hex(data)
    assert readback["record"] == {key: value for key, value in record().items() if key != "contract"}
    assert br.path(local).read_bytes() == data  # read only


MALFORMED = {
    "not json": b"{ this is not json",
    "a list": b"[]",
    "another contract": record(contract="ll.alignment-benchmark/2"),
    "a key too many": {**record(), "accuracy": 0.93},
    "a key missing": {key: value for key, value in record().items() if key != "result"},
    "method without version": record(method={"name": "lexical-sequence"}),
    "method with an empty version": record(method={"name": "lexical-sequence", "version": ""}),
    "method with an extra field": record(method={**SEQUENCE, "label": "best"}),
    "version as a number": record(method={"name": "lexical-sequence", "version": 2}),
    "baseline without a name": record(baseline={}),
    "baseline is the method itself": record(baseline={"name": "lexical-sequence"}),
    "no labelled windows": record(labelled_windows=0),
    "windows as a fraction": record(labelled_windows=12.5),
    "windows as true": record(labelled_windows=True),
    "windows as text": record(labelled_windows="120"),
    "a result outside the three": record(result="much_better"),
    "thresholds as text": record(thresholds_fixed_before_reading_answers="yes"),
    "a date that is not a UTC time": record(produced_at="6 October 2026"),
    "an impossible date": record(produced_at="2026-13-45T08:00:00Z"),
    "nothing compared": record(compared_on="  "),
    "compared_on over several lines": record(compared_on="windows\nof a lecture"),
    "a note that is not text": record(note=None),
    "too large": json.dumps(record(note="x" * (br.MAX_BYTES + 1))).encode("utf-8"),
}


@pytest.mark.parametrize("name", sorted(MALFORMED))
def test_a_malformed_record_is_reported_unreadable_treated_as_absent_and_never_repaired(local, name):
    data = write_record(local, MALFORMED[name])
    readback = br.read(local)
    assert readback["state"] == "unreadable" and readback["record"] is None and readback["sha256"] is None
    assert isinstance(readback["detail"], str) and readback["detail"].strip()
    assert br.path(local).read_bytes() == data and sorted(p.name for p in br.path(local).parent.iterdir()) == ["alignment.json"]
    # Treated as absent: no suggestion is called benchmarked.
    statement = br.statement(readback, SEQUENCE, "pipeline")
    assert statement["state"] == "not_benchmarked" and statement["reason"] == "record_unreadable" and statement["result"] is None


def test_a_folder_in_the_place_of_the_file_is_unreadable_too(local):
    br.path(local).mkdir(parents=True)
    assert br.read(local)["state"] == "unreadable"


# ---- the statement of one suggestion -------------------------------------------------------------------------------------
STATEMENT_KEYS = {"state", "reason", "method", "baseline", "compared_on", "labelled_windows", "result", "thresholds_fixed_before_reading_answers", "produced_at"}


def test_benchmarked_only_when_the_record_names_exactly_the_methods_name_and_version():
    readback = {"state": "present", "detail": None, "record": present(), "sha256": "0" * 64}
    statement = br.statement(readback, SEQUENCE, "pipeline")
    assert set(statement) == STATEMENT_KEYS
    assert statement == {"state": "benchmarked", "reason": None, "method": SEQUENCE, "baseline": {"name": "lexical-monotone-baseline"},
                         "compared_on": "synthetic labelled windows of an imaginary baking course", "labelled_windows": 120, "result": "not_clearly_better",
                         "thresholds_fixed_before_reading_answers": True, "produced_at": "2026-10-06T08:00:00Z"}
    other_version = br.statement(readback, {"name": "lexical-sequence", "version": "3"}, "pipeline")
    assert (other_version["state"], other_version["reason"], other_version["result"], other_version["compared_on"]) == ("not_benchmarked", "record_is_for_another_version", None, None)
    assert other_version["method"] == {"name": "lexical-sequence", "version": "3"}  # the range's own method, never the record's
    other_method = br.statement(readback, {"name": "transcript-cue-match", "version": None}, "pipeline")
    assert (other_method["state"], other_method["reason"]) == ("not_benchmarked", "record_is_for_another_method")
    unnamed = br.statement(readback, None, "pipeline")
    assert (unnamed["state"], unnamed["reason"], unnamed["method"]) == ("not_benchmarked", "no_method_named", None)
    assert set(other_version) == set(other_method) == set(unnamed) == STATEMENT_KEYS


def test_without_a_record_every_method_says_not_benchmarked():
    for readback in (None, br.ABSENT, {"state": "absent", "detail": None, "record": None, "sha256": None}):
        statement = br.statement(readback, SEQUENCE, "pipeline")
        assert (statement["state"], statement["reason"], statement["result"], statement["baseline"]) == ("not_benchmarked", "no_record", None, None)


def test_the_lexical_baseline_itself_says_so_with_and_without_a_record():
    readback = {"state": "present", "detail": None, "record": present(), "sha256": "0" * 64}
    for given in (readback, br.ABSENT):
        statement = br.statement(given, BASELINE, "pipeline")
        assert (statement["state"], statement["reason"], statement["result"]) == ("not_benchmarked", "is_the_baseline", None)
    assert BASELINE["name"] == al.BASELINE_METHOD.partition("/")[0]  # the name the app's own baseline carries
    # A record may name its baseline otherwise: a suggestion made by THAT method is the baseline too.
    renamed = {"state": "present", "detail": None, "record": present(baseline={"name": "plain-overlap"}), "sha256": "0" * 64}
    assert br.statement(renamed, {"name": "plain-overlap", "version": "1"}, "pipeline")["reason"] == "is_the_baseline"


@pytest.mark.parametrize("origin, reason", [("manual", "entered_by_a_person"), ("reviewed_source_map", "stated_by_the_course")])
def test_a_persons_link_and_the_courses_statement_are_not_a_methods_suggestion(origin, reason):
    readback = {"state": "present", "detail": None, "record": present(), "sha256": "0" * 64}
    for given in (readback, br.ABSENT):
        statement = br.statement(given, SEQUENCE, origin)
        assert (statement["state"], statement["reason"], statement["result"], statement["compared_on"]) == ("not_applicable", reason, None, None)


def test_a_record_whose_thresholds_were_not_fixed_first_says_that_beside_its_result():
    readback = {"state": "present", "detail": None, "record": present(thresholds_fixed_before_reading_answers=False, result="better"), "sha256": "0" * 64}
    statement = br.statement(readback, SEQUENCE, "pipeline")
    assert statement["state"] == "benchmarked" and statement["result"] == "better" and statement["thresholds_fixed_before_reading_answers"] is False


def test_the_installation_readback_names_the_record_and_what_it_says_about_the_method_in_use():
    data = json.dumps(record()).encode("utf-8")
    readback = {"state": "present", "detail": None, "record": br.parse(data), "sha256": br.c.sha256_hex(data)}
    report = br.installation(readback, SEQUENCE)
    assert set(report) == {"record", "detail", "recorded", "current_method", "statement"}
    assert report["record"] == "present" and report["current_method"] == SEQUENCE and report["statement"]["state"] == "benchmarked"
    assert report["recorded"] == {key: value for key, value in record().items() if key != "contract"}
    absent = br.installation(None, SEQUENCE)
    assert (absent["record"], absent["recorded"], absent["statement"]["state"], absent["statement"]["reason"]) == ("absent", None, "not_benchmarked", "no_record")
    unreadable = br.installation({"state": "unreadable", "detail": "labelled_windows must be a whole number of at least 1", "record": None, "sha256": None}, SEQUENCE)
    assert (unreadable["record"], unreadable["recorded"], unreadable["detail"]) == ("unreadable", None, "labelled_windows must be a whole number of at least 1")


# ---- the lecture view ----------------------------------------------------------------------------------------------------
def enrich(mat, *, benchmark, the_view=None, annotations=None) -> dict:
    doc = tl.compose(mat, now=NOW)
    assert "benchmark" not in json.dumps(doc), "the stored links state nothing about a benchmark: it is read when the view is made"
    generated = {r["source_id"]: r["generated"] for r in mat["recordings"]}
    return tl.enrich(the_view or view(), source_map=source_map(), links=tl.evaluate(doc, copy.deepcopy(doc["inputs"])), generated=generated, annotations=annotations, benchmark=benchmark)


def ranges_of(result) -> list[dict]:
    return [item for row in result["slides"] for item in row["ranges"]]


def test_every_range_of_a_lecture_view_carries_its_statement_and_the_timing_block_the_one_of_the_method_in_use():
    mat = material(pairings=[pairing([5, 7, 8], [LINE_OF["oven"]])])
    mine = view()
    mine["slides"][5]["occurrences"] = [listed(annotation("ann-own", 6, 200_000, 215_000))]  # entered by a person
    mine["slides"][6]["occurrences"] = [listed(annotation("ann-cue", 7, 220_000, 230_000, review_state="suggested", basis="transcript_only"))]  # an earlier suggestion of another method
    readback = {"state": "present", "detail": None, "record": present(), "sha256": "0" * 64}

    result = enrich(mat, benchmark=readback, the_view=mine)

    everything = ranges_of(result)
    assert everything and all(set(item["benchmark"]) == STATEMENT_KEYS for item in everything)
    suggested = [item for item in everything if item["origin"] == "pipeline" and item["method"] == SEQUENCE]
    assert suggested and all(item["benchmark"]["state"] == "benchmarked" and item["benchmark"]["result"] == "not_clearly_better" for item in suggested)
    sections = [item for item in everything if item["support"]["scope"] == "section"]
    assert sections and all((item["benchmark"]["state"], item["benchmark"]["reason"]) == ("not_applicable", "stated_by_the_course") for item in sections)
    (own,) = [item for item in slide(result, 6)["ranges"] if item["annotation_id"] == "ann-own"]
    assert (own["benchmark"]["state"], own["benchmark"]["reason"]) == ("not_applicable", "entered_by_a_person")
    (cue,) = [item for item in slide(result, 7)["ranges"] if item["annotation_id"] == "ann-cue"]
    assert cue["origin"] == "pipeline" and (cue["benchmark"]["state"], cue["benchmark"]["reason"]) == ("not_benchmarked", "record_is_for_another_method")
    assert result["timing"]["benchmark"] == br.statement(readback, SEQUENCE, "pipeline") and result["timing"]["benchmark"]["state"] == "benchmarked"


def test_without_a_record_no_range_and_no_timing_block_is_called_benchmarked():
    for given in (None, br.ABSENT, {"state": "unreadable", "detail": "not valid JSON", "record": None, "sha256": None}):
        result = enrich(material(), benchmark=given)
        suggested = [item for item in ranges_of(result) if item["origin"] == "pipeline"]
        assert suggested and {item["benchmark"]["state"] for item in suggested} == {"not_benchmarked"}
        assert result["timing"]["benchmark"]["state"] == "not_benchmarked" and result["timing"]["benchmark"]["method"] == SEQUENCE
    # A record for an earlier version of the method does not carry over to the version in use.
    older = {"state": "present", "detail": None, "record": present(method={"name": "lexical-sequence", "version": "1"}), "sha256": "0" * 64}
    result = enrich(material(), benchmark=older)
    assert {item["benchmark"]["reason"] for item in ranges_of(result) if item["origin"] == "pipeline"} == {"record_is_for_another_version"}
    assert result["timing"]["benchmark"]["reason"] == "record_is_for_another_version"


def test_no_statement_calls_a_suggestion_aligned_verified_or_confirmed():
    readback = {"state": "present", "detail": None, "record": present(result="better"), "sha256": "0" * 64}
    result = enrich(material(pairings=[pairing([5], [LINE_OF["gluten"]])]), benchmark=readback)
    for item in ranges_of(result):
        words = json.dumps({key: value for key, value in item["benchmark"].items() if key not in {"compared_on"}}).lower()
        assert not any(word in words for word in ("aligned", "verified", "confirmed", "certified")), words
        assert item["review_state"] == "generated"  # a benchmark of the method reviews no range


# ---- through the settings: the lecture view and the course readback -------------------------------------------------------
def test_the_lecture_view_and_the_course_readback_read_the_record_of_the_state_directory(local, journal, tmp_path):
    from lecture_brain.preparation import Preparation
    from lecture_brain.projections import Projector

    import_generation(local, journal, tmp_path / "out" / "gen-0001", transcript_lines(local))
    tl.build(local, "be505", "lecture-01", now=lambda: NOW)
    preparation = Preparation(local, converter=None, now=lambda: NOW)
    projector = Projector(local, journal, preparation=preparation, now=lambda: NOW)

    def suggestions() -> tuple[list[dict], dict]:
        """The lecture view as it is served, and the suggestions of the same lecture when the reviewed links of this
        fixture lecture (which stand in front of every suggestion) are left out of the view that is enriched."""
        lecture = projector.lecture_view("be505", "lecture-01")
        own = [item for row in lecture["slides"] for item in row["ranges"]]
        assert own and {(item["origin"], item["benchmark"]["state"], item["benchmark"]["reason"]) for item in own} == {("manual", "not_applicable", "entered_by_a_person")}
        bare = copy.deepcopy(lecture)
        for row in bare["slides"]:
            row["occurrences"] = []
        tl.enrich_view(local, "be505", "lecture-01", bare, preparation=preparation)
        return [item for row in bare["slides"] for item in row["ranges"] if item["origin"] == "pipeline"], lecture["timing"]

    before, timing = suggestions()
    assert before and {item["benchmark"]["reason"] for item in before} == {"no_record"} and timing["benchmark"]["state"] == "not_benchmarked"
    report = tl.status(local, "be505")
    assert report["benchmark"]["record"] == "absent" and report["benchmark"]["recorded"] is None and report["benchmark"]["current_method"] == SEQUENCE
    assert tl.status(local, "be505", queue=False)["benchmark"]["record"] == "absent"  # stated with and without the queue

    data = write_record(local, record(result="worse"))
    after, timing = suggestions()
    assert {(item["benchmark"]["state"], item["benchmark"]["result"]) for item in after} == {("benchmarked", "worse")}
    assert timing["benchmark"]["state"] == "benchmarked" and timing["benchmark"]["labelled_windows"] == 120
    report = tl.status(local, "be505")
    assert report["benchmark"]["record"] == "present" and report["benchmark"]["recorded"]["result"] == "worse" and report["benchmark"]["statement"]["state"] == "benchmarked"
    assert br.path(local).read_bytes() == data

    write_record(local, {**record(), "accuracy": 0.99})
    unreadable, timing = suggestions()
    assert {item["benchmark"]["reason"] for item in unreadable} == {"record_unreadable"} and timing["benchmark"]["state"] == "not_benchmarked"
    report = tl.status(local, "be505")
    assert report["benchmark"]["record"] == "unreadable" and report["benchmark"]["recorded"] is None and report["benchmark"]["detail"]
