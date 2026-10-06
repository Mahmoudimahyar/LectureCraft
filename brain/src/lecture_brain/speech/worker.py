"""Standalone speech worker. Run by the EXTERNAL speech interpreter, never imported by the app.

    <speech interpreter> -B worker.py --job <job.json>

It needs only the standard library plus ``faster_whisper``, ``av`` (PyAV) and ``numpy`` from that interpreter; it does
not import the app. The supervisor (``runner.py``) writes the job file and launches this script with an offline child
environment. The worker

* loads ONE model from the explicit local directory in the job (``local_files_only=True``; CPU, int8, one worker, at
  most four threads — hard limits here, whatever the job says) and downloads nothing;
* processes the listed chunk jobs sequentially: checks the recording is the frozen bytes (size and SHA-256), decodes
  ONLY the chunk's range of original-media time with PyAV to 16 kHz mono float32, transcribes it with word times, and
  writes the result atomically (words and segments in chunk-LOCAL seconds plus the chunk offset);
* checks its own output: a recogniser can fall into a repetition loop (one word over and over). The job's settings
  (the verified proof's) are the PRIMARY pass. Only when a tenth of a chunk's words or a minute of it fail the
  repetition check is the chunk decoded ONCE more with the job's second-pass settings (no conditioning on the
  previous text, a temperature ladder). The pass that keeps MORE ACCEPTED words (words outside failing segments) is
  the chunk's text; a second pass that keeps fewer never replaces the first, and with equal counts the one with less
  failed text wins, the first pass on a full tie. The result records both passes, which one was kept and why, and the
  digest of the second-pass settings and selection rule that were used (``second_pass_sha256``), so a later edit of
  either is visible in every chunk made before it. What still fails is withheld later, at the merge;
* writes a heartbeat while it works (one that cannot be written is skipped and the next one tried as usual: it is a
  sign of life, not a result); stops between or inside chunks when the stop file appears, when the
  supervisor's lease is no longer refreshed (the supervisor is gone), at the job's hard stop (the allowance ceiling,
  honoured even when no supervisor is left to enforce it) or — between chunks only — at the job's deadline; an
  interrupted chunk leaves no result. A watchdog thread ends the process when the lease stays lost (or the hard stop
  passed) for a grace period while the work is inside a step that passes no checkpoint;
* treats a recording whose audio cannot be DECODED as that recording's problem: the error is reported in the result
  file, the recording's remaining chunks are skipped in this run, and the other recordings go on. Audio that stops
  short of the requested range while the stream goes on is such an error too: a short chunk is never written;
* ends with a result file and an exit code: 0 finished or stopped cleanly, 2 a resource failure (memory, model,
  runtime), 4 the lease was lost.

A stand-in for the speech library that declares itself one (``LABELLED_STUB = True``, used by tests that run this
script's control flow without a speech runtime) makes every result say ``labelled_double: true``.

Time mapping (the same as the verified proof): original media seconds = frame pts * time base - container origin.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

TOOL = "faster-whisper"
HEARTBEAT_ATTEMPTS = 5  # a heartbeat whose file cannot be replaced is given a tenth of a second, then skipped: the next one comes within a second
WATCHDOG_GRACE_SECONDS = 5.0  # how long a lost lease (or a passed hard stop) may last before the watchdog ends the process inside a step without a checkpoint
STUB_TOOL = "labelled-stub-speech-runtime"  # named in every result when the speech library is a test's declared stand-in
EXIT_OK, EXIT_RESOURCE, EXIT_LEASE = 0, 2, 4
MAX_THREADS = 4
PREROLL_SECONDS = 1.0  # decoded and discarded before a chunk's start, so the decoder and resampler are settled at the first kept sample
MAX_GAP_SECONDS = 0.5  # more missing audio than this inside the decoded range is a decoding failure, never silently padded
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
REPETITION_MIN_WORDS = 8
SELECTION_RULE = "most-accepted-words-1"  # how the kept pass is chosen when a chunk was decoded twice (see choose_pass)


def settings_digest(value) -> str:
    """SHA-256 of the canonical JSON of a settings object (sorted keys, no spaces, UTF-8): the supervisor's form."""
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def second_pass_digest(second_pass_settings: dict) -> str:
    """The identity of a second pass: its settings and the rule that chooses between the two passes."""
    return settings_digest({"second_pass_settings": second_pass_settings, "selection_rule": SELECTION_RULE})


