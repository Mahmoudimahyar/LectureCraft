"""Clause-level projection of the teaching policy (``ll.policy-projection/1``).

The common tutoring policy and a course's learning strategy mix teaching rules with text about the
learner personally. Neither whole file is supplied to a tutor. A private, versioned projection lists
clauses (sentence spans) of those files with a category, where each applies, and whether it may be
supplied; this module verifies every clause against the bytes that are on disk *now* and returns
only the clauses that still match.

Rules enforced here:
* a clause is supplied only when its file still has the recorded hash and its span still has the
  recorded text hash; otherwise it is left out and reported as a gap (never the whole file instead);
* a required rule area with no supplied clause is reported as a gap, not passed over in silence;
* a projection cannot relax a course restriction, and a clause in a personal category can never be
  marked for inclusion;
* a projection that has not been reviewed by the owner is not supplied outside the synthetic fixture.

Nothing here writes to a course or planner folder, and nothing contacts a tutor.
"""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Iterable

from .. import contracts as c
from ..config import Settings

CONTRACT = "ll.policy-projection/1"
REVIEW_STATES = ("drafted_unreviewed", "owner_reviewed")
REQUIRED_CATEGORIES = ("mode_pacing", "direct_help", "optional_diagnostics", "assistant_error_and_asr_uncertainty", "alternatives", "assistance",
                       "source_vs_added_clarification", "owner_save")
OPTIONAL_CATEGORIES = ("evidence", "stopping", "teaching_method", "course_scope")
TEACHING_CATEGORIES = (*REQUIRED_CATEGORIES, *OPTIONAL_CATEGORIES)
EXCLUSION_CATEGORIES = ("identity", "learner_history", "planner_personal", "unrelated")
ASSESSMENT_ACTIONS = ("explain", "practice", "review_answer", "correct_assessment")
ACTIONS = ("ask", "diagnose", *ASSESSMENT_ACTIONS)
ACTION_GROUPS = {"assessment": ASSESSMENT_ACTIONS}
CATEGORY_LABEL = {
    "mode_pacing": "mode and pacing", "direct_help": "direct help", "optional_diagnostics": "optional diagnostics",
    "assistant_error_and_asr_uncertainty": "tutor errors and transcript (ASR) uncertainty", "alternatives": "alternative answers and methods",
    "assistance": "assistance", "source_vs_added_clarification": "course source versus added clarification", "owner_save": "saving by the course owner",
    "evidence": "learning evidence", "stopping": "stopping", "teaching_method": "teaching method", "course_scope": "course scope",
}
RELAXES = "a projection cannot relax a course restriction"
SYNTHETIC_PROJECTION_REL = "protocols/policy-projection.json"
_SYNTHETIC_MARKER = ".ll-synthetic-fixture"  # the fixture generator's marker (fixtures.builder.MARKER); not imported to keep this module free of fixture code
_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{2,95}$")
_HASH = re.compile(r"^[a-f0-9]{64}$")
_TOP = {"contract", "projection_version", "review_state", "sources", "clauses", "required_categories", "note"}
_SOURCE = {"label", "scope", "path", "sha256", "bytes"}
_CLAUSE = {"clause_id", "source", "span", "text_sha256", "category", "applies_to", "include", "exclusion_reason", "restriction", "note"}
_SPAN = {"line_start", "line_end", "char_start", "char_end"}


class PolicyProjectionError(ValueError):
    """The projection file cannot be used as written. Nothing from the policy files is supplied."""


# ---- drafting helpers (used by the synthetic fixture and by a private draft of the real files) --------------------
def source_entry(label: str, scope: str, path: str, data: bytes) -> dict:
    return {"label": label, "scope": scope, "path": path, "sha256": c.sha256_hex(data), "bytes": len(data)}


def span_of(text: str, char_start: int, char_end: int) -> dict:
    """Span record for ``text[char_start:char_end]``: half-open character offsets into the decoded file, 1-based inclusive lines."""
    return {"line_start": text.count("\n", 0, char_start) + 1, "line_end": text.count("\n", 0, max(char_start, char_end - 1)) + 1, "char_start": char_start, "char_end": char_end}


def clause_entry(clause_id: str, source_label: str, text: str, char_start: int, char_end: int, *, category: str, include: bool = True, exclusion_reason: str | None = None,
                 restriction: bool = False, courses: list[str] | str = "all", actions: list[str] | str = "all") -> dict:
    return {"clause_id": clause_id, "source": source_label, "span": span_of(text, char_start, char_end), "text_sha256": c.sha256_hex(text[char_start:char_end].encode("utf-8")),
            "category": category, "applies_to": {"courses": courses, "actions": actions}, "include": include, "exclusion_reason": exclusion_reason, "restriction": restriction}


