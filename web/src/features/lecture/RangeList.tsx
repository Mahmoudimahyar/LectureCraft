// The range list (design specification 5.6): every range of the page as a radio row, in ONE placement: a pop layer
// anchored to the bar's top edge, as wide as the bar, lying over the lower part of the slide. It is closed until asked
// for. Opening it never grows the bar, resizes the slide, scrolls the page or mounts a second player. Choosing a row
// does not close it; Escape or a press outside the list and the bar does, and focus returns to the button.
//
// One row per range, earliest first, separate visits as separate rows; nothing is drawn between them. A row says the
// times, the length, what the range is (a suggestion with its method, checked by a second pass, marked by you), the
// recording, where it applies (this page, the whole group, a section the course's study map states) and why. The three
// qualities are opened on request under a row and are never merged into one figure. For an ambiguous page the same
// list holds its candidates, each worded as a candidate and never as a range.
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useInRouterContext, useSearchParams } from "react-router";
import { Popover, RadioGroup } from "radix-ui";
import { AudioLines, ChevronDown, Play } from "lucide-react";
import type { BasisGlyphKind } from "@/components/glyphs";
import { BasisLabel, rangeBasisGlyph } from "@/components/labels";
import { cn } from "@/components/ui";
import {
  COURSE_STUDY_MAP_WORDS, DISPLAYED_SENTENCE, QUALITY_LABEL, RANGE_RELATION_LABEL, TOPIC_DISCUSSION_SENTENCE, countLabel, durationLabel, methodWords, pagesRef, qualityStateLabel, rangeKindInFull, rangeKindOf,
  rangeSupportLine, recordingLabel, timeSpanLabel, transcriptLinesRef, type RangeKind,
} from "@/lib/labels";
import type { GroupPositionKind, LineRange, MethodRef, NoRangeCandidate, QualityName, TimingRange } from "@/lib/types";
import type { RangeListProps } from "./contracts";

// ---- what a range is, in words --------------------------------------------------------------------------------------------
type RangeLike = Pick<TimingRange, "origin" | "review_state"> & { method?: MethodRef | null };
/**
 * The words of design specification 9.4 for what a range is: a suggestion (with its method in brackets), a suggestion
 * a second pass checked, a range the learner entered or confirmed. One table, so the words are one line to change
 * (lib/labels `rangeKindLabel` holds the UI contract's "reviewed" and "entered by you" for the same four kinds).
 */
export const RANGE_KIND_WORDS: Record<RangeKind, string> = { suggestion: "Suggestion", suggestion_checked: "Checked", reviewed: "Marked by you", entered_by_you: "Marked by you" };
/** The kind and, for a suggestion nobody checked, the method that goes into the brackets ("wording match", "course study map"). */
export function rangeKindParts(range: RangeLike): { label: string; method: string | null } {
  const kind = rangeKindOf(range);
  const method = kind === "suggestion" ? (range.origin === "reviewed_source_map" ? COURSE_STUDY_MAP_WORDS : methodWords(range.method)) : "";
  return { label: RANGE_KIND_WORDS[kind], method: method || null };
}
/** "Suggestion (wording match)", "Suggestion (course study map)", "Checked", "Marked by you". A suggestion is never worded as confirmed. */
export function rangeKindWords(range: RangeLike): string {
  const { label, method } = rangeKindParts(range);
  return method ? `${label} (${method})` : label;
}
/** The glyph of what a range is: a dashed square, the same with a tick once a second pass checked it, the pencil for the learner's own. */
export const rangeBasis = (range: RangeLike): BasisGlyphKind => rangeBasisGlyph(range);

/** What a candidate of an ambiguous page is called: never a range. */
export const CANDIDATE_WORDS = "Candidate, not shown as a range";
/** What tells one candidate from another in the list and in the player. */
export const candidateId = (candidate: Pick<NoRangeCandidate, "range_id" | "start_ms" | "end_ms" | "recording_source_id">): string =>
  `candidate:${candidate.range_id ?? `${candidate.recording_source_id ?? ""}:${candidate.start_ms}-${candidate.end_ms}`}`;

