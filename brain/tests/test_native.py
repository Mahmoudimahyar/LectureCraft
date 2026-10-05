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
    args = [str(FAKE), mode, str(log) if log else "-"]
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
    methods = [c["method"] for c in calls]
    # Two starts: the first finds the user's tool servers, the second runs with each of them disabled and is the one that is used.
    assert methods == ["initialize", "initialized", "config/read", "initialize", "initialized", "account/read", "config/read", "mcpServerStatus/list", "hooks/list", "thread/resume", "turn/start"]
    resume, start = calls[-2]["params"], calls[-1]["params"]
    assert resume == {"threadId": THREAD}
    # Wire values as the installed app-server's own generated schema declares them (AskForApproval: untrusted | on-request | never).
    assert start["sandboxPolicy"] == {"type": "readOnly"} and start["approvalPolicy"] == "on-request" and start["threadId"] == THREAD
    assert not any(c["method"].startswith("thread/list") for c in calls)  # never list-and-pick a thread


@pytest.mark.parametrize("mode,failed", [("ignores-sandbox", "effective_sandbox_read_only"), ("tools-stay", "no_enabled_tool_servers"), ("apikey", "managed_chatgpt_signin"),
                                         ("hooks", "no_hooks_or_notify_program")])
def test_a_tutor_turn_is_never_sent_into_an_unrestricted_runtime(tmp_path, mode, failed):
    """The user's own defaults may be full access with tool servers and hooks. A turn this app starts must run in the
    restricted scope, verified from the running process — otherwise it is blocked, not sent."""
    log = tmp_path / "rpc.log"
    adapter = _adapter(mode, log=log)
    with pytest.raises(NativeBlocked) as err:
        adapter.submit(_sub())
    assert err.value.code == "unsafe_scope" and failed in err.value.message
    methods = [json.loads(line)["method"] for line in log.read_text(encoding="utf-8").splitlines()]
    assert "thread/resume" not in methods and "turn/start" not in methods
    assert adapter.last_scope["checks"][failed] == "FAIL"


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


# ---- the single-request proof on a new disposable thread -----------------------------------------------------------
from lecture_brain.native.disposable_proof import DISABLED_FEATURES, proof_report_path, run_disposable_proof  # noqa: E402


def _disposable(settings, **native):
    _live(settings, purpose="disposable-proof", proof_target="new-disposable-thread", **native)
    settings.native_binding.setdefault("approval_policy", "never")
    if "approval_policy" not in native:
        settings.native_binding["approval_policy"] = "never"
    return settings


def _calls(log):
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []


def _run(settings, tmp_path, mode="normal", execute=True, budget=15.0):
    log = tmp_path / f"rpc-{mode}.log"
    log.unlink(missing_ok=True)
    report = run_disposable_proof(settings, execute=execute, argv_prefix=[sys.executable, str(FAKE), mode, str(log)], budget_seconds=budget, rpc_timeout=15.0)
    return report, _calls(log)


def test_disposable_proof_sends_exactly_one_request_after_reading_back_a_safe_scope(settings, tmp_path):
    report, calls = _run(_disposable(settings), tmp_path)
    assert report["classification"] == "SEPARATE_WORKER_ONLY", report["findings"]  # never "verified": this process cannot see the desktop app
    assert set(report["checks"].values()) == {"PASS"} and report["turns_sent"] == 1
    methods = [c["method"] for c in calls]
    assert methods.count("turn/start") == 1 and methods.count("thread/start") == 1 and "thread/resume" not in methods
    # Scope is read back from the process before the thread exists, and the thread before the request.
    second = methods[methods.index("initialize", 1):]
    assert second.index("account/read") < second.index("config/read") < second.index("thread/start") < second.index("turn/start") < len(second) - 1
    turn = next(c["params"] for c in calls if c["method"] == "turn/start")
    assert turn["sandboxPolicy"] == {"type": "readOnly"} and turn["approvalPolicy"] == "never" and turn["threadId"] == report["target"]["thread_id"]
    nonce = report["request"]["nonce"]
    assert turn["input"] == [{"type": "text", "text": report["request"]["prompt"]}] and nonce in report["request"]["prompt"] and report["request"]["request_id"] in report["request"]["prompt"]
    assert report["result"]["terminal_status"] == "completed" and report["result"]["visible_answer"] == f"LL-PROOF {nonce}"
    assert report["effective"]["sandbox_mode"] == "read-only" and report["effective"]["mcp_servers_enabled"] == [] and report["effective"]["notify"] == [] and report["effective"]["web_search"] == "disabled"
    assert all(feature in report["launch_arguments"] for feature in DISABLED_FEATURES) and "mcp_servers.node_repl.enabled=false" in report["launch_arguments"]
    # It is recorded apart from the adapter proof and can never make tutoring selectable.
    assert proof_report_path(settings).is_file() and load_proof(settings) is None
    settings.native_binding["course_targets_confirmed"] = True
    assert isinstance(select_adapter(settings), UnverifiedNativeAdapter)
    # Settings shows what was proven and, in the same breath, that tutoring is still not connected.
    from lecture_brain.journal import Journal
    from lecture_brain.maintenance import Maintenance

    journal = Journal.open(settings.journal_path, synced_roots=[])
    try:
        native = Maintenance(settings, journal).capabilities(select_adapter(settings))["native"]
    finally:
        journal.close()
    assert native["status"] == "not_verified" and native["label"] == "Native connection not verified"
    assert native["disposable_proof"] == {"classification": "SEPARATE_WORKER_ONLY", "checked_at": report["checked_at"], "thread_id": report["target"]["thread_id"],
                                          "meaning": native["disposable_proof"]["meaning"]}
    assert "does not connect the tutor" in native["disposable_proof"]["meaning"]


