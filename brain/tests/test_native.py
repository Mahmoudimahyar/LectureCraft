"""LL018 / LL019: native adapter boundary, safe target resolution and the connection verifier."""
from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

import pytest

from lecture_brain.native import (NativeBlocked, NativeSubmission, NativeTarget, UnverifiedNativeAdapter, load_proof, proof_is_current, resolve_target, select_adapter)
from lecture_brain.native.codex_app_server import CodexAppServerAdapter, CodexQueueAdapter
from lecture_brain.native.fixture_tutor import BANNER, FixtureTutorAdapter
from lecture_brain.native.probe import probe_native
from lecture_brain.tutoring.outputs import parse_tutor_output

FAKE = Path(__file__).with_name("fake_app_server.py")
THREAD = "thread-disposable-0001"


def _adapter(mode="normal", log=None, timeout=20.0):
    args = [str(FAKE), mode] + ([str(log)] if log else [])
    return CodexAppServerAdapter(Path(sys.executable), extra_args=args, handshake_timeout=timeout)


def _sub(prompt="Reply with exactly this line and nothing else: LL-PROOF abc", thread=THREAD, sandbox="read-only", approval="on-request", budget=15.0):
    return NativeSubmission("disp-1", "req-1", NativeTarget("be505", "native-be505", "0" * 64, thread, sandbox, approval), prompt, budget)


def _live(settings, **native):
    """Turn the synthetic workspace settings into a non-fixture profile for boundary tests."""
    settings.profile = "live"
    settings.native_dispatch_enabled = True
    settings.native_binding = {"adapter": "codex-app-server", "executable": sys.executable, "sandbox": "read-only", "approval_policy": "on-request", **native}
    return settings


# ---- target resolution: trusted binding only -------------------------------------------------------
def test_default_adapter_blocks_and_never_substitutes(settings):
    settings.profile = "local"
    adapter = select_adapter(settings)
    assert isinstance(adapter, UnverifiedNativeAdapter) and adapter.capabilities()["verified"] is False
    with pytest.raises(NativeBlocked) as err:
        adapter.submit(_sub())
    assert err.value.code == "native_not_verified" and err.value.job_state == "AUTH_REQUIRED"


def test_fixture_adapter_is_only_selected_in_the_fixture_profile(settings):
    assert isinstance(select_adapter(settings), FixtureTutorAdapter)
    assert select_adapter(settings).is_test_double is True
    _live(settings)
    assert not isinstance(select_adapter(settings), FixtureTutorAdapter)


@pytest.mark.parametrize("case,code", [("no_thread", "thread_not_bound"), ("full_access", "unsafe_sandbox"), ("no_sandbox", "unsafe_sandbox"), ("no_approval", "approval_policy_unset"),
                                       ("stale_binding", "stale_binding"), ("wrong_thread_key", "wrong_thread"), ("disabled", "native_disabled")])
def test_wrong_course_thread_or_config_blocks_with_no_fallback(settings, case, code):
    _live(settings)
    if case != "no_thread":
        settings.courses["be505"] = dataclasses.replace(settings.courses["be505"], native_thread_id="11111111-2222-3333-4444-555555555555")
    if case == "full_access":
        settings.native_binding["sandbox"] = "danger-full-access"
    if case == "no_sandbox":
        settings.native_binding.pop("sandbox")
    if case == "no_approval":
        settings.native_binding.pop("approval_policy")
    if case == "disabled":
        settings.native_dispatch_enabled = False
    revision = "0" * 64 if case == "stale_binding" else settings.binding_revision
    thread_key = "tutor-cs542" if case == "wrong_thread_key" else "tutor-be505"
    with pytest.raises(NativeBlocked) as err:
        resolve_target(settings, course_id="be505", request_binding_revision=revision, request_thread_key=thread_key)
    assert err.value.code == code


def test_bound_target_resolves_exactly(settings):
    _live(settings)
    settings.courses["be505"] = dataclasses.replace(settings.courses["be505"], native_thread_id="11111111-2222-3333-4444-555555555555")
    target = resolve_target(settings, course_id="be505", request_binding_revision=settings.binding_revision, request_thread_key="tutor-be505")
    assert target.native_thread_id == "11111111-2222-3333-4444-555555555555" and target.sandbox == "read-only" and target.approval_policy == "on-request"


