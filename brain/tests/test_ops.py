"""LL025 / LL032 / LL033 / LL035 / LL036: evaluation harness, retention, lifecycle, acceptance, backups."""
from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from lecture_brain import contracts as c
from lecture_brain.acceptance import run_acceptance
from lecture_brain.capture import CaptureError, CaptureStore
from lecture_brain.config import load_settings
from lecture_brain.evaluation import load_cases, promotion_decision, run_evaluation, wilson
from lecture_brain.journal import JobState as S
from lecture_brain.maintenance import Maintenance
from lecture_brain.native.fixture_tutor import FixtureTutorAdapter
from lecture_brain.preparation import Preparation
from lecture_brain.retention import Retention

from helpers import submission
from test_coordinator import Env


@pytest.fixture()
def env(settings, clock):
    e = Env(settings, clock)
    yield e
    e.journal.close()


def _tree(root: Path) -> dict[str, int]:
    return {p.relative_to(root).as_posix(): p.stat().st_size for p in root.rglob("*") if p.is_file()}


# ---- LL025 evaluation harness ------------------------------------------------------------------------
def test_evaluation_reports_separate_metrics_with_denominators(repo, settings, tmp_path):
    report = run_evaluation([repo / "fixtures/evaluation/synthetic-cases.json"], FixtureTutorAdapter(), policy=settings.policy, out_dir=tmp_path / "eval", rubric_digest="r1")
    assert report["split_counts"] == {"train": 2, "heldout": 5}  # train cases are never scored as held-out
    assert report["alignment"]["precision_of_proposed_links"]["n"] == 6 and report["alignment"]["precision_of_proposed_links"]["low"] is not None
    assessment = report["assessment"]
    assert assessment["grade_agreement"]["n"] == 3 and assessment["useful_abstention_on_ambiguous"]["n"] == 1 and assessment["false_rejection_of_valid_alternatives"]["n"] == 1
    assert assessment["useful_abstention_on_ambiguous"]["successes"] == 1  # "idk" → uncertain, not a confident failure
    assert assessment["separately_billed_cost_usd"] == 0 and assessment["latency_seconds"]["n"] == 4 and assessment["answer_guidance_leaks"] == 0
    # The keyword double wrongly rejects the valid alternative explanation: the harness reports it instead of hiding it.
    assert assessment["false_rejection_of_valid_alternatives"]["successes"] == 1
    assert Path(report["path"]).is_file()


def test_promotion_fails_closed_on_synthetic_labels_doubles_and_thin_coverage(repo, settings, tmp_path):
    report = run_evaluation([repo / "fixtures/evaluation/synthetic-cases.json"], FixtureTutorAdapter(), policy=settings.policy, out_dir=tmp_path / "eval", rubric_digest="r1")
    decision = report["promotion"]
    assert decision["promote"] is False
    text = " ".join(decision["reasons"])
    assert "synthetic" in text and "fixture double" in text and "five configured courses" in text and "at least 100" in text
    # Even a perfect-looking reviewed report below the case minimum cannot promote.
    perfect = {"label_source": "reviewed", "evaluator": {"is_test_double": False}, "courses_covered": ["be505", "be562", "be572", "cs542", "ds551"],
               "alignment": {"precision_of_proposed_links": wilson(40, 40)},
               "assessment": {"grade_agreement": wilson(40, 40), "false_rejection_of_valid_alternatives": wilson(0, 10), "answer_guidance_leaks": 0}}
    assert promotion_decision(perfect)["promote"] is False
    perfect["alignment"]["precision_of_proposed_links"] = wilson(120, 120)
    perfect["assessment"]["grade_agreement"] = wilson(118, 120)
    assert promotion_decision(perfect)["promote"] is True
    perfect["assessment"]["answer_guidance_leaks"] = 1
    assert promotion_decision(perfect)["promote"] is False


def test_changed_rubric_creates_a_new_report_and_history_is_not_rewritten(repo, settings, tmp_path):
    out = tmp_path / "eval"
    first = run_evaluation([repo / "fixtures/evaluation/synthetic-cases.json"], FixtureTutorAdapter(), policy=settings.policy, out_dir=out, rubric_digest="rubric-A")
    second = run_evaluation([repo / "fixtures/evaluation/synthetic-cases.json"], FixtureTutorAdapter(), policy=settings.policy, out_dir=out, rubric_digest="rubric-B")
    assert first["path"] != second["path"] and len(list(out.glob("evaluation-*.json"))) == 2
    assert json.loads(Path(first["path"]).read_text())["rubric_digest"] == "rubric-A"
    with pytest.raises(ValueError):
        bad = tmp_path / "bad.json"
        bad.write_text(json.dumps({"case_set": "x", "label_source": "self_judged", "cases": []}))
        load_cases(bad)


