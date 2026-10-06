// Typed contracts of the parts the lecture workspace is composed of (design specification 5.1 – 5.12). Each part lives in
// its own file and is owned separately; LectureWorkspace.tsx composes them on app/WorkspaceFrame. A part receives what it
// shows and reports what the learner did; it never reads the URL and never fetches the lecture view itself.
//
// Shared state (the current page, the focused tab or pane, the selected range, the one player) is in ./workspace-state.
import type { ReactNode, RefObject } from "react";
import type { FramePane } from "@/app/WorkspaceFrame";
import type { SourceRef } from "@/lib/db";
import { CONTEXT_TABS, PANE_LABEL, type ContextTabId } from "@/lib/labels";
import type { LectureView, Occurrence, RecordingView, SlideRoleValue, SlideView, TimingRange } from "@/lib/types";

// ---- tabs and panes ----------------------------------------------------------------------------------------------------
export type { ContextTabId };
/** One focused pane below 1180 px: the slide, the outline, or one of the five tabs of the context panel (4.4). */
export type LecturePaneId = "slide" | "outline" | ContextTabId;

export const CONTEXT_TAB_IDS: readonly ContextTabId[] = CONTEXT_TABS.map((tab) => tab.id);
export const isContextTab = (value: string | null | undefined): value is ContextTabId => !!value && (CONTEXT_TAB_IDS as readonly string[]).includes(value);

/** Seven panes, in order. lib/labels words six of them; "Outline" is this file's until PANE_LABEL carries it. */
export const LECTURE_PANES: ReadonlyArray<FramePane & { id: LecturePaneId }> = [
  { id: "slide", label: PANE_LABEL.slide, zone: "stage" },
  { id: "outline", label: "Outline", zone: "outline" },
  ...CONTEXT_TABS.map((tab) => ({ id: tab.id, label: tab.label, zone: "context" as const })),
];
export const isLecturePane = (value: string | null | undefined): value is LecturePaneId => !!value && LECTURE_PANES.some((pane) => pane.id === value);

/** Where the tab last used on this device is kept (5.7). */
export const LECTURE_TAB_STORAGE_KEY = "ll.lecture.tab";
/** The tab shown first on a device that has used none (5.7). */
export const FIRST_TAB: ContextTabId = "questions";

/**
 * The tab of the context panel (5.7): the one the address names; else the one last used on this device; else Questions.
 * `panel` is the `panel` parameter of the address, which names a tab or, below 1180 px, a pane.
 */
export function resolveTab(panel: string | null | undefined, lastUsed: string | null | undefined): ContextTabId {
  if (isContextTab(panel)) return panel;
  return isContextTab(lastUsed) ? lastUsed : FIRST_TAB;
}
/** The focused pane of the one-pane arrangement: the one the address names, else the slide. */
export const resolvePane = (panel: string | null | undefined): LecturePaneId => (isLecturePane(panel) ? panel : "slide");

// ---- the one player ----------------------------------------------------------------------------------------------------
/** What the workspace can ask of the one media transport. There is one instance per lecture workspace. */
export interface LecturePlayerHandle {
  pause(): void;
  /** Play when paused, pause when playing, by the transport's own rules (a selected range starts at its start and stops at its end). */
  toggle(): void;
  /** Seek the one player. A position outside the selected range leaves the range for the whole recording. */
  seekTo(ms: number): void;
  currentMs(): number;
  isPlaying(): boolean;
  /** Length reported by the media element (null until its metadata has loaded). */
  durationMs(): number | null;
  /** The recording loaded in the player. */
  recording(): RecordingView | null;
}

/** The selected range of the page on screen: a `range_id` of `slides[].ranges`, or the whole recording. */
export type RangeSelection = string;
export const WHOLE_RECORDING: RangeSelection = "whole";

export interface PlaybackPosition {
  ms: number;
  playing: boolean;
}

