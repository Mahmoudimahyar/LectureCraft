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
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Iterable
from urllib.parse import quote

from fastapi import HTTPException, Query

from .evidence import EvidenceReader, skills_under
from .outline import OutlineModel
from .ownerio.question_links import parse_locator

GRAPH_VERSION = "concept-graph/1"
DEFAULT_LIMIT = 150
MAX_LIMIT = 400
MAX_DEPTH = 3
MAX_SOURCES = 80
MAX_QUESTIONS = 100
KINDS = ("topic", "concept", "skill", "question", "criterion")
FAMILIES = ("assessment", "source", "structure")
TIES = ("exact", "stated", "agent_inferred")  # as recorded; one is never rewritten into another
WHERE = ("on_this_page", "elsewhere_in_sequence", "group_level")
SCOPE_PATTERN = r"^(course|lecture:[A-Za-z0-9._-]+|slide:[A-Za-z0-9._-]+:[0-9]{1,5})$"
PRIVATE_SCOPE_KEYS = ("question_ids", "concept_ids", "skill_ids", "criterion_ids", "topic_ids", "support")
_SCOPE = re.compile(SCOPE_PATTERN)
_ORDER = {kind: position for position, kind in enumerate(KINDS)}
_FAMILY_ORDER = {"structure": 0, "assessment": 1, "source": 2}
_TIE_PROVENANCE = {"exact": "course anchor (reviewed page)", "stated": "course anchor (as stated)", "agent_inferred": "suggested link (agent-inferred)"}
_STRUCTURAL_NOTE = "No question or concept is required of this page: its role is {role} (a structural page). The lecture scope lists this lecture's concepts and questions."
_EMPTY_SLIDE_NOTE = "Nothing in the course record and no suggested link names this slide. The lecture scope lists this lecture's concepts and questions."
_SLIDE_NOTE = "What the course record or a suggested link ties to this slide, each entry once. Support pages name the pages of the slide on which the support is recorded."


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
    """node id → tie → ``{pages, direct}``. An entry that names nothing of this slide, an unknown node or an unknown tie is left out."""
    found: dict[str, dict[str, dict]] = {}
    whole = set(members)

    def add(node_id: Any, tie: str, pages: set[int], direct: bool) -> None:
        if isinstance(node_id, str) and model.kind_of(node_id) is not None:
            slot = found.setdefault(node_id, {}).setdefault(tie, {"pages": set(), "direct": False})
            slot["pages"] |= pages
            slot["direct"] = slot["direct"] or direct

    def through(criterion: dict, tie: str, pages: set[int]) -> None:  # what a supported criterion assesses
        add(criterion.get("concept_id"), tie, pages, False)
        add(criterion.get("skill_id"), tie, pages, False)
        add((model.skills.get(criterion.get("skill_id")) or {}).get("concept_id"), tie, pages, False)

    for entry in entries:
        node_id, tie = (entry.get("node_id"), entry.get("tie")) if isinstance(entry, dict) else (None, None)
        kind = model.kind_of(node_id) if isinstance(node_id, str) else None
        if kind in {None, "topic"} or tie not in TIES:  # a topic is a heading of the catalog: no support is recorded for a heading
            continue
        named = {p for p in entry.get("pages") or [] if isinstance(p, int) and not isinstance(p, bool)}
        pages = named & whole if named else set(whole)  # no page named: the support was recorded for the slide as a whole
        if not pages:
            continue
        add(node_id, tie, pages, True)
        if kind == "question":
            for criterion in model.questions[node_id].get("criteria") or []:
                add(criterion["criterion_id"], tie, pages, False)
                through(criterion, tie, pages)
        elif kind == "criterion":
            add(model.criteria[node_id]["question_id"], tie, pages, False)
            through(model.criteria[node_id], tie, pages)
        elif kind == "skill":
            add(model.skills[node_id].get("concept_id"), tie, pages, False)
    return found