# ---- LL032 export / retention / cleanup ----------------------------------------------------------------
def test_export_is_scoped_hashed_and_excludes_credentials_originals_and_answer_keys(env):
    env.explain()
    env.coordinator.tick()
    retention = Retention(env.settings, env.journal)
    preview = retention.export_preview(["be505"])
    kinds = {i["kind"] for i in preview["items"]}
    assert {"attempt_or_revision", "captured_turns_and_messages", "source_link_annotations"} <= kinds
    assert any("original slides" in e["what"] for e in preview["excluded"]) and any("signing keys" in e["what"] for e in preview["excluded"])
    result = retention.build_export(["be505"])
    with zipfile.ZipFile(result["path"]) as bundle:
        names = set(bundle.namelist())
        manifest = json.loads(bundle.read("manifest.json"))
        for entry in manifest["files"]:
            assert c.sha256_hex(bundle.read(entry["path"])) == entry["sha256"]
    assert not any(n.endswith((".pdf", ".wav", ".pem")) or "assessor" in n or "question-map" in n for n in names)
    assert any("/turns/turn-req-exp.json" in n for n in names) and Path(result["path"]).is_relative_to(env.settings.state_dir)


def test_cleanup_is_previewed_reference_safe_and_reports_actual_scope(env):
    env.explain()
    env.coordinator.tick()
    env.mode("completion_unknown")
    env.explain("req-pending", logical="input-pending")
    env.coordinator.tick()
    Preparation(env.settings, converter=None).prepare_course("be505")
    retention = Retention(env.settings, env.journal)
    originals = _tree(env.root / "materials")
    preview = retention.cleanup_preview("be505")
    assert {i["path"].split("/")[-1] for i in preview["removable"]} == {"prepared"}
    blocked = {i["path"]: i["why"] for i in preview["blocked"]}
    assert any(p.endswith("turns/turn-req-exp.json") and "Referenced by attempt" in why for p, why in blocked.items())  # durable evidence, not scratch
    assert any(p.endswith("inbox/req-pending") and "unresolved request" in why for p, why in blocked.items())
    assert any("Original lecture files" in o["what"] for o in preview["out_of_scope"]) and any("provider" in o["what"] for o in preview["out_of_scope"])
    stale = retention.cleanup_apply("be505", "not-the-preview-id")
    assert stale["status"] == "blocked"
    receipt = retention.cleanup_apply("be505", preview["preview_id"])
    assert receipt["status"] == "done" and [r["path"].split("/")[-1] for r in receipt["removed"]] == ["prepared"]
    assert not (env.settings.app_area("be505") / "prepared").exists()
    assert _tree(env.root / "materials") == originals  # original recordings and slides are never deleted
    captured = env.result("req-exp")["publication"]["captured_submission"]
    assert env.coordinator.capture.verify("be505", captured)  # referenced sidecar still verifies
    assert retention.request_evidence_deletion("be505", captured["path"])["status"] == "blocked"
    assert {x["class"] for x in retention.classes()} >= {"raw_teachback_audio", "text_evidence", "referenced_sidecars", "operational_logs", "reproducible_cache", "original_sources"}


def test_raw_audio_is_not_accepted_as_persistent_evidence_by_default(settings):
    audio = b"RIFF synthetic audio bytes"
    sub = submission("req-voice", text="Spoken explanation, transcribed and corrected.", prompt="Explain.", question_id=None, family=None)
    sub["response"].update(kind="voice_transcript", transcription_revision="tr-1", attachments=[c.artifact_for_bytes(audio, "attachments/take1.webm", "audio/webm")])
    with pytest.raises(CaptureError) as err:
        CaptureStore(settings).freeze_submission("be505", c.dump_json(sub), {"attachments/take1.webm": audio})
    assert err.value.code == "audio_retention_not_permitted"
    sub["response"]["attachments"] = []
    assert CaptureStore(settings).freeze_submission("be505", c.dump_json(sub))["bytes"] > 0  # the corrected transcript itself is kept


