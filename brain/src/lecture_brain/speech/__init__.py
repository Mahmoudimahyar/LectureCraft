"""Speech timing for recordings: the adapter for the offline producer's bundle, and the one resumable runner.

* ``producer_bundle`` — reads a bundle written by the offline timing producer (``private-timing-output-manifest-v1``)
  and maps it to this app's ``ll.derived-manifest/1`` generation. It runs nothing and changes nothing in the bundle.
* ``chunks`` — pure functions: the fixed chunk plan of a recording and the deterministic merge of chunk results.
* ``ledger`` — the durable allowance ledger (cumulative processing wall time, never reset).
* ``runner`` — the supervisor: frozen queue, one child worker, publication of prefixes into the derived store, status.
* ``worker`` — a standalone script for the EXTERNAL speech interpreter. Nothing in this package imports a speech
  library; the supervisor only launches that script.

Nothing here is scheduled, started at import, or wired into the source-refresh path. The functions below load the
runner only when they are called, so importing the importer does not load the supervisor.
"""
from __future__ import annotations

from typing import Any


def status(settings: Any, **kwargs: Any) -> dict[str, Any]:
    """Per course and per recording: state, seconds covered, chunks done, allowance used and remaining, resume command."""
    from .runner import status as _status

    return _status(settings, **kwargs)


def run(settings: Any, journal: Any, **kwargs: Any) -> dict[str, Any]:
    """One bounded run of the resumable transcription runner. See :func:`lecture_brain.speech.runner.run`."""
    from .runner import run as _run

    return _run(settings, journal, **kwargs)
