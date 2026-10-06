// The Transcript tab (design specification 5.11, UI08): two labelled things that are never mixed (R2-T4).
//
//   Course transcript       the course's own text, as SPEECH: one row per line of talk. A line that is only a speaker
//                           tag ("[Speaker 1]") is folded into the talk that follows it as a muted prefix, shown where
//                           the speaker changes; a blank line of the file is not drawn. Nothing is renumbered: a row
//                           keeps the line number of its talk, and stands for its tag's line too (`transcriptRows`).
//                           A row shows a time only where the Brain says it has one: a line the accepted text alignment
//                           timed (`generated_line_times`), or the first line of a stretch a link ties to the recording
//                           (`line_times`). Every other row has an empty gutter (its line number is in the name of its
//                           quote button) and is not a link. Pressing a time seeks the ONE player. The lines of the
//                           selected range sit under one divider that carries what the range is and "Range 1 of 2",
//                           with a rule down their left edge; the line being spoken is on a pad. Search, follow playback
//                           and quoting lines into a question stay.
//   Generated speech text   text generated on this PC from the recording, with its own times; labelled generated and
//                           not reviewed, with what it covers and what was withheld. Gaps are said as gaps, never filled.
//
// Each open section scrolls inside itself, so both headings stay in reach. The ranges of the slide are not listed again
// here: they are in the bar and its list.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Check, Quote } from "lucide-react";
import { BasisLabel } from "@/components/labels";
import { Button, cn, SectionToggle, ToolbarButton } from "@/components/ui";
import type { SourceRef } from "@/lib/db";
import { GENERATED_TEXT_NOTE, NO_GENERATED_TEXT_SENTENCE, clockLabel, countLabel, durationLabel, generatedCoverageSentence, rangeOrdinalLabel, recordingLabel, textAlignmentSentence, timeSpanLabel } from "@/lib/labels";
import { intervalBounds, rangesForPage } from "@/lib/r2";
import type { GeneratedText, LectureTiming, MethodRef, RecordingView, TimingGenerated, TimingRange, TimingTextAlignment, TranscriptRange, TranscriptView } from "@/lib/types";
import { rangeBasis, rangeKindWords } from "./RangeList";
import { useLectureWorkspace, type LectureWorkspaceState } from "./workspace-state";

// ---- what the Brain adds to a transcript with timing (r2: timing_links.enrich; not yet in lib/types) ---------------------
/** One line of the course transcript that the accepted text alignment gave a time. */
export interface AlignedLineTime { line: number; start_ms: number; end_ms: number; recording_source_id: string; review_state?: string; method?: MethodRef | null }
export type TimedTranscript = TranscriptView & {
  generated_line_times?: AlignedLineTime[];
  /** One row per recording that was aligned with this transcript. */
  text_alignment?: Array<TimingTextAlignment & { recording_source_id?: string }>;
};

// ---- pure parts (web/tests/lecture/transcript.test.tsx) ------------------------------------------------------------------
export interface LineTime {
  /** Where pressing the line's time takes the player. */
  ms: number;
  endMs: number;
  /** `aligned`: this line itself was timed by text alignment. `link`: the first line of a stretch a link ties to the recording. */
  basis: "aligned" | "link";
  /** "generated" for an aligned line; a link's own state ("confirmed", "suggested"). */
  state: string;
  recordingId: string | null;
  /** The lines the time stands for: the line itself, or the whole linked stretch. */
  lines: [number, number];
}
/**
 * The lines of a transcript that show a time, and nothing more: a line the text alignment timed, and the FIRST line of
 * each stretch a link ties to the recording (the link gives the stretch one start, not one per line). A reviewed link
 * stands before an aligned time on the same line, and that before a suggested link.
 */
export function lineTimeIndex(transcript: TimedTranscript | null | undefined): Map<number, LineTime> {
  const index = new Map<number, LineTime>();
  if (!transcript) return index;
  const rank = (time: LineTime): number => (time.basis === "link" ? (time.state === "confirmed" ? 3 : 1) : 2);
  const put = (line: number, time: LineTime) => {
    if (!Number.isInteger(line) || line < 1 || !(time.endMs > time.ms)) return;
    const held = index.get(line);
    if (!held || rank(time) > rank(held)) index.set(line, time);
  };
  for (const row of transcript.generated_line_times ?? []) put(row.line, { ms: row.start_ms, endMs: row.end_ms, basis: "aligned", state: row.review_state ?? "generated", recordingId: row.recording_source_id ?? null, lines: [row.line, row.line] });
  for (const row of transcript.line_times ?? []) put(row.start, { ms: row.start_ms, endMs: row.end_ms, basis: "link", state: row.review_state, recordingId: row.recording_source_id ?? null, lines: [row.start, Math.max(row.start, row.end)] });
  return index;
}

