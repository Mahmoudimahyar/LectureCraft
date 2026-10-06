"""The concept graph of amendment R2 (R2-C2 … R2-C8, R2-C11): the document of ``docs/engineering/r2-read-api.md`` section 3.

There is one model — ``outline.OutlineModel`` over the course's own catalogs — and this module only reads it. The three
scopes (``course``, ``lecture:<id>``, ``slide:<lecture>:<page>``) are FILTERS of that model, resolved once by
:func:`resolve_scope`; the keyboard outline (``OutlineModel.rows``) accepts the same resolved scope, so outline and graph
show the same ids and the same counts. Nothing here stores a graph, and nothing is a second authority.

* A node is returned once by its canonical id, however many branches or builds reach it.
* Edges belong to one of three families that are never mixed: ``assessment`` (question → criterion → concept or skill),
  ``source`` (a logical slide supports a node; with the kind of tie as recorded) and ``structure`` (containment, and the
  owner's question-to-question relations under the owner's label). A relation between two questions stays between those
  two questions: it is never turned into a relation between concepts, and it grants credit only if the catalog says so.
* Slide scope: the caller hands in what is tied to the LOGICAL slide. An entry is listed once and carries the member
  pages on which its support is recorded; ``where`` words that relative to the selected page. Support recorded on a
  later build is never reported as being on an earlier one.
* Criterion wording, question wording and the owner's rationales are not part of any output (criteria are identified,
  never quoted before an attempt).
* One join answers "the questions of a node inside a scope" (``OutlineModel.hierarchy``): the outline's children, a
  node's counts and the Questions of its detail are the same set, also for a concept that only criteria name.
* A recorded source reference is listed as the kind it is — pages, transcript lines or a broad text locator — and is
  never dropped because it is not a page, and never turned into one.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Iterable
from urllib.parse import quote

from fastapi import HTTPException, Query
from fastapi.responses import JSONResponse

from .evidence import EvidenceReader, skills_under
from .outline import OutlineModel
from .ownerio.question_links import parse_locator

GRAPH_VERSION = "concept-graph/1"
DEFAULT_LIMIT = 150
MAX_LIMIT = 400
MAX_DEPTH = 3
MAX_SOURCES = 80
MAX_QUESTIONS = 100
MAX_LOCATOR_TEXT = 300
SOURCE_KINDS = ("pages", "transcript_lines", "text")  # the kind a recorded reference IS; one is never converted into another
KINDS = ("topic", "concept", "skill", "question", "criterion")
FAMILIES = ("assessment", "source", "structure")
TIES = ("exact", "stated", "agent_inferred")  # as recorded; one is never rewritten into another
WHERE = ("on_this_page", "elsewhere_in_sequence", "group_level")
SCOPE_PATTERN = r"^(course|lecture:[A-Za-z0-9._-]+|slide:[A-Za-z0-9._-]+:[1-9][0-9]{0,4})$"  # a page is written as a 1-based number: no page 0, and "007" is not another name of page 7
PRIVATE_SCOPE_KEYS = ("question_ids", "concept_ids", "skill_ids", "criterion_ids", "topic_ids", "support")
# What a view is built from besides the scope itself (R2-C11); a key that was not handed in is ``None``, never guessed. ``scope_revision`` is added by ``graph``.
REVISION_KEYS = ("question_index_sha256", "skills_sha256", "map_revision", "anchor_revision", "policy_revision", "evidence_revision")
_SCOPE = re.compile(SCOPE_PATTERN)
_ORDER = {kind: position for position, kind in enumerate(KINDS)}
_FAMILY_ORDER = {"structure": 0, "assessment": 1, "source": 2}
_TIE_PROVENANCE = {"exact": "course anchor (reviewed page)", "stated": "course anchor (as stated)", "agent_inferred": "suggested link (agent-inferred)"}
_STRUCTURAL_NOTE = "No question or concept is required of this page: its role is {role} (a structural page). The lecture scope lists this lecture's concepts and questions."
_EMPTY_SLIDE_NOTE = "Nothing in the course record and no suggested link names this slide. The lecture scope lists this lecture's concepts and questions."
_SLIDE_NOTE = "What the course record or a suggested link ties to this slide, each entry once. Support pages name the pages of the slide on which the support is recorded."
_ELSEWHERE_NOTE = " {count} {noun} listed here {verb} to another collection than this lecture's (tied to this slide by a link); the lecture scope lists this lecture's own collections only."
_ACCEPTED = ", accepted by the learner"


# ---- scope: one filter for outline and graph --------------------------------------------------------------------------
def _anchor_entries(model: OutlineModel, lecture_id: str, deck: str | None, members: list[int]) -> list[dict]:
    """The course's own page anchors of this lecture's questions on the displayed deck, for the given member pages."""
    out = []
    for question_id in model.bank["lectures"][lecture_id]["question_ids"]:
        for anchor in model.bank["questions"][question_id]["anchors"]:
            if deck is not None and anchor.get("kind") == "pages" and anchor.get("source_id") == deck:
                pages = sorted(set(anchor.get("pages") or []) & set(members))
                if pages:
                    out.append({"node_id": question_id, "tie": "exact" if anchor.get("basis") == "exact" else "stated", "pages": pages})
    return out


def _support(model: OutlineModel, entries: Iterable[Any], members: list[int]) -> dict[str, dict[str, dict]]:
    """node id → tie → ``{pages, direct, group, accepted}``. An entry that names nothing of this slide, an unknown node, an unknown
    tie or pages that are not page numbers is left out; it is never widened. ``group``: ONE record was made for the slide as a
    whole (it names no page, or every page of a group of two or more) — page records that together happen to cover a group are
    not that. ``accepted``: the learner confirmed a suggested link among the records."""
    found: dict[str, dict[str, dict]] = {}
    whole = set(members)

    def add(node_id: Any, tie: str, pages: set[int], direct: bool, group: bool, accepted: bool) -> None:
        if isinstance(node_id, str) and model.kind_of(node_id) is not None:
            slot = found.setdefault(node_id, {}).setdefault(tie, {"pages": set(), "direct": False, "group": False, "accepted": False})
            slot["pages"] |= pages
            slot["direct"], slot["group"], slot["accepted"] = slot["direct"] or direct, slot["group"] or group, slot["accepted"] or accepted

    for entry in entries:
        node_id, tie = (entry.get("node_id"), entry.get("tie")) if isinstance(entry, dict) else (None, None)
        kind = model.kind_of(node_id) if isinstance(node_id, str) else None
        if kind in {None, "topic"} or tie not in TIES:  # a topic is a heading of the catalog: no support is recorded for a heading
            continue
        raw = entry.get("pages")
        listed = isinstance(raw, (list, tuple, set, frozenset))
        if raw is None or (listed and not raw):
            pages = set(whole)  # no page named: the support was recorded for the slide as a whole
        else:
            pages = {p for p in raw if isinstance(p, int) and not isinstance(p, bool)} & whole if listed else set()
        if not pages:  # it names something, and none of it is a page of this slide
            continue
        group, accepted = len(whole) >= 2 and pages == whole, tie == "agent_inferred" and entry.get("decision") == "confirmed"

        def through(criterion: dict) -> None:  # what a supported criterion assesses
            add(criterion.get("concept_id"), tie, pages, False, group, accepted)
            add(criterion.get("skill_id"), tie, pages, False, group, accepted)
            add((model.skills.get(criterion.get("skill_id")) or {}).get("concept_id"), tie, pages, False, group, accepted)

        add(node_id, tie, pages, True, group, accepted)
        if kind == "question":
            for criterion in model.questions[node_id].get("criteria") or []:
                add(criterion["criterion_id"], tie, pages, False, group, accepted)
                through(criterion)
        elif kind == "criterion":
            add(model.criteria[node_id]["question_id"], tie, pages, False, group, accepted)
            through(model.criteria[node_id])
        elif kind == "skill":
            add(model.skills[node_id].get("concept_id"), tie, pages, False, group, accepted)
    return found


def resolve_scope(model: OutlineModel, scope: str, deck_source_id_of: Callable[[str], str | None], slide_support: dict | None = None) -> dict[str, Any]:
    """The filter of one scope: the R1 scope description plus the id sets by kind that outline and graph both use.

    ``slide_support`` (slide scope) is ``{"logical_slide_id", "label", "page", "pages", "entries", "role"?, "page_count"?}``;
    ``entries`` are ``{"node_id", "tie", "pages", "decision"?}`` and ``None`` means "the course's own anchors on the member
    pages". Without ``slide_support`` the slide is the single page. Raises ``ValueError`` for a scope that does not exist:
    an unknown lecture, a page number that is not written as a 1-based number, a page beyond a ``page_count`` handed in.

    A slide scope lists what is tied to the slide. A suggested link may tie a question of another collection to it, so a
    slide scope is not always a subset of its lecture scope (which is collection membership): such questions are named in
    ``questions_of_other_collections`` and the scope's note says so.
    """
    if not isinstance(scope, str) or not _SCOPE.fullmatch(scope):
        raise ValueError(f"Unknown scope {scope!r}")
    base = model.scope(scope, deck_source_id_of)
    resolved: dict[str, Any] = {**base, "logical_slide_id": None, "label": None, "pages": [], "role": None, "support": {}}
    if base["kind"] == "course":
        resolved.update(concept_ids=None, skill_ids=None, criterion_ids=None, topic_ids=None)
        return resolved
    if base["kind"] == "lecture":
        questions, concepts, skills = model._in_scope(base)
        skills = {s for s in skills if s in model.skills}
        concepts = {c for c in concepts if c in model.concepts} | {model.skills[s]["concept_id"] for s in skills if model.skills[s].get("concept_id") in model.concepts}
        resolved.update(concept_ids=concepts, skill_ids=skills, criterion_ids={c["criterion_id"] for q in questions for c in model.questions[q].get("criteria") or []},
                        note=base.get("gap") or base["note"])
    else:
        page, lecture_id = base["page"], base["lecture_id"]
        given = slide_support or {}
        try:
            members = sorted({int(p) for p in given.get("pages") or [page]})
        except (TypeError, ValueError):
            raise ValueError("The pages of the slide handed in are not page numbers") from None
        if page not in members or given.get("page", page) != page:
            raise ValueError(f"Page {page} is not a page of the slide handed in")
        count = given.get("page_count")
        if isinstance(count, int) and not isinstance(count, bool) and not all(1 <= member <= count for member in members):
            raise ValueError(f"Page {page} is not a page of the displayed deck, which has {count}")
        entries = given.get("entries")
        if entries is None:
            entries = _anchor_entries(model, lecture_id, deck_source_id_of(lecture_id), members)
        found = _support(model, entries, members)
        by_kind: dict[str, set[str]] = {kind: set() for kind in KINDS}
        for node_id in found:
            by_kind[model.kind_of(node_id) or "criterion"].add(node_id)
        own = model.bank["lectures"][lecture_id]["question_ids"]
        suggested = {q for q in by_kind["question"] if set(found[q]) == {"agent_inferred"}}  # in scope through a suggested link only: never listed as anchored
        role = given.get("role") if isinstance(given.get("role"), dict) else None
        if found:
            note = _SLIDE_NOTE if slide_support is not None else base["note"]
        elif role is not None and role.get("forced_requirements") is False:
            note = _STRUCTURAL_NOTE.format(role=str(role.get("value") or "structural").replace("_", " "))
        else:
            note = _EMPTY_SLIDE_NOTE if slide_support is not None else base["note"]
        elsewhere = sorted(q for q in by_kind["question"] if q not in own)  # tied to this slide, and not a question of this lecture's collections
        if elsewhere:
            note += _ELSEWHERE_NOTE.format(count=len(elsewhere), noun="question" if len(elsewhere) == 1 else "questions", verb="belongs" if len(elsewhere) == 1 else "belong")
        resolved.update(
            question_ids=by_kind["question"], concept_ids=by_kind["concept"], skill_ids=by_kind["skill"], criterion_ids=by_kind["criterion"],
            basis="typed_anchor_or_suggested_link" if any("agent_inferred" in ties for ties in found.values()) else base["basis"],
            anchored_questions=sorted(by_kind["question"] - suggested), suggested_questions=sorted(suggested), questions_of_other_collections=elsewhere,
            related_questions=sorted(q for q in own if q not in by_kind["question"] and any(c.get("concept_id") in by_kind["concept"] for c in model.questions[q].get("criteria") or [])),
            note=note, logical_slide_id=given.get("logical_slide_id"), label=given.get("label"), pages=members, role=role,
            support={node_id: [{"tie": tie, "pages": sorted(ties[tie]["pages"]), "direct": ties[tie]["direct"], "group": ties[tie]["group"], "accepted": ties[tie]["accepted"]}
                               for tie in TIES if tie in ties] for node_id, ties in found.items()})
    resolved["topic_ids"] = set(model.hierarchy(resolved)["topics"])  # the headings under which something of the scope is listed
    return resolved


def public_scope(resolved: dict) -> dict[str, Any]:
    """The part of a resolved scope a view may return: plain data, without the id sets."""
    return {key: value for key, value in resolved.items() if key not in PRIVATE_SCOPE_KEYS}


def _members(model: OutlineModel, resolved: dict) -> dict[str, Any]:
    """The ids of the scope by kind (``None`` = the whole catalog), the same sets ``OutlineModel.children`` filters by."""
    if resolved["question_ids"] is None:
        return {kind: None for kind in KINDS}
    return {"topic": resolved["topic_ids"], "concept": resolved["concept_ids"], "skill": resolved["skill_ids"], "question": resolved["question_ids"], "criterion": resolved["criterion_ids"]}


def hierarchy_index(model: OutlineModel, resolved: dict) -> dict[str, Any]:
    """What lies directly below each node INSIDE the scope: ``OutlineModel.hierarchy`` itself — the joins ``OutlineModel.children`` lists, read once."""
    return model.hierarchy(resolved)


def node_counts(model: OutlineModel, resolved: dict, node_id: str, index: dict | None = None) -> dict[str, int | None]:
    """Distinct skills and questions BELOW a node inside the scope — what expanding it in the outline shows, each id once.
    The questions are ``OutlineModel.questions_of(node, scope)``: the join the node detail lists and the graph draws. A count
    that does not apply to the node's kind is ``None`` (a question has skills and no questions below it)."""
    kind = model.kind_of(node_id)
    if kind == "question":
        return {"skills": len([s for s in model.skills_of(node_id) if resolved["skill_ids"] is None or s in resolved["skill_ids"]]), "questions": None}
    if kind not in {"topic", "concept", "skill"}:
        return {"skills": None, "questions": None}
    index = index or model.hierarchy(resolved)
    if kind == "skill":
        skills: list[str] | None = None
    elif kind == "concept":
        skills = index["skills_of_concept"].get(node_id, [])
    else:
        skills = sorted({*index["loose_skills_of_topic"].get(node_id, []), *(s for c in index["concepts_of_topic"].get(node_id, []) for s in index["skills_of_concept"].get(c, []))})
    return {"skills": None if skills is None else len(skills), "questions": len(model.questions_of(node_id, resolved))}


