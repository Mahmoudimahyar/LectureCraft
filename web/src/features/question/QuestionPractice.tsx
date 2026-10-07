// SC06 Question and practice (UI15, UI22): the complete prompt with its origin and figures, explicit
// reference conditions, an answer editor kept apart from solutions, and deliberate hint/reveal that is
// recorded as exposure. Skipping creates nothing; only a submitted answer is assessed.
//
// Amendment R2: the question's links to the slides are listed with their basis (Exact, Stated, a suggested link, or
// one of the two no-link lines), each page as a link to that page of that lecture; and the recorded attempts carry the
// five evidence states where the Brain sends them, prior exposure beside the state and never as assistance.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { BasisLabel, StateLabel } from "@/components/labels";
import { Button, ErrorState, formatWhen, LoadingState, OUTCOME_LABEL, PageHeader, Segmented } from "@/components/ui";
import { apiPost, contentUrl } from "@/lib/api";
import { isoNow } from "@/lib/bundle";
import { deleteDraft, getDraft, saveDraft, type SourceRef } from "@/lib/db";
import {
  NARROWED_SENTENCE, NO_LINK_LINE, PRIOR_EXPOSURE_LABEL, RELATION_LABEL, TIE_KIND, TIE_SENTENCE, evidenceSummarySentence, noLinkSentence, pageRef, sectionTieSentence, supportSentence, transcriptLinesRef,
  unlistedLabel,
} from "@/lib/labels";
import { useCourse, useLecture, useQuestion, useReview } from "@/lib/queries";
import { questionOwnLinks, tieOpensInLecture } from "@/lib/r2";
import { NotPairedError, reviewItemPayload, type Conditions } from "@/lib/requests";
import type { EvidenceObject, LectureQuestionTie, QuestionAnchor, QuestionFile, QuestionRecord, QuestionRow, QuestionView } from "@/lib/types";
import { observationsByAttempt, useNodeDetail } from "@/features/progress/ProgressPages";
import { Callout, Details, Page, ReturnLink } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard, type FollowUp } from "@/features/tutor/RequestCard";

type Exposure = Conditions["prior_exposure"];
const EXPOSURE_OPTIONS: Array<{ value: Exposure; label: string }> = [
  { value: "unknown", label: "Not sure" }, { value: "unseen_reported", label: "No" }, { value: "seen_question", label: "Yes" }, { value: "seen_solution", label: "Yes, with its solution" },
];
/** One line of what is known about where a question comes from: a quiet term, then what it holds. */
const LINE = "flex flex-wrap items-baseline gap-x-3 gap-y-1";
const TERM = "text-ui text-muted";
const outcomeWords = (outcome: string): string => OUTCOME_LABEL[outcome]?.label ?? unlistedLabel(outcome);

/** Pages as links, each to that page of that lecture's deck (or of the file itself when it is not the lecture's deck). */
function PageLinks({ courseId, questionId, pages, lectureId, sourceId, onDeck }: { courseId: string; questionId: string; pages: readonly number[]; lectureId: string | null; sourceId: string | null; onDeck: boolean }) {
  const back = { returnTo: `/courses/${courseId}/questions/${encodeURIComponent(questionId)}`, returnLabel: "Return to the question" };
  return (
    <>
      {pages.map((page, index) => {
        const href = onDeck && lectureId ? `/courses/${courseId}/lectures/${lectureId}?page=${page}&panel=questions` : sourceId ? `/courses/${courseId}/sources/${encodeURIComponent(sourceId)}?page=${page}` : null;
        return <span key={page}>{index > 0 ? ", " : ""}{href ? <Link className="ll-link ll-num" to={href} state={back}>{pageRef(page)}</Link> : <span className="ll-num">{pageRef(page)}</span>}</span>;
      })}
    </>
  );
}

/** The sentence of a course anchor, said of one page or of several. A page of another file is not a page of the lecture's slides and is said to be so. */
const OTHER_FILE_SENTENCE = "A page of another file, not of the lecture's slides.";
const courseSentence = (basis: "exact" | "stated", pages: number, onDeck: boolean): string =>
  !onDeck ? OTHER_FILE_SENTENCE : pages > 1 ? TIE_SENTENCE[basis].replace("this page", "these pages") : TIE_SENTENCE[basis];
