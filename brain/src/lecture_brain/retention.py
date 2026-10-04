"""Scoped export, retention classes and reference-safe cleanup (LL032).

Nothing here deletes an original source, an owner record, or a full-response sidecar that an
attempt references. Cleanup is always previewed first; applying it removes exactly the previewed
set and returns a receipt of what was removed, retained, blocked and out of scope. No claim is made
about copies held by a provider or another device.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import re
import shutil
import time
import zipfile
from typing import Any

from . import contracts as c
from .config import Settings
from .fsutil import replace_atomic
from .journal import Journal, TERMINAL
from .ownerio.attempts import read_attempt_records

_CAPTURE = re.compile(r"Lecture Learning capture (?P<path>\S+) sha256:(?P<sha>[a-f0-9]{64})")
EXPORT_CONTRACT = "ll.export/1"

RETENTION_CLASSES = [
    {"class": "raw_teachback_audio", "policy_key": "raw_teachback_audio_persistent_retention", "default": "Not retained: audio stays on the recording device until its transcript is confirmed, then is discarded.",
     "removable": "automatic"},
    {"class": "text_evidence", "policy_key": "full_submitted_text_retention", "default": "Kept until an explicit, reference-aware deletion you request.", "removable": "explicit_request_only"},
    {"class": "referenced_sidecars", "policy_key": "referenced_evidence_ttl_days", "default": "Durable: a full response referenced by an attempt is evidence, not scratch.", "removable": "never_by_cleanup"},
    {"class": "operational_logs", "policy_key": "unreferenced_debug_log_days", "default": "Unreferenced activity events are removable after the configured number of days.", "removable": "by_age"},
    {"class": "reproducible_cache", "policy_key": None, "default": "Prepared text, renditions, generated views and hash caches can be rebuilt and are safe to clear.", "removable": "anytime"},
    {"class": "original_sources", "policy_key": "durable_original_media_auto_deletion", "default": "Never deleted or modified by this app.", "removable": "never"},
]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Retention:
    def __init__(self, settings: Settings, journal: Journal):
        self._settings = settings
        self._journal = journal

    def classes(self) -> list[dict]:
        return [dict(item, policy_value=self._settings.policy.get(item["policy_key"]) if item["policy_key"] else None) for item in RETENTION_CLASSES]

    # ---- references ----------------------------------------------------------------------------
    def referenced_captures(self, course_id: str) -> dict[str, str]:
        """Run-area files that an owner attempt points at: {relative path: attempt id}."""
        refs: dict[str, str] = {}
        try:
            records = read_attempt_records(self._settings.course(course_id).root, course_id)
        except Exception:  # noqa: BLE001 - if evidence cannot be read, treat every capture as referenced (keep it)
            return {"*": "attempt records unreadable"}
        for attempt_id, attempt in records["attempts"].items():
            match = _CAPTURE.search(attempt["response_evidence"]["locator"])
            if match:
                refs[match["path"]] = attempt_id
        return refs

    def _unresolved_requests(self, course_id: str) -> set[str]:
        return {j["request_id"] for j in self._journal.jobs(course_id=course_id) if j["request_id"] and j["state"] not in TERMINAL}

    # ---- export --------------------------------------------------------------------------------
    def export_preview(self, course_ids: list[str], *, include_originals: bool = False) -> dict[str, Any]:
        items, excluded = [], [
            {"what": "Device and Brain signing keys, pairing registry, native session data", "why": "Credentials and private runtime state are never exported."},
            {"what": "Assessor guides and answer keys", "why": "Restricted by course disclosure rules."},
        ]
        for course_id in course_ids:
            binding = self._settings.course(course_id)
            root, write_root = binding.root, self._settings.write_root(course_id)
            for path in sorted((root / "learning" / "attempts").glob("*/*.json")) if (root / "learning" / "attempts").is_dir() else []:
                items.append({"course_id": course_id, "kind": "attempt_or_revision", "base": "course", "path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size})
            for sub, kind in ((".agent/course-learning/runs", "captured_turns_and_messages"), (".agent/learning-app/notes", "notes"), (".agent/learning-app/review", "review_items_and_events"),
                              (".agent/learning-app/resume", "resume_checkpoints"), ("work/lecture-review/source-links", "source_link_annotations")):
                for base_name, base in (("app", write_root), ("course", root)):
                    directory = base / sub
                    if directory.is_dir() and (base_name == "app" or base != write_root):
                        for path in sorted(p for p in directory.rglob("*") if p.is_file()):
                            entry = {"course_id": course_id, "kind": kind, "base": base_name, "path": path.relative_to(base).as_posix(), "bytes": path.stat().st_size}
                            if entry not in items:
                                items.append(entry)
            if include_originals:
                excluded.append({"what": f"{course_id}: original lecture files", "why": "Original course material may be copyrighted/private. It is listed by reference only; copy it yourself from the course folder if you have the right to."})
            else:
                excluded.append({"what": f"{course_id}: original slides, recordings, transcripts, textbooks", "why": "Not bundled by default; the export references them by source id and version."})
        return {"contract": EXPORT_CONTRACT, "courses": course_ids, "items": items, "total_bytes": sum(i["bytes"] for i in items), "excluded": excluded,
                "note": "A private export for you. It is not shared or uploaded anywhere by this action."}

    def build_export(self, course_ids: list[str]) -> dict[str, Any]:
        preview = self.export_preview(course_ids)
        export_id = f"export-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{c.sha256_hex(c.dump_json(preview))[:8]}"
        out_dir = self._settings.state_dir / "exports"
        out_dir.mkdir(parents=True, exist_ok=True)
        archive = out_dir / f"{export_id}.zip"
        files = []
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for item in preview["items"]:
                base = self._settings.course(item["course_id"]).root if item["base"] == "course" else self._settings.write_root(item["course_id"])
                data = (base / item["path"]).read_bytes()
                name = f"{item['course_id']}/{item['path']}"
                bundle.writestr(name, data)
                files.append({"path": name, "sha256": c.sha256_hex(data), "bytes": len(data), "kind": item["kind"]})
            manifest = {"contract": EXPORT_CONTRACT, "export_id": export_id, "created_at": _now(), "courses": course_ids, "files": files, "excluded": preview["excluded"],
                        "app_version": "0.1.0-alpha.1", "note": "Integrity hashes cover the exported bytes. Originals and credentials are not included."}
            bundle.writestr("manifest.json", json.dumps(manifest, indent=2))
        return {"export_id": export_id, "path": str(archive), "files": len(files), "bytes": archive.stat().st_size, "manifest": manifest}

    # ---- cleanup -------------------------------------------------------------------------------
    def cleanup_preview(self, course_id: str) -> dict[str, Any]:
        area = self._settings.app_area(course_id)
        write_root = self._settings.write_root(course_id)
        referenced = self.referenced_captures(course_id)
        unresolved = self._unresolved_requests(course_id)
        removable, retained, blocked = [], [], []

        def add(bucket: list, path: Path, why: str, **extra: Any) -> None:
            bucket.append({"path": path.relative_to(write_root).as_posix(), "bytes": path.stat().st_size if path.is_file() else sum(p.stat().st_size for p in path.rglob("*") if p.is_file()), "why": why, **extra})

        for name, why in (("prepared", "Reproducible: slide text and preparation state are rebuilt from the sources."), ("renditions", "Reproducible: PDF renditions are regenerated from the original decks."),
                          ("views", "Reproducible: generated views are rebuilt from the records.")):
            if (area / name).is_dir():
                add(removable, area / name, why, retention_class="reproducible_cache")
        runs = self._settings.runs_area(course_id)
        if runs.is_dir():
            for path in sorted(p for p in runs.rglob("*") if p.is_file()):
                rel = path.relative_to(write_root).as_posix()
                if "*" in referenced or rel in referenced:
                    add(blocked, path, f"Referenced by attempt {referenced.get(rel, 'unknown')}: durable evidence, not scratch.", retention_class="referenced_sidecars")
                elif "/attachments/" in rel and any(r.rsplit("/turns/", 1)[0] == rel.rsplit("/attachments/", 1)[0] for r in referenced):
                    add(blocked, path, "Attachment of a referenced response.", retention_class="referenced_sidecars")
                else:
                    add(retained, path, "Captured text evidence is kept until you explicitly request a reference-aware deletion.", retention_class="text_evidence")
        inbox = area / "inbox"
        if inbox.is_dir():
            for directory in sorted(p for p in inbox.iterdir() if p.is_dir()):
                if directory.name in unresolved:
                    add(blocked, directory, "Belongs to an unresolved request; removing it could lose input or duplicate an effect.", retention_class="operational")
                else:
                    add(retained, directory, "Admitted request bundle: kept as the record of what was submitted.", retention_class="text_evidence")
        preview = {"course_id": course_id, "created_at": _now(), "removable": removable, "retained": retained, "blocked": blocked,
                   "out_of_scope": [{"what": "Original lecture files and all owner records under the course folder", "why": "Never deleted or modified by this app."},
                                    {"what": "Copies on other devices, in Google Drive history or in a native provider thread", "why": "This app cannot remove or verify them; no such claim is made."}],
                   "removable_bytes": sum(i["bytes"] for i in removable)}
        preview["preview_id"] = c.sha256_hex(c.dump_json({k: preview[k] for k in ("course_id", "removable")}))[:24]
        return preview

    def cleanup_apply(self, course_id: str, preview_id: str) -> dict[str, Any]:
        preview = self.cleanup_preview(course_id)
        if preview["preview_id"] != preview_id:
            return {"status": "blocked", "reason": "The files changed since the preview. Review the new preview before removing anything.", "preview": preview}
        write_root = self._settings.write_root(course_id)
        removed = []
        for item in preview["removable"]:
            target = c.resolve_inside(write_root, item["path"])
            if target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
            removed.append(item)
        receipt = {"status": "done", "course_id": course_id, "at": _now(), "removed": removed, "retained": len(preview["retained"]), "blocked": preview["blocked"], "out_of_scope": preview["out_of_scope"],
                   "note": "Only reproducible local data was removed. Evidence, originals and unresolved work were not touched."}
        log = self._settings.state_dir / "cleanup-receipts" / f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{course_id}.json"
        replace_atomic(log, json.dumps(receipt, indent=2).encode("utf-8"))
        return receipt

    def request_evidence_deletion(self, course_id: str, relative_path: str) -> dict[str, Any]:
        """Deleting captured evidence is a scoped request, never an instant button."""
        referenced = self.referenced_captures(course_id)
        if "*" in referenced or relative_path in referenced:
            return {"status": "blocked", "reason": f"This response is referenced by attempt {referenced.get(relative_path, 'unknown')}. Removing it would orphan canonical evidence; that needs an approved "
                                                   "referential deletion policy and the owning course writer. Nothing was deleted.", "path": relative_path}
        return {"status": "needs_confirmation", "path": relative_path,
                "reason": "Unreferenced captured text can be removed after you confirm; the original request bundle and any provider copy are separate and are not affected."}

    def purge_old_events(self, *, days: int | None = None) -> int:
        """Drop unreferenced activity events older than the configured window (operational logs only)."""
        import sqlalchemy as sa

        from .journal import schema as t

        window = int(days if days is not None else self._settings.policy["unreferenced_debug_log_days"])
        cutoff = self._journal.now() - window * 86400
        with self._journal.tx() as conn:
            active = sa.select(t.jobs.c.job_id).where(t.jobs.c.state.notin_([str(s) for s in TERMINAL]))
            result = conn.execute(t.events.delete().where(t.events.c.at < cutoff, sa.or_(t.events.c.job_id.is_(None), t.events.c.job_id.notin_(active))))
            return result.rowcount or 0
