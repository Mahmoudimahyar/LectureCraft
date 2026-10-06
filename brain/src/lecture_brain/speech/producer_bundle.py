"""Adapter for the offline timing producer's bundle (``private-timing-output-manifest-v1``).

The producer leaves five files in a bundle folder: ``timing.json`` (segments and words in clip-local seconds),
``provenance.json``, ``QA_SAMPLE.json``, ``derived.vtt`` and, written last, ``manifest.json`` with the size and
SHA-256 of the other four. That is not this app's ``ll.derived-manifest/1``, and the producer is not changed to fit:
this module reads the bundle's documents (already verified byte for byte by the importer) and returns the parts of
one generation in the app's own contract. It opens no file, runs nothing and never writes into a bundle.

What is checked here: the three job keys agree; the manifest and the timing file name the same source; the status is
the producer's "generated, unreviewed" and nothing claims a slide link; times are clip-local seconds inside
``[0, actual_duration]`` (plus the importer's stated tolerance), segments have ``start < end``, words ``start <= end``
(speech tools do emit zero-length words; they are kept and counted); the counts equal ``word_count`` and
``segment_count``; and wherever the producer itself states a recording time (its QA sample, its decoded range) that
statement equals clip offset + clip time, so an offset that was already applied by the producer is caught rather than
applied a second time. Because already-shifted times can still lie inside the clip, a clip that does not start at
zero and has words must carry at least one such statement (a QA sample); otherwise it is refused
(``offset_unverified``). Identity against the recording on disk is the importer's part.
"""
from __future__ import annotations

import math
from pathlib import PurePosixPath
import re
from typing import Any

from .. import contracts as c

MANIFEST_CONTRACT = "private-timing-output-manifest-v1"
TIMING_CONTRACT = "private-derived-acoustic-timing-v1"
PROVENANCE_CONTRACT = "private-timing-provenance-v1"
QA_CONTRACT = "private-timing-qa-candidates-v1"
ADAPTER_VERSION = "producer-bundle-adapter-1"
TIMING_PATH, PROVENANCE_PATH, QA_PATH = "timing.json", "provenance.json", "QA_SAMPLE.json"
KEPT_PREFIX = "producer/"  # the producer's own files are kept byte for byte under this folder of the stored generation
MAX_DECLARED_OUTPUTS = 24
GENERATED_UNREVIEWED = "GENERATED_UNREVIEWED"
_HEX64 = re.compile(r"^[a-f0-9]{64}$")
_MEDIA_TYPES = {".json": "application/json", ".vtt": "text/vtt", ".txt": "text/plain", ".md": "text/plain"}
_SECONDS_EPSILON = 1e-6


class Refused(Exception):
    """A bundle that is not adapted. ``code`` is the stable reason the importer records in its receipt."""

    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def is_bundle_manifest(manifest: Any) -> bool:
    return isinstance(manifest, dict) and manifest.get("contract") == MANIFEST_CONTRACT


def generation_id(job_key: str) -> str:
    """Short and derived from the job key: the same bundle is the same generation, and the folder name stays far from MAX_PATH."""
    return f"pb1-{job_key[:20]}"


def _need(condition: Any, code: str, detail: str) -> None:
    if not condition:
        raise Refused(code, detail)


def declared_outputs(manifest: dict) -> list[dict]:
    """The bundle's declared outputs as the importer's artifact entries (``path``, ``bytes``, ``sha256``, ``media_type``).
    Only the manifest is looked at: shape, portable relative paths, no duplicate, known text types, required files."""
    job_key, source, outputs = manifest.get("job_key"), manifest.get("source"), manifest.get("outputs")
    _need(isinstance(job_key, str) and _HEX64.match(job_key), "manifest_invalid", "job_key is not a SHA-256 hex digest.")
    _need(isinstance(source, dict) and all(isinstance(source.get(key), str) and source[key] for key in ("course_id", "source_id", "version_id", "sha256")) and _HEX64.match(source["sha256"]),
          "manifest_invalid", "source must name course_id, source_id, version_id and a sha256.")
    _need(isinstance(outputs, list) and 1 <= len(outputs) <= MAX_DECLARED_OUTPUTS and all(isinstance(entry, dict) for entry in outputs),
          "manifest_invalid", f"outputs must list between 1 and {MAX_DECLARED_OUTPUTS} files.")
    declared = []
    for entry in outputs:
        path = entry.get("path")
        if not c.safe_relative(path):
            raise Refused("unsafe_path", f"Not a plain relative path inside the bundle: {str(path)[:120]!r}")
        size, sha256 = entry.get("size_bytes"), entry.get("sha256")
        _need(type(size) is int and size >= 0 and isinstance(sha256, str) and _HEX64.match(sha256), "manifest_invalid", f"{path!r} must declare size_bytes and sha256.")
        declared.append({"path": path, "bytes": size, "sha256": sha256, "media_type": _MEDIA_TYPES.get(PurePosixPath(path).suffix.lower())})
    names = [entry["path"].casefold() for entry in declared]
    _need(len(set(names)) == len(names) and "manifest.json" not in names, "duplicate_output", "Outputs must be listed once and never under the name manifest.json.")
    for entry in declared:
        _need(entry["media_type"] is not None, "unsupported_media_type", f"{entry['path']!r} is not a timed-text or plain-text file; nothing else is kept.")
    missing = [name for name in (TIMING_PATH, PROVENANCE_PATH) if name not in {entry["path"] for entry in declared}]
    _need(not missing, "bundle_incomplete", f"The manifest does not declare {', '.join(missing)}; a bundle is never completed from undeclared files.")
    return declared


