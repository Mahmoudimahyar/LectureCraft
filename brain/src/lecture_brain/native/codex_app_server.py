"""Candidate adapter: Codex App Server over stdio JSON-RPC (documented stable transport).

Status: IMPLEMENTED, NOT VERIFIED on this installation. Method names follow the public App Server
documentation checked 2026-10-04 (``initialize`` → ``initialized``, ``thread/resume``,
``turn/start``, ``turn/interrupt``, ``thread/read``, terminal ``turn/completed``). Exact parameter
shapes of the installed version must be confirmed by the connection proof
(``lecture-brain probe-native --execute``) before this adapter is ever selected.

Safety properties enforced here regardless of version:
* explicit thread id only (resume by id; never list-and-pick, never "latest");
* explicit sandbox and approval policy on every turn; ``dangerFullAccess`` is refused;
* a server-initiated approval request is never answered by this process — the turn is
  interrupted and the job surfaces "permission needed";
* no result within the budget is ``completion_unknown`` with the turn id retained; it is never
  re-sent from here;
* only the documented methods above are used: no command execution, file or config methods.
"""
from __future__ import annotations

from pathlib import Path
import json
import queue
import subprocess
import threading
import time
from typing import Any

from . import NativeBlocked, NativeObservation, NativeSubmission

SANDBOX_POLICY = {"read-only": {"type": "readOnly"}, "workspace-write": {"type": "workspaceWrite"}}
# Wire values follow the installed app-server's own generated schema (AskForApproval: untrusted | on-request | never).
APPROVAL_POLICY = {"never": "never", "on-request": "on-request", "untrusted": "untrusted"}
CLIENT_INFO = {"name": "lecture-learning-brain", "title": "Lecture Learning Brain", "version": "0.1.0"}

# Per-process restrictions. A user default such as danger-full-access is never inherited.
BASE_OVERRIDES = ['sandbox_mode="read-only"', 'approval_policy="never"', 'web_search="disabled"', "notify=[]", "project_doc_max_bytes=0"]
DISABLED_FEATURES = ["daemon_auto_start", "computer_use", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "in_app_browser", "apps", "plugins",
                     "remote_plugin", "plugin_sharing", "hooks", "memories", "multi_agent", "goals", "image_generation", "shell_tool", "unified_exec", "tool_suggest",
                     "skill_search", "realtime_conversation"]
MUST_BE_OFF = ["computer_use", "browser_use", "apps", "plugins", "hooks", "memories", "multi_agent", "shell_tool", "unified_exec", "image_generation"]

def launch_args(mcp_servers: list[str]) -> list[str]:
    args: list[str] = []
    for override in [*BASE_OVERRIDES, *(f"mcp_servers.{name}.enabled=false" for name in sorted(mcp_servers))]:
        args += ["-c", override]
    for feature in DISABLED_FEATURES:
        args += ["--disable", feature]
    return args


def read_scope(session: "_Session", cwd: Path, timeout: float) -> tuple[dict[str, str], dict[str, Any]]:
    """Read the effective scope back from the running process. Every check is PASS or FAIL; unknown is FAIL."""
    account = (session.request("account/read", {"refreshToken": False}, timeout=timeout) or {}).get("account") or {}
    config = (session.request("config/read", {"cwd": str(cwd), "includeLayers": False}, timeout=timeout) or {}).get("config") or {}
    servers = (session.request("mcpServerStatus/list", {}, timeout=timeout) or {}).get("data") or []
    hooks = [h for row in (session.request("hooks/list", {"cwds": [str(cwd)]}, timeout=timeout) or {}).get("data") or [] for h in row.get("hooks") or []]
    configured = config.get("mcp_servers") or {}
    live_tools = {s.get("name"): len(s.get("tools") or {}) for s in servers}
    enabled = sorted(name for name, entry in configured.items() if (entry or {}).get("enabled") is not False) + sorted(n for n, count in live_tools.items() if count and n not in configured)
    features = config.get("features") or {}
    observed = {"auth_type": account.get("type"), "plan_type": account.get("planType"), "sandbox_mode": config.get("sandbox_mode"), "approval_policy": config.get("approval_policy"),
                "model": config.get("model"), "reasoning_effort": config.get("model_reasoning_effort"), "project_doc_max_bytes": config.get("project_doc_max_bytes"),
                "notify": config.get("notify"), "web_search": config.get("web_search"), "mcp_servers_configured": sorted(configured), "mcp_servers_enabled": enabled, "mcp_tools_exposed": sum(live_tools.values()),
                "hooks": len(hooks), "features_still_on": sorted(f for f in MUST_BE_OFF if features.get(f) is not False),
                "developer_instructions_set": bool(config.get("developer_instructions") or config.get("instructions"))}
    checks = {
        "managed_chatgpt_signin": "PASS" if account.get("type") == "chatgpt" else "FAIL",  # an API-key login would mean metered billing
        "effective_sandbox_read_only": "PASS" if config.get("sandbox_mode") == "read-only" else "FAIL",
        "effective_approval_never": "PASS" if config.get("approval_policy") == "never" else "FAIL",
        "no_enabled_tool_servers": "PASS" if not enabled and not observed["mcp_tools_exposed"] else "FAIL",
        "no_hooks_or_notify_program": "PASS" if not hooks and not config.get("notify") else "FAIL",
        "web_search_disabled": "PASS" if config.get("web_search") == "disabled" else "FAIL",
        "tool_features_off": "PASS" if not observed["features_still_on"] else "FAIL",
        "no_inherited_instruction_files": "PASS" if config.get("project_doc_max_bytes") == 0 and not observed["developer_instructions_set"] else "FAIL",
    }
    return checks, observed




