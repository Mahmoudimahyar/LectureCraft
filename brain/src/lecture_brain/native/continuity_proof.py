"""Continuity proof on the EXISTING disposable proof thread (``probe-native --continuity``).

At most two synthetic turns, ever, under one authorization:

* client process 1: restricted launch → effective scope read back → ``thread/resume`` of the exact thread recorded by
  the single-request proof → its earlier answer read back by turn id → turn one sets a fresh marker;
* that client process is closed (only this app's own child; no desktop app, daemon or socket is touched);
* client process 2: the same verification again → ``thread/resume`` of the same thread → turn one's answer read back by
  turn id → turn two asks for the marker **without** carrying it, and without the app replaying any history.

Nothing is sent when the scope or the thread cannot be verified. An unclear first turn ends the proof: it is never
re-sent and the second turn is not attempted. A second invocation after any turn was sent sends nothing.

The result is reported per question, never as one verdict: process roundtrip, resumed-thread history, retrieval of the
exact terminal answers, desktop visibility (only the user can observe it), control of a desktop-created thread (not
attempted), loading of course instructions (deliberately disabled here, so a remembered marker says nothing about it),
and production activation (never changed by this proof). This worker is a separate Codex process; it is not the
desktop application.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import secrets
from typing import Any, Callable

from ..config import Settings
from ..fsutil import replace_atomic
from . import executable_identity
from .codex_app_server import AppServerError, CLIENT_INFO, _Session, launch_args, read_scope
from .disposable_proof import proof_report_path
from .probe import _version

MAX_TURNS = 2


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def continuity_report_path(settings: Settings) -> Path:
    return settings.state_dir / "native-continuity-proof.json"


def _agent_text(turn: dict | None) -> str:
    return "\n".join(i["text"] for i in (turn or {}).get("items") or [] if i.get("type") == "agentMessage" and isinstance(i.get("text"), str)).strip()


def _connect(prefix: list[str], cwd: Path, timeout: float) -> tuple[_Session, list[str]]:
    """One restricted client process. A first start finds the configured tool servers; the one that is used runs with each disabled."""
    first = _Session([*prefix, *launch_args([])], cwd=cwd)
    try:
        first.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=timeout)
        first.notify("initialized")
        names = sorted(((first.request("config/read", {"cwd": str(cwd), "includeLayers": False}, timeout=timeout) or {}).get("config") or {}).get("mcp_servers") or {})
    finally:
        first.close()
    session = _Session([*prefix, *launch_args(names)], cwd=cwd)
    try:
        session.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=timeout)
        session.notify("initialized")
    except (AppServerError, TimeoutError):
        session.close()
        raise
    return session, launch_args(names)


def _verified_thread(session: _Session, thread_id: str, proof_dir: Path, known_answers: dict[str, str], timeout: float) -> tuple[dict[str, str], dict[str, Any]]:
    """Scope read-back, resume of the exact thread, and the earlier answers read by turn id. No inference happens here."""
    checks, observed = read_scope(session, proof_dir, timeout)
    facts: dict[str, Any] = {"effective": observed}
    if "FAIL" in checks.values():
        return checks, facts
    try:
        resumed = session.request("thread/resume", {"threadId": thread_id, "cwd": str(proof_dir), "sandbox": "read-only", "approvalPolicy": "never"}, timeout=timeout) or {}
    except (AppServerError, TimeoutError) as exc:
        checks["same_thread_resumed"] = "FAIL"
        facts["resume_error"] = str(exc)[:200] or "timeout"
        return checks, facts
    thread = resumed.get("thread") or {}
    sandbox = resumed.get("sandbox") or {}
    facts["thread"] = {"thread_id": thread.get("id"), "cwd": resumed.get("cwd"), "sandbox": sandbox, "approval_policy": resumed.get("approvalPolicy"),
                       "instruction_sources": resumed.get("instructionSources"), "model": resumed.get("model"), "model_provider": resumed.get("modelProvider")}
    checks["same_thread_resumed"] = "PASS" if thread.get("id") == thread_id else "FAIL"
    checks["thread_sandbox_read_only"] = "PASS" if sandbox.get("type") == "readOnly" and not sandbox.get("networkAccess") else "FAIL"
    checks["thread_approval_never"] = "PASS" if resumed.get("approvalPolicy") == "never" else "FAIL"
    checks["thread_has_no_instruction_files"] = "PASS" if resumed.get("instructionSources") == [] else "FAIL"
    if "FAIL" in checks.values():
        return checks, facts
    try:  # the process-readable return path, shown on answers that already exist
        read = session.request("thread/read", {"threadId": thread_id, "includeTurns": True}, timeout=timeout) or {}
        by_id = {t.get("id"): t for t in (read.get("thread") or {}).get("turns") or []}
        facts["turns_in_thread"] = len(by_id)
        checks["earlier_answers_readable_by_turn_id"] = "PASS" if known_answers and all(
            (by_id.get(turn_id) or {}).get("status") == "completed" and _agent_text(by_id.get(turn_id)) == answer for turn_id, answer in known_answers.items()) else "FAIL"
    except (AppServerError, TimeoutError) as exc:
        checks["earlier_answers_readable_by_turn_id"] = "FAIL"
        facts["read_error"] = str(exc)[:200] or "timeout"
    return checks, facts


def _one_turn(session: _Session, thread_id: str, request_id: str, prompt: str, budget: float, timeout: float) -> dict[str, Any]:
    turn: dict[str, Any] = {"request_id": request_id, "sent_at": _now(), "turn_id": None, "terminal_status": None, "visible_answer": None, "non_message_items": [], "outcome": "UNCERTAIN_COMPLETION"}
    try:
        result = session.request("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text": prompt}], "approvalPolicy": "never", "sandboxPolicy": {"type": "readOnly"},
                                                "clientUserMessageId": request_id}, timeout=timeout)
    except TimeoutError:
        turn["note"] = "turn/start was sent but not acknowledged; it may have been accepted and is not re-sent"
        return turn
    except AppServerError as exc:
        turn.update(outcome="REJECTED", note=f"turn/start was rejected: {str(exc)[:200]}")
        return turn
    turn_id = ((result or {}).get("turn") or {}).get("id")
    turn["turn_id"] = turn_id
    texts, other, terminal = [], [], None
    try:
        for message in session.events(timeout=budget):
            method, params = message.get("method"), message.get("params") or {}
            if method and "id" in message:  # a server → client request (an approval): never answered
                other.append(f"server-request:{method}")
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
                    other.append(str(item.get("type")))
            elif method == "turn/completed" and (turn_id is None or (params.get("turn") or {}).get("id") == turn_id):
                terminal = params.get("turn") or {}
                break
    except TimeoutError:
        turn["note"] = "no terminal turn/completed within the budget; outcome unknown, not re-sent"
        return turn
    except AppServerError as exc:
        turn["note"] = f"the connection ended before a terminal result: {str(exc)[:160]}; not re-sent"
        return turn
    error = terminal.get("error") or {}
    turn.update(terminal_status=terminal.get("status"), completed_at=_now(), duration_ms=terminal.get("durationMs"), visible_answer="\n".join(texts).strip()[:500], non_message_items=sorted(set(other)),
                error=(str(error.get("message") or error)[:200] if error else None), outcome="TERMINAL")
    return turn


def run_continuity_proof(settings: Settings, *, execute: bool = False, argv_prefix: Callable[[int], list[str]] | None = None, budget_seconds: float = 90.0, rpc_timeout: float = 40.0,
                         write: bool = True) -> dict[str, Any]:
    native = settings.native_binding
    executable = Path(native["executable"]) if native.get("executable") else None
    identity = executable_identity(executable)
    proof_dir = settings.state_dir / "native-proof" / "cwd"
    classification = {"process_roundtrip": "BLOCKED", "resumed_thread_history": "NOT_ESTABLISHED", "exact_terminal_response_retrieval": "NOT_ESTABLISHED",
                      "desktop_visibility": "UNCONFIRMED", "desktop_thread_control": "NOT_RUN", "course_context_loading": "NOT_TESTED", "production_activation": "NOT_ACTIVATED"}
    report: dict[str, Any] = {
        "contract": "ll.native-continuity-proof/1", "checked_at": _now(), "interface": "codex app-server over stdio, separate worker process (marked experimental by the CLI); not the desktop application",
        "executable": identity, "version": _version(executable) if identity["present"] and argv_prefix is None else ("NOT_OBSERVED" if not identity["present"] else "test launcher"),
        "proof_root": str(proof_dir), "thread_id": None, "source_receipt": None, "marker": None, "sessions": [], "turns": [], "turns_sent": 0, "max_turns_authorized": MAX_TURNS,
        "classification": classification, "findings": [],
        "meaning": {"desktop_visibility": "Only the user can observe the desktop app; nothing here inspects it.",
                    "desktop_thread_control": "This thread was created by this app's worker. No thread created in the desktop app was resumed or driven.",
                    "course_context_loading": "Instruction files and memories are disabled in this scope and the thread has no instruction sources: a remembered marker shows thread history only.",
                    "production_activation": "This proof selects no adapter, binds no course thread and enables no dispatch."},
    }

    def finish(save: bool) -> dict[str, Any]:
        report["proof_sha256"] = hashlib.sha256(json.dumps({k: v for k, v in report.items() if k != "proof_sha256"}, sort_keys=True).encode()).hexdigest()
        if save and write:
            replace_atomic(continuity_report_path(settings), (json.dumps(report, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        return report

    try:
        source = json.loads(proof_report_path(settings).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        source = None
    target, result = (source or {}).get("target") or {}, (source or {}).get("result") or {}
    thread_id = target.get("thread_id")
    if not source or source.get("classification") != "SEPARATE_WORKER_ONLY" or not thread_id or not result.get("turn_id") or not result.get("visible_answer"):
        report["findings"].append("No saved single-request proof with a thread, a turn and an answer exists. This proof only continues that exact thread; it never creates another.")
        return finish(False)
    report["thread_id"] = thread_id
    report["source_receipt"] = {"request_id": (source.get("request") or {}).get("request_id"), "nonce": (source.get("request") or {}).get("nonce"), "turn_id": result["turn_id"],
                                "terminal_status": result.get("terminal_status"), "answer": result["visible_answer"], "checked_at": source.get("checked_at"), "version": source.get("version"),
                                "note": "The nonce is part of the request text; the thread id is the separate identifier above."}
    course_threads = {b.native_thread_id for b in settings.courses.values() if b.native_thread_id}
    if (not identity["present"] or native.get("purpose") != "disposable-proof" or native.get("sandbox") != "read-only" or native.get("approval_policy") != "never" or thread_id in course_threads
            or Path(str(target.get("cwd") or "")) != proof_dir or any(proof_dir.iterdir() if proof_dir.is_dir() else [True])):
        report["findings"].append("The binding is not the disposable-proof binding (existing executable, read-only, approval never), the thread is a course thread, or the proof root changed or is not empty.")
        return finish(False)
    if execute:
        try:
            used = json.loads(continuity_report_path(settings).read_text(encoding="utf-8")).get("turns_sent", 0)
        except (OSError, json.JSONDecodeError):
            used = 0
        if used:
            report["findings"].append(f"This authorization was already used ({used} turn(s) sent, recorded in {continuity_report_path(settings).name}). Nothing is sent again.")
            return finish(False)

    prefix = argv_prefix or (lambda n: [str(executable), "app-server"])
    known = {result["turn_id"]: result["visible_answer"]}
    marker = f"LL-MARK {secrets.token_hex(8)}"
    requests = [f"ll-cont-{secrets.token_hex(6)}-1", f"ll-cont-{secrets.token_hex(6)}-2"]
    prompts = [f"Continuity test {requests[0]}. This is a synthetic test with no task. Remember this marker for my next message: {marker}. Reply with exactly this line and nothing else: LL-ACK {requests[0]}",
               f"Continuity test {requests[1]}. This is a synthetic test with no task. Reply with exactly the marker line I asked you to remember in my previous message, and add no other text."]
    report["marker"] = marker if execute else None

    for number in (1, 2):
        entry: dict[str, Any] = {"session": number, "checks": {}, "started_at": _now()}
        report["sessions"].append(entry)
        try:
            session, arguments = _connect(prefix(number), proof_dir, rpc_timeout)
        except (AppServerError, TimeoutError, OSError) as exc:
            entry["checks"]["handshake"] = "FAIL"
            report["findings"].append(f"Client process {number} did not complete its restricted handshake: {str(exc)[:160] or type(exc).__name__}. Nothing was sent from it.")
            break
        entry["checks"]["handshake"] = "PASS"
        entry["launch_arguments"] = arguments
        try:
            try:
                checks, facts = _verified_thread(session, thread_id, proof_dir, known, rpc_timeout)
            except (AppServerError, TimeoutError) as exc:
                entry["checks"]["effective_scope_readable"] = "FAIL"
                report["findings"].append(f"Client process {number}: the effective scope could not be read back ({str(exc)[:160] or 'timeout'}). Nothing was sent from it.")
                break
            entry["checks"].update(checks)
            entry.update(facts)
            failed = sorted(k for k, v in entry["checks"].items() if v != "PASS")
            if failed:
                report["findings"].append(f"Client process {number}: not verified ({', '.join(failed)}). No request was sent from it.")
                break
            if number == 2:
                classification["exact_terminal_response_retrieval"] = "VERIFIED"  # both earlier answers were read by turn id after a reconnect
            if not execute:
                report["ready_to_execute"] = True
                report["findings"].append("Inspection only: scope read back, the exact thread resumed, its earlier answer read by turn id. No request was sent.")
                return finish(False)
            turn = _one_turn(session, thread_id, requests[number - 1], prompts[number - 1], budget_seconds, rpc_timeout)
            turn["session"] = number
            report["turns"].append(turn)
            report["turns_sent"] += turn["outcome"] != "REJECTED"
            finish(True)  # recorded as soon as anything may have been sent, so a crash can never lead to a re-send
            if turn["outcome"] != "TERMINAL":
                classification["process_roundtrip"] = "UNCERTAIN_COMPLETION" if turn["outcome"] == "UNCERTAIN_COMPLETION" else "BLOCKED"
                report["findings"].append(f"Turn {number}: {turn.get('note')}. The proof stops here.")
                break
            clean = turn["terminal_status"] == "completed" and not turn["non_message_items"] and turn["visible_answer"]
            if number == 1:
                if not clean or turn["visible_answer"] != f"LL-ACK {requests[0]}":
                    classification["process_roundtrip"] = "PARTIAL"
                    report["findings"].append("Turn 1 did not end as a clean completed turn with the exact acknowledgement. The second turn was not sent.")
                    break
                known[turn["turn_id"]] = turn["visible_answer"]
            else:
                classification["process_roundtrip"] = "VERIFIED" if clean else "PARTIAL"
                if clean and turn["visible_answer"] == marker:
                    classification["resumed_thread_history"] = "VERIFIED"
                    report["findings"].append("After a reconnect by a new client process, the resumed thread returned the marker that only its own earlier turn contained: "
                                              "the conversation history is held on the Codex side for this worker-created thread.")
                else:
                    report["findings"].append("The second turn did not return the exact marker. Thread history across a reconnect is not established.")
        finally:
            session.close()  # only this app's own child process
            entry["closed_at"] = _now()
    return finish(report["turns_sent"] > 0)
