"""R2-C2 … R2-C8, R2-C11 (Brain side): one typed model read through three scopes and two presentations; three edge families;
a logical slide that lists each entry once and says on which member page its support is recorded; a bounded graph; node
detail that follows the data joins. Everything here is synthetic."""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lecture_brain import concept_graph as cg
from lecture_brain.evidence import EvidenceReader, evidence_revision
from lecture_brain.evidence import skills_under as ev_skills_under
from lecture_brain.fixtures import content
from lecture_brain.journal import Journal
from lecture_brain.outline import OutlineModel
from lecture_brain.preparation import Preparation
from lecture_brain.projections import Projector

WORDING = "CRITERION WORDING THAT MUST NOT LEAK"
PROMPT = "QUESTION WORDING THAT A GRAPH DOES NOT CARRY"
RATIONALE = "OWNER RATIONALE KEPT OUT OF THE GRAPH"
DOCUMENT_KEYS = {"course_id", "graph_version", "scope", "nodes", "edges", "focus", "truncated", "dropped", "totals", "revisions"}
NODE_KEYS = {"id", "kind", "label", "counts", "in_scope", "where", "support_pages", "evidence"}
EDGE_KEYS = {"id", "from", "to", "family", "relation", "provenance", "automatic_credit", "tie", "support_pages"}
SCOPE_KEYS = {"kind", "lecture_id", "page", "logical_slide_id", "label", "pages", "note"}
REVISION_KEYS = {"question_index_sha256", "skills_sha256", "map_revision", "anchor_revision", "policy_revision", "evidence_revision", "scope_revision"}
OWNER_RELATIONS = {"strict_containment", "diagnostic_prerequisite", "partial_overlap"}
DECKS = {"L1": "deck-1", "L2": "deck-2", "L3": None}
GROUP = "ls-0a1b2c3d4e-p22-24"


# ---- a synthetic catalog ----------------------------------------------------------------------------------------
def criterion(criterion_id, skill, concept):
    return {"criterion_id": criterion_id, "skill_id": skill, "concept_id": concept, "action_types": ["explain"], "observable": WORDING, "tag": "synthetic"}


def anchor(lecture, source, pages, basis, shown=True):
    return {"kind": "pages", "ranges": [[pages[0], pages[-1]]], "pages": pages, "basis": basis, "from": "locator", "lecture_id": lecture, "source_id": source,
            "page_basis": "one_based_physical_page", "on_displayed_deck": shown}


def build_model(*, definition=None):
    topics = {t: {"topic_id": t, "label": label} for t, label in (("t.flow", "Flow"), ("t.control", "Control"), ("t.empty", "Admin"))}

    def skill(skill_id, topic, concept, target, refs=()):
        return {"skill_id": skill_id, "topic_ids": [topic], "concept_id": concept, "performance_target": target, "source_refs": [{"source_id": s, "locator": loc} for s, loc in refs]}

    skills = {s["skill_id"]: s for s in (
        skill("s.valve.explain", "t.flow", "c.valve", "Explain a valve.", [("deck-1", "slides 22-23")]),
        skill("s.pump.size", "t.flow", "c.pump", "Size a pump."),
        skill("s.gauge.read", "t.flow", "c.gauge", "Read a gauge."),
        skill("s.loop.tune", "t.control", "c.loop", "Tune a loop."),
        skill("s.orphan", "t.control", "c.missing", "Orphan skill."))}   # its concept is not in the catalog
    concepts = {"c.valve": {"concept_id": "c.valve", "label": "Valve", "topic_ids": ["t.flow", "t.control"], "aliases": []},   # one concept under two topics
                "c.pump": {"concept_id": "c.pump", "label": "Pump", "topic_ids": ["t.flow"], "aliases": []},
                "c.gauge": {"concept_id": "c.gauge", "label": "Gauge", "topic_ids": ["t.flow"], "aliases": []},
                "c.loop": {"concept_id": "c.loop", "label": "Loop", "topic_ids": ["t.control"], "aliases": [], **({"definition": definition} if definition else {})}}

    def question(question_id, title, collection, criteria):
        return {"question_id": question_id, "title": title, "prompt": PROMPT, "collection": collection, "criteria": criteria}

    questions = {q["question_id"]: q for q in (
        question("Q1", "Valve and pump", "L1", [criterion("Q1.C01", "s.valve.explain", "c.valve"), criterion("Q1.C02", "s.pump.size", "c.pump")]),
        question("Q2", "Reading a gauge", "L1", [criterion("Q2.C01", "s.gauge.read", "c.gauge")]),
        question("Q3", "Tuning", "L1", [criterion("Q3.C01", "s.loop.tune", "c.loop")]),
        question("Q4", "Valve again", "L2", [criterion("Q4.C01", "s.valve.explain", "c.valve")]),
        question("Q5", "Orphan", "L2", [criterion("Q5.C01", "s.orphan", None)]))}
    relationships = [{"from_question": "Q2", "to_question": "Q1", "relation": "strict_containment", "rationale": RATIONALE, "automatic_credit": False},
                     {"from_question": "Q1", "to_question": "Q3", "relation": "diagnostic_prerequisite", "rationale": RATIONALE, "automatic_credit": False},
                     {"from_question": "Q3", "to_question": "Q4", "relation": "partial_overlap", "rationale": RATIONALE, "automatic_credit": True}]   # only because this catalog says so
    anchors = {"Q1": [anchor("L1", "deck-1", [22], "stated")], "Q2": [anchor("L1", "deck-1", [24], "stated")],
               "Q3": [{"kind": "transcript_lines", "ranges": [[4, 9]], "basis": "stated", "from": "locator", "lecture_id": "L1", "source_id": "tr-1"}],
               "Q4": [anchor("L2", "deck-2", [3], "exact")], "Q5": [anchor("L2", "sheet-9", [1], "stated", shown=False)]}
    bank = {"lectures": {"L1": {"lecture_id": "L1", "collections": ["L1"], "question_ids": ["Q1", "Q2", "Q3"], "gap": None},
                         "L2": {"lecture_id": "L2", "collections": ["L2"], "question_ids": ["Q4", "Q5"], "gap": None},
                         "L3": {"lecture_id": "L3", "collections": [], "question_ids": [], "gap": "No question collection in the course catalog cites a file of this lecture unit."}},
            "questions": {q: {"question_id": q, "collection": questions[q]["collection"], "anchors": anchors[q],
                              "slide_anchor": "named" if any(a["kind"] == "pages" and a["on_displayed_deck"] for a in anchors[q]) else "none"} for q in questions}}
    return OutlineModel({"skills": {"topics": topics, "skills": skills}, "families": {}, "questions": {"concepts": concepts, "questions": questions, "relationships": relationships}}, bank)


def build_irregular():
    """Shapes a real catalog also holds: a concept that criteria name and no skill is bound to (c.named); criteria whose concept is not their
    skill's concept (Q1.C02, Q2.C01); a concept whose topic is not catalogued (c.adrift); a skill with neither concept nor topic
    (s.nowhere); a skill whose concept is not catalogued (s.loose); a question without criteria (Q4); criteria on nothing catalogued (Q6)."""
    topics = {t: {"topic_id": t, "label": label} for t, label in (("t.a", "Alpha"), ("t.b", "Beta"))}
    concepts = {c: {"concept_id": c, "label": label, "topic_ids": filed, "aliases": []} for c, label, filed in (
        ("c.own", "Own", ["t.a"]), ("c.named", "Named by criteria only", ["t.a"]), ("c.other", "Other", ["t.b"]), ("c.adrift", "Adrift", ["t.gone"]))}
    skills = {s: {"skill_id": s, "topic_ids": filed, "concept_id": concept, "performance_target": label, "source_refs": []} for s, filed, concept, label in (
        ("s.own", ["t.a"], "c.own", "Own skill"), ("s.other", ["t.b"], "c.other", "Other skill"), ("s.adrift", [], "c.adrift", "Adrift skill"),
        ("s.loose", ["t.b"], "c.absent", "Loose skill"), ("s.nowhere", [], None, "Skill filed nowhere"))}
    asked = {"Q1": ("L1", [criterion("Q1.C01", "s.own", "c.own"), criterion("Q1.C02", "s.own", "c.named")]),
             "Q2": ("L1", [criterion("Q2.C01", "s.other", "c.named")]),
             "Q3": ("L2", [criterion("Q3.C01", "s.loose", None)]),
             "Q4": ("L2", []),
             "Q5": ("L2", [criterion("Q5.C01", "s.ghost", "c.adrift")]),
             "Q6": ("L2", [criterion("Q6.C01", "s.ghost", None)]),
             "Q7": ("L1", [criterion("Q7.C01", "s.nowhere", None)])}
    questions = {q: {"question_id": q, "title": f"Question {q[1:]}", "prompt": PROMPT, "collection": collection, "criteria": criteria} for q, (collection, criteria) in asked.items()}
    bank = {"lectures": {lecture: {"lecture_id": lecture, "collections": [lecture], "question_ids": [q for q in questions if questions[q]["collection"] == lecture], "gap": None} for lecture in ("L1", "L2")},
            "questions": {q: {"question_id": q, "collection": questions[q]["collection"], "anchors": [], "slide_anchor": "none"} for q in questions}}
    return OutlineModel({"skills": {"topics": topics, "skills": skills}, "families": {}, "questions": {"concepts": concepts, "questions": questions, "relationships": []}}, bank)


def support(page, entries, pages=(22, 23, 24), **extra):
    return {"logical_slide_id": GROUP, "label": f"PDF page {page} of 40 · build {list(pages).index(page) + 1} of {len(pages)}", "page": page, "pages": list(pages), "entries": entries, **extra}


THREE_BUILDS = [{"node_id": "Q1", "tie": "stated", "pages": [22]},            # shown on the first build
                {"node_id": "Q1", "tie": "stated", "pages": [22]},            # the same tie reported twice: still one entry
                {"node_id": "Q2", "tie": "agent_inferred", "pages": [24]},    # supported only on the last build
                {"node_id": "Q3", "tie": "exact", "pages": [22, 23, 24]}]     # recorded for the whole group


def graph(model=None, scope="course", **kw):
    return cg.graph(model or build_model(), course_id="demo", scope=scope, deck_source_id_of=DECKS.get, **kw)


def by_id(document):
    return {n["id"]: n for n in document["nodes"]}


def ids(document, kind=None):
    return [n["id"] for n in document["nodes"] if kind is None or n["kind"] == kind]


def edge_set(document, family=None):
    return {(e["from"], e["relation"], e["to"]) for e in document["edges"] if family is None or e["family"] == family}


def walk(model, resolved, parent=None, seen=None):
    """Every row the keyboard outline can reach under one resolved scope."""
    seen = seen if seen is not None else []
    for row in model.rows(resolved, parent)["rows"]:
        seen.append(row)
        if row["has_children"]:
            walk(model, resolved, row["instance_id"], seen)
    return seen


