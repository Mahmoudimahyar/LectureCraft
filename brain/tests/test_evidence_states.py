"""R2-C9, R2-C10 (Brain side): five evidence states that stay different, prior exposure reported beside them and never as
assistance, counts with their denominators, and no mastery or probability anywhere. All records here are synthetic."""
from __future__ import annotations

import json

import pytest

from lecture_brain import evidence as ev
from lecture_brain.evidence import (EVIDENCE_STATES, EvidenceReader, condition_of, evidence_revision, evidence_rows, node_evidence, observation_state,
                                    question_evidence)
from lecture_brain.outline import OutlineModel
from lecture_brain.ownerio.attempts import read_attempt_records

QUESTION_KEYS = {"state", "assistance", "prior_exposure", "attempts", "last_at"}
NODE_KEYS = {"state", "assistance", "prior_exposure", "attempts"}
OBSERVATION_KEYS = {"attempt_id", "recorded_at", "outcome", "state", "assistance", "prior_exposure", "question_id", "skill_id"}


# ---- synthetic builders ------------------------------------------------------------------------------------
def obs(skill="s.valve.explain", outcome="demonstrated", assistance="none", reference="none", **extra):
    return {"skill_id": skill, "outcome": outcome, "assistance": assistance, "reference_access": reference, **extra}


def att(attempt_id, at, observations, *, question_id=None, exposure="unseen", kind="observed_response"):
    question = {"family_id": "fam.synthetic", "family_revision": 1, "prompt": "Synthetic prompt.", "prior_exposure": exposure}
    if question_id:
        question["question_id"] = question_id
    return {"record_kind": "attempt", "attempt_id": attempt_id, "recorded_at": at, "evidence_kind": kind, "question": question, "observations": observations}


def records(*attempts, regrades=()):
    """The shape ``read_attempt_records`` returns. ``regrades``: (event id, attempt id, recorded_at, observations)."""
    out = {"attempts": {a["attempt_id"]: a for a in attempts}, "revisions": {}, "effective": {}, "problems": []}
    for a in attempts:
        out["effective"][a["attempt_id"]] = {"assessment_id": a["attempt_id"], "observations": a["observations"], "chain": [a["attempt_id"]], "conflict": False, "assessed_at": a["recorded_at"]}
    for event_id, attempt_id, at, observations in regrades:
        out["revisions"][event_id] = {"record_kind": "assessment_revision", "event_id": event_id, "attempt_id": attempt_id, "replaces_assessment_id": attempt_id, "recorded_at": at,
                                      "observations": observations}
        out["effective"][attempt_id] = {"assessment_id": event_id, "observations": observations, "chain": [attempt_id, event_id], "conflict": False, "assessed_at": at}
    return out


