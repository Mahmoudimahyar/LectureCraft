"""Activity, lifecycle, bounded maintenance and backups (LL033 / LL036, WF11).

The supervisor can pause, report honest capability status, propose bounded repairs with an exact
preview, and back up / restore its own operational journal. It never inspects credentials, never
steals a live lease or lock, never spends on a paid route, never restarts or reconfigures a native
app and never regenerates an owner's view or history on the owner's behalf.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import shutil
import sqlite3
from typing import Any

from . import contracts as c
from .config import Settings
from .journal import Journal, JournalError, JobState as S, assert_local_nonsynced
from .native import executable_identity, load_proof, proof_is_current
from .ownerio.attempts import learning_view_status, read_attempt_records
from .preparation import find_converter

BACKUP_CONTRACT = "ll.journal-backup/1"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Maintenance:
    def __init__(self, settings: Settings, journal: Journal, *, coordinator: Any = None, projector: Any = None):
        self._settings, self._journal, self._coordinator, self._projector = settings, journal, coordinator, projector

    # ---- lifecycle -----------------------------------------------------------------------------
    def pause(self, reason: str) -> None:
        self._journal.set_value("supervisor-paused", True)
        self._journal.set_value("supervisor-pause-reason", {"reason": reason, "at": _now()})

    def resume(self) -> None:
        self._journal.set_value("supervisor-paused", False)

    def guard_native_identity(self) -> dict[str, Any]:
        """Pause native work when the executable or its policy changed since the proof (update, restart, re-login).

        Only public facts are compared (executable bytes digest, bound policy). No credential, token,
        cookie or session database is ever opened.
        """
        if self._settings.profile == "fixture" or not self._settings.native_dispatch_enabled:
            return {"checked": False, "reason": "No live native route is enabled."}
        native = self._settings.native_binding
        executable = Path(native["executable"]) if native.get("executable") else None
        ok, reason = proof_is_current(self._settings, load_proof(self._settings), executable)
        if not ok:
            self.pause(f"Native identity changed or is unproven: {reason}")
        return {"checked": True, "current": ok, "reason": reason, "executable": executable_identity(executable)}

    def spending_policy(self) -> dict[str, Any]:
        budget = self._settings.policy["additional_paid_inference_budget_usd"]
        return {"additional_paid_inference_budget_usd": budget, "paid_route_configured": False,
                "note": "This app has no API-key or metered inference route. Native usage is governed by your existing subscription, which this app cannot measure."}

    # ---- capability status (installed / configured / verified are separate) -------------------------
    def capabilities(self, adapter: Any) -> dict[str, Any]:
        settings = self._settings
        native = adapter.capabilities() if adapter is not None else {}
        if settings.profile == "fixture":
            native_status = {"status": "fixture_double", "label": "Fixture tutor (labeled test double)", "detail": "Synthetic replies for testing. Not a real tutor; cannot satisfy native acceptance."}
            writer = {"status": "fixture_isolated", "label": "Synthetic course roots", "detail": "Saves go to generated fixture folders owned by this workspace."}
        else:
            proof = load_proof(settings)
            executable = Path(settings.native_binding["executable"]) if settings.native_binding.get("executable") else None
            ok, reason = proof_is_current(settings, proof, executable) if settings.native_dispatch_enabled else (False, "Native dispatch is not enabled.")
            native_status = {"status": "verified" if ok else "not_verified", "label": "Native connection verified" if ok else "Native connection not verified", "detail": reason,
                             "installed": executable_identity(executable)["present"], "configured": bool(settings.native_binding), "last_proof_at": (proof or {}).get("checked_at")}
            single = self._disposable_proof()
            if single is not None:
                native_status["disposable_proof"] = single
            writer = ({"status": "staged_only", "label": "Course writes not enabled", "detail": "Assessments are staged locally and reported as awaiting course save."}
                      if settings.writes_are_staged else {"status": "enabled", "label": "Course writer enabled", "detail": "Saves go through the bound owning writer."})
        return {"native": dict(native_status, adapter=native.get("adapter")), "writer": writer,
                "drive": {"status": "not_configured", "label": "Drive access not configured on the Brain", "detail": "This PC reads its local course folders. Browser Drive access is set up per device."},
                "speech": {"status": "not_installed", "label": "Automatic transcription not available",
                           "detail": "No local speech-to-text model is installed and none is downloaded by this app. Spoken explanations are recorded on the device and you type or correct "
                                     "the transcript yourself; that corrected text is what gets assessed."},
                "office_converter": ({"status": "available", "label": "PowerPoint decks can be shown as PDF renditions", "detail": "LibreOffice was found on this PC. Renditions are labeled, versioned and kept in the app's private area; the original deck is only read."}
                                     if find_converter() is not None else
                                     {"status": "not_installed", "label": "PowerPoint decks cannot be shown yet",
                                      "detail": "Showing a .pptx deck needs a PDF rendition made by LibreOffice, which is not installed on this PC. Until then such a deck is listed and its original "
                                                "can be opened outside the app; nothing is regenerated from other material."}),
                "brain": {"profile": settings.profile, "paused": bool(self._journal.get_value("supervisor-paused", False)), "pause_reason": self._journal.get_value("supervisor-pause-reason")},
                "spending": self.spending_policy()}

    def _disposable_proof(self) -> dict[str, Any] | None:
        """The single-request proof, reported for what it is. It never changes the connection status above."""
        from .native.disposable_proof import proof_report_path

        try:
            report = json.loads(proof_report_path(self._settings).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        meaning = {"SEPARATE_WORKER_ONLY": "One synthetic request was answered through a separate worker process on a new disposable thread. This does not connect the tutor: "
                                           "no course thread is bound and the desktop app's own threads were not reached.",
                   "UNCERTAIN_COMPLETION": "One synthetic request was sent and its outcome is unknown. It was not sent again. This does not connect the tutor."}.get(
            report.get("classification"), "The single-request proof did not complete. This does not connect the tutor.")
        return {"classification": report.get("classification"), "checked_at": report.get("checked_at"), "thread_id": (report.get("target") or {}).get("thread_id"), "meaning": meaning}

    # ---- bounded repair ------------------------------------------------------------------------
    def issues(self) -> list[dict[str, Any]]:
        found = []
        for course_id, binding in sorted(self._settings.courses.items()):
            if not binding.usable:
                found.append({"issue_id": f"binding:{course_id}", "course_id": course_id, "kind": "source_availability", "summary": binding.problem, "repair": None})
                continue
            status = learning_view_status(binding.root)
            if status != "current":
                found.append({"issue_id": f"owner-view:{course_id}", "course_id": course_id, "kind": "stale_view",
                              "summary": f"The course's generated learning-state view is {status}. Original attempts are intact.", "repair": "owner_refresh_required"})
            for problem in read_attempt_records(binding.root, course_id)["problems"]:
                found.append({"issue_id": f"record:{course_id}:{problem.get('path') or problem.get('attempt_id')}", "course_id": course_id, "kind": "invalid_record",
                              "summary": f"Attempt tree problem: {problem['code']}", "repair": None})
            if not (self._settings.exports_area(course_id) / "alignment.json").is_file():
                found.append({"issue_id": f"alignment-export:{course_id}", "course_id": course_id, "kind": "stale_view", "summary": "The alignment export is missing; link revisions are intact.",
                              "repair": "rebuild_alignment_export"})
        for job in self._journal.jobs(states=[S.UNCERTAIN_COMPLETION, S.COMMIT_PENDING, S.STAGED]):
            found.append({"issue_id": f"job:{job['job_id']}", "course_id": job["course_id"], "kind": "uncertain_publication" if job["state"] != S.UNCERTAIN_COMPLETION else "uncertain_native_outcome",
                          "summary": f"Request {job['request_id']} is {job['state']}: {job['waiting_reason'] or 'interrupted before completion'}", "repair": "reconcile_job"})
        return found

    def repair_preview(self, issue_id: str) -> dict[str, Any]:
        issue = next((i for i in self.issues() if i["issue_id"] == issue_id), None)
        if issue is None:
            return {"status": "unknown_issue", "issue_id": issue_id}
        repair = issue["repair"]
        base = {"issue": issue, "status": "preview"}
        if repair == "rebuild_alignment_export":
            return dict(base, operation="Rebuild exports/learning/alignment.json from the source-link revisions.", inputs=["work/lecture-review/source-links/*.rN.json"],
                        target_owner="this app (derived export)", expected_writes=["exports/learning/alignment.json"], unchanged=["all link revisions", "all course sources", "attempts"], allowed=True)
        if repair == "reconcile_job":
            return dict(base, operation="Check existing native and writer receipts for this request and continue from them. The turn is not re-sent and no new attempt is created.",
                        inputs=["journal receipts", "staged candidate", "canonical record identity"], target_owner="this app's coordinator; the owning course writer only for the already staged candidate",
                        expected_writes=["result bundle (if the outcome is now known)", "the staged attempt/revision if it is not already saved"], unchanged=["captured learner input", "other requests"], allowed=True)
        if repair == "owner_refresh_required":
            return dict(base, operation="Regenerate the course's learning-state view.", target_owner="the course's own tutoring workflow/helper",
                        expected_writes=["learning-state.md (and course exports where the course has them)"], allowed=False,
                        blocked_reason="This view belongs to the course owner and is produced by its own helper under its own lock. This app does not run that writer. "
                                       "Ask the course agent to refresh it; nothing is lost while it is stale.")
        return dict(base, operation=None, allowed=False, blocked_reason="No safe automatic repair exists for this problem; it needs the owner's review. Missing original content cannot be recreated from a summary.")

    def repair_apply(self, issue_id: str) -> dict[str, Any]:
        preview = self.repair_preview(issue_id)
        if not preview.get("allowed"):
            return {"status": "blocked", "issue_id": issue_id, "reason": preview.get("blocked_reason", "Unknown issue")}
        repair = preview["issue"]["repair"]
        if repair == "rebuild_alignment_export":
            from .annotations import AnnotationStore

            view = AnnotationStore(self._settings).export_alignment(preview["issue"]["course_id"])
            return {"status": "done", "issue_id": issue_id, "wrote": ["exports/learning/alignment.json"], "links": len(view["links"]), "unchanged": preview["unchanged"]}
        if repair == "reconcile_job" and self._coordinator is not None:
            state = self._coordinator.reconcile(issue_id.split(":", 1)[1])
            return {"status": "done" if state in {S.SUCCEEDED, S.CANCELLED} else "still_pending", "issue_id": issue_id, "job_state": str(state)}
        return {"status": "blocked", "issue_id": issue_id, "reason": "Repair handler unavailable"}

    # ---- journal backup / restore (on copies; never an owner record) ----------------------------------
    def backup_journal(self, dest_dir: Path) -> dict[str, Any]:
        assert_local_nonsynced(dest_dir, self._settings.synced_roots)
        dest_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = dest_dir / f"journal-{stamp}.sqlite"
        source = sqlite3.connect(self._journal.path)
        try:
            copy = sqlite3.connect(target)
            try:
                source.backup(copy)  # consistent online snapshot (WAL-safe)
            finally:
                copy.close()
        finally:
            source.close()
        manifest = {"contract": BACKUP_CONTRACT, "created_at": _now(), "file": target.name, "sha256": c.sha256_hex(target.read_bytes()), "bytes": target.stat().st_size,
                    "schema_revision": self._journal.schema_revision(), "counts": self._journal.counts(),
                    "excludes": ["signing keys", "course folders", "captured evidence files (they live in the course/app areas and are not part of the journal)"]}
        (dest_dir / f"journal-{stamp}.manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest

    @staticmethod
    def verify_backup(backup_file: Path, manifest: dict, known_head: str) -> list[str]:
        problems = []
        if manifest.get("contract") != BACKUP_CONTRACT:
            problems.append("unsupported backup contract")
        if not backup_file.is_file() or c.sha256_hex(backup_file.read_bytes()) != manifest.get("sha256"):
            problems.append("backup bytes do not match the manifest")
            return problems
        con = sqlite3.connect(f"file:{backup_file.as_posix()}?mode=ro", uri=True)
        try:
            if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                problems.append("SQLite integrity check failed")
            revision = con.execute("SELECT version_num FROM alembic_version").fetchone()
            if revision is None:
                problems.append("backup has no schema revision")
        except sqlite3.DatabaseError as exc:
            problems.append(f"not a readable journal: {exc}")
        finally:
            con.close()
        return problems

    def restore_journal(self, backup_file: Path, manifest: dict, target: Path) -> dict[str, Any]:
        """Restore a verified backup to ``target``. An existing journal is never overwritten in place."""
        problems = self.verify_backup(backup_file, manifest, self._journal.head_revision())
        if problems:
            return {"status": "blocked", "problems": problems}
        assert_local_nonsynced(target, self._settings.synced_roots)
        if target.exists():
            return {"status": "blocked", "problems": ["A journal already exists at the target. Move it aside deliberately; a restore never replaces newer state silently."]}
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(backup_file, target)
        try:
            restored = Journal.open(target, synced_roots=self._settings.synced_roots)  # runs forward migrations if the backup is older
        except JournalError as exc:
            target.unlink(missing_ok=True)
            return {"status": "blocked", "problems": [str(exc)]}
        try:
            recovered = restored.recover_after_restart()
            return {"status": "restored", "schema_revision": restored.schema_revision(), "counts": restored.counts(), "recovery": recovered,
                    "note": "In-flight work from the backup is re-checked against existing receipts before anything is retried."}
        finally:
            restored.close()

    def restore_app_files(self, backup_root: Path, course_id: str) -> dict[str, Any]:
        """No-clobber restore of this app's own files for one course. Existing files always win."""
        target_root = self._settings.write_root(course_id)
        restored, kept_existing, conflicts = [], [], []
        for path in sorted(p for p in backup_root.rglob("*") if p.is_file()):
            rel = path.relative_to(backup_root).as_posix()
            if not rel.startswith((".agent/learning-app/", ".agent/course-learning/runs/", "work/lecture-review/source-links/")):
                continue  # only this app's own areas; never attempts, catalogs, tracking files or sources
            destination = target_root / rel
            if destination.exists():
                (kept_existing if destination.read_bytes() == path.read_bytes() else conflicts).append(rel)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
            restored.append(rel)
        return {"status": "done", "restored": restored, "kept_existing": kept_existing, "conflicts_left_untouched": conflicts,
                "note": "Files already present were not replaced. Conflicting versions are listed for you to compare."}
