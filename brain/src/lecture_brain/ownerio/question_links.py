"""Read-side links between catalogued questions, lecture units and source locations (R1-Q1…Q4).

Nothing here writes to a course and nothing is inferred from an id or a title. Three facts are kept apart:

* **collection membership** — the catalog's own ``collection`` field; a collection belongs to a lecture unit when the
  source its questions cite is a file of that unit (exact id join against the inventory);
* **anchors** — where the catalog's locator points, normalised into typed anchors: pages of the cited file, line ranges
  of the unit's transcript, pages of another named source. A list is kept as the list that was written;
* **original and rendition** — the authoritative file of a question whose wording is not in the catalog, and a
  displayable copy only where the course index relates the two and a check of the two was recorded.

A locator this module cannot read is reported as unparsed or unresolved, with its wording. It is never guessed.
"""
from __future__ import annotations

from collections import Counter
import re
from typing import Any, Iterable

LINKS_VERSION = "question-links/1"
MAX_SPAN = 500  # a "range" wider than this is a typo or another numbering, not a run of slides
_ITEM = r"\d+(?:\s*[-–]\s*\d+)?"
_LIST = rf"{_ITEM}(?:\s*,\s*{_ITEM})*"
_FORMS = (
    ("pages", "in_class_question_sheet", re.compile(rf"(?i)^in-class question\s+(?:pdf\s+)?pages?\s+({_LIST})(.*)$")),
    ("pages", "cited", re.compile(rf"(?i)^(?:pdf\s+)?(?:slides?|pages?)\s+({_LIST})(.*)$")),
    ("transcript_lines", "unit_transcript", re.compile(rf"(?i)^transcript(?:\s+lines?)?\s+({_LIST})(.*)$")),
)
_OPENABLE = {"registered_readable", "present_unindexed"}


def _ranges(text: str) -> list[list[int]] | None:
    out = []
    for part in text.split(","):
        numbers = [int(n) for n in re.split(r"\s*[-–]\s*", part.strip())]
        start, end = numbers[0], numbers[-1]
        if start < 1 or end < start or end - start > MAX_SPAN:
            return None
        out.append([start, end])
    return out


def _tail(rest: str) -> tuple[bool, list[str]]:
    """What follows a number list: nothing, ``(a note)``, ``, a note`` or `` a note``. Anything glued to the digits is malformed."""
    if not rest:
        return True, []
    if rest[0] not in " ,(\t":
        return False, []
    note = rest.strip().lstrip(",").strip()
    if note.startswith("(") and note.endswith(")"):
        note = note[1:-1].strip()
    return True, [note] if note else []


def parse_locator(text: str | None) -> dict[str, Any]:
    """Normalise one free-text catalog locator. Clauses are separated by ``;`` and each is read on its own."""
    anchors: list[dict] = []
    qualifiers: list[str] = []
    unparsed: list[str] = []
    for clause in [c.strip() for c in (text or "").split(";") if c.strip()]:
        for kind, target, pattern in _FORMS:
            match = pattern.match(clause)
            if not match:
                continue
            ok, notes = _tail(match.group(2))
            ranges = _ranges(match.group(1)) if ok else None
            if ranges is None:
                unparsed.append(clause)
            else:
                anchor = {"kind": kind, "target": target, "ranges": ranges}
                if kind == "pages":
                    anchor["pages"] = sorted({n for a, b in ranges for n in range(a, b + 1)})
                anchors.append(anchor)
                qualifiers.extend(notes)
            break
        else:
            if re.match(r"(?i)^(?:pdf\s+)?(?:slides?|pages?|transcript)\s+\d", clause):
                unparsed.append(clause)  # it starts like an anchor but is not one this reader understands
            else:
                qualifiers.append(clause)
    state = "unresolved" if not anchors else ("partial" if unparsed else "resolved")
    return {"text": text or "", "anchors": anchors, "qualifiers": qualifiers, "unparsed": unparsed, "state": state}


def _items(inventory: dict) -> Iterable[tuple[dict, str | None]]:
    for lecture in inventory["lectures"]:
        for item in [*lecture["decks"], *lecture["extra_materials"]]:
            yield item, lecture["lecture_id"]
    for session in inventory["sessions"]:
        for item in session["items"]:
            yield item, None
    for item in inventory["other_sources"]:
        yield item, None


def _displayable(item: dict | None) -> bool:
    return bool(item) and item["state"] in _OPENABLE and item["rendition"] == "native_pdf"


