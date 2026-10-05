"""Course-tutor pilot: a restricted, app-created Codex worker with a persisted budget ("Experimental Codex worker tutor").

This is a trial route chosen explicitly for a pilot. It is not the learner's desktop course chats, it never replaces them
silently, and nothing falls back to it or from it. The grant is small and written down:

* one thread, created by this adapter on first use and resumed afterwards;
* a fixed number of turns. A slot is reserved on disk *before* a turn is sent, so an unclear acceptance has used its
  slot; the same dispatch is never sent twice, and a restart cannot forget what was used;
* only allow-listed courses;
* before every turn the effective scope is read back from the running worker (read-only sandbox, no tool servers,
  plugins, hooks, shell, web search or notify program, no instruction files) and the thread's own scope is checked.
  If any of it cannot be verified, nothing is sent and no slot is used.

Every prompt that is sent is kept, with its digest, in the pilot's private state folder.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
from typing import Any

from ..config import Settings
from ..fsutil import replace_atomic
from . import NativeBlocked, NativeObservation, NativeSubmission
from .codex_app_server import AppServerError, CodexAppServerAdapter

PENDING_THREAD = "pilot-thread-not-created-yet"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class PilotLedger:
    """The pilot grant and what has been used of it. One small JSON file, replaced atomically."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self.path = settings.state_dir / "pilot-budget.json"

    def state(self) -> dict[str, Any]:
        grant = self._settings.pilot
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {"contract": "ll.pilot-budget/1", "thread": None, "turns": []}
        data.update(label=grant.get("label"), courses=list(grant.get("courses", [])), max_threads=grant.get("max_threads", 1), max_turns=grant.get("max_turns", 0))
        data["remaining_turns"] = max(0, data["max_turns"] - len(data["turns"]))
        return data

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        replace_atomic(self.path, (json.dumps({k: v for k, v in data.items() if k != "remaining_turns"}, indent=2, sort_keys=True) + "\n").encode("utf-8"))

    def record_thread(self, thread: dict[str, Any]) -> None:
        data = self.state()
        if data["thread"] is not None:
            raise NativeBlocked("pilot_thread_exists", "The pilot already has its one thread; another is never created.")
        data["thread"] = thread
        self._save(data)

    def turn(self, dispatch_id: str) -> dict | None:
        return next((t for t in self.state()["turns"] if t["dispatch_id"] == dispatch_id), None)

    def reserve(self, *, dispatch_id: str, request_id: str, course_id: str, prompt: str) -> int:
        data = self.state()
        if not data["remaining_turns"]:
            raise NativeBlocked("pilot_budget_exhausted", f"All {data['max_turns']} pilot turns have been used. Nothing is sent and nothing answers in the worker's place.", job_state="WAITING_USER")
        slot = len(data["turns"]) + 1
        data["turns"].append({"slot": slot, "dispatch_id": dispatch_id, "request_id": request_id, "course_id": course_id, "reserved_at": _now(), "outcome": "reserved_before_send",
                              "turn_id": None, "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(), "prompt_chars": len(prompt)})
        self._save(data)
        return slot

    def settle(self, dispatch_id: str, *, outcome: str, turn_id: str | None, release: bool = False) -> None:
        data = self.state()
        if release:  # the worker refused the request outright: nothing reached a model, so the slot was not used
            data["turns"] = [t for t in data["turns"] if t["dispatch_id"] != dispatch_id]
        for entry in data["turns"]:
            if entry["dispatch_id"] == dispatch_id:
                entry.update(outcome=outcome, turn_id=turn_id, settled_at=_now())
        self._save(data)


class PilotWorkerAdapter(CodexAppServerAdapter):
    name = "codex-worker-pilot"
    label = "Experimental Codex worker tutor"
    is_test_double = False

    def __init__(self, settings: Settings, *, argv_prefix: list[str] | None = None, handshake_timeout: float = 40.0):
        executable = Path(argv_prefix[0]) if argv_prefix else Path(settings.native_binding["executable"])
        self._settings = settings
        self._ledger = PilotLedger(settings)
        self._work = settings.state_dir / "pilot"
        cwd = self._work / "cwd"
        cwd.mkdir(parents=True, exist_ok=True)
        super().__init__(executable, extra_args=argv_prefix[1:] if argv_prefix else None, handshake_timeout=handshake_timeout, cwd=cwd)
        self.label = settings.pilot.get("label") or self.label

    def capabilities(self) -> dict[str, Any]:
        budget = self._ledger.state()
        return {"adapter": self.name, "label": self.label, "transport": "codex app-server over stdio, separate restricted worker (marked experimental by the CLI)",
                "courses": budget["courses"], "max_turns": budget["max_turns"], "remaining_turns": budget["remaining_turns"], "thread_id": (budget["thread"] or {}).get("thread_id"),
                "desktop_thread_integration": "unresolved", "verified": "scope read back before every turn"}

    # ---- one turn -----------------------------------------------------------------------------------
    def _thread(self, session, course_id: str) -> str:
        """The pilot's one thread: created once with an explicit scope, resumed afterwards. Its scope is checked every time."""
        known = self._ledger.state()["thread"]
        params = {"cwd": str(self._cwd), "sandbox": "read-only", "approvalPolicy": "never"}
        try:
            if known is None:
                reply = session.request("thread/start", dict(params, ephemeral=False), timeout=self._handshake_timeout) or {}
            else:
                reply = session.request("thread/resume", dict(params, threadId=known["thread_id"]), timeout=self._handshake_timeout) or {}
        except (AppServerError, TimeoutError) as exc:
            raise NativeBlocked("unsafe_scope" if known is None else "wrong_thread", f"The pilot thread could not be {'created' if known is None else 'resumed'}: {exc or 'timeout'}. Nothing was sent.") from exc
        thread_id = (reply.get("thread") or {}).get("id")
        sandbox = reply.get("sandbox") or {}
        failed = [name for name, ok in (("thread_sandbox_read_only", sandbox.get("type") == "readOnly" and not sandbox.get("networkAccess")), ("thread_approval_never", reply.get("approvalPolicy") == "never"),
                                         ("thread_has_no_instruction_files", reply.get("instructionSources") == []),
                                         ("same_thread_resumed", isinstance(thread_id, str) and bool(thread_id) and (known is None or thread_id == known["thread_id"]))) if not ok]
        if failed:
            raise NativeBlocked("unsafe_scope", "The pilot thread does not have the required scope: " + ", ".join(failed) + ". No turn was sent.")
        if known is None:
            self._ledger.record_thread({"thread_id": thread_id, "created_at": _now(), "created_for_course": course_id, "cwd": str(self._cwd), "sandbox": sandbox, "approval_policy": reply.get("approvalPolicy"),
                                        "instruction_sources": reply.get("instructionSources"), "model": reply.get("model"), "model_provider": reply.get("modelProvider")})
        return thread_id

    def submit(self, submission: NativeSubmission) -> NativeObservation:
        course_id = submission.target.course_id
        if course_id not in self._settings.pilot.get("courses", []):
            raise NativeBlocked("pilot_course_not_allowed", f"{course_id} is not part of the pilot.", job_state="FAILED_FINAL")
        earlier = self._ledger.turn(submission.dispatch_id)
        if earlier is not None:  # this dispatch already used its slot: reconcile by reading, never send it again
            return NativeObservation("completion_unknown", earlier.get("turn_id"), None, None, {"note": "This dispatch was already sent once; it is not sent again. Check its status instead."})
        if not self._ledger.state()["remaining_turns"]:
            self._ledger.reserve(dispatch_id=submission.dispatch_id, request_id=submission.request_id, course_id=course_id, prompt=submission.prompt)  # raises pilot_budget_exhausted
        session = self._scoped_session()  # raises unsafe_scope before anything is created or sent
        try:
            thread_id = self._thread(session, course_id)
            prompts = self._work / "prompts"
            prompts.mkdir(parents=True, exist_ok=True)
            (prompts / f"{submission.dispatch_id}.txt").write_text(submission.prompt, encoding="utf-8", newline="\n")
            slot = self._ledger.reserve(dispatch_id=submission.dispatch_id, request_id=submission.request_id, course_id=course_id, prompt=submission.prompt)
            manifest = self._work / "manifests" / f"{submission.request_id}.json"
            if manifest.is_file():
                data = json.loads(manifest.read_text(encoding="utf-8"))
                data.update(dispatch_id=submission.dispatch_id, pilot_slot=slot, thread_id=thread_id, prompt_chars=len(submission.prompt),
                            prompt_sha256=hashlib.sha256(submission.prompt.encode("utf-8")).hexdigest(), effective_scope=self.last_scope)
                manifest.write_text(json.dumps(data, indent=2), encoding="utf-8")
            try:
                result = session.request("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text": submission.prompt}], "approvalPolicy": "never",
                                                        "sandboxPolicy": {"type": "readOnly"}, "clientUserMessageId": submission.dispatch_id}, timeout=self._handshake_timeout)
            except TimeoutError:
                self._ledger.settle(submission.dispatch_id, outcome="completion_unknown", turn_id=None)
                return NativeObservation("completion_unknown", None, None, None, {"note": "turn/start was sent but not acknowledged; the slot is used and the turn is not re-sent", "native_thread_id": thread_id})
            except AppServerError as exc:
                self._ledger.settle(submission.dispatch_id, outcome="rejected_before_send", turn_id=None, release=True)
                return NativeObservation("failed", None, None, f"turn_start_rejected: {exc}"[:128], {"native_thread_id": thread_id})
            turn_id = ((result or {}).get("turn") or {}).get("id")
            turn_id = str(turn_id) if turn_id is not None else None
            observation = self._collect(session, thread_id, turn_id, submission.budget_seconds)
            observation.detail["native_thread_id"] = thread_id
            self._ledger.settle(submission.dispatch_id, outcome=observation.state, turn_id=observation.native_turn_id or turn_id)
            return observation
        finally:
            session.close()

    # ---- reconcile / interrupt on the pilot thread; neither uses a slot ----------------------------------
    def _on_pilot_thread(self, submission: NativeSubmission) -> NativeSubmission:
        thread = self._ledger.state()["thread"]
        if thread is None:
            raise NativeBlocked("pilot_thread_missing", "No pilot thread exists; there is nothing to check.")
        return replace(submission, target=replace(submission.target, native_thread_id=thread["thread_id"]))

    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        entry = self._ledger.turn(submission.dispatch_id)
        observation = super().status(self._on_pilot_thread(submission), native_turn_id or (entry or {}).get("turn_id"))
        if observation.terminal and entry is not None:
            self._ledger.settle(submission.dispatch_id, outcome=observation.state, turn_id=observation.native_turn_id)
        observation.detail["native_thread_id"] = self._ledger.state()["thread"]["thread_id"]
        return observation

    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        return super().interrupt(self._on_pilot_thread(submission), native_turn_id)
