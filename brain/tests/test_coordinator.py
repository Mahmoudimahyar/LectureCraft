"""LL021 / LL022 / LL023 / LL026 / LL027: coordinator joins admission, native turn and owning writers."""
from __future__ import annotations

import json

import pytest

from lecture_brain import contracts as c
from lecture_brain.config import load_settings
from lecture_brain.coordinator import Coordinator
from lecture_brain.journal import Journal, JobState as S
from lecture_brain.native import UnverifiedNativeAdapter
from lecture_brain.native.fixture_tutor import BANNER, FixtureTutorAdapter
from lecture_brain.ownerio.attempts import read_attempt_records
from lecture_brain.transport import signing
from lecture_brain.transport.bundles import read_manifest
from lecture_brain.transport.pairing import PairingRegistry

from helpers import Device, make_request_bundle, pair, question_message, source_ref, submission

Q1 = ("be505.family.question.l01-q01", 1)
GOOD = "States that plasmid replication starts at the origin and that it does not control expression of the gene."


class Env:
    def __init__(self, settings, clock, adapter_cls=FixtureTutorAdapter):
        self.settings, self.clock = settings, clock
        self.journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
        self.pairing = PairingRegistry(self.journal)
        self.device = Device()
        pair(self.pairing, self.device)
        self.adapter = adapter_cls(journal=self.journal) if adapter_cls is FixtureTutorAdapter else adapter_cls()
        self.coordinator = Coordinator(settings, journal=self.journal, pairing=self.pairing, adapter=self.adapter, clock=clock)
        self.root = settings.course("be505").root
        self._seq = 0

    def send(self, request_id, action, payload, **kw):
        self._seq += 1
        return make_request_bundle(self.settings, self.device, request_id=request_id, action=action, payload=payload, sequence=self._seq, **kw)

    def ask(self, request_id="req-ask", text="What does the origin do?", **kw):
        return self.send(request_id, "ask", question_message(self.settings, request_id, text, [source_ref(self.root)]), **kw)

    def explain(self, request_id="req-exp", text=GOOD, family=Q1, question_id="BE505-L01-Q01", action="explain", interaction="explain_back", **kw):
        sub = submission(request_id, text=text, prompt="Explain what the origin of replication does.", question_id=question_id, family=family, interaction=interaction,
                         sources=[source_ref(self.root)], **{k: kw.pop(k) for k in ("logical", "conditions") if k in kw})
        self.send(request_id, action, sub, depth="standard", **kw)
        return sub

    def job(self, request_id):
        return self.journal.job_for_request(request_id)

    def result(self, request_id, generation=1):
        directory = self.settings.app_area("be505") / "outbox" / request_id / f"g{generation}"
        if not (directory / "ready.json").is_file():
            return None
        manifest_bytes, manifest = read_manifest(directory)
        signature = json.loads((directory / "ready.sig.json").read_text())
        files = {f["path"]: json.loads((directory / f["path"]).read_text(encoding="utf-8")) for f in manifest["files"]}
        return {"manifest": manifest, "manifest_bytes": manifest_bytes, "signature": signature, "dir": directory, **{k.removesuffix(".json"): v for k, v in files.items()}}

    def attempts(self):
        return read_attempt_records(self.root, "be505")

    def mode(self, mode):
        self.journal.set_value("fixture-native-mode", mode)


@pytest.fixture()
def env(settings, clock):
    e = Env(settings, clock)
    yield e
    e.journal.close()