# ---- the document and the course scope ----------------------------------------------------------------------------
def test_the_course_graph_is_topics_concepts_and_skills_each_once_in_the_documented_shape():
    document = graph()
    assert set(document) == DOCUMENT_KEYS and document["graph_version"] == "concept-graph/1" == cg.GRAPH_VERSION and document["course_id"] == "demo"
    assert document["scope"] == {"kind": "course", "lecture_id": None, "page": None, "logical_slide_id": None, "label": None, "pages": [], "note": "Everything in this course's catalogs."}
    assert set(document["scope"]) == SCOPE_KEYS == set(graph(scope="lecture:L1")["scope"]) == set(graph(scope="slide:L1:22")["scope"])
    assert all(set(n) == NODE_KEYS for n in document["nodes"]) and all(set(e) == EDGE_KEYS for e in document["edges"])
    # stable order: kind, then label, then id
    assert ids(document) == ["t.empty", "t.control", "t.flow", "c.gauge", "c.loop", "c.pump", "c.valve", "s.valve.explain", "s.orphan", "s.gauge.read", "s.pump.size", "s.loop.tune"]
    assert document["totals"] == {"topic": 3, "concept": 4, "skill": 5, "question": 5, "criterion": 6}   # canonical counts: questions and criteria exist although they are not drawn here
    assert document["focus"] is None and document["truncated"] is False and document["dropped"] == 0
    valve = by_id(document)["c.valve"]   # under two topics: one node, two containment edges
    assert valve == {"id": "c.valve", "kind": "concept", "label": "Valve", "counts": {"skills": 1, "questions": 2}, "in_scope": True, "where": None, "support_pages": [], "evidence": None}
    assert edge_set(document) == {("t.flow", "topic_includes_concept", "c.valve"), ("t.control", "topic_includes_concept", "c.valve"), ("t.flow", "topic_includes_concept", "c.pump"),
                                  ("t.flow", "topic_includes_concept", "c.gauge"), ("t.control", "topic_includes_concept", "c.loop"), ("c.valve", "concept_assessed_as_skill", "s.valve.explain"),
                                  ("c.pump", "concept_assessed_as_skill", "s.pump.size"), ("c.gauge", "concept_assessed_as_skill", "s.gauge.read"), ("c.loop", "concept_assessed_as_skill", "s.loop.tune"),
                                  ("t.control", "topic_includes_skill", "s.orphan")}
    assert {e["family"] for e in document["edges"]} == {"structure"} and all(e["automatic_credit"] is False and e["tie"] is None for e in document["edges"])
    assert by_id(document)["t.flow"]["counts"] == {"skills": 3, "questions": 3} and by_id(document)["s.pump.size"]["counts"] == {"skills": None, "questions": 1}
    assert graph() == document and json.loads(json.dumps(document)) == document   # deterministic and plain JSON


def test_edge_ids_are_stable_and_unique_so_neighbourhoods_can_be_merged():
    whole = {e["id"]: e for e in graph()["edges"]}
    part = {e["id"]: e for e in graph(focus="c.valve")["edges"]}
    assert len(whole) == 10 and all(part[i] == whole[i] for i in part if i in whole) and len(set(part) & set(whole)) == 3


def test_criterion_and_question_wording_never_enters_a_graph_or_a_node_detail():
    model = build_model()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    texts = [json.dumps(graph(model, focus=node, depth=3)) for table in (model.topics, model.concepts, model.skills, model.questions, model.criteria) for node in table]
    texts += [json.dumps(cg.node_detail(model, node, course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)) for node in [*model.concepts, *model.questions, *model.criteria]]
    assert all(WORDING not in text and PROMPT not in text and RATIONALE not in text and "observable" not in text for text in texts)
    assert by_id(graph(model, focus="Q1"))["Q1.C02"]["label"] == "Criterion 2 of Q1 (explain)"   # identified, never quoted


# ---- three scopes as filters of one model (R2-C2, R2-C5) --------------------------------------------------------------
def test_lecture_scope_filters_the_same_model_and_an_empty_scope_says_why():
    first = graph(scope="lecture:L1")
    assert first["scope"]["kind"] == "lecture" and first["scope"]["lecture_id"] == "L1" and first["scope"]["page"] is None and "Membership is not a slide anchor" in first["scope"]["note"]
    assert ids(first) == ["t.control", "t.flow", "c.gauge", "c.loop", "c.pump", "c.valve", "s.valve.explain", "s.gauge.read", "s.pump.size", "s.loop.tune"]
    assert first["totals"] == {"topic": 2, "concept": 4, "skill": 4, "question": 3, "criterion": 4}
    assert by_id(first)["c.valve"]["counts"] == {"skills": 1, "questions": 1}   # the count is of this scope: Q4 belongs to the other lecture
    second = graph(scope="lecture:L2")
    assert ids(second) == ["t.control", "t.flow", "c.valve", "s.valve.explain", "s.orphan"] and second["totals"] == {"topic": 2, "concept": 1, "skill": 2, "question": 2, "criterion": 2}
    assert all(n["in_scope"] and n["where"] is None and n["support_pages"] == [] for n in [*first["nodes"], *second["nodes"]])
    empty = graph(scope="lecture:L3")
    assert empty["nodes"] == [] and empty["edges"] == [] and empty["totals"] == {"topic": 0, "concept": 0, "skill": 0, "question": 0, "criterion": 0}
    assert "error" not in empty and empty["scope"]["note"] == "No question collection in the course catalog cites a file of this lecture unit."


@pytest.mark.parametrize("scope,focus", [("lecture:nope", None), ("slide:nope:3", None), ("slide:L1:x", None), ("banana", None), ("", None), ("lecture:L1:extra", None),
                                         ("slide:L1:0", None), ("slide:L1:00022", None), ("slide:L1:022", None), ("slide:L1:-1", None),   # pages are 1-based; "00022" is not another name of page 22
                                         ("course", "no-such-node"), ("lecture:L1", "")])
def test_an_unknown_scope_or_focus_is_an_explicit_error_and_never_an_empty_graph(scope, focus):
    document = graph(scope=scope, focus=focus)
    assert set(document) == {"course_id", "graph_version", "error"} and "nodes" not in document
    assert document["error"]["code"] == ("unknown_focus" if focus is not None else "unknown_scope") and document["error"]["detail"]


@pytest.mark.parametrize("scope,slide_support", [("course", None), ("lecture:L1", None), ("lecture:L2", None), ("slide:L1:22", None), ("slide:L1:23", "three"), ("slide:L1:24", "criterion")])
def test_outline_and_graph_show_the_same_ids_and_counts_in_every_scope(scope, slide_support):
    model = build_model()
    page = int(scope.split(":")[2]) if scope.startswith("slide") else None
    given = {None: None, "three": support(page or 22, THREE_BUILDS), "criterion": support(page or 22, [{"node_id": "Q1.C02", "tie": "agent_inferred", "pages": [24]}])}[slide_support]
    resolved = cg.resolve_scope(model, scope, DECKS.get, given)
    rows = walk(model, resolved)
    outline = {kind: {r["node_id"] for r in rows if r["kind"] == kind} for kind in ("topic", "concept", "skill", "question", "criterion")}
    document = graph(model, scope, slide_support=given)
    assert document["totals"] == {kind: len(found) for kind, found in outline.items()}
    assert {kind: set(ids(document, kind)) for kind in ("topic", "concept", "skill")} == {kind: outline[kind] for kind in ("topic", "concept", "skill")}
    for row in rows:   # the same relations: what the outline lists under a node is what the graph draws next to it
        if row["kind"] in {"topic", "concept", "skill"}:
            hood = graph(model, scope, slide_support=given, focus=row["node_id"])
            below = {child for child, _ in model.children(row["node_id"], resolved)}
            assert below <= set(ids(hood)) and all(n["in_scope"] for n in hood["nodes"])
            under = walk(model, resolved, row["instance_id"])   # a node's counts are what expanding it shows, each id once
            assert by_id(hood)[row["node_id"]]["counts"] == cg.node_counts(model, resolved, row["node_id"]) == {
                "skills": None if row["kind"] == "skill" else len({r["node_id"] for r in under if r["kind"] == "skill"}), "questions": len({r["node_id"] for r in under if r["kind"] == "question"})}
            if row["kind"] == "skill":
                assert set(ids(hood, "question")) == below
    assert json.dumps(cg.public_scope(resolved))   # what the outline may return of the scope is plain data
    assert {"question_ids", "concept_ids", "skill_ids", "criterion_ids", "support"}.isdisjoint(cg.public_scope(resolved))


def assessed_in(document, node_id):
    """The questions ONE graph document ties to a node by its own edges: what the structure edges put below the node, the criteria
    that assess any of it, and the questions those criteria belong to."""
    edges, below, frontier = document["edges"], {node_id}, [node_id]
    while frontier:
        frontier = [e["to"] for e in edges if e["from"] in frontier and e["relation"] in {"topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill"} and e["to"] not in below]
        below |= set(frontier)
    criteria = {e["from"] for e in edges if e["relation"] in {"criterion_assesses_concept", "criterion_assesses_skill"} and e["to"] in below}
    return {e["from"] for e in edges if e["relation"] == "question_has_criterion" and e["to"] in criteria}


@pytest.mark.parametrize("build", [build_model, build_irregular])
@pytest.mark.parametrize("scope", ["course", "lecture:L1", "lecture:L2"])
def test_a_node_has_one_question_count_in_the_outline_the_graph_and_its_detail(build, scope):
    """R2-C5. The reviewed defect: a concept that criteria name and no skill is bound to read "0 questions" and could not be opened in
    the outline, while its Questions list and its own graph showed the questions. One join now answers all of them."""
    model = build()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    resolved = cg.resolve_scope(model, scope, DECKS.get)
    checked = 0
    for row in walk(model, resolved):
        if row["kind"] not in {"topic", "concept", "skill"}:
            continue
        node = row["node_id"]
        under = {r["node_id"] for r in walk(model, resolved, row["instance_id"]) if r["kind"] == "question"}   # what expanding the row shows
        assert cg.node_counts(model, resolved, node)["questions"] == len(under), (scope, node)
        assert set(model.questions_of(node, resolved)) == under, (scope, node)
        assert row["has_children"] is bool(model.children(node, resolved)) and (not under or row["has_children"]), (scope, node)   # what is counted can be opened
        hood = graph(model, scope, focus=node, depth=3, limit=cg.MAX_LIMIT)
        assert not hood["truncated"] and by_id(hood)[node]["counts"]["questions"] == len(under) and assessed_in(hood, node) == under, (scope, node)
        near = graph(model, scope, focus=node, depth=1, limit=cg.MAX_LIMIT)   # one relation away is part of what lies below, never more than is counted
        assert assessed_in(near, node) <= under and (row["kind"] != "skill" or assessed_in(near, node) == under), (scope, node)
        if scope == "course":   # the node detail has no scope of its own: it is the course's
            detail = cg.node_detail(model, node, course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)
            assert detail["questions_total"] == len(under) and {q["question_id"] for q in detail["questions"]} == under, (scope, node)
            assert all(q["criterion_ids"] for q in detail["questions"]), (scope, node)   # every listed question says through which criteria
        checked += 1
    assert checked