# ---- app-server adapter against the labeled protocol double -----------------------------------------
def test_roundtrip_uses_explicit_thread_and_policies(tmp_path):
    log = tmp_path / "rpc.log"
    result = _adapter(log=log).submit(_sub())
    assert result.state == "completed" and result.terminal and result.text == "LL-PROOF abc" and result.native_turn_id == "turn-1"
    calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert [c["method"] for c in calls] == ["initialize", "initialized", "thread/resume", "turn/start"]
    assert calls[2]["params"] == {"threadId": THREAD}
    start = calls[3]["params"]
    assert start["sandboxPolicy"] == {"type": "readOnly"} and start["approvalPolicy"] == "onRequest" and start["threadId"] == THREAD
    assert not any("list" in c["method"] for c in calls)  # never list-and-pick


def test_unknown_thread_blocks_and_no_other_thread_is_tried(tmp_path):
    log = tmp_path / "rpc.log"
    with pytest.raises(NativeBlocked) as err:
        _adapter(log=log).submit(_sub(thread="thread-that-does-not-exist"))
    assert err.value.code == "wrong_thread"
    methods = [json.loads(line)["method"] for line in log.read_text(encoding="utf-8").splitlines()]
    assert methods.count("thread/resume") == 1 and "turn/start" not in methods


def test_full_access_is_refused_before_any_process_starts(tmp_path):
    log = tmp_path / "rpc.log"
    with pytest.raises(NativeBlocked) as err:
        _adapter(log=log).submit(_sub(sandbox="danger-full-access"))
    assert err.value.code == "unsafe_sandbox" and not log.exists()


@pytest.mark.parametrize("mode,state,code", [("fail", "failed", "model_overloaded"), ("quota", "quota_wait", "usage limit reached")])
def test_terminal_failures_keep_their_reason(mode, state, code):
    result = _adapter(mode).submit(_sub())
    assert result.state == state and result.failure_code == code


def test_silence_is_completion_unknown_and_is_reconciled_not_resent(tmp_path):
    log = tmp_path / "rpc.log"
    adapter = _adapter("silent", log=log)
    result = adapter.submit(_sub(budget=1.5))
    assert result.state == "completion_unknown" and result.terminal is False and result.native_turn_id == "turn-1"
    methods = [json.loads(line)["method"] for line in log.read_text(encoding="utf-8").splitlines()]
    assert methods.count("turn/start") == 1


def test_approval_request_is_never_answered_by_the_process(tmp_path):
    log = tmp_path / "rpc.log"
    result = _adapter("approval", log=log).submit(_sub())
    assert result.state == "approval_pending" and result.failure_code == "native_approval_requested"
    calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert "turn/interrupt" in [c["method"] for c in calls]
    assert not any(c["method"] is None for c in calls)  # no response was sent to request id 9001


def test_queue_candidate_can_only_report_unknown():
    adapter = CodexQueueAdapter(Path(sys.executable))
    assert adapter.capabilities()["terminal_result_channel"] is False
    assert adapter.status(_sub(), None).state == "completion_unknown"


# ---- connection verifier ---------------------------------------------------------------------------
def test_probe_inspect_only_sends_nothing(settings, tmp_path):
    _live(settings, purpose="disposable-proof", proof_thread_id=THREAD)
    log = tmp_path / "rpc.log"
    report = probe_native(settings, execute=False, adapter_factory=lambda s, exe: _adapter(log=log))
    assert report["status"] == "INSPECT_ONLY" and not log.exists() and load_proof(settings) is None
    assert report["auth_category"].startswith("NOT_OBSERVED")


def test_probe_passes_on_a_disposable_target_and_records_identity(settings, tmp_path):
    _live(settings, purpose="disposable-proof", proof_thread_id=THREAD)
    report = probe_native(settings, execute=True, adapter_factory=lambda s, exe: _adapter(), budget_seconds=15)
    assert report["status"] == "PASS", report["findings"]
    assert report["checks"] == {"executable_present": "PASS", "explicit_safe_sandbox": "PASS", "approval_policy_bound": "PASS", "disposable_target": "PASS",
                                "terminal_roundtrip": "PASS", "terminal_after_interrupt": "PASS"}
    assert report["executable"]["sha256"] and report["interrupt"]["state"] == "interrupted"
    proof = load_proof(settings)
    # Still not usable for tutoring until the user confirms the course targets.
    ok, reason = proof_is_current(settings, proof, Path(sys.executable))
    assert ok is False and "confirm the course thread targets" in reason
    settings.native_binding["course_targets_confirmed"] = True
    assert proof_is_current(settings, proof, Path(sys.executable)) == (True, "verified")
    assert isinstance(select_adapter(settings), CodexAppServerAdapter)
    # A changed policy or executable invalidates the proof.
    settings.native_binding["sandbox"] = "workspace-write"
    assert proof_is_current(settings, proof, Path(sys.executable))[0] is False
    assert isinstance(select_adapter(settings), UnverifiedNativeAdapter)