# ---- edges ----------------------------------------------------------------------------------------------------------------
def _edge(family: str, relation: str, source: str, target: str, provenance: str, *, credit: bool = False, tie: str | None = None, pages: list[int] | None = None,
          between_questions: bool = False) -> dict[str, Any]:
    identity = hashlib.sha1(f"{family}|{relation}|{source}|{target}|{tie or ''}".encode("utf-8")).hexdigest()[:12]  # noqa: S324 - an id, not a security digest
    return {"id": f"e-{identity}", "from": source, "to": target, "family": family, "relation": relation, "provenance": provenance, "automatic_credit": credit, "tie": tie,
            "support_pages": pages, "_between_questions": between_questions}


def _catalog_edges(model: OutlineModel) -> list[dict[str, Any]]:
    """Every relation the catalogs record, typed by family. One relation is one edge."""
    edges: dict[str, dict] = {}

    def keep(edge: dict) -> None:
        edges.setdefault(edge["id"], edge)

    def is_a(node_id: Any, kind: str) -> bool:  # an id that occurs in two tables is the object ``kind_of`` says it is, and nothing else
        return isinstance(node_id, str) and model.kind_of(node_id) == kind

    for concept_id, concept in model.concepts.items():
        for topic_id in concept.get("topic_ids") or []:
            if is_a(topic_id, "topic") and is_a(concept_id, "concept"):
                keep(_edge("structure", "topic_includes_concept", topic_id, concept_id, "question index"))
    for skill_id, skill in model.skills.items():
        if not is_a(skill_id, "skill"):
            continue
        if is_a(skill.get("concept_id"), "concept"):
            keep(_edge("structure", "concept_assessed_as_skill", skill["concept_id"], skill_id, "skills catalog"))
        else:
            for topic_id in skill.get("topic_ids") or []:
                if is_a(topic_id, "topic"):
                    keep(_edge("structure", "topic_includes_skill", topic_id, skill_id, "skills catalog"))
    for question_id, question in model.questions.items():
        for criterion in question.get("criteria") or []:
            if not (is_a(question_id, "question") and is_a(criterion["criterion_id"], "criterion")):
                continue
            keep(_edge("assessment", "question_has_criterion", question_id, criterion["criterion_id"], "question index"))
            if is_a(criterion.get("concept_id"), "concept"):
                keep(_edge("assessment", "criterion_assesses_concept", criterion["criterion_id"], criterion["concept_id"], "question index"))
            if is_a(criterion.get("skill_id"), "skill"):
                keep(_edge("assessment", "criterion_assesses_skill", criterion["criterion_id"], criterion["skill_id"], "question index"))
    for relation in model.relationships:  # the owner's label, between the two questions it names, and nothing derived from it
        source, target, label = relation.get("from_question"), relation.get("to_question"), relation.get("relation")
        if is_a(source, "question") and is_a(target, "question") and source != target and isinstance(label, str) and label:
            keep(_edge("structure", label, source, target, "question index", credit=relation.get("automatic_credit") is True, between_questions=True))
    return list(edges.values())


