// The docked transport (design specification 4.4): below 1180 px a 52 px strip at the foot of every pane but Slide, so the
// ONE transport stays reachable (R2-V4). A view bound to the one player, not a second player: the disc plays and pauses
// in place; pressing the strip anywhere else opens the Slide pane, where the full bar is. Two short lines say what is
// selected and what it is; the position stands at the right; a 2 px line on the top edge shows the progress.
import { Pause, Play } from "lucide-react";
import { R2_ACTION, clockLabel, timeSpanLabel } from "@/lib/labels";
import { rangesForPage } from "@/lib/r2";
import type { DockedTransportProps } from "./contracts";
import { rangeKindParts } from "./RangeList";
import { noRangeLine, playLabel } from "./Transport";
import { useLectureWorkspace, type LectureWorkspaceState } from "./workspace-state";

/** The workspace the strip is drawn in, or null outside one (a story, a unit test): the strip then shows what its props say and no more. */
function useWorkspaceIfAny(): LectureWorkspaceState | null {
  try {
    return useLectureWorkspace(); // one context read on every render, with or without a workspace
  } catch {
    return null;
  }
}

export function DockedTransport({ position, range, available, onToggle, onOpenSlide, page, note, durationMs }: DockedTransportProps) {
  const state = useWorkspaceIfAny();
  if (!available) {
    return (
      <div role="group" aria-label="Recording" className="flex h-[52px] items-center border-t border-hairline bg-raised px-4 text-ui text-muted" data-testid="dock">
        No recording is linked to this lecture.
      </div>
    );
  }
  const onPage = page ?? state?.page ?? null;
  const pageRanges = state ? rangesForPage(state.lecture, state.page) : null;
  const length = durationMs ?? state?.player.current?.durationMs() ?? null;
  const span = range ? Math.max(1, range.end_ms - range.start_ms) : length;
  const progress = span ? Math.min(1, Math.max(0, (position.ms - (range?.start_ms ?? 0)) / span)) : null;
  const what = range ? timeSpanLabel(range.start_ms, range.end_ms) : R2_ACTION.whole_recording;
  // The second line: what the range is and the page it is for; without a range, why (the page's no-range state) or how many there are.
  const second = range
    ? `${rangeKindParts(range).label}${onPage ? ` for page ${onPage}` : ""}`
    : note !== undefined ? note
      : pageRanges?.noRange ? noRangeLine(pageRanges.noRange, state?.lecture.recordings ?? []).name
        : pageRanges && pageRanges.ranges.length > 0 ? `Page ${onPage} has ${pageRanges.ranges.length === 1 ? "1 range" : `${pageRanges.ranges.length} ranges`}` : null;
  const press = playLabel(position.playing, range);
  return (
    <div role="group" aria-label="Recording" className="relative grid h-[52px] grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border-t border-hairline bg-raised pl-3 pr-4" data-testid="dock">
      {progress !== null && <span aria-hidden className="absolute inset-x-0 -top-px h-0.5"><span className="block h-full bg-accent-text" style={{ width: `${progress * 100}%` }} /></span>}
      <button type="button" onClick={onToggle} aria-label={press} title={press} data-testid="dock-play"
        className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-accent text-on-accent transition-colors duration-[var(--ll-motion-small)] hover:bg-accent-hover">
        {position.playing ? <Pause aria-hidden className="size-4" fill="currentColor" strokeWidth={0} /> : <Play aria-hidden className="size-4 translate-x-px" fill="currentColor" strokeWidth={1.5} />}
      </button>
      <button type="button" onClick={onOpenSlide} data-testid="dock-open"
        aria-label={`${position.playing ? "Playing" : "Paused"} at ${clockLabel(position.ms)}${range ? ` in the range ${clockLabel(range.start_ms)} to ${clockLabel(range.end_ms)}` : " in the whole recording"}. Open the Slide pane.`}
        className="grid h-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent p-0 text-left text-ink">
        <span className="grid min-w-0">
          <b className="ll-num ll-nb text-ui font-semibold leading-[18px]">{what}</b>
          {second && <span className="truncate text-ui leading-[18px] text-muted">{second}</span>}
        </span>
        <span className="ll-num text-ui font-semibold text-accent-text">{clockLabel(position.ms)}</span>
      </button>
    </div>
  );
}
