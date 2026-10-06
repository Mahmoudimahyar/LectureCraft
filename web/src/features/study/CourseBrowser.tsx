// Course browsing on the Study home (design specification 6): the configured courses as ONE vertical tab list, joined to
// the pane of the chosen course (its name, one sentence of real totals, Concept map and Question bank, its lectures as
// rows). Under 900 px the courses come first as compact rows and the chosen course's pane opens beneath them.
//
// A lecture row: the first page of the lecture's displayed deck (rendered lazily by lib/thumbs; a flat neutral block
// until it exists and when there is no deck), ONE title line (the title, led by "Lecture 03" where the title does not
// say the number itself, so every row has the same two lines), one line of facts that breaks only between facts, and
// "You left this at page N" on the one row it applies to. No card, no pill, no all-caps label.
//
// Nothing here moves when something arrives: a row is never lower than its 4:3 placeholder, a picture of another shape
// is centred in that place, the skeleton rows have the size of the rows that follow, and the words of the timing answer
// have a place kept for them. A block that waits pulses quietly (not under reduced motion); one that will stay empty does not.
import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { Tabs } from "radix-ui";
import { Bookmark, Network } from "lucide-react";
import { Callout, cn, ErrorState, Skeleton } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { factsLine } from "@/lib/format";
import { R2_ACTION, nb } from "@/lib/labels";
import { useNearViewport } from "@/lib/thumbs";
import type { CourseLecture, CourseView, WorkspaceCourse } from "@/lib/types";
import { usePagePicture } from "./study-data";
import {
  NO_LECTURES_SENTENCE, awaitsTimingFact, courseCounts, lectureDeckContent, lectureFacts, lectureHeading, lectureShortName, slidesProblem, unlinkedRecordingCount, unlinkedSessionsSentence,
  type TimingLectureRow,
} from "./study-facts";

/** A block that waits for something: a quiet pulse of its opacity. The app's reduced-motion rules end it at once. */
export const PULSE = "animate-pulse motion-reduce:animate-none";

/** The widest a row thumbnail is drawn (from 1920 px); narrower rows scale the same picture down. */
const ROW_THUMB_WIDTH = 160;
/** Width over height of the place a row keeps for its thumbnail (the placeholder's shape, specification 6). */
const THUMB_PLACE = 4 / 3;
// Thumbnail 80 px on a phone, 96 from 600 px, 128 from 1440 px and 160 from 1920 px: wide enough to tell real first pages apart.
const ROW_GRID = "grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 p-2 min-[600px]:grid-cols-[96px_minmax(0,1fr)] min-[600px]:gap-4 min-[600px]:p-3 min-[1440px]:grid-cols-[128px_minmax(0,1fr)] min-[1920px]:grid-cols-[160px_minmax(0,1fr)]";
/** The height of the 4:3 placeholder plus the row's padding at each thumbnail width: a 16:9 picture is centred in it and the row does not move. */
const ROW_MIN = "min-h-[76px] min-[600px]:min-h-[96px] min-[1440px]:min-h-[120px] min-[1920px]:min-h-[144px]";
const LECTURE_GRID = cn(
  "grid grid-cols-1 gap-x-3 gap-y-1 p-2 min-[600px]:p-3",
  "min-[600px]:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]",
  "min-[900px]:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]",
  // two columns of about 600 px on the widest windows: with a 160 px thumbnail a third column would leave the facts no room
  "min-[2400px]:grid-cols-[repeat(auto-fill,minmax(520px,1fr))]",
  // enlarged text: the columns grow with the text, so a row keeps room for its facts
  "[html[data-text-scale=large]_&]:grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]",
  // dark: a resting page at 90 % with its hairline ring (80 % read as a disabled page on real decks); full on hover, on focus and for the row you left
  "dark:[--ll-thumb-rest:0.9]",
);
const TAB_LIST = "grid content-start gap-0.5 max-[899px]:grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] max-[899px]:gap-x-3 [html[data-text-scale=large]_&]:grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] [html[data-text-scale=large]_&]:gap-x-3";
const TAB_BOX = "grid min-h-14 content-center gap-0 px-3 py-1.5 min-[900px]:content-start min-[900px]:gap-0.5 min-[900px]:px-4 min-[900px]:py-3";

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
    <Tabs.List aria-label="Courses" data-testid="course-tabs" className={TAB_LIST}>
      {items.map((item) => {
        const selected = item.courseId === chosen;
        return (
          <Tabs.Trigger key={item.courseId} value={item.courseId} data-course={item.courseId}
            className={cn(TAB_BOX, "relative rounded-control border-0 bg-transparent text-left transition-colors duration-[var(--ll-motion-small)]", selected ? "bg-tint hover:bg-tint-strong" : "hover:bg-pad")}>
            {selected && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r-[3px] bg-accent-text" />}
            <span className={cn("text-read leading-snug [overflow-wrap:anywhere]", selected ? "font-semibold text-accent-text" : "text-ink")}>{item.name}</span>
            <span className={cn("ll-num text-ui", selected ? "text-ink" : "text-muted")}>{item.line}</span>
          </Tabs.Trigger>
        );
      })}
    </Tabs.List>
  );
}