def node_support(resolved: dict, node_id: str) -> dict[str, Any]:
    """``{where, support_pages}`` of a node in a slide scope: the member pages its support is recorded on, worded relative to the
    selected page. ``group_level`` only when one record was made for the slide as a whole; page records that together cover
    a group stay page records. Outside a slide scope, and for a node no support names, ``where`` is ``None`` and the list is empty."""
    ties = resolved["support"].get(node_id) if resolved["kind"] == "slide" else None
    pages = sorted({page for tie in ties for page in tie["pages"]}) if ties else []
    if not pages:
        return {"where": None, "support_pages": []}
    where = "group_level" if any(tie["group"] for tie in ties) else ("on_this_page" if resolved["page"] in pages else "elsewhere_in_sequence")
    return {"where": where, "support_pages": pages}


def _scope_revision(model: OutlineModel, resolved: dict) -> str:
    """Digest of what the scope holds and how it is filed. It changes when membership, the place of a member in the hierarchy
    (a skill moved to another concept keeps its id), a build group, a tie of THIS scope or the learner's decision on one of its
    suggested links changes, and with nothing else."""
    members = _members(model, resolved)
    tables = {"topic": model.topics, "concept": model.concepts, "skill": model.skills, "question": model.questions, "criterion": model.criteria}
    filed = model.hierarchy(resolved)
    payload = {"kind": resolved["kind"], "lecture_id": resolved.get("lecture_id"), "page": resolved.get("page"), "logical_slide_id": resolved["logical_slide_id"], "pages": resolved["pages"],
               "ids": {kind: sorted(tables[kind] if members[kind] is None else members[kind]) for kind in KINDS},
               "hierarchy": {name: ({key: sorted(below) for key, below in filed[name].items()} if isinstance(filed[name], dict) else sorted(filed[name])) for name in sorted(filed)},
               "support": {node_id: [[t["tie"], t["pages"], t["direct"], t["group"], t["accepted"]] for t in ties] for node_id, ties in sorted(resolved["support"].items())}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def stale_keys(built_from: dict, current: dict) -> list[str]:
    """The revisions that differ between what a view was built from and what holds now. Empty means the view is current."""
    return sorted(key for key in {*built_from, *current} if built_from.get(key) != current.get(key))


# ---- the graph document ---------------------------------------------------------------------------------------------------
def _error(course_id: str, code: str, detail: str) -> dict[str, Any]:
    return {"course_id": course_id, "graph_version": GRAPH_VERSION, "error": {"code": code, "detail": detail}}


def graph(model: OutlineModel, *, course_id: str, scope: str, focus: str | None = None, depth: int = 1, limit: int = DEFAULT_LIMIT,
          deck_source_id_of: Callable[[str], str | None], slide_support: dict | None = None, evidence_of: Callable[[str], dict | None] | None = None,
          revisions: dict | None = None) -> dict[str, Any]:
    """The document of r2-read-api.md section 3, or ``{course_id, graph_version, error: {code, detail}}`` for an unknown scope or focus.

    Without ``focus``: the scope's topics, concepts and skills. With ``focus``: that node and what lies within ``depth``
    (1–3) relations of it, questions and criteria included. A neighbour is drawn when it belongs to the scope; a
    question reached through the owner's question-to-question relation is drawn too and marked ``in_scope: false``, as
    is a focus that lies outside the scope. A criterion is never returned without its question: the question is listed
    before it, and a focused criterion comes with its question even at ``limit=1`` (the one case of two nodes). ``limit``
    caps the nodes otherwise; ``dropped`` says how many were left out. ``totals`` count what the scope holds — exactly
    the ids the outline reaches by expanding — each id once, as the kind ``kind_of`` gives it.
    """
    try:
        resolved = resolve_scope(model, scope, deck_source_id_of, slide_support)
    except ValueError as exc:
        return _error(course_id, "unknown_scope", str(exc))
    if focus is not None and (not isinstance(focus, str) or model.kind_of(focus) is None):
        return _error(course_id, "unknown_focus", f"Unknown catalog object {focus!r}")
    depth, limit = max(1, min(int(depth), MAX_DEPTH)), max(1, min(int(limit), MAX_LIMIT))
    members = _members(model, resolved)
    everything = members["question"] is None

    def inside(node_id: str) -> bool:
        return everything or node_id in members[model.kind_of(node_id) or "topic"]

    def rank(node_id: str) -> tuple:
        return _ORDER[model.kind_of(node_id) or "criterion"], model.label_of(node_id).lower(), node_id

    edges = _catalog_edges(model)
    tables = {"topic": model.topics, "concept": model.concepts, "skill": model.skills, "question": model.questions, "criterion": model.criteria}
    held = {kind: [node_id for node_id in (tables[kind] if everything else members[kind]) if model.kind_of(node_id) == kind] for kind in KINDS}  # each id once, as the kind it is
    if focus is None:
        order = sorted((node_id for kind in ("topic", "concept", "skill") for node_id in held[kind]), key=rank)
    else:
        adjacency: dict[str, list[tuple[str, bool]]] = {}
        for edge in edges:
            adjacency.setdefault(edge["from"], []).append((edge["to"], edge["_between_questions"]))
            adjacency.setdefault(edge["to"], []).append((edge["from"], edge["_between_questions"]))
        distance, frontier = {focus: 0}, [focus]
        for step in range(1, depth + 1):
            reached = []
            for node_id in frontier:
                for other, between_questions in adjacency.get(node_id, ()):
                    if other not in distance and (between_questions or inside(other)):
                        distance[other] = step
                        reached.append(other)
            frontier = reached
        for node_id in [n for n in distance if model.kind_of(n) == "criterion"]:  # a criterion comes with its question, listed no later than it
            question_id = model.criteria[node_id]["question_id"]
            distance[question_id] = min(distance.get(question_id, distance[node_id]), distance[node_id])
        order = sorted(distance, key=lambda node_id: (node_id != focus, distance[node_id], *rank(node_id)))
        if model.kind_of(focus) == "criterion":  # a focused criterion is identified by its question: the two are not separated, whatever the limit
            limit = max(limit, 2)
    kept = order[:limit]
    present = set(kept)

    nodes = []
    drawn = [edge for edge in edges if edge["from"] in present and edge["to"] in present]
    index = hierarchy_index(model, resolved)
    for node_id in kept:
        nodes.append({"id": node_id, "kind": model.kind_of(node_id), "label": model.label_of(node_id), "counts": node_counts(model, resolved, node_id, index), "in_scope": inside(node_id),
                      **node_support(resolved, node_id), "evidence": evidence_of(node_id) if evidence_of is not None else None})
        for tie in resolved["support"].get(node_id) or []:  # one source edge per kind of tie: a stated anchor and a suggested link stay two things
            drawn.append(_edge("source", "slide_supports" if tie["direct"] else "slide_supports_by_assessment", resolved["logical_slide_id"] or f"slide:{resolved['lecture_id']}:{resolved['page']}",
                               node_id, _TIE_PROVENANCE[tie["tie"]] + (_ACCEPTED if tie["accepted"] else ""), tie=tie["tie"], pages=list(tie["pages"])))
    drawn.sort(key=lambda edge: (_FAMILY_ORDER[edge["family"]], edge["relation"], edge["from"], edge["to"], edge["tie"] or ""))
    totals = {kind: len(held[kind]) for kind in KINDS}
    return {"course_id": course_id, "graph_version": GRAPH_VERSION,
            "scope": {"kind": resolved["kind"], "lecture_id": resolved.get("lecture_id"), "page": resolved.get("page"), "logical_slide_id": resolved["logical_slide_id"], "label": resolved["label"],
                      "pages": list(resolved["pages"]), "note": resolved.get("note")},
            "nodes": nodes, "edges": [{key: value for key, value in edge.items() if not key.startswith("_")} for edge in drawn],
            "focus": focus, "truncated": len(order) > len(kept), "dropped": len(order) - len(kept), "totals": totals,
            "revisions": {**{key: None for key in REVISION_KEYS}, **(revisions or {}), "scope_revision": _scope_revision(model, resolved)}}


# ---- node detail: Sources, Questions, Evidence ------------------------------------------------------------------------------
def _runs(numbers: Iterable[int]) -> list[list[int]]:
    runs: list[list[int]] = []
    for number in sorted(set(numbers)):
        if runs and number == runs[-1][1] + 1:
            runs[-1][1] = number
        else:
            runs.append([number, number])
    return runs


def _ranges_text(ranges: Iterable[Iterable[int]]) -> str:
    return ", ".join(str(a) if a == b else f"{a}–{b}" for a, b in ranges)


def _pages_label(pages: list[int], page_count: int | None) -> str:
    return f"PDF page{'s' if len(pages) > 1 else ''} {_ranges_text(_runs(pages))}" + (f" of {page_count}" if page_count else "")


def _line_ranges(ranges: Any) -> list[list[int]]:
    """Inclusive line ranges as written: pairs of positive integers, first ≤ last. Anything else is left out, never repaired."""
    out = []
    for pair in ranges or []:
        if isinstance(pair, (list, tuple)) and len(pair) == 2 and all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in pair) and pair[0] <= pair[1]:
            out.append([pair[0], pair[1]])
    return out


