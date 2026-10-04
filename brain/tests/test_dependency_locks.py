"""LL002: reproducible locks — every pin has hashes and the running environment matches the lock."""
from __future__ import annotations

import json
import re
from importlib import metadata


def _pins(path):
    pins = {}
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", line)
        if m:
            current = m.group(1).lower().replace("_", "-")
            pins[current] = {"version": m.group(2), "hashes": 0}
        elif current and "--hash=sha256:" in line:
            pins[current]["hashes"] += 1
    return pins


def test_python_locks_are_hashed_and_installed_exactly(repo):
    runtime = _pins(repo / "brain/requirements.lock")
    dev = _pins(repo / "brain/requirements-dev.lock")
    assert {"fastapi", "sqlalchemy", "alembic", "jsonschema", "cryptography", "fsrs", "pyyaml", "pypdf", "uvicorn"} <= set(runtime)
    assert {"pytest", "httpx"} <= set(dev)
    for name, pin in {**dev, **runtime}.items():
        assert pin["hashes"] >= 1, f"{name} has no hash"
        assert metadata.version(name) == pin["version"], f"{name} installed version differs from lock"


def test_web_lock_pins_selected_stack_with_integrity(repo):
    lock = json.loads((repo / "web/package-lock.json").read_text(encoding="utf-8"))
    package = json.loads((repo / "web/package.json").read_text(encoding="utf-8"))
    assert lock["lockfileVersion"] >= 3
    selected = ["react", "react-router", "@tanstack/react-query", "idb", "pdfjs-dist", "media-chrome", "katex", "lucide-react", "motion", "radix-ui", "ajv", "tailwindcss", "vite", "vitest", "@playwright/test", "@axe-core/playwright"]
    declared = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    for name in selected:
        assert name in declared, name
        entry = lock["packages"][f"node_modules/{name}"]
        assert entry["version"] and entry["integrity"].startswith("sha512-"), name
    without = [k for k, v in lock["packages"].items() if k and not v.get("integrity") and not v.get("link")]
    assert without == []


def test_no_hosted_llm_sdk_or_second_framework(repo):
    package = json.loads((repo / "web/package.json").read_text(encoding="utf-8"))
    declared = set({**package.get("dependencies", {}), **package.get("devDependencies", {})})
    forbidden = {"openai", "@anthropic-ai/sdk", "next", "redux", "@reduxjs/toolkit", "gsap", "lottie-web", "zod", "streamlit"}
    assert not (declared & forbidden)
    runtime = set(_pins(repo / "brain/requirements.lock"))
    assert not (runtime & {"openai", "anthropic", "celery", "redis", "streamlit"})
