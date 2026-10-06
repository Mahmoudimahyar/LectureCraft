"""A recording the course index links to no lecture unit can be OFFERED for a unit when its own file name carries
that unit's number. It is a labelled suggestion that the learner's private read configuration switches on; the course
index is never changed, the session stays listed as unlinked, and nothing is guessed when the names are ambiguous."""
from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

from lecture_brain.config import load_settings, repo_root
from lecture_brain.ownerio import inventory as inv
from lecture_brain.ownerio.inventory import build_inventory

COURSE = "ds551"  # the synthetic course: its index links session 2026-09-03 ("… Lec 1 …") to no unit, and it has lecture-01
SESSION = "2026-09-03"


def _session(root: Path, date: str, *names: str) -> None:
    """One more synthetic session folder, filled with copies of an existing synthetic recording / transcript."""
    sessions = root / "materials" / "sessions"
    folder = sessions / f"{date}-lecture"
    folder.mkdir(parents=True)
    samples = {p.suffix.lower(): p for p in sessions.rglob("*") if p.is_file()}
    for name in names:
        sample = samples.get(Path(name).suffix.lower())
        (folder / name).write_bytes(sample.read_bytes() if sample else b"synthetic line one\nsynthetic line two\n")


def _lecture(inventory: dict, lecture_id: str) -> dict:
    return next(l for l in inventory["lectures"] if l["lecture_id"] == lecture_id)


def _named(*filenames: str) -> set[int]:
    kinds = {".wav": "lecture_recording", ".m4a": "lecture_recording", ".mp4": "lecture_recording", ".txt": "lecture_transcript", ".md": "session_material"}
    return inv._named_lecture_numbers({"items": [{"kind": kinds[Path(n).suffix], "filename": n} for n in filenames]})


def test_without_the_setting_nothing_is_offered_and_the_inventory_is_what_the_course_index_says(settings):
    inventory = build_inventory(settings.course(COURSE))
    lecture = _lecture(inventory, "lecture-01")
    assert lecture["session_link"] == "none_recorded" and lecture["sessions"] == [] and "session_link_evidence" not in lecture
    assert SESSION in {s["session_id"] for s in inventory["unlinked_sessions"]}
    assert all("suggested_lecture_ids" not in s for s in inventory["sessions"])


def test_a_session_whose_file_names_carry_the_units_number_is_offered_as_a_labelled_suggestion(settings):
    inventory = build_inventory(replace(settings.course(COURSE), suggest_session_links=True))
    lecture = _lecture(inventory, "lecture-01")
    assert lecture["session_link"] == "suggested_by_file_name"
    assert [s["session_id"] for s in lecture["sessions"]] == [SESSION]
    evidence = lecture["session_link_evidence"]
    assert evidence["state"] == "suggested" and evidence["number"] == 1 and evidence["session_id"] == SESSION
    assert "Fixture 551 Lec 1.wav" in evidence["files"] and "course index" in evidence["note"]
    session = next(s for s in inventory["sessions"] if s["session_id"] == SESSION)
    assert session["linked_lecture_ids"] == [] and session["suggested_lecture_ids"] == ["lecture-01"]
    assert SESSION in {s["session_id"] for s in inventory["unlinked_sessions"]}, "the course index still links it to nothing, and the app keeps saying so"
    other = next(s for s in inventory["sessions"] if s["session_id"] == "2026-09-10")
    assert not other.get("suggested_lecture_ids"), "'Lec 2' has no unit lecture-02 in this course: it is offered to nothing"


def test_the_number_is_read_from_lec_and_lecture_spellings_and_never_from_a_date_or_another_number():
    assert _named("DS_551_Lecture_01_2026-09-17.m4a") == {1}
    assert _named("BE 572 Lec 3 Sep 10.m4a", "BE 572 Lec 3 Sep 10.txt") == {3}
    assert _named("Lec12.mp4") == {12} and _named("lecture-07.wav") == {7}
    assert _named("lecture.mp4", "2026-09-14.txt", "recording 1.wav") == set(), "a name without 'lec N' names no lecture"
    assert _named("collective 7.wav", "selection 3.wav") == set(), "'lec' inside another word is not 'lecture'"
    assert _named("Lec 1 and Lec 2.wav") == {1, 2}, "a session naming two lectures is offered to neither"
    assert _named("notes for lecture 5.md") == set(), "only recordings and transcripts count"


def test_two_sessions_with_the_same_number_or_a_number_without_a_unit_offer_nothing(settings):
    binding = replace(settings.course(COURSE), suggest_session_links=True)
    _session(binding.root, "2026-09-17", "Fixture 551 Lec 1 again.wav")
    _session(binding.root, "2026-09-19", "Fixture 551 Lec 9.wav")
    inventory = build_inventory(binding)
    lecture = _lecture(inventory, "lecture-01")
    assert lecture["session_link"] == "none_recorded" and lecture["sessions"] == []
    assert lecture["session_link_evidence"]["state"] == "ambiguous" and lecture["session_link_evidence"]["candidates"] == [SESSION, "2026-09-17"]
    assert all(not s.get("suggested_lecture_ids") for s in inventory["sessions"])


def test_a_unit_the_course_index_already_links_keeps_that_link_and_gets_no_suggestion(settings):
    binding = replace(settings.course("be562"), suggest_session_links=True)
    before = _lecture(build_inventory(settings.course("be562")), "lecture-01")
    assert before["session_link"] == "owner_related_sources"
    _session(binding.root, "2026-09-25", "Fixture 562 Lec 1 repeat.wav")
    after = _lecture(build_inventory(binding), "lecture-01")
    assert after["session_link"] == "owner_related_sources" and [s["session_id"] for s in after["sessions"]] == [s["session_id"] for s in before["sessions"]]
    assert "session_link_evidence" not in after


def test_the_setting_comes_from_the_private_read_configuration(workspace, tmp_path):
    repo = tmp_path / "repo"
    (repo / "config" / "local-bindings").mkdir(parents=True)
    for name in ("defaults.json", "workspace.example.json"):
        shutil.copy(repo_root() / "config" / name, repo / "config" / name)
    planner = workspace / "University" / "Fixture Brain" / "planner-config.yaml"
    binding_file = repo / "config" / "local-bindings" / "workspace.json"

    def load(overrides: dict):
        binding_file.write_text(json.dumps({"planner_config": str(planner), "local_state_dir": ".local/state/real", "read_overrides": overrides}), encoding="utf-8")
        return load_settings("local", env={}, repo=repo)

    assert load({}).course(COURSE).suggest_session_links is False
    assert load({"suggest_session_links": True}).course(COURSE).suggest_session_links is True
    only = load({"suggest_session_links": [COURSE]})
    assert only.course(COURSE).suggest_session_links is True and only.course("be505").suggest_session_links is False
