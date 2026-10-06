// The range list (design specification 5.6), FIRST VERSION: every range of the page as a radio row, in ONE placement:
// a pop layer anchored to the bar's top edge, as wide as the bar, lying over the lower part of the slide. Opening it never
// grows the bar, resizes the slide, scrolls the page or mounts a second player. Choosing a row does not close it; Escape
// or a press outside does and returns focus to the button. Separate visits are separate rows; nothing is drawn between
// them. The three qualities behind "Qualities" are the next version's.
import type { RefObject } from "react";
import { Popover, RadioGroup } from "radix-ui";
import { AudioLines, Play } from "lucide-react";
import { BasisGlyph, type BasisGlyphKind } from "@/components/glyphs";
import { cn } from "@/components/ui";
import { countLabel, durationLabel, rangeKindLabel, rangeSupportLine, recordingLabel, timeSpanLabel, RANGE_RELATION_LABEL } from "@/lib/labels";
import type { GroupPositionKind, RecordingView, TimingRange } from "@/lib/types";
import type { RangeListProps } from "./contracts";

/** The glyph of what a range is: nobody checked it, a second pass checked it, or the learner entered or confirmed it. */
export const rangeBasis = (range: Pick<TimingRange, "review_state">): BasisGlyphKind => (range.review_state === "human_confirmed" ? "by_you" : range.review_state === "agent_reviewed" ? "checked" : "suggested");

export function RangeList({ pages, ranges, selection, onSelect, open, onOpenChange, trigger, onMarkRange, anchor, recordings, groupKind }: RangeListProps & {
  /** The bar: the list is as wide as it and opens from its top edge. */
  anchor: RefObject<HTMLElement | null>;
  recordings: RecordingView[];
  /** The word for a member of the page's group ("build", "step"), when the page is in one. */
  groupKind?: GroupPositionKind | null;
}) {
  const first = pages[0];
  const last = pages[pages.length - 1];
  const heading = pages.length > 1 ? `Where pages ${first}–${last} are discussed` : `Where page ${first ?? ""} is discussed`;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchor as RefObject<HTMLElement>} />
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} collisionPadding={8} aria-label={heading}
          className="ll-pop z-40 max-h-[min(440px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[min(92vw,20rem)] overflow-y-auto p-2 [scrollbar-width:thin]" data-testid="range-list">
          <p className="flex flex-wrap items-baseline gap-x-3 px-2 pb-2 pt-1 text-ui text-muted">
            <b className="font-semibold text-ink">{heading}</b>
            <span>{countLabel(ranges.length, "range")}. Each is a separate visit. Playing one stops at its end.</span>
          </p>
          <RadioGroup.Root value={selection} onValueChange={onSelect} aria-label={heading} className="flex flex-col gap-0.5">
            {ranges.map((range) => {
              const chosen = range.range_id === selection;
              const support = rangeSupportLine(range.support, groupKind);
              return (
                <RadioGroup.Item key={range.range_id} value={range.range_id}
                  className={cn("grid min-h-[52px] w-full grid-cols-[18px_auto_auto_minmax(0,1fr)] items-center gap-x-3 rounded-row border-0 bg-transparent px-2 py-1.5 text-left text-ui transition-colors duration-[var(--ll-motion-small)] hover:bg-pad",
                    chosen && "bg-tint hover:bg-tint-strong")}>
                  {chosen ? <AudioLines aria-hidden className="size-4 text-accent-text" /> : <Play aria-hidden className="size-4 text-muted" />}
                  <span className={cn("ll-num ll-nb", chosen && "font-semibold text-accent-text")}>{range.relation === "displayed_during" ? `${RANGE_RELATION_LABEL.displayed_during} ` : ""}{timeSpanLabel(range.start_ms, range.end_ms)}</span>
                  <span className="ll-num ll-nb text-muted">{durationLabel(range.end_ms - range.start_ms)}</span>
                  <span className="ll-basis min-w-0 text-ink"><BasisGlyph basis={rangeBasis(range)} /><span>{rangeKindLabel(range)}</span></span>
                  <span className="col-span-3 col-start-2 break-words text-muted">{[recordingLabel(recordings, range.recording.source_id), support.short, range.why].filter(Boolean).join(" · ")}</span>
                </RadioGroup.Item>
              );
            })}
          </RadioGroup.Root>
          {onMarkRange && <p className="px-2 pb-1 pt-2 text-ui"><button type="button" className="ll-link border-0 bg-transparent p-0" onClick={onMarkRange}>Mark a range yourself</button></p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
