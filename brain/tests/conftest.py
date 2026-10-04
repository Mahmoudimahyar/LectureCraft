from __future__ import annotations
from pathlib import Path
import json
import pytest

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def repo() -> Path:
    return REPO


@pytest.fixture()
def fixture_json():
    def load(name: str):
        return json.loads((REPO / "fixtures/contracts" / name).read_text(encoding="utf-8"))
    return load
