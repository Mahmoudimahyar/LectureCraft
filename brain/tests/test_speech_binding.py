"""R2-T2: the prepared, inactive binding of later transcription runs to the ONE runner, and the runner identity of each
generated speech generation, as a readback.

Everything here is synthetic: the labelled fake worker of ``test_speech.py`` stands for the speech tool and no model
runs. What is proven: the readback names the runner's own command and settings identity, says "prepared, not active"
only after this runner's output was published into the app's store, refuses a binding whose settings are not the ones
the published text was made with, states no schedule, and reads only — no file, receipt, lock, task or process comes
from it.
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from lecture_brain import timing_links as tl
from lecture_brain.journal import Journal
from lecture_brain.speech import binding as sb
from lecture_brain.speech import runner as rn
from test_speech import FAKE_WORKER, FAST, Ticking, control, fake_binding, private_files, take_out_the_showcase_recording  # noqa: F401 - `control` is a fixture

SHORT = "be562"  # one synthetic recording of 6 s: one chunk


@pytest.fixture()
def workspace(workspace) -> Path:
    take_out_the_showcase_recording(workspace)  # the scenarios below need one short recording, not the long showcase one
    return workspace


@pytest.fixture()
def journal(settings):
    j = Journal.open(settings.journal_path, clock=Ticking(), synced_roots=[])
    yield j
    j.close()


@pytest.fixture()
def bound(tmp_path, monkeypatch):
    """Names a LABELLED test binding for the fixture profile (``LL_SPEECH_BINDING``); returns a function that rewrites it."""
    path = tmp_path / "speech-binding.json"

    def write(**over) -> dict:
        document = {**fake_binding(tmp_path), "worker_script": str(FAKE_WORKER), "timings": FAST, **over}
        path.write_text(json.dumps(document), encoding="utf-8")
        return document

    write()
    monkeypatch.setenv("LL_SPEECH_BINDING", str(path))
    return write


def run_one(settings, journal) -> dict:
    result = rn.SpeechRunner(settings, journal).run(chunk_seconds=25, courses=[SHORT])
    assert result["state"] == "completed" and result["chunks_completed"] == 1, result
    return result


def test_without_a_speech_binding_nothing_is_prepared_and_the_reason_is_stated(settings, journal):
    before = private_files(settings)
    report = sb.prepared(settings)
    assert report["binding"] is None and report["reason"]["code"] == "no_speech_binding" and report["reason"]["text"].strip()
    assert report["published"] == {} and report["queue_settings_sha256"] is None
    assert private_files(settings) == before and not (settings.state_dir / "speech").exists() and journal.receipts(kind="speech-run") == []


def test_a_binding_whose_runner_has_published_nothing_yet_is_not_listed_as_prepared(settings, journal, bound):
    before = private_files(settings)
    report = sb.prepared(settings)
    assert report["binding"] is None and report["reason"]["code"] == "nothing_published_by_this_runner"
    assert private_files(settings) == before and not (settings.state_dir / "speech").exists()


def test_after_real_publication_the_binding_is_prepared_inactive_with_the_runners_own_command_and_settings_identity(settings, journal, bound, control):
    run_one(settings, journal)
    status = rn.status(settings)
    queue = json.loads((settings.state_dir / "speech" / "queue.json").read_text(encoding="utf-8"))
    before, receipts = private_files(settings), len(journal.receipts(kind="speech-run"))

    report = sb.prepared(settings)

    binding = report["binding"]
    assert report["reason"] is None and set(binding) == {"state", "command", "argv", "command_sha256", "settings_sha256", "runner", "same_runner", "schedule", "note"}
    assert binding["state"] == "prepared_inactive" and binding["same_runner"] is True and binding["schedule"] is None
    # The SAME command: what the runner itself prints as the command that continues its queue.
    assert binding["argv"] == status["resume_argv"] and binding["command"] == status["resume_command"] == subprocess.list2cmdline(status["resume_argv"])
    assert binding["command_sha256"] == hashlib.sha256(json.dumps(status["resume_argv"], separators=(",", ":")).encode("utf-8")).hexdigest()
    assert "--retry-failed" not in binding["argv"] and binding["argv"][-1] == "speech-run"
    # The SAME settings identity: the one every chunk result of the frozen queue carries.
    assert binding["settings_sha256"] == queue["settings_sha256"] == report["queue_settings_sha256"] and len(binding["settings_sha256"]) == 64
    assert binding["runner"] == rn.RUNNER_VERSION
    assert "not active" in binding["note"] and "Nothing is scheduled" in binding["note"]
    published = {item["key"]: item["published_generation"] for item in queue["items"] if item["published_generation"]}
    assert report["published"] == published and len(published) == 1
    # A readback: nothing written, no receipt, no lock held, no stop file.
    assert private_files(settings) == before and len(journal.receipts(kind="speech-run")) == receipts
    assert sb.prepared(settings) == report


def test_a_binding_that_would_run_other_settings_than_the_published_text_was_made_with_is_refused(settings, journal, bound, control, tmp_path):
    run_one(settings, journal)
    other = tmp_path / "another-model"
    other.mkdir()
    for name in rn.MODEL_FILES:
        (other / name).write_text("LABELLED PLACEHOLDER: not a speech model\n", encoding="utf-8")
    bound(model_dir=str(other))  # another model: another settings identity

    report = sb.prepared(settings)

    binding = report["binding"]
    assert binding["state"] == "refused" and binding["same_runner"] is False and binding["schedule"] is None
    assert binding["settings_sha256"] != report["queue_settings_sha256"] and "refuse" in binding["note"]


def test_an_unusable_binding_file_is_no_prepared_binding(settings, journal, bound, control):
    run_one(settings, journal)
    bound(threads=64)  # more than the runner allows
    report = sb.prepared(settings)
    assert report["binding"] is None and report["reason"]["code"] == "binding_invalid"


def test_the_course_readback_lists_the_binding_with_the_queue_and_the_runner_identity_of_every_generation(settings, journal, bound, control):
    nothing = tl.status(settings, SHORT)
    assert nothing["binding"] is None and nothing["binding_reason"]["code"] == "nothing_published_by_this_runner" and nothing["runners"] == []
    run_one(settings, journal)
    before = private_files(settings)

    report = tl.status(settings, SHORT)

    assert report["binding"]["state"] == "prepared_inactive" and report["binding"]["schedule"] is None and report["binding_reason"] is None
    assert report["binding"]["command"] == report["resume_command"]
    (identity,) = report["runners"]
    assert set(identity) == {"origin", "runner", "tool", "tool_version", "model", "language", "parameters_sha256", "settings_sha256", "same_as_prepared", "generations", "recordings"}
    assert identity["origin"] == "speech_runner" and identity["runner"] == rn.RUNNER_VERSION and identity["tool"] and identity["model"]
    assert identity["settings_sha256"] == report["binding"]["settings_sha256"] and identity["same_as_prepared"] is True
    assert identity["generations"] == 1 and len(identity["recordings"]) == 1
    (row,) = identity["recordings"]
    assert set(row) == {"source_id", "filename", "generation"} and row["generation"] == next(iter(sb.prepared(settings)["published"].values()))
    # Without the queue (Study) the runner is not consulted: nothing is said of a binding, and the identities state no comparison.
    plain = tl.status(settings, SHORT, queue=False)
    assert plain["binding"] is None and plain["binding_reason"] is None and plain["queue_included"] is False
    assert [(r["tool"], r["settings_sha256"], r["same_as_prepared"]) for r in plain["runners"]] == [(identity["tool"], None, None)]
    assert private_files(settings) == before


def test_a_generation_that_this_runner_did_not_publish_states_its_own_parameters_and_no_comparison(settings, journal, tmp_path):
    from test_timing_links import import_generation, transcript_lines

    import_generation(settings, journal, tmp_path / "out" / "gen-0001", transcript_lines(settings))  # a labelled synthetic producer, imported from a folder
    report = tl.status(settings, "be505")
    assert report["binding"] is None and report["binding_reason"]["code"] == "no_speech_binding"
    (identity,) = report["runners"]
    assert (identity["tool"], identity["tool_version"], identity["model"], identity["parameters_sha256"]) == ("synthetic-fixture-producer", "0.0.0", "none-synthetic", "b" * 64)
    assert identity["origin"] is None and identity["runner"] is None and identity["settings_sha256"] is None and identity["same_as_prepared"] is None
    assert identity["recordings"][0]["generation"] == "gen-0001"


def test_the_readback_module_starts_nothing_and_schedules_nothing():
    """Read from the code: the module calls nothing that starts a process, and names no scheduler, service or startup place."""
    source = Path(sb.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    called = {node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "") for node in ast.walk(tree) if isinstance(node, ast.Call)}
    assert not called & {"Popen", "run", "call", "check_call", "check_output", "system", "startfile", "spawn", "execv", "write_text", "write_bytes", "write_json", "mkdir", "open", "unlink"}, called
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names}
    assert not imported & {"winreg", "sched", "threading", "multiprocessing", "asyncio"}
    code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
    assert not any(word in code.lower() for word in ("schtasks", "crontab", "register-scheduledtask", "systemd", "launchd"))
