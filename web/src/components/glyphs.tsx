// Glyph families (design specification 8.3). Three families that never share a shape, so no glyph can mean two things:
//   rings          evidence states, and nothing else is a ring
//   squares        the basis of a link or a range (with a pencil for the learner's own mark and a link for a tie
//                  through a concept)
//   filled shapes  the kind of a node of the concept model, 12 px, no stroke
// An error is a triangle. A glyph never carries a meaning alone: the words beside it do, so every glyph here is hidden
// from assistive technology. Lucide draws a shape wherever Lucide has it; the three shapes Lucide lacks are drawn here
// on the same 24-unit grid with the same stroke.
import { useId, type ReactNode } from "react";
import { Ban, CircleHelp, CircleMinus, Eye, LifeBuoy, Link2, Pencil, RefreshCw, SquareCheck, SquareDashed, SquareMenu, TriangleAlert, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";

export interface GlyphProps {
  /** Edge length in px. Evidence 16, basis 15, kind 12 unless the place asks otherwise. */
  size?: number;
  className?: string;
}

const STROKE = 2;
function Drawn({ size, className, filled, children }: { size: number; className?: string; filled?: boolean; children: ReactNode }) {
  return (
    <svg aria-hidden focusable="false" width={size} height={size} viewBox="0 0 24 24" className={clsx("shrink-0", className)}
      fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={filled ? undefined : STROKE} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const lucide = (Icon: LucideIcon, size: number, className?: string) => <Icon aria-hidden focusable="false" width={size} height={size} strokeWidth={STROKE} className={clsx("shrink-0", className)} />;

// ---- evidence: rings ------------------------------------------------------------------------------------------------------
/** The five evidence states of the read API. A value this build does not know is drawn as Unknown is (rule 9.1): never as the nearest known state. */
export type EvidenceGlyphState = "independent" | "assisted" | "not_separately_observed" | "unknown" | "not_applicable";
const EVIDENCE_RING: Record<Exclude<EvidenceGlyphState, "independent">, LucideIcon> = { assisted: LifeBuoy, not_separately_observed: CircleMinus, unknown: CircleHelp, not_applicable: Ban };
/** The colour is the glyph's alone; the words beside it stay neutral. Prior exposure never changes it. */
export const EVIDENCE_GLYPH_COLOUR: Record<EvidenceGlyphState, string> = {
  independent: "text-success", assisted: "text-caution", not_separately_observed: "text-unassessed", unknown: "text-unassessed", not_applicable: "text-unassessed",
};
const isEvidenceState = (state: string): state is EvidenceGlyphState => Object.prototype.hasOwnProperty.call(EVIDENCE_GLYPH_COLOUR, state);

/** Independent: a filled disc with a tick. The tick is cut out, so whatever ground the glyph sits on shows through it. */
function IndependentDisc({ size, className }: { size: number; className?: string }) {
  const id = `ll-g-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg aria-hidden focusable="false" width={size} height={size} viewBox="0 0 24 24" className={clsx("shrink-0", className)} fill="none">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <path d="m7.6 12.4 3 3 5.8-6.2" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <circle cx="12" cy="12" r="10" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

export function EvidenceGlyph({ state, size = 16, className }: GlyphProps & { state: EvidenceGlyphState | (string & {}) }) {
  const known: EvidenceGlyphState = isEvidenceState(state) ? state : "unknown";
  const colour = clsx(EVIDENCE_GLYPH_COLOUR[known], className);
  return known === "independent" ? <IndependentDisc size={size} className={colour} /> : lucide(EVIDENCE_RING[known], size, colour);
}

// ---- basis: squares, a pencil, a link --------------------------------------------------------------------------------------
/**
 * What a link or a range rests on. `suggested` is also the glyph of generated data and of a value this build does not
 * know (rule 9.1). `checked` is a second pass by an agent: still dashed, never the solid ticked square of `exact`.
 */
export type BasisGlyphKind = "exact" | "stated" | "suggested" | "checked" | "by_you" | "concept_related";
const BASIS_ICON: Record<Exclude<BasisGlyphKind, "checked">, LucideIcon> = { exact: SquareCheck, stated: SquareMenu, suggested: SquareDashed, by_you: Pencil, concept_related: Link2 };

/** A dashed square with a tick: Lucide's dashed square with the tick of its ticked square. */
function DashedSquareTick({ size, className }: { size: number; className?: string }) {
  return (
    <Drawn size={size} className={className}>
      <path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M21 9v1" /><path d="M3 14v1" /><path d="M21 14v1" />
      <path d="m16 9-5.5 5.5L8 12" />
    </Drawn>
  );
}

export function BasisGlyph({ basis, size = 15, className }: GlyphProps & { basis: BasisGlyphKind }) {
  const colour = clsx("text-muted", className);
  return basis === "checked" ? <DashedSquareTick size={size} className={colour} /> : lucide(BASIS_ICON[basis] ?? SquareDashed, size, colour);
}

// ---- kinds: small filled shapes ---------------------------------------------------------------------------------------------
/** The kinds of the concept graph and the source marker of the map. */
export type KindGlyphKind = "topic" | "concept" | "skill" | "question" | "criterion" | "source_page";
const KIND_SHAPE: Record<KindGlyphKind, ReactNode> = {
  topic: <rect x="5" y="5" width="14" height="14" rx="3" />, // rounded square
  concept: <circle cx="12" cy="12" r="6.5" />, // disc
  skill: <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />, // diamond
  question: <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />, // capsule
  criterion: <path d="M4 6.5h9.5L20 12l-6.5 5.5H4z" />, // tag: a rectangle with one pointed end
  source_page: <rect x="3" y="5.5" width="18" height="13" rx="2" />, // page-shaped rectangle
};

/** Muted at rest; `selected` (the row or node it stands in is the selected one) draws it in accent text. */
export function KindGlyph({ kind, size = 12, selected, className }: GlyphProps & { kind: KindGlyphKind; selected?: boolean }) {
  // The class carries the muted colour and turns accent inside a selected row ([aria-selected], [aria-current]); a
  // utility here would override that, so `selected` is the only colour this component writes itself.
  return <Drawn size={size} filled className={clsx("ll-kind", selected && "text-accent-text", className)}>{KIND_SHAPE[kind] ?? KIND_SHAPE.concept}</Drawn>;
}

// ---- error, and the two that belong to no family ----------------------------------------------------------------------------
/** A failed load or a failed job: a triangle in the danger colour. Never a ring. */
export function ErrorGlyph({ size = 16, className }: GlyphProps) {
  return lucide(TriangleAlert, size, clsx("text-danger", className));
}
/** Prior exposure, shown beside a state and never as one. */
export function PriorExposureGlyph({ size = 14, className }: GlyphProps) {
  return lucide(Eye, size, clsx("text-muted", className));
}
/** The stale notice. */
export function StaleGlyph({ size = 16, className }: GlyphProps) {
  return lucide(RefreshCw, size, clsx("text-muted", className));
}

/** Every member of every family, for the stories and for a check that no two members share a shape. */
export const EVIDENCE_GLYPH_STATES: readonly EvidenceGlyphState[] = ["independent", "assisted", "not_separately_observed", "unknown", "not_applicable"];
export const BASIS_GLYPH_KINDS: readonly BasisGlyphKind[] = ["exact", "stated", "suggested", "checked", "by_you", "concept_related"];
export const KIND_GLYPH_KINDS: readonly KindGlyphKind[] = ["topic", "concept", "skill", "question", "criterion", "source_page"];
