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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { BAND_CLASS } from "@/app/WorkspaceFrame";
import { cn, ToolbarButton } from "@/components/ui";
import { dotJoin } from "@/lib/format";
import { NO_RANGE_OUTLINE_LINE, ROLE_LABEL, countLabel, groupRowLabel, nb, noRangeInOutline, pagesRef } from "@/lib/labels";
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
  /** Plain figures: "2 questions · 1 range". null when there is nothing to count. */
  figures: string | null;
  /** The page has a recording that holds nothing for it (the first four no-range states of 9.5); never on a structural page. */
  noRange: boolean;
}

/**
 * What a row says under its title. A question and a range are each counted once per row, however many member pages
 * carry them; a section range (the course's pairing of a part of the lecture with transcript lines) gives no time for
 * the page alone and is not counted. A view without R2 fields is counted from what it does carry.
 */
export function outlineFacts(row: LogicalSlideRow, slides: ReadonlyMap<number, SlideView>): OutlineFacts {
  const members = row.pages.map((page) => slides.get(page)).filter((slide): slide is SlideView => !!slide);
  const tied = members.some((slide) => slide.question_ties !== undefined);
  const ranged = members.some((slide) => slide.ranges !== undefined);
  const questions = tied ? row.counts.questions : new Set(members.flatMap((slide) => (slide.questions ?? []).map((question) => question.question_id))).size;
  const ranges = ranged ? row.counts.ranges : new Set(members.flatMap((slide) => (slide.occurrences ?? []).map((link) => link.annotation_id))).size;
  const first = members[0];
  const noRange = !row.structural && ranged && members.every((slide) => (slide.ranges ?? []).length === 0) && !!first?.no_range && noRangeInOutline(first.no_range.state);
  const figures = dotJoin([questions > 0 ? countLabel(questions, "question") : null, ranges > 0 ? countLabel(ranges, "range") : null]);
  return { figures: figures || null, noRange };
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
const COLUMNS = "grid-cols-[22px_minmax(0,1fr)] min-[1920px]:grid-cols-[26px_minmax(0,1fr)]";
/** The quiet row: number, small picture, words beside it from a list 216 px wide (an outline of 232 px); under it below that. */
const QUIET_COLUMNS = `${COLUMNS} @min-[13.5rem]/outline:grid-cols-[22px_56px_minmax(0,1fr)] @min-[13.5rem]/outline:items-center @min-[13.5rem]/outline:gap-y-0 min-[1920px]:@min-[13.5rem]/outline:grid-cols-[26px_64px_minmax(0,1fr)]`;
/** A title wraps in full: no clamp, no ellipsis; a word longer than the column is hyphenated, not cut. */
const TITLE = "block hyphens-auto break-words text-ui leading-[1.125rem]";

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

  const renderRow = (row: LogicalSlideRow) => {
    const current = row.pages.includes(page);
    const title = row.title ?? slides.get(row.firstPage)?.title ?? null;
    const facts = outlineFacts(row, slides);
    const group = row.pages.length > 1;
    const groupLine = group ? groupRowLabel(row.kind, row.pages, row.grouping?.state ?? null) ?? `${countLabel(row.pages.length, "page")}, ${pagesRef(row.pages)}` : null;
    const shownPage = current ? page : row.firstPage;
    const number = <span className={cn("ll-num pt-px text-right text-micro", current ? "font-semibold text-accent-text" : "text-muted")}>{shownPage}</span>;
    const name = rowName(row, title);
    const role = ROLE_LABEL[row.role] ?? String(row.role).replace(/_/g, " ");

    // A page of which nothing is forced: quiet, and still pictured, small. The picture stands at the left of the text
    // where the outline is wide enough for the words beside it, and over them where it is not (a word is never broken
    // to fit). In the grid every cell keeps the same shape.
    if (row.structural && !group && !grid) {
      return (
        <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">
          <button type="button" onClick={() => onSelect(row.firstPage)} aria-current={current ? "true" : undefined} aria-label={name} data-row="structural"
            className={cn(ROW, QUIET_COLUMNS, current ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad")}>
            {number}
            <PageThumb url={pdfUrl} page={row.firstPage} width={64} fallbackShape={firstShape} current={current} root={list} className="w-14 min-[1920px]:w-16" />
            <span className="col-start-2 min-w-0 @min-[13.5rem]/outline:col-start-3 @min-[13.5rem]/outline:row-start-1">
              <span className={cn(TITLE, "font-semibold", current ? "text-accent-text" : "text-muted")}>{title ?? NO_TITLE}</span>
              <span className="block text-ui leading-[1.125rem] text-muted">{role}</span>
            </span>
          </button>
        </div>
      );
    }
    const quiet = row.structural && !group;
    const body = (
      <button type="button" onClick={() => onSelect(current ? page : row.firstPage)} aria-current={current && !group ? "true" : undefined} aria-expanded={group ? current : undefined} aria-label={name}
        data-row={group ? "group" : quiet ? "structural" : "page"} className={cn(ROW, COLUMNS, !(current && group) && (current ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad"))}>
        {number}
        <PageThumb url={pdfUrl} page={shownPage} width={thumbWidth} fallbackShape={firstShape} current={current} root={list} className={cn(group && !current && PILE)} />
        {group ? (current ? <ChevronUp aria-hidden className="mt-px size-4 justify-self-end text-accent-text" /> : <ChevronDown aria-hidden className="mt-px size-4 justify-self-end text-muted" />) : <span />}
        <span className="min-w-0">
          <span className={cn(TITLE, current ? "font-semibold text-accent-text" : quiet ? "font-semibold text-muted" : !title && "text-muted")}>{title ?? NO_TITLE}</span>
          {quiet && <span className="block text-ui leading-[1.125rem] text-muted">{role}</span>}
          {groupLine && <span className={cn("ll-num block text-ui leading-[1.125rem]", current ? "text-ink" : "text-muted")}>{groupLine}</span>}
          {facts.figures && <span className="ll-num block text-ui leading-[1.125rem] text-muted">{facts.figures}</span>}
          {facts.noRange && <span className="block text-ui leading-[1.125rem] text-muted">{nb(NO_RANGE_OUTLINE_LINE)}</span>}
        </span>
      </button>
    );
    if (!group) return <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">{body}</div>;
    return (
      <div key={row.id} ref={current ? currentRef : undefined} className={cn("flex-none rounded-control", current && "bg-tint", grid && current && "col-span-2 max-[599px]:col-span-full")} aria-current={current ? "true" : undefined}
        data-group={row.kind}>
        {body}
        {current && (
          <div role="group" aria-label="Pages of this slide" className="grid grid-cols-3 gap-2 px-2 pb-2 pl-8 min-[1920px]:pl-9" data-testid="outline-builds">
            {row.pages.map((member, index) => (
              <button key={member} type="button" onClick={() => onSelect(member)} aria-current={member === page ? "true" : undefined} aria-label={`Page ${member}, ${index + 1} of ${row.pages.length}`}
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
      <div ref={setList} onScroll={measureEdges} role="navigation" aria-label="Pages"
        className={cn("@container/outline min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]",
          grid ? "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] content-start gap-2 p-3" : "flex flex-col gap-1 px-2 pb-4 pt-2")}
        style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}>
        {shown.map(renderRow)}
        {shown.length === 0 && <p className="p-2 text-ui text-muted">{rows.length === 0 ? "The pages of this file are not known yet." : "No page has that number or title."}</p>}
      </div>
    </div>
  );
}
