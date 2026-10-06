// The ONE transport bar under the slide (design specification 5.5). There is no other play control for the recording
// on the screen. Two rows, 84 px (92 from 1920, 100 from 2400; 126 when the bar is under 480 px wide), whatever the state:
//
//   row 1   play · back 10 · forward 10 · the track · position / end · speed · volume · repeat · more
//   row 2   the ONE range line: which range of how many, its times, what it is, where it applies, Whole recording, and
//           the disclosure of the range list (./RangeList), which opens over the stage and never grows the bar
//
// The player itself is ./ClipPlayer: one media element under one Media Chrome controller, living in the frame's
// persistent media host. This file is a view of it. The seek buttons, the mute button and the volume slider are Media
// Chrome's own, bound to the controller by id; the track is the app's range input, because it spans the SELECTED range.
//
// A page without a range shows exactly one line of its no-range state with at most one action (9.5); until the
// learner opens the whole recording nothing can be played. A lecture view of an older Brain (no `ranges`) keeps its
// timed links, shown as ranges, and plays the whole recording as before.
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { DropdownMenu, Popover } from "radix-ui";
import { MediaMuteButton, MediaSeekBackwardButton, MediaSeekForwardButton, MediaVolumeRange } from "media-chrome/react";
import { Check, ChevronLeft, ChevronRight, Ellipsis, Pause, Play, Repeat, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { ErrorGlyph } from "@/components/glyphs";
import { BasisLabel } from "@/components/labels";
import { Button, cn, IconButton, ToolbarButton } from "@/components/ui";
import {
  NBSP, NO_RANGE_LINE, R2_ACTION, RANGE_RELATION_LABEL, TOPIC_DISCUSSION_SENTENCE, clockLabel, countLabel, rangeSupportLine, timeSpanLabel, unlistedLabel, type NoRangeActionId,
} from "@/lib/labels";
import { identityOf, isStructuralPage, noRangeDetail, noRangeSentence, rangesForPage } from "@/lib/r2";
import type { NoRange, Occurrence, RecordingView, TimingRange } from "@/lib/types";
import { useClipPlayer, type ClipBounds } from "./ClipPlayer";
import { WHOLE_RECORDING, type TransportProps } from "./contracts";
import { CANDIDATE_WORDS, RangeList, candidateId, rangeBasis, rangeKindParts } from "./RangeList";

// ---- pure parts (web/tests/lecture/transport.test.tsx) -------------------------------------------------------------------
/** What the bar still shows at a width (container widths of 5.5): narrower bars move things into More, never onto a third row of text. */
export interface BarLayout {
  /** From 760: the words that say where the range applies. */
  applies: boolean;
  /** From 640: the method in brackets, the volume button. */
  method: boolean;
  volume: boolean;
  /** From 560: the Whole recording toggle and the hint sentences. */
  wholeToggle: boolean;
  hints: boolean;
  /** From 480: the speed button. */
  speed: boolean;
  /** Under 480: the track and the time take the first row, the buttons the second. */
  stacked: boolean;
}
/** `width` in CSS px; null or 0 (not measured) counts as a wide bar. */
export function barLayout(width: number | null | undefined): BarLayout {
  const px = width && width > 0 ? width : Number.POSITIVE_INFINITY;
  return { applies: px >= 760, method: px >= 640, volume: px >= 640, wholeToggle: px >= 560, hints: px >= 560, speed: px >= 480, stacked: px < 480 };
}

/** "18 minutes 24 seconds", "1 hour 20 minutes", "0 seconds": a time as it is read out. */
export function spokenTime(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const parts: Array<[number, string]> = [[Math.floor(total / 3600), "hour"], [Math.floor((total % 3600) / 60), "minute"], [total % 60, "second"]];
  const said = parts.filter(([count]) => count > 0).map(([count, unit]) => `${count} ${unit}${count === 1 ? "" : "s"}`);
  return said.length ? said.join(" ") : "0 seconds";
}
/** What the track's slider says: the position, and the range it lies in or the length of the recording. */
export function scrubberValueText(positionMs: number, bounds: { start_ms: number; end_ms: number } | null, durationMs: number | null): string {
  if (bounds) return `${spokenTime(positionMs)}, in the range ${clockLabel(bounds.start_ms)} to ${clockLabel(bounds.end_ms)}`;
  return durationMs ? `${spokenTime(positionMs)} of ${spokenTime(durationMs)}` : spokenTime(positionMs);
}
/** The name of the play disc: what a press does. */
export function playLabel(playing: boolean, bounds: { start_ms: number; end_ms: number } | null): string {
  if (playing) return "Pause";
  return bounds ? `Play the range ${clockLabel(bounds.start_ms)} to ${clockLabel(bounds.end_ms)}` : "Play the whole recording";
}

/** Where the ranges of the page lie on the track of the whole recording, in percent. Only ranges of the recording that is loaded; none without its length. */
export function trackSegments(ranges: readonly TimingRange[], recordingId: string | null | undefined, durationMs: number | null | undefined): Array<{ id: string; left: number; width: number }> {
  if (!durationMs || durationMs <= 0) return [];
  return ranges.filter((range) => !recordingId || range.recording.source_id === recordingId).map((range) => {
    const start = Math.min(Math.max(range.start_ms, 0), durationMs);
    const end = Math.min(Math.max(range.end_ms, start), durationMs);
    return { id: range.range_id, left: (start / durationMs) * 100, width: ((end - start) / durationMs) * 100 };
  });
}

/** True when no two segments overlap: each can then be told from the others above the track, and they can be counted there. */
export const separate = (segments: ReadonlyArray<{ left: number; width: number }>): boolean =>
  [...segments].sort((a, b) => a.left - b.left).every((segment, index, sorted) => index === 0 || segment.left >= sorted[index - 1]!.left + sorted[index - 1]!.width);

/** "99.7 %": a share that is under the whole never reads as 100, and one above nothing never as 0. */
export function shareLabel(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  if (clamped >= 1) return `100${NBSP}%`;
  const tenths = Math.min(999, Math.max(clamped > 0 ? 1 : 0, Math.round(clamped * 1000)));
  return `${(tenths / 10).toFixed(1)}${NBSP}%`;
}
/**
 * How much of the lecture's recording has timing, for a page whose talk was looked for in the processed part only:
 * the processed stretches of the state's own detail over the lengths of the recordings they belong to; failing that,
 * the one coverage figure the Brain stated. null when neither is known: no share is made up.
 */
export function processedShare(noRange: NoRange, recordings: ReadonlyArray<Pick<RecordingView, "source_id" | "duration_ms">>): number | null {
  if (noRange.state !== "audio_unprocessed") return null;
  const detail = noRange.detail ?? {};
  const processed = Array.isArray(detail.processed) ? detail.processed.filter((entry) => Array.isArray(entry) && entry.length === 3 && typeof entry[1] === "number" && typeof entry[2] === "number" && entry[2] > entry[1]) : [];
  const ids = new Set(processed.map((entry) => String(entry[0])));
  const lengths = recordings.filter((recording) => ids.has(recording.source_id)).map((recording) => recording.duration_ms);
  if (processed.length && lengths.length === ids.size && lengths.every((length): length is number => typeof length === "number" && length > 0)) {
    return Math.min(1, processed.reduce((sum, entry) => sum + (entry[2] - entry[1]), 0) / lengths.reduce((sum, length) => sum + length, 0));
  }
  const stated = (detail.coverage ?? []).map((row) => row.coverage_fraction).filter((value): value is number => typeof value === "number");
  return stated.length === 1 ? Math.min(1, Math.max(0, stated[0]!)) : null;
}
/**
 * The one line of a page without a range (9.5): the state's name, its sentence (the Brain's own, verbatim) and at most
 * one action. When part of the recording was processed and nothing for the page was found in it, "audio not processed
 * yet" would be untrue as a name: the line then says that it was not found in the processed part, and how much that is.
 */
export function noRangeLine(noRange: NoRange, recordings: ReadonlyArray<Pick<RecordingView, "source_id" | "duration_ms">> = []): { name: string; brief: string; sentence: string; action: NoRangeActionId | null } {
  const row = (NO_RANGE_LINE as Record<string, { label: string; action: NoRangeActionId | null } | undefined>)[noRange.state];
  const state = String(noRange.state);
  let name = row?.label ?? unlistedLabel(state).replace(/^./, (first) => first.toUpperCase());
  let brief = name; // for a bar too narrow for the sentence: the same fact in fewer words
  if (noRange.state === "audio_unprocessed" && noRangeDetail(noRange).coveredIntervals.length > 0) {
    const share = processedShare(noRange, recordings);
    name = `Not found in the processed part of the recording${share === null ? "" : ` (${shareLabel(share)})`}`;
    brief = share === null ? "Not found in the processed part" : `Not found in ${shareLabel(share)}`;
  }
  return { name, brief, sentence: row ? noRangeSentence(noRange) : (noRange as { text?: string }).text ?? "", action: row?.action ?? null };
}

/**
 * The timed links of a lecture view that carries no `ranges` (an older Brain), shaped as ranges so that one bar serves
 * both. Nothing is added to them: the method is the link's recorded basis and no quality is stated.
 */
export function rangesFromLinks(links: readonly Occurrence[], page: number): TimingRange[] {
  const shown = links.filter((link) => link.review_state !== "rejected" && Number.isFinite(link.start_ms) && Number.isFinite(link.end_ms) && link.end_ms > link.start_ms);
  const unstated = { state: "not_stated", basis: "" };
  return shown.map((link, index) => ({
    range_id: link.annotation_id,
    recording: { source_id: link.source.source_id, version_id: link.source.version_id ?? null, sha256: link.source.sha256 ?? null },
    timebase: "original_source_start", start_ms: link.start_ms, end_ms: link.end_ms,
    relation: link.relation === "displayed_during" ? "displayed_during" : "discussed_during",
    occurrence_index: index + 1, occurrences_total: shown.length,
    support: { scope: "page", pages: [page], builds: null },
    method: { name: link.basis.replace(/_/g, " "), version: null },
    origin: link.review_state === "confirmed" ? "manual" : "pipeline",
    review_state: link.review_state === "confirmed" ? "human_confirmed" : "generated",
    quality: { acoustic: unstated, association: unstated, group_mapping: unstated },
    why: null, evidence: {}, annotation_id: link.annotation_id,
  }));
}

// ---- small parts ---------------------------------------------------------------------------------------------------------
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const rateLabel = (rate: number): string => `${rate}×`;
const MENU = "ll-pop z-50 max-h-[min(70dvh,32rem)] min-w-[13rem] max-w-[min(92vw,22rem)] overflow-y-auto p-1";
const MENU_LABEL = "px-3 pb-1 pt-2 text-ui text-muted";
const SEPARATOR = "my-1 h-px bg-hairline";
/** A text button of the range line: 28 high on a pad. */
const LINE_BUTTON = "flex-none px-2.5";
const LINE_PAD = "bg-pad hover:bg-pad-strong";
/** Media Chrome's own buttons, drawn as the app's icon button: 36 square, bare, a pad on hover, the app's focus ring. */
const MC_BUTTON = [
  "size-9 flex-none rounded-control [--media-control-background:transparent] [--media-control-hover-background:var(--ll-pad)] [--media-control-padding:6px] [--media-control-height:24px]",
  "[--media-icon-color:var(--ll-text)] [--media-primary-color:var(--ll-text)] [--media-focus-box-shadow:0_0_0_2px_var(--ll-surface-raised),0_0_0_4px_var(--ll-focus)]",
].join(" ");
const MC_BUTTON_OFF = "[--media-icon-color:var(--ll-border)] [--media-control-hover-background:transparent] [--media-cursor:not-allowed]";
const ROW_1 = "h-[52px] min-[1920px]:h-14 min-[2400px]:h-[60px]";
const ROW_2 = "h-8 min-[1920px]:h-9 min-[2400px]:h-10";

/** The width of the bar in whole px; 0 until it is measured (and where nothing is laid out). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(Math.round(node.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * How much the range line has to give up to stay one line: 0 nothing; then, one step at a time, whatever of it is
 * marked `data-fit` and is cut, or the line itself when it runs over. `key` names what the line holds and how wide it
 * is; a new key starts again from nothing given up. Measured before paint, so no cut line is ever shown.
 */
function useFit(ref: RefObject<HTMLElement | null>, key: string, steps: number): number {
  const [state, setState] = useState({ key, given: 0 });
  const given = state.key === key ? state.given : 0;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const cut = node.scrollWidth > node.clientWidth + 1 || [...node.querySelectorAll<HTMLElement>("[data-fit]")].some((part) => part.scrollWidth > part.clientWidth + 1);
    if (cut && given < steps) setState({ key, given: given + 1 });
    else if (state.key !== key) setState({ key, given });
  });
  return given;
}

