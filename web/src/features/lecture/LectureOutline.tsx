// The lecture outline (design specification 5.2): a thumbnail outline with one row per logical slide (lib/r2
// `logicalSlides`), plain pages when the view carries no source map. Rows exist before the PDF has loaded: numbers,
// titles and groups come from the lecture view; a thumbnail is a flat block of the page's shape until lib/thumbs has
// rendered the page (rows near the list's own viewport first, one page at a time).
//
// Row kinds: a page (number, picture, title, plain figures); a structural page (a small picture beside a quiet title and
// its role, so a figure-only page filed as structural is still seen); a group, closed (one row for one logical slide,
// its picture stacked); the current group (a tint block with a strip of its member pages). The current page is the one
// selection idiom: tint, accent text, a 2 px ring on its picture. Nothing here says "Slide N": a row is named by its
// physical page. Only the list scrolls; it keeps the current row in view and centres it when the lecture is opened.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { BAND_CLASS } from "@/app/WorkspaceFrame";
import { cn, ToolbarButton } from "@/components/ui";
import { dotJoin } from "@/lib/format";
import { NBSP, NO_RANGE_OUTLINE_LINE, ROLE_LABEL, countLabel, groupRowLabel, noRangeInOutline, pagesRef } from "@/lib/labels";
import { logicalSlides, type LogicalSlideRow } from "@/lib/r2";
import { useFirstPageShape, useNearViewport, useThumb } from "@/lib/thumbs";
import type { LectureView, SlideView } from "@/lib/types";
import type { LectureOutlineProps } from "./contracts";

export const NO_TITLE = "No title on this page";

// ---- rows (pure; web/tests/lib/lecture-source.test.ts) ---------------------------------------------------------------------
/** A deck of which only the page count is known: one plain row per page, nothing grouped, no role claimed. */
export function plainRows(pageCount: number): LogicalSlideRow[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => ({ id: `page-${index + 1}`, kind: "single" as const, firstPage: index + 1, pages: [index + 1], title: null, role: "unknown" as const, roleState: null,
    roleUncertain: false, structural: false, grouping: null, known: false, counts: { questions: 0, ranges: 0, sectionRanges: 0 } }));
}

/** The rows of the outline: one per logical slide; plain pages when the view names none. */
export function outlineRows(lecture: LectureView, pageCount: number): LogicalSlideRow[] {
  const rows = logicalSlides(lecture);
  return rows.length ? rows : plainRows(pageCount);
}

export interface OutlineFacts {
  /** Plain figures: "2 questions · 1 range · 3 for its section". null when there is nothing to count. */
  figures: string | null;
  /** The page has a recording that holds nothing for it (the first four no-range states of 9.5); never on a structural page. */
  noRange: boolean;
  /**
   * The rows the range list shows for the page the row stands on, as the figures word them: ranges of that page or of
   * its whole group, and ranges of its section. Their sum is the length of that list.
   */
  listed: { own: number; section: number };
}

/**
 * The ranges of a page in the words of the outline, counted as its range list shows them: "2 ranges"; with ranges of
 * its section too, "1 range · 3 for its section" (four rows); with those alone, "3 ranges for its section only" (the
 * course's study map pairs a part of the lecture with the recording: no time of this page alone). null for none.
 */
export function rangeNote({ own, section }: { own: number; section: number }): string | null {
  if (own > 0) return dotJoin([countLabel(own, "range"), section > 0 ? `${section}${NBSP}for its section` : null]);
  return section > 0 ? `${countLabel(section, "range")} for its section only` : null;
}

const SECTION_SCOPE = "section";
/** The ids of a page's ranges as its range list holds them: its own (the page, its group, a region of it) and its section's. A view without R2 fields has its timed links. */
function listedRanges(slide: SlideView | undefined): { own: string[]; section: string[] } {
  if (!slide) return { own: [], section: [] };
  if (slide.ranges === undefined) return { own: [...new Set((slide.occurrences ?? []).map((link) => link.annotation_id))], section: [] };
  return { own: slide.ranges.filter((range) => range.support?.scope !== SECTION_SCOPE).map((range) => range.range_id),
    section: slide.ranges.filter((range) => range.support?.scope === SECTION_SCOPE).map((range) => range.range_id) };
}