def test_probe_refuses_course_threads_and_unsafe_bindings(settings):
    _live(settings, purpose="disposable-proof", proof_thread_id="course-thread-id")
    settings.courses["be505"] = dataclasses.replace(settings.courses["be505"], native_thread_id="course-thread-id")
    report = probe_native(settings, execute=True, adapter_factory=lambda s, exe: pytest.fail("must not dispatch"))
    assert report["status"] == "BLOCKED" and report["checks"]["disposable_target"] == "FAIL"
    _live(settings, purpose="disposable-proof", proof_thread_id=THREAD, sandbox="danger-full-access")
    assert probe_native(settings, execute=True, adapter_factory=lambda s, exe: pytest.fail("must not dispatch"))["checks"]["explicit_safe_sandbox"] == "FAIL"


def test_queue_acceptance_alone_cannot_pass_the_probe(settings):
    _live(settings, purpose="disposable-proof", proof_thread_id=THREAD)
    report = probe_native(settings, execute=True, adapter_factory=lambda s, exe: _adapter("silent"), budget_seconds=1.5)
    assert report["status"] == "FAIL" and report["checks"]["terminal_roundtrip"] == "FAIL"
    assert "not completion" in " ".join(report["findings"])
    assert proof_is_current(settings, load_proof(settings), Path(sys.executable))[0] is False


# ---- fixture tutor double and output parsing -------------------------------------------------------
def test_fixture_tutor_output_is_always_visibly_labeled():
    from lecture_brain.native.fixture_tutor import synthesize

    out = synthesize({"action": "ask", "depth": "quick", "question": "What does the origin do?", "sources": [{"index": 0, "text": "DNA replication of the plasmid begins here."}]})
    assert out["reply_markdown"].startswith(BANNER) and out["assessment"] is None and out["sources_used"] == [0]


def test_help_requests_can_never_yield_an_assessment():
    text = json.dumps({"reply_markdown": "Answer.", "assessment": {"observations": [{"skill_id": "s", "outcome": "not_demonstrated"}]}})
    out = parse_tutor_output(text, expect_assessment=False, intended_skill_ids=["s"], max_sources=0)
    assert out.observations is None and any("discarded" in p for p in out.problems)


def test_assessment_must_cover_exactly_the_intended_skills():
    def reply(skills):
        return json.dumps({"reply_markdown": "Feedback.", "assessment": {"observations": [{"skill_id": s, "outcome": "partial", "analysis": "a", "missing_or_incorrect": ["m"], "error_types": ["concept", "bogus"], "assessment_confidence": "high"} for s in skills]}})

    ok = parse_tutor_output(reply(["a", "b"]), expect_assessment=True, intended_skill_ids=["a", "b"], max_sources=0)
    assert [o["skill_id"] for o in ok.observations] == ["a", "b"] and ok.observations[0]["error_types"] == ["concept"]
    assert parse_tutor_output(reply(["a"]), expect_assessment=True, intended_skill_ids=["a", "b"], max_sources=0).observations is None
    assert parse_tutor_output(reply(["a", "b", "c"]), expect_assessment=True, intended_skill_ids=["a", "b"], max_sources=0).observations is not None  # extra skill ignored
    unobserved = json.dumps({"reply_markdown": "x", "assessment": {"observations": [{"skill_id": "a", "outcome": "not_observed", "error_types": ["concept"], "missing_or_incorrect": ["m"]}]}})
    obs = parse_tutor_output(unobserved, expect_assessment=True, intended_skill_ids=["a"], max_sources=0).observations[0]
    assert obs["error_types"] == [] and obs["missing_or_incorrect"] == []


def test_malformed_reply_is_kept_as_text_without_invented_structure():
    out = parse_tutor_output("Just some prose, not JSON.", expect_assessment=True, intended_skill_ids=["a"], max_sources=0)
    assert out.structured is False and out.reply_markdown == "Just some prose, not JSON." and out.observations is None
