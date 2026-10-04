"""Consume the EXISTING source-refresh updater's receipts (LL014, WF01).

The course updater stays the only interpreter/registrar of sources and its publisher the only
replacement authority. This module never runs it, never schedules it and never registers a source.
It only reads the updater's machine-readable final-verification receipts and, when the verified
published index of a course changed, queues the app's own downstream inventory/preparation work.

Triggers key on (run receipt, published index digest) — never on this app's generated exports, so
there is no feedback loop from generated output back into source ingestion.
"""
from __future__ import annotations

from pathlib import Path
import json
import re
from typing import Any

from .config import Settings
from .journal import Journal
from .ownerio import OwnerReadError
from .ownerio.source_index import read_source_index

_RUN = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}-source-refresh$")
RECEIPT_CONTRACT = "course-source-refresh-final-verification-v1"
MAX_RUNS_INSPECTED = 12


def runs_dir(settings: Settings) -> Path:
    return settings.planner_root / "automation" / "course-tracking" / "runs"


def latest_verified_receipt(settings: Settings) -> dict[str, Any] | None:
    """Newest run that carries a final-verification receipt. Runs without one are skipped, not guessed."""
    directory = runs_dir(settings)
    if not directory.is_dir():
        return None
    for run in sorted((p for p in directory.iterdir() if p.is_dir() and _RUN.match(p.name)), key=lambda p: p.name, reverse=True)[:MAX_RUNS_INSPECTED]:
        for name in ("final-verification.json", "final.json"):
            path = run / name
            if not path.is_file():
                continue
            try:
                receipt = json.loads(path.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError):
                continue
            if receipt.get("contract") == RECEIPT_CONTRACT and isinstance(receipt.get("courses"), dict):
                return {"run": run.name, "file": name, "courses": receipt["courses"]}
    return None


def consume_receipts(settings: Settings, journal: Journal) -> dict[str, Any]:
    """Queue downstream work for courses whose verified published index changed since last seen."""
    receipt = latest_verified_receipt(settings)
    report: dict[str, Any] = {"run": receipt["run"] if receipt else None, "courses": {}, "queued": []}
    if receipt is None:
        report["note"] = "No updater final-verification receipt is readable; nothing was queued. The updater is not run from here."
    for course_id, binding in sorted(settings.courses.items()):
        entry: dict[str, Any] = {"updater_status": None, "publication": None, "index": None}
        course_receipt = (receipt or {}).get("courses", {}).get(course_id)
        if course_receipt:
            entry["updater_status"] = course_receipt.get("status")
            entry["publication"] = (course_receipt.get("verify") or {}).get("publication")
            entry["receipt_index_revision"] = (course_receipt.get("revisions") or {}).get("source_index")
        if not binding.usable:
            entry["index"] = "binding_unusable"
            report["courses"][course_id] = entry
            continue
        try:
            index = read_source_index(binding.root, course_id)
        except OwnerReadError as exc:
            entry["index"] = f"unavailable:{exc.code}"  # mixed/changing bundle: wait, do not consume
            report["courses"][course_id] = entry
            continue
        entry["index"] = {"revision": index["revision"], "sha256": index["index_sha256"]}
        if course_receipt and entry["publication"] not in (None, "consistent"):
            entry["held"] = "The updater reported an inconsistent publication; downstream work waits for a consistent one."
            report["courses"][course_id] = entry
            continue
        seen = journal.get_value(f"updater-seen:{course_id}")
        if seen != index["index_sha256"]:
            job_id = journal.enqueue_internal(workflow="WF02", course_id=course_id, thread_key=f"prep-{course_id}", priority=4, input_digest=index["index_sha256"],
                                              detail={"kind": "inventory-refresh", "reason": "published source index changed", "index_revision": index["revision"],
                                                      "updater_run": receipt["run"] if receipt else None, "needs_native": False})
            journal.set_value(f"updater-seen:{course_id}", index["index_sha256"])
            if job_id:
                report["queued"].append({"course_id": course_id, "job_id": job_id})
        report["courses"][course_id] = entry
    return report