def test_a_concept_assessed_only_through_criteria_is_counted_listed_and_reachable():
    model = build_irregular()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    course = cg.resolve_scope(model, "course", DECKS.get)
    assert cg.node_counts(model, course, "c.named") == {"skills": 0, "questions": 2}
    assert model.children("c.named", course) == [("Q1", "concept_assessed_by_question"), ("Q2", "concept_assessed_by_question")]
    assert model.children("c.own", course) == [("s.own", "concept_assessed_as_skill")]   # Q1 is listed under the skill it is assessed through, not a second time beside it
    named = next(r for r in model.rows(course, "t.a")["rows"] if r["node_id"] == "c.named")
    assert named["has_children"] is True and [r["node_id"] for r in model.rows(course, "t.a>c.named")["rows"]] == ["Q1", "Q2"]
    assert [r["node_id"] for r in model.rows(course, "t.a>c.named>Q1")["rows"]] == ["Q1.C01", "Q1.C02"]
    detail = cg.node_detail(model, "c.named", course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)
    assert [(q["question_id"], q["criterion_ids"]) for q in detail["questions"]] == [("Q1", ["Q1.C02"]), ("Q2", ["Q2.C01"])] and detail["questions_total"] == 2
    assert by_id(graph(model, focus="c.named"))["c.named"]["counts"] == {"skills": 0, "questions": 2} and set(ids(graph(model, focus="c.named"), "question")) == {"Q1", "Q2"}
    # a criterion whose concept is not its skill's concept: the question is a question of both, through the criteria that say so
    other = cg.node_detail(model, "c.other", course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)
    assert [(q["question_id"], q["criterion_ids"]) for q in other["questions"]] == [("Q2", ["Q2.C01"])] and cg.node_counts(model, course, "c.other") == {"skills": 1, "questions": 1}
    assert cg.node_counts(model, course, "t.a") == {"skills": 1, "questions": 2} and cg.node_counts(model, course, "t.b") == {"skills": 2, "questions": 2}
    assert [q["question_id"] for q in cg.node_detail(model, "t.a", course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)["questions"]] == ["Q1", "Q2"]
    assert [q["question_id"] for q in cg.node_detail(model, "t.b", course_id="demo", sources_of=cg.catalog_sources(model), evidence=reader)["questions"]] == ["Q2", "Q3"]
    first = cg.resolve_scope(model, "lecture:L1", DECKS.get)   # the same join inside a lecture: only this lecture's questions
    assert cg.node_counts(model, first, "c.named") == {"skills": 0, "questions": 2} and model.questions_of("c.named", first) == ["Q1", "Q2"]
    second = cg.resolve_scope(model, "lecture:L2", DECKS.get)
    assert "c.named" not in second["concept_ids"] and model.questions_of("c.named", second) == []


@pytest.mark.parametrize("scope", ["course", "lecture:L1", "lecture:L2"])
def test_what_a_scope_counts_can_be_reached_in_the_outline_also_on_an_irregular_catalog(scope):
    model = build_irregular()
    resolved = cg.resolve_scope(model, scope, DECKS.get)
    rows = walk(model, resolved)
    outline = {kind: {r["node_id"] for r in rows if r["kind"] == kind} for kind in cg.KINDS}
    document = graph(model, scope, limit=cg.MAX_LIMIT)
    assert document["totals"] == {kind: len(found) for kind, found in outline.items()}   # nothing is counted that cannot be opened
    assert {kind: set(ids(document, kind)) for kind in ("topic", "concept", "skill")} == {kind: outline[kind] for kind in ("topic", "concept", "skill")}
    assert len(ids(document)) == len(set(ids(document)))
    if scope == "course":
        assert document["totals"] == {"topic": 2, "concept": 4, "skill": 5, "question": 7, "criterion": 7}
        # what the catalog files under nothing is listed beside the topics, after them: a concept without a catalogued topic, a skill with neither, questions whose criteria name nothing catalogued
        assert [(r["node_id"], r["kind"], r["relation"]) for r in model.rows(resolved, None)["rows"]] == [
            ("t.a", "topic", "root"), ("t.b", "topic", "root"), ("c.adrift", "concept", "unfiled"), ("s.nowhere", "skill", "unfiled"), ("Q4", "question", "unfiled"), ("Q6", "question", "unfiled")]
        assert model.children("c.adrift", resolved) == [("s.adrift", "concept_assessed_as_skill"), ("Q5", "concept_assessed_by_question")]
        assert resolved["topic_ids"] is None and cg.resolve_scope(model, "lecture:L2", DECKS.get)["topic_ids"] == {"t.b"}   # an unfiled entry is not a topic


def test_an_id_that_occurs_in_two_tables_is_one_node_of_one_kind():
    model = build_model()
    model.skills["c.pump"] = {"skill_id": "c.pump", "topic_ids": ["t.flow"], "concept_id": "c.valve", "performance_target": "A skill that reuses a concept's id", "source_refs": []}
    document = graph(model, limit=cg.MAX_LIMIT)
    assert ids(document).count("c.pump") == 1 and by_id(document)["c.pump"]["kind"] == "concept" and len({e["id"] for e in document["edges"]}) == len(document["edges"])
    assert document["totals"] == graph()["totals"]   # the second entry is not a second object
    kinds = {n["id"]: n["kind"] for n in graph(model, focus="c.valve", depth=2, limit=cg.MAX_LIMIT)["nodes"]}
    assert not any(e["relation"] == "concept_assessed_as_skill" and e["to"] == "c.pump" for e in graph(model, focus="c.valve", depth=2, limit=cg.MAX_LIMIT)["edges"]) and kinds["c.pump"] == "concept"
    resolved = cg.resolve_scope(model, "course", DECKS.get)
    assert [r["node_id"] for r in walk(model, resolved)].count("c.pump") == 1   # under its one topic, as the concept it is


# ---- neighbourhood, bounds (R2-C3, R2-C4) -------------------------------------------------------------------------------
def test_focusing_a_node_returns_only_its_neighbours_with_criteria_never_shown_without_their_question():
    document = graph(focus="c.valve")
    assert document["focus"] == "c.valve" and ids(document) == ["c.valve", "t.control", "t.flow", "s.valve.explain", "Q4", "Q1", "Q1.C01", "Q4.C01"]   # the focus, then kind and label
    assert edge_set(document) == {("t.flow", "topic_includes_concept", "c.valve"), ("t.control", "topic_includes_concept", "c.valve"), ("c.valve", "concept_assessed_as_skill", "s.valve.explain"),
                                  ("Q1", "question_has_criterion", "Q1.C01"), ("Q4", "question_has_criterion", "Q4.C01"), ("Q1.C01", "criterion_assesses_concept", "c.valve"),
                                  ("Q4.C01", "criterion_assesses_concept", "c.valve"), ("Q1.C01", "criterion_assesses_skill", "s.valve.explain"), ("Q4.C01", "criterion_assesses_skill", "s.valve.explain")}
    assert len(ids(document)) == len(set(ids(document))) and document["totals"] == graph()["totals"]   # focusing changes what is drawn, never what exists
    wider = graph(focus="c.valve", depth=2)   # one more step: what the two topics hold besides the valve; a question's other criteria are a step further
    assert set(ids(wider)) == set(ids(document)) | {"c.pump", "c.gauge", "c.loop", "s.orphan"}
    assert {"Q1.C02", "Q2", "Q3"} <= set(ids(graph(focus="c.valve", depth=3)))
    question = graph(focus="Q1")
    assert ids(question) == ["Q1", "Q2", "Q3", "Q1.C01", "Q1.C02"]
    assert set(ids(graph(focus="Q1", depth=9))) == set(ids(graph(focus="Q1", depth=3)))   # depth is bounded at three
    alone = graph(focus="Q1.C02")   # a criterion is never returned without its question, which is listed with it
    assert ids(alone) == ["Q1.C02", "Q1", "c.pump", "s.pump.size"] and ("Q1", "question_has_criterion", "Q1.C02") in edge_set(alone)
    cut = graph(focus="s.valve.explain", limit=4)   # also when the limit cuts: the question is kept before its criterion
    assert ids(cut) == ["s.valve.explain", "c.valve", "Q4", "Q1"] and cut["dropped"] == 2


def test_the_limit_bounds_what_is_returned_and_says_how_much_was_left_out():
    document = graph(limit=5)
    assert ids(document) == ["t.empty", "t.control", "t.flow", "c.gauge", "c.loop"] and document["truncated"] is True and document["dropped"] == 7
    assert edge_set(document) == {("t.flow", "topic_includes_concept", "c.gauge"), ("t.control", "topic_includes_concept", "c.loop")}   # no edge to a node that was cut
    assert document["totals"] == graph()["totals"]
    hood = graph(focus="c.valve", limit=4)
    assert ids(hood) == ["c.valve", "t.control", "t.flow", "s.valve.explain"] and hood["truncated"] is True and hood["dropped"] == 4
    assert graph(limit=10**6)["truncated"] is False and len(graph(limit=0)["nodes"]) == 1   # out-of-range values are clamped, not obeyed
    least = graph(focus="Q1.C02", limit=1)   # the one case in which the limit yields: a focused criterion is not returned without its question
    assert ids(least) == ["Q1.C02", "Q1"] and least["truncated"] is True and least["dropped"] == 2 and ("Q1", "question_has_criterion", "Q1.C02") in edge_set(least)
    assert ids(graph(focus="Q1", limit=1)) == ["Q1"] and all(len(graph(focus=node, limit=1)["nodes"]) == 1 for node in ("t.flow", "c.valve", "s.pump.size"))


def test_the_largest_synthetic_course_stays_bounded_and_expands_on_demand():
    topics = {f"t{t:02d}": {"topic_id": f"t{t:02d}", "label": f"Topic {t:02d}"} for t in range(12)}
    concepts = {f"c{n:04d}": {"concept_id": f"c{n:04d}", "label": f"Concept {n:04d}", "topic_ids": [f"t{n % 12:02d}"]} for n in range(600)}
    skills = {f"s{n:04d}": {"skill_id": f"s{n:04d}", "topic_ids": [f"t{n % 12:02d}"], "concept_id": f"c{n:04d}", "performance_target": f"Skill {n:04d}"} for n in range(600)}
    questions = {f"Q{n:04d}": {"question_id": f"Q{n:04d}", "title": f"Question {n:04d}", "prompt": PROMPT, "collection": "X",
                               "criteria": [criterion(f"Q{n:04d}.C01", f"s{n:04d}", f"c{n:04d}")]} for n in range(300)}
    bank = {"lectures": {}, "questions": {q: {"anchors": [], "slide_anchor": "none"} for q in questions}}
    model = OutlineModel({"skills": {"topics": topics, "skills": skills}, "families": {}, "questions": {"concepts": concepts, "questions": questions, "relationships": []}}, bank)
    document = graph(model)
    assert len(document["nodes"]) == cg.DEFAULT_LIMIT == 150 and document["truncated"] is True and document["dropped"] == 12 + 600 + 600 - 150
    assert ids(document)[:12] == sorted(topics) and document["totals"] == {"topic": 12, "concept": 600, "skill": 600, "question": 300, "criterion": 300}
    grouped = graph(model, limit=12)   # grouped at topic level
    assert ids(grouped) == sorted(topics) and grouped["edges"] == []
    opened = graph(model, focus="t03")   # expanding one topic adds only what that topic holds
    assert set(ids(opened)) == {"t03"} | {c for c, concept in concepts.items() if concept["topic_ids"] == ["t03"]} and opened["truncated"] is False
    assert len(graph(model, limit=10**6)["nodes"]) == cg.MAX_LIMIT


# ---- three edge families (R2-C6) -----------------------------------------------------------------------------------------
def test_edges_keep_three_families_apart_and_question_containment_is_never_a_prerequisite():
    model = build_model()
    document = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), focus="Q1", depth=2)
    assert {e["family"] for e in document["edges"]} == {"assessment", "source", "structure"} == set(cg.FAMILIES)
    relations = {e["relation"]: e for e in document["edges"]}
    assert relations["question_has_criterion"]["family"] == relations["criterion_assesses_concept"]["family"] == relations["criterion_assesses_skill"]["family"] == "assessment"
    assert relations["strict_containment"]["family"] == relations["diagnostic_prerequisite"]["family"] == relations["concept_assessed_as_skill"]["family"] == "structure"
    assert relations["slide_supports"]["family"] == relations["slide_supports_by_assessment"]["family"] == "source" and relations["slide_supports"]["from"] == GROUP
    everything = [e for node in [*model.questions, *model.concepts] for e in graph(model, focus=node, depth=3)["edges"]]
    kinds = {n: model.kind_of(n) for n in [*model.topics, *model.concepts, *model.skills, *model.questions, *model.criteria]}
    for edge in everything:
        if edge["relation"] in OWNER_RELATIONS:   # the owner's label, between two questions, and nothing derived from it
            assert kinds[edge["from"]] == kinds[edge["to"]] == "question" and edge["family"] == "structure" and edge["provenance"] == "question index"
        else:
            assert "prerequisite" not in edge["relation"] and "containment" not in edge["relation"] and "overlap" not in edge["relation"]
        assert not (kinds[edge["from"]] == "concept" and kinds[edge["to"]] == "concept")   # no concept-to-concept relation is invented
        assert edge["automatic_credit"] is (edge["relation"] == "partial_overlap")           # false unless the catalog says otherwise
    assert ("Q2", "strict_containment", "Q1") in {(e["from"], e["relation"], e["to"]) for e in everything}
    assert not any(e["relation"] == "diagnostic_prerequisite" and (e["from"], e["to"]) == ("Q2", "Q1") for e in everything)


