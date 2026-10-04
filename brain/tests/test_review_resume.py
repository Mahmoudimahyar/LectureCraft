"""LL028 / LL029 / LL031: review items, immutable review events, FSRS replay; resume lineage conflicts."""
from __future__ import annotations

import copy
from importlib import metadata

import pytest

from lecture_brain import contracts as c
from lecture_brain.resume import ResumeError, ResumeStore
from lecture_brain.review import ReviewError, ReviewStore, rating_from_observations

from helpers import source_ref

SCOPE = {"course_id": "be505", "term": "2026-fall"}
ATTEMPT = {"record_id": "be505-20260906-l01-q01-retry-02", "artifact": {"path": "learning/attempts/2026-09/be505-20260906-l01-q01-retry-02.json", "sha256": "a" * 64, "bytes": 10, "media_type": "application/json"}}
SUBMISSION = {"path": ".agent/course-learning/runs/ll-s/turns/t.json", "sha256": "b" * 64, "bytes": 10, "media_type": "application/json"}


@pytest.fixture()
def reviews(settings):
    return ReviewStore(settings)


def _item(store, be505, item_id="item-ori", selection="active", revision=1, supersedes=None, prompt="Explain what the origin of replication does.", family=("be505.family.question.l01-q01", 1)):
    return {"contract": "ll.review-item/1", "item_id": item_id, "scope": SCOPE, "revision": revision,
            "question": {"question_id": "BE505-L01-Q01", "family_id": family[0] if family else None, "family_revision": family[1] if family else None, "prompt": prompt,
                         "sources": [source_ref(be505)], "attachments": []},
            "kind": "explanation", "selection": selection, "scheduler_config": store.scheduler_config("be505") if selection == "active" else None,
            "supersedes": supersedes, "created_at": "2026-10-04T09:00:00Z"}


def _event(store, event_id, occurred, *, rating="good", basis="reviewed_observation", assistance="none_reported", apply=True, attempt=ATTEMPT, item="item-ori", item_revision=1):
    return {"contract": "ll.review-event/1", "event_id": event_id, "scope": SCOPE, "item_id": item, "item_revision": item_revision, "submission": SUBMISSION, "attempt": attempt,
            "occurred_at": occurred, "rating": rating, "rating_basis": basis, "assistance_before_answer": assistance, "apply_schedule": apply,
            "scheduler_config": store.scheduler_config("be505"), "previous_schedule_revision": None}


def test_scheduler_config_records_exact_library_version_and_no_fuzz(reviews, settings):
    artifact = reviews.scheduler_config("be505")
    config = c.parse_json((settings.write_root("be505") / artifact["path"]).read_bytes())
    assert config["library_version"] == metadata.version("fsrs") and config["config"]["enable_fuzzing"] is False and config["config"]["desired_retention"] == 0.9
    assert reviews.scheduler_config("be505") == artifact  # stable identity


def test_saved_only_is_never_due_and_active_needs_family_and_scheduler(reviews, be505):
    assert reviews.save_item("be505", c.dump_json(_item(reviews, be505, "item-saved", selection="saved_only")))["status"] == "saved"
    assert reviews.save_item("be505", c.dump_json(_item(reviews, be505)))["status"] == "saved"
    rows = {r["item_id"]: r for r in reviews.due_view("be505", now="2026-10-04T10:00:00Z")}
    assert rows["item-saved"]["is_due"] is False and rows["item-saved"]["due_at"] is None and "never due" in rows["item-saved"]["schedule_note"]
    assert rows["item-ori"]["is_due"] is True and rows["item-ori"]["performed_reviews"] == 0
    with pytest.raises(ReviewError):  # active without a family/rubric is not ready for assessed review
        reviews.save_item("be505", c.dump_json(_item(reviews, be505, "item-norubric", family=None)))