# ---- loading and validation ------------------------------------------------------------------------------------------
def projection_path(settings: Settings) -> Path:
    """Where the projection for the bound workspace lives.

    A generated synthetic workspace carries its own synthetic projection beside its planner files, whatever
    the profile. Real folders are never written to, so their projection is a private local binding.
    """
    config = settings.planner_config.resolve()
    if any((parent / _SYNTHETIC_MARKER).is_file() for parent in config.parents):
        return settings.planner_root / SYNTHETIC_PROJECTION_REL
    return settings.repo / "config" / "local-bindings" / "policy-projection.json"


def _need(condition: bool, message: str) -> None:
    if not condition:
        raise PolicyProjectionError(message)


def _course_of(scope: str) -> str | None:
    return scope.split(":", 1)[1] if scope.startswith("course:") else None


def validate_projection(data: Any) -> dict:
    _need(isinstance(data, dict), "the projection is not a JSON object")
    _need(not set(data) - _TOP, f"unknown projection field(s): {sorted(set(data) - _TOP)}")
    _need(data.get("contract") == CONTRACT, f"unsupported projection contract {data.get('contract')!r}; expected {CONTRACT}")
    version = data.get("projection_version")
    _need(isinstance(version, int) and not isinstance(version, bool) and version >= 1, "projection_version must be a positive integer")
    _need(data.get("review_state") in REVIEW_STATES, f"review_state must be one of {REVIEW_STATES}")
    required = data.get("required_categories", list(REQUIRED_CATEGORIES))
    _need(isinstance(required, list) and all(r in TEACHING_CATEGORIES for r in required) and len(set(required)) == len(required), "required_categories must be distinct teaching categories")
    sources = data.get("sources")
    _need(isinstance(sources, list) and sources, "the projection names no source file")
    by_label: dict[str, dict] = {}
    for source in sources:
        _need(isinstance(source, dict) and set(source) == _SOURCE, "each source needs exactly label, scope, path, sha256 and bytes")
        _need(isinstance(source["label"], str) and source["label"] and source["label"] not in by_label, f"source label missing or repeated: {source.get('label')!r}")
        scope = source["scope"]
        _need(scope == "common" or (isinstance(scope, str) and scope.startswith("course:") and len(scope) > 7), f"source scope must be 'common' or 'course:<id>': {scope!r}")
        _need(c.safe_relative(source["path"]), f"source path is not a safe relative path: {source['path']!r}")
        _need(isinstance(source["sha256"], str) and bool(_HASH.match(source["sha256"])), f"source {source['label']} has no valid sha256")
        _need(isinstance(source["bytes"], int) and not isinstance(source["bytes"], bool) and source["bytes"] >= 0, f"source {source['label']} has no valid size")
        by_label[source["label"]] = source
    clauses = data.get("clauses")
    _need(isinstance(clauses, list), "clauses must be a list")
    seen: set[str] = set()
    taken: dict[str, list[tuple[int, int, str]]] = {}
    for clause in clauses:
        _need(isinstance(clause, dict) and not set(clause) - _CLAUSE and _CLAUSE - {"note"} <= set(clause), "each clause needs clause_id, source, span, text_sha256, category, applies_to, include, exclusion_reason and restriction")
        clause_id = clause["clause_id"]
        _need(isinstance(clause_id, str) and bool(_ID.match(clause_id)) and clause_id not in seen, f"clause id missing, malformed or repeated: {clause_id!r}")
        seen.add(clause_id)
        _need(clause["source"] in by_label, f"clause {clause_id} names an unknown source")
        span = clause["span"]
        _need(isinstance(span, dict) and set(span) == _SPAN and all(isinstance(v, int) and not isinstance(v, bool) for v in span.values()), f"clause {clause_id} has a malformed span")
        _need(1 <= span["line_start"] <= span["line_end"] and 0 <= span["char_start"] < span["char_end"], f"clause {clause_id} has an empty or reversed span")
        _need(isinstance(clause["text_sha256"], str) and bool(_HASH.match(clause["text_sha256"])), f"clause {clause_id} has no valid text hash")
        _need(isinstance(clause["include"], bool) and isinstance(clause["restriction"], bool), f"clause {clause_id}: include and restriction must be true or false")
        category = clause["category"]
        _need(category in TEACHING_CATEGORIES or category in EXCLUSION_CATEGORIES, f"clause {clause_id} has an unknown category {category!r}")
        applies = clause["applies_to"]
        _need(isinstance(applies, dict) and set(applies) == {"courses", "actions"}, f"clause {clause_id} needs applies_to.courses and applies_to.actions")
        courses, actions = applies["courses"], applies["actions"]
        _need(courses == "all" or (isinstance(courses, list) and courses and all(isinstance(x, str) and x for x in courses)), f"clause {clause_id}: applies_to.courses must be 'all' or a list of course ids")
        _need(actions == "all" or (isinstance(actions, list) and actions and all(x in ACTIONS or x in ACTION_GROUPS for x in actions)), f"clause {clause_id}: applies_to.actions must be 'all' or a list of actions")
        if clause["include"]:
            _need(category not in EXCLUSION_CATEGORIES, f"clause {clause_id} is in the personal/unrelated category {category!r} and cannot be included")
            _need(clause["exclusion_reason"] is None, f"clause {clause_id} is included but carries an exclusion reason")
        else:
            _need(isinstance(clause["exclusion_reason"], str) and bool(clause["exclusion_reason"].strip()), f"clause {clause_id} is excluded without a reason")
        owner = _course_of(by_label[clause["source"]]["scope"])
        if owner is not None:
            _need(courses == "all" or courses == [owner], f"clause {clause_id} comes from the {owner} course file and can apply to that course only")
            if clause["restriction"]:
                _need(clause["include"], f"{RELAXES}: clause {clause_id} is a restriction of course {owner} and is marked excluded")
        for start, end, other in taken.setdefault(clause["source"], []):
            _need(span["char_end"] <= start or span["char_start"] >= end, f"clauses {other} and {clause_id} overlap in {clause['source']}; an included span could carry excluded text")
        taken[clause["source"]].append((span["char_start"], span["char_end"], clause_id))
    return dict(data, required_categories=list(required))


