"""LL013: durable owned source annotations — revisions, conflicts, suggestion safety, rebuildable export."""
from __future__ import annotations

import copy

import pytest

from lecture_brain import contracts as c
from lecture_brain.annotations import AnnotationError, AnnotationStore, precision_of


@pytest.fixture()
def store(settings):
    return AnnotationStore(settings)


def _revise(entry, **changes):
    record = copy.deepcopy(entry["record"])
    record.update(revision=record["revision"] + 1, supersedes={"record_id": record["annotation_id"], "artifact": entry["artifact"]}, created_at="2026-10-04T12:00:00Z")
    for key, value in changes.items():
        if key == "interval":
            record["to"]["locator"].update(start_ms=value[0], end_ms=value[1])
        else:
            record[key] = value
    return record


def test_fixture_links_load_with_typed_precision(store):
    state = store.load("be505")
    assert len(state["current"]) == 18 and state["problems"] == [] and state["conflicts"] == []
    textbook = state["current"]["ann-l01-s03-textbook"]["record"]
    chapter = state["current"]["ann-l01-s02-textbook-chapter"]["record"]
    assert precision_of(textbook) == "exact_page" and textbook["to"]["locator"]["printed_label"] == "34"
    # A chapter-level relation stays a broad reference; it is never shown as an exact page.
    assert precision_of(chapter) == "broad_reference" and chapter["review_state"] == "suggested"


def test_correction_is_a_new_revision_and_survives_regenerating_exports(store, settings):
    head = store.load("be505")["current"]["ann-l01-s02-o1-displayed"]
    result = store.propose("be505", c.dump_json(_revise(head, interval=(16000, 29000))))
    assert result["status"] == "saved" and result["artifact"]["path"].endswith("ann-l01-s02-o1-displayed.r2.json")
    export = settings.exports_area("be505") / "alignment.json"
    for _ in range(2):  # regenerate twice, deleting the export in between
        view = store.export_alignment("be505")
        link = next(l for l in view["links"] if l["annotation_id"] == "ann-l01-s02-o1-displayed")
        assert link["revision"] == 2 and link["to"]["locator"]["start_ms"] == 16000 and link["review_state"] == "confirmed"
        export.unlink()
    assert len(store.load("be505")["history"]["ann-l01-s02-o1-displayed"]) == 2  # original revision retained


def test_two_conflicting_revisions_require_reconciliation(store):
    head = store.load("be505")["current"]["ann-l01-s03-o1-displayed"]
    first = store.propose("be505", c.dump_json(_revise(head, interval=(30000, 44000))))
    second = store.propose("be505", c.dump_json(_revise(head, interval=(31000, 45000))))  # built on the same base from another device
    assert first["status"] == "saved" and second["status"] == "conflict"
    state = store.load("be505")
    assert state["current"]["ann-l01-s03-o1-displayed"]["record"]["to"]["locator"]["start_ms"] == 30000  # not last-write-wins
    assert [x["annotation_id"] for x in state["conflicts"]] == ["ann-l01-s03-o1-displayed"]
    assert state["conflicts"][0]["proposed"]["to"]["locator"]["start_ms"] == 31000  # the other version is preserved
    # Explicit reconciliation: a revision built on the current head resolves it.
    resolved = store.propose("be505", c.dump_json(_revise(state["current"]["ann-l01-s03-o1-displayed"], interval=(31000, 45000))))
    assert resolved["status"] == "saved" and store.load("be505")["conflicts"] == []


def test_identical_replay_is_idempotent(store):
    head = store.load("be505")["current"]["ann-l01-s04-o1-displayed"]
    data = c.dump_json(_revise(head, interval=(45000, 54000)))
    assert store.propose("be505", data)["status"] == "saved"
    assert store.propose("be505", data)["status"] == "already_saved"


