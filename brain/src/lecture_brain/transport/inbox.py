"""Bounded inbox rescans → verified admission (WF00).

A filesystem event is only a hint; every scan re-verifies manifest, files, signature, pairing and
binding before admitting. Local matching bytes establish the local bundle, not global Drive
freshness. Rejected or pending bundles are never deleted: captured input stays where it is.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from .. import contracts as c
from ..config import Settings
from ..journal import AdmissionOutcome, Journal
from ..workflows import workflow_for
from .bundles import MANIFEST, inspect_bundle
from .pairing import PairingRegistry

MAX_BUNDLES_PER_SCAN = 500


class InboxScanner:
    def __init__(self, settings: Settings, journal: Journal, pairing: PairingRegistry, *, now: Callable[[], str]):
        self._settings = settings
        self._journal = journal
        self._pairing = pairing
        self._now = now

    def inbox(self, course_id: str) -> Path:
        return self._settings.app_area(course_id) / "inbox"

    def _seen(self, course_id: str) -> dict:
        return self._journal.get_value(f"inbox-seen:{course_id}", {})

    def rejections(self) -> list[dict]:
        out = []
        for course_id in sorted(self._settings.courses):
            for name, entry in self._seen(course_id).items():
                if entry["status"] not in {"admitted", "duplicate"}:
                    out.append(dict(entry, name=name, course_id=course_id))
        return out

    def scan(self) -> dict[str, list[dict]]:
        result: dict[str, list[dict]] = {"admitted": [], "pending": [], "rejected": []}
        for course_id, binding in sorted(self._settings.courses.items()):
            if not binding.usable:
                continue
            inbox = self.inbox(course_id)
            if not inbox.is_dir():
                continue
            seen = self._seen(course_id)
            changed = False
            for directory in sorted(p for p in inbox.iterdir() if p.is_dir())[:MAX_BUNDLES_PER_SCAN]:
                name = directory.name
                manifest_path = directory / MANIFEST
                marker = c.sha256_hex(manifest_path.read_bytes()) if manifest_path.is_file() else None
                previous = seen.get(name)
                if previous and previous.get("manifest") == marker and previous["status"] != "pending":
                    continue  # already decided for exactly these manifest bytes
                inspection = inspect_bundle(directory, settings=self._settings, pairing=self._pairing, course_id=course_id, now=self._now())
                if inspection.status == "pending":
                    result["pending"].append({"course_id": course_id, "name": name, "reason": inspection.reason})
                    continue
                entry = {"status": inspection.status, "reason": inspection.reason, "manifest": marker, "at": self._now(),
                         "request_id": inspection.request["request_id"] if inspection.request else None}
                if inspection.status == "complete":
                    workflow, priority, needs_native = workflow_for(inspection.request["action"])
                    admission = self._journal.admit(
                        inspection.request, manifest_sha256=inspection.manifest_sha256, bundle_ref=directory.relative_to(self._settings.write_root(course_id)).as_posix(),
                        workflow=workflow, priority=priority, detail={"needs_native": needs_native, "signer_key_id": inspection.manifest["signer_key_id"]})
                    if admission.outcome is AdmissionOutcome.ADMITTED:
                        self._journal.add_receipt(kind="admission", job_id=admission.job_id, generation=1, ref=directory.name, sha256=inspection.manifest_sha256,
                                                  payload={"request_id": inspection.request["request_id"], "device_id": inspection.request["device_id"], "received_at": self._now()})
                        entry["status"] = "admitted"
                        result["admitted"].append({"course_id": course_id, "request_id": inspection.request["request_id"], "job_id": admission.job_id})
                    elif admission.outcome is AdmissionOutcome.DUPLICATE:
                        entry["status"] = "duplicate"
                    else:
                        entry.update(status="conflict", reason=admission.reason)
                        result["rejected"].append({"course_id": course_id, "name": name, "status": "conflict", "reason": admission.reason, "request_id": entry["request_id"]})
                else:
                    result["rejected"].append({"course_id": course_id, "name": name, "status": inspection.status, "reason": inspection.reason, "request_id": entry["request_id"]})
                seen[name] = entry
                changed = True
            if changed:
                self._journal.set_value(f"inbox-seen:{course_id}", seen)
        return result