def load_projection(path: Path) -> dict:
    """Read and validate a projection file. Raises PolicyProjectionError; never falls back to another file."""
    try:
        data = c.load_json(path)
    except (OSError, c.ContractError) as exc:
        raise PolicyProjectionError(f"the projection file cannot be read: {exc}") from exc
    return validate_projection(data)


def _applies(listed: Iterable[str] | str, action: str) -> bool:
    return listed == "all" or action in listed or any(action in ACTION_GROUPS.get(name, ()) for name in listed)


# ---- building what one request is given --------------------------------------------------------------------------------
def _read_source(root: Path, source: dict) -> tuple[str | None, str | None, str, str | None]:
    """(decoded text, current sha256, state, detail) for one source file as it is on disk now."""
    try:
        path = c.resolve_inside(root, source["path"])
        if not path.is_file():
            return None, None, "missing", "the file is not present"
        data = path.read_bytes()
    except (OSError, c.ContractError) as exc:
        return None, None, "unreadable", f"the file could not be read ({type(exc).__name__})"
    current = c.sha256_hex(data)
    if current != source["sha256"]:
        return None, current, "changed", "the file's hash differs from the one the projection was made from"
    try:
        return data.decode("utf-8"), current, "current", None
    except UnicodeDecodeError:
        return None, current, "unreadable", "the file is not valid UTF-8"


def _empty(course_id: str, action: str, state: str, reason: str, *, error: str | None = None, sha256: str | None = None) -> dict:
    return {"course_id": course_id, "action": action, "projection_state": state, "projection_error": error, "projection_sha256": sha256, "projection_version": None, "review_state": None,
            "text": "", "text_supplied": False, "held_reason": None, "clauses_included": [], "clauses_held": [], "clauses_excluded": [], "sources": [],
            "required_categories": list(REQUIRED_CATEGORIES), "gaps": [{"category": category, "reason": reason} for category in REQUIRED_CATEGORIES]}


