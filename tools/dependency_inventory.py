#!/usr/bin/env python3
"""Record exact resolved dependency versions, integrity hashes and declared licenses (LL002).

Reads the committed lock files (brain/requirements*.lock, web/package-lock.json) and, when
available, the installed package metadata in this interpreter and web/node_modules. It installs
nothing and makes no network request. A declared license string is the package's own metadata,
not a legal review.

    python tools/dependency_inventory.py --write    # refresh docs/engineering/dependency-inventory.json
    python tools/dependency_inventory.py --check    # fail if the committed inventory is stale
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/engineering/dependency-inventory.json"
DIRECT_PY = ROOT / "brain/requirements.in"
DIRECT_PY_DEV = ROOT / "brain/requirements-dev.in"


def _lock_entries(path: Path) -> dict[str, dict]:
    entries: dict[str, dict] = {}
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", line)
        if match:
            current = match.group(1).lower().replace("_", "-")
            entries[current] = {"version": match.group(2), "sha256_count": 0}
        elif current and "--hash=sha256:" in line:
            entries[current]["sha256_count"] += 1
    return entries


def _direct(path: Path) -> list[str]:
    names = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "-")):
            names.append(re.split(r"[<>=\[ ]", line)[0].lower())
    return names


def _py_license(name: str) -> str:
    try:
        meta = metadata.metadata(name)
    except metadata.PackageNotFoundError:
        return "NOT_INSTALLED_IN_THIS_INTERPRETER"
    expr = meta.get("License-Expression")
    if expr:
        return expr
    classifiers = [c.split("::")[-1].strip() for c in meta.get_all("Classifier", []) if c.startswith("License ::")]
    if classifiers:
        return "; ".join(sorted(set(classifiers)))
    text = (meta.get("License") or "").strip().splitlines()
    return text[0][:80] if text else "UNDECLARED"


def python_inventory() -> dict:
    runtime = _lock_entries(ROOT / "brain/requirements.lock")
    dev = _lock_entries(ROOT / "brain/requirements-dev.lock")
    direct = set(_direct(DIRECT_PY))
    direct_dev = set(_direct(DIRECT_PY_DEV))

    def rows(entries, direct_names):
        return [
            {"name": n, "version": e["version"], "direct": n in direct_names, "lock_sha256_hashes": e["sha256_count"], "declared_license": _py_license(n)}
            for n, e in sorted(entries.items())
        ]

    return {
        "interpreter_requirement": ">=3.13",
        "registry": "https://pypi.org/simple (pip-compile --generate-hashes)",
        "lock_files": {
            "brain/requirements.lock": hashlib.sha256((ROOT / "brain/requirements.lock").read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
            "brain/requirements-dev.lock": hashlib.sha256((ROOT / "brain/requirements-dev.lock").read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
        },
        "runtime": rows(runtime, direct),
        "development_only": rows({k: v for k, v in dev.items() if k not in runtime}, direct_dev),
    }


def web_inventory() -> dict:
    lock_path = ROOT / "web/package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    root = lock["packages"][""]
    direct = set(root.get("dependencies", {})) | set(root.get("devDependencies", {}))
    dev_direct = set(root.get("devDependencies", {}))
    rows = []
    missing_integrity = 0
    for key, pkg in sorted(lock["packages"].items()):
        if not key:
            continue
        name = key.split("node_modules/")[-1]
        if not pkg.get("integrity") and not pkg.get("link"):
            missing_integrity += 1
        if name in direct and key == f"node_modules/{name}":
            rows.append({"name": name, "version": pkg["version"], "dev": name in dev_direct, "integrity": pkg.get("integrity"), "declared_license": pkg.get("license", "UNDECLARED")})
    licenses: dict[str, int] = {}
    for key, pkg in lock["packages"].items():
        if key:
            lic = pkg.get("license", "UNDECLARED")
            licenses[lic] = licenses.get(lic, 0) + 1
    return {
        "registry": "https://registry.npmjs.org (npm lockfileVersion %s)" % lock.get("lockfileVersion"),
        "lock_files": {"web/package-lock.json": hashlib.sha256(lock_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()},
        "direct": rows,
        "total_locked_packages": len(lock["packages"]) - 1,
        "packages_without_integrity": missing_integrity,
        "license_counts_all_locked": dict(sorted(licenses.items())),
    }


def build() -> dict:
    return {
        "version": 1,
        "scope": "Exact resolved versions and integrity hashes from committed locks. Declared licenses are package metadata, not legal review. Compatibility is established only by the tests that ran.",
        "python": python_inventory(),
        "web": web_inventory(),
        "generated_component_sources": [
            {"component": "web/src/components/ui/*", "origin": "Hand-written in this repository on top of the radix-ui package primitives following the shadcn/ui composition pattern; no shadcn registry code was copied, so there is no upstream component revision to pin."},
            {"component": "web/src/contracts/generated/*", "origin": "Generated by web/scripts/gen-types.mjs from contracts/v1 (digest recorded in generated/meta.ts)."},
        ],
        "not_installed": ["Seed runtime (source archive unavailable)", "local transcription models", "LibreOffice", "Storybook hosted services"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.write:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {OUT.relative_to(ROOT).as_posix()}")
        return 0
    current = OUT.read_text(encoding="utf-8").replace("\r\n", "\n") if OUT.exists() else ""
    if current != text:
        print("dependency inventory is stale; run: python tools/dependency_inventory.py --write", file=sys.stderr)
        return 1
    print("dependency inventory is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
