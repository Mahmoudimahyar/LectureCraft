// One submitted request with its orthogonal states: what was captured, whether the Brain received it,
// what the native turn did, whether an answer is available, and whether anything was saved to the
// course. These are never collapsed into a single "Saved" tick. A result is shown only after its
// signature and file digests verify against the paired Brain key.
import { useState } from "react";
import { Link } from "react-router";
import { Button, Callout, Dialog, Field, formatWhen, Markdown, OUTCOME_LABEL, StatusChip } from "@/components/ui";
import type { LocalRequest } from "@/lib/db";
import { ASSISTANCE_LABEL, JOB_STATE, REFERENCE_LABEL } from "@/lib/labels";
import { useRequestStatus } from "@/lib/queries";
import type { Conditions } from "@/lib/requests";
import type { QuestionRecord, ResultDetail } from "@/lib/types";
import { useSubmitActions } from "./actions";

const ACTION_LABEL: Record<string, string> = {
  ask: "Question", explain: "Explain back", practice: "Practice answer", review_answer: "Review answer", diagnose: "Diagnostic answer", correct_assessment: "Assessment dispute",
  correct_source: "Link correction", select_review: "Review selection", edit_review: "Review item edit", save_note: "Note", resume: "Position checkpoint", cancel: "Cancel", source_hint: "Source hint",
};

export interface FollowUp {
  kind: "deeper" | "explain" | "retry_answer" | "diagnose";
  request: LocalRequest;
  prompt?: string;
}

function DiagnosticBlock({ detail, request, onFollowUp }: { detail: ResultDetail; request: LocalRequest; onFollowUp?: (f: FollowUp) => void }) {
  const [open, setOpen] = useState(false);
  const diagnostic = detail.diagnostic;
  if (!diagnostic || (diagnostic.hypotheses.length === 0 && !diagnostic.next_prompt)) return null;
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Understand this gap</Button>;
  return (
    <div className="ll-card flex w-full flex-col gap-2 p-3" data-testid="diagnostic">
      <p className="font-semibold">Possible causes (hypotheses, not conclusions)</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {diagnostic.hypotheses.map((h, i) => (
          <li key={i}>
            {h.statement} <span className="text-muted">— {h.supporting}</span>
            {h.alternative_causes.length > 0 && <span className="block text-muted">Other explanations: {h.alternative_causes.join("; ")}</span>}
          </li>
        ))}
      </ul>
      {diagnostic.next_prompt ? (
        <>
          <p className="text-sm"><span className="font-medium">One short check:</span> {diagnostic.next_prompt}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => onFollowUp?.({ kind: "diagnose", request, prompt: diagnostic.next_prompt! })}>Answer this check</Button>
            <Button size="sm" onClick={() => setOpen(false)}>Skip</Button>
            <Button size="sm" variant="quiet" onClick={() => onFollowUp?.({ kind: "deeper", request })}>Just explain it</Button>
          </div>
          <p className="text-sm text-muted">Nothing runs until you answer. Skipping leaves this pending — it is not counted as a failure.</p>
        </>
      ) : <p className="text-sm text-muted">The short detour ends here{diagnostic.followups_limit ? ` (after ${diagnostic.followups_used} of ${diagnostic.followups_limit} checks)` : ""}. Going deeper is your choice.</p>}
    </div>
  );
}

const ADDED_EXPLANATION = "Added explanation — not from the cited course source";

// The reply. When the tutor itemized it and the parts really are the verified text, a part the tutor added beyond the
// supplied course source gets a quiet marker; supported parts are left as they are. Otherwise the text is shown as before.
function ReplyBody({ text, detail }: { text: string; detail: ResultDetail | null }) {
  const segments = detail?.support_itemized ? detail.segments ?? [] : [];
  const joined = segments.map((s) => s.text).join("\n\n");
  if (segments.length === 0 || !text.endsWith(joined)) return <Markdown>{text}</Markdown>;
  const lead = text.slice(0, text.length - joined.length).trim();
  return (
    <>
      {lead && <Markdown>{lead}</Markdown>}
      {segments.map((s, i) => s.support === "added_explanation"
        ? <div key={i} className="border-l-2 border-dashed border-line pl-2" title={ADDED_EXPLANATION} data-support="added_explanation"><span className="sr-only">{ADDED_EXPLANATION}: </span><Markdown>{s.text}</Markdown></div>
        : <Markdown key={i}>{s.text}</Markdown>)}
    </>
  );
}

