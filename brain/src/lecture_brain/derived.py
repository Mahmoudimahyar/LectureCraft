"""Consumer of generated speech timing for recordings (remediation R1-E).

Some other process — the owner's, with its own speech tool — produces timed text for ONE recording and leaves it in
an output root: output files first, ``manifest.json`` last. This module never runs speech recognition, never starts
that process, never installs anything and never executes or follows anything found in an output root. It only:

* checks an explicitly selected output root against the ``ll.derived-manifest/1`` and ``ll.derived-segments/1``
  contracts, the declared bytes and the app's CURRENT identity of the recording (what the course index names AND
  the bytes on disk now);
* accepts, through an adapter, a bundle of the offline timing producer (``private-timing-output-manifest-v1``): the
  bundle is verified and mapped to one generation in the app's own contract, and the producer's files are kept
  unchanged beside it (``speech/producer_bundle.py``; the producer is never rewritten to fit);
* admits a generation that this app's own speech runner assembled in memory, through the same checks;
* copies it into the app-local derived store (``<app area>/derived/<source_id>/<generation>/``), outputs first and
  the manifest last, and never changes a stored generation afterwards;
* reads, of the stored generations that still match the recording's current bytes, the one that RESOLVES the most
  of the recording (the newest among equals).

**Processed is not covered.** The app's own speech runner withholds text that fails its repetition check and states
the time it stands for as ``unresolved_intervals`` in the generation's ``provenance.json``: that time was processed,
but neither speech nor silence is known there. The reader therefore reports ``covered_intervals`` (the window minus
the unresolved intervals), ``unresolved_intervals`` and ``unresolved_seconds``; ``coverage_fraction`` counts resolved
time only (``processed_fraction`` is the window); and ``covers_whole_recording`` is false while anything is
unresolved. A generation of the speech runner that does not state a withholding merge policy this consumer serves
(``SERVED_MERGE_POLICIES``) — one published before text was withheld — is kept on disk and never served.

What comes out is NEW generated text with its own times. It is not the course transcript, it is unreviewed, and it
establishes nothing about slides. Every import, reuse and rejection is a receipt in the existing journal; there is
no second queue here and the source-refresh path does not call this module.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import shutil
from typing import Any, Callable, Iterable

from . import contracts as c
from .annotations import media_duration_ms
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive, replace_atomic
from .journal import Journal
from .ownerio.inventory import build_inventory
from .preparation import Preparation
from .speech import producer_bundle

CONSUMER_VERSION = "derived-consumer-1"
MANIFEST_NAME = "manifest.json"
SEGMENTS_NAME = "segments.json"  # in generations this app assembles itself (adapter, runner)
PROVENANCE_NAME = "provenance.json"  # where such a generation keeps where it came from
PROVENANCE_DOCUMENT = "derived-provenance/1"
RECEIPT_KIND = "derived-import"
STOP_FILE = "derived-import.stop"  # in the app's private state folder: while it exists no import starts or continues
TIME_TOLERANCE_MS = 500  # the same slack the cue route allows past the end of a recording
DURATION_TOLERANCE_MS = 1000
MAX_SEGMENTS = 20_000
MAX_WORDS = 400_000
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_BACKLOG_ROOTS = 256  # output roots looked at in one call, whatever the caller passes
ALLOWED_MEDIA_TYPES = frozenset({"application/json", "text/plain", "text/vtt"})
_OUTCOME = {"imported": "imported", "reused": "no_change", "rejected": "rejected", "cancelled": "cancelled"}  # status of a result -> outcome in its receipt
_READABLE = frozenset({"registered_readable", "present_unindexed"})
_PRODUCER_KEYS = ("tool", "tool_version", "model", "language", "parameters_sha256")
_PROVENANCE_SUMMARY = ("origin", "adapter", "runner", "producer_contract", "job_key", "producer_manifest_sha256", "producer_statuses", "model", "counts", "covers_whole_recording",
                       "publication")
# Merge policies of the app's own speech runner under which text failing the repetition check is withheld and its time
# stated as unresolved. A runner generation that names none of these was published before withholding: never served.
SERVED_MERGE_POLICIES = frozenset({"withhold-repetition-1", "withhold-repetition-2"})
GENERATION_STATES = ("current", "superseded", "unserved_policy", "stale", "invalid", "incomplete")


def input_fingerprint(*, recording_sha256: str, recording_bytes: int, window_start_ms: int, window_end_ms: int, clip_offset_ms: int, producer: dict,
                      consumer_version: str) -> str:
    """Digest of everything that decides what a run would produce: the recording's bytes, the processed window and
    clip offset, the producer (tool, version, model, language, parameters) and the consumer version it writes for.
    A runner computes it before working; an equal fingerprint already listed by ``derived-status`` means no work."""
    material = {"contract": "ll.derived-input/1", "consumer_version": consumer_version, "recording": {"sha256": recording_sha256, "bytes": recording_bytes},
                "window": {"start_ms": window_start_ms, "end_ms": window_end_ms}, "clip_offset_ms": clip_offset_ms, "producer": {key: producer[key] for key in _PRODUCER_KEYS}}
    return c.sha256_hex(c.dump_json(material))


def fingerprint_of(manifest: dict) -> str:
    return input_fingerprint(recording_sha256=manifest["recording"]["sha256"], recording_bytes=manifest["recording"]["bytes"], window_start_ms=manifest["window"]["start_ms"],
                             window_end_ms=manifest["window"]["end_ms"], clip_offset_ms=manifest["clip_offset_ms"], producer=manifest["producer"],
                             consumer_version=manifest["consumer_version"])


def to_recording_ms(clip_ms: int, clip_offset_ms: int) -> int:
    """The single place where a clip-relative time becomes a recording-absolute time (offset applied once)."""
    return clip_ms + clip_offset_ms


def assemble_generation(*, course_id: str, source_id: str, generation: str, created_at: str, recording_sha256: str, recording_bytes: int, declared_duration_ms: int | None,
                        producer: dict, window: dict, clip_offset_ms: int, segments: list[dict], provenance: dict | None = None,
                        extra_files: dict[str, tuple[bytes, str]] | None = None) -> tuple[bytes, dict[str, bytes]]:
    """One generation in this app's own contract, assembled in memory (the producer-bundle adapter, the speech runner).
    Returns the manifest bytes and the output bytes; the same inputs give the same bytes. Nothing is stored here: the
    result goes through the same admission checks as an output root on disk."""
    document = {"contract": "ll.derived-segments/1", "course_id": course_id, "source_id": source_id, "generation": generation, "time_base": "clip_relative",
                "clip_offset_ms": clip_offset_ms, "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [], "segments": segments}
    files: dict[str, tuple[bytes, str]] = {SEGMENTS_NAME: (c.dump_json(document), "application/json"), **(extra_files or {})}
    if provenance is not None:
        files[PROVENANCE_NAME] = (c.dump_json({"document": PROVENANCE_DOCUMENT, **provenance}), "application/json")
    manifest = {"contract": "ll.derived-manifest/1", "status": "complete", "kind": "speech_timing", "course_id": course_id, "generation": generation, "created_at": created_at,
                "consumer_version": CONSUMER_VERSION, "recording": {"source_id": source_id, "sha256": recording_sha256, "bytes": recording_bytes, "duration_ms": declared_duration_ms},
                "producer": {key: producer[key] for key in _PRODUCER_KEYS}, "window": {"start_ms": window["start_ms"], "end_ms": window["end_ms"]}, "time_base": "clip_relative",
                "clip_offset_ms": clip_offset_ms, "input_fingerprint": "0" * 64, "segments_path": SEGMENTS_NAME,
                "outputs": [c.artifact_for_bytes(data, name, media_type) for name, (data, media_type) in sorted(files.items())],
                "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": []}
    manifest["input_fingerprint"] = fingerprint_of(manifest)
    return c.dump_json(manifest), {name: data for name, (data, _) in files.items()}


class _Rejected(Exception):
    """An output root that is not imported. ``code`` is the stable reason recorded in the receipt."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail[:500]