@pytest.mark.parametrize("case,code", [("reversed", "invalid_annotation"), ("beyond_recording", "outside_recording"), ("confirmed_without_reviewer", "invalid_annotation"), ("wrong_course", "identity_mismatch")])
def test_invalid_corrections_are_rejected_inline(store, case, code):
    head = store.load("be505")["current"]["ann-l01-s01-o1-displayed"]
    record = _revise(head)
    if case == "reversed":
        record["to"]["locator"].update(start_ms=9000, end_ms=3000)
    elif case == "beyond_recording":
        record["to"]["locator"].update(start_ms=58000, end_ms=75000)  # the fixture recording is 60 s long
    elif case == "confirmed_without_reviewer":
        record["reviewer_ref"] = None
    elif case == "wrong_course":
        record["scope"]["course_id"] = "cs542"
    with pytest.raises(AnnotationError) as err:
        store.propose("be505", c.dump_json(record))
    assert err.value.code == code


def test_reject_and_undo_are_revisions_that_keep_the_audit(store):
    head = store.load("be505")["current"]["ann-l01-s02-textbook-chapter"]
    rejected = _revise(head, review_state="rejected", reviewer_ref="learner", basis="manual_review")
    assert store.propose("be505", c.dump_json(rejected))["status"] == "saved"
    head2 = store.load("be505")["current"]["ann-l01-s02-textbook-chapter"]
    undo = _revise(head2, review_state="suggested", reviewer_ref=None, basis="transcript_only")
    assert store.propose("be505", c.dump_json(undo))["status"] == "saved"
    history = store.load("be505")["history"]["ann-l01-s02-textbook-chapter"]
    assert [h["record"]["review_state"] for h in history] == ["suggested", "rejected", "suggested"]


def test_pipeline_suggestions_never_override_reviewed_links(store):
    confirmed = store.load("be505")["current"]["ann-l01-s01-o1-displayed"]["record"]
    again = copy.deepcopy(confirmed)
    again.update(annotation_id="ann-pipeline-rerun-s01", review_state="suggested", reviewer_ref=None, basis="transcript_only")
    again["to"]["locator"].update(start_ms=2000, end_ms=11000)
    result = store.suggest("be505", again)
    assert result["status"] == "kept_existing" and result["annotation_id"] == "ann-l01-s01-o1-displayed"
    assert "ann-pipeline-rerun-s01" not in store.load("be505")["current"]
    with pytest.raises(AnnotationError):
        store.suggest("be505", dict(again, review_state="confirmed", reviewer_ref="pipeline"))  # a pipeline cannot self-confirm


def test_learner_can_create_the_first_link_for_a_slide_that_has_no_suggestion(store, settings):
    """Real transcripts are often untimed, so no interval is suggested. The learner's own first link is a normal
    revision-1 annotation: confirmed by them, bounded by the recording, and shown like any reviewed link."""
    from lecture_brain.journal import Journal
    from lecture_brain.preparation import Preparation
    from lecture_brain.projections import Projector

    prep = Preparation(settings, converter=None, now=lambda: "2026-10-04T12:00:00Z")
    prep.prepare_course("be562")
    journal = Journal.open(settings.journal_path, synced_roots=[])
    try:
        projector = Projector(settings, journal, preparation=prep, now=lambda: "2026-10-04T12:00:00Z")
        before = projector.lecture_view("be562", "lecture-01")
        slide = before["slides"][0]
        assert slide["occurrences"] == [] and before["recordings"], "the fixture lecture has a recording but no timed link"
        deck, recording = before["deck"], before["recordings"][0]
        assert recording["version_id"] and recording["sha256"] and recording["duration_ms"]
        record = {"contract": "ll.annotation/1", "annotation_id": "ann-learner-be562-l01-s01-a1", "scope": {"course_id": "be562", "term": "2026-fall"}, "revision": 1, "supersedes": None,
                  "relation": "displayed_during", "from": {"source_id": deck["source_id"], "version_id": deck["version_id"], "sha256": deck["sha256"], "locator": {"kind": "page", "page": 1, "printed_label": None}},
                  "to": {"source_id": recording["source_id"], "version_id": recording["version_id"], "sha256": recording["sha256"],
                         "locator": {"kind": "media", "start_ms": 1000, "end_ms": 4000, "origin": "original_source_start"}},
                  "review_state": "confirmed", "basis": "manual_review", "support": [recording["artifact"]], "reviewer_ref": "learner", "created_at": "2026-10-04T12:00:00Z"}
        assert c.validate("annotation", record) == []
        result = store.propose("be562", c.dump_json(record))
        assert result["status"] == "saved"
        after = projector.lecture_view("be562", "lecture-01")
        (occurrence,) = after["slides"][0]["occurrences"]
        assert (occurrence["start_ms"], occurrence["end_ms"], occurrence["review_state"], occurrence["basis"], occurrence["revision"]) == (1000, 4000, "confirmed", "manual_review", 1)
        # Outside the recording, or against bytes that are not the current file, a first link is refused like any other.
        beyond = dict(record, annotation_id="ann-learner-be562-l01-s01-a2", to=dict(record["to"], locator=dict(record["to"]["locator"], end_ms=recording["duration_ms"] + 60_000)))
        with pytest.raises(AnnotationError):
            store.propose("be562", c.dump_json(beyond))
        stale = dict(record, annotation_id="ann-learner-be562-l01-s01-a3", to=dict(record["to"], sha256="0" * 64))
        with pytest.raises(AnnotationError):
            store.propose("be562", c.dump_json(stale))
    finally:
        journal.close()


