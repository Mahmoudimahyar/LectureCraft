// SC02 Study home and SC03 the course on Study (design specification 6): one bounded browsing page, decided apart from
// the reading view. Top to bottom and nothing else: the title, Resume (the place you left, or one sentence on a first
// run), the configured courses as tabs joined to the chosen course's lectures, one closing line.
//
// `/study` shows the active course; `/courses/:courseId` is the same page with that course chosen (the header's course
// link leads here). Every configured course is listed whatever its state, and every inventoried lecture of the chosen
// course whatever its readiness. Counts are real totals; nothing on this page measures what the learner knows.
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Tabs } from "radix-ui";
import { useApp } from "@/app/state";
import { Callout, EmptyState, ErrorState, formatWhen, Skeleton } from "@/components/ui";
import { useCourse, useCourseTiming } from "@/lib/queries";
import type { ResumeState, WorkspaceCourse } from "@/lib/types";
import { CoursePane, CourseTabs, SynchronisedPlaceLine, type CourseTabItem } from "./CourseBrowser";
import { ResumeBlock, ResumeFirstRun, ResumePending } from "./ResumeBlock";
import { lastPosition, useCourseResumes } from "./study-data";
import { STUDY_CLOSING_LINE, STUDY_SAMPLE_SENTENCE, chosenCourseId, courseTabLine, latestPlace, otherSynchronisedPlace, studyPlace, type LastPlace, type StudyPlace, type TimingLectureRow } from "./study-facts";

export { lastPosition };

/** The home column (specification 6): full width under 1200 px, then 1280, 1400 and 1760 px including the 48 px sides (24 of them are the shell's). */
const COLUMN = "mx-auto w-full pb-6 max-[899px]:pt-2 min-[1200px]:max-w-[1232px] min-[1200px]:px-6 min-[1200px]:pt-2 min-[1920px]:max-w-[1352px] min-[1920px]:pt-6 min-[2400px]:max-w-[1712px]";
// Courses beside the pane from 900 px; with enlarged text (as under 900 px) the courses come first and the pane beneath,
// at every width, like the shell's own compact arrangement.
const BROWSE_GRID = "mt-3 grid grid-cols-1 items-start gap-4 min-[900px]:grid-cols-[264px_minmax(0,1fr)] min-[1200px]:grid-cols-[336px_minmax(0,1fr)] min-[1200px]:gap-6 min-[2400px]:grid-cols-[400px_minmax(0,1fr)] [html[data-text-scale=large]_&]:grid-cols-1 [html[data-text-scale=large]_&]:gap-4";
const TITLE = "text-display font-semibold tracking-[-0.015em]";

/** True where the courses are stacked above the pane: under 900 px, and whenever the learner has enlarged text. */
const narrow = (): boolean => typeof window !== "undefined" && ((typeof window.matchMedia === "function" && window.matchMedia("(max-width: 899px)").matches) || document.documentElement.getAttribute("data-text-scale") === "large");

