"""Recorded-evidence conditions and performance facets (R1-F1…F4). Read side only: nothing here writes or scores.

* A recorded demonstration is described by the condition it was recorded under. Only an observed response given with
  no assistance, no reference and no known prior exposure counts as recorded unaided performance. Unknown is unknown.
* Facets come from a versioned mapping of the catalog's own action tokens. A token that does not support a finer
  conclusion maps to no facet, and a skill with several tokens is one combined target.
* Coverage is always stated with its unit, target set, rule versions, numerator, denominator and remainder. There is
  no mastery figure, no probability and no percentage.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

CONDITIONS_VERSION = "evidence-conditions/1"
CONDITIONS = ("unaided", "assisted", "prior_exposure", "conditions_unknown")
_NONE = {"none", "none_reported"}
_UNKNOWN = {None, "", "unknown"}
_UNEXPOSED = {"unseen", "unseen_reported", "none", "no_known_exposure"}


def condition_of(observation: dict, attempt: dict) -> dict[str, Any]:
    """The condition one observation was recorded under. Known help outranks prior exposure, which outranks unknowns."""
    assistance, reference = observation.get("assistance"), observation.get("reference_access")
    exposure = (attempt.get("question") or {}).get("prior_exposure")
    helped = ([f"assistance: {assistance}"] if assistance not in _NONE | _UNKNOWN else []) + ([f"reference: {reference}"] if reference not in _NONE | _UNKNOWN else [])
    unknown = [name for name, value in (("assistance", assistance), ("reference", reference), ("prior exposure", exposure)) if value in _UNKNOWN]
    if helped:
        condition, reasons = "assisted", helped
    elif exposure not in _UNEXPOSED | _UNKNOWN:
        condition, reasons = "prior_exposure", [f"prior exposure: {exposure}"]
    elif unknown:
        condition, reasons = "conditions_unknown", [f"{name} not recorded" for name in unknown]
    else:
        condition, reasons = "unaided", []
    qualifying = condition == "unaided" and observation.get("outcome") == "demonstrated" and attempt.get("evidence_kind") == "observed_response"
    return {"condition": condition, "reasons": reasons, "prior_exposure": exposure if exposure not in {None, ""} else "unknown", "qualifying_unaided": qualifying}


def load_facet_mapping(repo: Path) -> dict[str, Any]:
    mapping = json.loads((repo / "config" / "facet-mapping.json").read_text(encoding="utf-8"))
    if mapping.get("contract") != "ll.facet-mapping/1" or not isinstance(mapping.get("mapping_version"), int):
        raise ValueError("Unsupported facet mapping")
    known = {f["facet"] for f in mapping["facets"]}
    for rule in mapping["rules"]:
        if not rule.get("rationale") or (rule["facet"] is not None and rule["facet"] not in known) or any(c not in known for c in rule.get("candidates", [])):
            raise ValueError(f"Facet rule for {rule.get('token')!r} is incomplete")
    return mapping


def facet_of(skill: dict, mapping: dict) -> dict[str, Any]:
    """Facet of one catalog skill under the mapping: a facet, or the reason there is none (unclassified, combined)."""
    tokens = [t for t in (skill.get("action_types") or []) if isinstance(t, str)]
    basis = "action_types"
    if not tokens and skill.get("ability"):
        tokens, basis = [str(skill["ability"])], "ability_field"
    base = {"tokens": tokens, "token_basis": basis if tokens else "none", "mapping_version": mapping["mapping_version"]}
    if not tokens:
        return dict(base, facet=None, state="unclassified", candidates=[], rationale="The catalog records no action for this skill.")
    if len(tokens) > 1:
        return dict(base, facet=None, state="combined", candidates=[], rationale=mapping["combined_rule"])
    rule = next((r for r in mapping["rules"] if r["token"] == tokens[0]), None)
    if rule is None:
        return dict(base, facet=None, state="unclassified", candidates=[], rationale=f"The mapping has no rule for the action {tokens[0]!r}.")
    if rule["facet"] is None:
        return dict(base, facet=None, state="unclassified", candidates=list(rule.get("candidates", [])), rationale=rule["rationale"])
    return dict(base, facet=rule["facet"], state="mapped", candidates=[], rationale=rule["rationale"])


def facet_summary(skill_rows: list[dict], mapping: dict) -> dict[str, Any]:
    """Coverage by facet over distinct skills. ``skill_rows`` carry ``facet`` (from :func:`facet_of`), ``history`` and ``latest``."""
    order = [f["facet"] for f in mapping["facets"]] + ["combined", "unclassified"]
    labels = {f["facet"]: f["label"] for f in mapping["facets"]} | {"combined": "Combined targets (not separately observed)", "unclassified": "Unclassified"}
    rows = {key: {"facet": key, "label": labels[key], "target_skills": 0, "qualifying_unaided_skills": 0, "observed_other_skills": 0, "uncertain_skills": 0, "unassessed_skills": 0,
                  "observations_by_condition": {c: 0 for c in CONDITIONS}, "observations_by_outcome": Counter()} for key in order}
    for skill in skill_rows:
        facet = skill["facet"]
        row = rows[facet["facet"] or facet["state"]]
        row["target_skills"] += 1
        observed = [e for e in skill["history"] if e["outcome"] != "not_observed"]
        for episode in observed:
            row["observations_by_condition"][episode["condition"]] += 1
            row["observations_by_outcome"][episode["outcome"]] += 1
        if any(e["qualifying_unaided"] for e in skill["history"]):
            row["qualifying_unaided_skills"] += 1
        elif not observed:
            row["unassessed_skills"] += 1
        elif observed[-1]["outcome"] == "uncertain":
            row["uncertain_skills"] += 1
        else:
            row["observed_other_skills"] += 1
    for row in rows.values():
        row["observations_by_outcome"] = dict(row["observations_by_outcome"])
    rows["coding_execution"]["note"] = ("No skill in this catalog is marked as coding or execution. " + mapping["coding_rule"]) if not rows["coding_execution"]["target_skills"] else mapping["coding_rule"]
    rows["combined"]["note"] = mapping["combined_rule"]
    rows["unclassified"]["note"] = "The catalog's action for these skills does not support a finer conclusion; see each rule's rationale."
    return {"mapping_version": mapping["mapping_version"], "conditions_version": CONDITIONS_VERSION, "unit": "skill", "target_set": "skills of this course's catalog",
            "numerator": "distinct skills with at least one observed, demonstrated response recorded with no assistance, no reference and no known prior exposure",
            "rows": [rows[key] for key in order],
            "notes": ["Counts of distinct skills and of recorded observations. No mastery figure and no exam probability is computed.",
                      "Skills and criteria are different units and are never added together.", mapping["absence_rule"]]}


# ---- evidence states (amendment R2: R2-C9, R2-C10) ----------------------------------------------------------------
# Added beside the R1 conditions above, which keep their definition (``condition_of`` and ``qualifying_unaided`` are
# not touched). The R2 state answers one question only: under what recorded help was this seen?
#
# * ``independent`` — an observation recorded with no assistance and no reference.
# * ``assisted`` — help was recorded; ``assistance`` carries the recorded kind.
# * ``unknown`` — nothing is recorded, or the help conditions of the latest record were not recorded. Not zero, not a failure.
# * ``not_separately_observed`` — an assessment covered it and did not observe it on its own (``not_observed``; a
#   criterion whose skill was observed). Never ``unknown`` and never ``assisted``.
# * ``not_applicable`` — the catalog binds nothing assessable to the node.
#
# Prior exposure (``unseen`` | ``seen`` | ``unknown``) is a separate recorded condition reported beside the state. It
# never changes the state: a seen question is not a shown solution. An exchange that carries no observation — an answer
# that was given, a request for help — is not an assessment: it adds no attempt and leaves every state as it was.
# Nothing here expresses mastery or a probability; summaries are counts beside their denominators.
EVIDENCE_STATES_VERSION = "evidence-states/1"
EVIDENCE_STATES = ("unknown", "not_applicable", "not_separately_observed", "assisted", "independent")
PRIOR_EXPOSURE_VALUES = ("unseen", "seen", "unknown")
MAX_OBSERVATIONS = 200
_PRECEDENCE = ("assisted", "unknown", "independent")  # one attempt claims no more independence than its least certain observation


def exposure_of(attempt: dict) -> str:
    """``unseen`` | ``seen`` | ``unknown`` from the attempt's own record. Any recorded earlier contact (the same question, its family) is ``seen``."""
    value = (attempt.get("question") or {}).get("prior_exposure")
    if not isinstance(value, str) or value in _UNKNOWN:
        return "unknown"
    return "unseen" if value in _UNEXPOSED else "seen"


