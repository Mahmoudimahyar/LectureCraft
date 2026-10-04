from __future__ import annotations

from pathlib import Path
import json
import shutil

import pytest

REPO = Path(__file__).resolve().parents[2]
OWNER_SCHEMAS = REPO / ".local" / "academic-reference" / "schemas"


@pytest.fixture(scope="session")
def repo() -> Path:
    return REPO


@pytest.fixture()
def fixture_json():
    def load(name: str):
        return json.loads((REPO / "fixtures/contracts" / name).read_text(encoding="utf-8"))

    return load


@pytest.fixture(scope="session")
def _fixture_template(tmp_path_factory) -> Path:
    from lecture_brain.fixtures.builder import build_fixture_workspace

    root = tmp_path_factory.mktemp("fixture-template")
    build_fixture_workspace(root)
    return root


@pytest.fixture()
def workspace(tmp_path, _fixture_template) -> Path:
    """A private, writable copy of the synthetic workspace for one test."""
    target = tmp_path / "ws"
    shutil.copytree(_fixture_template, target)
    # planner-config.yaml carries absolute roots: repoint them at the copy.
    config = target / "University" / "Fixture Brain" / "planner-config.yaml"
    config.write_text(config.read_text(encoding="utf-8").replace(_fixture_template.as_posix(), target.as_posix()), encoding="utf-8")
    return target


@pytest.fixture()
def settings(workspace, tmp_path):
    from lecture_brain.config import load_settings

    return load_settings("fixture", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")


@pytest.fixture()
def be505(settings) -> Path:
    return settings.course("be505").root


class FakeClock:
    def __init__(self, start: float = 1_800_000_000.0):
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture()
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture(scope="session")
def owner_learning_schema():
    """The owner's real course-learning-v1 schema, when the permitted private snapshot is present."""
    path = OWNER_SCHEMAS / "course-learning.schema.json"
    if not path.is_file():
        pytest.skip("Owner schema snapshot (.local/academic-reference) not present: real-schema compatibility NOT verified here")
    return json.loads(path.read_text(encoding="utf-8"))
