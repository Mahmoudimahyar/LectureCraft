// Tutor panel (UI11–UI16; design specification 5.8): an unboxed thread, bottom-aligned above a composer that is docked
// at the foot of the panel and does not move as the thread grows. Three kinds of help — Quick answer, Understand,
// Explain back — in one segmented control. The draft is pinned to the page it was started on, autosaved with its real
// durability, and sent only by an explicit action: nothing is sent while typing. Asking for help is never assessed; only
// a submitted response is. When Send cannot be pressed, the sentence beside it says why.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowUp, Mic, X } from "lucide-react";
import { useApp } from "@/app/state";
import { ErrorGlyph } from "@/components/glyphs";
import { Button, Callout, IconButton, Segmented, cn } from "@/components/ui";
import { deleteDraft, getDraft, saveDraft, type Draft, type DraftMode, type SourceRef } from "@/lib/db";
import { isoNow } from "@/lib/bundle";
import { nb } from "@/lib/labels";
import { identityOf, isStructuralPage } from "@/lib/r2";
import { NotPairedError, type Conditions } from "@/lib/requests";
import type { LectureView, QuestionRecord, SlideView } from "@/lib/types";
import { TabFoot, TabScroll } from "@/features/lecture/ContextPanel";
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
  quick: "Ask about this slide",
  understand: "Ask for an example, a contrast, the mechanism or a connection",
  explain: "Explain it in your own words",
};
const MODES: Array<{ value: Mode; label: string }> = [{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }];

/** What the next message is about, in the words of the identity line: "About page 23, build 2 of 3". Never a slide number made from the page index. */
export function aboutPage(lecture: LectureView, page: number): string {
  const identity = identityOf(lecture, page);
  return `About ${nb(`page ${page}`)}${identity.position && identity.parts[1] ? `, ${identity.parts[1]}` : ""}`;
}

