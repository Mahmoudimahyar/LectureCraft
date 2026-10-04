// Tutor panel (UI11–UI16): three interaction choices — Quick answer, Understand, Explain back.
// The draft is pinned to the slide it was started on, autosaved with its real durability, and sent
// only by an explicit action. Asking for help is never assessed; only a submitted response is.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Mic, SendHorizontal, X } from "lucide-react";
import { useApp } from "@/app/state";
import { NativeChip } from "@/app/Shell";
import { Button, Callout, IconButton, Segmented, StatusChip } from "@/components/ui";
import { deleteDraft, getDraft, saveDraft, type Draft, type DraftMode, type SourceRef } from "@/lib/db";
import { isoNow } from "@/lib/bundle";
import { NotPairedError, type Conditions } from "@/lib/requests";
import type { LectureView, QuestionRecord, SlideView } from "@/lib/types";
import { useLocalRequests, useSubmitActions } from "./actions";
import { RequestCard, type FollowUp } from "./RequestCard";
import { ResponseCapture } from "./ResponseCapture";

type Mode = "quick" | "understand" | "explain";

interface TutorPanelProps {
  courseId: string;
  lecture: LectureView;
  page: number;
  slideRef: SourceRef | null;
  pinned: Array<{ source: SourceRef; label: string }>;
  onUnpin: (index: number) => void;
  onPauseMedia: () => void;
  onGoToPage: (page: number) => void;
  hideSlide: boolean;
  onHideSlide: (hide: boolean) => void;
}

const PLACEHOLDER: Record<Mode, string> = {
  quick: "Ask about this slide — you get the short answer first…",
  understand: "Ask for an example, a contrast, the mechanism or a connection…",
  explain: "Explain it in your own words…",
};