# ---- LL022 quick answer --------------------------------------------------------------------------
def test_quick_answer_end_to_end_is_signed_sourced_and_not_assessed(env):
    before = env.attempts()
    env.ask()
    summary = env.coordinator.tick()
    assert [r["state"] for r in summary["ran"]] == ["SUCCEEDED"]
    result = env.result("req-ask")
    brain_key = signing.load_or_create_brain_key(env.settings.keys_dir).public_key()
    assert signing.verify_manifest(brain_key, result["manifest_bytes"], result["signature"]) is True
    assert c.verify_files(result["dir"], result["manifest"]) == []
    assert result["manifest"]["kind"] == "result" and result["manifest"]["predecessor_manifest"] == env.journal.admission("req-ask")["manifest_sha256"]
    for name in ("publication", "message", "native-result", "context"):
        assert c.validate(name, result[name]) == [], name
    assert result["publication"]["kind"] == "none" and result["publication"]["status"] == "not_requested" and result["publication"]["canonical_record"] is None
    assert result["message"]["role"] == "tutor" and result["message"]["assessment_disposition"] == "not_assessed" and result["message"]["text"].startswith(BANNER)
    assert result["message"]["sources"] == [source_ref(env.root)]  # the answer cites the source that was actually loaded
    assert result["context"]["sources"] == [source_ref(env.root)] and result["context"]["native_history_blind"] is False
    assert result["native-result"]["context_receipt"]["sha256"] and result["native-result"]["terminal"] is True
    # No fake attempt and no loss of prior evidence.
    after = env.attempts()
    assert set(after["attempts"]) == set(before["attempts"]) and after["effective"] == before["effective"]
    assert not list((env.root / "learning/attempts").glob("2026-10/*"))


def test_input_survives_when_native_is_not_verified_and_nothing_is_substituted(settings, clock):
    env = Env(settings, clock, adapter_cls=UnverifiedNativeAdapter)
    try:
        env.ask(text="A question typed while the native route is unavailable.")
        env.coordinator.tick()
        job = env.job("req-ask")
        assert job["state"] == S.AUTH_REQUIRED and "not verified" in job["waiting_reason"]
        captured = list(env.settings.runs_area("be505").rglob("messages/*.json"))
        assert len(captured) == 1 and "typed while the native route is unavailable" in captured[0].read_text(encoding="utf-8")
        assert env.result("req-ask") is None and env.journal.counts()["dispatches"] == 0  # no canned answer, no other provider
    finally:
        env.journal.close()


def test_idle_supervisor_makes_no_native_call(env):
    for _ in range(3):
        assert env.coordinator.tick()["ran"] == []
    assert env.adapter.calls == 0 and env.journal.counts()["dispatches"] == 0


# ---- LL023 explain back ---------------------------------------------------------------------------
def test_explain_back_freezes_input_before_inference_and_saves_one_attempt(env, monkeypatch):
    seen = {}
    original = env.adapter.submit

    def spy(submission_):
        seen["captured_before_dispatch"] = [p.name for p in env.settings.runs_area("be505").rglob("turns/*.json")]
        return original(submission_)

    monkeypatch.setattr(env.adapter, "submit", spy)
    sub = env.explain()
    env.coordinator.tick()
    assert seen["captured_before_dispatch"] == ["turn-req-exp.json"]
    result = env.result("req-exp")
    pub = result["publication"]
    assert pub["status"] == "saved" and pub["kind"] == "attempt" and pub["view_status"] == "stale"
    assert result["message"]["assessment_disposition"] == "canonical_saved" and result["message"]["reply_to_turn"] == "turn-req-exp"
    record = json.loads((env.root / pub["canonical_record"]["artifact"]["path"]).read_text(encoding="utf-8"))
    assert record["question"]["family_id"] == Q1[0] and record["question"]["family_revision"] == 1
    assert [o["skill_id"] for o in record["observations"]] == ["be505.skill.ori.explain"]  # exactly the frozen family's skills
    assert record["observations"][0]["outcome"] == "demonstrated" and record["response_evidence"]["excerpt"] == sub["response"]["text"]
    assert env.job("req-exp")["state"] == S.SUCCEEDED
    assert len(env.attempts()["attempts"]) == 5
    # The frozen submission is byte-identical after the tutor replied.
    assert env.coordinator.capture.verify("be505", pub["captured_submission"])["response"]["text"] == sub["response"]["text"]
    assert result["detail"]["criteria"][0]["skill_id"] == "be505.skill.ori.explain"
    # Re-scanning and re-ticking never produces a second attempt or a second dispatch.
    env.coordinator.tick()
    assert len(env.attempts()["attempts"]) == 5 and env.adapter.calls == 1