def model():
    """Two topics, one concept under both, one skill nobody asks about, one topic with nothing assessable."""
    def criterion(cid, skill, concept):
        return {"criterion_id": cid, "skill_id": skill, "concept_id": concept, "action_types": ["explain"], "observable": "WORDING THAT MUST NOT LEAK"}

    catalogs = {
        "skills": {"topics": {"t.flow": {"topic_id": "t.flow", "label": "Flow"}, "t.control": {"topic_id": "t.control", "label": "Control"}, "t.empty": {"topic_id": "t.empty", "label": "Housekeeping"}},
                   "skills": {"s.valve.explain": {"skill_id": "s.valve.explain", "topic_ids": ["t.flow"], "concept_id": "c.valve", "performance_target": "Explain a valve."},
                              "s.pump.size": {"skill_id": "s.pump.size", "topic_ids": ["t.flow"], "concept_id": "c.pump", "performance_target": "Size a pump."},
                              "s.loop.tune": {"skill_id": "s.loop.tune", "topic_ids": ["t.control"], "concept_id": "c.loop", "performance_target": "Tune a loop."}}},
        "families": {},
        "questions": {"concepts": {"c.valve": {"concept_id": "c.valve", "label": "Valve", "topic_ids": ["t.flow", "t.control"]},
                                   "c.pump": {"concept_id": "c.pump", "label": "Pump", "topic_ids": ["t.flow"]},
                                   "c.loop": {"concept_id": "c.loop", "label": "Loop", "topic_ids": ["t.control"]},
                                   "c.bare": {"concept_id": "c.bare", "label": "Named only", "topic_ids": ["t.empty"]}},
                      "questions": {"Q1": {"question_id": "Q1", "title": "Valve and pump", "prompt": "Synthetic.",
                                           "criteria": [criterion("Q1.C01", "s.valve.explain", "c.valve"), criterion("Q1.C02", "s.pump.size", "c.pump")]},
                                    "Q2": {"question_id": "Q2", "title": "Valve again", "prompt": "Synthetic.", "criteria": [criterion("Q2.C01", "s.valve.explain", "c.valve")]},
                                    "Q3": {"question_id": "Q3", "title": "Loop", "prompt": "Synthetic.", "criteria": [criterion("Q3.C01", "s.loop.tune", "c.loop")]}},
                      "relationships": []}}
    bank = {"lectures": {}, "questions": {q: {"slide_anchor": "none", "anchors": []} for q in ("Q1", "Q2", "Q3")}}
    return OutlineModel(catalogs, bank)


# ---- one observation -----------------------------------------------------------------------------------------
@pytest.mark.parametrize("observation,exposure,state,assistance,prior", [
    (obs(), "unseen", "independent", None, "unseen"),
    (obs(), "seen_exact", "independent", None, "seen"),          # a seen question is not a shown solution
    (obs(), "same_family", "independent", None, "seen"),
    (obs(), "unknown", "independent", None, "unknown"),          # unknown exposure is reported, it does not change the state
    (obs(), None, "independent", None, "unknown"),
    (obs(outcome="partial"), "unseen", "independent", None, "unseen"),   # the state is about help, never about how well it went
    (obs(outcome="not_demonstrated"), "seen_exact", "independent", None, "seen"),
    (obs(assistance="solution_shown"), "unseen", "assisted", "solution_shown", "unseen"),
    (obs(assistance="solution_shown"), "seen_exact", "assisted", "solution_shown", "seen"),
    (obs(assistance="hint"), "unseen", "assisted", "hint", "unseen"),
    (obs(assistance="formula_provided"), "unseen", "assisted", "formula_provided", "unseen"),
    (obs(assistance="worked_example"), "unseen", "assisted", "worked_example", "unseen"),
    (obs(assistance="mixed"), "unknown", "assisted", "mixed", "unknown"),
    (obs(reference="notes"), "unseen", "assisted", "reference_notes", "unseen"),
    (obs(assistance="hint", reference="notes"), "unseen", "assisted", "hint", "unseen"),
    (obs(assistance="unknown"), "unseen", "unknown", None, "unseen"),
    (obs(reference="unknown"), "unseen", "unknown", None, "unseen"),
    (obs(assistance=None, reference=None), "unseen", "unknown", None, "unseen"),
    (obs(assistance="solution_shown", reference="unknown"), "unknown", "assisted", "solution_shown", "unknown"),   # known help outranks what is unknown
    (obs(outcome="not_observed"), "unseen", "not_separately_observed", None, "unseen"),
    (obs(outcome="not_observed", assistance="solution_shown"), "seen_exact", "not_separately_observed", None, "seen"),   # never assisted
    (obs(outcome="not_observed", assistance="unknown", reference="unknown"), "unknown", "not_separately_observed", None, "unknown"),   # never unknown
])
def test_each_observation_has_one_of_five_states_with_prior_exposure_beside_it(observation, exposure, state, assistance, prior):
    result = observation_state(observation, att("a1", "2026-09-01T10:00:00Z", [observation], exposure=exposure))
    assert result == {"state": state, "assistance": assistance, "prior_exposure": prior}
    assert result["state"] in EVIDENCE_STATES and set(EVIDENCE_STATES) == {"unknown", "not_applicable", "not_separately_observed", "assisted", "independent"}


