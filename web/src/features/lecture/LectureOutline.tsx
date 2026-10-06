// The lecture outline (design specification 5.2), FIRST VERSION: a thumbnail outline with one row per logical slide
// (lib/r2 `logicalSlides`), falling back to plain pages when the view carries no source map. Rows exist before the PDF
// has loaded: numbers and titles come from the lecture view; a thumbnail is a flat block of the page's shape until
// lib/thumbs has rendered the page (rows near the viewport first).
//
// Row kinds: a page; a structural page (small thumbnail beside a quiet title and its role); a group, closed (one row for
// one logical slide); the current group (a tint block with a strip of its member pages). Nothing here says "Slide N":
// a row is named by its physical page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { BAND_CLASS } from "@/app/WorkspaceFrame";
import { cn, ToolbarButton } from "@/components/ui";
import { NO_RANGE_OUTLINE_LINE, ROLE_LABEL, countLabel, groupRowLabel, nb, noRangeInOutline, pagesRef } from "@/lib/labels";
import { logicalSlides, type LogicalSlideRow } from "@/lib/r2";
import { useFirstPageShape, useNearViewport, useThumb } from "@/lib/thumbs";
import type { LectureView, SlideView } from "@/lib/types";
import type { LectureOutlineProps } from "./contracts";

const NO_TITLE = "No title on this page";

/** A page picture, or a flat block of the page's shape while it is not rendered. Never a fake page. */
function PageThumb({ url, page, width, fallbackShape, current, className }: { url: string | null; page: number; width: number; fallbackShape: number; current?: boolean; className?: string }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const { thumb, shape } = useThumb(url, page, width, near);
  return (
    <span ref={ref} className={cn("ll-thumb", current && "shadow-[0_0_0_2px_var(--ll-accent-text)]", className)} data-current={current ? "true" : undefined} data-page-thumb={page}>
      {thumb ? <img src={thumb.src} alt="" width={thumb.width} height={thumb.height} loading="lazy" decoding="async" draggable={false} />
        : <span className="block bg-pad-strong" style={{ aspectRatio: String(shape ?? fallbackShape) }} />}
    </span>
  );
}

function secondLine(row: LogicalSlideRow, slides: Map<number, SlideView>): string | null {
  const members = row.pages.map((page) => slides.get(page)).filter((slide): slide is SlideView => !!slide);
  const facts: string[] = [];
  const r2 = members.some((slide) => slide.question_ties !== undefined);
  const questions = r2 ? row.counts.questions : new Set(members.flatMap((slide) => slide.questions.map((question) => question.question_id))).size;
  if (questions > 0) facts.push(countLabel(questions, "question"));
  // "No recording range" only for a content page whose recording exists and holds nothing for it (9.5).
  const first = members[0];
  if (!row.structural && first?.ranges !== undefined && members.every((slide) => (slide.ranges ?? []).length === 0) && first.no_range && noRangeInOutline(first.no_range.state)) facts.push(nb(NO_RANGE_OUTLINE_LINE));
  return facts.length ? facts.join(", ") : null;
}

function plainRows(pageCount: number): LogicalSlideRow[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => ({ id: `page-${index + 1}`, kind: "single" as const, firstPage: index + 1, pages: [index + 1], title: null, role: "unknown" as const, roleState: null,
    roleUncertain: false, structural: false, grouping: null, known: false, counts: { questions: 0, ranges: 0, sectionRanges: 0 } }));
}

const rowsOf = (lecture: LectureView, pageCount: number): LogicalSlideRow[] => {
  const rows = logicalSlides(lecture);
  return rows.length ? rows : plainRows(pageCount);
};

