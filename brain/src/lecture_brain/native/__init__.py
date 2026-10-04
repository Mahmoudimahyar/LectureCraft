"""Native execution boundary (LL018): Dispatcher.submit / status / interrupt.

The target tutoring runtime is the user's existing native OpenAI/Codex course thread. This module
defines the adapter port and the checks that sit in front of every adapter:

* the target (course → thread, sandbox, approval policy) comes only from the trusted local
  binding — never from request content, never "latest thread";
* an adapter is usable only while a recorded proof matches the current executable identity and
  binding revision; otherwise dispatch is blocked ("Native connection not verified");
* there is no fallback: an unavailable native route never becomes another provider, API
  conversation or account;
* authentication category, thread identity, tool/sandbox policy and terminal-result capability
  are separate facts. Prompt-only restrictions are reported as exactly that.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import hashlib
import json
from typing import Any, Protocol

from ..config import Settings

TERMINAL_STATES = frozenset({"completed", "failed", "interrupted"})


class NativeBlocked(RuntimeError):
    """Dispatch refused before reaching any runtime. ``code`` is shown to the user as the next action."""

    def __init__(self, code: str, message: str, *, job_state: str = "AUTH_REQUIRED"):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.job_state = job_state


@dataclass(frozen=True)
class NativeTarget:
    course_id: str
    binding_id: str
    binding_revision: str
    native_thread_id: str
    sandbox: str
    approval_policy: str


@dataclass
class NativeSubmission:
    dispatch_id: str
    request_id: str
    target: NativeTarget
    prompt: str
    budget_seconds: float


@dataclass
class NativeObservation:
    """What was actually observed about one dispatch. Queue acceptance is not completion."""

    state: str  # completed | failed | interrupted | completion_unknown | approval_pending | quota_wait | auth_required
    native_turn_id: str | None = None
    text: str | None = None
    failure_code: str | None = None
    detail: dict = field(default_factory=dict)

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_STATES


class NativeAdapter(Protocol):
    name: str
    label: str
    is_test_double: bool

    def capabilities(self) -> dict[str, Any]: ...
    def submit(self, submission: NativeSubmission) -> NativeObservation: ...
    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation: ...
    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation: ...


class UnverifiedNativeAdapter:
    """Default: no proven native route. Every dispatch is refused; nothing is substituted."""

    name = "unverified"
    label = "Native connection not verified"
    is_test_double = False

    def __init__(self, reason: str = "Native connection not verified: no adapter has passed the connection proof for this installation and binding."):
        self.reason = reason

    def capabilities(self) -> dict[str, Any]:
        return {"adapter": self.name, "installed": "not_observed", "configured": False, "verified": False, "reason": self.reason}

    def submit(self, submission: NativeSubmission) -> NativeObservation:
        raise NativeBlocked("native_not_verified", self.reason)

    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        raise NativeBlocked("native_not_verified", self.reason)

    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        raise NativeBlocked("native_not_verified", self.reason)


# ---- trusted target resolution -----------------------------------------------------------------
UNSAFE_SANDBOXES = {"danger-full-access", "dangerFullAccess", ""}


def resolve_target(settings: Settings, *, course_id: str, request_binding_revision: str, request_thread_key: str) -> NativeTarget:
    """Resolve the exact native target from the local binding or block. No fallback, no guessing."""
    binding = settings.course(course_id)
    if not binding.usable:
        raise NativeBlocked("course_binding_unusable", binding.problem or "course binding is not usable", job_state="FAILED_FINAL")
    if request_binding_revision != settings.binding_revision:
        raise NativeBlocked("stale_binding", "The request was built against a different binding revision; renew it on the device.", job_state="WAITING_USER")
    if request_thread_key != binding.thread_key:
        raise NativeBlocked("wrong_thread", "The request names a thread outside the trusted binding.", job_state="FAILED_FINAL")
    if settings.profile == "fixture":
        return NativeTarget(course_id, f"fixture-binding-{course_id}", settings.binding_revision, f"fixture-thread-{course_id}", "read-only", "never")
    if not settings.native_dispatch_enabled:
        raise NativeBlocked("native_disabled", "Native dispatch is not enabled for this profile.")
    native = settings.native_binding
    thread_id = binding.native_thread_id
    if not thread_id:
        raise NativeBlocked("thread_not_bound", f"No explicit native thread is bound for {course_id}; 'latest thread' routing is never used.")
    sandbox = str(native.get("sandbox") or "")
    if sandbox in UNSAFE_SANDBOXES:
        raise NativeBlocked("unsafe_sandbox", "The tutor target has no explicit non-full-access sandbox; broad defaults are not inherited for unattended turns.")
    approval = str(native.get("approval_policy") or "")
    if not approval:
        raise NativeBlocked("approval_policy_unset", "No approval policy is bound for the tutor target.")
    return NativeTarget(course_id, str(native.get("binding_id") or f"native-{course_id}"), settings.binding_revision, thread_id, sandbox, approval)


# ---- proof record ------------------------------------------------------------------------------
def proof_path(settings: Settings) -> Path:
    return settings.state_dir / "native-proof.json"


def executable_identity(path: Path | None) -> dict[str, Any]:
    if path is None or not Path(path).is_file():
        return {"path": str(path) if path else None, "present": False, "sha256": None}
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return {"path": str(path), "present": True, "sha256": digest}


def load_proof(settings: Settings) -> dict | None:
    path = proof_path(settings)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def transport_digest(native_binding: dict, identity: dict) -> str:
    """What a proof actually covers: adapter kind, executable bytes and the turn policy."""
    material = {"adapter": native_binding.get("adapter"), "executable_sha256": identity.get("sha256"), "sandbox": native_binding.get("sandbox"),
                "approval_policy": native_binding.get("approval_policy")}
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode("utf-8")).hexdigest()


def proof_is_current(settings: Settings, proof: dict | None, executable: Path | None) -> tuple[bool, str]:
    """A proof counts only for the exact executable bytes, transport and policy it was recorded against."""
    if not proof or proof.get("status") != "PASS":
        return False, "No passing native connection proof is recorded."
    identity = executable_identity(executable)
    if not identity["present"]:
        return False, "The native executable is not present at the bound path."
    if proof.get("transport_digest") != transport_digest(settings.native_binding, identity):
        return False, "The native executable or its policy changed since the proof (update/restart/reconfiguration); run the connection proof again."
    if settings.native_binding.get("course_targets_confirmed") is not True:
        return False, "The proof used a disposable target; confirm the course thread targets in the native binding to enable tutoring."
    return True, "verified"


def select_adapter(settings: Settings, *, journal=None) -> NativeAdapter:
    """Pick the adapter for this profile. Fixture → labeled double; otherwise proven adapter or the blocker."""
    if settings.profile == "fixture":
        from .fixture_tutor import FixtureTutorAdapter

        return FixtureTutorAdapter(journal=journal)
    if not settings.native_dispatch_enabled:
        return UnverifiedNativeAdapter("Native dispatch is not enabled. Reading and drafting remain available.")
    native = settings.native_binding
    executable = Path(native["executable"]) if native.get("executable") else None
    ok, reason = proof_is_current(settings, load_proof(settings), executable)
    if not ok:
        return UnverifiedNativeAdapter(reason)
    if native.get("adapter") == "codex-app-server" and executable is not None:
        from .codex_app_server import CodexAppServerAdapter

        return CodexAppServerAdapter(executable)
    return UnverifiedNativeAdapter("No supported, proven adapter is configured.")
