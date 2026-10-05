// Question lists (R1-Q1/Q1b/Q2): the course question bank and a lecture's "All lecture questions".
// Membership comes from the course catalog's own collections. A slide is named only where the catalog names one;
// a question without a slide is still a lecture question. Lists load in steps and always state the true total.
import { useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useApp } from "@/app/state";
import { Button, Callout, EmptyState, ErrorState, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { useCourse, useQuestionBank } from "@/lib/queries";
import type { LectureView, QuestionAnchor, QuestionRow } from "@/lib/types";

const rangesText = (ranges: Array<[number, number]>) => ranges.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");

/** Where the catalog says a question points, in words, without claiming more than the catalog does. */
export function anchorSummary(row: Pick<QuestionRow, "anchors" | "anchor_state" | "slide_anchor" | "locator_text">): { text: string; tone: "neutral" | "unassessed" | "caution" } {
  const slides = row.anchors.filter((a) => a.kind === "pages" && a.lecture_id && !a.named_source && a.from === "locator");
  const lines = row.anchors.filter((a) => a.kind === "transcript_lines");
  const pages = row.anchors.filter((a) => a.kind === "pages" && !slides.includes(a));
  const parts: string[] = [];
  if (slides.length) parts.push(`slides ${slides.map((a) => rangesText(a.ranges)).join(", ")}${slides.some((a) => a.basis === "stated") ? " (as stated; page numbers not yet confirmed)" : ""}`);
  if (pages.length) parts.push(`page ${pages.map((a) => rangesText(a.ranges)).join(", ")} of ${pages.some((a) => a.named_source) ? "the question sheet" : "its source"}`);
  if (lines.length) parts.push(`transcript lines ${lines.map((a) => rangesText(a.ranges)).join(", ")}`);
  if (!parts.length) return { text: "No slide is named in the course record for this question.", tone: "unassessed" };
  return { text: `Course record: ${parts.join(" · ")}`, tone: slides.length ? "neutral" : "unassessed" };
}

const pagesOn = (anchors: QuestionAnchor[], deckId: string | null | undefined) => anchors.filter((a) => a.kind === "pages" && a.source_id === deckId).flatMap((a) => a.pages ?? []);

export function QuestionListItem({ courseId, row, children, onGoToPage, deckId }: { courseId: string; row: QuestionRow; children?: React.ReactNode; onGoToPage?: (page: number) => void; deckId?: string | null }) {
  const location = useLocation();
  const back = { returnTo: location.pathname + location.search, returnLabel: "Return" };
  const summary = anchorSummary(row);
  const slidePages = onGoToPage ? [...new Set(pagesOn(row.anchors, deckId))].sort((a, b) => a - b) : [];
  return (
    <li className="ll-card flex flex-col gap-1 p-3" data-testid="question-row" data-question-id={row.question_id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link className="min-w-0 font-semibold hover:underline" to={`/courses/${courseId}/questions/${encodeURIComponent(row.question_id)}`} state={back}>{row.title ?? row.question_id}</Link>
        <span className="text-sm text-muted">{row.question_id}</span>
      </div>
      <p className="ll-measure">{row.prompt_in_index ? row.prompt : "Wording is in the original source; open the question to read it there."}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {row.collection && <StatusChip tone="neutral">{row.collection}</StatusChip>}
        <StatusChip tone="neutral">{row.origin === "course_source" ? "From course material" : "Generated practice"}</StatusChip>
        {!row.prompt_in_index && <StatusChip tone="unassessed">Read in the original</StatusChip>}
      </div>
      <p className="text-sm text-muted" data-testid="question-anchor">{summary.text}</p>
      {slidePages.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted">Go to slide</span>
          {slidePages.slice(0, 12).map((page) => <button key={page} type="button" className="ll-chip hover:underline" onClick={() => onGoToPage!(page)}>{page}</button>)}
          {slidePages.length > 12 && <span className="text-muted">and {slidePages.length - 12} more</span>}
        </p>
      )}
      {children}
    </li>
  );
}

const STEP = 20;

/** Context-panel tab: every question of the lecture's collections, then questions reached through a relationship. */
export function LectureQuestionsPanel({ courseId, lecture, onGoToPage }: { courseId: string; lecture: LectureView; onGoToPage: (page: number) => void }) {
  const [shown, setShown] = useState(STEP);
  const [find, setFind] = useState("");
  const all = lecture.questions.all;
  const matching = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return needle ? all.filter((q) => `${q.question_id} ${q.title ?? ""} ${q.prompt}`.toLowerCase().includes(needle)) : all;
  }, [all, find]);
  const related = lecture.questions.related_by_relationship;
  return (
    <div className="flex flex-col gap-4" data-testid="lecture-questions">
      <section aria-labelledby="lq-all">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 id="lq-all" className="ll-label">All lecture questions ({all.length})</h3>
          <span className="flex gap-3 text-sm"><Link className="text-accent hover:underline" to={`/courses/${courseId}/outline?scope=${encodeURIComponent(`lecture:${lecture.lecture_id}`)}`}>Concept outline</Link>
            <Link className="text-accent hover:underline" to={`/courses/${courseId}/questions?lecture=${encodeURIComponent(lecture.lecture_id)}`}>Open in the question bank</Link></span>
        </div>
        {lecture.questions.gap ? (
          <Callout tone="unassessed" title="No question collection for this lecture">{lecture.questions.gap} Nothing was generated to fill the gap.</Callout>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              {lecture.questions.collections.map((c) => `${c.collection}: ${c.count}`).join(" · ")}. These belong to this lecture because the course catalog ties their collection to this unit's files.
              {lecture.questions.collections.some((c) => c.anchor_unresolved > 0) ? " Some name no slide: they are listed here and on no slide." : ""}
            </p>
            {all.length > STEP && <input type="search" className="ll-input mb-2" placeholder="Find a question in this lecture" aria-label="Find a question in this lecture" value={find} onChange={(e) => { setFind(e.target.value); setShown(STEP); }} />}
            <ul className="flex flex-col gap-2">
              {matching.slice(0, shown).map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} onGoToPage={onGoToPage} deckId={lecture.deck?.source_id} />)}
            </ul>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="lecture-questions-count">
              Showing {Math.min(shown, matching.length)} of {matching.length}{matching.length !== all.length ? ` matching (${all.length} in this lecture)` : ""}
              {shown < matching.length && <Button size="sm" onClick={() => setShown((n) => n + STEP)}>Show {Math.min(STEP, matching.length - shown)} more</Button>}
            </p>
          </>
        )}
      </section>
      {related.length > 0 && (
        <section aria-labelledby="lq-related">
          <h3 id="lq-related" className="ll-label mb-1">Related through another question ({related.length})</h3>
          <p className="mb-2 text-sm text-muted">Not part of this lecture's collections. The course catalog relates each to one of this lecture's questions; a relation is context and grants no credit.</p>
          <ul className="flex flex-col gap-2">
            {related.map((row) => (
              <QuestionListItem key={row.question_id} courseId={courseId} row={row}>
                <p className="text-sm text-muted">{(row.via ?? []).map((v) => `${v.relation.replace(/_/g, " ")} ${v.direction === "from_lecture_question" ? "of" : "for"} ${v.question_id}`).join(" · ")}</p>
              </QuestionListItem>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** SC: course question bank. Every catalogued question, by collection, with real totals, search and filters. */
export function QuestionBankPage() {
  const { courseId = "" } = useParams();
  const app = useApp();
  const [params, setParams] = useSearchParams();
  const course = useCourse(courseId);
  const filter = { collection: params.get("collection") ?? undefined, lecture: params.get("lecture") ?? undefined, q: params.get("q") ?? undefined, origin: params.get("origin") ?? undefined, anchor: params.get("anchor") ?? undefined };
  const bank = useQuestionBank(courseId, filter);
  const [text, setText] = useState(filter.q ?? "");
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  if (bank.isLoading) return <LoadingState label="Loading questions…" />;
  if (bank.isError || !bank.data) return <ErrorState error={bank.error} retry={() => void bank.refetch()} />;
  const first = bank.data.pages[0]!;
  const rows = bank.data.pages.flatMap((p) => p.items);
  const filtered = Object.values(filter).some(Boolean);
  const lectureRow = filter.lecture ? first.lectures.find((l) => l.lecture_id === filter.lecture) : null;
  return (
    <div className="ll-page" data-testid="question-bank">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
        <Link to="/study" className="hover:underline">Courses</Link> › <Link to={`/courses/${courseId}`} className="hover:underline">{course.data?.display_name ?? courseId.toUpperCase()}</Link> › <span aria-current="page">Questions</span>
      </nav>
      <PageHeader title="Question bank" subtitle={<span data-testid="bank-total">{first.total} question{first.total === 1 ? "" : "s"} in the course catalog{filtered ? ` · ${first.matching} match the filters` : ""}</span>}
        actions={<Link className="ll-btn ll-btn-sm" to="/review" onClick={() => app.setCourseId(courseId)}>Review</Link>} />
      {first.total === 0 ? <EmptyState title="This course has no question catalog">Nothing is generated in its place. Slides, transcripts and the tutor remain available.</EmptyState> : (
        <>
          <section aria-label="Collections" className="mb-4">
            <ul className="ll-card-grid">
              {first.collections.map((c) => {
                const on = filter.collection === c.collection;
                return (
                  <li key={c.collection}>
                    <button type="button" aria-pressed={on} onClick={() => set("collection", on ? "" : c.collection)} className={`ll-card flex w-full flex-col gap-0.5 p-3 text-left hover:bg-raised ${on ? "outline outline-2 outline-accent" : ""}`}>
                      <span className="flex items-baseline justify-between gap-2"><span className="font-semibold">{c.collection}</span><span className="tabular-nums">{c.count}</span></span>
                      <span className="text-sm text-muted">
                        {(c.lecture_ids ?? []).length ? (c.lecture_ids ?? []).map((l) => l.replace("-", " ")).join(", ") : "not tied to a lecture unit"}
                        {c.without_wording ? ` · ${c.without_wording} read in the original` : ""}{c.anchor_unresolved ? ` · ${c.anchor_unresolved} name no location` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <form className="mb-3 flex flex-wrap items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); set("q", text.trim()); }}>
            <input type="search" className="ll-input max-w-sm" placeholder="Search by id, title or wording" aria-label="Search questions" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit">Search</Button>
            <select className="ll-input w-auto" aria-label="Lecture" value={filter.lecture ?? ""} onChange={(e) => set("lecture", e.target.value)}>
              <option value="">Any lecture</option>
              {first.lectures.map((l) => <option key={l.lecture_id} value={l.lecture_id}>{l.title ?? l.lecture_id} ({l.count})</option>)}
            </select>
            <select className="ll-input w-auto" aria-label="Origin" value={filter.origin ?? ""} onChange={(e) => set("origin", e.target.value)}>
              <option value="">Any origin</option>
              <option value="course_source">From course material</option>
              <option value="generated_practice">Generated practice</option>
            </select>
            <select className="ll-input w-auto" aria-label="Slide reference" value={filter.anchor ?? ""} onChange={(e) => set("anchor", e.target.value)}>
              <option value="">Any slide reference</option>
              <option value="slide_named">Names a slide</option>
              <option value="no_slide">Names no slide</option>
              <option value="unresolved">No location in the record</option>
            </select>
            {filtered && <Button variant="quiet" onClick={() => { setText(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>}
          </form>
          {lectureRow?.gap && <Callout tone="unassessed" className="mb-3" title="No question collection for this lecture">{lectureRow.gap} Nothing was generated to fill the gap.</Callout>}
          {rows.length === 0 ? <EmptyState title="No question matches these filters">The catalog still holds {first.total}; clear a filter to see them.</EmptyState> : (
            <ul className="flex flex-col gap-2">{rows.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} />)}</ul>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="bank-count">
            Showing {rows.length} of {first.matching}{filtered ? ` matching (${first.total} in the catalog)` : ""}
            {bank.hasNextPage && <Button size="sm" busy={bank.isFetchingNextPage} onClick={() => void bank.fetchNextPage()}>Show more</Button>}
          </p>
          {first.guidance.errors.length > 0 && (
            <Callout tone="caution" className="mt-3" title="Some assessor guidance entries could not be matched">
              {first.guidance.errors.length} entr{first.guidance.errors.length === 1 ? "y" : "ies"} in the course's guidance files {first.guidance.errors.length === 1 ? "is" : "are"} not used ({[...new Set(first.guidance.errors.map((e) => e.code.replace(/_/g, " ")))].join(", ")}). Questions stay available; those answers are assessed without that guidance.
            </Callout>
          )}
          <p className="ll-measure mt-3 text-sm text-muted">{first.note}</p>
        </>
      )}
    </div>
  );
}
