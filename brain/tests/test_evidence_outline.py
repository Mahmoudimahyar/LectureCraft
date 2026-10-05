"""R1-G1..G4 and R1-F1..F4: one typed outline with criteria over three scopes; evidence shown with its recorded condition;
facets from a versioned mapping that may answer "unclassified"; coverage with an explicit unit and remainder."""
from __future__ import annotations

import json

import pytest

from lecture_brain.evidence import condition_of, facet_of, load_facet_mapping
from lecture_brain.fixtures import content
from lecture_brain.journal import Journal
from lecture_brain.preparation import Preparation
from lecture_brain.projections import Projector

NOW = "2026-10-05T12:00:00Z"
CRITERIA = sum(len(q["criteria"]) for q in content.BE505_QUESTIONS)


@pytest.fixture()
def projector(settings, clock):
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    prep.prepare_course("be505")
    yield Projector(settings, journal, preparation=prep, now=lambda: NOW)
    journal.close()


# ---- evidence conditions (R1-F1) -------------------------------------------------------------------------
def obs(assistance="none", reference="none"):
    return {"assistance": assistance, "reference_access": reference, "outcome": "demonstrated"}


def attempt(exposure="unseen", kind="observed_response"):
    return {"question": {"prior_exposure": exposure}, "evidence_kind": kind}


@pytest.mark.parametrize("observation,att,expected", [
    (obs(), attempt(), "unaided"),
    (obs("solution_shown"), attempt(), "assisted"),
    (obs("formula_provided"), attempt(), "assisted"),
    (obs("hint"), attempt(), "assisted"),
    (obs("mixed"), attempt(), "assisted"),
    (obs(reference="notes"), attempt(), "assisted"),
    (obs(), attempt("seen_exact"), "prior_exposure"),
    (obs(), attempt("same_family"), "prior_exposure"),
    (obs("unknown"), attempt(), "conditions_unknown"),
    (obs(reference="unknown"), attempt(), "conditions_unknown"),
    (obs(), attempt("unknown"), "conditions_unknown"),
    (obs(), attempt(None), "conditions_unknown"),
    (obs("solution_shown", "unknown"), attempt("unknown"), "assisted"),  # known help outranks what is unknown
])
def test_only_unaided_unexposed_work_counts_as_recorded_unaided_performance(observation, att, expected):
    result = condition_of(observation, att)
    assert result["condition"] == expected
    assert result["qualifying_unaided"] is (expected == "unaided")
    assert result["reasons"] or expected == "unaided"


def test_a_response_that_was_not_observed_never_qualifies():
    assert condition_of(obs(), attempt(kind="self_report"))["qualifying_unaided"] is False
    assert condition_of({**obs(), "outcome": "partial"}, attempt())["qualifying_unaided"] is False


# ---- facet mapping (R1-F2) ---------------------------------------------------------------------------------
def test_the_mapping_is_versioned_and_gives_a_rationale_for_every_rule(repo):
    mapping = load_facet_mapping(repo)
    assert mapping["contract"] == "ll.facet-mapping/1" and isinstance(mapping["mapping_version"], int)
    assert {f["facet"] for f in mapping["facets"]} == {"recall", "conceptual_explanation", "formulation_method_choice", "algebra_numerical_execution", "coding_execution", "interpretation", "transfer"}
    assert all(rule["rationale"] for rule in mapping["rules"])


def test_tokens_that_do_not_support_a_finer_conclusion_stay_unclassified(repo):
    mapping = load_facet_mapping(repo)
    assert facet_of({"action_types": ["recall"]}, mapping)["facet"] == "recall"
    assert facet_of({"action_types": ["calculate"]}, mapping)["facet"] == "algebra_numerical_execution"
    assert facet_of({"action_types": ["select_method"]}, mapping)["facet"] == "formulation_method_choice"
    # deriving mixes formulation and algebra; designing is not coding; neither is forced into a facet
    for token in ("derive", "design", "critique"):
        result = facet_of({"action_types": [token]}, mapping)
        assert result["facet"] is None and result["state"] == "unclassified" and result["candidates"]
    assert all(rule["facet"] != "coding_execution" for rule in mapping["rules"])  # no token is read as coding
    combined = facet_of({"action_types": ["interpret", "explain"]}, mapping)
    assert combined["facet"] is None and combined["state"] == "combined" and combined["tokens"] == ["interpret", "explain"]
    legacy = facet_of({"ability": "explain"}, mapping)  # older skills carry no action tokens
    assert legacy["facet"] == "conceptual_explanation" and legacy["token_basis"] == "ability_field"
    assert facet_of({}, mapping)["state"] == "unclassified"