def catalog_sources(model: OutlineModel, *, deck_source_id_of: Callable[[str], str | None] | None = None, lecture_of_source: Callable[[str], str | None] | None = None,
                    page_count_of: Callable[[str], int | None] | None = None, logical_slides_of: Callable[[str, str, list[int]], Iterable[str]] | None = None,
                    transcript_of: Callable[[str], str | None] | None = None) -> Callable[[str], list[dict]]:
    """``sources_of`` for :func:`node_detail` from the course's own records: a question's anchors and a skill's source references.

    Every recorded reference becomes a row of the kind it IS, and no kind is converted into another: ``pages`` of a file,
    ``transcript_lines`` (inclusive line ranges; a line is not a page), or ``text`` — the catalog's own locator wording
    when it names no page and no line (also a reference that names a file and no place in it). What is not handed in
    is not claimed: without ``page_count_of`` a label has no "of n"; without ``lecture_of_source`` a skill reference has
    no lecture; without ``transcript_of`` (lecture id → the id of the unit's one transcript) the lines a skill reference
    names belong to a transcript that is not identified; and a file that is not known to be the displayed deck is opened
    as the file itself.
    """
    def row(lecture_id: str | None, source_id: str | None, pages: list[int], tie: str, basis: str, shown: bool | None) -> dict:
        return {"kind": "pages", "lecture_id": lecture_id, "source_id": source_id, "pages": list(pages), "tie": tie, "basis": basis, "on_displayed_deck": shown,
                "page_count": page_count_of(source_id) if page_count_of and source_id else None,
                "logical_slide_ids": list(logical_slides_of(lecture_id, source_id, list(pages))) if logical_slides_of and lecture_id and source_id else []}

    def lines(lecture_id: str | None, source_id: str | None, ranges: Any, tie: str, basis: str) -> dict:
        return {"kind": "transcript_lines", "lecture_id": lecture_id, "source_id": source_id, "pages": [], "ranges": _line_ranges(ranges), "tie": tie, "basis": basis}

    def sources_of(node_id: str) -> list[dict]:
        kind, rows = model.kind_of(node_id), []
        if kind == "question":
            for anchor in (model.bank["questions"].get(node_id) or {}).get("anchors") or []:
                tie = "exact" if anchor.get("basis") == "exact" else "stated"
                if anchor.get("kind") == "pages" and anchor.get("pages"):  # ``source_id`` is ``None`` when the record names a file the unit does not identify
                    rows.append(row(anchor.get("lecture_id"), anchor.get("source_id") or None, anchor["pages"], tie, f"question anchor ({tie})", anchor.get("on_displayed_deck")))
                elif anchor.get("kind") == "transcript_lines":
                    rows.append(lines(anchor.get("lecture_id"), anchor.get("source_id") or None, anchor.get("ranges"), tie, f"question anchor ({tie})"))
        elif kind == "skill":
            for ref in model.skills[node_id].get("source_refs") or []:
                source_id = ref.get("source_id") if isinstance(ref.get("source_id"), str) and ref.get("source_id") else None
                locator = ref.get("locator").strip() if isinstance(ref.get("locator"), str) else ""
                anchors = parse_locator(locator)["anchors"]
                pages = sorted({page for anchor in anchors if anchor["kind"] == "pages" and anchor["target"] == "cited" for page in anchor["pages"]}) if source_id else []
                named = [pair for anchor in anchors if anchor["kind"] == "transcript_lines" for pair in anchor["ranges"]]
                lecture_id = lecture_of_source(source_id) if lecture_of_source and source_id else None
                if pages:
                    rows.append(row(lecture_id, source_id, pages, "stated", "skill source reference", deck_source_id_of(lecture_id) == source_id if deck_source_id_of and lecture_id else None))
                if named:  # lines of the unit's transcript, which is another file than the one the reference cites
                    rows.append(lines(lecture_id, transcript_of(lecture_id) if transcript_of and lecture_id else None, named, "stated", "skill source reference"))
                if not pages and not named and (source_id or locator):  # no page and no line could be read from it: the reference as the catalog words it
                    rows.append({"kind": "text", "lecture_id": lecture_id, "source_id": source_id, "pages": [], "locator_text": locator, "tie": "stated", "basis": "skill source reference"})
        return rows

    return sources_of


