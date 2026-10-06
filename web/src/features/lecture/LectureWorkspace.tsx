// SC04 Lecture workspace (design specification 5): the composition of the lecture's parts on app/WorkspaceFrame.
//
//   outline zone   LectureOutline                      (collapsible panel; a pane below 1180 px)
//   stage zone     Pager · the original page · Transport (the ONE media transport, directly under the slide)
//   context zone   ContextPanel: Tutor · Questions · Concepts · Transcript · Sources
//
// The address owns `page`, `panel` (a tab, or below 1180 px a pane), `focus`, `line` and `deck`; ./workspace-state holds
// what the parts share (selected range, the one player, fit). Changing page pauses playback and never autoplays;
// changing tab, pane, outline state, panel width or theme never reloads the slide or the media and never clears a draft.
// The parts are first versions in their own files (see ./contracts); this file keeps the flows that span them: notes,
// finishing a session, choosing among decks, correcting a link, the resume position.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { WorkspaceFrame, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { Button, Callout, cn, Dialog, ErrorState, Field, LoadingState, formatMs } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { isoNow, newId } from "@/lib/bundle";
import type { SourceRef } from "@/lib/db";
import { getOrCreateDevice, nextSequence } from "@/lib/device";
import { useLecture, useNotes, useResume, useSourceMapOverride } from "@/lib/queries";
import { identityOf, isStructuralPage, nextContentPage, questionsForPage } from "@/lib/r2";
import { draftAttachment, reviseAnnotation, sessionId, TERM, newOccurrenceAnnotation } from "@/lib/requests";
import type { LectureView, Occurrence, SlideRoleValue } from "@/lib/types";
import { ConceptsTab, conceptMapHref } from "@/features/concepts/ConceptsTab";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard } from "@/features/tutor/RequestCard";
import { TutorPanel } from "@/features/tutor/TutorPanel";
import { ContextPanel, TabScroll } from "./ContextPanel";
import { LECTURE_PANES, type LecturePaneId, type PinnedSource } from "./contracts";
import { DockedTransport } from "./DockedTransport";
import { LectureOutline } from "./LectureOutline";
import { Pager } from "./Pager";
import { QuestionsTab } from "./QuestionsTab";
import { SlideCanvas } from "./SlideCanvas";
import { AddMatchDialog, EditMatchDialog, SourcesPanel, type NewMatchDraft } from "./SourcesPanel";
import { GeneratedTextPanel, TranscriptPanel } from "./TranscriptPanel";
import { Transport } from "./Transport";
import { LectureWorkspaceProvider, useLecturePlayback, useLectureWorkspace, useReportPlayback } from "./workspace-state";

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* per-device convenience only */
  }
}

/** The resume record names four panels; the newer tabs and the outline pane are kept as the nearest of them. */
const resumePanel = (panel: string | null): "slide" | "tutor" | "transcript" | "sources" => (panel === "tutor" || panel === "transcript" ? panel : panel === null || panel === "slide" ? "slide" : "sources");

/** Arrow keys page the slide unless something else on the page uses them. */
function pagingAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return true;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return false;
  return !target.closest('[role="tablist"],[role="radiogroup"],[role="menu"],[role="slider"],[role="separator"],[role="listbox"],[role="tree"],[role="dialog"],media-controller');
}

