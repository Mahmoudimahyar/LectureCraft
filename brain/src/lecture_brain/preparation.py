"""Complete-archive preparation and alignment pipeline (LL015, WF02).

Bounded, incremental and restartable. For every lecture unit of every bound course it records an
explicit disposition for each stage — it never shrinks the denominator and never marks a missing,
empty, unconvertible or unaligned source as done.

Stages per lecture:
  rendition   original PDF is displayed as-is; office decks need a labeled, versioned PDF rendition
              (LibreOffice, isolated profile). The original file is never modified or replaced.
  slide_text  per-page text of the deck (for search, context and matching); an empty page is reported.
  transcript  linked transcript lines; timing only when a real cue file exists beside it.
  alignment   lexical monotone matching of transcript lines to slides → *suggested* links only.
              Human-confirmed or rejected links are never overridden. No timestamp is invented:
              without a cue file there are line references but no media intervals.

Everything written here is derived app data under the app area, or an unreviewed suggestion in the
source-link sidecar registry. Quality of the matcher is a separate, measured question (LL025).
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
from typing import Any, Callable

from pypdf import PdfReader

from . import contracts as c
from .annotations import AnnotationStore, media_duration_ms
from .config import Settings
from .fsutil import replace_atomic
from .ownerio.inventory import build_inventory, disk_version_id, primary_deck

TOOL_VERSION = "prep-2"
_WORD = re.compile(r"[a-z][a-z0-9'-]{2,}")
_STOP = frozenset("the and that this with for are was not but you can has have its from one each will our out about into than then them they their there what when which who how why does did had been were would could should also just more most some such only very much many may might must shall over under between both few any all per via".split())
_CUE_TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})")
MIN_SEGMENT_SCORE = 0.10
MIN_MARGIN = 0.02


# ---- hashing with a small persistent cache (large recordings are hashed at most once per change) ----
def file_sha256(path: Path, cache: dict | None = None) -> str:
    stat = path.stat()
    key = f"{path.as_posix()}|{stat.st_size}|{stat.st_mtime_ns}"
    if cache is not None and key in cache:
        return cache[key]
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    value = digest.hexdigest()
    if cache is not None:
        cache[key] = value
    return value


def source_ref_for(root: Path, item: dict, locator: dict, cache: dict | None = None) -> dict | None:
    """A contract ``source`` for an inventory item, hashing unregistered files on demand."""
    if not item.get("path") or not (root / item["path"]).is_file():
        return None
    sha = item["sha256"] or file_sha256(root / item["path"], cache)
    return {"source_id": item["source_id"], "version_id": item["version_id"] or disk_version_id(sha), "sha256": sha, "locator": locator}


# ---- text ---------------------------------------------------------------------------------------------
def tokens(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


def extract_slide_texts(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    return [(page.extract_text() or "").strip() for page in reader.pages]


def parse_cues(path: Path) -> list[dict]:
    """Cues from a WebVTT/SRT file: ``[{start_ms, end_ms, text}]``. Malformed blocks are skipped."""
    cues, current = [], None
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.strip()
        match = _CUE_TIME.search(line)
        if match:
            g = match.groups()
            start = ((int(g[0] or 0) * 60 + int(g[1])) * 60 + int(g[2])) * 1000 + int(g[3])
            end = ((int(g[4] or 0) * 60 + int(g[5])) * 60 + int(g[6])) * 1000 + int(g[7])
            current = {"start_ms": start, "end_ms": end, "text": ""}
            cues.append(current)
        elif not line:
            current = None
        elif current is not None:
            current["text"] = (current["text"] + " " + line).strip()
    return [cue for cue in cues if cue["end_ms"] > cue["start_ms"]]


# ---- matcher ------------------------------------------------------------------------------------------
def _tfidf(docs: list[list[str]]) -> list[dict[str, float]]:
    df = Counter(term for doc in docs for term in set(doc))
    n = len(docs)
    vectors = []
    for doc in docs:
        tf = Counter(doc)
        vec = {term: (count / len(doc)) * (math.log((1 + n) / (1 + df[term])) + 1.0) for term, count in tf.items()} if doc else {}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        vectors.append({term: v / norm for term, v in vec.items()})
    return vectors


def _cos(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(term, 0.0) for term, v in a.items())


def align_lines_to_slides(slide_texts: list[str], lines: list[str]) -> list[dict]:
    """Monotone segmentation of transcript lines over slides, plus detected out-of-order revisits.

    Returns ``[{page, start_line, end_line, score, margin, kind}]`` with 1-based inclusive lines.
    Only segments that clear the score and margin thresholds are returned; the rest stay unresolved.
    """
    n_slides, n_lines = len(slide_texts), len(lines)
    if not n_slides or not n_lines:
        return []
    slide_tokens = [tokens(t) for t in slide_texts]
    singles = [tokens(line) for line in lines]
    windows = [tokens(" ".join(lines[max(0, i - 1): i + 2])) for i in range(n_lines)]  # a line with its neighbours
    vectors = _tfidf(slide_tokens + singles + windows)
    slides_v, single_v, window_v = vectors[:n_slides], vectors[n_slides:n_slides + n_lines], vectors[n_slides + n_lines:]
    # The line itself dominates; its neighbours add context without blurring segment boundaries too much.
    sim = [[0.65 * _cos(single_v[i], slides_v[s]) + 0.35 * _cos(window_v[i], slides_v[s]) for s in range(n_slides)] for i in range(n_lines)]
    neg = float("-inf")
    dp = [[neg] * n_slides for _ in range(n_lines)]
    back = [[0] * n_slides for _ in range(n_lines)]
    for s in range(n_slides):
        dp[0][s] = sim[0][s]
    for i in range(1, n_lines):
        best_prev, best_idx = neg, 0
        for s in range(n_slides):
            if dp[i - 1][s] > best_prev:
                best_prev, best_idx = dp[i - 1][s], s
            dp[i][s] = sim[i][s] + best_prev
            back[i][s] = best_idx
    s = max(range(n_slides), key=lambda k: dp[n_lines - 1][k])
    assigned = [0] * n_lines
    for i in range(n_lines - 1, -1, -1):
        assigned[i] = s
        s = back[i][s]

    # Out-of-order revisits: a run of ≥2 lines whose best slide is clearly a different, earlier slide.
    kinds = ["sequential"] * n_lines
    i = 0
    while i < n_lines:
        best = max(range(n_slides), key=lambda k: sim[i][k])
        if best != assigned[i] and sim[i][best] - sim[i][assigned[i]] > 0.10:
            j = i
            while j + 1 < n_lines and max(range(n_slides), key=lambda k: sim[j + 1][k]) == best and sim[j + 1][best] - sim[j + 1][assigned[j + 1]] > 0.10:
                j += 1
            if j > i:
                for k in range(i, j + 1):
                    assigned[k], kinds[k] = best, "revisit"
            i = j + 1
        else:
            i += 1

    segments, start = [], 0
    for i in range(1, n_lines + 1):
        if i == n_lines or assigned[i] != assigned[start] or kinds[i] != kinds[start]:
            page = assigned[start]
            span = range(start, i)
            score = sum(sim[k][page] for k in span) / len(span)
            others = [sum(sim[k][o] for k in span) / len(span) for o in range(n_slides) if o != page]
            margin = score - (max(others) if others else 0.0)
            if len(span) >= 2 and score >= MIN_SEGMENT_SCORE and margin >= MIN_MARGIN:
                segments.append({"page": page + 1, "start_line": start + 1, "end_line": i, "score": round(score, 4), "margin": round(margin, 4), "kind": kinds[start]})
            start = i
    return segments


# ---- office rendition ---------------------------------------------------------------------------------
def find_converter() -> Path | None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return Path(found)
    for candidate in (Path(r"C:\Program Files\LibreOffice\program\soffice.exe"), Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe")):
        if candidate.is_file():
            return candidate
    return None


def convert_office_deck(source: Path, out_path: Path, converter: Path, *, timeout: float = 180.0) -> None:
    """Convert a copy of the deck to PDF in an isolated temporary profile. The original is only read."""
    with tempfile.TemporaryDirectory(prefix="ll-rendition-") as tmp:
        work = Path(tmp)
        copy = work / ("deck" + source.suffix.lower())
        shutil.copyfile(source, copy)
        profile = (work / "profile").as_uri()
        argv = [str(converter), f"-env:UserInstallation={profile}", "--headless", "--norestore", "--nolockcheck", "--nodefault", "--convert-to", "pdf", "--outdir", str(work), str(copy)]
        done = subprocess.run(argv, capture_output=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL)
        produced = work / "deck.pdf"
        if done.returncode != 0 or not produced.is_file() or produced.stat().st_size == 0:
            raise RuntimeError(f"converter exit {done.returncode}; no PDF produced")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        replace_atomic(out_path, produced.read_bytes())


class Preparation:
    def __init__(self, settings: Settings, annotations: AnnotationStore | None = None, *, converter: Path | None | str = "auto",
                 now: Callable[[], str] | None = None):
        self._settings = settings
        self._now = now or (lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        self._annotations = annotations or AnnotationStore(settings)
        self._converter = find_converter() if converter == "auto" else converter
        self._hash_cache_path = settings.state_dir / "hash-cache.json"
        try:
            self._hash_cache: dict[str, str] = json.loads(self._hash_cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._hash_cache = {}

    def _save_cache(self) -> None:
        replace_atomic(self._hash_cache_path, json.dumps(self._hash_cache).encode("utf-8"))

    def prepared_dir(self, course_id: str, lecture_id: str) -> Path:
        return self._settings.app_area(course_id) / "prepared" / lecture_id

    def state(self, course_id: str, lecture_id: str) -> dict | None:
        path = self.prepared_dir(course_id, lecture_id) / "state.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    # ---- one lecture ---------------------------------------------------------------------------------
    def _displayable_pdf(self, course_id: str, root: Path, deck: dict, stages: dict) -> Path | None:
        if deck["state"] in {"registered_empty", "present_unindexed_empty"}:
            stages["rendition"] = {"status": "no_source", "reason": "The deck file is empty (zero bytes)."}
            return None
        if deck["state"] in {"registered_unavailable", "registered_missing_on_disk", "registered_unreadable"}:
            stages["rendition"] = {"status": "no_source", "reason": f"The deck is {deck['state'].replace('_', ' ')}."}
            return None
        source = root / deck["path"]
        if deck["rendition"] == "native_pdf":
            stages["rendition"] = {"status": "original", "note": "The original PDF is displayed unchanged."}
            return source
        sha = deck["sha256"] or file_sha256(source, self._hash_cache)
        out = self._settings.app_area(course_id) / "renditions" / deck["source_id"] / sha[:16] / "deck.pdf"
        rel = out.relative_to(self._settings.write_root(course_id)).as_posix()
        if out.is_file():
            stages["rendition"] = {"status": "rendition", "path": rel, "of_sha256": sha, "note": "Static PDF rendition of the original deck; animations and media are not represented."}
            return out
        if self._converter is None:
            stages["rendition"] = {"status": "blocked", "reason": "This deck is not a PDF and no approved office converter is installed. The original stays available to open externally."}
            return None
        try:
            convert_office_deck(source, out, Path(self._converter))
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            stages["rendition"] = {"status": "blocked", "reason": f"Conversion failed: {exc}"[:300]}
            return None
        stages["rendition"] = {"status": "rendition", "path": rel, "of_sha256": sha, "note": "Static PDF rendition of the original deck; animations and media are not represented."}
        return out

    def prepare_lecture(self, course_id: str, lecture: dict) -> dict[str, Any]:
        root = self._settings.course(course_id).root
        lecture_id = lecture["lecture_id"]
        stages: dict[str, Any] = {}
        result = {"lecture_id": lecture_id, "tool_version": TOOL_VERSION, "stages": stages, "suggestions": {"created": 0, "kept_existing": 0}}
        deck = primary_deck(lecture)
        transcripts = [i for s in lecture["sessions"] for i in s["items"] if i["kind"] == "lecture_transcript" and i["path"] and i["rendition"] == "native_text"]
        recordings = [i for s in lecture["sessions"] for i in s["items"] if i["kind"] == "lecture_recording" and i["path"]]
        fingerprint = c.sha256_hex(c.dump_json({"v": TOOL_VERSION, "deck": [deck["path"], deck["bytes"], deck["sha256"]] if deck else None,
                                                "t": [[t["path"], t["bytes"]] for t in transcripts], "r": [[r["path"], r["bytes"]] for r in recordings],
                                                "converter": bool(self._converter)}))
        previous = self.state(course_id, lecture_id)
        if previous and previous.get("fingerprint") == fingerprint:
            return dict(previous, unchanged=True)
        result["fingerprint"] = fingerprint

        slide_texts: list[str] = []
        if deck is None:
            stages["rendition"] = {"status": "no_source", "reason": "No slide deck file is present for this lecture unit."}
        else:
            pdf = self._displayable_pdf(course_id, root, deck, stages)
            if pdf is not None:
                try:
                    slide_texts = extract_slide_texts(pdf)
                    empty = [i + 1 for i, text in enumerate(slide_texts) if not text]
                    replace_atomic(self.prepared_dir(course_id, lecture_id) / "slides-text.json", c.dump_json({"deck_source_id": deck["source_id"], "pages": slide_texts}))
                    stages["slide_text"] = {"status": "done", "pages": len(slide_texts), "pages_without_text": empty}
                except Exception as exc:  # noqa: BLE001 - an unreadable PDF is a reported state, not a crash
                    stages["slide_text"] = {"status": "blocked", "reason": f"The PDF text layer could not be read: {exc}"[:300]}
        stages.setdefault("slide_text", {"status": "not_applicable", "reason": "No displayable deck."})

        if not lecture["sessions"]:
            stages["transcript"] = {"status": "no_source", "reason": "No session is linked to this lecture by the owner; correspondence is not guessed."}
            stages["alignment"] = {"status": "not_applicable", "reason": "No linked session."}
        elif not transcripts:
            stages["transcript"] = {"status": "no_source", "reason": "The linked session has no transcript file."}
            stages["alignment"] = {"status": "not_applicable", "reason": "No transcript to align."}
        else:
            transcript = transcripts[0]
            lines = (root / transcript["path"]).read_text(encoding="utf-8-sig", errors="replace").splitlines()
            cue_path = next((p for p in ((root / transcript["path"]).with_suffix(ext) for ext in (".vtt", ".srt")) if p.is_file()), None)
            cues = parse_cues(cue_path) if cue_path else []
            timing = "cue_file" if cues and len(cues) == len(lines) else ("cue_count_mismatch" if cues else "untimed")
            stages["transcript"] = {"status": "done", "lines": len(lines), "timing": timing,
                                    "note": {"untimed": "Line references only; no timestamps exist for this transcript.", "cue_file": "Timing taken from the cue file beside the transcript.",
                                             "cue_count_mismatch": "A cue file exists but does not correspond line-for-line; timing left unresolved."}[timing]}
            if not slide_texts:
                stages["alignment"] = {"status": "not_applicable", "reason": "No slide text to match against."}
            else:
                segments = align_lines_to_slides(slide_texts, lines)
                matched_pages = sorted({s["page"] for s in segments})
                recording = recordings[0] if recordings else None
                support = c.artifact(root / transcript["path"], transcript["path"], "text/plain")
                timed = 0
                for segment in segments:
                    page_ref = source_ref_for(root, deck, {"kind": "page", "page": segment["page"], "printed_label": None}, self._hash_cache)
                    lines_ref = source_ref_for(root, transcript, {"kind": "lines", "start": segment["start_line"], "end": segment["end_line"]}, self._hash_cache)
                    if page_ref is None or lines_ref is None:
                        continue
                    base = {"contract": "ll.annotation/1", "scope": {"course_id": course_id, "term": self._settings.course(course_id).term}, "revision": 1, "supersedes": None,
                            "review_state": "suggested", "basis": "transcript_only", "support": [support], "reviewer_ref": None, "created_at": self._now()}
                    suffix = f"{lecture_id}-s{segment['page']:02d}-l{segment['start_line']}"
                    outcomes = [self._annotations.suggest(course_id, dict(base, annotation_id=f"sug-{suffix}-transcript", relation="explained_by", **{"from": page_ref, "to": lines_ref}))]
                    if timing == "cue_file" and recording is not None:
                        start_ms, end_ms = cues[segment["start_line"] - 1]["start_ms"], cues[segment["end_line"] - 1]["end_ms"]
                        duration = media_duration_ms(root / recording["path"])
                        media_ref = source_ref_for(root, recording, {"kind": "media", "start_ms": start_ms, "end_ms": end_ms, "origin": "original_source_start"}, self._hash_cache)
                        if media_ref is not None and end_ms > start_ms and (duration is None or end_ms <= duration + 500):
                            outcomes.append(self._annotations.suggest(course_id, dict(base, annotation_id=f"sug-{suffix}-displayed", relation="displayed_during", **{"from": page_ref, "to": media_ref})))
                            outcomes.append(self._annotations.suggest(course_id, dict(base, annotation_id=f"sug-{suffix}-time", relation="discussed_during", **{"from": lines_ref, "to": media_ref})))
                            timed += 1
                    for outcome in outcomes:
                        result["suggestions"]["created" if outcome["status"] in {"saved", "already_saved"} else "kept_existing"] += 1
                unresolved = [p for p in range(1, len(slide_texts) + 1) if p not in matched_pages]
                stages["alignment"] = {"status": "suggested" if segments else "unresolved", "segments": segments, "pages_matched": matched_pages, "pages_unresolved": unresolved,
                                       "timed_segments": timed, "note": "Matcher output is a suggestion until reviewed. Unmatched pages stay unresolved; nothing is inferred for them."}
        stages["recording"] = ({"status": "present", "count": len(recordings)} if recordings else
                               {"status": "no_source", "reason": "No recording file is present in a linked session." if lecture["sessions"] else "No linked session."})
        replace_atomic(self.prepared_dir(course_id, lecture_id) / "state.json", c.dump_json(result))
        self._save_cache()
        return result

    # ---- course / archive ----------------------------------------------------------------------------
    def prepare_course(self, course_id: str, *, max_units: int | None = None) -> dict[str, Any]:
        """Process lecture units that changed; ``max_units`` bounds one batch (the rest stays queued, not dropped)."""
        inventory = build_inventory(self._settings.course(course_id))
        processed, unchanged, remaining = [], 0, 0
        for lecture in inventory["lectures"]:
            if max_units is not None and len(processed) >= max_units:
                previous = self.state(course_id, lecture["lecture_id"])
                remaining += previous is None
                continue
            outcome = self.prepare_lecture(course_id, lecture)
            if outcome.get("unchanged"):
                unchanged += 1
            else:
                processed.append(lecture["lecture_id"])
        if processed:
            self._annotations.export_alignment(course_id)
        return {"course_id": course_id, "processed": processed, "unchanged": unchanged, "remaining_unprepared": remaining, "lecture_units": len(inventory["lectures"])}

    def coverage(self) -> dict[str, Any]:
        """All-lecture preparation coverage across every bound course (QT02 denominator)."""
        courses, totals = {}, Counter()
        for course_id, binding in sorted(self._settings.courses.items()):
            inventory = build_inventory(binding)
            links = self._annotations.load(course_id)["current"].values() if binding.usable else []
            by_deck: dict[str, dict[str, set]] = {}
            for entry in links:
                record = entry["record"]
                if record["relation"] in {"displayed_during", "explained_by"} and record["from"]["locator"]["kind"] == "page":
                    bucket = by_deck.setdefault(record["from"]["source_id"], {"confirmed": set(), "suggested": set(), "rejected": set()})
                    bucket[record["review_state"]].add(record["from"]["locator"]["page"])
            rows = []
            for lecture in inventory["lectures"]:
                state = self.state(course_id, lecture["lecture_id"])
                deck = primary_deck(lecture)
                pages = (state or {}).get("stages", {}).get("slide_text", {}).get("pages")
                linked = by_deck.get(deck["source_id"], {"confirmed": set(), "suggested": set(), "rejected": set()}) if deck else {"confirmed": set(), "suggested": set(), "rejected": set()}
                confirmed = len(linked["confirmed"])
                suggested = len(linked["suggested"] - linked["confirmed"])
                unresolved = (pages - len(linked["confirmed"] | linked["suggested"])) if pages else None
                if state is None:
                    disposition = "not_processed"
                elif state["stages"]["rendition"]["status"] in {"no_source", "blocked"}:
                    disposition = f"{state['stages']['rendition']['status']}: {state['stages']['rendition']['reason']}"
                elif pages and confirmed == pages:
                    disposition = "links_reviewed"
                elif state["stages"].get("alignment", {}).get("status") in {"not_applicable", None}:
                    disposition = f"slides_ready_no_alignment: {state['stages'].get('alignment', {}).get('reason', 'not applicable')}"
                else:
                    disposition = "links_pending_review"
                totals[disposition.split(":")[0]] += 1
                rows.append({"lecture_id": lecture["lecture_id"], "title": lecture["title"], "deck_state": deck["state"] if deck else "no_deck", "session_link": lecture["session_link"],
                             "pages": pages, "pages_confirmed": confirmed, "pages_suggested": suggested, "pages_unresolved": unresolved, "disposition": disposition,
                             "stages": (state or {}).get("stages")})
            courses[course_id] = {"lecture_units": len(rows), "unlinked_sessions": len(inventory["unlinked_sessions"]), "lectures": rows}
            totals["lecture_units"] += len(rows)
        return {"tool_version": TOOL_VERSION, "courses": courses, "totals": dict(totals),
                "note": "Preparation coverage only. 'links_reviewed' means every page has a human-confirmed link; suggestions are not counted as reviewed."}
