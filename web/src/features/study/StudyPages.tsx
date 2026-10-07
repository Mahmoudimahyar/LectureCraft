// SC02 Study home and SC03 the course on Study (design specification 6): one bounded browsing page, decided apart from
// the reading view. Top to bottom and nothing else: the title, Resume (the place you left, or one sentence on a first
// run), the configured courses as tabs joined to the chosen course's lectures, one closing line.
//
// `/study` shows the active course; `/courses/:courseId` is the same page with that course chosen (the header's course
// link leads here). Every configured course is listed whatever its state, and every inventoried lecture of the chosen
// course whatever its readiness. Counts are real totals; nothing on this page measures what the learner knows.
//
// The first frame is the final frame. What the device knows is drawn at once: the place you left (or the sentence that
// nothing was opened), the course names kept of the last load, and the course that was active, whose lectures are asked
// for beside the workspace instead of after it. What is not known yet is grey in the size of what follows, the region
// is marked busy, and a load of more than two seconds says once what it is doing. Coming back from a lecture shows what
// the page had while it is read again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Tabs } from "radix-ui";
import { useApp } from "@/app/state";
import { Callout, EmptyState, ErrorState, formatWhen } from "@/components/ui";
import { useCourse, useCourseTiming } from "@/lib/queries";
import type { WorkspaceCourse } from "@/lib/types";
import { CoursePane, CoursePaneSkeleton, CourseTabs, CourseTabsSkeleton, SynchronisedPlaceLine, type CourseTabItem } from "./CourseBrowser";
import { ResumeBlock, ResumeFirstRun } from "./ResumeBlock";
import { lastPosition, rememberCourses, rememberedCourses, storedLastPlaces, useCourseResumes, useKept, useLongerThan } from "./study-data";
import {
  STUDY_CLOSING_LINE, STUDY_READING_LINE, STUDY_SAMPLE_SENTENCE, chosenCourseId, courseTabLine, latestPlace, otherSynchronisedPlace, studyPlace, type LastPlace, type StudyPlace, type TimingLectureRow,
} from "./study-facts";

export { lastPosition };

/** The home column (specification 6): full width under 1200 px, then 1280, 1400 and 1760 px including the 48 px sides (24 of them are the shell's). */
const COLUMN = "mx-auto w-full pb-6 max-[899px]:pt-2 min-[1200px]:max-w-[1232px] min-[1200px]:px-6 min-[1200px]:pt-2 min-[1920px]:max-w-[1352px] min-[1920px]:pt-6 min-[2400px]:max-w-[1712px]";
// Courses beside the pane from 900 px; with enlarged text (as under 900 px) the courses come first and the pane beneath,
// at every width, like the shell's own compact arrangement.
const BROWSE_GRID = "mt-3 grid grid-cols-1 items-start gap-4 min-[900px]:grid-cols-[264px_minmax(0,1fr)] min-[1200px]:grid-cols-[336px_minmax(0,1fr)] min-[1200px]:gap-6 min-[2400px]:grid-cols-[400px_minmax(0,1fr)] [html[data-text-scale=large]_&]:grid-cols-1 [html[data-text-scale=large]_&]:gap-4";
const TITLE = "text-display font-semibold tracking-[-0.015em]";
const PANE = "ll-region min-w-0 scroll-mt-3 overflow-hidden";
/** A load that lasts longer than this says what it is doing (one muted line beside "Courses"). */
const SLOW_MS = 2_000;

/** True where the courses are stacked above the pane: under 900 px, and whenever the learner has enlarged text. */
const narrow = (): boolean => typeof window !== "undefined" && ((typeof window.matchMedia === "function" && window.matchMedia("(max-width: 899px)").matches) || document.documentElement.getAttribute("data-text-scale") === "large");