export function LectureWorkspace() {
  const { courseId = "", lectureId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const deckChoice = params.get("deck");
  const lectureQuery = useLecture(courseId, lectureId, deckChoice);
  const [pageCount, setPageCount] = useState<number | null>(null);

  const lecture = lectureQuery.data;
  const total = lecture?.page_count ?? pageCount ?? 0;
  const page = Math.min(Math.max(1, Number(params.get("page")) || 1), Math.max(total, 1));

  const update = useCallback((changes: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace });
  }, [params, setParams]);

  useEffect(() => {
    if (courseId) app.setCourseId(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);
  useEffect(() => setPageCount(null), [courseId, lectureId, deckChoice]);

  const onPanel = useCallback((panel: string) => update({ panel }, true), [update]);
  const onPage = useCallback((next: number) => update({ page: String(next), line: null }), [update]);

  if (lectureQuery.isLoading) return <div className="p-6"><LoadingState label="Opening lecture…" /></div>;
  if (lectureQuery.isError || !lecture) return <div className="p-6"><ErrorState error={lectureQuery.error} retry={() => void lectureQuery.refetch()} /></div>;

  return (
    <LectureWorkspaceProvider courseId={courseId} lectureId={lectureId} lecture={lecture} page={page} total={total} panel={params.get("panel")} onPanel={onPanel} onPage={onPage}>
      <LectureComposition update={update} deckChoice={deckChoice} focus={params.get("focus") === "1"} focusLine={Number(params.get("line")) || null} panelParam={params.get("panel")}
        onPageCount={setPageCount} />
    </LectureWorkspaceProvider>
  );
}

interface CompositionProps {
  update: (changes: Record<string, string | null>, replace?: boolean) => void;
  deckChoice: string | null;
  focus: boolean;
  focusLine: number | null;
  panelParam: string | null;
  onPageCount: (count: number) => void;
}

function LectureComposition({ update, deckChoice, focus, focusLine, panelParam, onPageCount }: CompositionProps) {
  const state = useLectureWorkspace();
  const { courseId, lectureId, lecture, page, total, slide, goTo, tab, pane, showTab, showPane, player } = state;
  const navigate = useNavigate();
  const location = useLocation();
  const app = useApp();
  const queryClient = useQueryClient();
  const notes = useNotes(courseId);
  const resume = useResume(courseId);
  const actions = useSubmitActions();
  const localRequests = useLocalRequests(courseId);
  const roleOverride = useSourceMapOverride(courseId, lectureId, deckChoice);
  const [pinned, setPinned] = useState<PinnedSource[]>([]);
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [adding, setAdding] = useState<NewMatchDraft | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [region, setRegion] = useState({ x: "", y: "", w: "", h: "" });
  const [noteBusy, setNoteBusy] = useState(false);
  const [readable, setReadable] = useState(false);
  const [hideSlide, setHideSlide] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    store(`ll.last.${courseId}`, JSON.stringify({ lectureId, page, title: lecture.title, at: Date.now() }));
  }, [courseId, lectureId, page, lecture.title]);

  // A file chosen earlier on this device for a unit with several equal candidates is applied again (a local preference, not a course record).
  useEffect(() => {
    if (deckChoice || lecture.deck_choice.state !== "unresolved") return;
    const remembered = stored(`ll.deck.${courseId}.${lectureId}`);
    if (remembered && lecture.deck_choice.candidates.some((c) => c.source_id === remembered)) update({ deck: remembered }, true);
  }, [lecture, deckChoice, courseId, lectureId, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!pagingAllowed(event)) return;
      if (event.key === "ArrowRight" && page < total) goTo(page + 1);
      if (event.key === "ArrowLeft" && page > 1) goTo(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, goTo]);

  const slideRef: SourceRef | null = useMemo(() => (lecture.deck?.version_id && lecture.deck.sha256
    ? { source_id: lecture.deck.source_id, version_id: lecture.deck.version_id, sha256: lecture.deck.sha256, locator: { kind: "page", page, printed_label: null } } : null), [lecture, page]);
  const corrections = (localRequests.data ?? []).filter((r) => r.action === "correct_source" && r.context.lectureId === lectureId).slice(0, 3);
  const slideNotes = (notes.data?.notes ?? []).filter((n) => n.sources.some((s) => s.source_id === lecture.deck?.source_id && s.locator.page === page));
  const pdfUrl = lecture.display.content ? contentUrl(lecture.display.content) : null;
  const here = `/courses/${courseId}/lectures/${lectureId}?page=${page}`;
  const structural = isStructuralPage(lecture, page);
  const nextContent = nextContentPage(lecture, page);
  const pageQuestions = useMemo(() => questionsForPage(lecture, page), [lecture, page]);
  const questionCount = structural ? 0 : pageQuestions.known ? pageQuestions.counts.thisSlide : slide?.questions.length ?? 0;
  const pageName = identityOf(lecture, page).label;

  const submitMatch = async (occurrence: Occurrence, change: { startMs: number; endMs: number; state: "confirmed" | "rejected" | "suggested" }) => {
    const record = reviseAnnotation({ record: occurrence.record, artifact: occurrence.artifact }, {
      review_state: change.state, startMs: change.startMs, endMs: change.endMs,
      reviewer_ref: change.state === "suggested" ? null : "learner", basis: change.state === "suggested" ? occurrence.basis : "manual_review",
    });
    await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, {
      label: `Link correction · page ${page}`, text: `${change.state === "rejected" ? "Reject" : change.state === "suggested" ? "Undo review of" : "Confirm"} link ${occurrence.annotation_id} → revision ${record.revision}`,
      context: { lectureId, page, label: `Page ${page}` },
    });
    setNotice("Correction sent. The current reviewed view stays in place until the new revision is accepted.");
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["lecture", courseId, lectureId] }), 2500);
  };

  // A new link needs exact identities of both ends and a paired device; otherwise it is not offered.
  const startAddMatch = (startMs?: number) => {
    const recording = player.current?.recording() ?? null;
    if (!recording?.version_id || !lecture.deck?.version_id) return;
    player.current?.pause();
    setAdding({ page, recordingName: recording.filename, recordingVersion: recording.version_id, deckVersion: lecture.deck.version_id, startMs: startMs ?? player.current?.currentMs() ?? 0,
      durationMs: player.current?.durationMs() ?? null });
  };
  const submitNewMatch = async (startMs: number, endMs: number) => {
    const recording = player.current?.recording() ?? null;
    if (!slideRef || !recording?.version_id || !recording.sha256 || !recording.artifact) throw new Error("The slide or the recording is not identified yet, so an exact link cannot be made.");
    const record = newOccurrenceAnnotation({ courseId, lectureId, slide: slideRef, startMs, endMs,
      recording: { source_id: recording.source_id, version_id: recording.version_id, sha256: recording.sha256, artifact: recording.artifact } });
    await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, {
      label: `New link · page ${page}`, text: `Link page ${page} to ${formatMs(startMs)}–${formatMs(endMs)} of the recording (${record.annotation_id})`, context: { lectureId, page, label: `Page ${page}` },
    });
    setNotice("Link sent. It appears on this page once the Brain has recorded it.");
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["lecture", courseId, lectureId] }), 2500);
  };
  const canAddMatch = app.pairing.state === "paired" && !!slideRef && lecture.deck_choice.basis !== "this_request" && lecture.recordings.some((r) => r.version_id && r.sha256 && r.artifact);

  const saveNote = async () => {
    if (!slideRef || !noteText.trim()) return;
    setNoteBusy(true);
    try {
      const nums = [region.x, region.y, region.w, region.h].map((v) => Number(v) / 100);
      const hasRegion = [region.x, region.y, region.w, region.h].every((v) => v.trim() !== "") && nums.every((n) => Number.isFinite(n) && n >= 0) && nums[2]! > 0 && nums[3]! > 0 && nums[0]! + nums[2]! <= 1 && nums[1]! + nums[3]! <= 1;
      const source: SourceRef = hasRegion ? { ...slideRef, locator: { kind: "figure", page, xywh: nums } } : slideRef;
      const outcome = await actions.control(courseId, "save_note", { text: noteText.trim(), sources: [source], attachments: [] }, { label: `Note · page ${page}`, text: noteText.trim(), context: { lectureId, page, source, label: `Page ${page}` } });
      setNotice(outcome.delivery === "uploaded" ? "Note sent to the Brain. It appears under this page once it is received." : `Note kept on this device (${outcome.reason ?? "not sent yet"}).`);
      setNoteOpen(false);
      setNoteText("");
      setRegion({ x: "", y: "", w: "", h: "" });
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["notes", courseId] }), 2500);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setNoteBusy(false);
    }
  };

  const finishSession = async () => {
    player.current?.pause();
    if (app.pairing.state === "paired" && slideRef) {
      try {
        const device = await getOrCreateDevice();
        const head = resume.data?.current ?? null;
        const draftText = (document.getElementById("tutor-composer") as HTMLTextAreaElement | null)?.value ?? "";
        const draft = draftText.trim() ? await draftAttachment(draftText) : null;
        const checkpoint = { contract: "ll.resume/1", checkpoint_id: newId("cp"), device_id: device.deviceId, scope: { course_id: courseId, term: TERM }, session_id: sessionId(), sequence: await nextSequence(),
          parent_checkpoint: head ? { record_id: head.checkpoint_id, artifact: head.artifact } : null,
          cursor: { lecture_id: lectureId, source: slideRef, position_ms: player.current ? player.current.currentMs() : null, panel: resumePanel(panelParam), draft: draft?.artifact ?? null }, updated_at: isoNow() };
        await actions.record(courseId, "resume", checkpoint, { label: "Study position", text: `${lecture.title}: ${pageName}`, context: { lectureId, page, label: `Page ${page}` }, attachments: draft ? [draft.file] : [] });
      } catch {
        /* the wrap-up page reports what is and is not synchronised */
      }
    }
    navigate(`/study/sessions/${sessionId()}/summary?course=${courseId}&lecture=${lectureId}&page=${page}`);
  };

  const chooseDeck = (sourceId: string) => {
    store(`ll.deck.${courseId}.${lectureId}`, sourceId);
    update({ deck: sourceId, page: "1" });
  };
  const chooseAnotherFile = () => {
    store(`ll.deck.${courseId}.${lectureId}`, "");
    update({ deck: null, page: "1" });
  };
  const setRole = async (role: SlideRoleValue) => {
    try {
      await roleOverride.mutateAsync({ op: "role", pages: [page], value: role, reason: "Corrected by the learner in the lecture workspace" });
      setNotice("The role of this page was recorded as your correction.");
    } catch (error) {
      setNotice(`The role could not be recorded: ${(error as Error).message}`);
    }
  };
  const pin = (source: SourceRef, label: string) => {
    setPinned((current) => [...current, { source, label }]);
    showTab("tutor");
  };

  const contextTabs = {
    tutor: (
      <TabScroll>
        <TutorPanel courseId={courseId} lecture={lecture} page={page} slideRef={slideRef} pinned={pinned} onUnpin={(i) => setPinned((p) => p.filter((_, n) => n !== i))}
          onPauseMedia={() => player.current?.pause()} onGoToPage={goTo} hideSlide={hideSlide} onHideSlide={setHideSlide} />
      </TabScroll>
    ),
    questions: <TabScroll><QuestionsTab courseId={courseId} lecture={lecture} page={page} slide={slide} onGoToPage={goTo} nextContentPage={nextContent} /></TabScroll>,
    concepts: <TabScroll><ConceptsTab courseId={courseId} lecture={lecture} page={page} slide={slide} onGoToPage={goTo} nextContentPage={nextContent} returnTo={`${here}&panel=concepts`} /></TabScroll>,
    transcript: (
      <TranscriptTab lecture={lecture} focusLine={focusLine}
        onQuote={(source, text) => {
          pin(source, `Transcript lines ${String(source.locator.start)}–${String(source.locator.end)}`);
          app.announce(`Quoted transcript lines attached to your next message: ${text.slice(0, 60)}`);
        }}
        onReportError={(source, text) => {
          setNoteText(`Transcript correction proposal for lines ${String(source.locator.start)}–${String(source.locator.end)}:\n"${text}"\nShould read: `);
          setNoteOpen(true);
        }} />
    ),
    sources: (
      <TabScroll className="gap-4">
        <SourcesPanel courseId={courseId} slide={slide} others={lecture.other_materials} lectureQuestionCount={lecture.questions.all.length} onShowLectureQuestions={() => showTab("questions")}
          outlineHref={conceptMapHref(courseId, `slide:${lectureId}:${page}`)} onPin={pin} />
        {slideNotes.length > 0 && (
          <section aria-labelledby="notes-heading">
            <h3 id="notes-heading" className="mb-1 text-head font-semibold">Your notes on this page</h3>
            <ul className="flex flex-col">{slideNotes.map((n) => <li key={n.event_id} className="ll-measure whitespace-pre-wrap border-t border-hairline py-2 first:border-t-0">{n.text}</li>)}</ul>
          </section>
        )}
        <section aria-labelledby="deck-heading" data-testid="deck-facts">
          <h3 id="deck-heading" className="mb-1 text-head font-semibold">The file on screen</h3>
          {lecture.deck ? (
            <p className="ll-measure break-words text-ui text-muted">
              {lecture.deck.filename} · version {lecture.deck.version_id ?? "not yet identified"}{lecture.deck.registration === "unregistered" ? " · not registered by the course updater" : ""}
              {lecture.deck_choice.basis === "this_request" ? " · shown by your choice on this device" : ""}
            </p>
          ) : <p className="text-ui text-muted">No deck is shown.</p>}
        </section>
      </TabScroll>
    ),
  };

  const stage = (
    <StageZone focus={focus} hideSlide={hideSlide} readable={readable} pdfUrl={pdfUrl} notice={notice} onPageCount={onPageCount} chooseDeck={chooseDeck}
      pager={(
        <Pager lecture={lecture} page={page} total={total} onGoTo={goTo} onNote={slideRef ? () => setNoteOpen(true) : undefined} fit={state.fit} onFit={state.setFit} focus={focus}
          onFocus={(on) => update({ focus: on ? "1" : null }, true)} onFinishSession={() => void finishSession()} readable={readable} onReadable={pdfUrl ? setReadable : undefined}
          onChooseAnotherFile={lecture.deck_choice.basis === "this_request" ? chooseAnotherFile : undefined} onCorrectPage={() => showTab("sources")}
          onSetRole={lecture.source_map?.state === "ready" ? setRole : undefined} />
      )}
      transport={(
        <TransportSlot onEditMatch={setEditing} onAddMatch={canAddMatch ? startAddMatch : undefined} onNextContent={nextContent !== null ? () => goTo(nextContent) : undefined} announce={app.announce} />
      )}
      hasExtras={corrections.length > 0 || lecture.link_conflicts.length > 0}
      extras={(
        <>
          {corrections.length > 0 && (
            <section aria-label="Your recent link corrections" className="flex flex-col gap-2">
              {corrections.map((r) => <RequestCard key={r.requestId} request={r} showContext />)}
            </section>
          )}
          {lecture.link_conflicts.length > 0 && (
            <Callout tone="caution" title="A link correction conflicts with another revision" actions={<Link className="ll-btn ll-btn-sm" to={`/activity/conflicts/${encodeURIComponent(lecture.link_conflicts[0]!.conflict_id)}?course=${courseId}&lecture=${lectureId}`}>Compare and resolve</Link>}>
              Both versions are kept. The reviewed link stays as it was until you choose.
            </Callout>
          )}
        </>
      )} />
  );

  const returning = !!(location.state as { returnTo?: string } | null)?.returnTo;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="lecture-workspace">
      {returning && !focus && <div className="flex-none border-b border-hairline bg-surface px-3 pt-2 [&>a]:mb-2"><ReturnLink /></div>}
      <div className="min-h-0 flex-1">
        <WorkspaceFrame kind="lecture" testId="workspace-frame" focus={focus} pane={pane} onPaneChange={(next) => showPane(next as LecturePaneId)} paneSwitchLabel="Workspace pane"
          labels={{ outline: "Lecture outline", stage: "Slide and recording", context: "Context panel" }}
          panes={LECTURE_PANES.map((entry) => (entry.id === "questions" && questionCount > 0 ? { ...entry, count: questionCount } : entry))}
          outline={<OutlineZone pdfUrl={pdfUrl} onSelectInPane={(next) => { player.current?.pause(); update({ page: String(next), line: null, panel: "slide" }); }} />}
          stage={stage}
          context={<ContextPanel tab={tab} onTabChange={showTab} counts={{ questions: questionCount }} tabs={contextTabs} returnTo={here} />}
          dock={<DockZone />} />
      </div>

      <AddMatchDialog draft={adding} onClose={() => setAdding(null)} onPreview={(startMs) => player.current?.seekTo(startMs)} onSubmit={submitNewMatch} />
      <EditMatchDialog occurrence={editing} recording={lecture.recordings.find((r) => r.source_id === editing?.source.source_id)} onClose={() => setEditing(null)}
        onPreview={(startMs) => player.current?.seekTo(startMs)} onSubmit={submitMatch} />

      <Dialog open={noteOpen} onOpenChange={setNoteOpen} title="Save a note on this page" description="A note is your own work linked to this exact page of this deck version. It is not sent to the tutor and it is not learning evidence."
        footer={<><Button onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" busy={noteBusy} disabled={!noteText.trim()} onClick={saveNote}>Save note</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-ui text-muted">Linked to: {pageName} · {lecture.deck?.filename} · version {lecture.deck?.version_id ?? "unknown"}</p>
          <Field label="Note" htmlFor="note-text"><textarea id="note-text" className="ll-input min-h-[7rem]" value={noteText} onChange={(e) => setNoteText(e.target.value)} /></Field>
          <fieldset className="grid grid-cols-4 gap-2">
            <legend className="mb-1 text-ui font-semibold">Optional figure region (percent of the page: left, top, width, height)</legend>
            {(["x", "y", "w", "h"] as const).map((key) => (
              <input key={key} className="ll-input" inputMode="numeric" aria-label={{ x: "Left percent", y: "Top percent", w: "Width percent", h: "Height percent" }[key]} placeholder={{ x: "left", y: "top", w: "width", h: "height" }[key]}
                value={region[key]} onChange={(e) => setRegion((r) => ({ ...r, [key]: e.target.value }))} />
            ))}
          </fieldset>
          <p className="text-ui text-muted">A region marks where on the page your note points. It stays a pointer into the full source, not a claim about what the figure shows.</p>
        </div>
      </Dialog>
    </div>
  );
}

