"""LL006 (Brain side): immutable full-turn capture — freeze, read back, verify; never rewrite."""
from __future__ import annotations

import pytest

from lecture_brain import contracts as c
from lecture_brain.capture import CaptureConflict, CaptureError, CaptureStore
from lecture_brain.config import load_settings

from helpers import submission


def _sub(**kw):
    base = dict(text="Replication starts at the origin; it does not switch the gene on.", prompt="Explain what the origin does.", question_id="BE505-L01-Q01",
                family=("be505.family.question.l01-q01", 1))
    base.update(kw)
    return submission("req-1", **base)


@pytest.fixture()
def store(settings):
    return CaptureStore(settings)


def test_freeze_reads_back_exact_bytes_and_is_idempotent(store, settings):
    data = c.dump_json(_sub())
    ref = store.freeze_submission("be505", data)
    assert ref["sha256"] == c.sha256_hex(data) and ref["bytes"] == len(data)
    assert ref["path"].startswith(".agent/course-learning/runs/") and "/turns/" in ref["path"]
    assert (settings.write_root("be505") / ref["path"]).read_bytes() == data
    assert store.freeze_submission("be505", data) == ref  # repeated submit / resync → same identity


def test_same_turn_different_bytes_is_a_conflict_and_never_overwrites(store, settings):
    original = c.dump_json(_sub())
    ref = store.freeze_submission("be505", original)
    with pytest.raises(CaptureConflict):
        store.freeze_submission("be505", c.dump_json(_sub(text="A different answer under the same turn id.")))
    assert (settings.write_root("be505") / ref["path"]).read_bytes() == original


def test_tutor_reply_is_a_separate_record_and_does_not_touch_the_hashed_input(store, settings):
    data = c.dump_json(_sub())
    ref = store.freeze_submission("be505", data)
    reply = {"contract": "ll.message/1", "message_id": "msg-tutor-1", "request_id": "req-1", "scope": {"course_id": "be505", "term": "2026-fall"},
             "thread_key": "tutor-be505", "reply_to_turn": "turn-req-1", "role": "tutor", "text": "Feedback text.", "sources": [], "attachments": [],
             "created_at": "2026-10-04T10:01:00Z", "assessment_disposition": "provisional"}
    message_ref = store.freeze_message("be505", "session-test-1", c.dump_json(reply))
    assert "/messages/" in message_ref["path"] and message_ref["path"] != ref["path"]
    assert c.sha256_hex((settings.write_root("be505") / ref["path"]).read_bytes()) == ref["sha256"]
    assert store.verify("be505", ref, expect_turn_id="turn-req-1")["response"]["text"].startswith("Replication")


def test_invalid_submission_is_not_frozen_as_evidence(store):
    bad = _sub()
    bad["response"]["text"] = None  # no actual response
    with pytest.raises(CaptureError) as err:
        store.freeze_submission("be505", c.dump_json(bad))
    assert err.value.code == "invalid_submission"


@pytest.mark.parametrize("case", ["missing", "tampered", "wrong_course", "wrong_turn", "wrong_input", "excerpt", "outside_runs", "traversal"])
def test_verify_blocks_unverifiable_evidence(store, settings, case):
    data = c.dump_json(_sub())
    ref = dict(store.freeze_submission("be505", data))
    path = settings.write_root("be505") / ref["path"]
    kwargs = {"expect_turn_id": "turn-req-1", "expect_logical_input_id": "input-req-1", "excerpt": "Replication starts at the origin"}
    course = "be505"
    if case == "missing":
        path.unlink()
    elif case == "tampered":
        path.write_bytes(data.replace(b"origin", b"ORIGIN"))
    elif case == "wrong_course":
        course = "cs542"
    elif case == "wrong_turn":
        kwargs["expect_turn_id"] = "turn-other"
    elif case == "wrong_input":
        kwargs["expect_logical_input_id"] = "input-other"
    elif case == "excerpt":
        kwargs["excerpt"] = "words the learner never wrote"
    elif case == "outside_runs":
        ref["path"] = "learning/attempts/2026-09/be505-20260905-l01-q01-teachback-01.json"
    elif case == "traversal":
        ref["path"] = ".agent/course-learning/runs/../../../planning/grades.yaml"
    with pytest.raises(CaptureError) as err:
        store.verify(course, ref, **kwargs)
    expected = {"missing": "missing_snapshot", "tampered": "hash_mismatch", "wrong_course": "missing_snapshot", "wrong_turn": "identity_mismatch",
                "wrong_input": "identity_mismatch", "excerpt": "excerpt_not_in_original", "outside_runs": "unsafe_locator", "traversal": "unsafe_locator"}[case]
    assert err.value.code == expected


def test_attachments_are_content_addressed_and_required_for_verification(store, settings):
    image = b"\x89PNG synthetic figure bytes"
    sub = _sub()
    sub["response"]["attachments"] = [c.artifact_for_bytes(image, "attachments/sketch.png", "image/png")]
    data = c.dump_json(sub)
    ref = store.freeze_submission("be505", data, attachments={"attachments/sketch.png": image})
    assert store.verify("be505", ref)["response"]["attachments"][0]["sha256"] == c.sha256_hex(image)
    # Same submission arriving without its attachment bytes: input is retained, verification is blocked.
    sub2 = _sub(logical="input-req-2")
    sub2["turn_id"] = "turn-req-2"
    sub2["response"]["attachments"] = [c.artifact_for_bytes(b"other bytes", "attachments/other.png", "image/png")]
    ref2 = store.freeze_submission("be505", c.dump_json(sub2), attachments={})
    with pytest.raises(CaptureError) as err:
        store.verify("be505", ref2)
    assert err.value.code == "missing_attachment"
    with pytest.raises(CaptureError):
        store.freeze_submission("be505", c.dump_json(_sub(logical="input-req-3") | {"turn_id": "turn-req-3", "response": dict(sub["response"])}), attachments={"attachments/sketch.png": b"different bytes"})


def test_nothing_is_written_inside_the_attempts_tree(store, settings):
    before = sorted(p.as_posix() for p in (settings.course("be505").root / "learning/attempts").rglob("*"))
    store.freeze_submission("be505", c.dump_json(_sub()))
    assert sorted(p.as_posix() for p in (settings.course("be505").root / "learning/attempts").rglob("*")) == before


def test_transcript_correction_is_a_new_linked_capture(store, settings):
    original_bytes = c.dump_json(_sub())
    ref = store.freeze_submission("be505", original_bytes)
    corrected = _sub(text="Replication starts at the origin; it does not switch the gene on. (corrected term: ori)", logical="input-req-1b",
                     supersedes={"record_id": "turn-req-1", "artifact": ref})
    corrected["turn_id"] = "turn-req-1b"
    ref2 = store.freeze_submission("be505", c.dump_json(corrected))
    assert ref2["path"] != ref["path"]
    assert (settings.write_root("be505") / ref["path"]).read_bytes() == original_bytes
    assert store.verify("be505", ref2)["supersedes_capture"]["artifact"]["sha256"] == ref["sha256"]


def test_capture_is_staged_locally_when_course_writes_are_disabled(workspace, tmp_path):
    s = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")
    ref = CaptureStore(s).freeze_submission("be505", c.dump_json(_sub()))
    assert (tmp_path / "state" / "shadow" / "be505" / ref["path"]).is_file()
    assert not (s.course("be505").root / ".agent" / "course-learning" / "runs").exists()