def test_prior_exposure_alone_is_never_assistance_and_the_r1_condition_keeps_its_definition():
    seen = att("a1", "2026-09-01T10:00:00Z", [obs()], exposure="seen_exact")
    new = observation_state(seen["observations"][0], seen)
    assert new["state"] == "independent" and new["assistance"] is None and new["prior_exposure"] == "seen"
    old = condition_of(seen["observations"][0], seen)  # R1-F1 is untouched: prior exposure still does not qualify as unaided there
    assert old["condition"] == "prior_exposure" and old["qualifying_unaided"] is False and old["prior_exposure"] == "seen_exact"
    supplied = att("a2", "2026-09-02T10:00:00Z", [obs(assistance="solution_shown")], exposure="unseen")
    assert observation_state(supplied["observations"][0], supplied)["state"] == "assisted"  # a solution actually supplied stays assisted
    assert condition_of(obs(), att("a3", "2026-09-03T10:00:00Z", [obs()]))["qualifying_unaided"] is True


# ---- one question ----------------------------------------------------------------------------------------------
def test_a_question_nobody_attempted_is_unknown_not_zero_and_not_a_failure():
    assert question_evidence(records(), "Q1") == {"state": "unknown", "assistance": None, "prior_exposure": "unknown", "attempts": 0, "last_at": None}
    other = records(att("a1", "2026-09-01T10:00:00Z", [obs()], question_id="Q2"))
    assert question_evidence(other, "Q1")["state"] == "unknown" and question_evidence(other, "Q1")["attempts"] == 0


def test_a_question_takes_the_state_of_its_latest_assessed_attempt_and_counts_each_attempt_once():
    recs = records(att("a1", "2026-09-01T10:00:00Z", [obs(assistance="solution_shown"), obs("s.pump.size", assistance="solution_shown")], question_id="Q1"),
                   att("a2", "2026-09-20T15:00:00Z", [obs(), obs("s.pump.size", outcome="partial")], question_id="Q1", exposure="seen_exact"))
    assert question_evidence(recs, "Q1") == {"state": "independent", "assistance": None, "prior_exposure": "seen", "attempts": 2, "last_at": "2026-09-20T15:00:00Z"}
    earlier_only = records(recs["attempts"]["a1"])
    assert question_evidence(earlier_only, "Q1") == {"state": "assisted", "assistance": "solution_shown", "prior_exposure": "unseen", "attempts": 1, "last_at": "2026-09-01T10:00:00Z"}
    assert set(question_evidence(recs, "Q1")) == QUESTION_KEYS


def test_an_attempt_claims_no_more_independence_than_its_least_certain_observation():
    helped = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size", assistance="hint")], question_id="Q1"))
    assert question_evidence(helped, "Q1")["state"] == "assisted" and question_evidence(helped, "Q1")["assistance"] == "hint"
    unsure = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size", assistance="unknown")], question_id="Q1"))
    assert question_evidence(unsure, "Q1")["state"] == "unknown"
    two_kinds = records(att("a1", "2026-09-01T10:00:00Z", [obs(assistance="hint"), obs("s.pump.size", assistance="formula_provided")], question_id="Q1"))
    assert question_evidence(two_kinds, "Q1")["assistance"] == "mixed"
    part = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size", outcome="not_observed", assistance="hint")], question_id="Q1"))
    assert question_evidence(part, "Q1")["state"] == "independent"  # the skill that was not observed says nothing about the one that was