def test_edited_item_keeps_previous_prompt_and_rating_history(reviews, be505):
    first = reviews.save_item("be505", c.dump_json(_item(reviews, be505)))
    reviews.record_event("be505", c.dump_json(_event(reviews, "rev-1", "2026-10-04T10:00:00Z")))
    edited = _item(reviews, be505, revision=2, supersedes={"record_id": "item-ori", "artifact": first["artifact"]}, prompt="Explain the origin and name one thing it does not control.")
    assert reviews.save_item("be505", c.dump_json(edited))["status"] == "saved"
    state = reviews.items("be505")
    assert [e["record"]["question"]["prompt"] for e in state["history"]["item-ori"]] == ["Explain what the origin of replication does.", "Explain the origin and name one thing it does not control."]
    row = reviews.due_view("be505", now="2026-10-04T10:00:00Z")[0]
    assert row["revision"] == 2 and row["performed_reviews"] == 1  # history survives the edit; no review event was invented
    stale = _item(reviews, be505, revision=2, supersedes={"record_id": "item-ori", "artifact": first["artifact"]}, prompt="A concurrent edit.")
    assert reviews.save_item("be505", c.dump_json(stale))["status"] == "conflict"


def test_one_event_per_review_and_duplicate_delivery_changes_the_schedule_once(reviews, be505):
    reviews.save_item("be505", c.dump_json(_item(reviews, be505)))
    event = c.dump_json(_event(reviews, "rev-1", "2026-10-04T10:00:00Z"))
    assert reviews.record_event("be505", event)["status"] == "saved"
    once = reviews.due_view("be505", now="2026-10-04T10:00:00Z")
    assert reviews.record_event("be505", event)["status"] == "already_saved"
    assert reviews.due_view("be505", now="2026-10-04T10:00:00Z") == once and once[0]["scheduled_reviews"] == 1 and once[0]["due_at"] > "2026-10-04T10:00:00Z"
    with pytest.raises(ReviewError):
        reviews.record_event("be505", c.dump_json(_event(reviews, "rev-1", "2026-10-04T10:00:00Z", rating="again")))
    assert reviews.due_view("be505", now="2026-10-04T10:00:00Z") == reviews.due_view("be505", now="2026-10-04T10:00:00Z")  # deterministic replay


def test_uncertain_and_assisted_reviews_are_practice_not_ratings(reviews, be505):
    reviews.save_item("be505", c.dump_json(_item(reviews, be505)))
    reviews.record_event("be505", c.dump_json(_event(reviews, "rev-unc", "2026-10-04T10:00:00Z", rating=None, basis="unresolved", apply=False)))
    reviews.record_event("be505", c.dump_json(_event(reviews, "rev-hint", "2026-10-04T11:00:00Z", rating="good", assistance="assisted", apply=False)))
    row = reviews.due_view("be505", now="2026-10-04T12:00:00Z")[0]
    assert row["performed_reviews"] == 2 and row["scheduled_reviews"] == 0 and row["practice_only_reviews"] == 2 and row["pending_grades"] == 1
    assert row["due_at"] is None  # nothing was fed to the scheduler
    for bad in (dict(rating="good", basis="unresolved", apply=False), dict(assistance="assisted", apply=True), dict(attempt=None, apply=True), dict(rating=None, apply=True)):
        with pytest.raises(ReviewError):
            reviews.record_event("be505", c.dump_json(_event(reviews, "rev-bad", "2026-10-04T12:00:00Z", **bad)))


def test_a_later_correction_revises_the_schedule_without_a_new_review(reviews, be505):
    reviews.save_item("be505", c.dump_json(_item(reviews, be505)))
    reviews.record_event("be505", c.dump_json(_event(reviews, "rev-1", "2026-10-04T10:00:00Z", rating="good")))
    good = reviews.due_view("be505", now="2026-10-04T10:00:00Z", effective_observations=lambda attempt: [{"outcome": "demonstrated"}])[0]
    corrected = reviews.due_view("be505", now="2026-10-04T10:00:00Z", effective_observations=lambda attempt: [{"outcome": "not_demonstrated"}])[0]
    assert corrected["performed_reviews"] == good["performed_reviews"] == 1
    assert corrected["due_at"] < good["due_at"]
    unresolved = reviews.due_view("be505", now="2026-10-04T10:00:00Z", effective_observations=lambda attempt: [{"outcome": "uncertain"}])[0]
    assert unresolved["scheduled_reviews"] == 0 and unresolved["pending_grades"] == 1


def test_rating_mapping_never_turns_unobserved_or_uncertain_into_failure():
    assert rating_from_observations([{"outcome": "demonstrated"}, {"outcome": "not_observed"}]) == "good"
    assert rating_from_observations([{"outcome": "partial"}, {"outcome": "demonstrated"}]) == "hard"
    assert rating_from_observations([{"outcome": "not_demonstrated"}]) == "again"
    assert rating_from_observations([{"outcome": "uncertain"}, {"outcome": "demonstrated"}]) is None
    assert rating_from_observations([{"outcome": "not_observed"}]) is None


