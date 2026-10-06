"""Amendment R2, wiring: the modules built for slide identity, question ties, timing links and the concept graph are
reachable through the one app and the one lecture view (docs/engineering/r2-read-api.md). Each module has its own
tests; these pin that the seams are connected and stay connected."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lecture_brain.api import create_app
from lecture_brain.runtime import Runtime

COURSE = "be505"


@pytest.fixture()
def runtime(settings, clock):
    rt = Runtime(settings, clock=clock)
    rt.startup()
    yield rt
    rt.journal.close()


@pytest.fixture()
def client(runtime):
    return TestClient(create_app(runtime, extra_hosts={"testserver"}))


def test_the_concept_graph_is_served_for_each_scope_and_refuses_what_does_not_exist(client):
    course = client.get(f"/api/courses/{COURSE}/concept-graph").json()
    assert course["graph_version"] == "concept-graph/1" and course["scope"]["kind"] == "course"
    assert course["nodes"] and {n["kind"] for n in course["nodes"]} <= {"topic", "concept", "skill", "question", "criterion"}
    assert {e["family"] for e in course["edges"]} <= {"assessment", "source", "structure"}
    lecture = client.get(f"/api/courses/{COURSE}/concept-graph", params={"scope": "lecture:lecture-01"}).json()
    assert lecture["scope"]["kind"] == "lecture" and lecture["totals"]["question"] <= course["totals"]["question"]
    concept = next(n["id"] for n in course["nodes"] if n["kind"] == "concept")
    focused = client.get(f"/api/courses/{COURSE}/concept-graph", params={"focus": concept, "depth": 2}).json()
    assert focused["focus"] == concept and any(n["id"] == concept for n in focused["nodes"])
    unknown_scope = client.get(f"/api/courses/{COURSE}/concept-graph", params={"scope": "lecture:no-such-lecture"})
    unknown_focus = client.get(f"/api/courses/{COURSE}/concept-graph", params={"focus": "no-such-node"})
    assert unknown_scope.status_code == 404 and unknown_scope.json()["error"]["code"] == "unknown_scope"
    assert unknown_focus.status_code == 404 and unknown_focus.json()["error"]["code"] == "unknown_focus"
    assert client.get("/api/courses/unknown/concept-graph").status_code == 404


def test_the_inferred_anchor_readback_says_plainly_when_there_is_no_file(client):
    readback = client.get(f"/api/courses/{COURSE}/inferred-anchors").json()
    assert readback["file"]["state"] == "missing" and readback["accepted"] == 0
    assert client.get("/api/courses/unknown/inferred-anchors").status_code == 404


def test_outline_rows_and_node_detail_carry_the_r2_evidence_state_and_openable_sources(client):
    top = client.get(f"/api/courses/{COURSE}/outline").json()
    assert top["rows"] and all(row["evidence"]["state"] in {"unknown", "not_applicable", "not_separately_observed", "assisted", "independent"} for row in top["rows"])
    question = "BE505-L01-Q01"  # the synthetic course names page 2 of the lecture-01 deck for it
    detail = client.get(f"/api/courses/{COURSE}/outline/node", params={"id": question}).json()
    assert detail["evidence"]["state"] in {"unknown", "not_applicable", "not_separately_observed", "assisted", "independent"}
    assert detail["evidence"]["prior_exposure"] in {"unseen", "seen", "unknown"} and "summary" in detail["evidence"]
    assert detail["evidence"]["unit"] == "skill", "the R1 evidence fields stay beside the R2 ones"
    paged = [s for s in detail["sources"] if s.get("pages")]
    assert paged and all(s["href"].startswith(f"/courses/{COURSE}/") and s["label"] for s in paged), "a source page is a link the learner can open"
    slide = client.get(f"/api/courses/{COURSE}/outline", params={"scope": "slide:lecture-01:2"}).json()
    assert slide["scope"]["kind"] == "slide" and "question_ids" not in slide["scope"]


NO_RANGE_STATES = {"recording_unavailable", "no_range_expected", "audio_unprocessed", "association_not_run", "ambiguous", "not_discussed"}
EVIDENCE_STATES = {"unknown", "not_applicable", "not_separately_observed", "assisted", "independent"}


def test_the_lecture_view_carries_identity_ties_ranges_and_timing_for_every_page(client):
    view = client.get(f"/api/courses/{COURSE}/lectures/lecture-01").json()
    assert view["source_map"]["state"] in {"ready", "unavailable"} and (view["source_map"]["state"] == "ready" or view["source_map"]["reason"])
    assert view["slides"], "the synthetic lecture has pages"
    for slide in view["slides"]:
        identity = slide["identity"]
        assert identity["page_index"] == slide["page"] and identity["label"].startswith(f"PDF page {slide['page']} of {view['page_count']}")
        assert slide["role"]["value"] and isinstance(slide["role"]["forced_requirements"], bool)
        assert isinstance(slide["question_ties"], list) and isinstance(slide["section_ties"], list) and isinstance(slide["related_questions"], list)
        assert all(tie["tie"] in {"exact", "stated", "agent_inferred"} and tie["evidence"]["state"] in EVIDENCE_STATES for tie in slide["question_ties"])
        assert isinstance(slide["ranges"], list)
        assert (slide["no_range"] is None) == bool(slide["ranges"]), "a page has ranges or exactly one stated reason for having none"
        assert slide["no_range"] is None or slide["no_range"]["state"] in NO_RANGE_STATES
    tied = [tie for slide in view["slides"] for tie in slide["question_ties"]]
    assert any(tie["question_id"] == "BE505-L01-Q01" and tie["where"] == "on_this_page" for tie in tied), "the course's own page anchor is a tie on that page"
    counts = view["questions"]["counts"]
    assert counts["all"] == len(view["questions"]["all"]) and counts["course_anchor"] + counts["agent_inferred"] + counts["without_link"] == counts["all"]
    assert all(("ties" in row) and ("no_link" in row) and row["evidence"]["state"] in EVIDENCE_STATES for row in view["questions"]["all"])
    assert view["timing"]["stage"] in {"no_recording", "audio_unprocessed", "partly_processed", "processed", "associated"}
    assert {"deck_sha256", "map_revision", "question_index_sha256", "inferred_anchors_sha256", "timing_links", "evidence_revision"} <= set(view["revisions"])


def test_a_stored_suggestion_shows_as_a_suggested_tie_and_a_learner_decision_is_reflected(client, settings):
    from lecture_brain import inferred_anchors

    context = inferred_anchors.course_context(settings, COURSE)
    deck = next(d for l in context["inventory"]["lectures"] if l["lecture_id"] == "lecture-01" for d in l["decks"] if d["source_id"] == "src-lecture-01-slides")
    sha = context["deck_sha256_of"](deck)
    inferred_anchors.store(settings, COURSE, {
        "contract": "ll.inferred-anchors/1", "course_id": COURSE, "produced_at": "2026-10-05T12:00:00Z", "producer": "claude-session", "question_index_sha256": context["index"]["sha256"],
        "items": [{"question_id": "BE505-L01-Q04", "question_version": 1, "lecture_id": "lecture-01", "source_id": "src-lecture-01-slides", "source_sha256": sha, "pages": [2, 3], "regions": None,
                   "criteria": ["BE505-L01-Q04.C01"], "coverage": "partial", "rationale": "Synthetic: the named pages show the parts this criterion asks about.", "state": "agent_inferred",
                   "verifier": None}]})
    view = client.get(f"/api/courses/{COURSE}/lectures/lecture-01").json()
    suggested = [tie for slide in view["slides"] if slide["page"] in (2, 3) for tie in slide["question_ties"] if tie["tie"] == "agent_inferred"]
    assert {tie["question_id"] for tie in suggested} == {"BE505-L01-Q04"} and all(tie["state"] == "agent_inferred" and tie["learner_decision"] is None for tie in suggested)
    assert view["revisions"]["inferred_anchors_sha256"]
    decided = client.post(f"/api/courses/{COURSE}/suggestions/{suggested[0]['suggestion_id']}/decision", json={"decision": "rejected"})
    assert decided.status_code == 200
    after = client.get(f"/api/courses/{COURSE}/lectures/lecture-01").json()
    assert not [tie for slide in after["slides"] for tie in slide["question_ties"] if tie["tie"] == "agent_inferred"], "a rejected suggestion is no longer shown as a link"


def test_generated_speech_text_states_what_was_covered_and_what_was_withheld(client, settings):
    view = client.get(f"/api/courses/{COURSE}/lectures/lecture-02").json()
    for recording in view["recordings"]:
        generated = recording["generated_text"]
        assert generated is None or {"covered_intervals", "unresolved_intervals", "unresolved_seconds"} <= set(generated)


def test_the_course_timing_readback_and_the_source_map_of_a_lecture_are_served(client):
    timing = client.get(f"/api/courses/{COURSE}/timing").json()
    assert timing["course_id"] == COURSE and isinstance(timing["lectures"], list) and timing["lectures"]
    source_map = client.get(f"/api/courses/{COURSE}/lectures/lecture-01/source-map").json()
    assert source_map["state"] in {"ready", "unavailable"} and source_map["lecture_id"] == "lecture-01"
    assert client.get(f"/api/courses/{COURSE}/lectures/no-such/source-map").status_code == 404


def test_catalogs_are_parsed_once_while_their_bytes_stay_the_same_and_reread_when_they_change(runtime, settings):
    projector = runtime.projector
    first = projector._catalogs(COURSE)
    again = projector._catalogs(COURSE)
    assert again["skills"] is first["skills"] and again["questions"] is first["questions"], "unchanged files are not parsed again on every request"
    path = settings.course(COURSE).root / "learning" / "skills.yaml"
    text = path.read_text(encoding="utf-8")
    some_label = next(skill["performance_target"] for skill in first["skills"]["skills"].values() if skill.get("performance_target"))
    path.write_text(text.replace(some_label, some_label + " (reworded)", 1), encoding="utf-8")
    changed = projector._catalogs(COURSE)
    assert changed["skills"] is not first["skills"]
    assert any(skill.get("performance_target") == some_label + " (reworded)" for skill in changed["skills"]["skills"].values()), "a changed catalog is read again, never served from memory"


def test_one_request_reads_the_inventory_once_and_the_next_request_sees_a_new_file(settings):
    from lecture_brain.ownerio import inventory

    binding = settings.course(COURSE)
    with inventory.request_memo():
        first = inventory.build_inventory(binding)
        assert inventory.build_inventory(binding) is first, "inside one request the inventory is built once"
    assert inventory.build_inventory(binding) is not first, "nothing is remembered between requests"
    lecture = first["lectures"][0]
    deck = next(d for d in lecture["decks"] if d.get("path"))
    extra = (binding.root / deck["path"]).with_name("an-extra-handout.pdf")
    extra.write_bytes((binding.root / deck["path"]).read_bytes())
    with inventory.request_memo():
        listed = inventory.build_inventory(binding)
    names = {i["filename"] for l in listed["lectures"] for i in [*l["decks"], *l["extra_materials"]]} | {i["filename"] for i in listed["other_sources"]}
    assert "an-extra-handout.pdf" in names


def test_a_suggested_session_link_reaches_the_lecture_view_with_its_evidence(settings, clock):
    from dataclasses import replace

    offered = replace(settings, courses={**settings.courses, "ds551": replace(settings.course("ds551"), suggest_session_links=True)})
    rt = Runtime(offered, clock=clock)
    rt.startup()
    try:
        view = TestClient(create_app(rt, extra_hosts={"testserver"})).get("/api/courses/ds551/lectures/lecture-01").json()
    finally:
        rt.journal.close()
    assert view["session_link"] == "suggested_by_file_name"
    assert view["session_link_evidence"]["state"] == "suggested" and view["session_link_evidence"]["session_id"] == "2026-09-03"
    assert view["recordings"] or view["transcripts"], "the offered session's files are shown with the unit"


def test_a_view_of_one_course_lists_no_other_courses_folder(client, settings, monkeypatch):
    """The page of one course, its lectures, its questions and its maps read that course. Listing the folders of the other
    bound courses for them made every such page as slow as all five courses together on a synced drive. (The timing readback WITH
    the transcription queue is the one course route that reads them all: the queue is one queue for every course.)"""
    from lecture_brain.ownerio import inventory

    assert len(settings.courses) > 1, "the check needs a second bound course"
    calls: list[str] = []
    real = inventory._build_inventory

    def counted(binding):
        calls.append(binding.course_id)
        return real(binding)

    monkeypatch.setattr(inventory, "_build_inventory", counted)
    for path in (f"/api/courses/{COURSE}", f"/api/courses/{COURSE}/lectures/lecture-01", f"/api/courses/{COURSE}/timing?queue=false", f"/api/courses/{COURSE}/outline",
                 f"/api/courses/{COURSE}/concept-graph", f"/api/courses/{COURSE}/questions", f"/api/courses/{COURSE}/progress", f"/api/courses/{COURSE}/inferred-anchors"):
        calls.clear()
        assert client.get(path).status_code == 200, path
        assert set(calls) <= {COURSE}, (path, sorted(set(calls)))


def test_a_lecture_view_checks_each_annotation_file_once_for_the_life_of_the_service(client, monkeypatch):
    """Every part of a lecture view reads the learner's links through the one store of the service, and that store reads a
    revision file once. A second request for the same lecture checks no annotation file again."""
    from lecture_brain import annotations

    checked: list[str] = []
    real = annotations.c.validate

    def counting(kind, record):
        if kind == "annotation":
            checked.append(record.get("annotation_id") if isinstance(record, dict) else "?")
        return real(kind, record)

    monkeypatch.setattr(annotations.c, "validate", counting)
    assert client.get(f"/api/courses/{COURSE}/lectures/lecture-01").status_code == 200
    assert checked and len(checked) == len(set(checked)), "within one request no file is checked twice"
    checked.clear()
    assert client.get(f"/api/courses/{COURSE}/lectures/lecture-01").status_code == 200
    assert checked == []


def test_one_api_request_lists_each_course_folder_once(client, settings, monkeypatch):
    """Listing a course folder is the slowest thing a view does on a synced drive; a request must not repeat it."""
    from lecture_brain.ownerio import inventory

    calls: list[str] = []
    real = inventory._build_inventory

    def counted(binding):
        calls.append(binding.course_id)
        return real(binding)

    monkeypatch.setattr(inventory, "_build_inventory", counted)
    for path in (f"/api/courses/{COURSE}", f"/api/courses/{COURSE}/lectures/lecture-01", f"/api/courses/{COURSE}/timing", f"/api/courses/{COURSE}/outline",
                 f"/api/courses/{COURSE}/concept-graph", "/api/workspace", "/api/coverage"):
        calls.clear()
        assert client.get(path).status_code == 200
        counts = {course_id: calls.count(course_id) for course_id in set(calls)}
        assert counts and max(counts.values()) == 1, (path, counts)
    calls.clear()
    assert client.get(f"/api/courses/{COURSE}/lectures/lecture-01").status_code == 200
    assert calls.count(COURSE) == 1, "nothing is remembered between requests: the next request lists the folder again"
