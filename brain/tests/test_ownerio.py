"""LL003 / LL009: typed read boundary over the existing owners and a complete source inventory."""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from lecture_brain.config import load_settings
from lecture_brain.ownerio import OwnerReadError
from lecture_brain.ownerio.attempts import learning_view_status, read_attempt_records
from lecture_brain.ownerio.catalogs import read_answer_guidance, read_families, read_question_index, read_skills
from lecture_brain.ownerio.inventory import build_inventory, coverage_summary
from lecture_brain.ownerio.source_index import read_source_index


# ---- bindings ------------------------------------------------------------------------------------
def test_all_five_configured_courses_are_bound(settings):
    assert sorted(settings.courses) == ["be505", "be562", "be572", "cs542", "ds551"]
    assert all(b.usable and b.term == "2026-fall" for b in settings.courses.values())
    assert settings.course("be505").display_name.startswith("FIXTURE")


def test_identity_mismatch_stops_only_that_binding(workspace, tmp_path):
    course_yaml = workspace / "University" / "CS 542" / "course.yaml"
    course_yaml.write_text(course_yaml.read_text(encoding="utf-8").replace("course_id: cs542", "course_id: cs999"), encoding="utf-8")
    s = load_settings("fixture", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")
    assert s.course("cs542").status == "identity_mismatch" and not s.course("cs542").usable
    assert s.course("be505").usable


def test_binding_revision_changes_with_binding(settings, workspace, tmp_path):
    other = load_settings("fixture", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "other-state")
    assert other.binding_revision == settings.binding_revision
    other.courses["be505"] = type(other.courses["be505"])("be505", "2026-fall", Path("X:/elsewhere"), "x", "tutor-be505")
    assert other.binding_revision != settings.binding_revision


def test_local_profile_never_writes_into_course_roots(workspace, tmp_path):
    s = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "state")
    assert s.course_writes_enabled is False and s.native_dispatch_enabled is False
    assert not s.app_area("be505").is_relative_to(s.course("be505").root)
    assert s.app_area("be505").is_relative_to(tmp_path / "state")


# ---- published source index ----------------------------------------------------------------------
def test_source_index_is_read_only_when_marker_matches(be505):
    index = read_source_index(be505, "be505")
    assert index["revision"] == 3 and "src-lecture-01-slides" in index["entries"]
    entry = index["entries"]["src-lecture-01-slides"]
    assert entry["current"]["version_id"].startswith("v1-") and entry["current"]["version_id"][3:] == entry["current"]["sha256"][:12]
    assert index["entries"]["src-ps-02-brief"]["current"]["availability"] == "unavailable"


def test_mixed_bundle_is_unavailable_not_changed_data(be505):
    path = be505 / ".agent/source-index.json"
    path.write_text(path.read_text(encoding="utf-8").replace('"revision": 3', '"revision": 4'), encoding="utf-8")
    with pytest.raises(OwnerReadError) as err:
        read_source_index(be505, "be505")
    assert err.value.code == "mixed_bundle"


def test_wrong_course_identity_is_rejected(be505):
    with pytest.raises(OwnerReadError) as err:
        read_source_index(be505, "be562")
    assert err.value.code == "identity_mismatch"


# ---- inventory -----------------------------------------------------------------------------------
def test_inventory_accounts_for_every_unit_and_keeps_states_distinct(settings):
    inv = build_inventory(settings.course("be505"))
    lectures = {l["lecture_id"]: l for l in inv["lectures"]}
    assert sorted(lectures) == ["lecture-01", "lecture-02", "lecture-03", "lecture-04"]
    l1, l2, l3 = lectures["lecture-01"], lectures["lecture-02"], lectures["lecture-03"]
    assert l1["decks"][0]["state"] == "registered_readable" and l1["decks"][0]["source_id"] == "src-lecture-01-slides"
    assert [s["session_id"] for s in l1["sessions"]] == ["2026-09-03"]
    # Lecture 02: the recording is on disk but was never registered by the owner's updater.
    rec2 = next(i for i in l2["sessions"][0]["items"] if i["kind"] == "lecture_recording")
    assert rec2["state"] == "present_unindexed" and rec2["source_id"].startswith("unreg-") and rec2["sha256"] is None
    # Lecture 03: slides exist, are unindexed, and no session is linked.
    assert l3["decks"][0]["state"] == "present_unindexed" and l3["sessions"] == [] and l3["session_link"] == "none_recorded"
    sessions = {s["session_id"]: s for s in inv["sessions"]}
    assert sessions["2026-09-10"]["state"] == "empty_unrecorded" and sessions["2026-09-10"]["items"] == []
    other = {i["source_id"]: i for i in inv["other_sources"]}
    assert other["src-ps-02-brief"]["state"] == "registered_unavailable" and other["src-ps-02-brief"]["path"] is None
    assert other["src-ps-01-solutions"]["disclosure"] == "restricted_solution"
    assert any(i["state"] == "present_unindexed" and i["kind"] == "textbook" for i in inv["other_sources"])


