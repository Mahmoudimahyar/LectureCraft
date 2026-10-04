"""Native connection verifier and report generator (LL019).

Without ``execute`` this only inspects: executable identity, version text and the local binding.
With ``execute`` it performs the single bounded proof against an explicit DISPOSABLE target:

1. one correlated nonce message → must come back in a process-readable terminal ``completed`` turn;
2. one turn that is interrupted → must reach a terminal state through this process;
3. everything actually reported (version, thread, capabilities) is recorded; anything not observed
   stays ``NOT_VERIFIED``.

It never targets a course thread ("no existing course chat as sandbox"), never retries an unknown
acceptance, and stops at the first unsafe finding. A queue-accepted return alone cannot pass.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import secrets
import subprocess
from typing import Any, Callable

from ..config import Settings
from ..fsutil import replace_atomic
from . import NativeAdapter, NativeBlocked, NativeSubmission, NativeTarget, UNSAFE_SANDBOXES, executable_identity, proof_path, transport_digest


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _version(executable: Path) -> str:
    try:
        done = subprocess.run([str(executable), "--version"], capture_output=True, timeout=20, check=False, stdin=subprocess.DEVNULL)
        return (done.stdout or done.stderr).decode("utf-8", "replace").strip()[:200] or "NOT_OBSERVED"
    except (OSError, subprocess.TimeoutExpired):
        return "NOT_OBSERVED"


def _default_factory(settings: Settings, executable: Path) -> NativeAdapter:
    native = settings.native_binding
    if native.get("adapter") == "codex-queue":
        from .codex_app_server import CodexQueueAdapter

        return CodexQueueAdapter(executable)
    from .codex_app_server import CodexAppServerAdapter

    return CodexAppServerAdapter(executable)


def probe_native(settings: Settings, *, execute: bool = False, adapter_factory: Callable[[Settings, Path], NativeAdapter] | None = None,
                 budget_seconds: float = 120.0, write: bool = True) -> dict[str, Any]:
    native = settings.native_binding
    executable = Path(native["executable"]) if native.get("executable") else None
    identity = executable_identity(executable)
    report: dict[str, Any] = {
        "contract": "ll.native-proof/1", "checked_at": _now(), "status": "INSPECT_ONLY", "adapter": native.get("adapter") or "NOT_CONFIGURED",
        "executable": identity, "version": _version(executable) if identity["present"] else "NOT_OBSERVED", "binding_revision": settings.binding_revision,
        "transport_digest": transport_digest(native, identity), "target_purpose": native.get("purpose") or "NOT_CONFIGURED",
        "auth_category": "NOT_OBSERVED (credentials are never inspected)", "checks": {}, "findings": [],
        "boundary": "A passing proof covers this executable's bytes, transport and policy only. It is not a tutoring-quality, Drive or writer check.",
    }
    checks = report["checks"]
    checks["executable_present"] = "PASS" if identity["present"] else "FAIL"
    sandbox = str(native.get("sandbox") or "")
    checks["explicit_safe_sandbox"] = "FAIL" if sandbox in UNSAFE_SANDBOXES else "PASS"
    checks["approval_policy_bound"] = "PASS" if native.get("approval_policy") else "FAIL"
    course_threads = {b.native_thread_id for b in settings.courses.values() if b.native_thread_id}
    proof_thread = native.get("proof_thread_id")
    checks["disposable_target"] = "PASS" if native.get("purpose") == "disposable-proof" and proof_thread and proof_thread not in course_threads else "FAIL"
    for name, result in list(checks.items()):
        if result == "FAIL":
            report["findings"].append({"executable_present": "No native executable is reachable for a resident process at the configured path.",
                                       "explicit_safe_sandbox": "The tutor target must use an explicit non-full-access sandbox.",
                                       "approval_policy_bound": "An approval policy must be bound for the tutor target.",
                                       "disposable_target": "The proof needs an explicit disposable thread that is not any course thread."}[name])
    if not execute:
        report["findings"].append("Inspection only: no message was sent. Run with --execute after binding a disposable target.")
        return _finish(settings, report, write=False)
    if any(result == "FAIL" for result in checks.values()):
        report["status"] = "BLOCKED"
        return _finish(settings, report, write)

    adapter = (adapter_factory or _default_factory)(settings, executable)
    report["capabilities_reported"] = adapter.capabilities()
    target = NativeTarget("proof", "native-proof", settings.binding_revision, proof_thread, sandbox, str(native["approval_policy"]))
    nonce = secrets.token_hex(8)

    def submission(suffix: str, prompt: str) -> NativeSubmission:
        return NativeSubmission(f"proof-{nonce}-{suffix}", f"proof-{nonce}", target, prompt, budget_seconds)

    try:
        first = adapter.submit(submission("roundtrip", f"Connection proof. Reply with exactly this line and nothing else: LL-PROOF {nonce}"))
    except NativeBlocked as exc:
        checks["terminal_roundtrip"] = "FAIL"
        report["findings"].append(f"Dispatch blocked before reaching the runtime: {exc.code}")
        report["status"] = "FAIL"
        return _finish(settings, report, write)
    report["roundtrip"] = {"state": first.state, "native_turn_id": first.native_turn_id, "failure_code": first.failure_code}
    if first.state == "completed" and first.text and f"LL-PROOF {nonce}" in first.text:
        checks["terminal_roundtrip"] = "PASS"
    else:
        checks["terminal_roundtrip"] = "FAIL"
        report["findings"].append("No correlated process-readable terminal result was observed. Queue acceptance or an unknown outcome is not completion; the turn was not re-sent."
                                  if first.state == "completion_unknown" else f"Roundtrip ended as {first.state}; the correlated nonce was not returned.")
        report["status"] = "FAIL"
        return _finish(settings, report, write)

    second_submission = submission("interrupt", "Connection proof (interrupt test). Count slowly from 1 to 200, one number per line.")
    second_submission.budget_seconds = 3.0
    second = adapter.submit(second_submission)
    if second.state == "completion_unknown":
        second = adapter.interrupt(second_submission, second.native_turn_id)
    report["interrupt"] = {"state": second.state, "native_turn_id": second.native_turn_id}
    checks["terminal_after_interrupt"] = "PASS" if second.terminal else "FAIL"
    if not second.terminal:
        report["findings"].append("Interruption did not reach a process-readable terminal state.")
    report["status"] = "PASS" if all(v == "PASS" for v in checks.values()) else "FAIL"
    if report["status"] == "PASS":
        report["findings"].append("Proof passed on the disposable target. Course threads are used only after you set course_targets_confirmed in the native binding.")
    return _finish(settings, report, write)


def _finish(settings: Settings, report: dict, write: bool) -> dict:
    report["proof_sha256"] = hashlib.sha256(json.dumps({k: v for k, v in report.items() if k != "proof_sha256"}, sort_keys=True).encode()).hexdigest()
    if write:
        replace_atomic(proof_path(settings), (json.dumps(report, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    return report
