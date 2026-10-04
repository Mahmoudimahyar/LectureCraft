#!/usr/bin/env python3
"""One real local check contract for the application (LL037).

Every stage runs an actual tool and returns its real exit status; there is no echo/mock success.
The same entry point is used locally, by tools/build_board.py receipts and by the (unpushed)
GitHub workflow. Live native/Drive/writer/device acceptance is NOT part of this contract and is
reported by `lecture-brain acceptance` instead.

    python tools/ci.py                     # all stages
    python tools/ci.py --only brain web-unit
    python tools/ci.py --only brain -- brain/tests/test_contracts.py
    python tools/ci.py --task LL013        # the checks declared for one task in config/task-checks.json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def _node() -> str:
    node = shutil.which("node")
    if not node:
        raise SystemExit("node executable not found")
    return node


def _web(script: str, *args: str) -> list[str]:
    return [_node(), str(WEB / "node_modules" / script), *args]


def stages(extra: list[str]) -> dict[str, list[tuple[list[str], Path]]]:
    py = sys.executable
    return {
        # Retained kit checks: specification baseline, contract fixtures, handoff consistency.
        "kit": [
            ([py, "tools/check_baseline.py"], ROOT),
            ([py, "tools/check_contracts.py"], ROOT),
            ([py, "-m", "unittest", "discover", "-s", "tests/contracts"], ROOT),
            ([py, "-m", "unittest", "discover", "-s", "tests/handoff"], ROOT),
        ],
        "brain": [([py, "-m", "pytest", *(extra or ["brain/tests"])], ROOT)],
        # Application tooling (candidate packaging) and the dependency inventory against the real lock files.
        "tools": [
            ([py, "-m", "pytest", "tests/app", "-q", "-p", "no:cacheprovider"], ROOT),
            ([py, "tools/dependency_inventory.py", "--check"], ROOT),
        ],
        "web-types": [
            ([_node(), "scripts/gen-types.mjs", "--check"], WEB),
            ([_node(), "scripts/gen-tokens.mjs", "--check"], WEB),
            (_web("typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"), WEB),
        ],
        "web-unit": [(_web("vitest/vitest.mjs", "run", *extra), WEB)],
        "web-build": [(_web("vite/bin/vite.js", "build"), WEB)],
        "storybook": [(_web("storybook/dist/bin/dispatcher.js", "build", "-o", str(ROOT / ".local" / "storybook-static"), "--quiet"), WEB)],
        # Real browser against a fresh fixture-profile Brain on loopback, serving the app that was just built.
        "e2e": [
            (_web("vite/bin/vite.js", "build"), WEB),
            (_web("storybook/dist/bin/dispatcher.js", "build", "-o", str(ROOT / ".local" / "storybook-static"), "--quiet"), WEB),
            (_web("@playwright/test/cli.js", "test", *extra), WEB),
        ],
    }


def task_plan(task: str) -> list[tuple[str, list[str]]]:
    """The declared checks for one task: [(stage, extra args)]. '@flows' expands to the two flow projects."""
    declared = json.loads((ROOT / "config" / "task-checks.json").read_text(encoding="utf-8"))
    if task not in declared["tasks"]:
        raise SystemExit(f"No checks are declared for {task} in config/task-checks.json")
    plan = []
    for stage, extra in declared["tasks"][task]:
        expanded: list[str] = []
        for arg in extra:
            expanded.extend(declared["flow_projects"] if arg == "@flows" else [arg])
        plan.append((stage, expanded))
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="+", help="Stage names to run (default: all)")
    parser.add_argument("--task", help="Run the checks declared for this task id (config/task-checks.json)")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("extra", nargs=argparse.REMAINDER, help="Arguments after -- go to the single selected stage")
    args = parser.parse_args()
    extra = args.extra[1:] if args.extra[:1] == ["--"] else args.extra
    table = stages(extra)
    if args.list:
        print(json.dumps(sorted(table), indent=2))
        return 0
    if args.task:
        if args.only or extra:
            print("--task cannot be combined with --only or extra arguments", file=sys.stderr)
            return 2
        runs = [(stage, stages(stage_extra)[stage]) for stage, stage_extra in task_plan(args.task)]
    else:
        selected = args.only or list(table)
        unknown = [s for s in selected if s not in table]
        if unknown:
            print(f"Unknown stage(s): {unknown}; available: {sorted(table)}", file=sys.stderr)
            return 2
        if extra and len(selected) != 1:
            print("Extra arguments require exactly one --only stage", file=sys.stderr)
            return 2
        runs = [(name, table[name]) for name in selected]
    env = dict(os.environ, PYTHONIOENCODING="utf-8", CI="1", NO_COLOR="1")
    env.pop("FORCE_COLOR", None)
    summary = []
    failed = False
    for name, commands in runs:
        for argv, cwd in commands:
            start = time.monotonic()
            print(f"\n=== [{name}] {' '.join(argv[1:] if argv[0] in (sys.executable, _node()) else argv)}", flush=True)
            code = subprocess.run(argv, cwd=cwd, env=env, check=False).returncode
            summary.append({"stage": name, "command": argv[1:], "exit": code, "seconds": round(time.monotonic() - start, 1)})
            if code != 0:
                failed = True
                break
        if failed:
            break
    print("\n" + json.dumps({"status": "FAIL" if failed else "PASS", **({"task": args.task} if args.task else {}), "stages": summary,
                             "scope": "Local application checks only. Not live native/Drive/writer/device acceptance."}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