/**
 * What a row says under its title. A question is counted once per row, however many member pages carry it. Ranges are
 * counted as the range list of ONE page shows them, so the outline and the list never give two numbers: the page the row
 * stands on (`shownPage`: the page on screen when it is one of the row's, else the row's first page). A range that only
 * another page of the row carries is named with its page ("1 range on p. 7"). A view without R2 fields is counted from
 * what it does carry.
 */
export function outlineFacts(row: LogicalSlideRow, slides: ReadonlyMap<number, SlideView>, shownPage: number = row.firstPage): OutlineFacts {
  const members = row.pages.map((page) => slides.get(page)).filter((slide): slide is SlideView => !!slide);
  const tied = members.some((slide) => slide.question_ties !== undefined);
  const ranged = members.some((slide) => slide.ranges !== undefined);
  const questions = tied ? row.counts.questions : new Set(members.flatMap((slide) => (slide.questions ?? []).map((question) => question.question_id))).size;
  const shown = slides.get(row.pages.includes(shownPage) ? shownPage : row.firstPage);
  const here = listedRanges(shown);
  const listed = { own: here.own.length, section: here.section.length };
  // What the other pages of the row carry and this one does not: each range once, with the pages that carry it.
  const elsewhere = new Set<string>();
  const elsewherePages = new Set<number>();
  for (const member of members) {
    if (member === shown) continue;
    for (const id of listedRanges(member).own) {
      if (here.own.includes(id)) continue;
      elsewhere.add(id);
      elsewherePages.add(member.page);
    }
  }
  const more = elsewhere.size > 0 ? `${listed.own > 0 ? `${elsewhere.size}${NBSP}more` : countLabel(elsewhere.size, "range")} on ${pagesRef([...elsewherePages])}` : null;
  const state = (shown ?? members[0])?.no_range;
  const noRange = !row.structural && ranged && members.every((slide) => (slide.ranges ?? []).length === 0) && !!state && noRangeInOutline(state.state);
  const figures = dotJoin([questions > 0 ? countLabel(questions, "question") : null, rangeNote(listed), more]);
  return { figures: figures || null, noRange, listed };
}

/** The rows a search for a page number or a part of a title keeps; every row for an empty search. */
export function findRows(rows: readonly LogicalSlideRow[], needle: string, slides: ReadonlyMap<number, SlideView>): LogicalSlideRow[] {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return [...rows];
  return rows.filter((row) => row.pages.some((member) => String(member) === wanted) || `${row.title ?? ""} ${row.pages.map((member) => slides.get(member)?.title ?? "").join(" ")}`.toLowerCase().includes(wanted));
}

/** The accessible name of a row: its page or pages, its title, and for a group its count line. */
export function rowName(row: LogicalSlideRow, title: string | null): string {
  const group = row.pages.length > 1;
  const groupLine = group ? groupRowLabel(row.kind, row.pages, row.grouping?.state ?? null) ?? `${countLabel(row.pages.length, "page")}, ${pagesRef(row.pages)}` : null;
  return `${group ? `Pages ${row.pages[0]}–${row.pages[row.pages.length - 1]}` : `Page ${row.firstPage}`}: ${title ?? NO_TITLE}${groupLine ? `, ${groupLine}` : ""}${row.structural ? `, ${ROLE_LABEL[row.role] ?? row.role}` : ""}`;
}

// ---- keyboard (pure) ---------------------------------------------------------------------------------------------------------
/** One place the arrow keys stop at, in the order drawn: a row, or a page of the open group's strip. */
export interface OutlineStop {
  kind: "row" | "member";
  /** A row of several pages. */
  group?: boolean;
  /** A group whose strip of pages is shown. */
  open?: boolean;
}
export type OutlineKeyAction = { type: "focus"; index: number } | { type: "open"; index: number } | { type: "close"; index: number } | { type: "stay" };
/**
 * What a key does on the stop at `index`. The outline is ONE Tab stop: Up and Down move through what is shown, Home and
 * End go to its ends, Right opens a closed group and from an open one goes to its first page, Left closes an open group
 * and from one of its pages goes back to its row. `stay`: the key belongs to the outline and does nothing here (so
 * Left and Right never turn the page while focus is inside it). null: not the outline's key (Enter and Space press the
 * row, Tab leaves).
 */