/** How a time is named for assistive technology: what kind of time it is, never more than is known. */
export const timeBasisWords = (time: Pick<LineTime, "basis" | "state">): string =>
  (time.basis === "aligned" ? "generated timing, not reviewed" : time.state === "confirmed" ? "reviewed timing" : "suggested timing");

/**
 * The lines of the transcript that belong to a range: the transcript lines the range itself names as evidence (when
 * this is the transcript they are lines of); otherwise the lines whose own time lies in the range, and the stretches a
 * link ties to a part of the recording that overlaps it. Sorted; empty when nothing ties the range to lines.
 */
export function linesOfRange(transcript: TimedTranscript | null | undefined, range: Pick<TimingRange, "start_ms" | "end_ms" | "recording" | "evidence"> | null | undefined,
  options: { evidenceApplies?: boolean } = {}): number[] {
  if (!transcript || !range) return [];
  const lines = new Set<number>();
  const count = transcript.lines.length;
  const add = (first: number, last: number) => {
    for (let line = Math.max(1, first); line <= Math.min(count, last); line++) lines.add(line);
  };
  if (options.evidenceApplies !== false) for (const entry of range.evidence?.transcript_lines ?? []) if (Array.isArray(entry) && entry.length === 2 && entry[0] <= entry[1]) add(entry[0], entry[1]);
  if (lines.size === 0) {
    const recording = range.recording?.source_id ?? null;
    const same = (id: string | null | undefined) => !recording || !id || id === recording;
    for (const row of transcript.generated_line_times ?? []) if (same(row.recording_source_id) && row.start_ms >= range.start_ms && row.start_ms < range.end_ms) add(row.line, row.line);
    for (const row of transcript.line_times ?? []) if (same(row.recording_source_id) && Math.min(row.end_ms, range.end_ms) > Math.max(row.start_ms, range.start_ms)) add(row.start, row.end);
  }
  return [...lines].sort((a, b) => a - b);
}

// ---- rows: speech only -------------------------------------------------------------------------------------------------------
/**
 * The speaker a line names when it is nothing but a speaker tag: "[Speaker 1]" (a whole line in square brackets) or
 * "Dr. Example:" (a few words closed by a colon). null for every line of talk, however short.
 */
export function speakerTag(line: string): string | null {
  const text = line.trim();
  const bracketed = /^\[([^\[\]]{1,40})\]$/.exec(text);
  if (bracketed) return bracketed[1]!.trim() || null;
  const named = /^([^.?!,;:]{1,40}):$/.exec(text);
  return named && named[1]!.trim().split(/\s+/).length <= 4 ? named[1]!.trim() : null;
}
/** One drawn row of the course transcript: a line of talk, with the tag line that names its speaker when one stands directly before it. */
export interface TranscriptRow {
  /** The line of the talk (1-based, as in the file): what the row is called, quoted by and found by. */
  n: number;
  /** The lines of the file the row stands for: its tag's line (if any) to its own. */
  first: number;
  last: number;
  speaker: string | null;
  text: string;
}
/**
 * The rows of a transcript: every line that is not blank, in order, a speaker tag folded into the line after it. A tag
 * with no talk after it (a blank line, another tag, the end) stays a row of its own, as written: no line of the file
 * with text in it goes unseen. Line numbers are the file's; nothing is renumbered.
 */
export function transcriptRows(lines: readonly string[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === "") continue;
    const speaker = speakerTag(line);
    const next = lines[index + 1];
    if (speaker !== null && next !== undefined && next.trim() !== "" && speakerTag(next) === null) {
      rows.push({ n: index + 2, first: index + 1, last: index + 2, speaker, text: next });
      index += 1;
    } else rows.push({ n: index + 1, first: index + 1, last: index + 1, speaker: null, text: line });
  }
  return rows;
}
/** The row that stands for a line of the file; for a blank line, the row after it. null past the last row. */
export function rowOfLine(rows: readonly TranscriptRow[], line: number): TranscriptRow | null {
  return rows.find((row) => row.last >= line) ?? null;
}

