// Course browsing on the Study home (design specification 6): the configured courses as ONE vertical tab list, joined to
// the pane of the chosen course (its name, one sentence of real totals, Concept map and Question bank, its lectures as
// rows). Under 900 px the courses come first as compact rows and the chosen course's pane opens beneath them.
//
// A lecture row: the first page of the lecture's displayed deck (rendered lazily by lib/thumbs; a flat neutral block
// until it exists and when there is no deck), "Lecture 03", the title (wraps, never cut), one line of facts that breaks
// only between facts, and "You left this at page N" on the one row it applies to. No card, no pill, no all-caps label.
import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { Tabs } from "radix-ui";
import { Bookmark, Network } from "lucide-react";
import { Callout, cn, ErrorState, Skeleton } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { factsLine } from "@/lib/format";
import { R2_ACTION, nb } from "@/lib/labels";
import { useNearViewport, useThumb } from "@/lib/thumbs";
import type { CourseLecture, CourseView, WorkspaceCourse } from "@/lib/types";
import {
  NO_LECTURES_SENTENCE, courseCounts, lectureDeckContent, lectureFacts, lectureKicker, lectureShortName, slidesProblem, unlinkedRecordingCount, unlinkedSessionsSentence, type TimingLectureRow,
} from "./study-facts";

/** The widest a row thumbnail is drawn (from 1920 px); narrower rows scale the same picture down. */
const ROW_THUMB_WIDTH = 112;
const ROW_GRID = "grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 p-2 min-[600px]:grid-cols-[96px_minmax(0,1fr)] min-[600px]:gap-4 min-[600px]:p-3 min-[1920px]:grid-cols-[112px_minmax(0,1fr)]";
const LECTURE_GRID = cn(
  "grid grid-cols-1 gap-x-3 gap-y-1 p-2 min-[600px]:p-3",
  "min-[600px]:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]",
  "min-[900px]:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]",
  "min-[2400px]:grid-cols-[repeat(auto-fill,minmax(400px,1fr))]",
  // enlarged text: the columns grow with the text, so a row keeps room for its facts
  "[html[data-text-scale=large]_&]:grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]",
);

// ---- the course tabs ---------------------------------------------------------------------------------------------------------
export interface CourseTabItem {
  courseId: string;
  name: string;
  /** Where the course was left, or the state that needs the learner (study-facts `courseTabLine`). */
  line: string;
}

/**
 * The courses as one tab list (Radix Tabs, vertical; arrow keys move, Enter or Space chooses). The chosen course is
 * drawn with the selection idiom: tint, a 3 px accent bar, the name in accent text.
 */
