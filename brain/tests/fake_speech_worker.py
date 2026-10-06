"""LABELLED FAKE speech worker for tests. It is NOT speech recognition.

It follows the worker protocol of ``lecture_brain/speech/worker.py`` (job file in, one atomically written chunk result
per job, heartbeat, lease, stop file, result file, exit codes) so the supervisor can be tested without a speech
runtime. It never opens the media file for decoding and loads no model: the "words" are fabricated from the clock
position alone — word ``j`` sits at ``[j*period + 300 ms, j*period + 700 ms]`` of original-media time and is called
``w<j>`` — so the same word appears in both chunks of an overlap and de-duplication can be checked exactly. Every
result says ``labelled_double: true`` and names the tool ``labelled-fake-speech-worker``.

Test-only behaviour comes from the JSON file named by the environment variable ``LL_FAKE_SPEECH_CONTROL``:
``delay_seconds`` (time spent "inside" each chunk), ``period_ms``, ``silent_chunks`` (chunk indexes with no words),
``out_of_bounds`` (adds one word before the chunk and one far past its end), ``fail_at`` / ``hang_at`` (chunk index
at which to exit with a resource failure, or to stay busy until stopped), ``die_at`` (exit without a result file),
``loop_chunks`` (chunk indexes whose first pass is a repetition loop: one word forty times with no duration, as a real
recogniser does; with ``second_pass_fixes`` the second pass asked for by the job yields the ordinary words, otherwise
it loops again), ``decode_error_at`` (chunk index whose audio "cannot be decoded": reported, the recording skipped, the rest goes on),
``startup_error`` (fail before any chunk, as a runtime that cannot start), ``mute_at`` (go silent inside that chunk:
no heartbeat, deaf to the stop file and the lease), ``short_chunks`` (chunk indexes whose result is written two
seconds short of the range asked for without saying the recording ended: a result the supervisor does not accept),
``odd_chunks`` with ``odd_shape`` (chunk indexes whose result is complete and well addressed but has an inside no
merge can read: ``"words_number"`` puts the number 5 where the second segment's list of words belongs,
``"decoding_text"`` a text where the decoding record belongs), ``collapsed_loop_chunks`` (chunk indexes whose second
segment is replaced by a repetition loop whose twenty copies all sit at ONE instant: a failing segment without a span),
``only_work`` (limit ``fail_at`` / ``hang_at`` / ``die_at`` / ``mute_at`` / ``loop_chunks`` / ``decode_error_at`` /
``short_chunks`` / ``odd_chunks`` / ``collapsed_loop_chunks`` to one recording's work id), ``log`` (a file that gets
one line per chunk started and finished).

When a chunk is "decoded" twice the fake keeps the pass with more accepted words, as the real worker does, and
writes the job's second-pass identity into the result.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

TOOL = "labelled-fake-speech-worker"
EXIT_OK, EXIT_RESOURCE, EXIT_LEASE = 0, 2, 4


def write_atomic(path: Path, value: dict, *, attempts: int = 40) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".tmp-{os.getpid()}-{path.name}")
    tmp.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    try:
        for attempt in range(attempts):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:  # a reader has the target open for an instant (Windows)
                time.sleep(0.02)
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def read_json(path: Path) -> dict | None:
    for attempt in range(40):
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


def fabricate(job: dict, control: dict) -> list[dict]:
    """Deterministic invented words inside the chunk, in chunk-local seconds, five to a segment."""
    period = int(control.get("period_ms", 2000))
    start_ms, end_ms, index = job["start_ms"], job["end_ms"], job["index"]
    words = []
    if index not in control.get("silent_chunks", []):
        j = 0
        while j * period + 700 <= end_ms:
            if j * period + 300 >= start_ms:
                words.append({"text": f"w{j}", "start": (j * period + 300 - start_ms) / 1000, "end": (j * period + 700 - start_ms) / 1000, "probability": round(min(1.0, (index + 1) / 10), 3)})
            j += 1
    if control.get("out_of_bounds"):
        words.insert(0, {"text": "before", "start": -3.0, "end": -2.5, "probability": 0.5})
        words.append({"text": "after", "start": (end_ms - start_ms) / 1000 + 30.0, "end": (end_ms - start_ms) / 1000 + 30.5, "probability": 0.5})
    segments = []
    for first in range(0, len(words), 5):
        group = words[first:first + 5]
        segments.append({"start": group[0]["start"], "end": group[-1]["end"], "text": " ".join(w["text"] for w in group), "avg_logprob": -0.1, "no_speech_prob": 0.0,
                         "compression_ratio": 1.5, "words": group})
    return segments


def loop(job: dict) -> list[dict]:
    """The output of a repetition loop over the chunk: one word forty times, none with a duration, from 1 s in to 1 s before the end."""
    start, end = 1.0, (job["end_ms"] - job["start_ms"]) / 1000 - 1.0
    words = [{"text": "okay,", "start": start + n * (end - start) / 40, "end": start + n * (end - start) / 40, "probability": 0.9} for n in range(40)]
    return [{"start": start, "end": end, "text": " ".join(w["text"] for w in words), "avg_logprob": -0.07, "no_speech_prob": 0.0, "compression_ratio": 31.9, "words": words}]


def failed_words(segments: list[dict]) -> int:
    return sum(len(segment["words"]) for segment in segments if segment["compression_ratio"] > 2.4)


def words_of(segments: list[dict]) -> int:
    return sum(len(segment["words"]) for segment in segments)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", required=True)
    job_file = json.loads(Path(parser.parse_args().job).read_text(encoding="utf-8"))
    control_path = os.environ.get("LL_FAKE_SPEECH_CONTROL")
    control = json.loads(Path(control_path).read_text(encoding="utf-8")) if control_path else {}
    heartbeat, lease, stop, result_path = (Path(job_file[key]) for key in ("heartbeat_path", "lease_path", "stop_path", "result_path"))
    done, conflicts, hashed, chunk_errors = 0, [], {}, []

    def log(line: str) -> None:
        if control.get("log"):
            with open(control["log"], "a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def beat(position: int, phase: str) -> None:
        """As in the real worker: a sign of life that cannot be written is skipped, and the next one is tried as usual."""
        try:
            write_atomic(heartbeat, {"at": time.time(), "job": position, "phase": phase, "pid": os.getpid(), "tool": TOOL}, attempts=5)
        except OSError:
            pass

    def finish(ended: str, code: int, **more) -> int:
        write_atomic(result_path, {"document": "speech-worker-result/1", "ended": ended, "jobs_done": done, "conflicts": conflicts, "chunk_errors": chunk_errors, "tool": TOOL,
                                   "labelled_double": True, **more})
        return code

    def interrupted() -> str | None:
        if stop.exists():
            return "stop"
        current = read_json(lease)
        if current is None or time.time() > float(current.get("until", 0)):
            return "lease_lost"
        return None

    beat(-1, "start")
    if control.get("startup_error"):
        return finish("error", EXIT_RESOURCE, phase="startup", error="startup: FAKE runtime that cannot start", error_job=None)
    for position, job in enumerate(job_file["jobs"]):
        why = interrupted()
        if why:
            return finish(why, EXIT_LEASE if why == "lease_lost" else EXIT_OK)
        if time.time() >= float(job_file["not_after_epoch"]):
            return finish("deadline", EXIT_OK)
        if job["work_id"] in conflicts or any(error["work_id"] == job["work_id"] for error in chunk_errors):
            continue
        media = Path(job["media_path"])
        if job["media_path"] not in hashed:
            try:
                hashed[job["media_path"]] = (media.stat().st_size, sha256_of(media))
            except OSError:
                hashed[job["media_path"]] = (None, None)
        if hashed[job["media_path"]] != (job["bytes"], job["sha256"]):
            conflicts.append(job["work_id"])
            continue
        log(f"start {job['work_id']} {job['index']}")
        beat(position, "transcribe")
        special = control if control.get("only_work") in (None, job["work_id"]) else {}
        if special.get("decode_error_at") == job["index"]:
            chunk_errors.append({"position": position, "work_id": job["work_id"], "index": job["index"], "error": "decode: FAKE audio that cannot be decoded"})
            continue
        if special.get("die_at") == job["index"]:
            os._exit(9)  # like a process killed from outside: no result file
        while special.get("mute_at") == job["index"]:
            time.sleep(0.05)  # a stuck worker: only its supervisor can end this
        if special.get("fail_at") == job["index"]:
            return finish("error", EXIT_RESOURCE, error="FAKE resource failure requested by the test", error_job=position)
        waited, delay = 0.0, float(control.get("delay_seconds", 0.0))
        while waited < delay or special.get("hang_at") == job["index"]:
            time.sleep(0.02)
            waited += 0.02
            beat(position, "transcribe")
            why = interrupted()
            if why:
                return finish(why, EXIT_LEASE if why == "lease_lost" else EXIT_OK)
        segments = fabricate(job, control)
        decoding = {"policy": job_file.get("decoding_policy"), "pass": "primary", "primary": {"failed_words": 0}, "second": None, "second_pass_sha256": None, "selection": None}
        if job["index"] in special.get("loop_chunks", []):
            segments = loop(job)
            decoding["primary"] = {"failed_words": failed_words(segments)}
            if job_file.get("second_pass_settings"):  # the job asks for one more pass over a looping chunk
                retried = fabricate(job, control) if special.get("second_pass_fixes") else loop(job)
                decoding["second"] = {"failed_words": failed_words(retried), "settings": job_file["second_pass_settings"]}
                decoding["second_pass_sha256"] = job_file.get("second_pass_sha256")  # the identity of what was used on this chunk, as the real worker records it
                kept = "second" if words_of(retried) - failed_words(retried) > words_of(segments) - failed_words(segments) else "primary"  # more accepted words wins, as in the real worker
                decoding["selection"] = {"rule": "most-accepted-words-1", "kept": kept, "why": "FAKE: decided by the labelled fake worker with the real worker's rule"}
                if kept == "second":
                    segments, decoding["pass"] = retried, "second"
        if job["index"] in special.get("collapsed_loop_chunks", []) and len(segments) >= 2:  # a loop whose copies carry one instant: the failing segment has no span
            at = segments[1]["start"]
            copies = [{"text": "okay,", "start": at, "end": at, "probability": 0.9} for _ in range(20)]
            segments = [segments[0], {"start": at, "end": at, "text": " ".join(w["text"] for w in copies), "avg_logprob": -0.07, "no_speech_prob": 0.0, "compression_ratio": 31.9, "words": copies},
                        *segments[2:]]
        if job["index"] in special.get("odd_chunks", []):  # well addressed, complete — and unreadable inside
            if special.get("odd_shape") == "words_number" and len(segments) >= 2:
                segments = [segments[0], {**segments[1], "words": 5}, *segments[2:]]
            elif special.get("odd_shape") == "decoding_text":
                decoding = "FAKE: a decoding record written as a text"
        decoded_ms = job["end_ms"] - job["start_ms"] - (2_000 if job["index"] in special.get("short_chunks", []) else 0)  # two seconds short: a result the supervisor must not accept
        write_atomic(Path(job["out_path"]), {
            "document": "speech-chunk/1", "work_id": job["work_id"], "index": job["index"], "offset_ms": job["start_ms"], "end_ms": job["end_ms"],
            "decoded_ms": decoded_ms, "end_of_stream": bool(job["last"]) and decoded_ms == job["end_ms"] - job["start_ms"], "recording": {"sha256": job["sha256"], "bytes": job["bytes"]},
            "settings_sha256": job_file["settings_sha256"], "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "wall_seconds": {"decode": 0.0, "transcribe": waited},
            "runtime": {"tool": TOOL, "python": sys.version.split()[0], "packages": {"faster-whisper": "0.0.0-fake"}, "device": "none", "compute_type": "none",
                        "threads": job_file["cpu_threads"], "workers": job_file["num_workers"]},
            "decode": {"note": "FAKE: no audio was decoded"}, "decoding": decoding, "labelled_double": True, "double_note": "Fabricated by the labelled fake speech worker; not speech recognition.",
            "segments": segments})
        done += 1
        log(f"done {job['work_id']} {job['index']}")
    return finish("completed", EXIT_OK)


if __name__ == "__main__":
    sys.exit(main())