def build_policy(settings: Settings, course_id: str, action: str, *, allow_unreviewed: bool | None = None) -> dict:
    """Select and verify the clauses that apply to one course and one action.

    Returns the text to supply (possibly empty) with a record of what was included, held back, excluded and
    missing. Projection problems never raise here: they produce no text and visible gaps.
    """
    if allow_unreviewed is None:
        allow_unreviewed = settings.profile == "fixture"  # synthetic files only; real files need the owner's review first
    path = projection_path(settings)
    if not path.is_file():
        return _empty(course_id, action, "absent", "no_projection")
    try:
        raw = path.read_bytes()
        projection = validate_projection(c.parse_json(raw))
    except (OSError, c.ContractError, PolicyProjectionError) as exc:
        return _empty(course_id, action, "invalid", "projection_invalid", error=str(exc)[:500])
    roots = {"common": settings.planner_root, f"course:{course_id}": settings.course(course_id).root}
    ranked = sorted((i for i, s in enumerate(projection["sources"]) if s["scope"] in roots), key=lambda i: (projection["sources"][i]["scope"] != "common", i))
    rank = {projection["sources"][i]["label"]: n for n, i in enumerate(ranked)}
    files, sources = {}, []
    for i in ranked:
        source = projection["sources"][i]
        text, current, state, detail = _read_source(roots[source["scope"]], source)
        files[source["label"]] = (text, state, detail, source["scope"])
        sources.append({"label": source["label"], "scope": source["scope"], "sha256": current, "expected_sha256": source["sha256"], "state": state})
    verified, excluded, gaps = [], [], []
    for clause in sorted((k for k in projection["clauses"] if k["source"] in rank), key=lambda k: (rank[k["source"]], k["span"]["char_start"])):
        clause_id, applies = clause["clause_id"], clause["applies_to"]
        if applies["courses"] != "all" and course_id not in applies["courses"]:
            excluded.append({"id": clause_id, "reason": "not_applicable:course"})
            continue
        if not clause["include"]:
            excluded.append({"id": clause_id, "reason": clause["exclusion_reason"]})
            continue
        if not _applies(applies["actions"], action):
            excluded.append({"id": clause_id, "reason": "not_applicable:action"})
            continue
        text, state, detail, scope = files[clause["source"]]
        span = clause["span"]
        if state == "current":
            piece = text[span["char_start"]:span["char_end"]]
            if span["char_end"] > len(text) or c.sha256_hex(piece.encode("utf-8")) != clause["text_sha256"]:
                detail = "the text at the clause's span differs from the text the clause was made from"
            elif span_of(text, span["char_start"], span["char_end"]) != span:
                detail = "the clause's line numbers do not match its character span"
            else:
                verified.append((clause, scope, " ".join(piece.split())))
                continue
        gaps.append({"category": clause["category"], "clause_id": clause_id, "reason": "source_changed", "detail": detail, **({"restriction": True} if clause["restriction"] else {})})
    held = projection["review_state"] != "owner_reviewed" and not allow_unreviewed
    supplied = [] if held else verified
    lines: list[str] = []
    for heading, wanted in (("Common tutoring rules:", True), ("Rules of this course:", False)):
        block = [f"- {piece}" for _, scope, piece in supplied if (scope == "common") is wanted]  # clause ids stay in the record; the tutor needs the rule, not its label
        if block:
            lines += [heading, *block]
    held_categories = {clause["category"] for clause, _, _ in verified} if held else set()
    covered = {clause["category"] for clause, _, _ in supplied} | {gap["category"] for gap in gaps}
    for category in projection["required_categories"]:
        if category not in covered:
            gaps.append({"category": category, "reason": "projection_unreviewed" if category in held_categories else "unresolved"})
    return {"course_id": course_id, "action": action, "projection_state": "loaded", "projection_error": None, "projection_sha256": c.sha256_hex(raw),
            "projection_version": projection["projection_version"], "review_state": projection["review_state"], "text": "\n".join(lines), "text_supplied": bool(lines),
            "held_reason": "the projection has not been reviewed by the owner, so none of its clauses were supplied" if held else None,
            "clauses_included": [clause["clause_id"] for clause, _, _ in supplied], "clauses_held": [clause["clause_id"] for clause, _, _ in verified] if held else [],
            "clauses_excluded": excluded, "sources": sources, "required_categories": list(projection["required_categories"]), "gaps": gaps}


# ---- the record kept with each request, and the wording for the tutor ---------------------------------------------------
def receipt_of(built: dict) -> dict:
    """The record of one selection (``ll.policy-receipt/1``): everything ``build_policy`` returned except the clause text itself."""
    text = built["text"].encode("utf-8")
    return {"contract": "ll.policy-receipt/1", **{k: v for k, v in built.items() if k != "text"}, "text_sha256": c.sha256_hex(text) if text else None, "text_bytes": len(text)}


def gap_categories(gaps: list[dict]) -> list[str]:
    """Rule areas with a gap, each once, in the order they were found."""
    return list(dict.fromkeys(gap["category"] for gap in gaps))


def gap_line(gaps: list[dict]) -> str | None:
    """One short line for the tutor naming the rule areas it was not given, or None when nothing is missing."""
    if not gaps:
        return None
    line = "Rule areas not available in this request: " + ", ".join(CATEGORY_LABEL[category] for category in gap_categories(gaps)) + ". Do not assume a rule for them."
    if any(gap.get("restriction") for gap in gaps):
        line += " A course restriction could not be checked against the current file: do not treat something as permitted because no rule about it appears here."
    return line


def summary_line(record: dict) -> str:
    """One sentence for the context receipt's note."""
    if record["projection_state"] != "loaded":
        head = {"absent": "no projection is present", "invalid": "the projection could not be used"}[record["projection_state"]]
        return f"Teaching policy: {head}; no clause of the tutoring policy or the course strategy was supplied; gaps: {', '.join(gap_categories(record['gaps']))}."
    held = f", {len(record['clauses_held'])} held back (not owner-reviewed)" if record["clauses_held"] else ""
    return (f"Teaching policy: projection v{record['projection_version']} ({record['review_state']}), {len(record['clauses_included'])} clause(s) supplied, "
            f"{len(record['clauses_excluded'])} excluded{held}; gaps: {', '.join(gap_categories(record['gaps'])) or 'none'}.")
