"""The ONE resumable offline transcription runner: the supervisor.

The same runner serves a manual command, the app and any later scheduled wrapper; nothing here schedules anything.
One call of :meth:`SpeechRunner.run` is one bounded run:

* **Binding** — interpreter, model directory, thread count, grant id and ceiling come from the private binding file
  ``config/local-bindings/speech.json`` (the fixture profile takes a test binding from ``LL_SPEECH_BINDING``). The
  interpreter is EXTERNAL: this process never imports a speech library, it launches ``worker.py`` with that
  interpreter and an offline child environment, one worker, at most four threads. Outside the fixture profile the
  binding also names the ONE state directory the grant's ledger lives in (``state_dir``, an ABSOLUTE path: a
  relative one would be another directory in every copy of the working tree): a run or a status for another state
  directory is refused (``state_dir_not_bound``), so a second allowance cannot be opened under the same grant by
  pointing the command somewhere else.
* **Allowance** — wall time of speech processing is charged to the durable ledger (``ledger.py``): reserved before
  the worker is launched, refreshed while it runs, settled when it ends — also when the run ends by an error or an
  interrupt — and settled conservatively when a run died. A refresh (of the reservation and of the worker's lease)
  that cannot be written at one look is tried again at the next; the run gives up only when none went through for
  a whole lease. When less than the safety margin is left the run stops cleanly with ``ceiling_reached`` and the
  queue stays.
* **Frozen queue** — ``queue.json`` is written at the first run: every recording of every configured course with its
  identity (source id, version id, SHA-256 of the bytes on disk, size, container duration, linked lecture ids).
  Later runs reuse it. A recording whose bytes changed is a ``source_conflict`` and is skipped; missing media stays
  listed with its reason; recordings that appear later are reported as ``not_in_frozen_queue``. The status reports
  lecture ids from the inventory as it is NOW (the frozen copy is kept beside them).
* **Chunks** — fixed windows of original-media time with a small overlap (``chunks.py``). Each result is written
  atomically by the worker to ``work/<short id>/chunk-<n>.json``; a finished chunk is never done again. A result
  the supervisor does not accept — also one whose inside the merge could not read — counts as a failed attempt of
  that chunk with the reason shown; it is never silently done again.
* **Repetition loops** — a recogniser can emit one word over and over instead of the speech. The settings of the
  verified proof are the PRIMARY pass; only a chunk whose first pass fails the repetition check is decoded once
  more with the second-pass settings below, and the pass that keeps more accepted words is kept. The second-pass
  settings and the selection rule have their own identity (``SECOND_PASS_SHA256``), recorded in every chunk result
  that used them and in the published provenance. Whatever still fails the check is WITHHELD from the published
  text and reported as unresolved intervals (not speech, not silence), each running from the accepted text before
  the withheld run to the accepted text after it: around a loop the recogniser often emits nothing, and that time
  is not known to be silence either. A chunk on disk that is mostly such output and was made without a second pass
  is done again.
* **Publication** — the contiguous processed prefix is merged deterministically and published as a new immutable
  generation of the existing derived store through the importer's own admission checks, as generated, unreviewed
  text with its window, its covered intervals and its unresolved intervals. The generation id ends in a digest of
  the generation as it is assembled (the bytes that are stored, with a stand-in for the id and the time), so other
  content — after other chunk results, another merge rule, an edit of this code or of the assembly, another
  consumer version — is always another generation and never a conflict with a stored one. A run that finds a
  recording published whole by other publication code publishes it again from the chunk results on disk: no
  worker, no charge. Accepted chunk results that still cannot be merged set THAT recording aside
  (``publish_rejected``) and the queue goes on. A recording whose every chunk is published is ``complete`` only
  when nothing is unresolved; otherwise it is ``complete_with_unresolved``.
* **Stopping** — the stop file ``STOP``, the ceiling, a worker failure. The supervisor stops only its own child.
  A RESOURCE failure reported by the worker (memory, model, runtime, also at start-up) PAUSES the queue: nothing is
  set aside, later runs start no worker and say ``paused``, and ``--retry-failed`` continues — with the recording
  whose chunk it happened in tried last, so a problem of that one recording does not hold up the others. A worker
  that dies or stalls without saying why is counted against the chunk it was in (twice sets that recording
  aside); when it ends the same way in the NEXT recording with no chunk finished in between, the cause is taken
  to be the machine and the queue pauses as well.

Every run, no-change run, refusal, error and interrupt leaves one ``speech-run`` receipt in the journal. Nothing is
written into a course folder: the runner reads recordings and writes only below the app's private state directory.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any, Callable, Mapping
import uuid

from .. import contracts as c
from .. import derived as derived_module
from ..annotations import media_duration_ms
from ..config import Settings
from ..derived import MANIFEST_NAME, TIME_TOLERANCE_MS, Derived, assemble_generation
from ..journal import Journal
from ..ownerio.inventory import build_inventory
from ..preparation import Preparation
from . import chunks as ch
from .ledger import Allowance, LedgerRefused, read_json, write_json

RUNNER_VERSION = "speech-runner-3"
RECEIPT_KIND = "speech-run"
BINDING_NAME = "speech.json"  # in config/local-bindings/ (private, git-ignored)
BINDING_ENV = "LL_SPEECH_BINDING"  # the fixture profile only: a test binding file
STOP_NAME = "STOP"
MAX_CEILING_SECONDS = 14_400  # the size of the grant given for this pass; a larger number in a file is refused, not honoured
MAX_THREADS = 4
WORKERS = 1
DEVICE, COMPUTE_TYPE, SAMPLE_RATE_HZ = "cpu", "int8", 16_000
INFERENCE_SETTINGS = {"language": "en", "task": "transcribe", "beam_size": 5, "best_of": 1, "temperature": 0.0, "word_timestamps": True, "vad_filter": False,
                      "condition_on_previous_text": True, "compression_ratio_threshold": 2.4, "log_prob_threshold": -1.0, "no_speech_threshold": 0.6}
# Used ONLY for a second pass over a chunk whose first pass (the settings above) fell into a repetition loop: each
# 30-second window is decoded on its own, and a window that fails the recogniser's own checks is retried warmer.
SECOND_PASS_SETTINGS = {"condition_on_previous_text": False, "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]}
SECOND_PASS_SELECTION = "most-accepted-words-1"  # the worker keeps the pass with more accepted (non-failing) words; see worker.choose_pass
LEGACY_SECOND_PASS_SELECTION = "least-failed-text-1"  # how chunk results made before the rule above chose their pass
DECODING_POLICY = "repetition-second-pass-2"
# A chunk result made under one of these was checked by its worker and decoded once more when it had to be. Results
# of the first policy stay accepted: they are finished chunks, and their second-pass identity is recorded with them.
ACCEPTED_DECODING_POLICIES = frozenset({"repetition-second-pass-1", DECODING_POLICY})
# withhold-repetition-2: withholding as in -1; the overlap is spliced at a matched word. -3: the time a withheld run stands for runs from the accepted text
# before it to the accepted text after it (chunks.UNRESOLVED_RULE), and an overlap in which only one chunk has accepted text is supplied by that chunk
# (chunks.OVERLAP_RULE). The reader ranks these policies (derived.MERGE_POLICY_ORDER): a generation under an older one gives way to one under a newer one.
MERGE_POLICY = "withhold-repetition-3"
REPETITION_THRESHOLD = INFERENCE_SETTINGS["compression_ratio_threshold"]  # the recogniser's own measure and its own threshold


def second_pass_identity(settings: Mapping[str, Any], selection: str = SECOND_PASS_SELECTION) -> str:
    """The identity of a second pass: the digest of its settings and of the rule that chooses between the two passes.
    The worker computes the same digest from the job it was given and writes it into every chunk result it used
    a second pass on, so a later edit of either is visible there and in the published provenance."""
    return c.sha256_hex(c.dump_json({"second_pass_settings": dict(settings), "selection_rule": selection}))


SECOND_PASS_SHA256 = second_pass_identity(SECOND_PASS_SETTINGS)
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
DEFAULT_CHUNK_SECONDS = 600.0
DEFAULT_OVERLAP_SECONDS = 5.0
DEFAULT_SAFETY_MARGIN_SECONDS = 180.0  # must be longer than one chunk takes, so a chunk that starts always ends below the ceiling
DEFAULT_PUBLISH_EVERY_CHUNKS = 4
MAX_CHUNK_ATTEMPTS = 2  # a chunk that fails this often sets its recording aside as failed
GENERATION_NAMES = 3  # names tried for one publication: the digest of its bytes, then digests of that, when a stored folder of the name holds other or damaged bytes
# ``complete``: every chunk is published and nothing is unresolved. ``complete_with_unresolved``: every chunk is
# published, but part of the recording is time whose text was withheld; it is processed, not covered.
STATES = ("queued", "partial", "complete", "complete_with_unresolved", "source_conflict", "failed", "not_in_frozen_queue")
_WORKABLE = frozenset({"queued", "partial"})
_PUBLISHED_WHOLE = frozenset({"complete", "complete_with_unresolved"})
PAUSE_REASON = "resource_failure"
_READABLE = frozenset({"registered_readable", "present_unindexed"})
_GRANT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SCRUBBED = frozenset({"PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"})  # the child is another Python, not this environment
CLEAN_STATES = frozenset({"completed", "no_change", "ceiling_reached", "stopped", "max_seconds_reached", "max_chunks_reached"})


@dataclass(frozen=True)
class Timings:
    poll_seconds: float = 0.5  # how often the supervisor looks at its child
    heartbeat_seconds: float = 5.0  # how often the ledger reservation and the worker's lease are refreshed
    lease_seconds: float = 30.0  # a worker that sees no fresh lease for this long stops by itself
    stall_seconds: float = 900.0  # a worker without a heartbeat for this long is stopped as failed
    terminate_wait_seconds: float = 10.0


class Refused(Exception):
    """A run that does not start. ``code`` is the stable reason recorded in the receipt."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


class RunLock:
    """One supervisor per state directory. An operating-system lock on a file: released by the system when the process ends."""

    def __init__(self, path: Path):
        self.path, self.acquired, self._handle = Path(path), False, None

    def __enter__(self) -> "RunLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return self
        self._handle, self.acquired = handle, True
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._handle is not None:
            try:
                if os.name == "nt":
                    import msvcrt

                    self._handle.seek(0)
                    msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            finally:
                self._handle.close()
        self._handle, self.acquired = None, False


# ---- binding ----------------------------------------------------------------------------------------------------------
def binding_path(settings: Settings) -> Path:
    return settings.repo / "config" / "local-bindings" / BINDING_NAME