class _Cancelled(Exception):
    """A stop was requested between two steps. Nothing is rolled forward: without its manifest the generation does not exist."""


def _is_link(path: Path) -> bool:
    """A symlink or (on Windows) a junction. Neither is ever followed out of an output root."""
    return path.is_symlink() or path.is_junction()


def _plain_path(root: Path, relative: Any) -> Path:
    """A declared path as a location inside ``root``: portable and relative, no link on the way, no escape."""
    if not c.safe_relative(relative):
        raise _Rejected("unsafe_path", f"Not a plain relative path inside the output root: {str(relative)[:120]!r}")
    current = root
    for part in relative.split("/"):
        current = current / part
        if _is_link(current):
            raise _Rejected("unsafe_path", f"A link is on the way to {relative!r}; links are not followed.")
    if not current.resolve().is_relative_to(root.resolve()):
        raise _Rejected("unsafe_path", f"{relative!r} resolves outside the output root.")
    return current


def _verify_outputs(directory: Path, manifest: dict) -> str | None:
    """Why the files under ``directory`` are not exactly the manifest's outputs, or None when they are."""
    for entry in manifest["outputs"]:
        try:
            path = _plain_path(directory, entry["path"])
            if not path.is_file() or path.stat().st_size != entry["bytes"] or c.sha256_hex(path.read_bytes()) != entry["sha256"]:
                return f"Stored {entry['path']!r} does not have the declared size and sha256."
        except (OSError, _Rejected):
            return f"Stored {entry['path']!r} cannot be read as a plain file."
    return None


def _when(manifest: dict) -> tuple[datetime, str]:
    """Ordering of generations of one recording: the producer's creation time, then the id."""
    return datetime.fromisoformat(manifest["created_at"].replace("Z", "+00:00")), manifest["generation"]


def stated_unresolved(provenance: dict | None, window: dict) -> list[dict[str, Any]]:
    """The intervals a generation's provenance states as unresolved (processed, text withheld): ``[{start_ms, end_ms,
    reason}]`` in whole milliseconds of recording time, inside the window, in order and not overlapping. A generation
    that states none has none. Raises ``ValueError`` when what is stated cannot be read that way: nothing is guessed."""
    stated = provenance.get("unresolved_intervals") if isinstance(provenance, dict) else None
    if stated is None:
        return []
    if not isinstance(stated, list):
        raise ValueError("unresolved_intervals is not a list")
    intervals, floor = [], window["start_ms"]
    for entry in stated:
        start, end, reason = (entry.get(key) for key in ("start_ms", "end_ms", "reason")) if isinstance(entry, dict) else (None, None, None)
        if type(start) is not int or type(end) is not int or not isinstance(reason, str) or not reason:
            raise ValueError("an unresolved interval needs start_ms and end_ms in whole milliseconds and a reason")
        if not (floor <= start < end <= window["end_ms"]):
            raise ValueError(f"the unresolved interval {start}-{end} ms is empty, out of order, overlapping or outside the window")
        intervals.append({"start_ms": start, "end_ms": end, "reason": reason[:80]})
        floor = end
    return intervals


def policy_problem(provenance: dict | None) -> str | None:
    """Why a generation of the app's own speech runner is not served, or None. Other origins state no merge policy and are not judged by one."""
    if not isinstance(provenance, dict) or provenance.get("origin") != "speech_runner":
        return None
    decoding = provenance.get("decoding")
    policy = decoding.get("merge_policy") if isinstance(decoding, dict) else None
    if policy not in SERVED_MERGE_POLICIES or provenance.get("unresolved_intervals") is None:
        return (f"Published by the speech runner under merge policy {policy!r} without stating unresolved intervals as this consumer needs them "
                f"({', '.join(sorted(SERVED_MERGE_POLICIES))}): text that fails the repetition check may not have been withheld. Kept on disk, never served.")
    return None


def covered_intervals(window: dict, unresolved: list[dict]) -> list[dict[str, int]]:
    """The window minus the unresolved intervals: what a generation actually covers."""
    covered, cursor = [], window["start_ms"]
    for interval in unresolved:
        if interval["start_ms"] > cursor:
            covered.append({"start_ms": cursor, "end_ms": interval["start_ms"]})
        cursor = max(cursor, interval["end_ms"])
    if cursor < window["end_ms"]:
        covered.append({"start_ms": cursor, "end_ms": window["end_ms"]})
    return covered