def test_alternative_wording_is_judged_by_criteria_and_uncertainty_is_supported(env):
    env.explain("req-short", text="ok")  # too short to judge: the double reports uncertainty rather than a failure
    env.coordinator.tick()
    record_path = env.result("req-short")["publication"]["canonical_record"]["artifact"]["path"]
    record = json.loads((env.root / record_path).read_text(encoding="utf-8"))
    assert record["observations"][0]["outcome"] == "uncertain" and record["observations"][0]["error_types"] == []


def test_missing_family_keeps_capture_as_assessment_pending(env):
    sub = env.explain("req-nofam", family=None, question_id=None, text="My explanation of slide four.")
    env.coordinator.tick()
    job = env.job("req-nofam")
    assert job["state"] == S.WAITING_REVIEW and "Assessment pending" in job["waiting_reason"]
    result = env.result("req-nofam")
    assert result["publication"]["status"] == "blocked" and result["publication"]["canonical_record"] is None and result["publication"]["captured_submission"]["sha256"]
    assert result["message"]["assessment_disposition"] == "unavailable"
    assert env.coordinator.capture.verify("be505", result["publication"]["captured_submission"])["response"]["text"] == sub["response"]["text"]
    assert len(env.attempts()["attempts"]) == 4


def test_malformed_tutor_output_is_kept_as_text_with_no_invented_grade(env):
    env.mode("malformed")
    env.explain("req-malformed")
    env.coordinator.tick()
    assert env.job("req-malformed")["state"] == S.WAITING_REVIEW
    result = env.result("req-malformed")
    assert result["publication"]["status"] == "blocked" and "plain text reply" in result["message"]["text"] and len(env.attempts()["attempts"]) == 4


def test_canonical_save_blocked_still_delivers_feedback_and_keeps_capture(workspace, tmp_path, clock):
    settings = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")
    settings.profile = "fixture"  # use the labeled double for the turn while course writes stay disabled
    settings.course_writes_enabled = False
    env = Env(settings, clock)
    try:
        env.explain()
        env.coordinator.tick()
        job = env.job("req-exp")
        assert job["state"] == S.WAITING_REVIEW and job["waiting_reason"].startswith("Awaiting course save")
        result = env.result("req-exp")
        assert result["publication"]["status"] == "blocked" and result["message"]["assessment_disposition"] == "provisional"
        assert not list((env.root / "learning/attempts").glob("2026-10/*"))
    finally:
        env.journal.close()


def test_same_learner_input_resent_under_a_new_request_is_not_a_second_attempt(env):
    env.explain("req-first", logical="input-shared")
    env.coordinator.tick()
    env.explain("req-second", logical="input-shared")
    env.coordinator.tick()
    second = env.result("req-second")["publication"]
    assert second["status"] == "blocked" and "already saved" in second["reason"]
    assert len(env.attempts()["attempts"]) == 5 and env.adapter.calls == 1


# ---- uncertain completion, cancellation, retry -----------------------------------------------------
def test_unknown_completion_is_reconciled_and_never_blindly_resent(env):
    env.mode("completion_unknown")
    env.explain()
    env.coordinator.tick()
    job = env.job("req-exp")
    assert job["state"] == S.UNCERTAIN_COMPLETION and env.result("req-exp") is None
    env.mode("normal")
    for _ in range(3):
        env.coordinator.tick()
    assert env.adapter.calls == 1 and env.job("req-exp")["state"] == S.UNCERTAIN_COMPLETION
    assert env.coordinator.reconcile(job["job_id"]) == S.SUCCEEDED
    assert env.adapter.calls == 1  # status check only
    assert env.result("req-exp")["publication"]["status"] == "saved" and len(env.attempts()["attempts"]) == 5


def test_cancel_before_start_is_terminal_and_keeps_input(env):
    env.journal.set_value("supervisor-paused", True)
    env.ask("req-a")
    env.coordinator.tick()  # admitted, not started (paused)
    env.journal.set_value("supervisor-paused", False)
    env.send("req-cancel", "cancel", {"contract": "ll.control/1", "event_id": "evt-c1", "request_id": "req-cancel", "scope": {"course_id": "be505", "term": "2026-fall"},
                                      "created_at": "2026-10-04T10:00:00Z", "command": {"kind": "cancel", "target_request_id": "req-a", "reason": "changed my mind"}})
    env.coordinator.tick()
    assert env.job("req-a")["state"] == S.CANCELLED and env.adapter.calls == 0
    assert env.result("req-cancel")["detail"]["target_state"] == "CANCELLED"
    assert (env.settings.app_area("be505") / "inbox" / "req-a" / "payload.json").is_file()  # captured request input is not erased


