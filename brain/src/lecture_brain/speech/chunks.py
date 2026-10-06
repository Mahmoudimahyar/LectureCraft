"""The fixed chunk plan of a recording and the deterministic merge of chunk results. Pure functions: no files, no clock.

A recording is cut into fixed windows of ORIGINAL-media time. Neighbouring chunks overlap by a few seconds so that a
word cut by a window edge is heard whole by one of them. A chunk result carries times in chunk-local seconds plus the
chunk's offset; the offset is added once, here, and nowhere else.

**The overlap.** The two chunks decode their overlap independently, so the same word gets slightly different times in
each. Each word must come out exactly once, so the overlap is SPLICED at a word both decodings agree on: the same
text (case and punctuation aside) with middles at most ``MATCH_TOLERANCE_MS`` apart. Of the words that match, the
one nearest the middle of the overlap is the splice point; the earlier chunk supplies everything up to it, the later
chunk everything after it, and the matched word itself is taken from the chunk on whose side of the middle it lies.
When no word of the overlap matches and ONLY ONE of the two chunks has accepted text there (the other heard nothing,
or what it heard is withheld), that chunk supplies the overlap: the dividing line lies where the other chunk's own
accepted text ends (or begins), so a word that straddles the edge of the overlap is still taken once. Only when both
chunks have accepted text there and none of it matches, or neither has any, does the bare middle of the overlap
decide, word by word. The result counts the three kinds of boundary separately.

A processed PREFIX (chunks 0..k-1) ends where its last chunk ends: that chunk keeps everything it heard, because no
later chunk exists yet to own its tail. When the next chunk arrives, the next prefix is merged again from the chunk
results, so the splice moves in and nothing is counted twice. Only a prefix that holds every chunk of the plan is
complete.

A speech recogniser can fall into a repetition loop: one word emitted over and over, most copies with no duration.
That is not text of the recording. A segment FAILS THE REPETITION CHECK when the recogniser's own compression ratio is
above its own threshold, or when one word makes up at least half of a segment of eight or more words. Such text is
withheld from the merged result and the time it stands for is reported as an unresolved interval — neither speech
nor silence — so nothing downstream reads it as what was said. What a merge COVERS is its window minus those
intervals. (``worker.py`` carries the same check, because it must run without this package; a test holds the two
copies to the same answers.)

**The time withheld text stands for.** Around a loop a recogniser also emits nothing for stretches in which there is
speech, and the failing segments' own times can be one instant, reversed or absent. So the unresolved interval of a
run of consecutive failing segments is not read from those times: it runs from the END of the accepted text before
the run to the START of the accepted text after it, in the chunk that withheld it — from that chunk's start when it
has no accepted text before the run, to the end of its audio when it has none after — cut to the part of the
recording the chunk supplies. Accepted text is what the chunk says outside failing segments, with a usable time. A
run between two accepted words that touch stands for no time; the merge counts such runs.
"""
from __future__ import annotations

from collections import Counter
import math
from typing import Any

REPETITION_MIN_WORDS = 8
UNRESOLVED_REASON = "repetition_check_failed"
MATCH_TOLERANCE_MS = 250  # the same word in two decodings: equal text and middles at most this far apart
OVERLAP_RULE = ("splice at the matched word nearest the middle of the overlap; when no word matches and only one chunk has accepted text there, that chunk supplies the overlap; "
                "otherwise the middle itself")
UNRESOLVED_RULE = "from the end of the accepted text before a withheld run to the start of the accepted text after it, in the chunk that withheld it"
_PUNCTUATION = " \t\r\n.,?!;:\"'()[]{}-–—…"


