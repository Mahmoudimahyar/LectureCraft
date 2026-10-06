"""Questions tied to the pages and logical slides of one lecture view (R2-Q2 … R2-Q8, R2-Q10; r2-read-api.md 1.2 – 1.4).

:func:`enrich` is a pure function over what it is handed: it mutates a lecture view and reads no file. It adds

* ``slides[].question_ties`` — the questions an anchor ties to the page's logical slide (``granularity: "page"``), each
  saying where its support is (``on_this_page``, ``elsewhere_in_sequence``, ``group_level``) and, for a suggested link
  whose producer said so, how many of its criteria this page carries (``criteria_supported_here``);
* ``slides[].section_ties`` — the course's own study-map statements that a question sits somewhere in a range of pages
  (``granularity: "section"``, D78), listed apart: a section is never a page tie and never becomes one;
* ``slides[].related_questions`` (+ ``related_questions_total``) — questions that share a concept with what the logical
  slide supports and are not tied to it;
* ``questions.all[].ties`` / ``no_link`` / ``evidence`` / ``suggestion_history`` and ``questions.counts``.

Four kinds of tie exist and none is ever turned into another: ``exact`` and ``stated`` are the course's own anchors
(``ownerio.question_links``; a study-map section is ``stated``), ``agent_inferred`` is an item of the suggestions file
(``inferred_anchors``), ``concept_related`` is a shared concept and no claim about the slide. A learner's confirmation
is a field beside an ``agent_inferred`` tie; it does not make it exact. An item the verifying pass rejected is a tie
only while the learner's own confirmation of it stands (R2-Q5: the learner's decision outranks both agent states); an
item the learner rejected is not a tie. Decisions about suggestions that are no longer current links are listed with
the reason in the row's ``suggestion_history`` and are never shown as links.

A page is matched by its physical number. Transcript lines stay lines. Criteria are named by identity and counted
("supports n of m"); their wording, the guidance and any expected answer are never part of the output.
"""
from __future__ import annotations

from typing import Any, Callable, Iterable

TIES_VERSION = "question-ties/1"
RELATED_CAP = 30
COURSE_TIES = ("exact", "stated")
_NO_SUGGESTION_FIELDS = {"criteria_supported": None, "criteria_total": None, "criteria": None, "coverage": None, "state": None, "verdict": None, "verdict_note": None, "rationale": None,
                         "regions": None, "suggestion_id": None, "learner_decision": None}


def unknown_evidence() -> dict[str, Any]:
    """What is said about a question when nobody supplied an evidence reader: nothing is known. Never drawn as zero work."""
    return {"state": "unknown", "assistance": None, "prior_exposure": "unknown", "attempts": 0, "last_at": None}


def _order(link: dict) -> tuple:
    return (str(link.get("collection")), link["number"] if isinstance(link.get("number"), int) else 10**6, link["question_id"])


def _decision_of(decisions: dict | None, suggestion_id: str) -> str | None:
    entry = (decisions or {}).get(suggestion_id)
    value = entry.get("decision") if isinstance(entry, dict) else entry
    return value if value in {"confirmed", "rejected"} else None  # a cleared decision is no decision


def _lines(link: dict, lecture_id: str | None) -> list[list[int]]:
    """Transcript line ranges of the course's own locator for one unit, as written. Lines, never pages."""
    out: list[list[int]] = []
    for anchor in link["anchors"]:
        if anchor["kind"] == "transcript_lines" and anchor.get("lecture_id") == lecture_id:
            out.extend(list(r) for r in anchor["ranges"] if list(r) not in out)
    return out


def _pages_text(pages: list[int]) -> str:
    if len(pages) == 1:
        return f"page {pages[0]}"
    return "pages " + ", ".join(str(p) for p in pages[:-1]) + f" and {pages[-1]}"