# ---- LL033 lifecycle and bounded maintenance -------------------------------------------------------------
def test_pause_stops_dispatch_without_losing_or_cancelling_work(env):
    maintenance = Maintenance(env.settings, env.journal, coordinator=env.coordinator)
    maintenance.pause("lock screen / user away")
    env.ask()
    summary = env.coordinator.tick()
    assert summary.get("paused") is True and env.adapter.calls == 0 and env.job("req-ask")["state"] == S.READY
    maintenance.resume()
    env.coordinator.tick()
    assert env.job("req-ask")["state"] == S.SUCCEEDED


def test_capabilities_separate_installed_configured_verified_and_no_paid_route(env, repo):
    caps = Maintenance(env.settings, env.journal).capabilities(env.adapter)
    assert caps["native"]["status"] == "fixture_double" and "Not a real tutor" in caps["native"]["detail"]
    assert caps["spending"] == {"additional_paid_inference_budget_usd": 0, "paid_route_configured": False, "note": caps["spending"]["note"]}
    env.settings.profile = "local"
    env.settings.course_writes_enabled = False
    caps = Maintenance(env.settings, env.journal).capabilities(env.adapter)
    assert caps["native"]["status"] == "not_verified" and caps["native"]["installed"] is False and caps["writer"]["status"] == "staged_only"
    # No metered-API credential is ever read by the Brain package.
    source = "\n".join(p.read_text(encoding="utf-8") for p in (repo / "brain/src/lecture_brain").rglob("*.py"))
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "api_key", "Authorization: Bearer"):
        assert name not in source


def test_repairs_are_previewed_bounded_and_never_rewrite_owner_views(env):
    path = next((env.root / "learning/attempts/2026-09").glob("*-retry-02.json"))
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")  # the owner's view is now stale
    env.mode("completion_unknown")
    env.explain()
    env.coordinator.tick()
    env.mode("normal")
    maintenance = Maintenance(env.settings, env.journal, coordinator=env.coordinator)
    issues = {i["issue_id"]: i for i in maintenance.issues()}
    job_issue = next(i for i in issues if i.startswith("job:"))
    assert issues["owner-view:be505"]["kind"] == "stale_view" and issues[job_issue]["kind"] == "uncertain_native_outcome" and "alignment-export:be505" in issues
    owner = maintenance.repair_preview("owner-view:be505")
    assert owner["allowed"] is False and "does not run that writer" in owner["blocked_reason"]
    before = (env.root / "learning-state.md").read_bytes()
    assert maintenance.repair_apply("owner-view:be505")["status"] == "blocked" and (env.root / "learning-state.md").read_bytes() == before
    preview = maintenance.repair_preview("alignment-export:be505")
    assert preview["allowed"] is True and preview["expected_writes"] == ["exports/learning/alignment.json"] and "attempts" in preview["unchanged"]
    assert maintenance.repair_apply("alignment-export:be505")["status"] == "done"
    assert "not re-sent" in maintenance.repair_preview(job_issue)["operation"]
    assert maintenance.repair_apply(job_issue) == {"status": "done", "issue_id": job_issue, "job_state": "SUCCEEDED"}
    assert env.adapter.calls == 1 and len(env.attempts()["attempts"]) == 5
    assert maintenance.repair_preview("nope")["status"] == "unknown_issue"


def test_a_live_lease_is_never_stolen_by_reconcile(env):
    env.mode("completion_unknown")
    env.explain()
    env.coordinator.tick()
    job = env.job("req-exp")
    env.journal.acquire_for_reconcile(job["job_id"], "another-live-worker", lease_seconds=300)
    from lecture_brain.journal import JournalError

    with pytest.raises(JournalError):
        env.coordinator.reconcile(job["job_id"])


def test_old_unreferenced_events_are_purged_but_active_work_keeps_its_trail(env):
    env.ask("req-old")
    env.coordinator.tick()
    env.mode("completion_unknown")
    env.explain("req-active")
    env.coordinator.tick()
    env.clock.advance(20 * 86400)
    removed = Retention(env.settings, env.journal).purge_old_events()
    assert removed > 0
    assert env.journal.events(env.job("req-active")["job_id"])  # unresolved job keeps its history
    assert env.journal.events(env.job("req-old")["job_id"]) == []


