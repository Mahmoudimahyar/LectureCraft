"""Slide identity for the lecture view: the seam between the source map and everything that shows "a slide".

``sourcemap.py`` knows what a file holds (R2-S1 … R2-S11); this module hands that to the lecture view in the spelling of
``docs/engineering/r2-read-api.md`` 1.1 and 1.2 and decides nothing about slides itself:

* :func:`map_for` — the map of a unit's DISPLAYED deck through ``sourcemap.load_or_build``, or the reason there is none;
* :func:`block` — the ``source_map`` object of the lecture view (logical slides, denominators, limitations);
* :func:`enrich` — ``source_map`` on a lecture view and ``identity`` + ``role`` on every ``slides[]`` row;
* :func:`alignment_slides`, :func:`alignment_groups`, :func:`grouping_state`, :func:`logical_slide_of`,
  :func:`label_for`, :func:`pages_of` — the same identity for the other consumers (timing, questions, concepts), so
  that none computes its own;
* :func:`prebuild` — maps built ahead of time by the preparation queue or a command;
* :func:`register` — the two routes: the stored map, and a learner's correction.

What stays true whatever the map says: ``slides[]`` keeps one row per physical page in page order, so ``?page=N`` always
means physical page N of the displayed deck. A label words only what the map establishes (``sourcemap.describe_page``);
with no map every page is still ``PDF page N of M`` with an unknown role, and nothing is invented: no grouping, no
printed number, no PowerPoint slide. A role never removes a page.

The module's group kinds are spelled for the read API as ``single`` → ``single``, ``incremental_build`` →
``build_group`` ("build k of n"), ``animation_steps`` → ``step_group`` ("step k of n"), ``duplicate`` →
``duplicate_group`` ("copy k of n") and ``manual_group`` → ``manual_group`` ("part k of n"). A group a correction
declares with a kind keeps that kind, with ``grouping.basis = "override"``.

``grouping.state`` says who established that the pages are one slide (:func:`grouping_state`): ``generated`` for
everything the detector read, also for a group that a correction beside it left behind; ``agent_reviewed`` or
``human_confirmed`` only for a grouping a correction made, by the authors of the corrections that join the pages (for
a page that was cut off: of the cuts).

The denominators count physical pages: ``raw`` is every page, ``instructional`` the pages whose role is instructional,
worked example or question, or mixed, ``excluded`` the pages whose role forces nothing (structural, administrative,
blank) and ``uncertain`` the rest (objectives or summary, and unknown). The three add up to ``raw``, as do the counts of
``by_role``; a page of unknown role is never excluded. With no map nothing was classified, so only ``raw`` is a number.

A request never waits long for a map: one that is stored is read (and then kept in memory until the file or its
corrections change); one that is not stored is built during the request only within ``REQUEST_BUILD_MAX_BYTES`` and
``REQUEST_BUILD_MAX_PAGES``, and is otherwise ``not_built`` until :func:`prebuild` has run.

Everything here reads the course folder and writes only what ``sourcemap`` writes: its cache and the correction
revisions under ``settings.app_area(course_id) / "source-map"``.
"""
from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
import os
import re
import threading
import time
from typing import Any

from fastapi import HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pypdf import PdfReader

from . import sourcemap as sm
from .config import Settings
from .ownerio.inventory import build_inventory, primary_deck

__all__ = ["REASONS", "KIND_NAMES", "POSITION_WORDS", "OPS", "REQUEST_BUILD_MAX_BYTES", "REQUEST_BUILD_MAX_PAGES", "map_for", "prebuild", "forget", "displayed_deck",
           "block", "unavailable_block", "enrich", "page_rows", "grouping_state", "alignment_groups", "alignment_slides", "logical_slide_of", "label_for", "pages_of",
           "correction_from", "register"]

REASONS = ("no_deck", "not_a_pdf", "unreadable", "not_built")
# The request-time bound. A deck that has no stored map yet is inspected during a request only when its file is at most
# this large and has at most this many pages; anything larger answers "not_built" until prebuild() has run. Measured on
# the decks this app is used with: every file within the bound was mapped in under four seconds, and the files that took
# twelve seconds or more were all larger than the byte bound. A stored map is read whatever its size.
REQUEST_BUILD_MAX_BYTES = 8 * 1024 * 1024
REQUEST_BUILD_MAX_PAGES = 120
_MEMO_ENTRIES = 32  # maps kept in memory, most recently used last
# How sourcemap's kinds of logical slide are spelled in the read API.
KIND_NAMES = {"single": "single", "incremental_build": "build_group", "animation_steps": "step_group", "duplicate": "duplicate_group", "manual_group": "manual_group"}
# The word for a page's place in its group, as sourcemap.describe_page words it; a group joined by a correction without a kind is "part".
POSITION_WORDS = {"incremental_build": "build", "animation_steps": "step", "duplicate": "copy"}
_PART = "part"
_BASIS = {"none": "page", "uncertain": "page", "inferred": "inferred", "override": "override"}  # uncertain means the page alone
_INSTRUCTIONAL = ("instructional", "worked_example_or_question", "mixed")
_EXCLUDED = ("structural_title_or_section", "administrative", "blank")  # the roles that carry no forced requirement
_SOURCE_KEYS = ("source_id", "version_id", "sha256")
_TEXT_LIMITATION = "Text extraction cannot tell covered text from visible text."
_GROUP_LIMITATION = "Page groups are read from the text, pictures and drawing operations in the file. Nothing was rendered, so a group is a proposal until someone has looked."
_NO_MAP = {
    "no_deck": "No slide deck is selected for this unit, so there is no source map.",
    "not_a_pdf": "The displayed deck is not a PDF file, so no source map is built for it.",
    "unreadable": "The deck file could not be read, so there is no source map for it.",
    "not_built": "The source map of this deck has not been built yet. The preparation step builds it ahead of time; a file over the source map's size bound is never mapped.",
}
_NO_MAP_CONSEQUENCE = "Without a source map each page is identified by its index only: no grouping, printed number, PowerPoint match or role is known."