const backToQuestion = (courseId: string, questionId: string) => ({ returnTo: `/courses/${courseId}/questions/${encodeURIComponent(questionId)}`, returnLabel: "Return to the question" });

/** Transcript lines as one link into the lecture's Transcript tab. Lines are never worded as pages. */
function LinesLink({ courseId, questionId, lectureId, lines }: { courseId: string; questionId: string; lectureId: string | null; lines: ReadonlyArray<readonly [number, number]> }) {
  const text = transcriptLinesRef(lines);
  const first = lines[0]?.[0];
  if (!text) return null;
  return lectureId && first !== undefined ? <Link className="ll-link ll-num" to={`/courses/${courseId}/lectures/${lectureId}?panel=transcript&line=${first}`} state={backToQuestion(courseId, questionId)}>{text}</Link> : <span className="ll-num">{text}</span>;
}

/** What a course anchor names: its pages as links, its transcript lines as a link, then the sentence of its basis. */
function CourseAnchorSentence({ courseId, questionId, basis, pages, lines, lectureId, sourceId, onDeck }: {
  courseId: string; questionId: string; basis: "exact" | "stated"; pages: readonly number[]; lines: ReadonlyArray<readonly [number, number]>; lectureId: string | null; sourceId: string | null; onDeck: boolean;
}) {
  const hasLines = lines.length > 0;
  if (pages.length === 0) return hasLines ? <><LinesLink courseId={courseId} questionId={questionId} lectureId={lectureId} lines={lines} /> of the lecture's transcript.</> : null;
  return (
    <>
      <PageLinks courseId={courseId} questionId={questionId} pages={pages} lectureId={lectureId} sourceId={sourceId} onDeck={onDeck} />
      {hasLines && <>, <LinesLink courseId={courseId} questionId={questionId} lectureId={lectureId} lines={lines} /></>}. {courseSentence(basis, pages.length, onDeck)}
    </>
  );
}

/** One tie of the question as the lecture view states it: its one basis label, the pages as links, and the sentence that goes with the basis. */
function TieLine({ courseId, questionId, tie }: { courseId: string; questionId: string; tie: LectureQuestionTie }) {
  const pages = tie.pages ?? [];
  let sentence: ReactNode;
  if (tie.tie === "agent_inferred") {
    sentence = (
      <>
        {pages.length > 0 && <><PageLinks courseId={courseId} questionId={questionId} pages={pages} lectureId={tie.lecture_id} sourceId={tie.source_id} onDeck={tieOpensInLecture(tie)} />. </>}
        {supportSentence(tie)}{tie.verdict === "narrowed" ? ` ${NARROWED_SENTENCE}` : ""}{tie.rationale ? <> Why: {tie.rationale}</> : null}
      </>
    );
  } else if (tie.granularity === "section") {
    sentence = sectionTieSentence(tie.section);
  } else {
    sentence = <CourseAnchorSentence courseId={courseId} questionId={questionId} basis={tie.tie} pages={pages} lines={tie.transcript_lines ?? []} lectureId={tie.lecture_id} sourceId={tie.source_id} onDeck={tieOpensInLecture(tie)} />;
  }
  return <li><BasisLabel tie={tie} sentence={sentence} /></li>;
}

/** The same from the question's own catalog anchors, for a Brain whose lecture view carries no ties. */
function AnchorLine({ courseId, questionId, anchor }: { courseId: string; questionId: string; anchor: QuestionAnchor }) {
  const isLines = anchor.kind === "transcript_lines";
  const pages = isLines ? [] : anchor.pages ?? anchor.ranges.flatMap(([first, last]) => Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i));
  return (
    <li>
      <BasisLabel basis={anchor.basis} sentence={<CourseAnchorSentence courseId={courseId} questionId={questionId} basis={anchor.basis} pages={pages} lines={isLines ? anchor.ranges : []}
        lectureId={anchor.lecture_id} sourceId={anchor.source_id} onDeck={anchor.on_displayed_deck === true} />}>{TIE_KIND[anchor.basis].label}</BasisLabel>
    </li>
  );
}