def _document(data: bytes, contract: str, code: str, name: str, max_bytes: int) -> dict:
    try:
        document = c.parse_json(data, max_bytes=max_bytes)
    except c.ContractError as exc:
        raise Refused(code, f"{name}: {exc}") from None
    _need(isinstance(document, dict) and document.get("contract") == contract, code, f"{name} is not a {contract} document.")
    return document


def _number(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Refused("timing_invalid", f"{what} is not a finite number.")
    return float(value)


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _plain(value: Any, depth: int = 0) -> Any:
    """A bounded copy of producer-stated facts: JSON scalars, short strings, small shallow containers. Data, never instructions."""
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:400]
    if depth >= 3:
        return None
    if isinstance(value, list):
        return [_plain(item, depth + 1) for item in value[:64]]
    if isinstance(value, dict):
        return {str(key)[:80]: _plain(item, depth + 1) for key, item in list(value.items())[:64]}
    return None


def _span(node: dict, what: str, duration_ms: int, tolerance_ms: int, *, may_be_empty: bool) -> tuple[int, int]:
    """Clip-local seconds of one segment or word as milliseconds, inside the clip."""
    start, end = _ms(_number(node.get("start_seconds"), f"{what} start")), _ms(_number(node.get("end_seconds"), f"{what} end"))
    if end < start or (end == start and not may_be_empty):
        raise Refused("time_out_of_bounds", f"{what}: start is not before end.")
    if start < 0 or end > duration_ms + tolerance_ms:
        raise Refused("time_out_of_bounds", f"{what}: {start}-{end} ms is outside the clip [0, {duration_ms}] ms (tolerance {tolerance_ms} ms). Times must be clip-local; the offset is added once, here.")
    return start, end