# ---- a logical slide with three builds (R2-C2, R2-C8) --------------------------------------------------------------------------
def test_a_build_group_lists_each_entry_once_and_says_where_its_support_is():
    model = build_model()
    views = {page: graph(model, f"slide:L1:{page}", slide_support=support(page, THREE_BUILDS)) for page in (22, 23, 24)}
    for page, document in views.items():
        assert document["scope"] == {"kind": "slide", "lecture_id": "L1", "page": page, "logical_slide_id": GROUP, "label": support(page, [])["label"], "pages": [22, 23, 24],
                                     "note": document["scope"]["note"]}   # the member pages, so a support page can be named as a build of this sequence
        assert ids(document) == ["t.control", "t.flow", "c.gauge", "c.loop", "c.pump", "c.valve", "s.valve.explain", "s.gauge.read", "s.pump.size", "s.loop.tune"]   # each once, on every build
        assert document["totals"] == {"topic": 2, "concept": 4, "skill": 4, "question": 3, "criterion": 4} == graph(model, "lecture:L1")["totals"]   # nothing multiplies with the builds
        assert {n["id"]: n["support_pages"] for n in document["nodes"] if n["kind"] == "concept"} == {"c.valve": [22], "c.pump": [22], "c.gauge": [24], "c.loop": [22, 23, 24]}
        assert all(n["where"] is None and n["support_pages"] == [] for n in document["nodes"] if n["kind"] == "topic")   # a topic is a heading; no support is recorded for it
    where = {page: {n["id"]: n["where"] for n in document["nodes"] if n["kind"] in {"concept", "skill"}} for page, document in views.items()}
    assert where[22] == {"c.valve": "on_this_page", "c.pump": "on_this_page", "c.gauge": "elsewhere_in_sequence", "c.loop": "group_level",
                         "s.valve.explain": "on_this_page", "s.pump.size": "on_this_page", "s.gauge.read": "elsewhere_in_sequence", "s.loop.tune": "group_level"}
    assert where[23]["c.valve"] == where[23]["c.gauge"] == "elsewhere_in_sequence" and where[23]["c.loop"] == "group_level"
    assert where[24]["c.gauge"] == "on_this_page" and where[24]["c.valve"] == "elsewhere_in_sequence"
    # what is first supported on the last build is never worded as on an earlier one
    assert all(where[page]["c.gauge"] != "on_this_page" for page in (22, 23))
    question = graph(model, "slide:L1:24", slide_support=support(24, THREE_BUILDS), focus="Q1")
    assert by_id(question)["Q1"]["where"] == "elsewhere_in_sequence" and by_id(question)["Q1"]["support_pages"] == [22] and by_id(question)["Q1.C01"]["support_pages"] == [22]
    assert by_id(question)["Q2"]["in_scope"] is True and by_id(question)["Q2"]["where"] == "on_this_page"


def test_source_edges_carry_the_tie_as_recorded_and_ties_are_never_merged_into_one_another():
    model = build_model()
    document = graph(model, "slide:L1:22", slide_support=support(22, [*THREE_BUILDS, {"node_id": "c.gauge", "tie": "stated", "pages": [23]}]))
    source = [e for e in document["edges"] if e["family"] == "source"]
    assert all(e["from"] == GROUP and e["automatic_credit"] is False and e["tie"] in cg.TIES for e in source)
    gauge = sorted((e["tie"], e["relation"], e["support_pages"], e["provenance"]) for e in source if e["to"] == "c.gauge")
    assert gauge == [("agent_inferred", "slide_supports_by_assessment", [24], "suggested link (agent-inferred)"), ("stated", "slide_supports", [23], "course anchor (as stated)")]
    assert by_id(document)["c.gauge"]["support_pages"] == [23, 24] and by_id(document)["c.gauge"]["where"] == "elsewhere_in_sequence"
    assert {(e["to"], e["tie"]) for e in source if e["to"].startswith("c.")} == {("c.valve", "stated"), ("c.pump", "stated"), ("c.gauge", "agent_inferred"), ("c.gauge", "stated"), ("c.loop", "exact")}
    assert not any(e["to"].startswith("t.") for e in source) and len({e["id"] for e in document["edges"]}) == len(document["edges"])
    focused = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), focus="Q1")
    assert ("Q1", "slide_supports", "stated", [22]) in [(e["to"], e["relation"], e["tie"], e["support_pages"]) for e in focused["edges"] if e["family"] == "source"]


def test_group_level_single_page_and_criterion_level_support():
    model = build_model()
    unnamed = graph(model, "slide:L1:23", slide_support=support(23, [{"node_id": "Q3", "tie": "stated", "pages": []}]))   # recorded for the group, not for a page
    assert by_id(unnamed)["c.loop"]["where"] == "group_level" and by_id(unnamed)["c.loop"]["support_pages"] == [22, 23, 24]
    single = graph(model, "slide:L1:5", slide_support=support(5, [{"node_id": "Q3", "tie": "stated", "pages": []}, {"node_id": "Q2", "tie": "exact", "pages": [5]}], pages=(5,)))
    assert {n["id"]: n["where"] for n in single["nodes"] if n["kind"] == "concept"} == {"c.loop": "on_this_page", "c.gauge": "on_this_page"}   # one page is never a group
    narrowed = graph(model, "slide:L1:22", slide_support=support(22, [{"node_id": "Q1.C02", "tie": "agent_inferred", "pages": [24]}]))
    assert ids(narrowed, "concept") == ["c.pump"] and narrowed["totals"] == {"topic": 1, "concept": 1, "skill": 1, "question": 1, "criterion": 1}   # the other criterion's concept is not put on the slide
    hood = graph(model, "slide:L1:22", slide_support=support(22, [{"node_id": "Q1.C02", "tie": "agent_inferred", "pages": [24]}]), focus="Q1")
    assert ids(hood) == ["Q1", "Q2", "Q3", "Q1.C02"] and [n["in_scope"] for n in hood["nodes"]] == [True, False, False, True]   # related questions are shown as outside the slide
    assert by_id(hood)["Q2"]["where"] is None and by_id(hood)["Q2"]["support_pages"] == []


def test_the_scope_keeps_anchored_and_suggested_questions_apart_and_gives_no_support_to_a_heading():
    model = build_model()
    resolved = cg.resolve_scope(model, "slide:L1:22", DECKS.get, support(22, [*THREE_BUILDS, {"node_id": "t.empty", "tie": "stated", "pages": [22]}]))
    assert resolved["anchored_questions"] == ["Q1", "Q3"] and resolved["suggested_questions"] == ["Q2"] and resolved["question_ids"] == {"Q1", "Q2", "Q3"}
    assert resolved["basis"] == "typed_anchor_or_suggested_link" and resolved["topic_ids"] == {"t.flow", "t.control"} and "t.empty" not in resolved["support"]
    plain = cg.resolve_scope(model, "slide:L1:22", DECKS.get)
    assert plain["basis"] == "typed_anchor" and plain["anchored_questions"] == ["Q1"] and plain["suggested_questions"] == [] and plain["pages"] == [22]
    both = cg.resolve_scope(model, "slide:L1:22", DECKS.get, support(22, [{"node_id": "Q2", "tie": "agent_inferred", "pages": [22]}, {"node_id": "Q2", "tie": "stated", "pages": [24]}]))
    assert both["anchored_questions"] == ["Q2"] and both["suggested_questions"] == []   # the course's own anchor is not hidden by a suggestion for the same question
    assert [t["tie"] for t in both["support"]["Q2"]] == ["stated", "agent_inferred"] and cg.node_support(both, "Q2") == {"where": "on_this_page", "support_pages": [22, 24]}


def test_support_that_names_nothing_of_this_slide_is_left_out_and_a_wrong_page_is_an_error():
    model = build_model()
    stray = [{"node_id": "no-such-node", "tie": "stated", "pages": [22]}, {"node_id": "Q4", "tie": "stated", "pages": [99]}, {"node_id": "Q2", "tie": "guessed", "pages": [22]}]
    document = graph(model, "slide:L1:22", slide_support=support(22, stray))
    assert document["nodes"] == [] and "error" not in document and document["scope"]["note"]
    assert graph(model, "slide:L1:30", slide_support=support(22, THREE_BUILDS))["error"]["code"] == "unknown_scope"   # the page is not a member of the slide handed in
    structural = graph(model, "slide:L1:22", slide_support=support(22, [], role={"value": "structural_title_or_section", "forced_requirements": False}))
    assert structural["nodes"] == [] and "structural" in structural["scope"]["note"] and "lecture" in structural["scope"]["note"].lower()
    outside = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), focus="Q4")   # a selection kept from another scope: shown as outside, not as an error
    assert by_id(outside)["Q4"]["in_scope"] is False and by_id(outside)["Q4"]["where"] is None and "error" not in outside


def test_a_page_the_deck_does_not_have_is_an_unknown_scope_and_never_an_empty_slide():
    view = {"page_count": 4, "slides": [{"page": n, "title": None} for n in range(1, 5)]}
    for page in (0, 5, 99999):
        with pytest.raises(ValueError, match="not a page"):
            cg.slide_support_from_lecture_view(view, page)
    assert cg.slide_support_from_lecture_view(view, 4) is None   # a page of the deck that carries no slide identity yet: the course's own anchors are used
    assert cg.slide_support_from_lecture_view({"page_count": None, "slides": []}, 7) is None   # no readable deck: this function cannot say which pages exist
    assert graph(scope="slide:L1:23", slide_support=dict(support(23, THREE_BUILDS), page_count=40))["scope"]["page"] == 23
    beyond = graph(scope="slide:L1:41", slide_support={"logical_slide_id": None, "label": None, "page": 41, "pages": [41], "entries": None, "page_count": 40})
    assert set(beyond) == {"course_id", "graph_version", "error"} and beyond["error"]["code"] == "unknown_scope" and "41" in beyond["error"]["detail"]


def test_a_malformed_support_entry_is_dropped_and_never_widened_to_the_whole_slide():
    model = build_model()
    for pages in (["24"], [24.0], [True], [None], "24", {"page": 24}):   # not page numbers: the entry names nothing, which is not the same as naming no page
        assert graph(model, "slide:L1:22", slide_support=support(22, [{"node_id": "Q2", "tie": "stated", "pages": pages}]))["nodes"] == [], pages
    partly = graph(model, "slide:L1:22", slide_support=support(22, [{"node_id": "Q2", "tie": "stated", "pages": [24, "x", 99]}]))
    assert by_id(partly)["c.gauge"]["support_pages"] == [24] and by_id(partly)["c.gauge"]["where"] == "elsewhere_in_sequence"
    for pages in ([], None):   # no page named at all: recorded for the slide as a whole
        assert by_id(graph(model, "slide:L1:22", slide_support=support(22, [{"node_id": "Q2", "tie": "stated", "pages": pages}])))["c.gauge"]["where"] == "group_level"


