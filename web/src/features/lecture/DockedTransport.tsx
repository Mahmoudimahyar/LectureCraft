// The docked transport (design specification 4.4): below 1180 px a 52 px strip at the foot of every pane but Slide, so the
// ONE transport stays reachable (R2-V4). A view bound to the one player, not a second player: the disc plays and pauses
// in place; pressing the strip anywhere else opens the Slide pane, where the full bar is.
import { Pause, Play } from "lucide-react";
import { RANGE_KIND_LABEL, R2_ACTION, clockLabel, rangeKindOf, timeSpanLabel } from "@/lib/labels";
import type { DockedTransportProps } from "./contracts";

export function DockedTransport({ position, range, available, onToggle, onOpenSlide }: DockedTransportProps) {
  if (!available) {
    return (
      <div role="group" aria-label="Recording" className="flex h-[52px] items-center border-t border-hairline bg-raised px-4 text-ui text-muted" data-testid="dock">
        No recording is linked to this lecture.
      </div>
    );
  }
  const span = range ? Math.max(1, range.end_ms - range.start_ms) : null;
  const progress = range && span ? Math.min(1, Math.max(0, (position.ms - range.start_ms) / span)) : null;
  const what = range ? timeSpanLabel(range.start_ms, range.end_ms) : R2_ACTION.whole_recording;
  return (
    <div role="group" aria-label="Recording" className="relative grid h-[52px] grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border-t border-hairline bg-raised pl-3 pr-4" data-testid="dock">
      {progress !== null && <span aria-hidden className="absolute inset-x-0 -top-px h-0.5"><span className="block h-full bg-accent-text" style={{ width: `${progress * 100}%` }} /></span>}
      <button type="button" onClick={onToggle} aria-label={position.playing ? "Pause" : range ? `Play the range ${what}` : "Play the whole recording"} data-testid="dock-play"
        className="grid size-8 place-items-center rounded-full border-0 bg-accent text-on-accent transition-colors duration-[var(--ll-motion-small)] hover:bg-accent-hover">
        {position.playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
      </button>
      <button type="button" onClick={onOpenSlide} aria-label={`${position.playing ? "Playing" : "Paused"} at ${clockLabel(position.ms)}${range ? ` in the range ${what}` : ""}. Open the Slide pane.`}
        className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent p-0 text-left" data-testid="dock-open">
        <span className="grid min-w-0">
          <b className="ll-num ll-nb text-ui font-semibold">{what}</b>
          {range && <span className="ll-nb overflow-hidden text-ui text-muted">{RANGE_KIND_LABEL[rangeKindOf(range)]}</span>}
        </span>
        <span className="ll-num text-ui font-semibold text-accent-text">{clockLabel(position.ms)}</span>
      </button>
    </div>
  );
}