def adapt(manifest: dict, manifest_sha256: str, files: dict[str, bytes], *, tolerance_ms: int, max_document_bytes: int) -> dict[str, Any]:
    """The parts of one app generation from a verified bundle: generation id, window, clip offset, the producer's
    identity, the segments in the app's shape (clip-relative milliseconds plus the stated recording time) and the
    provenance to store with it. ``files`` are the declared outputs, already checked against their size and digest."""
    timing = _document(files[TIMING_PATH], TIMING_CONTRACT, "timing_invalid", TIMING_PATH, max_document_bytes)
    provenance = _document(files[PROVENANCE_PATH], PROVENANCE_CONTRACT, "provenance_invalid", PROVENANCE_PATH, max_document_bytes)
    job_key, source = manifest["job_key"], manifest["source"]
    for name, document in ((TIMING_PATH, timing), (PROVENANCE_PATH, provenance)):
        _need(document.get("job_key") == job_key, "job_key_mismatch", f"{name} names another job than the manifest; one bundle is one job.")
    _need(timing.get("source") == source, "source_mismatch", "timing.json names another source (course, id, version or sha256) than the manifest.")
    refs = provenance.get("source_refs")
    _need(not isinstance(refs, list) or not refs or source in refs, "source_mismatch", "provenance.json does not list the manifest's source among its source_refs.")
    statuses = manifest.get("producer_statuses") if isinstance(manifest.get("producer_statuses"), dict) else {}
    _need(timing.get("status") == GENERATED_UNREVIEWED and statuses.get("timing_generated", GENERATED_UNREVIEWED) == GENERATED_UNREVIEWED, "unsupported_status",
          f"Only timing the producer marks {GENERATED_UNREVIEWED} is imported; it becomes generated_unreviewed here.")
    _need(not timing.get("semantic_slide_links"), "unsupported_status", "The bundle claims slide links; generated speech timing establishes nothing about slides.")
    _need(isinstance(timing.get("time_coordinate"), str) and timing["time_coordinate"].startswith("clip_local_seconds"), "time_base_mismatch",
          "time_coordinate does not say clip_local_seconds; times in another base are not guessed at.")
    offset, duration = _number(timing.get("clip_offset_seconds"), "clip_offset_seconds"), _number(timing.get("actual_duration_seconds"), "actual_duration_seconds")
    offset_ms, duration_ms = _ms(offset), _ms(duration)
    _need(offset_ms >= 0 and duration_ms >= 1, "timing_invalid", "The clip offset must not be negative and the clip must have a duration.")
    rows = timing.get("segments")
    _need(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), "timing_invalid", "segments must be a list of objects.")

    segments: list[dict] = []
    by_word_id: dict[str, float] = {}
    counts = {"segments": len(rows), "words": 0, "zero_length_words": 0}
    skipped = {"segments_without_text": 0, "words_without_text": 0}
    for row in rows:
        what = f"segment {row.get('segment_id')!r}"
        start, end = _span(row, what, duration_ms, tolerance_ms, may_be_empty=False)
        words = row.get("words", [])
        _need(isinstance(words, list) and all(isinstance(word, dict) for word in words) and isinstance(row.get("text"), str), "timing_invalid", f"{what}: text and words are required.")
        kept = []
        for word in words:
            counts["words"] += 1
            word_start, word_end = _span(word, f"a word of {what}", duration_ms, tolerance_ms, may_be_empty=True)
            counts["zero_length_words"] += word_end == word_start
            _need(isinstance(word.get("text"), str), "timing_invalid", f"A word of {what} has no text.")
            if isinstance(word.get("word_id"), str):
                by_word_id[word["word_id"]] = _number(word.get("start_seconds"), "a word start")
            text = word["text"].strip()
            if not text:
                skipped["words_without_text"] += 1
                continue
            entry = {"clip_start_ms": word_start, "clip_end_ms": word_end, "start_ms": word_start + offset_ms, "end_ms": word_end + offset_ms, "text": text}
            if "probability" in word:
                entry["probability"] = min(1.0, max(0.0, _number(word["probability"], "a word probability")))
            kept.append(entry)
        text = row["text"].strip() or " ".join(word["text"] for word in kept)
        if not text:
            skipped["segments_without_text"] += 1
            continue
        segment = {"index": len(segments), "clip_start_ms": start, "clip_end_ms": end, "start_ms": start + offset_ms, "end_ms": end + offset_ms, "text": text}
        if kept:
            segment["words"] = kept
        segments.append(segment)
    _need(timing.get("segment_count") == counts["segments"] and timing.get("word_count") == counts["words"], "count_mismatch",
          f"The file holds {counts['segments']} segments and {counts['words']} words; it declares {timing.get('segment_count')!r} and {timing.get('word_count')!r}.")

    # Wherever the producer states a time in the recording, it must be clip offset + clip time: the offset is applied once.
    stated = 0  # words whose recording time the producer states itself
    if QA_PATH in files:
        qa = _document(files[QA_PATH], QA_CONTRACT, "timing_invalid", QA_PATH, max_document_bytes)
        for sample in qa.get("samples") if isinstance(qa.get("samples"), list) else []:
            if not isinstance(sample, dict) or sample.get("word_id") not in by_word_id:
                raise Refused("timing_invalid", "QA_SAMPLE.json names a word that is not in timing.json.")
            clip, original = _number(sample.get("proposed_clip_seconds"), "a QA clip time"), _number(sample.get("proposed_original_seconds"), "a QA original time")
            if abs(clip - by_word_id[sample["word_id"]]) > _SECONDS_EPSILON or abs(original - (offset + clip)) > _SECONDS_EPSILON:
                raise Refused("absolute_time_mismatch", f"QA sample {sample['word_id']}: the stated recording time is not the clip offset plus the word's clip time.")
            stated += 1
    # Times a producer already shifted can still lie inside the clip; then nothing but its own statement of a word's
    # recording time tells. A clip that does not start at zero and has words but no such statement is not imported.
    _need(offset_ms == 0 or not counts["words"] or stated > 0, "offset_unverified",
          f"The clip starts {offset} s into the recording and the bundle states no recording time of any word ({QA_PATH} with at least one sample); "
          "whether the offset was already applied cannot be checked, so the times are not shifted on trust.")
    decode = provenance.get("decode") if isinstance(provenance.get("decode"), dict) else {}
    requested = decode.get("requested_original_range_seconds")
    if isinstance(requested, list) and len(requested) == 2:
        low, high = _number(requested[0], "the decoded range"), _number(requested[1], "the decoded range")
        if abs(_ms(low) - offset_ms) > tolerance_ms or abs(_ms(high - low) - duration_ms) > tolerance_ms:
            raise Refused("time_base_mismatch", f"The producer decoded [{low}, {high}] s of the recording; the timing file says offset {offset} s and duration {duration} s.")
    if "actual_decoded_duration_seconds" in decode and abs(_ms(_number(decode["actual_decoded_duration_seconds"], "the decoded duration")) - duration_ms) > tolerance_ms:
        raise Refused("time_base_mismatch", "The decoded duration in provenance.json is not the clip duration in timing.json.")
    declared_duration_ms = None
    if "container_duration_metadata_seconds" in decode and decode["container_duration_metadata_seconds"] is not None:
        declared_duration_ms = _ms(_number(decode["container_duration_metadata_seconds"], "the container duration"))
        _need(1 <= declared_duration_ms <= 86_400_000, "provenance_invalid", "The container duration in provenance.json is not a plausible recording length.")

    model = provenance.get("model") if isinstance(provenance.get("model"), dict) else {}
    runtime = provenance.get("runtime") if isinstance(provenance.get("runtime"), dict) else {}
    settings = provenance.get("inference_settings") if isinstance(provenance.get("inference_settings"), dict) else {}
    packages = runtime.get("packages") if isinstance(runtime.get("packages"), dict) else {}
    repository, snapshot, tool_version, language = model.get("repository"), model.get("snapshot"), packages.get("faster-whisper"), settings.get("language")
    _need(all(isinstance(value, str) and value for value in (repository, snapshot, tool_version, language)), "provenance_invalid",
          "provenance.json must state the model repository and snapshot, the faster-whisper version and the language.")
    try:
        parameters = c.sha256_hex(c.dump_json({"inference_settings": _plain(settings), "device": _plain(runtime.get("device")), "compute_type": _plain(runtime.get("compute_type")),
                                               "threads": _plain(runtime.get("threads")), "workers": _plain(runtime.get("workers")), "sample_rate_hz": _plain(timing.get("sample_rate_hz"))}))
    except (TypeError, ValueError) as exc:
        raise Refused("provenance_invalid", f"The inference settings cannot be fingerprinted: {exc}") from None
    window = {"start_ms": offset_ms, "end_ms": offset_ms + duration_ms}
    record = {"origin": "producer_bundle", "adapter": ADAPTER_VERSION, "producer_contract": MANIFEST_CONTRACT, "job_key": job_key, "producer_manifest_sha256": manifest_sha256,
              "producer_outputs": [{"path": entry["path"], "bytes": entry["size_bytes"], "sha256": entry["sha256"]} for entry in manifest["outputs"]],
              "source": {key: source[key] for key in ("course_id", "source_id", "version_id", "sha256")}, "producer_statuses": _plain(statuses),
              "model": {"repository": repository[:200], "snapshot": snapshot[:80]},
              "runtime": {key: _plain(runtime.get(key)) for key in ("python", "packages", "device", "compute_type", "threads", "workers")}, "inference_settings": _plain(settings),
              "window": dict(window), "clip_offset_ms": offset_ms, "actual_duration_ms": duration_ms, "tolerance_ms": tolerance_ms, "counts": counts, "skipped": skipped,
              "review": {"status": GENERATED_UNREVIEWED, "audio_review": _plain(provenance.get("audio_review")), "qa_accuracy": _plain(provenance.get("qa_accuracy"))},
              "note": "Generated, unreviewed speech timing for the stated window of one recording. The producer's own files are kept unchanged under producer/."}
    return {"generation": generation_id(job_key), "source": dict(source), "declared_duration_ms": declared_duration_ms, "window": window, "clip_offset_ms": offset_ms,
            "producer": {"tool": "faster-whisper", "tool_version": tool_version[:64], "model": f"{repository}@{snapshot}"[:128], "language": language[:35], "parameters_sha256": parameters},
            "segments": segments, "provenance": record}
