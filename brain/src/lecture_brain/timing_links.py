"""Timing links: from generated speech to playable slide ranges (amendment R2, checks R2-T4 … R2-T13).

One derived, app-private document per lecture — ``<app area>/timing-links/<lecture_id>.json`` — holds every range a
page can be played from that did not come from a person. It is rebuilt from its inputs and never edited; links a
learner entered or confirmed stay ``ll.annotation/1`` records in the annotation store, are not touched by a build and
outrank every suggestion when the lecture view is assembled.

Stages of a build (each recorded with its own state for every recording of the lecture's sessions):

a. **generated** — the generation ``Derived.current`` serves for the recording (none: ``audio_unprocessed``).
b. **text alignment** — when the unit has exactly ONE original plain-text transcript: ``alignment.align_text`` carries
   times from generated words to its lines. Accepted or refused as a whole; a line that is not aligned has no time
   anywhere in the document. The transcript is read only; its sha256 before and after the build is recorded.
c. **windows** — the timed transcript lines when the mapping was accepted, otherwise windows of generated segments.
   With line windows, recognised speech that lies in no window is measured and kept (``speech_outside``,
   ``SPEECH_OUTSIDE_RULE``): it was not compared with any slide, so it is never read as "nothing was said". A stretch
   that lies in no range at all is listed as unassigned (``speech_without_timed_line``).
d. **slides** — the logical slides of the deck's source map (one page, one slide when there is no map).
e. **hints** — what the course itself states (study-map rows; a catalog locator naming pages AND transcript lines of
   one question), de-duplicated. They reach the engine only when the windows carry transcript line numbers.
f. **association** — ``alignment.align_windows_to_slides`` and ``cross_check_with_baseline``. Every occurrence becomes
   ONE candidate link; disjoint occurrences are never merged, and nothing is divided among slides or builds.
g. **course-stated links** — for each stated pairing, one link per stretch of its lines that received times
   (``origin: reviewed_source_map``, ``support.scope: section``). The ends are measured ends of timed lines; a spoken
   line without a time between two timed lines at most ``max_gap_ms`` apart lies inside the stretch and gets no time.
h. **selection** — a fixed, versioned rule (``SELECTION``) decides which candidates are shown as a page's ranges and
   which stay candidates of an ``ambiguous`` state.

What is NOT established by anything here: that a generated timestamp is acoustically right, that a suggestion is
about the slide it names (the method is lexical; see the measured results in ``alignment.py``), or that a slide was
on screen — every link says ``discussed_during``. The three quality objects of a link are kept apart and no combined
figure exists. The thresholds below were fixed before any real lecture was built and are not tuned on real output.

Reading: :func:`read` returns the stored document as ``current``, ``stale`` (naming the input that differs; a stale
document yields no range) or ``missing`` (also when its content no longer matches its own ``links_revision``). :func:`enrich` is a pure function over the lecture view: it sets
``slides[].ranges``, ``slides[].no_range`` (exactly one of six states) and ``timing`` as ``docs/engineering/r2-read-api.md``
spells them.
"""
from __future__ import annotations

from bisect import bisect_right
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import sys
from typing import Any, Callable

from . import alignment
from . import contracts as c
from . import sourcemap
from .annotations import AnnotationStore, media_duration_ms
from .config import Settings
from .derived import Derived
from .fsutil import replace_atomic
from .ownerio import OwnerReadError
from .ownerio.catalogs import read_question_index
from .ownerio.inventory import build_inventory, disk_version_id, primary_deck
from .ownerio.question_links import build_question_bank
from .preparation import Preparation, extract_slide_texts, file_sha256, tokens

LINKS_CONTRACT = "timing-links/1"
BUILDER_VERSION = "timing-links-builder/2"  # /2: speech outside every window is listed; a document checks its own revision
RECEIPT_KIND = "timing-build"
COURSE_STATED_METHOD = "course-stated-lines/1"
NO_FORCED_ROLES = frozenset({"structural_title_or_section", "administrative", "blank"})  # interface-contracts.md, "Content role"
NO_RANGE_STATES = ("recording_unavailable", "no_range_expected", "audio_unprocessed", "association_not_run", "ambiguous", "not_discussed")
LECTURE_STAGES = ("no_recording", "audio_unprocessed", "partly_processed", "processed", "associated")
MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
MAX_TRANSCRIPT_LINES = 20000  # the bound the lecture view reads a transcript with: line numbers mean the same in both

# ---- fixed rules (stated in every document; changing a value needs a new version) ------------------------------------
SELECTION: dict[str, Any] = {
    "version": "selection/1",
    "min_duration_ms": 8000,
    "min_baseline_same_slide": 0.5,
    "rule": ("A candidate is shown as a range of its slide when it lasts at least min_duration_ms AND (the lexical baseline, run on the same windows, puts at least "
             "min_baseline_same_slide of its windows on the same slide OR its transcript lines lie inside one line range of a course-stated pairing that names that slide). "
             "Every other candidate stays a candidate."),
    "fixed": "Fixed in code before any real lecture was built; never tuned on real output.",
}
SECTION_RULE: dict[str, Any] = {
    "version": COURSE_STATED_METHOD,
    "max_gap_ms": 30_000,  # the engine's own bound: timed windows further apart never share an interval
    "rule": ("For each run of lines the course pairs with pages (line ranges of one statement that touch or overlap are one run): the lines that received a time, in order; a new "
             "stretch starts where two consecutive timed lines are more than max_gap_ms apart. A stretch runs from the start of its first timed line to the end of its last. "
             "No line without a time is given one, no end is moved over one (an untimed line between two timed lines of a stretch lies inside it), and the time is not divided "
             "among the pages."),
}
SPEECH_OUTSIDE_RULE: dict[str, Any] = {
    "version": "speech-outside-windows/1",
    "max_gap_ms": 30_000,  # the same bound as above
    "reason": "speech_without_timed_line",
    "rule": ("When the windows are transcript lines: the recognised words whose middle lies in no window, in runs. A run ends at a word that lies in a window or at a silence longer "
             "than max_gap_ms, and is kept when it holds at least one content word. It goes from the start of its first word to the end of its last and never into a window. "
             "This speech was not compared with any slide, so it is never read as silence: every run is kept in speech_outside, saying whether it lies inside a "
             "suggested range or inside an unassigned interval, and a run that lies in neither is listed as unassigned itself."),
}
_READABLE = frozenset({"registered_readable", "present_unindexed"})
_LECTURE_ID = re.compile(r"^lecture-\d{2}$")
_UNSET: Any = object()
_INPUT_ORDER = ("deck", "map_revision", "transcript", "text_alignment_version", "method_versions", "hints_digest", "selection_version")


class TimingLinksError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


# ---- small things ---------------------------------------------------------------------------------------------------------
def _method(identifier: str) -> dict[str, Any]:
    name, _, version = identifier.partition("/")
    return {"name": name, "version": version or None}


def _digest(value: Any) -> str:
    return c.sha256_hex(c.dump_json(value))


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ms(seconds: float) -> int:
    return int(round(float(seconds) * 1000))