def resolve_scope(model: OutlineModel, scope: str, deck_source_id_of: Callable[[str], str | None], slide_support: dict | None = None) -> dict[str, Any]:
    """The filter of one scope: the R1 scope description plus the id sets by kind that outline and graph both use.

    ``slide_support`` (slide scope) is ``{"logical_slide_id", "label", "page", "pages", "entries", "role"?}``; ``entries``
    are ``{"node_id", "tie", "pages"}`` and ``None`` means "the course's own anchors on the member pages". Without
    ``slide_support`` the slide is the single page. Raises ``ValueError`` for a scope that does not exist.
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
        resolved.update(
            question_ids=by_kind["question"], concept_ids=by_kind["concept"], skill_ids=by_kind["skill"], criterion_ids=by_kind["criterion"],
            basis="typed_anchor_or_suggested_link" if any("agent_inferred" in ties for ties in found.values()) else base["basis"],
            anchored_questions=sorted(by_kind["question"] - suggested), suggested_questions=sorted(suggested),
            related_questions=sorted(q for q in own if q not in by_kind["question"] and any(c.get("concept_id") in by_kind["concept"] for c in model.questions[q].get("criteria") or [])),
            note=note, logical_slide_id=given.get("logical_slide_id"), label=given.get("label"), pages=members, role=role,
            support={node_id: [{"tie": tie, "pages": sorted(ties[tie]["pages"]), "direct": ties[tie]["direct"]} for tie in TIES if tie in ties] for node_id, ties in found.items()})
    resolved["topic_ids"] = {topic for topic, _ in model.children(None, resolved)}  # the headings under which something of the scope is listed
    return resolved


def public_scope(resolved: dict) -> dict[str, Any]:
    """The part of a resolved scope a view may return: plain data, without the id sets."""
    return {key: value for key, value in resolved.items() if key not in PRIVATE_SCOPE_KEYS}


def _members(model: OutlineModel, resolved: dict) -> dict[str, Any]:
    """The ids of the scope by kind (``None`` = the whole catalog), the same sets ``OutlineModel.children`` filters by."""
    if resolved["question_ids"] is None:
        return {kind: None for kind in KINDS}
    return {"topic": resolved["topic_ids"], "concept": resolved["concept_ids"], "skill": resolved["skill_ids"], "question": resolved["question_ids"], "criterion": resolved["criterion_ids"]}


def hierarchy_index(model: OutlineModel, resolved: dict) -> dict[str, dict[str, list[str]]]:
    """What lies directly below each node INSIDE the scope — the same joins and the same filter as ``OutlineModel.children``, read once."""
    members = _members(model, resolved)

    def within(kind: str, node_id: Any) -> bool:
        return members[kind] is None or node_id in members[kind]

    index: dict[str, dict[str, list[str]]] = {"concepts_of_topic": {}, "loose_skills_of_topic": {}, "skills_of_concept": {}, "questions_of_skill": {}}
    for concept_id, concept in model.concepts.items():
        if within("concept", concept_id):
            for topic_id in concept.get("topic_ids") or []:
                index["concepts_of_topic"].setdefault(topic_id, []).append(concept_id)
    for skill_id, skill in model.skills.items():
        if within("skill", skill_id):
            if skill.get("concept_id") in model.concepts:
                index["skills_of_concept"].setdefault(skill["concept_id"], []).append(skill_id)
            else:
                for topic_id in skill.get("topic_ids") or []:
                    index["loose_skills_of_topic"].setdefault(topic_id, []).append(skill_id)
    for question_id, question in model.questions.items():
        if within("question", question_id):
            for skill_id in {c.get("skill_id") for c in question.get("criteria") or [] if within("criterion", c["criterion_id"])}:
                index["questions_of_skill"].setdefault(skill_id, []).append(question_id)
    return index


def node_counts(model: OutlineModel, resolved: dict, node_id: str, index: dict | None = None) -> dict[str, int | None]:
    """Distinct skills and questions BELOW a node inside the scope — what expanding it in the outline shows, each id once.
    A count that does not apply to the node's kind is ``None`` (a question has skills and no questions below it)."""
    kind = model.kind_of(node_id)
    if kind == "question":
        return {"skills": len([s for s in model.skills_of(node_id) if resolved["skill_ids"] is None or s in resolved["skill_ids"]]), "questions": None}
    if kind not in {"topic", "concept", "skill"}:
        return {"skills": None, "questions": None}
    index = index or hierarchy_index(model, resolved)
    if kind == "skill":
        skills = [node_id]
    elif kind == "concept":
        skills = index["skills_of_concept"].get(node_id, [])
    else:
        skills = sorted({*index["loose_skills_of_topic"].get(node_id, []), *(s for c in index["concepts_of_topic"].get(node_id, []) for s in index["skills_of_concept"].get(c, []))})
    return {"skills": None if kind == "skill" else len(skills), "questions": len({q for s in skills for q in index["questions_of_skill"].get(s, [])})}


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

    for concept_id, concept in model.concepts.items():
        for topic_id in concept.get("topic_ids") or []:
            if topic_id in model.topics:
                keep(_edge("structure", "topic_includes_concept", topic_id, concept_id, "question index"))
    for skill_id, skill in model.skills.items():
        if skill.get("concept_id") in model.concepts:
            keep(_edge("structure", "concept_assessed_as_skill", skill["concept_id"], skill_id, "skills catalog"))
        else:
            for topic_id in skill.get("topic_ids") or []:
                if topic_id in model.topics:
                    keep(_edge("structure", "topic_includes_skill", topic_id, skill_id, "skills catalog"))
    for question_id, question in model.questions.items():
        for criterion in question.get("criteria") or []:
            keep(_edge("assessment", "question_has_criterion", question_id, criterion["criterion_id"], "question index"))
            if criterion.get("concept_id") in model.concepts:
                keep(_edge("assessment", "criterion_assesses_concept", criterion["criterion_id"], criterion["concept_id"], "question index"))
            if criterion.get("skill_id") in model.skills:
                keep(_edge("assessment", "criterion_assesses_skill", criterion["criterion_id"], criterion["skill_id"], "question index"))
    for relation in model.relationships:  # the owner's label, between the two questions it names, and nothing derived from it
        source, target, label = relation.get("from_question"), relation.get("to_question"), relation.get("relation")
        if source in model.questions and target in model.questions and source != target and isinstance(label, str) and label:
            keep(_edge("structure", label, source, target, "question index", credit=relation.get("automatic_credit") is True, between_questions=True))
    return list(edges.values())