/**
 * A bar standing for one line of text. `className` is the text style of the line it stands for ("text-ui", "text-read
 * leading-snug"): the bar sits in a real line of that style, so it is exactly as high as the words that replace it.
 */
function LineSkeleton({ width, className }: { width: string; className: string }) {
  return <span className={cn("block", className)}><Skeleton className={cn("inline-block h-[0.7em] max-w-full align-baseline", PULSE)} width={width} /></span>;
}

/** The courses before their names are known (a first visit of this device): rows of the size of a course tab. */
export function CourseTabsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden data-testid="course-tabs-skeleton" className={TAB_LIST}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={TAB_BOX}>
          <LineSkeleton width={`${72 - (index % 3) * 12}%`} className="text-read leading-snug" />
          <LineSkeleton width="52%" className="text-ui" />
        </span>
      ))}
    </div>
  );
}

// ---- a lecture row --------------------------------------------------------------------------------------------------------------
/**
 * The first page of the lecture's deck once the row is near the viewport. Until the picture exists the place holds a flat
 * neutral block of 4:3, which pulses while a picture is on its way and is still when none will come (no deck, a deck that
 * cannot be drawn here, a file that could not be read).
 */
function LectureThumb({ url, noDeck, current, order }: { url: string | null; noDeck: boolean; current: boolean; order?: number }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const { thumb, state } = usePagePicture(url, 1, ROW_THUMB_WIDTH, near, order);
  const ring = current && "shadow-[0_0_0_2px_var(--ll-accent-text)]";
  if (thumb) {
    // A page narrower than the place (a portrait handout) is drawn as high as the place, never higher: the row keeps its height.
    const width = thumb.aspect > 0 && thumb.aspect < THUMB_PLACE ? `${(thumb.aspect / THUMB_PLACE) * 100}%` : "100%";
    return (
      <span ref={ref} className={cn("ll-thumb justify-self-center", ring)} style={{ width }} data-current={current ? "true" : undefined}>
        <img src={thumb.src} alt="" width={thumb.width} height={thumb.height} decoding="async" draggable={false} />
      </span>
    );
  }
  const waiting = state === "loading";
  return (
    <span ref={ref} className={cn("block overflow-hidden rounded-thumb", ring)} data-thumb="placeholder" data-state={waiting ? "loading" : "none"}>
      <span className={cn("ll-thumb-ph rounded-none", waiting && PULSE)}>{noDeck ? nb("No slides") : null}</span>
    </span>
  );
}

export interface LectureRowProps {
  courseId: string;
  lecture: CourseLecture;
  /** The lecture's row of `GET …/timing`; absent from an older Brain and while it loads. */
  timing?: TimingLectureRow | null;
  /** True while the timing answer is on its way: a row whose recording it will describe keeps a place for those words. */
  timingPending?: boolean;
  /** The page this lecture was left at on this device; null on every other row. */
  leftAt: number | null;
  unlinkedRecordings?: number;
  /** The row's place in its list (from 0): pictures asked for together then arrive from the top row down. */
  order?: number;
}

