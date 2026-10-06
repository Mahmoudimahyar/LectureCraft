// The one transport bar under the slide (design specification 5.5), FIRST VERSION: the existing player (ClipPlayer: one
// media element under one Media Chrome controller, its clip bounds, stop-at-end and repeat) inside the new bar, with the
// ONE range line and the disclosure of the range list added around it. The next version rebuilds the bar itself; what it
// must keep is this file's contract (./contracts `TransportProps`, `LecturePlayerHandle`).
//
// Ranges. When the lecture view carries `slides[].ranges`, the selected range is what the player plays: it is handed
// to the player as its one bounded interval, so playback starts at its start and stops at its end. The player's own
// choice between that interval and the whole recording is mirrored into the shared selection. A view without range data
// (an older Brain) keeps the player's earlier list of timed links unchanged.
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BasisGlyph } from "@/components/glyphs";
import { Button, cn, IconButton, ToolbarButton } from "@/components/ui";
import { NO_RANGE_LINE, R2_ACTION, TOPIC_DISCUSSION_SENTENCE, countLabel, rangeKindLabel, rangeOrdinalLabel, rangeSupportLine, timeSpanLabel, RANGE_RELATION_LABEL } from "@/lib/labels";
import { identityOf, isStructuralPage, rangesForPage } from "@/lib/r2";
import type { Occurrence, TimingRange } from "@/lib/types";
import { ClipPlayer, type ClipPlayerHandle } from "./ClipPlayer";
import { WHOLE_RECORDING, type TransportProps } from "./contracts";
import { RangeList, rangeBasis } from "./RangeList";

/** A range of the lecture view as the interval the existing player understands. `link` is the learner's own record of it, when there is one. */
function asInterval(range: TimingRange, link: Occurrence | undefined): Occurrence {
  return {
    ...(link ?? {}),
    annotation_id: range.range_id,
    review_state: range.review_state === "human_confirmed" ? "confirmed" : "suggested",
    basis: link?.basis ?? range.method.name,
    relation: range.relation,
    source: { source_id: range.recording.source_id, version_id: range.recording.version_id ?? "", sha256: range.recording.sha256 ?? "", locator: { kind: "media", start_ms: range.start_ms, end_ms: range.end_ms } },
    start_ms: range.start_ms,
    end_ms: range.end_ms,
  } as Occurrence; // a view for the player only: it reads the interval, its recording and its state
}

