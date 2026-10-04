"""LL034: the 32 UI flows and 24 global UI cases are mapped to tests that actually exist."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "docs/project/experience-spec.json").read_text(encoding="utf-8"))
GLOBAL = json.loads((ROOT / "docs/project/ui-global-acceptance.json").read_text(encoding="utf-8"))
TRACE = json.loads((ROOT / "docs/implementation/ui-test-traceability.json").read_text(encoding="utf-8"))
TITLE = re.compile(r"""\btest\(\s*(["'`])((?:\\.|(?!\1).)*)\1""")


def _titles(path: Path) -> list[str]:
    return [m.group(2) for m in TITLE.finditer(path.read_text(encoding="utf-8"))]


def test_every_ui_flow_has_at_least_one_browser_test_named_for_it():
    flow_ids = {flow["id"] for flow in SPEC["flows"]}
    assert len(flow_ids) == 32
    covered: dict[str, list[str]] = {}
    for rel in TRACE["flows"]["files"]:
        for title in _titles(ROOT / rel):
            for flow_id in re.findall(r"\bUI\d{2}\b", title):
                covered.setdefault(flow_id, []).append(title)
    assert flow_ids - set(covered) == set(), f"flows without a browser test: {sorted(flow_ids - set(covered))}"
    assert set(covered) - flow_ids == set(), "a test names a flow that is not in the specification"


def test_flow_tests_run_in_a_light_and_a_dark_project():
    config = (ROOT / "web/playwright.config.ts").read_text(encoding="utf-8")
    assert 'viewport("flows-desktop-light", 1280, 800, "light")' in config
    assert 'viewport("flows-phone-dark", 390, 844, "dark"' in config
    for width in (360, 390, 768, 1280, 1440):
        assert f"sweep-{width}-${{scheme}}" in config  # every required viewport, both schemes


def test_every_global_case_is_mapped_to_existing_test_text():
    case_ids = {case["id"] for case in GLOBAL["cases"]}
    assert len(case_ids) == 24
    assert set(TRACE["global_cases"]) == case_ids
    for case_id, entry in TRACE["global_cases"].items():
        assert entry["how"].strip() and entry["tests"], case_id
        for rel, needle in entry["tests"]:
            path = ROOT / rel
            assert path.is_file(), f"{case_id}: {rel} does not exist"
            assert needle in path.read_text(encoding="utf-8"), f"{case_id}: {rel} does not contain {needle!r}"