def test_late_result_after_cancellation_is_kept_as_late_and_not_published_or_saved(env):
    env.mode("completion_unknown")
    env.explain()
    env.coordinator.tick()
    job = env.job("req-exp")
    env.send("req-cancel", "cancel", {"contract": "ll.control/1", "event_id": "evt-c2", "request_id": "req-cancel", "scope": {"course_id": "be505", "term": "2026-fall"},
                                      "created_at": "2026-10-04T10:00:00Z", "command": {"kind": "cancel", "target_request_id": "req-exp", "reason": "stop"}})
    env.coordinator.tick()
    assert env.job("req-exp")["state"] == S.UNCERTAIN_COMPLETION and env.job("req-exp")["cancel_requested"] is True  # requested, not terminal
    assert "not terminal" in env.result("req-cancel")["publication"]["reason"]
    assert env.coordinator.reconcile(job["job_id"]) == S.CANCELLED  # the turn had completed natively: its result is late
    assert env.result("req-exp") is None and len(env.attempts()["attempts"]) == 4
    assert any(r["kind"] == "late-result" for r in env.journal.receipts(job["job_id"]))
    assert env.coordinator.capture.verify("be505", env.journal.receipts(job["job_id"], "capture")[0] | {"path": env.journal.receipts(job["job_id"], "capture")[0]["ref"], "bytes": len((env.settings.write_root("be505") / env.journal.receipts(job["job_id"], "capture")[0]["ref"]).read_bytes()), "media_type": "application/json"})


def test_explicit_retry_uses_a_new_dispatch_for_the_same_learner_input(env):
    env.mode("completion_unknown")
    sub = env.explain()
    env.coordinator.tick()
    job = env.job("req-exp")
    env.mode("normal")
    assert env.coordinator.retry(job["job_id"]) == S.READY
    env.coordinator.tick()
    dispatches = env.journal.dispatches(job["job_id"])
    assert len(dispatches) == 2 and dispatches[0]["dispatch_id"] != dispatches[1]["dispatch_id"] and dispatches[1]["generation"] == 2
    result = env.result("req-exp", generation=2)
    assert result["publication"]["status"] == "saved" and env.result("req-exp", generation=1) is None
    record = json.loads((env.root / result["publication"]["canonical_record"]["artifact"]["path"]).read_text(encoding="utf-8"))
    assert record["attempt_id"] == Coordinator._attempt_id("be505", sub["logical_input_id"]) and len(env.attempts()["attempts"]) == 5


@pytest.mark.parametrize("mode,state", [("quota_wait", S.QUOTA_WAIT), ("auth_required", S.AUTH_REQUIRED), ("approval_pending", S.WAITING_USER), ("fail", S.FAILED_FINAL)])
def test_native_pauses_are_visible_states_and_do_not_starve_other_jobs(env, mode, state):
    env.mode(mode)
    env.ask("req-blocked")
    env.coordinator.tick()
    assert env.job("req-blocked")["state"] == state and env.job("req-blocked")["waiting_reason"]
    env.mode("normal")
    env.ask("req-other", course="be562") if False else env.send("req-note", "save_note", {
        "contract": "ll.control/1", "event_id": "evt-n1", "request_id": "req-note", "scope": {"course_id": "be505", "term": "2026-fall"}, "created_at": "2026-10-04T10:00:00Z",
        "command": {"kind": "save_note", "text": "Remember: replication is not transcription.", "sources": [source_ref(env.root)], "attachments": []}})
    env.coordinator.tick()
    assert env.job("req-note")["state"] == S.SUCCEEDED  # an independent job still completes
    assert env.adapter.calls == 1  # the failed job was not retried in a loop


