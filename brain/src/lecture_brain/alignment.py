"""Alignment engine: validated text alignment and a sequence model from time windows to logical slides (WF02, phase 4).

Pure functions over plain dicts. Nothing here reads a course, writes a file or touches the journal; the caller supplies
generated words, transcript lines, windows and logical slides and decides what to store. Three separate questions are
answered and their answers are never folded into one number:

``align_text``
    WHEN was an original (untimed) transcript line spoken? Generated speech words carry times; the transcript lines do
    not. The two token streams are aligned monotonically and a line receives a time span only where enough of its own
    tokens are matched in order. The whole mapping is refused (``accepted: False`` with a reason) when the generated
    text and the transcript do not correspond. No time is interpolated over an unmatched line and none is produced
    outside what was transcribed. A line without a time says which of two things is the case: recognised speech lies
    where the line would be and does not match it (``too_few_matches``), or nothing recognised can account for it
    (``outside_generated_window``); ``window_basis`` names what the first statement rests on.

    Method — anchors, an optimal chain, exact fill (``anchored-token-alignment/2``). A full dynamic programme over a
    lecture is about 10^8 cells in pure Python and no band is known in advance, because a generated chunk may sit
    anywhere in the transcript. ``difflib.SequenceMatcher`` is greedy (longest block first): one repeated phrase can
    become the pivot and force everything else to agree with it, and with ``autojunk`` off it is quadratic in frequent
    words. So: word n-grams that occur exactly once in each stream are anchors; the longest increasing chain of anchors
    is the globally optimal monotone skeleton (patience sorting, O(n log n)) and locates the corridor at any offset;
    anchors without nearby anchors on the same diagonal are dropped, and so is any part of the chain nobody could have
    spoken (the transcript advancing by more words than fit into the recording time between two anchors — a stock
    phrase that also occurs far away); the short gaps between consecutive anchors — a band by construction — are
    filled with an exact longest-common-subsequence programme. Repeated sentences cannot be anchors, so they are
    placed by their unique surroundings.

``align_windows_to_slides``
    WHICH logical slide is a stretch of speech about? Windows (generated segments, or transcript lines with or without
    times) are scored against logical slides: lexical similarity (the repository's tokeniser with plurals folded,
    TF-IDF weights taken from the deck), vocabulary tied to a slide, support from known source maps (hints), and the
    window's neighbours. Neighbours and hints may strengthen what a window's own wording says about a slide; neither
    can create it. Structural pages get a lower prior, never zero. A Viterbi decode
    over ``slides + UNASSIGNED`` then chooses one path with explicit costs for staying, advancing, skipping forward,
    jumping back to an earlier slide (a revisit — nobody has to say "slide") and for entering and leaving UNASSIGNED.
    The output is a list of disjoint occurrences per logical slide plus the intervals that stayed unassigned and why
    (``weak_evidence``, or ``ambiguous`` between named slides). Nothing is spread evenly. Three rules are applied to
    the decoded path and hold whatever the costs are:

    * a window that shares no term with a slide is never part of that slide's occurrence, however short the stretch
      and whether or not it has any content word at all (the decoder may pass through such windows because leaving
      and re-entering a slide costs more than they are worth; they are returned unassigned and the occurrence ends
      there);
    * two timed windows further apart than ``max_gap_seconds`` never share an interval, and windows without a time
      lying between them belong to neither side;
    * the cost of starting late in the deck is charged only when the windows begin at the beginning of the recording
      (``initial="auto"``; the result says which was used and why).

``benchmark``
    Runs this procedure and the existing lexical baseline (``preparation.align_lines_to_slides``) on identical inputs
    and scores both against labelled spans. ``cross_check_with_baseline`` adds to each occurrence how far that matcher
    lands on the same slide; it reports and decides nothing.

Quality states stay apart on every occurrence: ``acoustic`` is carried from the timing source, ``association`` is
always ``candidate`` (this module can never confirm anything, and it offers no second, weaker-sounding step: see
below), ``grouping`` is carried from the source map. What a lexical-plus-sequence method cannot establish — that a
slide was on screen, or that speech which shares no vocabulary with a page was about it — is not claimed by any field.

MEASURED, 2026-10-06, on version 1 of the sequence model (``lexical-sequence/1``; private benchmark; values frozen
beforehand, three held-out lectures of one course, weak untimed reference pairs, no hints, no vocabulary, roles
unknown). Read this before wiring the sequence model in:

* It is NOT clearly better than the existing lexical matcher when both get the same windows: 48% against 50% of the
  labelled windows agree with the reference, 88% against 91% precision where a slide is given. About half of the talk
  stays unassigned with either method: speech that does not use the page's words leaves no lexical trace.
* It is WORSE at staying silent on speech from another lecture (about 12% of such windows received a slide, against
  about 1% for the lexical matcher): a page with a handful of everyday words can collect a long, weak run.
* It found more returns to earlier slides (7 of 18 against 4 of 18).
* A two-step label (``candidate`` for longer, clearer occurrences, ``weak_candidate`` for the rest) did not put the
  more reliable links in the upper step. Version 2 therefore gives every link the one label and describes the same
  facts as ``support["shape"]`` (``sustained_clear`` / ``brief_or_close``): a description of how much evidence there
  is, not a grade, and not to be shown as one.
* By far the largest effect was the windowing, not the method: the lexical matcher fed every raw transcript line
  (blank and speaker-label lines included) agreed on 15% of the labelled windows; fed spoken lines only
  (``windows_from_lines``), on 50%.
* ``align_text`` was read back once, untuned, on a real 120-second generated clip: accepted, 92% of the generated
  tokens found in order, four transcript lines timed, nothing timed outside the clip. Nobody listened to it.

VERSION 2 (``lexical-sequence/2``, ``anchored-token-alignment/2``) corrects defects an independent review found in
version 1: the three rules above, hints that could create a link by themselves, loose transition labels, and line
statuses decided by the extent of the matches instead of by what speech was recognised. No frozen value was changed;
emissions and the decoded path are the same as in version 1, only what is reported from the path differs.

The lectures above had been seen by then, so the numbers of version 2 on them are a DESCRIPTION, NOT held-out
evidence (kept apart, with that label, in the private benchmark folder). They do not improve the picture:

* 42% of the labelled windows agree with the reference (version 1: 48%; existing matcher: 50%) at 88% precision
  (88%; 91%); 56% of all windows stay unassigned (50%; 50%). Agreement fell because version 1 carried windows along
  that shared no term with the slide (38 of the 399 it assigned), and the weak labels count such a window as
  agreement whenever it lies inside a labelled range; version 2 assigns none of them and judges every remaining
  piece on its own windows.
* Speech from another course still receives a slide in 9% of the windows (12%; 1%). Not cured.
* Returns to earlier slides found: 4 of 18 — the same as the existing matcher. The one advantage version 1 showed
  did not survive the correction.
* ``sustained_clear`` occurrences were again the less precise ones (83% against 95% for ``brief_or_close``).

So: the sequence model is the one that returns disjoint occurrences with honest unassigned intervals, and it has not
been shown to link better than the existing matcher on any data. Nothing here is a semantic method.

The switched-off options (``full_shared_terms``, ``background_factor``) have not been scored against unseen data.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import Counter
import math
import re
from typing import Any, Iterable, Sequence

from .preparation import _cos, align_lines_to_slides, tokens

ALIGNMENT_VERSION = "alignment/2"
TEXT_METHOD = "anchored-token-alignment/2"
SEQUENCE_METHOD = "lexical-sequence/2"
BASELINE_METHOD = "lexical-monotone-baseline/preparation.align_lines_to_slides"

# ---- frozen parameters ---------------------------------------------------------------------------------
# Fixed on synthetic cases and one development lecture before any held-out lecture was scored; the protocol and the
# reasons are kept with the private benchmark. Changing a value here invalidates the recorded held-out numbers.
# Version 2 changed none of them. It added one text value (``max_silence_seconds``, a priori, synthetic cases only).
_TEXT_DEFAULTS: dict[str, Any] = {
    "anchor_ngram": 3,              # words per anchor; an anchor occurs exactly once in each stream
    "support_reach_tokens": 40,     # an anchor needs neighbours this close in the transcript …
    "support_max_drift": 10,        # … on nearly the same diagonal …
    "support_min_neighbours": 2,    # … at least this many, or it is treated as a coincidence
    "max_tokens_per_second": 6.0,   # nobody speaks faster: the transcript cannot advance further than this between two anchors …
    "speech_slack_tokens": 12,      # … plus this allowance for word-boundary and timestamp error
    "max_gap_tokens": 80,           # a gap between anchors is filled only when both sides are at most this long
    "max_gap_ratio": 4.0,           # … and of comparable length
    "min_gap_fill_fraction": 0.3,   # … and the fill explains at least this share of the shorter side
    "min_matched_tokens": 20,       # below this there is not enough text to validate a mapping
    "min_match_ratio": 0.5,         # matched share of the generated tokens where the two texts overlap
    "min_generated_coverage": 0.5,  # share of the generated tokens that lie inside the matched corridor
    "min_line_fraction": 0.5,       # a line is timed only when at least this share of its tokens is matched in order
    "min_line_matched": 2,
    "max_line_stretch": 2.0,        # the matched generated tokens of a line may not be spread much wider than the line
    "line_stretch_slack": 6,
    "max_bridge_seconds": 4.0,      # the small stated gap: an unmatched line may get a bracket only inside it
    "max_bridge_lines": 2,
    "max_silence_seconds": 30.0,    # added in version 2: when the caller does not say what was processed, words further apart than this are separate stretches
}
_SEQUENCE_DEFAULTS: dict[str, Any] = {
    "lexical_weight": 0.65,         # the window's own wording against the slide
    "context_weight": 0.35,         # the window with its neighbours — counted only where the window has evidence of its own
    "context_radius": 1,
    "title_boost": 1,               # extra copies of the title tokens in the slide's vector
    "fold_plurals": True,           # treat "pump" and "pumps" as one term
    "full_shared_terms": 1,         # distinct shared terms needed for full lexical credit (1: off — no gain on development data)
    "background_factor": 0.0,       # share of a slide's average similarity over all windows that is subtracted (0: off — no gain)
    "background_min_windows": 20,   # … only when there are enough windows to know that average
    "vocabulary_weight": 0.15,      # concept labels and aliases tied to the slide
    "vocabulary_full": 2.0,         # specificity-weighted hits that count as full vocabulary support
    "hint_weight": 0.10,            # a known source map covering the window names this slide
    "prior_structural": -0.03,      # title, section, administrative pages: lower, never excluded
    "prior_blank": -0.06,
    "full_weight_tokens": 8,        # a window with fewer content tokens counts proportionally less, for and against
    "unassigned_score": 0.07,       # what a full-weight window is worth in UNASSIGNED
    "cost_advance": 0.03,
    "cost_skip_per_slide": 0.02,
    "cost_skip_cap": 0.20,
    "cost_back": 0.12,
    "cost_back_per_slide": 0.005,
    "cost_back_cap": 0.10,
    "cost_enter_unassigned": 0.08,
    "cost_leave_unassigned": 0.08,
    "min_occurrence_score": 0.10,   # an occurrence whose mean emission is below this is returned as weak evidence
    "ambiguous_margin": 0.02,       # … and one this close to its runner-up as ambiguous between the named slides
    "ambiguous_max_slides": 3,      # … unless more than this many slides fit equally well: that is weak evidence, not a choice
    "candidate_min_score": 0.15,    # these three describe an occurrence as "sustained_clear" (support["shape"]); they grade nothing
    "candidate_min_margin": 0.05,
    "candidate_min_weight": 1.5,    # about two full windows
    "max_gap_seconds": 30.0,        # timed windows further apart than this never share an interval; also: speech beginning later than this is not the start of the lecture
}


def text_params(overrides: dict | None = None) -> dict[str, Any]:
    return dict(_TEXT_DEFAULTS, **(overrides or {}))


def sequence_params(overrides: dict | None = None) -> dict[str, Any]:
    return dict(_SEQUENCE_DEFAULTS, **(overrides or {}))


# ---- shared small things ---------------------------------------------------------------------------------
_NORM = re.compile(r"[a-z0-9]+")
_FILLERS = frozenset({"um", "uh", "uhm", "umm", "erm", "er", "hmm", "mm", "mhm", "ah"})
_LABEL = re.compile(r"^\s*(?:\[[^\]]{1,40}\]|(?:speaker|spk)\s*\d+)\s*:?\s*$", re.IGNORECASE)


def norm_tokens(text: str) -> list[str]:
    """Every word, lower-cased, without punctuation or hesitation sounds — the unit of text alignment."""
    return [t for t in _NORM.findall((text or "").lower().replace("’", "'").replace("'", "")) if t not in _FILLERS]


def is_label_line(line: str) -> bool:
    """A line that only names a speaker or a bracketed note carries no speech."""
    return bool(_LABEL.match(line or ""))


def _num(record: dict, *names: str) -> float | None:
    for name in names:
        value = record.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


# ---- generated words -------------------------------------------------------------------------------------
def words_from_timing(timing: dict) -> list[dict]:
    """Words of a producer ``timing.json`` in RECORDING time (``clip_offset_seconds`` applied). Nothing else is changed."""
    offset = float(timing.get("clip_offset_seconds") or 0.0)
    words = []
    for segment in timing.get("segments") or []:
        for word in segment.get("words") or []:
            start, end = _num(word, "start_seconds", "start"), _num(word, "end_seconds", "end")
            if start is None or end is None:
                continue
            row = {"word_id": word.get("word_id"), "text": word.get("text") or "", "start": round(offset + start, 3), "end": round(offset + end, 3)}
            if isinstance(word.get("probability"), (int, float)):
                row["probability"] = word["probability"]
            words.append(row)
    return words


def covered_from_timing(timing: dict) -> list[tuple[float, float]]:
    """The stretch of the recording this generation actually processed, in recording time."""
    offset = float(timing.get("clip_offset_seconds") or 0.0)
    duration = _num(timing, "actual_duration_seconds")
    return [(offset, offset + duration)] if duration else []


# ---- text alignment --------------------------------------------------------------------------------------
def _unique_ngrams(seq: Sequence[str], k: int) -> dict[tuple, int]:
    seen: dict[tuple, int] = {}
    for i in range(len(seq) - k + 1):
        key = tuple(seq[i:i + k])
        seen[key] = i if key not in seen else -1
    return {key: i for key, i in seen.items() if i >= 0}


def _longest_increasing(pairs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Longest chain strictly increasing in both coordinates; ``pairs`` is sorted by the first one (all distinct)."""
    tails: list[int] = []
    tail_index: list[int] = []
    previous = [-1] * len(pairs)
    for i, (_, t) in enumerate(pairs):
        pos = bisect_left(tails, t)
        if pos == len(tails):
            tails.append(t)
            tail_index.append(i)
        else:
            tails[pos] = t
            tail_index[pos] = i
        previous[i] = tail_index[pos - 1] if pos else -1
    chain, i = [], tail_index[-1] if tail_index else -1
    while i >= 0:
        chain.append(pairs[i])
        i = previous[i]
    return chain[::-1]


