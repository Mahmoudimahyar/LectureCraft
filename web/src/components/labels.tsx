// State label and basis label (design specification 8.2). Each is a glyph with words; neither is ever a pill, and no
// colour but the glyph's carries the state. The words come from src/lib/labels.ts (one table per kind of state), the
// glyphs from ./glyphs. A value this build has no words for is shown as recorded, with the neutral glyph of its family
// (rule 9.1): never as the nearest known label.
import { Fragment, type ReactNode } from "react";
import {
  SECTION_TIE, TIE_KIND, evidenceAttemptsLabel, evidenceLabel, rangeKindLabel, rangeKindOf, suggestedLinkLabel, suggestionCheckOf, unlistedLabel, EVIDENCE_STATE, PRIOR_EXPOSURE_LABEL, type RangeKind,
} from "@/lib/labels";
import type { EvidenceObject, EvidenceState, LearnerDecision, MethodRef, SuggestionState, SuggestionVerdict, TimingRange } from "@/lib/types";
import { BasisGlyph, EvidenceGlyph, PriorExposureGlyph, type BasisGlyphKind } from "./glyphs";
import { cn } from "./ui";

// ---- evidence state -------------------------------------------------------------------------------------------------------
type EvidenceLike = Pick<EvidenceObject, "state" | "assistance" | "prior_exposure"> & { attempts?: number | null };

export interface StateLabelProps {
  /**
   * The evidence object of the read API. It gives the state with its kind of help ("Assisted: solution shown"), the
   * attempts beside it ("1 attempt") and, when the question was seen before, "prior exposure" with the eye glyph.
   */
  evidence?: EvidenceLike | null;
  /** The state alone, when there is no evidence object. Ignored when `evidence` is given. */
  state?: EvidenceState | (string & {});
  /** Other words for the state than the table's. */
  label?: string;
  /** What stands beside the state, each after a middle dot, in muted text. Given, it replaces the attempts line. */
  beside?: ReactNode | ReactNode[];
  /** Whether prior exposure is said beside the state. Default: the evidence object says the question was seen. */
  priorExposure?: boolean;
  /** Muted words, for a state that stands in a secondary place (a node outside the scope). The glyph keeps its colour. */
  quiet?: boolean;
  className?: string;
}

/**
 * One of the five evidence states: a ring glyph in the state's colour and neutral words; what stands beside the state
 * follows in muted text, separated by middle dots. Prior exposure is shown beside the state and is never a state: it
 * changes neither the glyph nor its colour.
 */
export function StateLabel({ evidence, state, label, beside, priorExposure, quiet, className }: StateLabelProps) {
  const value = evidence?.state ?? state ?? "unknown";
  const words = label ?? (evidence ? evidenceLabel(evidence).state : (EVIDENCE_STATE[value as EvidenceState]?.label ?? unlistedLabel(String(value))));
  const attempts = evidence && typeof evidence.attempts === "number" ? evidenceAttemptsLabel({ state: evidence.state, attempts: evidence.attempts }) : null;
  const besides = (beside === undefined ? [attempts] : Array.isArray(beside) ? beside : [beside]).filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  const seen = priorExposure ?? evidence?.prior_exposure === "seen";
  return (
    <span className={cn("ll-state", quiet && "text-muted", className)} data-state={String(value)}>
      <EvidenceGlyph state={String(value)} />
      <span className="min-w-0">
        <span>{words}</span>
        {besides.map((part, index) => <Fragment key={index}><span className="ll-beside"> · {part}</span></Fragment>)}
        {seen && <span className="ll-beside"> · <span className="ll-nb"><PriorExposureGlyph />{PRIOR_EXPOSURE_LABEL.seen}</span></span>}
      </span>
    </span>
  );
}

