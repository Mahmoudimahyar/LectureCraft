#!/usr/bin/env python3
"""LL008 evidence: exercise a COPY of the BE 505 save helper on synthetic roots only.

The course's own `tools/study_index.py` resolves every write through a module-global root, so its
`--root` flag does not redirect `save-attempt`. This tool never runs the helper where it lives.
It reads the bytes of four owner files, copies them into two throwaway synthetic workspaces under
`.local/isolated-writer/`, and then:

  1. checks the copies statically (inspected digest, no absolute paths, root derived from __file__);
  2. runs the unmodified copy and shows where a `--root` save really lands (the defect);
  3. runs a copy with a minimal patch that makes `--root` effective and compares the two roots;
  4. drives the application's own wrapper (Be505StudyIndexWriter) and candidate mapping against the
     unmodified copy, so the app-produced record is judged by the owner's real validation code.

Nothing here touches a real course folder: the helper copies can only see the synthetic root they
were copied into. The copies and the report stay under ignored `.local/`.

    python tools/isolated_writer_check.py --be505-root "<real BE 505 root>" --planner-root "<real planner root>"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "brain" / "src"))
sys.path.insert(0, str(ROOT / "brain" / "tests"))

INSPECTED = {"study_index.py": "6516024a0cb89690353107db33a67da51b5404570d87dda17a5fe64f029f0f6a",
             "course_learning.py": "1938e139e51bfa6cbf91b1b38ac890ceb6c9d5fc13742d216305ad0bfab0167b"}
ROOT_LINE = "ROOT=Path(__file__).resolve().parents[1]"
# The whole fix: honour --root before any module-level path or default argument is bound.
PATCHED_ROOT_LINE = "ROOT=Path(sys.argv[sys.argv.index('--root')+1]).resolve() if '--root' in sys.argv else Path(__file__).resolve().parents[1]"
UNSAFE = re.compile(r"[A-Za-z]:[\\/]|expanduser|LOCALAPPDATA|gettempdir|\bhome\(\)")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): sha(p.read_bytes()) for p in sorted(root.rglob("*")) if p.is_file() and "__pycache__" not in p.parts}


def diff(before: dict[str, str], after: dict[str, str]) -> dict[str, list[str]]:
    return {"added": sorted(set(after) - set(before)), "changed": sorted(k for k in before if k in after and before[k] != after[k]), "removed": sorted(set(before) - set(after))}


def run(helper: Path, *args: str) -> dict:
    env = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "PATH", "TEMP", "TMP"}}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    done = subprocess.run([sys.executable, "-B", "-X", "utf8", str(helper), *args], cwd=helper.parents[1], env=env, capture_output=True, timeout=180, check=False, stdin=subprocess.DEVNULL)
    out, err = done.stdout.decode("utf-8", "replace"), done.stderr.decode("utf-8", "replace")
    try:
        parsed = json.loads(out if done.returncode == 0 else (err or out))
    except json.JSONDecodeError:
        parsed = None
    return {"exit": done.returncode, "json": parsed, "stdout_tail": out[-600:], "stderr_tail": err[-600:]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--be505-root", type=Path, required=True)
    parser.add_argument("--planner-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=ROOT / ".local" / "isolated-writer")
    args = parser.parse_args()

    from lecture_brain import contracts as c
    from lecture_brain.capture import CaptureStore
    from lecture_brain.config import load_settings
    from lecture_brain.fixtures.builder import build_fixture_workspace
    from lecture_brain.writer import Be505StudyIndexWriter, WriterFacade
    from lecture_brain.writer import candidate as cand
    from helpers import submission  # the same synthetic submission builder the Brain tests use

    # ---- read owner bytes (read-only) -----------------------------------------------------------
    sources = {
        "study_index.py": args.be505_root / "tools" / "study_index.py",
        "study_map_template.html": args.be505_root / "tools" / "study_map_template.html",
        "course_learning.py": args.planner_root / "tools" / "course_learning.py",
        "course-learning.schema.json": args.planner_root / "protocols" / "schemas" / "course-learning.schema.json",
    }
    blobs = {name: path.read_bytes() for name, path in sources.items()}
    report: dict = {"purpose": "LL008 isolated-copy evidence on synthetic roots; not a live course save", "owner_file_digests": {k: sha(v) for k, v in blobs.items()}, "steps": []}

    def step(name: str, ok: bool, **detail) -> bool:
        report["steps"].append({"step": name, "ok": ok, **detail})
        print(f"[{'ok' if ok else 'FAIL'}] {name}")
        return ok

    static_ok = True
    for name in ("study_index.py", "course_learning.py"):
        text = blobs[name].decode("utf-8")
        hits = sorted(set(UNSAFE.findall(text)))
        same = sha(blobs[name]) == INSPECTED[name]
        static_ok &= step(f"static check of {name}", same and not hits, digest_matches_inspected_revision=same, unsafe_tokens=hits)
    static_ok &= step("course helper derives its root from its own location", ROOT_LINE in blobs["study_index.py"].decode("utf-8"))
    if not static_ok:
        report["result"] = "STOPPED_BEFORE_EXECUTION"
        _write(args.out, report)
        return 1

    # ---- two synthetic workspaces ---------------------------------------------------------------
    run_dir = args.out / time.strftime("run-%Y%m%d-%H%M%S")
    if run_dir.exists():
        shutil.rmtree(run_dir)
    patched = blobs["study_index.py"].decode("utf-8").replace(ROOT_LINE, PATCHED_ROOT_LINE).encode("utf-8")
    roots: dict[str, Path] = {}
    for label, helper_bytes in (("A", blobs["study_index.py"]), ("B", blobs["study_index.py"]), ("C", patched)):
        workspace = run_dir / label
        build_fixture_workspace(workspace)
        be505 = workspace / "University" / "BE 505"
        (be505 / "tools").mkdir(exist_ok=True)
        (be505 / "tools" / "study_index.py").write_bytes(helper_bytes)
        (be505 / "tools" / "study_map_template.html").write_bytes(blobs["study_map_template.html"])
        planner = workspace / "University" / "Fall 2026 Brain"
        (planner / "tools").mkdir(parents=True)
        (planner / "protocols" / "schemas").mkdir(parents=True)
        (planner / "tools" / "course_learning.py").write_bytes(blobs["course_learning.py"])
        (planner / "protocols" / "schemas" / "course-learning.schema.json").write_bytes(blobs["course-learning.schema.json"])
        roots[label] = be505
    helper = {label: root / "tools" / "study_index.py" for label, root in roots.items()}

    # ---- the owner's own validation of the synthetic root ---------------------------------------
    validated = run(helper["A"], "validate")
    step("owner validation accepts the synthetic BE 505 root (fixture fidelity)", validated["exit"] == 0 and bool(validated["json"] and validated["json"].get("valid")), result=validated)
    refreshed = run(helper["A"], "refresh")
    step("owner refresh renders its derived views on the synthetic root", refreshed["exit"] == 0, result=refreshed)
    for label in ("B", "C"):
        run(helper[label], "refresh")

    # ---- an application-produced candidate ------------------------------------------------------
    def candidate_for(workspace_label: str, request_id: str, text: str, outcome: str = "demonstrated"):
        settings = load_settings("fixture", env={"LL_FIXTURE_ROOT": str(run_dir / workspace_label)}, state_dir=run_dir / f"state-{workspace_label}")
        capture = CaptureStore(settings)
        sub = submission(request_id, text=text, prompt="In your own words, explain what the origin of replication does on a plasmid and name one thing it does not control.",
                         question_id="BE505-L01-Q01", family=("be505.family.question.l01-q01", 1))
        ref = capture.freeze_submission("be505", c.dump_json(sub))
        record = cand.build_attempt_candidate(submission=sub, capture=ref, attempt_id=f"be505-ll-iso-{request_id}", recorded_at="2026-10-04T10:00:30+00:00",
                                              observations=[cand.observation("be505.skill.ori.explain", outcome, submission=sub, analysis="States that replication starts at the origin and that it does not control expression.")])
        return settings, capture, sub, ref, record

    def staged(workspace_label: str, record: dict) -> Path:
        path = run_dir / f"staged-{workspace_label}-{record['attempt_id']}.json"
        path.write_bytes(cand.serialize(record))
        return path

    # ---- 2. the defect: --root does not redirect the unmodified helper ---------------------------
    _, _, _, _, record_b = candidate_for("B", "defect-1", "Replication starts at the origin; it does not control expression of the gene.")
    before_a, before_b = tree(roots["A"]), tree(roots["B"])
    defect = run(helper["A"], "save-attempt", "--candidate", str(staged("B", record_b)), "--root", str(roots["B"]))
    change_a, change_b = diff(before_a, tree(roots["A"])), diff(before_b, tree(roots["B"]))
    landed_in_a = any(p.endswith(f"{record_b['attempt_id']}.json") for p in change_a["added"])
    step("unmodified helper: a save asked for root B is written into root A (the helper's own folder)", landed_in_a and not any(change_b.values()),
         helper_result=defect, root_a_changes=change_a, root_b_changes=change_b)

    # ---- 3. the fix, in the isolated copy only ---------------------------------------------------
    _, _, _, _, record_fix = candidate_for("B", "fixed-1", "Plasmid replication begins at the origin of replication; expression of the gene is not controlled by it.")
    before_b, before_c = tree(roots["B"]), tree(roots["C"])
    fixed = run(helper["C"], "save-attempt", "--candidate", str(staged("B", record_fix)), "--root", str(roots["B"]))
    change_b, change_c = diff(before_b, tree(roots["B"])), diff(before_c, tree(roots["C"]))
    landed_in_b = any(p.endswith(f"{record_fix['attempt_id']}.json") for p in change_b["added"])
    step("patched copy: the same request is written into root B and the helper's own root is untouched", fixed["exit"] == 0 and landed_in_b and not any(change_c.values()),
         helper_result=fixed, root_b_changes=change_b, root_c_changes=change_c, patch={"from": ROOT_LINE, "to": PATCHED_ROOT_LINE})
    again = run(helper["C"], "save-attempt", "--candidate", str(staged("B", record_fix)), "--root", str(roots["B"]))
    step("same id, same bytes is a no-op (already_saved)", again["exit"] == 0 and (again["json"] or {}).get("status") == "already_saved", helper_result=again)
    clash_record = dict(record_fix, observations=[dict(record_fix["observations"][0], outcome="partial")])
    clash = run(helper["C"], "save-attempt", "--candidate", str(staged("B", clash_record)), "--root", str(roots["B"]))
    step("same id, different bytes is refused without overwrite", clash["exit"] == 1 and "Same ID with different bytes" in json.dumps(clash), helper_result=clash)

    # ---- 4. the application's wrapper against the unmodified owner code ---------------------------
    settings, capture, sub, ref, record = candidate_for("A", "wrapper-1", "The origin is where plasmid replication starts, and it does not control whether the gene is expressed.")
    facade = WriterFacade(settings, capture)
    facade.writer_for = lambda course_id: Be505StudyIndexWriter(roots["A"], interpreter=Path(sys.executable), helper=helper["A"], helper_sha256=INSPECTED["study_index.py"])  # type: ignore[method-assign]
    receipt = facade.publish_attempt("be505", record, capture=ref, submission=sub, request_id="req-iso-wrapper-1", now="2026-10-04T10:00:31Z")
    step("application wrapper + candidate mapping: the owner's helper saves the app-produced attempt", receipt["status"] == "saved" and receipt["writer_id"] == "be505-study-index",
         receipt={k: receipt[k] for k in ("status", "kind", "writer_id", "view_status", "reason")})
    repeat = facade.publish_attempt("be505", record, capture=ref, submission=sub, request_id="req-iso-wrapper-1", now="2026-10-04T10:00:41Z")
    step("application wrapper: an identical retry is already_saved, not a second record", repeat["status"] == "already_saved", receipt={k: repeat[k] for k in ("status", "reason")})
    verify = run(helper["A"], "verify")
    step("owner verify: derived study view is consistent after the app-driven save", verify["exit"] == 0, result=verify)

    report["result"] = "PASS" if all(s["ok"] for s in report["steps"]) else "FAIL"
    report["scope"] = "Synthetic roots only. A real course save still needs the owner's approval, the pinned interpreter and a reviewed binding (LIVE_WRITE gate)."
    report["run_dir"] = str(run_dir)
    _write(args.out, report)
    print(json.dumps({"result": report["result"], "steps": len(report["steps"]), "failed": [s["step"] for s in report["steps"] if not s["ok"]]}, indent=2))
    return 0 if report["result"] == "PASS" else 1


def _write(out: Path, report: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "last-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
