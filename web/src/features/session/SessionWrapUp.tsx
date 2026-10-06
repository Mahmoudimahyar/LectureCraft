// SC16 Session wrap-up (UI31). The recap is built only from what actually happened: requests this
// device sent in this session and the Brain's own job phases and receipts. Viewing a slide is not
// reported as learning, a quick answer is "not assessed", and nothing here edits a calendar or deadline.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useApp, courseName } from "@/app/state";
import { Button, formatMs, formatWhen, LoadingState, PageHeader } from "@/components/ui";
import { listDrafts, listOutbox, type LocalRequest } from "@/lib/db";
import { JOB_STATE } from "@/lib/labels";
import { useActivity, useCourse, useResume, useReview } from "@/lib/queries";
import { reviewItemPayload } from "@/lib/requests";
import type { ActivityJob, QuestionRecord } from "@/lib/types";
import { Callout, Lead, StateWords, lectureNameOf } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";

const ANSWERS = new Set(["explain", "practice", "review_answer", "diagnose"]);
const TERMINAL = new Set(["SUCCEEDED", "FAILED_FINAL", "CANCELLED", "SUPERSEDED"]);
/** The sections of the summary are parted by a hairline, not boxed. */
const SECTION = "border-t border-hairline py-6 first-of-type:border-t-0 first-of-type:pt-0";
const SECTION_HEAD = "text-head font-semibold";

function publicationOf(job: ActivityJob | undefined): { label: string; tone: "success" | "caution" | "unassessed" | "neutral" } {
  if (!job) return { label: "Not received by the Brain yet", tone: "caution" };
  const publication = job.phases.publication;
  if (/^attempt: (saved|already_saved)/.test(publication)) return { label: "Assessed and saved to your course record", tone: "success" };
  if (/blocked|incomplete/.test(publication)) return { label: `Response kept; course record not saved (${job.phases.publication_reason ?? publication})`, tone: "caution" };
  if (!TERMINAL.has(job.state)) return { label: JOB_STATE[job.state]?.label ?? job.state, tone: "caution" };
  return { label: "Not assessed in this exchange", tone: "unassessed" };
}

