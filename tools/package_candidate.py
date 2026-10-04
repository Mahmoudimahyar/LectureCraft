#!/usr/bin/env python3
"""Build and verify a PRIVATE candidate package of the implemented application (LL038, local facet).

The package is a reproducible zip of the tracked source plus the built static web app, with a manifest
that pins commit, specification baseline, wire contracts and dependency locks, and that lists every
original release gate still uncleared. It is never published, tagged or called a release by this
tool: while any live gate is uncleared the label is `integration-blocked-candidate`, and even with
every gate cleared the most it says is `release-candidate-awaiting-approval`.

    python tools/package_candidate.py --out .local/release            # build + verify + extract smoke
    python tools/package_candidate.py --verify path/to/candidate.zip  # verify an existing archive
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Never packaged, whatever the caller lists: machine-local state, bindings to real folders, secrets, caches.
PRIVATE_PREFIXES = (".local/", ".seed-local/", ".venv/", ".git/", "config/local-bindings/", "web/node_modules/", "web/dist/", "web/.vite/")
PRIVATE_NAMES = (".env",)
PRIVATE_SUFFIXES = (".sqlite", ".db", ".log", ".pyc")
LOCKS = ("brain/requirements.lock", "web/package-lock.json")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # constant entry timestamps keep the archive byte-reproducible
STATEMENT = ("Private candidate of locally implemented and locally tested code. NOT a release and NOT live-accepted: "
             "the residual blockers below are original release gates that only the owner can clear with real evidence.")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _private(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return rel.startswith(PRIVATE_PREFIXES) or (name.startswith(PRIVATE_NAMES) and name != ".env.example") or rel.endswith(PRIVATE_SUFFIXES)


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True).stdout
    return sorted(p for p in out.decode("utf-8").split("\0") if p)


def git_state(root: Path) -> tuple[str, bool]:
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=root, check=True, capture_output=True, text=True).stdout.strip())
    return commit, dirty


def gate_summary(root: Path) -> dict:
    gates = json.loads((root / "docs/delivery/activation-gates.json").read_text(encoding="utf-8"))["gates"]
    return {"cleared": sorted(g["id"] for g in gates if g["state"] == "CLEARED"), "not_cleared": sorted(g["id"] for g in gates if g["state"] != "CLEARED"),
            "blockers": [{"gate": g["id"], "state": g["state"], "requires": g["required"]} for g in sorted(gates, key=lambda g: g["id"]) if g["state"] != "CLEARED"]}


def board_summary(root: Path) -> dict:
    """What the local build ledger says. Fresh LOCAL_TESTED for every task is necessary, never sufficient."""
    result = subprocess.run([sys.executable, str(root / "tools/build_board.py"), "status"], cwd=root, capture_output=True, text=True, check=False)
    try:
        status = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"complete": False, "counts": {}, "problem": "build board status unavailable"}
    tasks = status["tasks"]
    complete = all(t["state"] == "LOCAL_TESTED" and t["test_freshness"] == "FRESH" for t in tasks.values())
    return {"complete": complete, "counts": status["counts"], "stale_or_missing": sorted(k for k, t in tasks.items() if t["state"] != "LOCAL_TESTED" or t["test_freshness"] != "FRESH")}


def label_for(gates: dict, *, dirty: bool, board: dict) -> str:
    if not board.get("complete"):
        return "local-checks-incomplete"
    if gates["not_cleared"]:
        return "integration-blocked-candidate" + ("-dirty-tree" if dirty else "")
    return "release-candidate-awaiting-approval" + ("-dirty-tree" if dirty else "")


def build(root: Path, out_dir: Path, *, tracked: list[str], commit: str, dirty: bool, board: dict) -> dict:
    entries: dict[str, bytes] = {}
    for rel in sorted(set(tracked)):
        path = root / rel
        if _private(rel) or not path.is_file():
            continue
        entries[rel] = path.read_bytes()
    dist = root / "web" / "dist"
    static_built = (dist / "index.html").is_file()
    if static_built:
        for path in sorted(p for p in dist.rglob("*") if p.is_file() and not p.name.endswith(".map")):
            entries["static/" + path.relative_to(dist).as_posix()] = path.read_bytes()

    gates = gate_summary(root)
    implementation = json.loads((root / "IMPLEMENTATION.json").read_text(encoding="utf-8"))
    contracts = sorted(k for k in entries if k.startswith("contracts/"))
    manifest = {
        "kind": "lecture-learning private candidate", "label": label_for(gates, dirty=dirty, board=board), "statement": STATEMENT,
        "commit": commit, "tree_dirty": dirty, "kit_version": implementation.get("package_version"), "specification_baseline": implementation.get("specification_baseline"),
        "contracts_sha256": sha256("".join(f"{k}:{sha256(entries[k])}\n" for k in contracts).encode()),
        "locks": {k: sha256(entries[k]) for k in LOCKS if k in entries}, "static_built": static_built,
        "gates": {"cleared": gates["cleared"], "not_cleared": gates["not_cleared"]}, "residual_blockers": gates["blockers"], "local_checks": board,
        "file_count": len(entries),
    }
    sums = "".join(f"{sha256(data)}  {name}\n" for name, data in sorted(entries.items()))
    payload = dict(entries)
    payload["CANDIDATE.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    payload["SHA256SUMS"] = sums.encode()

    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / f"lecture-learning-{commit[:12]}{'-dirty' if dirty else ''}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(payload):
            info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, payload[name])
    result = dict(manifest, archive=str(archive), archive_sha256=sha256(archive.read_bytes()), archive_bytes=archive.stat().st_size)
    (out_dir / (archive.stem + ".manifest.json")).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def verify(archive: Path, work_dir: Path) -> dict:
    """Extract into an empty directory and check every listed file's digest; unlisted or missing files are problems."""
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True)
    problems: list[str] = []
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            target = (work_dir / name).resolve()
            if not str(target).startswith(str(work_dir.resolve()) + os.sep):
                problems.append(f"{name}: path escapes the extraction directory")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(name))
    sums_path = work_dir / "SHA256SUMS"
    if not sums_path.is_file():
        return {"ok": False, "files": 0, "problems": problems + ["SHA256SUMS: missing"], "extracted_to": str(work_dir)}
    listed: dict[str, str] = {}
    for line in sums_path.read_text(encoding="utf-8").splitlines():
        digest, _, name = line.partition("  ")
        listed[name] = digest
    for name, digest in sorted(listed.items()):
        path = work_dir / name
        if not path.is_file():
            problems.append(f"{name}: missing from the archive")
        elif sha256(path.read_bytes()) != digest:
            problems.append(f"{name}: digest differs from SHA256SUMS")
    present = {p.relative_to(work_dir).as_posix() for p in work_dir.rglob("*") if p.is_file()} - {"SHA256SUMS", "CANDIDATE.json"}
    for extra in sorted(present - set(listed)):
        problems.append(f"{extra}: present but not listed in SHA256SUMS")
    for required in ("CANDIDATE.json", "brain/src/lecture_brain/__init__.py"):
        if not (work_dir / required).is_file():
            problems.append(f"{required}: required file missing")
    return {"ok": not problems, "files": len(listed), "problems": problems, "extracted_to": str(work_dir)}