def load_binding(settings: Settings, env: Mapping[str, str] | None = None) -> dict[str, Any] | None:
    """The speech binding of this profile, or ``None`` when there is none.

    Real profiles read the private binding file only, and keys that exist for tests (another worker script, faster
    timings) are dropped. The fixture profile works on synthetic recordings and never reads the private binding: a
    test names its own binding file in ``LL_SPEECH_BINDING``."""
    if settings.profile == "fixture":
        named = (os.environ if env is None else env).get(BINDING_ENV)
        if not named:
            return None
        source = Path(named)
    else:
        source = binding_path(settings)
    try:
        document = read_json(source)
    except ValueError as exc:
        raise Refused("binding_invalid", f"The speech binding cannot be read: {exc}") from None
    if document is None:
        return None
    if not isinstance(document, dict):
        raise Refused("binding_invalid", "The speech binding is not a JSON object.")
    if settings.profile != "fixture":
        document = {key: value for key, value in document.items() if key not in {"worker_script", "timings"}}
    return document


def _number(binding: dict, key: str, default: float | None, low: float, high: float, *, whole: bool = False) -> float:
    value = binding.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not (low <= value <= high) or (whole and int(value) != value):
        raise Refused("binding_invalid", f"{key} must be a number between {low} and {high}; found {value!r}.")
    return int(value) if whole else float(value)


def check_binding(binding: dict[str, Any]) -> dict[str, Any]:
    """The binding with its limits enforced. More than four threads, more than one worker or a ceiling above the grant are refused."""
    for key in ("interpreter", "model_dir", "grant_id"):
        if not isinstance(binding.get(key), str) or not binding[key]:
            raise Refused("binding_invalid", f"The speech binding must name {key}.")
    if not _GRANT.match(binding["grant_id"]):
        raise Refused("binding_invalid", "grant_id must be a short plain identifier.")
    checked = {"interpreter": Path(binding["interpreter"]), "model_dir": Path(binding["model_dir"]), "grant_id": binding["grant_id"],
               "threads": _number(binding, "threads", None, 1, MAX_THREADS, whole=True), "workers": _number(binding, "workers", None, WORKERS, WORKERS, whole=True),
               "ceiling_seconds": _number(binding, "ceiling_seconds", None, 0.001, MAX_CEILING_SECONDS),
               "overlap_seconds": _number(binding, "overlap_seconds", DEFAULT_OVERLAP_SECONDS, 0, 30),
               "safety_margin_seconds": _number(binding, "safety_margin_seconds", DEFAULT_SAFETY_MARGIN_SECONDS, 0.001, 3_600),
               "publish_every_chunks": _number(binding, "publish_every_chunks", DEFAULT_PUBLISH_EVERY_CHUNKS, 1, 1_000, whole=True)}
    if binding.get("model_bin_sha256") is not None:
        if not isinstance(binding["model_bin_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", binding["model_bin_sha256"]):
            raise Refused("binding_invalid", "model_bin_sha256 must be a SHA-256 hex digest.")
        checked["model_bin_sha256"] = binding["model_bin_sha256"]  # the worker refuses to load another model.bin
    if binding.get("state_dir") is not None:
        if not isinstance(binding["state_dir"], str) or not binding["state_dir"].strip():
            raise Refused("binding_invalid", "state_dir must be the path of the state directory this grant's ledger lives in.")
        checked["state_dir"] = Path(binding["state_dir"])  # an absolute path; only a test binding of the fixture profile may name it relative to the repository
    if binding.get("worker_script"):
        checked["worker_script"] = Path(str(binding["worker_script"]))
    if isinstance(binding.get("timings"), dict):
        try:
            checked["timings"] = Timings(**{key: float(value) for key, value in binding["timings"].items()})
        except (TypeError, ValueError) as exc:
            raise Refused("binding_invalid", f"timings: {exc}") from None
    return checked


def model_identity(model_dir: Path) -> dict[str, str]:
    """Repository and snapshot of a model directory in the local hub cache layout; otherwise the folder's own name."""
    parts = model_dir.parts
    if len(parts) >= 3 and parts[-2] == "snapshots" and parts[-3].startswith("models--"):
        return {"repository": parts[-3][len("models--"):].replace("--", "/")[:120], "snapshot": parts[-1][:80]}
    return {"repository": model_dir.name[:120] or "model", "snapshot": "local-directory"}


def child_environment(base: Mapping[str, str], *, threads: int, temp_dir: Path) -> dict[str, str]:
    """The worker's environment: offline, no bytecode, bounded threads, its own temp folder, and nothing that would
    make the external interpreter load this environment's packages."""
    environment = {key: value for key, value in base.items() if key.upper() not in _SCRUBBED}
    environment.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                        "DO_NOT_TRACK": "1", "TEMP": str(temp_dir), "TMP": str(temp_dir), "OMP_NUM_THREADS": str(threads), "MKL_NUM_THREADS": str(threads),
                        "OPENBLAS_NUM_THREADS": str(threads), "NUMBA_NUM_THREADS": str(threads)})
    return environment