def test_group_level_means_one_record_made_for_the_group_not_page_records_that_happen_to_cover_it():
    model = build_model()
    apart = [{"node_id": "Q2", "tie": "stated", "pages": [22]}, {"node_id": "Q2", "tie": "stated", "pages": [23]}, {"node_id": "Q2", "tie": "agent_inferred", "pages": [24]}]
    for page in (22, 23, 24):
        node = by_id(graph(model, f"slide:L1:{page}", slide_support=support(page, apart), focus="Q2"))["Q2"]
        assert node["where"] == "on_this_page" and node["support_pages"] == [22, 23, 24]   # three page-level records, one of them only a suggestion
    two = by_id(graph(model, "slide:L1:24", slide_support=support(24, apart[:2]), focus="Q2"))["Q2"]
    assert two["where"] == "elsewhere_in_sequence" and two["support_pages"] == [22, 23]
    whole = [*apart, {"node_id": "Q2", "tie": "exact", "pages": [22, 23, 24]}]   # one record that names every page of the group
    assert by_id(graph(model, "slide:L1:23", slide_support=support(23, whole), focus="Q2"))["Q2"]["where"] == "group_level"
    resolved = cg.resolve_scope(model, "slide:L1:23", DECKS.get, support(23, whole))
    assert [(t["tie"], t["pages"], t["group"]) for t in resolved["support"]["Q2"]] == [("exact", [22, 23, 24], True), ("stated", [22, 23], False), ("agent_inferred", [24], False)]
    assert [(t["tie"], t["group"]) for t in resolved["support"]["c.gauge"]] == [("exact", True), ("stated", False), ("agent_inferred", False)]   # reached through the question's criterion: the same records


def test_a_suggested_link_to_a_question_of_another_collection_is_on_the_slide_and_said_to_be_from_elsewhere():
    """Decision: a slide scope lists what is tied to the slide; the lecture scope lists the collections of the lecture. A suggested link may tie
    a question of another collection to a slide, so the slide scope can hold what the lecture scope does not — and says so."""
    model = build_model()
    given = support(22, [{"node_id": "Q1", "tie": "stated", "pages": [22]}, {"node_id": "Q4.C01", "tie": "agent_inferred", "pages": [22]}])   # Q4 belongs to L2
    resolved = cg.resolve_scope(model, "slide:L1:22", DECKS.get, given)
    assert resolved["questions_of_other_collections"] == ["Q4"] and "Q4" in resolved["question_ids"] and resolved["suggested_questions"] == ["Q4"]
    assert "Q4" not in cg.resolve_scope(model, "lecture:L1", DECKS.get)["question_ids"]
    public = cg.public_scope(resolved)
    assert public["questions_of_other_collections"] == ["Q4"] and "another collection" in public["note"] and "1 question" in public["note"]
    assert graph(model, "slide:L1:22", slide_support=given)["scope"]["note"] == public["note"]
    plain = cg.resolve_scope(model, "slide:L1:22", DECKS.get, support(22, THREE_BUILDS))
    assert plain["questions_of_other_collections"] == [] and "another collection" not in plain["note"]


def test_without_a_source_map_the_slide_scope_is_the_course_anchors_of_that_page():
    document = graph(scope="slide:L1:22")
    assert document["scope"]["logical_slide_id"] is None and document["scope"]["label"] is None
    assert ids(document, "concept") == ["c.pump", "c.valve"] and all(n["where"] == "on_this_page" and n["support_pages"] == [22] for n in document["nodes"] if n["kind"] != "topic")
    assert {e["from"] for e in document["edges"] if e["family"] == "source"} == {"slide:L1:22"} and {e["tie"] for e in document["edges"] if e["family"] == "source"} == {"stated"}
    assert graph(scope="slide:L2:3")["edges"][-1]["tie"] == "exact"
    nothing = graph(scope="slide:L1:23")
    assert nothing["nodes"] == [] and "names this slide" in nothing["scope"]["note"]
    derived = graph(scope="slide:L1:23", slide_support=dict(support(23, None)))   # a grouped slide whose ties were not handed in: the course anchors of its member pages
    assert {n["id"]: n["where"] for n in derived["nodes"] if n["kind"] == "concept"} == {"c.gauge": "elsewhere_in_sequence", "c.pump": "elsewhere_in_sequence", "c.valve": "elsewhere_in_sequence"}


def test_slide_support_is_read_from_an_enriched_lecture_view():
    def slide(page, ordinal, ties, role="instructional"):
        return {"page": page, "identity": {"page_index": page, "page_count": 40, "logical_slide_id": GROUP, "position": {"ordinal": ordinal, "of": 3, "kind": "build"},
                                           "label": f"PDF page {page} of 40 · build {ordinal} of 3"},
                "role": {"value": role, "state": "generated", "uncertain": False, "forced_requirements": True, "basis": []}, "question_ties": ties}

    def listed(*criterion_ids):   # the criteria a suggested link says its pages support, as the lecture view lists them: identity, never wording
        return [{"criterion_id": c, "number": int(c[-2:]), "label": f"Criterion {int(c[-2:])}", "concept_id": None, "concept_label": None} for c in criterion_ids]

    ties = [{"question_id": "Q1", "tie": "stated", "where": "on_this_page", "support_pages": [22], "criteria": None, "learner_decision": None},
            {"question_id": "Q2", "tie": "agent_inferred", "where": "elsewhere_in_sequence", "support_pages": [24], "criteria": listed("Q2.C01"), "learner_decision": "confirmed"},   # accepted: still a suggestion
            {"question_id": "Q1", "tie": "agent_inferred", "where": "on_this_page", "support_pages": [23], "criteria": listed("Q1.C02"), "learner_decision": None},   # part of a question the course also anchors
            {"question_id": "Q3", "tie": "agent_inferred", "where": "group_level", "support_pages": [22, 23, 24], "criteria": [], "learner_decision": None},   # lists no criterion: the question is the entry
            {"question_id": "Q4", "tie": "agent_inferred", "where": "on_this_page", "support_pages": [23], "criteria": listed("Q4.C01"), "learner_decision": "rejected"},   # rejected by the learner: not a link
            # a section tie of the course's study map belongs in ``section_ties`` (r2-read-api.md 1.4); should one be listed here, it names a range of pages and is not support of this slide
            {"question_id": "Q5", "tie": "stated", "granularity": "section", "from": "course_study_map", "where": None, "support_pages": [22, 23, 24], "criteria": None, "learner_decision": None},
            {"question_id": "Q5", "tie": "stated", "granularity": "page", "where": None, "support_pages": [], "criteria": None, "learner_decision": None}]   # names no page of this slide: not widened to all of them
    view = {"source_map": {"state": "ready", "map_revision": "a1b2c3d4e5f60718", "logical_slides": [{"id": GROUP, "kind": "build_group", "pages": [22, 23, 24]}, {"id": "ls-x-p25", "kind": "single", "pages": [25]}]},
            "slides": [slide(22, 1, ties), slide(23, 2, ties), slide(24, 3, ties), {"page": 26, "title": "not enriched"}]}
    given = cg.slide_support_from_lecture_view(view, 23)
    assert given == {"logical_slide_id": GROUP, "label": "PDF page 23 of 40 · build 2 of 3", "page": 23, "pages": [22, 23, 24],
                     "entries": [{"node_id": "Q1", "tie": "stated", "pages": [22], "decision": None}, {"node_id": "Q2.C01", "tie": "agent_inferred", "pages": [24], "decision": "confirmed"},
                                 {"node_id": "Q1.C02", "tie": "agent_inferred", "pages": [23], "decision": None}, {"node_id": "Q3", "tie": "agent_inferred", "pages": [22, 23, 24], "decision": None}],
                     "role": {"value": "instructional", "forced_requirements": True}}
    assert cg.slide_support_from_lecture_view(view, 26) is None and cg.slide_support_from_lecture_view(view, 99) is None and cg.slide_support_from_lecture_view({}, 1) is None
    document = graph(scope="slide:L1:23", slide_support=given)
    assert {n["id"]: (n["where"], n["support_pages"]) for n in document["nodes"] if n["kind"] == "concept"} == {
        "c.valve": ("elsewhere_in_sequence", [22]), "c.pump": ("on_this_page", [22, 23]), "c.gauge": ("elsewhere_in_sequence", [24]), "c.loop": ("group_level", [22, 23, 24])}
    assert sorted((e["tie"], e["support_pages"]) for e in document["edges"] if e["to"] == "c.pump" and e["family"] == "source") == [("agent_inferred", [23]), ("stated", [22])]
    assert {"Q4", "Q5"}.isdisjoint(cg.resolve_scope(build_model(), "slide:L1:23", DECKS.get, given)["question_ids"])
    # an accepted suggestion stays a suggestion and says that it was accepted; one nobody decided on does not
    provenance = {e["to"]: e["provenance"] for e in document["edges"] if e["family"] == "source" and e["tie"] == "agent_inferred"}
    assert provenance["c.gauge"] == "suggested link (agent-inferred), accepted by the learner" and provenance["c.pump"] == "suggested link (agent-inferred)"
    del view["slides"][1]["question_ties"]   # identity without ties (the tie module not run): the entries are left to the course anchors
    assert cg.slide_support_from_lecture_view(view, 23)["entries"] is None


# ---- evidence and revisions (R2-C9, R2-C11) --------------------------------------------------------------------------------------
def test_each_node_carries_its_evidence_state_from_the_one_evidence_reader():
    model = build_model()
    attempt = {"attempt_id": "a1", "recorded_at": "2026-09-20T15:00:00Z", "evidence_kind": "observed_response", "question": {"question_id": "Q1", "prior_exposure": "seen_exact"},
               "observations": [{"skill_id": "s.valve.explain", "outcome": "demonstrated", "assistance": "solution_shown", "reference_access": "none"},
                                {"skill_id": "s.pump.size", "outcome": "not_observed", "assistance": "solution_shown", "reference_access": "none"}]}
    records = {"attempts": {"a1": attempt}, "revisions": {}, "effective": {"a1": {"assessment_id": "a1", "observations": attempt["observations"], "chain": ["a1"], "conflict": False}}}
    reader = EvidenceReader(records, model)
    document = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), evidence_of=reader.compact, focus="Q1", depth=2)
    nodes = by_id(document)
    assert nodes["c.valve"]["evidence"] == {"state": "assisted", "assistance": "solution_shown", "prior_exposure": "seen", "attempts": 1}
    assert nodes["s.pump.size"]["evidence"] == {"state": "not_separately_observed", "assistance": None, "prior_exposure": "seen", "attempts": 0}
    assert nodes["Q1"]["evidence"]["state"] == "assisted" and nodes["Q2"]["evidence"] == {"state": "unknown", "assistance": None, "prior_exposure": "unknown", "attempts": 0}
    assert nodes["Q1.C01"]["evidence"]["state"] == "not_separately_observed" and by_id(graph(model, evidence_of=reader.compact))["t.empty"]["evidence"]["state"] == "not_applicable"
    text = json.dumps(document).lower()
    assert all(word not in text for word in ("mastery", "probab", "percent", "%", "score"))


