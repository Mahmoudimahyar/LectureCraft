"""REHEARSAL HARNESS (labeled): the pilot profile on SYNTHETIC courses with the protocol double as the worker.

Serves the same loopback app as `lecture-brain --profile pilot serve`, but the pilot adapter's worker process is
`fake_app_server.py` — no Codex, no account, no inference. It exists so the browser path of the pilot can be driven
end to end before a single real turn is spent.

    python brain/tests/serve_pilot_double.py <port> <state-dir>
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "brain" / "src"))

import uvicorn  # noqa: E402

from lecture_brain.api import create_app  # noqa: E402
from lecture_brain.config import load_settings  # noqa: E402
from lecture_brain.fixtures.builder import ensure_fixture_workspace  # noqa: E402
from lecture_brain.native.pilot import PilotWorkerAdapter  # noqa: E402
from lecture_brain.runtime import Runtime  # noqa: E402

port, state = int(sys.argv[1]), Path(sys.argv[2]).resolve()
os.environ["LL_FAKE_STATE"] = str(state / "double-state.json")
planner = ensure_fixture_workspace(REPO / ".local" / "fixture-workspace")
settings = load_settings("pilot", env={}, planner_config=planner, state_dir=state,
                         pilot={"label": "Experimental Codex worker tutor", "courses": ["be505"], "max_threads": 1, "max_turns": 4})
settings.native_binding = {"adapter": "codex-app-server", "executable": sys.executable, "sandbox": "read-only", "approval_policy": "never"}
runtime = Runtime(settings)
adapter = PilotWorkerAdapter(settings, argv_prefix=[sys.executable, str(HERE / "fake_app_server.py"), "normal", "-"])
runtime.adapter = runtime.coordinator.adapter = adapter
print(json.dumps({"rehearsal": True, "worker": "labeled protocol double", "startup": runtime.startup(), "url": f"http://127.0.0.1:{port}/"}), flush=True)
runtime.start_supervisor()
uvicorn.run(create_app(runtime, static_dir=REPO / "web" / "dist"), host="127.0.0.1", port=port, log_level="warning")
