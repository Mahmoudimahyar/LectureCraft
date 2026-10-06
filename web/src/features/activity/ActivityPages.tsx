// SC12 Activity and request detail (UI25, UI27) and SC14 Conflict resolution (UI10, UI26).
// Each request shows its separate facts — captured, received, native turn, answer, course save — with
// the one action that is actually possible. Unknown outcomes are checked, never blindly re-sent; a
// conflict keeps both versions until the learner chooses.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, Callout, EmptyState, ErrorState, formatMs, formatWhen, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import { listOutbox, type OutboxItem } from "@/lib/db";
import { JOB_STATE } from "@/lib/labels";
import { useActivity, useLecture, useResume } from "@/lib/queries";
import { flushOutbox, reviseAnnotation } from "@/lib/requests";
import type { ActivityJob, AnnotationRecord } from "@/lib/types";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard } from "@/features/tutor/RequestCard";

function Phases({ job }: { job: ActivityJob }) {
  const rows: Array<[string, string]> = [["Your input", job.phases.input], ["Delivery", job.phases.transport], ["Native turn", job.phases.native], ["Answer", job.phases.answer], ["Course record", job.phases.publication]];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {rows.map(([name, value]) => <div key={name} className="contents"><dt className="text-muted">{name}</dt><dd>{value}</dd></div>)}
      {job.phases.publication_reason && <div className="contents"><dt className="text-muted">Why</dt><dd className="text-muted">{job.phases.publication_reason}</dd></div>}
    </dl>
  );
}