# ---- the map of the displayed deck -------------------------------------------------------------------------------------
class _WouldInspect(Exception):
    """Raised in place of the first clock reading of an inspection: the stored map was asked for, and there is none."""


def _no_inspection() -> float:
    # sourcemap.load_or_build consults its clock only when it starts to inspect a file; a stored map is returned without it.
    raise _WouldInspect()


_LOCK = threading.Lock()
_MEMO: OrderedDict[tuple, tuple[dict | None, str | None, str | None]] = OrderedDict()  # (file, companions, limits, corrections on disk) -> (map, reason, what stopped the inspection)
_CORRECTIONS: dict[tuple, Path] = {}  # file -> the folder its correction revisions are stored in, known once a map of it was read
_REVISION_FILE = re.compile(r"^r\d{4}\.json$")
_PAGE_ID = re.compile(r"^p(\d+)$")  # the id alignment.logical_slides_from_pages gives a page that is in no group


def forget() -> None:
    """Drop what this process keeps in memory. Nothing stored is touched: the next read comes from the store."""
    with _LOCK:
        _MEMO.clear()
        _CORRECTIONS.clear()


def displayed_deck(lecture: dict, requested: str | None = None) -> dict | None:
    """The deck a unit is shown with: the one the request names when it is a file of the unit, else the unit's own choice."""
    if requested:
        chosen = next((deck for deck in lecture.get("decks") or [] if deck["source_id"] == requested), None)
        if chosen is not None:
            return chosen
    return primary_deck(lecture)


def _corrections_on_disk(directory: Path) -> int:
    try:
        with os.scandir(directory) as entries:
            return sum(1 for entry in entries if _REVISION_FILE.match(entry.name))
    except OSError:
        return 0


def _companions_key(root: Path, lecture: dict | None, deck: dict) -> tuple:
    """The presentations of the unit that the source map tries for slide identity, by what their files are now."""
    found = []
    for other in (lecture or {}).get("decks") or []:
        if other.get("source_id") == deck.get("source_id") or not other.get("path") or Path(other.get("filename") or "").suffix.lower() != ".pptx":
            continue
        try:
            stat = (root / other["path"]).stat()
        except OSError:
            continue
        found.append((other["source_id"], stat.st_size, stat.st_mtime_ns))
    return tuple(sorted(found))


def _within_request_bound(path: Path, size: int) -> bool:
    if size > REQUEST_BUILD_MAX_BYTES:
        return False
    try:
        return len(PdfReader(str(path)).pages) <= REQUEST_BUILD_MAX_PAGES
    except Exception:  # noqa: BLE001 - not readable as a PDF: the inspection says what it is, and that is quick
        return True