def tie_sources(ties: Iterable[dict] | None, *, page_count_of: Callable[[str], int | None] | None = None) -> list[dict]:
    """``sources_of`` rows from one question's ``ties`` of a lecture view (r2-read-api.md 1.3 ``questions.all[].ties``).

    A suggested link carries the criteria it supports; :func:`node_detail` then lists it only for a concept, skill or
    criterion that one of those criteria is bound to. A tie without pages — a question the course anchors to transcript
    lines only — is a row of transcript lines, never a page.
    """
    rows = []
    for tie in ties or []:
        if tie.get("tie") not in TIES:
            continue
        basis = _TIE_PROVENANCE[tie["tie"]] if tie["tie"] == "agent_inferred" else f"question anchor ({tie['tie']})"
        if tie.get("pages") and tie.get("source_id"):
            listed = [c.get("criterion_id") for c in tie.get("criteria") or [] if isinstance(c, dict) and c.get("criterion_id")] if tie["tie"] == "agent_inferred" else []
            rows.append({"kind": "pages", "lecture_id": tie.get("lecture_id"), "source_id": tie["source_id"], "pages": list(tie["pages"]), "tie": tie["tie"],
                         "on_displayed_deck": tie.get("on_displayed_deck"), "logical_slide_ids": list(tie.get("logical_slide_ids") or []),
                         "page_count": page_count_of(tie["source_id"]) if page_count_of else None, "basis": basis, "criterion_ids": listed or None})
        elif not tie.get("pages") and _line_ranges(tie.get("transcript_lines")):
            rows.append({"kind": "transcript_lines", "lecture_id": tie.get("lecture_id"), "source_id": tie.get("source_id") or None, "pages": [], "ranges": _line_ranges(tie["transcript_lines"]),
                         "tie": tie["tie"], "basis": basis, "criterion_ids": None})
    return rows