const sentence = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capital = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};
/** One quality of a range: its state as a sentence, then the Brain's basis verbatim. Never merged with another. */
export function qualityLine(facet: { state?: string | null; basis?: string | null } | null | undefined): string {
  if (!facet) return "Not stated.";
  return [sentence(qualityStateLabel(facet.state ?? "")), (facet.basis ?? "").trim()].filter(Boolean).join(" ") || "Not stated.";
}
const QUALITY_ORDER: readonly QualityName[] = ["acoustic", "association", "group_mapping"];

// ---- a link to transcript lines --------------------------------------------------------------------------------------------
function LinesInAddress({ lines, children }: { lines: LineRange; children: ReactNode }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set("panel", "transcript");
  next.set("line", String(lines[0]));
  return <Link className="ll-link ll-num" to={{ search: `?${next.toString()}` }} replace>{children}</Link>;
}
/** "transcript lines 120–164", opening them in the Transcript tab: through the caller when it says how, else through the address. */
function TranscriptLines({ lines, onOpen }: { lines: LineRange; onOpen?: (start: number, end: number) => void }) {
  const routed = useInRouterContext();
  const words = transcriptLinesRef([lines]);
  if (onOpen) return <button type="button" className="ll-link ll-num border-0 bg-transparent p-0 text-left" onClick={() => onOpen(lines[0], lines[1])}>{words}</button>;
  return routed ? <LinesInAddress lines={lines}>{words}</LinesInAddress> : <span className="ll-num">{words}</span>;
}

// ---- rows ---------------------------------------------------------------------------------------------------------------
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-start rounded-row transition-colors duration-[var(--ll-motion-small)] hover:bg-pad data-[chosen=true]:bg-tint";
const ROW_MAIN = "grid min-h-[52px] w-full grid-cols-[18px_auto_auto_minmax(0,1fr)] items-center gap-x-3 rounded-row border-0 bg-transparent py-1.5 pl-1.5 pr-2 text-left text-ui text-ink @max-[479px]:min-h-14 @max-[479px]:grid-cols-[18px_auto_minmax(0,1fr)]";
const QUALITIES_BUTTON = "ll-tbtn ll-tbtn-sm mr-1.5 mt-1.5 self-start text-muted @max-[479px]:col-span-2 @max-[479px]:mb-1.5 @max-[479px]:ml-[30px] @max-[479px]:mt-0 @max-[479px]:justify-self-start";

function Glyph({ chosen }: { chosen: boolean }) {
  return chosen ? <AudioLines aria-hidden className="size-4 text-accent-text" /> : <Play aria-hidden className="size-4 text-muted" />;
}