def _load(settings: Settings, course_id: str, lecture: dict | None, deck: dict | None, limits: sm.Limits | None, build: str, refresh: bool = False) -> tuple[dict | None, str | None, str | None]:
    """``(map, reason, how)``. For a map ``how`` is ``memory``, ``stored`` or ``built``. When there is none it is the
    source map's own word for what stopped the inspection (``byte_limit``, ``encrypted`` …), or ``None`` when no
    inspection was asked for."""
    if deck is None:
        return None, "no_deck", None
    name = deck.get("filename") or deck.get("path")
    if name and Path(name).suffix.lower() != ".pdf":
        return None, "not_a_pdf", None
    if not deck.get("path"):  # the course lists the deck, but there is no file to read
        return None, "unreadable", None
    root = settings.course(course_id).root
    path = root / deck["path"]
    try:
        stat = path.stat()
    except OSError:
        return None, "unreadable", None
    if not path.is_file() or stat.st_size == 0:
        return None, "unreadable", None
    limits = limits or sm.Limits()
    # What the file is now, and what the course index declares it to be: the map names its source by both, so an index
    # that re-declares the same bytes (a deck replaced on disk first and indexed later) is another answer.
    file_key = (str(settings.app_area(course_id)), deck["source_id"], str(path), stat.st_size, stat.st_mtime_ns, deck.get("version_id"), deck.get("sha256"), deck.get("registration"))
    partners = _companions_key(root, lecture, deck)
    if not refresh:
        with _LOCK:
            directory = _CORRECTIONS.get(file_key)
        if directory is not None:
            key = (file_key, partners, limits, _corrections_on_disk(directory))
            with _LOCK:
                hit = _MEMO.get(key)
                if hit is not None:
                    _MEMO.move_to_end(key)
                    return hit[0], hit[1], "memory" if hit[0] is not None else hit[2]
    how = "built"
    try:
        if refresh:
            source_map = sm.load_or_build(settings, course_id, deck, lecture=lecture, limits=limits, refresh=True)
        else:
            try:
                source_map = sm.load_or_build(settings, course_id, deck, lecture=lecture, limits=limits, clock=_no_inspection)
                how = "stored"
            except _WouldInspect:
                if build == "never" or (build == "bounded" and not _within_request_bound(path, stat.st_size)):
                    return None, "not_built", None
                source_map = sm.load_or_build(settings, course_id, deck, lecture=lecture, limits=limits)
    except (OSError, sm.SourceMapError):  # the file changed or went away while it was read: a failure of the moment
        return None, "unreadable", None
    inspection = source_map.get("inspection") or {}
    result = (source_map, None, None) if source_map.get("page_count") and source_map.get("pages") else (None, _reason_of(source_map), inspection.get("reason"))
    sha = (source_map.get("source") or {}).get("sha256")
    if sha and source_map.get("cache") is not None and not inspection.get("transient") and inspection.get("status") != "unavailable":
        # Settled: what the bytes are, not what happened to this read. Kept until the file or its corrections change.
        directory = sm._source_dir(settings, course_id, deck["source_id"]) / sha[:16] / "overrides"
        on_disk = _corrections_on_disk(directory)
        if on_disk == len((source_map.get("overrides") or {}).get("history") or []):  # else a correction landed meanwhile, or the chain is damaged: read again next time
            with _LOCK:
                _CORRECTIONS[file_key] = directory
                _MEMO[(file_key, partners, limits, on_disk)] = result
                _MEMO.move_to_end((file_key, partners, limits, on_disk))
                while len(_MEMO) > _MEMO_ENTRIES:
                    _MEMO.popitem(last=False)
                for stale in [known for known in _CORRECTIONS if not any(key[0] == known for key in _MEMO)]:
                    del _CORRECTIONS[stale]
    return result[0], result[1], how if result[0] is not None else result[2]


def map_for(settings: Settings, course_id: str, lecture: dict | None, deck: dict | None, *, limits: sm.Limits | None = None, build: str = "bounded") -> tuple[dict | None, str | None]:
    """``(source_map, None)`` for the unit's displayed ``deck``, or ``(None, reason)``.

    ``lecture`` is the unit of ``build_inventory`` and ``deck`` the item it is shown with (:func:`displayed_deck`); the
    presentations of the unit are handed to ``sourcemap.load_or_build`` as companions. Reasons: ``no_deck``;
    ``not_a_pdf`` (a presentation, or anything else that has no pages to map); ``unreadable`` (missing, empty, damaged,
    encrypted, or not readable just now); ``not_built`` (no map is stored for these bytes and building one now would
    exceed the request-time bound, or the file is over the source map's own byte bound).

    ``build`` says what may happen when no map is stored: ``"bounded"`` (the default, for a request) inspects the file
    only within ``REQUEST_BUILD_MAX_BYTES`` and ``REQUEST_BUILD_MAX_PAGES``; ``"always"`` inspects it whatever its
    size (the preparation step); ``"never"`` only reads the store.

    A settled answer is kept in memory per file path, size, modification time, what the course index declares the file
    to be (version id, digest, registration), companions, limits and the number of correction revisions on disk, so a
    lecture view does not read the stored JSON on every request. A failure of the moment (a read error, an inspection
    cut short) is never kept. The returned map is shared: read it, do not change it.

    ``not_built`` is also the answer whenever an input of the stored map changed without the bytes changing — the
    index re-declares the file, or a presentation is added to or changed in the unit — and the deck is over the request
    bound: :func:`prebuild` has to run again then, not only when the deck file changes.
    """
    if build not in {"bounded", "always", "never"}:
        raise ValueError("build must be bounded, always or never")
    source_map, reason, _ = _load(settings, course_id, lecture, deck, limits, build)
    return source_map, reason


