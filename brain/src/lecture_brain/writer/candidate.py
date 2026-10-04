"""Build and pre-check course-learning-v1 candidates from captured submissions.

The existing academic schema is not changed or extended here. New sidecar fields are mapped
explicitly onto the owner's existing enums (see the tables below); they are never copied across
by label. Pre-checks mirror the owner validator's documented cross-field rules so that an invalid
candidate is blocked before any writer is invoked — the owner's own validation still applies.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import re
from typing import Any

OUTCOMES = {"demonstrated", "partial", "not_demonstrated", "not_observed", "uncertain"}
ERROR_TYPES = {"concept", "formula_recall", "method_selection", "algebra", "arithmetic", "units", "notation", "implementation", "interpretation", "source_uncertainty", "other"}
CONFIDENCE = {"low", "medium", "high"}
_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

# Sidecar (ll.submission/1) → owner (course-learning-v1) vocabulary. Explicit, reviewed mappings.
ASSISTANCE = {"none_reported": "none", "hint": "hint", "formula": "formula_provided", "worked_solution": "solution_shown", "unknown": "unknown"}
REFERENCE_ACCESS = {"none_reported": "none", "notes": "notes", "sources": "notes", "unknown": "unknown"}
PRIOR_EXPOSURE = {"unseen_reported": "unseen", "seen_question": "seen_exact", "seen_solution": "seen_exact", "unknown": "unknown"}
#: A client-reported time counts as "now" only within this window before the Brain records it.
RECORDED_NOW_TOLERANCE = timedelta(minutes=15)


class CandidateError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _dt(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def map_time(submission: dict, recorded_at: str) -> tuple[str | None, str]:
    """(occurred_at, time_basis) in the owner's terms.

    ``recorded_now`` requires a non-null occurrence not after the record time; approximate and
    unknown bases require null. A delayed or learner-reported time is never upgraded to exact: the
    client value stays in the sidecar, the owner record keeps ``occurred_at: null``.
    """
    basis, occurred = submission["time_basis"], submission["occurred_at"]
    if basis == "client_reported" and occurred is not None:
        delta = _dt(recorded_at) - _dt(occurred)
        if timedelta(0) <= delta <= RECORDED_NOW_TOLERANCE:
            return recorded_at, "recorded_now"
        return None, "historical_approximate"
    if basis == "learner_reported":
        return None, "historical_approximate"
    return None, "unknown"


def map_mode(submission: dict) -> str:
    """Existing canonical mode. UI interaction kind and reply depth stay separate metadata."""
    if submission["interaction"] == "review_answer":
        return "maintain"
    unaided = submission["conditions"]["assistance_before_answer"] == "none_reported"
    return "assess" if unaided else "learn"


def capture_locator(capture: dict, turn_id: str) -> str:
    return f"Lecture Learning capture {capture['path']} sha256:{capture['sha256']} bytes:{capture['bytes']} turn:{turn_id}"


def excerpt_of(text: str, limit: int = 600) -> str:
    """A short exact prefix of the response (the full text lives in the verified sidecar)."""
    return text if len(text) <= limit else text[:limit]


def build_attempt_candidate(*, submission: dict, capture: dict, attempt_id: str, recorded_at: str, observations: list[dict], review_suggestion: dict | None = None) -> dict:
    question = submission["question"]
    if question["family_id"] is None:
        raise CandidateError("family_missing", "no question family/rubric is bound to this response; it stays captured as assessment pending")
    occurred_at, time_basis = map_time(submission, recorded_at)
    conditions = submission["conditions"]
    record: dict[str, Any] = {
        "contract_version": "course-learning-v1", "course_id": submission["scope"]["course_id"], "term": submission["scope"]["term"], "record_kind": "attempt",
        "attempt_id": attempt_id, "session_id": submission["session_id"], "recorded_at": recorded_at, "occurred_at": occurred_at, "time_basis": time_basis,
        "mode": map_mode(submission), "evidence_kind": "observed_response", "assessor": "agent", "user_confidence": None,
        "question": {"family_id": question["family_id"], "family_revision": question["family_revision"], "prompt": question["prompt"],
                     "prior_exposure": PRIOR_EXPOSURE[conditions["prior_exposure"]]},
        "response_evidence": {"locator": capture_locator(capture, submission["turn_id"]), "excerpt": excerpt_of(submission["response"]["text"] or "[attachment response; see capture]")},
        "observations": observations,
    }
    if question["question_id"] is not None:
        record["question"]["question_id"] = question["question_id"]
        record["question"]["question_version"] = 1
    if review_suggestion is not None:
        record["review_suggestion"] = review_suggestion
    return record


def observation(skill_id: str, outcome: str, *, submission: dict, analysis: str, missing: list[str] | None = None, error_types: list[str] | None = None,
                confidence: str = "medium") -> dict:
    """One owner-shaped observation with assistance/reference taken from the captured conditions."""
    conditions = submission["conditions"]
    return {"skill_id": skill_id, "outcome": outcome, "assistance": ASSISTANCE[conditions["assistance_before_answer"]],
            "reference_access": REFERENCE_ACCESS[conditions["reference_access"]], "analysis": analysis, "missing_or_incorrect": list(missing or []),
            "error_types": list(error_types or []), "assessment_confidence": confidence}


def serialize(record: dict) -> bytes:
    """UTF-8, LF only, no BOM — the form the owners' writers require."""
    return (json.dumps(record, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def check_observations(observations: list[dict], *, skills: dict, expected_skill_ids: set[str]) -> None:
    seen: set[str] = set()
    for obs in observations:
        sid = obs.get("skill_id")
        if sid in seen:
            raise CandidateError("invalid_candidate", f"duplicate observation for skill {sid}")
        seen.add(sid)
        if sid not in skills:
            raise CandidateError("invalid_candidate", f"observation names unknown skill {sid}")
        if obs.get("outcome") not in OUTCOMES:
            raise CandidateError("invalid_candidate", f"unknown outcome {obs.get('outcome')!r}")
        if obs.get("assessment_confidence") not in CONFIDENCE:
            raise CandidateError("invalid_candidate", "assessment_confidence must be low/medium/high")
        if set(obs.get("error_types") or []) - ERROR_TYPES:
            raise CandidateError("invalid_candidate", "unknown error type")
        if obs["outcome"] == "not_observed" and (obs.get("error_types") or obs.get("missing_or_incorrect")):
            raise CandidateError("invalid_candidate", "not_observed cannot carry errors or missing items (unobserved is not a failure)")
        if not isinstance(obs.get("analysis"), str) or not obs["analysis"].strip():
            raise CandidateError("invalid_candidate", "observation analysis is required")
    if seen != expected_skill_ids:
        raise CandidateError("invalid_candidate", "observation skill set must equal the intended family's skill set")


def check_attempt(record: dict, *, course_id: str, skills: dict, families: dict, existing_ids: set[str]) -> None:
    if "TEMPLATE_ONLY" in record:
        raise CandidateError("invalid_candidate", "template records are never live evidence")
    if record.get("course_id") != course_id or record.get("term") != "2026-fall" or record.get("contract_version") != "course-learning-v1":
        raise CandidateError("invalid_candidate", "candidate identity does not match the bound course")
    attempt_id = record.get("attempt_id", "")
    if not _ID.match(attempt_id):
        raise CandidateError("invalid_candidate", "attempt id is not a valid owner id")
    if attempt_id in existing_ids:
        raise CandidateError("id_in_use", "this id already names another record")
    key = (record["question"]["family_id"], record["question"]["family_revision"])
    family = families.get(key)
    if family is None:
        raise CandidateError("family_missing", f"question family {key[0]} revision {key[1]} is not in the owner catalog")
    check_observations(record["observations"], skills=skills, expected_skill_ids=set(family["skill_ids"]))
    recorded = _dt(record["recorded_at"])
    if recorded.tzinfo is None:
        raise CandidateError("invalid_candidate", "recorded_at must be timezone-aware")
    if record["time_basis"] in {"recorded_now", "historical_exact"}:
        if record["occurred_at"] is None or _dt(record["occurred_at"]) > recorded:
            raise CandidateError("invalid_candidate", "exact timing needs occurred_at not after recorded_at")
    elif record["occurred_at"] is not None:
        raise CandidateError("invalid_candidate", "approximate/unknown timing must keep occurred_at null")
    suggestion = record.get("review_suggestion")
    if suggestion and not set(suggestion["skill_ids"]) <= {o["skill_id"] for o in record["observations"]}:
        raise CandidateError("invalid_candidate", "review suggestion names skills that were not observed")
    for key_name in ("locator", "excerpt"):
        if not isinstance(record["response_evidence"].get(key_name), str) or not record["response_evidence"][key_name]:
            raise CandidateError("invalid_candidate", f"response_evidence.{key_name} is required")


def month_of(recorded_at: str) -> str:
    return _dt(recorded_at).strftime("%Y-%m")
