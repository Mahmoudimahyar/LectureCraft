"""The course-tutor pilot: an explicit, separate profile with a course allowlist and a persisted native budget.

The pilot lets a restricted, app-created Codex worker answer for one allow-listed course. It is not the desktop
course chats and never replaces them silently. These tests run against the labeled protocol double; no inference.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

from lecture_brain.config import ConfigError, load_settings
from lecture_brain.journal import JobState as S
from lecture_brain.native import NativeBlocked, NativeSubmission, UnverifiedNativeAdapter, resolve_target, select_adapter
from lecture_brain.native.fixture_tutor import FixtureTutorAdapter
from lecture_brain.native.pilot import PilotLedger, PilotWorkerAdapter
from lecture_brain.ownerio.attempts import read_attempt_records
from lecture_brain.tutoring.outputs import parse_tutor_output

from helpers import make_request_bundle, question_message, source_ref, submission
from test_coordinator import Env

FAKE = Path(__file__).with_name("fake_app_server.py")
PLANNER = ("University", "Fixture Brain", "planner-config.yaml")
GRANT = {"label": "Experimental Codex worker tutor", "courses": ["be505"], "max_threads": 1, "max_turns": 4}


def prompt_text(private, native):
    return (private / "pilot" / "prompts" / f"{native['dispatch_id']}.txt").read_text(encoding="utf-8")


def _tree(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


@pytest.fixture()
def pilot(workspace, tmp_path, monkeypatch):
    monkeypatch.setenv("LL_FAKE_STATE", str(tmp_path / "double-state.json"))
    settings = load_settings("pilot", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "pilot-state", pilot=dict(GRANT))
    settings.native_binding = {"adapter": "codex-app-server", "executable": sys.executable, "sandbox": "read-only", "approval_policy": "never"}
    return settings


def _adapter(settings, tmp_path, mode="normal"):
    log = tmp_path / f"pilot-{mode}.log"
    return PilotWorkerAdapter(settings, argv_prefix=[sys.executable, str(FAKE), mode, str(log)]), log


def _calls(log):
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []


def _env(settings, clock, tmp_path, mode="normal"):
    adapter, log = _adapter(settings, tmp_path, mode)
    env = Env(settings, clock, adapter_cls=lambda: adapter)
    return env, log


def _sub(settings, n, course="be505", prompt="Reply with exactly this line and nothing else: ok"):
    target = resolve_target(settings, course_id=course, request_binding_revision=settings.binding_revision, request_thread_key=settings.course(course).thread_key)
    return NativeSubmission(f"disp-{n}", f"req-{n}", target, prompt, 15.0)


# ---- profile separation ------------------------------------------------------------------------------------------
def test_pilot_is_a_separate_profile_and_the_local_profile_keeps_its_unconditional_guards(workspace, tmp_path, pilot):
    assert pilot.profile == "pilot" and pilot.course_writes_enabled is False and pilot.native_dispatch_enabled is True
    # Environment flags cannot switch course writes on in the pilot.
    forced = load_settings("pilot", env={"LL_COURSE_WRITES_ENABLED": "true"}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "p2", pilot=dict(GRANT))
    assert forced.course_writes_enabled is False
    # The read-only profile is unchanged by the existence of a pilot grant: no dispatch, no writes, no worker.
    local = load_settings("local", env={"LL_NATIVE_ENABLED": "true", "LL_COURSE_WRITES_ENABLED": "true"}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "local", pilot=dict(GRANT))
    assert local.native_dispatch_enabled is False and local.course_writes_enabled is False and isinstance(select_adapter(local), UnverifiedNativeAdapter)
    with pytest.raises(NativeBlocked):
        resolve_target(local, course_id="be505", request_binding_revision=local.binding_revision, request_thread_key="tutor-be505")
    # A pilot needs an explicit grant, and its history never shares a folder with another profile's.
    with pytest.raises(ConfigError, match="pilot"):
        load_settings("pilot", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "p3", pilot={})
    with pytest.raises(ConfigError, match="more than"):
        load_settings("pilot", env={}, planner_config=workspace.joinpath(*PLANNER), state_dir=tmp_path / "p4", pilot=dict(GRANT, max_turns=5))
    adapter = select_adapter(pilot)
    assert isinstance(adapter, PilotWorkerAdapter) and adapter.is_test_double is False and not isinstance(adapter, FixtureTutorAdapter)
    assert adapter.label == "Experimental Codex worker tutor" and adapter.capabilities()["desktop_thread_integration"] == "unresolved"


def test_a_course_outside_the_allowlist_and_a_stale_request_are_refused_without_using_the_budget(pilot, tmp_path):
    adapter, log = _adapter(pilot, tmp_path)
    with pytest.raises(NativeBlocked) as err:
        resolve_target(pilot, course_id="be562", request_binding_revision=pilot.binding_revision, request_thread_key="tutor-be562")
    assert err.value.code == "pilot_course_not_allowed"
    with pytest.raises(NativeBlocked) as err:
        resolve_target(pilot, course_id="be505", request_binding_revision="0" * 64, request_thread_key="tutor-be505")
    assert err.value.code == "stale_binding"
    with pytest.raises(NativeBlocked) as err:
        resolve_target(pilot, course_id="be505", request_binding_revision=pilot.binding_revision, request_thread_key="tutor-be562")
    assert err.value.code == "wrong_thread"
    assert PilotLedger(pilot).state()["turns"] == [] and _calls(log) == []


# ---- budget ----------------------------------------------------------------------------------------------------------
def test_four_turns_on_one_thread_then_the_grant_is_exhausted_even_after_a_restart(pilot, tmp_path):
    adapter, log = _adapter(pilot, tmp_path)
    for n in (1, 2):
        assert adapter.submit(_sub(pilot, n)).state == "completed"
    adapter, _ = _adapter(pilot, tmp_path)  # a restart: a new adapter object reads the persisted budget
    for n in (3, 4):
        result = adapter.submit(_sub(pilot, n))
        assert result.state == "completed" and result.detail["native_thread_id"] == PilotLedger(pilot).state()["thread"]["thread_id"]
    state = PilotLedger(pilot).state()
    assert [t["slot"] for t in state["turns"]] == [1, 2, 3, 4] and state["remaining_turns"] == 0 and state["max_turns"] == 4
    assert all(t["prompt_sha256"] and t["turn_id"] and t["outcome"] == "completed" for t in state["turns"])
    methods = [c["method"] for c in _calls(log)]
    assert methods.count("thread/start") == 1 and methods.count("thread/resume") == 3 and methods.count("turn/start") == 4  # one thread, ever
    adapter, _ = _adapter(pilot, tmp_path)
    with pytest.raises(NativeBlocked) as err:
        adapter.submit(_sub(pilot, 5))
    assert err.value.code == "pilot_budget_exhausted"
    assert [c["method"] for c in _calls(log)].count("turn/start") == 4
    # Every prompt that was sent is kept in the pilot's private store.
    assert sorted(p.name for p in (pilot.state_dir / "pilot" / "prompts").glob("*.txt")) == ["disp-1.txt", "disp-2.txt", "disp-3.txt", "disp-4.txt"]


def test_an_unclear_acceptance_uses_a_slot_and_a_replayed_dispatch_is_reconciled_never_resent(pilot, tmp_path):
    adapter, log = _adapter(pilot, tmp_path, "silent")
    first = adapter.submit(NativeSubmission("disp-1", "req-1", _sub(pilot, 1).target, "anything", 1.5))
    assert first.state == "completion_unknown" and PilotLedger(pilot).state()["remaining_turns"] == 3
    again = adapter.submit(NativeSubmission("disp-1", "req-1", _sub(pilot, 1).target, "anything", 1.5))  # the same dispatch replayed
    assert again.state == "completion_unknown" and "not sent again" in again.detail["note"]
    assert [c["method"] for c in _calls(log)].count("turn/start") == 1 and PilotLedger(pilot).state()["remaining_turns"] == 3


def test_a_turn_the_worker_never_acknowledges_has_used_its_slot(pilot, tmp_path):
    log = tmp_path / "pilot-no-ack.log"
    adapter = PilotWorkerAdapter(pilot, argv_prefix=[sys.executable, str(FAKE), "no-ack", str(log)], handshake_timeout=4.0)
    result = adapter.submit(_sub(pilot, 1))
    assert result.state == "completion_unknown" and "not re-sent" in result.detail["note"]
    state = PilotLedger(pilot).state()
    assert state["remaining_turns"] == 3 and state["turns"][0]["outcome"] == "completion_unknown"


@pytest.mark.parametrize("mode,failed", [("ignores-sandbox", "effective_sandbox_read_only"), ("tools-stay", "no_enabled_tool_servers"), ("hooks", "no_hooks_or_notify_program"),
                                         ("apikey", "managed_chatgpt_signin"), ("instructions", "thread_has_no_instruction_files"), ("thread-full-access", "thread_sandbox_read_only")])
def test_nothing_is_sent_and_no_slot_is_used_when_the_bounds_cannot_be_verified(pilot, tmp_path, mode, failed):
    adapter, log = _adapter(pilot, tmp_path, mode)
    with pytest.raises(NativeBlocked) as err:
        adapter.submit(_sub(pilot, 1))
    assert err.value.code == "unsafe_scope" and failed in err.value.message
    assert "turn/start" not in [c["method"] for c in _calls(log)] and PilotLedger(pilot).state()["remaining_turns"] == 4


# ---- through the coordinator: capture, context, no learner history, no attempt ------------------------------------------
def test_a_quick_question_is_answered_by_the_worker_with_a_context_manifest_and_creates_no_attempt_or_gap(pilot, clock, tmp_path):
    env, log = _env(pilot, clock, tmp_path)
    roots = {cid: b.root for cid, b in pilot.courses.items()}
    before = {cid: _tree(root) for cid, root in roots.items()}
    try:
        env.ask("req-pilot-ask", text="What does the origin of replication control?")
        env.coordinator.tick()
        assert env.job("req-pilot-ask")["state"] == S.SUCCEEDED
        result = env.result("req-pilot-ask")
        native = result["native-result"]
        ledger = PilotLedger(pilot).state()
        assert native["native_thread_id"] == ledger["thread"]["thread_id"] and native["native_turn_id"] == ledger["turns"][0]["turn_id"] and native["terminal"] is True
        assert result["message"]["assessment_disposition"] == "not_assessed" and result["publication"]["status"] == "not_requested"
        # The full question is captured, and the tutor's message is a separate record.
        private = pilot.state_dir
        assert any("What does the origin of replication control?" in p.read_text(encoding="utf-8") for p in private.rglob("messages/*.json"))
        assert result["message"]["role"] == "tutor" and result["message"]["message_id"] != "msg-req-pilot-ask"
        # What was supplied is recorded: policy files and source spans by version and hash, text kept apart from instructions.
        manifest = json.loads((private / "pilot" / "manifests" / "req-pilot-ask.json").read_text(encoding="utf-8"))
        assert manifest["course_id"] == "be505" and manifest["learner_history_supplied"] == 0 and manifest["assessor_guidance_supplied"] is False
        # Only the course's own agent guidance is supplied. Files that speak about the learner's attempts, name the learner or carry
        # planner preferences are withheld by rule, and the manifest says so.
        assert [i["label"] for i in manifest["instructions"]] == ["AGENTS.md"] and all(len(i["sha256"]) == 64 for i in manifest["instructions"])
        assert [w["label"] for w in manifest["instructions_withheld"]] == ["learning-strategy.md", "planner/protocols/tutoring-policy.md"]
        assert "learning-strategy.md" not in prompt_text(private, native) and "tutoring-policy.md" not in prompt_text(private, native)
        span = manifest["source_spans"][0]
        assert span["source_id"] == "src-lecture-01-slides" and span["locator"] == {"kind": "page", "page": 2, "printed_label": None} and len(span["text_sha256"]) == 64 and span["text_chars"] > 0
        prompt = (private / "pilot" / "prompts" / f"{native['dispatch_id']}.txt").read_text(encoding="utf-8")
        assert manifest["prompt_sha256"] == hashlib.sha256(prompt.encode("utf-8")).hexdigest() == ledger["turns"][0]["prompt_sha256"]
        assert prompt.index("COURSE INSTRUCTIONS") < prompt.index("SOURCES (numbered)") < prompt.index("LEARNER QUESTION")  # instructions, then data
        assert '"prior_effective_attempts": []' in prompt and "Experimental Codex worker tutor" in prompt
        # No attempt, no candidate, no review item, and no course byte changed.
        assert not list(private.rglob("*.candidate")) and not list(private.rglob("review/*.json"))
        assert {cid: _tree(root) for cid, root in roots.items()} == before
    finally:
        env.journal.close()


def test_a_pilot_assessment_is_synthetic_is_not_recorded_and_sees_no_learner_history_or_answer_guidance(pilot, clock, tmp_path):
    env, log = _env(pilot, clock, tmp_path)
    root = pilot.course("be505").root
    attempts_before = _tree(root / "learning")
    try:
        env.explain("req-pilot-explain")
        env.coordinator.tick()
        job = env.job("req-pilot-explain")
        assert job["state"] == S.WAITING_REVIEW and "Pilot" in job["waiting_reason"]
        publication = env.result("req-pilot-explain")["publication"]
        assert publication["status"] == "blocked" and "synthetic" in publication["reason"] and publication["canonical_record"] is None
        assert _tree(root / "learning") == attempts_before and len(read_attempt_records(root, "be505")["attempts"]) == 4
        manifest = json.loads((pilot.state_dir / "pilot" / "manifests" / "req-pilot-explain.json").read_text(encoding="utf-8"))
        assert manifest["learner_history_supplied"] == 0 and manifest["assessor_guidance_supplied"] is False and manifest["rubric_criteria"]
        prompt = next((pilot.state_dir / "pilot" / "prompts").glob("*.txt")).read_text(encoding="utf-8")
        assert '"prior_effective_attempts": []' in prompt and '"assessor_guidance": null' in prompt and "ASSESSOR GUIDANCE" not in prompt
        assert "SYNTHETIC-SOLUTION-MARKER" not in prompt
    finally:
        env.journal.close()


def test_when_the_worker_cannot_run_nothing_answers_in_its_place(pilot, clock, tmp_path):
    env, log = _env(pilot, clock, tmp_path, "tools-stay")
    try:
        env.ask("req-pilot-blocked")
        env.coordinator.tick()
        job = env.job("req-pilot-blocked")
        assert job["state"] == S.AUTH_REQUIRED and "unsafe_scope" in job["waiting_reason"]
        assert env.result("req-pilot-blocked") is None and PilotLedger(pilot).state()["remaining_turns"] == 4
        assert not [p for p in pilot.state_dir.rglob("*.json") if "Fixture tutor" in p.read_text(encoding="utf-8", errors="ignore")]
    finally:
        env.journal.close()


def test_a_citation_of_something_that_was_not_supplied_is_dropped_and_reported():
    reply = json.dumps({"reply_markdown": "See the slide.", "sources_used": [0, 3], "uncertainty": None, "assessment": None, "diagnostic": None})
    out = parse_tutor_output(reply, expect_assessment=False, intended_skill_ids=[], max_sources=1)
    assert out.sources_used == [0] and any("source" in problem for problem in out.problems)


def test_the_pilot_brain_starts_unpaused_and_its_own_gates_decide_each_turn(pilot, clock, tmp_path):
    """The adapter proof that guards live tutoring does not exist for the pilot, and must not pause it: the pilot's
    gate is the scope read-back and the budget, applied at every turn."""
    from lecture_brain.runtime import Runtime

    runtime = Runtime(pilot, clock=clock)
    try:
        runtime.startup()
        assert runtime.journal.get_value("supervisor-paused", False) is False
        caps = runtime.maintenance.capabilities(runtime.adapter)
        assert caps["native"]["status"] == "pilot" and caps["native"]["label"] == "Experimental Codex worker tutor" and caps["native"]["pilot_budget"] == {"max_turns": 4, "remaining_turns": 4}
        assert "not your desktop course chats" in caps["native"]["detail"] and caps["writer"]["status"] == "staged_only"
    finally:
        runtime.journal.close()
