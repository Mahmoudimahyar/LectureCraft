// SC07 Questions and review, SC08 Review session (UI22–UI24). Existing course questions come first;
// saving an item is not scheduling it; one review event exists per review actually performed; a skip
// or an uncertain grade never becomes a failing rating.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useApp } from "@/app/state";
import { Button, Callout, Dialog, EmptyState, ErrorState, Field, formatWhen, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { newId } from "@/lib/bundle";
import { useReview } from "@/lib/queries";
import { reviewItemPayload, type Conditions } from "@/lib/requests";
import type { QuestionRecord, ReviewRow } from "@/lib/types";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard } from "@/features/tutor/RequestCard";

const SELECTION: Record<string, { label: string; tone: "success" | "neutral" | "unassessed" | "caution" }> = {
  active: { label: "In review", tone: "success" }, saved_only: { label: "Saved only (not scheduled)", tone: "neutral" }, suspended: { label: "Suspended", tone: "caution" }, retired: { label: "Removed from review", tone: "unassessed" },
};

function sessionKey(id: string) {
  return `ll.review.${id}`;
}

export function ReviewHome() {
  const app = useApp();
  const courseId = app.courseId;
  const review = useReview(courseId);
  const actions = useSubmitActions();
  const navigate = useNavigate();
  const [size, setSize] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [availableShown, setAvailableShown] = useState(20);

  if (!courseId) return <EmptyState title="No course selected">Choose a course in the header.</EmptyState>;
  if (review.isLoading) return <LoadingState label="Loading review…" />;
  if (review.isError || !review.data) return <ErrorState error={review.error} retry={() => void review.refetch()} />;
  const data = review.data;
  const due = data.items.filter((i) => i.is_due);
  const sessionSize = size ?? Math.min(data.default_session_size, Math.max(due.length, 1));

  const run = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      window.setTimeout(() => void review.refetch(), 2500);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const change = (row: ReviewRow, selection: ReviewRow["selection"], question: QuestionRecord = row.question) =>
    run(`${row.item_id}-${selection}`, () => actions.record(courseId, "edit_review", reviewItemPayload({ courseId, itemId: row.item_id, revision: row.revision + 1, question, kind: row.kind as "recall", selection,
      schedulerConfig: selection === "active" ? data.scheduler_config : null, supersedes: { record_id: row.item_id, artifact: row.artifact } }), { label: `Review item · ${row.item_id}`, text: `Change to ${selection}` }),
      "Change sent. Earlier responses and review history stay as they are; no review was invented.");

  const add = (question: QuestionRecord, selection: "saved_only" | "active", itemId: string) =>
    run(`${itemId}-${selection}`, () => actions.record(courseId, "select_review", reviewItemPayload({ courseId, itemId, revision: 1, question, kind: "explanation", selection,
      schedulerConfig: selection === "active" ? data.scheduler_config : null, supersedes: null }), { label: `Review selection · ${itemId}`, text: selection }),
      selection === "active" ? "Sent: added to review." : "Sent: saved only. It will not get a due date.");

  const start = () => {
    const id = newId("rs");
    const items = due.slice(0, sessionSize).map((i) => i.item_id);
    try {
      window.sessionStorage.setItem(sessionKey(id), JSON.stringify({ courseId, items }));
    } catch {
      /* the session then lives only in the route state */
    }
    navigate(`/review/sessions/${id}`, { state: { courseId, items } });
  };

  return (
    <div className="ll-page">
      <PageHeader title="Review" subtitle={data.note} actions={<Button onClick={() => { setPrompt(""); setCreateOpen(true); }}>Create my own question</Button>} />
      {notice && <Callout tone="accent" role="status" className="mb-3" title="Review">{notice}</Callout>}

      <section aria-labelledby="due-h" className="ll-card mb-5 p-4">
        <h2 id="due-h" className="text-lg font-semibold">Available now ({due.length})</h2>
        {due.length === 0 ? <p className="text-muted">Nothing is due. A due date is only a scheduling suggestion; nothing here means you forgot or learned something.</p> : (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">Session size
              <select className="ll-input w-auto" value={sessionSize} onChange={(e) => setSize(Number(e.target.value))}>
                {Array.from({ length: Math.min(due.length, 25) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} item{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <Button variant="primary" onClick={start} data-testid="start-review">Start review</Button>
            <p className="text-sm text-muted">You can stop at any point; unanswered items are simply not reviewed.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="items-h" className="mb-5">
        <h2 id="items-h" className="mb-2 text-lg font-semibold">Your selected and saved items ({data.items.length})</h2>
        {data.items.length === 0 ? <p className="text-muted">You have not saved or selected any question yet. Nothing is added automatically.</p> : (
          <ul className="flex flex-col gap-2">
            {data.items.map((row) => (
              <li key={row.item_id} className="ll-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-medium">{row.question.prompt}</p>
                  <StatusChip tone={SELECTION[row.selection]!.tone}>{SELECTION[row.selection]!.label}</StatusChip>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {row.question.question_id ?? "your own question"} · version {row.revision} · {row.performed_reviews} review{row.performed_reviews === 1 ? "" : "s"} done ({row.scheduled_reviews} scheduled, {row.practice_only_reviews} practice-only{row.pending_grades ? `, ${row.pending_grades} grade pending` : ""})
                  {row.due_at ? ` · next suggested ${formatWhen(row.due_at)}` : ""}. {row.schedule_note}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.question.question_id && <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/questions/${encodeURIComponent(row.question.question_id)}`}>Open question</Link>}
                  {row.selection !== "active" && <Button size="sm" busy={busy === `${row.item_id}-active`} disabled={!row.question.family_id} title={row.question.family_id ? undefined : "Needs a reviewed rubric before it can be scheduled"} onClick={() => change(row, "active")}>{row.selection === "suspended" ? "Resume" : "Add to review"}</Button>}
                  {row.selection === "active" && <Button size="sm" busy={busy === `${row.item_id}-suspended`} onClick={() => change(row, "suspended")}>Suspend</Button>}
                  {row.selection !== "retired" && <Button size="sm" variant="quiet" busy={busy === `${row.item_id}-retired`} onClick={() => window.confirm("Remove this item from review? Your past responses and reviews are kept.") && void change(row, "retired")}>Remove from review</Button>}
                  {!row.question.question_id && <Button size="sm" variant="quiet" onClick={() => { setEditing(row); setPrompt(row.question.prompt); }}>Edit my item</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="avail-h">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="avail-h" className="text-lg font-semibold">Course questions you can add ({data.available_total})</h2>
          <Link className="text-accent-text hover:underline" to={`/courses/${courseId}/questions`}>Browse the question bank by lecture and collection</Link>
        </div>
        {data.available_questions.length === 0 ? <p className="text-muted">This course has no question catalog to choose from, or every question is already in your list.</p> : (
          <ul className="flex flex-col gap-2">
            {data.available_questions.slice(0, availableShown).map((q) => {
              const record: QuestionRecord = { question_id: q.question_id, family_id: q.family_id, family_revision: q.family_revision, prompt: q.prompt, sources: [], attachments: [] };
              const itemId = `item-${q.question_id.toLowerCase()}`;
              return (
                <li key={q.question_id} className="ll-card flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <Link className="font-medium hover:underline" to={`/courses/${courseId}/questions/${encodeURIComponent(q.question_id)}`}>{q.title ?? q.question_id}</Link>
                    <p className="text-sm text-muted">{q.collection ? `${q.collection} · ` : ""}{q.origin === "course_source" ? "from course material" : "generated practice"} · {q.prompt_in_index ? `${q.prompt.slice(0, 120)}${q.prompt.length > 120 ? "…" : ""}` : "wording is in the original source"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" busy={busy === `${itemId}-saved_only`} onClick={() => add(record, "saved_only", itemId)}>Save only</Button>
                    <Button size="sm" busy={busy === `${itemId}-active`} disabled={!q.family_id} onClick={() => add(record, "active", itemId)}>Add to review</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data.available_total > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="available-count">
            Showing {Math.min(availableShown, data.available_total)} of {data.available_total}
            {availableShown < data.available_total && <Button size="sm" onClick={() => setAvailableShown((n) => n + 20)}>Show 20 more</Button>}
          </p>
        )}
      </section>

      <Dialog open={createOpen || !!editing} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditing(null); } }} title={editing ? "Edit my question" : "Create my own question"}
        description={editing ? "A substantive edit creates a new version. The earlier wording and its review history are kept." : "Your own question is marked learner-authored. Without a reviewed rubric it can be saved, but not scheduled or graded."}
        footer={<><Button onClick={() => { setCreateOpen(false); setEditing(null); }}>Cancel</Button>
          <Button variant="primary" disabled={prompt.trim().length < 5} onClick={() => {
            const question: QuestionRecord = { question_id: null, family_id: null, family_revision: null, prompt: prompt.trim(), sources: [], attachments: [] };
            if (editing) void change(editing, editing.selection === "active" ? "saved_only" : editing.selection, question);
            else void add(question, "saved_only", newId("item-own"));
            setCreateOpen(false);
            setEditing(null);
          }}>{editing ? "Save new version" : "Save only"}</Button></>}>
        <Field label="Question (include any givens the answer needs)" htmlFor="own-q"><textarea id="own-q" className="ll-input min-h-[7rem]" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}

export function ReviewSession() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const app = useApp();
  const stored = useMemo(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem(sessionKey(sessionId)) ?? "null") as { courseId: string; items: string[] } | null;
    } catch {
      return null;
    }
  }, [sessionId]);
  const courseId = stored?.courseId ?? app.courseId;
  const review = useReview(courseId);
  const actions = useSubmitActions();
  const requests = useLocalRequests(courseId);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [hinted, setHinted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, "answered" | "skipped">>({});
  const [submitted, setSubmitted] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!stored || !courseId) return <EmptyState title="This review session is no longer available" action={<Link className="ll-btn" to="/review">Back to review</Link>}>Review sessions are kept only for the current browser tab. Nothing was recorded for unanswered items.</EmptyState>;
  if (review.isLoading) return <LoadingState label="Loading review items…" />;
  if (review.isError || !review.data) return <ErrorState error={review.error} />;
  const items = stored.items.map((id) => review.data!.items.find((i) => i.item_id === id)).filter((i): i is ReviewRow => !!i);
  const item = items[index];
  const answered = Object.values(done).filter((v) => v === "answered").length;
  const skipped = Object.values(done).filter((v) => v === "skipped").length;

  if (finished || !item) {
    return (
      <div className="ll-page ll-page-reading">
        <PageHeader title="Review session finished" subtitle="Only items you actually answered were recorded as reviews." />
        <dl className="ll-card grid grid-cols-2 gap-2 p-4" data-testid="review-summary">
          <dt>Answered</dt><dd className="font-semibold">{answered}</dd>
          <dt>Skipped (nothing recorded)</dt><dd className="font-semibold">{skipped}</dd>
          <dt>Not reached</dt><dd className="font-semibold">{items.length - answered - skipped}</dd>
        </dl>
        <div className="mt-4 flex flex-col gap-3">
          {Object.values(submitted).map((requestId) => {
            const request = requests.data?.find((r) => r.requestId === requestId);
            return request ? <RequestCard key={requestId} request={request} showContext={false} /> : null;
          })}
        </div>
        <p className="mt-3 text-sm text-muted">Feedback that is still pending stays in Activity. A pending or uncertain grade is not treated as a wrong answer.</p>
        <div className="mt-4 flex gap-2"><Link className="ll-btn ll-btn-primary" to="/review">Back to review</Link><Link className="ll-btn" to="/study">Back to study</Link></div>
      </div>
    );
  }

  const currentRequest = submitted[item.item_id] ? requests.data?.find((r) => r.requestId === submitted[item.item_id]) : undefined;
  const next = () => {
    setText("");
    setHinted(false);
    setError(null);
    if (index + 1 >= items.length) setFinished(true);
    else setIndex(index + 1);
  };
  const submitAnswer = async () => {
    setBusy(true);
    setError(null);
    try {
      const conditions: Conditions = { assistance_before_answer: hinted ? "hint" : "none_reported", reference_access: "none_reported", prior_exposure: "seen_question" };
      const outcome = await actions.answer({ courseId, text: text.trim(), action: "review_answer", question: item.question, conditions, context: { questionId: item.question.question_id ?? undefined, label: `Review · ${item.question.question_id ?? "own question"}` },
        draftKey: `review:${sessionId}:${item.item_id}` });
      setSubmitted((s) => ({ ...s, [item.item_id]: outcome.requestId }));
      setDone((d) => ({ ...d, [item.item_id]: "answered" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ll-page ll-page-reading">
      <PageHeader title="Review session" subtitle={`Item ${index + 1} of ${items.length}`} actions={<Button onClick={() => setFinished(true)}>Stop here</Button>} />
      <article className="ll-card flex flex-col gap-3 p-4" aria-label="Review item">
        <p className="whitespace-pre-wrap text-lg" data-testid="review-prompt">{item.question.prompt}</p>
        {!currentRequest ? (
          <>
            <label className="sr-only" htmlFor="review-answer">Your answer</label>
            <textarea id="review-answer" className="ll-input min-h-[8rem]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer from memory before revealing anything…" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setHinted(true)} disabled={hinted}>{hinted ? "Hint noted — this will count as practice" : "I used a hint"}</Button>
              {item.question.question_id && <Link className="ll-btn ll-btn-sm ll-btn-quiet" to={`/courses/${courseId}/questions/${encodeURIComponent(item.question.question_id)}`} target="_blank" rel="noopener">Show source</Link>}
              <span className="flex-1" />
              <Button onClick={() => { setDone((d) => ({ ...d, [item.item_id]: "skipped" })); next(); }}>Skip</Button>
              <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={submitAnswer} data-testid="submit-review">Submit</Button>
            </div>
            <p className="text-sm text-muted">Skipping records nothing. With a hint, your answer is kept as practice and is not fed to the scheduler as a rating.</p>
          </>
        ) : (
          <>
            <RequestCard request={currentRequest} showContext={false} />
            <div className="flex justify-end"><Button variant="primary" onClick={next}>{index + 1 >= items.length ? "Finish" : "Continue"}</Button></div>
          </>
        )}
        {error && <Callout tone="danger" role="alert" title="Not sent">{error}</Callout>}
      </article>
      <div className="mt-3"><Button variant="quiet" onClick={() => navigate("/review")}>Leave session</Button></div>
    </div>
  );
}