def _where(pages: list[int], page: int, members: list[int]) -> str:
    if len(members) >= 2 and set(members) <= set(pages):
        return "group_level"
    return "on_this_page" if page in pages else "elsewhere_in_sequence"


def node_support(resolved: dict, node_id: str) -> dict[str, Any]:
    """``{where, support_pages}`` of a node in a slide scope: the member pages its support is recorded on, worded relative to the
    selected page. Outside a slide scope, and for a node no support names, ``where`` is ``None`` and the list is empty."""
    ties = resolved["support"].get(node_id) if resolved["kind"] == "slide" else None
    pages = sorted({page for tie in ties for page in tie["pages"]}) if ties else []
    return {"where": _where(pages, resolved["page"], resolved["pages"]) if pages else None, "support_pages": pages}


def _scope_revision(model: OutlineModel, resolved: dict) -> str:
    """Digest of what the scope holds. It changes when membership, a build group or a tie of THIS scope changes, and with nothing else."""
    members = _members(model, resolved)
    tables = {"topic": model.topics, "concept": model.concepts, "skill": model.skills, "question": model.questions, "criterion": model.criteria}
    payload = {"kind": resolved["kind"], "lecture_id": resolved.get("lecture_id"), "page": resolved.get("page"), "logical_slide_id": resolved["logical_slide_id"], "pages": resolved["pages"],
               "ids": {kind: sorted(tables[kind] if members[kind] is None else members[kind]) for kind in KINDS},
               "support": {node_id: [[t["tie"], t["pages"], t["direct"]] for t in ties] for node_id, ties in sorted(resolved["support"].items())}}
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
    is a focus that lies outside the scope. A criterion is never returned without its question. ``limit`` caps the
    nodes; ``dropped`` says how many were left out. ``totals`` count what the scope holds, each id once.
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
    if focus is None:
        tables = {"topic": model.topics, "concept": model.concepts, "skill": model.skills}
        order = sorted((node_id for kind, table in tables.items() for node_id in (table if everything else members[kind]) if node_id in table), key=rank)
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
                               node_id, _TIE_PROVENANCE[tie["tie"]], tie=tie["tie"], pages=list(tie["pages"])))
    drawn.sort(key=lambda edge: (_FAMILY_ORDER[edge["family"]], edge["relation"], edge["from"], edge["to"], edge["tie"] or ""))
    totals = {kind: model.canonical_counts[kind] if members[kind] is None else len(members[kind]) for kind in KINDS}
    return {"course_id": course_id, "graph_version": GRAPH_VERSION,
            "scope": {"kind": resolved["kind"], "lecture_id": resolved.get("lecture_id"), "page": resolved.get("page"), "logical_slide_id": resolved["logical_slide_id"], "label": resolved["label"],
                      "pages": list(resolved["pages"]), "note": resolved.get("note")},
            "nodes": nodes, "edges": [{key: value for key, value in edge.items() if not key.startswith("_")} for edge in drawn],
            "focus": focus, "truncated": len(order) > len(kept), "dropped": len(order) - len(kept), "totals": totals,
            "revisions": {"question_index_sha256": None, "map_revision": None, "evidence_revision": None, **(revisions or {}), "scope_revision": _scope_revision(model, resolved)}}