export function TutorPanel({ courseId, lecture, page, slideRef, pinned, onUnpin, onPauseMedia, onGoToPage, hideSlide, onHideSlide }: TutorPanelProps) {
  const app = useApp();
  const actions = useSubmitActions();
  const draftId = `tutor:${courseId}:${lecture.lecture_id}`;
  const [mode, setMode] = useState<Mode>("quick");
  const [text, setText] = useState("");
  const [draftPage, setDraftPage] = useState(page);
  const [durability, setDurability] = useState<"empty" | "saving" | "saved_on_device" | "memory_only">("empty");
  const [questionId, setQuestionId] = useState<string>("");
  const [assistance, setAssistance] = useState<Conditions["assistance_before_answer"]>("none_reported");
  const [exposure, setExposure] = useState<Conditions["prior_exposure"]>("unknown");
  const [follow, setFollow] = useState<{ kind: FollowUp["kind"]; parent: string; prompt?: string } | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ message: string; copyable: boolean; pair?: boolean } | null>(null);
  const [onlyThisSlide, setOnlyThisSlide] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);
  const requests = useLocalRequests(courseId);

  // Restore the draft for this lecture (it stays attached to the slide it was written for).
  useEffect(() => {
    loaded.current = false;
    void getDraft(draftId).then((draft) => {
      if (draft && draft.text) {
        setText(draft.text);
        setMode(draft.mode === "explain" ? "explain" : draft.mode === "understand" ? "understand" : "quick");
        setDraftPage(draft.context.page ?? page);
        setQuestionId(draft.context.questionId ?? "");
        setDurability("saved_on_device");
      } else {
        setDraftPage(page);
      }
      loaded.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // An empty composer follows the current slide; a draft with text never silently changes its source.
  useEffect(() => {
    if (loaded.current && text.trim() === "" && !follow) setDraftPage(page);
  }, [page, text, follow]);

  const draftSlide: SlideView | undefined = lecture.slides.find((s) => s.page === draftPage);
  const draftSlideRef: SourceRef | null = slideRef ? { ...slideRef, locator: { kind: "page", page: draftPage, printed_label: null } } : null;
  const contextLabel = `Slide ${draftPage} · ${lecture.title}`;

  useEffect(() => {
    if (!loaded.current) return;
    if (text === "") {
      setDurability("empty");
      void deleteDraft(draftId);
      return;
    }
    setDurability("saving");
    const timer = window.setTimeout(() => {
      const draft: Draft = { draftId, courseId, mode: mode as DraftMode, text, updatedAt: isoNow(),
        context: { lectureId: lecture.lecture_id, page: draftPage, questionId: questionId || undefined, source: draftSlideRef ?? undefined, label: contextLabel } };
      void saveDraft(draft).then((r) => setDurability(r.durability));
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode, draftPage, questionId]);

  const slideQuestions = draftSlide?.questions ?? [];
  const chosenQuestion = slideQuestions.find((q) => q.question_id === questionId) ?? null;
  const priorHelpOnSlide = useMemo(() => (requests.data ?? []).some((r) => r.action === "ask" && r.context.lectureId === lecture.lecture_id && r.context.page === draftPage), [requests.data, lecture.lecture_id, draftPage]);
  useEffect(() => {
    if (priorHelpOnSlide && assistance === "none_reported") setAssistance("hint");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorHelpOnSlide]);

  const thread = useMemo(() => (requests.data ?? [])
    .filter((r) => r.context.lectureId === lecture.lecture_id && ["ask", "explain", "diagnose"].includes(r.action) && (!onlyThisSlide || r.context.page === page))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), [requests.data, lecture.lecture_id, onlyThisSlide, page]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    const sources = [...(draftSlideRef ? [draftSlideRef] : []), ...pinned.map((p) => p.source)];
    const context = { lectureId: lecture.lecture_id, page: draftPage, source: draftSlideRef ?? undefined, questionId: questionId || undefined, label: contextLabel };
    try {
      let outcome;
      if (follow?.kind === "diagnose") {
        const question: QuestionRecord = { question_id: null, family_id: null, family_revision: null, prompt: follow.prompt ?? "Diagnostic check", sources, attachments: [] };
        outcome = await actions.answer({ courseId, text: body, action: "diagnose", question, context, parentRequestId: follow.parent, draftKey: `${draftId}:diag:${follow.parent}`,
          conditions: { assistance_before_answer: "unknown", reference_access: hideSlide ? "none_reported" : "sources", prior_exposure: "unknown" } });
      } else if (mode === "explain") {
        const question: QuestionRecord = chosenQuestion
          ? { question_id: chosenQuestion.question_id, family_id: chosenQuestion.family_id, family_revision: chosenQuestion.family_revision, prompt: chosenQuestion.prompt, sources, attachments: [] }
          : { question_id: null, family_id: null, family_revision: null, prompt: `Explain slide ${draftPage} of "${lecture.title}" in your own words.`, sources, attachments: [] };
        outcome = await actions.answer({ courseId, text: body, action: "explain", question, context, parentRequestId: follow?.parent ?? null, draftKey: draftId, transcriptionRevision: transcription,
          conditions: { assistance_before_answer: assistance, reference_access: hideSlide ? "none_reported" : "sources", prior_exposure: exposure } });
      } else {
        const depth = follow?.kind === "deeper" ? "deep" : mode === "quick" ? "quick" : "standard";
        outcome = await actions.ask({ courseId, text: body, depth, sources, context, parentRequestId: follow?.parent ?? null, draftKey: draftId });
      }
      if (outcome.delivery === "not_retained") {
        setProblem({ message: outcome.reason ?? "Your text was not sent and could not be stored.", copyable: true });
      } else {
        setText("");
        setFollow(null);
        setTranscription(null);
        await deleteDraft(draftId);
        if (outcome.delivery === "retained_locally") setProblem({ message: `Kept on this device and will be sent when the Brain is reachable. ${outcome.reason ?? ""}`, copyable: false });
      }
    } catch (error) {
      setProblem({ message: (error as Error).message, copyable: false, pair: error instanceof NotPairedError });
    } finally {
      setSending(false);
    }
  };

  const onFollowUp = (f: FollowUp) => {
    setProblem(null);
    setDraftPage(f.request.context.page ?? page);
    if (f.kind === "deeper") {
      setMode("understand");
      setFollow({ kind: "deeper", parent: f.request.requestId });
      setText((t) => t || `Go deeper on: ${f.request.text}`);
    } else if (f.kind === "explain" || f.kind === "retry_answer") {
      setMode("explain");
      setFollow({ kind: f.kind, parent: f.request.requestId });
      setQuestionId(f.request.context.questionId ?? "");
      if (f.kind === "retry_answer") setExposure("seen_question");
    } else {
      setFollow({ kind: "diagnose", parent: f.request.requestId, prompt: f.prompt });
    }
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  const durabilityChip = durability === "saved_on_device" ? <StatusChip tone="success">Draft saved on this device</StatusChip>
    : durability === "memory_only" ? <StatusChip tone="danger">Local save failed — kept only while this page is open</StatusChip>
    : durability === "saving" ? <StatusChip tone="neutral">Saving draft…</StatusChip> : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="tutor-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Help that fits your time</h3>
        <NativeChip />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversation on this lecture">
        {thread.length === 0 ? <p className="text-sm text-muted">No questions or explanations on this lecture yet. Reading a slide is never counted as an assessment.</p> : (
          <>
            <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={onlyThisSlide} onChange={(e) => setOnlyThisSlide(e.target.checked)} /> Only this slide</label>
            <ol className="flex flex-col gap-3">{thread.map((r) => <li key={r.requestId}><RequestCard request={r} onFollowUp={onFollowUp} /></li>)}</ol>
          </>
        )}
      </div>

      <div className="ll-card flex flex-col gap-2 p-3">
        {follow?.kind === "diagnose" ? (
          <Callout tone="accent" title="Diagnostic check" actions={<Button size="sm" variant="quiet" onClick={() => { setFollow(null); setText(""); }}>Skip — return to the slide</Button>}>{follow.prompt}</Callout>
        ) : (
          <Segmented<Mode> label="Interaction" value={mode} onChange={(m) => { setMode(m); if (follow?.kind !== "retry_answer") setFollow(null); }}
            options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Context sent with your message">
          <span className="text-muted">Context:</span>
          <span className="ll-chip" data-testid="context-chip">Slide {draftPage}</span>
          {pinned.map((p, i) => (
            <span key={i} className="ll-chip">{p.label}<button type="button" aria-label={`Remove ${p.label}`} className="ml-1" onClick={() => onUnpin(i)}><X aria-hidden className="size-3" /></button></span>
          ))}
        </div>
        {draftPage !== page && text.trim() !== "" && (
          <Callout tone="caution" title={`This draft belongs to slide ${draftPage}`} role="status"
            actions={<>
              <Button size="sm" onClick={() => onGoToPage(draftPage)}>Go back to slide {draftPage}</Button>
              <Button size="sm" variant="quiet" onClick={() => setDraftPage(page)}>Move the draft to slide {page}</Button>
            </>}>
            You are now on slide {page}. The draft keeps its original slide unless you move it.
          </Callout>
        )}

        {mode === "explain" && follow?.kind !== "diagnose" && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">What to explain</span>
              <select className="ll-input" value={questionId} onChange={(e) => setQuestionId(e.target.value)} aria-describedby="explain-hint">
                <option value="">Slide {draftPage} in my own words (no rubric — kept as "assessment pending")</option>
                {slideQuestions.map((q) => <option key={q.question_id} value={q.question_id}>{q.title ?? q.question_id}</option>)}
              </select>
            </label>
            <p id="explain-hint" className="rounded bg-raised p-2">{chosenQuestion ? chosenQuestion.prompt : `Explain slide ${draftPage} in your own words. Your full response is retained; without a reviewed rubric it is not graded.`}</p>
            <details>
              <summary className="cursor-pointer font-medium">Conditions (self-reported)</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">Help before this answer
                  <select className="ll-input" value={assistance} onChange={(e) => setAssistance(e.target.value as Conditions["assistance_before_answer"])}>
                    <option value="none_reported">None</option><option value="hint">A hint or tutor answer</option><option value="formula">A formula was given</option>
                    <option value="worked_solution">I saw a worked solution</option><option value="unknown">Not sure</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">Have you seen this question before?
                  <select className="ll-input" value={exposure} onChange={(e) => setExposure(e.target.value as Conditions["prior_exposure"])}>
                    <option value="unknown">Not sure</option><option value="unseen_reported">No</option><option value="seen_question">Yes, the question</option><option value="seen_solution">Yes, and its solution</option>
                  </select>
                </label>
              </div>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" className="size-4" checked={hideSlide} onChange={(e) => onHideSlide(e.target.checked)} /> Hide the slide while I explain (recorded as "no references reported")</label>
              <p className="mt-1 text-muted">These are your own report. Hiding sources here cannot prove that no other help was used.</p>
            </details>
          </div>
        )}

        <label className="sr-only" htmlFor="tutor-composer">{follow?.kind === "diagnose" ? "Your answer to the diagnostic check" : PLACEHOLDER[mode]}</label>
        <textarea id="tutor-composer" ref={textRef} className="ll-input min-h-[6.5rem] resize-y" placeholder={follow?.kind === "diagnose" ? "Your answer…" : PLACEHOLDER[mode]} value={text}
          onChange={(e) => setText(e.target.value)} maxLength={200000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }} />
        <div className="flex flex-wrap items-center gap-2">
          {mode === "explain" && follow?.kind !== "diagnose" && <IconButton label="Explain aloud" onClick={() => setCaptureOpen(true)}><Mic aria-hidden className="size-5" /></IconButton>}
          {transcription && <StatusChip tone="neutral">From your corrected voice transcript</StatusChip>}
          <span className="min-w-0 flex-1" role="status" aria-live="polite">{durabilityChip}</span>
          <Button variant="primary" onClick={send} busy={sending} disabled={text.trim() === ""} data-testid="send">
            <SendHorizontal aria-hidden className="size-4" />
            {follow?.kind === "diagnose" ? "Submit answer" : mode === "explain" ? "Check my explanation" : "Send"}
          </Button>
        </div>
        <p className="text-xs text-muted">Nothing is sent while you type. {mode === "explain" ? "Your response is frozen and retained before the tutor sees it." : "Asking for help is not assessed."} Ctrl+Enter sends.</p>
        {problem && (
          <Callout tone="danger" role="alert" title="Not sent" actions={<>
            {problem.copyable && <Button size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>Copy my text</Button>}
            {problem.pair && <Link className="ll-btn ll-btn-sm" to="/connect">Pair this device</Link>}
          </>}>{problem.message}</Callout>
        )}
        {app.pairing.state !== "paired" && !problem && <p className="text-sm text-muted">This device is not paired yet, so sending is off. <Link className="text-accent underline" to="/connect">Pair it</Link> — your draft stays here.</p>}
      </div>

      <ResponseCapture open={captureOpen} onClose={() => setCaptureOpen(false)} onPauseLecture={onPauseMedia} initialText={text}
        onConfirm={({ text: spoken, transcriptionRevision }) => {
          setText(spoken);
          setTranscription(transcriptionRevision);
          setCaptureOpen(false);
        }} />
    </div>
  );
}