export function RequestCard({ request, onFollowUp, showContext = true }: { request: LocalRequest; onFollowUp?: (f: FollowUp) => void; showContext?: boolean }) {
  const status = useRequestStatus(request.courseId, request.upload === "uploaded" ? request.requestId : null);
  const actions = useSubmitActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"assessment" | "input" | "rubric" | "new_answer">("assessment");
  const [corrected, setCorrected] = useState(request.text);

  const job = status.data?.envelope.job ?? null;
  const verified = status.data?.verified ?? null;
  const jobLabel = job ? (JOB_STATE[job.state] ?? { label: job.state, tone: "neutral" as const }) : null;
  const publication = verified?.publication ?? null;
  const detail = verified?.detail ?? null;
  const isAsk = request.action === "ask";
  const isAnswer = ["explain", "practice", "review_answer"].includes(request.action);
  const running = !!job && ["READY", "CLAIMED", "RUNNING", "STAGED", "COMMIT_PENDING", "WAITING_SYNC"].includes(job.state);

  const canCorrect = kind === "input" && isAnswer && !!publication?.captured_submission && !!request.answered;

  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const transportLabel = request.upload === "uploaded" ? (job ? "Received by Brain" : "Sent · waiting for the Brain to receive complete files")
    : request.upload === "retained_locally" ? "Kept on this device · not sent yet" : "Not sent · not stored";

  return (
    <article className="ll-card flex flex-col gap-2 p-3" aria-label={`${ACTION_LABEL[request.action] ?? request.action}: ${request.text.slice(0, 60)}`} data-testid="request-card" data-request-id={request.requestId} data-state={job?.state ?? request.upload}>
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StatusChip tone="accent">{ACTION_LABEL[request.action] ?? request.action}{request.action === "ask" ? ` · ${request.depth === "quick" ? "quick answer" : request.depth === "deep" ? "go deeper" : "understand"}` : ""}</StatusChip>
        {showContext && <span className="ll-chip">{request.context.label}</span>}
        <span className="text-muted">{formatWhen(request.createdAt)}</span>
      </header>
      <p className="whitespace-pre-wrap rounded bg-raised p-2 text-sm" data-testid="learner-text">{request.text}</p>

      <ul className="flex flex-wrap gap-1.5 text-sm" aria-label="Request status">
        <li><StatusChip tone={request.upload === "upload_failed" ? "danger" : "success"}>Your input: {request.upload === "upload_failed" ? "at risk — copy it" : request.upload === "uploaded" ? "captured" : "kept on this device"}</StatusChip></li>
        <li><StatusChip tone={request.upload === "uploaded" && job ? "success" : request.upload === "uploaded" ? "neutral" : "caution"}>{transportLabel}</StatusChip></li>
        {jobLabel && <li><StatusChip tone={jobLabel.tone}>{jobLabel.label}{job?.cancel_requested && job.state !== "CANCELLED" ? " · cancellation requested" : ""}</StatusChip></li>}
        {verified && <li><StatusChip tone="success">Answer available (verified)</StatusChip></li>}
      </ul>

      {job?.reason && !verified && <Callout tone={job.state === "FAILED_FINAL" ? "danger" : "caution"} title={jobLabel?.label}>{job.reason}</Callout>}
      {status.data?.verificationError && <Callout tone="danger" role="alert" title="Result not shown">{status.data.verificationError}</Callout>}
      {status.isError && <Callout tone="caution" title="Status unavailable">{status.error.message}</Callout>}

      {verified?.message && (
        <section aria-label="Tutor reply" className="border-l-2 border-accent pl-3" data-testid="tutor-reply">
          <p className="ll-label mb-1">Tutor</p>
          <ReplyBody text={verified.message.text} detail={detail} />
          {verified.message.sources.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Sources used">
              {verified.message.sources.map((s, i) => {
                const loc = s.locator as { kind: string; page?: number; start?: number; end?: number };
                const label = loc.kind === "page" ? `Slide/page ${loc.page}` : loc.kind === "lines" ? `Lines ${loc.start}–${loc.end}` : loc.kind;
                return <li key={i}>{request.context.lectureId && loc.kind === "page"
                  ? <Link className="ll-chip hover:underline" to={`/courses/${request.courseId}/lectures/${request.context.lectureId}?page=${loc.page}`}>{label}</Link> : <span className="ll-chip">{label}</span>}</li>;
              })}
            </ul>
          )}
          {detail?.uncertainty && <p className="mt-1 text-sm text-muted">Tutor's stated uncertainty: {detail.uncertainty}</p>}
          {detail?.problems?.map((p) => <p key={p} className="text-sm text-caution">Note: {p}</p>)}
        </section>
      )}

      {verified && isAsk && publication?.status === "not_requested" && (
        <Callout tone="unassessed" title="Not assessed this exchange" role="note">Receiving an answer does not establish understanding. Your earlier evidence is unchanged.</Callout>
      )}

      {verified && isAnswer && (
        <section aria-label="Feedback and save status" className="flex flex-col gap-2" data-testid="feedback">
          {detail?.capture_correction && (
            <Callout tone="neutral" role="note" title="Correction of an earlier capture">
              This is the same response with corrected wording. The original capture is kept unchanged and no new attempt was created
              {detail.previous_outcomes ? ` (before: ${Object.values(detail.previous_outcomes).map((o) => OUTCOME_LABEL[o]?.label ?? o).join(", ")})` : ""}.
            </Callout>
          )}
          {detail?.observations && detail.observations.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {detail.observations.map((o) => {
                const label = OUTCOME_LABEL[o.outcome] ?? { label: o.outcome, tone: "neutral" as const };
                const criterion = detail.criteria?.find((k) => k.skill_id === o.skill_id);
                return (
                  <li key={o.skill_id} className="rounded border border-line/40 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><StatusChip tone={label.tone}>{label.label}</StatusChip><span className="text-muted">confidence: {o.assessment_confidence}</span></div>
                    {criterion && <p className="mt-1"><span className="font-medium">Criterion:</span> {criterion.observable}</p>}
                    <p className="text-muted">{o.analysis}</p>
                    {o.missing_or_incorrect.length > 0 && <p>Missing or incorrect: {o.missing_or_incorrect.join("; ")}</p>}
                  </li>
                );
              })}
            </ul>
          ) : <Callout tone="caution" title="Assessment pending">{publication?.reason ?? "No assessment is available for this response yet. Your full response is retained."}</Callout>}
          {detail?.conditions && (
            <p className="text-sm text-muted">Recorded conditions: {ASSISTANCE_LABEL[detail.conditions.assistance_before_answer ?? "unknown"]}, {REFERENCE_LABEL[detail.conditions.reference_access ?? "unknown"]} (self-reported; unknown is not treated as unaided).</p>
          )}
          <ul className="flex flex-wrap gap-1.5 text-sm" aria-label="Save status">
            <li><StatusChip tone={publication?.captured_submission ? "success" : "caution"}>Full response {publication?.captured_submission ? "retained" : "retention not confirmed"}</StatusChip></li>
            <li><StatusChip tone={verified.message?.assessment_disposition === "canonical_saved" ? "success" : "caution"}>
              Assessment: {verified.message?.assessment_disposition === "canonical_saved" ? "recorded" : verified.message?.assessment_disposition === "provisional" ? "provisional" : "pending"}</StatusChip></li>
            <li><StatusChip tone={(publication && ["saved", "already_saved"].includes(publication.status)) || (detail?.capture_correction && publication?.kind === "none") ? "success" : "caution"}>
              {publication && ["saved", "already_saved"].includes(publication.status) ? (publication.kind === "assessment_revision" ? "Correction saved to course (revision of the same attempt)" : "Saved to course")
                : detail?.capture_correction && publication?.kind === "none" ? "Assessment unchanged — nothing rewritten"
                : publication?.status === "incomplete" ? "Course save uncertain — being reconciled" : "Awaiting course save"}</StatusChip></li>
            {publication && ["saved", "already_saved"].includes(publication.status) && (
              <li><StatusChip tone={publication.view_status === "current" ? "success" : "unassessed"}>Course summary view: {publication.view_status === "current" ? "current" : "stale (your attempt is saved; only the summary lags)"}</StatusChip></li>
            )}
          </ul>
          {publication && !["saved", "already_saved"].includes(publication.status) && publication.reason && <p className="text-sm text-muted">{publication.reason}</p>}
          {detail?.review_event && <p className="text-sm text-muted">Review: {detail.review_event.apply_schedule ? `scheduled with rating "${detail.review_event.rating}".` : detail.review_event.note ?? detail.review_event.error}</p>}
        </section>
      )}

      {verified && !isAsk && !isAnswer && publication && (
        <p className="text-sm" data-testid="publication-line"><StatusChip tone={["saved", "already_saved"].includes(publication.status) ? "success" : publication.status === "not_requested" ? "neutral" : "caution"}>
          {publication.kind === "none" ? "Done" : `${publication.kind.replace(/_/g, " ")}: ${publication.status.replace(/_/g, " ")}`}</StatusChip> <span className="text-muted">{publication.reason}</span></p>
      )}
      {verified && request.action === "diagnose" && detail && <DiagnosticBlock detail={detail} request={request} onFollowUp={onFollowUp} />}

      <footer className="flex flex-wrap gap-2">
        {verified && isAsk && onFollowUp && (
          <>
            <Button size="sm" onClick={() => onFollowUp({ kind: "deeper", request })}>Go deeper</Button>
            <Button size="sm" onClick={() => onFollowUp({ kind: "explain", request })}>Try explaining</Button>
            <Button size="sm" variant="quiet" busy={busy === "save"} onClick={() => act("save", () => actions.control(request.courseId, "save_note", { text: `Question saved for later: ${request.text}`, sources: request.context.source ? [request.context.source] : [], attachments: [] },
              { label: "Saved question", text: request.text, context: request.context }), "Saved to your notes for this course.")}>Save question for later</Button>
          </>
        )}
        {verified && isAnswer && detail && <DiagnosticBlock detail={detail} request={request} onFollowUp={onFollowUp} />}
        {verified && isAnswer && (
          <>
            {onFollowUp && <Button size="sm" onClick={() => onFollowUp({ kind: "retry_answer", request })}>Try again (new answer)</Button>}
            <Button size="sm" variant="quiet" onClick={() => setDisputeOpen(true)}>Report an issue</Button>
          </>
        )}
        {running && <Button size="sm" busy={busy === "cancel"} onClick={() => act("cancel", () => actions.cancel(request.courseId, request.requestId), "Cancellation requested. It is not final until the Brain confirms; your input is kept.")}>Cancel</Button>}
        {job && ["UNCERTAIN_COMPLETION", "STAGED", "COMMIT_PENDING"].includes(job.state) && (
          <Button size="sm" busy={busy === "check"} onClick={() => act("check", async () => { const r = await actions.reconcile(request.requestId); setNotice(`Checked: ${JOB_STATE[r.state]?.label ?? r.state}. Nothing was re-sent.`); })}>Check status</Button>
        )}
        {job && ["UNCERTAIN_COMPLETION", "AUTH_REQUIRED", "QUOTA_WAIT"].includes(job.state) && (
          <Button size="sm" variant="quiet" busy={busy === "retry"} onClick={() => act("retry", () => actions.retry(request.requestId), "Queued again as a new dispatch of the same input. An earlier result can no longer replace it.")}>Retry deliberately</Button>
        )}
        <Link className="ll-btn ll-btn-sm ll-btn-quiet" to={`/activity/${request.requestId}`}>Details</Link>
      </footer>
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen} title="Report an issue with this feedback" description="Choose what is wrong. The original response and its time are always kept."
        footer={<>
          <Button onClick={() => setDisputeOpen(false)}>Close</Button>
          <Button variant="primary" busy={busy === "dispute"} disabled={canCorrect ? corrected.trim().length === 0 || corrected.trim() === request.text.trim() : kind !== "new_answer" && reason.trim().length < 5}
            onClick={() => {
              if (kind === "new_answer") {
                setDisputeOpen(false);
                onFollowUp?.({ kind: "retry_answer", request });
                return;
              }
              const attempt = publication?.canonical_record;
              const original = publication?.captured_submission;
              if (kind === "input" && original && request.answered && isAnswer) {
                void act("dispute", async () => {
                  await actions.answer({ courseId: request.courseId, text: corrected.trim(), action: request.action as "explain" | "practice" | "review_answer",
                    question: request.answered!.question as unknown as QuestionRecord, conditions: request.answered!.conditions as unknown as Conditions, context: request.context,
                    parentRequestId: request.requestId, draftKey: `correction:${request.requestId}`, supersedes: { record_id: `turn-${request.requestId}`, artifact: original } });
                  setDisputeOpen(false);
                }, "Correction sent. The original capture is kept; the same attempt is re-read against your corrected wording — it is not a new attempt.");
                return;
              }
              void act("dispute", async () => {
                if (kind === "assessment" && attempt) await actions.dispute(request.courseId, attempt, reason.trim());
                else await actions.control(request.courseId, "save_note", { text: `[${kind === "input" ? "Captured input issue" : kind === "rubric" ? "Source or rubric issue" : "Assessment issue (not yet saved to course)"}] ${reason.trim()} — about request ${request.requestId}`,
                  sources: request.context.source ? [request.context.source] : [], attachments: [] }, { label: "Issue report", text: reason.trim(), context: request.context });
                setDisputeOpen(false);
                setReason("");
              }, kind === "assessment" && attempt ? "Sent for review. Nothing changes until the regrade is verified; clicking disagree does not change your record by itself." : "Recorded for review with the original evidence untouched.");
            }}>
            {kind === "new_answer" ? "Write a new answer" : canCorrect ? "Send corrected wording" : "Submit for review"}
          </Button>
        </>}>
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">What is the problem?</legend>
            {([["assessment", "The assessment is wrong", "Regrades the same response for the same skills. It is a revision, not a new attempt."],
              ["input", "My response was captured wrongly", "For example a transcription error. A linked correction is recorded; the original capture is not edited."],
              ["rubric", "The source or the criteria are wrong", "Goes to owner review; rubric changes are not applied automatically."],
              ["new_answer", "I understand it better now", "Write a new answer. It is a new attempt and never overwrites this one."]] as const).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2 rounded border border-line/40 p-2">
                <input type="radio" name={`dispute-${request.requestId}`} className="mt-1 size-4" checked={kind === value} onChange={() => setKind(value)} />
                <span><span className="font-medium">{label}</span><span className="block text-sm text-muted">{hint}</span></span>
              </label>
            ))}
          </fieldset>
          {canCorrect && (
            <Field label="What you actually said or wrote" htmlFor={`corrected-${request.requestId}`} hint="Fix only what was captured wrongly. This is recorded as a correction of the same response; to answer differently, choose “I understand it better now”.">
              <textarea id={`corrected-${request.requestId}`} className="ll-input min-h-[7rem]" value={corrected} onChange={(e) => setCorrected(e.target.value)} />
            </Field>
          )}
          {kind !== "new_answer" && !canCorrect && (
            <Field label="What should be reconsidered?" htmlFor={`reason-${request.requestId}`} hint={kind === "assessment" && !publication?.canonical_record ? "This assessment is not saved to the course yet, so your report is kept as a note for review." : undefined}>
              <textarea id={`reason-${request.requestId}`} className="ll-input min-h-[6rem]" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
      </Dialog>
    </article>
  );
}