def test_inventory_states_across_other_courses(settings):
    be572 = build_inventory(settings.course("be572"))
    decks = {l["lecture_id"]: l["decks"][0] for l in be572["lectures"]}
    assert decks["lecture-01"]["state"] == "registered_empty"
    assert decks["lecture-02"]["state"] == "present_unindexed" and decks["lecture-02"]["rendition"] == "needs_rendition"
    session = be572["sessions"][0]
    assert session["state"] == "transcript_only_no_recording"
    ds551 = build_inventory(settings.course("ds551"))
    assert ds551["lectures"][0]["decks"][0]["state"] == "present_unindexed"
    assert {s["session_id"] for s in ds551["unlinked_sessions"]} == {"2026-09-03", "2026-09-10"}  # correspondence is not recorded, never guessed
    cs542 = build_inventory(settings.course("cs542"))
    assert cs542["lectures"][0]["decks"][0]["rendition"] == "needs_rendition"


def test_coverage_denominator_is_all_courses_and_is_not_filterable(settings):
    summary = coverage_summary(settings)
    assert sorted(summary["courses"]) == ["be505", "be562", "be572", "cs542", "ds551"]
    assert summary["totals"]["lecture_units"] == 4 + 2 + 3 + 1 + 1
    assert summary["totals"]["sessions"] == 3 + 2 + 1 + 1 + 2
    be505 = summary["courses"]["be505"]
    assert be505["by_state"]["present_unindexed"] >= 3 and be505["by_state"]["registered_unavailable"] == 1
    # Preparation state is separate from learning evidence.
    assert "attempts" not in be505 and "mastery" not in json.dumps(summary)


def test_stray_prefix_directory_is_not_treated_as_agent_dir(settings, be505):
    stray = be505 / ".agentร้อง" / "course-learning" / "runs"
    stray.mkdir(parents=True)
    (be505 / ".agentร้อง" / "source-index.json").write_text("{}", encoding="utf-8")
    assert read_source_index(be505, "be505")["revision"] == 3


def test_missing_file_for_indexed_readable_source_is_inaccessible(settings, be505):
    (be505 / "materials/assignments/ps-01/Fixture PS01.pdf").unlink()
    inv = build_inventory(settings.course("be505"))
    item = next(i for i in inv["other_sources"] if i["source_id"] == "src-ps-01-brief")
    assert item["state"] == "registered_missing_on_disk"


# ---- catalogs ------------------------------------------------------------------------------------
def test_catalogs_keep_owner_ids_and_relation_meanings(be505):
    skills = read_skills(be505, "be505")
    assert "be505.skill.ori.explain" in skills["skills"] and skills["skills"]["be505.skill.ori.explain"]["concept_id"] == "be505.concept.origin-of-replication"
    families = read_families(be505, "be505")
    fam = families[("be505.family.question.l01-q03", 1)]
    assert set(fam["skill_ids"]) == {r["skill_id"] for r in fam["rubric"]}
    qi = read_question_index(be505, "be505")
    rels = {(r["from_question"], r["to_question"]): r for r in qi["relationships"]}
    assert rels[("BE505-L01-Q02", "BE505-L01-Q03")]["relation"] == "strict_containment"
    assert all(r["automatic_credit"] is False for r in qi["relationships"])
    assert "answer" not in json.dumps(qi)  # prompts only; answers stay in the restricted guide
    assert read_question_index(settings_root_for("be562", be505), "be562") is None


def settings_root_for(course_dir_id: str, be505: Path) -> Path:
    names = {"be562": "BE 562", "cs542": "CS 542", "ds551": "DS 551", "be572": "BE 572"}
    return be505.parent / names[course_dir_id]


def test_answer_guidance_is_a_separate_restricted_read(be505):
    assert "Replication" in read_answer_guidance(be505, "BE505-L01-Q01")
    assert read_answer_guidance(be505, "BE505-L99-Q99") is None


def test_duplicate_yaml_keys_are_rejected(be505):
    path = be505 / "learning/skills.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "\nrevision: 2\n", encoding="utf-8")
    with pytest.raises(OwnerReadError) as err:
        read_skills(be505, "be505")
    assert err.value.code == "invalid_record"


# ---- attempts ------------------------------------------------------------------------------------
def test_effective_observations_follow_the_revision_chain_without_adding_attempts(be505):
    records = read_attempt_records(be505, "be505")
    assert len(records["attempts"]) == 4 and len(records["revisions"]) == 1 and records["problems"] == []
    original = records["attempts"]["be505-20260907-l01-q03-assisted-03"]
    effective = records["effective"]["be505-20260907-l01-q03-assisted-03"]
    by_skill = {o["skill_id"]: o["outcome"] for o in effective["observations"]}
    assert by_skill["be505.skill.ori-vs-promoter.integrate"] == "partial"
    assert {o["skill_id"]: o["outcome"] for o in original["observations"]}["be505.skill.ori-vs-promoter.integrate"] == "not_demonstrated"
    assert effective["assessment_id"] == "be505-20260908-l01-q03-regrade-01" and effective["chain"] == ["be505-20260907-l01-q03-assisted-03", "be505-20260908-l01-q03-regrade-01"]
    assert original["occurred_at"] is None and original["time_basis"] == "unknown"  # never fabricated