def _file(item: dict | None, page: int | None = None) -> dict | None:
    if item is None:
        return None
    return {"source_id": item["source_id"], "filename": item["filename"], "kind": item["kind"], "available": item["state"] in _OPENABLE and bool(item["path"]),
            "displayable": _displayable(item), "disclosure": item["disclosure"], "page": page}


def build_question_bank(index: dict | None, inventory: dict, *, reviewed_collections: Iterable[str] = (), rendition_checks: dict | None = None) -> dict[str, Any]:
    """Every catalogued question with its collection, lecture membership, typed anchors and source-opening actions."""
    reviewed = set(reviewed_collections)
    checks = rendition_checks or {}
    by_id: dict[str, dict] = {}
    by_path: dict[str, dict] = {}
    unit_of: dict[str, str] = {}
    for item, lecture_id in _items(inventory):
        by_id.setdefault(item["source_id"], item)
        if item["path"]:
            by_path.setdefault(item["path"], item)
        if lecture_id:
            unit_of[item["source_id"]] = lecture_id
    transcripts: dict[str, list[dict]] = {}
    sheets: dict[str, list[dict]] = {}
    for lecture in inventory["lectures"]:
        transcripts[lecture["lecture_id"]] = [i for s in lecture["sessions"] for i in s["items"] if i["kind"] == "lecture_transcript"]
        sheets[lecture["lecture_id"]] = [i for i in [*lecture["decks"], *lecture["extra_materials"]] if i["kind"] == "in_class_question_sheet"]

    questions: dict[str, dict] = {}
    for question in ((index or {}).get("questions") or {}).values():
        collection = question.get("collection")
        basis = "exact" if collection in reviewed else "stated"
        cited = [r.get("source_id") for r in question.get("source_refs") or [] if r.get("source_id")]
        lecture_ids = sorted({unit_of[s] for s in cited if s in unit_of})
        anchors: list[dict] = []
        qualifiers: list[str] = []
        unparsed: list[str] = []
        locator_text = []
        for ref in question.get("source_refs") or []:
            parsed = parse_locator(ref.get("locator") if isinstance(ref.get("locator"), str) else None)
            locator_text.append(parsed["text"])
            qualifiers.extend(parsed["qualifiers"])
            unparsed.extend(parsed["unparsed"])
            unit = unit_of.get(ref.get("source_id"))
            for anchor in parsed["anchors"]:
                row = {"kind": anchor["kind"], "ranges": anchor["ranges"], "basis": basis, "from": "locator", "lecture_id": unit}
                if anchor["kind"] == "pages" and anchor["target"] == "cited":
                    row.update(source_id=ref.get("source_id"), pages=anchor["pages"], page_basis="one_based_physical_page")
                elif anchor["kind"] == "pages":
                    found = sheets.get(unit, []) if unit else []
                    row.update(source_id=found[0]["source_id"] if len(found) == 1 else None, pages=anchor["pages"], page_basis="one_based_physical_page",
                               named_source=anchor["target"], resolution="unit_question_sheet" if len(found) == 1 else "named_source_not_unique_in_unit")
                else:
                    found = transcripts.get(unit, []) if unit else []
                    row.update(source_id=found[0]["source_id"] if len(found) == 1 else None,
                               resolution="unit_transcript" if len(found) == 1 else ("no_transcript_linked_to_unit" if not found else "transcript_not_unique"))
                anchors.append(row)
        original_item = by_path.get(question.get("source_path") or "") or (by_id.get(cited[0]) if cited else None)
        bank_item = by_path.get(question.get("bank_path") or "")
        page = question.get("page") if isinstance(question.get("page"), int) and question["page"] > 0 else None
        # The catalog's structured page counts pages of a PDF: the bank copy when there is one, else the original if that is a PDF.
        paged = bank_item if _displayable(bank_item) else (original_item if _displayable(original_item) and question.get("source_path") else None)
        if page and paged is not None and not any(a["kind"] == "pages" and a["source_id"] == paged["source_id"] and page in a["pages"] for a in anchors):
            anchors.append({"kind": "pages", "ranges": [[page, page]], "pages": [page], "basis": basis, "from": "page_field", "source_id": paged["source_id"],
                            "lecture_id": unit_of.get(paged["source_id"]), "page_basis": "one_based_physical_page"})
        rendition = None
        related_copy = None
        if original_item is not None and not _displayable(original_item) and bank_item is not None and bank_item["source_id"] != original_item["source_id"] and _displayable(bank_item):
            related = original_item["source_id"] in (bank_item.get("related_source_ids") or []) or bank_item["source_id"] in (original_item.get("related_source_ids") or [])
            check = checks.get(original_item["source_id"]) or {}
            verified = (related and check.get("result") == "match" and check.get("rendition_source_id") == bank_item["source_id"]
                        and check.get("original_sha256") == original_item.get("sha256") and check.get("rendition_sha256") == bank_item.get("sha256"))
            copy = dict(_file(bank_item, page), index_relation=related)
            if verified:
                rendition = dict(copy, label="Display rendition", verification={k: check.get(k) for k in ("method", "checked_at", "score", "scope")},
                                 note="A copy for reading. The original file remains the authoritative source.")
            else:
                related_copy = dict(copy, note="A copy exists but has not been checked against the original" if related else "A file named by the catalog; the course index does not relate it to the original")
        deck_pages = [a for a in anchors if a["kind"] == "pages" and a.get("lecture_id")]
        questions[question["question_id"]] = {
            "question_id": question["question_id"], "version": question.get("version"), "collection": collection, "number": question.get("number"), "title": question.get("title"),
            "origin": question.get("origin"), "topic": question.get("topic"), "prompt_in_index": bool(question.get("prompt_in_index", bool(question.get("prompt")))),
            "family_id": question.get("family_id"), "family_revision": question.get("family_revision"), "criteria_count": len(question.get("criteria") or []),
            "criteria_authorship": "tutor_authored" if question.get("origin") == "course_source" else "catalog",
            "lecture_ids": lecture_ids, "membership": ({"basis": "cited_source_in_unit", "source_ids": [s for s in cited if s in unit_of]} if lecture_ids
                                                       else {"basis": "not_a_lecture_file", "source_ids": cited}),
            "anchors": anchors, "anchor_state": "unresolved" if not anchors else ("partial" if unparsed else "resolved"),
            "slide_anchor": "named" if deck_pages else "none", "locator_text": "; ".join(t for t in locator_text if t), "qualifiers": qualifiers, "unparsed": unparsed,
            "original": _file(original_item, page if original_item is not None and paged is original_item else None), "display_rendition": rendition, "related_copy": related_copy,
            "source_note": question.get("source_note"),
        }

    def order(q: dict) -> tuple:
        return (str(q["collection"]), q["number"] if isinstance(q["number"], int) else 10**6, q["question_id"])

    collections: dict[str, dict] = {}
    for q in sorted(questions.values(), key=order):
        row = collections.setdefault(str(q["collection"]), {"collection": q["collection"], "count": 0, "lecture_ids": set(), "cited_source_ids": set(), "origins": Counter(),
                                                           "without_wording": 0, "slide_named": 0, "anchor_unresolved": 0, "question_ids": []})
        row["count"] += 1
        row["lecture_ids"] |= set(q["lecture_ids"])
        row["cited_source_ids"] |= set(q["membership"]["source_ids"])
        row["origins"][q["origin"]] += 1
        row["without_wording"] += 0 if q["prompt_in_index"] else 1
        row["slide_named"] += 1 if q["slide_anchor"] == "named" else 0
        row["anchor_unresolved"] += 1 if q["anchor_state"] == "unresolved" else 0
        row["question_ids"].append(q["question_id"])
    for row in collections.values():
        row.update(lecture_ids=sorted(row["lecture_ids"]), cited_source_ids=sorted(row["cited_source_ids"]), origins=dict(row["origins"]),
                   page_basis_reviewed=row["collection"] in reviewed)
    lectures = {}
    for lecture in inventory["lectures"]:
        mine = [c for c in collections.values() if lecture["lecture_id"] in c["lecture_ids"]]
        lectures[lecture["lecture_id"]] = {"lecture_id": lecture["lecture_id"], "collections": [c["collection"] for c in mine],
                                           "question_ids": [q for c in mine for q in c["question_ids"]],
                                           "gap": None if mine else "No question collection in the course catalog cites a file of this lecture unit."}
    return {"links_version": LINKS_VERSION, "total": len(questions), "questions": questions, "collections": [collections[k] for k in sorted(collections)], "lectures": lectures,
            "note": "Collection membership comes from the catalog and the files its questions cite. A slide is named only where the catalog names one."}
