// SC02 Study home and SC03 Course lecture list (UI03). Every configured course and every inventoried
// lecture unit is listed whatever its readiness; preparation status is kept apart from learning evidence.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowRight, BookOpen, CalendarDays } from "lucide-react";
import { useApp } from "@/app/state";
import { Callout, EmptyState, ErrorState, formatWhen, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { dispositionLabel, SESSION_STATE, SOURCE_STATE } from "@/lib/labels";
import { useCourse, useResume } from "@/lib/queries";
import type { WorkspaceCourse } from "@/lib/types";

export function lastPosition(courseId: string): { lectureId: string; page: number } | null {
  try {
    const raw = window.localStorage.getItem(`ll.last.${courseId}`);
    return raw ? (JSON.parse(raw) as { lectureId: string; page: number }) : null;
  } catch {
    return null;
  }
}

function ContinueCard({ course }: { course: WorkspaceCourse }) {
  const resume = useResume(course.course_id);
  const local = lastPosition(course.course_id);
  if (resume.data?.conflict) {
    return (
      <Callout tone="caution" title="Two study positions need your choice" actions={<Link className="ll-btn ll-btn-sm" to={`/activity/conflicts/resume-${course.course_id}`}>Compare and choose</Link>}>
        Checkpoints from different devices do not follow one another. Both drafts are kept; nothing was merged or overwritten.
      </Callout>
    );
  }
  const head = resume.data?.current;
  if (head) {
    const page = (head.cursor.source.locator as { page?: number }).page ?? 1;
    return (
      <Link to={`/courses/${course.course_id}/lectures/${head.cursor.lecture_id}?page=${page}`} className="ll-btn ll-btn-primary w-full justify-between">
        <span>Continue: {head.cursor.lecture_id.replace("-", " ")}, slide {page}</span>
        <span className="text-xs font-normal opacity-90">synchronised {formatWhen(head.updated_at)} · paused</span>
      </Link>
    );
  }
  if (local) {
    return (
      <Link to={`/courses/${course.course_id}/lectures/${local.lectureId}?page=${local.page}`} className="ll-btn w-full justify-between">
        <span>Continue on this device: {local.lectureId.replace("-", " ")}, slide {local.page}</span>
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    );
  }
  return <p className="text-sm text-muted">No saved position yet.</p>;
}

export function StudyHome() {
  const app = useApp();
  if (app.workspaceLoading) return <LoadingState label="Loading your courses…" />;
  if (!app.workspace) return <ErrorState error={app.workspaceError} />;
  const { workspace } = app;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Study" subtitle={`All configured courses · ${workspace.term}`} actions={app.pairing.state !== "paired" ? <Link className="ll-btn" to="/connect">Pair this device</Link> : undefined} />
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspace.courses.map((course) => {
          const bound = course.binding === "bound";
          const prep = course.preparation ?? {};
          const pendingLinks = prep.links_pending_review ?? 0;
          return (
            <li key={course.course_id} className="ll-card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{bound ? <Link to={`/courses/${course.course_id}`} onClick={() => app.setCourseId(course.course_id)} className="hover:underline">{course.display_name}</Link> : course.display_name}</h2>
                  <p className="text-sm text-muted">{course.course_id}</p>
                </div>
                <BookOpen aria-hidden className="size-6 shrink-0 text-accent" />
              </div>
              {!bound ? <Callout tone="danger" title="This course is not bound">{course.problem} Other courses are unaffected.</Callout> : (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted">Lecture units</dt><dd>{course.lecture_units}</dd>
                    <dt className="text-muted">Sessions</dt><dd>{course.sessions}</dd>
                    <dt className="text-muted">Recorded evidence</dt><dd><StatusChip tone={course.recorded_attempts ? "neutral" : "unassessed"}>{course.assessed_label}</StatusChip></dd>
                    <dt className="text-muted">Preparation</dt>
                    <dd>{pendingLinks ? `${pendingLinks} with suggested links` : prep.not_processed ? `${prep.not_processed} not prepared yet` : "No pending link review"}</dd>
                  </dl>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {course.due_items ? <Link className="ll-chip" to="/review" onClick={() => app.setCourseId(course.course_id)}>{course.due_items} review item{course.due_items === 1 ? "" : "s"} available</Link> : null}
                    {course.pending_requests ? <Link className="ll-chip" to="/activity">{course.pending_requests} open request{course.pending_requests === 1 ? "" : "s"}</Link> : null}
                  </div>
                  <ContinueCard course={course} />
                  <Link to={`/courses/${course.course_id}`} onClick={() => app.setCourseId(course.course_id)} className="ll-btn ll-btn-sm self-start">All lectures</Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">Counts describe what exists and what was prepared. They say nothing about what you know; reading or replaying a lecture is never treated as an assessment.</p>
    </div>
  );
}

export function CourseLectures() {
  const { courseId } = useParams();
  const app = useApp();
  const course = useCourse(courseId);
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<"all" | "openable" | "needs_attention">("all");
  const lectures = course.data?.lectures ?? [];
  const shown = useMemo(() => lectures.filter((l) => {
    const text = `${l.title} ${l.lecture_id}`.toLowerCase();
    if (filter && !text.includes(filter.toLowerCase())) return false;
    if (only === "openable") return l.displayable;
    if (only === "needs_attention") return !l.displayable || l.disposition.startsWith("links_pending") || l.disposition.startsWith("not_processed");
    return true;
  }), [lectures, filter, only]);

  if (course.isLoading) return <LoadingState label="Loading lectures…" />;
  if (course.isError || !course.data) return <ErrorState error={course.error} retry={() => void course.refetch()} />;
  const data = course.data;
  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted"><Link to="/study" className="hover:underline">Courses</Link> › <span aria-current="page">{data.display_name}</span></nav>
      <PageHeader title={data.display_name} subtitle={`${lectures.length} lecture unit${lectures.length === 1 ? "" : "s"} in the inventory${shown.length !== lectures.length ? ` · showing ${shown.length} (filter does not change the total)` : ""}`}
        actions={<Link className="ll-btn ll-btn-sm" to="/sources" onClick={() => app.setCourseId(data.course_id)}>Sources and preparation</Link>} />
      {data.index.status !== "ok" && <Callout tone="caution" className="mb-3" title="The course's published source index could not be trusted right now">{data.index.reason} Files on disk are still listed; registration details are temporarily unavailable.</Callout>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="search" className="ll-input max-w-xs" placeholder="Filter lectures…" aria-label="Filter lectures in this course" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="ll-input w-auto" aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
          <option value="all">All lecture units</option>
          <option value="openable">Slides can be opened</option>
          <option value="needs_attention">Needs attention</option>
        </select>
      </div>
      {shown.length === 0 ? <EmptyState title="No lecture matches this filter">The course still has {lectures.length} lecture unit{lectures.length === 1 ? "" : "s"}; clear the filter to see them.</EmptyState> : (
        <ul className="flex flex-col gap-2">
          {shown.map((lecture) => {
            const prep = dispositionLabel(lecture.disposition);
            const deckState = lecture.deck ? SOURCE_STATE[lecture.deck.state] : null;
            return (
              <li key={lecture.lecture_id} className="ll-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold">
                      {lecture.displayable ? <Link className="hover:underline" to={`/courses/${data.course_id}/lectures/${lecture.lecture_id}`}>{lecture.title}</Link> : lecture.title}
                    </h2>
                    <p className="text-sm text-muted">{lecture.lecture_id}{lecture.pages ? ` · ${lecture.pages} slides` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {deckState ? <StatusChip tone={deckState.tone} title={deckState.detail}>Slides: {deckState.label}</StatusChip> : <StatusChip tone="unassessed">No slide file</StatusChip>}
                    <StatusChip tone={prep.tone} title={prep.detail ?? undefined}>{prep.label}</StatusChip>
                  </div>
                </div>
                {prep.detail && <p className="mt-1 text-sm text-muted">{prep.detail}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <CalendarDays aria-hidden className="size-4 text-muted" />
                  {lecture.sessions.length === 0 ? <span className="text-muted">No dated session is linked to this lecture by the course records (not guessed).</span> :
                    lecture.sessions.map((s) => <StatusChip key={s.session_id} tone={SESSION_STATE[s.state]?.tone ?? "neutral"}>{s.date}: {SESSION_STATE[s.state]?.label ?? s.state}</StatusChip>)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data.unlinked_sessions.length > 0 && (
        <section className="mt-6" aria-labelledby="unlinked-heading">
          <h2 id="unlinked-heading" className="mb-2 text-lg font-semibold">Dated sessions without a recorded lecture link</h2>
          <ul className="flex flex-col gap-2">
            {data.unlinked_sessions.map((s) => (
              <li key={s.session_id} className="ll-card flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="font-medium">{s.date}</span>
                <StatusChip tone={SESSION_STATE[s.state]?.tone ?? "neutral"}>{SESSION_STATE[s.state]?.label ?? s.state}</StatusChip>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-muted">The course records do not say which lecture these belong to, so no pairing is assumed.</p>
        </section>
      )}
      <p className="mt-4 text-sm text-muted">Recorded evidence in this course: {data.recorded_attempts === 0 ? "Not assessed (no attempts recorded) — that is not a score of zero." : `${data.recorded_attempts} attempt record(s).`}</p>
    </div>
  );
}