def _ranges_text(ranges: list[list[int]]) -> str:
    """Page ranges as the study map states them: "pages 5 to 20", "pages 2 to 5 and 9", "page 7"."""
    parts = [str(a) if a == b else f"{a} to {b}" for a, b in ranges]
    if len(parts) == 1:
        return ("page " if ranges[0][0] == ranges[0][1] else "pages ") + parts[0]
    return "pages " + ", ".join(parts[:-1]) + f" and {parts[-1]}"


def where_of(page: int, members: list[int], named: Iterable[int]) -> tuple[str, list[int]]:
    """(where, support_pages) of a tie on ``page`` of a logical slide with ``members``, for the pages the tie names.

    ``group_level`` only when every member of a group of two or more is named; otherwise this page when it is named,
    else another page of the sequence. Support on a later page is therefore never reported for an earlier one.
    """
    named = set(named)
    support = [p for p in members if p in named]
    if len(members) >= 2 and len(support) == len(members):
        return "group_level", support
    return ("on_this_page" if page in named else "elsewhere_in_sequence"), support


def _why(tie: dict, where: str, support: list[int], here: int | None) -> str:
    place = {"on_this_page": "this page", "group_level": "every page of this sequence"}.get(where) or f"{_pages_text(support)} of this sequence, not this page"
    kind = tie["tie"]
    if kind in COURSE_TIES and tie["catalog_field"] == "page":  # where the question itself is printed: not a statement about where its content is
        return f"The course catalog records {place} as where this question is printed" + ("." if kind == "exact" else "; its page number has not been reviewed as a physical page.")
    if kind == "exact":
        return f"A reviewed anchor of the course record names {place}."
    if kind == "stated":
        return f"The course record names {place}; its page numbers have not been reviewed as physical pages."
    rejected = tie["verdict"] == "rejected"
    text = f"Suggested by an agent pass from the content of {place}; " + ("a second agent pass rejected it." if rejected else "checked by a second agent pass." if tie["state"] == "agent_reviewed"
                                                                         else "not yet checked by a second pass.")
    if here is not None and where != "elsewhere_in_sequence" and here < (tie["criteria_supported"] or 0):
        text += " This page carries none of the criteria the link lists." if here == 0 else f" This page carries {here} of the {tie['criteria_supported']} criteria the link lists."
    if tie["learner_decision"] == "confirmed":
        text += " You confirmed this link, so it is kept." if rejected else " You confirmed this link."
    return text