# ---- recording length for the formats real sessions use ----------------------------------------------
def _mp4(duration_ticks: int, timescale: int, *, version: int = 0, moov_last: bool = True) -> bytes:
    """A minimal ISO-BMFF file: ftyp, a (possibly large) mdat and moov/mvhd — synthetic, no media content."""
    import struct

    def box(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I4s", 8 + len(payload), kind) + payload

    if version == 0:
        mvhd = struct.pack(">B3xIIII", 0, 0, 0, timescale, duration_ticks) + b"\x00" * 80
    else:
        mvhd = struct.pack(">B3xQQIQ", 1, 0, 0, timescale, duration_ticks) + b"\x00" * 80
    moov = box(b"moov", box(b"udta", b"xx") + box(b"mvhd", mvhd))
    mdat = box(b"mdat", b"\x00" * 4096)
    return box(b"ftyp", b"M4A \x00\x00\x00\x00") + (mdat + moov if moov_last else moov + mdat)


@pytest.mark.parametrize("name,data,expected", [
    ("a.m4a", _mp4(5120 * 44100, 44100), 5_120_000),
    ("b.mp4", _mp4(90_000 * 75 + 45_000, 90_000, version=1, moov_last=False), 75_500),
    ("c.m4a", b"not an mp4 at all", None),
    ("d.m4a", _mp4(10, 0), None),  # a zero timescale is not a duration
    ("e.mp4", _mp4(1000, 1000)[:40], None),  # truncated before moov
])
def test_recording_length_is_read_from_mp4_and_m4a_headers(tmp_path, name, data, expected):
    from lecture_brain.annotations import media_duration_ms

    path = tmp_path / name
    path.write_bytes(data)
    assert media_duration_ms(path) == expected


def test_recording_length_is_remembered_until_the_file_changes(tmp_path, monkeypatch):
    """Recordings sit on a synced drive; their header is read once per file version, not on every view."""
    from lecture_brain import annotations

    path = tmp_path / "session.m4a"
    path.write_bytes(_mp4(30 * 1000, 1000))
    calls = []
    original = annotations._mp4_duration_ms
    monkeypatch.setattr(annotations, "_mp4_duration_ms", lambda p: calls.append(p) or original(p))
    assert annotations.media_duration_ms(path) == 30_000 and annotations.media_duration_ms(path) == 30_000
    assert len(calls) == 1
    path.write_bytes(_mp4(45 * 1000, 1000) + b"\x00" * 16)  # a different file under the same name
    assert annotations.media_duration_ms(path) == 45_000 and len(calls) == 2
