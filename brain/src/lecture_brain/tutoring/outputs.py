"""Parse and bound the tutor's structured reply.

The native tutor is asked to answer with one JSON object (internal shape ``ll.tutor-output/1``).
A syntactically valid reply is not certified teaching accuracy; this module only guarantees that
what the app stores and shows is what was returned, that an assessment is accepted only for an
actual submitted response and only for the intended skills, and that malformed output degrades
to "answer text available, assessment unavailable" instead of an invented grade.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any

from ..writer.candidate import CONFIDENCE, ERROR_TYPES, OUTCOMES

MAX_REPLY_CHARS = 300_000
MAX_SEGMENTS = 200
SUPPORT_KINDS = ("course_source", "added_explanation")
NOT_SUPPLIED = "the reply cited a source that was not supplied; that citation was dropped"
_FENCE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


@dataclass
class TutorOutput:
    reply_markdown: str
    structured: bool
    observations: list[dict] | None = None
    diagnostic: dict | None = None
    uncertainty: str | None = None
    sources_used: list[int] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    # The reply as ordered parts, each marked as stated by a supplied course source or as the tutor's added explanation.
    # None (and support_itemized False) when the reply was not itemized: one citation on a reply does not support every sentence in it.
    segments: list[dict] | None = None
    support_itemized: bool = False


def _extract_object(text: str) -> dict | None:
    candidate = text.strip()
    match = _FENCE.search(candidate)
    if match:
        candidate = match.group(1)
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _valid_index(value: Any, max_sources: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < max_sources


def _read_segments(raw: Any, max_sources: int) -> tuple[list[dict], bool, int] | None:
    """(parts, a citation was dropped, parts downgraded), or None when ``raw`` is not a usable list of parts.

    A part counts as course-supported only with at least one index of a source that was actually supplied; otherwise
    it is an added explanation. An added explanation carries no citation. The wording of a part is never changed.
    """
    if not isinstance(raw, list) or not raw or len(raw) > MAX_SEGMENTS:
        return None
    parts, dropped, downgraded = [], False, 0
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str) or not item["text"].strip() or item.get("support") not in SUPPORT_KINDS:
            return None
        listed = item.get("sources") or []
        if not isinstance(listed, list):
            return None
        support, valid = item["support"], []
        if support == "course_source":
            valid = sorted({i for i in listed if _valid_index(i, max_sources)})
            dropped = dropped or any(not _valid_index(i, max_sources) for i in listed)
            if not valid:
                support, downgraded = "added_explanation", downgraded + 1
        parts.append({"text": item["text"].strip(), "support": support, "sources": valid})
    return parts, dropped, downgraded


def _squash(text: str) -> str:
    return "".join(text.split())


def parse_tutor_output(text: str, *, expect_assessment: bool, intended_skill_ids: list[str], max_sources: int) -> TutorOutput:
    data = _extract_object(text)
    reply = data.get("reply_markdown") if data is not None else None
    has_reply = isinstance(reply, str) and bool(reply.strip())
    itemized = _read_segments(data.get("segments"), max_sources) if data is not None else None
    if data is None or (not has_reply and itemized is None):
        # Keep the delivered text; never fabricate structure around it.
        return TutorOutput(reply_markdown=text.strip()[:MAX_REPLY_CHARS] or "(empty reply)", structured=False,
                           problems=["reply was not the requested JSON object; shown as plain text, no assessment taken from it"])
    out = TutorOutput(reply_markdown=reply[:MAX_REPLY_CHARS] if has_reply else "", structured=True)
    used = data.get("sources_used")
    if isinstance(used, list):
        out.sources_used = sorted({i for i in used if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < max_sources})
        if len(out.sources_used) != len(set(map(str, used))):
            out.problems.append(NOT_SUPPLIED)
    if itemized is not None:
        parts, dropped, downgraded = itemized
        joined = "\n\n".join(part["text"] for part in parts)
        if has_reply and _squash(joined) != _squash(reply):
            out.problems.append("the reply's itemized parts did not match its text; the reply is shown whole and support is not itemized")
        elif len(joined) > MAX_REPLY_CHARS:
            out.reply_markdown = out.reply_markdown or joined[:MAX_REPLY_CHARS]
        else:
            # The parts are the reply: what is shown is exactly the parts, in order, with nothing added to any of them.
            out.reply_markdown, out.segments, out.support_itemized = joined, parts, True
            out.sources_used = sorted(set(out.sources_used) | {i for part in parts for i in part["sources"]})
            if dropped and NOT_SUPPLIED not in out.problems:
                out.problems.append(NOT_SUPPLIED)
            if downgraded:
                out.problems.append(f"{downgraded} part(s) of the reply marked as course-supported named no supplied source; shown as added explanation")
    elif data.get("segments") not in (None, []):
        out.problems.append("the reply's support marking could not be read; support is not itemized")
    if isinstance(data.get("uncertainty"), str) and data["uncertainty"].strip():
        out.uncertainty = data["uncertainty"].strip()[:2000]
    diagnostic = data.get("diagnostic")
    if isinstance(diagnostic, dict):
        hypotheses = [
            {"statement": str(h.get("statement", ""))[:1000], "supporting": str(h.get("supporting", ""))[:1000],
             "alternative_causes": [str(a)[:500] for a in (h.get("alternative_causes") or []) if isinstance(a, str)][:5]}
            for h in (diagnostic.get("hypotheses") or []) if isinstance(h, dict) and h.get("statement")
        ][:5]
        prompt = diagnostic.get("next_prompt")
        out.diagnostic = {"hypotheses": hypotheses, "next_prompt": prompt.strip()[:4000] if isinstance(prompt, str) and prompt.strip() else None}
    assessment = data.get("assessment")
    if not expect_assessment:
        if assessment is not None:
            out.problems.append("an assessment was returned for a help request and was discarded (help is not assessed)")
        return out
    if not isinstance(assessment, dict) or not isinstance(assessment.get("observations"), list):
        out.problems.append("no usable assessment returned; the response stays captured as assessment pending")
        return out
    observations, seen = [], set()
    for raw in assessment["observations"]:
        if not isinstance(raw, dict):
            continue
        skill, outcome = raw.get("skill_id"), raw.get("outcome")
        if skill not in intended_skill_ids or skill in seen or outcome not in OUTCOMES:
            out.problems.append(f"observation for {skill!r} ignored (not an intended skill, duplicate, or unknown outcome)")
            continue
        seen.add(skill)
        errors = [e for e in (raw.get("error_types") or []) if e in ERROR_TYPES]
        missing = [str(m)[:500] for m in (raw.get("missing_or_incorrect") or []) if isinstance(m, str)][:10]
        if outcome == "not_observed":
            errors, missing = [], []  # unobserved is never an error diagnosis
        confidence = raw.get("assessment_confidence") if raw.get("assessment_confidence") in CONFIDENCE else "low"
        observations.append({"skill_id": skill, "outcome": outcome, "analysis": str(raw.get("analysis") or "No analysis text was returned.")[:4000],
                             "missing_or_incorrect": missing, "error_types": errors, "assessment_confidence": confidence})
    if {o["skill_id"] for o in observations} != set(intended_skill_ids):
        # The frozen family's skills must all be covered; a partial set cannot become a valid attempt.
        out.problems.append("assessment does not cover exactly the intended skills; kept as assessment pending")
        return out
    out.observations = observations
    return out


def output_format_instructions(*, expect_assessment: bool, expect_diagnostic: bool) -> str:
    parts = [
        "Reply with ONE JSON object and nothing else:",
        '{"reply_markdown": "<your reply to the learner in Markdown; math as $...$>",',
        ' "segments": [{"text": "<one part of that same reply>", "support": "course_source|added_explanation", "sources": [<indexes of the numbered sources that state this part>]}],',
        ' "sources_used": [<indexes of the numbered sources you actually relied on>],',
        ' "uncertainty": "<what you are unsure about, or null>",',
    ]
    if expect_assessment:
        parts.append(' "assessment": {"observations": [{"skill_id": "<one of the intended skills>", "outcome": "demonstrated|partial|not_demonstrated|not_observed|uncertain",'
                     ' "analysis": "<what the response shows for this criterion>", "missing_or_incorrect": ["..."], "error_types": ["concept|formula_recall|method_selection|algebra|arithmetic|units|notation|implementation|interpretation|source_uncertainty|other"],'
                     ' "assessment_confidence": "low|medium|high"}]},')
    else:
        parts.append(' "assessment": null,')
    parts.append(' "diagnostic": ' + ('{"hypotheses": [{"statement": "...", "supporting": "...", "alternative_causes": ["..."]}], "next_prompt": "<one discriminating question, or null>"}}' if expect_diagnostic else "null}"))
    parts.append('In "segments" give the same reply again, split in order into whole paragraphs or list items, so that the parts joined together are the reply. '
                 "Mark a part course_source only when a numbered source above states it, and list those sources. Mark your own explanation, examples and anything "
                 "from outside the supplied sources added_explanation, with no sources. Do not add hedging or disclaimers to a supported part, and a correct added "
                 "explanation needs none either: the marking is enough.")
    return "\n".join(parts)