class Derived:
    def __init__(self, settings: Settings, journal: Journal | None = None, *, preparation: Preparation | None = None, now: Callable[[], str] | None = None,
                 cancel: Callable[[], bool] | None = None):
        self._settings = settings
        self._journal = journal
        self._cancel = cancel
        self._preparation = preparation or Preparation(settings, converter=None)
        self._now = now or (lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

    # ---- locations and identity ----------------------------------------------------------------------------------
    def store_dir(self, course_id: str) -> Path:
        """The app's own derived store for a course. Never the course's materials."""
        return self._settings.app_area(course_id) / "derived"

    def _owned_roots(self) -> list[Path]:
        """The planner folder and every course folder that actually exists. A configured course without a folder has no
        root (its binding carries a placeholder), so it is left out rather than read as the current folder."""
        return [self._settings.planner_root, *(binding.root for binding in self._settings.courses.values() if binding.status != "missing_root")]

    def _sources(self, course_id: str) -> list[dict]:
        """Every file the app currently lists for the course, as the inventory identifies it."""
        inventory = build_inventory(self._settings.course(course_id))
        return [*(i for s in inventory["sessions"] for i in s["items"]), *(i for l in inventory["lectures"] for i in [*l["decks"], *l["extra_materials"]]), *inventory["other_sources"]]

    def _recording(self, course_id: str, source_id: str) -> dict | None:
        return next((i for i in self._sources(course_id) if i["source_id"] == source_id), None)

    def _check_identity(self, course_id: str, item: dict, manifest: dict) -> None:
        """The manifest must describe the recording as this app identifies it NOW: same file, same bytes."""
        if item["rendition"] != "native_media":
            raise _Rejected("not_a_recording", f"{item['source_id']!r} is not an audio or video recording.")
        sha256 = self._identity(course_id, item)[1]
        if sha256 is None:
            raise _Rejected("source_unavailable", f"{item['source_id']!r} is listed but cannot be read now ({item['state']}).")
        if manifest["recording"]["sha256"] != sha256 or manifest["recording"]["bytes"] != item["bytes"]:
            raise _Rejected("changed_input", "The recording's current bytes are not the bytes this result was made from; the result is not imported.")
        if self._disk_sha256(course_id, item) != sha256:
            raise _Rejected("changed_input", "The file on disk is not the version the course index names for this recording; timing is bound to the actual bytes, so the result is not imported.")

    def _disk_sha256(self, course_id: str, item: dict) -> str | None:
        """SHA-256 of the recording's bytes on disk NOW, whatever the course index says about it. Hashed at most once
        per file version: the preparation's persistent hash cache is keyed by path, size and modification time."""
        if item["state"] not in _READABLE or not item.get("path"):
            return None
        return self._preparation.identity_of(course_id, {**item, "sha256": None, "version_id": None})[1]

    # ---- import ---------------------------------------------------------------------------------------------------
    def stop_requested(self) -> bool:
        """The stop file in the app's private state folder, or the caller's own cancel check."""
        return (self._settings.state_dir / STOP_FILE).exists() or bool(self._cancel is not None and self._cancel())

    def _checkpoint(self) -> None:
        if self.stop_requested():
            raise _Cancelled()

    def import_generation(self, output_root: Path, *, course_id: str) -> dict[str, Any]:
        """Check one explicitly selected output root and copy it into the derived store.

        Returns ``{status: imported | reused | rejected | cancelled, reused, reason, detail, ...}``. A refusal is a
        result with a reason code and copies nothing; a stop between copy steps leaves no manifest, so readers see no
        generation and the next import starts it again. Every outcome leaves one receipt in the journal.
        """
        root = Path(output_root)
        facts: dict[str, Any] = {"course_id": course_id, "root": str(root), "source_id": None, "generation": None, "manifest_sha256": None, "input_fingerprint": None,
                                 "files": 0, "bytes": 0}
        try:
            outcome = self._import(root, course_id, facts)
        except _Rejected as refusal:
            outcome = {"status": "rejected", "reused": False, "reason": refusal.code, "detail": refusal.detail}
        except _Cancelled:
            outcome = {"status": "cancelled", "reused": False, "reason": "cancelled",
                       "detail": f"Stopped on request ({STOP_FILE} or the caller's cancel check). No manifest was written; import the same root again to finish."}
        result = {**facts, **outcome}
        result["receipt_id"] = self._receipt(result)
        return result

    def import_prepared(self, *, course_id: str, manifest_bytes: bytes, outputs: dict[str, bytes], origin: str) -> dict[str, Any]:
        """Admit a generation that this app's own speech runner assembled in memory (:func:`assemble_generation`).

        The same checks as for a root on disk — contract, fingerprint, the recording's current identity and bytes,
        duration, window, every segment and word, declared sizes and digests — and the same store and receipt. Only
        the reading of files from a selected folder is absent. ``origin`` is recorded where a root path would be."""
        facts: dict[str, Any] = {"course_id": course_id, "root": origin, "source_id": None, "generation": None, "manifest_sha256": None, "input_fingerprint": None,
                                 "files": 0, "bytes": 0}
        try:
            if course_id not in self._settings.courses:
                raise _Rejected("unknown_course", f"Course {course_id!r} is not one of the configured courses.")
            self._checkpoint()
            try:
                manifest = c.parse_json(manifest_bytes, max_bytes=c.MAX_MANIFEST_BYTES)
            except c.ContractError as exc:
                raise _Rejected("manifest_unreadable", str(exc)) from None
            self._check_manifest(manifest, manifest_bytes, facts)
            outcome = self._admit(course_id, manifest, manifest_bytes, facts, outputs=outputs)
        except _Rejected as refusal:
            outcome = {"status": "rejected", "reused": False, "reason": refusal.code, "detail": refusal.detail}
        except _Cancelled:
            outcome = {"status": "cancelled", "reused": False, "reason": "cancelled",
                       "detail": f"Stopped on request ({STOP_FILE} or the caller's cancel check). No manifest was written; publish the same generation again to finish."}
        result = {**facts, **outcome}
        result["receipt_id"] = self._receipt(result)
        return result

    def import_backlog(self, output_roots: Iterable[Path], *, course_id: str, max_imports: int = 8) -> dict[str, Any]:
        """Import several explicitly selected output roots in one bounded call (a cold backlog, or a routine run).

        At most ``max_imports`` generations are copied per call. Roots that are already stored ("no change") and roots
        that are refused do not use up the bound, so repeating the same call drains a backlog in a known number of
        calls and then settles into no-change receipts. A stop request ends the call; what was not looked at is
        returned in ``remaining``. ``complete`` means every offered root was looked at, not that every root was accepted.
        """
        roots = list(dict.fromkeys(Path(root) for root in output_roots))
        results: list[dict[str, Any]] = []
        counts = {"imported": 0, "reused": 0, "rejected": 0, "cancelled": 0}
        position = 0
        while position < min(len(roots), MAX_BACKLOG_ROOTS) and counts["imported"] < max(0, max_imports):
            result = self.import_generation(roots[position], course_id=course_id)
            results.append(result)
            counts[result["status"]] += 1
            if result["status"] == "cancelled":
                break  # the stopped root stays in the remaining list
            position += 1
        remaining = [str(root) for root in roots[position:]]
        return {"course_id": course_id, "max_imports": max_imports, "offered": len(roots), "results": results, "counts": counts, "remaining": remaining, "complete": not remaining}

    def _check_root(self, root: Path) -> None:
        if _is_link(root):
            raise _Rejected("root_is_link", "The selected output root is a link; select the real folder.")
        if not root.is_dir():
            raise _Rejected("root_missing", "The selected output root is not an existing folder.")
        resolved = root.resolve()
        # A runner writes only into its own output root. Course folders, the planner folder and this app's private
        # state are never one: the two sides of the handoff stay disjoint.
        if any(resolved.is_relative_to(Path(owned).resolve()) for owned in self._owned_roots()):
            raise _Rejected("root_inside_course", "The output root is inside a course or planner folder; a runner must write somewhere else.")
        if resolved.is_relative_to(self._settings.state_dir.resolve()):
            raise _Rejected("root_inside_app", "The output root is inside this app's private state folder.")

    def _read_manifest(self, root: Path) -> tuple[Any, bytes]:
        """``manifest.json`` of a selected root as strict JSON, and its exact bytes. Which contract it is comes next."""
        self._check_root(root)
        path = root / MANIFEST_NAME
        if _is_link(path):
            raise _Rejected("unsafe_path", f"{MANIFEST_NAME} in the output root is a link; links are not followed.")
        if not path.is_file():
            raise _Rejected("incomplete", f"No {MANIFEST_NAME} in the output root: the manifest is written last, so this generation is not finished.")
        if path.stat().st_size > c.MAX_MANIFEST_BYTES:
            raise _Rejected("manifest_too_large", f"{MANIFEST_NAME} is larger than {c.MAX_MANIFEST_BYTES} bytes.")
        data = path.read_bytes()
        try:
            return c.parse_json(data, max_bytes=c.MAX_MANIFEST_BYTES), data
        except c.ContractError as exc:
            raise _Rejected("manifest_unreadable", str(exc)) from None

    def _check_manifest(self, manifest: Any, data: bytes, facts: dict[str, Any]) -> dict:
        """A manifest in this app's own contract: complete, valid, its outputs listed once and its segments among them."""
        if not isinstance(manifest, dict) or manifest.get("status") != "complete":
            raise _Rejected("incomplete", "The manifest does not say status \"complete\"; an unfinished generation is never imported.")
        declared = [entry.get("path") for entry in manifest.get("outputs") or [] if isinstance(entry, dict)] if isinstance(manifest.get("outputs"), list) else []
        for relative in [*declared, manifest.get("segments_path")]:
            if isinstance(relative, str) and not c.safe_relative(relative):  # named precisely before the schema reports it as a pattern mismatch
                raise _Rejected("unsafe_path", f"Not a plain relative path inside the output root: {relative[:120]!r}")
        errors = c.validate("derived-manifest", manifest)
        if errors:
            raise _Rejected("manifest_invalid", "; ".join(errors[:5]))
        names = [entry["path"].casefold() for entry in manifest["outputs"]]
        if len(set(names)) != len(names) or MANIFEST_NAME in names:
            raise _Rejected("duplicate_output", f"Outputs must be listed once and never under the name {MANIFEST_NAME}.")
        if manifest["segments_path"] not in {entry["path"] for entry in manifest["outputs"]}:
            raise _Rejected("segments_not_listed", "segments_path does not name one of the listed outputs.")
        facts.update(source_id=manifest["recording"]["source_id"], generation=manifest["generation"], manifest_sha256=c.sha256_hex(data), input_fingerprint=manifest["input_fingerprint"])
        return manifest

    def _import(self, root: Path, course_id: str, facts: dict[str, Any]) -> dict[str, Any]:
        if course_id not in self._settings.courses:
            raise _Rejected("unknown_course", f"Course {course_id!r} is not one of the configured courses.")
        self._checkpoint()
        offered, data = self._read_manifest(root)
        if producer_bundle.is_bundle_manifest(offered):
            manifest_bytes, outputs = self._adapt_bundle(root, course_id, offered, data, facts)
            manifest = self._check_manifest(c.parse_json(manifest_bytes, max_bytes=c.MAX_MANIFEST_BYTES), manifest_bytes, {})  # held to the app's contract like any other
            facts.update(generation=manifest["generation"], input_fingerprint=manifest["input_fingerprint"], stored_manifest_sha256=c.sha256_hex(manifest_bytes))
            return self._admit(course_id, manifest, manifest_bytes, facts, outputs=outputs)
        manifest = self._check_manifest(offered, data, facts)
        return self._admit(course_id, manifest, data, facts, root=root)

    def _adapt_bundle(self, root: Path, course_id: str, offered: dict, data: bytes, facts: dict[str, Any]) -> tuple[bytes, dict[str, bytes]]:
        """A bundle of the offline timing producer as one generation in this app's contract (nothing is stored here).

        Declared paths, sizes and digests are verified with the importer's own reader; the adapter checks job keys,
        status and timing semantics; and the bundle's source (course, id, version, sha256) must be the recording as
        this app identifies it now AND the bytes on disk. The producer's files are read, never written."""
        try:
            declared = producer_bundle.declared_outputs(offered)
        except producer_bundle.Refused as refusal:
            raise _Rejected(refusal.code, refusal.detail) from None
        source = offered["source"]
        facts.update(source_id=source["source_id"], manifest_sha256=c.sha256_hex(data), adapter=producer_bundle.ADAPTER_VERSION, producer_contract=producer_bundle.MANIFEST_CONTRACT,
                     job_key=offered["job_key"])
        if source["course_id"] != course_id:
            raise _Rejected("course_mismatch", f"The bundle is for course {source['course_id']!r}, not {course_id!r}.")
        item = self._recording(course_id, source["source_id"])
        if item is None:
            raise _Rejected("unknown_source", f"{source['source_id']!r} is not a source this app currently lists for {course_id}.")
        if item["rendition"] != "native_media":
            raise _Rejected("not_a_recording", f"{item['source_id']!r} is not an audio or video recording.")
        files = self._read_outputs(root, declared, producer_bundle.TIMING_PATH)
        try:
            parts = producer_bundle.adapt(offered, facts["manifest_sha256"], files, tolerance_ms=TIME_TOLERANCE_MS, max_document_bytes=MAX_OUTPUT_BYTES)
        except producer_bundle.Refused as refusal:
            raise _Rejected(refusal.code, refusal.detail) from None
        version_id, sha256 = self._identity(course_id, item)
        if sha256 is None:
            raise _Rejected("source_unavailable", f"{item['source_id']!r} is listed but cannot be read now ({item['state']}).")
        if (source["version_id"], source["sha256"]) != (version_id, sha256):
            raise _Rejected("changed_input", f"The bundle was made from version {source['version_id']!r} of this recording; the app's current version is {version_id!r}. A stale result is not imported.")
        disk_sha256 = self._disk_sha256(course_id, item)
        if disk_sha256 != sha256:
            raise _Rejected("changed_input", "The file on disk is not the version the course index names for this recording; timing is bound to the actual bytes, so the bundle is not imported.")
        generation, window = parts["generation"], parts["window"]
        duration = self._duration_ms(course_id, item, {"recording": {"duration_ms": parts["declared_duration_ms"]}})
        whole = None if duration is None else window["start_ms"] <= TIME_TOLERANCE_MS and window["end_ms"] >= duration - TIME_TOLERANCE_MS
        provenance = {**parts["provenance"], "bound_to": {"version_id": version_id, "sha256": sha256, "disk_sha256": disk_sha256, "bytes": item["bytes"], "duration_ms": duration},
                      "covers_whole_recording": whole}
        kept = {f"{producer_bundle.KEPT_PREFIX}{MANIFEST_NAME}": (data, "application/json"),
                **{f"{producer_bundle.KEPT_PREFIX}{entry['path']}": (files[entry["path"]], entry["media_type"]) for entry in declared}}
        # The same bundle offered again must give the same bytes: an already stored generation keeps its creation time.
        created_at = self.stored_created_at(course_id, source["source_id"], generation) or self._now()
        return assemble_generation(course_id=course_id, source_id=source["source_id"], generation=generation, created_at=created_at, recording_sha256=sha256, recording_bytes=item["bytes"],
                                   declared_duration_ms=parts["declared_duration_ms"], producer=parts["producer"], window=window, clip_offset_ms=parts["clip_offset_ms"],
                                   segments=parts["segments"], provenance=provenance, extra_files=kept)

    def stored_created_at(self, course_id: str, source_id: str, generation: str) -> str | None:
        """The creation time a stored generation carries, or None when there is no such generation."""
        try:
            stored = c.parse_json((_plain_path(self.store_dir(course_id), f"{source_id}/{generation}") / MANIFEST_NAME).read_bytes(), max_bytes=c.MAX_MANIFEST_BYTES)
        except (OSError, c.ContractError, _Rejected):
            return None
        return stored.get("created_at") if isinstance(stored, dict) and isinstance(stored.get("created_at"), str) else None

    def _admit(self, course_id: str, manifest: dict, manifest_bytes: bytes, facts: dict[str, Any], *, root: Path | None = None, outputs: dict[str, bytes] | None = None) -> dict[str, Any]:
        """Everything a generation must satisfy before it is stored, whether its outputs are files in a selected root
        or bytes assembled in memory by the adapter or the runner."""
        if manifest["consumer_version"] != CONSUMER_VERSION:
            raise _Rejected("unsupported_consumer_version", f"Written for {manifest['consumer_version']!r}; this consumer is {CONSUMER_VERSION!r}.")
        if manifest["course_id"] != course_id:
            raise _Rejected("course_mismatch", f"The manifest is for course {manifest['course_id']!r}, not {course_id!r}.")
        if manifest["input_fingerprint"] != fingerprint_of(manifest):
            raise _Rejected("fingerprint_mismatch", "input_fingerprint is not the digest of the recording, window, clip offset, producer and consumer version stated in the manifest.")
        window, offset = manifest["window"], manifest["clip_offset_ms"]
        if window["end_ms"] <= window["start_ms"]:
            raise _Rejected("time_out_of_bounds", "The processed window is empty or reversed.")
        if offset > window["start_ms"]:
            raise _Rejected("time_base_mismatch", "clip_offset_ms is after the start of the window the clip is said to cover.")
        source_id = manifest["recording"]["source_id"]
        item = self._recording(course_id, source_id)
        if item is None:
            raise _Rejected("unknown_source", f"{source_id!r} is not a source this app currently lists for {course_id}.")
        self._check_identity(course_id, item, manifest)
        self._check_duration(course_id, item, manifest)
        outputs = self._read_outputs(root, manifest["outputs"], manifest["segments_path"], given=outputs)
        self._check_segments(manifest, outputs[manifest["segments_path"]])
        self._check_provenance(manifest, outputs)
        facts.update(files=len(outputs), bytes=sum(len(data) for data in outputs.values()))
        return self._store(course_id, manifest, manifest_bytes, outputs)

    def _check_provenance(self, manifest: dict, outputs: dict[str, bytes]) -> None:
        """A generation that carries this app's own provenance document must state what the reader relies on in a
        form it can read: unresolved intervals inside the window, and — for the speech runner — a served merge policy.
        A ``provenance.json`` of another producer in another format is that producer's file and is not judged here."""
        if not any(o["path"] == PROVENANCE_NAME and o["media_type"] == "application/json" for o in manifest["outputs"]):
            return
        try:
            document = c.parse_json(outputs[PROVENANCE_NAME], max_bytes=MAX_OUTPUT_BYTES)
        except c.ContractError:
            return
        if not isinstance(document, dict) or document.get("document") != PROVENANCE_DOCUMENT:
            return
        problem = policy_problem(document)
        if problem:
            raise _Rejected("unserved_merge_policy", problem)
        try:
            stated_unresolved(document, manifest["window"])
        except ValueError as exc:
            raise _Rejected("provenance_invalid", f"{PROVENANCE_NAME}: {exc}. Withheld time must be stated exactly or the generation is not stored.") from None

    def _store(self, course_id: str, manifest: dict, manifest_bytes: bytes, outputs: dict[str, bytes]) -> dict[str, Any]:
        """Outputs first, read back, manifest last. A generation that has its manifest is never written again."""
        destination = _plain_path(self.store_dir(course_id), f"{manifest['recording']['source_id']}/{manifest['generation']}")  # the ids become folder names
        stored_manifest = destination / MANIFEST_NAME
        if stored_manifest.is_file():
            if stored_manifest.read_bytes() != manifest_bytes:
                raise _Rejected("generation_conflict", f"Generation {manifest['generation']!r} is already stored with different bytes; a stored generation is never replaced. Use a new generation id.")
            problem = _verify_outputs(destination, manifest)
            if problem:
                raise _Rejected("stored_generation_damaged", f"{problem} The stored generation is not served and is not repaired automatically.")
            return {"status": "reused", "reused": True, "reason": None, "detail": "No change: this generation is already stored with identical bytes."}
        try:
            if destination.exists():
                shutil.rmtree(destination)  # leftovers of an import that never got its manifest: invisible to readers, replaced now
            for relative, data in outputs.items():
                self._checkpoint()
                replace_atomic(_plain_path(destination, relative), data)
            problem = _verify_outputs(destination, manifest)
            if problem:
                raise _Rejected("store_verify_failed", f"{problem} No manifest was written, so this generation does not exist for readers.")
            self._checkpoint()
            publish_exclusive(stored_manifest, manifest_bytes)  # manifest last; read back by the primitive
        except ExclusiveConflict:
            raise _Rejected("generation_conflict", f"Generation {manifest['generation']!r} was stored with different bytes meanwhile.") from None
        except OSError as exc:
            raise _Rejected("store_write_failed", f"The derived store could not be written: {exc}") from None
        return {"status": "imported", "reused": False, "reason": None, "detail": None}

    def _duration_ms(self, course_id: str, item: dict, manifest: dict) -> int | None:
        """Length of the recording: what this app reads from the file itself when it can, else what the producer declared."""
        measured = media_duration_ms(self._settings.course(course_id).root / item["path"]) if item.get("path") else None
        return measured or manifest["recording"]["duration_ms"]

    def _check_duration(self, course_id: str, item: dict, manifest: dict) -> None:
        declared = manifest["recording"]["duration_ms"]
        duration = self._duration_ms(course_id, item, manifest)
        if declared is not None and duration is not None and abs(declared - duration) > DURATION_TOLERANCE_MS:
            raise _Rejected("duration_mismatch", f"The manifest says the recording is {declared} ms; the file is {duration} ms.")
        if duration is not None and manifest["window"]["end_ms"] > duration + TIME_TOLERANCE_MS:
            raise _Rejected("window_exceeds_duration", f"The window ends at {manifest['window']['end_ms']} ms; the recording is {duration} ms long.")

    def _check_segments(self, manifest: dict, data: bytes) -> dict:
        """The generated text: valid, belonging to this manifest, in clip time, inside the processed window."""
        try:
            document = c.parse_json(data, max_bytes=MAX_OUTPUT_BYTES)
        except c.ContractError as exc:
            raise _Rejected("segments_invalid", str(exc)) from None
        errors = c.validate("derived-segments", document)
        if errors:
            raise _Rejected("segments_invalid", "; ".join(errors[:5]))
        if (document["course_id"], document["source_id"], document["generation"]) != (manifest["course_id"], manifest["recording"]["source_id"], manifest["generation"]):
            raise _Rejected("segments_mismatch", "The segments file names another course, recording or generation than its manifest.")
        offset = manifest["clip_offset_ms"]
        if document["clip_offset_ms"] != offset:
            raise _Rejected("time_base_mismatch", "The segments file and the manifest state different clip offsets.")
        segments = document["segments"]
        if len(segments) > MAX_SEGMENTS:
            raise _Rejected("too_many_segments", f"{len(segments)} segments; the cap is {MAX_SEGMENTS}.")
        if sum(len(segment.get("words", ())) for segment in segments) > MAX_WORDS:
            raise _Rejected("too_many_words", f"More than {MAX_WORDS} word timings.")
        low, high = manifest["window"]["start_ms"] - TIME_TOLERANCE_MS, manifest["window"]["end_ms"] + TIME_TOLERANCE_MS

        def check(node: dict, what: str, *, may_be_empty: bool) -> None:
            start, end = to_recording_ms(node["clip_start_ms"], offset), to_recording_ms(node["clip_end_ms"], offset)
            if end < start or (end == start and not may_be_empty):
                raise _Rejected("time_out_of_bounds", f"{what}: start is not before end.")
            if start < low or end > high:
                raise _Rejected("time_out_of_bounds", f"{what}: {start}-{end} ms in the recording is outside the processed window.")
            if "start_ms" in node and (node["start_ms"], node["end_ms"]) != (start, end):
                raise _Rejected("absolute_time_mismatch", f"{what}: the stated recording time is not clip time plus the clip offset.")

        last_index, last_start = -1, -1
        for segment in segments:
            if segment["index"] <= last_index or segment["clip_start_ms"] < last_start:
                raise _Rejected("segments_out_of_order", "Segments must be in increasing index and non-decreasing start order.")
            last_index, last_start = segment["index"], segment["clip_start_ms"]
            check(segment, f"segment {segment['index']}", may_be_empty=False)
            for word in segment.get("words", ()):
                check(word, f"a word of segment {segment['index']}", may_be_empty=True)  # speech tools do emit zero-length words
        return document

    def _read_outputs(self, root: Path | None, declared: list[dict], json_path: str | None, *, given: dict[str, bytes] | None = None) -> dict[str, bytes]:
        """Every declared output, read once and checked against its declared size and digest. The bytes verified here
        are the bytes that get stored: nothing is read from the root a second time. ``given`` holds the bytes of a
        generation assembled in memory instead of a root; they are held to the same declarations."""
        if sum(entry["bytes"] for entry in declared) > MAX_TOTAL_BYTES or any(entry["bytes"] > MAX_OUTPUT_BYTES for entry in declared):
            raise _Rejected("output_too_large", f"Outputs exceed the cap ({MAX_OUTPUT_BYTES} bytes per file, {MAX_TOTAL_BYTES} in total).")
        for entry in declared:
            expected = "application/json" if entry["path"] == json_path else None
            if entry["media_type"] not in ALLOWED_MEDIA_TYPES or (expected and entry["media_type"] != expected):
                raise _Rejected("unsupported_media_type", f"{entry['path']!r} is declared as {entry['media_type']!r}; only timed-text and plain-text outputs are kept.")
        if given is not None and set(given) != {entry["path"] for entry in declared}:
            raise _Rejected("output_missing", "The assembled outputs are not exactly the outputs the manifest lists.")
        outputs: dict[str, bytes] = {}
        for entry in declared:
            if given is not None:
                data = given[entry["path"]]
            else:
                path = _plain_path(root, entry["path"])
                try:
                    if not path.is_file():
                        raise _Rejected("output_missing", f"{entry['path']!r} is listed in the manifest but is not a file in the output root.")
                    if path.stat().st_size != entry["bytes"]:
                        raise _Rejected("output_size_mismatch", f"{entry['path']!r} is {path.stat().st_size} bytes; the manifest declares {entry['bytes']}.")
                    data = path.read_bytes()
                except OSError as exc:
                    raise _Rejected("output_missing", f"{entry['path']!r} could not be read: {exc}") from None
            if len(data) != entry["bytes"]:
                raise _Rejected("output_size_mismatch", f"{entry['path']!r} is {len(data)} bytes when read; the manifest declares {entry['bytes']}.")
            if c.sha256_hex(data) != entry["sha256"]:
                raise _Rejected("output_digest_mismatch", f"{entry['path']!r} does not have the declared sha256.")
            outputs[entry["path"]] = data
        return outputs

    def _receipt(self, result: dict) -> str:
        """One receipt per outcome in the app's existing journal (no job, no queue entry)."""
        if self._journal is not None:
            return self._write_receipt(self._journal, result)
        # No journal was handed in (a direct library call): use the app's one journal for this single write.
        journal = Journal.open(self._settings.journal_path, synced_roots=[] if self._settings.profile == "fixture" else self._owned_roots())
        try:
            return self._write_receipt(journal, result)
        finally:
            journal.close()

    def _write_receipt(self, journal: Journal, result: dict) -> str:
        ref = f"derived/{result['source_id']}/{result['generation']}" if result["generation"] else None
        return journal.add_receipt(kind=RECEIPT_KIND, job_id=None, ref=ref, sha256=result["manifest_sha256"],
                                         payload={"outcome": _OUTCOME[result["status"]], "reason": result["reason"], "detail": result["detail"], "course_id": result["course_id"],
                                                  "source_id": result["source_id"], "generation": result["generation"], "input_fingerprint": result["input_fingerprint"],
                                                  "files": result["files"], "bytes": result["bytes"], "root": result["root"], "at": self._now(),
                                                  **{key: result[key] for key in ("adapter", "producer_contract", "job_key", "stored_manifest_sha256") if key in result}})

    # ---- read -----------------------------------------------------------------------------------------------------
    def _load_stored(self, directory: Path, source_id: str) -> dict[str, Any]:
        """One stored generation folder: its manifest, and whether it is still exactly what was imported."""
        entry: dict[str, Any] = {"generation": directory.name, "dir": directory, "manifest": None, "manifest_sha256": None, "problem": None, "detail": None}
        path = directory / MANIFEST_NAME
        if _is_link(directory) or not path.is_file():
            return dict(entry, problem="incomplete", detail="No manifest: an import that did not finish. It is replaced by the next import of this generation.")
        try:
            data = path.read_bytes() if path.stat().st_size <= c.MAX_MANIFEST_BYTES else b""
            manifest = c.parse_json(data, max_bytes=c.MAX_MANIFEST_BYTES)
            errors = c.validate("derived-manifest", manifest)
        except (OSError, c.ContractError) as exc:
            return dict(entry, problem="invalid", detail=f"The stored manifest cannot be read: {exc}"[:300])
        if errors or manifest["generation"] != directory.name or manifest["recording"]["source_id"] != source_id or manifest["consumer_version"] != CONSUMER_VERSION:
            return dict(entry, problem="invalid", detail="The stored manifest is not a manifest of this generation for this consumer version.")
        entry.update(manifest=manifest, manifest_sha256=c.sha256_hex(data))
        problem = _verify_outputs(directory, manifest)
        if problem:
            return dict(entry, problem="invalid", detail=problem)
        entry["provenance"] = self._provenance(entry)
        try:
            entry["unresolved"] = stated_unresolved(entry["provenance"], manifest["window"])
        except ValueError as exc:
            return dict(entry, problem="invalid", detail=f"The stored provenance states unresolved intervals that cannot be read ({exc}); the generation is not served.")
        entry["resolved_ms"] = manifest["window"]["end_ms"] - manifest["window"]["start_ms"] - sum(i["end_ms"] - i["start_ms"] for i in entry["unresolved"])
        return entry

    def _provenance(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        """Where a stored generation came from, when it was assembled by this app (adapter or runner) and says so in
        its ``provenance.json`` output. The file's bytes were verified against the manifest when the entry was loaded."""
        manifest = entry["manifest"]
        if manifest is None or not any(o["path"] == PROVENANCE_NAME and o["media_type"] == "application/json" for o in manifest["outputs"]):
            return None
        try:
            document = c.parse_json((entry["dir"] / PROVENANCE_NAME).read_bytes(), max_bytes=MAX_OUTPUT_BYTES)
        except (OSError, c.ContractError):
            return None
        return document if isinstance(document, dict) and document.get("document") == PROVENANCE_DOCUMENT else None

    def _generations(self, course_id: str, source_id: str, sha256: str | None, size: int | None) -> list[dict[str, Any]]:
        """Stored generations of one recording, newest first, each with its state:
        ``current`` (of those that verify, were made from the recording's current bytes and may be served: the one
        that resolves the most of the recording, the newest among equals), ``superseded`` (as valid, but resolving
        less or older), ``unserved_policy`` (a speech-runner generation from before text failing the repetition check
        was withheld: kept, never served), ``stale`` (made from other bytes: kept, never served), ``invalid`` or
        ``incomplete``."""
        directory = self.store_dir(course_id) / source_id
        entries = [self._load_stored(p, source_id) for p in sorted(directory.iterdir()) if p.is_dir()] if directory.is_dir() and not _is_link(directory) else []
        usable = sorted((e for e in entries if e["problem"] is None), key=lambda e: _when(e["manifest"]), reverse=True)
        servable = []
        for entry in usable:
            recording = entry["manifest"]["recording"]
            unserved = policy_problem(entry["provenance"])
            if sha256 is None or recording["sha256"] != sha256 or recording["bytes"] != size:
                entry["state"] = "stale"
            elif unserved:
                entry.update(state="unserved_policy", detail=unserved)
            else:
                entry["state"] = "superseded"
                servable.append(entry)
        if servable:
            max(servable, key=lambda e: (e["resolved_ms"], _when(e["manifest"])))["state"] = "current"
        return usable + [dict(e, state=e["problem"]) for e in entries if e["problem"] is not None]

    def newest_created_at(self, course_id: str, source_id: str) -> str | None:
        """The latest creation time among the stored generations of one recording that have a readable manifest, or
        None. A publisher that wants its next generation to be the newest stamps it later than this."""
        directory = self.store_dir(course_id) / source_id
        if not directory.is_dir() or _is_link(directory):
            return None
        times = [stamp for stamp in (self.stored_created_at(course_id, source_id, p.name) for p in directory.iterdir() if p.is_dir()) if stamp]
        try:
            return max(times, key=lambda stamp: datetime.fromisoformat(stamp.replace("Z", "+00:00"))) if times else None
        except ValueError:
            return None

    def _identity(self, course_id: str, item: dict) -> tuple[str | None, str | None]:
        return self._preparation.identity_of(course_id, item) if item["state"] in _READABLE else (None, None)

    def _coverage(self, manifest: dict, duration: int | None, unresolved: list[dict] | None = None) -> dict[str, Any]:
        """How much of the recording a generation covers. Unknown length means unknown coverage, never "all of it".

        ``window`` is what was PROCESSED. What is COVERED is the window minus the intervals whose text was withheld:
        ``coverage_fraction`` counts that resolved time only (``processed_fraction`` is the window), and a recording
        is never called whole while any of it is unresolved."""
        window = manifest["window"]
        unresolved = list(unresolved or [])
        processed = window["end_ms"] - window["start_ms"]
        unresolved_ms = sum(interval["end_ms"] - interval["start_ms"] for interval in unresolved)
        whole = None if duration is None else window["start_ms"] <= TIME_TOLERANCE_MS and window["end_ms"] >= duration - TIME_TOLERANCE_MS
        return {"window": dict(window), "duration_ms": duration, "coverage_fraction": None if not duration else min(1.0, (processed - unresolved_ms) / duration),
                "processed_fraction": None if not duration else min(1.0, processed / duration),
                "covers_whole_recording": False if unresolved else whole,
                "covered_intervals": covered_intervals(window, unresolved), "unresolved_intervals": unresolved, "unresolved_seconds": unresolved_ms / 1000}

    def current(self, course_id: str, source_id: str) -> dict[str, Any] | None:
        """The stored generation made from the recording's CURRENT bytes that resolves the most of it (the newest
        among equals), with times in the recording, what it covers and what it leaves unresolved.

        None when there is none to serve: nothing imported, only generations for older bytes (kept on disk, reported
        by :meth:`status` as ``stale``) or from before text was withheld (``unserved_policy``), or the recording is
        not listed or readable now."""
        item = self._recording(course_id, source_id)
        if item is None or item["rendition"] != "native_media":
            return None
        version_id, sha256 = self._identity(course_id, item)
        chosen = next((g for g in self._generations(course_id, source_id, sha256, item["bytes"]) if g["state"] == "current"), None)
        if chosen is None:
            return None
        if self._disk_sha256(course_id, item) != sha256:
            return None  # the file on disk is not the version the course index names: timing made for the named bytes is not served over other audio
        manifest = chosen["manifest"]
        document = c.parse_json((chosen["dir"] / manifest["segments_path"]).read_bytes(), max_bytes=MAX_OUTPUT_BYTES)  # bytes verified against the manifest just above
        offset = manifest["clip_offset_ms"]

        def span(node: dict) -> dict[str, Any]:
            return {"start_ms": to_recording_ms(node["clip_start_ms"], offset), "end_ms": to_recording_ms(node["clip_end_ms"], offset), "text": node["text"]}

        segments = []
        for segment in document["segments"]:
            row = {"index": segment["index"], **span(segment)}
            if "words" in segment:
                row["words"] = [dict(span(word), **({"probability": word["probability"]} if "probability" in word else {})) for word in segment["words"]]
            segments.append(row)
        return {"course_id": course_id, "source_id": source_id, "generation": manifest["generation"], "state": "current", "created_at": manifest["created_at"],
                "manifest_sha256": chosen["manifest_sha256"], "input_fingerprint": manifest["input_fingerprint"], "consumer_version": manifest["consumer_version"],
                "producer": dict(manifest["producer"]), "recording": {"source_id": source_id, "version_id": version_id, "sha256": sha256, "bytes": item["bytes"]},
                "time_base": "recording_absolute", "clip_offset_ms": offset, **self._coverage(manifest, self._duration_ms(course_id, item, manifest), chosen["unresolved"]),
                "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [], "segments": segments,
                "provenance": chosen["provenance"],
                "note": "Generated speech text with generated times. It is not the course transcript, has not been reviewed and says nothing about which slide was shown. "
                        "The window is what was processed; unresolved intervals inside it are time whose text was withheld: neither speech nor silence is known there."}

    def _generation_rows(self, course_id: str, source_id: str, sha256: str | None, size: int | None, duration: int | None) -> list[dict[str, Any]]:
        rows = []
        for entry in self._generations(course_id, source_id, sha256, size):
            row: dict[str, Any] = {"generation": entry["generation"], "state": entry["state"], "detail": entry["detail"]}
            if entry["manifest"] is not None:
                manifest = entry["manifest"]
                row.update(created_at=manifest["created_at"], manifest_sha256=entry["manifest_sha256"], input_fingerprint=manifest["input_fingerprint"],
                           recording_sha256=manifest["recording"]["sha256"], producer=dict(manifest["producer"]), consumer_version=manifest["consumer_version"],
                           **self._coverage(manifest, duration or manifest["recording"]["duration_ms"], entry.get("unresolved")))
                if entry["problem"] is None:
                    provenance = entry["provenance"]
                    row["provenance"] = None if provenance is None else {key: provenance.get(key) for key in _PROVENANCE_SUMMARY}
            rows.append(row)
        return rows

    def status(self, course_id: str) -> dict[str, Any]:
        """Readback for a person or a runner: every recording the app lists with its current identity and stored
        generations, plus stored generations whose recording is no longer listed (kept, never served)."""
        recordings = []
        for item in self._sources(course_id):
            if item["rendition"] != "native_media":
                continue
            version_id, sha256 = self._identity(course_id, item)
            duration = media_duration_ms(self._settings.course(course_id).root / item["path"]) if item.get("path") else None
            generations = self._generation_rows(course_id, item["source_id"], sha256, item["bytes"], duration)
            bytes_on_disk = "not_checked"  # hashed only where a generation would otherwise be served
            if any(g["state"] in {"current", "superseded"} for g in generations):
                bytes_on_disk = "match" if self._disk_sha256(course_id, item) == sha256 else "differ"
                if bytes_on_disk == "differ":  # the index names other bytes than the file holds: nothing made for the named bytes is current
                    generations = self._generation_rows(course_id, item["source_id"], None, None, duration)
            served = next((g for g in generations if g["state"] == "current"), None)
            recordings.append({"source_id": item["source_id"], "filename": item["filename"], "path": item["path"], "registration": item["registration"], "availability": item["state"],
                               "version_id": version_id, "sha256": sha256, "bytes": item["bytes"], "bytes_on_disk": bytes_on_disk, "duration_ms": duration,
                               "current_generation": served["generation"] if served else None,
                               "coverage_fraction": served["coverage_fraction"] if served else None, "processed_fraction": served["processed_fraction"] if served else None,
                               "covers_whole_recording": served["covers_whole_recording"] if served else None,
                               "covered_intervals": served["covered_intervals"] if served else [], "unresolved_intervals": served["unresolved_intervals"] if served else [],
                               "unresolved_seconds": served["unresolved_seconds"] if served else 0.0,
                               "generations": generations})
        listed = {r["source_id"] for r in recordings}
        store = self.store_dir(course_id)
        unlisted = [{"source_id": directory.name, "generations": self._generation_rows(course_id, directory.name, None, None, None)}
                    for directory in (sorted(store.iterdir()) if store.is_dir() else []) if directory.is_dir() and directory.name not in listed]
        states = [g["state"] for group in (recordings, unlisted) for r in group for g in r["generations"]]
        return {"course_id": course_id, "consumer_version": CONSUMER_VERSION, "manifest_contract": "ll.derived-manifest/1", "recordings": recordings, "unlisted": unlisted,
                "totals": {"recordings": len(recordings), "with_current_generation": sum(1 for r in recordings if r["current_generation"]),
                           "whole_recording_covered": sum(1 for r in recordings if r["covers_whole_recording"]),
                           "with_unresolved_time": sum(1 for r in recordings if r["unresolved_seconds"] > 0),
                           "generations": {state: states.count(state) for state in GENERATION_STATES}},
                "note": "Generated timing only. A generation is unreviewed generated text for the stated window of one recording; it is not reviewed timing and not a slide match. "
                        "Coverage counts resolved time only: unresolved intervals were processed but their text was withheld, and a recording with any is not covered whole."}
