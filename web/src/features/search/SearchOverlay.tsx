// SC17 Search (UI04): current course by default, "All my courses" only when chosen. Opening a hit
// keeps the study context: drafts are pinned to their own source, and "Return" restores the origin.
//
// This file also holds what the pages that keep their layout share (Review, Progress, Library, Activity, Settings,
// Connect, session summary, question practice): `ReturnLink`, and at the foot `Page` (the one page column, which is the
// column of the Study home), `Picker`, `StateWords`, `Callout` (held to a reading measure), `Disclosure`, `Details`
// (identifiers on request), `keyWords`, `lectureNameOf`, `Lead`, `Facts` / `Fact`.
// They belong in components/ui.tsx; they are here because that file was not this stream's to edit.
import { useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { Select as RSelect } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { courseName, useApp } from "@/app/state";
import { ErrorGlyph } from "@/components/glyphs";
import { Callout as BaseCallout, cn, Dialog, EmptyState, SectionToggle, Segmented, type Tone } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { countLabel } from "@/lib/labels";
import { hitHref, searchIndexes, TYPE_LABEL } from "@/lib/search";
import type { SearchIndex } from "@/lib/types";

export function SearchOverlay() {
  const app = useApp();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"course" | "all">("course");
  const courseIds = useMemo(() => {
    const bound = (app.workspace?.courses ?? []).filter((c) => c.binding === "bound").map((c) => c.course_id);
    return scope === "all" ? bound : bound.filter((c) => c === app.courseId);
  }, [app.workspace, app.courseId, scope]);
  const indexes = useQueries({
    queries: courseIds.map((courseId) => ({ queryKey: ["search-index", courseId], queryFn: () => apiGet<SearchIndex>(`courses/${courseId}/search-index`), enabled: app.searchOpen, staleTime: 30_000, retry: false })),
  });
  const loaded = indexes.map((q) => q.data).filter((d): d is SearchIndex => !!d);
  const failed = indexes.filter((q) => q.isError).length;
  const results = useMemo(() => searchIndexes(loaded, query), [loaded, query]);
  const unindexed = loaded.flatMap((index) => index.unindexed.map((u) => ({ ...u, course: index.display_name })));
  const close = () => app.setSearchOpen(false);

  return (
    <Dialog open={app.searchOpen} onOpenChange={app.setSearchOpen} title="Search" description="Searches slide text, transcripts, questions, concepts and source names. Answer keys are never searched." wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* No magnifier here: the header's search button is the one magnifier of a screen. */}
          <input autoFocus type="search" className="ll-input min-w-[14rem] flex-1 text-read" placeholder="Term or question…" aria-label="Search query" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Segmented label="Search scope" value={scope} onChange={setScope} options={[{ value: "course", label: courseName(app.workspace, app.courseId) }, { value: "all", label: "All my courses" }]} />
        </div>
        {failed > 0 && <p role="alert" className="ll-err"><ErrorGlyph /><span>{countLabel(failed, "course index", "course indexes")} could not be read right now; results may be incomplete.</span></p>}
        {query.trim().length < 2 ? (
          <p className="text-ui text-muted">Type at least two characters. Scope: <strong className="font-semibold text-ink">{scope === "course" ? courseName(app.workspace, app.courseId) : "all bound courses"}</strong>.</p>
        ) : results.hits.length === 0 ? (
          <EmptyState title="No matches in the indexed material">
            <p>Nothing indexed contains every word you typed. Try fewer words{scope === "course" ? " or search all your courses" : ""}.</p>
            {unindexed.length > 0 && (
              <div className="mt-3">
                <p className="font-semibold text-ink">Not searchable yet ({unindexed.length}) — this is a preparation gap, not an empty source:</p>
                <ul className="mt-1 list-disc pl-5">
                  {unindexed.slice(0, 6).map((u) => <li key={u.course + u.what}>{u.what}: {u.reason}</li>)}
                </ul>
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            <p className="text-ui text-muted" role="status">
              Showing {results.hits.length} of {results.total} match{results.total === 1 ? "" : "es"}{results.truncated ? " (bounded — refine the query to narrow it)" : ""}.
            </p>
            <ul className="-mx-2 flex flex-col" aria-label="Search results">
              {results.hits.map((hit, i) => (
                <li key={`${hit.courseId}-${hit.entry.type}-${i}`} className="border-t border-hairline first:border-t-0">
                  <Link to={hitHref(hit)} state={{ returnTo: location.pathname + location.search, returnLabel: "Return to where you were" }} onClick={close}
                    className="flex flex-col gap-0.5 rounded-row px-2 py-3 transition-colors duration-[var(--ll-motion-small)] hover:bg-pad">
                    <span className="text-ui text-muted">{TYPE_LABEL[hit.entry.type]}{scope === "all" && <> · {hit.courseName}</>}</span>
                    <span className="font-semibold">{hit.entry.title}</span>
                    <span className="ll-measure text-ui text-muted">{hit.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** "Return to slide" link shown on pages reached from search or a related-material jump. */
export function ReturnLink() {
  const location = useLocation();
  const state = location.state as { returnTo?: string; returnLabel?: string } | null;
  if (!state?.returnTo) return null;
  return <Link to={state.returnTo} className="ll-btn ll-btn-sm mb-4">← {state.returnLabel ?? "Return"}</Link>;
}

// ---- shared by the pages that keep their layout ------------------------------------------------------------------------------

/**
 * The one page column of every browsing page. It is the column of the Study home (design specification 6): the full
 * width under 1200 px, then 1280, 1400 and 1760 px including 48 px of side padding, 24 of which are the shell's. With
 * it a page title stands in the same place whichever rail item is open. A test holds it, class for class, to the
 * constant the Study home states for itself.
 */
export const PAGE_COLUMN = "mx-auto w-full pb-6 max-[899px]:pt-2 min-[1200px]:max-w-[1232px] min-[1200px]:px-6 min-[1200px]:pt-2 min-[1920px]:max-w-[1352px] min-[1920px]:pt-6 min-[2400px]:max-w-[1712px]";
/** What a reading page holds: capped to a measure and kept on the column's left edge, never centred apart from it. */
const READING_WIDTH = "max-w-[56rem] min-[1920px]:max-w-[64rem]";

/**
 * A page in the page column. A reading page (one record, one task) is the same column with what it holds capped to a
 * measure, so its title starts where every other page's title starts. `className` arranges what the page holds.
 */
export function Page({ reading = false, className, testId, children }: { reading?: boolean; className?: string; testId?: string; children: ReactNode }) {
  if (!reading) return <div className={cn(PAGE_COLUMN, className)} data-testid={testId}>{children}</div>;
  return <div className={PAGE_COLUMN} data-testid={testId}><div className={cn(READING_WIDTH, className)}>{children}</div></div>;
}

/** A key as words that start with a capital ("raw_teachback_audio" → "Raw teachback audio"): for a heading whose only name is its key. */
export function keyWords(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}

/**
 * One choice of many, where a segmented control would not fit (a filter with long options, a size from 1 to 25). It
 * replaces the native select: a pad button showing the chosen option, and a popover list (Radix Select: a combobox
 * with a listbox, type-ahead and arrow keys). `label` is its accessible name; say the same word beside it when the
 * place needs a visible label.
 */
export function Picker<T extends string>({ label, value, onChange, options, className, testId, disabled }: {
  label: string; value: T; onChange: (value: T) => void; options: ReadonlyArray<{ value: T; label: string }>; className?: string; testId?: string; disabled?: boolean;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <RSelect.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <RSelect.Trigger aria-label={label} data-testid={testId} data-value={value}
        className={cn("inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-control border-0 bg-pad px-3 py-1.5 text-left text-ui text-ink transition-colors duration-[var(--ll-motion-small)]",
          "hover:bg-pad-strong data-[state=open]:bg-pad-strong disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--ll-hairline)] [@media(pointer:coarse)]:min-h-11", className)}>
        <span className="min-w-0"><RSelect.Value>{chosen?.label ?? value}</RSelect.Value></span>
        <RSelect.Icon asChild><ChevronDown aria-hidden className="size-4 flex-none text-muted" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" align="start" sideOffset={6} className="ll-pop z-50 max-h-[min(60dvh,24rem)] min-w-[var(--radix-select-trigger-width)] max-w-[min(92vw,32rem)] overflow-hidden">
          <RSelect.Viewport className="p-1.5">
            {options.map((option) => (
              <RSelect.Item key={option.value} value={option.value} className="ll-menu-item justify-between outline-none">
                <RSelect.ItemText>{option.label}</RSelect.ItemText>
                <RSelect.ItemIndicator><Check aria-hidden className="size-4 flex-none" /></RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/**
 * A state that is neither an evidence state (those are `StateLabel`, a ring) nor the basis of a link (`BasisLabel`, a
 * square): the state of a file, of a session, of a selection. It is said in words. Only an error carries a glyph, the
 * triangle. Never a pill, and no colour carries the state. `detail` explains the state on request (a tooltip).
 */
export function StateWords({ tone = "neutral", children, detail, className }: { tone?: Tone; children: ReactNode; detail?: string | null; className?: string }) {
  if (tone === "danger") return <span className={cn("ll-err", className)} title={detail || undefined}><ErrorGlyph /><span>{children}</span></span>;
  return <span className={cn("text-ui", tone === "unassessed" ? "text-muted" : "text-ink", className)} title={detail || undefined}>{children}</span>;
}

/**
 * A note in the flow of a page (the `Callout` of components/ui), held to a reading measure: on a wide page its
 * sentences would otherwise run to twice the eighty characters a line of prose may have.
 */
export function Callout({ className, ...rest }: ComponentProps<typeof BaseCallout>) {
  return <BaseCallout {...rest} className={cn("max-w-[36rem]", className)} />;
}

/**
 * Detail that opens on request: the text button with a chevron of components/ui (`SectionToggle`) and, once opened,
 * what it holds. It replaces the native details element, whose marker belongs to the browser and not to this system.
 * Closed at first; the content is not in the page until it is opened.
 */
export function Disclosure({ title, count, children, className, bodyClassName, defaultOpen = false }: {
  title: ReactNode; count?: number; children: ReactNode; className?: string; bodyClassName?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = useId();
  return (
    <div className={className}>
      <SectionToggle aria-expanded={open} aria-controls={open ? body : undefined} count={count} className="text-ui" onClick={() => setOpen((value) => !value)}>{title}</SectionToggle>
      {open && <div id={body} className={bodyClassName}>{children}</div>}
    </div>
  );
}

/**
 * The identifiers of a record (an attempt, a file version, a catalog entry), on request: a closed "Details" that holds
 * them as terms and values the learner can select. A sentence or a heading says the thing in words; its identifier
 * stays here for the day it is needed. A row with nothing to state is left out, and with no row nothing is drawn.
 */
export function Details({ rows, className }: { rows: ReadonlyArray<readonly [term: string, value: ReactNode]>; className?: string }) {
  const stated = rows.filter(([, value]) => value !== null && value !== undefined && value !== false && value !== "");
  if (stated.length === 0) return null;
  return (
    <Disclosure title="Details" className={cn("text-ui", className)} bodyClassName="pb-1 pt-1">
      <Facts className="text-muted">{stated.map(([term, value]) => <Fact key={term} term={term}><span className="select-all break-all">{value}</span></Fact>)}</Facts>
    </Disclosure>
  );
}

/** A lecture's own title where the course lists it; its identifier otherwise. No title is made up. */
export function lectureNameOf(course: { lectures?: ReadonlyArray<{ lecture_id: string; title?: string | null }> } | null | undefined, lectureId: string): string {
  return course?.lectures?.find((lecture) => lecture.lecture_id === lectureId)?.title || lectureId;
}

/** The sentence under a page title, held to the reading measure. */
export function Lead({ children }: { children: ReactNode }) {
  return <span className="ll-measure block">{children}</span>;
}

/** Facts as terms and values: two columns from 600 px, stacked below. A term is a word or two; the value may be a sentence. */
export function Facts({ children, label, className, testId }: { children: ReactNode; label?: string; className?: string; testId?: string }) {
  return <dl aria-label={label} data-testid={testId} className={cn("grid grid-cols-[minmax(6.5rem,max-content)_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-ui max-[599px]:grid-cols-1 max-[599px]:gap-y-0", className)}>{children}</dl>;
}
export function Fact({ term, children, testId }: { term: string; children: ReactNode; testId?: string }) {
  return (
    <div className="contents max-[599px]:[&:not(:first-child)>dt]:mt-2">
      <dt className="text-muted">{term}</dt>
      <dd className="min-w-0 max-w-[68ch] break-words" data-testid={testId}>{children}</dd>
    </div>
  );
}