/** The lines being spoken at a position: the line whose own time holds it, or the linked stretch that does. null when no time of the transcript holds it. */
export function linesAt(index: ReadonlyMap<number, LineTime>, positionMs: number, recordingId?: string | null): [number, number] | null {
  let found: LineTime | null = null;
  for (const time of index.values()) {
    if (recordingId && time.recordingId && time.recordingId !== recordingId) continue;
    if (positionMs >= time.ms && positionMs < time.endMs && (!found || time.ms > found.ms || (time.ms === found.ms && time.basis === "aligned"))) found = time;
  }
  return found ? found.lines : null;
}

/**
 * The closing line of the Course transcript section (9.10): how many lines the text alignment timed and what those
 * times are, or why none has one; and, where links tie stretches of lines to the recording, how many do and how far
 * they were reviewed. null for a view that states nothing about timing and has no linked stretch.
 */
export function transcriptClosingLine(transcript: TimedTranscript, hasTiming: boolean): string | null {
  const alignment = transcript.text_alignment?.[0] ?? null;
  const links = transcript.line_times ?? [];
  const reviewed = links.filter((row) => row.review_state === "confirmed").length;
  const parts: string[] = [];
  if (alignment && (alignment.state === "accepted" || alignment.state === "refused")) parts.push(textAlignmentSentence(alignment) ?? "");
  if (links.length) {
    const kinds = [reviewed ? `${reviewed} reviewed` : null, links.length - reviewed ? `${links.length - reviewed} suggested and not reviewed` : null].filter(Boolean).join(", ");
    parts.push(`${countLabel(links.length, "stretch", "stretches")} of lines ${links.length === 1 ? "is" : "are"} linked to a time in the recording (${kinds}); the time stands on the first line of each.`);
  } else if (!parts.length && (alignment || hasTiming)) parts.push(textAlignmentSentence(alignment ?? { state: "not_run", reason: null, lines_aligned: null, lines_total: null, method: null }) ?? "");
  const text = parts.filter(Boolean).join(" ");
  return text || null;
}

/**
 * What generated speech text covers and what was withheld, as the line under its heading: the stretches themselves
 * while they are few ("Covers 0:00 – 1:30 and 1:38 – 2:30 of the recording. Not resolved: 1:30 – 1:38."); for a recording
 * with many, how much is covered and how much is withheld, because each gap is said in its place in the text.
 */
export function generatedCoverageLine(generated: Pick<TimingGenerated, "covered_intervals" | "unresolved_intervals" | "unresolved_ms"> | null | undefined): string {
  if (!generated) return NO_GENERATED_TEXT_SENTENCE;
  const bounds = (entries: ReadonlyArray<unknown>) => entries.map(intervalBounds).filter((entry): entry is [number, number] => entry !== null);
  const covered = bounds(generated.covered_intervals ?? []);
  const gaps = bounds(generated.unresolved_intervals ?? []);
  if (covered.length <= 2 && gaps.length <= 2) return generatedCoverageSentence(generated);
  const length = (entries: Array<[number, number]>) => entries.reduce((sum, [start, end]) => sum + (end - start), 0);
  const withheld = generated.unresolved_ms || length(gaps);
  return `Covers ${durationLabel(length(covered))} of the recording in ${countLabel(covered.length, "stretch", "stretches")}, between ${clockLabel(covered[0]![0])} and ${clockLabel(covered[covered.length - 1]![1])}.`
    + (gaps.length ? ` Text is withheld for ${durationLabel(withheld)} in ${countLabel(gaps.length, "gap")}; each is said in its place.` : "");
}

/** A row of the generated speech text: a stretch of text with its own time, or a stretch for which no text is given. */
export type GeneratedRow = { kind: "text"; start_ms: number; end_ms: number; text: string } | { kind: "gap"; start_ms: number; end_ms: number };
/** The generated text in the order of the recording, with every stretch whose text was withheld said as a gap in its place. */
export function generatedRows(text: Pick<GeneratedText, "segments"> | null | undefined, unresolved: ReadonlyArray<unknown> = []): GeneratedRow[] {
  const rows: GeneratedRow[] = (text?.segments ?? []).map((segment) => ({ kind: "text", start_ms: segment.start_ms, end_ms: segment.end_ms, text: segment.text }));
  for (const entry of unresolved) {
    const bounds = intervalBounds(entry);
    if (bounds) rows.push({ kind: "gap", start_ms: bounds[0], end_ms: bounds[1] });
  }
  return rows.sort((a, b) => a.start_ms - b.start_ms || (a.kind === "gap" ? -1 : 1));
}