def test_a_view_names_the_revisions_it_was_built_from_and_only_the_affected_scope_changes():
    model = build_model()
    given = {"question_index_sha256": "q" * 64, "map_revision": "a1b2c3d4e5f60718", "evidence_revision": "e" * 16}
    before = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), revisions=given)["revisions"]
    assert {k: before[k] for k in given} == given and len(before["scope_revision"]) == 16 and set(before) == REVISION_KEYS
    assert graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), revisions=given)["revisions"] == before
    assert graph(model)["revisions"] == {**{key: None for key in REVISION_KEYS}, "scope_revision": graph(model)["revisions"]["scope_revision"]}   # what was not handed in is not claimed
    # the learner accepts a suggested link of this slide: the same entries, and the view built before is stale
    undecided = graph(model, "slide:L1:22", slide_support=support(22, [*THREE_BUILDS[:2], {"node_id": "Q2", "tie": "agent_inferred", "pages": [24], "decision": None}]), revisions=given)
    decided = graph(model, "slide:L1:22", slide_support=support(22, [*THREE_BUILDS[:2], {"node_id": "Q2", "tie": "agent_inferred", "pages": [24], "decision": "confirmed"}]), revisions=given)
    assert cg.stale_keys(undecided["revisions"], decided["revisions"]) == ["scope_revision"] and undecided["nodes"] == decided["nodes"]
    assert [e["provenance"] for e in decided["edges"] if e["to"] == "c.gauge" and e["family"] == "source"] == ["suggested link (agent-inferred), accepted by the learner"]
    assert cg.stale_keys(before, {**before, "skills_sha256": "5" * 64}) == ["skills_sha256"] and cg.stale_keys(before, {**before, "anchor_revision": "a" * 16}) == ["anchor_revision"]
    regrouped = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS[:2], pages=(22, 23)), revisions=given)["revisions"]            # the build group changed
    accepted = graph(model, "slide:L1:22", slide_support=support(22, [*THREE_BUILDS, {"node_id": "Q4", "tie": "agent_inferred", "pages": [23]}]), revisions=given)["revisions"]   # an anchor was accepted
    remapped = graph(model, "slide:L1:22", slide_support=support(22, THREE_BUILDS), revisions={**given, "map_revision": "ffff000011112222"})["revisions"]
    assert cg.stale_keys(before, regrouped) == ["scope_revision"] == cg.stale_keys(before, accepted) and cg.stale_keys(before, remapped) == ["map_revision"]
    assert cg.stale_keys(before, before) == [] and cg.stale_keys(before, {**before, "evidence_revision": "0" * 16}) == ["evidence_revision"]
    other = graph(model, "lecture:L2", revisions=given)["revisions"]   # another lecture's view is built from the same things as before
    assert other == graph(model, "lecture:L2", revisions=given)["revisions"] and other["scope_revision"] != before["scope_revision"]
    # a source was added to lecture L2: its scope changes, lecture L1's does not
    grown = build_model()
    grown.bank["lectures"]["L2"]["question_ids"].append("Q3")
    assert graph(grown, "lecture:L2")["revisions"]["scope_revision"] != graph(model, "lecture:L2")["revisions"]["scope_revision"]
    assert graph(grown, "lecture:L1")["revisions"]["scope_revision"] == graph(model, "lecture:L1")["revisions"]["scope_revision"]
    # the skills catalog was edited and every id kept: a skill now sits under another concept. The scopes that hold it are stale; a lecture that does not is not
    moved = build_model()
    moved.skills["s.pump.size"]["concept_id"] = "c.gauge"
    assert edge_set(graph(moved)) != edge_set(graph(model)) and set(ids(graph(moved))) == set(ids(graph(model)))
    assert graph(moved)["revisions"]["scope_revision"] != graph(model)["revisions"]["scope_revision"]
    assert graph(moved, "lecture:L1")["revisions"]["scope_revision"] != graph(model, "lecture:L1")["revisions"]["scope_revision"]
    assert graph(moved, "lecture:L2")["revisions"]["scope_revision"] == graph(model, "lecture:L2")["revisions"]["scope_revision"]


def test_the_anchor_revision_of_a_lecture_follows_its_anchors_and_the_decisions_on_them():
    def lecture(decision=None, pages=(12,), rationale=RATIONALE):
        return {"questions": {"all": [
            {"question_id": "Q1", "anchors": [anchor("L1", "deck-1", [22], "stated")],
             "ties": [{"tie": "stated", "lecture_id": "L1", "source_id": "deck-1", "pages": [22], "criteria": None, "learner_decision": None, "suggestion_id": None, "transcript_lines": []}]},
            {"question_id": "Q2", "anchors": [],
             "ties": [{"tie": "agent_inferred", "lecture_id": "L1", "source_id": "deck-1", "pages": list(pages), "criteria": [{"criterion_id": "Q2.C01", "number": 1}], "state": "agent_reviewed",
                       "verdict": "upheld", "suggestion_id": "ia-1", "learner_decision": decision, "rationale": rationale, "transcript_lines": []}]}]}}

    base = cg.anchor_revision(lecture())
    assert len(base) == 16 and int(base, 16) >= 0 and base == cg.anchor_revision(lecture())
    assert len({base, cg.anchor_revision(lecture("confirmed")), cg.anchor_revision(lecture("rejected")), cg.anchor_revision(lecture(pages=(12, 13)))}) == 4   # a decision or a changed anchor
    reordered = lecture()
    reordered["questions"]["all"].reverse()
    assert cg.anchor_revision(reordered) == base and cg.anchor_revision(lecture(rationale="Other words for the same link.")) == base   # what is tied where, not how it is worded or listed
    unenriched = {"questions": {"all": [{"question_id": "Q1", "anchors": [anchor("L1", "deck-1", [22], "stated")]}]}}   # a lecture view without ties: the course's own anchors
    moved = {"questions": {"all": [{"question_id": "Q1", "anchors": [anchor("L1", "deck-1", [23], "stated")]}]}}
    assert cg.anchor_revision(unenriched) not in {None, base, cg.anchor_revision(moved)}
    assert cg.anchor_revision({}) is None and cg.anchor_revision(None) is None   # no lecture view: no revision is claimed


# ---- node detail (R2-C7) --------------------------------------------------------------------------------------------------------
def test_node_detail_follows_the_joins_for_sources_questions_and_evidence():
    model = build_model()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    sources_of = cg.catalog_sources(model, deck_source_id_of=DECKS.get, lecture_of_source={"deck-1": "L1", "deck-2": "L2"}.get, page_count_of={"deck-1": 40, "deck-2": 12}.get,
                                    logical_slides_of=lambda lecture, source, pages: [GROUP] if source == "deck-1" and set(pages) & {22, 23, 24} else [])
    detail = cg.node_detail(model, "c.valve", course_id="demo", sources_of=sources_of, evidence=reader)
    assert set(detail) == {"sources", "sources_total", "questions", "questions_total", "evidence", "definition"}
    assert detail["sources"] == [   # the skill's own reference and the first question's anchor name the same file with the same kind of tie: one row, pages joined, both origins named
        {"kind": "pages", "lecture_id": "L1", "source_id": "deck-1", "pages": [22, 23], "ranges": [[22, 23]], "locator_text": None, "label": "PDF pages 22–23 of 40", "tie": "stated",
         "logical_slide_ids": [GROUP], "href": "/courses/demo/lectures/L1?page=22", "basis": "question anchor (stated); skill source reference", "from": ["Q1", "s.valve.explain"]},
        {"kind": "pages", "lecture_id": "L2", "source_id": "deck-2", "pages": [3], "ranges": [[3, 3]], "locator_text": None, "label": "PDF page 3 of 12", "tie": "exact",
         "logical_slide_ids": [], "href": "/courses/demo/lectures/L2?page=3", "basis": "question anchor (exact)", "from": ["Q4"]}]
    assert detail["questions"] == [
        {"question_id": "Q1", "title": "Valve and pump", "collection": "L1", "tie_to_node": "assessment", "criterion_ids": ["Q1.C01"], "evidence": reader.question("Q1")},
        {"question_id": "Q4", "title": "Valve again", "collection": "L2", "tie_to_node": "assessment", "criterion_ids": ["Q4.C01"], "evidence": reader.question("Q4")}]
    assert detail["sources_total"] == 2 and detail["questions_total"] == 2 and detail["evidence"] == reader.node("c.valve")
    assert detail["definition"]["state"] == "coverage_gap" and detail["definition"]["text"] is None and "catalog" in detail["definition"]["reason"]
    topic = cg.node_detail(model, "t.control", course_id="demo", sources_of=sources_of, evidence=reader)   # read through what the outline lists under it: the valve concept sits under both topics
    # the valve concept sits under both topics; the orphan skill is filed under this topic, so its question (Q5) is a question of the topic, as the outline lists and counts it
    assert [(s["kind"], s["from"]) for s in topic["sources"]] == [("pages", ["Q1", "s.valve.explain"]), ("pages", ["Q4"]), ("pages", ["Q5"]), ("transcript_lines", ["Q3"])] and topic["definition"] is None
    assert [(q["question_id"], q["criterion_ids"]) for q in topic["questions"]] == [("Q1", ["Q1.C01"]), ("Q3", ["Q3.C01"]), ("Q4", ["Q4.C01"]), ("Q5", ["Q5.C01"])]
    assert topic["questions_total"] == cg.node_counts(model, cg.resolve_scope(model, "course", DECKS.get), "t.control")["questions"] == 4


SOURCE_ROW_KEYS = {"kind", "lecture_id", "source_id", "pages", "ranges", "locator_text", "label", "tie", "logical_slide_ids", "href", "basis", "from"}


def test_a_source_row_opens_the_exact_file_and_page_and_other_anchor_kinds_are_not_pages():
    model = build_model(definition="A synthetic definition the catalog records.")
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    plain = cg.catalog_sources(model)   # nothing known about decks or page counts: nothing is claimed about them
    orphan = cg.node_detail(model, "Q5", course_id="demo", sources_of=plain, evidence=reader)
    assert orphan["sources"] == [{"kind": "pages", "lecture_id": "L2", "source_id": "sheet-9", "pages": [1], "ranges": [[1, 1]], "locator_text": None, "label": "PDF page 1", "tie": "stated",
                                  "logical_slide_ids": [], "href": "/courses/demo/sources/sheet-9?page=1", "basis": "question anchor (stated)", "from": ["Q5"]}]   # not the deck the lecture is shown with: the file itself is opened
    assert orphan["questions"][0]["tie_to_node"] == "self" and orphan["definition"] is None
    loop = cg.node_detail(model, "c.loop", course_id="demo", sources_of=plain, evidence=reader)
    # its only anchor is a range of transcript lines: listed as lines of that transcript, never as pages and never dropped
    assert loop["sources"] == [{"kind": "transcript_lines", "lecture_id": "L1", "source_id": "tr-1", "pages": [], "ranges": [[4, 9]], "locator_text": None, "label": "Transcript lines 4–9", "tie": "stated",
                                "logical_slide_ids": [], "href": "/courses/demo/lectures/L1?line=4", "basis": "question anchor (stated)", "from": ["Q3"]}] and loop["sources_total"] == 1
    assert loop["definition"] == {"state": "catalog", "text": "A synthetic definition the catalog records.", "reason": None}
    criterion_detail = cg.node_detail(model, "Q1.C02", course_id="demo", sources_of=plain, evidence=reader)
    assert criterion_detail["questions"] == [{"question_id": "Q1", "title": "Valve and pump", "collection": "L1", "tie_to_node": "criterion_of_question", "criterion_ids": ["Q1.C02"],
                                              "evidence": reader.question("Q1")}]
    scattered = cg.node_detail(model, "Q1", course_id="demo", evidence=reader, sources_of=lambda node: [
        {"lecture_id": "L1", "source_id": "deck-1", "pages": [30, 22, 24], "tie": "agent_inferred", "on_displayed_deck": True, "page_count": 40, "basis": "suggested link"}] if node == "Q1" else [])
    assert scattered["sources"][0]["label"] == "PDF pages 22, 24, 30 of 40" and scattered["sources"][0]["href"].endswith("?page=22") and scattered["sources"][0]["tie"] == "agent_inferred"
    assert cg.node_detail(model, "no-such-node", course_id="demo", sources_of=plain, evidence=reader) is None