def smoke(extracted: Path) -> dict:
    """Start the extracted Brain code (fixture profile, throwaway state) far enough to report its own status."""
    with tempfile.TemporaryDirectory(prefix="ll-smoke-") as tmp:
        env = dict(os.environ, PYTHONPATH=str(extracted / "brain" / "src"), LL_PROFILE="fixture", LL_FIXTURE_ROOT=str(Path(tmp) / "fixture"), PYTHONIOENCODING="utf-8")
        run = subprocess.run([sys.executable, "-m", "lecture_brain", "--profile", "fixture", "--state-dir", str(Path(tmp) / "state"), "status"],
                             cwd=extracted, env=env, capture_output=True, text=True, check=False, timeout=180)
    ok = run.returncode == 0 and '"profile": "fixture"' in run.stdout
    return {"ok": ok, "exit": run.returncode, "detail": "extracted Brain reported fixture status" if ok else (run.stderr or run.stdout)[-600:]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ROOT / ".local" / "release")
    parser.add_argument("--verify", type=Path, help="Verify an existing archive instead of building one")
    parser.add_argument("--no-smoke", action="store_true")
    args = parser.parse_args()
    if args.verify:
        report = verify(args.verify, args.out / "verify")
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] else 1
    commit, dirty = git_state(ROOT)
    manifest = build(ROOT, args.out, tracked=tracked_files(ROOT), commit=commit, dirty=dirty, board=board_summary(ROOT))
    check = verify(Path(manifest["archive"]), args.out / "verify")
    run = {"ok": True, "detail": "skipped"} if args.no_smoke else smoke(Path(check["extracted_to"]))
    report = {"label": manifest["label"], "statement": manifest["statement"], "archive": manifest["archive"], "archive_sha256": manifest["archive_sha256"],
              "archive_bytes": manifest["archive_bytes"], "file_count": manifest["file_count"], "static_built": manifest["static_built"], "verify": {k: check[k] for k in ("ok", "files", "problems")},
              "extract_smoke": run, "residual_blockers": [b["gate"] for b in manifest["residual_blockers"]], "local_checks": manifest["local_checks"]}
    print(json.dumps(report, indent=2))
    (args.out / "last-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if check["ok"] and run["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