# ---- node detail: Sources, Questions, Evidence ------------------------------------------------------------------------------
def _pages_label(pages: list[int], page_count: int | None) -> str:
    runs: list[list[int]] = []
    for page in pages:
        if runs and page == runs[-1][1] + 1:
            runs[-1][1] = page
        else:
            runs.append([page, page])
    text = ", ".join(str(a) if a == b else f"{a}–{b}" for a, b in runs)
    return f"PDF page{'s' if len(pages) > 1 else ''} {text}" + (f" of {page_count}" if page_count else "")


def catalog_sources(model: OutlineModel, *, deck_source_id_of: Callable[[str], str | None] | None = None, lecture_of_source: Callable[[str], str | None] | None = None,
                    page_count_of: Callable[[str], int | None] | None = None, logical_slides_of: Callable[[str, str, list[int]], Iterable[str]] | None = None) -> Callable[[str], list[dict]]:
    """``sources_of`` for :func:`node_detail` from the course's own records: a question's page anchors and a skill's source reference.

    What is not handed in is not claimed: without ``page_count_of`` a label has no "of n", without ``lecture_of_source``
    a skill reference has no lecture, and a file that is not known to be the displayed deck is opened as the file itself.
    """
    def row(lecture_id: str | None, source_id: str, pages: list[int], tie: str, basis: str, shown: bool | None) -> dict:
        return {"lecture_id": lecture_id, "source_id": source_id, "pages": list(pages), "tie": tie, "basis": basis, "on_displayed_deck": shown,
                "page_count": page_count_of(source_id) if page_count_of else None,
                "logical_slide_ids": list(logical_slides_of(lecture_id, source_id, list(pages))) if logical_slides_of and lecture_id else []}

    def sources_of(node_id: str) -> list[dict]:
        kind, rows = model.kind_of(node_id), []
        if kind == "question":
            for anchor in (model.bank["questions"].get(node_id) or {}).get("anchors") or []:
                if anchor.get("kind") == "pages" and anchor.get("source_id") and anchor.get("pages"):
                    tie = "exact" if anchor.get("basis") == "exact" else "stated"
                    rows.append(row(anchor.get("lecture_id"), anchor["source_id"], anchor["pages"], tie, f"question anchor ({tie})", anchor.get("on_displayed_deck")))
        elif kind == "skill":
            for ref in model.skills[node_id].get("source_refs") or []:
                source_id, locator = ref.get("source_id"), ref.get("locator")
                pages = sorted({page for anchor in parse_locator(locator)["anchors"] if anchor["kind"] == "pages" and anchor["target"] == "cited" for page in anchor["pages"]}) if isinstance(locator, str) else []
                if source_id and pages:
                    lecture_id = lecture_of_source(source_id) if lecture_of_source else None
                    shown = deck_source_id_of(lecture_id) == source_id if deck_source_id_of and lecture_id else None
                    rows.append(row(lecture_id, source_id, pages, "stated", "skill source reference", shown))
        return rows

    return sources_of