def prebuild(settings: Settings, course_id: str, *, lecture_id: str | None = None, every_deck: bool = False, refresh: bool = False, limits: sm.Limits | None = None) -> dict[str, Any]:
    """Build the maps of a course's displayed decks ahead of time (the preparation queue, or a command) and count.

    One unit when ``lecture_id`` is given (``ValueError`` when the course has no such unit). ``every_deck`` also maps
    the unit's other PDF files, which a request can choose to display. ``refresh`` inspects again what is stored.
    Counts: ``lectures``, ``decks``, ``built`` (inspected now), ``already_built`` (stored before), ``partial`` (mapped,
    with pages that could not be inspected), one count per reason there is no map, ``pages`` and ``seconds``; ``items``
    lists each deck with its state and, when there is no map, ``detail``: the source map's own word for what stopped
    the inspection. ``not_built`` with ``detail == "byte_limit"`` is a file over the source map's size bound: no later
    run maps it. Reads the course folder; writes only under the app's own area.

    Run it again when the course index re-declares a deck or a presentation of a unit is added or changed: a stored map
    is found by those inputs too, not by the deck's bytes alone.
    """
    lectures = [unit for unit in build_inventory(settings.course(course_id))["lectures"] if lecture_id is None or unit["lecture_id"] == lecture_id]
    if lecture_id is not None and not lectures:
        raise ValueError(f"course {course_id!r} has no lecture unit {lecture_id!r}")
    counts: dict[str, Any] = {"course_id": course_id, "lectures": len(lectures), "decks": 0, "built": 0, "already_built": 0, "partial": 0, **{reason: 0 for reason in REASONS},
                              "pages": 0, "seconds": 0.0, "items": []}
    started = time.monotonic()
    for lecture in lectures:
        shown = primary_deck(lecture)
        decks: list[dict | None] = [shown]
        if every_deck:
            decks += [deck for deck in lecture["decks"] if deck is not shown and Path(deck.get("filename") or "").suffix.lower() == ".pdf"]
        for deck in decks:
            tick = time.monotonic()
            source_map, reason, how = _load(settings, course_id, lecture, deck, limits, "always", refresh)
            state = reason or ("built" if how == "built" else "already_built")
            counts[state] += 1
            counts["decks"] += deck is not None
            partial = source_map is not None and (source_map.get("inspection") or {}).get("status") == "partial"
            counts["partial"] += partial
            counts["pages"] += source_map["page_count"] if source_map is not None else 0
            counts["items"].append({"lecture_id": lecture["lecture_id"], "source_id": deck["source_id"] if deck else None, "displayed": deck is shown, "state": state,
                                    "detail": how if reason else None, "page_count": source_map["page_count"] if source_map is not None else None, "logical_slides": len(source_map["logical_slides"]) if source_map is not None else None,
                                    "map_revision": source_map["map_revision"] if source_map is not None else None, "partial": partial, "seconds": round(time.monotonic() - tick, 2)})
    counts["seconds"] = round(time.monotonic() - started, 2)
    return counts


# ---- who established something -------------------------------------------------------------------------------------
def _history(source_map: dict) -> dict[int, dict]:
    return {entry["revision"]: entry for entry in (source_map.get("overrides") or {}).get("history") or []}


def _review_state(history: dict[int, dict], revisions: list[Any]) -> str:
    """``human_confirmed`` when a correction in play is the learner's (or made on the learner's say), ``agent_reviewed``
    when corrections are an agent's alone, ``generated`` when nothing but the detector spoke."""
    kinds = set()
    for revision in revisions:
        author = (history.get(revision) or {}).get("author")
        if isinstance(author, dict):
            kinds.add("learner" if author.get("kind") == "learner" or author.get("learner_authority") else author.get("kind"))
        elif isinstance(author, str):
            kinds.add(author)
    return "human_confirmed" if "learner" in kinds else "agent_reviewed" if "agent" in kinds else "generated"


def _joins(entry: dict | None, first: int, last: int) -> bool:
    """Whether a correction of the history joins pages of the run ``first`` … ``last``: a group that holds two of them."""
    op = (entry or {}).get("op") or {}
    pages = op.get("pages") if op.get("type") == "group" else None
    return bool(pages) and max(pages[0], first) < min(pages[-1], last)


def grouping_state(source_map: dict, slide: dict) -> str:
    """Who established that the pages of ``slide`` are one logical slide: ``generated``, ``agent_reviewed`` or
    ``human_confirmed``. ``slide`` is a logical slide of ``source_map`` in the source map's own spelling.

    Only a grouping that a correction made (``grouping == "override"``) is anyone's but the detector's. A group the
    detector inferred stays ``generated`` when a correction cuts beside it: a split before page 5 says where page 5
    starts, not that pages 3 and 4 are one slide. For a group a correction joined, the state is that of the corrections
    that join its pages; a cut at its edge by someone else does not confirm the join. For a page a correction cut off,
    it is that of the cuts. The source map lists on a slide every correction at its boundaries (``slide.overrides``),
    which is why this is decided here and not read off that list. Every consumer that words a grouping uses this.
    """
    if slide.get("grouping") != "override":
        return "generated"
    history = _history(source_map)
    revisions, pages = slide.get("overrides") or [], slide.get("pages") or []
    if len(pages) > 1:
        revisions = [revision for revision in revisions if _joins(history.get(revision), pages[0], pages[-1])]
    return _review_state(history, revisions)


# ---- the source_map object (r2-read-api.md 1.1) ----------------------------------------------------------------------
def _signals(source_map: dict, slide: dict) -> list[str]:
    """The signals behind a slide's grouping, in the order they were first seen. For a page kept apart because the
    reading was unsure, the signals of the pairs that were not joined."""
    seen: list[str] = []
    entries = slide.get("evidence") or []
    if not entries and slide.get("grouping") == "uncertain":
        members, others = set(slide["pages"]), set(slide.get("uncertain_with") or [])
        entries = [pair for pair in source_map.get("pairs") or [] if pair.get("decision") == "uncertain" and set(pair["pages"]) & members and set(pair["pages"]) & others]
    for entry in entries:
        for signal in entry.get("signals") or []:
            if signal not in seen:
                seen.append(signal)
    return seen


