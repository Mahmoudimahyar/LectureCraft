"""One bounded native proof on a NEW disposable thread (integration pass; ``probe-native --disposable``).

Order of work, all inside one app-server child process started with per-process restrictions:

1. identity: executable path, bytes digest and version text;
2. effective scope, read back from the running process through read-only methods (``account/read``,
   ``config/read``, ``mcpServerStatus/list``, ``hooks/list``) — nothing is assumed from the launch arguments;
3. a new thread created with an explicit read-only sandbox and working directory, and its response checked
   (sandbox, approval policy, instruction sources) — creating a thread sends nothing to a model;
4. only then, exactly one synthetic turn carrying a request id and nonce, its terminal state, and the same answer
   read back once more through ``thread/read``.

Any unmet check before step 4 ends as ``BLOCKED`` with no turn sent. No answer within the budget is
``UNCERTAIN_COMPLETION`` and is never re-sent. A pass here is ``SEPARATE_WORKER_ONLY``: this process cannot observe
whether the desktop app shows the same thread, so it never enables tutoring and never selects an adapter.
The app-server interface is marked experimental by the installed CLI: this is a labeled preview proof.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import secrets
from typing import Any

from ..config import Settings
from ..fsutil import replace_atomic
from . import executable_identity
from .codex_app_server import AppServerError, CLIENT_INFO, DISABLED_FEATURES, _Session, launch_args, read_scope as _scope  # noqa: F401 - re-exported for callers
from .probe import _version

CLASSES = ("NATIVE_ROUNDTRIP_VERIFIED", "SEPARATE_WORKER_ONLY", "PARTIAL", "BLOCKED", "UNCERTAIN_COMPLETION")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def proof_report_path(settings: Settings) -> Path:
    return settings.state_dir / "native-proof-disposable.json"


def _open(argv: list[str], cwd: Path, timeout: float) -> tuple[_Session, dict]:
    session = _Session(argv, cwd=cwd)
    try:
        hello = session.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=timeout) or {}
        session.notify("initialized")
    except (AppServerError, TimeoutError, OSError):
        session.close()
        raise
    return session, hello


def run_disposable_proof(settings: Settings, *, execute: bool = False, argv_prefix: list[str] | None = None, budget_seconds: float = 90.0, rpc_timeout: float = 40.0,
                         write: bool = True) -> dict[str, Any]:
    native = settings.native_binding
    executable = Path(native["executable"]) if native.get("executable") else None
    identity = executable_identity(executable)
    proof_dir = settings.state_dir / "native-proof" / "cwd"
    report: dict[str, Any] = {
        "contract": "ll.native-disposable-proof/1", "checked_at": _now(), "classification": "BLOCKED", "interface": "codex app-server over stdio (marked experimental by the CLI: labeled preview proof)",
        "executable": identity, "version": _version(executable) if identity["present"] and argv_prefix is None else ("NOT_OBSERVED" if not identity["present"] else "test launcher"),
        "binding_revision": settings.binding_revision, "test_root": str(proof_dir), "checks": {}, "effective": {}, "target": None, "request": None, "result": None, "turns_sent": 0,
        "findings": [], "boundary": "One synthetic request on a new disposable thread. It does not enable tutoring, does not select an adapter and says nothing about course threads, "
                                    "the desktop app's own threads, answer quality, Drive or course saves.",
    }
    checks = report["checks"]
    course_threads = {b.native_thread_id for b in settings.courses.values() if b.native_thread_id}
    checks["executable_present"] = "PASS" if identity["present"] else "FAIL"
    checks["binding_is_disposable_proof"] = "PASS" if native.get("purpose") == "disposable-proof" and native.get("proof_target") == "new-disposable-thread" else "FAIL"
    checks["binding_read_only_never"] = "PASS" if native.get("sandbox") == "read-only" and native.get("approval_policy") == "never" else "FAIL"
    if "FAIL" in checks.values():
        report["findings"].append("The private native binding must name an existing executable, purpose 'disposable-proof', proof_target 'new-disposable-thread', sandbox 'read-only' and approval_policy 'never'.")
        return _finish(settings, report, write and execute)

    proof_dir.mkdir(parents=True, exist_ok=True)
    if any(proof_dir.iterdir()):
        checks["empty_test_root"] = "FAIL"
        report["findings"].append("The proof working directory is not empty.")
        return _finish(settings, report, write and execute)
    checks["empty_test_root"] = "PASS"
    prefix = argv_prefix or [str(executable), "app-server"]
    try:
        first, _ = _open([*prefix, *launch_args([])], proof_dir, rpc_timeout)
        try:
            names = sorted(((first.request("config/read", {"cwd": str(proof_dir), "includeLayers": False}, timeout=rpc_timeout) or {}).get("config") or {}).get("mcp_servers") or {})
        finally:
            first.close()
        session, hello = _open([*prefix, *launch_args(names)], proof_dir, rpc_timeout)
    except (AppServerError, TimeoutError, OSError) as exc:
        checks["handshake"] = "FAIL"
        report["findings"].append(f"The app-server did not complete its handshake under the restricted launch: {str(exc)[:200] or type(exc).__name__}.")
        return _finish(settings, report, write and execute)
    checks["handshake"] = "PASS"
    report["launch_arguments"] = launch_args(names)
    report["server"] = {"userAgent": hello.get("userAgent"), "platformOs": hello.get("platformOs")}
    try:
        try:
            scope_checks, observed = _scope(session, proof_dir, rpc_timeout)
        except (AppServerError, TimeoutError) as exc:
            checks["effective_scope_readable"] = "FAIL"
            report["findings"].append(f"The effective configuration could not be read back: {str(exc)[:200] or 'timeout'}. Without it no request is sent.")
            return _finish(settings, report, write and execute)
        checks.update(scope_checks)
        report["effective"] = observed
        if "FAIL" in checks.values():
            report["findings"].append("Safe scope not established: " + ", ".join(k for k, v in checks.items() if v == "FAIL") + ". No thread was created and no request was sent.")
            return _finish(settings, report, write and execute)
        if not execute:
            report["classification"] = "BLOCKED"
            report["findings"].append("Inspection only: identity and effective scope were read back; no thread was created and no request was sent. Run with --execute for the single request.")
            report["ready_to_execute"] = True
            return _finish(settings, report, False)

        # ---- the disposable target: creating it sends nothing to a model ----
        try:
            started = session.request("thread/start", {"cwd": str(proof_dir), "sandbox": "read-only", "approvalPolicy": "never", "ephemeral": False}, timeout=rpc_timeout) or {}
        except (AppServerError, TimeoutError) as exc:
            checks["disposable_thread_created"] = "FAIL"
            report["findings"].append(f"thread/start was not accepted: {str(exc)[:200] or 'timeout'}.")
            return _finish(settings, report, write)
        thread = started.get("thread") or {}
        thread_id = thread.get("id")
        report["target"] = {"thread_id": thread_id, "created_by": "thread/start in this process", "cwd": started.get("cwd"), "sandbox": started.get("sandbox"), "approval_policy": started.get("approvalPolicy"),
                            "instruction_sources": started.get("instructionSources"), "model": started.get("model"), "model_provider": started.get("modelProvider"),
                            "ephemeral": thread.get("ephemeral"), "cli_version": thread.get("cliVersion")}
        checks["disposable_thread_created"] = "PASS" if isinstance(thread_id, str) and thread_id and thread_id not in course_threads else "FAIL"
        checks["thread_sandbox_read_only"] = "PASS" if (started.get("sandbox") or {}).get("type") == "readOnly" and not (started.get("sandbox") or {}).get("networkAccess") else "FAIL"
        checks["thread_approval_never"] = "PASS" if started.get("approvalPolicy") == "never" else "FAIL"
        checks["thread_has_no_instruction_files"] = "PASS" if started.get("instructionSources") == [] else "FAIL"
        try:
            session.request("thread/read", {"threadId": thread_id, "includeTurns": False}, timeout=rpc_timeout)
            checks["return_path_reachable"] = "PASS"
        except (AppServerError, TimeoutError) as exc:
            # A thread that has no turn yet may not be readable; the return path is then proven only by the request itself.
            checks["return_path_reachable"] = "PASS" if "not materialized" in str(exc).lower() or "no rollout" in str(exc).lower() else "FAIL"
            report["target"]["read_before_first_turn"] = str(exc)[:160] or "timeout"
        if "FAIL" in checks.values():
            report["findings"].append("The new thread did not come back with the required scope: " + ", ".join(k for k, v in checks.items() if v == "FAIL") + ". No request was sent.")
            return _finish(settings, report, write)

        # ---- exactly one synthetic request ----
        nonce = secrets.token_hex(8)
        request_id = f"ll-proof-{nonce}"
        prompt = f"Connection proof {request_id}. This is a synthetic test with no task. Reply with exactly this line and nothing else: LL-PROOF {nonce}"
        report["request"] = {"request_id": request_id, "nonce": nonce, "prompt": prompt, "sent_at": _now()}
        report["turns_sent"] = 1
        try:
            result = session.request("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text": prompt}], "approvalPolicy": "never", "sandboxPolicy": {"type": "readOnly"},
                                                    "clientUserMessageId": request_id}, timeout=rpc_timeout)
        except TimeoutError:
            report["classification"] = "UNCERTAIN_COMPLETION"
            report["findings"].append("turn/start was sent but not acknowledged. It may have been accepted; it is not re-sent.")
            return _finish(settings, report, write)
        except AppServerError as exc:
            report["turns_sent"] = 0
            checks["terminal_roundtrip"] = "FAIL"
            report["findings"].append(f"turn/start was rejected by the app-server: {str(exc)[:200]}. Nothing reached a model.")
            return _finish(settings, report, write)
        turn_id = ((result or {}).get("turn") or {}).get("id")
        texts, terminal, other_items = [], None, []
        try:
            for message in session.events(timeout=budget_seconds):
                method, params = message.get("method"), message.get("params") or {}
                if method and "id" in message:  # the server asks this client something (an approval). It is never answered.
                    other_items.append(f"server-request:{method}")
                    try:
                        session.request("turn/interrupt", {"threadId": thread_id, "turnId": turn_id}, timeout=10)
                    except (AppServerError, TimeoutError):
                        pass
                    continue
                if method == "item/completed":
                    item = params.get("item") or {}
                    if item.get("type") == "agentMessage" and isinstance(item.get("text"), str):
                        texts.append(item["text"])
                    elif item.get("type") not in {"userMessage", "reasoning", None}:
                        other_items.append(str(item.get("type")))
                elif method == "turn/completed" and (turn_id is None or (params.get("turn") or {}).get("id") == turn_id):
                    terminal = params.get("turn") or {}
                    break
        except TimeoutError:
            report["classification"] = "UNCERTAIN_COMPLETION"
            report["result"] = {"turn_id": turn_id, "terminal_status": None, "observed_until": _now()}
            report["findings"].append("No terminal turn/completed arrived within the budget. The outcome is unknown; reconcile by reading the thread, never by sending again.")
            return _finish(settings, report, write)
        except AppServerError as exc:
            report["classification"] = "UNCERTAIN_COMPLETION"
            report["result"] = {"turn_id": turn_id, "terminal_status": None, "observed_until": _now()}
            report["findings"].append(f"The connection ended before a terminal result: {str(exc)[:160]}. Not re-sent.")
            return _finish(settings, report, write)
        answer = "\n".join(texts).strip()
        error = terminal.get("error") or {}
        report["result"] = {"turn_id": turn_id, "terminal_status": terminal.get("status"), "completed_at": _now(), "duration_ms": terminal.get("durationMs"), "visible_answer": answer[:500],
                            "non_message_items": sorted(set(other_items)), "error": (str(error.get("message") or error)[:200] if error else None)}
        checks["terminal_roundtrip"] = "PASS" if terminal.get("status") == "completed" and answer == f"LL-PROOF {nonce}" else "FAIL"
        checks["no_tool_activity"] = "PASS" if not other_items else "FAIL"
        try:  # the same answer through the reconcile path (what `status` uses after an unknown completion)
            read = session.request("thread/read", {"threadId": thread_id, "includeTurns": True}, timeout=rpc_timeout) or {}
            turn = next((t for t in (read.get("thread") or {}).get("turns") or [] if t.get("id") == turn_id), None)
            again = "\n".join(i["text"] for i in (turn or {}).get("items") or [] if i.get("type") == "agentMessage" and isinstance(i.get("text"), str)).strip()
            checks["answer_readable_again_by_turn_id"] = "PASS" if turn is not None and turn.get("status") == "completed" and again == answer and answer else "FAIL"
        except (AppServerError, TimeoutError) as exc:
            checks["answer_readable_again_by_turn_id"] = "FAIL"
            report["findings"].append(f"thread/read after the turn failed: {str(exc)[:160] or 'timeout'}.")
        if checks["terminal_roundtrip"] == "PASS" and checks["no_tool_activity"] == "PASS":
            report["classification"] = "SEPARATE_WORKER_ONLY"
            report["findings"].append("An independent worker process sent one request and read its terminal answer. Whether the desktop app shows this thread was not observed by this process: "
                                      "desktop-thread continuity is NOT established.")
        else:
            report["classification"] = "PARTIAL" if terminal.get("status") == "completed" else "BLOCKED"
            report["findings"].append(f"The turn ended as {terminal.get('status')!r} without the exact correlated answer, or with tool activity. Not re-sent.")
        return _finish(settings, report, write)
    finally:
        session.close()


def _finish(settings: Settings, report: dict, write: bool) -> dict:
    report["proof_sha256"] = hashlib.sha256(json.dumps({k: v for k, v in report.items() if k != "proof_sha256"}, sort_keys=True).encode()).hexdigest()
    if write:
        replace_atomic(proof_report_path(settings), (json.dumps(report, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    return report