/**
 * How the page is sized ("Fit page" menu, 5.3). `page`: the whole page in the stage, by the stage rule of 5.4. `width`:
 * as wide as the stage; it scrolls inside its own place. `100`, `150`, `200`: that many percent of the page's own size
 * (a PDF point is 1/72 in), panned inside its own place; the two magnifications keep the contained zoom the slide had.
 */
export type SlideFit = "page" | "width" | "100" | "150" | "200";

// ---- parts -------------------------------------------------------------------------------------------------------------
/** 5.2. The outline of the deck: one row per logical slide (lib/r2 `logicalSlides`), plain pages when no source map came. */
export interface LectureOutlineProps {
  lecture: LectureView;
  /** The page on screen (physical, 1-based). */
  page: number;
  /** Page count known so far (the view's, else pdf.js's); rows exist before the PDF has loaded. */
  pageCount: number;
  /** The PDF the thumbnails are rendered from; null when the deck cannot be displayed. */
  pdfUrl: string | null;
  onSelect: (page: number) => void;
  /** A scrolling list beside the stage, or a grid of thumbnails that fills a pane (4.4). */
  layout: "list" | "grid";
}

/** 5.3. The stage's band: paging, the identity line, the role, and the tools of the page. */
export interface PagerProps {
  lecture: LectureView;
  page: number;
  /** Page count; 0 while unknown. */
  total: number;
  onGoTo: (page: number) => void;
  /** Present when the deck can carry a note (an identified deck version). */
  onNote?: () => void;
  fit: SlideFit;
  onFit: (fit: SlideFit) => void;
  /** Focus mode: slide and bar only. */
  focus: boolean;
  onFocus: (focus: boolean) => void;
  onFinishSession: () => void;
  /** Readable text of the page (a derived rendition) is shown. */
  readable: boolean;
  onReadable?: (shown: boolean) => void;
  /** Offered when the learner chose this file among several; returns to the choice. */
  onChooseAnotherFile?: () => void;
  /** Opens the correction of this page's grouping (the dialog of the composition; `useLectureWorkspace().correctGrouping`). Absent without a source map. */
  onCorrectPage?: () => void;
  /** Records a new role for the page (a source-map override). Absent when corrections cannot be made (no source map). */
  onSetRole?: (role: SlideRoleValue) => Promise<void>;
  /** Undoes the learner's own correction of this page's role (a further revision); offered while the role is human-confirmed. */
  onTakeBackRole?: () => Promise<void>;
}

/** 5.7. The context panel: five text tabs in the band, one region under them. Tab contents stay mounted once shown. */
export interface ContextPanelProps {
  tab: ContextTabId;
  onTabChange: (tab: ContextTabId) => void;
  /** Counts shown as muted figures after a tab's label (Questions: the rows of "This slide"); 0 or undefined shows none. */
  counts?: Partial<Record<ContextTabId, number>>;
  /**
   * The content of each tab. Tutor is mounted from the start (its draft must never be lost); the others on first use.
   * A tab gets a bounded column and scrolls inside itself (TabScroll of ContextPanel.tsx, with TabFoot for a docked part).
   */
  tabs: Record<ContextTabId, ReactNode>;
  /** The address a link out of the panel returns to. */
  returnTo?: string;
}

/** 5.9. Questions: this slide, related concepts, all lecture questions, as three sections in one scroll. */
export interface QuestionsTabProps {
  courseId: string;
  lecture: LectureView;
  page: number;
  slide: SlideView | undefined;
  onGoToPage: (page: number) => void;
  /** The next page whose role forces something, for the button a structural page offers; null when there is none. */
  nextContentPage: number | null;
  /**
   * Opens the Transcript tab at these lines (a "transcript lines 120–164" citation). Optional: without it the tab
   * writes `panel=transcript&line=<start>` to the address itself, which is the same thing.
   */
  onOpenTranscriptLines?: (start: number, end: number) => void;
}