# ---- LL036 backups, restore and migration on copies ---------------------------------------------------------
def test_journal_backup_restores_to_a_new_location_and_never_replaces_existing_state(env, tmp_path):
    env.ask()
    env.coordinator.tick()
    env.mode("completion_unknown")
    env.explain()
    env.coordinator.tick()
    maintenance = Maintenance(env.settings, env.journal)
    manifest = maintenance.backup_journal(tmp_path / "backups")
    backup = tmp_path / "backups" / manifest["file"]
    assert manifest["schema_revision"] == env.journal.head_revision() and manifest["counts"]["jobs"] == 2 and "signing keys" in manifest["excludes"]
    assert maintenance.restore_journal(backup, manifest, env.settings.journal_path)["status"] == "blocked"  # existing journal is not overwritten
    restored = maintenance.restore_journal(backup, manifest, tmp_path / "restored" / "journal.sqlite")
    assert restored["status"] == "restored" and restored["counts"]["jobs"] == 2 and restored["recovery"]["uncertain"] == 0
    con = sqlite3.connect(tmp_path / "restored" / "journal.sqlite")
    states = dict(con.execute("SELECT request_id, state FROM jobs").fetchall())
    con.close()
    assert states == {"req-ask": "SUCCEEDED", "req-exp": "UNCERTAIN_COMPLETION"}  # uncertain work stays uncertain; it is not replayed
    tampered = tmp_path / "backups" / "tampered.sqlite"
    tampered.write_bytes(backup.read_bytes()[:-10] + b"0123456789")
    assert maintenance.restore_journal(tampered, manifest, tmp_path / "x" / "journal.sqlite")["status"] == "blocked"
    with pytest.raises(Exception):
        maintenance.backup_journal(env.root / "backups")  # never into a course/synced folder


def test_older_journal_copy_is_migrated_forward_and_newer_is_refused(env, tmp_path):
    maintenance = Maintenance(env.settings, env.journal)
    manifest = maintenance.backup_journal(tmp_path / "b")
    backup = tmp_path / "b" / manifest["file"]
    future = tmp_path / "b" / "future.sqlite"
    future.write_bytes(backup.read_bytes())
    con = sqlite3.connect(future)
    con.execute("UPDATE alembic_version SET version_num='9999_future'")
    con.commit()
    con.close()
    future_manifest = dict(manifest, sha256=c.sha256_hex(future.read_bytes()))
    result = maintenance.restore_journal(future, future_manifest, tmp_path / "f" / "journal.sqlite")
    assert result["status"] == "blocked" and "newer than this build" in result["problems"][0] and not (tmp_path / "f" / "journal.sqlite").exists()


def test_app_file_restore_is_no_clobber_and_limited_to_app_areas(env, tmp_path):
    env.explain()
    env.coordinator.tick()
    backup = tmp_path / "course-backup"
    import shutil

    shutil.copytree(env.settings.write_root("be505"), backup)
    capture = env.result("req-exp")["publication"]["captured_submission"]["path"]
    newer_attempt = next((env.root / "learning/attempts").rglob("be505-ll-*.json"))
    (backup / newer_attempt.relative_to(env.root)).write_text("{}")  # a stale copy of a canonical record in the backup
    (backup / capture).write_text("{\"tampered\": true}")
    lost = env.settings.runs_area("be505") / "ll-session-test-1" / "receipts"
    removed = sorted(lost.glob("native-*.json"))[0]
    removed_bytes = removed.read_bytes()
    removed.unlink()
    before_attempt = newer_attempt.read_bytes()
    result = Maintenance(env.settings, env.journal).restore_app_files(backup, "be505")
    assert removed.read_bytes() == removed_bytes and removed.relative_to(env.settings.write_root("be505")).as_posix() in result["restored"]
    assert capture in result["conflicts_left_untouched"] and env.coordinator.capture.verify("be505", env.result("req-exp")["publication"]["captured_submission"])
    assert newer_attempt.read_bytes() == before_attempt  # canonical records are outside the restore scope entirely


# ---- LL035 acceptance runner ------------------------------------------------------------------------------
def test_fixture_profile_can_never_satisfy_a_live_check(env, tmp_path):
    env.explain()
    env.coordinator.tick()
    report = run_acceptance(env.settings, env.journal, reports_dir=tmp_path / "reports")
    assert report["overall"] != "READY" and report["counts"]["NOT_RUN"] >= 8
    live = [x for x in report["checks"] if x["id"] != "no-unreconciled-work"]
    assert all(x["status"] == "NOT_RUN" and "Fixture profile" in x["detail"] for x in live)
    assert Path(report["path"]).is_file()