def test_branched_correction_chain_needs_reconciliation(be505):
    branch = json.loads((be505 / "learning/attempts/2026-09/be505-20260908-l01-q03-regrade-01.json").read_text(encoding="utf-8"))
    branch["event_id"] = "be505-20260908-l01-q03-regrade-02"
    (be505 / "learning/attempts/2026-09/be505-20260908-l01-q03-regrade-02.json").write_text(json.dumps(branch), encoding="utf-8")
    records = read_attempt_records(be505, "be505")
    assert any(p["code"] == "branched_chain" for p in records["problems"])
    assert records["effective"]["be505-20260907-l01-q03-assisted-03"]["conflict"] is True


def test_zero_attempts_is_unassessed_not_failure(settings):
    records = read_attempt_records(settings.course("cs542").root, "cs542")
    assert records["attempts"] == {} and records["problems"] == []


def test_unrecognised_files_in_attempts_tree_are_reported(be505):
    (be505 / "learning/attempts/2026-09/notes.txt").write_text("x", encoding="utf-8")
    records = read_attempt_records(be505, "be505")
    assert any(p["code"] == "unrecognised_artifact" for p in records["problems"])


def test_learning_view_freshness_is_checked_from_bytes(be505):
    assert learning_view_status(be505) == "current"
    path = next((be505 / "learning/attempts/2026-09").glob("*-retry-02.json"))
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    assert learning_view_status(be505) == "stale"
    (be505 / "learning-state.md").unlink()
    assert learning_view_status(be505) == "unavailable"


def test_fixture_evidence_validates_against_the_real_owner_schema(settings, owner_learning_schema):
    """LL003: synthetic records are checked against the supplied original schema, not a guess of it."""
    validator = Draft202012Validator({"$ref": "#/$defs/evidence_record", "$defs": owner_learning_schema["$defs"]}, format_checker=FormatChecker())
    checked = 0
    for binding in settings.courses.values():
        for path in (binding.root / "learning/attempts").glob("*/*.json"):
            errors = [e.message for e in validator.iter_errors(json.loads(path.read_text(encoding="utf-8")))]
            assert errors == [], (path.name, errors)
            checked += 1
    assert checked == 6


@pytest.mark.skipif(not os.environ.get("LL_REAL_PLANNER_CONFIG"), reason="Real-root read-only smoke runs only when LL_REAL_PLANNER_CONFIG is set by the user")
def test_real_roots_metadata_smoke_read_only(tmp_path):
    s = load_settings("local", env={}, planner_config=Path(os.environ["LL_REAL_PLANNER_CONFIG"]), state_dir=tmp_path / "state")
    summary = coverage_summary(s)
    assert sorted(summary["courses"]) == ["be505", "be562", "be572", "cs542", "ds551"]
    assert summary["totals"]["lecture_units"] > 0


def test_fixture_question_index_carries_the_policy_keys_the_owner_helper_reads(be505):
    """The owner's refresh reads index['policy']['coverage']; a synthetic root without it cannot exercise that code."""
    index = json.loads((be505 / "learning/question-index.json").read_text(encoding="utf-8"))
    assert set(index["policy"]) >= {"shared_concept", "strict_containment", "unassessed", "family_matching", "future_attempts", "coverage"}
    assert all(isinstance(v, str) and v for v in index["policy"].values())


def test_local_state_dir_comes_from_the_private_binding_file_and_never_sits_inside_a_course(workspace, tmp_path):
    """Derived files for real courses live where the private binding says — inside the code workspace, not in a course."""
    import shutil

    from lecture_brain.config import ConfigError, repo_root

    repo = tmp_path / "repo"
    (repo / "config" / "local-bindings").mkdir(parents=True)
    for name in ("defaults.json", "workspace.example.json"):
        shutil.copy(repo_root() / "config" / name, repo / "config" / name)
    planner = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    binding = repo / "config" / "local-bindings" / "workspace.json"
    binding.write_text(json.dumps({"planner_config": str(planner), "local_state_dir": ".local/state/real"}), encoding="utf-8")

    s = load_settings("local", env={}, repo=repo)
    assert s.state_dir == repo / ".local" / "state" / "real"  # a relative path is anchored in the workspace
    assert s.app_area("be505").is_relative_to(repo / ".local") and s.course_writes_enabled is False
    # An explicit environment override still wins over the file.
    assert load_settings("local", env={"LL_LOCAL_STATE_DIR": str(tmp_path / "env")}, repo=repo).state_dir == tmp_path / "env"

    # A state directory inside a course folder or the planner folder is refused outright.
    for inside in (s.course("be505").root / ".agent" / "ll-state", planner.parent / "ll-state"):
        binding.write_text(json.dumps({"planner_config": str(planner), "local_state_dir": str(inside)}), encoding="utf-8")
        with pytest.raises(ConfigError, match="inside a course or planner folder"):
            load_settings("local", env={}, repo=repo)
        assert not inside.exists()