def _logical(source_map: dict, slide: dict) -> dict[str, Any]:
    grouping = slide.get("grouping")
    return {"id": slide["logical_slide_id"], "kind": KIND_NAMES.get(slide["kind"], "manual_group"), "pages": list(slide["pages"]), "title": slide.get("title"), "role": slide["role"],
            "grouping": {"basis": _BASIS.get(grouping, "page"), "state": grouping_state(source_map, slide),
                         "confidence": "not_established" if grouping == "uncertain" else slide.get("confidence"), "signals": _signals(source_map, slide)}}


def _denominators(source_map: dict) -> dict[str, Any]:
    """Per physical page. ``raw`` is every page; ``instructional`` + ``uncertain`` + ``excluded`` add up to it, and so do
    the counts of ``by_role``. A page of unknown role is listed as uncertain, never as excluded."""
    counts = {role: 0 for role in sm.ROLES}
    for page in source_map["pages"]:
        counts[page["role"]["role"]] += 1
    raw = len(source_map["pages"])
    instructional = sum(counts[role] for role in _INSTRUCTIONAL)
    excluded = sum(counts[role] for role in _EXCLUDED)
    return {"raw": raw, "instructional": instructional, "by_role": counts, "uncertain": raw - instructional - excluded, "excluded": excluded}


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _limitations(source_map: dict) -> list[str]:
    lines = [_TEXT_LIMITATION]
    pages = source_map["pages"]
    if any(len(slide["pages"]) > 1 and slide.get("grouping") == "inferred" for slide in source_map["logical_slides"]):
        lines.append(_GROUP_LIMITATION)
    unknown = [page for page in pages if page.get("status") != "ok"]
    if unknown:
        reasons = ", ".join(sorted({str(page.get("reason")) for page in unknown}))
        again = " The inspection was cut short and is tried again." if (source_map.get("inspection") or {}).get("retry") == "automatic" else ""
        lines.append(f"{_plural(len(unknown), 'page', 'pages')} of {len(pages)} could not be inspected ({reasons}); they stay in the list with an unknown role.{again}")
    unsure = sum(1 for slide in source_map["logical_slides"] if slide.get("grouping") == "uncertain")
    if unsure:
        lines.append(f"Grouping is not established for {_plural(unsure, 'page', 'pages')} that share content with a neighbour; each of them stands alone.")
    doubtful = sum(1 for page in pages if page["role"]["role"] in _EXCLUDED and page["role"].get("uncertain"))
    if doubtful:
        lines.append(f"{_plural(doubtful, 'page is', 'pages are')} counted as excluded on a role the detector is unsure of.")
    pptx = source_map.get("pptx")
    if pptx is not None and (pptx.get("alignment") or {}).get("status") != "supported":
        lines.append("A PowerPoint file of this unit exists, but its slides were not matched to these pages; no PowerPoint slide number is shown.")
    earlier = sum(len(version.get("overrides_not_applied") or []) for version in source_map.get("other_source_versions") or [])
    if earlier:
        lines.append(f"{_plural(earlier, 'correction', 'corrections')} made for other bytes of this file {'was' if earlier == 1 else 'were'} not carried over to this version.")
    problems = (source_map.get("overrides") or {}).get("problems") or []
    if problems:
        lines.append(f"{_plural(len(problems), 'stored correction', 'stored corrections')} could not be applied ({', '.join(sorted({str(p.get('code')) for p in problems}))}).")
    return lines


def block(source_map: dict) -> dict[str, Any]:
    """The ``source_map`` object of the lecture view (r2-read-api.md 1.1) for a map with inspected pages."""
    layout = (source_map.get("page_layout") or {}).get("kind")
    pptx = source_map.get("pptx")
    return {
        "state": "ready", "reason": None, "contract": source_map["contract"], "map_revision": source_map["map_revision"],
        "source": {key: source_map["source"].get(key) for key in _SOURCE_KEYS},
        "page_index_base": source_map["page_index_base"], "page_count": source_map["page_count"], "page_layout": layout if layout in {"slides", "document", "mixed"} else None,
        "printed_numbers_established": bool((source_map.get("printed_numbers") or {}).get("established")),
        # Only when a presentation of the unit was read; whether its slides match these pages is the state, never assumed.
        "pptx": None if pptx is None else {"source_id": (pptx.get("source") or {}).get("source_id"), "state": (pptx.get("alignment") or {}).get("status"),
                                            "matched_pages": sum(1 for page in source_map["pages"] if page.get("pptx"))},
        "logical_slides": [_logical(source_map, slide) for slide in source_map["logical_slides"]],
        "denominators": _denominators(source_map), "limitations": _limitations(source_map), "override_revision": (source_map.get("overrides") or {}).get("revision", 0),
    }


def unavailable_block(reason: str, *, deck: dict | None = None, page_count: int | None = None) -> dict[str, Any]:
    """The same object when there is no map: it says why, counts the pages the view lists and claims nothing else."""
    if reason not in REASONS:
        raise ValueError(f"reason must be one of {', '.join(REASONS)}")
    return {"state": "unavailable", "reason": reason, "contract": sm.SOURCE_MAP_VERSION, "map_revision": None,
            "source": {key: deck.get(key) for key in _SOURCE_KEYS} if deck else None, "page_index_base": sm.PAGE_INDEX_BASE, "page_count": page_count, "page_layout": None,
            "printed_numbers_established": False, "pptx": None, "logical_slides": [],
            "denominators": {"raw": page_count, "instructional": None, "by_role": None, "uncertain": None, "excluded": None},
            "limitations": [_NO_MAP[reason], _NO_MAP_CONSEQUENCE], "override_revision": None}