def test_references_that_are_not_pages_stay_listed_as_what_they_are():
    """R2-C7 with the anchor rule (a line range and a broad text locator stay what they are). The reviewed defect: such references were
    dropped, so a node whose catalog record names a source showed an empty Sources list."""
    model = build_model()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    model.skills["s.loop.tune"]["source_refs"] = [{"source_id": "notes-7", "locator": "Section 3.2, the tuning rules"},      # a broad text locator
                                                   {"source_id": "deck-1", "locator": "slides 30-31; transcript lines 40-44"},  # pages of the cited file AND lines of the unit's transcript
                                                   {"source_id": "notes-7", "locator": "Section 3.2, the tuning rules"},      # the same reference twice: one row
                                                   {"source_id": None, "locator": ""}]                                         # nothing recorded: no row
    model.skills["s.gauge.read"]["source_refs"] = [{"source_id": "deck-1"}, {"source_id": None, "locator": "the handout from week 2"}]   # a file and no place in it; a place and no file
    model.bank["questions"]["Q2"]["anchors"] = [{"kind": "pages", "ranges": [[2, 3]], "pages": [2, 3], "basis": "stated", "from": "locator", "lecture_id": "L1", "source_id": None,
                                                 "page_basis": "one_based_physical_page", "named_source": "in_class_question_sheet", "resolution": "named_source_not_unique_in_unit",
                                                 "on_displayed_deck": False},
                                                {"kind": "transcript_lines", "ranges": [[70, 72], [80, 80]], "basis": "stated", "from": "locator", "lecture_id": "L1", "source_id": None,
                                                 "resolution": "transcript_not_unique"}]
    known = dict(deck_source_id_of=DECKS.get, lecture_of_source={"deck-1": "L1"}.get, page_count_of={"deck-1": 40}.get)
    loop = cg.node_detail(model, "s.loop.tune", course_id="demo", sources_of=cg.catalog_sources(model, **known), evidence=reader)["sources"]
    assert all(set(row) == SOURCE_ROW_KEYS for row in loop)
    assert [(s["kind"], s["lecture_id"], s["source_id"], s["pages"], s["ranges"], s["locator_text"], s["label"], s["href"], s["from"]) for s in loop] == [
        ("pages", "L1", "deck-1", [30, 31], [[30, 31]], None, "PDF pages 30–31 of 40", "/courses/demo/lectures/L1?page=30", ["s.loop.tune"]),
        ("transcript_lines", "L1", None, [], [[40, 44]], None, "Transcript lines 40–44", None, ["s.loop.tune"]),   # which transcript is not known here: named as lines, opened as nothing
        ("transcript_lines", "L1", "tr-1", [], [[4, 9]], None, "Transcript lines 4–9", "/courses/demo/lectures/L1?line=4", ["Q3"]),
        ("text", None, "notes-7", [], [], "Section 3.2, the tuning rules", "Section 3.2, the tuning rules", "/courses/demo/sources/notes-7", ["s.loop.tune"])]
    assert {s["tie"] for s in loop} == {"stated"} and {s["basis"] for s in loop} == {"skill source reference", "question anchor (stated)"}
    resolved = cg.node_detail(model, "s.loop.tune", course_id="demo", evidence=reader, sources_of=cg.catalog_sources(model, transcript_of={"L1": "tr-1"}.get, **known))["sources"]
    assert [(s["kind"], s["source_id"], s["ranges"], s["label"], s["href"], s["from"]) for s in resolved if s["kind"] == "transcript_lines"] == [
        ("transcript_lines", "tr-1", [[4, 9], [40, 44]], "Transcript lines 4–9, 40–44", "/courses/demo/lectures/L1?line=4", ["Q3", "s.loop.tune"])]   # the same transcript, the same kind of tie: one row
    gauge = cg.node_detail(model, "c.gauge", course_id="demo", sources_of=cg.catalog_sources(model, **known), evidence=reader)
    assert [(s["kind"], s["source_id"], s["pages"], s["ranges"], s["locator_text"], s["label"], s["href"]) for s in gauge["sources"]] == [
        ("pages", None, [2, 3], [[2, 3]], None, "PDF pages 2–3", None),                                             # pages of a file the record does not identify: listed, not openable
        ("transcript_lines", None, [], [[70, 72], [80, 80]], None, "Transcript lines 70–72, 80", None),
        ("text", None, [], [], "the handout from week 2", "the handout from week 2", None),                         # a place in words and no file: listed as written
        ("text", "deck-1", [], [], "", "No place in the file is named", "/courses/demo/sources/deck-1")]            # a file and no place: the file itself
    assert gauge["sources_total"] == 4 and all(s["pages"] == [] for s in gauge["sources"] if s["kind"] != "pages")   # a line is not a page
    # every node whose catalog record names a source has a Sources row
    sources_of = cg.catalog_sources(model, **known)
    for node in [*model.topics, *model.concepts, *model.skills, *model.questions, *model.criteria]:
        own = ev_skills_under(model, node) if model.kind_of(node) in {"topic", "concept"} else set(model.skills_of(node))   # a question and a criterion: the skills they assess
        recorded = [r for s in own for r in model.skills[s].get("source_refs") or [] if r.get("source_id") or r.get("locator")]
        recorded += [a for q in model.questions_of(node) for a in model.bank["questions"][q]["anchors"]]
        assert bool(cg.node_detail(model, node, course_id="demo", sources_of=sources_of, evidence=reader)["sources"]) is bool(recorded), node
    lined = cg.tie_sources([{"tie": "stated", "lecture_id": "L1", "source_id": "tr-1", "pages": [], "logical_slide_ids": [], "transcript_lines": [[4, 9]], "criteria": None, "on_displayed_deck": False}])
    assert [(r["kind"], r["source_id"], r["ranges"], r["pages"]) for r in lined] == [("transcript_lines", "tr-1", [[4, 9]], [])]   # a question the course anchors to transcript lines only


def test_a_question_and_a_criterion_also_list_where_the_skill_they_assess_is_taught_apart_from_their_own_anchors():
    """The join question → criterion → skill → the skill's source reference (as the R1 detail listed it). The reviewed defect: a question
    or criterion without an anchor of its own showed no source although its skill names one."""
    model = build_model()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    sources_of = cg.catalog_sources(model, deck_source_id_of=DECKS.get, lecture_of_source={"deck-1": "L1"}.get, page_count_of={"deck-1": 40}.get)

    def listed(node):
        return [(s["kind"], s["pages"], s["basis"], s["from"]) for s in cg.node_detail(model, node, course_id="demo", sources_of=sources_of, evidence=reader)["sources"]]

    # the same file and the same kind of tie, and still two rows: the question's own anchor is not blurred by where its skill is taught
    assert listed("Q1") == [("pages", [22], "question anchor (stated)", ["Q1"]), ("pages", [22, 23], "skill source reference", ["s.valve.explain"])]
    assert listed("Q1.C01") == [("pages", [22], "question anchor (stated)", ["Q1"]), ("pages", [22, 23], "skill source reference", ["s.valve.explain"])]
    assert listed("Q1.C02") == [("pages", [22], "question anchor (stated)", ["Q1"])]   # only the skill of THIS criterion; the pump skill names no source
    assert listed("Q4") == [("pages", [3], "question anchor (exact)", ["Q4"]), ("pages", [22, 23], "skill source reference", ["s.valve.explain"])]
    assert listed("c.valve")[0] == ("pages", [22, 23], "question anchor (stated); skill source reference", ["Q1", "s.valve.explain"])   # a concept's sources stay joined per file and tie
    model.bank["questions"]["Q1"]["anchors"] = []   # a question the course anchors nowhere still says where the skill it assesses is taught
    assert listed("Q1") == [("pages", [22, 23], "skill source reference", ["s.valve.explain"])] == listed("Q1.C01") and listed("Q1.C02") == []


def test_a_suggested_link_is_a_source_only_of_what_its_listed_criteria_assess():
    model = build_model()
    reader = EvidenceReader({"attempts": {}, "revisions": {}, "effective": {}}, model)
    ties = {"Q1": [{"tie": "stated", "lecture_id": "L1", "source_id": "deck-1", "pages": [22], "logical_slide_ids": [GROUP], "criteria": None, "on_displayed_deck": True},
                   {"tie": "agent_inferred", "lecture_id": "L1", "source_id": "deck-1", "pages": [30, 31], "logical_slide_ids": ["ls-x-p30-31"], "on_displayed_deck": True,
                    "criteria": [{"criterion_id": "Q1.C02", "number": 2}], "coverage": "partial", "state": "agent_reviewed", "rationale": RATIONALE},
                   {"tie": "stated", "lecture_id": "L1", "source_id": "tr-1", "pages": [], "logical_slide_ids": [], "criteria": None, "on_displayed_deck": False}]}   # transcript lines only: not a page source

    def sources_of(node_id):
        return cg.tie_sources(ties.get(node_id), page_count_of={"deck-1": 40}.get)

    pump = cg.node_detail(model, "c.pump", course_id="demo", sources_of=sources_of, evidence=reader)["sources"]
    assert [(s["tie"], s["pages"], s["label"], s["basis"], s["logical_slide_ids"]) for s in pump] == [
        ("stated", [22], "PDF page 22 of 40", "question anchor (stated)", [GROUP]), ("agent_inferred", [30, 31], "PDF pages 30–31 of 40", "suggested link (agent-inferred)", ["ls-x-p30-31"])]
    valve = cg.node_detail(model, "c.valve", course_id="demo", sources_of=sources_of, evidence=reader)["sources"]
    assert [(s["tie"], s["pages"]) for s in valve] == [("stated", [22])]   # the suggestion lists the pump criterion only: it is no source of the valve
    assert [(s["tie"], s["pages"]) for s in cg.node_detail(model, "Q1", course_id="demo", sources_of=sources_of, evidence=reader)["sources"]] == [("stated", [22]), ("agent_inferred", [30, 31])]
    assert [s["tie"] for s in cg.node_detail(model, "Q1.C01", course_id="demo", sources_of=sources_of, evidence=reader)["sources"]] == ["stated"]
    assert [s["tie"] for s in cg.node_detail(model, "Q1.C02", course_id="demo", sources_of=sources_of, evidence=reader)["sources"]] == ["stated", "agent_inferred"]
    assert RATIONALE not in json.dumps(pump) and cg.tie_sources(None) == []


# ---- the synthetic fixture course through the Projector, and the route ------------------------------------------------------------
NOW = "2026-10-05T12:00:00Z"


@pytest.fixture()
def projector(settings, clock):
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    prep.prepare_course("be505")
    yield Projector(settings, journal, preparation=prep, now=lambda: NOW)
    journal.close()