def _supported(chain: list[tuple[int, int]], p: dict) -> list[tuple[int, int]]:
    """Drop anchors that have no company: a true anchor has neighbours close by on nearly the same diagonal."""
    reach, drift, need = p["support_reach_tokens"], p["support_max_drift"], p["support_min_neighbours"]
    support = [0] * len(chain)
    for i, (g, t) in enumerate(chain):
        j = i + 1
        while j < len(chain) and chain[j][1] - t <= reach:
            if abs((chain[j][1] - chain[j][0]) - (t - g)) <= drift:
                support[i] += 1
                support[j] += 1
            j += 1
    return [pair for pair, count in zip(chain, support) if count >= need]


def _speakable_chain(chain: list[tuple[int, int]], speakable) -> list[tuple[int, int]]:
    """Keep the part of the chain a person could have spoken. Between two consecutive anchors the transcript may not
    advance by more words than fit into the time that passed in the recording; where it does, the chain breaks into
    blocks, the largest block is kept, and a neighbouring block is kept only if it is consistent with what is kept."""
    if len(chain) < 2:
        return chain
    blocks: list[list[tuple[int, int]]] = [[chain[0]]]
    for previous, anchor in zip(chain, chain[1:]):
        if speakable(previous, anchor):
            blocks[-1].append(anchor)
        else:
            blocks.append([anchor])
    if len(blocks) == 1:
        return chain
    core = max(range(len(blocks)), key=lambda i: (len(blocks[i]), -i))
    kept = list(blocks[core])
    for block in blocks[core + 1:]:
        if speakable(kept[-1], block[0]):
            kept.extend(block)
    for block in reversed(blocks[:core]):
        if speakable(block[-1], kept[0]):
            kept[:0] = block
    return kept


