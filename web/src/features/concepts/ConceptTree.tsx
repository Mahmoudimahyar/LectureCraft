// The concept tree (design specification 7.2, 5.10): the complete, keyboard-usable hierarchy of one scope — topic,
// concept, skill, question, criterion, and a last group for what the catalog files under no topic. Everything the map
// offers is reachable here. It reads the scoped outline (`GET …/outline?scope=&parent=`) one branch at a time, so a
// course of several hundred concepts is never drawn at once; a row already on its own branch is not expanded again.
//
// Keyboard (the tree pattern): Up and Down move, Right opens or steps in, Left closes or steps out, Home and End, Enter
// selects, and typing letters moves to the next row whose name starts with them. One row is the tab stop.
//
// The same component serves the concept explorer (rows select a node) and, compactly, the Concepts tab of the lecture
// workspace (rows are links that open the node in the concept map; topic to skill only).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { KindGlyph, type KindGlyphKind } from "@/components/glyphs";
import { BasisLabel, StateLabel } from "@/components/labels";
import { cn, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { GRAPH_NODE_KIND_LABEL, TIE_KIND, countLabel, nodeCountsLabel, whereLabel } from "@/lib/labels";
import { whereLine } from "@/lib/r2";
import type { AnchorTieKind, GraphScopeKind, OutlineRow, OutlineView, SlidePosition, TieWhere } from "@/lib/types";
import { NO_QUESTION, UNFILED_ID, UNFILED_LABEL } from "./map-model";

/** One level of the scoped outline. The same cache entries serve the explorer and the Concepts tab. */
export function useOutlineRows(courseId: string, scope: string, parent: string | null, enabled = true): UseQueryResult<OutlineView, Error> {
  return useQuery<OutlineView, Error>({
    queryKey: ["outline", courseId, scope, parent], enabled: !!courseId && enabled, retry: false, staleTime: 30_000,
    queryFn: ({ signal }) => apiGet<OutlineView>(`courses/${courseId}/outline?scope=${encodeURIComponent(scope)}${parent ? `&parent=${encodeURIComponent(parent)}` : ""}`, signal),
  });
}

/** Where the selected page sits in its group, so a row can say "on this build" or name the build its support is on. */
export interface TreePlace {
  page: number;
  position: SlidePosition | null;
  groupPages: number[];
}

/**
 * Where an entry's support is, relative to the page on screen: "on this build", "elsewhere in this sequence: build 3",
 * "group-level: all 3 builds"; "on this page" for a page in no group. null when no support names the entry. Something
 * supported only on a later build is never worded as on this one.
 */
export function wherePhrase(entry: { where?: TieWhere | null; support_pages?: readonly number[] | null }, place: TreePlace | null | undefined): string | null {
  if (!entry.where) return null;
  const inGroup = place ? whereLine({ position: place.position, groupPages: place.groupPages, page: place.page }, { where: entry.where, support_pages: entry.support_pages ?? [] }) : null;
  return inGroup ?? whereLabel(entry.where, null);
}

/**
 * The kind glyph as the concept views draw it. The shapes of components/glyphs are 6.5 to 9.5 px wide inside their
 * 12 px box, where a square, a disc and a diamond are hard to tell apart. Here each is enlarged about its centre until
 * it is 10 to 11 px wide; the 12 px box and the grid of the row stay as they are.
 */
const KIND_SCALE: Record<KindGlyphKind, string> = { topic: "scale-150", concept: "scale-[1.6]", skill: "scale-[1.3]", question: "scale-[1.15]", criterion: "scale-[1.3]", source_page: "scale-[1.15]" };
export function Kind({ kind, selected, className }: { kind: KindGlyphKind; selected?: boolean; className?: string }) {
  return <KindGlyph kind={kind} selected={selected} className={cn(KIND_SCALE[kind] ?? KIND_SCALE.concept, className)} />;
}

/**
 * The basis label of an entry that only a suggested link ties to the slide: the dashed square with "Suggested link",
 * so a suggestion is never listed as the course's own anchor. A course anchor (exact or stated) adds no label here
 * (the detail's Sources tab words every tie), and a tie that is not known claims nothing.
 */
export function SuggestedOnly({ className }: { className?: string }) {
  return <BasisLabel basis="suggested" className={className}>{TIE_KIND.agent_inferred.label}</BasisLabel>;
}

export interface RowLines {
  /** Counts of a topic or a concept ("2 concepts, 4 skills, 6 questions"). */
  counts: string | null;
  /** Slide scope: where the row's support is. */
  where: string | null;
  /** Slide scope: a suggested link is all that ties the row to the slide. */
  suggested: boolean;
  /** A plain statement about the row: no question, already on this branch, which skill a criterion assesses. */
  note: string | null;
}
export interface RowContext {
  scopeKind: GraphScopeKind;
  place?: TreePlace | null;
  conceptCounts?: ReadonlyMap<string, number> | null;
  /** Slide scope: the strongest tie of each node the slide supports (from the scope's graph). */
  ties?: ReadonlyMap<string, AnchorTieKind> | null;
  /** Slide scope: the questions tied to the slide by a suggested link only (from the scoped outline). */
  suggestedQuestions?: ReadonlySet<string> | null;
}
/** The second line of a row, in words. Evidence is drawn apart (a glyph with words). Nothing here is derived from a name or an id. */
export function rowLines(row: OutlineRow, context: RowContext): RowLines {
  const grouping = row.kind === "topic" || row.kind === "concept";
  const held = row.kind === "topic" ? context.conceptCounts?.get(row.node_id) : undefined;
  const counts = grouping
    ? [held !== undefined ? countLabel(held, "concept") : null, nodeCountsLabel({ skills: row.skills ?? null, questions: row.questions ?? null }) || null].filter((part): part is string => part !== null).join(", ") || null
    : null;
  const slide = context.scopeKind === "slide";
  const tie = context.ties?.get(row.node_id) ?? (row.kind === "question" && context.suggestedQuestions?.has(row.node_id) ? "agent_inferred" : null);
  const where = slide ? wherePhrase(row, context.place) : null;
  const note = row.repeated_on_path ? "Already on this branch"
    : row.kind === "skill" && !row.has_children ? NO_QUESTION[context.scopeKind]
    : row.kind === "criterion" && row.on_parent_skill === false ? "Assesses another skill of this question"
    : null;
  return { counts, where, suggested: slide && tie === "agent_inferred", note };
}

/** The next row, after `from`, whose name starts with what was typed; wraps round; -1 when none does. */
export function typeaheadIndex(labels: readonly string[], from: number, typed: string): number {
  const query = typed.trim().toLowerCase();
  if (!query || labels.length === 0) return -1;
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (from + step) % labels.length;
    if (labels[index]!.toLowerCase().startsWith(query)) return index;
  }
  return -1;
}