def test_live_profile_reports_blocked_gates_and_real_backlog_instead_of_mocked_success(workspace, tmp_path, clock):
    settings = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")
    from lecture_brain.journal import Journal

    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    try:
        reports = tmp_path / "reports"
        report = run_acceptance(settings, journal, reports_dir=reports, preparation=Preparation(settings, converter=None))
        by_id = {x["id"]: x for x in report["checks"]}
        assert report["overall"] == "NOT_READY_FAILED"
        assert by_id["inventory-denominator"]["status"] == "PASS" and by_id["inventory-denominator"]["evidence"]["lecture_units"] == 10
        assert by_id["preparation-complete"]["status"] == "FAIL" and "not processed" in by_id["preparation-complete"]["detail"]
        for gate in ("native-roundtrip", "drive-oauth", "device-pairing", "device-acceptance", "static-deployment", "canonical-writer", "quality-evaluation"):
            assert by_id[gate]["status"] == "BLOCKED", gate
        # Emulated or fixture evidence is rejected, not accepted.
        reports.mkdir(exist_ok=True)
        (reports / "device-acceptance-2026.json").write_text(json.dumps({"status": "PASS", "emulated": True}))
        (reports / "drive-proof-2026.json").write_text(json.dumps({"status": "PASS", "summary": "user-authenticated read/write/range playback verified"}))
        by_id = {x["id"]: x for x in run_acceptance(settings, journal, reports_dir=reports, preparation=Preparation(settings, converter=None))["checks"]}
        assert by_id["device-acceptance"]["status"] == "FAIL" and by_id["drive-oauth"]["status"] == "PASS"
    finally:
        journal.close()


def test_capabilities_say_plainly_which_optional_tools_this_pc_lacks(env, monkeypatch, tmp_path):
    """Speech-to-text and PowerPoint conversion are required capabilities that depend on tools this PC may not have.
    Their absence is a stated status with the fallback that still works — never silence, never a claim of support."""
    import lecture_brain.maintenance as maintenance

    monkeypatch.setattr(maintenance, "find_converter", lambda: None)
    caps = Maintenance(env.settings, env.journal).capabilities(env.adapter)
    assert caps["speech"]["status"] == "not_installed" and caps["speech"]["label"] == "Automatic transcription not available"
    assert "type or correct" in caps["speech"]["detail"] and "none is downloaded" in caps["speech"]["detail"]
    assert caps["office_converter"]["status"] == "not_installed" and "LibreOffice" in caps["office_converter"]["detail"]
    assert "original" in caps["office_converter"]["detail"]
    soffice = tmp_path / "soffice.exe"
    soffice.write_bytes(b"x")
    monkeypatch.setattr(maintenance, "find_converter", lambda: soffice)
    caps = Maintenance(env.settings, env.journal).capabilities(env.adapter)
    assert caps["office_converter"]["status"] == "available" and caps["office_converter"]["label"] == "PowerPoint decks can be shown as PDF renditions"


def test_evaluation_keeps_each_kind_of_hard_case_apart_and_runs_offline(repo, settings, tmp_path):
    """Valid alternative, partial answer, unclear transcript, an unasked prerequisite, an assisted answer, a disputed
    grade and an unmatched source are different questions. One blended agreement figure would hide them. The mechanics
    run offline against scripted replies; that run is labeled as a double and can never promote."""
    from lecture_brain.evaluation import ScriptedReplyAdapter

    cases = repo / "fixtures/evaluation/case-kinds.json"
    adapter = ScriptedReplyAdapter([cases])
    assert adapter.is_test_double is True and "scripted" in adapter.label.lower()
    report = run_evaluation([cases], adapter, policy=settings.policy, out_dir=tmp_path / "eval", rubric_digest="r1")
    a = report["assessment"]
    assert a["by_kind"] == {"valid_alternative": 1, "partial": 1, "ambiguous": 1, "false_prerequisite": 1, "assisted": 1, "disputed": 1}
    # A disputed label is not ground truth: it is held out of the agreement figure until a person adjudicates it.
    assert a["disputed_awaiting_adjudication"] == {"cases": 1, "reply_within_acceptable_outcomes": 1}
    assert a["grade_agreement"]["n"] == 5 and a["grade_agreement"]["successes"] == 5  # 2 skills in the partial case + 3 single-skill cases; ambiguous and disputed are not in it
    assert a["false_rejection_of_valid_alternatives"] == wilson(0, 1) and a["useful_abstention_on_ambiguous"] == wilson(1, 1)
    # A reply that grades a skill nobody asked about is counted, and that extra judgment is never accepted.
    assert a["prerequisite_overreach"] == {"cases": 1, "replies_judging_unasked_skills": 1, "unasked_judgments_accepted": 0}
    # Assisted answers are told to the tutor as assisted and reported apart from independent ones.
    assert a["assisted"] == {"cases": 1, "conditions_stated_to_tutor": 1, "agreement": wilson(1, 1)}
    assert a["independent_agreement"]["n"] == 4
    # Unmatched material: proposing nothing is the right answer and is reported as such, not as missing coverage.
    assert report["alignment"]["unmatched_cases"] == {"cases": 1, "abstained": 1}
    decision = report["promotion"]
    assert decision["promote"] is False and "scripted" in " ".join(decision["reasons"]).lower() and "synthetic" in " ".join(decision["reasons"])
    # The scripted adapter answers only the cases it was given and never anything else.
    from lecture_brain.native import NativeSubmission, NativeTarget

    other = adapter.submit(NativeSubmission("x", "x", NativeTarget("evaluation", "evaluation", "0" * 64, "t", "read-only", "never"), "an unrelated prompt", 5.0))
    assert other.state == "failed" and other.failure_code == "no_scripted_reply"


