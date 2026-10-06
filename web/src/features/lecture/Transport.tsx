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
// A page without a range shows exactly one line of its no-range state with at most one action (9.5). The play disc is
// never dead while the recording can be read (fix round of 2026-10-06, amending 5.5 and 9.5): on such a page Play opens
// the whole recording and plays it from where the player stands; only "Recording unavailable" draws no control. A
// lecture view of an older Brain (no `ranges`) keeps its timed links, shown as ranges, and plays the whole recording.
//
// The range line is ONE line and never ends in an ellipsis: what does not fit is given up whole, in a fixed order (a
// sentence for a shorter one, then for none), and what was given up opens in full from the line.
//
// Where the player stood (page, selection, time, Repeat) is kept on this device (./ClipPlayer `StoredPosition`) and put
// back, paused, when the same page of the lecture is opened again.
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { DropdownMenu, Popover } from "radix-ui";
import { MediaMuteButton, MediaSeekBackwardButton, MediaSeekForwardButton, MediaVolumeRange } from "media-chrome/react";
import { Check, ChevronLeft, ChevronRight, Ellipsis, Info, Pause, Play, Repeat, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { ErrorGlyph } from "@/components/glyphs";
import { BasisLabel } from "@/components/labels";
import { Button, cn, IconButton, ToolbarButton } from "@/components/ui";
import {
  NBSP, NO_RANGE_LINE, R2_ACTION, RANGE_RELATION_LABEL, TOPIC_DISCUSSION_SENTENCE, clockLabel, countLabel, nb, rangeSupportLine, timeSpanLabel, unlistedLabel, type NoRangeActionId,
} from "@/lib/labels";
import { identityOf, isStructuralPage, noRangeDetail, noRangeSentence, rangesForPage } from "@/lib/r2";
import type { LectureView, NoRange, Occurrence, RecordingView, TimingRange } from "@/lib/types";
import { readStoredPosition, useClipPlayer, writeStoredPosition, type ClipBounds, type StoredPosition } from "./ClipPlayer";
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

/**
 * How much of the lecture's recording has speech timing, for a page whose talk was looked for in that part only: the
 * processed stretches of the state's own detail and the lengths of the recordings they belong to; failing that, the one
 * coverage figure the Brain stated, of a recording whose length is known. null when neither is known: no figure is
 * made up. Said as two times ("2:22 of 2:30"), never as a percentage (design principle 6).
 */
export function processedSpan(noRange: NoRange, recordings: ReadonlyArray<Pick<RecordingView, "source_id" | "duration_ms">>): { coveredMs: number; totalMs: number } | null {
  if (noRange.state !== "audio_unprocessed") return null;
  const detail = noRange.detail ?? {};
  const processed = Array.isArray(detail.processed) ? detail.processed.filter((entry) => Array.isArray(entry) && entry.length === 3 && typeof entry[1] === "number" && typeof entry[2] === "number" && entry[2] > entry[1]) : [];
  const ids = new Set(processed.map((entry) => String(entry[0])));
  const lengths = recordings.filter((recording) => ids.has(recording.source_id)).map((recording) => recording.duration_ms);
  if (processed.length && lengths.length === ids.size && lengths.every((length): length is number => typeof length === "number" && length > 0)) {
    const totalMs = lengths.reduce((sum, length) => sum + length, 0);
    return { coveredMs: Math.min(totalMs, processed.reduce((sum, entry) => sum + (entry[2] - entry[1]), 0)), totalMs };
  }
  const stated = (detail.coverage ?? []).filter((row) => typeof row.coverage_fraction === "number");
  const length = stated.length === 1 ? recordings.find((recording) => recording.source_id === stated[0]!.recording_source_id)?.duration_ms : null;
  if (typeof length !== "number" || !(length > 0)) return null;
  return { coveredMs: Math.round(Math.min(1, Math.max(0, stated[0]!.coverage_fraction!)) * length), totalMs: length };
}
/**
 * "2:22 of 2:30", held on one line. Both times are whole seconds counted down, as the Brain writes them in its own
 * sentence ("Timing covers 2:22 of the recording's 2:30"), so the line and the sentence it opens never differ by a
 * second, and a part under the whole never reads as the whole. null when the two cannot be told apart to the second.
 */
function partOfWhole(span: { coveredMs: number; totalMs: number }): string | null {
  if (!(span.coveredMs < span.totalMs)) return null;
  const seconds = (ms: number): string => clockLabel(Math.floor(ms / 1000) * 1000);
  return seconds(span.coveredMs) === seconds(span.totalMs) ? null : nb(`${seconds(span.coveredMs)} of ${seconds(span.totalMs)}`);
}

export interface NoRangeLine {
  /** The state's name: semibold, first on the line. */
  name: string;
  /** The name for a bar too narrow for it: the same fact without its figures. */
  brief: string;
  /** A second clause short enough for a bar of 560 px, said from the state and its detail alone; "" when the state has none. */
  short: string;
  /** The Brain's own sentence, verbatim: shown when it fits, and always what opens in full. */
  sentence: string;
  action: NoRangeActionId | null;
}
/**
 * The one line of a page without a range (9.5): the state's name, then its sentence, and at most one action. The
 * sentence is the Brain's own when the bar has room for it, else the short clause, else nothing; it is never cut.
 * When part of the recording was transcribed and nothing for the page was found in it, "audio not processed yet" would
 * be untrue as a name: the line then says that it was not found in the transcribed part, and how long that part is.
 */
export function noRangeLine(noRange: NoRange, recordings: ReadonlyArray<Pick<RecordingView, "source_id" | "duration_ms">> = []): NoRangeLine {
  const row = (NO_RANGE_LINE as Record<string, { label: string; action: NoRangeActionId | null } | undefined>)[noRange.state];
  const state = String(noRange.state);
  const detail = noRangeDetail(noRange);
  let name = row?.label ?? unlistedLabel(state).replace(/^./, (first) => first.toUpperCase());
  let brief = name;
  let short = "";
  switch (noRange.state) {
    case "not_discussed":
      short = "No talk about this slide was found.";
      break;
    case "audio_unprocessed":
      if (detail.reason === "transcript_lines_without_time") {
        name = brief = "Not found among the timed lines";
        short = "Some transcript lines have no time yet.";
      } else if (detail.coveredIntervals.length > 0) {
        const span = processedSpan(noRange, recordings);
        const times = span ? partOfWhole(span) : null;
        name = times ? `Not found in the transcribed ${times}` : "Not found in the transcribed part of the recording";
        brief = "Not found in the transcribed part";
        short = "The rest has no speech timing yet.";
      } else short = "This recording has no speech timing yet.";
      break;
    case "association_not_run": {
      const cause = detail.cause === "stale" ? "inputs_changed" : detail.cause;
      short = cause === "not_run" ? "Slide matching has not run yet." : cause === "inputs_changed" ? "Its inputs changed since slide matching ran."
        : cause === "no_adequate_method" ? "No adequate matching method is available." : "Slide matching has not run with the current inputs.";
      break;
    }
    case "ambiguous":
      short = `${detail.candidates.length ? countLabel(detail.candidates.length, "candidate") : "Several candidates"}, none clear enough to show.`;
      break;
    case "no_range_expected":
      short = "No recording range is expected here.";
      break;
    default:
      break;
  }
  return { name, brief, short, sentence: row ? noRangeSentence(noRange) : (noRange as { text?: string }).text ?? "", action: row?.action ?? null };
}

/**
 * A lecture whose session the course's index does not link, offered to it only because a recording or transcript file
 * name carries its number (`session_link` "suggested_by_file_name", r2-read-api 1.4): every range of the lecture rests
 * on that suggestion, and the screen says so where the recording is named. null for every other lecture.
 */
export function sessionLinkNote(lecture: Pick<LectureView, "session_link">): { short: string; sentence: string; full: string } | null {
  if (lecture.session_link !== "suggested_by_file_name") return null;
  const evidence = (lecture as { session_link_evidence?: { files?: unknown } | null }).session_link_evidence;
  const files = Array.isArray(evidence?.files) ? evidence.files.filter((file): file is string => typeof file === "string" && file.trim() !== "") : [];
  return {
    short: "recording offered by its file name",
    sentence: "The recording was offered to this lecture by its file name.",
    full: `The recording was offered to this lecture by its file name${files.length ? ` (${files.join(", ")})` : ""}; the course's index does not link it. Every range of this lecture rests on that suggestion.`,
  };
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
/** A window under 900 px is pressed with a finger: the buttons of the first row are 44 px there (36 elsewhere). */
const TOUCH = "max-[899px]:h-11 max-[899px]:min-w-11";
/** Media Chrome's own buttons, drawn as the app's icon button: 36 square (44 under 900 px), bare, a pad on hover, the app's focus ring. */
const MC_BUTTON = [
  "size-9 max-[899px]:size-11 flex-none rounded-control [--media-control-background:transparent] [--media-control-hover-background:var(--ll-pad)] [--media-control-padding:6px] [--media-control-height:24px]",
  "[--media-icon-color:var(--ll-text)] [--media-primary-color:var(--ll-text)] [--media-focus-box-shadow:0_0_0_2px_var(--ll-surface-raised),0_0_0_4px_var(--ll-focus)]",
].join(" ");
/** A sentence of the range line: whole or not there. It is never cut for the eye: while it is cut, the line gives it up (`useFit`). */
const SENTENCE = "min-w-0 overflow-hidden whitespace-nowrap text-muted";
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
 * How much the range line has to give up to stay whole: 0 nothing; then, one step at a time, while whatever of it is
 * marked `data-fit` is cut (a part marked "wrap" may take two lines and is cut when it needs a third), or the line
 * itself runs over. `key` names what the line holds and how wide it is; a new key starts again from nothing given up.
 * Measured before paint, so no cut line is ever shown.
 */
function useFit(ref: RefObject<HTMLElement | null>, key: string, steps: number): number {
  const [state, setState] = useState({ key, given: 0 });
  const given = state.key === key ? state.given : 0;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const cut = node.scrollWidth > node.clientWidth + 1
      || [...node.querySelectorAll<HTMLElement>("[data-fit]")].some((part) => part.scrollWidth > part.clientWidth + 1 || (part.dataset.fit === "wrap" && part.scrollHeight > part.clientHeight + 2));
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
 * What the line had no room for, in full, on request. The trigger is the text that stayed on the line, marked with an
 * "i"; `full` is what opens (the state's name, the Brain's sentence verbatim, what the recording rests on).
 */
function InFull({ label, className, children, content, fit, anchor }: { label: string; className?: string; children: ReactNode; content: ReactNode; fit?: "wrap"; anchor: RefObject<HTMLElement | null> }) {
  return (
    <Popover.Root>
      {/* It opens over the slide, from the bar's top edge: the controls of the bar stay in sight and in reach. */}
      <Popover.Anchor virtualRef={anchor as RefObject<HTMLElement>} />
      <Popover.Trigger className={cn("cursor-pointer rounded-thumb border-0 bg-transparent p-0 text-left text-ui hover:[&_svg]:text-ink", className)} aria-label={`Read in full: ${label}`} data-fit={fit}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} className="ll-pop z-50 max-w-[min(92vw,34rem)] p-3 text-ui" data-testid="range-line-full">{content}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** What the bar remembers: the position to put back, and the last one to keep. */
interface Memory {
  key: string;
  /** The stored position of this page, until it has been put back (or could not be). */
  want: StoredPosition | null;
  /** The render in which the selection it names was asked for (the player follows a selection first); null before. */
  asked: number | null;
  /** Nothing is written before the stored position has been put back: the cue of a fresh page must not replace it. */
  saving: boolean;
  /** The bar was taken down: what the element reports while it goes is not a position. */
  closed: boolean;
  last: StoredPosition | null;
  wrote: number;
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
  const [listPlace, setListPlace] = useState<{ side: "top" | "bottom"; room: number | null }>({ side: "top", room: null });
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
  // "idle": a page without a range whose whole recording is not open. Nothing is selected, but Play is never dead: it opens the whole recording.
  const mode: "unavailable" | "range" | "whole" | "candidate" | "opened" | "idle" = unavailable ? "unavailable" : selected ? "range" : ranges.length ? "whole" : candidate ? "candidate" : wholeOpen ? "opened" : "idle";
  const live = mode !== "unavailable" && mode !== "idle";

  const bounds = useMemo<ClipBounds | null>(() => (selected
    ? { id: selected.range_id, start_ms: selected.start_ms, end_ms: selected.end_ms, recording_source_id: selected.recording.source_id }
    : candidate ? { id: candidateId(candidate), start_ms: candidate.start_ms, end_ms: candidate.end_ms, recording_source_id: candidate.recording_source_id ?? null } : null),
  [selected, candidate]);

  // ---- where the learner was: read once per lecture, before anything is cued ------------------------------------------------
  const memory = useRef<Memory | null>(null);
  if (memory.current === null || memory.current.key !== lectureKey) {
    const held = readStoredPosition(lectureKey);
    const want = held && held.page === page ? held : null;
    memory.current = { key: lectureKey, want, asked: null, saving: !want, closed: false, last: null, wrote: 0 };
  }
  const renders = useRef(0);
  renders.current += 1;
  const now = useRef({ page, chosen, wholeOpen, repeat: false, recording: null as string | null });
  const remember = useCallback((ms: number, playing: boolean) => {
    const held = memory.current;
    if (!held || !held.saving || held.closed || !Number.isFinite(ms)) return;
    const at = now.current;
    held.last = { page: at.page, selection: at.chosen, whole: at.wholeOpen, recording: at.recording, ms: Math.max(0, Math.round(ms)), repeat: at.repeat, saved_at: Date.now() };
    // While it plays a second is exact enough; a pause, a seek or a new selection is written at once.
    if (!playing || held.last.saved_at - held.wrote >= 1_000) {
      writeStoredPosition(held.key, held.last);
      held.wrote = held.last.saved_at;
    }
  }, []);

  const leave = useRef<() => void>(() => undefined);
  const clip = useClipPlayer({
    host, recordings: lecture.recordings, bounds, pageKey,
    onTime: (ms, playing) => {
      onTime(ms, playing);
      remember(ms, playing);
    },
    onLeftRange: () => leave.current(),
    onStopped: () => announce?.("Stopped at the end of this range."),
  });
  leave.current = () => {
    if (selected) select(WHOLE_RECORDING);
    setHeard(null);
    setOpened(lectureKey);
  };
  now.current = { page, chosen, wholeOpen, repeat: clip.repeat, recording: clip.recording?.source_id ?? null };

  // Put the stored position back, paused: first the selection it names (the player follows a selection by cueing its
  // start), then the time inside it. A range that is no longer listed, or another recording, is not forced.
  const putBack = (): void => {
    const held = memory.current;
    const want = held?.want;
    if (!held || !want) return;
    const done = (restore: boolean): void => {
      held.want = null;
      held.saving = true;
      if (!restore || (want.recording && clip.recording && want.recording !== clip.recording.source_id)) return;
      clip.seek(want.ms);
      if (want.repeat && selected) clip.setRepeat(true);
    };
    if (unavailable) {
      done(false);
    } else if (ranges.length > 0) {
      const target = want.selection === WHOLE_RECORDING ? WHOLE_RECORDING : ranges.some((range) => range.range_id === want.selection) ? want.selection : null;
      if (target === null) done(false);
      else if (target === chosen) done(true);
      else if (held.asked === null) {
        held.asked = renders.current;
        select(target); // this runs again once the selection has come back
      } else if (held.asked !== renders.current) done(false); // it was asked for and not taken: nothing is forced
    } else if (want.whole && !wholeOpen) {
      if (held.asked === null) {
        held.asked = renders.current;
        setOpened(lectureKey);
      } else if (held.asked !== renders.current) done(true);
    } else done(true);
  };
  useEffect(() => {
    putBack();
  });
  // A new selection, Repeat or the whole recording opened: kept at once. Leaving the page of the app, or the tab: the last position is written.
  useEffect(() => {
    remember(clip.currentMs(), clip.isPlaying());
  }, [remember, clip.currentMs, clip.isPlaying, pageKey, chosen, wholeOpen, clip.repeat]);
  useLayoutEffect(() => {
    const held = memory.current;
    if (!held) return;
    held.closed = false;
    const write = () => {
      if (held.saving && !held.closed && held.last) writeStoredPosition(held.key, held.last);
    };
    window.addEventListener("pagehide", write);
    return () => {
      window.removeEventListener("pagehide", write);
      write();
      held.closed = true;
    };
  }, [lectureKey]);

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

  // Where the list opens. Beside the context panel it lies over the slide and nothing else: it gets the room between
  // the top of the stage's content and the bar. With one pane at a time it opens in the free area under the bar when
  // that holds it, so the slide stays in sight while a range is chosen.
  const openList = (open: boolean) => {
    if (open && bar.current) {
      const rect = bar.current.getBoundingClientRect();
      // The nearest ancestor that holds something above the bar is the block of the slide and the bar.
      let above = 0;
      for (let parent = bar.current.parentElement, depth = 0; parent && depth < 4 && above <= 120; parent = parent.parentElement, depth += 1) above = rect.top - parent.getBoundingClientRect().top;
      // The nearest ancestor that scrolls or clips is the pane: what it leaves under the bar is free.
      let below = 0;
      if (frame.arrangement === "panes") {
        for (let parent = bar.current.parentElement; parent; parent = parent.parentElement) {
          const overflow = window.getComputedStyle(parent).overflowY;
          if (overflow === "visible" && parent.parentElement) continue;
          below = Math.min(parent.getBoundingClientRect().bottom, window.innerHeight) - rect.bottom;
          break;
        }
      }
      setListPlace(below >= 200 ? { side: "bottom", room: Math.floor(below) - 16 } : { side: "top", room: above > 120 ? Math.floor(above) - 8 : null });
    }
    setListOpen(open);
  };
  // `play`: a row of the list was pressed, which plays the range to its end (UI contract R2). The stepper of the line
  // only moves: the recording goes on when it was playing and stays paused when it was not.
  const choose = (next: string, play = false) => {
    clip.keepPlaying(play);
    setHeard(null);
    if (next === chosen && selected) {
      clip.seek(selected.start_ms); // the chosen range again: back to its start
      if (play) clip.play();
    } else select(next);
  };
  const hear = (id: string, play = false) => {
    clip.keepPlaying(play);
    if (candidate && candidateId(candidate) === id) {
      clip.seek(candidate.start_ms);
      if (play) clip.play();
    } else setHeard({ key: pageKey, id });
  };
  const toggleWhole = () => {
    clip.keepPlaying();
    if (mode === "range") select(WHOLE_RECORDING);
    else if (mode === "whole") select((lastRange.current?.key === pageKey ? ranges.find((range) => range.range_id === lastRange.current!.id) : null)?.range_id ?? (pageRanges.selectedDefault ?? ranges[0])!.range_id);
    else if (mode === "candidate") {
      setHeard(null);
      setOpened(lectureKey);
    } else if (mode === "opened" && !legacy) {
      clip.pause(); // nothing is selected on this page once the whole recording is closed
      setOpened(null);
    } else setOpened(lectureKey);
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
  const note = useMemo(() => sessionLinkNote(lecture), [lecture]);
  const kind = selected ? rangeKindParts(selected) : null;
  const applies = selected ? (structural ? TOPIC_DISCUSSION_SENTENCE : rangeSupportLine(selected.support, identity.position?.kind ?? null).short) : null;
  const stopped = clip.stoppedAtEnd && (mode === "range" || mode === "candidate");
  const canRepeat = mode === "range" || mode === "candidate";
  const noRangeShown = mode === "idle" || mode === "opened";
  const act = noLine?.action ?? "open_whole_recording";
  // On a page without a range the Whole recording toggle stands on the line beside the one action of the state; where
  // that action is "Open whole recording" the two are one control: the action until it is pressed, the toggle (on) after.
  const noRangeToggle = noRangeShown && (mode === "opened" ? !legacy : act !== "open_whole_recording");
  const fullSentence = noLine?.sentence ?? (legacy ? "No reviewed or suggested interval links this slide to the recording. No start time is guessed." : "No range came for this page, and no reason was stated.");
  const wholeSays = mode !== "whole" ? [] : (() => {
    const count = segments.length;
    const long = count === 0 ? `This slide has ${countLabel(ranges.length, "range")}.` : count === 1 ? "The segment above the track is where this slide is discussed."
      : separate(segments) ? `The ${count} segments above the track are where this slide is discussed.` : "The segments above the track are where this slide is discussed; some overlap.";
    const short = count === 0 ? "" : count === 1 ? "1 segment marks this slide." : separate(segments) ? `${count} segments mark this slide.` : "Segments mark this slide; some overlap.";
    return (note ? [`${long} ${note.sentence}`, note.sentence] : [long, short]).filter(Boolean);
  })();

  // What the line gives up to stay whole, in this order, one step at a time. The widths of 5.5 say what a bar starts
  // with; a line that still does not fit (long times, a stepper, large text, a long sentence) gives up the next thing
  // of its list. A sentence is given up for a shorter one and then for none: it is never cut, and never ends in "…".
  const order: string[] = [];
  if (mode === "range") {
    if (stopped) {
      if (measured.method) order.push("goOn", "long");
      if (!measured.stacked) order.push("again");
    } else if (clip.repeat) {
      if (measured.hints) order.push("say0", "say1");
      if (measured.wholeToggle) order.push("whole");
    } else {
      if (measured.applies && applies) order.push("applies");
      if (measured.method && kind?.method) order.push("method");
      if (measured.method && note) order.push("note");
      if (measured.wholeToggle) order.push("whole");
    }
    if (ranges.length > 1) order.push("of");
    if (!stopped) order.push("kind");
  } else if (mode === "whole") {
    if (measured.hints) wholeSays.forEach((_, at) => order.push(`say${at}`));
    if (measured.wholeToggle) order.push("whole");
  } else if (mode === "candidate") {
    if (!measured.stacked) order.push("words");
  } else if (noRangeShown) {
    if (measured.hints) {
      order.push("sentence");
      if (noLine?.short && noLine.short !== fullSentence) order.push("short");
    }
    if (noRangeToggle && measured.wholeToggle) order.push("whole");
    order.push("name");
  }
  const given = useFit(lineRef, `${width}|${mode}|${bounds?.id ?? ""}|${ranges.length}|${stopped}|${clip.repeat}|${listOpen}|${noRange?.state ?? ""}|${order.join()}`, order.length);
  /** Still on the line: it is something this line can hold, and it has not been given up. */
  const kept = (what: string): boolean => order.indexOf(what) >= given;
  const layout = measured;
  const wholeOnLine = mode === "range" ? !stopped && kept("whole") : mode === "whole" ? kept("whole") : noRangeToggle && kept("whole");
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
  // The disc is live whenever the recording can be read. With nothing selected it opens the whole recording and plays
  // it from where the player stands; nothing ever starts without this press.
  const open = () => {
    if (mode === "idle") setOpened(lectureKey);
  };
  const disc = (
    <button type="button" onClick={() => { open(); clip.toggle(); }} aria-label={playLabel(clip.playing, bounds)} title={playLabel(clip.playing, bounds)} data-testid="play-toggle"
      className="mr-1.5 grid size-10 flex-none cursor-pointer place-items-center rounded-full border-0 bg-accent text-on-accent transition-colors duration-[var(--ll-motion-small)] hover:bg-accent-hover max-[899px]:size-11 min-[1920px]:size-11">
      {clip.playing ? <Pause aria-hidden className="size-5" fill="currentColor" strokeWidth={0} /> : <Play aria-hidden className="size-5 translate-x-px" fill="currentColor" strokeWidth={1.5} />}
    </button>
  );
  const controls = (
    <div className={cn("flex items-center gap-0.5", layout.stacked ? "h-12" : ROW_1)} data-testid="transport-controls">
      {disc}
      <span id={backName} hidden>Back 10 seconds</span>
      <span id={forwardName} hidden>Forward 10 seconds</span>
      {/* A press on a seek button with nothing selected is the learner asking for the recording: it opens too. */}
      <span className="contents" onClickCapture={open}>
        <MediaSeekBackwardButton mediaController={clip.controllerId ?? undefined} seekOffset={10} noTooltip aria-labelledby={backName} title="Back 10 seconds" className={MC_BUTTON} />
        <MediaSeekForwardButton mediaController={clip.controllerId ?? undefined} seekOffset={10} noTooltip aria-labelledby={forwardName} title="Forward 10 seconds" className={MC_BUTTON} />
      </span>
    </div>
  );
  const track = (
    <Scrubber className={layout.stacked ? "h-9 pt-2" : ROW_1} min={trackMin} max={trackMax} value={clip.positionMs} bounded={!!bounds} idle={!live} segments={segments}
      label={bounds ? "Position in the selected range" : "Position in the whole recording"} valueText={scrubberValueText(clip.positionMs, bounds, clip.durationMs)} onSeek={clip.seek} />
  );
  // Where the player stands, also while nothing is selected: Play goes on from there.
  const standsAt = trackMax > trackMin ? Math.min(Math.max(clip.positionMs, trackMin), trackMax) : Math.max(clip.positionMs, 0);
  const time = (
    <p className={cn("ll-num whitespace-nowrap text-ui text-muted", layout.stacked && "pr-2 pt-2")} data-testid="time-readout">
      <b className={cn("font-semibold", live && "text-ink")}>{clockLabel(standsAt)}</b>
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
          <DropdownMenu.Trigger asChild><ToolbarButton className={cn("ll-num justify-center px-2", TOUCH)} aria-label={`Playback speed, ${rateLabel(clip.rate)}`} title="Playback speed" data-testid="speed-button">{rateLabel(clip.rate)}</ToolbarButton></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content side="top" align="end" sideOffset={6} className={cn(MENU, "min-w-[7rem]")} data-testid="speed-menu">{speedItems}</DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {layout.volume && (
        <Popover.Root>
          <Popover.Trigger asChild><IconButton label="Volume" className={TOUCH}><VolumeIcon aria-hidden /></IconButton></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="top" align="center" sideOffset={6} aria-label="Volume" className="ll-pop z-50 flex items-center gap-1 p-1.5" data-testid="volume-popover">
              <MediaMuteButton mediaController={clip.controllerId ?? undefined} noTooltip className={MC_BUTTON} />
              <MediaVolumeRange {...(clip.controllerId ? ({ mediacontroller: clip.controllerId } as object) : {})}
                className="h-9 w-36 rounded-control [--media-control-background:transparent] [--media-control-hover-background:transparent] [--media-range-bar-color:var(--ll-accent-text)] [--media-range-padding:8px] [--media-range-thumb-background:var(--ll-accent-text)] [--media-range-thumb-height:14px] [--media-range-thumb-width:14px] [--media-range-track-background:var(--ll-border)] [--media-range-track-height:3px] [--media-focus-box-shadow:0_0_0_2px_var(--ll-focus)]" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <IconButton label="Repeat this range" className={TOUCH} aria-pressed={canRepeat && clip.repeat} disabled={!canRepeat} onClick={() => clip.setRepeat(!clip.repeat)} data-testid="repeat-toggle"><Repeat aria-hidden /></IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><IconButton label="More: mark a range for this slide, correct this range" className={TOUCH} data-testid="transport-more-button"><Ellipsis aria-hidden /></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="end" sideOffset={6} className={MENU} data-testid="transport-more">
            {markable
              ? <DropdownMenu.Item className="ll-menu-item" onSelect={() => onAddMatch!()}>Mark a range for this slide</DropdownMenu.Item>
              : <DropdownMenu.Label className={cn(MENU_LABEL, "pb-2")}>A range can be marked once this device is paired and the slide and the recording are identified.</DropdownMenu.Label>}
            {selected && canCorrect(selected) && <DropdownMenu.Item className="ll-menu-item" onSelect={() => correct(selected)}>Correct this range</DropdownMenu.Item>}
            {stopped && (mode === "candidate" ? !layout.method : !kept("goOn")) && <DropdownMenu.Item className="ll-menu-item" onSelect={goOn}>Go on in the whole recording</DropdownMenu.Item>}
            {!wholeOnLine && !(mode === "idle" && act === "open_whole_recording") && (
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
  const wholeToggle = wholeOnLine && (
    <ToolbarButton size="sm" aria-pressed={wholeShown} className={lineButton(wholeShown)} onClick={toggleWhole} data-testid="whole-toggle">{R2_ACTION.whole_recording}</ToolbarButton>
  );
  // The chevron points to where the list is, or will open: up over the slide; down under the bar with one pane at a time.
  const listSide = listOpen ? listPlace.side : frame.arrangement === "panes" ? "bottom" : "top";
  const listButton = (closedLabel: ReactNode, openLabel: ReactNode) => (
    <ToolbarButton size="sm" chevron className={cn(lineButton(), "max-[899px]:min-w-11 max-[899px]:justify-center", (listSide === "bottom") === listOpen && "[&>svg:last-child]:rotate-180")} data-testid="range-list-toggle">{listOpen ? openLabel : closedLabel}</ToolbarButton>
  );
  const list = (trigger: ReactNode) => (
    <RangeList pages={identity.groupPages} ranges={ranges} candidates={candidates} selection={candidate ? candidateId(candidate) : chosen}
      onSelect={(next, how) => (next.startsWith("candidate:") ? hear(next, how?.play) : choose(next, how?.play))}
      open={listOpen} onOpenChange={openList} room={listPlace.room} side={listPlace.side} trigger={trigger} anchor={bar} recordings={lecture.recordings} groupKind={identity.position?.kind ?? null} structural={structural}
      note={note?.full ?? null}
      onMarkRange={onAddMatch ? () => { setListOpen(false); onAddMatch(); } : undefined} onCorrectRange={ranges.some(canCorrect) ? correct : undefined} onOpenTranscriptLines={onOpenTranscriptLines} />
  );
  const rangesButton = list(listButton(
    ranges.length === 1 ? (layout.stacked ? "Details" : "Range details") : layout.stacked ? `All${NBSP}${ranges.length}` : `All${NBSP}${countLabel(ranges.length, "range")}`,
    layout.stacked ? "Hide" : "Hide ranges",
  ));
  const action = (label: string, onClick: () => void, icon?: ReactNode) => (
    <ToolbarButton size="sm" icon={icon} className={cn(LINE_BUTTON, LINE_PAD, "font-semibold text-accent-text")} onClick={onClick} data-testid="no-range-action">{label}</ToolbarButton>
  );
  const say = (options: readonly string[]): string | null => options.find((_, at) => kept(`say${at}`)) ?? null;

  let line: ReactNode;
  if (mode === "range" && selected && kind) {
    const repeats = clip.repeat && !stopped ? say(["Repeats this range until you turn it off", "Repeating"]) : null;
    line = (
      <>
        {ranges.length > 1 && (
          <span className="inline-flex flex-none items-center gap-0.5 whitespace-nowrap" data-testid="range-stepper">
            <IconButton size="sm" label="Previous range" disabled={index <= 0} onClick={() => choose(ranges[index - 1]!.range_id)}><ChevronLeft aria-hidden /></IconButton>
            <span className="ll-num ll-nb">{!layout.stacked && `Range${NBSP}`}<b className="font-semibold">{index + 1}</b>{kept("of") ? `${NBSP}of${NBSP}${ranges.length}` : <span className="sr-only"> of {ranges.length}</span>}</span>
            <IconButton size="sm" label="Next range" disabled={index >= ranges.length - 1} onClick={() => choose(ranges[index + 1]!.range_id)}><ChevronRight aria-hidden /></IconButton>
          </span>
        )}
        {stopped ? (
          <>
            <b className="ll-nb flex-none font-semibold" data-testid="stopped-line">{kept("long") ? "Stopped at the end of this range" : "Stopped at the end"}</b>
            {kept("again") && <ToolbarButton size="sm" className={lineButton()} onClick={clip.play}>Play it again</ToolbarButton>}
            {kept("goOn") && <ToolbarButton size="sm" className={lineButton()} onClick={goOn}>Go on in the whole recording</ToolbarButton>}
          </>
        ) : (
          <>
            <b className="ll-num ll-nb flex-none font-semibold" data-testid="range-times">{selected.relation === "displayed_during" ? `${RANGE_RELATION_LABEL.displayed_during} ` : ""}{timeSpanLabel(selected.start_ms, selected.end_ms)}</b>
            <BasisLabel basis={rangeBasis(selected)} className="min-w-0 flex-shrink-0 whitespace-nowrap text-ink">{kept("kind")
              ? <span className="block" data-fit="">{kind.label}{kind.method && kept("method") ? ` (${kind.method})` : ""}</span> : <span className="sr-only">{kind.label}</span>}</BasisLabel>
            {repeats && <span className={SENTENCE} data-fit="">{repeats}</span>}
            {!clip.repeat && (kept("applies") || kept("note")) && (
              <span className={SENTENCE} data-fit="">{kept("applies") && <><span aria-hidden>· </span>{applies}</>}{kept("note") && <><span aria-hidden> · </span>{note!.short}</>}</span>
            )}
          </>
        )}
        <span className="min-w-2 flex-1" />
        {wholeToggle}
        {rangesButton}
      </>
    );
  } else if (mode === "whole") {
    const says = say(wholeSays);
    line = (
      <>
        <b className="ll-nb flex-none font-semibold">{R2_ACTION.whole_recording}</b>
        {says && <span className={SENTENCE} data-fit="">{says}</span>}
        <span className="min-w-2 flex-1" />
        {wholeToggle}
        {rangesButton}
      </>
    );
  } else if (mode === "candidate" && candidate) {
    line = (
      <>
        {stopped ? <b className="ll-nb flex-none font-semibold" data-testid="stopped-line">{layout.stacked ? "Stopped at the end" : "Stopped at the end of this candidate"}</b>
          : <><b className="ll-num ll-nb flex-none font-semibold" data-testid="range-times">{timeSpanLabel(candidate.start_ms, candidate.end_ms)}</b>
            <BasisLabel basis="suggested" className="min-w-0 flex-shrink-0 whitespace-nowrap text-ink"><span className="block" data-fit="">{kept("words") ? CANDIDATE_WORDS : "Candidate"}</span></BasisLabel></>}
        <span className="min-w-2 flex-1" />
        {list(listButton(layout.stacked ? "Candidates" : R2_ACTION.show_candidates, layout.stacked ? "Hide" : "Hide candidates"))}
      </>
    );
  } else {
    // No range: the one line of the page's state and its one action. The name always stands; its sentence is the
    // Brain's own when there is room for it, else the short clause, else none, and opens in full from the line.
    const fullName = noLine?.name ?? (legacy ? "No recording range" : "No recording range is listed");
    const name = kept("name") ? fullName : noLine?.brief ?? fullName;
    const second = kept("sentence") ? fullSentence : kept("short") ? noLine!.short : null;
    const more = second !== fullSentence || !!note;
    const mark = more && <Info aria-hidden className={cn("flex-none text-muted", layout.stacked ? "ml-1 inline size-3.5 align-[-2px]" : "size-4")} />;
    const words = layout.stacked
      ? <><b className="font-semibold text-ink">{name}</b>{mark}</>
      : <><b className="ll-nb flex-none font-semibold text-ink">{name}</b>{second && <span className={SENTENCE} data-fit="">{second}</span>}{mark}</>;
    // A bar under 480 px gives the name two lines of its row; a wider one keeps it on one.
    const shape = layout.stacked ? "block max-h-9 min-w-0 flex-shrink overflow-hidden whitespace-normal leading-[18px]" : "flex min-w-0 flex-shrink items-center gap-2";
    line = (
      <>
        {more
          ? <InFull anchor={bar} label={`${fullName}. ${fullSentence}`} className={shape} fit={layout.stacked ? "wrap" : undefined}
            content={<><b className="font-semibold">{fullName}.</b> {fullSentence}{note && <span className="mt-2 block text-muted">{note.full}</span>}</>}>{words}</InFull>
          : <span className={shape} data-fit={layout.stacked ? "wrap" : undefined}>{words}</span>}
        <span className="min-w-2 flex-1" />
        {act === "next_content" ? (onNextContent && action(R2_ACTION.next_content, onNextContent, <SkipForward aria-hidden />))
          : act === "show_candidates" ? list(<ToolbarButton size="sm" className={cn(LINE_BUTTON, LINE_PAD, "font-semibold text-accent-text")} data-testid="no-range-action">{listOpen ? "Hide candidates" : R2_ACTION.show_candidates}</ToolbarButton>)
            : mode !== "opened" && action(R2_ACTION.open_whole_recording, () => setOpened(lectureKey))}
        {wholeToggle}
      </>
    );
  }

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
          <div ref={lineRef} className={cn("flex min-w-0 items-center gap-3 overflow-x-clip pl-2.5 pr-2 text-ui", layout.stacked ? "h-10 gap-2 pb-1" : cn(ROW_2, "pb-1.5"))} data-testid={noRangeShown ? "no-range-line" : "range-line"}
            data-state={noRangeShown ? noRange?.state ?? "none" : undefined}>
            {line}
          </div>
        </>
      )}
    </section>
  );
}