def plan_chunks(duration_ms: int, chunk_ms: int, overlap_ms: int) -> list[dict[str, int]]:
    """``[{index, start_ms, end_ms}]`` covering ``[0, duration_ms]``. Chunk ``n`` starts at ``n * chunk_ms`` and runs
    ``overlap_ms`` past the start of the next one; the last chunk ends with the recording and may be shorter."""
    if duration_ms < 1 or chunk_ms < 1_000 or overlap_ms < 0 or overlap_ms * 2 > chunk_ms:
        raise ValueError("a chunk plan needs a duration, chunks of at least one second and an overlap of at most half a chunk")
    plan, index = [], 0
    while index == 0 or index * chunk_ms + overlap_ms < duration_ms:  # no extra chunk for a tail the previous overlap already covers
        plan.append({"index": index, "start_ms": index * chunk_ms, "end_ms": min(duration_ms, (index + 1) * chunk_ms + overlap_ms)})
        index += 1
    return plan


def dividing_line_ms(plan: list[dict[str, int]], index: int) -> int:
    """Between chunk ``index`` and the next one: the middle of their overlap."""
    return (plan[index + 1]["start_ms"] + plan[index]["end_ms"]) // 2


def repetition_check_failed(segment: dict, threshold: float) -> bool:
    """True when a segment is the output of a repetition loop rather than text of the recording (see the module text)."""
    ratio = segment.get("compression_ratio")
    if isinstance(ratio, (int, float)) and not isinstance(ratio, bool) and ratio > threshold:
        return True
    words = [word["text"].strip().lower().strip(".,?!;:") for word in segment.get("words") or [] if isinstance(word, dict) and isinstance(word.get("text"), str)]
    words = [word for word in words if word]
    return len(words) >= REPETITION_MIN_WORDS and max(Counter(words).values()) * 2 >= len(words)


def repetition_stats(segments: list, threshold: float) -> dict:
    """How much of a chunk's output fails the repetition check. ``failed_seconds`` spans each run of consecutive
    failed segments from its first start to its last end: the gaps inside a loop belong to the loop."""
    flags = [repetition_check_failed(segment, threshold) for segment in segments]
    seconds, position = 0.0, 0
    while position < len(segments):
        if not flags[position]:
            position += 1
            continue
        last = position
        while last + 1 < len(segments) and flags[last + 1]:
            last += 1
        start, end = segments[position].get("start"), segments[last].get("end")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
            seconds += end - start
        position = last + 1
    return {"segments": len(segments), "words": sum(len(segment.get("words") or []) for segment in segments), "failed_segments": sum(flags),
            "failed_words": sum(len(segment.get("words") or []) for segment, failed in zip(segments, flags) if failed), "failed_seconds": round(seconds, 3)}


def needs_second_pass(stats: dict) -> bool:
    """A chunk is worth decoding once more when a tenth of its words, or a minute of it, failed the repetition check."""
    return stats["failed_words"] > 0 and (stats["failed_words"] * 10 >= stats["words"] or stats["failed_seconds"] >= 60.0)


def subtract_intervals(window: dict[str, int], intervals: list[dict]) -> list[dict[str, int]]:
    """``window`` minus ``intervals`` (each ``{start_ms, end_ms}``, in any order): the stretches of the window that
    none of the intervals touches, in order. This is what "covered" means wherever time was withheld."""
    covered, cursor = [], window["start_ms"]
    for interval in sorted(intervals, key=lambda entry: (entry["start_ms"], entry["end_ms"])):
        low, high = max(interval["start_ms"], window["start_ms"]), min(interval["end_ms"], window["end_ms"])
        if high <= low:
            continue
        if low > cursor:
            covered.append({"start_ms": cursor, "end_ms": low})
        cursor = max(cursor, high)
    if cursor < window["end_ms"]:
        covered.append({"start_ms": cursor, "end_ms": window["end_ms"]})
    return covered