export function outlineKeyAction(key: string, index: number, stops: readonly OutlineStop[]): OutlineKeyAction | null {
  const stop = stops[index];
  if (!stop) return null;
  const focus = (target: number): OutlineKeyAction => (target >= 0 && target < stops.length && target !== index ? { type: "focus", index: target } : { type: "stay" });
  switch (key) {
    case "ArrowDown": return focus(index + 1);
    case "ArrowUp": return focus(index - 1);
    case "Home": return focus(0);
    case "End": return focus(stops.length - 1);
    case "ArrowRight":
      if (stop.kind !== "row" || !stop.group) return { type: "stay" };
      return stop.open ? (stops[index + 1]?.kind === "member" ? focus(index + 1) : { type: "stay" }) : { type: "open", index };
    case "ArrowLeft": {
      if (stop.kind === "row") return stop.group && stop.open ? { type: "close", index } : { type: "stay" };
      let parent = index - 1;
      while (parent >= 0 && stops[parent]!.kind !== "row") parent -= 1;
      return focus(parent);
    }
    default: return null;
  }
}

// ---- pictures --------------------------------------------------------------------------------------------------------------
const RING = "shadow-[0_0_0_2px_var(--ll-accent-text)]";
const PILE = "mb-1.5 mr-1.5 shadow-[0_0_0_1px_var(--ll-hairline),3px_3px_0_-1px_var(--ll-surface),3px_3px_0_0_var(--ll-hairline),6px_6px_0_-1px_var(--ll-surface),6px_6px_0_0_var(--ll-hairline)]";

/** A page picture, or a flat block of the page's shape while it is not rendered. Never a fake page. */
function PageThumb({ url, page, width, fallbackShape, current, root, className }: { url: string | null; page: number; width: number; fallbackShape: number; current?: boolean; root: Element | null; className?: string }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>("200px", root);
  const { thumb, shape } = useThumb(url, page, width, near);
  return (
    <span ref={ref} className={cn("ll-thumb", current && RING, className)} data-current={current ? "true" : undefined} data-page-thumb={page} data-rendered={thumb ? "true" : undefined}>
      {thumb ? <img src={thumb.src} alt="" width={thumb.width} height={thumb.height} decoding="async" draggable={false} />
        : <span className="block bg-pad-strong" style={{ aspectRatio: String(shape ?? fallbackShape) }} />}
    </span>
  );
}

const ROW = "grid w-full flex-none items-start gap-x-2 gap-y-1 rounded-control border-0 bg-transparent p-2 pl-0.5 text-left transition-colors duration-[var(--ll-motion-small)]";
/** A number column of 22 px (26 from 1920) and the content column. In rem, so the columns grow with the learner's text size as the figures and the small picture do. */
const COLUMNS = "grid-cols-[1.375rem_minmax(0,1fr)] min-[1920px]:grid-cols-[1.625rem_minmax(0,1fr)]";
/** The quiet row: number, small picture (56 px, 64 from 1920), words beside it from a list 240 px wide (an outline of 256 px), where an ordinary title word still fits beside the picture; under it below that. */
const QUIET_COLUMNS = `${COLUMNS} @min-[15rem]/outline:grid-cols-[1.375rem_3.5rem_minmax(0,1fr)] @min-[15rem]/outline:items-center @min-[15rem]/outline:gap-y-0 min-[1920px]:@min-[15rem]/outline:grid-cols-[1.625rem_4rem_minmax(0,1fr)]`;
/** A title wraps in full, between words: no clamp, no ellipsis, no hyphen put into a word; only a word longer than the column is broken. */
const TITLE = "block break-words text-ui leading-[1.125rem]";