def choose_pass(primary: dict, second: dict) -> tuple[str, str]:
    """Which of two decodings of one chunk is kept — ``"primary"`` or ``"second"`` — and why, from their repetition
    statistics. More ACCEPTED words (words outside failing segments) wins; a second pass that keeps fewer never
    replaces the first. With equal counts the pass with less failed text wins, the first pass on a full tie."""
    first_kept, second_kept = primary["words"] - primary["failed_words"], second["words"] - second["failed_words"]
    if second_kept > first_kept:
        return "second", f"the second pass keeps {second_kept} accepted words, the first pass {first_kept}"
    if second_kept < first_kept:
        return "primary", f"the first pass keeps {first_kept} accepted words, the second pass only {second_kept}: it does not replace the first"
    if (second["failed_seconds"], second["failed_words"]) < (primary["failed_seconds"], primary["failed_words"]):
        return "second", f"both passes keep {first_kept} accepted words; the second pass leaves less failed text ({second['failed_seconds']} s against {primary['failed_seconds']} s)"
    return "primary", f"both passes keep {first_kept} accepted words and the second pass leaves no less failed text: the first pass stands"


# ---- the repetition check: the same three functions as lecture_brain/speech/chunks.py (a test holds them together) ----
def repetition_check_failed(segment: dict, threshold: float) -> bool:
    """True when a segment is the output of a repetition loop rather than text of the recording: the recogniser's own
    compression ratio above its own threshold, or one word making up at least half of a segment of eight or more words."""
    ratio = segment.get("compression_ratio")
    if isinstance(ratio, (int, float)) and not isinstance(ratio, bool) and ratio > threshold:
        return True
    words = [word["text"].strip().lower().strip(".,?!;:") for word in segment.get("words") or [] if isinstance(word, dict) and isinstance(word.get("text"), str)]
    words = [word for word in words if word]
    return len(words) >= REPETITION_MIN_WORDS and max(Counter(words).values()) * 2 >= len(words)


def repetition_stats(segments: list, threshold: float) -> dict:
    """How much of a chunk's output fails the repetition check. ``failed_seconds`` spans each run of consecutive
    failed segments from its first start to its last end: the gaps inside a loop belong to the loop."""
    flags = [repetition_check_failed(segment, threshold) for segment in segments]
    seconds, position = 0.0, 0
    while position < len(segments):
        if not flags[position]:
            position += 1
            continue
        last = position
        while last + 1 < len(segments) and flags[last + 1]:
            last += 1
        start, end = segments[position].get("start"), segments[last].get("end")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
            seconds += end - start
        position = last + 1
    return {"segments": len(segments), "words": sum(len(segment.get("words") or []) for segment in segments), "failed_segments": sum(flags),
            "failed_words": sum(len(segment.get("words") or []) for segment, failed in zip(segments, flags) if failed), "failed_seconds": round(seconds, 3)}


def needs_second_pass(stats: dict) -> bool:
    """A chunk is worth decoding once more when a tenth of its words, or a minute of it, failed the repetition check."""
    return stats["failed_words"] > 0 and (stats["failed_words"] * 10 >= stats["words"] or stats["failed_seconds"] >= 60.0)