def node_detail(model: OutlineModel, node_id: str, *, course_id: str, sources_of: Callable[[str], Iterable[dict]], evidence: Any,
                questions_of: Callable[[str], Iterable[str]] | None = None) -> dict[str, Any] | None:
    """The R2 additions to ``outline/node``: ``sources``, ``questions``, ``evidence`` (+ totals and ``definition``). ``None`` for an unknown node.

    ``questions`` are ``OutlineModel.questions_of(node)`` — the join the outline expands and the counts count — unless
    ``questions_of`` hands in another list. ``sources_of(id)`` yields, for a question or a skill, rows ``{kind?, lecture_id,
    source_id, pages, ranges?, locator_text?, tie, basis?, on_displayed_deck?, page_count?, logical_slide_ids?, criterion_ids?}``
    (:func:`catalog_sources`, :func:`tie_sources`). ``kind`` is ``pages`` (the default), ``transcript_lines`` or ``text``; a row
    stays the kind it is. Rows of one kind naming the same file with the same kind of tie are joined; rows of different ties
    never are. A row that lists ``criterion_ids`` supports those criteria only: it is a source of a concept, skill, topic or
    criterion only through one of them. ``href`` is ``None`` for a row the record does not make openable (no file identified).
    ``evidence`` is an ``evidence.EvidenceReader`` (``.question(id)``, ``.node(id)``).
    """
    kind = model.kind_of(node_id) if isinstance(node_id, str) else None
    if kind is None:
        return None
    question_ids = [q for q in (questions_of(node_id) if questions_of else model.questions_of(node_id)) if q in model.questions]
    topic_concepts = {c for c, concept in model.concepts.items() if node_id in (concept.get("topic_ids") or [])} if kind == "topic" else set()
    own_skills = skills_under(model, node_id) if kind in {"topic", "concept"} else set()  # the skills the outline lists under the node

    def bound(criterion: dict) -> bool:  # the criteria through which a question is a question of this node: the same joins as ``OutlineModel.hierarchy``
        return {"question": True, "criterion": criterion["criterion_id"] == node_id, "skill": criterion.get("skill_id") == node_id,
                "concept": criterion.get("concept_id") == node_id or criterion.get("skill_id") in own_skills,
                "topic": criterion.get("concept_id") in topic_concepts or criterion.get("skill_id") in own_skills}[kind]

    bound_criteria = {q: [c["criterion_id"] for c in model.questions[q].get("criteria") or [] if bound(c)] for q in question_ids}
    # Where a node's sources come from: its own records, the anchors of its questions, and the source references of its skills. For a
    # question and a criterion the skills are those they assess (question → criterion → skill): where the assessed skill is taught is
    # listed too, in rows of its own, so that the question's own anchor is not blurred by it.
    assessed = model.skills_of(node_id) if kind in {"question", "criterion"} else []
    origins = {"question": [node_id, *assessed], "criterion": [*question_ids, *assessed], "skill": [node_id, *question_ids]}.get(kind, [*sorted(own_skills), *question_ids])
    merged: dict[tuple, dict] = {}
    for origin in origins:
        apart = 1 if origin in assessed else 0  # question and criterion only: 0 = the anchors of the question itself, 1 = the references of an assessed skill
        for raw in sources_of(origin) or ():
            row_kind = raw.get("kind") or "pages"
            if row_kind not in SOURCE_KINDS or raw.get("tie") not in TIES:
                continue
            source_id = raw.get("source_id") if isinstance(raw.get("source_id"), str) and raw.get("source_id") else None
            pages = {p for p in raw.get("pages") or [] if isinstance(p, int) and not isinstance(p, bool) and p > 0} if row_kind == "pages" else set()
            ranges = {tuple(pair) for pair in _line_ranges(raw.get("ranges"))} if row_kind == "transcript_lines" else set()
            text = raw.get("locator_text").strip()[:MAX_LOCATOR_TEXT] if row_kind == "text" and isinstance(raw.get("locator_text"), str) else ""
            if (row_kind == "pages" and not pages) or (row_kind == "transcript_lines" and not ranges) or (row_kind == "text" and not text and source_id is None):
                continue  # the row names nothing
            if raw.get("criterion_ids") is not None and kind != "question" and not set(raw["criterion_ids"]) & set(bound_criteria.get(origin, [])):
                continue  # the link supports other criteria of that question, not the ones bound to this node
            key = (SOURCE_KINDS.index(row_kind), apart, raw.get("lecture_id") or "", source_id or "", TIES.index(raw["tie"]), text)
            slot = merged.setdefault(key, {"kind": row_kind, "lecture_id": raw.get("lecture_id") or None, "source_id": source_id, "tie": raw["tie"], "text": text, "pages": set(), "ranges": set(),
                                           "slides": set(), "from": set(), "basis": set(), "page_count": None, "shown": False})
            slot["pages"] |= pages
            slot["ranges"] |= ranges
            slot["slides"] |= set(raw.get("logical_slide_ids") or [])
            slot["from"].add(origin)
            slot["basis"] |= {raw["basis"]} if raw.get("basis") else set()
            slot["page_count"] = slot["page_count"] or raw.get("page_count")
            slot["shown"] = slot["shown"] or raw.get("on_displayed_deck") is True
    sources = []
    course_path = f"/courses/{quote(course_id, safe='')}"
    for _key, slot in sorted(merged.items()):  # pages first, then transcript lines, then broad text; inside a kind by lecture, file and tie
        lecture_id, source_id, pages, ranges = slot["lecture_id"], slot["source_id"], sorted(slot["pages"]), [list(pair) for pair in sorted(slot["ranges"])]
        lecture_path = f"{course_path}/lectures/{quote(lecture_id, safe='')}" if lecture_id else None
        file_path = f"{course_path}/sources/{quote(source_id, safe='')}" if source_id else None
        if slot["kind"] == "pages":
            # the lecture opens with its displayed deck: only a page of that deck is a page of the lecture; any other file is opened as itself
            href = f"{lecture_path}?page={pages[0]}" if lecture_path and source_id and slot["shown"] else (f"{file_path}?page={pages[0]}" if file_path else None)
            label, shown_ranges = _pages_label(pages, slot["page_count"]), _runs(pages)
        elif slot["kind"] == "transcript_lines":
            # openable only when the record identifies the transcript; the lecture shows its unit's transcript at a line
            href = None if not file_path else (f"{lecture_path}?line={ranges[0][0]}" if lecture_path else f"{file_path}?line={ranges[0][0]}")
            label, shown_ranges = f"Transcript line{'s' if len(ranges) > 1 or ranges[0][0] != ranges[0][1] else ''} {_ranges_text(ranges)}", ranges
        else:
            href, label, shown_ranges = file_path, slot["text"] or "No place in the file is named", []
        sources.append({"kind": slot["kind"], "lecture_id": lecture_id, "source_id": source_id, "pages": pages, "ranges": shown_ranges, "locator_text": slot["text"] if slot["kind"] == "text" else None,
                        "label": label, "tie": slot["tie"], "logical_slide_ids": sorted(slot["slides"]), "href": href, "basis": "; ".join(sorted(slot["basis"])), "from": sorted(slot["from"])})

    tie_to_node = {"question": "self", "criterion": "criterion_of_question"}.get(kind, "assessment")
    questions = [{"question_id": q, "title": model.questions[q].get("title") or q, "collection": model.questions[q].get("collection"), "tie_to_node": tie_to_node,
                  "criterion_ids": bound_criteria[q], "evidence": evidence.question(q)} for q in question_ids[:MAX_QUESTIONS]]
    definition = None
    if kind == "concept":  # a definition is shown only when the catalog records one; its absence is a gap in coverage, not something to fill in
        text = model.concepts[node_id].get("definition")
        text = text.strip() if isinstance(text, str) and text.strip() else None
        definition = {"state": "catalog" if text else "coverage_gap", "text": text, "reason": None if text else "The course catalog records no definition for this concept, and none is supplied here."}
    return {"sources": sources[:MAX_SOURCES], "sources_total": len(sources), "questions": questions, "questions_total": len(question_ids), "evidence": evidence.node(node_id),
            "definition": definition}