def test_drafted_unreviewed_cases_are_accepted_as_a_case_set_but_never_count_as_reviewed(repo, settings, tmp_path):
    """Cases grounded in real questions but written by a developer or a model are neither synthetic nor reviewed.
    They get their own label, run through the mechanics, and can no more promote than synthetic ones."""
    from lecture_brain.evaluation import ScriptedReplyAdapter

    drafted = json.loads((repo / "fixtures/evaluation/case-kinds.json").read_text(encoding="utf-8"))
    drafted.update(case_set="drafted-v1", label_source="drafted_unreviewed")
    path = tmp_path / "drafted.json"
    path.write_text(json.dumps(drafted), encoding="utf-8")
    assert load_cases(path)["label_source"] == "drafted_unreviewed"
    report = run_evaluation([path], ScriptedReplyAdapter([path]), policy=settings.policy, out_dir=tmp_path / "eval", rubric_digest="r1")
    assert report["label_source"] == "drafted_unreviewed" and report["promotion"]["promote"] is False
    assert any("not human-reviewed" in reason for reason in report["promotion"]["reasons"])
    # Mixing one reviewed file with a drafted one never yields "reviewed".
    reviewed = tmp_path / "reviewed.json"
    signed = [dict(case, review={"status": "reviewed", "reviewer": "course owner", "reviewed_at": "2026-10-05"}) for case in drafted["cases"]]
    reviewed.write_text(json.dumps(dict(drafted, case_set="rev", label_source="reviewed", cases=signed)), encoding="utf-8")
    mixed = run_evaluation([reviewed, path], ScriptedReplyAdapter([path]), policy=settings.policy, out_dir=tmp_path / "eval2", rubric_digest="r1")
    assert mixed["label_source"] != "reviewed" and mixed["promotion"]["promote"] is False


def test_a_case_file_cannot_be_called_reviewed_unless_every_case_was_reviewed_by_a_named_person(repo, tmp_path):
    """Changing one word at the top of a drafted file must not turn drafts into reviewed labels. Each case carries its
    own review record; a file claiming "reviewed" with any case still awaiting review, or reviewed by its own author
    the development assistant, is refused."""
    drafted = json.loads((repo / "fixtures/evaluation/case-kinds.json").read_text(encoding="utf-8"))
    path = tmp_path / "claimed.json"

    def claim(cases):
        path.write_text(json.dumps(dict(drafted, case_set="claimed", label_source="reviewed", cases=cases)), encoding="utf-8")
        return load_cases(path)

    with pytest.raises(ValueError, match="not reviewed case by case"):
        claim(drafted["cases"])  # no review record at all
    waiting = [dict(case, review={"status": "awaiting_owner_review", "drafted_by": "development assistant"}) for case in drafted["cases"]]
    with pytest.raises(ValueError, match="not reviewed case by case"):
        claim(waiting)
    signed = [dict(case, review={"status": "reviewed", "reviewer": "course owner", "reviewed_at": "2026-10-05"}) for case in drafted["cases"]]
    with pytest.raises(ValueError, match="not reviewed case by case"):
        claim(signed[:-1] + [waiting[-1]])  # one left over is enough
    with pytest.raises(ValueError, match="not reviewed case by case"):
        claim([dict(case, review={"status": "reviewed", "reviewer": "development assistant", "reviewed_at": "2026-10-05"}) for case in drafted["cases"]])
    assert claim(signed)["label_source"] == "reviewed"