export function ActivityPage() {
  const { requestId } = useParams();
  const app = useApp();
  const activity = useActivity(true);
  const actions = useSubmitActions();
  const queryClient = useQueryClient();
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    void listOutbox().then(setOutbox);
  }, [activity.dataUpdatedAt]);

  if (requestId) return <RequestDetail requestId={requestId} />;
  if (activity.isLoading) return <LoadingState label="Loading activity…" />;
  const data = activity.data;
  const jobs = (data?.jobs ?? []).filter((j) => j.request_id && (filter === "all" || !["SUCCEEDED", "CANCELLED", "SUPERSEDED"].includes(j.state)));
  const internal = (data?.jobs ?? []).filter((j) => !j.request_id);

  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await queryClient.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ll-page">
      <PageHeader title="Activity" subtitle={data?.note ?? "Requests and their real states."} actions={
        <select className="ll-input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")} aria-label="Which requests to show">
          <option value="open">Open requests</option><option value="all">All requests</option>
        </select>} />
      {activity.isError && <Callout tone="danger" role="alert" className="mb-3" title="The Brain is not reachable">{activity.error.message} What is listed below is only what this device still holds.</Callout>}
      {data?.supervisor.paused && <Callout tone="caution" className="mb-3" title="Processing is paused" actions={<Link className="ll-btn ll-btn-sm" to="/settings/limits">Open limits</Link>}>Requests are received and kept, but nothing is dispatched until you resume.</Callout>}
      {notice && <Callout tone="accent" role="status" className="mb-3" title="Activity">{notice}</Callout>}

      {outbox.length > 0 && (
        <section aria-labelledby="outbox-h" className="mb-5">
          <h2 id="outbox-h" className="mb-2 text-lg font-semibold">Kept on this device, not sent yet ({outbox.length})</h2>
          <ul className="flex flex-col gap-2">
            {outbox.map((item) => <li key={item.requestId} className="ll-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span className="font-mono">{item.requestId}</span><span className="text-muted">signed {formatWhen(item.createdAt)} · {item.files.length} file(s)</span></li>)}
          </ul>
          <div className="mt-2"><Button busy={busy === "flush"} onClick={() => act("flush", async () => {
            const r = await flushOutbox();
            setOutbox(await listOutbox());
            await queryClient.invalidateQueries({ queryKey: ["local-requests"] });
            if (r.stillHeld.length) throw new Error(`${r.sent.length} sent; ${r.stillHeld.length} still held (delivery unavailable). The same signed bytes will be used next time.`);
          }, "Sent. They count as received only once the Brain admits them.")}>Send now</Button></div>
        </section>
      )}

      <section aria-labelledby="jobs-h" className="mb-5">
        <h2 id="jobs-h" className="mb-2 text-lg font-semibold">Requests ({jobs.length})</h2>
        {jobs.length === 0 ? <EmptyState title={filter === "open" ? "No open requests" : "No requests yet"}>Completed requests stay in "All requests". Reading and navigating never creates one.</EmptyState> : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => {
              const label = JOB_STATE[job.state] ?? { label: job.state, tone: "neutral" as const };
              return (
                <li key={job.job_id} className="ll-card p-3" data-testid="activity-job" data-state={job.state}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusChip tone={label.tone}>{label.label}</StatusChip>
                    <span className="font-medium">{(job.action ?? "request").replace(/_/g, " ")}</span>
                    <span className="text-sm text-muted">{job.course_id.toUpperCase()} · {formatWhen(job.created_at)}{job.cancel_requested && job.state !== "CANCELLED" ? " · cancellation requested (not final)" : ""}</span>
                  </div>
                  {job.reason && <p className="mb-2 text-sm">{job.reason}</p>}
                  <Phases job={job} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className="ll-btn ll-btn-sm" to={`/activity/${job.request_id}`}>Details</Link>
                    {job.actions.includes("check_status") && <Button size="sm" busy={busy === `c${job.job_id}`} onClick={() => act(`c${job.job_id}`, () => actions.reconcile(job.request_id!), "Checked against existing receipts. Nothing was re-sent.")}>Check status</Button>}
                    {job.actions.includes("retry") && <Button size="sm" variant="quiet" busy={busy === `r${job.job_id}`} onClick={() => act(`r${job.job_id}`, () => actions.retry(job.request_id!), "Queued again as a new dispatch of the same input.")}>Retry deliberately</Button>}
                    {job.actions.includes("cancel") && app.pairing.state === "paired" && <Button size="sm" variant="quiet" busy={busy === `x${job.job_id}`} onClick={() => act(`x${job.job_id}`, () => actions.cancel(job.course_id, job.request_id!), "Cancellation requested. It is final only when the Brain confirms; captured input and saved records are kept.")}>Cancel</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(data?.pending_bundles.length ?? 0) > 0 && (
        <section className="mb-5" aria-labelledby="pending-h">
          <h2 id="pending-h" className="mb-2 text-lg font-semibold">Waiting for complete files</h2>
          <ul className="flex flex-col gap-1 text-sm">{data!.pending_bundles.map((p) => <li key={p.name} className="ll-card p-2"><span className="font-mono">{p.name}</span> — {p.reason}</li>)}</ul>
        </section>
      )}
      {(data?.rejections.length ?? 0) > 0 && (
        <section className="mb-5" aria-labelledby="rej-h">
          <h2 id="rej-h" className="mb-2 text-lg font-semibold">Not accepted ({data!.rejections.length})</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data!.rejections.map((r) => <li key={r.course_id + r.name} className="ll-card p-2"><StatusChip tone="danger">{r.status.replace(/_/g, " ")}</StatusChip> <span className="font-mono">{r.name}</span> — {r.reason} <span className="text-muted">The submitted files were kept, not deleted.</span></li>)}
          </ul>
        </section>
      )}
      {internal.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Background preparation ({internal.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">{internal.map((j) => <li key={j.job_id} className="ll-card p-2">{j.course_id.toUpperCase()} · {(j.action ?? j.workflow).replace(/[-_]/g, " ")} · {JOB_STATE[j.state]?.label ?? j.state}{j.reason ? ` — ${j.reason}` : ""}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function RequestDetail({ requestId }: { requestId: string }) {
  const app = useApp();
  const detail = useQuery<{ job: ActivityJob; events: Array<{ id: number; kind: string; at: number; detail: Record<string, unknown> }>; receipts: Array<{ kind: string; ref: string | null; generation: number | null; created_at: number }> }, Error>({
    queryKey: ["activity", requestId], queryFn: () => apiGet(`activity/${encodeURIComponent(requestId)}`), retry: false, refetchInterval: 3000 });
  const local = useLocalRequests(app.courseId);
  const mine = local.data?.find((r) => r.requestId === requestId);
  return (
    <div className="ll-page ll-page-reading">
      <Link to="/activity" className="ll-btn ll-btn-sm mb-3">← All activity</Link>
      <PageHeader title="Request detail" subtitle={<span className="break-all font-mono">{requestId}</span>} />
      {mine && <div className="mb-4"><RequestCard request={mine} /></div>}
      {detail.isLoading ? <LoadingState /> : detail.isError || !detail.data ? (
        <Callout tone="caution" title="The Brain has not admitted this request">{detail.error?.message ?? "No record."} {mine ? "It is still held on this device; see its state above." : "It may have been sent from another device or not yet received."}</Callout>
      ) : (
        <>
          <section className="ll-card mb-4 p-3" aria-labelledby="ph-h">
            <h2 id="ph-h" className="mb-2 font-semibold">Where it stands</h2>
            <p className="mb-2"><StatusChip tone={JOB_STATE[detail.data.job.state]?.tone ?? "neutral"}>{JOB_STATE[detail.data.job.state]?.label ?? detail.data.job.state}</StatusChip> <span className="text-sm text-muted">generation {detail.data.job.generation} · {detail.data.job.dispatches} native dispatch(es)</span></p>
            {detail.data.job.reason && <p className="mb-2 text-sm">{detail.data.job.reason}</p>}
            <Phases job={detail.data.job} />
          </section>
          <section className="mb-4" aria-labelledby="ev-h">
            <h2 id="ev-h" className="mb-2 font-semibold">Timeline</h2>
            <ol className="flex flex-col gap-1 text-sm">
              {detail.data.events.map((e) => <li key={e.id} className="ll-card p-2"><span className="text-muted">{formatWhen(e.at)}</span> · {e.kind.replace(/_/g, " ")}{e.detail.to ? ` → ${JOB_STATE[String(e.detail.to)]?.label ?? String(e.detail.to)}` : ""}{e.detail.reason ? ` — ${String(e.detail.reason)}` : ""}</li>)}
            </ol>
          </section>
          <section aria-labelledby="rc-h">
            <h2 id="rc-h" className="mb-2 font-semibold">Receipts</h2>
            <ul className="flex flex-col gap-1 text-sm">{detail.data.receipts.map((r, i) => <li key={i} className="ll-card p-2">{r.kind.replace(/[-_]/g, " ")}{r.ref ? ` · ${r.ref}` : ""} <span className="text-muted">· {formatWhen(r.created_at)}</span></li>)}</ul>
          </section>
        </>
      )}
    </div>
  );
}

export function ConflictResolution() {
  const { conflictId = "" } = useParams();
  const [params] = useSearchParams();
  return conflictId.startsWith("resume-") ? <ResumeConflict courseId={conflictId.slice("resume-".length)} /> : <LinkConflict conflictId={conflictId} courseId={params.get("course") ?? ""} lectureId={params.get("lecture") ?? ""} />;
}

function ResumeConflict({ courseId }: { courseId: string }) {
  const resume = useResume(courseId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heads = resume.data?.conflict?.heads ?? [];
  useEffect(() => {
    for (const head of heads) {
      const draft = head.cursor.draft;
      if (draft && drafts[draft.sha256] === undefined) {
        void fetch(`/api/courses/${courseId}/resume/drafts/${draft.sha256}`).then(async (r) => {
          const text = r.ok ? await r.text() : "(draft bytes have not arrived on the Brain)";
          setDrafts((d) => ({ ...d, [draft.sha256]: text }));
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heads.map((h) => h.checkpoint_id).join("|")]);
  if (resume.isLoading) return <LoadingState />;
  if (resume.isError) return <ErrorState error={resume.error} />;
  if (!resume.data?.conflict) {
    return <EmptyState title="No competing study positions" action={<Link className="ll-btn" to="/study">Back to study</Link>}>{resume.data?.current ? "There is one current position; continue from Study." : "No position has been synchronised yet."}</EmptyState>;
  }
  return (
    <div className="ll-page ll-page-reading">
      <PageHeader title="Two study positions" subtitle={resume.data.conflict.note} />
      <ul className="grid gap-3 md:grid-cols-2">
        {heads.map((head) => {
          const page = (head.cursor.source.locator as { page?: number }).page ?? 1;
          return (
            <li key={head.checkpoint_id} className="ll-card flex flex-col gap-2 p-3" data-testid="resume-head">
              <h2 className="font-semibold">From device {head.device_id}</h2>
              <p className="text-sm text-muted">{head.cursor.lecture_id}, slide {page} · source version {head.cursor.source.version_id} · {head.cursor.position_ms !== null ? `recording at ${formatMs(head.cursor.position_ms)} (paused)` : "no playback position"} · received with time {formatWhen(head.updated_at)} (device clocks are not used to pick a winner)</p>
              {head.cursor.draft ? <><p className="ll-label">Draft on that device</p><p className="whitespace-pre-wrap rounded bg-pad p-2 text-sm">{drafts[head.cursor.draft.sha256] ?? "Loading…"}</p></> : <p className="text-sm text-muted">No draft.</p>}
              <Button variant="primary" busy={busy} onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await apiPost(`courses/${courseId}/resume/resolve`, { chosen: head.checkpoint_id, set_aside: heads.filter((h) => h.checkpoint_id !== head.checkpoint_id).map((h) => h.checkpoint_id) });
                  await queryClient.invalidateQueries({ queryKey: ["resume", courseId] });
                  navigate(`/courses/${courseId}/lectures/${head.cursor.lecture_id}?page=${page}`); // opens paused; the other draft stays kept
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>Continue from this one</Button>
              <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/lectures/${head.cursor.lecture_id}?page=${page}`}>Open without choosing</Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">The draft you do not choose is kept as a separate draft; nothing is merged, overwritten or sent.</p>
      {error && <Callout tone="danger" role="alert" title="Not resolved" className="mt-3">{error}</Callout>}
    </div>
  );
}

function interval(record: AnnotationRecord | null): string {
  const loc = record?.to.locator as { start_ms?: number; end_ms?: number } | undefined;
  return loc?.start_ms !== undefined ? `${formatMs(loc.start_ms)}–${formatMs(loc.end_ms ?? 0)} (${record!.review_state})` : record ? record.review_state : "none";
}

function LinkConflict({ conflictId, courseId, lectureId }: { conflictId: string; courseId: string; lectureId: string }) {
  const lecture = useLecture(courseId, lectureId);
  const actions = useSubmitActions();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (lecture.isLoading) return <LoadingState />;
  if (lecture.isError || !lecture.data) return <ErrorState error={lecture.error} />;
  const conflict = lecture.data.link_conflicts.find((c) => c.conflict_id === conflictId);
  const back = <Link className="ll-btn" to={`/courses/${courseId}/lectures/${lectureId}`}>Back to the lecture</Link>;
  if (!conflict || !conflict.current) return <EmptyState title="This conflict is resolved" action={back}>A later revision exists; both earlier versions remain in the history.</EmptyState>;
  const all = lecture.data.slides.flatMap((s) => s.occurrences);
  const head = all.find((o) => o.annotation_id === conflict.annotation_id);
  const resolve = async (useProposed: boolean) => {
    if (!head) return;
    setBusy(true);
    try {
      const loc = conflict.proposed.to.locator as unknown as { start_ms: number; end_ms: number };
      const record = reviseAnnotation({ record: head.record, artifact: head.artifact }, useProposed
        ? { review_state: conflict.proposed.review_state, startMs: loc.start_ms, endMs: loc.end_ms, reviewer_ref: conflict.proposed.review_state === "suggested" ? null : "learner", basis: "manual_review" }
        : { review_state: head.review_state, reviewer_ref: head.record.reviewer_ref });
      await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, { label: "Link conflict resolution", text: useProposed ? "Use the other version" : "Keep the current version", context: { lectureId, label: "Link conflict" } });
      setNotice("Resolution sent as a new revision. Both earlier versions stay in the history.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ll-page ll-page-reading">
      <PageHeader title="Two versions of a slide link" subtitle="Another correction was accepted first. Nothing was overwritten; choose which one should stand." />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="ll-card flex flex-col gap-2 p-3"><h2 className="font-semibold">Current (accepted)</h2><p data-testid="conflict-current">{interval(conflict.current)} · revision {conflict.current.revision}</p><Button busy={busy} disabled={!head} onClick={() => resolve(false)}>Keep this one</Button></div>
        <div className="ll-card flex flex-col gap-2 p-3"><h2 className="font-semibold">Your other version</h2><p data-testid="conflict-proposed">{interval(conflict.proposed)}</p><Button variant="primary" busy={busy} disabled={!head} onClick={() => resolve(true)}>Use this one instead</Button></div>
      </div>
      {notice && <Callout tone="accent" role="status" className="mt-3" title="Conflict">{notice}</Callout>}
      <div className="mt-3">{back}</div>
    </div>
  );
}