/** Why Send cannot be pressed, as the sentence beside it; null when it can. */
export function sendBlockedReason(state: { paired: boolean; ready: boolean; empty: boolean }): "unpaired" | "empty" | null {
  if (state.ready && !state.paired) return "unpaired";
  return state.empty ? "empty" : null;
}

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
  const threadEnd = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  /** The draft whose save still waits for its 350 ms; null once it is written or the composer is empty. */
  const unsaved = useRef<(() => Draft) | null>(null);
  const requests = useLocalRequests(courseId);

  // Restore the draft for this lecture (it stays attached to the page it was written for).
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

  // An empty composer follows the current page; a draft with text never silently changes its source.
  useEffect(() => {
    if (loaded.current && text.trim() === "" && !follow) setDraftPage(page);
  }, [page, text, follow]);

  const draftSlide: SlideView | undefined = lecture.slides.find((s) => s.page === draftPage);
  const draftSlideRef: SourceRef | null = slideRef ? { ...slideRef, locator: { kind: "page", page: draftPage, printed_label: null } } : null;
  const contextLabel = `Page ${draftPage} · ${lecture.title}`;
  // A structural page asks for no explanation of itself (R2-S8): Explain back is not offered for it, the composer stays usable.
  const structural = isStructuralPage(lecture, draftPage);
  useEffect(() => {
    if (structural && mode === "explain" && text.trim() === "" && !follow) setMode("quick");
  }, [structural, mode, text, follow]);

  useEffect(() => {
    if (!loaded.current) return;
    if (text === "") {
      unsaved.current = null;
      setDurability("empty");
      void deleteDraft(draftId);
      return;
    }
    setDurability("saving");
    const draft = (): Draft => ({ draftId, courseId, mode: mode as DraftMode, text, updatedAt: isoNow(),
      context: { lectureId: lecture.lecture_id, page: draftPage, questionId: questionId || undefined, source: draftSlideRef ?? undefined, label: contextLabel } });
    unsaved.current = draft;
    const timer = window.setTimeout(() => {
      unsaved.current = null;
      void saveDraft(draft()).then((r) => setDurability(r.durability));
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode, draftPage, questionId]);
  // Leaving the lecture inside those 350 ms (a link pressed right after the last keystroke) writes the waiting draft at once instead of dropping it.
  useEffect(() => () => {
    if (unsaved.current) void saveDraft(unsaved.current());
  }, []);

  const slideQuestions = draftSlide?.questions ?? [];
  const chosenQuestion = slideQuestions.find((q) => q.question_id === questionId) ?? null;
  const priorHelpOnSlide = useMemo(() => (requests.data ?? []).some((r) => r.action === "ask" && r.context.lectureId === lecture.lecture_id && r.context.page === draftPage), [requests.data, lecture.lecture_id, draftPage]);
  useEffect(() => {
    if (priorHelpOnSlide && assistance === "none_reported") setAssistance("hint");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorHelpOnSlide]);

  const lectureThread = useMemo(() => (requests.data ?? [])
    .filter((r) => r.context.lectureId === lecture.lecture_id && ["ask", "explain", "diagnose"].includes(r.action))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)), [requests.data, lecture.lecture_id]);
  const thread = useMemo(() => (onlyThisSlide ? lectureThread.filter((r) => r.context.page === page) : lectureThread), [lectureThread, onlyThisSlide, page]);

  // The thread is bottom-aligned: the latest exchange stays in view as its reply arrives, shown from its question on
  // (not from the last line of a long reply). Once the learner scrolls somewhere else, nothing moves under them until
  // the next exchange.
  const lastId = thread[thread.length - 1]?.requestId ?? null;
  useEffect(() => {
    const end = threadEnd.current;
    const scroller = end?.closest<HTMLElement>("[data-tab-scroll]");
    if (!end || !scroller) return;
    const last = end.parentElement?.querySelector<HTMLElement>("ol > li:last-child") ?? null;
    let placed: number | null = null;
    let following = true;
    const follow = () => {
      if (!following) return;
      if (placed !== null && Math.abs(scroller.scrollTop - placed) > 2) {
        following = false;
        return;
      }
      const lowest = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const top = last ? last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12 : lowest;
      scroller.scrollTop = Math.min(lowest, Math.max(0, top));
      placed = scroller.scrollTop;
    };
    follow();
    if (!last || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(last);
    return () => observer.disconnect();
  }, [lastId]);

  const paired = app.pairing.state === "paired";
  const diagnosing = follow?.kind === "diagnose";
  const blocked = sendBlockedReason({ paired, ready: app.ready, empty: text.trim() === "" });

  const send = async () => {
    const body = text.trim();
    if (!body || sending || blocked === "unpaired") return;
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
          : { question_id: null, family_id: null, family_revision: null, prompt: `Explain page ${draftPage} of "${lecture.title}" in your own words.`, sources, attachments: [] };
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

  const native = app.workspace?.capabilities.native;
  const sendLabel = diagnosing ? "Submit answer" : mode === "explain" ? "Check my explanation" : "Send";
  const offered = structural && mode !== "explain" ? MODES.filter((entry) => entry.value !== "explain") : MODES;
  const placeholder = diagnosing ? "Your answer" : PLACEHOLDER[mode];

  return (
    <TabScroll>
      <div className="flex flex-1 flex-col" data-testid="tutor-thread">
        {/* A thread is bottom-aligned above the composer (the room it does not fill is above it). Before the first
            exchange there is no thread: the heading and its two sentences start at the top of the region, on the first
            line of every other tab, and the composer stays docked at the foot. */}
        <div className={cn("flex w-full flex-col gap-3", lectureThread.length > 0 && "mt-auto")} role="region" aria-label="Conversation on this lecture" data-empty={lectureThread.length === 0 || undefined}>
          {lectureThread.length === 0 ? (
            <div className="ll-measure flex flex-col gap-1" data-testid="tutor-empty">
              <h3 className="text-head font-semibold">Ask about this slide</h3>
              <p className="text-read text-muted">Choose how much help you want, then ask. Reading a slide or receiving an answer is never counted as an assessment.</p>
            </div>
          ) : (
            <>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-ui text-muted"><input type="checkbox" className="size-4 accent-[var(--ll-accent-text)]" checked={onlyThisSlide} onChange={(e) => setOnlyThisSlide(e.target.checked)} /> Only this slide</label>
              {thread.length === 0 && <p className="text-ui text-muted">Nothing was asked on this page. The other exchanges of this lecture are hidden.</p>}
              <ol className="flex flex-col [&>li+li]:mt-5 [&>li+li]:border-t [&>li+li]:border-hairline [&>li+li]:pt-5">{thread.map((r) => <li key={r.requestId}><RequestCard request={r} onFollowUp={onFollowUp} variant="thread" /></li>)}</ol>
            </>
          )}
          {/* Who answers, when it is not the verified tutor: said with the thread, so the docked composer never shifts for it. */}
          {native && native.status !== "verified" && (
            <p className="ll-measure text-ui text-muted" data-testid="tutor-connection">
              {native.status === "fixture_double" ? <><span>Fixture tutor (test double)</span>. Its answers are synthetic.</>
                : native.status === "pilot" ? native.label
                  : <>The tutor connection of this PC is not verified. What you send waits until it is. <Link className="ll-link" to="/settings">Open Settings</Link></>}
            </p>
          )}
          <div ref={threadEnd} />
        </div>
      </div>

      <TabFoot>
        <div className="ll-measure flex flex-col gap-2" role="group" aria-label="Ask the tutor" data-testid="tutor-composer-area">
          {diagnosing ? (
            <Callout tone="accent" title="Diagnostic check" actions={<Button size="sm" variant="quiet" onClick={() => { setFollow(null); setText(""); }}>Skip — return to the slide</Button>}>{follow?.prompt}</Callout>
          ) : (
            <Segmented<Mode> label="Interaction" className="flex w-full" value={mode} onChange={(m) => { setMode(m); if (follow?.kind !== "retry_answer") setFollow(null); }} options={offered} />
          )}

          {draftPage !== page && text.trim() !== "" && (
            <Callout tone="caution" title={`This draft belongs to page ${draftPage}`} role="status"
              actions={<>
                <Button size="sm" onClick={() => onGoToPage(draftPage)}>Go back to page {draftPage}</Button>
                <Button size="sm" variant="quiet" onClick={() => setDraftPage(page)}>Move the draft to page {page}</Button>
              </>}>
              You are now on page {page}. The draft keeps its original page unless you move it.
            </Callout>
          )}

          {mode === "explain" && !diagnosing && (
            <div className="flex flex-col gap-2 text-ui">
              <label className="flex flex-col gap-1">
                <span className="font-semibold">What to explain</span>
                <select className="ll-input" value={questionId} onChange={(e) => setQuestionId(e.target.value)} aria-describedby="explain-hint">
                  <option value="">Page {draftPage} in my own words (no rubric — kept as "assessment pending")</option>
                  {slideQuestions.map((q) => <option key={q.question_id} value={q.question_id}>{q.title ?? q.question_id}</option>)}
                </select>
              </label>
              <p id="explain-hint" className="rounded-row bg-pad px-3 py-2 text-muted">{chosenQuestion ? chosenQuestion.prompt : `Explain page ${draftPage} in your own words. Your full response is retained; without a reviewed rubric it is not graded.`}</p>
              <details>
                <summary className="w-fit cursor-pointer rounded-row font-semibold">Conditions (self-reported)</summary>
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
                <label className="mt-2 flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--ll-accent-text)]" checked={hideSlide} onChange={(e) => onHideSlide(e.target.checked)} /> Hide the slide while I explain (recorded as "no references reported")</label>
                <p className="mt-1 text-muted">These are your own report. Hiding sources here cannot prove that no other help was used.</p>
              </details>
            </div>
          )}

          {pinned.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5 text-ui" aria-label="Attached to your next message">
              {pinned.map((p, i) => (
                <li key={i} className="ll-token"><span className="min-w-0">{p.label}</span><IconButton size="sm" label={`Remove ${p.label}`} onClick={() => onUnpin(i)}><X aria-hidden /></IconButton></li>
              ))}
            </ul>
          )}

          {/* The one outlined field of the panel: the text, what it is about, and Send. Focus is shown once, as a ring
              around the whole field; the textarea's own ring is taken off (the sheet's unlayered :focus-visible rule would
              otherwise draw a second one inside it). */}
          <div className="rounded-control border border-line bg-raised pb-2 pl-3 pr-2 pt-3 has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-1 has-[textarea:focus-visible]:outline-focus">
            <label className="sr-only" htmlFor="tutor-composer">{diagnosing ? "Your answer to the diagnostic check" : placeholder}</label>
            <textarea id="tutor-composer" ref={textRef} rows={2} className="block max-h-[32dvh] min-h-[3.25rem] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 text-read text-ink outline-none! [field-sizing:content] placeholder:text-muted placeholder:opacity-100"
              placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} maxLength={200000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }} />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="ll-num min-w-0 text-ui text-muted" data-testid="context-chip" aria-label="What your message is about">{aboutPage(lecture, draftPage)}</span>
              <span className="flex flex-none items-center gap-1">
                {mode === "explain" && !diagnosing && <IconButton label="Explain aloud" onClick={() => setCaptureOpen(true)}><Mic aria-hidden /></IconButton>}
                <Button variant="primary" size="sm" onClick={send} busy={sending} disabled={blocked !== null} data-testid="send" aria-describedby="tutor-send-note">
                  {!sending && <ArrowUp aria-hidden />}
                  {sendLabel}
                </Button>
              </span>
            </div>
          </div>

          {/* One line beside Send: why it cannot be pressed, or that nothing is sent before it is; then where the draft is kept.
              Two lines are held for it, so the field does not move when the sentence changes. */}
          <p className="min-h-[calc(2*var(--ll-lh-ui))] text-ui text-muted">
            <span id="tutor-send-note" data-testid="send-note">
              {blocked === "unpaired" ? <>Sending is off because this device is not paired with the tutor. What you type stays here. <Link className="ll-link" to="/connect">Pair this device</Link></>
                : blocked === "empty" ? <>{diagnosing ? "Write your answer first." : mode === "explain" ? "Write your explanation first." : "Write your question first."} Nothing is sent until you press {sendLabel === "Send" ? "Send" : `“${sendLabel}”`}.</>
                  : <>Nothing is sent until you press {sendLabel === "Send" ? "Send" : `“${sendLabel}”`}.{mode === "explain" || diagnosing ? " Your response is kept as you wrote it before the tutor sees it." : ""}</>}
              {transcription ? " From your corrected voice transcript." : ""}
            </span>{" "}
            <span role="status" aria-live="polite" data-testid="draft-state">
              {durability === "saved_on_device" ? "Draft saved on this device"
                : durability === "memory_only" ? <span className="ll-err font-normal"><ErrorGlyph /><span>Local save failed — kept only while this page is open</span></span>
                  : durability === "saving" ? "Saving draft…" : ""}
            </span>
          </p>
          {problem && (
            <Callout tone="danger" role="alert" title="Not sent" actions={<>
              {problem.copyable && <Button size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>Copy my text</Button>}
              {problem.pair && <Link className="ll-btn ll-btn-sm" to="/connect">Pair this device</Link>}
            </>}>{problem.message}</Callout>
          )}
        </div>
      </TabFoot>

      <ResponseCapture open={captureOpen} onClose={() => setCaptureOpen(false)} onPauseLecture={onPauseMedia} initialText={text}
        onConfirm={({ text: spoken, transcriptionRevision }) => {
          setText(spoken);
          setTranscription(transcriptionRevision);
          setCaptureOpen(false);
        }} />
    </TabScroll>
  );
}