export function SessionWrapUp() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const app = useApp();
  const courseId = params.get("course") ?? app.courseId;
  const lectureId = params.get("lecture");
  const page = params.get("page");
  const local = useLocalRequests(courseId);
  const activity = useActivity(true);
  const resume = useResume(courseId);
  const review = useReview(courseId);
  const course = useCourse(courseId ?? undefined); // only for the lecture's title; the position is stated without it
  const actions = useSubmitActions();
  const [device, setDevice] = useState<{ drafts: number; outbox: number } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([listDrafts(courseId), listOutbox()]).then(([d, o]) => setDevice({ drafts: d.filter((x) => x.text.trim()).length, outbox: o.length }));
  }, [courseId, local.dataUpdatedAt]);

  // The checkpoint written by "Finish session" is processed by the Brain a moment later: follow it.
  useEffect(() => {
    void resume.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.dataUpdatedAt]);

  const mine = useMemo(() => (local.data ?? []).filter((r) => r.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [local.data, sessionId]);
  const jobs = useMemo(() => new Map((activity.data?.jobs ?? []).filter((j) => j.request_id).map((j) => [j.request_id!, j])), [activity.data]);

  if (!courseId) return <Callout tone="caution" title="No course selected">Open a course to see its session summary.</Callout>;
  if (local.isLoading) return <LoadingState />;

  const asked = mine.filter((r) => r.action === "ask");
  const answered = mine.filter((r) => ANSWERS.has(r.action));
  const other = mine.filter((r) => r.action !== "ask" && !ANSWERS.has(r.action) && r.action !== "resume" && r.action !== "cancel");
  const assessed = answered.filter((r) => publicationOf(jobs.get(r.requestId)).tone === "success");
  const pending = mine.filter((r) => {
    const job = jobs.get(r.requestId);
    return r.upload !== "uploaded" || !job || !TERMINAL.has(job.state);
  });
  const head = resume.data?.current ?? null;
  const here = head && head.session_id === sessionId ? head : null;

  // Suggestions come only from course questions this session actually touched and that are not in the list yet.
  const inList = new Set((review.data?.items ?? []).map((i) => i.question.question_id).filter(Boolean));
  const touched = [...new Set(mine.map((r) => r.context.questionId).filter((q): q is string => !!q))];
  const suggestions = touched.map((id) => review.data?.available_questions.find((q) => q.question_id === id)).filter((q): q is NonNullable<typeof q> => !!q && !inList.has(q.question_id));

  const saveChosen = async () => {
    setBusy(true);
    try {
      let count = 0;
      for (const q of suggestions.filter((s) => chosen.has(s.question_id))) {
        const record: QuestionRecord = { question_id: q.question_id, family_id: q.family_id, family_revision: q.family_revision, prompt: q.prompt, sources: [], attachments: [] };
        const itemId = `item-${q.question_id.toLowerCase()}`;
        await actions.record(courseId, "select_review", reviewItemPayload({ courseId, itemId, revision: 1, question: record, kind: "explanation", selection: "saved_only", schedulerConfig: null, supersedes: null }),
          { label: `Review selection · ${itemId}`, text: "saved_only" });
        count += 1;
      }
      setSaved(`${count} item${count === 1 ? "" : "s"} sent as "saved only". They get no due date, and nothing was added to a calendar, task list or course deadline.`);
      setChosen(new Set());
    } catch (error) {
      setSaved(`Not saved: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const row = (r: LocalRequest) => {
    const job = jobs.get(r.requestId);
    const status = ANSWERS.has(r.action) ? publicationOf(job) : { label: !job ? "Not received by the Brain yet" : r.action === "ask" && job.state === "SUCCEEDED" ? "Answer received — not assessed in this exchange" : (JOB_STATE[job.state]?.label ?? job.state), tone: (!job || !TERMINAL.has(job.state) ? "caution" : "unassessed") as "caution" | "unassessed" };
    return (
      <li key={r.requestId} className="border-t border-hairline py-3 first:border-t-0 first:pt-1" data-testid="wrapup-row">
        <p className="font-semibold">{r.label}</p>
        <p className="ll-measure text-ui text-muted">{r.text.slice(0, 160)}{r.text.length > 160 ? "…" : ""}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-ui"><StateWords tone={status.tone === "unassessed" ? "neutral" : status.tone}>{status.label}</StateWords><Link className="ll-link" to={`/activity/${encodeURIComponent(r.requestId)}`}>Details</Link></p>
      </li>
    );
  };
  const count = (label: string, value: number) => <div><dt className="text-ui text-muted">{label}</dt><dd className="ll-num text-title font-semibold">{value}</dd></div>;

  return (
    <div className="ll-page ll-page-reading">
      <PageHeader title="Session summary" subtitle={<Lead>{courseName(app.workspace, courseId)} · built from this session's actual requests and receipts, not from a model's recollection.</Lead>} />

      <section className={SECTION} aria-labelledby="where-h">
        <h2 id="where-h" className={SECTION_HEAD}>Where you stopped</h2>
        {here ? (
          <p className="ll-measure mt-1">{lectureNameOf(course.data, here.cursor.lecture_id)}, PDF page {String((here.cursor.source.locator as { page?: number }).page ?? "?")}{here.cursor.position_ms != null ? ` · recording at ${formatMs(here.cursor.position_ms)}` : ""} · synchronised {formatWhen(here.updated_at)}.{here.cursor.draft ? " Your unsent draft text was saved with it." : ""}</p>
        ) : lectureId ? (
          <p className="ll-measure mt-1">{lectureNameOf(course.data, lectureId)}, PDF page {page ?? "?"}. Position not confirmed by the Brain yet. <span className="text-muted">{head ? `The last synchronised position is from ${formatWhen(head.updated_at)}.` : "It is remembered on this device only."}</span></p>
        ) : <p className="mt-1 text-muted">No lecture position was recorded in this session.</p>}
        {resume.data?.conflict && <Callout tone="caution" className="mt-3" title="Two devices stopped in different places" actions={<Link className="ll-btn ll-btn-sm" to={`/activity/conflicts/resume-${courseId}`}>Choose which to keep</Link>}>{resume.data.conflict.note}</Callout>}
        {lectureId && <Link className="ll-btn mt-3" to={`/courses/${courseId}/lectures/${lectureId}${page ? `?page=${page}` : ""}`}>Continue this lecture</Link>}
      </section>

      <section className={SECTION} aria-labelledby="did-h">
        <h2 id="did-h" className={SECTION_HEAD}>What actually happened</h2>
        <dl className="mt-3 flex flex-wrap gap-x-12 gap-y-4" data-testid="wrapup-counts">
          {count("Answers requested", asked.length)}
          {count("Responses you submitted", answered.length)}
          {count("Assessed and saved", assessed.length)}
        </dl>
        {mine.length === 0 && <p className="ll-measure mt-3 text-muted">You looked at material without sending anything. That is fine; viewing is not recorded as learning or as a gap.</p>}
        {asked.length > 0 && answered.length === 0 && <Callout tone="neutral" role="note" className="mt-4" title="Understanding was not assessed in this session">You asked for answers. Receiving an answer says nothing about what you know, so no result — and no failure — was recorded.</Callout>}
        {asked.length > 0 && <><h3 className="mt-5 text-ui font-semibold text-muted">Answers you asked for</h3><ul className="flex flex-col">{asked.map(row)}</ul></>}
        {answered.length > 0 && <><h3 className="mt-5 text-ui font-semibold text-muted">Your own responses</h3><ul className="flex flex-col">{answered.map(row)}</ul></>}
        {other.length > 0 && <><h3 className="mt-5 text-ui font-semibold text-muted">Notes and corrections</h3><ul className="flex flex-col">{other.map(row)}</ul></>}
        <p className="ll-measure mt-4 text-ui text-muted">Time spent and slides viewed are observations only; they are never treated as evidence of knowledge.</p>
      </section>

      <section className={SECTION} aria-labelledby="pending-h">
        <h2 id="pending-h" className={SECTION_HEAD}>Still pending</h2>
        {pending.length === 0 && (device?.outbox ?? 0) === 0 ? <p className="ll-measure mt-1" data-testid="pending-none">Nothing from this session is waiting. Everything listed above has a final state.</p> : (
          <div className="mt-1 flex flex-col gap-2" data-testid="pending-some">
            <p className="ll-measure">{pending.length} request{pending.length === 1 ? "" : "s"} from this session {pending.length === 1 ? "has" : "have"} no final state yet{(device?.outbox ?? 0) > 0 ? `, and ${device!.outbox} signed request(s) are held on this device waiting to be sent` : ""}.</p>
            <p className="ll-measure text-ui text-muted">Leaving this page does not cancel work the Brain already accepted, and nothing is submitted again when you come back. Requests held only on this device are sent the next time the app is open and the Brain is reachable.</p>
            <div><Link className="ll-btn" to="/activity">Open Activity</Link></div>
          </div>
        )}
        {(device?.drafts ?? 0) > 0 && <p className="ll-measure mt-2 text-ui text-muted">{device!.drafts} unsent draft{device!.drafts === 1 ? "" : "s"} stay on this device until you send or discard them.</p>}
      </section>

      <section className={SECTION} aria-labelledby="next-h">
        <h2 id="next-h" className={SECTION_HEAD}>Optional next steps</h2>
        {suggestions.length === 0 ? <p className="ll-measure mt-1 text-muted">No course question from this session is waiting to be added to your review list.</p> : (
          <>
            <p className="ll-measure mt-1 text-ui text-muted">Tick only what you want to keep. Unticked suggestions are dropped — they do not become scheduled work.</p>
            <ul className="mt-3 flex flex-col gap-3">
              {suggestions.map((q) => (
                <li key={q.question_id}><label className="flex items-start gap-3"><input type="checkbox" className="mt-0.5 size-5 flex-none accent-accent" checked={chosen.has(q.question_id)} onChange={(e) => setChosen((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(q.question_id); else next.delete(q.question_id);
                  return next;
                })} /><span><span className="font-semibold">{q.title ?? q.question_id}</span><span className="ll-measure block text-ui text-muted">{q.prompt.slice(0, 140)}{q.prompt.length > 140 ? "…" : ""}</span></span></label></li>
              ))}
            </ul>
          </>
        )}
        {saved && <p role="status" className="ll-measure mt-3 text-ui">{saved}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link className="ll-btn ll-btn-primary" to="/study">Done</Link>
          <Link className="ll-btn" to="/review">Review now</Link>
          {suggestions.length > 0 && <Button busy={busy} disabled={chosen.size === 0} onClick={saveChosen}>Save selected for later</Button>}
          {suggestions.length > 0 && chosen.size === 0 && <span className="text-ui text-muted">Tick a question to save it.</span>}
        </div>
      </section>
    </div>
  );
}