def observation_state(observation: dict, attempt: dict) -> dict[str, Any]:
    """The R2 state of one observation: ``{state, assistance, prior_exposure}``. ``assistance`` is the recorded kind, only when assisted."""
    exposure = exposure_of(attempt)
    if observation.get("outcome") == "not_observed":
        return {"state": "not_separately_observed", "assistance": None, "prior_exposure": exposure}
    assistance, reference = (value if isinstance(value, str) else None for value in (observation.get("assistance"), observation.get("reference_access")))
    if assistance not in _NONE | _UNKNOWN:
        return {"state": "assisted", "assistance": assistance, "prior_exposure": exposure}
    if reference not in _NONE | _UNKNOWN:  # a reference that was open is help too; the kind says that it was a reference
        return {"state": "assisted", "assistance": f"reference_{reference}", "prior_exposure": exposure}
    if assistance in _UNKNOWN or reference in _UNKNOWN:
        return {"state": "unknown", "assistance": None, "prior_exposure": exposure}
    return {"state": "independent", "assistance": None, "prior_exposure": exposure}


def _instant(text: Any) -> float:
    try:
        moment = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return float("-inf")
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def evidence_rows(records: dict) -> list[dict[str, Any]]:
    """One row per EFFECTIVE observation, newest attempt first. A regrade replaces the observations of its attempt, so a
    performance is listed once however often it was reassessed; an attempt without observations yields no row."""
    rows = []
    for attempt_id, attempt in (records.get("attempts") or {}).items():
        effective = (records.get("effective") or {}).get(attempt_id) or {}
        for observation in effective.get("observations", attempt.get("observations")) or []:
            rows.append({"attempt_id": attempt_id, "recorded_at": attempt.get("recorded_at"), "outcome": observation.get("outcome"), **observation_state(observation, attempt),
                         "question_id": (attempt.get("question") or {}).get("question_id"), "skill_id": observation.get("skill_id"), "criterion_id": observation.get("criterion_id")})
    rows.sort(key=lambda row: str(row["skill_id"] or ""))
    rows.sort(key=lambda row: (_instant(row["recorded_at"]), row["attempt_id"]), reverse=True)
    return rows