const KIND_DEPTH: Record<OutlineRow["kind"], number> = { topic: 0, concept: 1, skill: 2, question: 3, criterion: 4 };

export interface ConceptTreeProps {
  courseId: string;
  /** `course`, `lecture:<id>` or `slide:<lecture>:<page>`. */
  scope: string;
  scopeKind: GraphScopeKind;
  /** The selected node (a catalog id). One object can sit on several branches: every row of it is marked. */
  selected?: string | null;
  /** Rows select a node (the explorer). */
  onSelect?: (row: OutlineRow) => void;
  /** Rows are links (the Concepts tab): each opens that node in the concept map. */
  hrefFor?: (row: OutlineRow) => string;
  linkState?: unknown;
  place?: TreePlace | null;
  conceptCounts?: ReadonlyMap<string, number> | null;
  /** Slide scope: the strongest tie of each node the slide supports, so a row can say that a suggested link is all there is. */
  ties?: ReadonlyMap<string, AnchorTieKind> | null;
  /** The deepest kind listed. The Concepts tab stops at skills. */
  deepest?: "skill" | "criterion";
  /** Kinds whose rows start open. */
  openKinds?: ReadonlyArray<OutlineRow["kind"]>;
  /** Catalog ids from a root down to the selected node: those branches are opened and the row is brought into view. */
  reveal?: readonly string[] | null;
  label: string;
  /** Shown instead of the tree when the scope holds nothing. */
  empty?: ReactNode;
  testId?: string;
}

interface TreeContext extends Required<Pick<ConceptTreeProps, "courseId" | "scope" | "scopeKind">> {
  selected: string | null;
  onSelect?: (row: OutlineRow) => void;
  hrefFor?: (row: OutlineRow) => string;
  linkState?: unknown;
  place: TreePlace | null;
  conceptCounts: ReadonlyMap<string, number> | null;
  ties: ReadonlyMap<string, AnchorTieKind> | null;
  suggestedQuestions: ReadonlySet<string> | null;
  maxDepth: number;
  isOpen: (id: string, kind: OutlineRow["kind"] | "group") => boolean;
  toggle: (id: string, open: boolean) => void;
  tabStop: string | null;
  setTabStop: (id: string) => void;
  revealed: string | null;
}