# ---- from the Projector's views -----------------------------------------------------------------------------------------------
def slide_support_from_lecture_view(view: dict, page: int) -> dict[str, Any] | None:
    """``slide_support`` for one page of an enriched lecture view (r2-read-api.md section 1), or ``None`` when the page carries no logical-slide identity.

    A course anchor names a page for a question, so the question is the entry. A suggested link names the criteria its
    pages support, so those criteria are the entries (the question itself when it lists none): a criterion the link does
    not list puts nothing on the slide, and a criterion for which the link states its own pages is on those pages only. A tie the learner rejected is not a link and is left out; an accepted suggestion
    stays a suggestion (``agent_inferred``) and its entries carry the decision. A tie that is not page support of this
    slide is left out and never widened: one of section granularity (the course's study map names a range of pages; such
    ties belong in ``section_ties``), and one that lists no support page. When the page has an identity but no
    ``question_ties``, ``entries`` is ``None``: the course's own anchors are used.

    Raises ``ValueError`` when the view states the deck's ``page_count`` and ``page`` is not one of its pages: a page that
    does not exist is an unknown scope, not a slide that holds nothing.
    """
    view = view or {}
    count = view.get("page_count")
    if isinstance(count, int) and not isinstance(count, bool) and not 1 <= page <= count:
        raise ValueError(f"Page {page} is not a page of the displayed deck, which has {count}")
    slide = next((s for s in view.get("slides") or [] if s.get("page") == page), None)
    identity = (slide or {}).get("identity") or {}
    if not identity.get("logical_slide_id"):
        return None
    logical = next((item for item in ((view.get("source_map") or {}).get("logical_slides") or []) if item.get("id") == identity["logical_slide_id"]), None)
    role = slide.get("role") if isinstance(slide.get("role"), dict) else None
    entries = None
    if "question_ties" in slide:
        entries = []
        for tie in slide["question_ties"] or []:
            pages = tie.get("support_pages")
            if tie.get("tie") not in TIES or tie.get("learner_decision") == "rejected" or tie.get("granularity") not in (None, "page") or not isinstance(pages, list) or not pages:
                continue
            listed = [c for c in tie.get("criteria") or [] if isinstance(c, dict) and c.get("criterion_id")] if tie["tie"] == "agent_inferred" else []
            for criterion in listed:
                # A link may state page by page which criteria it supports: a criterion is then on ITS pages, never on
                # every page of the link. Pages it states outside the link's own are not support of this slide.
                own = [p for p in criterion.get("pages") or [] if p in pages]
                entries.append({"node_id": criterion["criterion_id"], "tie": tie["tie"], "pages": own or list(pages), "decision": tie.get("learner_decision")})
            if not listed:
                entries.append({"node_id": tie.get("question_id"), "tie": tie["tie"], "pages": list(pages), "decision": tie.get("learner_decision")})
    return {"logical_slide_id": identity["logical_slide_id"], "label": identity.get("label"), "page": page, "pages": sorted((logical or {}).get("pages") or [page]), "entries": entries,
            "role": {"value": role.get("value"), "forced_requirements": role.get("forced_requirements")} if role else None}