def evidence_revision(records: dict) -> str:
    """Digest of the attempt and regrade records a view was built from. It changes when a record is added or its bytes change, and with nothing else."""
    lines = []
    for kind in ("attempts", "revisions"):
        for record_id, record in (records.get(kind) or {}).items():
            digest = record.get("_sha256") or hashlib.sha256(json.dumps({k: v for k, v in record.items() if not str(k).startswith("_")}, sort_keys=True, ensure_ascii=False,
                                                                        default=str).encode("utf-8")).hexdigest()
            lines.append(f"{kind}\0{record_id}\0{digest}")
    return hashlib.sha256("\n".join(sorted(lines)).encode("utf-8")).hexdigest()[:16]


def _summarise(rows: list[dict]) -> dict[str, Any]:
    """State and counts of a set of rows (newest first). The state is that of the latest attempt that separately observed anything."""
    counts = Counter(row["state"] for row in rows)
    observed = [row for row in rows if row["state"] != "not_separately_observed"]
    out: dict[str, Any] = {"state": "unknown", "assistance": None, "prior_exposure": "unknown", "attempts": len({row["attempt_id"] for row in observed}), "last_at": None}
    if observed:
        latest = [row for row in observed if row["attempt_id"] == observed[0]["attempt_id"]]
        state = next(s for s in _PRECEDENCE if any(row["state"] == s for row in latest))
        kinds = sorted({row["assistance"] for row in latest if row["state"] == "assisted"})
        out.update(state=state, assistance=(kinds[0] if len(kinds) == 1 else "mixed") if state == "assisted" else None, prior_exposure=latest[0]["prior_exposure"],
                   last_at=latest[0]["recorded_at"])
    elif rows:
        out.update(state="not_separately_observed", prior_exposure=rows[0]["prior_exposure"])
    out["summary"] = {"independent": counts["independent"], "assisted": counts["assisted"], "not_separately_observed": counts["not_separately_observed"], "unknown": counts["unknown"],
                      "observations": len(rows), "attempts": out["attempts"], "unit": "observation"}
    return out


