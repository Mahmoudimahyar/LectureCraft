"""Whole-product live-acceptance runner and readiness report (LL035).

Fail closed. Every original live gate is evaluated against real evidence files or real state; a
missing prerequisite yields ``BLOCKED`` or ``NOT_RUN`` with the exact reason — never a mocked pass.
Fixture-profile output can not satisfy any live check, and the product is ``READY`` only when every
check passes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
from typing import Any

from .config import Settings
from .journal import Journal, JobState as S
from .native import load_proof, proof_is_current
from .ownerio.inventory import coverage_summary
from .preparation import Preparation

PASS, FAIL, BLOCKED, NOT_RUN = "PASS", "FAIL", "BLOCKED", "NOT_RUN"


def _evidence(reports: Path, prefix: str) -> dict | None:
    """Newest evidence file ``<prefix>-*.json`` that declares itself live (not fixture)."""
    for path in sorted(reports.glob(f"{prefix}-*.json"), reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        data["_path"] = path.name
        return data
    return None


def run_acceptance(settings: Settings, journal: Journal, *, reports_dir: Path, preparation: Preparation | None = None) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    fixture = settings.profile == "fixture"

    def add(check_id: str, gate: str, status: str, detail: str, evidence: Any = None) -> None:
        checks.append({"id": check_id, "gates": gate, "status": status, "detail": detail, "evidence": evidence})

    def live_only(check_id: str, gate: str) -> bool:
        if fixture:
            add(check_id, gate, NOT_RUN, "Fixture profile: synthetic data and a test double can not satisfy a live check.")
        return fixture

    # 1. All-lecture inventory denominator ------------------------------------------------------------
    if not live_only("inventory-denominator", "COURSE_READ"):
        summary = coverage_summary(settings)
        unusable = [cid for cid, course in summary["courses"].items() if course["binding"] != "bound" or course["index"] != "ok"]
        truncated = [cid for cid, course in summary["courses"].items() if course["enumeration_truncated"]]
        if unusable or truncated:
            add("inventory-denominator", "COURSE_READ", FAIL, f"Courses without a trusted inventory: {unusable or '-'}; truncated enumeration: {truncated or '-'}", summary["totals"])
        else:
            add("inventory-denominator", "COURSE_READ", PASS, f"{summary['totals']['lecture_units']} lecture units and {summary['totals']['sessions']} sessions accounted for across all five courses.", summary["totals"])

    # 2. Preparation backlog --------------------------------------------------------------------------
    if not live_only("preparation-complete", "PREPARATION_EXECUTION"):
        coverage = (preparation or Preparation(settings)).coverage()
        totals = coverage["totals"]
        backlog = totals.get("not_processed", 0) + totals.get("links_pending_review", 0) + totals.get("blocked", 0)
        if totals.get("lecture_units", 0) == 0:
            add("preparation-complete", "PREPARATION_EXECUTION", FAIL, "No lecture units were found.", totals)
        elif backlog:
            add("preparation-complete", "PREPARATION_EXECUTION", FAIL,
                f"{totals.get('not_processed', 0)} unit(s) not processed, {totals.get('links_pending_review', 0)} with unreviewed links, {totals.get('blocked', 0)} blocked. Recoverable work remains.", totals)
        else:
            add("preparation-complete", "PREPARATION_EXECUTION", PASS, "Every lecture unit has a reviewed or explicitly non-recoverable disposition.", totals)

    # 3. Native path ----------------------------------------------------------------------------------
    if not live_only("native-roundtrip", "NATIVE_PROBE"):
        native = settings.native_binding
        executable = Path(native["executable"]) if native.get("executable") else None
        ok, reason = proof_is_current(settings, load_proof(settings), executable) if settings.native_dispatch_enabled else (False, "Native dispatch is not enabled.")
        add("native-roundtrip", "NATIVE_PROBE", PASS if ok else BLOCKED, reason, (load_proof(settings) or {}).get("proof_sha256"))

    # 4. Drive / second device / static shell -----------------------------------------------------------
    for check_id, gate, prefix, what in (("drive-oauth", "DRIVE_OAUTH", "drive-proof", "a user-authenticated Drive read/write/playback proof from the browser client"),
                                         ("device-pairing", "DEVICE_PAIRING", "device-pairing-proof", "a second-device pairing and signed round trip"),
                                         ("device-acceptance", "DEVICE_ACCEPTANCE", "device-acceptance", "real phone/tablet/desktop browser sessions (emulation is not accepted)"),
                                         ("static-deployment", "STATIC_DEPLOYMENT", "static-deployment", "the deployed static shell origin and its no-private-data check")):
        if live_only(check_id, gate):
            continue
        evidence = _evidence(reports_dir, prefix)
        if evidence is None:
            add(check_id, gate, BLOCKED, f"No evidence recorded for {what}.")
        elif evidence.get("fixture") or evidence.get("emulated"):
            add(check_id, gate, FAIL, "The recorded evidence is fixture/emulated and can not satisfy this gate.", evidence["_path"])
        else:
            add(check_id, gate, PASS if evidence.get("status") == "PASS" else FAIL, evidence.get("summary", "evidence recorded"), evidence["_path"])

    # 5. Canonical writer -------------------------------------------------------------------------------
    if not live_only("canonical-writer", "LIVE_WRITE"):
        if settings.writes_are_staged:
            add("canonical-writer", "LIVE_WRITE", BLOCKED, "Course writes are not enabled; assessments are staged, not saved.")
        else:
            evidence = _evidence(reports_dir, "writer-proof")
            saved = [r for r in journal.receipts(kind="publication") if r["payload"].get("status") in {"saved", "already_saved"}]
            if evidence is None or evidence.get("status") != "PASS" or not saved:
                add("canonical-writer", "LIVE_WRITE", BLOCKED, "No observed safe live writer test with a verified sidecar and readback is recorded.")
            else:
                add("canonical-writer", "LIVE_WRITE", PASS, f"{len(saved)} verified owner save(s); writer proof recorded.", evidence["_path"])

    # 6. Quality evaluation -----------------------------------------------------------------------------
    if not live_only("quality-evaluation", "EVALUATION_RUNS"):
        evidence = _evidence(reports_dir / "evaluation", "evaluation") if (reports_dir / "evaluation").is_dir() else None
        if evidence is None:
            add("quality-evaluation", "EVALUATION_RUNS", BLOCKED, "No evaluation report on reviewed held-out cases exists.")
        elif not evidence.get("promotion", {}).get("promote"):
            add("quality-evaluation", "EVALUATION_RUNS", FAIL, "; ".join(evidence.get("promotion", {}).get("reasons", ["evaluation did not meet targets"]))[:600], evidence["_path"])
        else:
            add("quality-evaluation", "EVALUATION_RUNS", PASS, "Reviewed held-out evaluation meets the quality targets.", evidence["_path"])

    # 7. No stuck or uncertain work ----------------------------------------------------------------------
    stuck = journal.jobs(states=[S.UNCERTAIN_COMPLETION, S.COMMIT_PENDING, S.STAGED, S.FAILED_RETRYABLE])
    add("no-unreconciled-work", "LIVE_WRITE", FAIL if stuck else PASS,
        f"{len(stuck)} request(s) have an uncertain or uncommitted outcome that must be reconciled." if stuck else "No request is left with an uncertain or uncommitted outcome.")

    statuses = [check["status"] for check in checks]
    overall = "READY" if all(s == PASS for s in statuses) else ("NOT_READY_FAILED" if FAIL in statuses else "NOT_READY_BLOCKED")
    report = {"contract": "ll.acceptance-report/1", "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "profile": settings.profile, "overall": overall, "checks": checks,
              "counts": {s: statuses.count(s) for s in (PASS, FAIL, BLOCKED, NOT_RUN)},
              "boundary": "Whole-product readiness needs every original gate to pass on live evidence. Local tests, fixtures and an empty task queue do not establish it."}
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"acceptance-{report['created_at'].replace(':', '')}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["path"] = str(path)
    return report
