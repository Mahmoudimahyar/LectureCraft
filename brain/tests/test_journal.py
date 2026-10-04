"""LL007: local job journal — atomic admission, duplicate identity, fencing, restart, CAS, migrations."""
from __future__ import annotations

import sqlite3
import threading

import pytest

from lecture_brain.journal import (
    AdmissionOutcome,
    Journal,
    JournalError,
    JobState,
    StaleLease,
    UnsafeJournalLocation,
)


class Clock:
    def __init__(self, start: float = 1_800_000_000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def request(request_id="req-1", *, sequence=1, device="dev-a", thread="thread-be505", action="ask", course="be505",
            logical="input-1", parent=None):
    return {
        "request_id": request_id, "logical_input_id": logical, "device_id": device, "sequence": sequence,
        "scope": {"course_id": course, "term": "2026-fall"}, "thread_key": thread, "action": action, "depth": "quick",
        "parent_request_id": parent, "submitted_at": "2026-10-04T10:00:00Z", "expires_at": None,
    }


@pytest.fixture()
def clock():
    return Clock()


@pytest.fixture()
def journal(tmp_path, clock):
    j = Journal.open(tmp_path / "state" / "journal.sqlite", clock=clock)
    yield j
    j.close()


def test_migrations_create_schema_and_wal(tmp_path, clock):
    path = tmp_path / "state" / "journal.sqlite"
    j = Journal.open(path, clock=clock)
    assert j.schema_revision() == j.head_revision()
    assert j.pragma("journal_mode") == "wal"
    assert j.pragma("foreign_keys") == 1
    j.close()
    # Reopening an up-to-date journal is a no-op migration.
    j2 = Journal.open(path, clock=clock)
    assert j2.schema_revision() == j2.head_revision()
    j2.close()


def test_refuses_synced_or_course_locations(tmp_path, clock):
    course_root = tmp_path / "My Drive" / "BE 505"
    course_root.mkdir(parents=True)
    with pytest.raises(UnsafeJournalLocation):
        Journal.open(course_root / ".agent" / "journal.sqlite", clock=clock, synced_roots=[course_root])
    drive = tmp_path / "DriveFS" / "My Drive" / "x"
    drive.mkdir(parents=True)
    with pytest.raises(UnsafeJournalLocation):
        Journal.open(drive / "journal.sqlite", clock=clock)


def test_newer_unknown_schema_is_not_opened(tmp_path, clock):
    path = tmp_path / "journal.sqlite"
    Journal.open(path, clock=clock).close()
    con = sqlite3.connect(path)
    con.execute("UPDATE alembic_version SET version_num='9999_future'")
    con.commit()
    con.close()
    with pytest.raises(JournalError):
        Journal.open(path, clock=clock)


def test_admission_is_idempotent_and_conflicts_on_different_bytes(journal):
    first = journal.admit(request(), manifest_sha256="a" * 64, bundle_ref="inbox/req-1", workflow="WF04", priority=2)
    assert first.outcome is AdmissionOutcome.ADMITTED
    again = journal.admit(request(), manifest_sha256="a" * 64, bundle_ref="inbox/req-1", workflow="WF04", priority=2)
    assert again.outcome is AdmissionOutcome.DUPLICATE and again.job_id == first.job_id
    conflict = journal.admit(request(), manifest_sha256="b" * 64, bundle_ref="inbox/req-1", workflow="WF04", priority=2)
    assert conflict.outcome is AdmissionOutcome.CONFLICT and conflict.job_id is None
    assert len(journal.jobs()) == 1
    kinds = [e["kind"] for e in journal.events(first.job_id)]
    assert "admitted" in kinds
    assert any(e["kind"] == "request_conflict" for e in journal.events())


def test_device_sequence_reuse_conflicts_but_out_of_order_is_accepted(journal):
    assert journal.admit(request("req-5", sequence=5), manifest_sha256="5" * 64, bundle_ref="x", workflow="WF04", priority=2).outcome is AdmissionOutcome.ADMITTED
    # A smaller, independent sequence arriving later is legitimate.
    assert journal.admit(request("req-3", sequence=3), manifest_sha256="3" * 64, bundle_ref="x", workflow="WF04", priority=2).outcome is AdmissionOutcome.ADMITTED
    # The same counter value for a different request is a conflict.
    assert journal.admit(request("req-other", sequence=5), manifest_sha256="6" * 64, bundle_ref="x", workflow="WF04", priority=2).outcome is AdmissionOutcome.CONFLICT


def test_concurrent_identical_admission_creates_one_job(tmp_path, clock):
    path = tmp_path / "journal.sqlite"
    Journal.open(path, clock=clock).close()
    results = []

    def worker():
        j = Journal.open(path, clock=clock)
        try:
            results.append(j.admit(request(), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2).outcome)
        finally:
            j.close()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(AdmissionOutcome.ADMITTED) == 1
    assert results.count(AdmissionOutcome.DUPLICATE) == 7
    j = Journal.open(path, clock=clock)
    assert len(j.jobs()) == 1
    j.close()


def test_parent_dependent_work_waits_for_parent(journal):
    child = journal.admit(request("req-child", sequence=2, parent="req-parent"), manifest_sha256="c" * 64, bundle_ref="x", workflow="WF04", priority=2)
    assert journal.job(child.job_id)["state"] == JobState.WAITING_SYNC
    assert journal.claim("worker-1") is None
    parent = journal.admit(request("req-parent", sequence=1), manifest_sha256="d" * 64, bundle_ref="x", workflow="WF04", priority=2)
    claimed = journal.claim("worker-1")
    assert claimed["job_id"] == parent.job_id
    journal.transition(claimed["job_id"], claimed["lease_token"], JobState.RUNNING)
    journal.transition(claimed["job_id"], claimed["lease_token"], JobState.SUCCEEDED)
    assert journal.job(child.job_id)["state"] == JobState.READY


def test_claim_is_compare_and_swap_with_one_turn_per_thread(journal):
    a = journal.admit(request("req-a", sequence=1), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    journal.admit(request("req-b", sequence=2), manifest_sha256="b" * 64, bundle_ref="x", workflow="WF04", priority=2)
    other = journal.admit(request("req-c", sequence=3, thread="thread-cs542", course="cs542"), manifest_sha256="c" * 64, bundle_ref="x", workflow="WF04", priority=2)
    first = journal.claim("worker-1")
    assert first["job_id"] == a.job_id and first["state"] == JobState.CLAIMED
    # Same thread is busy: the next claim must skip req-b and take the other thread.
    second = journal.claim("worker-2")
    assert second["job_id"] == other.job_id
    assert journal.claim("worker-3") is None


def test_stale_lease_token_cannot_transition_or_publish(journal, clock):
    admitted = journal.admit(request(), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    lease = journal.claim("worker-1", lease_seconds=30)
    clock.advance(31)
    assert journal.reap_expired_leases() == 1  # claimed-not-started returns to READY
    lease2 = journal.claim("worker-2", lease_seconds=30)
    assert lease2["lease_token"] > lease["lease_token"]
    with pytest.raises(StaleLease):
        journal.transition(admitted.job_id, lease["lease_token"], JobState.RUNNING)
    journal.transition(admitted.job_id, lease2["lease_token"], JobState.RUNNING)
    assert journal.job(admitted.job_id)["state"] == JobState.RUNNING


def test_illegal_transition_is_rejected(journal):
    admitted = journal.admit(request(), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    lease = journal.claim("worker-1")
    with pytest.raises(JournalError):
        journal.transition(admitted.job_id, lease["lease_token"], JobState.SUCCEEDED)  # CLAIMED → SUCCEEDED skips RUNNING


def test_restart_recovery_never_blindly_retries_possible_native_work(journal):
    not_started = journal.admit(request("req-a", sequence=1), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    running = journal.admit(request("req-b", sequence=2, thread="t2"), manifest_sha256="b" * 64, bundle_ref="x", workflow="WF04", priority=2)
    staged = journal.admit(request("req-c", sequence=3, thread="t3"), manifest_sha256="c" * 64, bundle_ref="x", workflow="WF05", priority=2)
    la = journal.claim("w")
    lb = journal.claim("w")
    lc = journal.claim("w")
    by_job = {l["job_id"]: l for l in (la, lb, lc)}
    journal.transition(running.job_id, by_job[running.job_id]["lease_token"], JobState.RUNNING)
    journal.record_dispatch(running.job_id, by_job[running.job_id]["lease_token"], dispatch_id="disp-1", adapter="fixture", native_thread_id="thr", native_turn_id=None)
    journal.transition(staged.job_id, by_job[staged.job_id]["lease_token"], JobState.RUNNING)
    journal.transition(staged.job_id, by_job[staged.job_id]["lease_token"], JobState.STAGED)

    report = journal.recover_after_restart()
    assert journal.job(not_started.job_id)["state"] == JobState.READY
    assert journal.job(running.job_id)["state"] == JobState.UNCERTAIN_COMPLETION
    assert journal.job(staged.job_id)["state"] == JobState.STAGED  # reconcile publication, do not rerun
    assert report == {"requeued": 1, "uncertain": 1, "staged_for_reconcile": 1}
    # Uncertain work is not claimable until it is explicitly reconciled.
    assert journal.claim("w2")["job_id"] == not_started.job_id
    assert journal.claim("w2") is None


def test_cancel_before_start_is_terminal_and_during_run_is_a_request(journal):
    queued = journal.admit(request("req-a", sequence=1), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    assert journal.request_cancel("req-a") == JobState.CANCELLED
    assert journal.job(queued.job_id)["state"] == JobState.CANCELLED

    running = journal.admit(request("req-b", sequence=2), manifest_sha256="b" * 64, bundle_ref="x", workflow="WF04", priority=2)
    lease = journal.claim("w")
    journal.transition(running.job_id, lease["lease_token"], JobState.RUNNING)
    generation_before = journal.job(running.job_id)["generation"]
    assert journal.request_cancel("req-b") == JobState.RUNNING  # cancellation requested, not terminal
    job = journal.job(running.job_id)
    assert job["cancel_requested"] is True and job["generation"] == generation_before + 1
    # The late result of the fenced generation must not publish as current.
    assert journal.is_current_generation(running.job_id, generation_before) is False


def test_priority_and_aging_prevent_starvation(journal, clock):
    background = journal.admit(request("req-bg", sequence=1, thread="t-bg", action="resume"), manifest_sha256="1" * 64, bundle_ref="x", workflow="WF02", priority=4)
    clock.advance(4000)  # aged past the starvation threshold
    interactive = journal.admit(request("req-int", sequence=2, thread="t-int"), manifest_sha256="2" * 64, bundle_ref="x", workflow="WF04", priority=2)
    first = journal.claim("w", aging_seconds=3600)
    assert first["job_id"] == background.job_id
    assert journal.claim("w", aging_seconds=3600)["job_id"] == interactive.job_id


def test_retry_policy_is_bounded_and_scheduled(journal, clock):
    admitted = journal.admit(request(), manifest_sha256="a" * 64, bundle_ref="x", workflow="WF04", priority=2)
    for attempt in range(2):
        lease = journal.claim("w")
        assert lease is not None
        journal.transition(admitted.job_id, lease["lease_token"], JobState.RUNNING)
        state = journal.fail_retryable(admitted.job_id, lease["lease_token"], reason="transport_unavailable", max_retries=2, backoff_seconds=60)
        assert state == JobState.FAILED_RETRYABLE
        assert journal.claim("w") is None  # backoff not elapsed
        clock.advance(60 * (2 ** attempt) + 1)
    lease = journal.claim("w")
    journal.transition(admitted.job_id, lease["lease_token"], JobState.RUNNING)
    assert journal.fail_retryable(admitted.job_id, lease["lease_token"], reason="transport_unavailable", max_retries=2, backoff_seconds=60) == JobState.FAILED_FINAL
    assert journal.claim("w") is None


def test_idle_journal_records_zero_model_requests(journal):
    assert journal.claim("w") is None
    assert journal.counts()["dispatches"] == 0
