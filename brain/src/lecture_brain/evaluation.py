"""Task evaluation harness and curated-label workflow (LL025).

Measures the alignment matcher and the tutor/assessor on labelled cases and reports each quantity
separately with its denominator and a Wilson interval: source/quote accuracy, grade agreement on
observable criteria, false rejection of valid alternatives, useful abstention on ambiguous cases,
latency. It never promotes on self-judged or synthetic labels: the promotion decision requires
human-reviewed, held-out cases spanning all configured courses.

Reports are append-only files keyed by evaluator identity, rubric/prompt digest and case-set
digest, so a model or rubric change produces a new report instead of rewriting history.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import time
from typing import Any

from . import contracts as c
from .native import NativeAdapter, NativeSubmission, NativeTarget
from .preparation import align_lines_to_slides
from .tutoring.outputs import parse_tutor_output
from .tutoring.prompts import build_prompt

REQUIRED_COURSES = {"be505", "be562", "be572", "cs542", "ds551"}
THRESHOLDS = {"alignment_precision": 0.95, "grade_agreement": 0.95, "false_rejection_max": 0.05, "min_cases": 100}


def wilson(successes: int, n: int, z: float = 1.96) -> dict[str, Any]:
    if n == 0:
        return {"n": 0, "successes": 0, "rate": None, "low": None, "high": None}
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return {"n": n, "successes": successes, "rate": round(p, 4), "low": round(max(0.0, centre - half), 4), "high": round(min(1.0, centre + half), 4)}


def load_cases(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("case_set", "label_source", "cases"):
        if key not in data:
            raise ValueError(f"case file lacks {key}")
    if data["label_source"] not in {"synthetic", "reviewed"}:
        raise ValueError("label_source must be 'synthetic' or 'reviewed'")
    data["digest"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return data


def evaluate_alignment(case_set: dict, *, split: str = "heldout") -> dict[str, Any]:
    proposed = correct = labelled = boundary_err_total = boundaries = 0
    for case in case_set["cases"]:
        if case.get("task") != "alignment" or case.get("split") != split:
            continue
        truth = {int(k): v for k, v in case["truth_line_to_page"].items()}
        labelled += len(truth)
        for segment in align_lines_to_slides(case["slides"], case["lines"]):
            for line in range(segment["start_line"], segment["end_line"] + 1):
                proposed += 1
                correct += truth.get(line) == segment["page"]
            starts = [line for line, page in sorted(truth.items()) if page == segment["page"]]
            if starts and segment["kind"] == "sequential":
                boundary_err_total += abs(segment["start_line"] - starts[0])
                boundaries += 1
    return {"task": "alignment", "split": split, "precision_of_proposed_links": wilson(correct, proposed), "coverage_of_labelled_lines": wilson(proposed, labelled),
            "mean_boundary_error_lines": round(boundary_err_total / boundaries, 3) if boundaries else None,
            "note": "Suggestions remain suggestions regardless of this score. Timing accuracy (ms) needs real labelled media and is not measured here."}


def evaluate_assessment(case_set: dict, adapter: NativeAdapter, *, policy: dict, split: str = "heldout") -> dict[str, Any]:
    agree = judged = false_reject = valid_alternatives = abstain_ok = ambiguous = quotes_ok = quotes = leaked = 0
    latencies = []
    target = NativeTarget("evaluation", "evaluation", "0" * 64, "evaluation-thread", "read-only", "never")
    for index, case in enumerate(c_ for c_ in case_set["cases"] if c_.get("task") == "assessment" and c_.get("split") == split):
        family = {"skill_ids": [k["skill_id"] for k in case["rubric"]], "rubric": [{"skill_id": k["skill_id"], "criterion": k["observable"]} for k in case["rubric"]]}
        submission = {"question": {"prompt": case["question"]}, "response": {"text": case["response"]},
                      "conditions": {"assistance_before_answer": "none_reported", "reference_access": "none_reported", "prior_exposure": "unknown"}}
        spans = [{"index": i, "source": {"source_id": f"eval-src-{i}", "version_id": "v1", "locator": {"kind": "text", "description": "evaluation span"}}, "filename": "evaluation", "text": text}
                 for i, text in enumerate(case.get("sources", []))]
        material = {"instruction_text": "Evaluation run.", "spans": spans, "attempts": [], "rubric": case["rubric"], "assessor_guidance": case.get("assessor_guidance")}
        prompt, _ = build_prompt(action="explain", depth="standard", material=material, submission=submission, family=family, policy=policy)
        started = time.monotonic()
        observation = adapter.submit(NativeSubmission(f"eval-{index}", f"eval-{index}", target, prompt, 120.0))
        latencies.append(time.monotonic() - started)
        out = parse_tutor_output(observation.text or "", expect_assessment=True, intended_skill_ids=family["skill_ids"], max_sources=len(spans))
        got = {o["skill_id"]: o["outcome"] for o in (out.observations or [])}
        for skill_id, expected in case["expected"].items():
            actual = got.get(skill_id)
            if case.get("kind") == "ambiguous":
                ambiguous += 1
                abstain_ok += actual in {"uncertain", "not_observed", None}
                continue
            judged += 1
            agree += actual == expected
            if case.get("kind") == "valid_alternative":
                valid_alternatives += 1
                false_reject += actual in {"not_demonstrated", "partial"} and expected == "demonstrated"
        for used in out.sources_used:
            quotes += 1
            quotes_ok += used < len(spans)
        if case.get("assessor_guidance") and case["assessor_guidance"][:60] in out.reply_markdown:
            leaked += 1
    return {"task": "assessment", "split": split, "grade_agreement": wilson(agree, judged), "false_rejection_of_valid_alternatives": wilson(false_reject, valid_alternatives),
            "useful_abstention_on_ambiguous": wilson(abstain_ok, ambiguous), "source_reference_validity": wilson(quotes_ok, quotes), "answer_guidance_leaks": leaked,
            "latency_seconds": {"n": len(latencies), "mean": round(sum(latencies) / len(latencies), 4) if latencies else None, "max": round(max(latencies), 4) if latencies else None},
            "separately_billed_cost_usd": 0, "note": "Agreement with labels is not ground truth on its own; disagreements with reviewed labels must be adjudicated by a human."}


def promotion_decision(report: dict[str, Any]) -> dict[str, Any]:
    """Fail closed: synthetic labels, self-judging, thin or single-course case sets can never promote."""
    reasons = []
    if report["label_source"] != "reviewed":
        reasons.append("Labels are synthetic: they exercise mechanics only and cannot establish quality.")
    if report["evaluator"].get("is_test_double"):
        reasons.append("The evaluated tutor is the labeled fixture double, not the native tutor.")
    if not REQUIRED_COURSES <= set(report.get("courses_covered", [])):
        reasons.append("Held-out cases do not span all five configured courses.")
    alignment, assessment = report.get("alignment"), report.get("assessment")
    for name, section, metric, threshold in (("alignment", alignment, "precision_of_proposed_links", THRESHOLDS["alignment_precision"]),
                                             ("assessment", assessment, "grade_agreement", THRESHOLDS["grade_agreement"])):
        if not section:
            reasons.append(f"No {name} evaluation was run.")
            continue
        stat = section[metric]
        if stat["n"] < THRESHOLDS["min_cases"]:
            reasons.append(f"{name}: only {stat['n']} adjudicated held-out judgments; at least {THRESHOLDS['min_cases']} are required.")
        elif stat["rate"] < threshold:
            reasons.append(f"{name}: {metric} {stat['rate']} is below the target {threshold}.")
    if assessment:
        rejection = assessment["false_rejection_of_valid_alternatives"]
        if rejection["n"] and rejection["rate"] > THRESHOLDS["false_rejection_max"]:
            reasons.append("assessment: valid alternative answers are rejected too often.")
        if assessment["answer_guidance_leaks"]:
            reasons.append("assessment: assessor guidance leaked into a reply (critical).")
    return {"promote": not reasons, "reasons": reasons, "thresholds": THRESHOLDS}


def run_evaluation(case_files: list[Path], adapter: NativeAdapter, *, policy: dict, out_dir: Path, rubric_digest: str) -> dict[str, Any]:
    case_sets = [load_cases(p) for p in case_files]
    merged = {"cases": [case for cs in case_sets for case in cs["cases"]]}
    label_source = "reviewed" if all(cs["label_source"] == "reviewed" for cs in case_sets) else "synthetic"
    evaluator = {"adapter": adapter.name, "is_test_double": bool(getattr(adapter, "is_test_double", False))}
    report = {
        "contract": "ll.evaluation-report/1", "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "label_source": label_source, "evaluator": evaluator,
        "rubric_digest": rubric_digest, "case_sets": [{"name": cs["case_set"], "digest": cs["digest"], "label_source": cs["label_source"]} for cs in case_sets],
        "courses_covered": sorted({case["course_id"] for case in merged["cases"] if case.get("split") == "heldout" and case.get("course_id")}),
        "split_counts": {split: sum(1 for case in merged["cases"] if case.get("split") == split) for split in ("train", "heldout")},
        "alignment": evaluate_alignment(merged), "assessment": evaluate_assessment(merged, adapter, policy=policy),
    }
    report["promotion"] = promotion_decision(report)
    identity = hashlib.sha256(c.dump_json({"e": evaluator, "r": rubric_digest, "c": [cs["digest"] for cs in case_sets]})).hexdigest()[:16]
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"evaluation-{report['created_at'].replace(':', '')}-{identity}.json"
    if path.exists():
        raise FileExistsError("An evaluation report with this identity and time already exists; history is never rewritten")
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["path"] = str(path)
    return report