function StudyPage({ routeCourseId }: { routeCourseId?: string }) {
  const app = useApp();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Set when the learner chooses a course, or arrives by a course address: under 900 px the pane is then brought into view. */
  const reveal = useRef(!!routeCourseId);
  /** What this device kept of the last load: read once, and shown only until the workspace answers. */
  const [remembered] = useState(rememberedCourses);

  const workspace = app.workspace;
  const loadingWorkspace = !workspace && app.workspaceLoading;
  const courses = useMemo<WorkspaceCourse[]>(() => {
    if (workspace) return workspace.courses;
    // Names, binding and nothing else: a remembered count is never shown as a total.
    return loadingWorkspace ? (remembered?.courses ?? []).map((course) => ({ course_id: course.course_id, display_name: course.display_name, binding: course.binding, problem: course.problem })) : [];
  }, [workspace, loadingWorkspace, remembered]);
  const sample = workspace ? !!workspace.fixture_label : loadingWorkspace && !!remembered?.sample;
  useEffect(() => {
    if (workspace) rememberCourses(workspace);
  }, [workspace]);

  const boundIds = useMemo(() => courses.filter((course) => course.binding === "bound").map((course) => course.course_id), [courses]);
  const resumes = useCourseResumes(boundIds);
  // Read on every render of the page: a place written by the lecture workspace is there as soon as the learner comes back.
  // On a first load that remembers no course names the places are read from the device's storage itself.
  const locals: Record<string, LastPlace | null> = courses.length > 0 || !loadingWorkspace
    ? Object.fromEntries(courses.map((course) => [course.course_id, course.binding === "bound" ? lastPosition(course.course_id) : null]))
    : storedLastPlaces();
  const places: Record<string, StudyPlace | null> = Object.fromEntries(Object.keys(locals).map((courseId) => [courseId, studyPlace(courseId, locals[courseId] ?? null, resumes.byCourse[courseId]?.current)]));
  const resumeAt = latestPlace(Object.values(places));

  const chosen = chosenCourseId(courses, routeCourseId ?? picked, app.courseId);
  const course = courses.find((candidate) => candidate.course_id === chosen) ?? null;
  const boundId = course && course.binding === "bound" ? course.course_id : undefined;
  // The chosen course is read beside the workspace (not after it), and what it answered is kept while it is read again.
  // A device that kept no course names still knows which course was active (or which one its address names): that one
  // is asked for at once too, so its lectures are there when the workspace has named it.
  const earlyId = !course && loadingWorkspace ? routeCourseId ?? app.courseId : undefined;
  const courseQuery = useCourse(boundId ?? earlyId);
  const view = useKept(boundId ? `course:${boundId}` : null, courseQuery.data);
  const timingQuery = useCourseTiming(boundId ?? earlyId, { queue: false });
  const timingView = useKept(boundId ? `timing:${boundId}` : null, timingQuery.data);
  const timing = useMemo(() => new Map<string, TimingLectureRow>((timingView?.lectures ?? []).map((row) => [row.lecture_id, row])), [timingView]);

  const paneLoading = !!boundId && !view && courseQuery.isLoading;
  const busy = loadingWorkspace || paneLoading;
  const slow = useLongerThan(busy, SLOW_MS);
  // An address is called unknown only by the workspace itself, never by the names kept from an earlier load.
  const unknownRoute = !!routeCourseId && !!workspace && courses.length > 0 && !courses.some((candidate) => candidate.course_id === routeCourseId);

  useEffect(() => {
    if (!chosen || !reveal.current || !heading.current) return;
    reveal.current = false;
    if (narrow()) heading.current.scrollIntoView({ block: "start" });
  }, [chosen, app.workspace]);

  if (!workspace && !loadingWorkspace) return <div className={COLUMN} data-testid="study-home"><h1 className={TITLE}>Study</h1><ErrorState error={app.workspaceError} title="Your courses could not be loaded" /></div>;

  const choose = (courseId: string) => {
    if (courseId === chosen) return;
    reveal.current = true;
    if (routeCourseId) {
      navigate(`/courses/${encodeURIComponent(courseId)}`);
      return;
    }
    setPicked(courseId);
    if (courses.find((candidate) => candidate.course_id === courseId)?.binding === "bound") app.setCourseId(courseId);
  };

  const items: CourseTabItem[] = courses.map((candidate) => ({
    courseId: candidate.course_id, name: candidate.display_name,
    line: courseTabLine(places[candidate.course_id] ?? null, { bound: candidate.binding === "bound", conflict: !!resumes.byCourse[candidate.course_id]?.conflict }),
  }));
  const resumeCourse = resumeAt ? courses.find((candidate) => candidate.course_id === resumeAt.courseId) : undefined;

  // The pane of the chosen course: where its timing stands, and the lines that need the learner.
  const local = course ? locals[course.course_id] ?? null : null;
  const resume = course ? resumes.byCourse[course.course_id] : undefined;
  const other = otherSynchronisedPlace(local, resume?.current);
  const otherTitle = other ? view?.lectures.find((lecture) => lecture.lecture_id === other.lectureId)?.title : null;
  const notices = course && (resume?.conflict || other) ? (
    <>
      {resume?.conflict && (
        <div className="px-4 pt-3 min-[600px]:px-6" data-testid="resume-conflict">
          <Callout tone="caution" title="Two study positions need your choice" actions={<Link className="ll-btn ll-btn-sm" to={`/activity/conflicts/resume-${course.course_id}`}>Compare and choose</Link>}>
            Checkpoints from different devices do not follow one another. Both drafts are kept; nothing was merged or overwritten.
          </Callout>
        </div>
      )}
      {other && !resume?.conflict && <SynchronisedPlaceLine courseId={course.course_id} lectureId={other.lectureId} title={otherTitle} page={other.page} when={formatWhen(other.updatedAt)} />}
    </>
  ) : null;
  /** As many grey rows as the course has lectures: from the workspace, or from what was kept of the last load. */
  const skeletonRows = course ? course.lecture_units ?? remembered?.courses.find((kept) => kept.course_id === course.course_id)?.rows ?? undefined : undefined;

  return (
    <div className={COLUMN} data-testid="study-home" aria-busy={busy ? true : undefined}>
      <h1 className={TITLE}>Study</h1>
      {sample && <p className="mt-1 max-w-[64ch] text-read text-muted" data-testid="sample-data-sentence">{STUDY_SAMPLE_SENTENCE}</p>}

      {/* The device knows its own place: Resume, or the sentence of a first run, is in the first frame. A position another
          device synchronised takes the sentence's place when it arrives. */}
      {resumeAt ? <ResumeBlock key={`${resumeAt.courseId}/${resumeAt.lectureId}`} place={resumeAt} courseName={resumeCourse?.display_name ?? null} /> : <ResumeFirstRun />}

      <section aria-labelledby="study-courses" className="mt-8 min-[900px]:mt-12">
        <div className="flex flex-wrap items-baseline gap-x-4">
          <h2 id="study-courses" className="text-head font-semibold">Courses</h2>
          <p role="status" className="text-ui text-muted" data-testid="study-status">
            {loadingWorkspace && <span className="sr-only">Loading your courses… </span>}
            {slow && STUDY_READING_LINE}
          </p>
        </div>
        {unknownRoute ? (
          <EmptyState title="No course is configured under this address" action={<Link className="ll-btn" to="/study">Back to Study</Link>}>
            “{routeCourseId}” is not one of the configured courses. Your records are not affected.
          </EmptyState>
        ) : !course ? (
          loadingWorkspace ? (
            // A first visit of this device: nothing is known yet, so the courses and the pane are grey in their final sizes.
            <div className={BROWSE_GRID}>
              <CourseTabsSkeleton />
              <div className={PANE}><CoursePaneSkeleton /></div>
            </div>
          ) : <EmptyState title="No course is configured">Courses are configured on the Brain PC; none is listed for this profile.</EmptyState>
        ) : (
          <Tabs.Root value={course.course_id} onValueChange={choose} orientation="vertical" activationMode="manual" className={BROWSE_GRID}>
            <CourseTabs items={items} chosen={course.course_id} />
            <Tabs.Content value={course.course_id} className={PANE} data-testid="course-pane" data-course={course.course_id} aria-busy={paneLoading ? true : undefined}>
              <CoursePane key={course.course_id} course={course} view={view} loading={paneLoading} error={courseQuery.isError ? courseQuery.error : null} onRetry={() => void courseQuery.refetch()}
                timing={timing} timingPending={!!boundId && !timingView && timingQuery.isLoading} skeletonRows={skeletonRows}
                leftAt={local ? { lectureId: local.lectureId, page: local.page } : null} notices={notices} headingRef={heading}
                onActivate={() => course.binding === "bound" && app.setCourseId(course.course_id)} />
            </Tabs.Content>
          </Tabs.Root>
        )}
        <p className="mt-6 max-w-[64ch] text-ui text-muted" data-testid="study-closing-line">{STUDY_CLOSING_LINE}</p>
      </section>
    </div>
  );
}

/** `/study`: the active course is the chosen one; choosing another makes it the active course. */
export function StudyHome() {
  return <StudyPage />;
}

/** `/courses/:courseId`: the same page with that course chosen; choosing another course goes to its address. */
export function CourseLectures() {
  const { courseId } = useParams();
  return <StudyPage routeCourseId={courseId} />;
}