export function CourseTabs({ items, chosen }: { items: readonly CourseTabItem[]; chosen: string | null }) {
  return (
    <Tabs.List aria-label="Courses" data-testid="course-tabs"
      className="grid content-start gap-0.5 max-[899px]:grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] max-[899px]:gap-x-3 [html[data-text-scale=large]_&]:grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] [html[data-text-scale=large]_&]:gap-x-3">
      {items.map((item) => {
        const selected = item.courseId === chosen;
        return (
          <Tabs.Trigger key={item.courseId} value={item.courseId} data-course={item.courseId}
            className={cn("relative grid min-h-14 content-center gap-0 rounded-control border-0 bg-transparent px-3 py-1.5 text-left transition-colors duration-[var(--ll-motion-small)]",
              "min-[900px]:content-start min-[900px]:gap-0.5 min-[900px]:px-4 min-[900px]:py-3",
              selected ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad")}>
            {selected && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r-[3px] bg-accent-text" />}
            <span className={cn("text-read leading-snug [overflow-wrap:anywhere]", selected ? "font-semibold text-accent-text" : "text-ink")}>{item.name}</span>
            <span className={cn("ll-num text-ui", selected ? "text-ink" : "text-muted")}>{item.line}</span>
          </Tabs.Trigger>
        );
      })}
    </Tabs.List>
  );
}

// ---- a lecture row --------------------------------------------------------------------------------------------------------------
/** The first page of the lecture's deck once the row is near the viewport; until then, and without a deck, a flat neutral block. */
function LectureThumb({ url, noDeck, current }: { url: string | null; noDeck: boolean; current: boolean }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const { thumb } = useThumb(url, 1, ROW_THUMB_WIDTH, near);
  const ring = current && "shadow-[0_0_0_2px_var(--ll-accent-text)]";
  if (thumb) {
    return (
      <span ref={ref} className={cn("ll-thumb", ring)} data-current={current ? "true" : undefined}>
        <img src={thumb.src} alt="" width={thumb.width} height={thumb.height} decoding="async" draggable={false} />
      </span>
    );
  }
  return (
    <span ref={ref} className={cn("block overflow-hidden rounded-thumb", ring)} data-thumb="placeholder">
      <span className="ll-thumb-ph rounded-none">{noDeck ? nb("No slides") : null}</span>
    </span>
  );
}

export interface LectureRowProps {
  courseId: string;
  lecture: CourseLecture;
  /** The lecture's row of `GET …/timing`; absent from an older Brain and while it loads. */
  timing?: TimingLectureRow | null;
  /** The page this lecture was left at on this device; null on every other row. */
  leftAt: number | null;
  unlinkedRecordings?: number;
}

export function LectureRow({ courseId, lecture, timing, leftAt, unlinkedRecordings = 0 }: LectureRowProps) {
  const id = useId();
  const kicker = lectureKicker(lecture.lecture_id, lecture.title);
  const content = lectureDeckContent(courseId, lecture);
  const problem = slidesProblem(lecture);
  const base = `/courses/${encodeURIComponent(courseId)}/lectures/${encodeURIComponent(lecture.lecture_id)}`;
  return (
    <li data-testid="lecture-row" data-lecture={lecture.lecture_id}>
      <Link to={leftAt ? `${base}?page=${leftAt}` : base} aria-labelledby={`${kicker ? `${id}-k ` : ""}${id}-t`} aria-describedby={`${id}-f`}
        className={cn(ROW_GRID, "h-full rounded-control text-ink no-underline transition-colors duration-[var(--ll-motion-small)] hover:bg-pad")}>
        <LectureThumb url={content ? contentUrl(content) : null} noDeck={!lecture.deck} current={leftAt !== null} />
        <span className="grid min-w-0">
          {kicker && <span id={`${id}-k`} className="text-ui font-semibold text-muted">{kicker}</span>}
          <span id={`${id}-t`} className="text-read font-semibold leading-snug [overflow-wrap:anywhere]">{lecture.title}</span>
          <span id={`${id}-f`} className="mt-0.5 grid">
            <span className="ll-num text-ui text-muted [overflow-wrap:anywhere]">{factsLine(lectureFacts(lecture, timing, { unlinkedRecordings }))}</span>
            {problem && <span className="text-ui text-muted">{problem}</span>}
            {leftAt !== null && (
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-ui font-semibold text-accent-text">
                <Bookmark aria-hidden className="size-3.5 flex-none" strokeWidth={2} />
                <span>You left this at {nb(`page ${leftAt}`)}</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function RowSkeletons({ rows = 6 }: { rows?: number }) {
  return (
    <ul className={LECTURE_GRID} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={ROW_GRID}>
          <Skeleton className="aspect-[4/3] w-full" />
          <span className="grid gap-1.5">
            <Skeleton height={14} width="40%" />
            <Skeleton height={16} width="85%" />
            <Skeleton height={14} width="70%" />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- the pane of the chosen course -----------------------------------------------------------------------------------------------
export interface CoursePaneProps {
  course: WorkspaceCourse;
  /** The course view; undefined while it loads. */
  view: CourseView | undefined;
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  /** Lectures of `GET …/timing` by lecture id; empty for an older Brain and while it loads. */
  timing: ReadonlyMap<string, TimingLectureRow>;
  /** The lecture and page left on this device in this course; null when nothing was opened. */
  leftAt: { lectureId: string; page: number } | null;
  /** Lines that need the learner or that another device left (a position conflict, a later synchronised place). */
  notices?: ReactNode;
  /** Chooses this course as the active one before following a link that depends on it (the Library). */
  onActivate?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

const PANE_NOTE = "px-4 pb-1 pt-3 text-ui text-muted min-[600px]:px-6";

export function CoursePane({ course, view, loading, error, onRetry, timing, leftAt, notices, onActivate, headingRef }: CoursePaneProps) {
  const bound = course.binding === "bound";
  const id = encodeURIComponent(course.course_id);
  const lectures = view?.lectures ?? [];
  const unlinked = view ? unlinkedSessionsSentence(view) : null;
  const unlinkedRecordings = unlinkedRecordingCount(view);
  const counts = courseCounts(course, view);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-hairline p-4 min-[600px]:pl-6">
        <div className="min-w-0">
          <h3 ref={headingRef} className="scroll-mt-3 text-title font-semibold [overflow-wrap:anywhere]" data-testid="course-name">{course.display_name}</h3>
          {bound && counts.length > 0 && <p className="ll-num mt-0.5 text-ui text-muted" data-testid="course-counts">{factsLine(counts)}.</p>}
        </div>
        {bound && (
          <div className="flex gap-2 max-[599px]:w-full">
            <Link to={`/courses/${id}/concepts`} className="ll-btn ll-btn-sm max-[599px]:flex-1"><Network aria-hidden />{R2_ACTION.concept_map}</Link>
            <Link to={`/courses/${id}/questions`} className="ll-btn ll-btn-sm max-[599px]:flex-1">Question bank</Link>
          </div>
        )}
      </div>
      {!bound ? (
        <div className="p-4 min-[600px]:px-6">
          <Callout tone="danger" title="This course is not bound">{course.problem} Other courses are unaffected.</Callout>
        </div>
      ) : (
        <>
          {notices}
          {view && view.index.status !== "ok" && (
            <div className="px-4 pt-3 min-[600px]:px-6">
              <Callout tone="caution" title="The course's published source index could not be trusted right now">{view.index.reason} Files on disk are still listed; registration details are temporarily unavailable.</Callout>
            </div>
          )}
          {loading ? <div role="status"><span className="sr-only">Loading lectures…</span><RowSkeletons /></div>
            : error || !view ? <ErrorState className="px-4 min-[600px]:px-6" error={error} retry={onRetry} title="The lectures of this course could not be loaded" stillWorks="The other courses are not affected." />
            : lectures.length === 0 ? <p className="p-4 text-read text-muted min-[600px]:px-6">{NO_LECTURES_SENTENCE}</p>
            : (
              <ul className={LECTURE_GRID} aria-label={`Lectures of ${course.display_name}`}>
                {lectures.map((lecture) => (
                  <LectureRow key={lecture.lecture_id} courseId={course.course_id} lecture={lecture} timing={timing.get(lecture.lecture_id) ?? null}
                    leftAt={leftAt && leftAt.lectureId === lecture.lecture_id ? leftAt.page : null} unlinkedRecordings={unlinkedRecordings} />
                ))}
              </ul>
            )}
          {unlinked && (
            <p className={cn(PANE_NOTE, "max-w-[76ch] pb-4 pt-1")} data-testid="unlinked-sessions">
              {unlinked} {view && view.unlinked_sessions.length === 1 ? "It is" : "They are"} listed in the <Link to="/sources" onClick={onActivate} className="ll-link">Library</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}

/** A line of the pane that points at a place another device left (the synchronised position of a finished session). */
export function SynchronisedPlaceLine({ courseId, lectureId, title, page, when }: { courseId: string; lectureId: string; title?: string | null; page: number; when: string }) {
  return (
    <p className={PANE_NOTE} data-testid="synchronised-place">
      A session finished {when} stopped at{" "}
      <Link className="ll-link" to={`/courses/${encodeURIComponent(courseId)}/lectures/${encodeURIComponent(lectureId)}?page=${page}`}>{lectureShortName(lectureId, title)}, {nb(`page ${page}`)}</Link>.
    </p>
  );
}