def _clock(ms: int) -> str:
    """A measured length for a sentence: ``1:36:39`` or ``4:05``. Whole seconds, rounded down."""
    hours, rest = divmod(int(ms) // 1000, 3600)
    return f"{hours}:{rest // 60:02d}:{rest % 60:02d}" if hours else f"{rest // 60}:{rest % 60:02d}"


def _pairs(intervals: Any) -> list[list[int]]:
    out = []
    for interval in intervals or []:
        out.append([interval["start_ms"], interval["end_ms"]] if isinstance(interval, dict) else [int(interval[0]), int(interval[1])])
    return out


def _fold(term: str) -> str:
    return term[:-1] if len(term) > 3 and term.endswith("s") and not term.endswith("ss") else term


def _terms(texts: list[str], slide_text: str, limit: int = 6) -> list[str]:
    """Words the windows share with the slide (plurals folded as the engine folds them), most frequent first."""
    wanted = {_fold(term) for term in tokens(slide_text or "")}
    counts = Counter(folded for text in texts for folded in (_fold(term) for term in tokens(text or "")) if folded in wanted)
    return [term for term, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def _identity(record: dict | None) -> dict[str, Any] | None:
    return {key: record.get(key) for key in ("source_id", "version_id", "sha256")} if record else None


def _path(settings: Settings, course_id: str, lecture_id: str) -> Path:
    if course_id not in settings.courses:  # this module's own refusal, not the configuration's error
        raise TimingLinksError("unknown_course", f"Course {course_id!r} is not one of the configured courses.")
    if not _LECTURE_ID.fullmatch(lecture_id or ""):
        raise TimingLinksError("unknown_lecture", f"{lecture_id!r} is not a lecture unit id.")
    return settings.app_area(course_id) / "timing-links" / f"{lecture_id}.json"


# ---- stage d: logical slides -----------------------------------------------------------------------------------------------
_GROUPING_STATES = ("generated", "agent_reviewed", "human_confirmed")
_WHO = {"human_confirmed": "made by the learner", "agent_reviewed": "made by an agent; no person has confirmed it", "generated": "whose author is not recorded"}


def _correction_author(entry: Any) -> str | None:
    """Who made a correction of the source map: ``learner`` (also when an agent recorded it on the learner's say),
    ``agent``, or unknown. The stored history keeps the author as an object ``{kind, ref, learner_authority?}``; older
    records hold the bare word."""
    author = entry.get("author") if isinstance(entry, dict) else None
    if isinstance(author, dict):
        if author.get("kind") == "learner" or author.get("learner_authority"):
            return "learner"
        return author["kind"] if isinstance(author.get("kind"), str) else None
    return author if isinstance(author, str) else None


def _joins(entry: Any, first: int, last: int) -> bool:
    """Whether a correction of the history joins pages of the run ``first`` … ``last``: a group holding two of them."""
    op = entry.get("op") if isinstance(entry, dict) else None
    pages = op.get("pages") if isinstance(op, dict) and op.get("type") == "group" else None
    return bool(pages) and max(pages[0], first) < min(pages[-1], last)


def _grouping_state(slide: dict, history: dict[Any, Any]) -> str:
    """Who established that the pages of a logical slide are one slide: ``generated``, ``agent_reviewed`` or
    ``human_confirmed`` — the rule ``slide_identity.grouping_state`` words the map with, so a link and the map agree.
    Only a grouping a correction made is anyone's but the detector's; for a joined group the corrections that join its
    pages decide (a cut at its edge confirms nothing), for a page that was cut off, the cuts."""
    grouping = slide.get("grouping")
    if isinstance(grouping, dict):  # the served block already states it
        return grouping["state"] if grouping.get("state") in _GROUPING_STATES else "generated"
    if grouping != "override":
        return "generated"
    revisions, pages = list(slide.get("overrides") or []), slide.get("pages") or []
    if len(pages) > 1:
        revisions = [revision for revision in revisions if _joins(history.get(revision), pages[0], pages[-1])]
    who = {_correction_author(history.get(revision)) for revision in revisions}
    if not who or who - {"learner", "agent"}:  # nobody, or somebody whose authorship is not recorded: nothing is confirmed
        return "generated"
    return "agent_reviewed" if "agent" in who else "human_confirmed"  # the weakest author decides


def _group_mapping(slide: dict, history: dict[Any, Any]) -> dict[str, str]:
    """The grouping quality of a link, carried from the source map: who or what says these pages are one slide."""
    grouping, pages, kind = slide.get("grouping") or "none", slide.get("pages") or [], slide.get("kind") or "single"
    span = f"pages {pages[0]}–{pages[-1]}" if len(pages) > 1 else f"page {pages[0]}" if pages else "no page"
    state = _grouping_state(slide, history)
    if isinstance(grouping, dict):
        return {"state": state, "basis": f"{span}: as the source map states it ({grouping.get('basis') or 'basis not stated'})."}
    if grouping == "override":
        revisions = ", ".join(f"r{revision}" for revision in slide.get("overrides") or []) or "revision not stated"
        return {"state": state, "basis": f"{span}: set by a correction ({revisions}) {_WHO[state]}."}
    if grouping == "inferred":
        signals = sorted({signal for item in slide.get("evidence") or [] for signal in item.get("signals") or []})
        return {"state": "generated", "basis": f"{span}: {kind} inferred from {', '.join(signals) or 'the file'} (confidence {slide.get('confidence') or 'not stated'}); nobody has looked."}
    if grouping == "uncertain":
        return {"state": "generated", "basis": f"{span}: kept as a page of its own because grouping it with a neighbour was uncertain."}
    return {"state": "generated", "basis": f"{span}: one page is one logical slide (no grouping applied)."}


def slides_from_map(source_map: dict | None) -> dict[str, Any]:
    """The association's slide input from a source map (the stored ``source-map/1`` shape; the served block is read for
    its revision and grouping only, because it carries no page text)."""
    if not isinstance(source_map, dict) or not source_map.get("logical_slides"):
        return slides_from_pages([])
    pages = {page["page"]: page for page in source_map.get("pages") or [] if isinstance(page, dict) and "page" in page}
    count = source_map.get("page_count") or (max(pages) if pages else max((n for s in source_map["logical_slides"] for n in s.get("pages") or []), default=0))
    texts = [(pages.get(n) or {}).get("text") or "" for n in range(1, int(count) + 1)]
    overrides = source_map.get("overrides")
    history = {entry.get("revision"): entry for entry in (overrides.get("history") if isinstance(overrides, dict) else None) or [] if isinstance(entry, dict)}
    stored = {(slide.get("logical_slide_id") or slide.get("id")): slide for slide in source_map["logical_slides"]}

    def grouping_of(slide: dict) -> str:
        grouping = slide.get("grouping")
        return str((grouping.get("basis") if isinstance(grouping, dict) else grouping) or "none")

    groups = [{"slide_id": slide_id, "pages": list(slide.get("pages") or []), "grouping": grouping_of(slide), "role": slide.get("role") if isinstance(slide.get("role"), str) else None,
               "title": slide.get("title")} for slide_id, slide in stored.items()]
    listed = source_map.get("pages") or []
    if all(isinstance(page, dict) for page in listed) and [page.get("page") for page in listed] == list(range(1, int(count) + 1)) \
            and all(isinstance(slide.get("logical_slide_id"), str) and isinstance(slide.get("kind"), str) and isinstance(slide.get("role"), str) for slide in source_map["logical_slides"]):
        from . import slide_identity  # the stored map: the engine's slides are the ones slide_identity makes of it (imported here: it needs the web framework)

        scored = slide_identity.alignment_slides(source_map)
    else:  # the served block, or a partial map: what can be read of it
        scored = alignment.logical_slides_from_pages(texts, groups=groups)
    rows = []
    for row in scored:
        slide = stored.get(row["slide_id"]) or {"pages": row["pages"]}
        rows.append(dict(row, kind=slide.get("kind") or "single", group_mapping=_group_mapping(dict(slide, pages=row["pages"]), history)))
    return {"basis": "source_map", "map_revision": source_map.get("map_revision"), "page_count": int(count), "logical_slides": rows}


def slides_from_pages(page_texts: list[str]) -> dict[str, Any]:
    """Without a source map every page is a slide of its own, and the links say that no grouping is known."""
    rows = [dict(row, kind="single", group_mapping={"state": "none", "basis": "No source map: one page is taken as one slide; no grouping is known."})
            for row in alignment.logical_slides_from_pages(list(page_texts or []))]
    return {"basis": "page_per_slide" if rows else "no_deck", "map_revision": None, "page_count": len(rows), "logical_slides": rows}


# ---- stage e: what the course states ---------------------------------------------------------------------------------------
def _pairings(material: dict) -> tuple[list[dict], int]:
    """The stated pairings, de-duplicated: the same pages with the same line ranges are one statement with all its bases."""
    merged: dict[tuple, dict] = {}
    stated = 0
    for given in material.get("pairings") or []:
        pages = sorted({int(page) for page in given.get("pages") or []})
        ranges = sorted({(int(a), int(b)) for a, b in given.get("line_ranges") or [] if int(a) <= int(b)})
        if not pages or not ranges:
            continue
        stated += 1
        row = merged.setdefault((tuple(pages), tuple(ranges)), {"pages": pages, "line_ranges": [list(r) for r in ranges], "bases": set(), "labels": [], "refs": []})
        row["bases"].add(str(given.get("basis") or "unstated"))
        if given.get("label") and given["label"] not in row["labels"]:
            row["labels"].append(given["label"])
        row["refs"].extend(ref for ref in given.get("refs") or [] if ref not in row["refs"])
    rows = [dict(row, bases=sorted(row["bases"])) for _, row in sorted(merged.items())]
    return rows, stated


def _hints_digest(pairings: list[dict]) -> str:
    return _digest([{"pages": p["pages"], "line_ranges": p["line_ranges"], "bases": p["bases"]} for p in pairings])


def inputs_of(material: dict) -> dict[str, Any]:
    """Everything a document is current for. Two materials with equal inputs give the same links."""
    transcript = material.get("transcript") or {}
    return {
        "deck": _identity(material.get("deck")),
        "map_revision": (material.get("slides") or {}).get("map_revision"),
        "transcript": _identity(transcript) if transcript.get("state") == "one" else None,
        "recordings": [dict(_identity(recording), generation=(recording.get("generated") or {}).get("generation")) for recording in material.get("recordings") or []],
        "text_alignment_version": alignment.TEXT_METHOD,
        "method_versions": {"alignment": alignment.ALIGNMENT_VERSION, "sequence": alignment.SEQUENCE_METHOD, "baseline": alignment.BASELINE_METHOD, "course_stated": COURSE_STATED_METHOD,
                            "builder": BUILDER_VERSION},
        "hints_digest": _hints_digest(_pairings(material)[0]),
        "selection_version": SELECTION["version"],
    }


# ---- stage h: the selection rule -------------------------------------------------------------------------------------------
def select(candidate: dict, pairings: list[dict]) -> dict[str, Any]:
    """The fixed rule applied to one candidate: shown as a range, or kept as a candidate, and on which test."""
    duration = candidate["end_ms"] - candidate["start_ms"]
    evidence = candidate.get("evidence") or {}
    same = float((evidence.get("baseline") or {}).get("same_slide") or 0.0)
    slide_id = (candidate.get("logical_slide") or {}).get("id")
    inside = any(slide_id in (pairing.get("slide_ids") or []) and any(a <= low and high <= b for a, b in pairing.get("line_ranges") or [])
                 for low, high in evidence.get("transcript_lines") or [] for pairing in pairings or [])
    long_enough, agrees = duration >= SELECTION["min_duration_ms"], same >= SELECTION["min_baseline_same_slide"]
    return {"shown": bool(long_enough and (agrees or inside)), "rule": SELECTION["version"], "duration_ms": duration, "long_enough": long_enough, "baseline_same_slide": same,
            "baseline_agrees": agrees, "inside_course_stated_pairing": inside}


def _why_not_shown(selection: dict) -> str:
    if not selection.get("long_enough"):
        return f"shorter than {SELECTION['min_duration_ms'] / 1000:g} seconds"
    return "the lexical baseline puts most of these windows on another slide or on none, and no course-stated pairing names this slide here"


# ---- compose: the document from gathered material (pure) -------------------------------------------------------------------
def _alignment_not_run(code: str, reason: str, state: str = "not_run") -> dict[str, Any]:
    return {"state": state, "reason": reason, "reason_code": code, "method": _method(alignment.TEXT_METHOD), "version": alignment.ALIGNMENT_VERSION, "transcript": None, "generation": None,
            "lines_total": 0, "lines_in_file": 0, "lines_aligned": 0, "counts": None, "match_ratio": None, "generated": None, "lines": []}


def _text_alignment(generated: dict, transcript: dict) -> tuple[dict[str, Any], dict | None]:
    """Stage b for one recording: the record kept in the document, and the engine's mapping when it was accepted."""
    state = transcript.get("state")
    if state == "none":
        return _alignment_not_run("no_transcript", "The unit has no original plain-text transcript.", "no_transcript"), None
    if state != "one":
        return _alignment_not_run("several_transcripts", "The unit has several plain-text transcripts; which one this recording goes with is not guessed."), None
    lines = list(transcript.get("lines") or [])
    words = [dict({"text": word.get("text") or "", "start": word["start_ms"] / 1000, "end": word["end_ms"] / 1000}, **({"probability": word["probability"]} if "probability" in word else {}))
             for segment in generated.get("segments") or [] for word in segment.get("words") or []]
    covered = [(interval["start_ms"] / 1000, interval["end_ms"] / 1000) for interval in generated.get("covered_intervals") or []]
    mapping = alignment.align_text(words, lines, covered=covered, acoustic=generated.get("review_state") or "generated_unreviewed")
    accepted = bool(mapping["accepted"])
    rows = []
    if accepted:  # a refused mapping times no line, so it lists none
        for row in mapping["lines"]:
            span = row["span"] if row["status"] == "aligned" else None
            rows.append({"line": row["line"], "status": row["status"], "start_ms": _ms(span["start"]) if span else None, "end_ms": _ms(span["end"]) if span else None,
                         "matched": row["matched"], "total": row["total"]})
    record = {"state": "accepted" if accepted else "refused", "reason": mapping["reason"], "reason_code": mapping["reason_code"], "method": _method(mapping["method"]),
              "version": mapping["version"], "transcript": _identity(transcript), "generation": generated.get("generation"), "lines_total": mapping["transcript"]["token_lines"],
              "lines_in_file": len(lines), "lines_aligned": mapping["counts"]["aligned"] if accepted else 0, "counts": dict(mapping["counts"]) if accepted else None,
              "match_ratio": mapping["match_ratio"],
              "generated": {"words": mapping["generated"]["words"], "tokens": mapping["generated"]["tokens"], "matched_tokens": mapping["generated"]["matched_tokens"],
                            "share_inside_matched_corridor": mapping["coverage"]["generated_tokens"], "words_outside_covered": mapping["generated"]["words_outside_covered"]},
              "lines": rows}
    return record, (mapping if accepted else None)


def _section_links(pairings: list[dict], line_rows: list[dict], recording: dict, generated: dict, deck: dict | None, transcript: dict) -> tuple[list[dict], dict[str, int]]:
    """Stage g: one link per timed stretch of each stated line range (``SECTION_RULE``). Statements that give the same
    pages the same stretch are one link that names every one of them."""
    timed = {row["line"]: row for row in line_rows if row["status"] == "aligned"}
    spoken = {row["line"] for row in line_rows if row["total"] > 0}
    found: dict[tuple, dict] = {}
    with_time = 0
    for pairing in pairings:
        before = with_time
        ranges: list[list[int]] = []
        for a, b in pairing["line_ranges"]:  # ranges that touch are one run of lines
            if ranges and a <= ranges[-1][1] + 1:
                ranges[-1][1] = max(ranges[-1][1], b)
            else:
                ranges.append([a, b])
        for a, b in ranges:
            stretch: list[dict] = []
            stretches: list[list[dict]] = []
            for number in sorted(n for n in timed if a <= n <= b):
                row = timed[number]
                if stretch and row["start_ms"] - stretch[-1]["end_ms"] > SECTION_RULE["max_gap_ms"]:
                    stretches.append(stretch)
                    stretch = []
                stretch.append(row)
            if stretch:
                stretches.append(stretch)
            for rows in stretches:
                start_ms, end_ms = rows[0]["start_ms"], rows[-1]["end_ms"]
                if end_ms <= start_ms:
                    continue
                with_time = before + 1
                entry = found.setdefault((tuple(pairing["pages"]), start_ms, end_ms), {"pages": list(pairing["pages"]), "rows": rows, "slide_ids": [], "bases": set(), "labels": [],
                                                                                    "refs": [], "stated": set()})
                entry["bases"].update(pairing["bases"])
                entry["stated"].update((x, y) for x, y in pairing["line_ranges"])
                entry["slide_ids"].extend(slide_id for slide_id in pairing.get("slide_ids") or [] if slide_id not in entry["slide_ids"])
                entry["labels"].extend(label for label in pairing.get("labels") or [] if label not in entry["labels"])
                entry["refs"].extend(ref for ref in pairing.get("refs") or [] if ref not in entry["refs"])
    links: list[dict] = []
    for (_, start_ms, end_ms), entry in sorted(found.items(), key=lambda item: (item[0][1], item[0][2], item[0][0])):
        rows, bases, stated = entry["rows"], sorted(entry["bases"]), sorted(entry["stated"])
        first, last = rows[0]["line"], rows[-1]["line"]
        written = ", ".join(f"{x}–{y}" if x != y else str(x) for x, y in stated)
        links.append({
            "range_id": f"tl-{_digest([recording['sha256'], generated.get('generation'), entry['pages'], start_ms, end_ms, COURSE_STATED_METHOD])[:12]}-s{len(links) + 1}",
            "recording": _identity(recording), "timebase": "original_source_start", "start_ms": start_ms, "end_ms": end_ms,
            "logical_slide": None, "logical_slides": list(entry["slide_ids"]), "deck": _identity(deck),
            "support": {"scope": "section", "pages": list(entry["pages"]), "builds": None, "group_kind": None},
            "relation": "discussed_during", "method": _method(COURSE_STATED_METHOD), "origin": "reviewed_source_map", "review_state": "generated",
            "quality": {
                "acoustic": {"state": generated.get("review_state") or "generated_unreviewed",
                             "basis": f"Times of generated speech text (generation {generated.get('generation')}), unreviewed, carried to transcript lines by {alignment.TEXT_METHOD}."},
                "association": {"state": "course_stated", "basis": f"The course's own record ({', '.join(bases)}) pairs transcript lines {written} with these pages; it names a section, not one page."},
                "group_mapping": {"state": "not_applicable", "basis": "The pages are the ones the course wrote; no grouping of pages is involved."}},
            "why": "The course's own record places these transcript lines with these pages.",
            "evidence": {"transcript_lines": [[first, last]], "terms": [], "shape": "course_stated_section", "lines_timed": len(rows),
                         "lines_spoken": sum(1 for n in range(first, last + 1) if n in spoken), "stated_line_ranges": [list(r) for r in stated],
                         "bases": bases, "labels": list(entry["labels"]), "refs": list(entry["refs"]), "transcript": _identity(transcript)},
            "selection": {"shown": True, "rule": SELECTION["version"], "reason": "course_stated"}, "annotation_id": None})
    return links, {"pairings": len(pairings), "pairings_timed": with_time, "links": len(links), "pairings_without_timed_lines": len(pairings) - with_time}


def _speech_outside(segments: list[dict], windows: list[dict], source_id: str, duration: int | None) -> list[dict]:
    """Recognised speech that lies in no window (``SPEECH_OUTSIDE_RULE``): intervals with measured word times."""
    spans: list[list[int]] = []
    for start, end in sorted((_ms(w["start"]), _ms(w["end"])) for w in windows if w.get("start") is not None and w.get("end") is not None):
        if spans and start <= spans[-1][1]:
            spans[-1][1] = max(spans[-1][1], end)
        else:
            spans.append([start, end])
    starts = [start for start, _ in spans]
    words = sorted((word for segment in segments for word in segment.get("words") or [] if word.get("start_ms") is not None and word.get("end_ms") is not None),
                   key=lambda word: (word["start_ms"], word["end_ms"]))
    runs: list[list[dict]] = []
    run: list[dict] = []
    for word in words:
        middle = (word["start_ms"] + word["end_ms"]) / 2
        at = bisect_right(starts, middle) - 1
        inside = at >= 0 and middle <= spans[at][1]
        if run and (inside or word["start_ms"] - run[-1]["end_ms"] > SPEECH_OUTSIDE_RULE["max_gap_ms"]):
            runs.append(run)
            run = []
        if not inside:
            run.append(word)
    if run:
        runs.append(run)
    found = []
    for run in runs:
        if not tokens(" ".join(str(word.get("text") or "") for word in run)):
            continue  # fillers and function words only: nothing in it could be about a slide
        start_ms, end_ms = max(0, run[0]["start_ms"]), max(word["end_ms"] for word in run)
        before = bisect_right(starts, start_ms) - 1  # never into a window: word times may overlap a neighbouring line by a few milliseconds
        if before >= 0:
            start_ms = max(start_ms, spans[before][1])
        after = bisect_right(starts, start_ms)
        if after < len(spans):
            end_ms = min(end_ms, spans[after][0])
        if duration:
            end_ms = min(end_ms, int(duration))
        if end_ms > start_ms:
            found.append({"recording_source_id": source_id, "start_ms": start_ms, "end_ms": end_ms, "words": len(run), "within": None})
    return found


def _recording_record(recording: dict, material: dict, slides_block: dict, pairings: list[dict], stated: int) -> tuple[dict, dict[str, list]]:
    """All stages for one recording: its stage record and what it produced."""
    generated = recording.get("generated")
    transcript = material.get("transcript") or {"state": "none"}
    deck = material.get("deck")
    slides = slides_block["logical_slides"]
    by_id = {slide["slide_id"]: slide for slide in slides}
    engine_slides = [{key: slide.get(key) for key in ("slide_id", "pages", "title", "text", "role", "grouping")} for slide in slides]
    produced: dict[str, list] = {"links": [], "candidates": [], "unassigned": [], "line_times": [], "speech_outside": []}
    sequence = _method(alignment.SEQUENCE_METHOD)
    stages: dict[str, Any] = {
        "generated": {"state": "none", "generation": None},
        "text_alignment": _alignment_not_run("no_generated_timing", "Nothing was generated for this recording."),
        "windows": {"basis": None, "count": 0, "why": "No generated timing."},
        "slides": {"basis": slides_block["basis"], "count": len(slides), "map_revision": slides_block.get("map_revision")},
        "hints": {"stated": stated, "distinct": len(pairings), "used": 0, "usable": False, "why": "No association ran.", "digest": _hints_digest(pairings)},
        "association": {"state": "not_run", "cause": "no_generated_timing", "method": sequence, "occurrences": 0, "unassigned": 0, "unassigned_ms": 0},
        "course_stated": {"pairings": len(pairings), "pairings_timed": 0, "links": 0, "pairings_without_timed_lines": len(pairings)},
        "selection": {"rule": SELECTION["version"], "shown": 0, "candidates": 0},
    }
    record = {**_identity(recording), "filename": recording.get("filename"), "duration_ms": recording.get("duration_ms"), "readable": bool(recording.get("readable", True)),
              "stage": "audio_unprocessed", "stages": stages, "summaries": None}
    if not record["readable"]:
        record["stage"] = "recording_unavailable"
        stages["association"]["cause"] = "recording_unavailable"
        stages["text_alignment"] = _alignment_not_run("recording_unavailable", "The recording cannot be read.")
        return record, produced
    if not generated:
        return record, produced

    # a. generated
    segments = generated.get("segments") or []
    review_state = generated.get("review_state") or "generated_unreviewed"
    producer = generated.get("producer") or {}
    unresolved = [{"start_ms": i["start_ms"], "end_ms": i["end_ms"], "reason": i.get("reason")} for i in generated.get("unresolved_intervals") or []]
    stages["generated"] = {"state": "current", "generation": generated.get("generation"), "review_state": review_state, "text_origin": generated.get("text_origin") or "generated_speech_text",
                           "producer": {key: producer.get(key) for key in ("tool", "model", "language")}, "window": generated.get("window"), "duration_ms": generated.get("duration_ms"),
                           "covered_intervals": _pairs(generated.get("covered_intervals")), "unresolved_intervals": unresolved,
                           "unresolved_ms": sum(i["end_ms"] - i["start_ms"] for i in unresolved), "coverage_fraction": generated.get("coverage_fraction"),
                           "covers_whole_recording": bool(generated.get("covers_whole_recording")), "segments": len(segments), "words": sum(len(s.get("words") or []) for s in segments)}
    record["stage"] = "processed"
    duration = generated.get("duration_ms") or recording.get("duration_ms")

    # b. text alignment
    stages["text_alignment"], mapping = _text_alignment(generated, transcript)
    line_rows = stages["text_alignment"]["lines"]
    produced["line_times"] = [{"recording_source_id": recording["source_id"], "transcript_source_id": transcript.get("source_id"), "line": row["line"], "start_ms": row["start_ms"],
                               "end_ms": row["end_ms"], "matched": row["matched"], "total": row["total"]} for row in line_rows if row["status"] == "aligned"]

    # c. windows
    if mapping is not None:
        windows = alignment.windows_from_lines(list(transcript.get("lines") or []), mapping, timed_only=True)
        basis, why = "timed_transcript_lines", "The text alignment was accepted: one window per transcript line that received a time."
    else:
        windows = alignment.windows_from_segments([{"start": s["start_ms"] / 1000, "end": s["end_ms"] / 1000, "text": s.get("text") or ""} for s in segments])
        fallback = {"refused": "The text alignment was refused", "no_transcript": "There is no original transcript", "not_run": "The text alignment did not run"}[stages["text_alignment"]["state"]]
        basis, why = "generated_segments", f"{fallback} ({stages['text_alignment']['reason_code']}): the windows are generated segments, which carry no transcript line numbers."
    # c'. what was recognised outside every window: possible only with line windows (generated segments are all windows)
    stray = _speech_outside(segments, windows, recording["source_id"], duration) if mapping is not None else []
    produced["speech_outside"] = stray
    stages["windows"] = {"basis": basis, "count": len(windows), "why": why,
                         "speech_outside": {"intervals": len(stray), "ms": sum(u["end_ms"] - u["start_ms"] for u in stray), "words": sum(u["words"] for u in stray)}}

    # g. what the course states, timed through the lines (needs no association)
    if mapping is not None:
        sections, stages["course_stated"] = _section_links(pairings, line_rows, recording, generated, deck, transcript)
        produced["links"].extend(sections)

    # e. hints for the engine
    with_slides = [pairing for pairing in pairings if pairing.get("slide_ids")]
    usable = mapping is not None
    hints = [{"slide_ids": list(p["slide_ids"]), "line_ranges": [list(r) for r in p["line_ranges"]], "basis": "+".join(p["bases"])} for p in with_slides] if usable else []
    stages["hints"].update(used=len(hints), usable=usable, why="The windows are transcript lines, so a stated line range can be compared with them." if usable else
                           "Not usable: the windows are generated segments and carry no transcript line numbers.")

    # f. association
    if not any((slide.get("text") or "").strip() for slide in slides):
        stages["association"]["cause"] = "no_slide_text"
        return record, produced
    if not windows:
        stages["association"]["cause"] = "no_windows"
        return record, produced
    result = alignment.cross_check_with_baseline(alignment.align_windows_to_slides(windows, engine_slides, hints=hints or None, acoustic=review_state, initial="auto"), windows, engine_slides)
    baseline = alignment.baseline_assignments(windows, engine_slides)
    acoustic_basis = (f"Times of generated speech text (generation {generated.get('generation')}; {producer.get('tool') or 'tool not stated'}, {producer.get('model') or 'model not stated'}), "
                      "unreviewed, " + (f"carried to transcript lines by {alignment.TEXT_METHOD}." if mapping is not None else "taken from generated segments."))
    shown = kept = 0
    for occurrence in result["occurrences"]:
        if occurrence.get("start") is None or occurrence.get("end") is None:
            continue
        start_ms, end_ms = max(0, _ms(occurrence["start"])), _ms(occurrence["end"])
        if duration:
            end_ms = min(end_ms, int(duration))
        if end_ms <= start_ms:
            continue
        slide = by_id[occurrence["slide_id"]]
        support = occurrence["support"]
        first, last = occurrence["windows"]
        agreement = support["baseline"]
        link = {
            "range_id": f"tl-{_digest([recording['sha256'], generated.get('generation'), slide['slide_id'], start_ms, end_ms, alignment.SEQUENCE_METHOD])[:12]}-o{occurrence['occurrence']}",
            "recording": _identity(recording), "timebase": "original_source_start", "start_ms": start_ms, "end_ms": end_ms,
            "logical_slide": {"id": slide["slide_id"], "map_revision": slides_block.get("map_revision")}, "deck": _identity(deck),
            "support": {"scope": "build_group" if len(slide["pages"]) > 1 else "page", "pages": list(slide["pages"]), "builds": None,
                        "group_kind": slide.get("kind") if len(slide["pages"]) > 1 else None},
            "relation": "discussed_during",  # nobody inspected frames: a link never says the slide was shown
            "method": sequence, "origin": "pipeline", "review_state": "generated",
            "quality": {
                "acoustic": {"state": review_state, "basis": acoustic_basis},
                "association": {"state": "candidate",
                                "basis": (f"{alignment.SEQUENCE_METHOD} from wording and order: {support['shape'].replace('_', ' ')}; the lexical baseline puts {agreement['same_slide']:.0%} of "
                                          "these windows on the same slide" + (f"; a course-stated pairing covers them ({', '.join(support['hint_bases'])})" if support["hint_bases"] else "") + ".")},
                "group_mapping": dict(slide["group_mapping"])},
            "why": "The wording of this stretch of the lecture overlaps the text of the " + ("slide's pages." if len(slide["pages"]) > 1 else "page."),
            "evidence": {"transcript_lines": [list(occurrence["lines"])] if occurrence.get("lines") else [],
                         "terms": _terms([windows[w].get("text") or "" for w in range(first, last + 1)], slide.get("text") or ""), "shape": support["shape"],
                         "occurrence": {"index": occurrence["occurrence"], "of": occurrence["of"]}, "windows": {"basis": basis, "first": first, "last": last, "count": last - first + 1},
                         "transition": occurrence["transition"], "revisit": bool(occurrence["revisit"]), "role": slide.get("role") or "unknown",
                         "baseline": {"method": agreement["method"], "same_slide": agreement["same_slide"], "other_slide": agreement["other_slide"], "unassigned": agreement["unassigned"]},
                         "hint_bases": list(support["hint_bases"]),
                         "measures": {"mean_emission": occurrence["score"], "margin_to_runner_up": occurrence["margin"], "lexical": support["lexical"], "context": support["context"],
                                      "hint": support["hint"], "weight": support["weight"]},
                         "runner_up": (occurrence.get("runner_up") or {}).get("slide_id")},
            "annotation_id": None}
        link["selection"] = select(link, pairings)
        if link["selection"]["shown"]:
            shown += 1
            produced["links"].append(link)
        else:
            kept += 1
            produced["candidates"].append(link)
    for interval in result["unassigned"]:
        if interval.get("start") is None or interval.get("end") is None:
            continue
        start_ms, end_ms = max(0, _ms(interval["start"])), _ms(interval["end"])
        if end_ms > start_ms:
            produced["unassigned"].append({"recording_source_id": recording["source_id"], "start_ms": start_ms, "end_ms": end_ms, "reason": interval["reason"],
                                           "between": list(interval.get("between") or []), "best": (interval.get("best") or {}).get("slide_id"),
                                           "transcript_lines": [list(interval["lines"])] if interval.get("lines") else [], "windows": list(interval["windows"]), "words": None})
    # Speech outside every window, placed: inside a suggested range (it bridges an untimed line), inside an unassigned interval, or in neither.
    # Only the last kind is listed as unassigned itself, so that ranges and unassigned intervals never overlap.
    pieces = [(link["start_ms"], link["end_ms"], "range", link["range_id"]) for link in [*produced["links"], *produced["candidates"]] if link["support"]["scope"] != "section"]
    pieces += [(u["start_ms"], u["end_ms"], "unassigned", None) for u in produced["unassigned"]]
    for interval in stray:
        holder = next(((kind, range_id) for a, b, kind, range_id in sorted(pieces, key=lambda piece: piece[:2]) if a <= interval["start_ms"] and interval["end_ms"] <= b), None)
        interval["within"] = {"kind": holder[0], "range_id": holder[1]} if holder else None
    produced["unassigned"].extend({"recording_source_id": u["recording_source_id"], "start_ms": u["start_ms"], "end_ms": u["end_ms"], "reason": SPEECH_OUTSIDE_RULE["reason"], "between": [],
                                   "best": None, "transcript_lines": [], "windows": None, "words": u["words"]} for u in stray if u["within"] is None)
    counts = stages["text_alignment"]["counts"] or {}
    stages["association"] = {"state": "run", "cause": None, "method": sequence, "occurrences": len(result["occurrences"]), "unassigned": len(produced["unassigned"]),
                             "unassigned_ms": sum(u["end_ms"] - u["start_ms"] for u in produced["unassigned"]), "initial": result["initial"]["mode"],
                             # Whether every recognised stretch of speech was a window: generated segments are; transcript lines only when none stayed without
                             # a time and no recognised speech lies outside all of them (speech the transcript lacks is not silence).
                             "all_speech_windowed": mapping is None or (not counts.get("too_few_matches") and not stray)}
    stages["selection"] = {"rule": SELECTION["version"], "shown": shown, "candidates": kept}
    assigned = [slide_id for slide_id in baseline["assignments"] if slide_id is not None]
    cross = result["baseline_cross_check"]
    record["summaries"] = {
        "sequence": {"method": alignment.SEQUENCE_METHOD, "windows": len(windows), "assigned": result["summary"]["assigned"], "unassigned": result["summary"]["unassigned"],
                     "slides": len(slides), "slides_linked": result["summary"]["slides_linked"], "occurrences": len(result["occurrences"])},
        "baseline": {"method": alignment.BASELINE_METHOD, "windows": len(windows), "assigned": len(assigned), "unassigned": len(windows) - len(assigned), "slides": len(slides),
                     "slides_linked": len(set(assigned)), "segments": len(baseline["segments"])},
        "agreement": {"same_slide": cross["windows_assigned_by_both_to_the_same_slide"], "different_slides": cross["windows_assigned_by_both_to_different_slides"],
                      "sequence_only": cross["windows_assigned_by_sequence_only"], "baseline_only": cross["windows_assigned_by_baseline_only"]}}
    record["stage"] = "associated"
    return record, produced


def compose(material: dict, *, now: str) -> dict[str, Any]:
    """The links document of one lecture from gathered material. Pure: nothing is read or written here."""
    slides_block = material.get("slides") or slides_from_pages([])
    pairings, stated = _pairings(material)
    page_to_slide = {page: slide["slide_id"] for slide in slides_block["logical_slides"] for page in slide["pages"]}
    for pairing in pairings:
        pairing["slide_ids"] = list(dict.fromkeys(page_to_slide[page] for page in pairing["pages"] if page in page_to_slide))
    records = []
    produced: dict[str, list] = {"links": [], "candidates": [], "unassigned": [], "line_times": [], "speech_outside": []}
    for recording in material.get("recordings") or []:
        record, made = _recording_record(recording, material, slides_block, pairings, stated)
        records.append(record)
        for key in produced:
            produced[key].extend(made[key])
    order = {record["source_id"]: index for index, record in enumerate(records)}

    def by_time(link: dict) -> tuple:
        return (order.get((link.get("recording") or {}).get("source_id", link.get("recording_source_id")), 0), link["start_ms"], link["end_ms"], str(link.get("range_id")))

    document: dict[str, Any] = {
        "contract": LINKS_CONTRACT, "builder_version": BUILDER_VERSION, "course_id": material.get("course_id"), "lecture_id": material.get("lecture_id"), "title": material.get("title"),
        "built_at": now, "inputs": inputs_of(material), "selection": dict(SELECTION), "section_rule": dict(SECTION_RULE), "speech_outside_rule": dict(SPEECH_OUTSIDE_RULE),
        "slides": {"basis": slides_block["basis"], "count": len(slides_block["logical_slides"]), "page_count": slides_block.get("page_count"), "map_revision": slides_block.get("map_revision")},
        "recordings": records, "line_times": produced["line_times"],
        "links": sorted(produced["links"], key=by_time), "candidates": sorted(produced["candidates"], key=by_time), "unassigned": sorted(produced["unassigned"], key=by_time),
        "speech_outside": sorted(produced["speech_outside"], key=by_time),
        "pairings": pairings, "pairing_notes": list(material.get("pairing_notes") or []),
        "note": "Suggestions from generated speech text, wording and order. Generated is not reviewed and not confirmed; no link says a slide was shown.",
    }
    document = json.loads(c.dump_json(document))  # plain JSON data, exactly what is read back from disk
    document["links_revision"] = _revision_of(document)
    return document


_NOT_IN_REVISION = frozenset({"built_at", "links_revision", "transcript_check"})  # the clock, the revision itself, and the check a build adds after composing


def _revision_of(document: dict) -> str:
    """The revision of a document: a digest of everything it says except when it was built."""
    return _digest({key: value for key, value in document.items() if key not in _NOT_IN_REVISION})


# ---- currentness -----------------------------------------------------------------------------------------------------------
def evaluate(document: dict | None, current_inputs: dict | None, *, reason: str = "not_built") -> dict[str, Any]:
    """A stored document against the inputs as they are now: ``current``, ``stale`` (``differs`` names the inputs; the
    links, candidates and line times of every stale recording are withheld) or ``missing``."""
    if not isinstance(document, dict):
        return {"state": "missing", "reason": reason, "differs": [], "stale_recordings": [], "withheld": {"links": 0, "candidates": 0}, "inputs": None, "current_inputs": current_inputs,
                "built_at": None, "links_revision": None, "recordings": [], "links": [], "candidates": [], "unassigned": [], "line_times": [], "speech_outside": []}
    built, now = document.get("inputs") or {}, current_inputs or {}
    differs = [key for key in _INPUT_ORDER if built.get(key) != now.get(key)]
    was = {row["source_id"]: row for row in built.get("recordings") or []}
    there = {row["source_id"]: row for row in now.get("recordings") or []}
    stale_recordings: list[str] = []
    if set(was) != set(there):
        differs.append("recordings")
    else:
        for source_id in was:
            changed = [name for name, keys in (("recording_sha256", ("sha256", "version_id")), ("generation", ("generation",))) if any(was[source_id].get(k) != there[source_id].get(k) for k in keys)]
            if changed:
                stale_recordings.append(source_id)
                differs.extend(name for name in changed if name not in differs)
    if any(name not in {"recording_sha256", "generation"} for name in differs):
        stale_recordings = list(was)  # a lecture-level input differs: nothing of the document is current

    def keep(rows: list[dict]) -> list[dict]:
        return [row for row in rows if (row.get("recording") or {}).get("source_id", row.get("recording_source_id")) not in stale_recordings]

    result = dict(document)
    for key in ("links", "candidates", "unassigned", "line_times", "speech_outside"):
        result[key] = keep(document.get(key) or []) if differs else list(document.get(key) or [])
    result.update(state="stale" if differs else "current", reason=None, differs=differs, stale_recordings=stale_recordings, current_inputs=current_inputs,
                  withheld={"links": len(document.get("links") or []) - len(result["links"]), "candidates": len(document.get("candidates") or []) - len(result["candidates"])})
    return result


# ---- gather: read-only I/O ---------------------------------------------------------------------------------------------------
class _Course:
    """What one call needs of a course, read once: inventory, identities, the question bank, the derived store."""

    def __init__(self, settings: Settings, course_id: str, preparation: Preparation | None = None):
        binding = settings.courses.get(course_id)
        if binding is None:
            raise TimingLinksError("unknown_course", f"Course {course_id!r} is not one of the configured courses.")
        if not binding.usable:
            raise TimingLinksError("course_unusable", binding.problem or f"The binding of course {course_id!r} is not usable.")
        self.settings, self.course_id, self.binding, self.root = settings, course_id, binding, binding.root
        self.preparation = preparation or Preparation(settings, converter=None)
        self.derived = Derived(settings, None, preparation=self.preparation)
        self.inventory = build_inventory(binding)
        self._bank: Any = _UNSET
        self._bank_problem: dict | None = None
        self._hashes: dict[str, str] = {}
        self.notes: list[dict] = []

    def lecture(self, lecture_id: str) -> dict:
        lecture = next((l for l in self.inventory["lectures"] if l["lecture_id"] == lecture_id), None) if _LECTURE_ID.fullmatch(lecture_id or "") else None
        if lecture is None:
            raise TimingLinksError("unknown_lecture", f"Course {self.course_id!r} has no lecture unit {lecture_id!r}.")
        return lecture

    def sha_of(self, path: Path) -> str:
        return file_sha256(path, self._hashes)

    def bank(self) -> dict | None:
        if self._bank is _UNSET:
            try:
                self._bank = build_question_bank(read_question_index(self.root, self.course_id), self.inventory, reviewed_collections=self.binding.reviewed_collections)
            except OwnerReadError as exc:
                self._bank, self._bank_problem = None, {"code": "question_catalog_unreadable", "detail": exc.code}
        if self._bank_problem is not None and self._bank_problem not in self.notes:
            self.notes.append(self._bank_problem)  # said for every lecture it concerns, not only the first one read
        return self._bank

    def source_map(self, lecture: dict, deck: dict) -> dict | None:
        try:
            return sourcemap.load_or_build(self.settings, self.course_id, deck, lecture=lecture)
        except Exception as exc:  # noqa: BLE001 - a deck that cannot be mapped is matched page by page; it never stops a build
            self.notes.append({"code": "source_map_unavailable", "detail": exc.__class__.__name__})
            return None

    def page_texts(self, lecture_id: str, deck: dict) -> list[str]:
        """Page text when there is no usable map: the prepared text of this deck, else the PDF's own text layer."""
        try:
            stored = json.loads((self.preparation.prepared_dir(self.course_id, lecture_id) / "slides-text.json").read_text(encoding="utf-8"))
            if stored.get("deck_source_id", deck["source_id"]) == deck["source_id"] and isinstance(stored.get("pages"), list):
                return [str(text or "") for text in stored["pages"]]
        except (OSError, ValueError, AttributeError):
            pass
        if deck.get("rendition") != "native_pdf":
            return []
        try:
            return extract_slide_texts(self.root / deck["path"])
        except Exception:  # noqa: BLE001 - an unreadable PDF has no slide text; the stage says so
            return []

    def stated_pairings(self, lecture_id: str, deck: dict | None, transcript: dict | None, page_count: int, line_count: int) -> list[dict]:
        """Pages the course itself pairs with transcript lines of this lecture: study-map rows and catalog locators."""
        if deck is None or transcript is None:
            return []
        found: list[dict] = []
        try:
            from .ownerio import study_maps  # optional reader: without it only the catalog locators are used
        except Exception:  # noqa: BLE001
            study_maps = None
            self.notes.append({"code": "study_maps_reader_unavailable", "detail": None})
        if study_maps is not None:
            try:
                maps = study_maps.read_study_maps(self.root, self.inventory, page_counts={deck["source_id"]: page_count} if page_count else None,
                                                  line_counts={transcript["source_id"]: line_count} if line_count else None, sha_of=self.sha_of)
                for row in study_maps.timing_hints(maps, lecture_id, deck_source_id=deck["source_id"], transcript_source_id=transcript["source_id"]):
                    found.append({"pages": list(row["pages"]), "line_ranges": [list(r) for r in row["transcript_ranges"]], "basis": "course_study_map", "label": row.get("label") or "",
                                  "refs": [{"row": row.get("row"), "map_sha256": row.get("map_sha256"), "bytes_verified": bool(row.get("bytes_verified"))}]})
            except Exception as exc:  # noqa: BLE001 - the reader is another module's; its failure costs the hints, not the build
                self.notes.append({"code": "study_maps_unreadable", "detail": exc.__class__.__name__})
        bank = self.bank()
        for question_id in sorted((bank or {}).get("questions") or {}):
            anchors = [a for a in bank["questions"][question_id]["anchors"] if a.get("lecture_id") == lecture_id]
            pages = sorted({page for a in anchors if a["kind"] == "pages" and a.get("source_id") == deck["source_id"] for page in a.get("pages") or []})
            ranges = sorted({(int(x), int(y)) for a in anchors if a["kind"] == "transcript_lines" and a.get("source_id") == transcript["source_id"] for x, y in a.get("ranges") or []})
            if pages and ranges:
                found.append({"pages": pages, "line_ranges": [list(r) for r in ranges], "basis": "course_locator", "label": question_id, "refs": [{"question_id": question_id}]})
        kept = []
        for pairing in found:  # a statement about pages or lines the files do not have is not used and is named
            if (page_count and max(pairing["pages"]) > page_count) or (line_count and max(b for _, b in pairing["line_ranges"]) > line_count):
                self.notes.append({"code": "pairing_outside_files", "detail": {"basis": pairing["basis"], "label": pairing["label"]}})
                continue
            kept.append(pairing)
        return kept


def _plain_transcripts(lecture: dict) -> list[dict]:
    return [item for session in lecture["sessions"] for item in session["items"]
            if item["kind"] == "lecture_transcript" and item.get("path") and item["rendition"] == "native_text" and Path(item["filename"] or "").suffix.lower() == ".txt" and item["state"] in _READABLE]


def gather(settings: Settings, course_id: str, lecture_id: str, *, preparation: Preparation | None = None, generated: dict | None = None, source_map: Any = _UNSET,
           context: _Course | None = None) -> dict[str, Any]:
    """Everything :func:`compose` needs for one lecture. Reads the course; writes nothing into it (the source map keeps
    its own cache in the app area). ``generated`` (by recording id) and ``source_map`` replace the reads when given."""
    ctx = context or _Course(settings, course_id, preparation)
    ctx.notes = []
    lecture = ctx.lecture(lecture_id)
    deck = primary_deck(lecture)
    deck_block, slides_block, deck_item = None, slides_from_pages([]), None
    if deck is not None and deck.get("path") and deck["state"] in _READABLE:
        deck_item = deck
        version_id, sha256 = ctx.preparation.identity_of(course_id, deck)
        deck_block = {"source_id": deck["source_id"], "version_id": version_id, "sha256": sha256}
        mapped = ctx.source_map(lecture, deck) if source_map is _UNSET else source_map
        slides_block = slides_from_map(mapped)
        if slides_block["basis"] != "source_map" or not any(slide.get("text") for slide in slides_block["logical_slides"]):
            texts = ctx.page_texts(lecture_id, deck)
            if texts and slides_block["basis"] != "source_map":
                slides_block = slides_from_pages(texts)
    transcript: dict[str, Any] = {"state": "none", "source_id": None, "version_id": None, "sha256": None, "lines": []}
    plain = _plain_transcripts(lecture)
    transcript_item = None
    if len(plain) > 1:
        transcript["state"] = "several"
    elif plain:
        try:
            data = (ctx.root / plain[0]["path"]).read_bytes()
        except OSError:
            data = None
        if data is not None:
            transcript_item = plain[0]
            sha256 = c.sha256_hex(data)
            transcript = {"state": "one", "source_id": plain[0]["source_id"], "version_id": plain[0]["version_id"] if plain[0].get("sha256") == sha256 and plain[0].get("version_id") else disk_version_id(sha256),
                          "sha256": sha256, "path": plain[0]["path"], "lines": data.decode("utf-8-sig", errors="replace").splitlines()[:MAX_TRANSCRIPT_LINES]}
    recordings = []
    for session in lecture["sessions"]:
        for item in session["items"]:
            if item["kind"] != "lecture_recording" or not item.get("path"):
                continue
            readable = item["state"] in _READABLE
            version_id, sha256 = ctx.preparation.identity_of(course_id, item) if readable else (None, None)
            current = None
            if readable:
                current = generated.get(item["source_id"]) if generated is not None else ctx.derived.current(course_id, item["source_id"])
            recordings.append({"source_id": item["source_id"], "version_id": version_id, "sha256": sha256, "filename": item["filename"], "state": item["state"], "readable": readable,
                               "session_id": session["session_id"], "duration_ms": (current or {}).get("duration_ms") or media_duration_ms(ctx.root / item["path"]), "generated": current})
    pairings = ctx.stated_pairings(lecture_id, deck_item, transcript_item and transcript, slides_block.get("page_count") or 0, len(transcript["lines"]))
    return {"course_id": course_id, "lecture_id": lecture_id, "title": lecture.get("title"), "deck": deck_block, "slides": slides_block, "transcript": transcript, "pairings": pairings,
            "pairing_notes": list(ctx.notes), "recordings": recordings}


def current_inputs(settings: Settings, course_id: str, lecture_id: str, *, preparation: Preparation | None = None, generated: dict | None = None, source_map: Any = _UNSET,
                   context: _Course | None = None) -> dict[str, Any]:
    """The inputs as they are now, for :func:`read`. Pass what the caller has already loaded (``generated`` by recording
    id — a dict with at least ``generation`` — and the deck's ``source_map``) and nothing is loaded twice."""
    return inputs_of(gather(settings, course_id, lecture_id, preparation=preparation, generated=generated, source_map=source_map, context=context))


# ---- build and read --------------------------------------------------------------------------------------------------------
def _stage_of(document: dict) -> str:
    stages = [record["stage"] for record in document.get("recordings") or [] if record["stage"] != "recording_unavailable"]
    if not stages:
        return "no_recording"
    if "associated" in stages:
        return "associated"
    return "audio_unprocessed" if all(stage == "audio_unprocessed" for stage in stages) else "processed"


def build(settings: Settings, course_id: str, lecture_id: str, *, journal: Any = None, preparation: Preparation | None = None, now: Callable[[], str] | None = None) -> dict[str, Any]:
    """Build the lecture's links from its current inputs and write them atomically into the app's private area.

    Nothing is written into a course folder: the course's files are read, and under the read-only profile the app
    area is a shadow folder in the state directory. Annotations are not read, written or changed by a build.
    """
    path = _path(settings, course_id, lecture_id)
    ctx = _Course(settings, course_id, preparation)
    material = gather(settings, course_id, lecture_id, context=ctx)
    document = compose(material, now=(now or _utc_now)())
    transcript = material["transcript"]
    document["transcript_check"] = None
    if transcript.get("state") == "one":  # read again after everything ran: this module has no code path that writes it
        try:
            after = c.sha256_hex((ctx.root / transcript["path"]).read_bytes())
        except OSError:
            after = None
        document["transcript_check"] = {"source_id": transcript["source_id"], "sha256_before": transcript["sha256"], "sha256_after": after, "unchanged": after == transcript["sha256"]}
    data = c.dump_json(document)
    replace_atomic(path, data)
    if journal is not None:
        journal.add_receipt(kind=RECEIPT_KIND, job_id=None, sha256=c.sha256_hex(data),
                            payload={"course_id": course_id, "lecture_id": lecture_id, "links_revision": document["links_revision"], "built_at": document["built_at"],
                                     "stage": _stage_of(document), "links": len(document["links"]), "candidates": len(document["candidates"]), "unassigned": len(document["unassigned"]),
                                     "recordings": [{"source_id": r["source_id"], "stage": r["stage"], "generation": r["stages"]["generated"]["generation"]} for r in document["recordings"]],
                                     "builder": BUILDER_VERSION, "selection": SELECTION["version"]})
    return document


def _load(settings: Settings, course_id: str, lecture_id: str) -> tuple[dict | None, str]:
    path = _path(settings, course_id, lecture_id)
    try:
        if not path.is_file():
            return None, "not_built"
        if path.stat().st_size > MAX_DOCUMENT_BYTES:
            return None, "unreadable"
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "unreadable"
    if not isinstance(document, dict) or document.get("contract") != LINKS_CONTRACT or document.get("course_id") != course_id or document.get("lecture_id") != lecture_id \
            or not isinstance(document.get("inputs"), dict) or not isinstance(document.get("recordings"), list):
        return None, "unreadable"
    try:
        if _revision_of(document) != document.get("links_revision"):  # altered after it was built: its links are not the ones its inputs produced
            return None, "revision_mismatch"
    except (TypeError, ValueError):
        return None, "unreadable"
    return document, "ok"


def _rejected_annotations(settings: Settings, course_id: str) -> list[dict]:
    try:
        records = AnnotationStore(settings).current_records(course_id)
    except Exception:  # noqa: BLE001 - a damaged annotation folder must not hide the suggestions; it is reported by its own view
        return []
    return [r for r in records if r.get("review_state") == "rejected" and r["from"]["locator"].get("kind") == "page" and r["to"]["locator"].get("kind") == "media"]


def read(settings: Settings, course_id: str, lecture_id: str, *, current_inputs: dict | None, annotations: list[dict] | None = None) -> dict[str, Any]:
    """The stored document with ``state`` ``current`` | ``stale`` (``differs``) | ``missing`` (``reason``: ``not_built``,
    ``unreadable`` or ``revision_mismatch``). A stale document yields no ranges. ``rejected_annotations`` are the learner's rejections (``ll.annotation/1`` records, read
    from the annotation store unless given): on read they suppress the suggestion they match."""
    document, reason = _load(settings, course_id, lecture_id)
    result = evaluate(document, current_inputs, reason=reason)
    result["rejected_annotations"] = [r for r in annotations if r.get("review_state") == "rejected"] if annotations is not None else _rejected_annotations(settings, course_id)
    return result


# ---- enrich: the lecture view ----------------------------------------------------------------------------------------------
_NO_RANGE_TEXT = {
    "recording_unavailable": "No recording is available for this lecture.",
    "no_range_expected": "No recording range is expected for this page.",
    "audio_unprocessed": "The recording has not been processed yet.",
    "association_not_run": "The recording has timing, but slide matching has not run with the current inputs.",
    "ambiguous": "Possible matches were found, none clear enough to show as this page's range.",
    "not_discussed": "The whole recording was processed and matched; nothing was found for this page.",
}
_ANNOTATION_METHOD = {"manual_review": "manual", "reviewed_source_map": "reviewed-source-map", "visual_and_transcript": "visual-and-transcript", "transcript_only": "transcript-cue-match"}


def _page_index(view: dict, source_map: dict | None) -> dict[int, dict[str, Any]]:
    """Logical slide and role of every page: from the view when ``slide_identity`` already wrote them, else from the map."""
    mapped = source_map if isinstance(source_map, dict) else {}
    pages = {page.get("page"): page for page in mapped.get("pages") or [] if isinstance(page, dict)}
    slide_of, role_of = {}, {}
    for slide in mapped.get("logical_slides") or []:
        for page in slide.get("pages") or []:
            slide_of[page] = slide.get("logical_slide_id") or slide.get("id")
            if isinstance(slide.get("role"), str):
                role_of[page] = slide["role"]
    index = {}
    for row in view.get("slides") or []:
        page = row.get("page")
        own, stored = row.get("role"), (pages.get(page) or {}).get("role")
        role = forced = None
        if isinstance(own, dict):
            role, forced = own.get("value") or own.get("role"), own.get("forced_requirements")
        elif isinstance(stored, dict):
            role, forced = stored.get("role") or stored.get("value"), stored.get("forced_requirements")
        elif page in role_of:
            role = role_of[page]
        index[page] = {"slide_id": (row.get("identity") or {}).get("logical_slide_id") or (pages.get(page) or {}).get("logical_slide_id") or slide_of.get(page) or f"p{page}",
                       "role": role or "unknown", "forced": bool(forced) if forced is not None else (role or "unknown") not in NO_FORCED_ROLES}
    return index


def _overlaps(link: dict, start_ms: int, end_ms: int) -> bool:
    """The same occurrence: the interval covers at least half of the suggestion. A touch at one end, or a short link
    of the learner's own inside a long suggestion, is other audio and leaves the suggestion where it is."""
    shared = min(end_ms, link["end_ms"]) - max(start_ms, link["start_ms"])
    return shared > 0 and shared * 2 >= link["end_ms"] - link["start_ms"]


def _as_range(link: dict, index: int, total: int) -> dict[str, Any]:
    evidence = link.get("evidence") or {}
    return {"range_id": link["range_id"], "recording": dict(link["recording"]), "timebase": link["timebase"], "start_ms": link["start_ms"], "end_ms": link["end_ms"],
            "relation": link["relation"], "occurrence_index": index, "occurrences_total": total,
            "support": {"scope": link["support"]["scope"], "pages": list(link["support"]["pages"]), "builds": link["support"].get("builds")},
            "method": dict(link["method"]), "origin": link["origin"], "review_state": link["review_state"], "quality": {name: dict(link["quality"][name]) for name in ("acoustic", "association", "group_mapping")},
            "why": link.get("why"), "evidence": {"transcript_lines": [list(r) for r in evidence.get("transcript_lines") or []], "terms": list(evidence.get("terms") or []), "shape": evidence.get("shape")},
            "annotation_id": None}


def _annotation_range(occurrence: dict, page: int) -> dict[str, Any]:
    """A range from an ``ll.annotation/1`` record of the view (page → media). The record is not changed."""
    record = occurrence.get("record") or {}
    target = occurrence.get("source") or record.get("to") or {}
    basis, confirmed = occurrence.get("basis") or record.get("basis"), (occurrence.get("review_state") or record.get("review_state")) == "confirmed"
    relation = occurrence.get("relation") or record.get("relation") or "discussed_during"
    if relation == "displayed_during" and basis == "transcript_only":
        relation = "discussed_during"  # made from text and cue times alone: nobody looked at frames, so nothing says the page was shown
    origin = "reviewed_source_map" if basis == "reviewed_source_map" else "manual" if confirmed or basis == "manual_review" else "pipeline"
    return {"range_id": f"an-{occurrence.get('annotation_id')}-r{occurrence.get('revision')}", "recording": {key: target.get(key) for key in ("source_id", "version_id", "sha256")},
            "timebase": "original_source_start", "start_ms": occurrence["start_ms"], "end_ms": occurrence["end_ms"], "relation": relation, "occurrence_index": 1, "occurrences_total": 1,
            "support": {"scope": "page", "pages": [page], "builds": None}, "method": {"name": _ANNOTATION_METHOD.get(basis, str(basis)), "version": None}, "origin": origin,
            "review_state": "human_confirmed" if confirmed else "generated",
            "quality": {"acoustic": {"state": "human_entered" if origin == "manual" else "recorded_unreviewed",
                                     "basis": "Times as entered or confirmed by a person." if origin == "manual" else "Times as recorded with the link; nobody has reviewed them."},
                        "association": {"state": "human_confirmed" if confirmed else "candidate",
                                        "basis": "Confirmed by a person for this page." if confirmed else "Suggested for this page; not confirmed."},
                        "group_mapping": {"state": "not_applicable", "basis": "Recorded for this page itself."}},
            "why": "A link a person entered or confirmed." if origin == "manual" else "A link kept in the course's reviewed source links." if origin == "reviewed_source_map"
            else "An earlier suggestion from the transcript's cue times.",
            "evidence": {"transcript_lines": [], "terms": [], "shape": None}, "annotation_id": occurrence.get("annotation_id")}


def _numbered(ranges: list[dict]) -> list[dict]:
    ranges = sorted(ranges, key=lambda r: (r["start_ms"], r["end_ms"], str(r["range_id"])))
    return [dict(item, occurrence_index=index, occurrences_total=len(ranges)) for index, item in enumerate(ranges, start=1)]


def _generated_block(current: dict | None) -> dict[str, Any] | None:
    if not current:
        return None
    unresolved = _pairs(current.get("unresolved_intervals"))
    return {"generation": current.get("generation"), "text_origin": current.get("text_origin") or "generated_speech_text", "review_state": current.get("review_state") or "generated_unreviewed",
            "covered_intervals": _pairs(current.get("covered_intervals")), "unresolved_intervals": unresolved, "unresolved_ms": sum(b - a for a, b in unresolved),
            "coverage_fraction": current.get("coverage_fraction"), "covers_whole_recording": bool(current.get("covers_whole_recording"))}


def _associations(view: dict, links: dict, generated: dict) -> dict[str, dict[str, Any]]:
    """Per recording of the view: where its association stands under the current inputs."""
    records = {record["source_id"]: record for record in links.get("recordings") or []}
    built = {row["source_id"]: row for row in (links.get("inputs") or {}).get("recordings") or []}
    out = {}
    for recording in view.get("recordings") or []:
        source_id = recording["source_id"]
        record = records.get(source_id)
        ran = bool(record and record["stages"]["association"]["state"] == "run")
        if links["state"] == "missing" or record is None:
            state, cause = "not_run", "not_run"
        elif source_id in links.get("stale_recordings", []):  # every recording of the document when a lecture-level input differs
            state, cause = ("stale", "inputs_changed") if ran else ("not_run", "not_run")
        elif ran:
            state, cause = "current", None
        else:
            state, cause = "not_run", "not_run"
        usable = record is not None and source_id not in links.get("stale_recordings", []) and links["state"] != "missing"
        why = None if ran or record is None else record["stages"]["association"]["cause"]
        if usable and state == "not_run" and why == "no_slide_text":
            cause = "no_adequate_method"  # the document is current and says why nothing ran: the only method compares wording, and this deck has none to compare
        out[source_id] = {"state": state, "cause": cause, "record": record if usable else None, "any_record": record, "inputs": built.get(source_id),
                          "why_not_run": why, "generated": generated.get(source_id)}
    return out


def _timing_block(view: dict, links: dict, generated: dict, associations: dict[str, dict]) -> dict[str, Any]:
    recordings = view.get("recordings") or []
    readable = [r for r in recordings if r.get("state") in _READABLE]
    rows = []
    for recording in recordings:
        info = associations[recording["source_id"]]
        record, built = info["record"], info["inputs"] or {}
        mapping = (record or {}).get("stages", {}).get("text_alignment")
        ran = (info["any_record"] or {}).get("stages", {}).get("association", {}) if info["state"] != "not_run" else {}
        rows.append({
            "source_id": recording["source_id"], "filename": recording.get("filename"), "duration_ms": recording.get("duration_ms"),
            "generated": _generated_block(info["generated"]),
            "text_alignment": ({"state": mapping["state"], "reason": mapping["reason"], "lines_aligned": mapping["lines_aligned"], "lines_total": mapping["lines_total"], "method": dict(mapping["method"])}
                               if mapping else {"state": "not_run", "reason": None, "lines_aligned": 0, "lines_total": 0, "method": _method(alignment.TEXT_METHOD)}),
            "association": {"state": info["state"], "cause": info["cause"], "method": _method(alignment.SEQUENCE_METHOD), "built_at": links.get("built_at") if info["state"] != "not_run" else None,
                            "ranges": sum(1 for link in links.get("links") or [] if link["recording"]["source_id"] == recording["source_id"]) if info["state"] == "current" else 0,
                            "unassigned_ms": ran.get("unassigned_ms", 0) if info["state"] == "current" else 0,
                            "inputs": {"recording_sha256": built.get("sha256") if info["state"] != "not_run" else recording.get("sha256"),
                                       "generation": built.get("generation") if info["state"] != "not_run" else None,
                                       "map_revision": (links.get("inputs") or {}).get("map_revision") if info["state"] != "not_run" else None,
                                       "method_version": _method(alignment.SEQUENCE_METHOD)["version"]}}})
    with_timing = [r for r in readable if generated.get(r["source_id"])]
    if not readable:
        stage = "no_recording"
    elif not with_timing:
        stage = "audio_unprocessed"
    elif all(associations[r["source_id"]]["state"] == "current" for r in with_timing):
        stage = "associated"
    else:
        stage = "processed" if all((generated.get(r["source_id"]) or {}).get("covers_whole_recording") for r in readable) else "partly_processed"
    return {"stage": stage, "recordings": rows, "summary": {}}


def enrich(view: dict, *, source_map: dict | None, links: dict | None, generated: dict | None, annotations: list[dict] | None = None) -> dict[str, Any]:
    """Set ``slides[].ranges``, ``slides[].no_range`` and ``timing`` on a lecture view (``r2-read-api.md`` 1.2 and 1.3).

    ``links`` is what :func:`read` returned (``None``: nothing was built); ``generated`` is ``Derived.current`` per
    recording id of the view (``None`` where nothing is generated). ``annotations`` — ``ll.annotation/1`` records —
    replaces the rejections that came with ``links``. Pure: reads only what it is handed, and changes only the view.

    Order of a page's ranges: links a person entered or confirmed first; then the current suggestions for the page's
    logical slide and what the course states for it, earliest first. A suggestion of which a person's link for the
    same page covers at least half is not shown beside it, and one that a rejected annotation covers by at least half
    is not shown: on every page of its logical slide for a page or build-group suggestion, on the page of the rejection
    only for a course-stated section. A stretch is listed once on a page. A person's link to a recording that cannot
    be played is kept as a record and named in ``no_range.detail.links_without_recording``; it is not a range.

    Also set, on every entry of ``transcripts``: ``generated_line_times`` (the lines of the course transcript that the
    accepted text alignment of the current document timed: ``{line, start_ms, end_ms, recording_source_id,
    review_state: "generated", method}``; ``line_times`` — links a person made — is left as it is) and
    ``text_alignment`` (one row per recording that was aligned with this transcript).
    """
    generated = generated or {}
    links = links if isinstance(links, dict) and links.get("state") in {"current", "stale", "missing"} else evaluate(None, None)
    deck_id = (view.get("deck") or {}).get("source_id")
    built_deck = ((links.get("inputs") or {}).get("deck") or {}).get("source_id")
    if links["state"] != "missing" and built_deck != deck_id:
        links = evaluate(None, links.get("current_inputs"), reason="built_for_another_deck")  # ranges are for pages of the deck they were made for
    index = _page_index(view, source_map)
    recordings = view.get("recordings") or []
    readable = [r for r in recordings if r.get("state") in _READABLE]
    unreadable = {r["source_id"] for r in recordings if r.get("state") not in _READABLE}
    associations = _associations(view, links, generated)
    rejected = [{"page": r["from"]["locator"].get("page"), "recording": r["to"]["source_id"], "start_ms": r["to"]["locator"]["start_ms"], "end_ms": r["to"]["locator"]["end_ms"],
                 "annotation_id": r.get("annotation_id")}
                for r in (annotations if annotations is not None else links.get("rejected_annotations") or [])
                if r.get("review_state") == "rejected" and r["from"]["locator"].get("kind") == "page" and r["to"]["locator"].get("kind") == "media"
                and (deck_id is None or r["from"].get("source_id") == deck_id)]
    shown, candidates = list(links.get("links") or []), list(links.get("candidates") or [])
    ambiguous = [u for u in links.get("unassigned") or [] if u.get("reason") == "ambiguous" and u.get("between")]

    def rejected_for(link: dict, page: int) -> bool:
        """Whether the learner rejected this suggestion for ``page``. A build group is one logical slide, so a rejection
        recorded on any of its builds holds on all of them. A section is the course's statement about several pages:
        a rejection recorded on one of them is a judgment of that page and removes the range from that page only."""
        whole_link = link["support"]["scope"] != "section"
        return any(r["recording"] == link["recording"]["source_id"] and (r["page"] in link["support"]["pages"] if whole_link else r["page"] == page)
                   and _overlaps(link, r["start_ms"], r["end_ms"]) for r in rejected)

    unavailable_reason = None
    if not readable:
        unavailable_reason = "recording_unreadable" if recordings else "no_recording_in_session" if view.get("sessions") else "no_session_linked"
    with_timing = [r for r in readable if generated.get(r["source_id"])]
    not_current = [associations[r["source_id"]] for r in with_timing if associations[r["source_id"]]["state"] != "current"]
    whole = bool(readable) and all((generated.get(r["source_id"]) or {}).get("covers_whole_recording") for r in readable)
    all_windowed = all(((associations[r["source_id"]]["record"] or {}).get("stages", {}).get("association", {}).get("all_speech_windowed", False)) for r in with_timing)
    processed = [[r["source_id"], a, b] for r in with_timing for a, b in _pairs(generated[r["source_id"]].get("covered_intervals"))]
    # Recognised speech that was in no window was not compared with any slide: never "nothing was said". Listed here: the stretches that lie in no range at all.
    not_matched = [[u["recording_source_id"], u["start_ms"], u["end_ms"]] for u in links.get("unassigned") or [] if u.get("reason") == SPEECH_OUTSIDE_RULE["reason"]]
    coverage = []
    for r in with_timing:
        current, stages = generated[r["source_id"]], (associations[r["source_id"]]["record"] or {}).get("stages") or {}
        mapping = stages.get("text_alignment") or {}
        coverage.append({"recording_source_id": r["source_id"], "coverage_fraction": current.get("coverage_fraction"), "covers_whole_recording": bool(current.get("covers_whole_recording")),
                         "unresolved_ms": sum(b - a for a, b in _pairs(current.get("unresolved_intervals"))), "lines_aligned": mapping.get("lines_aligned"), "lines_total": mapping.get("lines_total"),
                         "lines_without_time": (mapping.get("counts") or {}).get("too_few_matches") or 0,
                         "speech_without_timed_line_ms": ((stages.get("windows") or {}).get("speech_outside") or {}).get("ms") or 0})
    lines_without_time, stray_ms = sum(row["lines_without_time"] for row in coverage), sum(row["speech_without_timed_line_ms"] for row in coverage)
    durations = [generated[r["source_id"]].get("duration_ms") or r.get("duration_ms") for r in with_timing]
    covered_ms = sum(b - a for _, a, b in processed)
    part_text = (f"Timing covers {_clock(covered_ms)} of the recording's {_clock(sum(durations))}; nothing was found for this page in that part." if durations and all(durations) else
                 "Only part of the recording has timing so far; nothing was found for this page in that part.")
    gaps = ([f"{lines_without_time} transcript line{'' if lines_without_time == 1 else 's'} could not be given a time"] if lines_without_time else []) + \
           ([f"{_clock(stray_ms)} of what was said has no timed line in the transcript and was not matched to slides"] if stray_ms else [])
    whole_text = (f"The recording is transcribed, but {' and '.join(gaps)}; nothing was found for this page in the rest." if gaps else
                  "The recording is transcribed, but not all of it could be matched to slides; nothing was found for this page in the part that was.")

    distinct: dict[str, str] = {}
    for row in view.get("slides") or []:
        page = row.get("page")
        info = index[page]
        mine, kept_without_recording = [], []
        for occurrence in row.get("occurrences") or []:
            if occurrence.get("start_ms") is None or occurrence.get("end_ms") is None or occurrence["end_ms"] <= occurrence["start_ms"]:
                continue
            item = _annotation_range(occurrence, page)
            if not readable or item["recording"].get("source_id") in unreadable:  # nothing can be sought in it: the record stays, the page says so, no range is offered
                kept_without_recording.append({"annotation_id": item["annotation_id"], "recording_source_id": item["recording"].get("source_id"), "start_ms": item["start_ms"],
                                               "end_ms": item["end_ms"], "review_state": item["review_state"]})
            else:
                mine.append(item)
        people = [item for item in mine if item["review_state"] == "human_confirmed" or item["origin"] == "manual"]
        earlier = [item for item in mine if item not in people]
        suppressed = 0
        derived = []
        for link in shown:
            if page not in link["support"]["pages"]:
                continue
            if rejected_for(link, page):
                suppressed += 1
            elif not any(item["recording"]["source_id"] == link["recording"]["source_id"] and _overlaps(link, item["start_ms"], item["end_ms"]) for item in people):
                derived.append(link)
        page_level = _numbered([_as_range(link, 0, 0) for link in derived if link["support"]["scope"] != "section"])
        # A stretch is listed once on a page. A suggestion for the page itself stands for a section with the same ends (its basis already names the course's
        # pairing); of two statements with one stretch, the one naming the fewest pages.
        own_stretches = {(item["recording"]["source_id"], item["start_ms"], item["end_ms"]): item for item in page_level}
        same_stretch: dict[tuple, dict] = {}
        for link in sorted((link for link in derived if link["support"]["scope"] == "section"), key=lambda link: (len(link["support"]["pages"]), link["range_id"])):
            stretch = (link["recording"]["source_id"], link["start_ms"], link["end_ms"])
            if stretch in own_stretches:
                if "course's own record" not in own_stretches[stretch]["why"]:
                    own_stretches[stretch]["why"] += " The course's own record places these transcript lines with this page as well."
            else:
                same_stretch.setdefault(stretch, link)
        sections = _numbered([_as_range(link, 0, 0) for link in same_stretch.values()])
        ranges = _numbered(people) + sorted(page_level + sections + _numbered(earlier), key=lambda r: (r["start_ms"], r["end_ms"], str(r["range_id"])))
        row["ranges"] = ranges
        for item in ranges:
            distinct[item["range_id"]] = item["review_state"]
        if ranges:
            row["no_range"] = None
            continue
        listed = []
        for link in candidates:
            if page in link["support"]["pages"]:
                if rejected_for(link, page):
                    suppressed += 1
                else:
                    listed.append({"kind": "occurrence", "range_id": link["range_id"], "recording_source_id": link["recording"]["source_id"], "start_ms": link["start_ms"], "end_ms": link["end_ms"],
                                   "why_not_shown": _why_not_shown(link.get("selection") or {}), "between": []})
        listed += [{"kind": "ambiguous_interval", "range_id": None, "recording_source_id": u["recording_source_id"], "start_ms": u["start_ms"], "end_ms": u["end_ms"],
                    "why_not_shown": "the wording fits several slides about equally", "between": list(u["between"])} for u in ambiguous if info["slide_id"] in u["between"]]
        extra = {"rejected_suggestions": suppressed} if suppressed else {}
        if kept_without_recording:
            extra["links_without_recording"] = kept_without_recording
        if unavailable_reason:
            state, detail = "recording_unavailable", {"reason": unavailable_reason}
        elif not info["forced"] and not listed:
            state, detail = "no_range_expected", {"role": info["role"]}
        elif listed:
            state, detail = "ambiguous", {"candidates": sorted(listed, key=lambda item: (item["start_ms"], item["end_ms"]))}
        elif not with_timing:
            state, detail = "audio_unprocessed", {"processed": [], "reason": "no_generated_timing"}
        elif not_current:
            first = not_current[0]
            state, detail = "association_not_run", {"cause": first["cause"], "differs": list(links.get("differs") or []) if first["cause"] == "inputs_changed" else []}
            if first["why_not_run"]:
                detail["reason"] = first["why_not_run"]
        elif whole and all_windowed:
            state, detail = "not_discussed", {}
        else:
            reason = "partly_processed" if not whole else "transcript_lines_without_time" if lines_without_time else SPEECH_OUTSIDE_RULE["reason"]
            state, detail = "audio_unprocessed", {"processed": processed, "reason": reason, "coverage": coverage, "not_matched": not_matched}
        text = _NO_RANGE_TEXT[state]
        if state == "audio_unprocessed" and with_timing:
            text = part_text if detail["reason"] == "partly_processed" else whole_text
        if state == "recording_unavailable" and unavailable_reason == "recording_unreadable":
            text = "The recording of this lecture cannot be read."
        if state == "association_not_run" and detail["cause"] == "no_adequate_method":
            text = "The recording has timing, but this deck has no readable text on its slides, so wording cannot be matched to them; no other matching method is available."
        if kept_without_recording:
            text += " The link recorded for this page is kept." if len(kept_without_recording) == 1 else f" The {len(kept_without_recording)} links recorded for this page are kept."
        if suppressed and state != "recording_unavailable":  # something was found for this page and the learner said no: that is not "nothing was found"
            said = "The one suggestion for this page was rejected" if suppressed == 1 else f"The {suppressed} suggestions for this page were rejected"
            text = f"{said}; nothing else was found for it in the recording." if state == "not_discussed" else f"{text} {said}."
        row["no_range"] = {"state": state, "text": text, "detail": {**detail, **extra}}

    # The transcript tab (R2-T4): a line of the course transcript has a time only through the accepted text alignment of the current document.
    timed_transcript = ((links.get("inputs") or {}).get("transcript") or {}).get("source_id") if links["state"] != "missing" else None
    for transcript in view.get("transcripts") or []:
        mine_too = timed_transcript is not None and transcript.get("source_id") == timed_transcript
        transcript["generated_line_times"] = [{"line": row["line"], "start_ms": row["start_ms"], "end_ms": row["end_ms"], "recording_source_id": row["recording_source_id"],
                                               "review_state": "generated", "method": _method(alignment.TEXT_METHOD)}
                                              for row in (links.get("line_times") or [] if mine_too else []) if row.get("transcript_source_id") == timed_transcript]
        transcript["text_alignment"] = [{"recording_source_id": source_id, "state": mapping["state"], "reason": mapping["reason"], "lines_aligned": mapping["lines_aligned"],
                                         "lines_total": mapping["lines_total"], "method": dict(mapping["method"])}
                                        for source_id, info in associations.items() for mapping in [((info["record"] or {}).get("stages") or {}).get("text_alignment")]
                                        if mine_too and mapping and (mapping.get("transcript") or {}).get("source_id") == timed_transcript]

    timing = _timing_block(view, links, generated, associations)
    slides = view.get("slides") or []
    with_range = sum(1 for row in slides if row.get("ranges"))
    expected = sum(1 for row in slides if (row.get("no_range") or {}).get("state") == "no_range_expected")
    states = Counter(distinct.values())
    timing["summary"] = {"pages": len(slides), "pages_with_range": with_range, "pages_no_range_expected": expected, "pages_without_range": len(slides) - with_range - expected,
                         "ranges": len(distinct), "human_confirmed": states.get("human_confirmed", 0), "agent_reviewed": states.get("agent_reviewed", 0), "generated": states.get("generated", 0)}
    view["timing"] = timing
    view.setdefault("revisions", {})["timing_links"] = [{"recording_source_id": record["source_id"], "links_revision": links.get("links_revision")} for record in links.get("recordings") or []
                                                       if links["state"] != "missing" and record["source_id"] not in links.get("stale_recordings", [])]
    return view


def enrich_view(settings: Settings, course_id: str, lecture_id: str, view: dict, *, preparation: Preparation | None = None, source_map: Any = _UNSET, generated: dict | None = None,
                context: _Course | None = None) -> dict[str, Any]:
    """Load what :func:`enrich` needs for one lecture view and apply it: the generations of the view's recordings, the
    deck's source map, the stored links against the current inputs, and the learner's rejections."""
    ctx = context or _Course(settings, course_id, preparation)
    lecture = ctx.lecture(lecture_id)
    if generated is None:
        generated = {r["source_id"]: (ctx.derived.current(course_id, r["source_id"]) if r.get("state") in _READABLE else None) for r in view.get("recordings") or []}
    deck = primary_deck(lecture)
    if source_map is _UNSET:
        source_map = ctx.source_map(lecture, deck) if deck is not None and deck.get("path") and deck["state"] in _READABLE else None
    material = gather(settings, course_id, lecture_id, generated=generated, source_map=source_map, context=ctx)
    links = read(settings, course_id, lecture_id, current_inputs=inputs_of(material))
    shown = (view.get("deck") or {}).get("source_id")
    # Another file of the unit is on screen for this request: the unit's own map says nothing about its pages.
    return enrich(view, source_map=source_map if deck is None or shown == deck["source_id"] else None, links=links, generated=generated)


# ---- status: every lecture and recording of a course -----------------------------------------------------------------------
def _speech(settings: Settings, course_id: str) -> tuple[dict | None, str | None, dict[str, dict]]:
    """Allowance, resume command and queue rows from the speech runner's own readback. Reads only."""
    try:
        from . import speech

        report = speech.status(settings)
    except Exception:  # noqa: BLE001 - the readback of another module; without it the rows simply carry no queue state
        return None, None, {}
    allowance = report.get("allowance") or {}
    numbers = {key: allowance.get(key) for key in ("ceiling_seconds", "used_seconds", "remaining_seconds")}
    rows = ((report.get("courses") or {}).get(course_id) or {}).get("recordings") or []
    # The runner reports no place in its queue (which spans all courses), so none is stated here: an ordinal of this list would not be one.
    queue = {row["source_id"]: {"state": row.get("state"), "chunks_done": row.get("chunks_done"), "chunks_total": row.get("chunks_total"), "seconds_covered": row.get("seconds_covered")}
             for row in rows}
    return (numbers if numbers["ceiling_seconds"] is not None and allowance.get("ledger") != "unreadable" else None), report.get("resume_command"), queue


def status(settings: Settings, course_id: str, *, preparation: Preparation | None = None) -> dict[str, Any]:
    """For ``GET /api/courses/{course_id}/timing``: per lecture and recording the stage, what is covered and what is
    unresolved, where the association stands, the queue row of the speech runner, the allowance used and remaining and
    the command that resumes transcription. Measured values only; nothing is extrapolated."""
    ctx = _Course(settings, course_id, preparation)
    served = {row["source_id"]: row for row in ctx.derived.status(course_id)["recordings"]}
    allowance, resume_command, queue = _speech(settings, course_id)
    lectures = []
    totals = Counter()
    stages = {stage: 0 for stage in LECTURE_STAGES}
    for lecture in ctx.inventory["lectures"]:
        lecture_id = lecture["lecture_id"]
        recordings = [{"source_id": item["source_id"], "filename": item["filename"], "state": item["state"], "sha256": (served.get(item["source_id"]) or {}).get("sha256"),
                       "duration_ms": (served.get(item["source_id"]) or {}).get("duration_ms")}
                      for session in lecture["sessions"] for item in session["items"] if item["kind"] == "lecture_recording" and item.get("path")]
        generated = {}
        for recording in recordings:
            row = served.get(recording["source_id"]) or {}
            generated[recording["source_id"]] = None if not row.get("current_generation") or recording["state"] not in _READABLE else {
                "generation": row["current_generation"], "covered_intervals": row["covered_intervals"], "unresolved_intervals": row["unresolved_intervals"],
                "coverage_fraction": row["coverage_fraction"], "covers_whole_recording": row["covers_whole_recording"], "duration_ms": row["duration_ms"]}
        document, reason = _load(settings, course_id, lecture_id)
        if document is None:
            links = evaluate(None, None, reason=reason)
        else:  # the full comparison is made only where something was built; nothing is built or mapped for a status
            links = evaluate(document, current_inputs(settings, course_id, lecture_id, generated=generated, context=ctx))
        view = {"recordings": recordings, "sessions": lecture["sessions"], "slides": []}
        timing = _timing_block(view, links, generated, _associations(view, links, generated))
        for row in timing["recordings"]:
            row["queue"] = queue.get(row["source_id"]) or {"state": "not_listed", "chunks_done": None, "chunks_total": None, "seconds_covered": None}
            block = row["generated"]
            totals["recordings"] += 1
            totals["recordings_with_generated"] += 1 if block else 0
            totals["recordings_associated"] += 1 if row["association"]["state"] == "current" else 0
            totals["covered_ms"] += sum(b - a for a, b in block["covered_intervals"]) if block else 0
            totals["unresolved_ms"] += block["unresolved_ms"] if block else 0
            totals["duration_ms"] += row["duration_ms"] or 0
            totals["ranges"] += row["association"]["ranges"]
        stages[timing["stage"]] += 1
        lectures.append({"lecture_id": lecture_id, "title": lecture.get("title"), "stage": timing["stage"], "links": {"state": links["state"], "differs": links["differs"], "built_at": links.get("built_at")},
                         "recordings": timing["recordings"]})
    return {"course_id": course_id, "allowance": allowance, "resume_command": resume_command, "build_command": _build_command(settings, course_id), "lectures": lectures,
            "summary": {"lectures": len(lectures), "stages": stages, **{key: totals[key] for key in ("recordings", "recordings_with_generated", "recordings_associated", "covered_ms",
                                                                                                    "unresolved_ms", "duration_ms", "ranges")}},
            "note": "Stages and times as measured. Generated timing is unreviewed; ranges are suggestions; nothing here estimates what remains."}


def _build_command(settings: Settings, course_id: str) -> str:
    import subprocess

    return subprocess.list2cmdline([sys.executable, "-m", "lecture_brain", "--profile", settings.profile, "--state-dir", str(settings.state_dir), "timing-build", "--course", course_id, "--all"])


# ---- routes ----------------------------------------------------------------------------------------------------------------
def register(app: Any, runtime: Any, locked: Callable[[Callable[[], Any]], Any]) -> None:
    """``GET /api/courses/{course_id}/timing`` and ``POST /api/courses/{course_id}/lectures/{lecture_id}/timing/build``.

    The POST rebuilds one lecture's derived links from its current inputs and changes only the app's private area; it
    is listed in ``brain/tests/test_boundaries.py::STATE_CHANGING_ROUTES`` by whoever calls this from ``create_app``.
    """
    from fastapi import HTTPException

    settings: Settings = runtime.settings

    def course(course_id: str) -> None:
        binding = settings.courses.get(course_id)
        if binding is None:
            raise HTTPException(404, "Unknown course")
        if not binding.usable:
            raise HTTPException(409, binding.problem or "Course binding is not usable")

    def refuse(exc: TimingLinksError) -> HTTPException:
        return HTTPException(404 if exc.code in {"unknown_lecture", "unknown_course"} else 409, exc.message)

    @app.get("/api/courses/{course_id}/timing")
    def timing_status(course_id: str):
        course(course_id)
        return locked(lambda: status(settings, course_id, preparation=getattr(runtime, "preparation", None)))

    @app.post("/api/courses/{course_id}/lectures/{lecture_id}/timing/build")
    def timing_build(course_id: str, lecture_id: str):
        course(course_id)

        def run() -> dict:
            preparation = getattr(runtime, "preparation", None)
            try:
                build(settings, course_id, lecture_id, journal=getattr(runtime, "journal", None), preparation=preparation, now=getattr(runtime, "now", None))
            except TimingLinksError as exc:
                raise refuse(exc) from None
            view = runtime.projector.lecture_view(course_id, lecture_id)
            if view is None:
                raise HTTPException(404, "Unknown lecture unit")
            if not isinstance(view.get("timing"), dict):  # the lecture view is enriched by its projector once that is wired; until then here
                enrich_view(settings, course_id, lecture_id, view, preparation=preparation)
            return view["timing"]

        return locked(run)


# ---- commands --------------------------------------------------------------------------------------------------------------
def cli_register(subparsers: Any) -> None:
    """``timing-build --course C (--lecture L | --all)`` and ``timing-status --course C``."""
    build_parser = subparsers.add_parser("timing-build", help="Rebuild the derived slide-to-recording links of one lecture or of every lecture of a course from the current inputs "
                                                              "(app-private files only; runs no speech tool; annotations are not touched)")
    build_parser.add_argument("--course", required=True)
    which = build_parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--lecture", help="One lecture unit, for example lecture-04")
    which.add_argument("--all", action="store_true", help="Every lecture unit of the course")
    status_parser = subparsers.add_parser("timing-status", help="Readback: per lecture and recording the stage, covered and unresolved time, the state of the association, "
                                                                "the transcription queue and allowance")
    status_parser.add_argument("--course", required=True)


def cli_run(args: Any, settings: Settings, *, journal: Any = None, preparation: Preparation | None = None, now: Callable[[], str] | None = None) -> int:
    """Run one of the two commands; prints one JSON document. 0: done; 1: a lecture could not be built; 2: unknown course."""

    def emit(value: Any) -> None:
        sys.stdout.write(json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n")

    binding = settings.courses.get(args.course)
    if binding is None or not binding.usable:
        print(f"Course {args.course!r} is not one of the usable configured courses.", file=sys.stderr)
        return 2
    if args.command == "timing-status":
        emit(status(settings, args.course, preparation=preparation))
        return 0
    lecture_ids = [lecture["lecture_id"] for lecture in build_inventory(binding)["lectures"]] if args.all else [args.lecture]
    built, failed = [], []
    for lecture_id in lecture_ids:
        try:
            document = build(settings, args.course, lecture_id, journal=journal, preparation=preparation, now=now)
        except TimingLinksError as exc:
            failed.append({"lecture_id": lecture_id, "code": exc.code, "detail": exc.message})
            continue
        built.append({"lecture_id": lecture_id, "stage": _stage_of(document), "links": len(document["links"]), "candidates": len(document["candidates"]),
                      "unassigned": len(document["unassigned"]), "links_revision": document["links_revision"],
                      "recordings": [{"source_id": r["source_id"], "stage": r["stage"], "text_alignment": r["stages"]["text_alignment"]["state"], "windows": r["stages"]["windows"]["basis"]}
                                     for r in document["recordings"]],
                      "path": str(_path(settings, args.course, lecture_id))})
    emit({"course_id": args.course, "built": built, "failed": failed})
    return 1 if failed else 0
