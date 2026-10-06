// Shared state of one lecture workspace: the page on screen, the focused tab and pane, the selected range, the one
// player and how the page is fitted. The address owns page and panel (LectureWorkspace passes them in); the rest lives
// here so that the parts (outline, pager, transport, tabs) agree without passing each other around.
//
// Two contexts on purpose: the playback position changes several times a second while a recording plays, and only the
// transcript, the docked strip and the like should re-render at that pace.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { rangesForPage } from "@/lib/r2";
import type { LectureView, SlideView, TimingRange } from "@/lib/types";
import {
  LECTURE_TAB_STORAGE_KEY, WHOLE_RECORDING, isContextTab, resolvePane, resolveTab, type ContextTabId, type LecturePaneId, type LecturePlayerHandle, type PlaybackPosition,
  type RangeSelection, type SlideFit,
} from "./contracts";

export interface LectureWorkspaceState {
  courseId: string;
  lectureId: string;
  lecture: LectureView;
  /** The page on screen (physical, 1-based) and the page count (0 while unknown). */
  page: number;
  total: number;
  slide: SlideView | undefined;
  /** Go to a page. Pauses playback: a new page never plays by itself. */
  goTo: (page: number) => void;
  /** The tab of the context panel (the default-tab rule of 5.7). */
  tab: ContextTabId;
  /** The focused pane of the one-pane arrangement. */
  pane: LecturePaneId;
  showTab: (tab: ContextTabId) => void;
  showPane: (pane: LecturePaneId) => void;
  /** The selected range of this page (`range_id`) or the whole recording; a new page selects its first range. */
  selection: RangeSelection;
  selectedRange: TimingRange | null;
  selectRange: (selection: RangeSelection) => void;
  /** The one player. null while no transport is mounted. */
  player: RefObject<LecturePlayerHandle | null>;
  fit: SlideFit;
  setFit: (fit: SlideFit) => void;
  /**
   * Open the correction of this page's grouping (join with a neighbour, start a new slide here, ungroup): the More menu
   * of the pager does, and any part inside the workspace may (the Sources tab's "Correct the grouping or the role").
   * A correction is a source-map override: the learner's own, versioned record; the file is never changed.
   */
  correctGrouping: () => void;
  /** The grouping correction is open (the composition draws the dialog). */
  groupingOpen: boolean;
  closeGrouping: () => void;
}

const StateContext = createContext<LectureWorkspaceState | null>(null);
const PlaybackContext = createContext<PlaybackPosition>({ ms: 0, playing: false });
const ReportContext = createContext<(ms: number, playing: boolean) => void>(() => undefined);

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a per-device convenience only */
  }
}

export interface LectureWorkspaceProviderProps {
  courseId: string;
  lectureId: string;
  lecture: LectureView;
  page: number;
  total: number;
  /** The `panel` parameter of the address: a tab, or below 1180 px a pane. */
  panel: string | null;
  /** Writes the `panel` parameter (replacing the history entry: a tab change is not a step back). */
  onPanel: (panel: string) => void;
  /** Writes the `page` parameter. */
  onPage: (page: number) => void;
  children: ReactNode;
}

export function LectureWorkspaceProvider({ courseId, lectureId, lecture, page, total, panel, onPanel, onPage, children }: LectureWorkspaceProviderProps) {
  const player = useRef<LecturePlayerHandle | null>(null);
  const [lastTab, setLastTab] = useState<string | null>(() => stored(LECTURE_TAB_STORAGE_KEY));
  const [chosen, setChosen] = useState<{ key: string; selection: RangeSelection } | null>(null);
  const [fit, setFit] = useState<SlideFit>("page");
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [position, setPosition] = useState<PlaybackPosition>({ ms: 0, playing: false });

  const tab = resolveTab(panel, lastTab);
  const pane = resolvePane(panel);
  const slide = lecture.slides.find((entry) => entry.page === page);

  // The selection belongs to a page of a lecture: another page starts from its own first range.
  const key = `${lectureId}#${page}`;
  const ranges = useMemo(() => rangesForPage(lecture, page), [lecture, page]);
  const wanted = chosen && chosen.key === key ? chosen.selection : null;
  const selectedRange = wanted && wanted !== WHOLE_RECORDING ? ranges.ranges.find((range) => range.range_id === wanted) ?? null : wanted === WHOLE_RECORDING ? null : ranges.selectedDefault;
  const selection: RangeSelection = wanted === WHOLE_RECORDING ? WHOLE_RECORDING : selectedRange?.range_id ?? WHOLE_RECORDING;

  const goTo = useCallback((next: number) => {
    player.current?.pause();
    onPage(next);
  }, [onPage]);
  const showTab = useCallback((next: ContextTabId) => {
    store(LECTURE_TAB_STORAGE_KEY, next);
    setLastTab(next);
    onPanel(next);
  }, [onPanel]);
  const showPane = useCallback((next: LecturePaneId) => {
    if (isContextTab(next)) {
      store(LECTURE_TAB_STORAGE_KEY, next);
      setLastTab(next);
    }
    onPanel(next);
  }, [onPanel]);
  const selectRange = useCallback((next: RangeSelection) => setChosen({ key, selection: next }), [key]);
  const report = useCallback((ms: number, playing: boolean) => setPosition((current) => (current.ms === ms && current.playing === playing ? current : { ms, playing })), []);
  const correctGrouping = useCallback(() => setGroupingOpen(true), []);
  const closeGrouping = useCallback(() => setGroupingOpen(false), []);

  const state = useMemo<LectureWorkspaceState>(() => ({ courseId, lectureId, lecture, page, total, slide, goTo, tab, pane, showTab, showPane, selection, selectedRange, selectRange, player, fit, setFit,
    correctGrouping, groupingOpen, closeGrouping }),
    [courseId, lectureId, lecture, page, total, slide, goTo, tab, pane, showTab, showPane, selection, selectedRange, selectRange, fit, correctGrouping, groupingOpen, closeGrouping]);

  return (
    <StateContext.Provider value={state}>
      <ReportContext.Provider value={report}>
        <PlaybackContext.Provider value={position}>{children}</PlaybackContext.Provider>
      </ReportContext.Provider>
    </StateContext.Provider>
  );
}

export function useLectureWorkspace(): LectureWorkspaceState {
  const value = useContext(StateContext);
  if (!value) throw new Error("useLectureWorkspace must be used inside LectureWorkspaceProvider");
  return value;
}
/** Where the one player stands. Re-renders at the pace of playback: read it only where the position is shown. */
export const useLecturePlayback = (): PlaybackPosition => useContext(PlaybackContext);
/** The transport reports its position through this (stable) function. */
export const useReportPlayback = (): ((ms: number, playing: boolean) => void) => useContext(ReportContext);