def tie_sources(ties: Iterable[dict] | None, *, page_count_of: Callable[[str], int | None] | None = None) -> list[dict]:
    """``sources_of`` rows from one question's ``ties`` of a lecture view (r2-read-api.md 1.3 ``questions.all[].ties``).

    A suggested link carries the criteria it supports; :func:`node_detail` then lists it only for a concept, skill or
    criterion that one of those criteria is bound to. A tie without pages (transcript lines only) is not a page source.
    """
    rows = []
    for tie in ties or []:
        if tie.get("tie") in TIES and tie.get("pages") and tie.get("source_id"):
            listed = [c.get("criterion_id") for c in tie.get("criteria") or [] if isinstance(c, dict) and c.get("criterion_id")] if tie["tie"] == "agent_inferred" else []
            rows.append({"lecture_id": tie.get("lecture_id"), "source_id": tie["source_id"], "pages": list(tie["pages"]), "tie": tie["tie"], "on_displayed_deck": tie.get("on_displayed_deck"),
                         "logical_slide_ids": list(tie.get("logical_slide_ids") or []), "page_count": page_count_of(tie["source_id"]) if page_count_of else None,
                         "basis": _TIE_PROVENANCE[tie["tie"]] if tie["tie"] == "agent_inferred" else f"question anchor ({tie['tie']})", "criterion_ids": listed or None})
    return rows


