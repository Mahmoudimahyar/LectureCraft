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
    assert len(state["current"]) == 20 and state["problems"] == [] and state["conflicts"] == []
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