# ---- progress (R1-F1, F3, F4) ---------------------------------------------------------------------------------
def test_status_carries_the_recorded_condition_instead_of_an_undifferentiated_shown(projector):
    view = projector.gaps_view("be505")
    statuses = {r["status"] for r in view["skills"]}
    assert "demonstrated_latest" not in statuses
    assert statuses <= {"not_assessed", "not_observed_only", "current_gap", "uncertain", "demonstrated_unaided", "demonstrated_assisted", "demonstrated_after_exposure",
                        "demonstrated_conditions_unknown"}
    for row in view["skills"]:
        for episode in row["history"]:
            assert episode["condition"] in {"unaided", "assisted", "prior_exposure", "conditions_unknown"} and "prior_exposure" in episode
        if row["status"].startswith("demonstrated_"):
            assert row["latest"]["condition"] == {"demonstrated_unaided": "unaided", "demonstrated_assisted": "assisted", "demonstrated_after_exposure": "prior_exposure",
                                                  "demonstrated_conditions_unknown": "conditions_unknown"}[row["status"]]
        assert row["unaided_demonstrated"] == sum(1 for e in row["history"] if e["qualifying_unaided"])
    assert view["rules"]["evidence_conditions"] == "evidence-conditions/1"


def test_coverage_names_its_unit_rule_version_and_remainder_and_never_a_percentage(projector):
    facets = projector.gaps_view("be505")["facets"]
    assert facets["unit"] == "skill" and facets["mapping_version"] >= 1 and facets["target_set"] == "skills of this course's catalog"
    rows = {r["facet"]: r for r in facets["rows"]}
    assert set(rows) == {"recall", "conceptual_explanation", "formulation_method_choice", "algebra_numerical_execution", "coding_execution", "interpretation", "transfer",
                         "combined", "unclassified"}
    total = sum(r["target_skills"] for r in rows.values())
    assert total == len(content.BE505_SKILLS)  # every skill is counted once, in exactly one row
    for row in rows.values():
        assert row["qualifying_unaided_skills"] + row["observed_other_skills"] + row["uncertain_skills"] + row["unassessed_skills"] == row["target_skills"]
        assert set(row["observations_by_condition"]) == {"unaided", "assisted", "prior_exposure", "conditions_unknown"}
    assert rows["coding_execution"]["target_skills"] == 0 and "no skill" in rows["coding_execution"]["note"].lower()
    text = json.dumps(facets)
    assert "%" not in text and "mastery" not in text.lower().replace("no mastery", "") and "probability" not in text.lower().replace("no exam probability", "")


def test_listing_criteria_is_not_evidence_about_them(projector):
    view = projector.gaps_view("be505")
    assert view["criterion_evidence"]["criteria_in_catalog"] == CRITERIA
    assert view["criterion_evidence"]["attempts_with_criterion_observations"] == 0
    assert "skill" in view["criterion_evidence"]["note"]


# ---- outline (R1-G1..G4) ----------------------------------------------------------------------------------------
def walk(projector, scope, parent=None, depth=0, seen=None):
    seen = seen if seen is not None else []
    page = projector.outline_view("be505", scope=scope, parent=parent)
    for row in page["rows"]:
        seen.append(row)
        if row["has_children"] and depth < 8:
            walk(projector, scope, row["instance_id"], depth + 1, seen)
    return seen


def test_every_catalogued_object_is_present_once_by_canonical_id_and_criteria_are_reachable(projector):
    top = projector.outline_view("be505", scope="course")
    assert top["canonical_counts"] == {"topic": len(content.BE505_TOPICS), "concept": len(content.BE505_CONCEPTS), "skill": len(content.BE505_SKILLS),
                                       "question_family": len(content.BE505_QUESTIONS) + 1, "question": len(content.BE505_QUESTIONS), "criterion": CRITERIA,
                                       "question_relationship": len(content.BE505_RELATIONSHIPS)}
    assert [r["kind"] for r in top["rows"]] == ["topic"] * len(content.BE505_TOPICS)  # grouped: nothing below topics is sent until asked for
    rows = walk(projector, "course")
    by_kind: dict[str, set] = {}
    for row in rows:
        by_kind.setdefault(row["kind"], set()).add(row["node_id"])
    assert len(by_kind["concept"]) == len(content.BE505_CONCEPTS) and len(by_kind["skill"]) == len(content.BE505_SKILLS)
    assert len(by_kind["question"]) == len(content.BE505_QUESTIONS) and len(by_kind["criterion"]) == CRITERIA
    # a concept under two topics is one canonical node shown on two branches with different instance ids
    promoter = [r for r in rows if r["node_id"] == "be505.concept.promoter"]
    assert len(promoter) == 2 and len({r["instance_id"] for r in promoter}) == 2
    assert len({r["instance_id"] for r in rows}) == len(rows)
    assert "observable" not in json.dumps(rows) and not [q["answer"] for q in content.BE505_QUESTIONS if q["answer"] in json.dumps(rows)]


