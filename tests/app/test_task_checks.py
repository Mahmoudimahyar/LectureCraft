"""Every task in the implementation plan declares real local checks, and they point at things that exist."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import ci  # noqa: E402

PLAN = json.loads((ROOT / "config/implementation-plan.json").read_text(encoding="utf-8"))
CHECKS = json.loads((ROOT / "config/task-checks.json").read_text(encoding="utf-8"))


def test_all_38_tasks_declare_checks_and_only_known_stages():
    task_ids = {task["id"] for task in PLAN["tasks"]}
    assert len(task_ids) == 38 and set(CHECKS["tasks"]) == task_ids
    stages = set(ci.stages([]))
    for task, checks in CHECKS["tasks"].items():
        assert checks, task
        assert {stage for stage, _ in checks} <= stages, task
        assert sum(1 for stage, _ in checks if stage == "e2e") <= 1, f"{task}: one browser run per task"


def test_declared_check_targets_exist():
    for task, checks in CHECKS["tasks"].items():
        for stage, extra in checks:
            for arg in extra:
                if arg.startswith("brain/tests/"):
                    assert (ROOT / arg).is_file(), f"{task}: {arg}"
                elif arg.startswith("tests/"):
                    assert (ROOT / "web" / arg).exists(), f"{task}: web/{arg}"
                elif arg.startswith("flows/"):
                    assert list((ROOT / "web/e2e/flows").glob(arg.split("/", 1)[1] + "*.spec.ts")), f"{task}: {arg}"


def test_flow_placeholder_expands_to_both_layouts_without_cross_project_dependencies():
    plan = dict(ci.task_plan("LL010"))
    assert plan["e2e"] == ["flows/01-access", "--project=flows-desktop-light", "--project=flows-phone-dark", "--no-deps"]


def test_every_ui_task_has_a_browser_check():
    """Tasks whose features are UI flows must be backed by a real-browser run, not only by unit tests."""
    ui_tasks = {"LL005", "LL010", "LL011", "LL012", "LL013", "LL016", "LL022", "LL023", "LL024", "LL026", "LL027", "LL028", "LL029", "LL030", "LL031", "LL032", "LL033", "LL034"}
    for task in ui_tasks:
        assert any(stage == "e2e" for stage, _ in CHECKS["tasks"][task]), task


def test_the_app_can_be_built_into_another_folder_so_a_running_server_keeps_the_build_it_serves(monkeypatch, tmp_path):
    """By default the build goes to web/dist. With LL_WEB_DIST it goes elsewhere and the browser tests are told to
    serve that folder, so checking a new build never swaps the files under a server that is serving the old one."""
    monkeypatch.delenv("LL_WEB_DIST", raising=False)
    monkeypatch.delenv("LL_E2E_DIST", raising=False)
    default = ci.stages([])
    assert "--outDir" not in default["web-build"][0][0] and "--outDir" not in default["e2e"][0][0]
    assert ci.stage_environment() == {}
    monkeypatch.setenv("LL_WEB_DIST", ".local/build/dist-check")
    moved = ci.stages([])
    for stage in ("web-build", "e2e"):
        argv = moved[stage][0][0]
        assert argv[argv.index("--outDir") + 1] == str(ci.ROOT / ".local" / "build" / "dist-check") and "--emptyOutDir" in argv
    assert ci.stage_environment() == {"LL_E2E_DIST": ".local/build/dist-check"}
    monkeypatch.setenv("LL_WEB_DIST", str(tmp_path / "outside"))
    try:
        ci.stages([])
    except SystemExit as refused:
        assert "inside the repository" in str(refused)
    else:
        raise AssertionError("a build folder outside the repository was accepted")