def queue_identity(queue: dict[str, Any]) -> str:
    """Digest of what was frozen: grant, chunking, settings and every recording's identity, in order. It stays the same while the queue is worked off."""
    return c.sha256_hex(c.dump_json({"document": queue["document"], "grant_id": queue["grant_id"], "created_at": queue["created_at"], "chunk_ms": queue["chunk_ms"],
                                     "overlap_ms": queue["overlap_ms"], "settings_sha256": queue["settings_sha256"],
                                     "items": [[item["key"], item["version_id"], item["sha256"], item["bytes"], item["duration_ms"], item["work_id"], item["chunks_total"]]
                                               for item in queue["items"]]}))


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SpeechRunner:
    def __init__(self, settings: Settings, journal: Journal | None = None, *, binding: dict[str, Any] | None = None, worker_script: Path | None = None,
                 timings: Timings | None = None, preparation: Preparation | None = None, now: Callable[[], str] | None = None):
        self._settings = settings
        self._journal = journal
        self._given_binding, self._given_worker, self._given_timings = binding, worker_script, timings
        self._preparation = preparation or Preparation(settings, converter=None)
        self._now = now or (lambda: _iso(time.time()))
        self._derived = Derived(settings, journal, preparation=self._preparation, now=self._now)
        self.dir = settings.state_dir / "speech"
        self.queue_path, self.ledger_path, self.stop_path = self.dir / "queue.json", self.dir / "allowance.json", self.dir / STOP_NAME
        self.work_dir, self.run_dir = self.dir / "work", self.dir / "run"

    # ---- small helpers --------------------------------------------------------------------------------------------
    def _binding(self) -> dict[str, Any]:
        raw = self._given_binding if self._given_binding is not None else load_binding(self._settings)
        if raw is None:
            where = f"${BINDING_ENV}" if self._settings.profile == "fixture" else str(binding_path(self._settings))
            raise Refused("no_binding", f"No speech binding ({where}): interpreter, model directory, threads, workers, ceiling and grant id are not configured.")
        checked = check_binding(raw)
        # ONE state directory per grant. The ledger is a file in the state directory, so a grant that could be used
        # from any state directory would get a fresh allowance (and a second worker) in each of them.
        named = checked.get("state_dir")
        if named is None:
            if self._settings.profile != "fixture":
                raise Refused("state_dir_not_bound", f"The speech binding does not name state_dir. Outside the fixture profile the allowance of grant {checked['grant_id']!r} lives in "
                                                     "ONE state directory, named in the private binding; without it nothing runs.")
            return checked
        if not named.is_absolute() and self._settings.profile != "fixture":
            # Relative to the repository it would be another directory in every copy of the working tree: the same private
            # binding in a copied tree would open a second ledger, and a second allowance, under the same grant.
            raise Refused("state_dir_not_bound", f"The speech binding names state_dir {str(named)!r}, which is not an absolute path. Outside the fixture profile the ONE state "
                                                 f"directory of grant {checked['grant_id']!r} is named absolutely, so that a copy of the working tree cannot open a second ledger.")
        bound = named if named.is_absolute() else self._settings.repo / named
        if os.path.normcase(str(bound.resolve())) != os.path.normcase(str(self._settings.state_dir.resolve())):
            raise Refused("state_dir_not_bound", f"The speech binding binds grant {checked['grant_id']!r} to the state directory {bound}; this command uses {self._settings.state_dir}. "
                                                 "A grant has one allowance ledger: another state directory does not get a second one.")
        return checked

    def _worker(self, binding: dict[str, Any]) -> Path:
        return Path(self._given_worker or binding.get("worker_script") or Path(__file__).with_name("worker.py"))

    def _timing(self, binding: dict[str, Any]) -> Timings:
        return self._given_timings or binding.get("timings") or Timings()

    def resume_argv(self, *, retry_failed: bool = False) -> list[str]:
        """The exact command that continues the run. A queue paused by a resource failure continues only with ``--retry-failed``."""
        return [sys.executable, "-m", "lecture_brain", "--profile", self._settings.profile, "--state-dir", str(self._settings.state_dir), "speech-run",
                *(["--retry-failed"] if retry_failed else [])]

    def _recordings_now(self) -> dict[str, dict]:
        """Every recording the inventory lists now, by ``course/source``, in course and lecture (session) order."""
        found: dict[str, dict] = {}
        for course_id, binding in self._settings.courses.items():
            if not binding.usable:
                continue
            inventory = build_inventory(binding)
            in_sessions = [(session, item) for session in inventory["sessions"] for item in session["items"]]
            elsewhere = [(None, item) for lecture in inventory["lectures"] for item in [*lecture["decks"], *lecture["extra_materials"]]] + [(None, item) for item in inventory["other_sources"]]
            for session, item in [*in_sessions, *elsewhere]:
                if item["kind"] != "lecture_recording":
                    continue
                found.setdefault(f"{course_id}/{item['source_id']}", {**item, "course_id": course_id, "session_id": session["session_id"] if session else None,
                                                                       "lecture_ids": list(session["linked_lecture_ids"]) if session else []})
        return found

    def _media_path(self, item: dict) -> Path | None:
        return self._settings.course(item["course_id"]).root / item["path"] if item.get("path") else None

    @staticmethod
    def _mtime_ns(path: Path | None) -> int | None:
        try:
            return path.stat().st_mtime_ns if path is not None else None
        except OSError:
            return None

    def _disk_sha256(self, listed: dict) -> str | None:
        """SHA-256 of the bytes on disk, hashed at most once per file version (the preparation's persistent cache)."""
        if listed["state"] not in _READABLE or not listed.get("path"):
            return None
        return self._preparation.identity_of(listed["course_id"], {**listed, "sha256": None, "version_id": None})[1]

    def _settings_sha256(self, binding: dict[str, Any]) -> str:
        """What decides the text a chunk yields: the model, the inference settings, device, compute type and sample rate."""
        return c.sha256_hex(c.dump_json({"inference_settings": INFERENCE_SETTINGS, "device": DEVICE, "compute_type": COMPUTE_TYPE, "sample_rate_hz": SAMPLE_RATE_HZ,
                                         "model": model_identity(binding["model_dir"])}))

    # ---- the frozen queue -----------------------------------------------------------------------------------------
    def _freeze(self, binding: dict[str, Any], listed: dict[str, dict], priority: list[str], chunk_ms: int, overlap_ms: int) -> dict[str, Any]:
        items = []
        for key in [*priority, *(key for key in listed if key not in priority)]:
            entry = listed[key]
            path = self._media_path(entry)
            version_id, index_sha256 = self._preparation.identity_of(entry["course_id"], entry) if entry["state"] in _READABLE else (entry.get("version_id"), entry.get("sha256"))
            sha256 = self._disk_sha256(entry)
            duration = media_duration_ms(path) if path is not None and sha256 is not None else None
            item = {"key": key, "course_id": entry["course_id"], "source_id": entry["source_id"], "version_id": version_id, "sha256": sha256, "bytes": entry["bytes"],
                    "mtime_ns": self._mtime_ns(path) if sha256 is not None else None, "duration_ms": duration,
                    "path": entry.get("path"), "filename": entry.get("filename"), "session_id": entry["session_id"], "lecture_ids": entry["lecture_ids"],
                    "registration": entry["registration"], "work_id": hashlib.sha256(f"{key}/{sha256}".encode("utf-8")).hexdigest()[:12],
                    "chunks_total": len(ch.plan_chunks(duration, chunk_ms, overlap_ms)) if duration else 0, "chunks_done": 0, "published_chunks": 0, "published_generation": None,
                    "state": "queued", "reason": None, "last_error": None, "failures": {}}
            if sha256 is None:
                item.update(state="failed", reason="media_missing" if path is None or not path.is_file() else "media_unreadable")
            elif not duration:
                item.update(state="failed", reason="duration_unknown", last_error="The container does not state a duration this app can read; the recording cannot be cut into bounded chunks.")
            elif index_sha256 != sha256:
                item.update(state="source_conflict", reason="index_differs_from_bytes")
            items.append(item)
        return {"document": "speech-queue/1", "runner": RUNNER_VERSION, "created_at": self._now(), "grant_id": binding["grant_id"], "chunk_ms": chunk_ms, "overlap_ms": overlap_ms,
                "settings_sha256": self._settings_sha256(binding), "model": model_identity(binding["model_dir"]), "courses": list(self._settings.courses), "items": items}

    def _plan(self, queue: dict, item: dict) -> list[dict[str, int]]:
        return ch.plan_chunks(item["duration_ms"], queue["chunk_ms"], queue["overlap_ms"]) if item["duration_ms"] else []

    def _chunk_path(self, item: dict, index: int) -> Path:
        return self.work_dir / item["work_id"] / f"chunk-{index:04d}.json"

    def _inspect_chunk(self, queue: dict, item: dict, plan: list[dict[str, int]], index: int) -> tuple[dict, str] | str:
        """The chunk result on disk with its digest when it is exactly the result for this chunk of this recording
        under these settings; otherwise WHY it is not, in words (``"missing"`` when there is no file)."""
        path = self._chunk_path(item, index)
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            return "missing"
        except OSError as exc:
            return f"the result file cannot be read ({exc})"
        try:
            document = c.parse_json(data, max_bytes=64 * 1024 * 1024)
        except c.ContractError as exc:
            return f"the result file is not strict JSON ({exc})"
        entry = plan[index]
        if not isinstance(document, dict) or document.get("document") != "speech-chunk/1":
            return "the result file is not a speech-chunk/1 document"
        if document.get("work_id") != item["work_id"] or document.get("index") != index or document.get("offset_ms") != entry["start_ms"] or document.get("end_ms") != entry["end_ms"]:
            return "the result names another chunk than this one"
        recording = document.get("recording")
        if not isinstance(recording, dict) or recording.get("sha256") != item["sha256"]:
            return "the result was made from other bytes than the frozen recording"
        if document.get("settings_sha256") != queue["settings_sha256"]:
            return "the result was made under other inference settings than the frozen queue's"
        decoded, segments = document.get("decoded_ms"), document.get("segments")
        if not isinstance(segments, list) or not all(isinstance(segment, dict) for segment in segments) or type(decoded) is not int or decoded < 0:
            return "the result has no list of segments or no decoded length"
        unreadable = ch.result_problem(document)  # an inside the merge and the publication could not read: refused here, never an error later
        if unreadable:
            return unreadable
        wanted = entry["end_ms"] - entry["start_ms"]
        if not (decoded >= wanted - TIME_TOLERANCE_MS or document.get("end_of_stream") is True):
            return f"the result holds {decoded} ms of the {wanted} ms asked for without having reached the end of the recording"
        policy = document["decoding"].get("policy") if isinstance(document.get("decoding"), dict) else None
        if policy not in ACCEPTED_DECODING_POLICIES and ch.needs_second_pass(ch.repetition_stats(segments, REPETITION_THRESHOLD)):
            return "the result is mostly the output of a repetition loop and was made without a second pass"  # this chunk is done again
        return document, c.sha256_hex(data)

    def _load_chunk(self, queue: dict, item: dict, plan: list[dict[str, int]], index: int) -> tuple[dict, str] | None:
        """A chunk result on disk when it is exactly the result for this chunk of this recording under these settings."""
        found = self._inspect_chunk(queue, item, plan, index)
        return None if isinstance(found, str) else found

    def _published_exists(self, item: dict) -> bool:
        generation = item.get("published_generation")
        return bool(generation) and (self._derived.store_dir(item["course_id"]) / item["source_id"] / generation / MANIFEST_NAME).is_file()

    def _recount(self, queue: dict, item: dict) -> None:
        """How far this recording is, from what is on disk: acceptable chunk files in order. A recording whose whole
        generation is published stays complete when its intermediate chunk files were removed; a chunk file that is
        there but no longer acceptable (see :meth:`_load_chunk`) is done again."""
        if not item["chunks_total"]:
            return
        if not self._published_exists(item):
            item["published_chunks"], item["published_generation"] = 0, None
        plan, done = self._plan(queue, item), 0
        while done < len(plan) and self._load_chunk(queue, item, plan, done) is not None:
            done += 1
        if done < len(plan) and item["published_chunks"] == item["chunks_total"] and not self._chunk_path(item, done).exists():
            done = len(plan)  # the whole recording is published and the chunk file is simply gone: nothing to redo
        item["chunks_done"] = done

    @staticmethod
    def _progress_state(item: dict) -> str:
        if item["chunks_total"] and item["chunks_done"] == item["chunks_total"] and item["published_chunks"] == item["chunks_total"]:
            return "complete_with_unresolved" if item.get("unresolved_seconds") else "complete"  # withheld time is processed, not covered: never plain complete
        return "partial" if item["chunks_done"] or item["published_chunks"] else "queued"

    @staticmethod
    def _chunk_failure(item: dict, index: int, error: str) -> None:
        """One failed attempt of a chunk, shown with its reason. A chunk that keeps failing sets its recording aside."""
        item["failures"][str(index)] = item["failures"].get(str(index), 0) + 1
        item["last_error"] = f"chunk {index}: {error}"[:600]
        if item["failures"][str(index)] >= MAX_CHUNK_ATTEMPTS:
            item.update(state="failed", reason="chunk_failed")

    def _evaluate(self, queue: dict, item: dict, listed: dict[str, dict], *, retry_failed: bool) -> None:
        """The recording's state for this run, from the file as it is now. Conflicts and missing media are not forever:
        when the frozen bytes are back, work continues where it stopped."""
        if retry_failed and item["reason"] in {"chunk_failed", "publish_rejected"}:
            item.update(failures={}, reason=None, last_error=None)
        if item["sha256"] is None or not item["duration_ms"]:
            return  # could not be identified or measured when the queue was frozen; it stays listed with that reason
        now = listed.get(item["key"])
        path = self._media_path(item)
        if now is None or now["state"] not in _READABLE:
            item.update(state="failed", reason="media_missing" if path is None or not path.is_file() else "media_unreadable")
            return
        # The same size and modification time as when the bytes were last hashed: the same file version (the worker hashes it again before it uses it).
        mtime = self._mtime_ns(path)
        if now["bytes"] != item["bytes"] or mtime is None or mtime != item.get("mtime_ns"):
            if self._disk_sha256(now) != item["sha256"]:
                item.update(state="source_conflict", reason="bytes_changed")
                return
            item["mtime_ns"] = mtime  # touched or synchronised again, the same bytes
        if now.get("sha256") not in (None, item["sha256"]):
            item.update(state="source_conflict", reason="index_differs_from_bytes")
            return
        self._recount(queue, item)
        if any(count >= MAX_CHUNK_ATTEMPTS for count in item["failures"].values()):
            item.update(state="failed", reason="chunk_failed")
            return
        item.update(state=self._progress_state(item), reason=None)

    # ---- publication ----------------------------------------------------------------------------------------------
    @staticmethod
    def publication_identity() -> str:
        """Digest of everything in this code that decides what a publication of given chunk results looks like."""
        return c.sha256_hex(c.dump_json({"runner": RUNNER_VERSION, "merge_policy": MERGE_POLICY, "overlap_rule": ch.OVERLAP_RULE, "unresolved_rule": ch.UNRESOLVED_RULE,
                                         "match_tolerance_ms": ch.MATCH_TOLERANCE_MS, "repetition_threshold": REPETITION_THRESHOLD, "decoding_policy": DECODING_POLICY,
                                         "second_pass_sha256": SECOND_PASS_SHA256, "inference_settings": INFERENCE_SETTINGS, "tolerance_ms": TIME_TOLERANCE_MS,
                                         "consumer": derived_module.CONSUMER_VERSION}))  # the consumer the generation is written for: another one cannot read what is stored

    @staticmethod
    def _second_pass_of(document: dict) -> tuple[str | None, str]:
        """The second-pass identity a chunk result was made under, and where that is known from. A result of a worker
        that did not state the digest yet carries the settings it used: the digest is computed from them, with the
        selection rule that worker had."""
        decoding = document.get("decoding") if isinstance(document.get("decoding"), dict) else {}
        second = decoding.get("second")
        if not isinstance(second, dict):
            return None, "second_pass_not_used"
        if isinstance(decoding.get("second_pass_sha256"), str):
            return decoding["second_pass_sha256"], "stated_by_worker"
        if isinstance(second.get("settings"), dict):
            return second_pass_identity(second["settings"], LEGACY_SECOND_PASS_SELECTION), "computed_from_recorded_settings"
        return None, "unknown"

    def _publish(self, queue: dict, binding: dict[str, Any], item: dict, report: dict) -> None:
        """Publish the contiguous processed prefix of one recording as a new immutable generation, through the importer.

        The generation id ends in a digest of the generation AS IT IS ASSEMBLED — the manifest and, through it, every
        output — with a fixed stand-in for the id and the creation time, which are not content. The same id therefore
        always means the same bytes: other chunk results, another merge rule, an edit of this code, an edit of the
        assembly or another consumer version give another generation, never a conflict with a stored one. A stored
        generation is never replaced or repaired: when the folder of that name holds other bytes or was damaged, the
        same content goes into the next name (a digest of the first), once.

        Chunk results that passed the acceptance check and still cannot be merged are THIS recording's problem: it
        is set aside with the reason (``publish_rejected``, tried again by the next run) and the queue goes on."""
        count = item["chunks_done"]
        if not count or count < item["published_chunks"]:
            return  # nothing processed, or less than what is already published (a chunk is being done again)
        plan = self._plan(queue, item)
        loaded = [self._load_chunk(queue, item, plan, index) for index in range(count)]
        if any(entry is None for entry in loaded):
            return  # the chunk files of a published recording were removed, or one vanished meanwhile: nothing to merge
        documents, digests = [entry[0] for entry in loaded], [entry[1] for entry in loaded]  # type: ignore[index]
        identity = self.publication_identity()
        inputs = c.sha256_hex(c.dump_json({"chunks": digests, "publication": identity}))
        if inputs == item.get("published_inputs") and self._published_exists(item):
            return  # exactly these chunk results are published by exactly this publication code
        entry: dict[str, Any] = {"course_id": item["course_id"], "source_id": item["source_id"], "generation": None, "window_end_ms": None, "complete": False,
                                 "covers_whole_recording": False, "chunks": count, "status": "failed", "reason": "merge_failed", "words": 0, "segments": 0, "covered_seconds": 0.0,
                                 "unresolved_seconds": 0.0, "withheld_repetition_words": 0}

        def assemble(generation: str, created_at: str) -> tuple[bytes, dict[str, bytes]]:
            return assemble_generation(course_id=item["course_id"], source_id=item["source_id"], generation=generation, created_at=created_at, recording_sha256=item["sha256"],
                                       recording_bytes=item["bytes"], declared_duration_ms=item["duration_ms"], producer=producer, window=merged["window"], clip_offset_ms=0,
                                       segments=merged["segments"], provenance=provenance)

        try:
            merged, producer, provenance = self._describe(queue, item, plan, documents, digests, identity, inputs)
            name = c.sha256_hex(assemble(f"sp-{item['work_id']}-p{count:04d}-{'0' * 8}", "1970-01-01T00:00:00Z")[0])  # the stand-ins are the same for every generation
        except Exception as exc:  # noqa: BLE001 - whatever it is, it is this recording's: shown, bounded, and not the end of the run
            item.update(state="failed", reason="publish_rejected", last_error=f"publication failed: the chunk results could not be merged ({type(exc).__name__}: {exc})"[:600])
            report["published"].append({**entry, "detail": f"{type(exc).__name__}: {exc}"[:300]})
            return
        whole = bool(merged["complete"] and not merged["unresolved"])
        for _ in range(GENERATION_NAMES):
            generation = f"sp-{item['work_id']}-p{count:04d}-{name[:8]}"
            # A generation that is already stored keeps its time: publishing the same content again must give the same bytes.
            # A new one is stamped when its newest chunk result was finished, and always later than every generation already
            # stored for this recording, so that among generations resolving equally much the newest is the latest publication.
            created_at = self._derived.stored_created_at(item["course_id"], item["source_id"], generation)
            if created_at is None:
                finished = [document["completed_at"] for document in documents if isinstance(document.get("completed_at"), str) and _TIME.match(document["completed_at"])]
                created_at = max(finished) if finished else self._now()
                for earlier in (item.get("published_at"), self._derived.newest_created_at(item["course_id"], item["source_id"])):
                    if isinstance(earlier, str) and _TIME.match(earlier):
                        created_at = max(created_at, _iso(datetime.strptime(earlier, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() + 1))
            manifest_bytes, outputs = assemble(generation, created_at)
            result = self._derived.import_prepared(course_id=item["course_id"], manifest_bytes=manifest_bytes, outputs=outputs, origin=f"speech-runner:{item['work_id']}:p{count:04d}")
            if result["reason"] not in {"generation_conflict", "stored_generation_damaged"}:
                break
            name = c.sha256_hex(f"{name}/next".encode("utf-8"))  # the folder of that name holds other bytes, or was damaged: it stays as it is, and this content takes the next name
        entry.update(generation=generation, window_end_ms=merged["window"]["end_ms"], complete=merged["complete"], covers_whole_recording=whole, status=result["status"],
                     reason=result["reason"], words=merged["stats"]["words"], segments=merged["stats"]["segments"], covered_seconds=merged["stats"]["covered_ms"] / 1000,
                     unresolved_seconds=merged["stats"]["unresolved_ms"] / 1000, withheld_repetition_words=merged["stats"]["withheld_repetition_words"])
        report["published"].append(entry)
        if result["status"] in {"imported", "reused"}:
            item.update(published_chunks=count, published_generation=generation, published_policy=MERGE_POLICY, published_at=created_at, published_inputs=inputs,
                        published_identity=identity, published_window_end_ms=merged["window"]["end_ms"], unresolved_seconds=merged["stats"]["unresolved_ms"] / 1000,
                        unresolved_intervals=[{"start_ms": interval["start_ms"], "end_ms": interval["end_ms"], "reason": interval["reason"]} for interval in merged["unresolved"]])
            if item["reason"] == "publish_rejected":  # what was refused in this run is published now
                item.update(state=self._progress_state(item), reason=None)
            if str(item.get("last_error") or "").startswith("publication "):
                item["last_error"] = None
        elif result["reason"] in {"changed_input", "source_unavailable"}:
            item.update(state="source_conflict", reason="bytes_changed", last_error=f"{result['reason']}: {result['detail']}")
        elif result["status"] == "rejected":
            item.update(state="failed", reason="publish_rejected", last_error=f"publication refused ({result['reason']}): {result['detail']}"[:600])
        else:
            item["last_error"] = f"publication {result['status']}: {result['detail']}"

    def _describe(self, queue: dict, item: dict, plan: list[dict[str, int]], documents: list[dict], digests: list[str], identity: str, inputs: str) -> tuple[dict, dict, dict]:
        """Merge the chunk results ``0..k-1`` of one recording and describe the generation that results: the merged
        text with what it covers, the producer, and the provenance. Pure with respect to the store: nothing is written."""
        count = len(documents)
        merged = ch.merge_prefix(plan, documents, duration_ms=item["duration_ms"], tolerance_ms=TIME_TOLERANCE_MS, repetition_threshold=REPETITION_THRESHOLD)
        last = documents[-1]
        runtime = last.get("runtime") if isinstance(last.get("runtime"), dict) else {}
        packages = runtime.get("packages") if isinstance(runtime.get("packages"), dict) else {}
        model = queue["model"]
        tool = str(runtime.get("tool") or "faster-whisper")[:64]
        parameters = c.sha256_hex(c.dump_json({"inference_settings": INFERENCE_SETTINGS, "device": DEVICE, "compute_type": COMPUTE_TYPE, "sample_rate_hz": SAMPLE_RATE_HZ,
                                               "chunk_ms": queue["chunk_ms"], "overlap_ms": queue["overlap_ms"], "runner": RUNNER_VERSION, "decoding_policy": DECODING_POLICY,
                                               "second_pass_settings": SECOND_PASS_SETTINGS, "second_pass_sha256": SECOND_PASS_SHA256, "merge_policy": MERGE_POLICY}))
        producer = {"tool": tool, "tool_version": str(packages.get("faster-whisper") or "unknown")[:64], "model": f"{model['repository']}@{model['snapshot']}"[:128],
                    "language": INFERENCE_SETTINGS["language"], "parameters_sha256": parameters}
        double = any(document.get("labelled_double") for document in documents)
        second_passes = [self._second_pass_of(document) for document in documents]
        whole = bool(merged["complete"] and not merged["unresolved"])
        provenance = {"origin": "speech_runner", "adapter": None, "runner": RUNNER_VERSION, "producer_contract": "speech-chunk/1", "producer_manifest_sha256": None,
                      "job_key": c.sha256_hex(c.dump_json({"recording": item["sha256"], "bytes": item["bytes"], "settings": queue["settings_sha256"], "chunk_ms": queue["chunk_ms"],
                                                           "overlap_ms": queue["overlap_ms"]})),
                      "work_id": item["work_id"], "grant_id": queue["grant_id"],
                      "source": {"course_id": item["course_id"], "source_id": item["source_id"], "version_id": item["version_id"], "sha256": item["sha256"]},
                      "bound_to": {"version_id": item["version_id"], "sha256": item["sha256"], "disk_sha256": item["sha256"], "bytes": item["bytes"], "duration_ms": item["duration_ms"]},
                      "producer_statuses": {"timing_generated": "GENERATED_UNREVIEWED", "timing_qa": "NOT_RUN", "original_transcript_alignment": "NOT_RUN", "semantic_slide_matching": "NOT_RUN"},
                      "model": dict(model), "runtime": {key: runtime.get(key) for key in ("tool", "python", "packages", "device", "compute_type", "threads", "workers")},
                      "inference_settings": dict(INFERENCE_SETTINGS),
                      "decoding": {"policy": DECODING_POLICY, "accepted_policies": sorted(ACCEPTED_DECODING_POLICIES), "second_pass_settings": dict(SECOND_PASS_SETTINGS),
                                   "second_pass_selection": SECOND_PASS_SELECTION, "second_pass_sha256": SECOND_PASS_SHA256, "merge_policy": MERGE_POLICY,
                                   "repetition_threshold": REPETITION_THRESHOLD,
                                   "chunks_decoded_twice": sum(1 for digest, _ in second_passes if digest is not None),
                                   "chunks_kept_from_second_pass": sum(1 for document in documents if (document.get("decoding") or {}).get("pass") == "second"),
                                   # Chunk results that used a second pass under ANOTHER identity than the one this code has now: other settings or another selection rule.
                                   "chunks_with_other_second_pass": [document["index"] for document, (digest, _) in zip(documents, second_passes) if digest not in (None, SECOND_PASS_SHA256)]},
                      "publication": {"identity_sha256": identity, "inputs_sha256": inputs, "merge_policy": MERGE_POLICY, "overlap_rule": ch.OVERLAP_RULE,
                                      "unresolved_rule": ch.UNRESOLVED_RULE, "match_tolerance_ms": ch.MATCH_TOLERANCE_MS},
                      "unresolved_intervals": merged["unresolved"], "covered_intervals": merged["covered"],
                      "chunking": {"chunk_ms": queue["chunk_ms"], "overlap_ms": queue["overlap_ms"], "chunks_total": len(plan), "chunks_merged": count, "rule": ch.OVERLAP_RULE},
                      "chunks": [{"index": document["index"], "offset_ms": document["offset_ms"], "end_ms": document["end_ms"], "decoded_ms": document["decoded_ms"],
                                  "end_of_stream": bool(document.get("end_of_stream")), "completed_at": document.get("completed_at"), "sha256": digest,
                                  "decoding_pass": (document.get("decoding") or {}).get("pass"), "decoding_policy": (document.get("decoding") or {}).get("policy"),
                                  "second_pass_sha256": second_pass[0], "second_pass_identity_from": second_pass[1],
                                  "selection": (document.get("decoding") or {}).get("selection"),
                                  "segments": len(document["segments"]), "words": sum(len(segment.get("words") or []) for segment in document["segments"])}
                                 for document, digest, second_pass in zip(documents, digests, second_passes)],
                      # ``complete``: every chunk of the plan is merged. ``covers_whole_recording``: that, and nothing was withheld.
                      "window": dict(merged["window"]), "complete": merged["complete"], "covers_whole_recording": whole,
                      "counts": {"segments": merged["stats"]["segments"], "words": merged["stats"]["words"], "zero_length_words": merged["stats"]["zero_length_words"]},
                      "merge": merged["stats"], "tolerance_ms": TIME_TOLERANCE_MS, "labelled_double": bool(double),
                      "note": ("LABELLED DOUBLE: fabricated by a test's stand-in for speech recognition; not speech recognition. " if double else "")
                              + "Generated, unreviewed speech text for the stated window. Acoustic accuracy was not reviewed and nothing about slides is established. "
                              + "Unresolved intervals are where the recogniser's output failed the repetition check and was withheld: neither speech nor silence is known there, "
                              + "and that time is not covered."}
        return merged, producer, provenance

    # ---- one run --------------------------------------------------------------------------------------------------
    def run(self, *, courses: list[str] | None = None, priority: list[str] | None = None, max_seconds: float | None = None, chunk_seconds: float | None = None,
            max_chunks: int | None = None, retry_failed: bool = False) -> dict[str, Any]:
        """One bounded run. Returns the report that is also the run's receipt; it never raises for an expected refusal
        or for an error inside the run (that is a report with state ``failed`` and reason ``internal_error``).

        ``courses`` limits what is processed in this run (the frozen queue always holds every configured course);
        ``priority`` (``course/source`` keys) goes first — in the frozen order when the queue is created by this run,
        otherwise for this run only; ``max_seconds`` is a wall-time bound after which no new chunk starts (a running
        chunk may finish); ``max_chunks`` bounds the chunks handed to the worker; ``chunk_seconds`` applies only when
        this run creates the queue; ``retry_failed`` tries again what was set aside after repeated failures and
        continues a queue that a resource failure paused.

        However the run ends — also by an unexpected error or an interrupt from the keyboard — its child is stopped,
        its reservation in the allowance ledger is settled with the time that passed, and one receipt is written. An
        interrupt is raised again after that."""
        report: dict[str, Any] = {"runner": RUNNER_VERSION, "run_id": uuid.uuid4().hex[:16], "profile": self._settings.profile, "state": None, "outcome": None, "reason": None,
                                  "detail": None, "grant_id": None,
                                  "allowance": {"ceiling_seconds": None, "used_before": None, "used_after": None, "remaining_seconds": None, "recovered_seconds": 0.0},
                                  "wall_seconds": 0.0, "chunks_completed": 0, "media_seconds": 0.0, "words": 0, "segments": 0, "published": [], "remaining": None, "queue": None,
                                  "pause": None,
                                  "selection": {"courses": list(courses) if courses else None, "priority": list(priority or []), "max_seconds": max_seconds, "max_chunks": max_chunks,
                                                "retry_failed": retry_failed}}
        interrupt: BaseException | None = None
        try:
            binding = self._binding()
            report["grant_id"] = binding["grant_id"]
            self._check_arguments(courses, max_seconds, chunk_seconds, max_chunks, binding)
            self._check_runtime(binding)
            if self.stop_path.exists():
                report.update(state="stopped", outcome="refused", reason="stop_file_present", detail=f"{self.stop_path} exists; nothing was started. Remove it to run.")
            else:
                with RunLock(self.dir / "run.lock") as lock:
                    if not lock.acquired:
                        raise Refused("already_running", "Another speech run holds the lock for this state directory; there is one worker at a time.")
                    self._locked_run(report, binding, courses=courses, priority=list(priority or []), max_seconds=max_seconds, chunk_seconds=chunk_seconds, max_chunks=max_chunks,
                                     retry_failed=retry_failed)
        except (Refused, LedgerRefused) as refusal:
            report.update(state="refused", outcome="refused", reason=refusal.code, detail=refusal.detail)
        except Exception as exc:  # noqa: BLE001 - whatever went wrong inside the run is reported and receipted, not lost with a traceback
            report.update(state="failed", outcome="ran" if report["wall_seconds"] else "failed", reason="internal_error", detail=f"{type(exc).__name__}: {exc}"[:500])
        except BaseException as exc:  # an interrupt from the keyboard, or the interpreter being told to exit
            interrupt = exc
            report.update(state="stopped", outcome="ran" if report["wall_seconds"] else "no_change", reason="interrupted",
                          detail=f"Interrupted ({type(exc).__name__}). The worker was stopped and the time that passed is charged; finished chunks are kept.")
        report.pop("_ended", None)
        report["resume_command"] = subprocess.list2cmdline(self.resume_argv(retry_failed=bool(report["pause"])))
        report["note"] = "Generated speech text is unreviewed. Local test or run success says nothing about acoustic accuracy; no completion time is extrapolated."
        try:
            report["receipt_id"] = self._receipt(report)
        except Exception:  # noqa: BLE001 - only reachable when the journal itself fails; an interrupt or the report still gets out
            if interrupt is None:
                raise
            report["receipt_id"] = None
        if interrupt is not None:
            raise interrupt
        return report

    def _check_arguments(self, courses: list[str] | None, max_seconds: float | None, chunk_seconds: float | None, max_chunks: int | None, binding: dict[str, Any]) -> None:
        unknown = [course for course in courses or [] if course not in self._settings.courses]
        if unknown:
            raise Refused("unknown_course", f"Not one of the configured courses: {', '.join(unknown)}.")
        if max_seconds is not None and not (isinstance(max_seconds, (int, float)) and max_seconds > 0):
            raise Refused("invalid_argument", "max_seconds must be a positive number of seconds.")
        if max_chunks is not None and not (isinstance(max_chunks, int) and max_chunks >= 1):
            raise Refused("invalid_argument", "max_chunks must be a positive whole number.")
        if chunk_seconds is not None and not (isinstance(chunk_seconds, (int, float)) and 1 <= chunk_seconds <= 3_600 and binding["overlap_seconds"] * 2 <= chunk_seconds):
            raise Refused("invalid_argument", "chunk_seconds must be between 1 and 3600 and at least twice the overlap.")

    def _check_runtime(self, binding: dict[str, Any]) -> None:
        """The external interpreter, the model files and the worker script must exist before anything is reserved."""
        if not binding["interpreter"].is_file():
            raise Refused("interpreter_missing", f"The configured speech interpreter does not exist: {binding['interpreter']}")
        missing = [name for name in MODEL_FILES if not (binding["model_dir"] / name).is_file()]
        if missing:
            raise Refused("model_missing", f"The model directory lacks {', '.join(missing)}: {binding['model_dir']}. Nothing is downloaded.")
        if not self._worker(binding).is_file():
            raise Refused("worker_missing", f"The worker script does not exist: {self._worker(binding)}")

    def _journal_floor(self, grant_id: str) -> float:
        """The largest allowance total the journal's run receipts already show for this grant."""
        used = [0.0]
        for receipt in self._with_journal(lambda journal: journal.receipts(kind=RECEIPT_KIND)):
            payload = receipt.get("payload") or {}
            after = (payload.get("allowance") or {}).get("used_after")
            if payload.get("grant_id") == grant_id and isinstance(after, (int, float)) and not isinstance(after, bool):
                used.append(float(after))
        return max(used)

    def _remaining(self, queue: dict) -> dict[str, int]:
        items = queue["items"]
        return {"recordings": sum(1 for item in items if item["state"] in _WORKABLE), "chunks": sum(item["chunks_total"] - item["chunks_done"] for item in items if item["state"] in _WORKABLE),
                "source_conflict": sum(1 for item in items if item["state"] == "source_conflict"), "failed": sum(1 for item in items if item["state"] == "failed")}

    def _locked_run(self, report: dict, binding: dict[str, Any], *, courses: list[str] | None, priority: list[str], max_seconds: float | None, chunk_seconds: float | None,
                    max_chunks: int | None, retry_failed: bool) -> None:
        timings = self._timing(binding)
        try:
            stored = read_json(self.queue_path)
        except ValueError as exc:
            raise Refused("queue_unreadable", f"The frozen queue cannot be read ({exc}); it is not replaced by a new one.") from None
        listed = self._recordings_now()
        known = {item["key"] for item in stored["items"]} if stored else set(listed)
        unknown = [key for key in priority if key not in known]
        if unknown or len(set(priority)) != len(priority):
            raise Refused("unknown_priority", f"Not a recording of the {'frozen queue' if stored else 'configured courses'} (course/source): {', '.join(unknown) or 'listed twice'}.")
        # The allowance first: a missing, foreign or older ledger stops the run before anything else is touched.
        work_exists = self.work_dir.is_dir() and any(path.is_file() for path in self.work_dir.rglob("*"))
        ledger = Allowance(self.ledger_path)
        ledger.open(grant_id=binding["grant_id"], ceiling_seconds=binding["ceiling_seconds"], may_create=stored is None and not work_exists,
                    floor_seconds=self._journal_floor(binding["grant_id"]))
        if ledger.open_reservation is not None:  # a run died: its worker may live until its lease ends, and its time is charged in full
            wait = ledger.seconds_until_lease_ends()
            time.sleep(wait + 0.25 if wait > 0 else 0.0)  # a moment more, so that worker has seen its lease end before another one starts
            report["allowance"]["recovered_seconds"] = ledger.recover()["seconds"]  # type: ignore[index]
        report["allowance"].update(ceiling_seconds=ledger.ceiling_seconds, used_before=ledger.used_seconds, used_after=ledger.used_seconds, remaining_seconds=ledger.remaining_seconds)

        created = stored is None
        if created:
            chunk_ms = int(round((chunk_seconds or DEFAULT_CHUNK_SECONDS) * 1000))
            queue = self._freeze(binding, listed, priority, chunk_ms, int(round(binding["overlap_seconds"] * 1000)))
        else:
            queue = stored
            if queue.get("document") != "speech-queue/1" or not isinstance(queue.get("items"), list):
                raise Refused("queue_unreadable", "queue.json is not a speech queue; it is not replaced by a new one.")
            if queue["settings_sha256"] != self._settings_sha256(binding):
                raise Refused("queue_binding_mismatch", "The frozen queue was made for another model or other inference settings than the binding names now; results would not belong together.")
        before = c.dump_json(queue) if not created else b""
        frozen_chunk_seconds = queue["chunk_ms"] / 1000
        report["queue"] = {"created": created, "recordings": len(queue["items"]), "chunk_seconds": frozen_chunk_seconds, "overlap_seconds": queue["overlap_ms"] / 1000,
                           "identity_sha256": queue_identity(queue),
                           "note": ("The chunk size is frozen with the queue; the other size asked for was not applied." if chunk_seconds and abs(chunk_seconds - frozen_chunk_seconds) > 1e-9
                                    else "Frozen at the first run; later runs reuse it.")}

        def save() -> None:
            nonlocal before
            data = c.dump_json(queue)
            if data != before:
                write_json(self.queue_path, queue)
                before = data

        selected = [item for item in queue["items"] if not courses or item["course_id"] in courses]
        pause = queue.get("pause") if isinstance(queue.get("pause"), dict) else None
        if pause and retry_failed:  # the owner says: go on
            report["resumed_after_pause"], queue["pause"], pause = pause, None, None
            queue.pop("unexplained_end", None)
        for item in queue["items"]:
            self._evaluate(queue, item, listed, retry_failed=retry_failed and item in selected)
        identity = self.publication_identity()
        for item in selected:  # a prefix that a dead run left unpublished; and what was published whole by other publication code (another merge rule, an edit)
            if item["state"] in _WORKABLE or (item["state"] in _PUBLISHED_WHOLE and item.get("published_identity") != identity):
                self._publish(queue, binding, item, report)
                if item["state"] in _WORKABLE or item["state"] in _PUBLISHED_WHOLE:
                    item["state"] = self._progress_state(item)
        save()
        if pause:  # a resource failure paused this queue: nothing is started until the owner says so, whatever wrapper repeats the command
            report["pause"], report["remaining"] = pause, self._remaining(queue)
            report.update(state="paused", outcome="no_change" if not report["published"] else "ran", reason=PAUSE_REASON,
                          detail=f"Paused since {pause.get('at')} after a resource failure ({pause.get('detail')}). No worker was started and nothing was set aside. "
                                 "When the cause is dealt with, run speech-run with --retry-failed to continue.")
            return

        # Priority first, then the frozen order; a recording whose chunk ran into a resource failure is tried last, so
        # that a problem of that one recording does not hold up the others (a problem of the machine pauses again at once).
        rest = [item for item in selected if item["key"] not in priority]
        order = ([item for key in priority for item in selected if item["key"] == key] + [item for item in rest if not item.get("resource_failures")]
                 + [item for item in rest if item.get("resource_failures")])
        jobs = []
        for item in order:
            if item["state"] not in _WORKABLE:
                continue
            plan = self._plan(queue, item)
            for index in range(item["chunks_done"], len(plan)):
                if self._load_chunk(queue, item, plan, index) is None:  # a later chunk whose acceptable result is already on disk is not done again
                    jobs.append({"item": item, "plan": plan, "index": index})
        limited = max_chunks is not None and len(jobs) > max_chunks
        jobs = jobs[:max_chunks] if limited else jobs
        report["remaining"] = self._remaining(queue)

        def refused_publications() -> str | None:
            """Why this run is not a clean one although its work is done: what it tried to publish was refused by the importer, or could not be merged."""
            refused = [item for item in selected if item["reason"] == "publish_rejected"]
            return (f"The publication of {len(refused)} recording(s) did not go through ({', '.join(item['key'] for item in refused[:5])}): the importer refused it, or the chunk "
                    "results could not be merged. Each is set aside with the reason in its last_error; the next run, and --retry-failed, try them again.") if refused else None

        if not jobs:
            report.update(state="no_change" if not report["published"] else "completed", outcome="no_change" if not report["published"] else "ran")
            if refused_publications():
                report.update(state="failed", reason="publish_rejected", detail=refused_publications())
            return
        margin = max(binding["safety_margin_seconds"], timings.poll_seconds + timings.terminate_wait_seconds)  # never smaller than the time it takes to stop the child
        if ledger.remaining_seconds < margin:
            report.update(state="ceiling_reached", outcome="no_change" if not report["published"] else "ran", reason="allowance_exhausted",
                          detail=f"{ledger.remaining_seconds:.1f} s of the allowance are left, less than the safety margin of {margin:.1f} s. The queue is kept.")
            return
        budget = ledger.remaining_seconds - margin
        by_bound = max_seconds is not None and max_seconds <= budget
        self._supervise(report, binding, timings, queue, ledger, jobs, soft_seconds=max_seconds if by_bound else budget, save=save)
        ended = report.pop("_ended")
        touched = {id(job["item"]): job["item"] for job in jobs}.values()
        for item in touched:
            if item["state"] in _WORKABLE:
                self._publish(queue, binding, item, report)
                if item["state"] in _WORKABLE:
                    item["state"] = self._progress_state(item)
        save()
        report["remaining"], report["pause"] = self._remaining(queue), queue.get("pause")
        left_selected = sum(item["chunks_total"] - item["chunks_done"] for item in selected if item["state"] in _WORKABLE)
        if ended["state"] is not None:
            report.update(state=ended["state"], reason=ended["reason"], detail=ended["detail"])
        elif ended["worker"] == "deadline":
            report.update(state="max_seconds_reached" if by_bound else "ceiling_reached", reason="max_seconds" if by_bound else "allowance_exhausted",
                          detail="No new chunk was started after the bound; the queue is kept.")
        elif left_selected and limited:
            report.update(state="max_chunks_reached", reason="max_chunks", detail="The chunk bound of this run was reached; the queue is kept.")
        elif refused_publications():
            report.update(state="failed", reason="publish_rejected", detail=refused_publications())
        else:
            report.update(state="completed")
        report["outcome"] = "ran"

    @staticmethod
    def _file_stamp(path: Path) -> tuple[int, int] | None:
        try:
            stat = path.stat()
        except OSError:
            return None
        return stat.st_mtime_ns, stat.st_size

    def _supervise(self, report: dict, binding: dict[str, Any], timings: Timings, queue: dict, ledger: Allowance, jobs: list[dict], *, soft_seconds: float,
                   save: Callable[[], None]) -> None:
        """Launch ONE worker for the job list and stay with it: account the time, keep the lease alive, take in chunk
        results as they appear, publish prefixes, and stop the child on the stop file, at the ceiling or when it stalls.

        From the moment the reservation is written, however this method is left — a return, an error, an interrupt —
        the child is stopped and the reservation is settled with the wall time that passed."""
        self.run_dir.mkdir(parents=True, exist_ok=True)
        temp = self.run_dir / "tmp"
        temp.mkdir(exist_ok=True)
        job_path, heartbeat_path, lease_path, result_path = (self.run_dir / name for name in ("job.json", "heartbeat.json", "lease.json", "result.json"))
        for stale in (heartbeat_path, result_path):
            stale.unlink(missing_ok=True)
        for job in jobs:
            self._chunk_path(job["item"], job["index"]).parent.mkdir(parents=True, exist_ok=True)
        before_run = {position: self._file_stamp(self._chunk_path(job["item"], job["index"])) for position, job in enumerate(jobs)}  # what lay there before this run
        ceiling, used_before = ledger.ceiling_seconds, ledger.used_seconds
        guard = timings.poll_seconds + timings.terminate_wait_seconds  # the backstop acts this long before the ceiling, so stopping the child still ends below it
        pending = list(range(len(jobs)))
        handed_out = {(id(job["item"]), job["index"]) for job in jobs}
        ended: dict[str, Any] = {"state": None, "reason": None, "detail": None, "worker": None}
        at_position: int | None = None  # the job the worker last said it was at

        def take_in(upto: int | None) -> None:
            """Take in finished chunk results of the jobs before position ``upto`` (all jobs when None), in order."""
            for position in [p for p in pending if upto is None or p < upto]:
                job = jobs[position]
                item = job["item"]
                if job["index"] != item["chunks_done"]:
                    continue  # an earlier chunk of this recording is not there: nothing after it counts
                loaded = self._load_chunk(queue, item, job["plan"], job["index"])
                if loaded is None:
                    continue
                pending.remove(position)
                item["chunks_done"] += 1
                while (item["chunks_done"] < len(job["plan"]) and (id(item), item["chunks_done"]) not in handed_out
                       and self._load_chunk(queue, item, job["plan"], item["chunks_done"]) is not None):
                    item["chunks_done"] += 1  # a later chunk whose result was on disk before this run: it was not handed out, it simply counts
                item.update(state=self._progress_state(item) if item["state"] in _WORKABLE else item["state"], last_error=None)
                item.pop("resource_failures", None)  # a chunk of this recording went through: it is not held back any more
                queue.pop("unexplained_end", None)  # a chunk went through: a worker that ended without a word before did not end for a reason of the machine
                report["chunks_completed"] += 1
                report["media_seconds"] += loaded[0]["decoded_ms"] / 1000
                report["segments"] += len(loaded[0]["segments"])
                report["words"] += sum(len(segment.get("words") or []) for segment in loaded[0]["segments"])
                if item["chunks_done"] == item["chunks_total"] or item["chunks_done"] - item["published_chunks"] >= binding["publish_every_chunks"]:
                    self._publish(queue, binding, item, report)
                    if item["state"] in _WORKABLE:
                        item["state"] = self._progress_state(item)
                save()

        reservation = ledger.reserve(report["run_id"], lease_seconds=timings.lease_seconds)  # durable BEFORE the worker is launched
        started_wall, started = float(reservation["started_at"]), time.monotonic()
        process: subprocess.Popen | None = None
        try:
            write_json(lease_path, {"until": started_wall + timings.lease_seconds})
            document = {"document": "speech-job/1", "run_id": report["run_id"], "model_dir": str(binding["model_dir"]), "cpu_threads": binding["threads"], "num_workers": binding["workers"],
                        "device": DEVICE, "compute_type": COMPUTE_TYPE, "sample_rate_hz": SAMPLE_RATE_HZ, "settings": dict(INFERENCE_SETTINGS), "settings_sha256": queue["settings_sha256"],
                        "model_bin_sha256": binding.get("model_bin_sha256"), "decoding_policy": DECODING_POLICY, "second_pass_settings": dict(SECOND_PASS_SETTINGS),
                        "second_pass_sha256": SECOND_PASS_SHA256,
                        "heartbeat_path": str(heartbeat_path), "lease_path": str(lease_path), "stop_path": str(self.stop_path), "result_path": str(result_path),
                        "not_after_epoch": started_wall + soft_seconds,
                        # The allowance ceiling as a clock time. This supervisor stops its child before it; a child left without a supervisor stops there by itself.
                        "hard_stop_epoch": started_wall + max(0.0, ceiling - used_before),
                        "jobs": [{"work_id": job["item"]["work_id"], "media_path": str(self._media_path(job["item"])), "sha256": job["item"]["sha256"], "bytes": job["item"]["bytes"],
                                  "index": job["index"], "start_ms": job["plan"][job["index"]]["start_ms"], "end_ms": job["plan"][job["index"]]["end_ms"],
                                  "last": job["index"] == len(job["plan"]) - 1, "out_path": str(self._chunk_path(job["item"], job["index"]))} for job in jobs]}
            write_json(job_path, document)
            with open(self.run_dir / "worker.log", "ab") as log:
                log.write(f"\n==== run {report['run_id']} at {self._now()} jobs={len(jobs)}\n".encode("utf-8"))
                log.flush()
                try:
                    process = subprocess.Popen([str(binding["interpreter"]), "-B", str(self._worker(binding)), "--job", str(job_path)], cwd=str(self.run_dir),
                                               env=child_environment(os.environ, threads=binding["threads"], temp_dir=temp), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                except OSError as exc:  # the configured interpreter exists but cannot be executed: nothing was processed and no chunk is to blame
                    ended.update(state="failed", reason="worker_launch_failed", detail=f"The speech interpreter could not be started ({exc}). Nothing was processed.")
                last_beat = time.monotonic()
                while process is not None and process.poll() is None:
                    elapsed = time.monotonic() - started
                    if time.monotonic() - last_beat >= timings.heartbeat_seconds:
                        try:
                            ledger.heartbeat(lease_seconds=timings.lease_seconds)
                            write_json(lease_path, {"until": time.time() + timings.lease_seconds})
                            last_beat = time.monotonic()
                        except OSError:
                            # The file could not be replaced this time (on Windows: another process has it open). The lease
                            # written before is still good, so this is tried again at the next look. Only when no refresh went
                            # through for a whole lease — the worker has stopped by itself by then — is it the end of the run.
                            if time.monotonic() - last_beat >= timings.lease_seconds:
                                raise
                    try:
                        beat = read_json(heartbeat_path)
                    except ValueError:
                        beat = None
                    at_position = beat["job"] if isinstance(beat, dict) and isinstance(beat.get("job"), int) and not isinstance(beat["job"], bool) else at_position
                    take_in(at_position if at_position is not None else 0)
                    silent_for = time.time() - float(beat["at"]) if isinstance(beat, dict) and isinstance(beat.get("at"), (int, float)) else elapsed
                    if self.stop_path.exists():
                        ended.update(state="stopped", reason="stop_file", detail=f"{self.stop_path} appeared; the worker was stopped. Finished chunks are kept.")
                    elif used_before + elapsed >= ceiling - guard:
                        ended.update(state="ceiling_reached", reason="hard_ceiling", detail="The allowance ceiling was about to be reached while a chunk was running; the worker was stopped and that chunk is not kept.")
                    elif silent_for >= timings.stall_seconds:
                        ended.update(state="failed", reason="worker_stalled", detail=f"The worker gave no heartbeat for {silent_for:.0f} s and was stopped.")
                    if ended["state"] is not None:
                        break
                    time.sleep(timings.poll_seconds)
        finally:
            try:
                if process is not None and process.poll() is None:  # only ever this run's own child
                    process.terminate()
                    try:
                        process.wait(timeout=timings.terminate_wait_seconds)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            finally:
                wall = time.monotonic() - started
                report["wall_seconds"] = wall
                report["allowance"].update(used_after=ledger.settle(wall), remaining_seconds=ledger.remaining_seconds)
        take_in(None)
        try:
            result, beat = read_json(result_path), read_json(heartbeat_path)
        except ValueError:
            result, beat = None, None
        result = result if isinstance(result, dict) else {}
        at_position = beat["job"] if isinstance(beat, dict) and isinstance(beat.get("job"), int) and not isinstance(beat["job"], bool) else at_position  # its last word
        blamed: set[int] = set()  # jobs whose failure is already counted in this run
        passed_over: set[str] = set()  # recordings the worker left alone after a conflict or a decoding error
        for item in {id(job["item"]): job["item"] for job in jobs}.values():
            if item["work_id"] in (result.get("conflicts") or []):
                item.update(state="source_conflict", reason="bytes_changed", last_error="The worker found other bytes than the frozen ones when it opened the recording.")
                passed_over.add(item["work_id"])
        for error in result.get("chunk_errors") or []:  # a recording whose audio could not be decoded: its chunk failed, the run went on
            position = error.get("position") if isinstance(error, dict) else None
            if isinstance(position, int) and 0 <= position < len(jobs) and position in pending:
                self._chunk_failure(jobs[position]["item"], jobs[position]["index"], str(error.get("error"))[:500])
                blamed.add(position)
                passed_over.add(jobs[position]["item"]["work_id"])
        # A result the worker wrote in this run that the supervisor does not accept is a failed attempt with its reason — not a chunk that is quietly done again.
        for position in list(pending):
            item, index = jobs[position]["item"], jobs[position]["index"]
            stamp = self._file_stamp(self._chunk_path(item, index))
            if position in blamed or item["work_id"] in passed_over or index != item["chunks_done"] or stamp is None or stamp == before_run[position]:
                continue
            verdict = self._inspect_chunk(queue, item, jobs[position]["plan"], index)
            if isinstance(verdict, str) and verdict != "missing":
                self._chunk_failure(item, index, f"the worker's result was not accepted: {verdict}")
                blamed.add(position)
        kind = result.get("ended")
        ended["worker"] = kind
        code = process.returncode if process is not None else None
        if ended["state"] is None and kind == "stop":
            ended.update(state="stopped", reason="stop_file", detail=f"{self.stop_path} appeared; the worker stopped. Finished chunks are kept.")
        elif ended["state"] is None and kind == "hard_ceiling":
            ended.update(state="ceiling_reached", reason="hard_ceiling", detail="The worker stopped itself at the allowance ceiling; the chunk it was in is not kept.")
        elif ended["state"] is None and (code != 0 or kind not in {"completed", "deadline"}):
            detail = str(result.get("error") or f"The worker exited with code {code} without a result; see {self.run_dir / 'worker.log'}.")[:500]
            if kind == "error":
                # A RESOURCE failure (memory, model, runtime; also one that keeps the runtime from starting): the queue is
                # PAUSED. No chunk is counted as failed and no recording is set aside: the cause is the machine, not the recording.
                reason = "worker_startup_failed" if result.get("phase") == "startup" else "worker_failed"
                position = result.get("error_job") if isinstance(result.get("error_job"), int) and not isinstance(result.get("error_job"), bool) and 0 <= result["error_job"] < len(jobs) else None
                where = None
                if reason == "worker_failed" and position is not None:
                    item, index = jobs[position]["item"], jobs[position]["index"]
                    counts = dict(item.get("resource_failures") or {})
                    counts[str(index)] = counts.get(str(index), 0) + 1
                    item["resource_failures"] = counts
                    item["last_error"] = f"chunk {index}: resource failure, the queue is paused: {detail}"[:600]
                    where = {"recording": item["key"], "chunk": index}
                queue["pause"] = {"reason": PAUSE_REASON, "worker_reason": reason, "detail": detail, "at": self._now(), "run_id": report["run_id"],
                                  "recording": where["recording"] if where else None, "chunk": where["chunk"] if where else None}
                ended.update(state="paused", reason=reason,
                             detail=f"{detail} — The queue is paused and nothing was set aside. When the cause is dealt with, run speech-run with --retry-failed to continue.")
            else:
                ended.update(state="failed", reason="worker_lease_lost" if kind == "lease_lost" else "worker_died", detail=detail)
        if ended["state"] == "failed" and ended["reason"] in {"worker_died", "worker_stalled"}:
            # Nothing says why: the failure is counted against the chunk the worker was in. A chunk that keeps failing sets its
            # recording aside — it may be that recording's audio. But when the worker ends the same way in ANOTHER recording
            # with no chunk finished in between, the cause is the machine: the queue is paused, like after a failure the worker
            # reports, and nothing more is counted or set aside until the owner says to go on.
            candidates = [p for p in pending if p not in blamed and jobs[p]["item"]["work_id"] not in passed_over]
            position = at_position if at_position in candidates else (candidates[0] if candidates else None)
            if position is not None:
                item, index = jobs[position]["item"], jobs[position]["index"]
                before = queue.get("unexplained_end") if isinstance(queue.get("unexplained_end"), dict) else None
                if before is not None and before.get("recording") != item["key"]:
                    counts = dict(item.get("resource_failures") or {})
                    counts[str(index)] = counts.get(str(index), 0) + 1
                    item["resource_failures"] = counts
                    item["last_error"] = f"chunk {index}: the worker ended without saying why, as it did in {before.get('recording')} just before; the queue is paused: {ended['detail']}"[:600]
                    queue["pause"] = {"reason": PAUSE_REASON, "worker_reason": ended["reason"], "detail": ended["detail"], "at": self._now(), "run_id": report["run_id"],
                                      "recording": item["key"], "chunk": index}
                    ended.update(state="paused", detail=f"{ended['detail']} — The worker ended without saying why in two recordings in a row ({before.get('recording')}, then "
                                                        f"{item['key']}) with no chunk finished in between: the queue is paused and nothing more was set aside. When the cause is "
                                                        "dealt with, run speech-run with --retry-failed to continue.")
                else:
                    self._chunk_failure(item, index, ended["detail"])
                    queue["unexplained_end"] = {"recording": item["key"], "chunk": index, "reason": ended["reason"], "run_id": report["run_id"], "at": self._now()}
        save()
        report["_ended"] = ended

    # ---- receipts -------------------------------------------------------------------------------------------------
    def _with_journal(self, action: Callable[[Journal], Any]) -> Any:
        if self._journal is not None:
            return action(self._journal)
        owned = [self._settings.planner_root, *(binding.root for binding in self._settings.courses.values() if binding.status != "missing_root")]
        journal = Journal.open(self._settings.journal_path, synced_roots=[] if self._settings.profile == "fixture" else owned)
        try:
            return action(journal)
        finally:
            journal.close()

    def _receipt(self, report: dict) -> str:
        """One receipt per run, no-change run, refusal, error or interrupt in the app's existing journal (no job, no queue entry)."""
        payload = {key: report[key] for key in ("outcome", "state", "reason", "detail", "run_id", "runner", "profile", "grant_id", "allowance", "wall_seconds", "chunks_completed",
                                                "media_seconds", "words", "segments", "published", "remaining", "queue", "selection", "pause")}
        if "resumed_after_pause" in report:
            payload["resumed_after_pause"] = report["resumed_after_pause"]
        payload["at"] = self._now()
        return self._with_journal(lambda journal: journal.add_receipt(kind=RECEIPT_KIND, job_id=None, ref=f"speech/{report['run_id']}", sha256=None, payload=payload))

    # ---- status ---------------------------------------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        """Readback for a person, the app or a wrapper. Reads only: no hashing, no lock, nothing written.

        Per course and per recording: state (``queued`` / ``partial`` / ``complete`` / ``complete_with_unresolved`` /
        ``source_conflict`` / ``failed`` / ``not_in_frozen_queue``), the duration, what was PROCESSED
        (``seconds_processed``: audio the worker went through), what is PUBLISHED (``seconds_published``) and what is
        COVERED: ``covered_intervals`` are the published stretches minus the intervals whose text was withheld
        (``unresolved_intervals``, ``unresolved_seconds``); ``seconds_covered`` and ``coverage_fraction`` count that
        resolved time only, and ``covers_whole_recording`` is false while anything is unresolved or unpublished. Then
        chunks done, the last error, the lecture ids the inventory links NOW (the frozen copy beside them); the
        allowance used and remaining; a pause after a resource failure; and the exact command that resumes the run.
        Nothing is extrapolated."""
        try:
            binding = self._binding()
            binding_state: dict[str, Any] = {"status": "ok", "grant_id": binding["grant_id"], "ceiling_seconds": binding["ceiling_seconds"], "threads": binding["threads"],
                                             "workers": binding["workers"], "interpreter": str(binding["interpreter"]), "model_dir": str(binding["model_dir"]),
                                             "interpreter_exists": binding["interpreter"].is_file(), "model_files_exist": all((binding["model_dir"] / name).is_file() for name in MODEL_FILES),
                                             "state_dir": str(binding["state_dir"]) if binding.get("state_dir") else None}
        except Refused as refusal:
            binding, binding_state = None, {"status": refusal.code, "detail": refusal.detail}
        ledger = Allowance.peek(self.ledger_path)
        allowance: dict[str, Any] = {"grant_id": binding["grant_id"] if binding else None, "ceiling_seconds": binding["ceiling_seconds"] if binding else None, "used_seconds": 0.0,
                                     "remaining_seconds": binding["ceiling_seconds"] if binding else None, "in_flight_seconds": 0.0, "open_reservation": None, "ledger": "not_created"}
        if ledger is not None and "unreadable" in ledger:
            allowance.update(ledger="unreadable", remaining_seconds=None, detail=ledger["unreadable"])
        elif ledger is not None:
            ceiling = min(float(ledger["ceiling_seconds"]), binding["ceiling_seconds"]) if binding and binding["grant_id"] == ledger["grant_id"] else float(ledger["ceiling_seconds"])
            reservation = ledger["open"]
            in_flight = max(0.0, float(reservation["heartbeat_at"]) - float(reservation["started_at"])) if reservation else 0.0
            allowance.update(grant_id=ledger["grant_id"], ceiling_seconds=ceiling, used_seconds=float(ledger["used_seconds"]), in_flight_seconds=in_flight,
                             remaining_seconds=max(0.0, ceiling - float(ledger["used_seconds"]) - in_flight), ledger="ok",
                             open_reservation=None if not reservation else {"run_id": reservation["run_id"], "started_at": _iso(reservation["started_at"]),
                                                                            "heartbeat_at": _iso(reservation["heartbeat_at"]), "lease_until": _iso(reservation["lease_until"])})
        try:
            queue = read_json(self.queue_path)
        except ValueError:
            queue = None
        queue = queue if isinstance(queue, dict) and isinstance(queue.get("items"), list) else None
        listed = self._recordings_now()
        chunk_ms, overlap_ms = (queue["chunk_ms"], queue["overlap_ms"]) if queue else (0, 0)

        def row(item: dict | None, now: dict | None) -> dict[str, Any]:
            base = item or now or {}
            duration = (item or {}).get("duration_ms") or (media_duration_ms(self._media_path(now)) if now and now.get("path") and now["state"] in _READABLE else None)  # type: ignore[arg-type]
            done, total = (item["chunks_done"], item["chunks_total"]) if item else (0, 0)
            published_chunks = (item or {}).get("published_chunks", 0)
            processed = 0 if not done or not duration else duration if done >= total else min(duration, done * chunk_ms + overlap_ms)
            published = 0
            if item and published_chunks and duration:
                stored = item.get("published_window_end_ms")
                published = stored if type(stored) is int and 0 < stored <= duration else duration if published_chunks >= total else min(duration, published_chunks * chunk_ms + overlap_ms)
            # What the publication withheld. A queue written before the intervals were kept states only their total:
            # then the intervals are unknown (None) until the recording is published again, and the total still counts.
            stated = (item or {}).get("unresolved_intervals")
            known = isinstance(stated, list) and all(isinstance(i, dict) and type(i.get("start_ms")) is int and type(i.get("end_ms")) is int for i in stated)
            unresolved_ms = int(round(float((item or {}).get("unresolved_seconds") or 0.0) * 1000)) if published else 0
            if not published:
                unresolved, covered = [], []
            elif known:
                unresolved = [{"start_ms": i["start_ms"], "end_ms": i["end_ms"], "reason": i.get("reason")} for i in stated if i["start_ms"] < published]
                covered = ch.subtract_intervals({"start_ms": 0, "end_ms": published}, unresolved)
                unresolved_ms = published - sum(i["end_ms"] - i["start_ms"] for i in covered)
            else:
                unresolved, covered = (None, None) if unresolved_ms else ([], [{"start_ms": 0, "end_ms": published}])
            covered_ms = max(0, published - unresolved_ms)
            state = item["state"] if item else "not_in_frozen_queue"
            if state == "complete" and unresolved_ms:  # a queue written before the two states were told apart: withheld time is never plain complete
                state = "complete_with_unresolved"
            frozen_ids = list((item or {}).get("lecture_ids") or [])
            return {"course_id": base.get("course_id"), "source_id": base.get("source_id"), "key": f"{base.get('course_id')}/{base.get('source_id')}", "filename": base.get("filename"),
                    "session_id": (now or base).get("session_id"),
                    # What the inventory links NOW; the copy frozen with the queue is kept beside it, because sessions get linked to lectures later too.
                    "lecture_ids": list(now.get("lecture_ids") or []) if now is not None else frozen_ids, "lecture_ids_from": "current_inventory" if now is not None else "frozen_queue",
                    "lecture_ids_frozen": frozen_ids if item else None, "version_id": base.get("version_id"),
                    "state": state, "reason": item["reason"] if item else ("not_in_frozen_queue" if queue else "queue_not_created"),
                    "duration_seconds": None if duration is None else duration / 1000, "seconds_processed": processed / 1000, "seconds_published": published / 1000,
                    "seconds_covered": covered_ms / 1000, "coverage_fraction": None if not duration else min(1.0, covered_ms / duration),
                    "covers_whole_recording": bool(item and total and published_chunks >= total and done >= total and not unresolved_ms),
                    "covered_intervals": covered, "unresolved_intervals": unresolved, "unresolved_seconds": unresolved_ms / 1000,
                    "chunks_done": done, "chunks_total": total,
                    "published_generation": (item or {}).get("published_generation"), "published_chunks": published_chunks,
                    "last_error": (item or {}).get("last_error"), "resource_failures": dict((item or {}).get("resource_failures") or {}), "listed_now": now is not None}

        courses: dict[str, Any] = {}
        sums = ("duration_seconds", "seconds_processed", "seconds_published", "seconds_covered", "unresolved_seconds")
        totals: dict[str, Any] = {"recordings": 0, "states": {state: 0 for state in STATES}, **{name: 0.0 for name in sums}}
        queued_keys = {item["key"] for item in queue["items"]} if queue else set()
        for course_id in self._settings.courses:
            rows = [row(item, listed.get(item["key"])) for item in (queue["items"] if queue else []) if item["course_id"] == course_id]
            rows += [row(None, now) for key, now in listed.items() if now["course_id"] == course_id and key not in queued_keys]
            course_totals = {"recordings": len(rows), **{state: sum(1 for r in rows if r["state"] == state) for state in STATES}, **{name: sum(r[name] or 0.0 for r in rows) for name in sums}}
            courses[course_id] = {"recordings": rows, "totals": course_totals}
            totals["recordings"] += len(rows)
            for name in sums:
                totals[name] += course_totals[name]
            for state in STATES:
                totals["states"][state] += course_totals[state]
        pause = queue.get("pause") if queue and isinstance(queue.get("pause"), dict) else None
        resume = self.resume_argv(retry_failed=bool(pause))
        return {"document": "speech-status/1", "runner": RUNNER_VERSION, "profile": self._settings.profile, "binding": binding_state, "allowance": allowance,
                "queue": {"exists": queue is not None, "created_at": queue["created_at"] if queue else None, "chunk_seconds": chunk_ms / 1000 if queue else None,
                          "overlap_seconds": overlap_ms / 1000 if queue else None, "recordings": len(queue["items"]) if queue else 0,
                          "identity_sha256": queue_identity(queue) if queue else None},
                "pause": pause, "courses": courses, "totals": totals, "stop_file": {"path": str(self.stop_path), "present": self.stop_path.exists()},
                "resume_argv": resume, "resume_command": subprocess.list2cmdline(resume),
                "note": "Generated, unreviewed speech text. seconds_processed is audio the worker went through; seconds_covered is the published part of it MINUS unresolved time, "
                        "where the recogniser's output failed the repetition check and was withheld (neither speech nor silence is known there). A recording is complete only "
                        "when nothing is unresolved; otherwise it is complete_with_unresolved. Lecture ids are the inventory's current links. Nothing about acoustic accuracy, "
                        "slide matching or time to completion is extrapolated."}


def run(settings: Settings, journal: Journal | None = None, **arguments: Any) -> dict[str, Any]:
    """One bounded run with the profile's binding. See :meth:`SpeechRunner.run`."""
    return SpeechRunner(settings, journal).run(**arguments)


def status(settings: Settings, **arguments: Any) -> dict[str, Any]:
    """The runner's status readback with the profile's binding (the status answers without one too)."""
    return SpeechRunner(settings, None, **arguments).status()