def test_the_fixture_course_reads_the_same_through_outline_and_graph(projector, be505):
    criteria = sum(len(q["criteria"]) for q in content.BE505_QUESTIONS)
    course = cg.view(projector, "be505")
    assert course["totals"] == {"topic": len(content.BE505_TOPICS), "concept": len(content.BE505_CONCEPTS), "skill": len(content.BE505_SKILLS), "question": len(content.BE505_QUESTIONS),
                                "criterion": criteria}
    counts = projector.outline_view("be505", scope="course")["canonical_counts"]
    assert all(course["totals"][kind] == counts[kind] for kind in course["totals"])
    promoter = [n for n in course["nodes"] if n["id"] == "be505.concept.promoter"]
    assert len(promoter) == 1 and sum(1 for e in course["edges"] if e["to"] == "be505.concept.promoter" and e["relation"] == "topic_includes_concept") == 2
    origin = by_id(course)["be505.concept.origin-of-replication"]
    assert origin["evidence"] == {"state": "assisted", "assistance": "hint", "prior_exposure": "unseen", "attempts": 3}
    assert by_id(course)["be505.skill.promoter.explain"]["evidence"]["state"] == "not_separately_observed"
    index_sha = __import__("hashlib").sha256((be505 / "learning" / "question-index.json").read_bytes()).hexdigest()
    assert course["revisions"]["question_index_sha256"] == index_sha and course["revisions"]["evidence_revision"] == evidence_revision(projector._records("be505"))
    lecture = cg.view(projector, "be505", scope="lecture:lecture-04")
    assert lecture["totals"]["question"] == 3 and ids(lecture, "concept") == ["be505.concept.inducible-promoter"]
    on_slide = cg.view(projector, "be505", scope="slide:lecture-04:1")
    assert ids(on_slide, "concept") == ["be505.concept.inducible-promoter"] and on_slide["totals"]["question"] == 1 and by_id(on_slide)["be505.concept.inducible-promoter"]["where"] == "on_this_page"
    slide = cg.view(projector, "be505", scope="slide:lecture-04:1", focus="BE505-L04-Q01")
    assert slide["scope"]["kind"] == "slide" and slide["scope"]["page"] == 1 and ids(slide, "question") == ["BE505-L04-Q01", "BE505-PS03-Q01"]
    assert by_id(slide)["BE505-L04-Q01"]["where"] == "on_this_page" and by_id(slide)["BE505-PS03-Q01"]["in_scope"] is False   # reached by the owner's relation only
    assert ("BE505-L04-Q01", "diagnostic_prerequisite", "BE505-PS03-Q01") in edge_set(slide, "structure")
    assert cg.view(projector, "be505", scope="slide:lecture-04:2")["nodes"] == [] and cg.view(projector, "be505", scope="lecture:nope")["error"]["code"] == "unknown_scope"
    model, _bank, decks, _catalogs = projector._outline("be505")
    resolved = cg.resolve_scope(model, "slide:lecture-04:1", decks.get)   # the R1 description of the scope is kept for the outline
    assert resolved["anchored_questions"] == ["BE505-L04-Q01"] and resolved["related_questions"] == ["BE505-L04-CLASS-Q01", "BE505-L04-Q02"] and cg.public_scope(resolved)["basis"] == "typed_anchor"
    assert cg.public_scope(cg.resolve_scope(model, "lecture:lecture-01", decks.get))["questions_without_slide_anchor"] == ["BE505-L01-Q04"]
    text = json.dumps([course, lecture, slide])
    assert "observable" not in text and not [q["answer"] for q in content.BE505_QUESTIONS if q["answer"] in text] and not [q["prompt"] for q in content.BE505_QUESTIONS if q["prompt"] and q["prompt"] in text]


def test_the_wired_views_list_every_revision_they_were_built_from(projector, be505, settings):
    course = cg.view(projector, "be505")
    lecture = cg.view(projector, "be505", scope="lecture:lecture-04")
    on_slide = cg.view(projector, "be505", scope="slide:lecture-04:1")
    assert set(course["revisions"]) == set(lecture["revisions"]) == set(on_slide["revisions"]) == REVISION_KEYS
    skills_sha = projector._catalogs("be505")["skills"]["sha256"]
    assert course["revisions"]["skills_sha256"] == skills_sha == lecture["revisions"]["skills_sha256"] and len(skills_sha) == 64   # the skills catalog: a moved or renamed skill keeps its id
    assert course["revisions"]["policy_revision"] == settings.policy_revision == on_slide["revisions"]["policy_revision"]
    assert course["revisions"]["anchor_revision"] is None   # the course graph draws no anchor
    assert len(lecture["revisions"]["anchor_revision"]) == 16 and on_slide["revisions"]["anchor_revision"] == lecture["revisions"]["anchor_revision"]
    assert cg.view(projector, "be505", scope="lecture:lecture-01")["revisions"]["anchor_revision"] != lecture["revisions"]["anchor_revision"]   # each lecture has its own


def test_the_wired_node_detail_has_one_question_count_and_keeps_references_that_are_not_pages(projector, be505):
    bank = projector._bank("be505")
    # the fixture question anchored to transcript lines of a unit without a linked transcript: listed as what the record says, opened as nothing
    lined = projector.outline_node("be505", "BE505-L04-Q02")
    assert lined["sources_total"] == 2 and [(s["kind"], s["pages"], s["ranges"], s["source_id"], s["href"], s["tie"], s["basis"], s["from"]) for s in lined["sources"]] == [
        ("pages", [1, 2], [[1, 2]], "src-lecture-02-slides", "/courses/be505/lectures/lecture-02?page=1", "stated", "skill source reference", ["be505.skill.inducible-control.explain"]),   # where the skill it assesses is taught
        ("transcript_lines", [], [[3, 5]], None, None, "exact", "question anchor (exact)", ["BE505-L04-Q02"])]
    unanchored = projector.outline_node("be505", "BE505-L01-Q04")   # the course anchors this question nowhere; its Sources are not empty for that
    assert bank["questions"]["BE505-L01-Q04"]["anchors"] == [] and [(s["kind"], s["pages"], s["basis"]) for s in unanchored["sources"]] == [("pages", [2, 3], "skill source reference")]
    model, _bank, decks, _catalogs = projector._outline("be505")
    resolved = cg.resolve_scope(model, "course", decks.get)
    for row in walk(model, resolved):   # outline row, graph node and node detail through the Projector: one count per node
        if row["kind"] in {"topic", "concept", "skill"}:
            detail = projector.outline_node("be505", row["node_id"])
            assert detail["questions_total"] == cg.node_counts(model, resolved, row["node_id"])["questions"] == len(detail["questions"]), row["node_id"]
            assert all(s["kind"] in cg.SOURCE_KINDS for s in detail["sources"])
    rows = projector.outline_view("be505", scope="course", parent="be505.topic.plasmids")["rows"]
    assert all(r["questions"] == projector.outline_node("be505", r["node_id"])["questions_total"] for r in rows if r["kind"] == "concept") and rows


def test_a_page_past_the_end_of_the_fixture_deck_is_an_unknown_scope_in_graph_and_outline(projector, be505, settings):
    assert projector.lecture_view("be505", "lecture-04")["page_count"] == 3
    assert "error" not in cg.view(projector, "be505", scope="slide:lecture-04:3")
    for page in (4, 99999):
        assert cg.view(projector, "be505", scope=f"slide:lecture-04:{page}")["error"]["code"] == "unknown_scope"
        with pytest.raises(ValueError):
            projector.outline_view("be505", scope=f"slide:lecture-04:{page}")
    for scope in ("slide:lecture-04:0", "slide:lecture-04:01"):
        assert cg.view(projector, "be505", scope=scope)["error"]["code"] == "unknown_scope"
        with pytest.raises(ValueError):
            projector.outline_view("be505", scope=scope)
    runtime = _Runtime(settings, projector)
    app = FastAPI()
    cg.register(app, runtime, runtime.with_lock)
    client = TestClient(app)
    assert client.get("/api/courses/be505/concept-graph", params={"scope": "slide:lecture-04:3"}).status_code == 200
    assert [client.get("/api/courses/be505/concept-graph", params={"scope": f"slide:lecture-04:{page}"}).status_code for page in (4, 99999, 0, "01")] == [404, 404, 422, 422]


class _Runtime:
    def __init__(self, settings, projector):
        self.settings, self.projector, self.locked = settings, projector, 0

    def with_lock(self, fn):
        self.locked += 1
        return fn()


def test_the_route_validates_its_parameters_and_answers_unknown_things_with_an_error(projector, settings):
    runtime = _Runtime(settings, projector)
    app = FastAPI()
    cg.register(app, runtime, runtime.with_lock)
    client = TestClient(app)
    ok = client.get("/api/courses/be505/concept-graph")
    assert ok.status_code == 200 and ok.json() == json.loads(json.dumps(cg.view(projector, "be505"))) and runtime.locked == 1
    focused = client.get("/api/courses/be505/concept-graph", params={"scope": "lecture:lecture-01", "focus": "BE505-L01-Q03", "depth": 2, "limit": 40})
    assert focused.status_code == 200 and focused.json()["focus"] == "BE505-L01-Q03" and focused.json()["scope"]["lecture_id"] == "lecture-01"
    assert {"strict_containment", "question_has_criterion", "criterion_assesses_concept"} <= {e["relation"] for e in focused.json()["edges"]}
    unknown_course = client.get("/api/courses/nope/concept-graph")
    assert unknown_course.status_code == 404 and unknown_course.json() == {"detail": "Unknown course"}   # no graph of that course exists to answer with a graph document
    for params in ({"scope": "banana"}, {"scope": "slide:lecture-01:x"}, {"scope": "lecture:"}, {"depth": 0}, {"depth": 4}, {"limit": 0}, {"limit": cg.MAX_LIMIT + 1}, {"focus": ""}, {"focus": "x" * 301}):
        assert client.get("/api/courses/be505/concept-graph", params=params).status_code == 422, params
    assert [r.methods for r in app.routes if getattr(r, "path", "") == "/api/courses/{course_id}/concept-graph"] == [{"GET"}]   # a read: nothing to pin among state-changing routes


@pytest.mark.parametrize("params,code,named", [
    ({"scope": "lecture:nope"}, "unknown_scope", "lecture:nope"),
    ({"scope": "slide:nope:1"}, "unknown_scope", "slide:nope:1"),
    ({"scope": "slide:lecture-04:4"}, "unknown_scope", "4"),                       # the deck of the fixture lecture has three pages
    ({"focus": "no-such-node"}, "unknown_focus", "no-such-node"),
    ({"scope": "lecture:lecture-01", "focus": "no-such-node", "depth": 3, "limit": 5}, "unknown_focus", "no-such-node"),
    ({"scope": "lecture:nope", "focus": "no-such-node"}, "unknown_scope", "lecture:nope"),   # the scope is resolved first: one code per answer
])
def test_the_route_answers_an_unknown_scope_or_focus_with_404_and_the_documented_error_document(projector, settings, params, code, named):
    """r2-read-api.md 1.4: ``{course_id, graph_version, error: {code, detail}}`` with status 404 — the reader tells the two apart by ``error.code``."""
    runtime = _Runtime(settings, projector)
    app = FastAPI()
    cg.register(app, runtime, runtime.with_lock)
    answer = TestClient(app).get("/api/courses/be505/concept-graph", params=params)
    body = answer.json()
    assert answer.status_code == 404 and answer.headers["content-type"].startswith("application/json") and runtime.locked == 1
    assert set(body) == {"course_id", "graph_version", "error"} and body["course_id"] == "be505" and body["graph_version"] == cg.GRAPH_VERSION == "concept-graph/1"
    assert set(body["error"]) == {"code", "detail"} and body["error"]["code"] == code
    assert isinstance(body["error"]["detail"], str) and named in body["error"]["detail"]
    assert body == cg.view(projector, "be505", **params)   # the route adds nothing to and removes nothing from the document the reader returns
    assert not {"nodes", "edges", "totals", "detail"} & set(body)   # never an empty graph, and not the bare ``{detail}`` of a general 404