# ---- identity and role of one page (r2-read-api.md 1.2) --------------------------------------------------------------
def _identity(source_map: dict, page: int) -> dict[str, Any]:
    described = sm.describe_page(source_map, page)
    record = source_map["pages"][page - 1]
    printed = None
    if record.get("printed_number") is not None and (source_map.get("page_layout") or {}).get("kind") != "document":  # on an upright reading it is a page number
        printed = {"value": record["printed_number"], "basis": "correction" if record.get("printed_number_source") == "override" else "printed_on_page"}
    match = record.get("pptx")
    position = None
    if described["build_count"] > 1:
        position = {"ordinal": described["build_index"], "of": described["build_count"], "kind": POSITION_WORDS.get(described["kind"], _PART)}
    return {"page_index": page, "page_count": source_map["page_count"], "page_label": record.get("pdf_label"), "printed_slide_number": printed,
            "pptx": None if not match else {"slide_id": match["slide_id"], "ordinal": match["ordinal"], "match_basis": (match.get("evidence") or {}).get("method"), "match_state": "generated"},
            "logical_slide_id": described["logical_slide_id"], "position": position, "label": described["label"], "label_parts": list(described["parts"])}


def _role(source_map: dict, page: int, history: dict[int, dict]) -> dict[str, Any]:
    role = source_map["pages"][page - 1]["role"]
    state = _review_state(history, [role.get("override_revision")]) if role.get("source") == "override" else "generated"
    return {"value": role["role"], "state": state, "uncertain": bool(role.get("uncertain")), "forced_requirements": bool(role.get("forced_requirements")),
            "basis": list(role.get("evidence") or [])}


def _bare_identity(page: Any, page_count: int | None, *, of: bool = True) -> dict[str, Any]:
    label = f"PDF page {page} of {page_count}" if of and page_count else f"PDF page {page}"
    return {"page_index": page, "page_count": page_count, "page_label": None, "printed_slide_number": None, "pptx": None, "logical_slide_id": None, "position": None,
            "label": label, "label_parts": [label]}


def _unknown_role(why: str) -> dict[str, Any]:
    # An unknown role keeps the ordinary behaviour: it is not one of the roles that force nothing.
    return {"value": "unknown", "state": None, "uncertain": True, "forced_requirements": True, "basis": [why]}


def page_rows(source_map: dict) -> list[dict[str, Any]]:
    """``[{page, identity, role}]`` for every physical page of a map, in page order: what :func:`enrich` puts on the rows of a lecture view."""
    history = _history(source_map)
    return [{"page": page, "identity": _identity(source_map, page), "role": _role(source_map, page, history)} for page in range(1, len(source_map["pages"]) + 1)]


def _reason_of(source_map: dict) -> str:
    """Why a map without inspected pages is no map for a lecture view."""
    inspection = source_map.get("inspection") or {}
    status, kind = inspection.get("status"), (source_map.get("source") or {}).get("kind")
    if status == "pptx_only" or inspection.get("reason") == "unsupported_type" or kind not in {None, "pdf"}:
        return "not_a_pdf"
    return "not_built" if status == "not_inspected" else "unreadable"


def enrich(view: dict, *, source_map: dict | None, reason: str | None = None) -> None:
    """Set ``view["source_map"]`` and, on every ``slides[]`` row, ``identity`` and ``role`` (r2-read-api.md 1.1, 1.2).

    ``source_map`` is the map :func:`map_for` returned, or ``None`` with the ``reason`` it gave. The rows are not
    reordered, merged or dropped: row N stays physical page N. With no map every page still gets an identity
    (``PDF page N of M``) and the role ``unknown``. A row for a page the mapped file does not hold (page text prepared
    for other bytes) gets the bare identity too, and the limitations say so.
    """
    rows = view.get("slides") or []
    if source_map is not None and not source_map.get("page_count"):
        reason, source_map = reason or _reason_of(source_map), None
    if source_map is None:
        if reason not in REASONS:
            raise ValueError(f"without a source map the reason must be one of {', '.join(REASONS)}")
        listed = view.get("page_count") if isinstance(view.get("page_count"), int) else (len(rows) or None)
        view["source_map"] = unavailable_block(reason, deck=view.get("deck"), page_count=listed)
        for row in rows:
            row["identity"] = _bare_identity(row.get("page"), listed)
            row["role"] = _unknown_role(_NO_MAP[reason])
        return
    result = block(source_map)
    count = source_map["page_count"]
    listed = view.get("page_count") if isinstance(view.get("page_count"), int) else len(rows)
    if rows and listed != count:
        result["limitations"].append(f"The lecture view lists {listed} pages but the mapped file holds {count}: page text was prepared for other bytes of this deck. "
                                     "Pages the file does not hold are identified by their index only.")
    history = _history(source_map)
    for row in rows:
        page = row.get("page")
        if isinstance(page, int) and not isinstance(page, bool) and 1 <= page <= count:
            row["identity"], row["role"] = _identity(source_map, page), _role(source_map, page, history)
        else:
            row["identity"] = _bare_identity(page, count, of=False)
            row["role"] = _unknown_role("This page is not a page of the mapped file.")
    view["source_map"] = result