export function LectureRow({ courseId, lecture, timing, timingPending = false, leftAt, unlinkedRecordings = 0, order }: LectureRowProps) {
  const id = useId();
  const content = lectureDeckContent(courseId, lecture);
  const problem = slidesProblem(lecture);
  const facts = lectureFacts(lecture, timing, { unlinkedRecordings });
  const pending = timingPending && !timing && awaitsTimingFact(lecture);
  const base = `/courses/${encodeURIComponent(courseId)}/lectures/${encodeURIComponent(lecture.lecture_id)}`;
  return (
    <li data-testid="lecture-row" data-lecture={lecture.lecture_id}>
      <Link to={leftAt ? `${base}?page=${leftAt}` : base} aria-labelledby={`${id}-t`} aria-describedby={`${id}-f`}
        className={cn(ROW_GRID, ROW_MIN, "h-full rounded-control text-ink no-underline transition-colors duration-[var(--ll-motion-small)] hover:bg-pad")}>
        <LectureThumb url={content ? contentUrl(content) : null} noDeck={!lecture.deck} current={leftAt !== null} order={order} />
        <span className="grid min-w-0">
          <span id={`${id}-t`} className="text-read font-semibold leading-snug [overflow-wrap:anywhere]">{lectureHeading(lecture.lecture_id, lecture.title)}</span>
          <span id={`${id}-f`} className="mt-0.5 grid">
            <span className="ll-num text-ui text-muted [overflow-wrap:anywhere]">
              {pending ? (
                // The questions fact is the last one; the place stands where the length and the stage of the recording will be said.
                <>
                  {factsLine(facts.slice(0, -1))}
                  <span aria-hidden data-pending="timing">, <Skeleton className={cn("inline-block h-[0.7em] w-[18ch] max-w-full align-baseline", PULSE)} /></span>
                  , {factsLine(facts.slice(-1))}
                </>
              ) : factsLine(facts)}
            </span>
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

/** Rows of the size of the lecture rows that follow, as many as the course is known to have. */
function RowSkeletons({ rows = 6 }: { rows?: number }) {
  return (
    <ul className={LECTURE_GRID} aria-hidden>
      {Array.from({ length: Math.min(Math.max(rows, 1), 24) }, (_, index) => (
        <li key={index} className={cn(ROW_GRID, ROW_MIN)} data-skeleton="lecture-row">
          <Skeleton className={cn("aspect-[4/3] w-full", PULSE)} />
          <span className="grid">
            <LineSkeleton width={`${86 - (index % 3) * 14}%`} className="text-read leading-snug" />
            <LineSkeleton width="64%" className="mt-0.5 text-ui" />
          </span>
        </li>
      ))}
    </ul>
  );
}

const PANE_HEAD = "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-hairline p-4 min-[600px]:pl-6";

/** The pane before any course is known (a first visit of this device): its heading and its rows in grey, in their final sizes. */
export function CoursePaneSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden data-testid="course-pane-skeleton">
      <div className={PANE_HEAD}>
        <div className="min-w-0 flex-1">
          <LineSkeleton width="min(18rem, 70%)" className="text-title" />
          <LineSkeleton width="min(22rem, 90%)" className="mt-0.5 text-ui" />
        </div>
        <div className="flex gap-2 max-[599px]:w-full">
          <Skeleton className={cn("h-9 w-32 rounded-control max-[599px]:flex-1", PULSE)} />
          <Skeleton className={cn("h-9 w-32 rounded-control max-[599px]:flex-1", PULSE)} />
        </div>
      </div>
      <RowSkeletons rows={rows} />
    </div>
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
  /** True while the timing answer is on its way (rows keep a place for its words). */
  timingPending?: boolean;
  /** How many grey rows stand for the lectures while they load; the course's own number of lectures where it is known. */
  skeletonRows?: number;
  /** The lecture and page left on this device in this course; null when nothing was opened. */
  leftAt: { lectureId: string; page: number } | null;
  /** Lines that need the learner or that another device left (a position conflict, a later synchronised place). */
  notices?: ReactNode;
  /** Chooses this course as the active one before following a link that depends on it (the Library). */
  onActivate?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

const PANE_NOTE = "px-4 pb-1 pt-3 text-ui text-muted min-[600px]:px-6";

export function CoursePane({ course, view, loading, error, onRetry, timing, timingPending = false, skeletonRows, leftAt, notices, onActivate, headingRef }: CoursePaneProps) {
  const bound = course.binding === "bound";
  const id = encodeURIComponent(course.course_id);
  const lectures = view?.lectures ?? [];
  const unlinked = view ? unlinkedSessionsSentence(view) : null;
  const unlinkedRecordings = unlinkedRecordingCount(view);
  const counts = courseCounts(course, view);
  return (
    <>
      <div className={PANE_HEAD}>
        <div className="min-w-0">
          <h3 ref={headingRef} className="scroll-mt-3 text-title font-semibold [overflow-wrap:anywhere]" data-testid="course-name">{course.display_name}</h3>
          {bound && counts.length > 0 && <p className="ll-num mt-0.5 text-ui text-muted" data-testid="course-counts">{factsLine(counts)}.</p>}
          {/* Totals are said only from an answer of the Brain; until one is there their line is kept as a place. */}
          {bound && counts.length === 0 && loading && <span aria-hidden data-pending="counts" className="block"><LineSkeleton width="min(22rem, 90%)" className="mt-0.5 text-ui" /></span>}
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
          {loading ? <div role="status" aria-busy="true"><span className="sr-only">Loading lectures…</span><RowSkeletons rows={skeletonRows ?? course.lecture_units ?? 6} /></div>
            : error || !view ? <ErrorState className="px-4 min-[600px]:px-6" error={error} retry={onRetry} title="The lectures of this course could not be loaded" stillWorks="The other courses are not affected." />
            : lectures.length === 0 ? <p className="p-4 text-read text-muted min-[600px]:px-6">{NO_LECTURES_SENTENCE}</p>
            : (
              <ul className={LECTURE_GRID} aria-label={`Lectures of ${course.display_name}`}>
                {lectures.map((lecture, index) => (
                  <LectureRow key={lecture.lecture_id} courseId={course.course_id} lecture={lecture} order={index} timing={timing.get(lecture.lecture_id) ?? null} timingPending={timingPending}
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
