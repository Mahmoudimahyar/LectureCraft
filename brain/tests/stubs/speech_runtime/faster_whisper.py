"""LABELLED STUB: this is NOT faster-whisper. It recognises nothing.

``LABELLED_STUB = True`` makes the real worker label every result it writes a double. ``WhisperModel`` records how it
was constructed and what each ``transcribe`` call was given, and FABRICATES words from time alone: the samples it gets
are the ramp of the ``av`` stub (each sample's value is its own time in the recording), so word ``j`` is placed at
``[j * 2 s + 300 ms, j * 2 s + 700 ms]`` of the recording and called ``w<j>`` — the same word in both chunks of an
overlap. If the samples are not that ramp, the worker put a sample at the wrong time and the stub raises.

Test-only behaviour comes from the JSON file named by ``LL_STUB_SPEECH_CONTROL`` (chunks are named by the second of
the recording they start at): ``loop_offsets`` (the first pass is a repetition loop: one word forty times, none with a
duration), ``partial_loop_offsets`` (the first pass has the ordinary words of the chunk's first half and loops over
the second half), ``second_pass`` (what a second pass yields: ``"fixes"`` the ordinary words, ``"loops"`` again,
``"few"`` only the first two ordinary words, ``"raises"``), ``error_offsets`` (the first pass raises, as a runtime
that ran out of memory), ``seconds_per_segment`` (time between two yielded segments), ``model_load_seconds`` (time
the model "takes to load"), ``record`` (a file that gets one JSON line per call).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import time

LABELLED_STUB = True
PERIOD_MS = 2_000


def _control() -> dict:
    path = os.environ.get("LL_STUB_SPEECH_CONTROL")
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else {}


def _record(control: dict, entry: dict) -> None:
    if control.get("record"):
        with open(control["record"], "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True, default=str) + "\n")


class _Word:
    def __init__(self, word: str, start: float, end: float, probability: float = 0.5):
        self.word, self.start, self.end, self.probability = word, start, end, probability


class _Segment:
    def __init__(self, number: int, words: list[_Word], compression_ratio: float, temperature: float = 0.0):
        self.id, self.words, self.compression_ratio, self.temperature = number, words, compression_ratio, temperature
        self.start, self.end, self.text = words[0].start, words[-1].end, " ".join(word.word for word in words)
        self.avg_logprob, self.no_speech_prob = -0.1, 0.0


def _ordinary(offset_ms: int, length_ms: int) -> list[_Segment]:
    words, j = [], 0
    while j * PERIOD_MS + 700 <= offset_ms + length_ms:
        if j * PERIOD_MS + 300 >= offset_ms:
            words.append(_Word(f"w{j}", (j * PERIOD_MS + 300 - offset_ms) / 1000, (j * PERIOD_MS + 700 - offset_ms) / 1000))
        j += 1
    return [_Segment(number, words[first:first + 5], 1.5) for number, first in enumerate(range(0, len(words), 5))]


def _loop(start: float, end: float, number: int = 0) -> _Segment:
    return _Segment(number, [_Word("okay,", start + n * (end - start) / 40, start + n * (end - start) / 40, 0.9) for n in range(40)][:-1] + [_Word("okay,", end, end, 0.9)], 31.9)


class WhisperModel:
    def __init__(self, model_dir, **kwargs):
        self._control = _control()
        _record(self._control, {"call": "model", "model_dir": str(model_dir), "kwargs": kwargs})
        time.sleep(float(self._control.get("model_load_seconds", 0)))  # a long step that passes no checkpoint of the worker

    def transcribe(self, samples, **options):
        control = self._control
        rate = round(1 / (samples[1] - samples[0]))
        offset = samples[0]
        if not control.get("missing_audio") and any(abs(samples[i] - (offset + i / rate)) > 1e-6 for i in range(len(samples))):
            raise RuntimeError("LABELLED STUB: a sample is not at its own time in the recording; the worker's time mapping is wrong")
        offset_ms, length_ms = int(round(offset * 1000)), int(round(len(samples) / rate * 1000))
        second = options.get("condition_on_previous_text") is False
        _record(control, {"call": "transcribe", "offset_ms": offset_ms, "length_ms": length_ms, "pass": "second" if second else "primary", "options": options})
        at = offset_ms // 1000
        ordinary = _ordinary(offset_ms, length_ms)
        if second:
            how = control.get("second_pass", "fixes")
            if how == "raises":
                raise RuntimeError("LABELLED STUB: the second pass fails")
            segments = {"fixes": ordinary, "loops": [_loop(1.0, length_ms / 1000 - 1.0)], "few": [_Segment(0, ordinary[0].words[:2], 1.5)] if ordinary else []}[how]
        elif at in control.get("error_offsets", []):
            raise MemoryError("LABELLED STUB: the runtime ran out of memory")
        elif at in control.get("loop_offsets", []):
            segments = [_loop(1.0, length_ms / 1000 - 1.0)]
        elif at in control.get("partial_loop_offsets", []):
            half = length_ms / 2000
            kept = [word for segment in ordinary for word in segment.words if word.end <= half]
            segments = ([_Segment(0, kept, 1.5)] if kept else []) + [_loop(half + 0.5, length_ms / 1000 - 0.5, 1)]
        else:
            segments = ordinary

        def stream():
            for segment in segments:
                if control.get("seconds_per_segment"):
                    time.sleep(float(control["seconds_per_segment"]))
                yield segment

        return stream(), {"language": "en", "labelled_stub": True}