export function LectureOutline({ lecture, page, pageCount, pdfUrl, onSelect, layout }: LectureOutlineProps) {
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState("");
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const centred = useRef<string | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [thumbWidth, setThumbWidth] = useState(layout === "grid" ? 240 : 160);
  const firstShape = useFirstPageShape(pdfUrl) ?? 4 / 3;
  const grid = layout === "grid";

  const slides = useMemo(() => new Map(lecture.slides.map((slide) => [slide.page, slide])), [lecture.slides]);
  const rows = useMemo(() => outlineRows(lecture, pageCount), [lecture, pageCount]);
  const shown = useMemo(() => findRows(rows, needle, slides), [rows, needle, slides]);
  const count = rows.reduce((total, row) => total + row.pages.length, 0);

  // The current row stays in view; it is centred when the lecture is opened. Only the list scrolls, never the page.
  const settle = useCallback(() => {
    const row = currentRef.current;
    if (!list || list.clientHeight === 0) return;
    if (row) {
      const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      if (centred.current !== lecture.lecture_id) {
        centred.current = lecture.lecture_id;
        list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2);
      } else if (top - 8 < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
      else if (top + row.offsetHeight + 8 > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight + 8 - list.clientHeight;
    }
    const next = { top: list.scrollTop > 2, bottom: list.scrollTop + list.clientHeight < list.scrollHeight - 8 };
    setEdges((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
  }, [list, lecture.lecture_id]);
  const measureEdges = useCallback(() => {
    if (!list) return;
    const next = { top: list.scrollTop > 2, bottom: list.scrollTop + list.clientHeight < list.scrollHeight - 8 };
    setEdges((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
  }, [list]);
  useLayoutEffect(settle, [settle, page, shown.length, layout, firstShape]);
  // An outline that was closed (or a pane that was hidden) has no height: it is settled when it gets one. Pictures are
  // asked for at the width of a row, in steps, so dragging the outline's edge does not redraw every page at every pixel.
  useEffect(() => {
    if (!list || typeof ResizeObserver === "undefined") return;
    let height = 0;
    const observer = new ResizeObserver(() => {
      if (list.clientWidth > 0) setThumbWidth(grid ? 240 : Math.max(120, Math.ceil((list.clientWidth - 56) / 40) * 40));
      // The first real height (the frame has placed the zone, the outline was opened, the pane was shown) and a lecture not centred yet.
      if (list.clientHeight > 0 && (height === 0 || centred.current !== lecture.lecture_id)) settle();
      else measureEdges();
      height = list.clientHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, grid, settle, measureEdges, lecture.lecture_id]);

  const fade = edges.top && edges.bottom ? "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent)"
    : edges.bottom ? "linear-gradient(to bottom, #000 calc(100% - 40px), transparent)" : edges.top ? "linear-gradient(to bottom, transparent, #000 32px)" : undefined;

  // ---- keyboard: the list is ONE Tab stop; the arrow keys move inside it (`outlineKeyAction`) --------------------------------
  const currentRow = rows.find((row) => row.pages.includes(page)) ?? null;
  /** The group on screen whose strip of pages the learner closed (Left on its row). Another row on screen forgets it. */
  const [closedGroup, setClosedGroup] = useState<string | null>(null);
  /** The stop that holds the Tab stop: the one last focused; the row on screen after the page has changed. */
  const [activeStop, setActiveStop] = useState<string | null>(null);
  useEffect(() => setClosedGroup(null), [currentRow?.id]);
  useEffect(() => setActiveStop(null), [page]);
  const rowStop = (row: LogicalSlideRow): string => `row:${row.id}`;
  const isOpen = (row: LogicalSlideRow): boolean => row.pages.length > 1 && row.id === currentRow?.id && closedGroup !== row.id;
  const stopKeys = shown.flatMap((row) => [rowStop(row), ...(isOpen(row) ? row.pages.map((member) => `member:${member}`) : [])]);
  const tabStop = activeStop !== null && stopKeys.includes(activeStop) ? activeStop : currentRow && stopKeys.includes(rowStop(currentRow)) ? rowStop(currentRow) : stopKeys[0] ?? null;
  const tabIndexOf = (stop: string): 0 | -1 => (stop === tabStop ? 0 : -1);
  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !list) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-stop]");
    if (!from) return;
    const nodes = [...list.querySelectorAll<HTMLElement>("[data-stop]")];
    const stops: OutlineStop[] = nodes.map((node) => (node.dataset.stop!.startsWith("member:") ? { kind: "member" } : { kind: "row", group: node.dataset.row === "group", open: node.getAttribute("aria-expanded") === "true" }));
    const action = outlineKeyAction(event.key, nodes.indexOf(from), stops);
    if (!action) return;
    event.preventDefault(); // the key is the outline's: the list is not scrolled by the browser and the page is not turned
    event.stopPropagation();
    if (action.type === "stay") return;
    const node = nodes[action.index]!;
    if (action.type === "focus") {
      setActiveStop(node.dataset.stop!);
      node.focus();
      return;
    }
    const row = shown.find((entry) => rowStop(entry) === node.dataset.stop);
    if (!row) return;
    if (action.type === "close") setClosedGroup(row.id);
    else if (row.id === currentRow?.id) setClosedGroup(null);
    else onSelect(row.firstPage); // a group opens by going to it
  };

  const renderRow = (row: LogicalSlideRow) => {
    const current = row.pages.includes(page);
    const title = row.title ?? slides.get(row.firstPage)?.title ?? null;
    const group = row.pages.length > 1;
    const open = isOpen(row);
    const groupLine = group ? groupRowLabel(row.kind, row.pages, row.grouping?.state ?? null) ?? `${countLabel(row.pages.length, "page")}, ${pagesRef(row.pages)}` : null;
    const shownPage = current ? page : row.firstPage;
    const facts = outlineFacts(row, slides, shownPage);
    const stop = rowStop(row);
    const number = <span className={cn("ll-num pt-px text-right text-micro", current ? "font-semibold text-accent-text" : "text-muted")}>{shownPage}</span>;
    const name = rowName(row, title);
    const role = ROLE_LABEL[row.role] ?? String(row.role).replace(/_/g, " ");

    // A page of which nothing is forced: quiet, and still pictured, small. The picture stands at the left of the text
    // where the outline is wide enough for the words beside it, and over them where it is not (a word is never broken
    // to fit). In the grid every cell keeps the same shape.
    if (row.structural && !group && !grid) {
      return (
        <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">
          <button type="button" onClick={() => onSelect(row.firstPage)} aria-current={current ? "true" : undefined} aria-label={name} data-row="structural" data-stop={stop} tabIndex={tabIndexOf(stop)}
            className={cn(ROW, QUIET_COLUMNS, current ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad")}>
            {number}
            <PageThumb url={pdfUrl} page={row.firstPage} width={64} fallbackShape={firstShape} current={current} root={list} className="w-14 min-[1920px]:w-16" />
            <span className="col-start-2 min-w-0 @min-[15rem]/outline:col-start-3 @min-[15rem]/outline:row-start-1">
              <span className={cn(TITLE, "font-semibold", current ? "text-accent-text" : "text-muted")}>{title ?? NO_TITLE}</span>
              <span className="block text-ui leading-[1.125rem] text-muted">{role}</span>
              {/* Talk that is supported over a title or housekeeping page stays listed there, so its row counts it too. */}
              {facts.figures && <span className="ll-num block text-ui leading-[1.125rem] text-muted" data-row-figures="">{facts.figures}</span>}
            </span>
          </button>
        </div>
      );
    }
    const quiet = row.structural && !group;
    const body = (
      <button type="button" onClick={() => { if (current && group) setClosedGroup(null); onSelect(current ? page : row.firstPage); }} aria-current={current && !group ? "true" : undefined} aria-expanded={group ? open : undefined}
        aria-label={name} data-row={group ? "group" : quiet ? "structural" : "page"} data-stop={stop} tabIndex={tabIndexOf(stop)} className={cn(ROW, COLUMNS, !(current && group) && (current ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad"))}>
        {number}
        <PageThumb url={pdfUrl} page={shownPage} width={thumbWidth} fallbackShape={firstShape} current={current} root={list} className={cn(group && !current && PILE)} />
        {group ? (open ? <ChevronUp aria-hidden className="mt-px size-4 justify-self-end text-accent-text" /> : <ChevronDown aria-hidden className={cn("mt-px size-4 justify-self-end", current ? "text-accent-text" : "text-muted")} />) : <span />}
        <span className="min-w-0">
          <span className={cn(TITLE, current ? "font-semibold text-accent-text" : quiet ? "font-semibold text-muted" : !title && "text-muted")}>{title ?? NO_TITLE}</span>
          {quiet && <span className="block text-ui leading-[1.125rem] text-muted">{role}</span>}
          {groupLine && <span className={cn("ll-num block text-ui leading-[1.125rem]", current ? "text-ink" : "text-muted")}>{groupLine}</span>}
          {facts.figures && <span className="ll-num block text-ui leading-[1.125rem] text-muted" data-row-figures="">{facts.figures}</span>}
          {facts.noRange && <span className="block text-ui leading-[1.125rem] text-muted">{NO_RANGE_OUTLINE_LINE}</span>}
        </span>
      </button>
    );
    if (!group) return <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">{body}</div>;
    return (
      <div key={row.id} ref={current ? currentRef : undefined} className={cn("flex-none rounded-control", current && "bg-tint", grid && current && "col-span-2 max-[599px]:col-span-full")} aria-current={current ? "true" : undefined}
        data-group={row.kind}>
        {body}
        {open && (
          <div role="group" aria-label="Pages of this slide" className="grid grid-cols-3 gap-2 px-2 pb-2 pl-8 min-[1920px]:pl-9" data-testid="outline-builds">
            {row.pages.map((member, index) => (
              <button key={member} type="button" onClick={() => onSelect(member)} aria-current={member === page ? "true" : undefined} aria-label={`Page ${member}, ${index + 1} of ${row.pages.length}`}
                data-stop={`member:${member}`} tabIndex={tabIndexOf(`member:${member}`)}
                className={cn("grid justify-items-center gap-0.5 rounded-thumb border-0 bg-transparent p-[3px] pb-px text-micro transition-colors duration-[var(--ll-motion-small)]",
                  member === page ? "font-semibold text-accent-text" : "text-muted hover:bg-pad")}>
                <PageThumb url={pdfUrl} page={member} width={grid ? 120 : 64} fallbackShape={firstShape} current={member === page} root={list} className="w-full" />
                <span className="ll-num">{index + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="lecture-outline" data-layout={layout}>
      <div className={cn(BAND_CLASS, "gap-2 pl-4 pr-1")}>
        {finding ? (
          <input type="search" autoFocus className="ll-input my-1 min-h-9 min-w-0 flex-1 py-1" placeholder="Page number or title" aria-label="Find a page by its number or title" value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation(); // typing here never pages the slide
              if (event.key === "Escape") {
                setFinding(false);
                setNeedle("");
              } else if (event.key === "Enter" && shown[0]) onSelect(shown[0].firstPage);
            }} />
        ) : (
          // One line: the page count leaves it (it wraps under the heading and is clipped there) where the outline is too narrow for both.
          <div className="flex h-[var(--ll-lh-ui)] min-w-0 flex-1 flex-wrap items-baseline gap-x-2 overflow-hidden">
            <h2 className="text-ui font-semibold">Outline</h2>
            <span className="ll-num whitespace-nowrap text-ui text-muted">{countLabel(count, "page")}</span>
          </div>
        )}
        <ToolbarButton onClick={() => { setFinding((on) => !on); setNeedle(""); }} aria-expanded={finding} className="flex-none">{finding ? "Close" : "Find"}</ToolbarButton>
      </div>
      <div ref={setList} onScroll={measureEdges} role="navigation" aria-label="Pages" onKeyDown={onListKey}
        onFocus={(event) => { const stop = (event.target as HTMLElement).closest<HTMLElement>("[data-stop]")?.dataset.stop; if (stop) setActiveStop(stop); }}
        className={cn("@container/outline min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]",
          // 160 px cells at the ordinary text size; in rem, so that enlarged text gets wider cells and fewer columns.
          grid ? "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] content-start gap-2 p-3" : "flex flex-col gap-1 px-2 pb-4 pt-2")}
        style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}>
        {shown.map(renderRow)}
        {shown.length === 0 && <p className="p-2 text-ui text-muted">{rows.length === 0 ? "The pages of this file are not known yet." : "No page has that number or title."}</p>}
      </div>
    </div>
  );
}