function Qualities({ range, groupKind, structural, onCorrect, onOpenTranscriptLines }: { range: TimingRange; groupKind?: GroupPositionKind | null; structural?: boolean; onCorrect?: () => void;
  onOpenTranscriptLines?: (start: number, end: number) => void }) {
  const lines = (range.evidence?.transcript_lines ?? []).filter((entry): entry is LineRange => Array.isArray(entry) && entry.length === 2);
  const terms = (range.evidence?.terms ?? []).filter((term) => typeof term === "string" && term.trim() !== "");
  const where = rangeSupportLine(range.support, groupKind).full;
  return (
    <dl className="col-span-2 mb-2 ml-9 mr-2 grid gap-0.5 border-t border-hairline pt-2 text-ui @max-[479px]:ml-[30px]" data-testid="range-qualities">
      {QUALITY_ORDER.map((name) => (
        <div key={name} className="grid grid-cols-[15em_minmax(0,1fr)] gap-x-3 @max-[639px]:grid-cols-1">
          <dt className="text-muted">{QUALITY_LABEL[name].label} <span className="block @max-[639px]:inline">({QUALITY_LABEL[name].question})</span></dt>
          <dd className="break-words">{qualityLine(range.quality?.[name])}</dd>
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[15em_minmax(0,1fr)] gap-x-3 @max-[639px]:grid-cols-1">
        <dt className="text-muted">What it is</dt>
        <dd className="break-words">
          {rangeKindInFull(range)} {sentence(`It applies to ${where}`)}
          {range.relation === "displayed_during" && <> {DISPLAYED_SENTENCE}</>}
          {structural && <> {TOPIC_DISCUSSION_SENTENCE}</>}
        </dd>
      </div>
      {(lines.length > 0 || terms.length > 0) && (
        <div className="grid grid-cols-[15em_minmax(0,1fr)] gap-x-3 @max-[639px]:grid-cols-1">
          <dt className="text-muted">Evidence</dt>
          <dd className="break-words">
            {lines.map((entry, index) => <span key={`${entry[0]}-${entry[1]}`}>{index > 0 && ", "}<TranscriptLines lines={entry} onOpen={onOpenTranscriptLines} /></span>)}
            {lines.length > 0 && terms.length > 0 && <span className="text-muted"> · </span>}
            {terms.length > 0 && <span>Terms: {terms.join(", ")}</span>}
          </dd>
        </div>
      )}
      {onCorrect && (
        <div className="mt-1 grid grid-cols-[15em_minmax(0,1fr)] gap-x-3 @max-[639px]:grid-cols-1">
          <dt />
          <dd><button type="button" className="ll-link border-0 bg-transparent p-0" onClick={onCorrect}>Correct this range</button></dd>
        </div>
      )}
    </dl>
  );
}

export function RangeList({ pages, ranges, candidates, selection, onSelect, open, onOpenChange, trigger, anchor, room, recordings, groupKind, structural, onMarkRange, onCorrectRange, onOpenTranscriptLines }: RangeListProps) {
  const [qualities, setQualities] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const first = pages[0];
  const listed = candidates && ranges.length === 0 ? candidates : null;
  const where = pages.length > 1 ? `pages ${pagesRef(pages).replace(/^pp?\.\s*/, "")}` : `page ${first ?? ""}`;
  const heading = listed ? `Candidates for ${where}` : `Where ${where} ${pages.length > 1 ? "are" : "is"} ${ranges.length > 0 && ranges.every((range) => range.relation === "displayed_during") ? "shown" : "discussed"}`;
  const lead = listed
    ? `${countLabel(listed.length, "candidate")}. None was clear enough to show as the range. Playing one stops at its end.`
    : `${countLabel(ranges.length, "range")}. ${ranges.length > 1 ? "Each is a separate visit. " : ""}Playing ${ranges.length > 1 ? "one" : "it"} stops at its end.`;
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchor as RefObject<HTMLElement>} />
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content ref={content} side="top" align="center" sideOffset={8} avoidCollisions={false} aria-label={heading} data-testid="range-list"
          style={room ? { maxHeight: Math.min(440, room) } : undefined}
          // It opens at its heading, with the chosen row in view (focus goes to the chosen row).
          onOpenAutoFocus={() => {
            window.requestAnimationFrame(() => {
              const node = content.current;
              if (!node) return;
              node.scrollTop = 0;
              const chosen = node.querySelector<HTMLElement>('[data-chosen="true"]');
              if (chosen && chosen.offsetTop + chosen.offsetHeight > node.clientHeight) node.scrollTop = chosen.offsetTop + chosen.offsetHeight - node.clientHeight + 8;
            });
          }}
          // The bar belongs to the list: pressing Play or stepping to the next range there keeps the list open.
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault();
          }}
          className="ll-pop @container relative z-40 max-h-[min(440px,calc(var(--radix-popover-content-available-height,440px)_-_24px))] w-[var(--radix-popover-trigger-width)] overflow-y-auto overflow-x-hidden p-2 [scrollbar-width:thin]">
          <p className="flex flex-wrap items-baseline gap-x-3 px-2 pb-2 pt-1 text-ui text-muted">
            <b className="font-semibold text-ink">{heading}</b>
            <span>{lead}</span>
          </p>
          <RadioGroup.Root value={selection} onValueChange={onSelect} aria-label={heading} className="flex flex-col gap-0.5">
            {!listed && ranges.map((range) => {
              const chosen = range.range_id === selection;
              const opened = qualities === range.range_id;
              const support = rangeSupportLine(range.support, groupKind);
              const meta = [recordingLabel(recordings, range.recording.source_id), structural ? TOPIC_DISCUSSION_SENTENCE : support.short, range.why].filter(Boolean);
              return (
                <div key={range.range_id} className={ROW} data-chosen={chosen} data-testid="range-row">
                  {/* Pressing the chosen row again goes back to its start. */}
                  <RadioGroup.Item value={range.range_id} className={ROW_MAIN} onClick={() => { if (chosen) onSelect(range.range_id); }}>
                    <Glyph chosen={chosen} />
                    <span className={cn("ll-num ll-nb", chosen && "font-semibold text-accent-text")}>{range.relation === "displayed_during" ? `${RANGE_RELATION_LABEL.displayed_during} ` : ""}{timeSpanLabel(range.start_ms, range.end_ms)}</span>
                    <span className="ll-num ll-nb text-muted @max-[639px]:hidden">{durationLabel(range.end_ms - range.start_ms)}</span>
                    <BasisLabel basis={rangeBasis(range)} className="text-ink @max-[479px]:justify-self-end">{rangeKindWords(range)}</BasisLabel>
                    <span className="col-start-2 col-end-[-1] break-words text-muted">{meta.join(" · ")}</span>
                  </RadioGroup.Item>
                  <button type="button" className={QUALITIES_BUTTON} aria-expanded={opened} aria-label={`Qualities of the range ${timeSpanLabel(range.start_ms, range.end_ms)}`} onClick={() => setQualities(opened ? null : range.range_id)}>
                    <span>Qualities</span><ChevronDown aria-hidden className={cn(opened && "rotate-180")} />
                  </button>
                  {opened && <Qualities range={range} groupKind={groupKind} structural={structural} onCorrect={onCorrectRange ? () => onCorrectRange(range) : undefined} onOpenTranscriptLines={onOpenTranscriptLines} />}
                </div>
              );
            })}
            {listed?.map((candidate) => {
              const id = candidateId(candidate);
              const chosen = id === selection;
              const meta = [candidate.recording_source_id ? recordingLabel(recordings, candidate.recording_source_id) : null, candidate.why_not_shown ? sentence(candidate.why_not_shown).replace(/\.$/, "") : null].filter(Boolean);
              return (
                <div key={id} className={ROW} data-chosen={chosen} data-testid="candidate-row">
                  <RadioGroup.Item value={id} className={cn(ROW_MAIN, "col-span-2")} onClick={() => { if (chosen) onSelect(id); }}>
                    <Glyph chosen={chosen} />
                    <span className={cn("ll-num ll-nb", chosen && "font-semibold text-accent-text")}>{timeSpanLabel(candidate.start_ms, candidate.end_ms)}</span>
                    <span className="ll-num ll-nb text-muted @max-[639px]:hidden">{durationLabel(candidate.end_ms - candidate.start_ms)}</span>
                    <BasisLabel basis="suggested" className="text-ink">{CANDIDATE_WORDS}</BasisLabel>
                    {meta.length > 0 && <span className="col-start-2 col-end-[-1] break-words text-muted">{meta.join(" · ")}</span>}
                  </RadioGroup.Item>
                </div>
              );
            })}
          </RadioGroup.Root>
          {onMarkRange && <p className="px-2 pb-1 pt-2 text-ui"><button type="button" className="ll-link border-0 bg-transparent p-0" onClick={onMarkRange}>Mark a range yourself</button></p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