def _lcs_pairs(a: Sequence[str], b: Sequence[str]) -> list[tuple[int, int]]:
    rows, cols = len(a), len(b)
    table = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows - 1, -1, -1):
        row, below, token = table[i], table[i + 1], a[i]
        for j in range(cols - 1, -1, -1):
            row[j] = below[j + 1] + 1 if token == b[j] else (below[j] if below[j] >= row[j + 1] else row[j + 1])
    pairs, i, j = [], 0, 0
    while i < rows and j < cols:
        if a[i] == b[j]:
            pairs.append((i, j))
            i, j = i + 1, j + 1
        elif table[i + 1][j] >= table[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


def _interval_index(covered: list[tuple[float, float]], time: float) -> int:
    for index, (start, end) in enumerate(covered):
        if start - 1e-6 <= time <= end + 1e-6:
            return index
    return -1


def _merged(intervals: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    """Sorted, with touching or overlapping stretches joined: two chunks processed back to back are one stretch."""
    out: list[list[float]] = []
    for start, end in sorted((float(a), float(b)) for a, b in intervals):
        if end < start:
            continue
        if out and start <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return [(start, end) for start, end in out]


def _word_stretches(spoken: list[dict], max_silence: float) -> list[tuple[float, float]]:
    """Where recognised words are, when nobody says what was processed: never across a long silence, because nothing
    tells a silence that was listened to from audio that was never opened."""
    out: list[list[float]] = []
    for word in spoken:
        if out and word["start"] - out[-1][1] <= max_silence:
            out[-1][1] = max(out[-1][1], word["end"])
        else:
            out.append([word["start"], word["end"]])
    return [(start, end) for start, end in out]


def _token_pairs(gen: list[str], trans: list[str], same_stretch, speakable, p: dict) -> list[tuple[int, int]]:
    """Monotone (generated index, transcript index) pairs of equal tokens."""
    k = p["anchor_ngram"]
    in_gen, in_trans = _unique_ngrams(gen, k), _unique_ngrams(trans, k)
    anchors = sorted((g, in_trans[key]) for key, g in in_gen.items() if key in in_trans)
    chain = _speakable_chain(_supported(_longest_increasing(anchors), p), speakable)
    pairs: list[tuple[int, int]] = []
    last_g = last_t = -1
    for g, t in chain:
        for offset in range(k):
            if g + offset > last_g and t + offset > last_t:
                pairs.append((g + offset, t + offset))
                last_g, last_t = g + offset, t + offset
    if not pairs:
        return []
    filled: list[tuple[int, int]] = []
    g, t = pairs[0]
    while g > 0 and t > 0 and gen[g - 1] == trans[t - 1] and same_stretch(g - 1, g):  # the same words right before the first anchor
        g, t = g - 1, t - 1
        filled.append((g, t))
    filled.reverse()
    for index, (g, t) in enumerate(pairs):
        if index:
            pg, pt = pairs[index - 1]
            dg, dt = g - pg - 1, t - pt - 1
            if dg > 0 and dt > 0 and max(dg, dt) <= p["max_gap_tokens"] and max(dg, dt) <= p["max_gap_ratio"] * min(dg, dt) + p["anchor_ngram"] and same_stretch(pg, g):
                inner = _lcs_pairs(gen[pg + 1:g], trans[pt + 1:t])
                if len(inner) >= p["min_gap_fill_fraction"] * min(dg, dt):
                    filled.extend((pg + 1 + i, pt + 1 + j) for i, j in inner)
        filled.append((g, t))
    g, t = pairs[-1]
    while g + 1 < len(gen) and t + 1 < len(trans) and gen[g + 1] == trans[t + 1] and same_stretch(g, g + 1):
        g, t = g + 1, t + 1
        filled.append((g, t))
    return filled


def align_text(words: list[dict], lines: list[str], *, covered: Iterable[tuple[float, float]] | None = None, acoustic: str = "generated_unreviewed",
               params: dict | None = None) -> dict[str, Any]:
    """Transfer times from generated words to original transcript lines — only through matched text.

    ``words``: ``[{text, start, end}]`` in recording time (``start_seconds``/``end_seconds`` are read too).
    ``lines``: the original transcript, one entry per line; results use 1-based line numbers.
    ``covered``: the stretches of the recording that were processed (chunks that touch are joined). Words that start
    outside them are not used and are counted. Without it nothing is known about what was processed: the stretches
    are then where the words are, never across a silence longer than ``max_silence_seconds``.

    Per line: ``status``, ``span`` (only when aligned; from the first to the last matched word that is part of a run of
    at least two consecutively matched tokens), ``matched``/``total`` tokens, a text-match ``confidence`` and
    ``window_basis``. The statuses:

    * ``aligned`` — enough of the line's tokens are matched in order;
    * ``too_few_matches`` — recognised speech lies where the line would be and does not match it well enough:
      the line has some matched tokens (``window_basis: "matched_tokens"``), or lies between matched tokens of one
      processed stretch (``"between_matched_tokens"``), or lies next to recognised words at the edge of a stretch
      that matched nothing and are numerous enough to have been this line (``"unmatched_speech_at_edge"`` — an
      estimate from token counts, named as one);
    * ``outside_generated_window`` — nothing recognised can account for the line;
    * ``empty`` — a blank or speaker-label line.
    """
    p = text_params(params)
    spoken = []
    for word in words or []:
        start, end = _num(word, "start", "start_seconds"), _num(word, "end", "end_seconds")
        if start is not None and end is not None and end >= start:
            spoken.append({"text": str(word.get("text") or word.get("word") or ""), "start": start, "end": end, "probability": word.get("probability")})
    spoken.sort(key=lambda word: (word["start"], word["end"]))
    stated = _merged(covered) if covered is not None else []
    outside_covered = 0
    if stated:
        inside = [word for word in spoken if _interval_index(stated, word["start"]) >= 0]
        outside_covered, spoken, stretches = len(spoken) - len(inside), inside, stated
    else:
        stretches = _word_stretches(spoken, p["max_silence_seconds"])
    gen: list[str] = []
    gen_word: list[int] = []
    gen_stretch: list[int] = []
    for index, word in enumerate(spoken):
        stretch = _interval_index(stretches, word["start"])
        for token in norm_tokens(word["text"]):
            gen.append(token)
            gen_word.append(index)
            gen_stretch.append(stretch)
    trans: list[str] = []
    ranges: list[tuple[int, int]] = []
    for line in lines or []:
        line_tokens = [] if is_label_line(line) else norm_tokens(line)
        ranges.append((len(trans), len(trans) + len(line_tokens)))
        trans.extend(line_tokens)
    window = (spoken[0]["start"], max(word["end"] for word in spoken)) if spoken else None

    def stretch_of(gen_index: int) -> int:
        return gen_stretch[gen_index]

    def speakable(a: tuple[int, int], b: tuple[int, int]) -> bool:
        seconds = spoken[gen_word[b[0]]]["start"] - spoken[gen_word[a[0]]]["start"]
        return b[1] - a[1] <= p["max_tokens_per_second"] * max(0.0, seconds) + p["speech_slack_tokens"]

    pairs = _token_pairs(gen, trans, lambda a, b: stretch_of(a) == stretch_of(b), speakable, p) if gen and trans and len(gen) >= p["min_matched_tokens"] else []
    matched = len(pairs)
    corridor = (pairs[-1][0] - pairs[0][0] + 1) if pairs else 0
    match_ratio = round(matched / corridor, 4) if corridor else 0.0
    generated_coverage = round(corridor / len(gen), 4) if gen else 0.0
    code = reason = None
    if not trans:
        code, reason = "empty_transcript", "The transcript has no text lines."
    elif len(gen) < p["min_matched_tokens"]:
        code, reason = "too_few_generated_tokens", f"Only {len(gen)} generated tokens: too little text to check that it belongs to this transcript."
    elif not pairs:
        code, reason = "no_ordered_match", "No run of generated words is found in the transcript in the same order: the two texts do not correspond."
    elif generated_coverage < p["min_generated_coverage"]:
        code, reason = "low_generated_coverage", (f"Only {generated_coverage:.0%} of the generated text lies where it meets the transcript; the rest has no counterpart "
                                                  "(another recording, or a transcript that starts or stops elsewhere).")
    elif match_ratio < p["min_match_ratio"]:
        code, reason = "low_match_ratio", f"Only {match_ratio:.0%} of the generated words are found in the transcript in order: the wording differs too much to carry times across."
    elif matched < p["min_matched_tokens"]:
        code, reason = "too_few_matched_tokens", f"Only {matched} tokens match in order: not enough to validate the mapping."
    accepted = code is None

    rows: list[dict] = []
    pair_t = [t for _, t in pairs]
    first_t, last_t = (pairs[0][1], pairs[-1][1]) if pairs else (0, -1)

    def needed(total: int) -> int:
        return max(p["min_line_matched"], math.ceil(p["min_line_fraction"] * total))

    # What each processed stretch holds: its tokens, the first and last matched pair, and the recognised tokens before
    # and after them that matched nothing.
    token_range: dict[int, list[int]] = {}
    for g, stretch in enumerate(gen_stretch):
        token_range.setdefault(stretch, [g, g])[1] = g
    pair_range: dict[int, list[int]] = {}
    for i, (g, _) in enumerate(pairs):
        pair_range.setdefault(gen_stretch[g], [i, i])[1] = i
    text_rows = [i for i, (lo, hi) in enumerate(ranges) if hi > lo]
    text_starts = [ranges[i][0] for i in text_rows]

    # Lines next to recognised speech that matched nothing, at the edge of a stretch. Unmatched recognised tokens are
    # spent on the neighbouring lines, nearest first, while enough remain for a line to have been spoken there at all
    # (as many as the line would need matched to be aligned). Past that, nothing recognised accounts for a line.
    at_edge: set[int] = set()
    if accepted:
        for stretch, (i0, i1) in pair_range.items():
            (g0, t0), (g1, t1) = pairs[i0], pairs[i1]
            for step, budget, t in ((-1, g0 - token_range[stretch][0], t0), (1, token_range[stretch][1] - g1, t1)):
                at = bisect_right(text_starts, t) - 1
                lo, hi = ranges[text_rows[at]]
                budget -= (t - lo) if step < 0 else (hi - 1 - t)  # the rest of the line the first (last) match is in
                at += step
                while 0 <= at < len(text_rows) and budget > 0:
                    lo, hi = ranges[text_rows[at]]
                    if bisect_left(pair_t, lo) != bisect_left(pair_t, hi) or budget < needed(hi - lo):
                        break
                    at_edge.add(text_rows[at])
                    budget -= hi - lo
                    at += step

    for number, (lo, hi) in enumerate(ranges, start=1):
        total = hi - lo
        row = {"line": number, "status": "empty" if not total else "too_few_matches", "span": None, "matched": 0, "total": total, "confidence": 0.0,
               "unmatched_head": None, "unmatched_tail": None, "bracket": None, "window_basis": None}
        rows.append(row)
        if not total or not accepted:
            continue
        mine = pairs[bisect_left(pair_t, lo):bisect_left(pair_t, hi)]
        row["matched"] = len(mine)
        robust = [(g, t) for i, (g, t) in enumerate(mine)
                  if (i and mine[i - 1] == (g - 1, t - 1)) or (i + 1 < len(mine) and mine[i + 1] == (g + 1, t + 1))]
        if robust and len(mine) >= needed(total):
            (g0, t0), (g1, t1) = robust[0], robust[-1]
            first, last = spoken[gen_word[g0]], spoken[gen_word[g1]]
            compact = (g1 - g0 + 1) <= p["max_line_stretch"] * (t1 - t0 + 1) + p["line_stretch_slack"]
            if compact and last["end"] > first["start"] and stretch_of(g0) == stretch_of(g1):
                probabilities = [spoken[gen_word[g]]["probability"] for g, _ in mine if isinstance(spoken[gen_word[g]]["probability"], (int, float))]
                row.update(status="aligned", span={"start": first["start"], "end": last["end"]}, unmatched_head=t0 - lo, unmatched_tail=hi - 1 - t1,
                           confidence=round((len(mine) / total) * min(1.0, len(mine) / (g1 - g0 + 1)), 3), window_basis="matched_tokens")
                if probabilities:
                    row["acoustic_mean_word_probability"] = round(sum(probabilities) / len(probabilities), 3)
                continue
        if mine:
            row["window_basis"] = "matched_tokens"
            continue
        before, after = bisect_left(pair_t, lo) - 1, bisect_left(pair_t, hi)
        if before >= 0 and after < len(pairs) and stretch_of(pairs[before][0]) == stretch_of(pairs[after][0]):
            row["window_basis"] = "between_matched_tokens"
        elif number - 1 in at_edge:
            row["window_basis"] = "unmatched_speech_at_edge"
        else:
            row["status"] = "outside_generated_window"  # before, after or between what was recognised

    # A bracket (bounds, not a span) for a short unmatched run between two aligned lines, only inside the stated gap.
    spoken_rows = [row for row in rows if row["total"]]
    index = 0
    while index < len(spoken_rows):
        if spoken_rows[index]["status"] != "too_few_matches":
            index += 1
            continue
        end = index
        while end + 1 < len(spoken_rows) and spoken_rows[end + 1]["status"] == "too_few_matches":
            end += 1
        left = spoken_rows[index - 1] if index else None
        right = spoken_rows[end + 1] if end + 1 < len(spoken_rows) else None
        if left and right and left["status"] == right["status"] == "aligned" and end - index + 1 <= p["max_bridge_lines"]:
            gap = right["span"]["start"] - left["span"]["end"]
            if 0 <= gap <= p["max_bridge_seconds"] and _interval_index(stretches, left["span"]["end"]) == _interval_index(stretches, right["span"]["start"]):
                for row in spoken_rows[index:end + 1]:
                    row["bracket"] = {"start": left["span"]["end"], "end": right["span"]["start"], "basis": "between_aligned_neighbours", "lines_sharing": end - index + 1}
        index = end + 1

    counts = Counter(row["status"] for row in rows)
    in_window = [row for row in rows if row["status"] in {"aligned", "too_few_matches"}]
    aligned = [row for row in rows if row["status"] == "aligned"]
    seconds = sum(row["span"]["end"] - row["span"]["start"] for row in aligned)
    covered_seconds = sum(b - a for a, b in stretches)
    line_of = {}
    if accepted:
        for number, (lo, hi) in enumerate(ranges, start=1):
            if lo <= first_t < hi:
                line_of["first"] = number
            if lo <= last_t < hi:
                line_of["last"] = number
    stretch_rows = []
    for index, (start, end) in enumerate(stretches):
        row = {"start": start, "end": end, "tokens": 0, "matched_tokens": 0, "unmatched_head_tokens": None, "unmatched_tail_tokens": None, "first_line": None, "last_line": None}
        if index in token_range:
            row["tokens"] = token_range[index][1] - token_range[index][0] + 1
        if index in pair_range:
            i0, i1 = pair_range[index]
            row.update(matched_tokens=i1 - i0 + 1, unmatched_head_tokens=pairs[i0][0] - token_range[index][0], unmatched_tail_tokens=token_range[index][1] - pairs[i1][0])
            if accepted:
                row.update(first_line=text_rows[bisect_right(text_starts, pairs[i0][1]) - 1] + 1, last_line=text_rows[bisect_right(text_starts, pairs[i1][1]) - 1] + 1)
        stretch_rows.append(row)
    return {
        "version": ALIGNMENT_VERSION, "method": TEXT_METHOD, "accepted": accepted, "reason": reason, "reason_code": code, "match_ratio": match_ratio,
        "coverage": {"generated_tokens": generated_coverage, "lines": (_rate(len(aligned), len(in_window)) or 0.0) if accepted else 0.0, "lines_aligned": len(aligned),
                     "lines_in_window": len(in_window) if accepted else 0, "seconds": round(seconds / covered_seconds, 4) if covered_seconds and accepted else 0.0},
        "generated": {"words": len(spoken), "tokens": len(gen), "matched_tokens": matched, "window": {"start": window[0], "end": window[1]} if window else None,
                      "covered": [list(s) for s in stretches], "covered_basis": "given" if stated else "word_extent", "words_outside_covered": outside_covered,
                      "stretches": stretch_rows},
        "transcript": {"lines": len(ranges), "token_lines": sum(1 for lo, hi in ranges if hi > lo), "tokens": len(trans), "first_line": line_of.get("first"), "last_line": line_of.get("last")},
        "counts": {status: counts.get(status, 0) for status in ("aligned", "too_few_matches", "outside_generated_window", "empty")},
        "lines": rows,
        "quality": {"acoustic": acoustic, "text_alignment": "token_match_validated" if accepted else "rejected"},
        "params": p,
        "note": "A span is where the matched words of that line were recognised. It says nothing about recognition accuracy and nothing about which slide was shown.",
    }


# ---- windows ---------------------------------------------------------------------------------------------
def windows_from_lines(lines: list[str], line_alignment: dict | None = None, *, timed_only: bool = False) -> list[dict]:
    """One window per spoken transcript line (blank and speaker-label lines carry no speech and are skipped).

    With an ACCEPTED ``align_text`` result the aligned lines carry their span; every other line has no time.
    """
    spans: dict[int, dict] = {}
    if line_alignment and line_alignment.get("accepted"):
        spans = {row["line"]: row["span"] for row in line_alignment.get("lines") or [] if row.get("status") == "aligned" and row.get("span")}
    windows = []
    for number, line in enumerate(lines, start=1):
        if not line.strip() or is_label_line(line):
            continue
        span = spans.get(number)
        if timed_only and span is None:
            continue
        windows.append({"window_id": f"line-{number}", "lines": [number, number], "start": span["start"] if span else None, "end": span["end"] if span else None, "text": line.strip()})
    return windows


def windows_from_segments(segments: list[dict], *, min_tokens: int = 12, max_seconds: float = 30.0, max_gap_seconds: float = 5.0, offset_seconds: float = 0.0) -> list[dict]:
    """Windows from generated segments: neighbours are merged until a window has enough words to compare, never across
    a silence longer than ``max_gap_seconds`` and never beyond ``max_seconds``. Times are the segments' own."""
    windows: list[dict] = []
    current: dict | None = None
    for index, segment in enumerate(segments or []):
        start, end = _num(segment, "start_seconds", "start"), _num(segment, "end_seconds", "end")
        text = str(segment.get("text") or "").strip()
        if start is None or end is None or end < start:
            continue
        start, end = round(start + offset_seconds, 3), round(end + offset_seconds, 3)
        if current is not None and (start - current["end"] > max_gap_seconds or end - current["start"] > max_seconds or current["_tokens"] >= min_tokens):
            windows.append(current)
            current = None
        if current is None:
            current = {"window_id": f"seg-{index}", "start": start, "end": end, "text": text, "segments": [index, index], "_tokens": len(tokens(text))}
        else:
            current.update(end=end, text=(current["text"] + " " + text).strip(), segments=[current["segments"][0], index], _tokens=current["_tokens"] + len(tokens(text)))
    if current is not None:
        windows.append(current)
    for window in windows:
        del window["_tokens"]
    return windows


def logical_slides_from_pages(page_texts: list[str], groups: list[dict] | None = None, roles: dict | None = None) -> list[dict]:
    """Logical slides for scoring: one per page unless a source-map group says several pages are one slide.

    ``groups``: ``[{slide_id, pages (1-based), grouping, role?, title?}]``. A group's text is its members' lines with
    repeats removed, so a three-page build does not count its first bullet three times. ``roles``: by page or slide id.
    A page listed in two groups, or two logical slides with one id, is refused (``ValueError``): the source map is wrong.
    """
    roles = roles or {}
    grouped: dict[int, dict] = {}
    for group in groups or []:
        for page in sorted(set(group["pages"])):
            if page in grouped:
                raise ValueError(f"page {page} is listed in two groups ({grouped[page]['slide_id']!r} and {group['slide_id']!r}): a page belongs to one logical slide")
            grouped[page] = group
    slides, done = [], set()
    for page in range(1, len(page_texts) + 1):
        group = grouped.get(page)
        if group is not None and id(group) in done:
            continue
        pages = sorted(set(group["pages"])) if group else [page]
        seen, kept = set(), []
        for member in pages:
            for line in (page_texts[member - 1] or "").splitlines() if 1 <= member <= len(page_texts) else []:
                key = " ".join(line.split())
                if key and key not in seen:
                    seen.add(key)
                    kept.append(line.strip())
        slide_id = group["slide_id"] if group else f"p{page}"
        if group:
            done.add(id(group))
        slides.append({"slide_id": slide_id, "pages": pages, "title": (group or {}).get("title") or (kept[0] if kept else ""), "text": "\n".join(kept),
                       "role": (group or {}).get("role") or roles.get(slide_id) or roles.get(page) or "unknown",
                       "grouping": (group or {}).get("grouping") or ("single_page" if len(pages) == 1 else "not_stated")})
    _require_unique_ids(slides)
    return slides


def _require_unique_ids(slides: list[dict]) -> None:
    repeated = sorted(str(slide_id) for slide_id, count in Counter(slide["slide_id"] for slide in slides).items() if count > 1)
    if repeated:
        raise ValueError(f"slide_id used for more than one logical slide: {', '.join(repeated)}")


# ---- candidate scoring -----------------------------------------------------------------------------------
def _role_prior(role: str | None, p: dict) -> float:
    parts = re.findall(r"[a-z]+", (role or "unknown").lower())  # whole words: "instructional" is not "structural"
    if any(part.startswith("blank") for part in parts):
        return p["prior_blank"]
    if any(part.startswith(("struct", "title", "section", "admin", "cover")) for part in parts):
        return p["prior_structural"]
    return 0.0


def _singular(term: str) -> str:
    return term[:-1] if len(term) > 3 and term.endswith("s") and not term.endswith("ss") else term


def _vector(doc: list[str], idf: dict[str, float], unseen: float) -> dict[str, float]:
    if not doc:
        return {}
    vec = {term: (count / len(doc)) * idf.get(term, unseen) for term, count in Counter(doc).items()}
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    return {term: v / norm for term, v in vec.items()}


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _hint_share(window: dict, hint: dict) -> float:
    """How much of the window a hint covers: by its lines when both name lines, else by time."""
    lines = window.get("lines")
    if lines and hint.get("line_ranges"):
        size = lines[1] - lines[0] + 1
        return min(1.0, sum(_overlap(lines[0], lines[1] + 1, a, b + 1) for a, b in hint["line_ranges"]) / size) if size > 0 else 0.0
    start, end = window.get("start"), window.get("end")
    if start is not None and end is not None and hint.get("time_ranges"):
        if end <= start:
            return 1.0 if any(a <= start <= b for a, b in hint["time_ranges"]) else 0.0
        return min(1.0, sum(_overlap(start, end, a, b) for a, b in hint["time_ranges"]) / (end - start))
    return 0.0


def _concepts(entries: Iterable[Any], terms) -> list[tuple[tuple[str, ...], list[tuple[str, ...]]]]:
    """``[(key, phrases)]``: a concept is hit when its label or any alias is spoken; it is counted once."""
    out = []
    for entry in entries or []:
        names = [entry] if isinstance(entry, str) else [entry.get("label"), *(entry.get("aliases") or [])]
        phrases = [tuple(terms(name)) for name in names if isinstance(name, str)]
        phrases = [phrase for phrase in phrases if phrase]
        if phrases:
            out.append((phrases[0], phrases))
    return out


def score_candidates(windows: list[dict], slides: list[dict], *, hints: list[dict] | None = None, vocabulary: dict | None = None, params: dict | None = None) -> dict[str, Any]:
    """Emission of every (window, logical slide) pair, with each signal kept apart.

    ``windows``: ``[{text, start?, end?, lines?}]`` in speaking order. ``slides``: ``[{slide_id, pages, text, title,
    role, grouping?}]`` in deck order, each with its own id. ``hints``: ``[{slide_ids, line_ranges? | time_ranges?,
    basis}]`` — known source maps. ``vocabulary``: ``{slide_id: [label | {label, aliases}]}``.

    A hint counts for a slide only in windows whose own wording (or vocabulary) already points at that slide: it can
    decide between slides the text supports, it cannot make a link out of speech that shares nothing with the page.
    """
    p = sequence_params(params)
    _require_unique_ids(slides)
    n_windows, n_slides = len(windows), len(slides)
    terms = (lambda text: [_singular(t) for t in tokens(text)]) if p["fold_plurals"] else tokens
    slide_docs = [terms(slide.get("title") or "") * int(p["title_boost"]) + terms(slide.get("text") or "") for slide in slides]
    df = Counter(term for doc in slide_docs for term in set(doc))
    idf = {term: math.log((1 + n_slides) / (1 + count)) + 1.0 for term, count in df.items()}
    unseen = math.log(1 + n_slides) + 1.0
    slide_vectors = [_vector(doc, idf, unseen) for doc in slide_docs]
    own_docs = [terms(window.get("text") or "") for window in windows]
    radius = int(p["context_radius"])
    own_vectors = [_vector(doc, idf, unseen) for doc in own_docs]
    context_vectors = [_vector([t for doc in own_docs[max(0, i - radius): i + radius + 1] for t in doc], idf, unseen) for i in range(n_windows)]
    priors = [_role_prior(slide.get("role"), p) for slide in slides]
    index_of = {slide["slide_id"]: i for i, slide in enumerate(slides)}

    # Wording. One shared word is thin evidence (a five-word page matches every sentence that uses one of its words),
    # and a page that resembles every stretch of the talk a little says nothing about any one of them.
    lexical = [[0.0] * n_slides for _ in range(n_windows)]
    context = [[0.0] * n_slides for _ in range(n_windows)]
    full_terms = max(1, int(p["full_shared_terms"]))
    for w in range(n_windows):
        if not own_vectors[w]:
            continue
        for s in range(n_slides):
            if not slide_vectors[s]:
                continue
            small, large = (own_vectors[w], slide_vectors[s]) if len(own_vectors[w]) <= len(slide_vectors[s]) else (slide_vectors[s], own_vectors[w])
            shared = sum(1 for term in small if term in large)
            if shared:
                thin = min(1.0, shared / full_terms)
                lexical[w][s] = thin * _cos(own_vectors[w], slide_vectors[s])
                # Neighbours may strengthen what the window itself says about a slide; they cannot create it.
                context[w][s] = thin * _cos(context_vectors[w], slide_vectors[s])
    if p["background_factor"] > 0 and n_windows >= p["background_min_windows"]:
        for grid in (lexical, context):
            for s in range(n_slides):
                level = p["background_factor"] * sum(grid[w][s] for w in range(n_windows)) / n_windows
                for w in range(n_windows):
                    grid[w][s] = max(0.0, grid[w][s] - level)

    concepts = [_concepts((vocabulary or {}).get(slide["slide_id"]), terms) for slide in slides]
    listed = Counter(key for per_slide in concepts for key in {key for key, _ in per_slide})
    longest = max((len(phrase) for per_slide in concepts for _, phrases in per_slide for phrase in phrases), default=0)

    vocab = [[0.0] * n_slides for _ in range(n_windows)]
    hint = [[0.0] * n_slides for _ in range(n_windows)]
    hint_bases: list[list[set]] = [[set() for _ in range(n_slides)] for _ in range(n_windows)]
    emissions = [[0.0] * n_slides for _ in range(n_windows)]
    for w in range(n_windows):
        grams = {tuple(own_docs[w][i:i + size]) for size in range(1, longest + 1) for i in range(len(own_docs[w]) - size + 1)} if longest else set()
        hinted: dict[int, tuple[float, set]] = {}
        for given in hints or []:
            share = _hint_share(windows[w], given)
            if share <= 0:
                continue
            for slide_id in given.get("slide_ids") or []:
                s = index_of.get(slide_id)
                if s is not None:
                    known = hinted.get(s, (0.0, set()))
                    hinted[s] = (max(known[0], share), known[1] | {str(given.get("basis") or "unstated")})
        for s in range(n_slides):
            if concepts[s] and grams:
                hits = sum(1.0 / listed[key] for key, phrases in concepts[s] if any(phrase in grams for phrase in phrases))
                vocab[w][s] = min(1.0, hits / p["vocabulary_full"])
            if s in hinted and (lexical[w][s] > 0 or vocab[w][s] > 0):  # a hint strengthens; like the neighbours, it cannot create
                hint[w][s], hint_bases[w][s] = hinted[s]
            evidence = p["lexical_weight"] * lexical[w][s] + p["context_weight"] * context[w][s] + p["vocabulary_weight"] * vocab[w][s] + p["hint_weight"] * hint[w][s]
            emissions[w][s] = evidence + priors[s]
    weights = [min(1.0, len(doc) / p["full_weight_tokens"]) for doc in own_docs]
    return {"slide_ids": [slide["slide_id"] for slide in slides], "emissions": emissions, "weights": weights, "priors": priors,
            "components": {"lexical": lexical, "context": context, "vocabulary": vocab, "hint": hint}, "hint_bases": hint_bases}


# ---- sequence decoding -----------------------------------------------------------------------------------
def _move_cost(previous: int, nxt: int, p: dict) -> float:
    if nxt == previous:
        return 0.0
    if nxt > previous:
        return p["cost_advance"] + min(p["cost_skip_per_slide"] * (nxt - previous - 1), p["cost_skip_cap"])
    return p["cost_back"] + min(p["cost_back_per_slide"] * (previous - nxt - 1), p["cost_back_cap"])


def _start_cost(slide: int, p: dict, initial: str) -> float:
    return 0.0 if initial == "anywhere" else min(p["cost_skip_per_slide"] * slide, p["cost_skip_cap"])


def transition_cost(previous: tuple[str, int], nxt: tuple[str, int], params: dict, *, initial: str = "deck_start") -> float:
    """The model's transition costs, stated once. States are ``("A", slide)`` — speaking about that slide — and
    ``("U", slide)`` — UNASSIGNED, remembering the slide the lecture was on (``-1``: none yet)."""
    (kind_a, a), (kind_b, b) = previous, nxt
    if kind_b == "U":
        if kind_a == "U":
            return 0.0 if a == b else math.inf
        return params["cost_enter_unassigned"] if a == b else math.inf
    if kind_a == "A":
        return _move_cost(a, b, params)
    if a < 0:
        return _start_cost(b, params, initial)
    return params["cost_leave_unassigned"] + _move_cost(a, b, params)


def decode(emissions: list[list[float]], weights: list[float], params: dict, *, initial: str = "deck_start") -> tuple[list[int | None], float]:
    """Viterbi over ``slides + UNASSIGNED``: the best path and its score. Linear in the number of slides per window —
    the skip and back costs are capped linear functions of the distance, so running maxima replace the inner loop."""
    n_windows = len(emissions)
    if not n_windows:
        return [], 0.0
    n = len(emissions[0])
    theta = params["unassigned_score"]
    if not n:
        return [None] * n_windows, sum(weights) * theta
    neg = -math.inf
    advance, skip, skip_cap = params["cost_advance"], params["cost_skip_per_slide"], params["cost_skip_cap"]
    back, back_step, back_cap = params["cost_back"], params["cost_back_per_slide"], params["cost_back_cap"]
    enter, leave = params["cost_enter_unassigned"], params["cost_leave_unassigned"]
    start = [_start_cost(s, params, initial) for s in range(n)]
    origin_none = 2 * n  # state ids: slide s → s, UNASSIGNED after slide s → n + s, UNASSIGNED before any slide → 2n
    in_slide, unassigned, before = [neg] * n, [neg] * n, 0.0
    trace: list[tuple[list[int], list[int]]] = []
    for w in range(n_windows):
        row, weight = emissions[w], weights[w]
        best_from, from_state = [neg] * n, [0] * n  # best way to be "at slide p, about to speak": from the slide itself or from its UNASSIGNED
        for q in range(n):
            if in_slide[q] >= unassigned[q] - leave:
                best_from[q], from_state[q] = in_slide[q], q
            else:
                best_from[q], from_state[q] = unassigned[q] - leave, n + q
        forward: list[tuple[float, int]] = [(neg, -1)] * n
        linear, linear_at, flat, flat_at = neg, -1, neg, -1
        for s in range(1, n):
            q = s - 1
            if best_from[q] + skip * q > linear:
                linear, linear_at = best_from[q] + skip * q, q
            if best_from[q] > flat:
                flat, flat_at = best_from[q], q
            by_distance, capped = linear - skip * (s - 1), flat - skip_cap
            forward[s] = (by_distance - advance, linear_at) if by_distance >= capped else (capped - advance, flat_at)
        backward: list[tuple[float, int]] = [(neg, -1)] * n
        linear, linear_at, flat, flat_at = neg, -1, neg, -1
        for s in range(n - 2, -1, -1):
            q = s + 1
            if best_from[q] - back_step * q > linear:
                linear, linear_at = best_from[q] - back_step * q, q
            if best_from[q] > flat:
                flat, flat_at = best_from[q], q
            by_distance, capped = linear + back_step * (s + 1), flat - back_cap
            backward[s] = (by_distance - back, linear_at) if by_distance >= capped else (capped - back, flat_at)
        new_slide, slide_from = [neg] * n, [origin_none] * n
        new_unassigned, unassigned_from = [neg] * n, [0] * n
        for s in range(n):
            best, came = best_from[s], from_state[s]  # stay (or return to the same slide)
            if forward[s][0] > best:
                best, came = forward[s][0], from_state[forward[s][1]]
            if backward[s][0] > best:
                best, came = backward[s][0], from_state[backward[s][1]]
            if before - start[s] > best:
                best, came = before - start[s], origin_none
            new_slide[s], slide_from[s] = (best + weight * row[s] if best > neg else neg), came
            if unassigned[s] >= in_slide[s] - enter:
                new_unassigned[s], unassigned_from[s] = unassigned[s] + weight * theta if unassigned[s] > neg else neg, n + s
            else:
                new_unassigned[s], unassigned_from[s] = in_slide[s] - enter + weight * theta, s
        in_slide, unassigned, before = new_slide, new_unassigned, before + weight * theta
        trace.append((slide_from, unassigned_from))
    # On an exact tie the path with less asserted wins: UNASSIGNED before a slide, then UNASSIGNED, then a slide.
    best, state = before, origin_none
    for s in range(n):
        if unassigned[s] > best:
            best, state = unassigned[s], n + s
    for s in range(n):
        if in_slide[s] > best:
            best, state = in_slide[s], s
    states: list[int | None] = [None] * n_windows
    for w in range(n_windows - 1, -1, -1):
        if state < n:
            states[w] = state
            state = trace[w][0][state]
        elif state < origin_none:
            state = trace[w][1][state - n]
    return states, best


def _extent(windows: list[dict], first: int, last: int) -> dict[str, Any]:
    timed = [w for w in windows[first:last + 1] if w.get("start") is not None and w.get("end") is not None]
    lined = [w["lines"] for w in windows[first:last + 1] if w.get("lines")]
    return {"start": min(w["start"] for w in timed) if timed else None, "end": max(w["end"] for w in timed) if timed else None,
            "lines": [min(l[0] for l in lined), max(l[1] for l in lined)] if lined else None, "windows": [first, last], "timed_windows": len(timed)}


def _initial_mode(initial: str, windows: list[dict], p: dict) -> tuple[str, str]:
    """Whether the cost of starting late in the deck applies, and on what basis. A lecture starts near the top of its
    deck; a chunk from the middle of a recording does not, and charging it would suppress its real matches."""
    if initial in ("deck_start", "anywhere"):
        return initial, "given"
    if initial != "auto":
        raise ValueError(f"initial must be 'auto', 'deck_start' or 'anywhere', not {initial!r}")
    start = windows[0].get("start") if windows else None
    if start is None:
        return "deck_start", "the first window carries no time: taken as a transcript from its beginning"
    if start <= p["max_gap_seconds"]:
        return "deck_start", f"the first window starts {start:g} s into the recording"
    return "anywhere", f"the first window starts {start:g} s into the recording: not the beginning of the lecture"


def _silence_breaks(windows: list[dict], max_gap: float) -> list[bool]:
    """``breaks[i]``: a new interval must start at window ``i``. Two timed windows further apart than ``max_gap`` are
    never in one interval, and the windows without a time that lie between them belong to neither side — their place
    in the gap is unknown, so they may not glue the two together."""
    breaks = [False] * (len(windows) + 1)
    last: int | None = None
    for i, window in enumerate(windows):
        if window.get("start") is None or window.get("end") is None:
            continue
        if last is not None and window["start"] - windows[last]["end"] > max_gap:
            breaks[last + 1] = breaks[i] = True
        last = i
    return breaks


def align_windows_to_slides(windows: list[dict], slides: list[dict], *, hints: list[dict] | None = None, vocabulary: dict | None = None, acoustic: Any = "unknown",
                            initial: str = "auto", params: dict | None = None) -> dict[str, Any]:
    """Disjoint occurrences of logical slides over the windows, and the intervals left unassigned with their reason.

    ``acoustic`` is the state of the timing source and is carried, not judged (``generated_unreviewed``,
    ``untimed_transcript_lines`` …). ``initial``: ``"deck_start"`` charges for beginning late in the deck (windows
    that start where the lecture starts), ``"anywhere"`` does not (a chunk, a clip, a slice of lines). ``"auto"``
    charges only when the first window carries no time or starts within ``max_gap_seconds`` of the start of the
    recording; an untimed slice from the middle of a transcript therefore needs ``"anywhere"`` said explicitly.

    ``transition`` of an occurrence: ``start``; ``advance`` (the next slide, or a later one when everything between
    was ambiguous talk about those slides); ``skip_forward`` (``skipped_slide_ids`` names what was passed over);
    ``back`` (an earlier slide); ``resume`` (the same slide after unassigned talk); ``return`` (the same slide after
    an interval that was ambiguous between other slides). ``revisit`` is true for every occurrence after the first
    except a ``resume``.
    """
    p = sequence_params(params)
    scores = score_candidates(windows, slides, hints=hints, vocabulary=vocabulary, params=p)
    emissions, weights, components = scores["emissions"], scores["weights"], scores["components"]
    mode, mode_basis = _initial_mode(initial, windows, p)
    states, total = decode(emissions, weights, p, initial=mode)
    n_windows, n_slides = len(windows), len(slides)
    breaks = _silence_breaks(windows, p["max_gap_seconds"])

    def runs_of(labels: list[Any]) -> list[tuple[int, int, Any]]:
        out, first = [], 0
        for i in range(1, len(labels) + 1):
            if i == len(labels) or labels[i] != labels[first] or breaks[i]:
                out.append((first, i - 1, labels[first]))
                first = i
        return out

    def mean_emissions(first: int, last: int) -> tuple[list[float], float]:
        weight = sum(weights[first:last + 1])
        if weight <= 0:
            return [0.0] * n_slides, 0.0
        return [sum(weights[w] * emissions[w][s] for w in range(first, last + 1)) / weight for s in range(n_slides)], weight

    # A window that shares no term with the slide it was decoded into is not that slide's talk. The decoder passes
    # through one or two unrelated sentences (leaving and re-entering costs more than they are worth) and through any
    # number of windows without a content word (they weigh nothing either way); all of them are returned unassigned
    # here, wherever they sit, so that no occurrence is made longer or heavier by speech that does not support it.
    for w, state in enumerate(states):
        if state is not None and components["lexical"][w][state] <= 0 and components["vocabulary"][w][state] <= 0:
            states[w] = None

    labels: list[Any] = [None] * n_windows
    for first, last, state in runs_of(list(states)) if n_windows else []:
        if state is None:
            label: Any = ("weak",)
        else:
            means, weight = mean_emissions(first, last)
            score = means[state]
            close = [s for s in range(n_slides) if s != state and means[s] >= score - p["ambiguous_margin"]]
            if weight <= 0 or score < p["min_occurrence_score"] or len(close) >= p["ambiguous_max_slides"]:
                label = ("weak",)  # nothing adequate, or so many slides fit equally that naming them would say nothing
            elif close:
                label = ("ambiguous", tuple(sorted([state, *close])))
            else:
                label = ("slide", state)
        for w in range(first, last + 1):
            labels[w] = label

    occurrences: list[dict] = []
    unassigned: list[dict] = []
    assignments: list[str | None] = [None] * n_windows
    ambiguous_slides: set[int] = set()
    per_slide = Counter()
    previous: int | None = None
    passed: set[int] = set()  # slides named by ambiguous intervals since the previous occurrence
    for first, last, label in runs_of(labels) if n_windows else []:
        extent = _extent(windows, first, last)
        means, weight = mean_emissions(first, last)
        ranked = sorted(range(n_slides), key=lambda s: (-means[s], s))
        if label[0] != "slide":
            best = {"slide_id": slides[ranked[0]]["slide_id"], "score": round(means[ranked[0]], 4)} if ranked and weight > 0 and means[ranked[0]] > 0 else None
            between = [slides[s]["slide_id"] for s in label[1]] if label[0] == "ambiguous" else []
            if label[0] == "ambiguous":
                ambiguous_slides.update(label[1])
                passed.update(label[1])
            unassigned.append(dict(extent, reason="ambiguous" if label[0] == "ambiguous" else "weak_evidence", between=between, best=best))
            continue
        s = label[1]
        runner = next((r for r in ranked if r != s), None)
        score = means[s]
        margin = score - (means[runner] if runner is not None else 0.0)

        def mean_of(grid: list[list[float]], s: int = s, first: int = first, last: int = last, weight: float = weight) -> float:
            return round(sum(weights[w] * grid[w][s] for w in range(first, last + 1)) / weight, 4)

        per_slide[s] += 1
        skipped: list[str] = []
        if previous is None:
            transition = "start"
        elif s == previous:
            transition = "return" if passed - {s} else "resume"  # other slides were talked about in between, or not
        elif s > previous:
            skipped = [slides[k]["slide_id"] for k in range(previous + 1, s) if k not in passed]
            transition = "skip_forward" if skipped else "advance"
        else:
            transition = "back"
        sustained = score >= p["candidate_min_score"] and margin >= p["candidate_min_margin"] and weight >= p["candidate_min_weight"]
        slide = slides[s]
        occurrences.append(dict(
            extent, slide_id=slide["slide_id"], occurrence_id=f"{slide['slide_id']}#{per_slide[s]}", pages=list(slide.get("pages") or []), role=slide.get("role") or "unknown",
            occurrence=per_slide[s], of=0,
            score=round(score, 4), margin=round(margin, 4),
            runner_up={"slide_id": slides[runner]["slide_id"], "score": round(means[runner], 4)} if runner is not None and means[runner] > 0 else None,
            support={"lexical": mean_of(components["lexical"]), "context": mean_of(components["context"]), "vocabulary": mean_of(components["vocabulary"]),
                     "hint": mean_of(components["hint"]), "role_prior": scores["priors"][s],
                     "hint_bases": sorted({basis for w in range(first, last + 1) for basis in scores["hint_bases"][w][s]}), "weight": round(weight, 3),
                     "shape": "sustained_clear" if sustained else "brief_or_close"},  # how much evidence and how clear of the runner-up: a description, not a grade
            transition=transition, revisit=per_slide[s] > 1 and transition != "resume", skipped_slide_ids=skipped, method=SEQUENCE_METHOD,
            quality={"acoustic": acoustic, "association": "candidate",
                     "grouping": slide.get("grouping") or ("single_page" if len(slide.get("pages") or []) == 1 else "not_stated")}))
        for w in range(first, last + 1):
            assignments[w] = slide["slide_id"]
        previous = s
        passed = set()
    for occurrence in occurrences:
        occurrence["of"] = per_slide[scores["slide_ids"].index(occurrence["slide_id"])]
    slide_rows = [{"slide_id": slide["slide_id"], "pages": list(slide.get("pages") or []), "role": slide.get("role") or "unknown", "occurrences": per_slide[s],
                   "state": "linked" if per_slide[s] else ("ambiguous_only" if s in ambiguous_slides else "no_match_in_these_windows")} for s, slide in enumerate(slides)]
    assigned = sum(1 for a in assignments if a is not None)
    return {"version": ALIGNMENT_VERSION, "method": SEQUENCE_METHOD, "occurrences": occurrences, "unassigned": unassigned, "slides": slide_rows, "assignments": assignments,
            "summary": {"windows": n_windows, "assigned": assigned, "unassigned": n_windows - assigned, "slides": n_slides, "slides_linked": sum(1 for s in range(n_slides) if per_slide[s])},
            "initial": {"mode": mode, "basis": mode_basis}, "path_score": round(total, 4), "params": p,
            "note": "Candidates from wording and order only. A slide without an occurrence had no adequate match in these windows; that is not a statement about the rest of the recording."}


# ---- baseline and benchmark ------------------------------------------------------------------------------
def baseline_assignments(windows: list[dict], slides: list[dict]) -> dict[str, Any]:
    """The existing lexical matcher on the same windows and slide texts, expressed per window."""
    segments = align_lines_to_slides([slide.get("text") or "" for slide in slides], [window.get("text") or "" for window in windows])
    assignments: list[str | None] = [None] * len(windows)
    for segment in segments:
        for line in range(segment["start_line"], segment["end_line"] + 1):
            assignments[line - 1] = slides[segment["page"] - 1]["slide_id"]
    return {"method": BASELINE_METHOD, "assignments": assignments, "segments": segments}


def cross_check_with_baseline(result: dict, windows: list[dict], slides: list[dict]) -> dict[str, Any]:
    """A copy of an ``align_windows_to_slides`` result in which every occurrence also says how far the existing lexical
    matcher, run on the same windows, puts those windows on the same slide (``support["baseline"]``).

    It reports and decides nothing: no occurrence is added, dropped or relabelled. Added after the benchmark, because
    neither method was clearly the better one there; whether agreement between the two marks the more reliable links
    has not been measured on unseen data.
    """
    baseline = baseline_assignments(windows, slides)["assignments"]
    mine = result["assignments"]
    occurrences = []
    for occurrence in result["occurrences"]:
        first, last = occurrence["windows"]
        size = last - first + 1
        same = sum(1 for w in range(first, last + 1) if baseline[w] == occurrence["slide_id"])
        missing = sum(1 for w in range(first, last + 1) if baseline[w] is None)
        support = dict(occurrence["support"], baseline={"method": BASELINE_METHOD, "same_slide": round(same / size, 4), "other_slide": round((size - same - missing) / size, 4),
                                                         "unassigned": round(missing / size, 4)})
        occurrences.append(dict(occurrence, support=support))
    both_same = sum(1 for a, b in zip(mine, baseline) if a is not None and a == b)
    both_different = sum(1 for a, b in zip(mine, baseline) if a is not None and b is not None and a != b)
    return dict(result, occurrences=occurrences, baseline_cross_check={
        "method": BASELINE_METHOD, "windows_assigned_by_both_to_the_same_slide": both_same, "windows_assigned_by_both_to_different_slides": both_different,
        "windows_assigned_by_sequence_only": sum(1 for a, b in zip(mine, baseline) if a is not None and b is None),
        "windows_assigned_by_baseline_only": sum(1 for a, b in zip(mine, baseline) if a is None and b is not None)})


def _label_ranges(windows: list[dict], label: dict) -> list[tuple[int, int]]:
    """Inclusive window-index ranges a label covers: given directly, by transcript lines or by time."""
    ranges = [(int(a), int(b)) for a, b in label.get("windows") or []]
    for key, lo_of, hi_of in (("lines", lambda w: (w.get("lines") or [None])[0], lambda w: (w.get("lines") or [None, None])[1]), ("times", lambda w: w.get("start"), lambda w: w.get("end"))):
        for a, b in label.get(key) or []:
            inside = [i for i, w in enumerate(windows) if lo_of(w) is not None and hi_of(w) is not None and lo_of(w) <= b and hi_of(w) >= a]
            first = None
            for i in inside:  # contiguous runs only
                if first is None:
                    first = last = i
                elif i == last + 1:
                    last = i
                else:
                    ranges.append((first, last))
                    first = last = i
            if first is not None:
                ranges.append((first, last))
    return [(max(0, a), min(len(windows) - 1, b)) for a, b in ranges if a <= b and b >= 0 and a < len(windows)]


def score_assignments(assignments: list[str | None], windows: list[dict], labels: list[dict], *, reach: int = 10) -> dict[str, Any]:
    """Score one per-window assignment against labelled spans.

    A label says "these windows discuss one of these slides" (``slide_ids`` may hold several: a reference pair that
    does not say which line belongs to which slide). ``kind: "unrelated"`` (or no slide ids) marks speech that belongs
    to no slide; ``kind: "revisit"`` marks a return to an earlier slide.
    """
    n = len(windows)
    allowed: list[set] = [set() for _ in range(n)]
    labelled, unrelated = [False] * n, [False] * n
    resolved = []
    for label in labels:
        ranges = _label_ranges(windows, label)
        ids = set(label.get("slide_ids") or [])
        is_unrelated = label.get("kind") == "unrelated" or not ids
        resolved.append((label, ranges, ids, is_unrelated))
        for a, b in ranges:
            for w in range(a, b + 1):
                if is_unrelated:
                    unrelated[w] = True
                else:
                    labelled[w] = True
                    allowed[w] |= ids
    agree = other = abstained = 0
    for w in range(n):
        if not labelled[w]:
            continue
        if assignments[w] is None:
            abstained += 1
        elif assignments[w] in allowed[w]:
            agree += 1
        else:
            other += 1
    n_labelled = agree + other + abstained
    unrelated_windows = [w for w in range(n) if unrelated[w] and not labelled[w]]
    falsely = sum(1 for w in unrelated_windows if assignments[w] is not None)

    start_errors, end_errors, missed, revisit_n, revisit_found = [], [], 0, 0, 0
    for label, ranges, ids, is_unrelated in resolved:
        if is_unrelated:
            continue
        hits = [assignments[w] in ids for w in range(n)]
        predicted, first = [], None
        for w in range(n + 1):
            if w < n and hits[w]:
                first = w if first is None else first
            elif first is not None:
                predicted.append((first, w - 1))
                first = None
        for a, b in ranges:
            overlapping = [run for run in predicted if run[0] <= b and run[1] >= a]
            if not overlapping:
                near = [run for run in predicted if (a - run[1] if run[1] < a else run[0] - b) <= reach]
                overlapping = [min(near, key=lambda run: (a - run[1] if run[1] < a else run[0] - b))] if near else []
            if not overlapping:
                missed += 1
                continue
            start_errors.append(abs(overlapping[0][0] - a))
            end_errors.append(abs(overlapping[-1][1] - b))
        if label.get("kind") == "revisit":
            covered = [w for a, b in ranges for w in range(a, b + 1)]
            revisit_n += 1
            revisit_found += bool(covered) and sum(1 for w in covered if assignments[w] in ids) * 2 >= len(covered)
    unassigned = sum(1 for a in assignments if a is None)
    return {
        "window_agreement": {"n": n_labelled, "agree": agree, "other_slide": other, "abstained": abstained, "rate": _rate(agree, n_labelled)},
        "precision_when_assigned": {"n": agree + other, "agree": agree, "rate": _rate(agree, agree + other)},
        "abstention_on_labelled": {"n": n_labelled, "abstained": abstained, "rate": _rate(abstained, n_labelled)},
        "boundary_error": {"unit": "windows", "reach": reach, "n": len(start_errors), "missed": missed,
                           "mean_start": round(sum(start_errors) / len(start_errors), 3) if start_errors else None,
                           "mean_end": round(sum(end_errors) / len(end_errors), 3) if end_errors else None},
        "revisit_recall": {"n": revisit_n, "found": revisit_found, "rate": _rate(revisit_found, revisit_n)},
        "false_assignment_on_unrelated": {"n": len(unrelated_windows), "assigned": falsely, "rate": _rate(falsely, len(unrelated_windows))},
        "abstention": {"n": n, "unassigned": unassigned, "rate": _rate(unassigned, n)},
    }


def benchmark(windows: list[dict], slides: list[dict], labels: list[dict], *, hints: list[dict] | None = None, vocabulary: dict | None = None, params: dict | None = None,
              initial: str = "auto", reach: int = 10) -> dict[str, Any]:
    """Run the sequence model and the lexical baseline on the SAME windows and slides and score both against ``labels``.

    Hints and vocabulary go to the sequence model only (the baseline has no such inputs); the report says whether any
    were given, so a comparison made with them is never mistaken for one made without.
    """
    sequence = align_windows_to_slides(windows, slides, hints=hints, vocabulary=vocabulary, initial=initial, params=params)
    baseline = baseline_assignments(windows, slides)
    scored = {"sequence": score_assignments(sequence["assignments"], windows, labels, reach=reach),
              "lexical_baseline": score_assignments(baseline["assignments"], windows, labels, reach=reach)}
    return {
        "inputs": {"windows": len(windows), "slides": len(slides), "labels": len(labels), "labelled_windows": scored["sequence"]["window_agreement"]["n"],
                   "unrelated_windows": scored["sequence"]["false_assignment_on_unrelated"]["n"], "revisit_labels": scored["sequence"]["revisit_recall"]["n"],
                   "hints_given": len(hints or []), "vocabulary_given": bool(vocabulary)},
        "methods": scored,
        "assignments": {"sequence": sequence["assignments"], "lexical_baseline": baseline["assignments"]},
        "method_ids": {"sequence": SEQUENCE_METHOD, "lexical_baseline": BASELINE_METHOD}, "initial": sequence["initial"],
        "sequence_occurrences": len(sequence["occurrences"]), "baseline_segments": len(baseline["segments"]),
    }