interface ScrubberProps {
  min: number;
  max: number;
  value: number;
  /** A range is selected: the track spans it and carries a cap at each end. */
  bounded: boolean;
  /** Nothing is selected to play: a bare line, no knob, no control. */
  idle: boolean;
  segments: Array<{ id: string; left: number; width: number }>;
  label: string;
  valueText: string;
  onSeek: (ms: number) => void;
  className?: string;
}
/** The track: a thin line, the played part thicker and in the accent, a knob, and above it this page's ranges as segments. */
function Scrubber({ min, max, value, bounded, idle, segments, label, valueText, onSeek, className }: ScrubberProps) {
  const top = Math.max(max, min + 1);
  const at = Math.min(Math.max(value, min), top);
  const share = ((at - min) / (top - min)) * 100;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const jump = event.key === "ArrowLeft" || event.key === "ArrowDown" ? at - 5_000 : event.key === "ArrowRight" || event.key === "ArrowUp" ? at + 5_000
      : event.key === "PageDown" ? at - 30_000 : event.key === "PageUp" ? at + 30_000 : event.key === "Home" ? min : event.key === "End" ? top : null;
    if (jump === null) return;
    event.preventDefault();
    event.stopPropagation(); // the arrow keys page the slide elsewhere; here they move the position
    onSeek(Math.min(Math.max(jump, min), top));
  };
  return (
    <div className={cn("group/scrub relative flex min-w-[64px] items-center px-[7px]", className)} data-testid="track" data-bounded={bounded || undefined}>
      <div className="relative h-0.5 flex-1 rounded-[1px] bg-line">
        {bounded && <><span aria-hidden className="absolute -left-0.5 -top-1.5 h-3.5 w-0.5 rounded-[1px] bg-line" /><span aria-hidden className="absolute -right-0.5 -top-1.5 h-3.5 w-0.5 rounded-[1px] bg-line" /></>}
        {segments.length > 0 && (
          <span aria-hidden className="absolute inset-x-0 bottom-full h-[18px]" data-testid="track-segments">
            {segments.map((segment) => <i key={segment.id} className="absolute bottom-[11px] h-[5px] min-w-[6px] rounded-[2px] bg-accent-text" style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />)}
          </span>
        )}
        {!idle && <span aria-hidden className="absolute -bottom-0.5 -top-0.5 left-0 rounded-[3px] bg-accent-text" style={{ width: `${share}%` }} />}
        {!idle && (
          <span aria-hidden className="absolute top-1/2 -ml-[7px] -mt-[7px] size-3.5 rounded-full bg-accent-text shadow-[0_0_0_3px_var(--ll-surface-raised)] group-has-[:focus-visible]/scrub:outline-2 group-has-[:focus-visible]/scrub:outline-offset-[5px] group-has-[:focus-visible]/scrub:outline-focus"
            style={{ left: `${share}%` }} />
        )}
      </div>
      {!idle && (
        <input type="range" min={min} max={top} step={250} value={at} onChange={(event) => onSeek(Number(event.target.value))} onKeyDown={onKeyDown} aria-label={label} aria-valuetext={valueText} data-testid="clip-scrubber"
          className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 [&::-moz-range-thumb]:size-3.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none" />
      )}
    </div>
  );
}