// ---- basis of a link or a range -------------------------------------------------------------------------------------------
/** A question tie as the read API sends it: its kind and, for a suggested link, how far it was checked and decided. */
export interface TieLike {
  tie: string;
  granularity?: string | null;
  state?: SuggestionState | null;
  verdict?: SuggestionVerdict | null;
  learner_decision?: LearnerDecision | null;
}
type RangeLike = Pick<TimingRange, "origin" | "review_state"> & { method?: MethodRef | null };

const suggested = (tie: TieLike) => ({ state: tie.state ?? "agent_inferred", verdict: tie.verdict ?? null, learner_decision: tie.learner_decision ?? null });

/**
 * The glyph of a tie. Exact: a ticked square. Stated: a lined square. A suggested link: a dashed square, with a tick
 * once a second pass checked it, and the pencil once the learner confirmed it. Concept-related: a link. A kind this
 * build does not know: the dashed square.
 */
export function tieBasisGlyph(tie: TieLike): BasisGlyphKind {
  switch (tie.tie) {
    case "exact":
      return "exact";
    case "stated":
      return "stated";
    case "concept_related":
      return "concept_related";
    case "agent_inferred":
      if (tie.learner_decision === "confirmed") return "by_you";
      return suggestionCheckOf(suggested(tie)) === "checked" ? "checked" : "suggested";
    default:
      return "suggested";
  }
}
/** The one basis label of a tie, in the words of lib/labels.ts. A suggested link never reads Exact or Stated. */
export function tieBasisWords(tie: TieLike): string {
  switch (tie.tie) {
    case "exact":
      return TIE_KIND.exact.label;
    case "stated":
      return tie.granularity === "section" ? SECTION_TIE.label : TIE_KIND.stated.label;
    case "concept_related":
      return TIE_KIND.concept_related.label;
    case "agent_inferred":
      return suggestedLinkLabel(suggested(tie));
    default:
      return unlistedLabel(tie.tie);
  }
}
const RANGE_GLYPH: Record<RangeKind, BasisGlyphKind> = { suggestion: "suggested", suggestion_checked: "checked", reviewed: "by_you", entered_by_you: "by_you" };
/** The glyph of a range: a dashed square for a suggestion, with a tick once a second pass checked it, the pencil for the learner's own mark. */
export const rangeBasisGlyph = (range: RangeLike): BasisGlyphKind => RANGE_GLYPH[rangeKindOf(range)] ?? "suggested";

export interface BasisLabelProps {
  /** A question tie: gives the glyph and the words. */
  tie?: TieLike;
  /** A recording range: gives the glyph and the words ("Suggestion (wording match)"). */
  range?: RangeLike;
  /** The glyph, when neither a tie nor a range is given (or to override it). */
  basis?: BasisGlyphKind;
  /** The words, when neither a tie nor a range is given (or to override them). */
  children?: ReactNode;
  /** The sentence after the label (a question entry). With a sentence the label is drawn in text colour, semibold. */
  sentence?: ReactNode;
  /** Draw the label in text colour, semibold, also without a sentence. */
  strong?: boolean;
  className?: string;
}

/**
 * What a link or a range rests on: a square-family glyph in muted text and words. In a question entry the label is
 * semibold in text colour and its sentence follows in muted text.
 */
export function BasisLabel({ tie, range, basis, children, sentence, strong, className }: BasisLabelProps) {
  const glyph = basis ?? (tie ? tieBasisGlyph(tie) : range ? rangeBasisGlyph(range) : "suggested");
  const words = children ?? (tie ? tieBasisWords(tie) : range ? rangeKindLabel(range) : null);
  const emphasised = strong ?? (sentence !== undefined && sentence !== null);
  return (
    <span className={cn("ll-basis", className)} data-basis={glyph}>
      <BasisGlyph basis={glyph} />
      <span className="min-w-0">
        <span className={emphasised ? "ll-basis-strong" : undefined}>{words}{emphasised && sentence ? "." : ""}</span>
        {sentence ? <> {sentence}</> : null}
      </span>
    </span>
  );
}