class AppServerError(RuntimeError):
    pass


class _Session:
    """One short-lived `codex app-server` child process speaking newline-delimited JSON-RPC."""

    def __init__(self, argv: list[str], *, cwd: Path | None = None):
        self._proc = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self._inbox: queue.Queue[dict | None] = queue.Queue()
        self._next_id = 0
        self.pending: list[dict] = []
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self) -> None:
        assert self._proc.stdout is not None
        for raw in self._proc.stdout:
            line = raw.strip()
            if not line:
                continue
            try:
                self._inbox.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        self._inbox.put(None)

    def _send(self, message: dict) -> None:
        assert self._proc.stdin is not None
        self._proc.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
        self._proc.stdin.flush()

    def notify(self, method: str, params: dict | None = None) -> None:
        self._send({"method": method, "params": params or {}})

    def _next(self, deadline: float) -> dict | None:
        if self.pending:
            return self.pending.pop(0)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        try:
            message = self._inbox.get(timeout=remaining)
        except queue.Empty as exc:
            raise TimeoutError from exc
        if message is None:
            raise AppServerError("app-server closed the connection")
        return message

    def request(self, method: str, params: dict, *, timeout: float) -> Any:
        self._next_id += 1
        request_id = self._next_id
        self._send({"method": method, "id": request_id, "params": params})
        deadline = time.monotonic() + timeout
        skipped = []
        try:
            while True:
                message = self._next(deadline)
                if message.get("id") == request_id and "method" not in message:
                    if "error" in message:
                        raise AppServerError(str(message["error"].get("message", message["error"]))[:500])
                    return message.get("result")
                skipped.append(message)
        finally:
            self.pending = skipped + self.pending

    def events(self, *, timeout: float):
        deadline = time.monotonic() + timeout
        while True:
            yield self._next(deadline)

    def close(self) -> None:
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
            self._proc.terminate()
            self._proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self._proc.kill()