# ---- the same identity for the other consumers ---------------------------------------------------------------------------
def _is_page(source_map: dict | None, page: Any) -> bool:
    return source_map is not None and isinstance(page, int) and not isinstance(page, bool) and 1 <= page <= len(source_map.get("pages") or [])


def logical_slide_of(source_map: dict | None, page: int) -> str | None:
    """The id of the logical slide that holds physical ``page``; ``None`` without a map or for a page it does not hold."""
    return source_map["pages"][page - 1].get("logical_slide_id") if _is_page(source_map, page) else None


def label_for(source_map: dict | None, page: int) -> str:
    """The label of physical ``page`` as the lecture view words it; ``PDF page N`` when nothing more is known."""
    return sm.describe_page(source_map, page)["label"] if _is_page(source_map, page) else f"PDF page {page}"


def pages_of(source_map: dict | None, logical_slide_id: Any) -> list[int]:
    """The member pages a logical-slide id names: a current id, or one this source version issued before a regrouping
    (it keeps naming the pages it named). An id of other bytes, an id never issued, or anything else names no page.
    Without a map only the aligner's own page ids (``p7``) resolve."""
    if not isinstance(logical_slide_id, str):
        return []
    if source_map is None:
        match = _PAGE_ID.match(logical_slide_id)
        return [int(match.group(1))] if match else []
    answer = sm.resolve(source_map, logical_slide_id)
    return list(answer["pages"]) if answer["status"] in {"current", "alias"} else []  # a page address is not a logical-slide id


def alignment_groups(source_map: dict | None) -> list[dict]:
    """The ``groups`` argument of ``alignment.logical_slides_from_pages``: every logical slide of the map as
    ``{slide_id, pages, grouping, role, title}``, a single page too, so that the aligner's ids are the map's ids.
    ``grouping`` is the kind of the slide in the read API's spelling (``single``, ``build_group`` …). ``[]`` without a map.
    """
    if source_map is None:
        return []
    return [{"slide_id": slide["logical_slide_id"], "pages": list(slide["pages"]), "grouping": KIND_NAMES.get(slide["kind"], "manual_group"), "role": slide["role"], "title": slide.get("title")}
            for slide in source_map["logical_slides"]]


def alignment_slides(source_map: dict | None, page_texts: list[str] | None = None) -> list[dict]:
    """The logical slides to score speech against (``alignment.align_windows_to_slides``): one per logical slide of
    the map, with its id, member pages, role, title and the kind of its group, built by
    ``alignment.logical_slides_from_pages`` from ``page_texts`` (index 0 is page 1; the text the map read when ``None``)
    and :func:`alignment_groups`.

    No logical slide is dropped when the texts are shorter than the mapped file, and a text beyond it stays a page of
    its own (``p15``, role unknown). Without a map every page is its own slide, as the aligner makes them itself.
    """
    from . import alignment  # imported here: the lecture view does not need the aligner

    if source_map is None:
        return alignment.logical_slides_from_pages(list(page_texts or []))
    texts = [page.get("text") or "" for page in source_map["pages"]] if page_texts is None else list(page_texts)
    texts += [""] * (len(source_map["pages"]) - len(texts))
    return alignment.logical_slides_from_pages(texts, groups=alignment_groups(source_map))


# ---- routes ---------------------------------------------------------------------------------------------------------------
OPS = ("group", "split", "split_before", "role", "printed_number", "regions", "revert")
_GROUP_VALUES = {"build_group": "incremental_build", "step_group": "animation_steps", "duplicate_group": "duplicate"}  # the read API's names for the module's kinds
_STATUS = {"invalid_override": 422, "learner_correction_in_force": 409, "override_conflict": 409, "override_chain_broken": 409, "source_unavailable": 409, "identity_mismatch": 409}


def correction_from(body: Any) -> tuple[dict, Any]:
    """``(op, reason)`` for ``sourcemap.apply_override`` from a request body ``{op, pages, value?, reason}``.

    ``group``: ``pages`` are adjacent pages that are one slide; ``value`` may name the kind (``build_group``,
    ``step_group``, ``duplicate_group``; a plain group otherwise). ``split``: each page of ``pages`` stands alone.
    ``split_before``: the one page of ``pages`` starts a new slide. ``role`` / ``printed_number`` / ``regions``: the
    one page of ``pages`` gets ``value`` (a role; a whole number or null; a list of boxes). ``revert``: ``value`` lists
    the revisions to undo. What the pages and values may be is decided by the source map; this only arranges them.
    """
    def bad(message: str) -> sm.SourceMapError:
        return sm.SourceMapError("invalid_override", message)

    if not isinstance(body, dict):
        raise bad("the body is an object {op, pages, value?, reason}")
    kind, pages, value = body.get("op"), body.get("pages"), body.get("value")
    if kind not in OPS:
        raise bad(f"op must be one of {', '.join(OPS)}")
    if kind != "revert" and not isinstance(pages, list):
        raise bad("pages must be a list of page numbers")
    if kind == "group":
        op: dict[str, Any] = {"type": "group", "pages": pages} | ({"kind": _GROUP_VALUES.get(value, value) if isinstance(value, str) else value} if value is not None else {})
    elif kind == "split":
        op = {"type": "split", "pages": pages}
    elif kind == "revert":
        op = {"type": "revert", "revisions": value}
    else:
        if len(pages) != 1:
            raise bad({"split_before": "split_before names one page: the page that starts a new slide"}.get(kind, f"a {kind} correction names one page"))
        op = {"split_before": {"type": "split", "before_page": pages[0]}, "role": {"type": "role", "page": pages[0], "role": value},
              "printed_number": {"type": "printed_number", "page": pages[0], "printed_number": value}, "regions": {"type": "regions", "page": pages[0], "regions": value}}[kind]
    return op, body.get("reason")


