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