/**
 * A sentence of the range line. The line is one line: a sentence that does not fit is cut there and opens in full on
 * request. `full` is more than what is shown (a bar too narrow for the sentence shows the name alone): it always opens.
 */
function LineSentence({ name, full, strong, children }: { name?: string; full?: string; strong?: boolean; children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setCut] = useState(false);
  const cut = overflowing || !!full;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setCut(node.scrollWidth > node.clientWidth + 1);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);
  const text = <span ref={ref} className="block min-w-0 truncate">{children}</span>;
  const tone = strong ? "font-semibold text-ink" : "text-muted";
  if (!cut) return <span className={cn("min-w-0 flex-shrink", tone)}>{text}</span>;
  return (
    <Popover.Root>
      <Popover.Trigger className={cn("min-w-0 flex-shrink cursor-pointer rounded-thumb border-0 bg-transparent p-0 text-left text-ui", tone, !strong && "hover:text-ink")} aria-label={`Read in full: ${full ?? children}`}>{text}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={10} collisionPadding={12} className="ll-pop z-50 max-w-[min(92vw,34rem)] p-3 text-ui">
          {name && <b className="font-semibold">{name}. </b>}{full ?? children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---- the bar ---------------------------------------------------------------------------------------------------------------
export function Transport({ lecture, page, slide, selection, onSelect, playerRef, onTime, onEditMatch, onAddMatch, onNextContent, announce, onOpenTranscriptLines }: TransportProps) {
  const frame = useWorkspaceFrame();
  const bar = useRef<HTMLElement>(null);
  const names = useId();
  const lineRef = useRef<HTMLDivElement>(null);
  const width = useWidth(bar);
  const measured = barLayout(width);
  const [listOpen, setListOpen] = useState(false);
  const [listRoom, setListRoom] = useState<number | null>(null);
  // Outside a workspace frame (a story, a unit test) the media element lives in the bar itself.
  const [ownHost, setOwnHost] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const host = frame.mediaHost ?? (mounted ? ownHost : null);

  const lectureKey = `${lecture.course_id}/${lecture.lecture_id}`;
  const pageKey = `${lectureKey}#${page}`;
  const pageRanges = useMemo(() => rangesForPage(lecture, page), [lecture, page]);
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const structural = isStructuralPage(lecture, page);
  const links = slide?.occurrences ?? [];
  // A view without range data (an older Brain) keeps its timed links and the whole recording as the default.
  const legacy = !pageRanges.known;
  const ranges = useMemo(() => (legacy ? rangesFromLinks(links, page) : pageRanges.ranges), [legacy, links, page, pageRanges.ranges]);
  const [legacyChoice, setLegacyChoice] = useState<{ key: string; selection: string } | null>(null);
  const chosen = legacy ? (legacyChoice?.key === pageKey ? legacyChoice.selection : ranges[0]?.range_id ?? WHOLE_RECORDING) : selection;
  const select = (next: string) => (legacy ? setLegacyChoice({ key: pageKey, selection: next }) : onSelect(next));
  const index = ranges.findIndex((range) => range.range_id === chosen);
  const selected = index >= 0 ? ranges[index]! : null;
  const lastRange = useRef<{ key: string; id: string } | null>(null);
  if (selected) lastRange.current = { key: pageKey, id: selected.range_id };

  const noRange = ranges.length === 0 ? pageRanges.noRange : null;
  const unavailable = lecture.recordings.length === 0 || noRange?.state === "recording_unavailable";
  const candidates = useMemo(() => (noRange?.state === "ambiguous" ? noRangeDetail(noRange).candidates : []), [noRange]);
  const [heard, setHeard] = useState<{ key: string; id: string } | null>(null);
  const candidate = heard?.key === pageKey ? candidates.find((entry) => candidateId(entry) === heard.id) ?? null : null;
  // The whole recording, once opened on a page without a range, stays open on the later ones of the lecture.
  const [opened, setOpened] = useState<string | null>(null);
  const wholeOpen = legacy || opened === lectureKey;
  const mode: "unavailable" | "range" | "whole" | "candidate" | "opened" | "idle" = unavailable ? "unavailable" : selected ? "range" : ranges.length ? "whole" : candidate ? "candidate" : wholeOpen ? "opened" : "idle";
  const live = mode !== "unavailable" && mode !== "idle";

  const bounds = useMemo<ClipBounds | null>(() => (selected
    ? { id: selected.range_id, start_ms: selected.start_ms, end_ms: selected.end_ms, recording_source_id: selected.recording.source_id }
    : candidate ? { id: candidateId(candidate), start_ms: candidate.start_ms, end_ms: candidate.end_ms, recording_source_id: candidate.recording_source_id ?? null } : null),
  [selected, candidate]);

  const leave = useRef<() => void>(() => undefined);
  const clip = useClipPlayer({
    host, recordings: lecture.recordings, bounds, pageKey, onTime,
    onLeftRange: () => leave.current(),
    onStopped: () => announce?.("Stopped at the end of this range."),
  });
  leave.current = () => {
    if (selected) select(WHOLE_RECORDING);
    setHeard(null);
    setOpened(lectureKey);
  };

  const state = useRef({ live, durationMs: clip.durationMs, recording: clip.recording });
  state.current = { live, durationMs: clip.durationMs, recording: clip.recording };
  useImperativeHandle(playerRef, () => ({
    pause: clip.pause,
    // From outside the bar (the docked strip, a timed transcript line) a press is the learner asking for the recording.
    toggle: () => {
      if (!state.current.live) setOpened(lectureKey);
      clip.toggle();
    },
    seekTo: (ms: number) => {
      if (!state.current.live) setOpened(lectureKey);
      clip.seekTo(ms);
    },
    currentMs: clip.currentMs,
    isPlaying: clip.isPlaying,
    durationMs: () => state.current.durationMs,
    recording: () => state.current.recording,
  }), [clip.pause, clip.toggle, clip.seekTo, clip.currentMs, clip.isPlaying, lectureKey]);

  // The list belongs to a page: another page closes it.
  useEffect(() => setListOpen(false), [pageKey]);

  // The list lies over the slide and nothing else: it gets the room between the top of the stage's content and the bar.
  const openList = (open: boolean) => {
    if (open) {
      // The nearest ancestor that holds something above the bar is the block of the slide and the bar.
      const top = bar.current?.getBoundingClientRect().top ?? 0;
      let above = 0;
      for (let parent = bar.current?.parentElement, depth = 0; parent && depth < 4 && above <= 120; parent = parent.parentElement, depth += 1) above = top - parent.getBoundingClientRect().top;
      setListRoom(above > 120 ? Math.floor(above) - 8 : null);
    }
    setListOpen(open);
  };
  const choose = (next: string) => {
    clip.keepPlaying();
    setHeard(null);
    if (next === chosen && selected) clip.seek(selected.start_ms); // the chosen range again: back to its start
    else select(next);
  };
  const hear = (id: string) => {
    clip.keepPlaying();
    if (candidate && candidateId(candidate) === id) clip.seek(candidate.start_ms);
    else setHeard({ key: pageKey, id });
  };
  const toggleWhole = () => {
    clip.keepPlaying();
    if (mode === "range") select(WHOLE_RECORDING);
    else if (mode === "whole") select((lastRange.current?.key === pageKey ? ranges.find((range) => range.range_id === lastRange.current!.id) : null)?.range_id ?? (pageRanges.selectedDefault ?? ranges[0])!.range_id);
    else if (mode === "candidate") {
      setHeard(null);
      setOpened(lectureKey);
    } else setOpened(mode === "opened" && !legacy ? null : lectureKey);
  };
  const goOn = () => {
    clip.goOn();
    if (selected) select(WHOLE_RECORDING);
    else leave.current();
  };
  const linkOf = (range: TimingRange): Occurrence | undefined => (range.annotation_id ? links.find((link) => link.annotation_id === range.annotation_id) : undefined);
  const canCorrect = (range: TimingRange): boolean => (linkOf(range) && onEditMatch ? true : !!onAddMatch);
  const correct = (range: TimingRange) => {
    const link = linkOf(range);
    setListOpen(false);
    if (link && onEditMatch) onEditMatch(link);
    else onAddMatch?.(range.start_ms); // a range nobody recorded is corrected by marking your own
  };

  const trackMin = bounds ? bounds.start_ms : 0;
  const trackMax = bounds ? bounds.end_ms : clip.durationMs ?? 0;
  const wholeShown = mode === "whole" || mode === "opened";
  const segments = wholeShown ? trackSegments(ranges, clip.recording?.source_id, clip.durationMs) : [];
  const noLine = noRange ? noRangeLine(noRange, lecture.recordings) : null;
  const kind = selected ? rangeKindParts(selected) : null;
  const applies = selected ? (structural ? TOPIC_DISCUSSION_SENTENCE : rangeSupportLine(selected.support, identity.position?.kind ?? null).short) : null;
  const stopped = clip.stoppedAtEnd && (mode === "range" || mode === "candidate");
  // The widths of 5.5 say what a bar keeps; a line that still does not fit (long times, a stepper, large text) gives up
  // the same things in the same order: where it applies, then the method, then the Whole recording toggle (to More).
  const given = useFit(lineRef, `${width}|${mode}|${bounds?.id ?? ""}|${ranges.length}|${stopped}|${clip.repeat}|${listOpen}`, 3);
  const layout: BarLayout = { ...measured, applies: measured.applies && given < 1, method: measured.method && given < 2, wholeToggle: measured.wholeToggle && given < 3 };
  const canRepeat = mode === "range" || mode === "candidate";
  const backName = `${names}back`;
  const forwardName = `${names}forward`;

  // ---- the bar holds one sentence: no recording, or it could not be loaded -------------------------------------------------
  const shell = "relative w-full flex-none rounded-control bg-raised text-ui shadow-[0_0_0_1px_var(--ll-hairline)]";
  const tall = "min-h-[84px] min-[1920px]:min-h-[92px] min-[2400px]:min-h-[100px]";
  if (mode === "unavailable") {
    return (
      <section ref={bar} aria-label="Recording" className={cn(shell, tall, "flex items-center px-4 py-2")} data-testid="transport" data-mode="unavailable">
        <p className="ll-measure" data-testid="no-range-line" data-state={noRange?.state ?? "recording_unavailable"}>
          <b className="font-semibold">{noLine?.name ?? NO_RANGE_LINE.recording_unavailable.label}</b>{" "}
          <span className="text-muted">{noLine?.sentence || "No recording is linked to this lecture. The slides can be read as usual; no times are shown."}</span>
        </p>
      </section>
    );
  }

  // ---- row 1 ---------------------------------------------------------------------------------------------------------------
  const disc = (
    <button type="button" disabled={!live} onClick={clip.toggle} aria-label={playLabel(clip.playing, bounds)} title={live ? playLabel(clip.playing, bounds) : "Nothing is selected to play"} data-testid="play-toggle"
      className={cn("mr-1.5 grid size-10 flex-none place-items-center rounded-full border-0 transition-colors duration-[var(--ll-motion-small)] min-[1920px]:size-11",
        live ? "cursor-pointer bg-accent text-on-accent hover:bg-accent-hover" : "cursor-not-allowed bg-pad-strong text-muted")}>
      {clip.playing ? <Pause aria-hidden className="size-5" fill="currentColor" strokeWidth={0} /> : <Play aria-hidden className="size-5 translate-x-px" fill="currentColor" strokeWidth={1.5} />}
    </button>
  );
  const controls = (
    <div className={cn("flex items-center gap-0.5", layout.stacked ? "h-12" : ROW_1)} data-testid="transport-controls">
      {disc}
      <span id={backName} hidden>Back 10 seconds</span>
      <span id={forwardName} hidden>Forward 10 seconds</span>
      <MediaSeekBackwardButton mediaController={clip.controllerId ?? undefined} seekOffset={10} noTooltip disabled={!live} aria-disabled={!live || undefined} aria-labelledby={backName} title="Back 10 seconds"
        className={cn(MC_BUTTON, !live && MC_BUTTON_OFF)} />
      <MediaSeekForwardButton mediaController={clip.controllerId ?? undefined} seekOffset={10} noTooltip disabled={!live} aria-disabled={!live || undefined} aria-labelledby={forwardName} title="Forward 10 seconds"
        className={cn(MC_BUTTON, !live && MC_BUTTON_OFF)} />
    </div>
  );
  const track = (
    <Scrubber className={layout.stacked ? "h-9 pt-2" : ROW_1} min={trackMin} max={trackMax} value={clip.positionMs} bounded={!!bounds} idle={!live} segments={segments}
      label={bounds ? "Position in the selected range" : "Position in the whole recording"} valueText={scrubberValueText(clip.positionMs, bounds, clip.durationMs)} onSeek={clip.seek} />
  );
  const time = (
    <p className={cn("ll-num whitespace-nowrap text-ui text-muted", layout.stacked && "pr-2 pt-2")} data-testid="time-readout">
      <b className={cn("font-semibold", live && "text-ink")}>{clockLabel(live ? Math.min(Math.max(clip.positionMs, trackMin), Math.max(trackMax, trackMin)) : 0)}</b>
      {trackMax > 0 && <> / {clockLabel(trackMax)}</>}
    </p>
  );
  const speedItems = (
    <DropdownMenu.RadioGroup value={String(clip.rate)} onValueChange={(value) => clip.setRate(Number(value))} aria-label="Playback speed">
      {RATES.map((rate) => (
        <DropdownMenu.RadioItem key={rate} value={String(rate)} className="ll-menu-item ll-num">
          <span className="flex-1">{rateLabel(rate)}</span>
          <DropdownMenu.ItemIndicator><Check aria-hidden className="size-4" /></DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
  const VolumeIcon = clip.muted || clip.volume === 0 ? VolumeX : clip.volume < 0.5 ? Volume1 : Volume2;
  const markable = !!onAddMatch;
  const tools = (
    <div className={cn("flex items-center gap-0.5", layout.stacked ? "h-12" : ROW_1)}>
      {layout.speed && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><ToolbarButton className="ll-num px-2" aria-label={`Playback speed, ${rateLabel(clip.rate)}`} title="Playback speed" data-testid="speed-button">{rateLabel(clip.rate)}</ToolbarButton></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content side="top" align="end" sideOffset={6} className={cn(MENU, "min-w-[7rem]")} data-testid="speed-menu">{speedItems}</DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {layout.volume && (
        <Popover.Root>
          <Popover.Trigger asChild><IconButton label="Volume"><VolumeIcon aria-hidden /></IconButton></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="center" sideOffset={6} aria-label="Volume" className="ll-pop z-50 flex items-center gap-1 p-1.5" data-testid="volume-popover">
              <MediaMuteButton mediaController={clip.controllerId ?? undefined} noTooltip className={MC_BUTTON} />
              <MediaVolumeRange {...(clip.controllerId ? ({ mediacontroller: clip.controllerId } as object) : {})}
                className="h-9 w-36 rounded-control [--media-control-background:transparent] [--media-control-hover-background:transparent] [--media-range-bar-color:var(--ll-accent-text)] [--media-range-padding:8px] [--media-range-thumb-background:var(--ll-accent-text)] [--media-range-thumb-height:14px] [--media-range-thumb-width:14px] [--media-range-track-background:var(--ll-border)] [--media-range-track-height:3px] [--media-focus-box-shadow:0_0_0_2px_var(--ll-focus)]" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <IconButton label="Repeat this range" aria-pressed={canRepeat && clip.repeat} disabled={!canRepeat} onClick={() => clip.setRepeat(!clip.repeat)} data-testid="repeat-toggle"><Repeat aria-hidden /></IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><IconButton label="More: mark a range for this slide, correct this range" data-testid="transport-more-button"><Ellipsis aria-hidden /></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="end" sideOffset={6} className={MENU} data-testid="transport-more">
            {markable
              ? <DropdownMenu.Item className="ll-menu-item" onSelect={() => onAddMatch!()}>Mark a range for this slide</DropdownMenu.Item>
              : <DropdownMenu.Label className={cn(MENU_LABEL, "pb-2")}>A range can be marked once this device is paired and the slide and the recording are identified.</DropdownMenu.Label>}
            {selected && canCorrect(selected) && <DropdownMenu.Item className="ll-menu-item" onSelect={() => correct(selected)}>Correct this range</DropdownMenu.Item>}
            {stopped && !layout.method && <DropdownMenu.Item className="ll-menu-item" onSelect={goOn}>Go on in the whole recording</DropdownMenu.Item>}
            {(!layout.wholeToggle || noLine?.action === "next_content" || noLine?.action === "show_candidates") && (
              <DropdownMenu.CheckboxItem className="ll-menu-item" checked={wholeShown} onCheckedChange={toggleWhole}>
                <span className="flex-1">{R2_ACTION.whole_recording}</span>
                <DropdownMenu.ItemIndicator><Check aria-hidden className="size-4" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.CheckboxItem>
            )}
            {!layout.volume && <DropdownMenu.Item className="ll-menu-item" onSelect={() => clip.setMuted(!clip.muted)}>{clip.muted ? "Unmute" : "Mute"}</DropdownMenu.Item>}
            {!layout.speed && <><DropdownMenu.Separator className={SEPARATOR} /><DropdownMenu.Label className={MENU_LABEL}>Playback speed</DropdownMenu.Label>{speedItems}</>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );

  // ---- row 2: the one range line ----------------------------------------------------------------------------------------------
  const lineButton = (pressed?: boolean) => cn(LINE_BUTTON, !pressed && LINE_PAD);
  const wholeToggle = layout.wholeToggle && (
    <ToolbarButton size="sm" aria-pressed={wholeShown} className={lineButton(wholeShown)} onClick={toggleWhole} data-testid="whole-toggle">{R2_ACTION.whole_recording}</ToolbarButton>
  );
  const listButton = (closed: ReactNode, open: ReactNode) => (
    <ToolbarButton size="sm" chevron className={cn(lineButton(), !listOpen && "[&>svg:last-child]:rotate-180")} data-testid="range-list-toggle">{listOpen ? open : closed}</ToolbarButton>
  );
  const list = (trigger: ReactNode) => (
    <RangeList pages={identity.groupPages} ranges={ranges} candidates={candidates} selection={candidate ? candidateId(candidate) : chosen} onSelect={(next) => (next.startsWith("candidate:") ? hear(next) : choose(next))}
      open={listOpen} onOpenChange={openList} room={listRoom} trigger={trigger} anchor={bar} recordings={lecture.recordings} groupKind={identity.position?.kind ?? null} structural={structural}
      onMarkRange={onAddMatch ? () => { setListOpen(false); onAddMatch(); } : undefined} onCorrectRange={ranges.some(canCorrect) ? correct : undefined} onOpenTranscriptLines={onOpenTranscriptLines} />
  );
  const rangesButton = list(listButton(
    ranges.length === 1 ? (layout.stacked ? "Details" : "Range details") : layout.stacked ? `All${NBSP}${ranges.length}` : `All${NBSP}${countLabel(ranges.length, "range")}`,
    layout.stacked ? "Hide" : "Hide ranges",
  ));
  const action = (label: string, onClick: () => void, icon?: ReactNode) => (
    <ToolbarButton size="sm" icon={icon} className={cn(LINE_BUTTON, LINE_PAD, "font-semibold text-accent-text")} onClick={onClick} data-testid="no-range-action">{label}</ToolbarButton>
  );

  let line: ReactNode;
  if (mode === "range" && selected && kind) {
    line = (
      <>
        {ranges.length > 1 && (
          <span className="inline-flex flex-none items-center gap-0.5 whitespace-nowrap" data-testid="range-stepper">
            <IconButton size="sm" label="Previous range" disabled={index <= 0} onClick={() => choose(ranges[index - 1]!.range_id)}><ChevronLeft aria-hidden /></IconButton>
            <span className="ll-num ll-nb">{!layout.stacked && `Range${NBSP}`}<b className="font-semibold">{index + 1}</b>{`${NBSP}of${NBSP}${ranges.length}`}</span>
            <IconButton size="sm" label="Next range" disabled={index >= ranges.length - 1} onClick={() => choose(ranges[index + 1]!.range_id)}><ChevronRight aria-hidden /></IconButton>
          </span>
        )}
        {stopped ? (
          <>
            <b className="ll-nb flex-none font-semibold" data-testid="stopped-line">{layout.method ? "Stopped at the end of this range" : "Stopped at the end"}</b>
            {!layout.stacked && <ToolbarButton size="sm" className={lineButton()} onClick={clip.play}>Play it again</ToolbarButton>}
            {layout.method && <ToolbarButton size="sm" className={lineButton()} onClick={goOn}>Go on in the whole recording</ToolbarButton>}
          </>
        ) : (
          <>
            <b className="ll-num ll-nb flex-none font-semibold" data-testid="range-times">{selected.relation === "displayed_during" ? `${RANGE_RELATION_LABEL.displayed_during} ` : ""}{timeSpanLabel(selected.start_ms, selected.end_ms)}</b>
            <BasisLabel basis={rangeBasis(selected)} className="min-w-0 flex-shrink-0 whitespace-nowrap text-ink">{layout.stacked ? <span className="sr-only">{kind.label}</span>
              : <span className="block" data-fit="">{kind.label}{kind.method && layout.method && !clip.repeat ? ` (${kind.method})` : ""}</span>}</BasisLabel>
            {clip.repeat ? (measured.hints && <LineSentence>Repeats this range until you turn it off</LineSentence>)
              : layout.applies && applies && <span className="min-w-0 truncate text-muted" data-fit=""><span aria-hidden>· </span>{applies}</span>}
          </>
        )}
        <span className="min-w-2 flex-1" />
        {!stopped && wholeToggle}
        {rangesButton}
      </>
    );
  } else if (mode === "whole") {
    line = (
      <>
        <b className="ll-nb flex-none font-semibold">{R2_ACTION.whole_recording}</b>
        {layout.hints && <LineSentence>{segments.length === 0 ? `This slide has ${countLabel(ranges.length, "range")}.` : segments.length === 1 ? "The segment above the track is where this slide is discussed."
          : separate(segments) ? `The ${segments.length} segments above the track are where this slide is discussed.` : "The segments above the track are where this slide is discussed; some overlap."}</LineSentence>}
        <span className="min-w-2 flex-1" />
        {wholeToggle}
        {rangesButton}
      </>
    );
  } else if (mode === "candidate" && candidate) {
    line = (
      <>
        {stopped ? <b className="ll-nb flex-none font-semibold" data-testid="stopped-line">Stopped at the end of this candidate</b>
          : <><b className="ll-num ll-nb flex-none font-semibold" data-testid="range-times">{timeSpanLabel(candidate.start_ms, candidate.end_ms)}</b>
            {!layout.stacked && <BasisLabel basis="suggested" className="min-w-0 text-ink"><span className="block truncate">{CANDIDATE_WORDS}</span></BasisLabel>}</>}
        <span className="min-w-2 flex-1" />
        {list(listButton(layout.stacked ? "Candidates" : R2_ACTION.show_candidates, layout.stacked ? "Hide" : "Hide candidates"))}
      </>
    );
  } else {
    // No range: the one line of the page's state and its one action.
    const name = (layout.hints ? noLine?.name : noLine?.brief) ?? (legacy ? "No recording range" : "No recording range is listed");
    const sentence = noLine?.sentence ?? (legacy ? "No reviewed or suggested interval links this slide to the recording. No start time is guessed." : "No range came for this page, and no reason was stated.");
    const act = noLine?.action ?? "open_whole_recording";
    line = (
      <>
        {layout.hints ? <><b className="ll-nb flex-none font-semibold">{name}</b><LineSentence name={name}>{sentence}</LineSentence></>
          : <LineSentence strong full={`${noLine?.name ?? name}. ${sentence}`}>{name}</LineSentence>}
        <span className="min-w-2 flex-1" />
        {act === "next_content" ? (onNextContent && action(R2_ACTION.next_content, onNextContent, <SkipForward aria-hidden />))
          : act === "show_candidates" ? list(<ToolbarButton size="sm" className={cn(LINE_BUTTON, LINE_PAD, "font-semibold text-accent-text")} data-testid="no-range-action">{listOpen ? "Hide candidates" : R2_ACTION.show_candidates}</ToolbarButton>)
            : mode !== "opened" ? action(R2_ACTION.open_whole_recording, () => setOpened(lectureKey))
              : !legacy && <ToolbarButton size="sm" aria-pressed className={LINE_BUTTON} onClick={toggleWhole} data-testid="whole-toggle">{R2_ACTION.whole_recording}</ToolbarButton>}
      </>
    );
  }
  const noRangeShown = mode === "idle" || mode === "opened";

  return (
    <section ref={bar} aria-label="Recording" className={cn(shell, layout.stacked && "py-px")} data-testid="transport" data-mode={mode}>
      <span ref={setOwnHost} hidden />
      {clip.element}
      {clip.error ? (
        <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2", tall)} data-testid="transport-error">
          <p className="ll-err min-w-0 flex-1"><ErrorGlyph /><span className="font-normal"><b className="font-semibold">The recording could not be played.</b> {clip.error} The recording file itself was not changed; the slides can be read as usual.</span></p>
          <Button size="sm" onClick={clip.reload}>Try again</Button>
        </div>
      ) : (
        <>
          <div className={cn("grid items-center gap-x-3 px-2", layout.stacked ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto_auto]")} data-testid="transport-row">
            {layout.stacked ? <>{track}{time}{controls}<div className="justify-self-end">{tools}</div></> : <>{controls}{track}{time}{tools}</>}
          </div>
          <div ref={lineRef} className={cn("flex min-w-0 items-center gap-3 overflow-x-clip pl-2.5 pr-2 text-ui", layout.stacked ? "h-10 gap-2 pb-2" : cn(ROW_2, "pb-1.5"))} data-testid={noRangeShown ? "no-range-line" : "range-line"}
            data-state={noRangeShown ? noRange?.state ?? "none" : undefined}>
            {line}
          </div>
        </>
      )}
    </section>
  );
}
