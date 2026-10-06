"""LABELLED TEST LAUNCHER. It runs the REAL worker script (``lecture_brain/speech/worker.py``), unchanged, with the
LABELLED STUB modules in ``speech_runtime/`` standing in for ``av``, ``numpy`` and ``faster_whisper``.

No speech runtime is involved: no model is loaded, no audio is decoded and nothing is recognised. What runs for real
is every line of the worker's own control flow — the job file, the limits it enforces, the source check, the decode
loop's time mapping, the repetition check, the second pass and the choice between the passes, the heartbeat, the
lease, the stop file, the deadline, the hard stop, the result files and the exit codes.

    <python> -B real_worker_with_stubs.py --job <job.json>

The supervisor strips ``PYTHONPATH`` from its child's environment, so the stubs are put on the import path here.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKER = HERE.parents[1] / "src" / "lecture_brain" / "speech" / "worker.py"

if __name__ == "__main__":
    sys.path.insert(0, str(HERE / "speech_runtime"))
    sys.argv = [str(WORKER), *sys.argv[1:]]
    runpy.run_path(str(WORKER), run_name="__main__")
