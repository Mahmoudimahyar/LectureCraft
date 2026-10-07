"""The benchmark record of the slide-matching method (R2-T6): an optional private file of ONE installation.

``<state_dir>/benchmarks/alignment.json``, contract ``ll.alignment-benchmark/1``::

    {"contract": "ll.alignment-benchmark/1",
     "method": {"name": "lexical-sequence", "version": "2"},     # the method that was compared, exactly as a range names it
     "baseline": {"name": "lexical-monotone-baseline"},          # what it was compared with
     "compared_on": "…",                                         # in words: which labelled references
     "labelled_windows": 120,                                    # how many labelled windows both were scored on
     "result": "better" | "not_clearly_better" | "worse",       # the method against the baseline
     "thresholds_fixed_before_reading_answers": true,
     "produced_at": "2026-10-06T08:00:00Z",
     "note": "…"}

This module only READS that file. It is written by whoever ran the comparison, outside the app; nothing here creates,
completes or repairs it. A file that does not have exactly this shape is reported as unreadable and treated as absent:
then no suggestion is called benchmarked.

What a suggestion may say (:func:`statement`): ``benchmarked`` only when the record names exactly the suggestion's
method name AND version, with the record's result; otherwise ``not_benchmarked`` with the reason — no record, an
unreadable one, a record for another method or version, or the suggestion comes from the baseline itself. A link a
person entered and a range the course itself states are not a method's suggestion: ``not_applicable``.

A benchmark compares a METHOD with the baseline on labelled references. It reviews no range: nothing here changes a
range's review state, and no word here calls a suggestion aligned, verified or confirmed.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
from typing import Any

from . import contracts as c

CONTRACT = "ll.alignment-benchmark/1"
RESULTS = ("better", "not_clearly_better", "worse")
MAX_BYTES = 64 * 1024
DIRECTORY, FILENAME = "benchmarks", "alignment.json"
#: The name the app's own lexical baseline carries (``alignment.BASELINE_METHOD`` before its slash).
APP_BASELINE_NAME = "lexical-monotone-baseline"
ABSENT: dict[str, Any] = {"state": "absent", "detail": None, "record": None, "sha256": None}

_KEYS = ("contract", "method", "baseline", "compared_on", "labelled_windows", "result", "thresholds_fixed_before_reading_answers", "produced_at", "note")
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_NOT_A_SUGGESTION = {"manual": "entered_by_a_person", "reviewed_source_map": "stated_by_the_course"}


def path(settings: Any) -> Path:
    return Path(settings.state_dir) / DIRECTORY / FILENAME


def _name(value: Any, what: str) -> str:
    if not isinstance(value, str) or not _NAME.match(value):
        raise ValueError(f"{what} must be a short plain identifier")
    return value


def _line(value: Any, what: str, *, limit: int, may_be_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError(f"{what} must be one line of text of at most {limit} characters")
    if not may_be_empty and not value.strip():
        raise ValueError(f"{what} must say something")
    return value


def parse(data: bytes) -> dict[str, Any]:
    """The record a file's bytes state, without its ``contract``. Raises ``ValueError`` saying what is wrong; never repairs."""
    if len(data) > MAX_BYTES:
        raise ValueError(f"the file is larger than {MAX_BYTES} bytes")
    try:
        document = c.parse_json(data, max_bytes=MAX_BYTES)
    except Exception as exc:  # noqa: BLE001 - whatever the strict reader says, the file is not a record
        raise ValueError(f"not valid JSON ({exc})") from None
    if not isinstance(document, dict):
        raise ValueError("the file is not a JSON object")
    if document.get("contract") != CONTRACT:
        raise ValueError(f"contract must be {CONTRACT}")
    missing, extra = [key for key in _KEYS if key not in document], sorted(key for key in document if key not in _KEYS)
    if missing or extra:
        raise ValueError("; ".join(([f"missing: {', '.join(missing)}"] if missing else []) + ([f"not part of the contract: {', '.join(extra)}"] if extra else [])))
    method, baseline = document["method"], document["baseline"]
    if not isinstance(method, dict) or set(method) != {"name", "version"}:
        raise ValueError("method must be exactly {name, version}")
    if not isinstance(baseline, dict) or set(baseline) != {"name"}:
        raise ValueError("baseline must be exactly {name}")
    record = {"method": {"name": _name(method["name"], "method.name"), "version": _name(method["version"], "method.version")},
              "baseline": {"name": _name(baseline["name"], "baseline.name")}}
    if record["baseline"]["name"] == record["method"]["name"]:
        raise ValueError("method and baseline carry the same name: a method is not compared with itself")
    record["compared_on"] = _line(document["compared_on"], "compared_on", limit=200)
    windows = document["labelled_windows"]
    if type(windows) is not int or windows < 1:
        raise ValueError("labelled_windows must be a whole number of at least 1")
    record["labelled_windows"] = windows
    if document["result"] not in RESULTS:
        raise ValueError(f"result must be one of {', '.join(RESULTS)}")
    record["result"] = document["result"]
    if type(document["thresholds_fixed_before_reading_answers"]) is not bool:
        raise ValueError("thresholds_fixed_before_reading_answers must be true or false")
    record["thresholds_fixed_before_reading_answers"] = document["thresholds_fixed_before_reading_answers"]
    produced = document["produced_at"]
    if not isinstance(produced, str) or not _TIME.match(produced):
        raise ValueError("produced_at must be a UTC time like 2026-10-06T08:00:00Z")
    try:
        datetime.strptime(produced, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise ValueError("produced_at is not a date that exists") from None
    record["produced_at"] = produced
    record["note"] = _line(document["note"], "note", limit=1000, may_be_empty=True)
    return record


def read(settings: Any) -> dict[str, Any]:
    """``{state: "absent" | "present" | "unreadable", detail, record, sha256}`` of this installation's record. Reads only."""
    source = path(settings)
    try:
        if not source.exists():
            return dict(ABSENT)
        if not source.is_file():
            return {"state": "unreadable", "detail": "the record's place holds something that is not a file", "record": None, "sha256": None}
        if source.stat().st_size > MAX_BYTES:
            return {"state": "unreadable", "detail": f"the file is larger than {MAX_BYTES} bytes", "record": None, "sha256": None}
        data = source.read_bytes()
    except OSError as exc:
        return {"state": "unreadable", "detail": f"the file could not be read ({type(exc).__name__})", "record": None, "sha256": None}
    try:
        record = parse(data)
    except ValueError as exc:
        return {"state": "unreadable", "detail": str(exc)[:300], "record": None, "sha256": None}
    return {"state": "present", "detail": None, "record": record, "sha256": c.sha256_hex(data)}


def _method(method: Any) -> dict[str, Any] | None:
    if not isinstance(method, dict) or not isinstance(method.get("name"), str) or not method["name"]:
        return None
    version = method.get("version")
    return {"name": method["name"], "version": version if isinstance(version, str) and version else None}


def _nothing(state: str, reason: str, method: dict | None) -> dict[str, Any]:
    return {"state": state, "reason": reason, "method": method, "baseline": None, "compared_on": None, "labelled_windows": None, "result": None,
            "thresholds_fixed_before_reading_answers": None, "produced_at": None}


def statement(readback: dict[str, Any] | None, method: Any, origin: str | None) -> dict[str, Any]:
    """What ONE range may say about a benchmark of what made it. ``readback`` is what :func:`read` returned (``None``:
    nothing was read, which is no record); ``method`` is the range's own ``{name, version}``; ``origin`` its origin.
    Pure. ``method`` in the result is always the range's own method, never the record's."""
    named = _method(method)
    if origin in _NOT_A_SUGGESTION:
        return _nothing("not_applicable", _NOT_A_SUGGESTION[origin], named)
    if named is None:
        return _nothing("not_benchmarked", "no_method_named", None)
    record = (readback or {}).get("record") if (readback or {}).get("state") == "present" else None
    if named["name"] == APP_BASELINE_NAME or (record is not None and named["name"] == record["baseline"]["name"]):
        return _nothing("not_benchmarked", "is_the_baseline", named)
    if record is None:
        return _nothing("not_benchmarked", "record_unreadable" if (readback or {}).get("state") == "unreadable" else "no_record", named)
    if named["name"] != record["method"]["name"]:
        return _nothing("not_benchmarked", "record_is_for_another_method", named)
    if named["version"] != record["method"]["version"]:
        return _nothing("not_benchmarked", "record_is_for_another_version", named)
    return {"state": "benchmarked", "reason": None, "method": named, "baseline": dict(record["baseline"]), "compared_on": record["compared_on"],
            "labelled_windows": record["labelled_windows"], "result": record["result"],
            "thresholds_fixed_before_reading_answers": record["thresholds_fixed_before_reading_answers"], "produced_at": record["produced_at"]}


def installation(readback: dict[str, Any] | None, current_method: Any) -> dict[str, Any]:
    """For the readback of an installation: where its record stands, what it states (as written, without the contract
    name), the method the app matches with now and what the record says about THAT method."""
    readback = readback or ABSENT
    record = readback.get("record") if readback.get("state") == "present" else None
    return {"record": readback.get("state") if readback.get("state") in {"present", "unreadable"} else "absent", "detail": readback.get("detail"),
            "recorded": None if record is None else {**record, "method": dict(record["method"]), "baseline": dict(record["baseline"])},
            "current_method": _method(current_method), "statement": statement(readback, current_method, "pipeline")}