def test_receiving_an_answer_or_asking_for_help_is_not_an_assessment_and_erases_nothing():
    first = att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size")], question_id="Q1")
    before = question_evidence(records(first), "Q1")
    assert before == {"state": "independent", "assistance": None, "prior_exposure": "unseen", "attempts": 1, "last_at": "2026-09-01T10:00:00Z"}
    # a later exchange in which the answer was given: nothing was observed, whatever help was recorded with it
    answer_given = att("a2", "2026-09-10T10:00:00Z", [obs(outcome="not_observed", assistance="solution_shown"), obs("s.pump.size", outcome="not_observed", assistance="solution_shown")],
                       question_id="Q1", exposure="seen_exact")
    # and a request for help that carries no observation at all
    help_request = att("a3", "2026-09-11T10:00:00Z", [], question_id="Q1", exposure="seen_exact")
    after = records(first, answer_given, help_request)
    assert question_evidence(after, "Q1") == before
    node = node_evidence(after, model(), "s.valve.explain")
    assert {k: node[k] for k in NODE_KEYS} == {"state": "independent", "assistance": None, "prior_exposure": "unseen", "attempts": 1}
    assert node["summary"]["independent"] == 1 and node["summary"]["not_separately_observed"] == 1 and node["summary"]["assisted"] == 0
    assert [o["outcome"] for o in node["observations"]] == ["not_observed", "demonstrated"]  # the earlier record is still there, newest first
    assert "fail" not in json.dumps(node).lower()


def test_a_regrade_is_the_same_performance_and_a_new_response_is_another(be505):
    recs = read_attempt_records(be505, "be505")  # the synthetic fixture course: Q01 answered twice, Q03 answered once and regraded
    assert question_evidence(recs, "BE505-L01-Q03")["attempts"] == 1 and question_evidence(recs, "BE505-L01-Q01")["attempts"] == 2
    rows = [r for r in evidence_rows(recs) if r["attempt_id"] == "be505-20260907-l01-q03-assisted-03"]
    assert len(rows) == 3 and {r["skill_id"]: r["outcome"] for r in rows}["be505.skill.ori-vs-promoter.integrate"] == "partial"  # the regraded outcome, once
    assert question_evidence(recs, "BE505-L01-Q01") == {"state": "independent", "assistance": None, "prior_exposure": "seen", "attempts": 2, "last_at": "2026-09-06T15:00:00+00:00"}
    assert question_evidence(recs, "BE505-L01-Q03")["state"] == "assisted" and question_evidence(recs, "BE505-L01-Q03")["assistance"] == "hint"
    assert question_evidence(recs, "BE505-PS01-Q01")["state"] == "unknown" and question_evidence(recs, "BE505-PS01-Q01")["attempts"] == 1


# ---- skills, concepts, topics, criteria ---------------------------------------------------------------------------
def test_a_skill_an_assessment_did_not_separately_observe_is_exactly_that():
    recs = records(att("a1", "2026-09-01T10:00:00Z", [obs(assistance="hint"), obs("s.pump.size", outcome="not_observed", assistance="hint")], question_id="Q1"))
    pump = node_evidence(recs, model(), "s.pump.size")
    assert {k: pump[k] for k in NODE_KEYS} == {"state": "not_separately_observed", "assistance": None, "prior_exposure": "unseen", "attempts": 0}
    assert pump["summary"] == {"independent": 0, "assisted": 0, "not_separately_observed": 1, "unknown": 0, "observations": 1, "attempts": 0, "unit": "observation"}
    assert node_evidence(recs, model(), "c.pump")["state"] == "not_separately_observed"   # the concept is read through its skill
    assert node_evidence(recs, model(), "s.loop.tune")["state"] == "unknown"              # nothing recorded at all is a different state
    assert node_evidence(recs, model(), "s.valve.explain")["state"] == "assisted"


