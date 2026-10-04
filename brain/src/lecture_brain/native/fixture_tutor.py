"""LABELED TEST DOUBLE for the native tutor — fixture profile only.

This is not a tutor and not a model. It produces deterministic, clearly marked synthetic replies
from the task spec so the whole pipeline (capture → dispatch → result → publication → views) can be
exercised without any native runtime. Its output can never satisfy a live acceptance check, and
every reply text starts with a visible fixture banner. Failure modes are selectable so that the
UI's blocked/uncertain/quota/auth states can be driven for real.
"""
from __future__ import annotations

import json
import re
from typing import Any

from . import NativeObservation, NativeSubmission

BANNER = "**[Fixture tutor — synthetic test reply, not a real tutor and not real feedback]**"
MODES = ("normal", "fail", "completion_unknown", "quota_wait", "auth_required", "approval_pending", "malformed")
_SPEC = re.compile(r"TASK_SPEC_JSON\s*```json\s*(\{.*?\})\s*```", re.DOTALL)
_WORD = re.compile(r"[a-z]{5,}")


def _keywords(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def _grade(response: str, observable: str) -> tuple[str, list[str]]:
    """Keyword-overlap heuristic. A stand-in so mechanics can be tested — not an assessment method."""
    if len(response.strip()) < 15:
        return "uncertain", []
    wanted = _keywords(observable)
    if not wanted:
        return "uncertain", []
    ratio = len(wanted & _keywords(response)) / len(wanted)
    if ratio >= 0.5:
        return "demonstrated", []
    if ratio >= 0.25:
        return "partial", [f"Fixture heuristic: criterion wording only partly present ({ratio:.0%})."]
    return "not_demonstrated", ["Fixture heuristic: criterion wording not found in the response."]


def synthesize(spec: dict[str, Any]) -> dict[str, Any]:
    readable = [s for s in spec.get("sources", []) if s.get("text")]
    used = [s["index"] for s in readable[:2]]
    quote = " ".join(readable[0]["text"].split())[:280] if readable else "no readable source text was supplied"
    action = spec["action"]
    out: dict[str, Any] = {"sources_used": used, "uncertainty": "Fixture output: content is synthetic and unreviewed.", "assessment": None, "diagnostic": None}
    if action == "ask":
        depth_note = {"quick": "Short version", "standard": "Explanation", "deep": "Longer explanation"}[spec["depth"]]
        out["reply_markdown"] = f"{BANNER}\n\n{depth_note} for: *{spec.get('question', '')[:200]}*\n\nFrom the pinned source: {quote}"
        return out
    response = spec.get("learner_response") or ""
    if action == "diagnose":
        limit_reached = spec.get("followups_used", 0) >= spec.get("followups_limit", 2)
        out["reply_markdown"] = f"{BANNER}\n\nObserved in your response: \"{response[:160]}\". Possible causes are listed as hypotheses, not conclusions."
        out["diagnostic"] = {
            "hypotheses": [{"statement": "The two processes on this slide may be merged into one idea.", "supporting": "Fixture: based on the wording of the response only.",
                            "alternative_causes": ["The question wording was read differently.", "The earlier tutor explanation was unclear."]}],
            "next_prompt": None if limit_reached else "In one sentence: what would still happen to the plasmid if the promoter were removed?",
        }
        return out
    if not spec.get("expect_assessment"):
        out["reply_markdown"] = f"{BANNER}\n\nNo reviewed rubric is bound to this response, so it was not assessed. Your explanation is retained."
        return out
    observations, lines = [], []
    for criterion in spec.get("rubric", []):
        outcome, missing = _grade(response, criterion["observable"])
        observations.append({"skill_id": criterion["skill_id"], "outcome": outcome, "analysis": f"Fixture heuristic comparison with the criterion: {criterion['observable']}",
                             "missing_or_incorrect": missing, "error_types": ["concept"] if outcome in {"partial", "not_demonstrated"} else [],
                             "assessment_confidence": "low"})
        lines.append(f"- `{criterion['skill_id']}`: **{outcome.replace('_', ' ')}**")
    merged: dict[str, dict] = {}
    for obs in observations:  # one observation per intended skill
        merged.setdefault(obs["skill_id"], obs)
    verb = "Regrade" if action == "correct_assessment" else "Feedback"
    out["reply_markdown"] = f"{BANNER}\n\n{verb} against the criteria (keyword heuristic, low confidence):\n" + "\n".join(lines)
    out["assessment"] = {"observations": list(merged.values())}
    if spec.get("expect_diagnostic") and any(o["outcome"] in {"partial", "not_demonstrated"} for o in merged.values()):
        out["diagnostic"] = {
            "hypotheses": [{"statement": "Part of the criterion is missing from the explanation.", "supporting": "Fixture: keyword comparison only.",
                            "alternative_causes": ["The idea is understood but was not written down.", "The question wording was ambiguous."]}],
            "next_prompt": "In one sentence: what would still happen to the plasmid if the promoter were removed?",
        }
    return out


class FixtureTutorAdapter:
    name = "fixture-tutor"
    label = "Fixture tutor (labeled test double)"
    is_test_double = True

    def __init__(self, journal=None):
        self._journal = journal
        self._held: dict[str, str] = {}
        self.calls = 0

    def _mode(self) -> str:
        mode = self._journal.get_value("fixture-native-mode", "normal") if self._journal is not None else "normal"
        return mode if mode in MODES else "normal"

    def capabilities(self) -> dict[str, Any]:
        return {"adapter": self.name, "is_test_double": True, "installed": True, "configured": True, "verified": False, "mode": self._mode(),
                "reason": "Synthetic fixture adapter. It cannot satisfy native acceptance and is unavailable outside the fixture profile."}

    def _text(self, submission: NativeSubmission) -> str:
        match = _SPEC.search(submission.prompt)
        if not match:
            return json.dumps({"reply_markdown": f"{BANNER}\n\nNo task spec was found in the prompt.", "sources_used": [], "uncertainty": None, "assessment": None, "diagnostic": None})
        return json.dumps(synthesize(json.loads(match.group(1))), ensure_ascii=False)

    def submit(self, submission: NativeSubmission) -> NativeObservation:
        self.calls += 1
        mode = self._mode()
        turn = f"fixture-turn-{submission.dispatch_id}"[:128]
        if mode == "fail":
            return NativeObservation("failed", turn, None, "fixture_injected_failure")
        if mode == "quota_wait":
            return NativeObservation("quota_wait", None, None, "fixture_quota", {"retry_after_seconds": 60})
        if mode == "auth_required":
            return NativeObservation("auth_required", None, None, "fixture_auth")
        if mode == "approval_pending":
            return NativeObservation("approval_pending", turn, None, "fixture_approval", {"approval": "A native tool approval is waiting for you in the desktop app."})
        if mode == "completion_unknown":
            self._held[submission.dispatch_id] = self._text(submission)
            return NativeObservation("completion_unknown", turn, None, None, {"note": "accepted; no terminal result observed before the budget ended"})
        if mode == "malformed":
            return NativeObservation("completed", turn, f"{BANNER} plain text reply that is not the requested JSON object")
        return NativeObservation("completed", turn, self._text(submission))

    def status(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        held = self._held.pop(submission.dispatch_id, None)
        if held is not None:
            return NativeObservation("completed", native_turn_id, held)
        return NativeObservation("completion_unknown", native_turn_id)

    def interrupt(self, submission: NativeSubmission, native_turn_id: str | None) -> NativeObservation:
        self._held.pop(submission.dispatch_id, None)
        return NativeObservation("interrupted", native_turn_id)