# ---- resume ----------------------------------------------------------------------------------------
def _checkpoint(be505, checkpoint_id, device, sequence, *, parent=None, page=2, draft=None, updated="2026-10-04T10:00:00Z"):
    return {"contract": "ll.resume/1", "checkpoint_id": checkpoint_id, "device_id": device, "scope": SCOPE, "session_id": "session-1", "sequence": sequence, "parent_checkpoint": parent,
            "cursor": {"lecture_id": "lecture-01", "source": source_ref(be505, page=page), "position_ms": 21000, "panel": "tutor",
                       "draft": c.artifact_for_bytes(draft, "draft.txt", "text/plain") if draft is not None else None},
            "updated_at": updated}


def test_single_lineage_resumes_and_never_autoplays(settings, be505):
    store = ResumeStore(settings)
    a1 = store.save_checkpoint("be505", c.dump_json(_checkpoint(be505, "cp-a1", "device-laptop", 1)))
    store.save_checkpoint("be505", c.dump_json(_checkpoint(be505, "cp-a2", "device-laptop", 2, parent={"record_id": "cp-a1", "artifact": a1["artifact"]}, page=3)))
    state = store.state("be505")
    assert state["conflict"] is None and state["current"]["checkpoint_id"] == "cp-a2" and state["current"]["autoplay"] is False
    assert state["current"]["cursor"]["source"]["locator"]["page"] == 3 and state["current"]["cursor"]["source"]["version_id"].startswith("v1-")


def test_concurrent_drafts_are_both_preserved_and_clock_skew_decides_nothing(settings, be505):
    store = ResumeStore(settings)
    base = store.save_checkpoint("be505", c.dump_json(_checkpoint(be505, "cp-base", "device-laptop", 1)))
    parent = {"record_id": "cp-base", "artifact": base["artifact"]}
    laptop_draft, phone_draft = b"Draft typed on the laptop.", b"Different draft typed on the phone."
    # The phone clock is far ahead; that must not make it authoritative.
    store.save_checkpoint("be505", c.dump_json(_checkpoint(be505, "cp-laptop", "device-laptop", 2, parent=parent, draft=laptop_draft, updated="2026-10-04T10:05:00Z")), laptop_draft)
    store.save_checkpoint("be505", c.dump_json(_checkpoint(be505, "cp-phone", "device-phone", 1, parent=parent, draft=phone_draft, updated="2031-01-01T00:00:00Z")), phone_draft)
    state = store.state("be505")
    assert state["current"] is None and {h["checkpoint_id"] for h in state["conflict"]["heads"]} == {"cp-laptop", "cp-phone"}
    drafts = {h["checkpoint_id"]: store.read_draft("be505", h["cursor"]["draft"]["sha256"]) for h in state["conflict"]["heads"]}
    assert drafts == {"cp-laptop": laptop_draft, "cp-phone": phone_draft}
    store.resolve("be505", chosen_checkpoint_id="cp-laptop", set_aside=["cp-phone"], resolution_id="res-1", at="2026-10-04T10:10:00Z")
    resolved = store.state("be505")
    assert resolved["conflict"] is None and resolved["current"]["checkpoint_id"] == "cp-laptop"
    assert store.read_draft("be505", c.sha256_hex(phone_draft)) == phone_draft  # set aside, not erased


def test_checkpoint_needs_its_draft_bytes_and_ids_are_immutable(settings, be505):
    store = ResumeStore(settings)
    record = _checkpoint(be505, "cp-1", "device-laptop", 1, draft=b"hello")
    with pytest.raises(ResumeError) as err:
        store.save_checkpoint("be505", c.dump_json(record), b"other bytes")
    assert err.value.code == "draft_mismatch"
    store.save_checkpoint("be505", c.dump_json(record), b"hello")
    changed = copy.deepcopy(record)
    changed["cursor"]["position_ms"] = 1
    with pytest.raises(ResumeError) as err:
        store.save_checkpoint("be505", c.dump_json(changed), b"hello")
    assert err.value.code == "checkpoint_conflict"
