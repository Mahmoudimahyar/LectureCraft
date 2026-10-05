"""Consumer of generated speech timing for recordings (remediation R1-E).

Some other process — the owner's, with its own speech tool — produces timed text for ONE recording and leaves it in
an output root: output files first, ``manifest.json`` last. This module never runs speech recognition, never starts
that process, never installs anything and never executes or follows anything found in an output root. It only:

* checks an explicitly selected output root against the ``ll.derived-manifest/1`` and ``ll.derived-segments/1``
  contracts, the declared bytes and the app's CURRENT identity of the recording;
* copies it into the app-local derived store (``<app area>/derived/<source_id>/<generation>/``), outputs first and
  the manifest last, and never changes a stored generation afterwards;
* reads the newest stored generation that still matches the recording's current bytes.

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

CONSUMER_VERSION = "derived-consumer-1"
MANIFEST_NAME = "manifest.json"
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

    def _read_manifest(self, root: Path, facts: dict[str, Any]) -> tuple[dict, bytes]:
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
            manifest = c.parse_json(data, max_bytes=c.MAX_MANIFEST_BYTES)
        except c.ContractError as exc:
            raise _Rejected("manifest_unreadable", str(exc)) from None
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
        return manifest, data

    def _import(self, root: Path, course_id: str, facts: dict[str, Any]) -> dict[str, Any]:
        if course_id not in self._settings.courses:
            raise _Rejected("unknown_course", f"Course {course_id!r} is not one of the configured courses.")
        self._checkpoint()
        manifest, manifest_bytes = self._read_manifest(root, facts)
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
        item = self._recording(course_id, facts["source_id"])
        if item is None:
            raise _Rejected("unknown_source", f"{facts['source_id']!r} is not a source this app currently lists for {course_id}.")
        self._check_identity(course_id, item, manifest)
        self._check_duration(course_id, item, manifest)
        outputs = self._read_outputs(root, manifest)
        self._check_segments(manifest, outputs[manifest["segments_path"]])
        facts.update(files=len(outputs), bytes=sum(len(data) for data in outputs.values()))
        return self._store(course_id, manifest, manifest_bytes, outputs)

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

    def _read_outputs(self, root: Path, manifest: dict) -> dict[str, bytes]:
        """Every declared output, read once and checked against its declared size and digest. The bytes verified here
        are the bytes that get stored: nothing is read from the root a second time."""
        if sum(entry["bytes"] for entry in manifest["outputs"]) > MAX_TOTAL_BYTES or any(entry["bytes"] > MAX_OUTPUT_BYTES for entry in manifest["outputs"]):
            raise _Rejected("output_too_large", f"Outputs exceed the cap ({MAX_OUTPUT_BYTES} bytes per file, {MAX_TOTAL_BYTES} in total).")
        for entry in manifest["outputs"]:
            expected = "application/json" if entry["path"] == manifest["segments_path"] else None
            if entry["media_type"] not in ALLOWED_MEDIA_TYPES or (expected and entry["media_type"] != expected):
                raise _Rejected("unsupported_media_type", f"{entry['path']!r} is declared as {entry['media_type']!r}; only timed-text and plain-text outputs are kept.")
        outputs: dict[str, bytes] = {}
        for entry in manifest["outputs"]:
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
                raise _Rejected("output_size_mismatch", f"{entry['path']!r} changed size while it was read.")
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
                                                  "files": result["files"], "bytes": result["bytes"], "root": result["root"], "at": self._now()})

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
        return dict(entry, problem="invalid", detail=problem) if problem else entry

    def _generations(self, course_id: str, source_id: str, sha256: str | None, size: int | None) -> list[dict[str, Any]]:
        """Stored generations of one recording, newest first, each with its state:
        ``current`` (the newest that verifies and was made from the recording's current bytes), ``superseded`` (as valid,
        but older), ``stale`` (made from other bytes: kept, never served), ``invalid`` or ``incomplete``."""
        directory = self.store_dir(course_id) / source_id
        entries = [self._load_stored(p, source_id) for p in sorted(directory.iterdir()) if p.is_dir()] if directory.is_dir() and not _is_link(directory) else []
        usable = sorted((e for e in entries if e["problem"] is None), key=lambda e: _when(e["manifest"]), reverse=True)
        served = False
        for entry in usable:
            recording = entry["manifest"]["recording"]
            if sha256 is None or recording["sha256"] != sha256 or recording["bytes"] != size:
                entry["state"] = "stale"
            else:
                entry["state"], served = ("superseded" if served else "current"), True
        return usable + [dict(e, state=e["problem"]) for e in entries if e["problem"] is not None]

    def _identity(self, course_id: str, item: dict) -> tuple[str | None, str | None]:
        return self._preparation.identity_of(course_id, item) if item["state"] in _READABLE else (None, None)

    def _coverage(self, manifest: dict, duration: int | None) -> dict[str, Any]:
        """How much of the recording a generation covers. Unknown length means unknown coverage, never "all of it"."""
        window = manifest["window"]
        whole = None if duration is None else window["start_ms"] <= TIME_TOLERANCE_MS and window["end_ms"] >= duration - TIME_TOLERANCE_MS
        return {"window": dict(window), "duration_ms": duration, "coverage_fraction": None if not duration else min(1.0, (window["end_ms"] - window["start_ms"]) / duration),
                "covers_whole_recording": whole}

    def current(self, course_id: str, source_id: str) -> dict[str, Any] | None:
        """The newest stored generation made from the recording's CURRENT bytes, with times in the recording.

        None when there is none to serve: nothing imported, only generations for older bytes (kept on disk, reported
        by :meth:`status` as ``stale``), or the recording is not listed or readable now."""
        item = self._recording(course_id, source_id)
        if item is None or item["rendition"] != "native_media":
            return None
        version_id, sha256 = self._identity(course_id, item)
        chosen = next((g for g in self._generations(course_id, source_id, sha256, item["bytes"]) if g["state"] == "current"), None)
        if chosen is None:
            return None
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
                "time_base": "recording_absolute", "clip_offset_ms": offset, **self._coverage(manifest, self._duration_ms(course_id, item, manifest)),
                "text_origin": "generated_speech_text", "review_state": "generated_unreviewed", "establishes": [], "segments": segments,
                "note": "Generated speech text with generated times. It is not the course transcript, has not been reviewed and says nothing about which slide was shown."}

    def _generation_rows(self, course_id: str, source_id: str, sha256: str | None, size: int | None, duration: int | None) -> list[dict[str, Any]]:
        rows = []
        for entry in self._generations(course_id, source_id, sha256, size):
            row: dict[str, Any] = {"generation": entry["generation"], "state": entry["state"], "detail": entry["detail"]}
            if entry["manifest"] is not None:
                manifest = entry["manifest"]
                row.update(created_at=manifest["created_at"], manifest_sha256=entry["manifest_sha256"], input_fingerprint=manifest["input_fingerprint"],
                           recording_sha256=manifest["recording"]["sha256"], producer=dict(manifest["producer"]), consumer_version=manifest["consumer_version"],
                           **self._coverage(manifest, duration or manifest["recording"]["duration_ms"]))
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
            served = next((g for g in generations if g["state"] == "current"), None)
            recordings.append({"source_id": item["source_id"], "filename": item["filename"], "path": item["path"], "registration": item["registration"], "availability": item["state"],
                               "version_id": version_id, "sha256": sha256, "bytes": item["bytes"], "duration_ms": duration, "current_generation": served["generation"] if served else None,
                               "coverage_fraction": served["coverage_fraction"] if served else None, "covers_whole_recording": served["covers_whole_recording"] if served else None,
                               "generations": generations})
        listed = {r["source_id"] for r in recordings}
        store = self.store_dir(course_id)
        unlisted = [{"source_id": directory.name, "generations": self._generation_rows(course_id, directory.name, None, None, None)}
                    for directory in (sorted(store.iterdir()) if store.is_dir() else []) if directory.is_dir() and directory.name not in listed]
        states = [g["state"] for group in (recordings, unlisted) for r in group for g in r["generations"]]
        return {"course_id": course_id, "consumer_version": CONSUMER_VERSION, "manifest_contract": "ll.derived-manifest/1", "recordings": recordings, "unlisted": unlisted,
                "totals": {"recordings": len(recordings), "with_current_generation": sum(1 for r in recordings if r["current_generation"]),
                           "whole_recording_covered": sum(1 for r in recordings if r["covers_whole_recording"]),
                           "generations": {state: states.count(state) for state in ("current", "superseded", "stale", "invalid", "incomplete")}},
                "note": "Generated timing only. A generation is unreviewed generated text for the stated window of one recording; it is not reviewed timing and not a slide match."}