/** 5.10. Concepts of this slide, with the ways into the concept map. */
export interface ConceptsTabProps {
  courseId: string;
  lecture: LectureView;
  page: number;
  slide: SlideView | undefined;
  onGoToPage: (page: number) => void;
  nextContentPage: number | null;
  /** The address the concept map returns to ("Back to page 23"). */
  returnTo: string;
}

/** 5.5. The one transport bar under the slide. It owns the media element's behaviour and exposes the one player handle. */
export interface TransportProps {
  lecture: LectureView;
  page: number;
  slide: SlideView | undefined;
  /** The selected range of this page, or the whole recording. */
  selection: RangeSelection;
  onSelect: (selection: RangeSelection) => void;
  /** The handle is written here while the transport is mounted. */
  playerRef: RefObject<LecturePlayerHandle | null>;
  onTime: (ms: number, playing: boolean) => void;
  /** "Correct this range": an annotation the learner can revise. */
  onEditMatch?: (occurrence: Occurrence) => void;
  /** "Mark a range for this slide", with the time to start from when one is known. Absent when a link cannot be made. */
  onAddMatch?: (startMs?: number) => void;
  onNextContent?: () => void;
  announce?: (message: string) => void;
  /**
   * Opens the Transcript tab at these lines (the evidence of a range, in Qualities). Optional: without it the link
   * writes `panel=transcript&line=<start>` to the address itself, which is the same thing.
   */
  onOpenTranscriptLines?: (start: number, end: number) => void;
}

/** 5.6. Every range of the page as a radio row, opened from the bar over the stage. */
export interface RangeListProps {
  /** The pages the list is about (the page, or the pages of its group). */
  pages: number[];
  ranges: TimingRange[];
  /** The candidates of an ambiguous page ("Show candidates"): listed when the page has no range, each worded as a candidate. */
  candidates?: import("@/lib/types").NoRangeCandidate[];
  /** A `range_id`, the id of a candidate (RangeList `candidateId`), or the whole recording. */
  selection: RangeSelection;
  /** Also called for the row that is already chosen: pressing it again goes back to its start. */
  onSelect: (selection: RangeSelection) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The disclosure button in the bar. */
  trigger: ReactNode;
  /** The bar: the list opens from its top edge and is as wide as it. A press on the bar does not close the list. */
  anchor: RefObject<HTMLElement | null>;
  /** The height the list may take, in px: the room over the bar that the slide fills (never more than 440). Without it, what the window leaves. */
  room?: number | null;
  /** The lecture's recordings, to name the one a range belongs to. */
  recordings: RecordingView[];
  /** The word for a member of the page's group ("build", "step"), when the page is in one. */
  groupKind?: import("@/lib/types").GroupPositionKind | null;
  /** The page is structural: a range over it is discussion of the topic, not evidence of what was displayed. */
  structural?: boolean;
  /** "Mark a range yourself" at the foot. */
  onMarkRange?: () => void;
  /** "Correct this range" in a row's Qualities. */
  onCorrectRange?: (range: TimingRange) => void;
  onOpenTranscriptLines?: (start: number, end: number) => void;
}

/** 4.4. The strip that keeps the one transport reachable from every pane but Slide. */
export interface DockedTransportProps {
  position: PlaybackPosition;
  /** The selected range, or null for the whole recording. */
  range: TimingRange | null;
  /** False when the lecture has no playable recording: the strip then says so and has no control. */
  available: boolean;
  /** Plays and pauses in place. */
  onToggle: () => void;
  /** Pressing the strip anywhere but the disc opens the Slide pane. */
  onOpenSlide: () => void;
  /** The page on screen, for the second line ("Suggestion for page 23"). Read from the workspace when absent. */
  page?: number;
  /** The second line when no range is selected (the name of the page's no-range state). Read from the workspace when absent. */
  note?: string | null;
  /** Length of the loaded recording, for the line of progress in the whole recording. Read from the one player when absent. */
  durationMs?: number | null;
}

/** A source the learner attached to the next tutor message. */
export interface PinnedSource {
  source: SourceRef;
  label: string;
}