class CodexAppServerAdapter:
    name = "codex-app-server"
    label = "Codex App Server (stdio)"
    is_test_double = False

    def __init__(self, executable: Path, *, extra_args: list[str] | None = None, handshake_timeout: float = 30.0, cwd: Path | None = None):
        self._argv = [str(executable), *(extra_args if extra_args is not None else ["app-server"])]
        self._handshake_timeout = handshake_timeout
        self._cwd = cwd
        self._tool_servers: list[str] | None = None  # names found in the user's configuration; each is disabled per process
        self.last_scope: dict[str, Any] | None = None

    def capabilities(self) -> dict[str, Any]:
        return {"adapter": self.name, "transport": "stdio", "methods": ["initialize", "thread/resume", "turn/start", "turn/interrupt", "thread/read"],
                "verified": "only while a current connection proof is recorded",
                "tool_restrictions": "restricted per process (read-only sandbox, no tool servers, plugins, hooks, shell or web search) and read back before every turn; an unsafe effective scope blocks"}

    def _open(self, submission: NativeSubmission) -> _Session:
        if submission.target.sandbox not in SANDBOX_POLICY:
            raise NativeBlocked("unsafe_sandbox", f"Sandbox {submission.target.sandbox!r} is not an allowed tutor sandbox.")
        if submission.target.approval_policy not in APPROVAL_POLICY:
            raise NativeBlocked("approval_policy_unset", "Unsupported approval policy for the tutor target.")
        session = self._scoped_session()
        try:
            session.request("thread/resume", {"threadId": submission.target.native_thread_id}, timeout=self._handshake_timeout)
        except (AppServerError, TimeoutError) as exc:
            session.close()
            raise NativeBlocked("wrong_thread", f"The bound native thread could not be resumed: {exc or 'timeout'}. No other thread is tried.") from exc
        return session

    def _start(self, tool_servers: list[str]) -> "_Session":
        try:
            session = _Session([*self._argv, *launch_args(tool_servers)], cwd=self._cwd)
        except OSError as exc:
            raise NativeBlocked("native_unavailable", f"The native executable could not be started: {exc}") from exc
        try:
            session.request("initialize", {"clientInfo": CLIENT_INFO}, timeout=self._handshake_timeout)
            session.notify("initialized")
        except (AppServerError, TimeoutError) as exc:
            session.close()
            raise NativeBlocked("native_unavailable", f"The app-server did not complete its handshake: {exc or 'timeout'}") from exc
        return session

    def _scoped_session(self) -> "_Session":
        """A child process whose EFFECTIVE scope was read back and found safe. The user's own defaults (full access,
        tool servers, plugins, hooks, a notify program) are never inherited by a turn this app starts."""
        cwd = self._cwd or Path.cwd()
        session = self._start(self._tool_servers or [])
        try:
            if self._tool_servers is None:
                config = (session.request("config/read", {"cwd": str(cwd), "includeLayers": False}, timeout=self._handshake_timeout) or {}).get("config") or {}
                self._tool_servers = sorted(config.get("mcp_servers") or {})
                if self._tool_servers:  # relaunch with each configured tool server disabled
                    session.close()
                    session = self._start(self._tool_servers)
            checks, observed = read_scope(session, cwd, self._handshake_timeout)
        except (AppServerError, TimeoutError) as exc:
            session.close()
            raise NativeBlocked("unsafe_scope", f"The effective native configuration could not be read back ({exc or 'timeout'}); no turn is sent without it.") from exc
        self.last_scope = {"checks": checks, "observed": observed}
        failed = sorted(name for name, result in checks.items() if result != "PASS")
        if failed:
            session.close()
            raise NativeBlocked("unsafe_scope", "The native runtime's effective scope is not the restricted one this app requires: " + ", ".join(failed) + ". No turn was sent.")
        return session

    @staticmethod
    def _terminal(turn: dict, text: str | None) -> NativeObservation:
        status = turn.get("status")
        turn_id = str(turn.get("id")) if turn.get("id") is not None else None
        if status == "completed":
            if not text:
                return NativeObservation("failed", turn_id, None, "empty_completed_turn")
            return NativeObservation("completed", turn_id, text)
        if status == "interrupted":
            return NativeObservation("interrupted", turn_id, text)
        error = turn.get("error") or {}
        code = str(error.get("code") or error.get("message") or "native_turn_failed")[:128]
        lowered = code.lower()
        if "quota" in lowered or "rate" in lowered or "usage" in lowered:
            return NativeObservation("quota_wait", turn_id, None, code)
        if "auth" in lowered or "login" in lowered or "unauthor" in lowered:
            return NativeObservation("auth_required", turn_id, None, code)
        return NativeObservation("failed", turn_id, None, code)

    def _collect(self, session: _Session, thread_id: str, turn_id: str | None, budget: float) -> NativeObservation:
        text_parts: list[str] = []
        try:
            for message in session.events(timeout=budget):
                method = message.get("method")
                if method and "id" in message:  # a server → client request: an approval prompt. Never answered here.
                    try:
                        session.request("turn/interrupt", {"threadId": thread_id, "turnId": turn_id}, timeout=10)
                    except (AppServerError, TimeoutError):
                        pass
                    return NativeObservation("approval_pending", turn_id, None, "native_approval_requested", {"request": method})
                params = message.get("params") or {}
                if method == "item/completed":
                    item = params.get("item") or {}
                    if item.get("type") == "agentMessage" and isinstance(item.get("text"), str):
                        text_parts.append(item["text"])
                elif method == "turn/completed":
                    turn = params.get("turn") or {}
                    if turn_id is None or str(turn.get("id")) == turn_id:
                        return self._terminal(turn, "\n".join(text_parts) or None)
        except TimeoutError:
            return NativeObservation("completion_unknown", turn_id, None, None, {"note": "no terminal turn/completed within the budget; reconcile before any retry"})
        except AppServerError as exc:
            return NativeObservation("completion_unknown", turn_id, None, None, {"note": f"connection ended before a terminal result: {exc}"})
        return NativeObservation("completion_unknown", turn_id)

    def submit(self, submission: NativeSubmission) -> NativeObservation:
        session = self._open(submission)
        try:
            try:
                result = session.request("turn/start", {"threadId": submission.target.native_thread_id, "input": [{"type": "text", "text": submission.prompt}],
                                                        "approvalPolicy": APPROVAL_POLICY[submission.target.approval_policy],
                                                        "sandboxPolicy": SANDBOX_POLICY[submission.target.sandbox]}, timeout=self._handshake_timeout)
            except TimeoutError:
                # The request may have been accepted: unknown, not failed, and never re-sent blindly.
                return NativeObservation("completion_unknown", None, None, None, {"note": "turn/start was sent but not acknowledged"})
            except AppServerError as exc:
                return NativeObservation("failed", None, None, f"turn_start_rejected: {exc}"[:128])
            turn = (result or {}).get("turn") or {}
            turn_id = str(turn.get("id")) if turn.get("id") is not None else None
            return self._collect(session, submission.target.native_thread_id, turn_id, submission.budget_seconds)
        finally:
            session.close()

    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        if native_turn_id is None:
            return NativeObservation("completion_unknown", None, None, None, {"note": "no native turn id was retained; cannot reconcile automatically"})
        session = self._open(submission)
        try:
            result = session.request("thread/read", {"threadId": submission.target.native_thread_id, "includeTurns": True}, timeout=self._handshake_timeout)
        except (AppServerError, TimeoutError) as exc:
            return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": f"thread/read failed: {exc or 'timeout'}"})
        finally:
            session.close()
        for turn in ((result or {}).get("thread") or {}).get("turns") or []:
            if str(turn.get("id")) == native_turn_id:
                if turn.get("status") in {"completed", "failed", "interrupted"}:
                    texts = [i["text"] for i in turn.get("items") or [] if i.get("type") == "agentMessage" and isinstance(i.get("text"), str)]
                    return self._terminal(turn, "\n".join(texts) or None)
                return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": "turn still in progress"})
        return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": "turn id not found in the bound thread"})

    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        session = self._open(submission)
        try:
            session.request("turn/interrupt", {"threadId": submission.target.native_thread_id, "turnId": native_turn_id}, timeout=self._handshake_timeout)
            return self._collect(session, submission.target.native_thread_id, native_turn_id, 20.0)
        except (AppServerError, TimeoutError) as exc:
            return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": f"interrupt not confirmed: {exc or 'timeout'}"})
        finally:
            session.close()