// ---- zones (inside the frame, so they know the arrangement) -------------------------------------------------------------
function OutlineZone({ pdfUrl, onSelectInPane }: { pdfUrl: string | null; onSelectInPane: (page: number) => void }) {
  const { lecture, page, total, goTo } = useLectureWorkspace();
  const frame = useWorkspaceFrame();
  const asPane = frame.arrangement !== "frame";
  // Choosing a page in the Outline pane returns to the Slide pane.
  return <LectureOutline lecture={lecture} page={page} pageCount={total} pdfUrl={pdfUrl} onSelect={asPane ? onSelectInPane : goTo} layout={asPane ? "grid" : "list"} />;
}

function TransportSlot({ onEditMatch, onAddMatch, onNextContent, announce }: { onEditMatch: (occurrence: Occurrence) => void; onAddMatch?: (startMs?: number) => void; onNextContent?: () => void; announce: (message: string) => void }) {
  const { lecture, page, slide, selection, selectRange, player } = useLectureWorkspace();
  const report = useReportPlayback();
  return <Transport lecture={lecture} page={page} slide={slide} selection={selection} onSelect={selectRange} playerRef={player} onTime={report} onEditMatch={onEditMatch} onAddMatch={onAddMatch}
    onNextContent={onNextContent} announce={announce} />;
}

