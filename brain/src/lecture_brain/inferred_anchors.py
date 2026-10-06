"""Agent-inferred question anchors ``ll.inferred-anchors/1`` (R2-Q3 – R2-Q5, R2-Q10; decisions D68, D74, D77).

One private file per course, ``<state_dir>/inferred-anchors/<course_id>.json``, holds candidate links from questions to
pages of a lecture deck. This module is its only reader and writer:

* :func:`load` reads the file against the CURRENT catalog, inventory and deck bytes and sorts every entry into exactly
  one of four lists — accepted, rejected by the verifying pass (kept for audit; whether the learner's own confirmation
  keeps it on screen is decided where ties are made, ``question_ties.enrich``), stale (made for another question
  version, other deck bytes or an earlier catalog; all of it when no catalog could be read) or refused (with the
  reason). Nothing is repaired, clipped or guessed: an entry is used as written or not at all. A refusal names the
  rule and repeats what was written where an id belongs only when it has the form of an id.
* An item may say what each of its pages supports (``per_page: [{page, supports}]``, optional): pages of the item and
  criterion ids among the item's criteria, nothing else. It is what lets a page that carries one criterion of three
  say so (r2-read-api.md 1.4).
* :func:`store` checks a document with the same rules and replaces the file atomically, keeping the previous bytes as
  a numbered history copy. By default it refuses a document holding a refused entry and a document that was not made
  against the current question index. It never writes outside ``settings.state_dir``.
* The learner's own accept / reject / clear is NOT a value of that file. Each decision is one immutable record per
  revision under ``<state_dir>/inferred-anchors/decisions/<course_id>/``; a second, different record with the same
  revision is refused (never last-write-wins). Decisions are keyed by a suggestion id derived from the question, its
  version, the deck bytes and the pages, so regenerating the suggestions does not erase them.

What the reader cannot check and does not pretend to: that a rationale is more than shared vocabulary, and that nothing
was inferred from a problem-set number. Those are the producer's rules and the verifying pass's verdict.
"""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import re
from typing import Any, Callable
import unicodedata

from fastapi import HTTPException, Request

from . import contracts as c
from .config import Settings
from .fsutil import ExclusiveConflict, publish_exclusive, replace_atomic

CONTRACT = "ll.inferred-anchors/1"
DECISION_CONTRACT = "inferred-anchor-decision/1"  # app-private, so no ``ll.`` wire prefix (as source-map-override/1)
READER_VERSION = "inferred-anchors-reader/1"
AREA = "inferred-anchors"
COVERAGE = ("main", "partial")
STATES = ("agent_inferred", "agent_reviewed")
VERDICTS = ("upheld", "narrowed", "rejected")
DECISIONS = ("confirmed", "rejected", "cleared")
FILE_FIELDS = ("contract", "course_id", "produced_at", "producer", "question_index_sha256", "items", "no_candidate")
ITEM_FIELDS = ("question_id", "question_version", "lecture_id", "source_id", "source_sha256", "pages", "regions", "criteria", "per_page", "coverage", "rationale", "state", "verifier")
PER_PAGE_FIELDS = ("page", "supports")  # optional per item: which of ITS criteria each of ITS pages supports (ids only; r2-read-api.md 1.4)
NO_CANDIDATE_FIELDS = ("question_id", "question_version", "why", "verifier")
SNAPSHOT_FIELDS = ("question_id", "question_version", "lecture_id", "source_id", "source_sha256", "pages")
_REQUIRED = tuple(f for f in ITEM_FIELDS if f not in {"regions", "verifier", "per_page"})  # the nullable fields may be left out
REPRODUCTION_RUN = 8       # this many consecutive words of protected text inside a rationale is a reproduction, not shared vocabulary
REPRODUCTION_SHORTEST = 5  # protected text shorter than this cannot be told from ordinary wording and is not checked
MAX_REFUSED_DETAIL = 200

_SAFE_COURSE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_SUGGESTION_ID = re.compile(r"^ia-[0-9a-f]{16}$")
_DECISION_FILE = re.compile(r"^(?P<id>ia-[0-9a-f]{16})\.r(?P<rev>[1-9]\d{0,5})\.json$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")  # the form of an id: one token, no spaces — a sentence written where an id belongs never has it
_WORD = re.compile(r"[^\W_]+")
_PAGE_COUNTS: dict[tuple[str, int, int], int | None] = {}
_HASHES: dict[str, str] = {}  # path|size|mtime -> sha256 of deck bytes, for the life of the process