def test_lecture_and_slide_scopes_come_from_membership_and_typed_anchors(projector):
    lecture = walk(projector, "lecture:lecture-04")
    questions = {r["node_id"] for r in lecture if r["kind"] == "question"}
    assert questions == {"BE505-L04-Q01", "BE505-L04-Q02", "BE505-L04-CLASS-Q01"}
    slide = projector.outline_view("be505", scope="slide:lecture-04:1")
    assert slide["scope"]["basis"] == "typed_anchor" and slide["scope"]["anchored_questions"] == ["BE505-L04-Q01"]
    assert {r["node_id"] for r in walk(projector, "slide:lecture-04:1") if r["kind"] == "question"} == {"BE505-L04-Q01"}
    assert slide["scope"]["related_questions"] == ["BE505-L04-CLASS-Q01", "BE505-L04-Q02"]  # same concept, not placed on the slide: listed apart
    empty = projector.outline_view("be505", scope="slide:lecture-04:2")
    assert empty["rows"] == [] and "names this slide" in empty["scope"]["note"]
    # a collection without slide anchors keeps its lecture scope and shows that the anchors are missing
    first = projector.outline_view("be505", scope="lecture:lecture-01")
    assert first["scope"]["questions_without_slide_anchor"] == ["BE505-L01-Q04"]
    assert projector.outline_view("be505", scope="lecture:lecture-03")["scope"]["gap"]
    with pytest.raises(ValueError):
        projector.outline_view("be505", scope="lecture:nope")


def test_selecting_a_node_offers_sources_questions_and_evidence(projector):
    node = projector.outline_node("be505", "be505.concept.origin-of-replication")
    assert node["node"]["kind"] == "concept" and {p["node_id"] for p in node["parents"]} == {"be505.topic.plasmids"}
    assert {q["question_id"] for q in node["questions"]} == {"BE505-L01-Q01", "BE505-L01-Q03"}
    assert node["sources"] and all(s["basis"] for s in node["sources"])
    assert node["evidence"]["unit"] == "skill" and node["evidence"]["skills"][0]["skill_id"] == "be505.skill.ori.explain"
    question = projector.outline_node("be505", "BE505-L01-Q03")
    relations = {(link["relation"], link["other"]) for link in question["links"]}
    assert ("strict_containment", "BE505-L01-Q02") in relations and all(link["automatic_credit"] is False for link in question["links"])
    criterion = projector.outline_node("be505", "BE505-L01-Q03.C02")
    assert criterion["node"]["kind"] == "criterion" and criterion["node"]["question_id"] == "BE505-L01-Q03" and "observable" not in json.dumps(criterion)
    assert criterion["evidence"]["criterion_observations"] == 0 and "its skill" in criterion["evidence"]["note"]
    assert projector.outline_node("be505", "no-such-node") is None


def test_traversal_is_bounded_and_a_repeated_identity_is_not_expanded_again(projector, settings):
    path = settings.course("be505").root / "learning" / "question-index.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["relationships"].append({"from_question": "BE505-L01-Q03", "to_question": "BE505-L01-Q01", "relation": "diagnostic_prerequisite", "rationale": "synthetic back-edge", "automatic_credit": False})
    path.write_text(json.dumps(doc), encoding="utf-8")
    rows = walk(projector, "course")  # a cycle between questions is a cross-link, not a tree edge: the walk still ends
    assert len(rows) < 400
    page = projector.outline_view("be505", scope="course", limit=1)
    assert len(page["rows"]) == 1 and page["truncated"] is True and page["total_children"] == len(content.BE505_TOPICS)
    assert projector.outline_view("be505", scope="course", parent="be505.topic.plasmids>be505.topic.plasmids")["rows"] == []


def test_the_older_graph_view_now_holds_criteria_too(projector):
    view = projector.concepts_view("be505")
    criteria = [n for n in view["nodes"].values() if n["type"] == "criterion"]
    assert len(criteria) == CRITERIA and "observable" not in json.dumps(criteria)
    assert sum(1 for e in view["edges"] if e["relation"] == "question_has_criterion") == CRITERIA