def skills_under(model: Any, node_id: str) -> set[str]:
    """The skills a node stands for. For a topic: what the outline lists under it — the skills of its concepts, and the
    skills filed under it that have no catalogued concept — so a concept under two topics brings its skills to both."""
    if model.kind_of(node_id) != "topic":
        return set(model.skills_of(node_id))
    concepts = {c for c, concept in model.concepts.items() if node_id in (concept.get("topic_ids") or [])}
    return {s for s, skill in model.skills.items() if skill.get("concept_id") in concepts or (skill.get("concept_id") not in model.concepts and node_id in (skill.get("topic_ids") or []))}


class EvidenceReader:
    """Evidence states of questions and catalog nodes over one read of the attempt records.

    ``question`` needs no catalog. ``node`` and ``compact`` need the ``OutlineModel`` whose joins they follow: a skill
    by its observations, a concept through its skills, a topic through the skills the outline lists under it, a
    question through the attempts made on it, a criterion through observations of the criterion itself — and, where
    there are none, as not separately observed when its question was attempted and its skill observed.
    """

    def __init__(self, records: dict, model: Any = None) -> None:
        self.rows = evidence_rows(records)
        self.revision = evidence_revision(records)
        self._model = model
        self._by_question: dict[str, list[dict]] = {}
        self._by_criterion: dict[str, list[dict]] = {}
        for row in self.rows:
            if row["question_id"]:
                self._by_question.setdefault(row["question_id"], []).append(row)
            if row["criterion_id"]:
                self._by_criterion.setdefault(row["criterion_id"], []).append(row)

    def question(self, question_id: str) -> dict[str, Any]:
        """``{state, assistance, prior_exposure, attempts, last_at}`` of one question: attempts recorded on this question only."""
        summary = _summarise(self._by_question.get(question_id, []))
        return {key: summary[key] for key in ("state", "assistance", "prior_exposure", "attempts", "last_at")}

    def _rows_of(self, node_id: str) -> tuple[list[dict], bool]:
        model = self._model
        if model is None:
            raise ValueError("node evidence needs the catalog model")
        kind = model.kind_of(node_id)
        if kind is None:
            raise ValueError(f"Unknown catalog object {node_id!r}")
        if kind == "question":
            return self._by_question.get(node_id, []), True
        if kind == "criterion":
            if self._by_criterion.get(node_id):
                return self._by_criterion[node_id], True
            criterion = model.criteria[node_id]  # the catalog lists it; no record observes it on its own
            return [dict(row, state="not_separately_observed", assistance=None) for row in self._by_question.get(criterion["question_id"], [])
                    if row["skill_id"] and row["skill_id"] == criterion["skill_id"]], True
        skills = skills_under(model, node_id)
        return [row for row in self.rows if row["skill_id"] in skills], bool(skills) or bool(model.questions_of(node_id))

    def node(self, node_id: str) -> dict[str, Any]:
        """Full evidence of one node: the state with its conditions, every observation once, and counts with their denominators."""
        rows, applicable = self._rows_of(node_id)
        out = _summarise(rows)
        if not applicable:
            out["state"] = "not_applicable"
        out["observations"] = [{key: value for key, value in row.items() if key != "criterion_id"} for row in rows[:MAX_OBSERVATIONS]]  # ``summary.observations`` is the full count
        return {key: out[key] for key in ("state", "assistance", "prior_exposure", "attempts", "last_at", "observations", "summary")}

    def compact(self, node_id: str) -> dict[str, Any]:
        """``{state, assistance, prior_exposure, attempts}`` — the form a graph node carries."""
        rows, applicable = self._rows_of(node_id)
        summary = _summarise(rows)
        return {"state": summary["state"] if applicable else "not_applicable", "assistance": summary["assistance"], "prior_exposure": summary["prior_exposure"], "attempts": summary["attempts"]}


def question_evidence(records: dict, question_id: str) -> dict[str, Any]:
    return EvidenceReader(records).question(question_id)


def node_evidence(records: dict, model: Any, node_id: str) -> dict[str, Any]:
    return EvidenceReader(records, model).node(node_id)