def anchor_revision(view: dict | None) -> str | None:
    """Digest of the anchors of ONE lecture as its lecture view lists them: the course's own anchors of the lecture's questions
    and, when the view is enriched, every tie with the learner's decision on it. It changes when an anchor of that lecture is
    added, moved or removed and when a suggested link is accepted, rejected or cleared — not with the wording of a rationale
    and not with the order of listing. ``None`` without a lecture view: no revision is claimed."""
    questions = ((view or {}).get("questions") or {}).get("all")
    if not isinstance(questions, list):
        return None
    rows = []
    for question in questions:
        anchors = sorted(json.dumps([a.get("kind"), a.get("source_id"), a.get("lecture_id"), a.get("pages") or a.get("ranges") or [], a.get("basis")], sort_keys=True) for a in question.get("anchors") or [])
        ties = sorted(json.dumps([t.get("tie"), t.get("source_id"), t.get("lecture_id"), t.get("pages") or [], t.get("transcript_lines") or [],
                                  sorted(c.get("criterion_id") or "" for c in t.get("criteria") or [] if isinstance(c, dict)), t.get("state"), t.get("verdict"), t.get("suggestion_id"),
                                  t.get("learner_decision")], sort_keys=True) for t in question.get("ties") or [])
        rows.append([question.get("question_id"), anchors, ties])
    return hashlib.sha256(json.dumps(sorted(rows, key=lambda row: str(row[0])), sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def view(projector: Any, course_id: str, *, scope: str = "course", focus: str | None = None, depth: int = 1, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """The concept graph of one course from the Projector's own readers (catalogs, question bank, attempt records, lecture view).

    ``revisions`` name what the view was built from (R2-C11): the question index and the skills catalog (their bytes), the
    source-map revision and the anchor revision of the lecture (lecture and slide scopes; the course graph draws neither
    a slide nor an anchor), the app's policy revision, the evidence revision, and the scope's own revision.
    """
    model, bank, decks, catalogs = projector._outline(course_id)
    reader = EvidenceReader(projector._records(course_id), model)
    support, map_revision, anchors = None, None, None
    parts = scope.split(":") if isinstance(scope, str) else []
    if len(parts) >= 2 and parts[0] in {"lecture", "slide"} and parts[1] in bank["lectures"] and _SCOPE.fullmatch(scope):
        lecture = projector.lecture_view(course_id, parts[1]) or {}
        map_revision, anchors = (lecture.get("source_map") or {}).get("map_revision"), anchor_revision(lecture)
        if parts[0] == "slide":
            try:
                support = slide_support_from_lecture_view(lecture, int(parts[2]))
            except ValueError as exc:  # the deck has no such page
                return _error(course_id, "unknown_scope", str(exc))
    return graph(model, course_id=course_id, scope=scope, focus=focus, depth=depth, limit=limit, deck_source_id_of=decks.get, slide_support=support, evidence_of=reader.compact,
                 revisions={"question_index_sha256": (catalogs["questions"] or {}).get("sha256"), "skills_sha256": (catalogs.get("skills") or {}).get("sha256"), "map_revision": map_revision,
                            "anchor_revision": anchors, "policy_revision": getattr(getattr(projector, "settings", None), "policy_revision", None), "evidence_revision": reader.revision})


def register(app: Any, runtime: Any, locked: Callable[[Callable[[], Any]], Any]) -> None:
    """``GET /api/courses/{course_id}/concept-graph`` — a read; it changes no state.

    An unknown scope or focus is answered with status 404 and the error document itself,
    ``{course_id, graph_version, error: {code: "unknown_scope" | "unknown_focus", detail}}`` (r2-read-api.md 1.4): the
    reader tells the two apart by ``error.code``. An unknown course is the general ``{detail}`` 404 of every course route,
    and a malformed request is 422.
    """
    @app.get("/api/courses/{course_id}/concept-graph")
    def concept_graph(course_id: str, scope: str = Query("course", max_length=120, pattern=SCOPE_PATTERN), focus: str | None = Query(None, min_length=1, max_length=300),
                      depth: int = Query(1, ge=1, le=MAX_DEPTH), limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)):
        binding = runtime.settings.courses.get(course_id)
        if binding is None:
            raise HTTPException(404, "Unknown course")
        if not binding.usable:
            raise HTTPException(409, binding.problem or "Course binding is not usable")
        document = locked(lambda: view(runtime.projector, course_id, scope=scope, focus=focus, depth=depth, limit=limit))
        if "error" in document:
            return JSONResponse(document, status_code=404)
        return document