def test_interrupted_commit_resumes_with_the_same_candidate_exactly_once(env, monkeypatch):
    calls = {"n": 0}
    real = env.coordinator.writer.publish_attempt

    def crash_once(*args, **kwargs):
        calls["n"] += 1
        receipt = real(*args, **kwargs)  # the owner save happens...
        if calls["n"] == 1:
            raise RuntimeError("simulated crash right after the owner commit")
        return receipt

    monkeypatch.setattr(env.coordinator.writer, "publish_attempt", crash_once)
    env.explain()
    with pytest.raises(RuntimeError):
        env.coordinator.tick()
    job = env.job("req-exp")
    assert job["state"] == S.COMMIT_PENDING and len(env.attempts()["attempts"]) == 5
    assert env.journal.recover_after_restart()["staged_for_reconcile"] == 1
    env.clock.advance(120)
    assert env.coordinator.reconcile(job["job_id"]) == S.SUCCEEDED
    assert env.result("req-exp")["publication"]["status"] == "already_saved"  # same bytes: recognised, not duplicated
    assert len(env.attempts()["attempts"]) == 5 and env.adapter.calls == 1


# ---- LL026 diagnosis with a real WAITING_USER continuation ------------------------------------------
def test_diagnostic_waits_for_real_input_and_stops_after_the_short_detour(env):
    env.explain("req-wrong", text="The origin is the part where the gene gets switched on by the polymerase.")
    env.coordinator.tick()
    first = env.result("req-wrong")
    assert first["detail"]["diagnostic"]["next_prompt"]  # offered, not auto-run
    assert env.adapter.calls == 1
    prompt = first["detail"]["diagnostic"]["next_prompt"]
    d1 = submission("req-d1", text="The plasmid would still be copied.", prompt=prompt, question_id=None, family=None, interaction="diagnostic_answer")
    env.send("req-d1", "diagnose", d1, parent="req-wrong")
    env.coordinator.tick()
    job1 = env.job("req-d1")
    assert job1["state"] == S.WAITING_USER and "Waiting for your answer" in job1["waiting_reason"]
    r1 = env.result("req-d1")
    assert r1["publication"]["kind"] == "none" and r1["message"]["assessment_disposition"] == "not_assessed"
    assert r1["detail"]["diagnostic"]["status"] == "waiting_user" and r1["detail"]["diagnostic"]["hypotheses"][0]["alternative_causes"]
    calls = env.adapter.calls
    for _ in range(3):
        env.coordinator.tick()
    assert env.adapter.calls == calls  # a pending question does not answer itself
    assert len(env.attempts()["attempts"]) == 5  # diagnostic answers are not canonical attempts; no learner response was generated
    d2 = submission("req-d2", text="Because the origin is intact; the promoter only matters for the product.", prompt=r1["detail"]["diagnostic"]["next_prompt"], question_id=None,
                    family=None, interaction="diagnostic_answer")
    env.send("req-d2", "diagnose", d2, parent="req-d1")
    env.coordinator.tick()
    assert env.job("req-d1")["state"] == S.SUCCEEDED  # answered by the learner
    assert env.job("req-d2")["state"] == S.SUCCEEDED
    assert env.result("req-d2")["detail"]["diagnostic"]["next_prompt"] is None and env.result("req-d2")["detail"]["diagnostic"]["followups_used"] == 2


# ---- LL027 disputes ---------------------------------------------------------------------------------
def _dispute(env, request_id, attempt_id, reason="I did state that it does not control expression."):
    attempt = env.attempts()["attempts"][attempt_id]
    ref = {"record_id": attempt_id, "artifact": {"path": attempt["_path"], "sha256": attempt["_sha256"], "bytes": attempt["_bytes"], "media_type": "application/json"}}
    env.send(request_id, "correct_assessment", {"contract": "ll.control/1", "event_id": f"evt-{request_id}", "request_id": request_id, "scope": {"course_id": "be505", "term": "2026-fall"},
                                                "created_at": "2026-10-04T10:00:00Z", "command": {"kind": "correct_assessment", "attempt": ref, "reason": reason, "support": []}})