function DockZone() {
  const { lecture, selectedRange, player, showPane } = useLectureWorkspace();
  const position = useLecturePlayback();
  return <DockedTransport position={position} range={selectedRange} available={lecture.recordings.length > 0} onToggle={() => player.current?.toggle()} onOpenSlide={() => showPane("slide")} />;
}

function TranscriptTab({ lecture, focusLine, onQuote, onReportError }: { lecture: LectureView; focusLine: number | null; onQuote: (source: SourceRef, text: string) => void; onReportError: (source: SourceRef, text: string) => void }) {
  const { slide, player } = useLectureWorkspace();
  const position = useLecturePlayback();
  const frame = useWorkspaceFrame();
  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col gap-2 p-[var(--ll-panel-pad,16px)]", frame.arrangement !== "frame" && "mx-auto max-w-[640px]")}>
      <GeneratedTextPanel recordings={lecture.recordings} onSeek={(ms) => player.current?.seekTo(ms)} />
      <TranscriptPanel transcripts={lecture.transcripts} slideRanges={slide?.transcript_ranges ?? []} positionMs={position.ms} playing={position.playing} focusLine={focusLine}
        onSeek={(ms) => player.current?.seekTo(ms)} onQuote={onQuote} onReportError={onReportError} />
    </div>
  );
}