def register(app: Any, runtime: Any, locked: Any) -> None:
    """``GET /api/courses/{course_id}/lectures/{lecture_id}/source-map`` and
    ``POST /api/courses/{course_id}/lectures/{lecture_id}/source-map/overrides``.

    The GET returns the ``source_map`` object of the lecture view (its fields at the top, spelled the same) and beside
    it ``course_id``, ``lecture_id``, ``deck``, ``pages`` (``[{page, identity, role}]``, every page as the lecture view
    shows it), ``overrides`` (the history: every correction with its author, reason, predecessor and what became of
    it), ``override_problems`` and ``map`` — the full stored map of the displayed deck in the source map's own spelling
    (``null`` when there is none; then ``state`` is ``unavailable`` with the reason, ``pages`` is empty and
    ``page_count`` and ``denominators.raw`` are ``null``: this route lists no pages of a deck it has no map of, while
    the lecture view's own ``source_map`` object counts the pages that view lists).
    The POST records a learner's correction ``{op, pages, value?, reason}`` (:func:`correction_from`) as the next
    immutable revision and returns the new ``source_map`` object. It changes only app-private state and is listed in
    ``brain/tests/test_boundaries.py::STATE_CHANGING_ROUTES`` by whoever calls this from ``create_app``. A refusal is
    ``{"detail": <what is wrong>, "code": <the source map's code, or the reason there is no map>}`` with 422 for a
    correction that is not valid and 409 for one that cannot be recorded now. Both take ``?deck=`` like the lecture view.
    """
    settings: Settings = runtime.settings

    def unit(course_id: str, lecture_id: str, requested: str | None) -> tuple[dict, dict | None]:
        binding = settings.courses.get(course_id)
        if binding is None:
            raise HTTPException(404, "Unknown course")
        if not binding.usable:
            raise HTTPException(409, binding.problem or "Course binding is not usable")
        lecture = next((entry for entry in build_inventory(binding)["lectures"] if entry["lecture_id"] == lecture_id), None)
        if lecture is None:
            raise HTTPException(404, "Unknown lecture unit")
        return lecture, displayed_deck(lecture, requested)

    def refusal(code: str, message: str) -> JSONResponse:
        return JSONResponse({"detail": message, "code": code}, status_code=_STATUS.get(code, 409))

    @app.get("/api/courses/{course_id}/lectures/{lecture_id}/source-map")
    def source_map_of_lecture(course_id: str, lecture_id: str, deck: str | None = Query(None, max_length=200)):
        def read() -> dict:
            lecture, shown = unit(course_id, lecture_id, deck)
            source_map, reason = map_for(settings, course_id, lecture, shown)
            overrides = (source_map or {}).get("overrides") or {}
            return {**(block(source_map) if source_map is not None else unavailable_block(reason, deck=shown)),
                    "course_id": course_id, "lecture_id": lecture_id, "deck": {key: shown.get(key) for key in ("source_id", "filename", "registration")} if shown else None,
                    "pages": page_rows(source_map) if source_map is not None else [], "overrides": list(overrides.get("history") or []),
                    "override_problems": list(overrides.get("problems") or []), "map": source_map}

        return locked(read)

    @app.post("/api/courses/{course_id}/lectures/{lecture_id}/source-map/overrides")
    async def source_map_override(course_id: str, lecture_id: str, request: Request, deck: str | None = Query(None, max_length=200)):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "The request body is not JSON.") from None
        if not isinstance(body, dict):
            raise HTTPException(400, "Send {\"op\": ..., \"pages\": [...], \"value\": ..., \"reason\": \"...\"}.")

        def apply() -> Any:
            lecture, shown = unit(course_id, lecture_id, deck)
            current, reason = map_for(settings, course_id, lecture, shown)  # a correction never starts a long build inside a request
            if current is None:
                return refusal(reason, _NO_MAP[reason] + " It cannot be corrected.")
            try:
                op, why = correction_from(body)
                corrected = sm.apply_override(settings, course_id, shown, op, author="learner", author_ref="lecture-view", reason=why, lecture=lecture)
            except sm.SourceMapError as exc:
                return refusal(exc.code, exc.message)
            return block(corrected)

        return locked(apply)