def test_dispute_creates_a_nonbranching_revision_for_the_same_skills(env, monkeypatch):
    env.explain("req-exp", text="The origin is where things begin for the plasmid in the cell somehow.")
    env.coordinator.tick()
    attempt_id = env.result("req-exp")["publication"]["canonical_record"]["record_id"]
    assert env.attempts()["effective"][attempt_id]["observations"][0]["outcome"] != "demonstrated"
    # The (double) regrade now judges the same frozen response differently.
    from lecture_brain.native import fixture_tutor

    monkeypatch.setattr(fixture_tutor, "_grade", lambda response, observable: ("demonstrated", []))
    _dispute(env, "req-dispute", attempt_id)
    env.coordinator.tick()
    result = env.result("req-dispute")
    assert result["publication"]["kind"] == "assessment_revision" and result["publication"]["status"] == "saved"
    records = env.attempts()
    assert len(records["attempts"]) == 5 and len(records["revisions"]) == 2 and records["problems"] == []  # no new learner attempt
    effective = records["effective"][attempt_id]
    assert effective["observations"][0]["outcome"] == "demonstrated" and effective["chain"][0] == attempt_id
    assert records["attempts"][attempt_id]["observations"][0]["outcome"] != "demonstrated"  # original evidence preserved
    assert result["detail"]["previous_outcomes"] == {"be505.skill.ori.explain": records["attempts"][attempt_id]["observations"][0]["outcome"]}


def test_dispute_that_changes_nothing_writes_no_revision(env):
    env.explain()
    env.coordinator.tick()
    attempt_id = env.result("req-exp")["publication"]["canonical_record"]["record_id"]
    _dispute(env, "req-dispute", attempt_id, reason="Please double-check.")
    env.coordinator.tick()
    result = env.result("req-dispute")
    assert result["publication"]["kind"] == "none" and "unchanged" in result["publication"]["reason"]
    assert len(env.attempts()["revisions"]) == 1  # only the fixture's pre-existing revision


def test_dispute_of_a_legacy_attempt_without_capture_goes_to_review_not_regrade(env):
    _dispute(env, "req-legacy", "be505-20260905-l01-q01-teachback-01")
    env.coordinator.tick()
    job = env.job("req-legacy")
    assert job["state"] == S.WAITING_REVIEW and "no verifiable full-turn capture" in job["waiting_reason"]
    assert env.adapter.calls == 0 and len(env.attempts()["revisions"]) == 1


# ---- deterministic owner workflows -------------------------------------------------------------------
def test_owner_workflows_publish_typed_receipts_without_a_native_turn(env):
    from lecture_brain.annotations import AnnotationStore

    head = AnnotationStore(env.settings).load("be505")["current"]["ann-l01-s01-o1-displayed"]
    revised = json.loads(json.dumps(head["record"]))
    revised.update(revision=2, supersedes={"record_id": revised["annotation_id"], "artifact": head["artifact"]}, created_at="2026-10-04T12:00:00Z")
    revised["to"]["locator"].update(start_ms=1000, end_ms=14000)
    env.send("req-link", "correct_source", revised)
    stale = json.loads(json.dumps(revised))
    stale["to"]["locator"].update(start_ms=2000, end_ms=13000)
    env.send("req-link-2", "correct_source", stale)
    env.send("req-hint", "source_hint", {"contract": "ll.control/1", "event_id": "evt-h", "request_id": "req-hint", "scope": {"course_id": "be505", "term": "2026-fall"},
                                         "created_at": "2026-10-04T10:00:00Z", "command": {"kind": "source_hint", "drive_file_ids": ["1AbCdEf"], "reason": "new slides uploaded"}})
    env.coordinator.tick()
    link = env.result("req-link")["publication"]
    assert link["kind"] == "source_annotation" and link["status"] == "saved" and link["canonical_record"]["artifact"]["path"].endswith(".r2.json")
    assert env.job("req-link-2")["state"] == S.WAITING_USER and "Both versions are kept" in env.job("req-link-2")["waiting_reason"]
    assert env.result("req-hint")["publication"]["kind"] == "none"
    assert any(j["workflow"] == "WF02" and j["request_id"] is None for j in env.journal.jobs())
    assert env.adapter.calls == 0