/** Where a question belongs and how to read it: lecture and slide links as stated or suggested; the authoritative original; a checked copy for reading. */
function QuestionSources({ courseId, questionId, view, row }: { courseId: string; questionId: string; view: QuestionView; row: QuestionRow | undefined }) {
  const back = { returnTo: `/courses/${courseId}/questions/${encodeURIComponent(questionId)}`, returnLabel: "Return to the question" };
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const open = (file: QuestionFile) => `/courses/${courseId}/sources/${encodeURIComponent(file.source_id)}${file.page ? `?page=${file.page}` : ""}`;
  const check = async () => {
    setChecking(true);
    setOutcome(null);
    try {
      const result = await apiPost<{ result: string; score?: number; scope?: string; reason?: string }>(`courses/${courseId}/questions/${encodeURIComponent(questionId)}/verify-rendition`, {});
      setOutcome(result.result === "match" ? "The copy's text matches the original. It is now offered as a display rendition."
        : `Not accepted as a rendition (${result.result.replace(/_/g, " ")}${typeof result.score === "number" ? `, ${Math.round(result.score * 100)}% of the page's words found in the original` : ""}). The original remains the only authority.`);
      await queryClient.invalidateQueries({ queryKey: ["question", courseId, questionId] });
    } catch (error) {
      setOutcome((error as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const { ties, noLink } = questionOwnLinks(view, row);
  const lecture = view.lecture_ids[0];
  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="question-sources">
      <p className="ll-measure text-ui text-muted" data-testid="question-membership">
        {view.lecture_ids.length ? <>Belongs to {view.lecture_ids.map((id, i) => <span key={id}>{i ? ", " : ""}<Link className="ll-link" to={`/courses/${courseId}/lectures/${id}?panel=questions`}>{id.replace("-", " ")}</Link></span>)} through its collection{view.collection ? ` ${view.collection}` : ""}.</>
          : <>Collection {view.collection ?? "none"}: not tied to a lecture unit.</>}
      </p>
      <div data-testid="question-links">
        <p className={TERM}>Links to the slides</p>
        {ties ? (
          <ul className="ll-measure mt-1 flex flex-col gap-1.5">
            {ties.map((tie, index) => <TieLine key={index} courseId={courseId} questionId={questionId} tie={tie} />)}
            {noLink && <li className="text-ui"><span className="font-semibold">{NO_LINK_LINE[noLink.state]?.label ?? unlistedLabel(String(noLink.state))}.</span> <span className="text-muted">{noLinkSentence(noLink)}</span></li>}
            {ties.length === 0 && !noLink && <li className="text-ui text-muted">{lecture ? "The lecture states no link for this question." : "No link to a slide is stated for this question."}</li>}
          </ul>
        ) : view.anchors.length > 0 ? (
          <ul className="ll-measure mt-1 flex flex-col gap-1.5">{view.anchors.map((anchor, index) => <AnchorLine key={index} courseId={courseId} questionId={questionId} anchor={anchor} />)}</ul>
        ) : (
          <p className="ll-measure mt-1 text-read">The course record names no slide for this question.{lecture ? <> Suggested links, when there are any, are listed with it in <Link className="ll-link" to={`/courses/${courseId}/lectures/${lecture}?panel=questions`}>the lecture's Questions tab</Link>.</> : null}</p>
        )}
        {ties?.some((tie) => tie.tie === "agent_inferred" && tie.learner_decision == null) && lecture && (
          <p className="ll-measure mt-1 text-read text-muted">Accept or reject a suggested link in <Link className="ll-link" to={`/courses/${courseId}/lectures/${lecture}?panel=questions`}>the lecture's Questions tab</Link>.</p>
        )}
      </div>
      {view.original && (
        <div className={LINE}>
          <span className={TERM}>Original (authoritative):</span>
          {view.original.available
            ? view.original.displayable
              ? <Link className="ll-btn ll-btn-sm" to={open(view.original)} state={back}>Open original{view.original.page ? `, page ${view.original.page}` : ""}</Link>
              : <a className="ll-btn ll-btn-sm" href={contentUrl(`sources/${courseId}/${view.original.source_id}/content`)} target="_blank" rel="noreferrer">Open original ({view.original.filename})</a>
            : <span className="text-ui">{view.original.filename ?? view.original.source_id}: file not available</span>}
          {view.original.available && !view.original.displayable && <span className={TERM}>This file type opens outside the app.</span>}
        </div>
      )}
      {view.display_rendition && (
        <div className={LINE} data-testid="display-rendition">
          <span className={TERM}>Display rendition:</span>
          <Link className="ll-btn ll-btn-sm" to={open(view.display_rendition)} state={back}>Read the copy{view.display_rendition.page ? `, page ${view.display_rendition.page}` : ""}</Link>
          <span className="ll-measure text-ui text-muted">{view.display_rendition.filename}. {view.display_rendition.note} {view.display_rendition.verification?.scope}</span>
        </div>
      )}
      {view.related_copy && (
        <div className={LINE} data-testid="related-copy">
          <span className={TERM}>Copy, not checked:</span>
          <Link className="ll-btn ll-btn-sm" to={open(view.related_copy)} state={back}>Open the copy</Link>
          <Button size="sm" variant="quiet" busy={checking} onClick={check}>Check it against the original</Button>
          <span className="ll-measure text-ui text-muted">{view.related_copy.filename}. {view.related_copy.note}.</span>
        </div>
      )}
      {outcome && <p role="status" className="ll-measure text-read text-muted">{outcome}</p>}
    </div>
  );
}

export function QuestionPractice() {
  const { courseId = "", questionId = "" } = useParams();
  const app = useApp();
  const question = useQuestion(courseId, questionId);
  const course = useCourse(courseId);
  const review = useReview(courseId);
  // The lecture view carries the question's ties and its no-link line (R2); the node detail its five-state evidence.
  const lecture = useLecture(courseId, question.data?.lecture_ids[0]);
  const detail = useNodeDetail(courseId, questionId, !!question.data);
  const actions = useSubmitActions();
  const requests = useLocalRequests(courseId);
  const draftId = `practice:${courseId}:${questionId}`;
  const [text, setText] = useState("");
  const [durability, setDurability] = useState<"empty" | "saved_on_device" | "memory_only">("empty");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [solutionSeen, setSolutionSeen] = useState(false);
  const [exposure, setExposure] = useState<Exposure>("unknown");
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
  const observations = useMemo(() => observationsByAttempt(detail.data), [detail.data]);

  if (question.isLoading) return <Page reading><LoadingState label="Opening question…" /></Page>;
  if (question.isError || !question.data) return <Page reading><ReturnLink /><ErrorState error={question.error} /></Page>;
  const q = question.data;
  const sources: SourceRef[] = [];
  const all = [...(course.data?.lectures ?? []).flatMap((l) => (l.deck ? [l.deck] : [])), ...(course.data?.other_sources ?? [])];
  const refs = q.source_refs.map((ref) => ({ ref, item: all.find((i) => i.source_id === ref.source_id) }));
  const record: QuestionRecord = { question_id: q.question_id, family_id: q.family?.family_id ?? null, family_revision: q.family?.revision ?? null, prompt: q.prompt, sources, attachments: [] };
  const existingItem = review.data?.items.find((i) => i.question.question_id === q.question_id) ?? null;
  const context = { questionId, label: `Question ${q.question_id}` };
  const row = lecture.data?.questions.all.find((entry) => entry.question_id === q.question_id);
  const r2 = detail.data?.evidence;

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
    <Page reading>
      <ReturnLink />
      {/* The question is named by its title; its catalog identifier is under "Details" at the foot of the page (it is the title only when the catalog gives none). */}
      <PageHeader title={q.title ?? q.question_id} subtitle={<span className="text-ui">{q.origin === "course_source" ? "From course material" : "Generated practice (tutor-authored)"}{q.collection ? ` · ${q.collection}` : ""}</span>} />

      <section aria-labelledby="prompt-h" className="mb-8">
        <h2 id="prompt-h" className="text-head font-semibold">Question</h2>
        <p className="ll-measure mt-2 whitespace-pre-wrap" data-testid="question-prompt">{q.prompt}</p>
        {!q.prompt_in_index && (
          <Callout tone="neutral" role="note" className="mt-3" title="Read this question in the original">
            The course's question index does not store the wording of this question; the original page is the authority, including its figures and givens.
            Open it below, then answer here. Your answer is assessed against the same page.
          </Callout>
        )}
        <div className={`mt-4 ${LINE}`}>
          <span className={TERM}>Original source:</span>
          {refs.map(({ ref, item }) => item
            ? <Link key={ref.source_id + ref.locator} className="ll-link text-ui" to={`/courses/${courseId}/sources/${encodeURIComponent(ref.source_id)}${q.page ? `?page=${q.page}` : ""}`}
                state={{ returnTo: `/courses/${courseId}/questions/${encodeURIComponent(questionId)}`, returnLabel: "Return to the question" }}>{item.filename ?? ref.source_id} · {ref.locator}</Link>
            : <span key={ref.source_id + ref.locator} className="text-ui">{ref.source_id} · {ref.locator} (not available)</span>)}
        </div>
        <QuestionSources courseId={courseId} questionId={questionId} view={q} row={row} />
        <p className="ll-measure mt-3 text-read text-muted">Open the original to see all sub-parts, givens and figures exactly as set. {q.criteria_note}
          {q.criteria_authorship === "tutor_authored" ? " The criteria for this question were written by the tutor; they are not the instructor's point scheme." : ""}</p>
        {!q.rubric_available && <Callout tone="caution" className="mt-3" title="No reviewed rubric is linked">An answer is still retained in full, but it stays "assessment pending" instead of being graded.</Callout>}
      </section>

      {thread.length > 0 && (
        <section aria-label="Your work on this question" className="mb-8 flex flex-col gap-3">
          {thread.map((r) => <RequestCard key={r.requestId} request={r} onFollowUp={onFollowUp} showContext={false} />)}
        </section>
      )}

      <section aria-labelledby="answer-h" className="ll-region mb-8 flex flex-col gap-4 p-4 min-[900px]:p-6">
        <h2 id="answer-h" className="text-head font-semibold">{diagnostic ? "Diagnostic check" : parent ? "New answer" : "Your answer"}</h2>
        {diagnostic && <Callout tone="accent" title="One short check" actions={<Button size="sm" variant="quiet" onClick={() => setDiagnostic(null)}>Skip</Button>}>{diagnostic.prompt}</Callout>}
        {parent && !diagnostic && <p className="ll-measure text-read text-muted">This is a new answer: it will be a separate attempt and never overwrites your earlier one.</p>}
        <fieldset className="flex flex-col gap-3 text-ui">
          <legend className="mb-2 font-semibold">Conditions for this attempt (self-reported)</legend>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-5 flex-none accent-accent" checked={sourcesOpen} onChange={(e) => setSourcesOpen(e.target.checked)} /> I am using my notes or the course sources</label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Seen this question before?</span>
            <Segmented<Exposure> label="Seen this question before?" value={exposure} onChange={setExposure} options={EXPOSURE_OPTIONS} />
          </div>
          <p className="ll-measure text-muted">This is practice, not a secured exam: hiding sources here cannot show that no other help was used.</p>
        </fieldset>
        <label className="sr-only" htmlFor="practice-answer">Your answer</label>
        <textarea id="practice-answer" className="ll-input min-h-[9rem]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your answer…" maxLength={200000} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span role="status" aria-live="polite" className="text-ui text-muted empty:absolute">{durability === "saved_on_device" ? "Draft saved on this device" : durability === "memory_only" ? <span className="font-semibold text-ink">Local save failed</span> : null}</span>
          {!text.trim() && <span className="text-ui text-muted">Submit is off until you have written an answer.</span>}
          {(hinted || solutionSeen) && <span className="text-ui">{solutionSeen ? "Solution seen — recorded" : "Hint used — recorded"}</span>}
          <span className="flex-1" />
          <Button onClick={() => { setText(""); setDiagnostic(null); setParent(null); setNotice("Skipped. Nothing was recorded — a skip is not a failed attempt."); }}>Skip</Button>
          <Button variant="primary" busy={busy === "submit"} disabled={!text.trim()} onClick={submitAnswer} data-testid="submit-answer">Submit answer</Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
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
        {notice && <p role="status" className="ll-measure text-read text-muted">{notice}</p>}
        {app.pairing.state !== "paired" && <p className="ll-measure text-read text-muted">This device is not paired, so nothing can be sent yet. <Link className="ll-link" to="/connect">Pair it</Link>.</p>}
      </section>

      <section aria-labelledby="review-h" className="mb-8 flex flex-col gap-2">
        <h2 id="review-h" className="text-head font-semibold">Review</h2>
        <p className="ll-measure text-read text-muted">{existingItem ? `This question is in your review list: ${existingItem.selection.replace("_", " ")}. ${existingItem.schedule_note ?? ""}` : "Not in your review list."}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" busy={busy === "saved_only"} disabled={existingItem?.selection === "saved_only"} onClick={() => select("saved_only")}>Save only</Button>
          <Button size="sm" busy={busy === "active"} disabled={existingItem?.selection === "active" || !q.rubric_available} onClick={() => select("active")} title={q.rubric_available ? undefined : "Needs a reviewed rubric before it can be scheduled"}>Add to review</Button>
          {!q.rubric_available && <span className="text-ui text-muted">It cannot be scheduled: a reviewed rubric is needed first.</span>}
        </div>
      </section>

      {q.relationships.length > 0 && (
        <section aria-labelledby="rel-h" className="mb-8">
          <h2 id="rel-h" className="mb-2 text-head font-semibold">Related questions</h2>
          <ul className="flex flex-col">
            {q.relationships.map((r, i) => {
              const other = r.from_question === q.question_id ? r.to_question : r.from_question;
              return (
                <li key={i} className="ll-measure border-t border-hairline py-3 first:border-t-0 first:pt-0">
                  {r.from_question === q.question_id ? "This question" : <Link className="ll-link" to={`/courses/${courseId}/questions/${encodeURIComponent(other)}`}>{other}</Link>} {RELATION_LABEL[r.relation] ?? r.relation}{" "}
                  {r.to_question === q.question_id ? "this question" : <Link className="ll-link" to={`/courses/${courseId}/questions/${encodeURIComponent(other)}`}>{other}</Link>}
                  <span className="block text-ui text-muted">{r.rationale} A relation between questions gives no automatic credit and is not a statement about a concept.</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence-h">
        <h2 id="evidence-h" className="mb-2 text-head font-semibold">Recorded attempts on this question</h2>
        {r2?.state && q.evidence.length > 0 && <StateLabel evidence={r2 as EvidenceObject} />}
        {r2?.summary && q.evidence.length > 0 && <p className="ll-measure mt-1 text-read text-muted">{evidenceSummarySentence(r2.summary)}</p>}
        {q.evidence.length === 0 ? <p className="text-muted">Not assessed: no attempt is recorded for this question.</p> : (
          <ul className="mt-2 flex flex-col">
            {q.evidence.map((e) => {
              const observation = observations.get(e.attempt_id);
              return (
                <li key={e.attempt_id} className="flex flex-col items-start gap-1 border-t border-hairline py-3 text-ui first:border-t-0">
                  <p><span className="font-semibold">{Object.values(e.outcomes).map(outcomeWords).join(", ") || "No outcome recorded"}</span> <span className="ll-num text-muted">· {formatWhen(e.recorded_at)}</span></p>
                  {observation && <StateLabel evidence={observation} beside={observation.prior_exposure === "seen" ? [] : [PRIOR_EXPOSURE_LABEL[observation.prior_exposure] ?? unlistedLabel(String(observation.prior_exposure))]} />}
                  <p className="text-muted">{e.link_scope}{e.assessment_id !== e.attempt_id ? " · corrected assessment in effect" : ""}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {q.title && <Details className="mt-6" rows={[["Catalog identifier", q.question_id]]} />}
    </Page>
  );
}