def test_five_states_come_out_of_five_synthetic_situations():
    recs = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size", outcome="not_observed")], question_id="Q1", exposure="seen_exact"),
                   att("a2", "2026-09-02T10:00:00Z", [obs("s.loop.tune", assistance="solution_shown")], question_id="Q3"))
    m = model()
    states = {node: node_evidence(recs, m, node)["state"] for node in ("s.valve.explain", "s.pump.size", "s.loop.tune", "t.empty", "Q2")}
    assert states == {"s.valve.explain": "independent", "s.pump.size": "not_separately_observed", "s.loop.tune": "assisted", "t.empty": "not_applicable", "Q2": "unknown"}
    assert len(set(states.values())) == 5
    assert node_evidence(recs, m, "c.bare")["state"] == "not_applicable"   # a concept no skill and no criterion is bound to: nothing to assess
    assert node_evidence(recs, m, "s.valve.explain")["prior_exposure"] == "seen" and node_evidence(recs, m, "s.loop.tune")["assistance"] == "solution_shown"


def test_concept_topic_and_question_nodes_follow_the_catalog_joins_and_count_each_observation_once():
    recs = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size", assistance="hint")], question_id="Q1"),
                   att("a2", "2026-09-05T10:00:00Z", [obs(assistance="unknown")], question_id="Q2"),
                   att("a3", "2026-09-07T10:00:00Z", [obs("s.loop.tune")]))   # an attempt recorded for a family only, with no question id
    m = model()
    valve = node_evidence(recs, m, "c.valve")
    assert valve["state"] == "unknown" and valve["attempts"] == 2 and valve["last_at"] == "2026-09-05T10:00:00Z"   # the latest attempt's conditions were not recorded
    assert valve["summary"] == {"independent": 1, "assisted": 0, "not_separately_observed": 0, "unknown": 1, "observations": 2, "attempts": 2, "unit": "observation"}
    flow = node_evidence(recs, m, "t.flow")   # the valve skill and the pump skill; a1 carries one observation of each
    assert flow["summary"]["observations"] == 3 and flow["summary"]["attempts"] == 2 and flow["summary"]["assisted"] == 1
    assert [(o["attempt_id"], o["skill_id"]) for o in flow["observations"]] == [("a2", "s.valve.explain"), ("a1", "s.pump.size"), ("a1", "s.valve.explain")]
    assert all(set(o) == OBSERVATION_KEYS for o in flow["observations"])
    control = node_evidence(recs, m, "t.control")
    assert control["state"] == "independent" and control["observations"][0]["question_id"] is None
    # a topic is read through what the outline lists under it: the valve concept sits under both topics, so its skill counts under both
    assert [(o["attempt_id"], o["skill_id"]) for o in control["observations"]] == [("a3", "s.loop.tune"), ("a2", "s.valve.explain"), ("a1", "s.valve.explain")]
    assert control["summary"] == {"independent": 2, "assisted": 0, "not_separately_observed": 0, "unknown": 1, "observations": 3, "attempts": 3, "unit": "observation"}
    question = node_evidence(recs, m, "Q1")
    assert question["state"] == "assisted" and question["summary"]["observations"] == 2 and question["attempts"] == 1
    assert node_evidence(recs, m, "Q3")["state"] == "unknown"   # the family-only attempt is no performance on this question


def test_listing_a_criterion_is_not_having_assessed_it():
    recs = records(att("a1", "2026-09-01T10:00:00Z", [obs(), obs("s.pump.size")], question_id="Q1"))
    m = model()
    criterion = node_evidence(recs, m, "Q1.C01")
    assert {k: criterion[k] for k in NODE_KEYS} == {"state": "not_separately_observed", "assistance": None, "prior_exposure": "unseen", "attempts": 0}
    assert criterion["summary"]["not_separately_observed"] == 1 and criterion["summary"]["independent"] == 0 and criterion["summary"]["observations"] == 1
    assert criterion["observations"][0]["state"] == "not_separately_observed" and criterion["observations"][0]["skill_id"] == "s.valve.explain"
    assert node_evidence(recs, m, "Q2.C01")["state"] == "unknown"   # same skill, but its own question was never attempted
    separately = records(att("a2", "2026-09-03T10:00:00Z", [obs(criterion_id="Q2.C01", assistance="hint")], question_id="Q2"))
    assert node_evidence(separately, m, "Q2.C01")["state"] == "assisted" and node_evidence(separately, m, "Q2.C01")["attempts"] == 1


