"""D50: a receipt may be bound to the inputs its check declares. It then stays current while those inputs are unchanged and
goes stale when one of them changes. A receipt recorded without a declared scope keeps the whole-tree rule."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_board", REPO / "tools" / "build_board.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)


def workspace(tmp_path: Path) -> Path:
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "implementation-plan.json").write_text(json.dumps({"version": 1, "scope": "test", "tasks": [
        {"id": "LL001", "title": "a", "dependencies": []}, {"id": "LL002", "title": "b", "dependencies": []}]}), encoding="utf-8")
    for name, text in {"brain/a.py": "A = 1\n", "web/b.ts": "export const b = 1;\n", "docs/readme.md": "notes\n"}.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text, encoding="utf-8")
    return tmp_path


def freshness(root: Path) -> dict[str, str]:
    return {task: row["test_freshness"] for task, row in board.status(root)["tasks"].items()}


def test_a_scoped_receipt_follows_its_declared_inputs_only(tmp_path):
    root = workspace(tmp_path)
    ok = [sys.executable, "-c", "print('checked')"]
    scoped = board.run_test(root, "LL001", ok, inputs=["brain/*", "config/implementation-plan.json"])
    whole = board.run_test(root, "LL002", ok)
    assert scoped["status"] == whole["status"] == "PASS"
    assert scoped["inputs_scope"] == ["brain/*", "config/implementation-plan.json"] and len(scoped["inputs_sha256"]) == 64 and "inputs_scope" not in whole
    assert freshness(root) == {"LL001": "CURRENT", "LL002": "CURRENT"}

    (root / "web" / "b.ts").write_text("export const b = 2;\n", encoding="utf-8")  # outside LL001's declared inputs
    assert freshness(root) == {"LL001": "CURRENT", "LL002": "STALE"}

    (root / "brain" / "a.py").write_text("A = 2\n", encoding="utf-8")  # inside them
    assert freshness(root) == {"LL001": "STALE", "LL002": "STALE"}


def test_a_new_file_inside_the_scope_makes_the_receipt_stale(tmp_path):
    root = workspace(tmp_path)
    board.run_test(root, "LL001", [sys.executable, "-c", "pass"], inputs=["brain/*"])
    (root / "brain" / "new.py").write_text("B = 1\n", encoding="utf-8")
    assert freshness(root)["LL001"] == "STALE"


def test_an_empty_or_unsafe_scope_is_refused(tmp_path):
    root = workspace(tmp_path)
    for bad in ([], ["../outside/*"], ["/abs"], ["C:/x"], ["nothing-matches/*"]):
        try:
            board.run_test(root, "LL001", [sys.executable, "-c", "pass"], inputs=bad)
        except ValueError:
            continue
        raise AssertionError(f"scope {bad!r} was accepted")


def test_every_declared_scope_in_the_repository_matches_files():
    declared = json.loads((REPO / "config" / "task-checks.json").read_text(encoding="utf-8"))
    scopes = declared.get("input_scopes", {})
    assert set(scopes) <= set(declared["tasks"])
    for task, patterns in scopes.items():
        assert patterns and board.scoped_fingerprint(REPO, patterns), task  # raises if a pattern matches nothing