class Interrupted(Exception):
    """Stop file or lost lease while a chunk was being processed. The chunk leaves no result."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


def write_atomic(path: Path, value: dict, *, attempts: int = 60) -> None:
    """Write the file whole or not at all. A refused replace is tried again ``attempts`` times, 20 ms apart; when it
    stays refused the error is raised and nothing is left lying beside the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".tmp-{os.getpid()}-{path.name}")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        for attempt in range(attempts):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:  # a reader has the target open for an instant (Windows)
                time.sleep(0.02)
        os.replace(tmp, path)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def read_json(path: Path) -> dict | None:
    for attempt in range(60):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (PermissionError, json.JSONDecodeError):
            time.sleep(0.02)
    return None


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def decode_range(av, np, media_path: str, start_ms: int, end_ms: int, rate: int, checkpoint) -> tuple:
    """Decode ``[start_ms, end_ms)`` of original-media time to mono float32 at ``rate``. Only the needed range is read.

    Returns ``(samples, evidence)``. Samples are placed on the chunk's sample grid by their own timestamps; the tail is
    cut where the audio ends. Nothing is padded: missing audio inside the range beyond a small tolerance is an error."""
    start, end = start_ms / 1000, end_ms / 1000
    limit = int(round((end - start) * rate))
    samples, filled = np.zeros(limit, dtype=np.float32), np.zeros(limit, dtype=np.bool_)
    frames = overlapped = 0
    highest = 0
    exhausted = True
    with av.open(media_path, mode="r") as container:
        stream = container.streams.audio[0]
        if container.start_time is not None:
            origin = float(container.start_time / av.time_base)
        elif stream.start_time is not None:
            origin = float(stream.start_time * stream.time_base)
        else:
            origin = 0.0
        evidence = {"container_start_us": container.start_time, "stream_start_pts": stream.start_time, "stream_time_base": str(stream.time_base), "media_origin_seconds": origin,
                    "input_sample_rate": stream.codec_context.sample_rate, "codec": stream.codec_context.name,
                    "container_duration_metadata_seconds": float(container.duration / av.time_base) if container.duration is not None else None,
                    "output_sample_rate": rate, "output_layout": "mono", "output_format": "float32", "requested_original_range_seconds": [start, end],
                    "time_mapping": "original media seconds = frame pts * time base - container origin; chunk-local 0 is the chunk offset"}
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=rate)

        def place(out) -> None:
            nonlocal highest, overlapped
            if out.pts is None or out.time_base is None:
                raise RuntimeError("a resampled frame has no timestamp")
            data = out.to_ndarray().reshape(-1).astype(np.float32, copy=False)
            begin = int(round((float(out.pts * out.time_base) - origin - start) * rate))
            low, high = max(0, begin), min(limit, begin + len(data))
            if high > low:
                overlapped += int(filled[low:high].sum())
                samples[low:high] = data[low - begin:high - begin]
                filled[low:high] = True
                highest = max(highest, high)

        lead = max(0.0, start - PREROLL_SECONDS)
        if lead > 0:
            container.seek(int((lead + origin) / stream.time_base), stream=stream, backward=True, any_frame=False)
        for frame in container.decode(stream):
            frames += 1
            if frames % 512 == 0:
                checkpoint("decode")
            if frame.pts is None:
                raise RuntimeError("an input frame has no timestamp")
            frame_start = float(frame.pts * frame.time_base) - origin
            if frame_start + frame.samples / frame.sample_rate <= lead:
                continue  # before the pre-roll: not needed
            if frame_start >= end:
                exhausted = False
                break
            for out in resampler.resample(frame):
                place(out)
            if highest >= limit:
                exhausted = False
                break
        if highest < limit:
            for out in resampler.resample(None):
                place(out)
    gaps = int(highest - int(filled[:highest].sum()))
    if gaps > MAX_GAP_SECONDS * rate:
        raise RuntimeError(f"decoded audio has {gaps / rate:.3f} s of gaps inside the requested range; nothing is padded")
    reached_end = bool(exhausted and highest < limit)
    if not reached_end and limit - highest > MAX_GAP_SECONDS * rate:  # the stream goes on, but the end of this range is missing: a hole at the tail is a gap too
        raise RuntimeError(f"decoded audio stops {(limit - highest) / rate:.3f} s before the end of the requested range although the stream goes on; nothing is padded")
    if not np.isfinite(samples[:highest]).all():
        raise RuntimeError("decoded audio contains non-finite samples")
    evidence.update(decoded_codec_frames=frames, output_samples=int(highest), actual_decoded_duration_seconds=highest / rate, gap_samples=gaps, overlapped_samples=int(overlapped),
                    reached_end_of_stream=reached_end)
    return samples[:highest], evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline speech worker (launched by the lecture-brain speech supervisor)")
    parser.add_argument("--job", required=True)
    job_file = json.loads(Path(parser.parse_args().job).read_text(encoding="utf-8"))
    heartbeat, lease, stop, result_path = (Path(job_file[key]) for key in ("heartbeat_path", "lease_path", "stop_path", "result_path"))
    hard_stop = job_file.get("hard_stop_epoch")  # the allowance ceiling as a clock time: this worker stops there by itself, supervisor or not
    hard_stop = float(hard_stop) if isinstance(hard_stop, (int, float)) and not isinstance(hard_stop, bool) else None
    state = {"done": 0, "conflicts": [], "chunk_errors": [], "position": -1, "last_beat": 0.0, "last_lease": 0.0, "tool": TOOL, "double": False, "beats_skipped": 0}

    def beat(phase: str, force: bool = False, **more) -> None:
        """A sign of life for the supervisor, at most once a second unless forced. One that cannot be written (on
        Windows: something else has the file open) is skipped, said once in the log, and the next one is tried as
        usual: the supervisor ends a worker whose heartbeat stays silent — the worker does not end itself, report a
        failure of the runtime or blame the recording it is at over a sign of life it could not give."""
        now = time.time()
        if force or now - state["last_beat"] >= 1.0:
            state["last_beat"] = now  # also when it is skipped: the work is not held up by one attempt after another
            try:
                write_atomic(heartbeat, {"at": now, "job": state["position"], "phase": phase, "pid": os.getpid(), "tool": state["tool"], **more}, attempts=HEARTBEAT_ATTEMPTS)
                state["beats_skipped"] = 0
            except OSError as exc:
                state["beats_skipped"] += 1
                if state["beats_skipped"] == 1:
                    print(f"heartbeat not written ({type(exc).__name__}: {exc}); the work goes on and the next one is tried as usual"[:400], flush=True)

    def finish(ended: str, code: int, **more) -> int:
        write_atomic(result_path, {"document": "speech-worker-result/1", "ended": ended, "jobs_done": state["done"], "conflicts": state["conflicts"],
                                   "chunk_errors": state["chunk_errors"], "tool": state["tool"], "labelled_double": state["double"], **more})
        print(f"worker ended: {ended} (jobs done {state['done']})", flush=True)
        return code

    def interrupted(force: bool = False) -> str | None:
        if stop.exists():
            return "stop"
        now = time.time()
        if hard_stop is not None and now >= hard_stop:
            return "hard_ceiling"
        if force or now - state["last_lease"] >= 1.0:
            state["last_lease"] = now
            current = read_json(lease)
            if current is None or now > float(current.get("until", 0)):
                return "lease_lost"
        return None

    def checkpoint(phase: str) -> None:
        why = interrupted()
        if why:
            raise Interrupted(why)
        beat(phase)

    def leave(why: str) -> int:
        return finish(why, EXIT_LEASE if why == "lease_lost" else EXIT_OK)

    def watch() -> None:
        """Runs beside the work, for the steps that pass no checkpoint (hashing a recording, loading the model, one
        window of recognition). When the lease has been lost, or the hard stop passed, for the whole grace period
        and the work still has not left by itself, the process is ended here: a worker without a supervisor must
        not outlive its lease inside a long step, where another run could start a second worker beside it."""
        since = None
        while True:
            time.sleep(min(1.0, grace))
            now = time.time()
            current = read_json(lease)
            gone = "lease_lost" if current is None or now > float(current.get("until", 0)) else "hard_ceiling" if hard_stop is not None and now >= hard_stop else None
            if gone is None:
                since = None
                continue
            since = time.monotonic() if since is None else since
            if time.monotonic() - since >= grace:
                try:
                    finish(gone, 0, by="watchdog")
                finally:
                    os._exit(EXIT_LEASE if gone == "lease_lost" else EXIT_OK)

    grace = job_file.get("watchdog_grace_seconds")
    grace = float(grace) if isinstance(grace, (int, float)) and not isinstance(grace, bool) and grace > 0 else WATCHDOG_GRACE_SECONDS
    threading.Thread(target=watch, name="lease-watchdog", daemon=True).start()

    try:
        beat("imports", force=True)
        started = time.monotonic()
        import av
        import numpy as np
        import faster_whisper
        from faster_whisper import WhisperModel
        from importlib import metadata

        def version(name: str) -> str | None:
            try:
                return metadata.version(name)
            except metadata.PackageNotFoundError:
                return None

        if getattr(faster_whisper, "LABELLED_STUB", False) is True:  # a test's stand-in for the speech library says so itself: nothing it yields is passed off as recognition
            state.update(tool=STUB_TOOL, double=True)
        if job_file.get("device") != "cpu" or job_file.get("compute_type") != "int8" or int(job_file.get("num_workers", 1)) != 1:
            raise RuntimeError("this worker runs on CPU with int8 and ONE worker only")
        second_pass = job_file.get("second_pass_settings") if isinstance(job_file.get("second_pass_settings"), dict) else None
        second_pass_sha256 = second_pass_digest(second_pass) if second_pass else None
        if second_pass and job_file.get("second_pass_sha256") not in (None, second_pass_sha256):
            raise RuntimeError("the supervisor recorded another second-pass identity than this worker computes for the same settings: supervisor and worker are not the same version")
        threads = max(1, min(MAX_THREADS, int(job_file["cpu_threads"])))
        model_dir = Path(job_file["model_dir"])
        missing = [name for name in MODEL_FILES if not (model_dir / name).is_file()]
        if missing:
            raise RuntimeError(f"model files missing in the configured directory: {', '.join(missing)} (nothing is downloaded)")
        model_bin_sha256 = sha256_of(model_dir / "model.bin")
        if job_file.get("model_bin_sha256") and job_file["model_bin_sha256"] != model_bin_sha256:
            raise RuntimeError("model.bin is not the file the binding pins (sha256 differs)")
        why = interrupted(force=True)
        if why:
            return leave(why)
        beat("model_load", force=True)
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=threads, num_workers=1, local_files_only=True)
        runtime = {"tool": state["tool"], "python": sys.version, "packages": {name: version(name) for name in ("faster-whisper", "ctranslate2", "av", "numpy")}, "device": "cpu",
                   "compute_type": "int8", "threads": threads, "workers": 1, "model_dir": str(model_dir), "model_bin_sha256": model_bin_sha256,
                   "startup_seconds": round(time.monotonic() - started, 3)}
        print(f"imports and model load: {runtime['startup_seconds']} s; packages {runtime['packages']}", flush=True)
    except Exception as exc:  # noqa: BLE001 - whatever stops the runtime from starting is reported, not hidden
        traceback.print_exc()
        return finish("error", EXIT_RESOURCE, phase="startup", error=f"startup: {type(exc).__name__}: {exc}"[:500], error_job=None)

    settings, rate, hashed = dict(job_file["settings"]), int(job_file["sample_rate_hz"]), {}
    threshold = float(settings.get("compression_ratio_threshold", 2.4))
    for position, job in enumerate(job_file["jobs"]):
        state["position"] = position
        why = interrupted(force=True)
        if why:
            return leave(why)
        if time.time() >= float(job_file["not_after_epoch"]):
            return finish("deadline", EXIT_OK)
        if job["work_id"] in state["conflicts"] or any(error["work_id"] == job["work_id"] for error in state["chunk_errors"]):
            continue
        media = Path(job["media_path"])
        try:
            before = media.stat()
            if job["media_path"] not in hashed:
                beat("verify_source", force=True)
                hashed[job["media_path"]] = (before.st_size, sha256_of(media))
            if hashed[job["media_path"]] != (job["bytes"], job["sha256"]):
                raise FileNotFoundError("the recording is not the frozen bytes")
        except OSError as exc:
            print(f"source conflict for {job['work_id']}: {exc}", flush=True)
            state["conflicts"].append(job["work_id"])
            continue
        try:
            beat("decode", force=True)
            clock = time.monotonic()
            try:
                samples, evidence = decode_range(av, np, str(media), job["start_ms"], job["end_ms"], rate, checkpoint)
            except (Interrupted, MemoryError):
                raise
            except Exception as exc:  # noqa: BLE001 - this recording's audio cannot be decoded here: its problem, not the run's
                traceback.print_exc()
                state["chunk_errors"].append({"position": position, "work_id": job["work_id"], "index": job["index"], "error": f"decode: {type(exc).__name__}: {exc}"[:500]})
                print(f"chunk {job['work_id']} #{job['index']}: decoding failed; this recording is skipped for the rest of this run", flush=True)
                continue
            decode_seconds = time.monotonic() - clock
            beat("transcribe", force=True)
            clock = time.monotonic()

            def transcribe(options: dict, phase: str) -> list:
                rows = []
                if len(samples) < rate // 10:  # less than a tenth of a second of audio holds no speech to recognise
                    return rows
                iterator, info = model.transcribe(samples, **options)
                for segment in iterator:
                    checkpoint(phase)
                    rows.append({"id": segment.id, "start": float(segment.start), "end": float(segment.end), "text": segment.text, "avg_logprob": float(segment.avg_logprob),
                                 "no_speech_prob": float(segment.no_speech_prob), "compression_ratio": float(segment.compression_ratio),
                                 "temperature": float(temperature) if isinstance(temperature := getattr(segment, "temperature", None), (int, float)) else None,
                                 "words": [{"text": word.word, "start": float(word.start), "end": float(word.end), "probability": float(word.probability)} for word in segment.words or []]})
                return rows

            segments = transcribe(settings, "transcribe")
            primary = repetition_stats(segments, threshold)
            decoding = {"policy": job_file.get("decoding_policy"), "pass": "primary", "repetition_threshold": threshold, "primary": dict(primary, seconds=round(time.monotonic() - clock, 3)),
                        "second": None, "second_pass_sha256": None, "selection": None}
            if second_pass and needs_second_pass(primary):
                print(f"chunk {job['work_id']} #{job['index']}: {primary['failed_words']} of {primary['words']} words fail the repetition check; decoding once more", flush=True)
                again = time.monotonic()
                decoding["second_pass_sha256"] = second_pass_sha256  # the identity of what was used on this chunk, whichever pass is kept
                try:
                    retried = transcribe({**settings, **second_pass}, "second_pass")
                    second = repetition_stats(retried, threshold)
                    decoding["second"] = dict(second, seconds=round(time.monotonic() - again, 3), settings=second_pass)
                    kept_pass, why = choose_pass(primary, second)
                    decoding["selection"] = {"rule": SELECTION_RULE, "kept": kept_pass, "why": why, "primary_accepted_words": primary["words"] - primary["failed_words"],
                                             "second_accepted_words": second["words"] - second["failed_words"]}
                    if kept_pass == "second":
                        segments, decoding["pass"] = retried, "second"
                except Interrupted:
                    raise
                except Exception as exc:  # noqa: BLE001 - the first pass stands; why the second one did not happen is recorded
                    traceback.print_exc()
                    decoding["second"] = {"error": f"{type(exc).__name__}: {exc}"[:300], "settings": second_pass}
                    decoding["selection"] = {"rule": SELECTION_RULE, "kept": "primary", "why": "the second pass failed; the first pass stands"}
            words = sum(len(row["words"]) for row in segments)
            transcribe_seconds = time.monotonic() - clock
            after = media.stat()
            if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
                print(f"source changed while chunk {job['index']} of {job['work_id']} was processed; the chunk is not kept", flush=True)
                state["conflicts"].append(job["work_id"])
                continue
            decoded_ms = int(round(len(samples) / rate * 1000))
            write_atomic(Path(job["out_path"]), {
                "document": "speech-chunk/1", "work_id": job["work_id"], "index": job["index"], "offset_ms": job["start_ms"], "end_ms": job["end_ms"], "decoded_ms": decoded_ms,
                "end_of_stream": bool(evidence["reached_end_of_stream"]), "recording": {"sha256": job["sha256"], "bytes": job["bytes"]}, "settings_sha256": job_file["settings_sha256"],
                "settings": settings, "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "wall_seconds": {"decode": round(decode_seconds, 3), "transcribe": round(transcribe_seconds, 3)},
                "runtime": runtime, "decode": evidence, "decoding": decoding, "labelled_double": state["double"],
                "time_coordinate": "chunk_local_seconds; original_seconds = offset_ms / 1000 + local_seconds",
                "word_count": words, "segment_count": len(segments), "segments": segments})
            state["done"] += 1
            kept = repetition_stats(segments, threshold)
            print(f"chunk {job['work_id']} #{job['index']} [{job['start_ms'] / 1000:.0f}-{job['end_ms'] / 1000:.0f} s]: decoded {decoded_ms / 1000:.1f} s in {decode_seconds:.1f} s, "
                  f"transcribed in {transcribe_seconds:.1f} s ({decoding['pass']} pass kept), {len(segments)} segments, {words} words, "
                  f"{kept['failed_words']} words / {kept['failed_seconds']:.0f} s fail the repetition check", flush=True)
            beat("chunk_done", force=True)
        except Interrupted as stopped:
            return leave(stopped.why)
        except Exception as exc:  # noqa: BLE001 - memory, decoder or model failure: report it and stop; the supervisor decides what happens next
            traceback.print_exc()
            return finish("error", EXIT_RESOURCE, error=f"{type(exc).__name__}: {exc}"[:500], error_job=position)
    return finish("completed", EXIT_OK)


if __name__ == "__main__":
    sys.exit(main())