interface StageZoneProps {
  focus: boolean;
  hideSlide: boolean;
  readable: boolean;
  pdfUrl: string | null;
  notice: string | null;
  onPageCount: (count: number) => void;
  chooseDeck: (sourceId: string) => void;
  pager: React.ReactNode;
  transport: React.ReactNode;
  /** Transient things under the bar: the learner's recent link corrections, a link conflict. */
  extras: React.ReactNode;
  hasExtras: boolean;
}

/** The stage: the band, then the original page with the one transport directly under it. Nothing is drawn above the page but the band. */
function StageZone({ focus, hideSlide, readable, pdfUrl, notice, onPageCount, chooseDeck, pager, transport, extras, hasExtras }: StageZoneProps) {
  const { lecture, page, total, slide, fit } = useLectureWorkspace();
  const frame = useWorkspaceFrame();
  // Beside its neighbours the page is fitted into the stage; alone in a pane it sits at the top, as wide as the pane.
  const fitted = frame.arrangement !== "panes" && fit === "page";
  const identity = identityOf(lecture, page);
  const label = `${identity.label}${slide?.title ? `: ${slide.title}` : ""} — original source, colours unchanged`;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="lecture-stage">
      {pager}
      <div className={cn("flex min-h-0 flex-1 flex-col gap-2", frame.arrangement === "frame" ? "py-3" : "p-3", fitted ? "overflow-hidden" : "overflow-y-auto")}>
        <div className={cn("flex flex-col gap-2", fitted && "min-h-0 flex-1 [&_[data-testid=slide-frame]]:min-h-0 [&_[data-testid=slide-frame]]:flex-1")} data-testid="stage-slide">
          {lecture.display.kind === "choose_deck" ? (
            <div className="flex flex-col gap-3 overflow-y-auto">
              <Callout tone="unassessed" title="Choose the file to read for this unit">{lecture.display.reason} Nothing is picked for you by file name or size. Your choice is remembered on this device only; the course records are not changed.</Callout>
              <ul className="flex flex-col gap-2" aria-label="Candidate files">
                {lecture.deck_choice.candidates.map((c) => (
                  <li key={c.source_id} className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface p-3">
                    <span className="min-w-0"><span className="block break-words font-semibold">{c.filename}</span>
                      <span className="text-ui text-muted">{c.bytes ? `${(c.bytes / 1_048_576).toFixed(1)} MB` : "size unknown"}{c.registration === "unregistered" ? " · not registered by the course updater" : ""}{c.rendition !== "native_pdf" ? " · needs a PDF rendition" : ""}</span></span>
                    <Button size="sm" onClick={() => chooseDeck(c.source_id)}>Show this file</Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : lecture.display.kind === "unavailable" || !pdfUrl ? (
            <Callout tone="caution" title="These slides cannot be displayed here">{lecture.display.reason} Nothing was regenerated in their place; the original file is untouched.</Callout>
          ) : (
            <>
              {lecture.display.kind === "rendition_pdf" && <Callout tone="unassessed" title="Static PDF rendition">{lecture.display.note}</Callout>}
              <SlideCanvas url={pdfUrl} page={page} label={total ? label : `Page ${page} — original source, colours unchanged`} onPageCount={onPageCount} hidden={hideSlide} contain={fitted} />
            </>
          )}
        </div>
        {transport}
        {((readable && !!pdfUrl && !focus) || !!notice || (hasExtras && !focus)) && (
          <div className={cn("flex flex-none flex-col gap-2", fitted && "max-h-[30%] overflow-y-auto")} data-testid="stage-extras">
            {readable && pdfUrl && !focus && (
              <section className="rounded-control bg-surface p-3" aria-label="Readable text rendition">
                <h3 className="mb-1 text-ui font-semibold text-muted">Derived text rendition, not the original</h3>
                {slide?.text ? <p className="ll-measure whitespace-pre-wrap">{slide.text}</p> : <p className="text-muted">{slide?.text_status === "not_prepared" ? "Text has not been extracted yet (preparation pending)." : "This page has no extractable text layer. The original image above is the source; nothing was guessed."}</p>}
                <p className="mt-1 text-ui text-muted">Extracted automatically; layout, figures and equations may be incomplete.</p>
              </section>
            )}
            {!focus && extras}
            {notice && <p role="status" className="text-ui text-muted">{notice}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