/** The pane of the chosen course: its lectures, where their timing stands, and the lines that need the learner. */
function ChosenCourse({ course, local, resume, headingRef, onActivate }: { course: WorkspaceCourse; local: LastPlace | null; resume: ResumeState | undefined;
  headingRef: Ref<HTMLHeadingElement>; onActivate: () => void }) {
  const bound = course.binding === "bound";
  const view = useCourse(bound ? course.course_id : undefined);
  const timingView = useCourseTiming(bound ? course.course_id : undefined, { queue: false });
  const timing = useMemo(() => new Map<string, TimingLectureRow>((timingView.data?.lectures ?? []).map((row) => [row.lecture_id, row])), [timingView.data]);
  const other = otherSynchronisedPlace(local, resume?.current);
  const otherTitle = other ? view.data?.lectures.find((lecture) => lecture.lecture_id === other.lectureId)?.title : null;
  const notices = (resume?.conflict || other) ? (
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
  return (
    <CoursePane course={course} view={view.data} loading={bound && view.isLoading} error={view.isError ? view.error : null} onRetry={() => void view.refetch()} timing={timing}
      leftAt={local ? { lectureId: local.lectureId, page: local.page } : null} notices={notices} onActivate={onActivate} headingRef={headingRef} />
  );
}

function StudyPage({ routeCourseId }: { routeCourseId?: string }) {
  const app = useApp();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Set when the learner chooses a course, or arrives by a course address: under 900 px the pane is then brought into view. */
  const reveal = useRef(!!routeCourseId);

  const courses = useMemo(() => app.workspace?.courses ?? [], [app.workspace]);
  const boundIds = useMemo(() => courses.filter((course) => course.binding === "bound").map((course) => course.course_id), [courses]);
  const resumes = useCourseResumes(boundIds);
  // Read on every render of the page: a place written by the lecture workspace is there as soon as the learner comes back.
  const locals: Record<string, LastPlace | null> = Object.fromEntries(courses.map((course) => [course.course_id, course.binding === "bound" ? lastPosition(course.course_id) : null]));
  const places: Record<string, StudyPlace | null> = Object.fromEntries(courses.map((course) => [course.course_id, studyPlace(course.course_id, locals[course.course_id] ?? null, resumes.byCourse[course.course_id]?.current)]));
  const resumeAt = latestPlace(Object.values(places));

  const chosen = chosenCourseId(courses, routeCourseId ?? picked, app.courseId);
  const unknownRoute = !!routeCourseId && courses.length > 0 && !courses.some((course) => course.course_id === routeCourseId);

  useEffect(() => {
    if (!chosen || !reveal.current || !heading.current) return;
    reveal.current = false;
    if (narrow()) heading.current.scrollIntoView({ block: "start" });
  }, [chosen, app.workspace]);

  if (app.workspaceLoading) {
    return (
      <div className={COLUMN} data-testid="study-home" role="status">
        <h1 className={TITLE}>Study</h1>
        <span className="sr-only">Loading your courses…</span>
        <div className="mt-6 grid max-w-[34rem] gap-2" aria-hidden>
          <Skeleton height={18} width="50%" /><Skeleton height={14} width="90%" /><Skeleton height={14} width="70%" />
        </div>
      </div>
    );
  }
  if (!app.workspace) return <div className={COLUMN} data-testid="study-home"><h1 className={TITLE}>Study</h1><ErrorState error={app.workspaceError} title="Your courses could not be loaded" /></div>;

  const choose = (courseId: string) => {
    if (courseId === chosen) return;
    reveal.current = true;
    if (routeCourseId) {
      navigate(`/courses/${encodeURIComponent(courseId)}`);
      return;
    }
    setPicked(courseId);
    if (courses.find((course) => course.course_id === courseId)?.binding === "bound") app.setCourseId(courseId);
  };

  const items: CourseTabItem[] = courses.map((course) => ({
    courseId: course.course_id, name: course.display_name,
    line: courseTabLine(places[course.course_id] ?? null, { bound: course.binding === "bound", conflict: !!resumes.byCourse[course.course_id]?.conflict }),
  }));
  const course = courses.find((candidate) => candidate.course_id === chosen) ?? null;
  const resumeCourse = resumeAt ? courses.find((candidate) => candidate.course_id === resumeAt.courseId) : undefined;

  return (
    <div className={COLUMN} data-testid="study-home">
      <h1 className={TITLE}>Study</h1>
      {app.workspace.fixture_label && <p className="mt-1 max-w-[64ch] text-read text-muted" data-testid="sample-data-sentence">{STUDY_SAMPLE_SENTENCE}</p>}

      {resumeAt && resumeCourse ? <ResumeBlock key={`${resumeAt.courseId}/${resumeAt.lectureId}`} place={resumeAt} courseName={resumeCourse.display_name} />
        : resumes.settled ? <ResumeFirstRun /> : <ResumePending />}

      <section aria-labelledby="study-courses" className="mt-8 min-[900px]:mt-12">
        <h2 id="study-courses" className="text-head font-semibold">Courses</h2>
        {unknownRoute ? (
          <EmptyState title="No course is configured under this address" action={<Link className="ll-btn" to="/study">Back to Study</Link>}>
            “{routeCourseId}” is not one of the configured courses. Your records are not affected.
          </EmptyState>
        ) : courses.length === 0 || !course ? (
          <EmptyState title="No course is configured">Courses are configured on the Brain PC; none is listed for this profile.</EmptyState>
        ) : (
          <Tabs.Root value={course.course_id} onValueChange={choose} orientation="vertical" activationMode="manual" className={BROWSE_GRID}>
            <CourseTabs items={items} chosen={course.course_id} />
            <Tabs.Content value={course.course_id} className="ll-region min-w-0 scroll-mt-3 overflow-hidden" data-testid="course-pane" data-course={course.course_id}>
              <ChosenCourse key={course.course_id} course={course} local={locals[course.course_id] ?? null} resume={resumes.byCourse[course.course_id]} headingRef={heading}
                onActivate={() => course.binding === "bound" && app.setCourseId(course.course_id)} />
            </Tabs.Content>
          </Tabs.Root>
        )}
        <p className="mt-6 max-w-[76ch] text-ui text-muted" data-testid="study-closing-line">{STUDY_CLOSING_LINE}</p>
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