class InferredAnchorError(ValueError):
    def __init__(self, code: str, message: str, detail: Any = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.detail = detail


class _Refuse(Exception):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


# ---- identity and places ------------------------------------------------------------------------------------
def _course(settings: Settings, course_id: Any) -> str:
    """A course id becomes a file name here, so it must be a plain name AND a bound course."""
    if not isinstance(course_id, str) or not _SAFE_COURSE.fullmatch(course_id) or course_id not in settings.courses:
        raise InferredAnchorError("unknown_course", "not a bound course of this workspace")
    return course_id


def _inside_state(settings: Settings, path: Path) -> Path:
    if not path.resolve().is_relative_to(settings.state_dir.resolve()):
        raise InferredAnchorError("unsafe_path", "refusing to touch a path outside the private state area")
    return path


def anchors_path(settings: Settings, course_id: str) -> Path:
    return _inside_state(settings, settings.state_dir / AREA / f"{_course(settings, course_id)}.json")


def _decisions_dir(settings: Settings, course_id: str) -> Path:
    return _inside_state(settings, settings.state_dir / AREA / "decisions" / _course(settings, course_id))


def suggestion_id(question_id: str, question_version: Any, source_sha256: str, pages: list[int]) -> str:
    """Stable identity of one suggestion: the question, its version, the deck bytes and the pages. Nothing else."""
    material = c.dump_json([str(question_id), str(question_version), str(source_sha256), sorted(int(p) for p in pages)])
    return "ia-" + c.sha256_hex(material)[:16]


# ---- small checks -------------------------------------------------------------------------------------------
def _tokens(text: str) -> list[str]:
    """Words as a reader sees them: compatibility forms folded (full-width letters, ligatures) and invisible format
    characters (soft hyphen, zero-width space and joiners) removed, so a disguised copy compares equal to the plain one."""
    folded = unicodedata.normalize("NFKC", text)
    return _WORD.findall("".join(ch for ch in folded if unicodedata.category(ch) != "Cf").casefold())


def _id_or(value: Any, otherwise: Any = None) -> Any:
    """``value`` when it has the form of an id, else ``otherwise``: what a producer wrote where an id belongs is repeated only then."""
    return value if isinstance(value, str) and _ID.fullmatch(value) else otherwise


def reproduces(text: str, protected: str) -> bool:
    """True when ``text`` carries a run of consecutive words of ``protected`` (guidance or a rubric sentence).

    Shared vocabulary is not a reproduction: the run must be :data:`REPRODUCTION_RUN` words long, or the whole
    protected text when that is shorter. Protected text of fewer than :data:`REPRODUCTION_SHORTEST` words is not
    checked at all, because a match would prove nothing.
    """
    words = _tokens(protected)
    if len(words) < REPRODUCTION_SHORTEST:
        return False
    size = min(REPRODUCTION_RUN, len(words))
    mine = _tokens(text)
    grams = {tuple(mine[i:i + size]) for i in range(len(mine) - size + 1)}
    return any(tuple(words[i:i + size]) in grams for i in range(len(words) - size + 1))


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _whole(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _version(value: Any) -> bool:
    return _whole(value) or _text(value)


def _pdf_page_count(path: Path) -> int | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    if key not in _PAGE_COUNTS:
        try:
            from pypdf import PdfReader

            _PAGE_COUNTS[key] = len(PdfReader(str(path)).pages)
        except Exception:  # noqa: BLE001 - a file that is not a readable PDF has no page count; that is an answer, not a crash
            _PAGE_COUNTS[key] = None
    return _PAGE_COUNTS[key]


def _default_page_count(root: Path) -> Callable[[dict], int | None]:
    def count(item: dict) -> int | None:
        if not item.get("path"):
            return None
        path = root / item["path"]
        try:
            if not path.resolve().is_relative_to(root.resolve()):
                return None
        except OSError:
            return None
        return _pdf_page_count(path)

    return count


def bytes_sha256_reader(root: Path) -> Callable[[dict], str | None]:
    """``deck_sha256_of`` over the file as it is on disk now: the hash of its bytes, which is what a producer records in
    ``source_sha256``. (The version the course index declares for a file is another thing and may lag behind the bytes.)"""
    def sha(item: dict) -> str | None:
        if not item.get("path"):
            return None
        path = root / item["path"]
        try:
            if not path.resolve().is_relative_to(root.resolve()) or not path.is_file() or path.stat().st_size == 0:
                return None
            from .preparation import file_sha256

            return file_sha256(path, _HASHES)
        except OSError:
            return None

    return sha


def guidance_reader(root: Path, index: dict | None) -> Callable[[str], str | None] | None:
    """``guidance_text_of`` for :func:`load`: the assessor guidance per question, used for comparison only and never
    returned to a client. ``None`` when the guidance maps cannot be read (rubric sentences are still checked from the catalog)."""
    from .ownerio import OwnerReadError
    from .ownerio.catalogs import read_guidance

    if not index:
        return None
    try:
        entries = read_guidance(root, index["questions"])["entries"]
    except OwnerReadError:
        return None
    return lambda question_id: (entries.get(question_id) or {}).get("answer")


def course_context(settings: Settings, course_id: str, *, deck_sha256_of: Callable[[dict], str | None] | None = None) -> dict[str, Any]:
    """Everything :func:`load` needs, read from the course as it is now (read-only): catalog, inventory, deck bytes, guidance."""
    from .ownerio import OwnerReadError
    from .ownerio.catalogs import read_question_index
    from .ownerio.inventory import build_inventory

    binding = settings.course(_course(settings, course_id))
    try:
        index = read_question_index(binding.root, course_id)
    except OwnerReadError:
        index = None
    return {"index": index, "inventory": build_inventory(binding), "deck_sha256_of": deck_sha256_of or bytes_sha256_reader(binding.root),
            "guidance_text_of": guidance_reader(binding.root, index), "page_count_of": None}


# ---- classification (shared by load and store) ---------------------------------------------------------------
class _Reader:
    def __init__(self, course_id: str, *, index: dict | None, inventory: dict, deck_sha256_of: Callable[[dict], str | None], guidance_text_of: Callable[[str], str | None] | None,
                 page_count_of: Callable[[dict], int | None]):
        self.course_id = course_id
        self.index = index
        self.questions: dict[str, dict] = (index or {}).get("questions") or {}
        self.decks = {lecture["lecture_id"]: {d["source_id"]: d for d in lecture["decks"]} for lecture in inventory["lectures"]}
        self.deck_sha256_of = deck_sha256_of
        self.guidance_text_of = guidance_text_of
        self.page_count_of = page_count_of
        self._sha: dict[str, str | None] = {}
        self._count: dict[str, int | None] = {}

    def _deck_sha(self, deck: dict) -> str | None:
        if deck["source_id"] not in self._sha:
            self._sha[deck["source_id"]] = self.deck_sha256_of(deck)
        return self._sha[deck["source_id"]]

    def _deck_pages(self, deck: dict) -> int | None:
        if deck["source_id"] not in self._count:
            self._count[deck["source_id"]] = self.page_count_of(deck)
        return self._count[deck["source_id"]]

    def _protected(self, question: dict) -> list[tuple[str, str]]:
        out = []
        if self.guidance_text_of is not None:
            guidance = self.guidance_text_of(question["question_id"])
            if isinstance(guidance, str):
                out.append(("guidance", guidance))
        for criterion in question.get("criteria") or []:
            if isinstance(criterion.get("observable"), str):
                out.append((f"wording of {criterion.get('criterion_id')}", criterion["observable"]))
        return out

    def _no_reproduction(self, question: dict, texts: list[tuple[str, Any]]) -> None:
        for field, text in texts:
            if isinstance(text, str):
                for what, protected in self._protected(question):
                    if reproduces(text, protected):
                        raise _Refuse("reproduces_guidance", f"{field} reproduces the {what}")

    # ---- one item ---------------------------------------------------------------------------------------
    def item(self, raw: Any, earlier_catalog: bool) -> tuple[str, dict | None, str | None]:
        """→ (``accepted`` | ``rejected`` | ``stale``, normalised item, stale reason). Raises :class:`_Refuse`."""
        if not isinstance(raw, dict):
            raise _Refuse("not_an_object")
        for field in _REQUIRED:
            if field not in raw:
                raise _Refuse("missing_field", field)
        for field in ("question_id", "lecture_id", "source_id"):
            if not _text(raw[field]):
                raise _Refuse("invalid_field", field)
        if not _version(raw["question_version"]):
            raise _Refuse("invalid_field", "question_version")
        if not isinstance(raw["source_sha256"], str) or not _SHA256.fullmatch(raw["source_sha256"]):
            raise _Refuse("invalid_field", "source_sha256")
        pages = raw["pages"]
        if not isinstance(pages, list):
            raise _Refuse("invalid_pages", "pages is not a list")
        if not pages:
            raise _Refuse("no_page")
        if any(not _whole(p) or p < 1 for p in pages) or len(set(pages)) != len(pages):
            raise _Refuse("invalid_pages", "pages are distinct whole numbers from 1")
        criteria = raw["criteria"]
        if not isinstance(criteria, list) or any(not _text(k) for k in criteria) or len(set(criteria)) != len(criteria):
            raise _Refuse("invalid_criteria", "criteria is a list of distinct criterion ids")
        if raw["coverage"] not in COVERAGE:
            raise _Refuse("outside_vocabulary", "coverage")
        if raw["state"] not in STATES:
            raise _Refuse("outside_vocabulary", "state")
        if not _text(raw["rationale"]):
            raise _Refuse("empty_rationale")
        verifier = raw.get("verifier")
        if verifier is not None and not isinstance(verifier, dict):
            raise _Refuse("invalid_field", "verifier")
        verdict, note = (verifier or {}).get("verdict"), (verifier or {}).get("note")
        if verdict is not None and verdict not in VERDICTS:
            raise _Refuse("outside_vocabulary", "verifier.verdict")
        if note is not None and not isinstance(note, str):
            raise _Refuse("invalid_field", "verifier.note")
        if raw["state"] == "agent_reviewed" and verdict is None:
            raise _Refuse("reviewed_without_verdict")
        if raw["state"] == "agent_inferred" and verdict is not None:
            raise _Refuse("verdict_without_review")
        regions = self._regions(raw.get("regions"), pages)
        per_page = self._per_page(raw.get("per_page"), pages, criteria)

        entry = {"suggestion_id": suggestion_id(raw["question_id"], raw["question_version"], raw["source_sha256"], pages),
                 "question_id": raw["question_id"], "question_version": raw["question_version"], "lecture_id": raw["lecture_id"], "source_id": raw["source_id"],
                 "source_sha256": raw["source_sha256"], "pages": sorted(pages), "regions": regions, "criteria": list(criteria), "per_page": per_page, "coverage": raw["coverage"],
                 "rationale": raw["rationale"], "state": raw["state"], "verifier": {"verdict": verdict, "note": note}}
        if self.index is None:  # no catalog was read: nothing below can be compared, and nothing is called unknown or made for an earlier catalog
            return "stale", entry, "catalog_unavailable"
        # A refusal names what was written where an id belongs only when it has the form of an id (never a sentence).
        question = self.questions.get(raw["question_id"])
        if question is None:
            raise _Refuse("unknown_question")
        if raw["lecture_id"] not in self.decks:
            raise _Refuse("unknown_lecture", _id_or(raw["lecture_id"], ""))
        deck = self.decks[raw["lecture_id"]].get(raw["source_id"])
        if deck is None:
            named = _id_or(raw["source_id"])
            raise _Refuse("source_not_a_deck_of_lecture", f"{named} is not a deck of {raw['lecture_id']}" if named and _id_or(raw["lecture_id"]) else "the named source is not a deck of the named lecture")
        # Stale comes before the rules that belong to the current version: criteria of another version and pages of other bytes cannot be checked today.
        if earlier_catalog:
            return "stale", entry, "earlier_catalog"
        if question.get("version") is not None and str(raw["question_version"]) != str(question["version"]):
            return "stale", entry, "question_version_differs"
        current = self._deck_sha(deck)
        if current is None:
            return "stale", entry, "source_unavailable"
        if current != raw["source_sha256"]:
            return "stale", entry, "source_bytes_differ"

        catalogued = [k.get("criterion_id") for k in question.get("criteria") or []]
        unknown = [k for k in criteria if k not in catalogued]
        if unknown:
            named = [k for k in unknown if _id_or(k)][:5]
            raise _Refuse("unknown_criterion", f"{len(unknown)} of {len(criteria)} listed ids are not criteria of the question" + (": " + ", ".join(named) if named else ""))
        if catalogued and not criteria:
            raise _Refuse("no_criteria", f"the question has {len(catalogued)} catalogued criteria and the item names none")
        count = self._deck_pages(deck)
        if count is None:
            raise _Refuse("page_count_unknown", f"the pages of {raw['source_id']} cannot be counted")
        outside = [p for p in sorted(pages) if p > count]
        if outside:
            raise _Refuse("page_outside_deck", f"page {outside[0]} of {count}")
        self._no_reproduction(question, [("rationale", raw["rationale"]), ("verifier.note", note)])
        return ("rejected" if verdict == "rejected" else "accepted"), entry, None

    @staticmethod
    def _regions(regions: Any, pages: list[int]) -> list[dict] | None:
        if regions is None:
            return None
        if not isinstance(regions, list) or not regions:
            raise _Refuse("invalid_regions", "regions is null or a non-empty list")
        out = []
        for region in regions:
            box = region.get("box") if isinstance(region, dict) else None
            if (not isinstance(region, dict) or region.get("page") not in pages or not _whole(region.get("page")) or not isinstance(box, list) or len(box) != 4
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in box) or not (box[0] < box[2] and box[1] < box[3])
                    or not (region.get("region_id") is None or _id_or(region.get("region_id")))):  # a region id is an id, never a description: it reaches the row as written
                raise _Refuse("invalid_regions", "a region is {page, box [x0, y0, x1, y1], optional region_id} inside one of the named pages, in fractions of the page")
            out.append({"page": region["page"], "box": list(box), **({"region_id": region["region_id"]} if region.get("region_id") else {})})
        return out

    @staticmethod
    def _per_page(per_page: Any, pages: list[int], criteria: list[str]) -> list[dict] | None:
        """``[{page, supports}]`` by page, or ``None`` when the producer said nothing page by page.

        Each entry names one page of THIS item and criterion ids among THIS item's criteria; a page appears once. A page
        may support nothing and a page may be left out (nothing is then known about it). Anything else refuses the item:
        the list is never clipped to what fits. The refusal names the rule and never repeats what was written.
        """
        if per_page is None:
            return None
        if not isinstance(per_page, list) or not per_page:
            raise _Refuse("invalid_per_page", "per_page is null or a non-empty list")
        seen: dict[int, list[str]] = {}
        for entry in per_page:
            page, supports = (entry.get("page"), entry.get("supports")) if isinstance(entry, dict) else (None, None)
            if not _whole(page) or page not in pages or page in seen:
                raise _Refuse("invalid_per_page", "an entry is {page, supports} for one page of the item, each page once")
            if not isinstance(supports, list) or any(not isinstance(k, str) or k not in criteria for k in supports) or len(set(supports)) != len(supports):
                raise _Refuse("invalid_per_page", "supports is a list of distinct criterion ids among the criteria the item lists")
            seen[page] = [k for k in criteria if k in supports]
        return [{"page": page, "supports": seen[page]} for page in sorted(seen)]

    # ---- one "examined, no page found" record (D77) ---------------------------------------------------------
    def no_candidate(self, raw: Any, earlier_catalog: bool) -> tuple[str, dict, str | None]:
        if not isinstance(raw, dict):
            raise _Refuse("not_an_object")
        for field in ("question_id", "question_version", "why"):
            if field not in raw:
                raise _Refuse("missing_field", field)
        if not _text(raw["question_id"]):
            raise _Refuse("invalid_field", "question_id")
        if not _version(raw["question_version"]):
            raise _Refuse("invalid_field", "question_version")
        if not _text(raw["why"]):
            raise _Refuse("empty_why")
        verifier = raw.get("verifier")
        if verifier is not None and not isinstance(verifier, dict):
            raise _Refuse("invalid_field", "verifier")
        confirmed, note = (verifier or {}).get("confirmed", False), (verifier or {}).get("note")
        if not isinstance(confirmed, bool):
            raise _Refuse("outside_vocabulary", "verifier.confirmed")
        if note is not None and not isinstance(note, str):
            raise _Refuse("invalid_field", "verifier.note")
        entry = {"question_id": raw["question_id"], "question_version": raw["question_version"], "why": raw["why"], "verifier": {"confirmed": confirmed, "note": note}}
        if self.index is None:
            return "stale", entry, "catalog_unavailable"
        question = self.questions.get(raw["question_id"])
        if question is None:
            raise _Refuse("unknown_question")
        if earlier_catalog:
            return "stale", entry, "earlier_catalog"
        if question.get("version") is not None and str(raw["question_version"]) != str(question["version"]):
            return "stale", entry, "question_version_differs"
        self._no_reproduction(question, [("why", raw["why"]), ("verifier.note", note)])
        return "accepted", entry, None


def _header_problem(raw: Any, course_id: str) -> str | None:
    if not isinstance(raw, dict):
        return "not_an_object"
    if raw.get("contract") != CONTRACT:
        return "unsupported_contract"
    if (not isinstance(raw.get("items"), list) or not isinstance(raw.get("question_index_sha256"), str) or not _SHA256.fullmatch(raw["question_index_sha256"])
            or not _text(raw.get("produced_at")) or not _text(raw.get("producer")) or not isinstance(raw.get("no_candidate", []), list)):
        return "invalid_header"
    if raw.get("course_id") != course_id:
        return "course_mismatch"
    return None


def _empty(course_id: str) -> dict[str, Any]:
    return {"contract": CONTRACT, "reader": READER_VERSION, "course_id": course_id,
            "file": {"state": "missing", "produced_at": None, "sha256": None, "question_index_matches": None, "producer": None, "reason": None},
            "items": [], "rejected_by_verifier": [], "stale": [], "refused": {"counts": {}, "items": []}, "no_candidate": [], "stale_no_candidate": [], "by_question": {},
            "unknown_fields": {"file": [], "items": [], "no_candidate": [], "per_page": []}, "duplicates_collapsed": 0, "guidance_check": "not_run"}


def _classify(raw: Any, course_id: str, reader: _Reader) -> dict[str, Any]:
    """Sort every entry of a parsed document. ``file.state`` is ``ok``, ``unreadable``, ``made_for_earlier_catalog`` or ``catalog_unavailable`` (sha256 is filled in by the caller)."""
    out = _empty(course_id)
    problem = _header_problem(raw, course_id)
    refused: list[dict] = []
    if problem is not None:
        out["file"].update(state="unreadable", reason=problem)
        if problem == "course_mismatch":  # a file for another course: every entry is counted, none is read
            refused = [{"list": name, "index": n, "question_id": None, "reason": "course_mismatch", "detail": ""} for name in ("items", "no_candidate") for n, _ in enumerate(raw.get(name) or [])]
            out["refused"] = {"counts": dict(Counter(r["reason"] for r in refused)), "items": refused[:MAX_REFUSED_DETAIL]}
        return out
    # Without a readable question index the comparison was not made: the file is not called older than a catalog nobody read.
    matches = None if reader.index is None else raw["question_index_sha256"] == reader.index.get("sha256")
    out["file"].update(state="catalog_unavailable" if matches is None else "ok" if matches else "made_for_earlier_catalog", produced_at=raw["produced_at"], producer=raw["producer"],
                       question_index_matches=matches)
    out["guidance_check"] = "guidance_and_criteria" if reader.guidance_text_of is not None else "criteria_only"
    out["unknown_fields"] = {"file": sorted(set(raw) - set(FILE_FIELDS)), "items": sorted({k for i in raw["items"] if isinstance(i, dict) for k in i} - set(ITEM_FIELDS)),
                             "no_candidate": sorted({k for i in raw.get("no_candidate") or [] if isinstance(i, dict) for k in i} - set(NO_CANDIDATE_FIELDS)),
                             "per_page": sorted({k for i in raw["items"] if isinstance(i, dict) and isinstance(i.get("per_page"), list) for e in i["per_page"] if isinstance(e, dict) for k in e
                                                 if isinstance(k, str)} - set(PER_PAGE_FIELDS))}

    def refuse(name: str, n: int, entry: Any, reason: str, detail: str = "") -> None:
        written = entry.get("question_id") if isinstance(entry, dict) and isinstance(entry.get("question_id"), str) else None
        question_id = written if written in reader.questions else _id_or(written)  # a sentence written in place of the id is not repeated
        refused.append({"list": name, "index": n, "question_id": question_id, "reason": reason, "detail": detail})

    # The same pages of the same bytes in two files of a unit are two places with one identity: a claim is compared with claims about the same file only.
    live: dict[tuple, list[tuple[int, str, dict]]] = {}  # (suggestion id, lecture, deck) -> the accepted/rejected entries that carry it
    seen_stale: set[str] = set()
    for n, entry in enumerate(raw["items"]):
        try:
            kind, item, why = reader.item(entry, matches is False)
        except _Refuse as exc:
            refuse("items", n, entry, exc.reason, exc.detail)
            continue
        if kind == "stale":
            key = c.dump_json([item, why]).decode("utf-8")
            if key in seen_stale:
                out["duplicates_collapsed"] += 1
            else:
                seen_stale.add(key)
                out["stale"].append(dict(item, stale_reason=why))
        else:
            live.setdefault((item["suggestion_id"], item["lecture_id"], item["source_id"]), []).append((n, kind, item))
    for group in sorted(live.values(), key=lambda g: g[0][0]):
        if any((kind, item) != (group[0][1], group[0][2]) for _, kind, item in group[1:]):
            for n, _, item in group:  # two different claims about the same pages of one question: neither is chosen
                refuse("items", n, item, "conflicting_duplicate", f"{len(group)} different items share {item['suggestion_id']}")
            continue
        out["duplicates_collapsed"] += len(group) - 1
        out["rejected_by_verifier" if group[0][1] == "rejected" else "items"].append(group[0][2])

    records: dict[str, list[tuple[int, dict]]] = {}
    for n, entry in enumerate(raw.get("no_candidate") or []):
        try:
            kind, record, why = reader.no_candidate(entry, matches is False)
        except _Refuse as exc:
            refuse("no_candidate", n, entry, exc.reason, exc.detail)
            continue
        if kind == "stale":
            row = {"question_id": record["question_id"], "question_version": record["question_version"], "stale_reason": why}
            if row not in out["stale_no_candidate"]:
                out["stale_no_candidate"].append(row)
        else:
            records.setdefault(record["question_id"], []).append((n, record))
    for group in sorted(records.values(), key=lambda g: g[0][0]):
        if any(record != group[0][1] for _, record in group[1:]):
            for n, record in group:
                refuse("no_candidate", n, record, "conflicting_duplicate", f"{len(group)} different records for one question")
            continue
        out["duplicates_collapsed"] += len(group) - 1
        out["no_candidate"].append(group[0][1])

    refused.sort(key=lambda r: (r["list"], r["index"]))
    out["refused"] = {"counts": dict(Counter(r["reason"] for r in refused)), "items": refused[:MAX_REFUSED_DETAIL]}

    def bucket(question_id: str) -> dict:
        return out["by_question"].setdefault(question_id, {"items": [], "rejected_by_verifier": [], "stale": [], "refused": 0, "no_candidate": None})

    for name in ("items", "rejected_by_verifier", "stale"):
        for item in out[name]:
            bucket(item["question_id"])[name].append(item)
    for record in out["no_candidate"]:
        bucket(record["question_id"])["no_candidate"] = record
    for entry in refused:
        if entry["question_id"] in reader.questions:
            bucket(entry["question_id"])["refused"] += 1
    return out


def _parse(data: bytes) -> Any:
    return c.parse_json(data.removeprefix(b"\xef\xbb\xbf"))


def load(settings: Settings, course_id: str, *, index: dict | None, inventory: dict, deck_sha256_of: Callable[[dict], str | None],
         guidance_text_of: Callable[[str], str | None] | None = None, page_count_of: Callable[[dict], int | None] | None = None) -> dict[str, Any]:
    """Read the course's suggestions file against the current catalog (``index``), ``inventory`` and deck bytes.

    ``deck_sha256_of(deck_item)`` returns the sha256 of a deck's current bytes (``None`` when it cannot be read);
    ``guidance_text_of(question_id)`` the assessor guidance of a question (never returned, only compared);
    ``page_count_of(deck_item)`` the deck's page count (default: counted from the PDF itself, read-only).
    """
    path = anchors_path(settings, course_id)
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return _empty(course_id)
    except OSError:
        out = _empty(course_id)
        out["file"].update(state="unreadable", reason="read_error")
        return out
    try:
        raw = _parse(data)
    except (ValueError, RecursionError):  # not the contract's JSON, a number too long to read, or nesting too deep: an answer, never a crash
        out = _empty(course_id)
        out["file"].update(state="unreadable", reason="too_large" if len(data) > c.MAX_JSON_BYTES else "not_json", sha256=c.sha256_hex(data))
        return out
    reader = _Reader(course_id, index=index, inventory=inventory, deck_sha256_of=deck_sha256_of, guidance_text_of=guidance_text_of,
                     page_count_of=page_count_of or _default_page_count(settings.course(course_id).root))
    out = _classify(raw, course_id, reader)
    out["file"]["sha256"] = c.sha256_hex(data)
    return out


_UNSET: Any = object()


def store(settings: Settings, course_id: str, document: Any, *, strict: bool = True, index: Any = _UNSET, inventory: dict | None = None,
          deck_sha256_of: Callable[[dict], str | None] | None = None, guidance_text_of: Any = _UNSET, page_count_of: Callable[[dict], int | None] | None = None) -> dict[str, Any]:
    """Check ``document`` with the reader's rules and make it the course's suggestions file.

    A document the reader could not use as a whole is refused. With ``strict`` (the default) a document holding even
    one entry the reader would refuse is refused too, and so is a document that was not made against the current
    question index (``made_for_earlier_catalog``) or could not be compared with one (``catalog_unavailable``): it would
    replace current links by none. Nothing is written then. Only the contract's fields are written; fields the producer
    added are named in the result (``dropped_fields``), and the result says whether the guidance was compared
    (``guidance_check``). The previous file is kept as ``history/<course>.<NNNN>.json``. Without the keyword context the
    catalog, inventory, deck bytes and guidance are read from the course (read-only).
    """
    path = anchors_path(settings, course_id)
    if index is _UNSET or inventory is None or deck_sha256_of is None:
        own = course_context(settings, course_id, deck_sha256_of=deck_sha256_of)
        index = own["index"] if index is _UNSET else index
        inventory = own["inventory"] if inventory is None else inventory
        deck_sha256_of = own["deck_sha256_of"]
        guidance_text_of = own["guidance_text_of"] if guidance_text_of is _UNSET else guidance_text_of
    reader = _Reader(course_id, index=index, inventory=inventory, deck_sha256_of=deck_sha256_of, guidance_text_of=None if guidance_text_of is _UNSET else guidance_text_of,
                     page_count_of=page_count_of or _default_page_count(settings.course(course_id).root))
    checked = _classify(document, course_id, reader)
    if checked["file"]["state"] == "unreadable":
        raise InferredAnchorError(checked["file"]["reason"], "the document is not a suggestions file of this course", checked["refused"])
    if strict and checked["refused"]["counts"]:
        raise InferredAnchorError("refused_items", "the reader would refuse entries of this document; nothing was written", checked["refused"])
    if strict and checked["file"]["state"] != "ok":  # made for another question index, or no index could be read: none of it could be a current link
        raise InferredAnchorError(checked["file"]["state"], "the document was not checked against the course's current question index, so it replaces nothing; nothing was written")

    def pure(entry: Any, fields: tuple[str, ...]) -> Any:
        if not isinstance(entry, dict):
            return entry
        kept = {k: entry[k] for k in fields if k in entry}
        if isinstance(kept.get("per_page"), list):  # page and criterion ids only: a producer's note about a page is not part of the contract
            kept["per_page"] = [pure(e, PER_PAGE_FIELDS) for e in kept["per_page"]]
        return kept

    clean = {k: document[k] for k in FILE_FIELDS if k in document and k not in {"items", "no_candidate"}}
    clean["items"] = [pure(i, ITEM_FIELDS) for i in document["items"]]
    if "no_candidate" in document:
        clean["no_candidate"] = [pure(i, NO_CANDIDATE_FIELDS) for i in document["no_candidate"]]
    data = json.dumps(clean, ensure_ascii=False, indent=1, allow_nan=False).encode("utf-8")
    if len(data) > c.MAX_JSON_BYTES:
        raise InferredAnchorError("too_large", "the document is larger than the reader accepts; nothing was written")
    result = {"path": path.relative_to(settings.state_dir).as_posix(), "sha256": c.sha256_hex(data), "history": None, "file_state": checked["file"]["state"],
              "accepted": len(checked["items"]), "rejected_by_verifier": len(checked["rejected_by_verifier"]), "stale": len(checked["stale"]), "no_candidate": len(checked["no_candidate"]),
              "refused": checked["refused"]["counts"], "dropped_fields": checked["unknown_fields"], "duplicates_collapsed": checked["duplicates_collapsed"],
              "guidance_check": checked["guidance_check"]}
    previous = path.read_bytes() if path.is_file() else None
    if previous == data:
        return dict(result, status="unchanged")
    if previous is not None:
        history = _inside_state(settings, path.parent / "history")
        taken = [int(m.group(1)) for p in (history.iterdir() if history.is_dir() else []) if (m := re.fullmatch(rf"{re.escape(course_id)}\.(\d{{4,}})\.json", p.name))]
        copy = history / f"{course_id}.{max(taken, default=0) + 1:04d}.json"
        publish_exclusive(copy, previous)  # the old bytes are safe before the new ones replace them
        result["history"] = copy.relative_to(settings.state_dir).as_posix()
    replace_atomic(path, data)
    return dict(result, status="stored")


# ---- the learner's decisions: one immutable record per revision ---------------------------------------------
def _snapshot(suggestion: dict | None) -> dict | None:
    """What a decision was about, by identity only (never the rationale)."""
    if suggestion is None:
        return None
    return {k: (sorted(suggestion[k]) if k == "pages" else suggestion[k]) for k in SNAPSHOT_FIELDS}


def _decision_errors(record: Any, course_id: str) -> list[str]:
    if not isinstance(record, dict):
        return ["not an object"]
    errors = []
    if set(record) != {"contract", "course_id", "suggestion_id", "revision", "supersedes", "decision", "author", "decided_at", "suggestion"}:
        errors.append("unexpected or missing fields")
        return errors
    if record["contract"] != DECISION_CONTRACT:
        errors.append("unsupported contract")
    if record["course_id"] != course_id:
        errors.append("another course")
    if not isinstance(record["suggestion_id"], str) or not _SUGGESTION_ID.fullmatch(record["suggestion_id"]):
        errors.append("malformed suggestion id")
    revision = record["revision"]
    if not _whole(revision) or revision < 1:
        errors.append("revision is a whole number from 1")
    else:
        supersedes = record["supersedes"]
        if revision == 1 and supersedes is not None:
            errors.append("the first revision supersedes nothing")
        if revision > 1 and not (isinstance(supersedes, dict) and set(supersedes) == {"revision", "sha256"} and supersedes["revision"] == revision - 1
                                 and isinstance(supersedes["sha256"], str) and _SHA256.fullmatch(supersedes["sha256"])):
            errors.append("a later revision names its predecessor by number and bytes")
    if record["decision"] not in DECISIONS:
        errors.append("decision outside the vocabulary")
    if record["author"] != "learner":
        errors.append("a decision is the learner's own")
    if not _text(record["decided_at"]):
        errors.append("decided_at missing")
    snapshot = record["suggestion"]
    if snapshot is not None and not (isinstance(snapshot, dict) and set(snapshot) == set(SNAPSHOT_FIELDS) and isinstance(snapshot["pages"], list)):
        errors.append("malformed suggestion snapshot")
    return errors


def _summary(record: dict, sha256: str) -> dict[str, Any]:
    return {"suggestion_id": record["suggestion_id"], "decision": record["decision"], "revision": record["revision"], "decided_at": record["decided_at"],
            "suggestion": record["suggestion"], "sha256": sha256}


def decision_state(settings: Settings, course_id: str) -> dict[str, Any]:
    """Every decision chain of a course: ``current`` (head of each verified chain), ``history``, ``problems`` and the ids whose chain is ``broken``."""
    directory = _decisions_dir(settings, course_id)
    valid: dict[str, dict[int, dict]] = {}
    seen: dict[str, set[int]] = {}
    problems: list[dict] = []
    for path in sorted(directory.iterdir()) if directory.is_dir() else []:
        match = _DECISION_FILE.fullmatch(path.name)
        if not match or not path.is_file():
            continue
        sid, revision = match["id"], int(match["rev"])
        seen.setdefault(sid, set()).add(revision)
        data = path.read_bytes()
        try:
            record = c.parse_json(data)
            errors = _decision_errors(record, course_id)
        except (ValueError, RecursionError):  # as for the suggestions file: one file that cannot be parsed is one reported problem
            record, errors = None, ["not JSON"]
        if errors or record["suggestion_id"] != sid or record["revision"] != revision:
            problems.append({"code": "invalid_decision_file", "suggestion_id": sid, "revision": revision, "file": path.name})
            continue
        valid.setdefault(sid, {})[revision] = _summary(record, c.sha256_hex(data)) | {"supersedes": record["supersedes"]}
    current: dict[str, dict] = {}
    history: dict[str, list[dict]] = {}
    broken: list[str] = []
    for sid in sorted(seen):
        chain: list[dict] = []
        for revision in range(1, max(seen[sid]) + 1):
            entry = valid.get(sid, {}).get(revision)
            expected = None if not chain else {"revision": chain[-1]["revision"], "sha256": chain[-1]["sha256"]}
            if entry is None or entry["supersedes"] != expected:
                if entry is not None or revision not in seen[sid]:  # an unreadable file is already reported above
                    problems.append({"code": "broken_revision_chain", "suggestion_id": sid, "revision": revision, "file": f"{sid}.r{revision}.json"})
                broken.append(sid)
                break
            chain.append(entry)
        history[sid] = [{k: v for k, v in e.items() if k != "supersedes"} for e in chain]
        if chain:
            current[sid] = history[sid][-1]
    return {"current": current, "history": history, "problems": problems, "broken": broken}


def decisions(settings: Settings, course_id: str) -> dict[str, dict]:
    """The current decision per suggestion id: ``{suggestion_id: {decision, revision, decided_at, suggestion, …}}``.

    ``decision`` is ``confirmed``, ``rejected`` or ``cleared`` (a cleared decision is no decision; it is listed so the
    history is visible). Decisions live apart from the suggestions file and survive its regeneration.
    """
    return decision_state(settings, course_id)["current"]


def put_decision(settings: Settings, course_id: str, record: dict) -> dict[str, Any]:
    """Publish one decision record at the revision it states. Never overwrites: a different record that already holds
    that revision is a conflict, and a record that does not follow the verified chain is refused."""
    directory = _decisions_dir(settings, course_id)
    errors = _decision_errors(record, course_id)
    if errors:
        raise InferredAnchorError("invalid_decision", "; ".join(errors[:3]))
    sid, revision = record["suggestion_id"], record["revision"]
    data = c.dump_json(record)
    path = directory / f"{sid}.r{revision}.json"
    outcome = {k: record[k] for k in ("suggestion_id", "decision", "revision", "decided_at", "suggestion")}
    if path.exists():
        if path.read_bytes() == data:
            return dict(outcome, status="already_saved")
        raise InferredAnchorError("conflict", "another record already holds this revision; both are kept apart and nothing was overwritten")
    state = decision_state(settings, course_id)
    if sid in state["broken"]:
        raise InferredAnchorError("conflict", "the decision history of this suggestion is damaged and needs to be looked at before it can continue")
    head = state["current"].get(sid)
    expected = None if head is None else {"revision": head["revision"], "sha256": head["sha256"]}
    if revision != (head["revision"] if head else 0) + 1 or record["supersedes"] != expected:
        raise InferredAnchorError("stale_base", "the record does not follow the current revision of this decision")
    try:
        publish_exclusive(path, data)
    except ExclusiveConflict:
        raise InferredAnchorError("conflict", "another decision was recorded first; nothing was overwritten") from None
    return dict(outcome, status="recorded")


def decide(settings: Settings, course_id: str, suggestion_id: str, decision: str, *, at: str, suggestion: dict | None = None, expected_revision: int | None = None) -> dict[str, Any]:
    """Record the learner's decision about one suggestion as the next immutable revision.

    Repeating the current decision, or clearing where nothing was decided, records nothing (``status: unchanged``).
    ``suggestion`` (an accepted item) is kept by identity so that an orphaned decision can still say what it was about.
    """
    _course(settings, course_id)
    if not isinstance(suggestion_id, str) or not _SUGGESTION_ID.fullmatch(suggestion_id):
        raise InferredAnchorError("invalid_suggestion_id", "not a suggestion id")
    if decision not in DECISIONS:
        raise InferredAnchorError("invalid_decision", "a decision is confirmed, rejected or cleared")
    state = decision_state(settings, course_id)
    if suggestion_id in state["broken"]:
        raise InferredAnchorError("conflict", "the decision history of this suggestion is damaged and needs to be looked at before it can continue")
    head = state["current"].get(suggestion_id)
    head_revision = head["revision"] if head else 0
    if expected_revision is not None and expected_revision != head_revision:
        raise InferredAnchorError("conflict", f"the decision is at revision {head_revision}, not {expected_revision}; nothing was changed")
    if head is None and decision == "cleared":
        return {"suggestion_id": suggestion_id, "decision": None, "revision": 0, "decided_at": None, "suggestion": None, "status": "unchanged"}
    if head is not None and head["decision"] == decision:
        return {**{k: head[k] for k in ("suggestion_id", "decision", "revision", "decided_at", "suggestion")}, "status": "unchanged"}
    record = {"contract": DECISION_CONTRACT, "course_id": course_id, "suggestion_id": suggestion_id, "revision": head_revision + 1,
              "supersedes": None if head is None else {"revision": head_revision, "sha256": head["sha256"]}, "decision": decision, "author": "learner", "decided_at": at,
              "suggestion": _snapshot(suggestion) if suggestion is not None else (head["suggestion"] if head else None)}
    return put_decision(settings, course_id, record)


# ---- readback -----------------------------------------------------------------------------------------------
def readback(document: dict, *, index: dict | None, decisions: dict[str, dict] | None = None, decision_problems: list[dict] | None = None) -> dict[str, Any]:
    """Coverage readback for ``GET /api/courses/{c}/inferred-anchors`` (r2-read-api.md section 2): counts and ids only, no prose of the file."""
    by_question = document["by_question"]
    rows: dict[str, dict] = {}
    for question in sorted(((index or {}).get("questions") or {}).values(), key=lambda q: (str(q.get("collection")), str(q["question_id"]))):
        row = rows.setdefault(str(question.get("collection")), {"collection": question.get("collection"), "questions": 0, "accepted": 0, "stale": 0, "rejected_by_verifier": 0, "refused": 0,
                                                                "questions_with_suggestion": 0, "questions_inspected_no_support": 0, "questions_without_suggestion": 0})
        mine = by_question.get(question["question_id"]) or {"items": [], "rejected_by_verifier": [], "stale": [], "refused": 0, "no_candidate": None}
        row["questions"] += 1
        row["accepted"] += len(mine["items"])
        row["stale"] += len(mine["stale"])
        row["rejected_by_verifier"] += len(mine["rejected_by_verifier"])
        row["refused"] += mine["refused"]
        inspected = bool(mine["rejected_by_verifier"]) or bool(mine["no_candidate"] and mine["no_candidate"]["verifier"]["confirmed"])
        row["questions_with_suggestion" if mine["items"] else "questions_inspected_no_support" if inspected else "questions_without_suggestion"] += 1
    current_ids = {i["suggestion_id"] for i in document["items"]}
    stale_ids = {i["suggestion_id"] for i in document["stale"]}
    audit_ids = {i["suggestion_id"] for i in document["rejected_by_verifier"]}
    report: dict[str, Any] = {"confirmed": 0, "rejected": 0, "cleared": 0, "orphaned": [], "on_stale": [], "on_rejected_by_verifier": [], "problems": list(decision_problems or [])}
    for sid, entry in sorted((decisions or {}).items()):
        report[entry["decision"]] += 1
        if entry["decision"] == "cleared" or sid in current_ids:
            continue
        snapshot = entry.get("suggestion") or {}
        report["on_stale" if sid in stale_ids else "on_rejected_by_verifier" if sid in audit_ids else "orphaned"].append(
            {"suggestion_id": sid, "decision": entry["decision"], "revision": entry["revision"], "decided_at": entry["decided_at"], "question_id": snapshot.get("question_id"),
             "lecture_id": snapshot.get("lecture_id"), "source_id": snapshot.get("source_id"), "pages": snapshot.get("pages")})
    return {"course_id": document["course_id"], "contract": CONTRACT, "reader": READER_VERSION,
            "file": {k: document["file"][k] for k in ("state", "produced_at", "sha256", "question_index_matches")}, "file_reason": document["file"]["reason"],
            "accepted": len(document["items"]), "refused": dict(document["refused"]["counts"]), "stale": len(document["stale"]), "rejected_by_verifier": len(document["rejected_by_verifier"]),
            "by_collection": [rows[k] for k in sorted(rows)],
            "no_candidate": len(document["no_candidate"]), "stale_by_reason": dict(Counter(i["stale_reason"] for i in [*document["stale"], *document["stale_no_candidate"]])),
            "refused_items": document["refused"]["items"][:50], "unknown_fields": document["unknown_fields"], "duplicates_collapsed": document["duplicates_collapsed"],
            "guidance_check": document["guidance_check"], "decisions": report,
            "note": "Suggestions are agent work kept apart from the course record. A refused entry is never repaired; a stale one is kept and not shown as a current link."}


# ---- routes -------------------------------------------------------------------------------------------------
def register(app: Any, runtime: Any, locked: Callable[[Callable[[], Any]], Any]) -> None:
    """``GET /api/courses/{course_id}/inferred-anchors`` and ``POST /api/courses/{course_id}/suggestions/{suggestion_id}/decision``.

    The POST changes only app-private state (one decision record under the state directory); it is listed in
    ``brain/tests/test_boundaries.py::STATE_CHANGING_ROUTES`` by whoever calls this from ``create_app``.
    """
    settings: Settings = runtime.settings

    def course(course_id: str) -> None:
        binding = settings.courses.get(course_id)
        if binding is None:
            raise HTTPException(404, "Unknown course")
        if not binding.usable:
            raise HTTPException(409, binding.problem or "Course binding is not usable")

    def current(course_id: str) -> tuple[dict, dict]:
        context = course_context(settings, course_id)
        return context, load(settings, course_id, **context)

    @app.get("/api/courses/{course_id}/inferred-anchors")
    def inferred_anchor_readback(course_id: str):
        course(course_id)

        def build() -> dict:
            context, document = current(course_id)
            state = decision_state(settings, course_id)
            return readback(document, index=context["index"], decisions=state["current"], decision_problems=state["problems"])

        return locked(build)

    @app.post("/api/courses/{course_id}/suggestions/{suggestion_id}/decision")
    async def suggestion_decision(course_id: str, suggestion_id: str, request: Request):
        course(course_id)
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "The request body is not JSON.") from None
        decision = body.get("decision") if isinstance(body, dict) else None
        expected = body.get("expected_revision") if isinstance(body, dict) else None
        if decision not in DECISIONS or not (expected is None or _whole(expected)):
            raise HTTPException(400, "Send {\"decision\": \"confirmed\" | \"rejected\" | \"cleared\"}.")
        if not _SUGGESTION_ID.fullmatch(suggestion_id):
            raise HTTPException(404, "Unknown suggestion")

        def apply() -> dict:
            suggestion = None
            if decision != "cleared":  # only a suggestion that is a current link can be accepted or rejected; clearing an older decision always works
                document = current(course_id)[1]
                suggestion = next((i for i in document["items"] if i["suggestion_id"] == suggestion_id), None)
                if suggestion is None:  # an item the checking pass rejected stays a link only while the learner's confirmation of it stands: that one can be changed
                    kept = next((i for i in document["rejected_by_verifier"] if i["suggestion_id"] == suggestion_id), None)
                    head = decision_state(settings, course_id)["current"].get(suggestion_id) if kept is not None else None
                    suggestion = kept if head is not None and head["decision"] == "confirmed" else None
                if suggestion is None:
                    raise HTTPException(404, "Unknown suggestion: it is not among the current suggested links of this course.")
            try:
                outcome = decide(settings, course_id, suggestion_id, decision, at=runtime.now(), suggestion=suggestion, expected_revision=expected)
            except InferredAnchorError as exc:
                raise HTTPException(409 if exc.code in {"conflict", "stale_base"} else 400, exc.message) from None
            return {"course_id": course_id, "suggestion_id": suggestion_id, "decision": outcome["decision"], "revision": outcome["revision"], "status": outcome["status"],
                    "decided_at": outcome["decided_at"], "question_id": (outcome["suggestion"] or {}).get("question_id")}

        return locked(apply)
