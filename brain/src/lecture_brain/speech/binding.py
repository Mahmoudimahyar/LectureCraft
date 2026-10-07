"""The prepared, inactive binding of later transcription runs to this installation's ONE runner (R2-T2). A readback.

A later job that transcribes more recordings must be this same runner: the same command and the same settings
identity as the runs that made the speech text the app shows. This module states that binding from what the runner
already keeps, so that a person, the app and any later wrapper read one and the same thing:

* the command is the runner's own command that continues its queue (``SpeechRunner.resume_argv``);
* the settings identity is the digest every chunk result must carry (model, inference settings, device, compute type,
  sample rate), computed from the binding as it is now and compared with the one frozen in the queue the published
  text was made under;
* it is listed as ``prepared_inactive`` only when this runner's output was really published into the app's store, and
  as ``refused`` when the binding would use other settings than that output was made with (the runner itself refuses
  to continue the queue then);
* ``schedule`` is always ``None``.

It reads the binding file and the queue file and computes two digests. It creates no file, receipt or lock, launches
nothing and registers nothing with the operating system: making a later run happen is a separate decision of the
owner, taken outside this module. The runner, its worker and its ledger are not changed by it.
"""
from __future__ import annotations

import json
import subprocess
from typing import Any

from .. import contracts as c
from ..config import Settings
from . import runner as rn
from .ledger import read_json

STATE_PREPARED = "prepared_inactive"
STATE_REFUSED = "refused"
_NO_BINDING = "No speech tool is set up on this installation, so no later run is prepared and nothing is scheduled."
_NOTHING_PUBLISHED = "This installation's runner has not published any speech text yet, so no later run is prepared and nothing is scheduled."
_PREPARED = ("Prepared, not active. Nothing is scheduled: no task, service or startup entry exists for it, and the app never starts it. It is the same command and the same "
             "settings as the runs that made the speech text shown here.")
_REFUSED = ("Not prepared. The settings this command would use now are not the settings the published speech text was made with, so the runner would refuse to continue "
            "its queue with them. Nothing is scheduled.")


def command_sha256(argv: list[str]) -> str:
    """SHA-256 of the argv as compact JSON: the form a command is pinned in."""
    return c.sha256_hex(json.dumps(argv, separators=(",", ":")).encode("utf-8"))


def _frozen(runner: rn.SpeechRunner) -> tuple[dict[str, str], str | None]:
    """From the frozen queue: the generation published for each ``course/source``, and the settings identity it was frozen under."""
    try:
        queue = read_json(runner.queue_path)
    except ValueError:
        return {}, None
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        return {}, None
    published = {item["key"]: item["published_generation"] for item in queue["items"]
                 if isinstance(item, dict) and isinstance(item.get("key"), str) and isinstance(item.get("published_generation"), str) and item["published_generation"]}
    frozen = queue.get("settings_sha256")
    return published, frozen if isinstance(frozen, str) and frozen else None


def prepared(settings: Settings) -> dict[str, Any]:
    """``{binding, reason, published, queue_settings_sha256}``.

    ``binding`` is ``{state, command, argv, command_sha256, settings_sha256, runner, same_runner, schedule: None,
    note}`` or ``None`` with ``reason: {code, text}`` saying why the installation has none: ``no_speech_binding``, a
    refusal of the binding file (``binding_invalid``, ``state_dir_not_bound``) or ``nothing_published_by_this_runner``.
    ``published`` maps ``course/source`` to the generation this runner published for it under
    ``queue_settings_sha256``. Reads only."""
    runner = rn.SpeechRunner(settings, None)
    published, frozen = _frozen(runner)
    base = {"published": published, "queue_settings_sha256": frozen}
    try:
        binding = runner._binding()
    except rn.Refused as refusal:
        if refusal.code == "no_binding":
            return {"binding": None, "reason": {"code": "no_speech_binding", "text": _NO_BINDING}, **base}
        return {"binding": None, "reason": {"code": refusal.code, "text": f"The speech set-up of this installation cannot be used, so no later run is prepared. {refusal.detail}"}, **base}
    if not published or frozen is None:
        return {"binding": None, "reason": {"code": "nothing_published_by_this_runner", "text": _NOTHING_PUBLISHED}, **base}
    argv = runner.resume_argv()
    now = runner._settings_sha256(binding)
    same = now == frozen
    return {"binding": {"state": STATE_PREPARED if same else STATE_REFUSED, "command": subprocess.list2cmdline(argv), "argv": argv, "command_sha256": command_sha256(argv),
                        "settings_sha256": now, "runner": rn.RUNNER_VERSION, "same_runner": same, "schedule": None, "note": _PREPARED if same else _REFUSED},
            "reason": None, **base}
