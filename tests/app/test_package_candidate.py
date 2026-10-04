"""LL038 (local facet): a private candidate package that is reproducible, verifiable and honestly labeled."""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import package_candidate as pc  # noqa: E402


@pytest.fixture()
def tree(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    files = {
        "brain/src/lecture_brain/__init__.py": "__version__ = '0.1.0a1'\n",
        "brain/requirements.lock": "fastapi==1.0 --hash=sha256:" + "a" * 64 + "\n",
        "web/package-lock.json": "{}\n",
        "contracts/v1/common.schema.json": "{}\n",
        "docs/delivery/activation-gates.json": json.dumps({"status": "x", "gates": [{"id": "NATIVE_PROBE", "state": "NOT_CLEARED", "required": "r", "evidence": []},
                                                                                     {"id": "BUILD_SCOPE", "state": "CLEARED", "required": "r", "evidence": ["e"]}]}),
        "IMPLEMENTATION.json": json.dumps({"package_version": "0.10.0", "specification_baseline": "0.9.0"}),
        "web/dist/index.html": "<!doctype html>",
        "web/dist/assets/app.js": "export {};",
        ".env": "SECRET=1\n",
        ".local/state/journal.sqlite": "private",
        "web/node_modules/x/index.js": "x",
        "config/local-bindings/workspace.json": "{\"planner_config\": \"G:/private\"}",
    }
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    return root


TRACKED = ["brain/src/lecture_brain/__init__.py", "brain/requirements.lock", "web/package-lock.json", "contracts/v1/common.schema.json",
           "docs/delivery/activation-gates.json", "IMPLEMENTATION.json"]


def _build(tree: Path, out: Path, **kw):
    return pc.build(tree, out, tracked=TRACKED, commit="c" * 40, dirty=kw.pop("dirty", False), board=kw.pop("board", {"complete": True, "counts": {"LOCAL_TESTED": 38}}), **kw)


def test_archive_is_reproducible_and_contains_only_source_and_built_static(tree, tmp_path):
    first = _build(tree, tmp_path / "out1")
    second = _build(tree, tmp_path / "out2")
    assert first["archive_sha256"] == second["archive_sha256"]  # same inputs, same bytes
    names = set(zipfile.ZipFile(first["archive"]).namelist())
    assert {"brain/src/lecture_brain/__init__.py", "static/index.html", "static/assets/app.js", "CANDIDATE.json", "SHA256SUMS"} <= names
    # Nothing private or machine-local is ever packaged, even if it sits in the working tree.
    assert not any(n.startswith((".local/", "web/node_modules/", "config/local-bindings/")) or n == ".env" for n in names)


def test_label_never_claims_a_release_while_a_live_gate_is_uncleared(tree, tmp_path):
    manifest = _build(tree, tmp_path / "out")
    assert manifest["label"] == "integration-blocked-candidate"
    assert manifest["gates"]["not_cleared"] == ["NATIVE_PROBE"]
    assert "stable" not in json.dumps(manifest).lower()
    assert "not a release" in manifest["statement"].lower()

    dirty = _build(tree, tmp_path / "dirty", dirty=True)
    assert dirty["label"] == "integration-blocked-candidate-dirty-tree"
    incomplete = _build(tree, tmp_path / "inc", board={"complete": False, "counts": {"LOCAL_TESTED": 30, "TODO": 8}})
    assert incomplete["label"] == "local-checks-incomplete"

    gates = tree / "docs/delivery/activation-gates.json"
    data = json.loads(gates.read_text(encoding="utf-8"))
    data["gates"][0]["state"] = "CLEARED"
    gates.write_text(json.dumps(data), encoding="utf-8")
    cleared = _build(tree, tmp_path / "cleared")
    assert cleared["label"] == "release-candidate-awaiting-approval"  # still never self-approved


def test_verify_extracts_and_detects_any_changed_or_missing_file(tree, tmp_path):
    manifest = _build(tree, tmp_path / "out")
    ok = pc.verify(Path(manifest["archive"]), tmp_path / "x1")
    assert ok["ok"], ok["problems"]
    assert ok["files"] == manifest["file_count"]

    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(manifest["archive"]) as src, zipfile.ZipFile(tampered, "w") as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "brain/requirements.lock":
                data += b"evil==1.0\n"
            if item.filename == "static/assets/app.js":
                continue  # dropped
            dst.writestr(item, data)
    bad = pc.verify(tampered, tmp_path / "x2")
    assert not bad["ok"]
    assert any("brain/requirements.lock" in p and "digest" in p for p in bad["problems"])
    assert any("static/assets/app.js" in p and "missing" in p for p in bad["problems"])


def test_manifest_pins_what_a_release_must_name(tree, tmp_path):
    manifest = _build(tree, tmp_path / "out")
    assert manifest["commit"] == "c" * 40
    assert manifest["specification_baseline"] == "0.9.0"
    assert set(manifest["locks"]) == {"brain/requirements.lock", "web/package-lock.json"}
    assert all(len(v) == 64 for v in manifest["locks"].values())
    assert len(manifest["contracts_sha256"]) == 64
    assert manifest["static_built"] is True
    assert manifest["residual_blockers"]  # every uncleared gate is named with what it requires


def test_board_summary_uses_the_ledgers_own_words_for_a_current_receipt():
    """The build board reports a receipt on the unchanged tree as CURRENT (not FRESH); only that counts as complete."""
    def status(freshness: str, state: str = "LOCAL_TESTED") -> dict:
        return {"counts": {"LOCAL_TESTED": 2}, "tasks": {"LL001": {"state": "LOCAL_TESTED", "test_freshness": "CURRENT"}, "LL002": {"state": state, "test_freshness": freshness}}}

    assert pc.summarize_board(status("CURRENT")) == {"complete": True, "counts": {"LOCAL_TESTED": 2}, "stale_or_missing": []}
    for freshness in ("STALE", "NOT_RUN", "INVALID"):
        assert pc.summarize_board(status(freshness))["complete"] is False
        assert pc.summarize_board(status(freshness))["stale_or_missing"] == ["LL002"]
    assert pc.summarize_board(status("CURRENT", state="IN_PROGRESS"))["complete"] is False