export function LectureOutline({ lecture, page, pageCount, pdfUrl, onSelect, layout }: LectureOutlineProps) {
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const centred = useRef<string | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const firstShape = useFirstPageShape(pdfUrl) ?? 4 / 3;

  const slides = useMemo(() => new Map(lecture.slides.map((slide) => [slide.page, slide])), [lecture.slides]);
  const rows = useMemo(() => rowsOf(lecture, pageCount), [lecture, pageCount]);
  const shown = useMemo(() => {
    const wanted = needle.trim().toLowerCase();
    if (!wanted) return rows;
    return rows.filter((row) => row.pages.some((member) => String(member) === wanted) || `${row.title ?? ""} ${row.pages.map((member) => slides.get(member)?.title ?? "").join(" ")}`.toLowerCase().includes(wanted));
  }, [rows, needle, slides]);
  const grid = layout === "grid";

  const measureEdges = () => {
    const list = listRef.current;
    if (!list) return;
    const next = { top: list.scrollTop > 2, bottom: list.scrollTop + list.clientHeight < list.scrollHeight - 8 };
    setEdges((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
  };
  // The current row stays in view; it is centred when the lecture is opened. Only the list scrolls, never the page.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = currentRef.current;
    if (!list || !row || list.clientHeight === 0) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (centred.current !== lecture.lecture_id) {
      centred.current = lecture.lecture_id;
      list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2);
    } else if (top - 8 < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
    else if (top + row.offsetHeight + 8 > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight + 8 - list.clientHeight;
    measureEdges();
  }, [page, lecture.lecture_id, shown.length, layout]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureEdges);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const fade = edges.top && edges.bottom ? "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent)"
    : edges.bottom ? "linear-gradient(to bottom, #000 calc(100% - 40px), transparent)" : edges.top ? "linear-gradient(to bottom, transparent, #000 32px)" : undefined;
  const count = rows.reduce((total, row) => total + row.pages.length, 0);

  const renderRow = (row: LogicalSlideRow) => {
    const current = row.pages.includes(page);
    const title = row.title ?? slides.get(row.firstPage)?.title ?? null;
    const meta = secondLine(row, slides);
    const group = row.pages.length > 1;
    const groupLine = group ? groupRowLabel(row.kind, row.pages, row.grouping?.state ?? null) ?? `${countLabel(row.pages.length, "page")}, ${pagesRef(row.pages)}` : null;
    const shownPage = current ? page : row.firstPage;
    const number = <span className={cn("ll-num pt-px text-right text-micro", current ? "font-semibold text-accent-text" : "text-muted")}>{shownPage}</span>;
    const name = `${group ? `Pages ${row.pages[0]}–${row.pages[row.pages.length - 1]}` : `Page ${row.firstPage}`}: ${title ?? NO_TITLE}${groupLine ? `, ${groupLine}` : ""}${row.structural ? `, ${ROLE_LABEL[row.role] ?? row.role}` : ""}`;

    if (row.structural && !group) {
      return (
        <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">
        <button type="button" onClick={() => onSelect(row.firstPage)} aria-current={current ? "true" : undefined} aria-label={name}
          className={cn("grid w-full flex-none grid-cols-[22px_56px_minmax(0,1fr)] items-center gap-x-2 rounded-control border-0 bg-transparent p-2 pl-0.5 text-left transition-colors duration-[var(--ll-motion-small)] hover:bg-pad min-[1920px]:grid-cols-[26px_64px_minmax(0,1fr)]",
            current && "bg-tint hover:bg-tint-strong")}>
          {number}
          <PageThumb url={pdfUrl} page={row.firstPage} width={80} fallbackShape={firstShape} current={current} />
          <span className="min-w-0">
            <span className={cn("block break-words text-ui font-semibold", current ? "text-accent-text" : "text-muted")}>{title ?? NO_TITLE}</span>
            <span className="block text-ui text-muted">{ROLE_LABEL[row.role] ?? row.role}</span>
          </span>
        </button>
        </div>
      );
    }
    const body = (
      <button type="button" onClick={() => onSelect(current ? page : row.firstPage)} aria-current={current && !group ? "true" : undefined} aria-expanded={group ? current : undefined} aria-label={name}
        className={cn("grid w-full flex-none grid-cols-[22px_minmax(0,1fr)] items-start gap-x-2 gap-y-1 rounded-control border-0 bg-transparent p-2 pl-0.5 text-left transition-colors duration-[var(--ll-motion-small)] min-[1920px]:grid-cols-[26px_minmax(0,1fr)]",
          !(current && group) && "hover:bg-pad", current && !group && "bg-tint hover:bg-tint-strong")}>
        {number}
        <PageThumb url={pdfUrl} page={shownPage} width={240} fallbackShape={firstShape} current={current}
          className={cn(group && !current && "mb-1.5 mr-1.5 shadow-[0_0_0_1px_var(--ll-hairline),3px_3px_0_-1px_var(--ll-surface),3px_3px_0_0_var(--ll-hairline),6px_6px_0_-1px_var(--ll-surface),6px_6px_0_0_var(--ll-hairline)]")} />
        {group ? (current ? <ChevronUp aria-hidden className="size-4 justify-self-end text-accent-text" /> : <ChevronDown aria-hidden className="size-4 justify-self-end text-muted" />) : <span />}
        <span className="min-w-0">
          <span className={cn("block break-words text-ui leading-[1.125rem]", current && "font-semibold text-accent-text", !title && "text-muted")}>{title ?? NO_TITLE}</span>
          {groupLine && <span className={cn("ll-num block text-ui", current ? "text-ink" : "text-muted")}>{groupLine}</span>}
          {meta && <span className="block text-ui text-muted">{meta}</span>}
        </span>
      </button>
    );
    if (!group) return <div key={row.id} ref={current ? currentRef : undefined} className="flex-none">{body}</div>;
    return (
      <div key={row.id} ref={current ? currentRef : undefined} className={cn("flex-none rounded-control", current && "bg-tint", grid && current && "col-span-2 max-[599px]:col-span-full")} aria-current={current ? "true" : undefined}>
        {body}
        {current && (
          <div role="group" aria-label="Pages of this slide" className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2 px-2 pb-2 pl-8 min-[1920px]:pl-9">
            {row.pages.map((member, index) => (
              <button key={member} type="button" onClick={() => onSelect(member)} aria-current={member === page ? "true" : undefined} aria-label={`Page ${member}, ${index + 1} of ${row.pages.length}`}
                className={cn("grid justify-items-center gap-0.5 rounded-thumb border-0 bg-transparent p-[3px] pb-px text-micro hover:bg-pad", member === page ? "font-semibold text-accent-text" : "text-muted")}>
                <PageThumb url={pdfUrl} page={member} width={80} fallbackShape={firstShape} current={member === page} className="w-full" />
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
          <input type="search" autoFocus className="ll-input my-1 min-h-9 flex-1 py-1" placeholder="Page number or title" aria-label="Find a page by its number or title" value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation(); // typing here never pages the slide
              if (event.key === "Escape") {
                setFinding(false);
                setNeedle("");
              } else if (event.key === "Enter" && shown[0]) onSelect(shown[0].firstPage);
            }} />
        ) : (
          <>
            <h2 className="text-ui font-semibold">Outline</h2>
            <span className="ll-num text-ui text-muted">{countLabel(count, "page")}</span>
            <span className="flex-1" />
          </>
        )}
        <ToolbarButton onClick={() => { setFinding((on) => !on); setNeedle(""); }} aria-expanded={finding} className="flex-none">{finding ? "Close" : "Find"}</ToolbarButton>
      </div>
      <div ref={listRef} onScroll={measureEdges} role="navigation" aria-label="Pages"
        className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]",
          grid ? "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] content-start gap-2 p-3" : "flex flex-col gap-1 px-2 pb-4 pt-2")}
        style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}>
        {shown.map(renderRow)}
        {shown.length === 0 && <p className="p-2 text-ui text-muted">{rows.length === 0 ? "The pages of this deck are not known yet." : "No page has that number or title."}</p>}
      </div>
    </div>
  );
}
