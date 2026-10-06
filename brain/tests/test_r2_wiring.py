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
    assert client.get(f"/api/courses/{COURSE}/concept-graph", params={"scope": "lecture:no-such-lecture"}).status_code == 404
    assert client.get(f"/api/courses/{COURSE}/concept-graph", params={"focus": "no-such-node"}).status_code == 404
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