def test_disposable_proof_inspection_creates_no_thread_and_sends_nothing(settings, tmp_path):
    report, calls = _run(_disposable(settings), tmp_path, execute=False)
    methods = [c["method"] for c in calls]
    assert report["ready_to_execute"] is True and report["turns_sent"] == 0 and report["target"] is None
    assert "thread/start" not in methods and "turn/start" not in methods and not proof_report_path(settings).exists()


@pytest.mark.parametrize("mode,failed", [("apikey", "managed_chatgpt_signin"), ("ignores-sandbox", "effective_sandbox_read_only"), ("tools-stay", "no_enabled_tool_servers"),
                                         ("hooks", "no_hooks_or_notify_program")])
def test_disposable_proof_blocks_before_any_thread_when_the_effective_scope_is_not_safe(settings, tmp_path, mode, failed):
    report, calls = _run(_disposable(settings), tmp_path, mode)
    methods = [c["method"] for c in calls]
    assert report["classification"] == "BLOCKED" and report["checks"][failed] == "FAIL" and report["turns_sent"] == 0
    assert "thread/start" not in methods and "turn/start" not in methods


@pytest.mark.parametrize("mode,failed", [("instructions", "thread_has_no_instruction_files"), ("thread-full-access", "thread_sandbox_read_only")])
def test_disposable_proof_blocks_before_the_request_when_the_new_thread_has_the_wrong_scope(settings, tmp_path, mode, failed):
    report, calls = _run(_disposable(settings), tmp_path, mode)
    assert report["classification"] == "BLOCKED" and report["checks"][failed] == "FAIL" and report["turns_sent"] == 0
    assert "turn/start" not in [c["method"] for c in calls]


def test_disposable_proof_refuses_an_unsuitable_binding_without_starting_anything(settings, tmp_path):
    for native in ({"sandbox": "danger-full-access"}, {"approval_policy": "on-request"}, {"purpose": "tutoring"}, {"proof_target": None}, {"executable": str(tmp_path / "missing.exe")}):
        _disposable(settings)
        settings.native_binding.update(native)
        report, calls = _run(settings, tmp_path, "normal")
        assert report["classification"] == "BLOCKED" and report["turns_sent"] == 0 and calls == [], native


def test_disposable_proof_never_resends_and_never_upgrades_an_unclear_outcome(settings, tmp_path):
    report, calls = _run(_disposable(settings), tmp_path, "silent", budget=1.5)
    assert report["classification"] == "UNCERTAIN_COMPLETION" and report["turns_sent"] == 1
    assert [c["method"] for c in calls].count("turn/start") == 1
    for mode, expected in (("wrong-answer", "PARTIAL"), ("fail", "BLOCKED"), ("tool-activity", "PARTIAL")):
        report, calls = _run(_disposable(settings), tmp_path, mode)
        assert report["classification"] == expected, (mode, report["classification"], report["findings"])
        assert [c["method"] for c in calls].count("turn/start") == 1