// ---- the tab ---------------------------------------------------------------------------------------------------------------
interface TranscriptPanelProps {
  transcripts: TranscriptView[];
  /** The lines links tie to the slide on screen (a reviewed link, or a text match awaiting review). Never a time. */
  slideRanges: TranscriptRange[];
  positionMs: number;
  playing: boolean;
  focusLine?: number | null;
  onSeek: (ms: number) => void;
  onQuote: (source: SourceRef, text: string) => void;
  onReportError: (source: SourceRef, text: string) => void;
  /** The selected range of the page, whose lines are marked. Read from the workspace when absent. */
  range?: TimingRange | null;
  /** "Range 1 of 2" for the divider. Read from the workspace when absent. */
  rangeOrdinal?: { index: number; of: number } | null;
  /** The lecture's recordings and timing, for the Generated speech text section. Read from the workspace when absent. */
  recordings?: RecordingView[];
  timing?: LectureTiming | null;
}

function useWorkspaceIfAny(): LectureWorkspaceState | null {
  try {
    return useLectureWorkspace(); // one context read on every render, with or without a workspace
  } catch {
    return null;
  }
}

/** The gutter: a time where the row has one, the quote button under it or in its place. 52 px, so the text keeps 300 px in a panel of 377. */
const GUTTER = "w-[3.25rem] flex-none text-left";
const span = (range: { start: number; end: number }): string => (range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`);

export function TranscriptPanel({ transcripts, slideRanges, positionMs, playing, focusLine, onSeek, onQuote, onReportError, range: rangeProp, rangeOrdinal: ordinalProp, recordings: recordingsProp, timing: timingProp }: TranscriptPanelProps) {
  const workspace = useWorkspaceIfAny();
  const ids = useId();
  const [index, setIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [courseOpen, setCourseOpen] = useState(true);
  const [generatedOpen, setGeneratedOpen] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(0);
  const transcript = (transcripts[index] ?? transcripts[0]) as TimedTranscript | undefined;

  const range = rangeProp !== undefined ? rangeProp : workspace?.selectedRange ?? null;
  const ordinal = useMemo(() => {
    if (ordinalProp !== undefined) return ordinalProp;
    if (!workspace || !range) return null;
    const all = rangesForPage(workspace.lecture, workspace.page).ranges;
    const at = all.findIndex((entry) => entry.range_id === range.range_id);
    return at >= 0 ? { index: at + 1, of: all.length } : null;
  }, [ordinalProp, workspace, range]);
  const recordings = recordingsProp ?? workspace?.lecture.recordings ?? [];
  const timing = timingProp !== undefined ? timingProp : workspace?.lecture.timing ?? null;

  const times = useMemo(() => lineTimeIndex(transcript), [transcript]);
  const rows = useMemo(() => transcriptRows(transcript?.lines ?? []), [transcript]);
  /** The row drawn for a line of the file (a speaker tag's line is its talk's row; a blank line, the row after it). */
  const lineOfRow = useCallback((line: number): number | null => rowOfLine(rows, line)?.n ?? null, [rows]);
  // The range's own evidence names lines of the transcript the timing was made with: the one that carries its rows, else the lecture's first.
  const evidenceApplies = !!transcript && ((transcript.generated_line_times?.length ?? 0) > 0 || (transcript.text_alignment?.length ?? 0) > 0 || transcripts[0]?.source_id === transcript.source_id);
  const rangeLines = useMemo(() => linesOfRange(transcript, range, { evidenceApplies }), [transcript, range, evidenceApplies]);
  const slideLines = useMemo(() => {
    const set = new Set<number>();
    for (const linked of slideRanges) if (linked.source.source_id === transcript?.source_id) for (let n = linked.start; n <= linked.end; n++) set.add(n);
    return set;
  }, [slideRanges, transcript]);
  const inRange = useMemo(() => new Set(rangeLines), [rangeLines]);
  const marked = inRange.size ? inRange : slideLines;
  const firstMarked = useMemo(() => (marked.size ? Math.min(...marked) : null), [marked]);
  // The divider stands before the first row that holds a line of the range, and "After this range" after the last one.
  const rangeRows = useMemo(() => rows.filter((row) => rangeLines.some((line) => line >= row.first && line <= row.last)), [rows, rangeLines]);
  const firstOfRange = rangeRows[0]?.n ?? null;
  const lastOfRange = rangeRows.length ? rangeRows[rangeRows.length - 1]!.n : null;
  const active = useMemo(() => linesAt(times, positionMs), [times, positionMs]);

  // Follow playback: keep the line being spoken in view, until the learner scrolls away.
  useEffect(() => {
    if (!follow || !playing || !active || filter.trim()) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-line="${lineOfRow(active[0])}"]`);
    if (node && typeof node.scrollIntoView === "function") {
      programmatic.current = Date.now();
      node.scrollIntoView({ block: "nearest" });
    }
  }, [active, follow, playing, filter, lineOfRow]);

  // A line the address names is shown and selected.
  useEffect(() => {
    if (!focusLine) return;
    const row = rowOfLine(rows, focusLine);
    const node = row ? scrollRef.current?.querySelector<HTMLElement>(`[data-line="${row.n}"]`) : null;
    if (row && node) {
      programmatic.current = Date.now();
      if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
      setSelection({ start: row.first, end: row.last });
    }
  }, [focusLine, rows]);

  // Another slide or another range: its lines come into view (unless the address names a line, or a search is open).
  // While the tab is hidden nothing can be scrolled: it is done when the tab is shown.
  const markKey = `${transcript?.source_id ?? ""}|${firstMarked ?? ""}|${range?.range_id ?? ""}`;
  const pendingMark = useRef<number | null>(null);
  const showMark = useCallback(() => {
    const scroll = scrollRef.current;
    const line = pendingMark.current;
    if (!scroll || line === null || scroll.clientHeight === 0) return;
    pendingMark.current = null;
    const node = scroll.querySelector<HTMLElement>(`[data-divider="range"]`) ?? scroll.querySelector<HTMLElement>(`[data-line="${lineOfRow(line)}"]`);
    if (node) {
      programmatic.current = Date.now();
      scroll.scrollTop = Math.max(0, node.offsetTop - 40); // below the fade at the top edge; the line before stays in sight
    }
  }, [lineOfRow]);
  useEffect(() => {
    if (firstMarked === null || focusLine || filter.trim()) return;
    pendingMark.current = firstMarked;
    showMark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markKey, showMark]);
  // Text that runs past an edge of the list fades there instead of being cut through a line.
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const readEdges = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = { top: scroll.scrollTop > 2, bottom: scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2 };
    setEdges((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
  }, []);
  const courseShown = courseOpen && !!transcript;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      showMark();
      readEdges();
    });
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [showMark, readEdges, courseShown]);
  useEffect(readEdges);
  const fade = edges.top && edges.bottom ? "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent)"
    : edges.bottom ? "linear-gradient(to bottom, #000 calc(100% - 40px), transparent)" : edges.top ? "linear-gradient(to bottom, transparent, #000 32px)" : undefined;

  const hasCourse = !!transcript;
  const generatedShown = generatedOpen ?? !hasCourse;
  const closing = transcript ? transcriptClosingLine(transcript, !!timing) : null;
  const tagOf = (row: TranscriptRow): string => (row.speaker !== null && transcript ? transcript.lines[row.first - 1]!.trim() : ""); // the tag as the file writes it
  const sought = filter.trim().toLowerCase();
  const matches = transcript && sought ? rows.filter((row) => row.text.toLowerCase().includes(sought) || tagOf(row).toLowerCase().includes(sought)) : null;
  const shown = matches ?? rows;
  const selectedText = selection && transcript ? transcript.lines.slice(selection.start - 1, selection.end).join("\n") : "";
  const selectionRef: SourceRef | null = selection && transcript?.sha256 && transcript.version_id
    ? { source_id: transcript.source_id, version_id: transcript.version_id, sha256: transcript.sha256, locator: { kind: "lines", start: selection.start, end: selection.end } } : null;
  // A row is selected with the tag line that names its speaker, so a quote carries who said it.
  const pick = (row: TranscriptRow, extend: boolean) => {
    setSelection((current) => (extend && current ? { start: Math.min(current.start, row.first), end: Math.max(current.end, row.last) }
      : current && current.start === row.first && current.end === row.last ? null : { start: row.first, end: row.last }));
  };
  const linked = transcript ? slideRanges.filter((entry) => entry.source.source_id === transcript.source_id).sort((a, b) => a.start - b.start) : [];
  const reviewedLinks = linked.filter((entry) => entry.review_state === "confirmed");
  const suggestedLinks = linked.filter((entry) => entry.review_state !== "confirmed");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="transcript-tab">
      {/* ---- the course's own transcript ---- */}
      <section aria-labelledby={`${ids}course`} className={cn("flex min-h-0 flex-col", courseOpen && "flex-1")} data-testid="course-transcript">
        <h2 id={`${ids}course`} className="flex-none"><SectionToggle aria-expanded={courseOpen} onClick={() => setCourseOpen((open) => !open)}>Course transcript</SectionToggle></h2>
        {courseOpen && !transcript && (
          <p className="ll-measure pb-3 text-ui text-muted" role="note"><b className="font-semibold text-ink">No transcript is linked to this lecture.</b> There is no transcript file in a session linked to these slides. Nothing is generated in its place.</p>
        )}
        {courseOpen && transcript && (
          <>
            <div className="flex flex-none flex-wrap items-center gap-2 pb-2">
              {transcripts.length > 1 && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild><ToolbarButton chevron className="min-w-0 max-w-full bg-pad hover:bg-pad-strong [&>span]:truncate" aria-label={`Transcript: ${transcript.filename}`}>{transcript.filename}</ToolbarButton></DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="start" sideOffset={6} className="ll-pop z-50 max-w-[min(92vw,26rem)] p-1">
                      <DropdownMenu.RadioGroup value={String(index)} onValueChange={(value) => { setIndex(Number(value)); setSelection(null); }} aria-label="Transcript">
                        {transcripts.map((entry, at) => <DropdownMenu.RadioItem key={entry.source_id} value={String(at)} className="ll-menu-item"><span className="min-w-0 flex-1 break-words">{entry.filename} <span className="text-muted">· session {entry.session_id}</span></span>
                          <DropdownMenu.ItemIndicator><Check aria-hidden className="size-4 flex-none" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
              <input type="search" className="ll-input min-w-[9rem] flex-1" placeholder="Search this transcript" aria-label="Search this transcript" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
            {!follow && times.size > 0 && (
              <p className="flex flex-none flex-wrap items-center gap-2 pb-2 text-ui text-muted"><Button size="xs" onClick={() => setFollow(true)}>Follow playback</Button> Following paused because you scrolled.</p>
            )}
            {matches && <p className="flex-none pb-1 text-ui text-muted" role="status">{countLabel(matches.length, "matching line")}</p>}
            <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]" data-testid="transcript-scroll" style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
              onScroll={() => {
                readEdges();
                if (Date.now() - programmatic.current > 400 && follow && playing) setFollow(false);
              }}>
            {/* What links say about the slide on screen: reviewed, or only a text match awaiting review. Never a time. */}
            <p className="ll-measure pb-2 text-ui text-muted" data-testid="slide-lines-note" role="note">
              {linked.length === 0 && "No transcript lines are linked to this slide. Nothing is inferred for it."}
              {reviewedLinks.length > 0 && <span>Lines {reviewedLinks.map(span).join(", ")} are linked to this slide (reviewed). </span>}
              {suggestedLinks.length > 0 && <span>Lines {suggestedLinks.map(span).join(", ")} are a suggested match for this slide: found by comparing words, not reviewed, and not a time in the recording.</span>}
            </p>
            <ol aria-label="Transcript lines" data-testid="transcript-lines">
              {shown.map((row, at) => {
                const { n } = row;
                const overlaps = (from: number, to: number, other: TranscriptRow = row): boolean => from <= other.last && to >= other.first;
                // The row's time: its talk's own, else the one its tag line carries (a linked stretch may begin on the tag).
                const time = times.get(n) ?? (row.first !== n ? times.get(row.first) ?? null : null);
                const spoken = !!active && overlaps(active[0], active[1]);
                const chosen = !!selection && overlaps(selection.start, selection.end);
                let ruled = false;
                for (let line = row.first; line <= row.last && !ruled; line++) ruled = marked.has(line);
                const quiet = !matches && inRange.size > 0 && !ruled;
                // A stretch of rows (a linked stretch being spoken, several selected rows) is one block: only its ends are rounded.
                const block = spoken || chosen;
                const joined = (other: TranscriptRow | undefined) => !!other && !matches && ((spoken && !!active && overlaps(active[0], active[1], other)) || (chosen && !!selection && overlaps(selection.start, selection.end, other)));
                // Who speaks is said where it changes (and on every row of a search, which stand out of their order).
                const tag = row.speaker !== null && (!!matches || shown[at - 1]?.speaker !== row.speaker) ? tagOf(row) : "";
                return (
                  <li key={n} data-line={n} data-lines={row.first === n ? undefined : `${row.first}-${row.last}`} aria-current={spoken ? "true" : undefined}>
                    {!matches && n === firstOfRange && range && (
                      <p className="flex items-center justify-between gap-3 pb-2 pt-1 text-ui font-semibold" data-divider="range" data-testid="range-divider">
                        <BasisLabel basis={rangeBasis(range)} className="text-ink">{rangeKindWords(range)}</BasisLabel>
                        {ordinal && <span className="ll-num ll-nb flex-none">{rangeOrdinalLabel(ordinal.index, ordinal.of)}</span>}
                      </p>
                    )}
                    <div className={cn("group/line flex items-start gap-2 border-l-2 py-2 pl-2 transition-colors duration-[var(--ll-motion-small)]", time && "[@media(pointer:coarse)]:min-h-[68px]",
                      !(block && joined(shown[at - 1])) && "rounded-tr-row", !(block && joined(shown[at + 1])) && "rounded-br-row",
                      ruled ? "border-accent-text" : "border-transparent", spoken && "bg-pad", chosen && "bg-tint")}>
                      {/* The gutter: the time where the row has one; the quote button under it, or in its place. No line number is drawn. */}
                      <div className={cn(GUTTER, "relative")}>
                        {time && (
                          <button type="button" className={cn("ll-num block cursor-pointer rounded-thumb border-0 bg-transparent p-0 text-left text-meta leading-[var(--ll-lh-read)] hover:text-accent-text hover:underline", spoken ? "font-semibold text-accent-text" : "text-muted")}
                            onClick={() => onSeek(time.ms)} aria-label={`Go to ${clockLabel(time.ms)} in the recording (${timeBasisWords(time)})`} title={`Play from ${clockLabel(time.ms)} (${timeBasisWords(time)})`}>
                            {clockLabel(time.ms)}
                          </button>
                        )}
                        <button type="button" onClick={(event) => pick(row, event.shiftKey)} aria-label={`Select line ${n}${chosen ? " (selected)" : ""}`} aria-pressed={chosen}
                          title={`Line ${n}. Select it to ask about it; Shift-press another to select the lines between`}
                          className={cn("ll-ib ll-ib-sm -ml-1.5 text-muted transition-opacity duration-[var(--ll-motion-small)] hover:text-ink focus-visible:opacity-100 group-hover/line:opacity-100 [@media(pointer:coarse)]:opacity-100",
                            time ? "absolute left-0 top-[22px] h-6 min-w-6" : "-mt-0.5", chosen ? "text-accent-text opacity-100" : "opacity-0")}>
                          <Quote aria-hidden />
                        </button>
                      </div>
                      <p className={cn("min-w-0 flex-1 break-words text-read", quiet && "text-muted")}>{tag && <span className="text-muted" data-testid="speaker-tag">{tag} </span>}{row.text}</p>
                    </div>
                    {!matches && n === lastOfRange && at < shown.length - 1 && <p className="mt-3 border-t border-hairline pb-1 pt-3 text-ui text-muted" data-testid="after-range">After this range</p>}
                  </li>
                );
              })}
            </ol>
            {closing && !matches && <p className="ll-measure pb-2 pt-3 text-ui text-muted" data-testid="transcript-closing">{closing}</p>}
            </div>
            {selection && (
              <div className="mt-2 flex flex-none flex-wrap items-center gap-2 rounded-control bg-pad p-2 text-ui" role="group" aria-label="Selected transcript lines">
                <span className="ll-num px-1 font-semibold">Lines {span(selection)} selected</span>
                <Button size="sm" variant="primary" disabled={!selectionRef} onClick={() => selectionRef && onQuote(selectionRef, selectedText)}>Ask about this</Button>
                <Button size="sm" variant="quiet" disabled={!selectionRef} onClick={() => selectionRef && onReportError(selectionRef, selectedText)}>Report a transcript error</Button>
                <Button size="sm" variant="quiet" onClick={() => setSelection(null)}>Clear</Button>
                <span className="basis-full px-1 text-muted">{selectionRef ? "Shift-press the quote mark of another line to select the lines between." : "This file has not been identified by its bytes yet, so an exact quote cannot be attached."}</span>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- text generated from the recording: its own thing, with its own times ---- */}
      {recordings.length > 0 && (
        <GeneratedSection recordings={recordings} timing={timing} open={generatedShown} onToggle={() => setGeneratedOpen(!generatedShown)} onSeek={onSeek} positionMs={positionMs} headingId={`${ids}generated`} />
      )}
    </div>
  );
}

function GeneratedSection({ recordings, timing, open, onToggle, onSeek, positionMs, headingId }: { recordings: RecordingView[]; timing: LectureTiming | null; open: boolean; onToggle: () => void; onSeek: (ms: number) => void;
  positionMs: number; headingId: string }) {
  const rows = recordings.map((recording) => {
    const stated = timing?.recordings.find((entry) => entry.source_id === recording.source_id)?.generated;
    const text = recording.generated_text ?? null;
    // What it covers: the resolved stretches the timing block states; from an older view, the window of the imported text.
    const covers = stated !== undefined ? generatedCoverageLine(stated)
      : text ? `Covers ${timeSpanLabel(text.window.start_ms, text.window.end_ms)} of the recording${text.covers_whole_recording ? "" : text.duration_ms ? ` (${durationLabel(text.duration_ms)} long)` : ""}.` : NO_GENERATED_TEXT_SENTENCE;
    return { recording, text, has: !!stated || !!text, covers, list: generatedRows(text, stated?.unresolved_intervals ?? []) };
  });
  const any = rows.some((row) => row.has);
  const several = recordings.length > 1;
  return (
    <section aria-labelledby={headingId} className={cn("flex min-h-0 flex-col border-t border-hairline", open && any && "flex-1")} data-testid="generated-text">
      <h2 id={headingId} className="flex-none"><SectionToggle aria-expanded={open} onClick={onToggle}>Generated speech text</SectionToggle></h2>
      <div className={cn("flex min-h-0 flex-col", open && any ? "flex-1 overflow-y-auto [scrollbar-width:thin]" : "flex-none")}>
        {rows.map(({ recording, text, has, covers, list }) => (
          <div key={recording.source_id} className="pb-3 pl-7">
            <p className="ll-measure text-ui text-muted" data-testid="generated-window">
              {several && <b className="font-semibold text-ink">{recordingLabel(recordings, recording.source_id)}. </b>}
              {covers}{has ? ` ${GENERATED_TEXT_NOTE}` : ""}
            </p>
            {open && has && !text && <p className="ll-measure pt-1 text-ui text-muted">The text itself is not part of this view.</p>}
            {open && text && (
              <>
                {text.segments.length < text.segments_total && <p className="pt-1 text-ui text-muted">The first {text.segments.length} of {countLabel(text.segments_total, "stretch", "stretches")} of text are listed.</p>}
                <ol className="pt-2" aria-label={`Generated speech text${several ? ` of ${recording.filename}` : ""}`}>
                  {list.map((row) => (row.kind === "gap" ? (
                    <li key={`gap-${row.start_ms}`} className="flex items-start gap-3 py-2 pl-3 pr-1 text-ui text-muted" data-testid="generated-gap">
                      <span className={GUTTER} aria-hidden />
                      <span className="ll-nb">No text for {timeSpanLabel(row.start_ms, row.end_ms)}</span>
                    </li>
                  ) : (
                    <li key={`text-${row.start_ms}`} className={cn("flex items-start gap-3 rounded-row py-2 pl-3 pr-1", positionMs >= row.start_ms && positionMs < row.end_ms && "bg-pad")}>
                      <button type="button" className={cn(GUTTER, "ll-num cursor-pointer rounded-thumb border-0 bg-transparent p-0 text-ui leading-[var(--ll-lh-read)] text-muted hover:text-accent-text hover:underline")}
                        onClick={() => onSeek(row.start_ms)} aria-label={`Go to ${clockLabel(row.start_ms)} in the recording (generated timing, not reviewed)`}>{clockLabel(row.start_ms)}</button>
                      <p className="min-w-0 flex-1 break-words text-read">{row.text}</p>
                    </li>
                  )))}
                </ol>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Kept for the composition that still mounts it above the transcript: the generated speech text is now the second
 * section of `TranscriptPanel` (two labelled sections in one tab, 5.11), so this draws nothing. Remove its use and it.
 */
export function GeneratedTextPanel(_props: { recordings: Array<{ filename: string; generated_text?: GeneratedText | null }>; onSeek: (ms: number) => void }) {
  return null;
}