def enrich(view: dict, *, bank: dict, index: dict | None, source_map: dict | None, inferred: dict | None, decisions: dict | None,
           evidence_of: Callable[[str], dict] | None = None, concepts_of_page: Callable[[int], Iterable[Any]] | None = None,
           section_ties: dict[str, list[dict]] | None = None, confirmed_outranks_verifier: bool = True) -> dict:
    """Add question ties to a lecture view (see the module text). Returns the same ``view``.

    ``bank``: ``build_question_bank`` output for the course. ``index``: the question index (``read_question_index``) or
    ``None``. ``source_map``: the ``source_map`` block of r2-read-api.md 1.1 or ``None`` (then every page is its own
    logical slide; only ``logical_slides[].id`` / ``pages`` are read). ``inferred``: the document of
    ``inferred_anchors.load`` or ``None`` (no suggestions file). ``decisions``: ``inferred_anchors.decisions`` output.
    ``evidence_of(question_id)`` returns the evidence object of a question; ``concepts_of_page(page)`` the concepts a
    page supports (ids or ``{concept_id, label}``), replacing the view's own ``slides[].concepts``.
    ``section_ties``: ``ownerio.study_maps.section_ties`` output, ``{question_id: [row]}``; only rows whose
    ``deck_state`` is ``"current"`` are statements, and a row is on a page of this view only when its ``source_id`` is
    the displayed deck. ``confirmed_outranks_verifier``: with ``False`` an item the verifying pass rejected is never a
    tie, also when the learner had confirmed it (the decision is then listed in ``suggestion_history``).
    """
    questions: dict[str, dict] = (index or {}).get("questions") or {}
    concept_table: dict[str, dict] = (index or {}).get("concepts") or {}
    links: dict[str, dict] = bank.get("questions") or {}
    lecture_id = view.get("lecture_id")
    deck_id = (view.get("deck") or {}).get("source_id")
    file_state = ((inferred or {}).get("file") or {}).get("state", "missing")
    by_question: dict[str, dict] = (inferred or {}).get("by_question") or {}
    stale_examined = {r["question_id"] for r in (inferred or {}).get("stale_no_candidate") or []}

    members_of: dict[int, tuple[str | None, list[int]]] = {}
    if isinstance(source_map, dict) and source_map.get("state", "ready") == "ready":
        for logical in source_map.get("logical_slides") or []:
            pages = sorted(int(p) for p in logical.get("pages") or [])
            for page in pages:
                members_of[page] = (logical.get("id"), pages)

    def logical_ids(pages: list[int]) -> list[str]:
        out: list[str] = []
        for page in pages:
            logical = members_of.get(page, (None, []))[0]
            if logical is not None and logical not in out:
                out.append(logical)
        return out

    evidence_cache: dict[str, dict] = {}

    def evidence(question_id: str) -> dict:
        if question_id not in evidence_cache:
            evidence_cache[question_id] = evidence_of(question_id) if evidence_of is not None else unknown_evidence()
        return dict(evidence_cache[question_id])

    def criteria_rows(question_id: str, listed: list[str], support: dict[int, list[str]] | None) -> tuple[list[dict], int]:
        """The listed criteria by identity, number and concept — never their wording — and the catalogued total.
        ``pages``: the pages the producer says carry the criterion, or ``None`` when it made no page-by-page statement."""
        catalogued = (questions.get(question_id) or {}).get("criteria") or []
        rows = []
        for number, criterion in enumerate(catalogued, start=1):
            if criterion.get("criterion_id") in listed:
                concept = concept_table.get(criterion.get("concept_id")) or {}
                rows.append({"criterion_id": criterion["criterion_id"], "number": number, "label": f"Criterion {number} of {len(catalogued)}", "concept_id": criterion.get("concept_id"),
                             "concept_label": concept.get("label"), "skill_id": criterion.get("skill_id"), "action_types": list(criterion.get("action_types") or []),
                             "pages": None if support is None else sorted(p for p, ids in support.items() if criterion["criterion_id"] in ids)})
        return rows, len(catalogued)

    # Decisions about suggestions the file no longer holds at all: what they were about is known from their own record only.
    known_ids = {item["suggestion_id"] for name in ("items", "rejected_by_verifier", "stale") for item in (inferred or {}).get(name) or []}
    gone_reason = {"missing": "no_file", "unreadable": "file_unreadable"}.get(file_state, "not_in_file")
    decided_elsewhere: dict[str, list[dict]] = {}
    for suggestion_id in sorted(decisions or {}):
        entry = (decisions or {})[suggestion_id]
        snapshot = entry.get("suggestion") if isinstance(entry, dict) else None
        value = _decision_of(decisions, suggestion_id)
        if value is not None and suggestion_id not in known_ids and isinstance(snapshot, dict):
            decided_elsewhere.setdefault(str(snapshot.get("question_id")), []).append(
                {"suggestion_id": suggestion_id, "lecture_id": snapshot.get("lecture_id"), "source_id": snapshot.get("source_id"), "pages": list(snapshot.get("pages") or []),
                 "learner_decision": value, "reason": gone_reason})

    def history_key(entry: dict) -> tuple:
        return (str(entry["lecture_id"]), str(entry["source_id"]), entry["pages"], entry["suggestion_id"])

    # ---- every tie of every catalogued question, once ------------------------------------------------------
    def ties_of(link: dict) -> dict[str, Any]:
        question_id = link["question_id"]
        course: list[dict] = []
        paged: dict[tuple, dict] = {}
        for anchor in link["anchors"]:
            if anchor["kind"] == "pages":  # the catalog's page field says where the question is printed; a locator says where its content is: two statements, two rows
                field = "page" if anchor.get("from") == "page_field" else "locator"
                group = paged.setdefault((anchor["basis"], anchor.get("source_id"), field), {"lecture_id": anchor.get("lecture_id"), "pages": set()})
                group["pages"].update(anchor["pages"])
        for (basis, source_id, field), group in paged.items():
            pages = sorted(group["pages"])
            shown = deck_id is not None and source_id == deck_id
            course.append({"tie": basis, "granularity": "page", "from": "course_locator", "catalog_field": field, "section": None, "lecture_id": group["lecture_id"], "source_id": source_id,
                           "pages": pages, "logical_slide_ids": logical_ids(pages) if shown else [], "transcript_lines": _lines(link, group["lecture_id"]) if field == "locator" else [],
                           **_NO_SUGGESTION_FIELDS, "on_displayed_deck": shown})
        paged_units = {group["lecture_id"] for (_, _, field), group in paged.items() if field == "locator"}
        lined: dict[tuple, dict] = {}
        for anchor in link["anchors"]:  # a question the course anchors to transcript lines only: an anchor with no page
            if anchor["kind"] == "transcript_lines" and anchor.get("lecture_id") not in paged_units:
                lined.setdefault((anchor["basis"], anchor.get("lecture_id")), {"source_id": anchor.get("source_id")})
        for (basis, unit), group in lined.items():
            course.append({"tie": basis, "granularity": "page", "from": "course_locator", "catalog_field": "locator", "section": None, "lecture_id": unit, "source_id": group["source_id"],
                           "pages": [], "logical_slide_ids": [], "transcript_lines": _lines(link, unit), **_NO_SUGGESTION_FIELDS, "on_displayed_deck": False})

        sections: list[dict] = []
        for stated in sorted((section_ties or {}).get(question_id) or [], key=lambda s: (str(s.get("lecture_id")), s.get("row") if isinstance(s.get("row"), int) else 10**6, list(s.get("pages") or []))):
            if stated.get("deck_state") != "current" or not stated.get("pages"):
                continue  # a map made for other deck bytes, or bound to no deck, states nothing about the pages of a current deck
            pages = sorted(int(p) for p in stated["pages"])
            shown = deck_id is not None and stated.get("source_id") == deck_id
            sections.append({"tie": "stated", "granularity": "section", "from": "course_study_map", "catalog_field": None,
                             "section": {"page_ranges": [list(r) for r in stated.get("page_ranges") or []], "label": stated.get("label"), "row": stated.get("row"), "scope": stated.get("scope")},
                             "lecture_id": stated.get("lecture_id"), "source_id": stated.get("source_id"), "pages": pages, "logical_slide_ids": logical_ids(pages) if shown else [],
                             "transcript_lines": [list(r) for r in stated.get("transcript_ranges") or []], **_NO_SUGGESTION_FIELDS, "on_displayed_deck": shown})

        suggested: list[tuple[dict, dict | None]] = []  # (tie, what each page supports or None)
        dismissed: list[dict] = []
        set_aside: list[dict] = list(decided_elsewhere.get(question_id) or [])
        mine = by_question.get(question_id) or {}

        def reference(item: dict, decision: str, **more: Any) -> dict:
            return {"suggestion_id": item["suggestion_id"], "lecture_id": item["lecture_id"], "source_id": item["source_id"], "pages": list(item["pages"]), "learner_decision": decision, **more}

        def suggest(item: dict, decision: str | None) -> None:
            # Whether the item was made for the deck's current bytes is the reader's verdict (stale items never get here);
            # the identity a view prints for its deck may be the index's declared one, so it is not compared a second time.
            shown = deck_id is not None and item["source_id"] == deck_id
            support = {entry["page"]: list(entry["supports"]) for entry in item["per_page"]} if item.get("per_page") is not None else None
            rows, total = criteria_rows(question_id, item["criteria"], support)
            suggested.append(({"tie": "agent_inferred", "granularity": "page", "from": "inferred_anchor_file", "catalog_field": None, "section": None, "lecture_id": item["lecture_id"],
                               "source_id": item["source_id"], "pages": list(item["pages"]), "logical_slide_ids": logical_ids(item["pages"]) if shown else [],
                               "transcript_lines": _lines(link, item["lecture_id"]), "criteria_supported": len(rows), "criteria_total": total, "criteria": rows, "coverage": item["coverage"],
                               "state": item["state"], "verdict": item["verifier"]["verdict"], "verdict_note": item["verifier"].get("note"), "rationale": item["rationale"], "regions": item["regions"],
                               "suggestion_id": item["suggestion_id"], "learner_decision": decision, "on_displayed_deck": shown}, support))

        for item in mine.get("items") or []:
            decision = _decision_of(decisions, item["suggestion_id"])
            if decision == "rejected":  # the learner's own record outranks the file: not a link, kept so it can be taken back
                dismissed.append(reference(item, decision))
            else:
                suggest(item, decision)
        for item in mine.get("rejected_by_verifier") or []:
            decision = _decision_of(decisions, item["suggestion_id"])
            if decision == "confirmed" and confirmed_outranks_verifier:
                suggest(item, decision)  # the learner's confirmation stands until the learner takes it back; the row says that the checking pass disagreed
            elif decision is not None:
                set_aside.append(reference(item, decision, reason="rejected_by_verifier"))
        for item in mine.get("stale") or []:
            decision = _decision_of(decisions, item["suggestion_id"])
            if decision is not None:
                set_aside.append(reference(item, decision, reason="stale"))
        suggested.sort(key=lambda pair: (not pair[0]["on_displayed_deck"], str(pair[0]["lecture_id"]), str(pair[0]["source_id"]), pair[0]["pages"], pair[0]["suggestion_id"]))
        dismissed.sort(key=history_key)
        set_aside.sort(key=history_key)

        no_link = None
        if not course and not suggested:  # about links to pages: a section statement of the course does not replace this line
            confirmed_empty = mine.get("no_candidate") if (mine.get("no_candidate") or {}).get("verifier", {}).get("confirmed") else None
            rejected = mine.get("rejected_by_verifier") or []
            if dismissed:
                no_link = {"state": "no_suggestion", "reason": "rejected_by_learner"}
            elif confirmed_empty:
                no_link = {"state": "inspected_no_support", "reason": confirmed_empty["why"]}
            elif rejected:
                notes = list(dict.fromkeys(i["verifier"]["note"] for i in rejected if i["verifier"].get("note")))
                no_link = {"state": "inspected_no_support", "reason": "; ".join(notes) if notes else "The checking pass rejected every candidate and recorded no note."}
            elif file_state == "missing":
                no_link = {"state": "no_suggestion", "reason": "no_file"}
            elif file_state == "unreadable":  # a file exists and could not be used: "none produced yet" would be untrue
                no_link = {"state": "no_suggestion", "reason": "file_unreadable"}
            elif mine.get("stale") or question_id in stale_examined:
                no_link = {"state": "no_suggestion", "reason": "stale"}
            else:
                no_link = {"state": "no_suggestion", "reason": "no_item"}
        return {"ties": [*course, *sections, *(tie for tie, _ in suggested)], "support": {id(tie): support for tie, support in suggested}, "no_link": no_link,
                "suggestion_history": {"stale": len(mine.get("stale") or []), "rejected_by_verifier": len(mine.get("rejected_by_verifier") or []), "rejected_by_learner": dismissed,
                                       "decisions_not_shown": set_aside}}

    ordered = sorted(links.values(), key=_order)
    all_ties = {link["question_id"]: ties_of(link) for link in ordered}

    # ---- per slide ---------------------------------------------------------------------------------------------
    on_deck: list[tuple[tuple, dict, dict]] = []      # (sort key, link, tie) for every page tie that names pages of the displayed deck
    sections_on_deck: list[tuple[tuple, dict, dict]] = []
    for link in ordered:
        for tie in all_ties[link["question_id"]]["ties"]:
            if not tie["on_displayed_deck"] or not tie["pages"]:
                continue
            if tie["granularity"] == "section":
                sections_on_deck.append(((_order(link), tie["section"]["row"] if isinstance(tie["section"]["row"], int) else 10**6, tie["pages"]), link, tie))
            else:
                on_deck.append(((0 if tie["tie"] in COURSE_TIES else 1, _order(link), tie["pages"], tie["suggestion_id"] or ""), link, tie))
    on_deck.sort(key=lambda entry: entry[0])  # the course's own anchors first, then suggestions; catalog order inside each
    sections_on_deck.sort(key=lambda entry: entry[0])

    concepts_of_question = {question_id: {k.get("concept_id") for k in question.get("criteria") or [] if k.get("concept_id")} for question_id, question in questions.items()}
    related_order = sorted(ordered, key=lambda link: (lecture_id not in (link.get("lecture_ids") or []), _order(link)))
    slides_by_page = {slide["page"]: slide for slide in view.get("slides") or []}

    def supported_on(page: int) -> dict[str, str]:
        raw = concepts_of_page(page) if concepts_of_page is not None else ((slides_by_page.get(page) or {}).get("concepts") or [])
        out = {}
        for entry in raw or []:
            concept_id = entry if isinstance(entry, str) else entry.get("concept_id")
            if concept_id:
                out[concept_id] = (concept_table.get(concept_id) or {}).get("label") or (entry.get("label") if isinstance(entry, dict) else None) or concept_id
        return out

    related_cache: dict[tuple, list[tuple[dict, list[dict]]]] = {}

    def related_for(members: list[int], here: list[tuple[dict, dict]]) -> list[tuple[dict, list[dict]]]:
        key = tuple(members)
        if key not in related_cache:
            supported: dict[str, tuple[str, str]] = {}  # concept id -> (label, where the support comes from)
            for page in members:
                for concept_id, label in supported_on(page).items():
                    supported[concept_id] = (label, "page_concepts")
            for _, tie in here:  # what a suggested link says THESE pages support counts as support of the logical slide, and is marked as coming from a suggestion
                for criterion in tie["criteria"] or []:
                    carried_here = criterion["pages"] is None or any(page in members for page in criterion["pages"])
                    if criterion["concept_id"] and carried_here:
                        supported.setdefault(criterion["concept_id"], (criterion["concept_label"] or criterion["concept_id"], "suggested_link"))
            tied = {link["question_id"] for link, _ in here}
            rows = []
            for link in related_order if supported else []:
                shared = concepts_of_question.get(link["question_id"], set()) & set(supported)
                if shared and link["question_id"] not in tied:
                    rows.append((link, sorted(({"concept_id": k, "label": supported[k][0], "basis": supported[k][1]} for k in shared), key=lambda v: (v["label"], v["concept_id"]))))
            related_cache[key] = rows
        return related_cache[key]

    def here_count(tie: dict, page: int, support_pages: list[int], support: dict[int, list[str]] | None) -> int | None:
        """How many of the listed criteria this page carries; for a tie that is not on this page, how many the member
        pages it names carry together. ``None`` when the producer said nothing about one of those pages."""
        if tie["tie"] != "agent_inferred" or support is None:
            return None
        scope = [page] if page in tie["pages"] else support_pages
        if any(p not in support for p in scope):
            return None
        return len({criterion_id for p in scope for criterion_id in support[p]})

    def head(link: dict) -> dict:
        return {"question_id": link["question_id"], "collection": link.get("collection"), "number": link.get("number"), "title": link.get("title"),
                "prompt": (questions.get(link["question_id"]) or {}).get("prompt"), "prompt_in_index": link.get("prompt_in_index")}

    for slide in view.get("slides") or []:
        page = slide["page"]
        members = members_of.get(page, (None, [page]))[1]
        here = [(link, tie) for _, link, tie in on_deck if any(p in tie["pages"] for p in members)]
        rows = []
        for link, tie in here:
            where, support_pages = where_of(page, members, tie["pages"])
            count = here_count(tie, page, support_pages, all_ties[link["question_id"]]["support"].get(id(tie)))
            rows.append({**head(link), "tie": tie["tie"], "granularity": "page", "from": tie["from"], "catalog_field": tie["catalog_field"], "section": None,
                         "where": where, "support_pages": support_pages, "other_pages": [p for p in tie["pages"] if p not in members],
                         **{k: tie[k] for k in ("transcript_lines", *_NO_SUGGESTION_FIELDS)}, "criteria_supported_here": count,
                         "why": _why(tie, where, support_pages, count), "evidence": evidence(link["question_id"])})
        related = related_for(members, here)
        slide["question_ties"] = rows
        # A section is a range of physical pages the course states; it names no page, so it has no "where" and no support page.
        slide["section_ties"] = [{**head(link), "tie": tie["tie"], "granularity": "section", "from": tie["from"], "catalog_field": None,
                                  "section": {**tie["section"], "page_ranges": [list(r) for r in tie["section"]["page_ranges"]]}, "where": None, "support_pages": [], "other_pages": [],
                                  **{k: tie[k] for k in ("transcript_lines", *_NO_SUGGESTION_FIELDS)}, "criteria_supported_here": None,
                                  "why": f"The course's study map places this question in the section on {_ranges_text(tie['section']['page_ranges']) if tie['section']['page_ranges'] else _pages_text(tie['pages'])}; "
                                         "it names no single page.",
                                  "evidence": evidence(link["question_id"])} for _, link, tie in sections_on_deck if page in tie["pages"]]
        slide["related_questions"] = [{"question_id": link["question_id"], "collection": link.get("collection"), "number": link.get("number"), "title": link.get("title"),
                                       "prompt_in_index": link.get("prompt_in_index"), "tie": "concept_related", "via_concepts": [dict(v) for v in via],
                                       "lecture_ids": list(link.get("lecture_ids") or []), "evidence": evidence(link["question_id"])} for link, via in related[:RELATED_CAP]]
        slide["related_questions_total"] = len(related)

    # ---- the lecture's question lists --------------------------------------------------------------------------
    block = view.setdefault("questions", {})
    counts = {"all": 0, "course_anchor": 0, "agent_inferred": 0, "without_link": 0, "course_section": 0, "course_anchor_with_suggestion": 0}
    nothing = {"ties": [], "no_link": {"state": "no_suggestion", "reason": "no_item"}, "suggestion_history": {"stale": 0, "rejected_by_verifier": 0, "rejected_by_learner": [], "decisions_not_shown": []}}
    for name in ("all", "related_by_relationship"):
        for row in block.get(name) or []:
            mine = all_ties.get(row["question_id"]) or nothing
            row["ties"] = [dict(t) for t in mine["ties"]]
            row["no_link"] = dict(mine["no_link"]) if mine["no_link"] else None
            row["suggestion_history"] = {**mine["suggestion_history"], "rejected_by_learner": [dict(d) for d in mine["suggestion_history"]["rejected_by_learner"]],
                                         "decisions_not_shown": [dict(d) for d in mine["suggestion_history"]["decisions_not_shown"]]}
            row["evidence"] = evidence(row["question_id"])
            if name == "all":
                page_ties = [t for t in row["ties"] if t["granularity"] == "page"]
                counts["all"] += 1
                anchored = any(t["tie"] in COURSE_TIES for t in page_ties)
                counts["course_anchor" if anchored else "agent_inferred" if page_ties else "without_link"] += 1
                # A part of course_anchor, never a fourth kind: the course anchors it (to whatever file) AND a suggestion names pages for it.
                counts["course_anchor_with_suggestion"] += anchored and any(t["tie"] == "agent_inferred" for t in page_ties)
                counts["course_section"] += any(t["granularity"] == "section" for t in row["ties"])  # counted beside the three kinds above, never as one of them
    block["counts"] = counts
    block["ties_version"] = TIES_VERSION
    return view