def result_problem(result: Any) -> str | None:
    """Why the inside of a chunk result is not in the shape :func:`merge_prefix` and the publication read it in, in
    words, or None when it is. Only the shape is judged here — a list of segment objects, each with a list of word
    objects (or none) and a text (or none), and a decoding record that is an object (or absent). Times that are not
    numbers, words without a text and times out of bounds are the merge's own business: it drops and counts them."""
    segments = result.get("segments") if isinstance(result, dict) else None
    if not isinstance(segments, list):
        return "the result has no list of segments"
    for order, segment in enumerate(segments):
        if not isinstance(segment, dict):
            return f"segment {order} is not an object"
        words = segment.get("words")
        if words is not None and not isinstance(words, list):
            return f"segment {order}: words is not a list"
        if any(not isinstance(word, dict) for word in words or []):
            return f"segment {order}: a word is not an object"
        if segment.get("text") is not None and not isinstance(segment["text"], str):
            return f"segment {order}: text is not a text"
    if result.get("decoding") is not None and not isinstance(result["decoding"], dict):
        return "the decoding record is not an object"
    return None


def _local_ms(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return int(round(value * 1000))


def _join(words: list[dict]) -> str:
    """Text of a segment from the words kept of it. Speech tools put the space in front of each word; plain lists do not."""
    raw = [word["raw"] for word in words]
    spaced = any(text[:1].isspace() for text in raw[1:])
    return ("".join(raw) if spaced else " ".join(text.strip() for text in raw)).strip()


def _same_words(left: list[tuple[int, int, int, str]], right: list[tuple[int, int, int, str]], tolerance_ms: int) -> list[tuple[tuple, tuple]]:
    """Pairs of the SAME word in two decodings of one overlap. Each entry is ``(position in its chunk, start, end,
    text without case and punctuation)``. The nearest pairs are taken first, a word is paired at most once, and the
    pairs keep the order of both decodings."""
    candidates = sorted((abs(a[1] + a[2] - b[1] - b[2]), i, j) for i, a in enumerate(left) for j, b in enumerate(right)
                        if a[3] == b[3] and abs(a[1] + a[2] - b[1] - b[2]) <= 2 * tolerance_ms)
    taken: list[tuple[int, int]] = []
    for _, i, j in candidates:
        if all((i - k) * (j - m) > 0 for k, m in taken):  # neither word is paired yet, and the pair crosses no other pair
            taken.append((i, j))
    return [(left[i], right[j]) for i, j in sorted(taken)]


def merge_prefix(plan: list[dict[str, int]], results: list[dict], *, duration_ms: int, tolerance_ms: int, repetition_threshold: float | None = None,
                 match_tolerance_ms: int = MATCH_TOLERANCE_MS) -> dict[str, Any]:
    """Merge the chunk results ``0..k-1`` (in order, as the workers wrote them) into one timed text in recording time.

    Returns ``{chunks, complete, window, segments, unresolved, covered, stats}``. ``segments`` are in the importer's
    shape with clip time equal to recording time (clip offset 0). Words outside a chunk's decoded audio or outside the
    prefix are dropped and counted (``tolerance_ms`` past the end is allowed, the same slack the importer states); a
    silent chunk simply contributes no words. Each overlap is divided as the module text says. With
    ``repetition_threshold``, segments that fail the repetition check are withheld, ``unresolved`` lists the recording
    intervals they stand for — from the accepted text before each run of them to the accepted text after it, cut to
    the part of the recording their chunk supplies — and ``covered`` is the window minus those intervals.
    Deterministic: the same inputs give the same output."""
    count = len(results)
    if count < 1 or count > len(plan) or any(result.get("index") != position or result.get("offset_ms") != plan[position]["start_ms"] for position, result in enumerate(results)):
        raise ValueError("a prefix is the chunk results 0..k-1 of this plan, in order")
    complete = count == len(plan)
    end_ms = duration_ms if complete else plan[count - 1]["end_ms"]
    stats = {"words_in": 0, "words": 0, "dropped_overlap_words": 0, "dropped_out_of_bounds_words": 0, "words_without_text": 0, "zero_length_words": 0, "segments_in": 0,
             "dropped_zero_length_segments": 0, "dropped_zero_length_segment_words": 0, "silent_chunks": 0, "withheld_repetition_segments": 0, "withheld_repetition_words": 0,
             "withheld_repetition_runs": 0, "withheld_runs_without_time": 0,
             "overlap_matched_words": 0, "overlap_boundaries_spliced": 0, "overlap_boundaries_one_sided": 0, "overlap_boundaries_at_midpoint": 0}

    # 1. Every word of every chunk gets its place in the recording, once: the one place where a chunk offset is applied.
    chunks: list[dict[str, Any]] = []
    for position, result in enumerate(results):
        offset = plan[position]["start_ms"]
        decoded = result.get("decoded_ms")
        decoded = plan[position]["end_ms"] - offset if not isinstance(decoded, int) or isinstance(decoded, bool) else decoded
        segments = result.get("segments") or []

        def place(node: dict, offset: int = offset, decoded: int = decoded) -> tuple[int, int] | None:
            """Recording milliseconds of a word (or of a segment without words); None when it lies outside the chunk's audio or the prefix."""
            start, end = _local_ms(node.get("start")), _local_ms(node.get("end"))
            if start is None or end is None or start < 0 or end < start or end > decoded + tolerance_ms or offset + end > end_ms + tolerance_ms:
                return None
            return offset + start, offset + end

        failed = [repetition_threshold is not None and repetition_check_failed(segment, repetition_threshold) for segment in segments]
        words: list[dict[str, Any]] = []  # in the order the recogniser gave them; the position in this list is the word's place in its chunk
        for order, segment in enumerate(segments):
            for word in segment.get("words") or []:
                text = word.get("text") if isinstance(word, dict) and isinstance(word.get("text"), str) else ""
                words.append({"segment": order, "node": word if isinstance(word, dict) else {}, "where": place(word) if isinstance(word, dict) else None, "text": text,
                              "same_as": text.strip(_PUNCTUATION).lower(), "failed": failed[order]})
        # The chunk's ACCEPTED text, by segment: where its words outside failing segments lie in the recording (a segment
        # that came without word times: where the segment lies). A segment that could not stand by itself has none.
        accepted: dict[int, list[tuple[int, int]]] = {}
        for word in words:
            if not word["failed"] and word["where"] is not None and word["text"].strip():
                accepted.setdefault(word["segment"], []).append(word["where"])
        for order, segment in enumerate(segments):
            if not failed[order] and not (segment.get("words") or []) and (segment.get("text") or "").strip() and place(segment) is not None:
                accepted[order] = [place(segment)]  # type: ignore[list-item]
        accepted = {order: places for order, places in accepted.items() if max(end for _, end in places) > min(start for start, _ in places)}
        chunks.append({"offset": offset, "decoded": decoded, "segments": segments, "failed": failed, "words": words, "place": place, "accepted": accepted})
        stats["silent_chunks"] += not any(segment.get("words") or (segment.get("text") or "").strip() for segment in segments)

    # 2. Every boundary between two chunks of the prefix: where the earlier chunk stops supplying words and the later one starts.
    boundaries: list[dict[str, Any]] = []
    for position in range(count - 1):
        zone = (plan[position + 1]["start_ms"], plan[position]["end_ms"])
        line = dividing_line_ms(plan, position)

        def in_overlap(chunk: dict, zone: tuple[int, int] = zone) -> list[tuple[int, int, int, str]]:
            return [(index, word["where"][0], word["where"][1], word["same_as"]) for index, word in enumerate(chunk["words"])
                    if not word["failed"] and word["where"] is not None and word["same_as"] and 2 * zone[0] <= word["where"][0] + word["where"][1] <= 2 * zone[1]]

        def accepted_places(chunk: dict) -> list[tuple[int, int]]:
            return [where for places in chunk["accepted"].values() for where in places]

        pairs = _same_words(in_overlap(chunks[position]), in_overlap(chunks[position + 1]), match_tolerance_ms)
        stats["overlap_matched_words"] += len(pairs)
        earlier, later = accepted_places(chunks[position]), accepted_places(chunks[position + 1])
        earlier_heard, later_heard = (any(2 * zone[0] <= start + end <= 2 * zone[1] for start, end in places) for places in (earlier, later))
        if pairs:
            left, right = min(pairs, key=lambda pair: (abs(pair[0][1] + pair[0][2] + pair[1][1] + pair[1][2] - 4 * line), pair[0][0]))
            from_earlier = left[1] + left[2] + right[1] + right[2] < 4 * line  # the matched word lies before the middle of the overlap: the earlier chunk's copy is the one kept
            boundaries.append({"zone": zone, "spliced": True, "earlier_last": left[0] if from_earlier else left[0] - 1, "later_first": right[0] + 1 if from_earlier else right[0],
                               "earlier_to": left[2], "later_from": right[1]})
            stats["overlap_boundaries_spliced"] += 1
        elif earlier_heard != later_heard:
            # Only one chunk has accepted text in the overlap: it supplies the overlap. The line lies where the OTHER chunk's
            # own accepted text ends (before the overlap) or begins (after it), so a word that straddles the edge of the
            # overlap — whole in one chunk, cut short in the other — is taken from the chunk that has it whole.
            if later_heard:
                line = min(zone[1], max([zone[0], *(end for start, end in earlier if start + end < 2 * zone[0])]))
            else:
                line = max(zone[0], min([zone[1], *(start for start, end in later if start + end > 2 * zone[1])]))
            boundaries.append({"zone": zone, "spliced": False, "line": line, "earlier_to": line, "later_from": line})
            stats["overlap_boundaries_one_sided"] += 1
        else:
            boundaries.append({"zone": zone, "spliced": False, "line": line, "earlier_to": line, "later_from": line})
            stats["overlap_boundaries_at_midpoint"] += 1

    def supplied(position: int, index: int | None, start: int, end: int) -> bool:
        """Whether chunk ``position`` is the one that supplies this word (``index`` is its place in the chunk) or this segment without words (``index`` None)."""
        twice = start + end
        if position > 0:
            before = boundaries[position - 1]
            if before["spliced"] and index is not None:
                if twice < 2 * before["zone"][0] or (twice <= 2 * before["zone"][1] and index < before["later_first"]):
                    return False
            elif twice < 2 * before["later_from"]:
                return False
        if position < count - 1:  # the last chunk of a prefix keeps its tail
            after = boundaries[position]
            if after["spliced"] and index is not None:
                if twice > 2 * after["zone"][1] or (twice >= 2 * after["zone"][0] and index > after["earlier_last"]):
                    return False
            elif twice >= 2 * after["earlier_to"]:
                return False
        return True

    # 3. The text: each word from the chunk that supplies it, withheld segments left out and their time recorded.
    rows: list[tuple[int, int, int, int, dict]] = []
    unresolved: list[list[int]] = []
    for position, chunk in enumerate(chunks):
        offset, decoded, segments, failed = chunk["offset"], chunk["decoded"], chunk["segments"], chunk["failed"]
        owned_from = 0 if position == 0 else boundaries[position - 1]["later_from"]
        owned_to = end_ms if position == count - 1 else boundaries[position]["earlier_to"]
        run_start: int | None = None
        for order in range(len(segments)):
            # Each run of consecutive failed segments is one unresolved interval: from the end of the accepted text before
            # it to the start of the accepted text after it (the chunk's start, the end of its audio, when there is none),
            # cut to what this chunk supplies. The failing segments' own times are not relied on.
            if failed[order] and run_start is None:
                run_start = order
            if run_start is not None and (order == len(segments) - 1 or not failed[order + 1]):
                before = [end for earlier in range(run_start) for _, end in chunk["accepted"].get(earlier, ())]
                after = [start for later in range(order + 1, len(segments)) for start, _ in chunk["accepted"].get(later, ())]
                low = max(max(before) if before else offset, owned_from)
                high = min(min(after) if after else offset + decoded, owned_to, end_ms)
                stats["withheld_repetition_runs"] += 1
                if high > low:
                    unresolved.append([low, high])
                else:  # between accepted words that touch, or wholly in the part of an overlap the other chunk supplies
                    stats["withheld_runs_without_time"] += 1
                run_start = None

        by_segment: dict[int, list[tuple[int, dict]]] = {}
        for index, word in enumerate(chunk["words"]):
            by_segment.setdefault(word["segment"], []).append((index, word))
        for order, segment in enumerate(segments):
            stats["segments_in"] += 1
            words = by_segment.get(order, [])
            if failed[order]:
                stats["words_in"] += len(words)
                stats["withheld_repetition_segments"] += 1
                stats["withheld_repetition_words"] += len(words)
                continue
            kept: list[dict] = []
            for index, word in words:
                stats["words_in"] += 1
                where = word["where"]
                if where is None:
                    stats["dropped_out_of_bounds_words"] += 1
                    continue
                if not supplied(position, index, *where):
                    stats["dropped_overlap_words"] += 1
                    continue
                if not word["text"].strip():
                    stats["words_without_text"] += 1
                    continue
                entry = {"clip_start_ms": where[0], "clip_end_ms": where[1], "start_ms": where[0], "end_ms": where[1], "text": word["text"].strip()[:200], "raw": word["text"]}
                probability = word["node"].get("probability")
                if isinstance(probability, (int, float)) and not isinstance(probability, bool) and math.isfinite(probability):
                    entry["probability"] = min(1.0, max(0.0, float(probability)))
                kept.append(entry)
            if words:
                if not kept:
                    continue
                start, end = min(word["clip_start_ms"] for word in kept), max(word["clip_end_ms"] for word in kept)
                text = (segment.get("text") or "").strip() if len(kept) == len(words) else ""
                text = text or _join(kept)
            else:  # a segment that came without word times is placed as one unit
                where = chunk["place"](segment)
                text = (segment.get("text") or "").strip()
                if where is None or not text or not supplied(position, None, *where):
                    continue
                start, end = where
            if end <= start or not text:  # a lone zero-length word cannot stand as a segment
                stats["dropped_zero_length_segments"] += 1
                stats["dropped_zero_length_segment_words"] += len(kept)
                continue
            stats["words"] += len(kept)
            stats["zero_length_words"] += sum(1 for word in kept if word["clip_end_ms"] == word["clip_start_ms"])
            row = {"clip_start_ms": start, "clip_end_ms": end, "start_ms": start, "end_ms": end, "text": text[:4000]}  # clip offset 0: clip time is recording time
            if kept:
                row["words"] = [{key: value for key, value in word.items() if key != "raw"} for word in kept[:2000]]
            rows.append((start, end, position, order, row))
    rows.sort(key=lambda entry: entry[:4])
    segments_out = [{"index": index, **row} for index, (_, _, _, _, row) in enumerate(rows)]
    stats["segments"] = len(segments_out)
    intervals: list[list[int]] = []
    for low, high in sorted(unresolved):
        if intervals and low <= intervals[-1][1]:
            intervals[-1][1] = max(intervals[-1][1], high)
        else:
            intervals.append([low, high])
    window = {"start_ms": 0, "end_ms": end_ms}
    unresolved_out = [{"start_ms": low, "end_ms": high, "reason": UNRESOLVED_REASON} for low, high in intervals]
    covered = subtract_intervals(window, unresolved_out)
    stats["unresolved_ms"] = sum(high - low for low, high in intervals)
    stats["covered_ms"] = sum(entry["end_ms"] - entry["start_ms"] for entry in covered)
    return {"chunks": count, "complete": complete, "window": window, "segments": segments_out, "unresolved": unresolved_out, "covered": covered, "stats": stats}