export function Transport({ lecture, page, slide, selection, onSelect, playerRef, onTime, onEditMatch, onAddMatch, onNextContent, announce }: TransportProps) {
  const clip = useRef<ClipPlayerHandle>(null);
  const bar = useRef<HTMLElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const resume = useRef(false);

  const pageRanges = useMemo(() => rangesForPage(lecture, page), [lecture, page]);
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const links = slide?.occurrences ?? [];
  const ranged = pageRanges.known && pageRanges.ranges.length > 0;
  const index = pageRanges.ranges.findIndex((range) => range.range_id === selection);
  const selected = index >= 0 ? pageRanges.ranges[index]! : null;
  // In "whole recording" the player keeps the interval it was last given, so going back to it is one choice in the player.
  const lastRange = useRef<TimingRange | null>(null);
  if (selected) lastRange.current = selected;
  else if (lastRange.current && !pageRanges.ranges.includes(lastRange.current)) lastRange.current = null;
  const offered = selected ?? lastRange.current ?? pageRanges.selectedDefault;

  const linkOf = (range: TimingRange): Occurrence | undefined => links.find((link) => link.annotation_id === range.annotation_id);
  const intervals = useMemo<Occurrence[]>(() => (ranged ? (offered ? [asInterval(offered, links.find((link) => link.annotation_id === offered.annotation_id))] : []) : links),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranged, offered?.range_id, offered?.start_ms, offered?.end_ms, links]);

  useImperativeHandle(playerRef, () => ({
    pause: () => clip.current?.pause(),
    toggle: () => bar.current?.querySelector<HTMLButtonElement>('[data-testid="play-toggle"]')?.click(),
    seekTo: (ms) => clip.current?.seekTo(ms),
    currentMs: () => clip.current?.currentMs() ?? 0,
    isPlaying: () => clip.current?.isPlaying() ?? false,
    durationMs: () => clip.current?.durationMs() ?? null,
    recording: () => clip.current?.recording() ?? null,
  }), []);

  // A range chosen while the recording was playing goes on playing, from that range's start to its end.
  useEffect(() => {
    if (!resume.current) return;
    resume.current = false;
    const id = window.setTimeout(() => {
      if (clip.current && !clip.current.isPlaying()) bar.current?.querySelector<HTMLButtonElement>('[data-testid="play-toggle"]')?.click();
    }, 0);
    return () => window.clearTimeout(id);
  }, [selection]);

  const choose = (next: string) => {
    if (next === selection) return;
    resume.current = next !== WHOLE_RECORDING && !!clip.current?.isPlaying();
    onSelect(next);
  };
  // The player's own choice (this interval, or the whole recording) is the same selection.
  const mirror = (event: FormEvent<HTMLElement>) => {
    const target = event.target;
    if (ranged && target instanceof HTMLSelectElement && target.getAttribute("aria-label") === "Which part of the recording to play") onSelect(target.value === "whole" ? WHOLE_RECORDING : target.value);
  };

  const structural = isStructuralPage(lecture, page);
  const noRange = pageRanges.noRange;
  const support = selected ? rangeSupportLine(selected.support, identity.position?.kind ?? null) : null;
  const disclosure = (
    <ToolbarButton size="sm" chevron aria-expanded={listOpen} className={cn("flex-none bg-pad hover:bg-pad-strong", listOpen && "[&>svg:last-child]:rotate-180")} data-testid="range-list-toggle">
      {listOpen ? "Hide ranges" : pageRanges.ranges.length === 1 ? "Range details" : `All ${countLabel(pageRanges.ranges.length, "range")}`}
    </ToolbarButton>
  );

  return (
    <section ref={bar} aria-label="Recording" onChange={mirror} data-testid="transport"
      className="flex-none rounded-control bg-raised shadow-[0_0_0_1px_var(--ll-hairline)] [&_[data-testid=clip-player-none]]:bg-transparent [&_[data-testid=clip-player]]:bg-transparent">
      <ClipPlayer ref={clip} recordings={lecture.recordings} occurrences={intervals} page={page} onTime={onTime} announce={announce}
        onAddMatch={onAddMatch ? () => onAddMatch() : undefined}
        onEditMatch={onEditMatch || onAddMatch ? (interval) => {
          const link = links.find((entry) => entry.annotation_id === interval.annotation_id) ?? (offered ? linkOf(offered) : undefined);
          if (link && onEditMatch) onEditMatch(link);
          else onAddMatch?.(interval.start_ms); // a generated range is corrected by marking your own
        } : undefined} />
      {ranged && lecture.recordings.length > 0 && (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1.5 text-ui" data-testid="range-line">
          {pageRanges.ranges.length > 1 && (
            <span className="inline-flex flex-none items-center gap-0.5 whitespace-nowrap">
              <IconButton size="sm" label="Previous range" disabled={index <= 0} onClick={() => choose(pageRanges.ranges[index - 1]!.range_id)}><ChevronLeft aria-hidden /></IconButton>
              <span className="ll-num">{selected ? rangeOrdinalLabel(index + 1, pageRanges.ranges.length) : countLabel(pageRanges.ranges.length, "range")}</span>
              <IconButton size="sm" label="Next range" disabled={index < 0 ? false : index >= pageRanges.ranges.length - 1} onClick={() => choose(pageRanges.ranges[index < 0 ? 0 : index + 1]!.range_id)}><ChevronRight aria-hidden /></IconButton>
            </span>
          )}
          {selected ? (
            <>
              <b className="ll-num ll-nb font-semibold">{selected.relation === "displayed_during" ? `${RANGE_RELATION_LABEL.displayed_during} ` : ""}{timeSpanLabel(selected.start_ms, selected.end_ms)}</b>
              <span className="ll-basis text-ink"><BasisGlyph basis={rangeBasis(selected)} /><span>{rangeKindLabel(selected)}</span></span>
              {support && <span className="text-muted">{structural ? TOPIC_DISCUSSION_SENTENCE : support.short}</span>}
            </>
          ) : <b className="font-semibold">{R2_ACTION.whole_recording}</b>}
          <span className="flex-1" />
          <RangeList pages={identity.groupPages} ranges={pageRanges.ranges} selection={selection} onSelect={choose} open={listOpen} onOpenChange={setListOpen} trigger={disclosure}
            onMarkRange={onAddMatch ? () => { setListOpen(false); onAddMatch(); } : undefined} anchor={bar} recordings={lecture.recordings} groupKind={identity.position?.kind ?? null} />
        </div>
      )}
      {pageRanges.known && !ranged && noRange && lecture.recordings.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-ui" data-testid="no-range-line" data-state={noRange.state}>
          <b className="font-semibold">{NO_RANGE_LINE[noRange.state]?.label ?? noRange.state.replace(/_/g, " ")}</b>
          <span className="text-muted">{noRange.text}</span>
          {NO_RANGE_LINE[noRange.state]?.action === "next_content" && onNextContent && <Button size="xs" variant="quiet" className="text-accent-text" onClick={onNextContent}>{R2_ACTION.next_content}</Button>}
        </p>
      )}
    </section>
  );
}
