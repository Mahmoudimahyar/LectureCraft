"""LABELLED STUB: this is NOT PyAV. It decodes nothing.

It answers the calls the real speech worker makes to PyAV with a made-up "recording" as long as the WAV header of the
file says (or as the control file says): half-second frames with timestamps, and a resampler whose output SAMPLES ARE
A RAMP — the value of every sample is its own time in the recording, in seconds. A test can therefore tell from the
samples the worker hands to the recogniser stub whether the worker mapped time correctly (seek, pre-roll, placement).

Test-only behaviour comes from the JSON file named by ``LL_STUB_SPEECH_CONTROL``: ``undecodable`` (file names that
raise when opened), ``missing_audio`` (``[[from_s, to_s], ...]``: frames starting inside are not delivered, as after a
timestamp discontinuity), ``duration_seconds`` (for files that are not WAV), ``origin_seconds`` (a container whose
first timestamp is not zero).
"""
from __future__ import annotations

from fractions import Fraction
import json
import os
from pathlib import Path
import wave

import numpy  # the labelled stub beside this file

LABELLED_STUB = True
time_base = 1_000_000  # as in PyAV: container times are in units of 1 / time_base seconds
FRAME = Fraction(1, 2)
INPUT_RATE = 8_000


def _control() -> dict:
    path = os.environ.get("LL_STUB_SPEECH_CONTROL")
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else {}


class _Frame:
    def __init__(self, pts: int, base: Fraction, samples: int):
        self.pts, self.time_base, self.samples, self.sample_rate = pts, base, samples, INPUT_RATE


class _Resampled:
    def __init__(self, pts: int, base: Fraction, seconds: Fraction, rate: int, origin: Fraction):
        self.pts, self.time_base, self._seconds, self._rate, self._origin = pts, base, seconds, rate, origin

    def to_ndarray(self) -> numpy.Array:
        start = self.pts * self.time_base - self._origin  # recording time of the first sample
        return numpy.Array(float(start + Fraction(k, self._rate)) for k in range(int(self._seconds * self._rate)))


class AudioResampler:
    def __init__(self, format: str, layout: str, rate: int):
        self.rate = rate

    def resample(self, frame):
        if frame is None:
            return []
        return [_Resampled(frame.pts, frame.time_base, Fraction(frame.samples, frame.sample_rate), self.rate, _Container.current_origin)]


class _Codec:
    sample_rate, name = INPUT_RATE, "labelled-stub-codec"


class _Stream:
    time_base = Fraction(1, 1000)
    codec_context = _Codec()

    def __init__(self, start_pts: int):
        self.start_time = start_pts


class _Streams:
    def __init__(self, stream: _Stream):
        self.audio = [stream]


class _Container:
    current_origin = Fraction(0)

    def __init__(self, path: str, control: dict):
        if Path(path).suffix.lower() == ".wav" and "duration_seconds" not in control:
            with wave.open(path, "rb") as handle:
                seconds = Fraction(handle.getnframes(), handle.getframerate())
        else:
            seconds = Fraction(str(control.get("duration_seconds", 60)))
        self._seconds, self._control, self._position = seconds, control, Fraction(0)
        self._origin = Fraction(str(control.get("origin_seconds", 0)))
        _Container.current_origin = self._origin
        self.start_time = int(self._origin * time_base)
        self.duration = int(seconds * time_base)
        self._stream = _Stream(int(self._origin / _Stream.time_base))
        self.streams = _Streams(self._stream)

    def __enter__(self) -> "_Container":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def seek(self, offset: int, stream=None, backward: bool = True, any_frame: bool = False) -> None:
        wanted = offset * stream.time_base - self._origin
        self._position = (wanted // FRAME) * FRAME  # the frame at or before the wanted time, as a backward seek does

    def decode(self, stream):
        position = self._position
        while position < self._seconds:
            length = min(FRAME, self._seconds - position)
            if not any(low <= float(position) < high for low, high in self._control.get("missing_audio", [])):
                yield _Frame(int((position + self._origin) / stream.time_base), stream.time_base, int(length * INPUT_RATE))
            position += FRAME


def open(path: str, mode: str = "r") -> _Container:  # noqa: A001 - PyAV's own name
    control = _control()
    if Path(path).name in control.get("undecodable", []):
        raise ValueError("LABELLED STUB: this file is declared undecodable by the test")
    return _Container(path, control)