def node_detail(model: OutlineModel, node_id: str, *, course_id: str, sources_of: Callable[[str], Iterable[dict]], evidence: Any,
                questions_of: Callable[[str], Iterable[str]] | None = None) -> dict[str, Any] | None:
    """The R2 additions to ``outline/node``: ``sources``, ``questions``, ``evidence`` (+ totals and ``definition``). ``None`` for an unknown node.

    ``sources_of(id)`` yields ``{lecture_id, source_id, pages, tie, basis?, on_displayed_deck?, page_count?, logical_slide_ids?,
    criterion_ids?}`` for a question or a skill (:func:`catalog_sources`, :func:`tie_sources`). Rows naming the same file
    with the same kind of tie are joined; rows of different ties never are. A row that lists ``criterion_ids`` supports
    those criteria only: it is a source of a concept, skill, topic or criterion only through one of them.
    ``evidence`` is an ``evidence.EvidenceReader`` (``.question(id)``, ``.node(id)``).
    """
    kind = model.kind_of(node_id) if isinstance(node_id, str) else None
    if kind is None:
        return None
    question_ids = [q for q in (questions_of(node_id) if questions_of else model.questions_of(node_id)) if q in model.questions]
    topic_concepts = {c for c, concept in model.concepts.items() if node_id in (concept.get("topic_ids") or [])} if kind == "topic" else set()

    def bound(criterion: dict) -> bool:
        return {"question": True, "criterion": criterion["criterion_id"] == node_id, "concept": criterion.get("concept_id") == node_id, "skill": criterion.get("skill_id") == node_id,
                "topic": criterion.get("concept_id") in topic_concepts}[kind]

    bound_criteria = {q: [c["criterion_id"] for c in model.questions[q].get("criteria") or [] if bound(c)] for q in question_ids}
    origins = {"question": [node_id], "criterion": question_ids, "skill": [node_id, *question_ids]}.get(kind, [*sorted(skills_under(model, node_id)), *question_ids])
    merged: dict[tuple, dict] = {}
    for origin in origins:
        for raw in sources_of(origin) or ():
            pages = {p for p in raw.get("pages") or [] if isinstance(p, int) and not isinstance(p, bool) and p > 0}
            if not pages or raw.get("tie") not in TIES or not raw.get("source_id"):
                continue
            if raw.get("criterion_ids") is not None and kind != "question" and not set(raw["criterion_ids"]) & set(bound_criteria.get(origin, [])):
                continue  # the link supports other criteria of that question, not the ones bound to this node
            slot = merged.setdefault((raw.get("lecture_id"), raw["source_id"], raw["tie"]), {"pages": set(), "slides": set(), "from": set(), "basis": set(), "page_count": None, "shown": False})
            slot["pages"] |= pages
            slot["slides"] |= set(raw.get("logical_slide_ids") or [])
            slot["from"].add(origin)
            slot["basis"] |= {raw["basis"]} if raw.get("basis") else set()
            slot["page_count"] = slot["page_count"] or raw.get("page_count")
            slot["shown"] = slot["shown"] or raw.get("on_displayed_deck") is True
    sources = []
    for (lecture_id, source_id, tie), slot in sorted(merged.items(), key=lambda item: (item[0][0] or "", item[0][1], TIES.index(item[0][2]))):
        pages = sorted(slot["pages"])
        # the lecture opens with its displayed deck: only a page of that deck is a page of the lecture; any other file is opened as itself
        href = (f"/courses/{quote(course_id, safe='')}/lectures/{quote(lecture_id, safe='')}?page={pages[0]}" if lecture_id and slot["shown"]
                else f"/courses/{quote(course_id, safe='')}/sources/{quote(source_id, safe='')}?page={pages[0]}")
        sources.append({"lecture_id": lecture_id, "source_id": source_id, "pages": pages, "label": _pages_label(pages, slot["page_count"]), "tie": tie,
                        "logical_slide_ids": sorted(slot["slides"]), "href": href, "basis": "; ".join(sorted(slot["basis"])), "from": sorted(slot["from"])})

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
    not list puts nothing on the slide. A tie the learner rejected is not a link and is left out; an accepted suggestion
    stays a suggestion (``agent_inferred``). When the page has an identity but no ``question_ties``, ``entries`` is
    ``None``: the course's own anchors are used.
    """
    slide = next((s for s in (view or {}).get("slides") or [] if s.get("page") == page), None)
    identity = (slide or {}).get("identity") or {}
    if not identity.get("logical_slide_id"):
        return None
    logical = next((item for item in ((view.get("source_map") or {}).get("logical_slides") or []) if item.get("id") == identity["logical_slide_id"]), None)
    role = slide.get("role") if isinstance(slide.get("role"), dict) else None
    entries = None
    if "question_ties" in slide:
        entries = []
        for tie in slide["question_ties"] or []:
            if tie.get("tie") not in TIES or tie.get("learner_decision") == "rejected":
                continue
            listed = [c.get("criterion_id") for c in tie.get("criteria") or [] if isinstance(c, dict) and c.get("criterion_id")] if tie["tie"] == "agent_inferred" else []
            entries += [{"node_id": node_id, "tie": tie["tie"], "pages": list(tie.get("support_pages") or [])} for node_id in (listed or [tie.get("question_id")])]
    return {"logical_slide_id": identity["logical_slide_id"], "label": identity.get("label"), "page": page, "pages": sorted((logical or {}).get("pages") or [page]), "entries": entries,
            "role": {"value": role.get("value"), "forced_requirements": role.get("forced_requirements")} if role else None}


def view(projector: Any, course_id: str, *, scope: str = "course", focus: str | None = None, depth: int = 1, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """The concept graph of one course from the Projector's own readers (catalogs, question bank, attempt records, lecture view)."""
    model, bank, decks, catalogs = projector._outline(course_id)
    reader = EvidenceReader(projector._records(course_id), model)
    support, map_revision = None, None
    parts = scope.split(":") if isinstance(scope, str) else []
    if len(parts) >= 2 and parts[0] in {"lecture", "slide"} and parts[1] in bank["lectures"] and _SCOPE.fullmatch(scope):
        lecture = projector.lecture_view(course_id, parts[1]) or {}
        map_revision = (lecture.get("source_map") or {}).get("map_revision")
        if parts[0] == "slide":
            support = slide_support_from_lecture_view(lecture, int(parts[2]))
    return graph(model, course_id=course_id, scope=scope, focus=focus, depth=depth, limit=limit, deck_source_id_of=decks.get, slide_support=support, evidence_of=reader.compact,
                 revisions={"question_index_sha256": (catalogs["questions"] or {}).get("sha256"), "map_revision": map_revision, "evidence_revision": reader.revision})


def register(app: Any, runtime: Any, locked: Callable[[Callable[[], Any]], Any]) -> None:
    """``GET /api/courses/{course_id}/concept-graph`` — a read; it changes no state."""
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
            raise HTTPException(404, "Unknown focus" if document["error"]["code"] == "unknown_focus" else "Unknown scope")
        return document