const ROW = "relative grid grid-cols-[16px_12px_minmax(0,1fr)] items-start gap-x-1.5 rounded-row py-2 pl-1 pr-2 transition-colors duration-[var(--ll-motion-small)] [@media(pointer:coarse)]:py-3";
const ITEM_FOCUS = "[&:focus-visible>[data-row]]:outline [&:focus-visible>[data-row]]:outline-2 [&:focus-visible>[data-row]]:-outline-offset-2 [&:focus-visible>[data-row]]:outline-focus";

function Chevron({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" tabIndex={-1} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={(event) => { event.stopPropagation(); onToggle(); }}
      className="relative mt-0.5 flex size-4 items-center justify-center rounded-thumb border-0 bg-transparent p-0 text-muted after:absolute after:-inset-2 after:content-[''] hover:text-ink">
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

function Branch({ parent, tree, level }: { parent: string; tree: TreeContext; level: number }) {
  const children = useOutlineRows(tree.courseId, tree.scope, parent);
  if (children.isLoading) return <li role="none" className="px-2 py-2"><span role="status" className="sr-only">Reading this branch…</span><Skeleton height={14} width="70%" /></li>;
  if (children.isError) {
    return (
      <li role="none" className="px-2 py-2 text-ui text-muted">This branch could not be read. <button type="button" className="ll-link border-0 bg-transparent p-0" onClick={() => void children.refetch()}>Try again</button></li>
    );
  }
  const rows = (children.data?.rows ?? []).filter((row) => KIND_DEPTH[row.kind] <= tree.maxDepth);
  return (
    <>
      {rows.map((row, index) => <Row key={row.instance_id} row={row} tree={tree} level={level} position={index + 1} setSize={rows.length} />)}
      {children.data?.truncated && <li role="none" className="px-2 py-2 text-ui text-muted">Showing {children.data.rows.length} of {children.data.total_children}. Narrow the scope to see the rest.</li>}
    </>
  );
}

function Row({ row, tree, level, position, setSize }: { row: OutlineRow; tree: TreeContext; level: number; position: number; setSize: number }) {
  const labelId = useId();
  const metaId = useId();
  const item = useRef<HTMLLIElement>(null);
  const expandable = row.has_children && !row.repeated_on_path && KIND_DEPTH[row.kind] < tree.maxDepth;
  const open = expandable && tree.isOpen(row.instance_id, row.kind);
  const selected = tree.selected !== null && tree.selected === row.node_id;
  const lines = rowLines(row, tree);
  const showEvidence = row.evidence && row.kind !== "topic" && row.kind !== "concept";
  const second = [lines.counts, lines.where].filter(Boolean).join(" · ");
  // A row revealed from elsewhere (the map) is brought into view once.
  const isRevealed = selected && tree.revealed === row.instance_id;
  useEffect(() => {
    if (isRevealed) item.current?.querySelector("[data-row]")?.scrollIntoView?.({ block: "nearest" });
  }, [isRevealed]);

  const body = (
    <>
      <span id={labelId} className={cn("block break-words text-read min-[900px]:text-ui", (row.kind === "topic" || selected) && "font-semibold", selected && "text-accent-text")}>
        <span className="sr-only">{GRAPH_NODE_KIND_LABEL[row.kind] ?? row.kind}:</span>{" "}{row.label}
      </span>
      <span id={metaId} className={cn("block text-ui", selected ? "text-ink" : "text-muted")}>
        {second && <span className="block">{second}</span>}
        {lines.suggested && <SuggestedOnly className="flex" />}
        {lines.note && <span className="block">{lines.note}</span>}
        {showEvidence && <StateLabel evidence={row.evidence} quiet={!selected} className="flex" />}
      </span>
    </>
  );
  const action = "col-start-3 min-w-0 border-0 bg-transparent p-0 text-left text-ink no-underline outline-none";
  return (
    <li ref={item} role="treeitem" aria-level={level} aria-posinset={position} aria-setsize={setSize} aria-expanded={expandable ? open : undefined}
      aria-selected={tree.onSelect ? selected : undefined} aria-labelledby={labelId} aria-describedby={metaId}
      data-kind={row.kind} data-node={row.node_id} data-instance={row.instance_id} data-label={row.label} tabIndex={tree.tabStop === row.instance_id ? 0 : -1}
      onFocus={(event) => { if (event.target === event.currentTarget) tree.setTabStop(row.instance_id); }} style={{ outline: "none" }} className={ITEM_FOCUS}>
      <div data-row="" className={cn(ROW, selected ? "bg-tint before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent-text before:content-['']" : "hover:bg-pad")}>
        {expandable ? <Chevron open={open} label={row.label} onToggle={() => tree.toggle(row.instance_id, !open)} /> : <span aria-hidden className="size-4" />}
        <Kind kind={row.kind} selected={selected} className="mt-1" />
        {tree.hrefFor
          ? <Link data-tree-action="" tabIndex={-1} to={tree.hrefFor(row)} state={tree.linkState} className={action}>{body}</Link>
          : <button data-tree-action="" type="button" tabIndex={-1} className={action} onClick={() => tree.onSelect?.(row)}>{body}</button>}
      </div>
      {open && <ul role="group" className="ml-[11px] grid gap-px border-l border-hairline pl-[5px]"><Branch parent={row.instance_id} tree={tree} level={level + 1} /></ul>}
    </li>
  );
}

/** What the catalog files under no topic, listed beside the topics as a group of its own. */
function Unfiled({ rows, tree, position, setSize }: { rows: OutlineRow[]; tree: TreeContext; position: number; setSize: number }) {
  const labelId = useId();
  const open = tree.isOpen(UNFILED_ID, "group");
  return (
    <li role="treeitem" aria-level={1} aria-posinset={position} aria-setsize={setSize} aria-expanded={open} aria-labelledby={labelId} data-kind="group" data-instance={UNFILED_ID} data-label={UNFILED_LABEL}
      tabIndex={tree.tabStop === UNFILED_ID ? 0 : -1} onFocus={(event) => { if (event.target === event.currentTarget) tree.setTabStop(UNFILED_ID); }} style={{ outline: "none" }} className={ITEM_FOCUS}>
      <div data-row="" className={cn(ROW, "hover:bg-pad")}>
        <Chevron open={open} label={UNFILED_LABEL} onToggle={() => tree.toggle(UNFILED_ID, !open)} />
        <span aria-hidden className="size-3" />
        <button data-tree-action="" type="button" tabIndex={-1} className="col-start-3 min-w-0 border-0 bg-transparent p-0 text-left text-ink outline-none" onClick={() => tree.toggle(UNFILED_ID, !open)}>
          <span id={labelId} className="block break-words text-read font-semibold min-[900px]:text-ui">{UNFILED_LABEL}</span>
          <span className="block text-ui text-muted">{countLabel(rows.length, "entry", "entries")}</span>
        </button>
      </div>
      {open && (
        <ul role="group" className="ml-[11px] grid gap-px border-l border-hairline pl-[5px]">
          {rows.map((row, index) => <Row key={row.instance_id} row={row} tree={tree} level={2} position={index + 1} setSize={rows.length} />)}
        </ul>
      )}
    </li>
  );
}

export function ConceptTree({ courseId, scope, scopeKind, selected = null, onSelect, hrefFor, linkState, place = null, conceptCounts = null, ties = null, deepest = "criterion", openKinds, reveal, label, empty, testId }: ConceptTreeProps) {
  const roots = useOutlineRows(courseId, scope, null);
  const suggested = roots.data?.scope.suggested_questions;
  const suggestedQuestions = useMemo(() => (suggested?.length ? new Set(suggested) : null), [suggested]);
  const root = useRef<HTMLUListElement>(null);
  // Open and closed rows the learner (or a reveal) set; everything else follows `openKinds`.
  const [override, setOverride] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [tabStop, setTabStopState] = useState<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const maxDepth = KIND_DEPTH[deepest];
  useEffect(() => {
    setOverride(new Map());
    setTabStopState(null);
  }, [courseId, scope]);

  const opens = useMemo(() => new Set(openKinds ?? []), [openKinds]);
  const isOpen = useCallback((id: string, kind: OutlineRow["kind"] | "group") => override.get(id) ?? (kind !== "group" && opens.has(kind)), [override, opens]);
  const toggle = useCallback((id: string, open: boolean) => {
    setOverride((current) => new Map(current).set(id, open));
    // A row that held the tab stop inside a branch being closed hands it to the branch.
    if (!open) setTabStopState((current) => (current && current.startsWith(`${id}>`) ? id : current));
  }, []);

  // Reveal: open every branch on the way to the selected row.
  const revealKey = reveal && reveal.length ? reveal.join(">") : null;
  const all = roots.data?.rows ?? [];
  const topics = all.filter((row) => row.relation !== "unfiled" && KIND_DEPTH[row.kind] <= maxDepth);
  const unfiled = all.filter((row) => row.relation === "unfiled" && KIND_DEPTH[row.kind] <= maxDepth);
  const revealUnfiled = !!reveal?.length && unfiled.some((row) => row.node_id === reveal[0]);
  useEffect(() => {
    if (!reveal || reveal.length === 0) return;
    setOverride((current) => {
      const next = new Map(current);
      // Every branch on the way, and the selected row itself: what it holds is listed under it, as the map draws what surrounds it.
      for (let depth = 1; depth <= reveal.length; depth += 1) next.set(reveal.slice(0, depth).join(">"), true);
      if (revealUnfiled) next.set(UNFILED_ID, true);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, revealUnfiled]);

  const fallback = topics[0]?.instance_id ?? (unfiled.length ? UNFILED_ID : null);
  const tree: TreeContext = { courseId, scope, scopeKind, selected, onSelect, hrefFor, linkState, place, conceptCounts, ties, suggestedQuestions, maxDepth, isOpen, toggle, tabStop: tabStop ?? fallback, setTabStop: setTabStopState, revealed: revealKey };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const list = root.current;
    if (!current || !list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = items.indexOf(current);
    const focus = (target: HTMLElement | null | undefined) => {
      if (!target) return;
      target.focus();
      target.querySelector("[data-row]")?.scrollIntoView?.({ block: "nearest" });
    };
    const id = current.dataset.instance ?? "";
    const expanded = current.getAttribute("aria-expanded");
    let handled = true;
    switch (event.key) {
      case "ArrowDown": focus(items[index + 1]); break;
      case "ArrowUp": focus(items[index - 1]); break;
      case "Home": focus(items[0]); break;
      case "End": focus(items[items.length - 1]); break;
      case "ArrowRight":
        if (expanded === "false") toggle(id, true);
        else if (expanded === "true") focus(current.querySelector<HTMLElement>('[role="group"] [role="treeitem"]'));
        break;
      case "ArrowLeft":
        if (expanded === "true") toggle(id, false);
        else focus(current.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        break;
      case "Enter":
      case " ":
        if ((event.target as HTMLElement).closest("button, a") && event.target !== current) handled = false; // a control inside the row keeps its own Enter
        else current.querySelector<HTMLElement>("[data-tree-action]")?.click();
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const now = Date.now();
          typed.current = { text: now - typed.current.at > 600 ? event.key : typed.current.text + event.key, at: now };
          const found = typeaheadIndex(items.map((entry) => entry.dataset.label ?? ""), typed.current.text.length > 1 ? index - 1 : index, typed.current.text);
          if (found >= 0) focus(items[found]);
        } else handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  if (roots.isLoading) {
    return <div role="status" className="grid gap-3 p-2"><span className="text-ui text-muted">Reading the outline from the course catalog…</span><Skeleton height={14} width="60%" /><Skeleton height={14} width="75%" /><Skeleton height={14} width="50%" /></div>;
  }
  if (roots.isError) {
    return <p className="p-2 text-ui text-muted">The outline could not be read. {roots.error?.message} <button type="button" className="ll-link border-0 bg-transparent p-0" onClick={() => void roots.refetch()}>Try again</button></p>;
  }
  if (topics.length === 0 && unfiled.length === 0) return <>{empty ?? null}</>;
  const setSize = topics.length + (unfiled.length ? 1 : 0);
  return (
    <ul ref={root} role="tree" aria-label={label} onKeyDown={onKeyDown} className="grid gap-px" data-testid={testId}>
      {topics.map((row, index) => <Row key={row.instance_id} row={row} tree={tree} level={1} position={index + 1} setSize={setSize} />)}
      {unfiled.length > 0 && <Unfiled rows={unfiled} tree={tree} position={setSize} setSize={setSize} />}
      {roots.data?.truncated && <li role="none" className="px-2 py-2 text-ui text-muted">Showing {roots.data.rows.length} of {roots.data.total_children}. Narrow the scope to see the rest.</li>}
    </ul>
  );
}