class CodexQueueAdapter:
    """Version-specific candidate (`codex queue --thread <id> --message <text>` from installed help).

    It has no process-readable result channel, so the best it can ever report is
    ``completion_unknown``. It therefore cannot pass the connection proof and is never selected for
    tutoring; it exists so the report can state precisely why a queue help entry is insufficient.
    """

    name = "codex-queue"
    label = "Codex queue (no result channel)"
    is_test_double = False

    def __init__(self, executable: Path):
        self._executable = executable

    def capabilities(self) -> dict[str, Any]:
        return {"adapter": self.name, "terminal_result_channel": False, "verified": False, "reason": "Queue acceptance is not a completed turn."}

    def submit(self, submission: NativeSubmission) -> NativeObservation:
        try:
            done = subprocess.run([str(self._executable), "queue", "--thread", submission.target.native_thread_id, "--message", submission.prompt],
                                  capture_output=True, timeout=60, check=False, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return NativeObservation("completion_unknown", None, None, None, {"note": f"queue command did not return cleanly: {exc}"})
        if done.returncode != 0:
            return NativeObservation("failed", None, None, f"queue_exit_{done.returncode}")
        return NativeObservation("completion_unknown", None, None, None, {"note": "queued; this interface exposes no terminal result to an independent process"})

    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": "no result channel"})

    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        return NativeObservation("completion_unknown", native_turn_id, None, None, {"note": "no interrupt channel"})