def test_summaries_are_counts_with_their_denominators_and_nothing_expresses_mastery_or_probability(be505, settings):
    from lecture_brain.ownerio.catalogs import read_families, read_question_index, read_skills
    from lecture_brain.ownerio.inventory import build_inventory
    from lecture_brain.ownerio.question_links import build_question_bank

    index = read_question_index(be505, "be505")
    catalogs = {"skills": read_skills(be505, "be505"), "families": read_families(be505, "be505"), "questions": index}
    m = OutlineModel(catalogs, build_question_bank(index, build_inventory(settings.course("be505"))))
    reader = EvidenceReader(read_attempt_records(be505, "be505"), m)
    documents = []
    for table in (m.topics, m.concepts, m.skills, m.questions, m.criteria):
        for node_id in table:
            full = reader.node(node_id)
            summary = full["summary"]
            assert summary["independent"] + summary["assisted"] + summary["not_separately_observed"] + summary["unknown"] == summary["observations"] and summary["unit"] == "observation"
            assert summary["observations"] == len(full["observations"]) and summary["attempts"] == full["attempts"]
            assert full["state"] in EVIDENCE_STATES and reader.compact(node_id) == {k: full[k] for k in NODE_KEYS}
            assert (full["assistance"] is not None) == (full["state"] == "assisted")
            documents.append(full)
    for question_id in m.questions:
        assert set(reader.question(question_id)) == QUESTION_KEYS
        documents.append(reader.question(question_id))
    text = json.dumps(documents).lower()
    for word in ("mastery", "probab", "percent", "%", "score", "likelihood", "weak", "strength", "confidence"):
        assert word not in text
    # what the fixture's four attempts support, and no more
    assert reader.node("be505.skill.promoter.explain")["state"] == "not_separately_observed" and reader.node("be505.skill.promoter.explain")["attempts"] == 0
    origin = reader.node("be505.concept.origin-of-replication")
    assert (origin["state"], origin["assistance"], origin["attempts"]) == ("assisted", "hint", 3) and origin["summary"]["independent"] == 2
    assert reader.node("be505.concept.inducible-promoter")["state"] == "unknown" and reader.node("be505.skill.selection.interpret")["state"] == "unknown"
    assert reader.node("be505.skill.selection.interpret")["attempts"] == 1 and reader.node("be505.concept.inducible-promoter")["attempts"] == 0


# ---- revision ------------------------------------------------------------------------------------------------------
def test_the_evidence_revision_changes_only_when_a_record_does():
    a1 = att("a1", "2026-09-01T10:00:00Z", [obs()], question_id="Q1")
    a2 = att("a2", "2026-09-02T10:00:00Z", [obs()], question_id="Q2")
    base = evidence_revision(records(a1, a2))
    assert base == evidence_revision(records(a2, a1)) and len(base) == 16 and int(base, 16) >= 0   # order of reading does not matter
    assert evidence_revision(records(a1)) != base and evidence_revision(records()) != base
    regraded = records(a1, a2, regrades=[("r1", "a1", "2026-09-03T10:00:00Z", [obs(outcome="partial")])])
    assert evidence_revision(regraded) != base
    assert EvidenceReader(records(a1, a2)).revision == base
    assert ev.EVIDENCE_STATES_VERSION == "evidence-states/1"


def test_the_revision_follows_the_bytes_of_the_owner_records(be505):
    recs = read_attempt_records(be505, "be505")
    first = evidence_revision(recs)
    assert first == evidence_revision(read_attempt_records(be505, "be505"))
    path = be505 / "learning" / "attempts" / "2026-09" / "be505-20260909-ps01-q01-04.json"
    before = path.read_bytes()
    path.write_bytes(before.replace(b"Growth means the gene works.", b"Growth means the plasmid is there."))
    assert evidence_revision(read_attempt_records(be505, "be505")) != first
