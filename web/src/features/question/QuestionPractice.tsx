// SC06 Question and practice (UI15, UI22): the complete prompt with its origin and figures, explicit
// reference conditions, an answer editor kept apart from solutions, and deliberate hint/reveal that is
// recorded as exposure. Skipping creates nothing; only a submitted answer is assessed.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useApp } from "@/app/state";
import { Button, Callout, ErrorState, formatWhen, LoadingState, OUTCOME_LABEL, PageHeader, StatusChip } from "@/components/ui";
import { isoNow } from "@/lib/bundle";
import { deleteDraft, getDraft, saveDraft, type SourceRef } from "@/lib/db";
import { RELATION_LABEL } from "@/lib/labels";
import { useCourse, useQuestion, useReview } from "@/lib/queries";
import { NotPairedError, reviewItemPayload, type Conditions } from "@/lib/requests";
import type { QuestionRecord } from "@/lib/types";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard, type FollowUp } from "@/features/tutor/RequestCard";

export function QuestionPractice() {
  const { courseId = "", questionId = "" } = useParams();
  const app = useApp();
  const question = useQuestion(courseId, questionId);
  const course = useCourse(courseId);
  const review = useReview(courseId);
  const actions = useSubmitActions();
  const requests = useLocalRequests(courseId);
  const draftId = `practice:${courseId}:${questionId}`;
  const [text, setText] = useState("");
  const [durability, setDurability] = useState<"empty" | "saved_on_device" | "memory_only">("empty");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [solutionSeen, setSolutionSeen] = useState(false);
  const [exposure, setExposure] = useState<Conditions["prior_exposure"]>("unknown");
  const [parent, setParent] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<{ parent: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (courseId) app.setCourseId(courseId);
    void getDraft(draftId).then((d) => {
      if (d?.text) {
        setText(d.text);
        setDurability("saved_on_device");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (text === "") {
      void deleteDraft(draftId);
      setDurability("empty");
      return;
    }
    const timer = window.setTimeout(() => void saveDraft({ draftId, courseId, mode: "practice", text, updatedAt: isoNow(), context: { questionId, label: `Question ${questionId}` } }).then((r) => setDurability(r.durability)), 350);
    return () => window.clearTimeout(timer);
  }, [text, draftId, courseId, questionId]);

  const thread = useMemo(() => (requests.data ?? []).filter((r) => r.context.questionId === questionId && ["practice", "explain", "ask", "diagnose", "review_answer"].includes(r.action)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), [requests.data, questionId]);
  useEffect(() => {
    if (thread.some((r) => r.action === "practice")) setExposure("seen_question");
  }, [thread]);

  if (question.isLoading) return <LoadingState label="Opening question…" />;
  if (question.isError || !question.data) return <><ReturnLink /><ErrorState error={question.error} /></>;
  const q = question.data;
  const sources: SourceRef[] = [];
  const all = [...(course.data?.lectures ?? []).flatMap((l) => (l.deck ? [l.deck] : [])), ...(course.data?.other_sources ?? [])];
  const refs = q.source_refs.map((ref) => ({ ref, item: all.find((i) => i.source_id === ref.source_id) }));
  const record: QuestionRecord = { question_id: q.question_id, family_id: q.family?.family_id ?? null, family_revision: q.family?.revision ?? null, prompt: q.prompt, sources, attachments: [] };
  const existingItem = review.data?.items.find((i) => i.question.question_id === q.question_id) ?? null;
  const context = { questionId, label: `Question ${q.question_id}` };

  const run = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setNotice(e instanceof NotPairedError ? `${e.message}` : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submitAnswer = () => run("submit", async () => {
    const conditions: Conditions = {
      assistance_before_answer: solutionSeen ? "worked_solution" : hinted ? "hint" : "none_reported",
      reference_access: sourcesOpen ? "sources" : "none_reported",
      prior_exposure: solutionSeen ? "seen_solution" : exposure,
    };
    if (diagnostic) {
      await actions.answer({ courseId, text: text.trim(), action: "diagnose", question: { ...record, question_id: null, family_id: null, family_revision: null, prompt: diagnostic.prompt }, conditions: { ...conditions, assistance_before_answer: "unknown" },
        context, parentRequestId: diagnostic.parent, draftKey: `${draftId}:diag:${diagnostic.parent}` });
      setDiagnostic(null);
    } else {
      await actions.answer({ courseId, text: text.trim(), action: "practice", question: record, conditions, context, parentRequestId: parent, draftKey: draftId });
    }
    setText("");
    setParent(null);
  });

  const select = (selection: "saved_only" | "active") => run(selection, async () => {
    if (!review.data) throw new Error("Review status is still loading.");
    const payload = existingItem
      ? reviewItemPayload({ courseId, itemId: existingItem.item_id, revision: existingItem.revision + 1, question: existingItem.question, kind: existingItem.kind as "recall", selection,
          schedulerConfig: selection === "active" ? review.data.scheduler_config : null, supersedes: { record_id: existingItem.item_id, artifact: existingItem.artifact } })
      : reviewItemPayload({ courseId, itemId: `item-${q.question_id.toLowerCase()}`, revision: 1, question: record, kind: "explanation", selection, schedulerConfig: selection === "active" ? review.data.scheduler_config : null, supersedes: null });
    await actions.record(courseId, existingItem ? "edit_review" : "select_review", payload, { label: `Review selection · ${q.question_id}`, text: selection === "active" ? "Add to review" : "Save only", context });
    window.setTimeout(() => void review.refetch(), 2500);
  }, selection === "active" ? "Sent: add to review. It becomes due only through the scheduler, not automatically." : "Sent: saved only. It will not be scheduled.");

  const onFollowUp = (f: FollowUp) => {
    if (f.kind === "diagnose" && f.prompt) setDiagnostic({ parent: f.request.requestId, prompt: f.prompt });
    if (f.kind === "retry_answer") {
      setParent(f.request.requestId);
      setExposure("seen_question");
    }
    document.getElementById("practice-answer")?.focus();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <ReturnLink />
      <PageHeader title={q.title ?? q.question_id} subtitle={`${q.question_id} · ${q.origin === "course_source" ? "from course material" : "generated practice (tutor-authored)"}${q.collection ? ` · ${q.collection}` : ""}`} />

      <section aria-labelledby="prompt-h" className="ll-card mb-4 p-4">
        <h2 id="prompt-h" className="ll-label mb-1">Question</h2>
        <p className={q.prompt_in_index ? "whitespace-pre-wrap text-lg" : "whitespace-pre-wrap"} data-testid="question-prompt">{q.prompt}</p>
        {!q.prompt_in_index && (
          <Callout tone="neutral" role="note" className="mt-2" title="Read this question in the original">
            The course's question index does not store the wording of this question; the original page is the authority, including its figures and givens.
            Open it below, then answer here. Your answer is assessed against the same page.
          </Callout>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Original source:</span>
          {refs.map(({ ref, item }) => item
            ? <Link key={ref.source_id + ref.locator} className="ll-chip hover:underline" to={`/courses/${courseId}/sources/${encodeURIComponent(ref.source_id)}${q.page ? `?page=${q.page}` : ""}`}
                state={{ returnTo: `/courses/${courseId}/questions/${encodeURIComponent(questionId)}`, returnLabel: "Return to the question" }}>{item.filename ?? ref.source_id} · {ref.locator}</Link>
            : <span key={ref.source_id + ref.locator} className="ll-chip">{ref.source_id} · {ref.locator} (not available)</span>)}
        </div>
        <p className="mt-2 text-sm text-muted">Open the original to see all sub-parts, givens and figures exactly as set. {q.criteria_note}</p>
        {!q.rubric_available && <Callout tone="caution" className="mt-2" title="No reviewed rubric is linked">An answer is still retained in full, but it stays "assessment pending" instead of being graded.</Callout>}
      </section>

      {thread.length > 0 && (
        <section aria-label="Your work on this question" className="mb-4 flex flex-col gap-3">
          {thread.map((r) => <RequestCard key={r.requestId} request={r} onFollowUp={onFollowUp} showContext={false} />)}
        </section>
      )}

      <section aria-labelledby="answer-h" className="ll-card mb-4 flex flex-col gap-3 p-4">
        <h2 id="answer-h" className="text-lg font-semibold">{diagnostic ? "Diagnostic check" : parent ? "New answer" : "Your answer"}</h2>
        {diagnostic && <Callout tone="accent" title="One short check" actions={<Button size="sm" variant="quiet" onClick={() => setDiagnostic(null)}>Skip</Button>}>{diagnostic.prompt}</Callout>}
        {parent && !diagnostic && <p className="text-sm text-muted">This is a new answer: it will be a separate attempt and never overwrites your earlier one.</p>}
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Conditions for this attempt (self-reported)</legend>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={sourcesOpen} onChange={(e) => setSourcesOpen(e.target.checked)} /> I am using my notes or the course sources</label>
          <label className="flex items-center gap-2">Seen this question before?
            <select className="ll-input w-auto" value={exposure} onChange={(e) => setExposure(e.target.value as Conditions["prior_exposure"])}>
              <option value="unknown">Not sure</option><option value="unseen_reported">No</option><option value="seen_question">Yes</option><option value="seen_solution">Yes, with its solution</option>
            </select>
          </label>
          <p className="text-muted">This is practice, not a secured exam: hiding sources here cannot show that no other help was used.</p>
        </fieldset>
        <label className="sr-only" htmlFor="practice-answer">Your answer</label>
        <textarea id="practice-answer" className="ll-input min-h-[9rem]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your answer…" maxLength={200000} />
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite">{durability === "saved_on_device" ? <StatusChip tone="success">Draft saved on this device</StatusChip> : durability === "memory_only" ? <StatusChip tone="danger">Local save failed</StatusChip> : null}</span>
          {(hinted || solutionSeen) && <StatusChip tone="caution">{solutionSeen ? "Solution seen — recorded" : "Hint used — recorded"}</StatusChip>}
          <span className="flex-1" />
          <Button onClick={() => { setText(""); setDiagnostic(null); setParent(null); setNotice("Skipped. Nothing was recorded — a skip is not a failed attempt."); }}>Skip</Button>
          <Button variant="primary" busy={busy === "submit"} disabled={!text.trim()} onClick={submitAnswer} data-testid="submit-answer">Submit answer</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line/40 pt-3">
          <Button size="sm" busy={busy === "hint"} onClick={() => {
            if (text.trim() && !window.confirm("You have an unsubmitted answer. A hint will be recorded as help before your answer. Get the hint anyway? (Cancel lets you submit first.)")) return;
            void run("hint", async () => {
              await actions.ask({ courseId, text: `Give me one hint for this question, without the answer: ${q.prompt}`, depth: "quick", sources: [], context, draftKey: `${draftId}:hint:${thread.length}` });
              setHinted(true);
            }, "Hint requested. Your next answer will be recorded as given after a hint.");
          }}>Request a hint</Button>
          <Button size="sm" variant="quiet" onClick={() => {
            if (window.confirm("Mark that you looked at a solution for this question? Answers after this are recorded as given with the solution seen.")) {
              setSolutionSeen(true);
              setNotice("Recorded: solution seen. Restricted answer files open from Sources with a deliberate reveal.");
            }
          }}>I looked at a solution</Button>
        </div>
        {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
        {app.pairing.state !== "paired" && <p className="text-sm text-muted">This device is not paired, so nothing can be sent yet. <Link className="text-accent underline" to="/connect">Pair it</Link>.</p>}
      </section>

      <section aria-labelledby="review-h" className="ll-card mb-4 flex flex-col gap-2 p-4">
        <h2 id="review-h" className="text-lg font-semibold">Review</h2>
        <p className="text-sm text-muted">{existingItem ? `This question is in your review list: ${existingItem.selection.replace("_", " ")}. ${existingItem.schedule_note ?? ""}` : "Not in your review list."}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" busy={busy === "saved_only"} disabled={existingItem?.selection === "saved_only"} onClick={() => select("saved_only")}>Save only</Button>
          <Button size="sm" busy={busy === "active"} disabled={existingItem?.selection === "active" || !q.rubric_available} onClick={() => select("active")} title={q.rubric_available ? undefined : "Needs a reviewed rubric before it can be scheduled"}>Add to review</Button>
        </div>
      </section>

      {q.relationships.length > 0 && (
        <section aria-labelledby="rel-h" className="mb-4">
          <h2 id="rel-h" className="mb-2 text-lg font-semibold">Related questions</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {q.relationships.map((r, i) => {
              const other = r.from_question === q.question_id ? r.to_question : r.from_question;
              return (
                <li key={i} className="ll-card p-2">
                  {r.from_question === q.question_id ? "This question" : <Link className="text-accent underline" to={`/courses/${courseId}/questions/${encodeURIComponent(other)}`}>{other}</Link>} {RELATION_LABEL[r.relation] ?? r.relation}{" "}
                  {r.to_question === q.question_id ? "this question" : <Link className="text-accent underline" to={`/courses/${courseId}/questions/${encodeURIComponent(other)}`}>{other}</Link>}
                  <span className="block text-muted">{r.rationale} A relation between questions gives no automatic credit and is not a statement about a concept.</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence-h">
        <h2 id="evidence-h" className="mb-2 text-lg font-semibold">Recorded attempts on this question</h2>
        {q.evidence.length === 0 ? <p className="text-muted">Not assessed: no attempt is recorded for this question.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {q.evidence.map((e) => (
              <li key={e.attempt_id} className="ll-card flex flex-wrap items-center gap-2 p-2">
                <span>{formatWhen(e.recorded_at)}</span>
                {Object.entries(e.outcomes).map(([skill, outcome]) => <StatusChip key={skill} tone={OUTCOME_LABEL[outcome]?.tone ?? "neutral"} title={skill}>{OUTCOME_LABEL[outcome]?.label ?? outcome}</StatusChip>)}
                <span className="text-muted">{e.link_scope}{e.assessment_id !== e.attempt_id ? " · corrected assessment in effect" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
