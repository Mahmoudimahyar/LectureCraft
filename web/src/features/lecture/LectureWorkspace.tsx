// SC04 Lecture workspace (UI06–UI10, UI18; layout R1 direction B): a collapsible lecture outline, the original slide
// fitted to the stage with ONE transport beneath it, and ONE context panel (Tutor · Transcript · This slide ·
// Questions). On wide screens the workspace fills the window, so slide and transport are visible without scrolling.
// Changing slide pauses playback and never autoplays; switching panel, outline or theme never reloads the slide or
// the media. On narrow screens one pane shows at a time with the same actions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Images, Maximize, Minimize, NotebookPen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, Callout, cn, Dialog, ErrorState, Field, IconButton, LoadingState, StatusChip, Tab, TabList, TabPanel, Tabs, formatMs } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { isoNow, newId } from "@/lib/bundle";
import type { SourceRef } from "@/lib/db";
import { getOrCreateDevice, nextSequence } from "@/lib/device";
import { dispositionLabel } from "@/lib/labels";
import { useLecture, useNotes, useResume } from "@/lib/queries";
import { draftAttachment, reviseAnnotation, sessionId, TERM, newOccurrenceAnnotation } from "@/lib/requests";
import type { Occurrence, QuestionRow, SlideView } from "@/lib/types";
import { LectureQuestionsPanel } from "@/features/question/QuestionList";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard } from "@/features/tutor/RequestCard";
import { TutorPanel } from "@/features/tutor/TutorPanel";
import { ClipPlayer, type ClipPlayerHandle } from "./ClipPlayer";
import { SlideCanvas, SlideThumb } from "./SlideCanvas";
import { AddMatchDialog, EditMatchDialog, SourcesPanel, type NewMatchDraft } from "./SourcesPanel";
import { GeneratedTextPanel, TranscriptPanel } from "./TranscriptPanel";

type Panel = "slide" | "tutor" | "transcript" | "sources" | "questions";
const PANELS: Panel[] = ["slide", "tutor", "transcript", "sources", "questions"];
const PANES: Array<{ value: Panel; label: string }> = [{ value: "slide", label: "Slide" }, { value: "tutor", label: "Tutor" }, { value: "transcript", label: "Transcript" }, { value: "sources", label: "This slide" },
  { value: "questions", label: "Questions" }];

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

/** True while the multi-column arrangement applies (wide window and text not enlarged): the stage then has a fixed height to fit the slide into. */
function useWideLayout(): boolean {
  const read = () => typeof window !== "undefined" && window.matchMedia("(min-width: 64rem)").matches && document.documentElement.getAttribute("data-text-scale") !== "large";
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    const update = () => setWide(read());
    query.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-scale"] });
    return () => {
      query.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return wide;
}

/** Narrow screens show one pane at a time. Each tab controls a region that exists on the page (the slide or the context panel). */
function PaneTabs({ value, onChange }: { value: Panel; onChange: (value: Panel) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const next = PANES[(index + PANES.length) % PANES.length]!;
    onChange(next.value);
    refs.current[(index + PANES.length) % PANES.length]?.focus();
  };
  return (
    <div role="tablist" aria-label="Workspace pane" className="ll-pane-tabs grid gap-1 border-b border-line/40 wide:hidden">
      {PANES.map((pane, index) => (
        <button key={pane.value} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" aria-selected={value === pane.value} aria-controls={pane.value === "slide" ? "pane-slide" : "pane-context"}
          tabIndex={value === pane.value ? 0 : -1} onClick={() => onChange(pane.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") move(index + 1);
            else if (event.key === "ArrowLeft") move(index - 1);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
          className={cn("min-h-[44px] min-w-0 border-b-2 border-transparent px-1 text-sm font-medium text-muted", value === pane.value && "border-accent text-accent")}>
          {pane.label}
        </button>
      ))}
    </div>
  );
}

/** Lecture outline: every slide with what the course record ties to it. Thumbnails are optional (off by default). */
function Outline({ slides, page, pdfUrl, thumbs, onSelect, lectureQuestions, onShowQuestions }: { slides: Array<Pick<SlideView, "page" | "title"> & Partial<SlideView>>; page: number; pdfUrl: string | null; thumbs: boolean;
  onSelect: (page: number) => void; lectureQuestions: number; onShowQuestions: () => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Keep the current slide in view by scrolling the outline's own list only — never the page.
    const list = listRef.current;
    const node = activeRef.current;
    if (!list || !node || thumbs) return;
    const top = node.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + node.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + node.offsetHeight - list.clientHeight;
  }, [page, thumbs]);
  return (
    <>
      <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Slides">
        {slides.map((s) => {
          const questions = s.questions?.length ?? 0;
          const concepts = s.concepts?.length ?? 0;
          const timed = s.occurrences?.length ?? 0;
          if (thumbs && pdfUrl) return <li key={s.page}><SlideThumb url={pdfUrl} page={s.page} active={s.page === page} title={s.title} onSelect={() => onSelect(s.page)} /></li>;
          const active = s.page === page;
          return (
            <li key={s.page}>
              <button ref={active ? activeRef : undefined} type="button" onClick={() => onSelect(s.page)} aria-current={active ? "true" : undefined} aria-label={`Slide ${s.page}${s.title ? `: ${s.title}` : ""}`}
                className={cn("flex w-full items-baseline gap-2 rounded-[var(--ll-radius)] px-2 py-1.5 text-left", active ? "bg-raised font-semibold text-accent outline outline-2 outline-accent" : "hover:bg-raised")}>
                <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted">{s.page}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.title ?? `Slide ${s.page}`}</span>
                  {(questions > 0 || concepts > 0 || timed > 0) && (
                    <span className="block truncate text-sm font-normal text-muted">
                      {[questions ? `${questions} question${questions === 1 ? "" : "s"}` : "", concepts ? `${concepts} concept${concepts === 1 ? "" : "s"}` : "", timed ? "timed" : ""].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="ll-btn ll-btn-sm justify-between" onClick={onShowQuestions} data-testid="outline-questions">
        <span>All lecture questions</span><span className="tabular-nums">{lectureQuestions}</span>
      </button>
    </>
  );
}

export function LectureWorkspace() {
  const { courseId = "", lectureId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const queryClient = useQueryClient();
  const deckChoice = params.get("deck");
  const lectureQuery = useLecture(courseId, lectureId, deckChoice);
  const notes = useNotes(courseId);
  const resume = useResume(courseId);
  const actions = useSubmitActions();
  const localRequests = useLocalRequests(courseId);
  const playerRef = useRef<ClipPlayerHandle>(null);
  const wide = useWideLayout();
  const [navOpen, setNavOpen] = useState(() => (stored("ll.outline") ?? (typeof window !== "undefined" && window.innerWidth >= 1600 ? "open" : "closed")) === "open");
  const [thumbs, setThumbs] = useState(() => stored("ll.outline.thumbs") === "1");
  const [findSlide, setFindSlide] = useState("");
  const [position, setPosition] = useState({ ms: 0, playing: false });
  const [pinned, setPinned] = useState<Array<{ source: SourceRef; label: string }>>([]);
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [adding, setAdding] = useState<NewMatchDraft | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [region, setRegion] = useState({ x: "", y: "", w: "", h: "" });
  const [noteBusy, setNoteBusy] = useState(false);
  const [readable, setReadable] = useState(false);
  const [hideSlide, setHideSlide] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lecture = lectureQuery.data;
  const total = lecture?.page_count ?? pageCount ?? 0;
  const page = Math.min(Math.max(1, Number(params.get("page")) || 1), Math.max(total, 1));
  const panel = (PANELS.includes((params.get("panel") ?? "") as Panel) ? params.get("panel") : "slide") as Panel;
  const focus = params.get("focus") === "1";
  const focusLine = Number(params.get("line")) || null;

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

  useEffect(() => {
    if (!lecture) return;
    store(`ll.last.${courseId}`, JSON.stringify({ lectureId, page, title: lecture.title, at: Date.now() }));
  }, [courseId, lectureId, page, lecture]);

  // A file chosen earlier on this device for a unit with several equal candidates is applied again (a local preference, not a course record).
  useEffect(() => {
    if (!lecture || deckChoice || lecture.deck_choice.state !== "unresolved") return;
    const remembered = stored(`ll.deck.${courseId}.${lectureId}`);
    if (remembered && lecture.deck_choice.candidates.some((c) => c.source_id === remembered)) update({ deck: remembered }, true);
  }, [lecture, deckChoice, courseId, lectureId, update]);

  const goTo = useCallback((next: number) => {
    playerRef.current?.pause(); // changing slides pauses; the new slide never autoplays
    update({ page: String(next), line: null });
  }, [update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "ArrowRight" && page < total) goTo(page + 1);
      if (event.key === "ArrowLeft" && page > 1) goTo(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, goTo]);

  const slide = lecture?.slides.find((s) => s.page === page);
  const slideRef: SourceRef | null = useMemo(() => (lecture?.deck?.version_id && lecture.deck.sha256
    ? { source_id: lecture.deck.source_id, version_id: lecture.deck.version_id, sha256: lecture.deck.sha256, locator: { kind: "page", page, printed_label: null } } : null), [lecture, page]);
  const occurrences = slide?.occurrences ?? [];
  const corrections = (localRequests.data ?? []).filter((r) => r.action === "correct_source" && r.context.lectureId === lectureId).slice(0, 3);
  const slideNotes = (notes.data?.notes ?? []).filter((n) => n.sources.some((s) => s.source_id === lecture?.deck?.source_id && s.locator.page === page));
  // "Related concepts": lecture questions that share a concept with this slide but are not placed on it by the course record.
  const relatedByConcept: QuestionRow[] = useMemo(() => {
    if (!lecture || !slide) return [];
    const here = new Set(slide.concepts.map((c) => c.concept_id));
    const placed = new Set(slide.questions.map((q) => q.question_id));
    return lecture.questions.all.filter((q) => !placed.has(q.question_id) && q.concept_ids.some((id) => here.has(id)));
  }, [lecture, slide]);

  if (lectureQuery.isLoading) return <LoadingState label="Opening lecture…" />;
  if (lectureQuery.isError || !lecture) return <ErrorState error={lectureQuery.error} retry={() => void lectureQuery.refetch()} />;

  const pdfUrl = lecture.display.content ? contentUrl(lecture.display.content) : null;
  const slides = lecture.slides.length ? lecture.slides : Array.from({ length: total }, (_, i) => ({ page: i + 1, title: null as string | null }));
  const shownSlides = findSlide.trim() ? slides.filter((s) => `${s.page} ${s.title ?? ""} ${(s as { text?: string | null }).text ?? ""}`.toLowerCase().includes(findSlide.toLowerCase())) : slides;
  const alignment = lecture.preparation.alignment;
  const lectureQuestionCount = lecture.questions.all.length;
  const here = `/courses/${courseId}/lectures/${lectureId}?page=${page}`;

  const submitMatch = async (occurrence: Occurrence, change: { startMs: number; endMs: number; state: "confirmed" | "rejected" | "suggested" }) => {
    const record = reviseAnnotation({ record: occurrence.record, artifact: occurrence.artifact }, {
      review_state: change.state, startMs: change.startMs, endMs: change.endMs,
      reviewer_ref: change.state === "suggested" ? null : "learner", basis: change.state === "suggested" ? occurrence.basis : "manual_review",
    });
    await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, {
      label: `Link correction · slide ${page}`, text: `${change.state === "rejected" ? "Reject" : change.state === "suggested" ? "Undo review of" : "Confirm"} link ${occurrence.annotation_id} → revision ${record.revision}`,
      context: { lectureId, page, label: `Slide ${page}` },
    });
    setNotice("Correction sent. The current reviewed view stays in place until the new revision is accepted.");
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["lecture", courseId, lectureId] }), 2500);
  };

  // A new link needs exact identities of both ends and a paired device; otherwise it is not offered.
  const startAddMatch = () => {
    const recording = playerRef.current?.recording() ?? null;
    if (!recording?.version_id || !lecture.deck?.version_id) return;
    playerRef.current?.pause();
    setAdding({ page, recordingName: recording.filename, recordingVersion: recording.version_id, deckVersion: lecture.deck.version_id, startMs: playerRef.current?.currentMs() ?? 0,
      durationMs: playerRef.current?.durationMs() ?? null });
  };
  const submitNewMatch = async (startMs: number, endMs: number) => {
    const recording = playerRef.current?.recording() ?? null;
    if (!slideRef || !recording?.version_id || !recording.sha256 || !recording.artifact) throw new Error("The slide or the recording is not identified yet, so an exact link cannot be made.");
    const record = newOccurrenceAnnotation({ courseId, lectureId, slide: slideRef, startMs, endMs,
      recording: { source_id: recording.source_id, version_id: recording.version_id, sha256: recording.sha256, artifact: recording.artifact } });
    await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, {
      label: `New link · slide ${page}`, text: `Link slide ${page} to ${formatMs(startMs)}–${formatMs(endMs)} of the recording (${record.annotation_id})`, context: { lectureId, page, label: `Slide ${page}` },
    });
    setNotice("Link sent. It appears on this slide once the Brain has recorded it.");
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
      const outcome = await actions.control(courseId, "save_note", { text: noteText.trim(), sources: [source], attachments: [] }, { label: `Note · slide ${page}`, text: noteText.trim(), context: { lectureId, page, source, label: `Slide ${page}` } });
      setNotice(outcome.delivery === "uploaded" ? "Note sent to the Brain. It appears under this slide once it is received." : `Note kept on this device (${outcome.reason ?? "not sent yet"}).`);
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
    playerRef.current?.pause();
    if (app.pairing.state === "paired" && slideRef) {
      try {
        const device = await getOrCreateDevice();
        const head = resume.data?.current ?? null;
        const draftText = (document.getElementById("tutor-composer") as HTMLTextAreaElement | null)?.value ?? "";
        const draft = draftText.trim() ? await draftAttachment(draftText) : null;
        const checkpoint = { contract: "ll.resume/1", checkpoint_id: newId("cp"), device_id: device.deviceId, scope: { course_id: courseId, term: TERM }, session_id: sessionId(), sequence: await nextSequence(),
          parent_checkpoint: head ? { record_id: head.checkpoint_id, artifact: head.artifact } : null,
          cursor: { lecture_id: lectureId, source: slideRef, position_ms: playerRef.current ? playerRef.current.currentMs() : null, panel: panel === "questions" ? "sources" : panel, draft: draft?.artifact ?? null }, updated_at: isoNow() };
        await actions.record(courseId, "resume", checkpoint, { label: "Study position", text: `Slide ${page} of ${lecture.title}`, context: { lectureId, page, label: `Slide ${page}` }, attachments: draft ? [draft.file] : [] });
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

  const contextPanel = (
    <Tabs value={panel === "slide" ? "tutor" : panel} onValueChange={(value) => update({ panel: value }, true)} className="flex h-full min-h-0 flex-col">
      <TabList label="Context panel" className="hidden wide:flex">
        <Tab value="tutor">Tutor</Tab>
        <Tab value="transcript">Transcript</Tab>
        <Tab value="sources">This slide</Tab>
        <Tab value="questions">Questions</Tab>
      </TabList>
      <TabPanel value="tutor" forceMount className="min-h-0 flex-1 overflow-y-auto pt-3 data-[state=inactive]:hidden">
        <TutorPanel courseId={courseId} lecture={lecture} page={page} slideRef={slideRef} pinned={pinned} onUnpin={(i) => setPinned((p) => p.filter((_, n) => n !== i))}
          onPauseMedia={() => playerRef.current?.pause()} onGoToPage={goTo} hideSlide={hideSlide} onHideSlide={setHideSlide} />
      </TabPanel>
      <TabPanel value="transcript" className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
        <GeneratedTextPanel recordings={lecture.recordings} onSeek={(ms) => playerRef.current?.seekTo(ms)} />
        <TranscriptPanel transcripts={lecture.transcripts} slideRanges={slide?.transcript_ranges ?? []} positionMs={position.ms} playing={position.playing} focusLine={focusLine}
          onSeek={(ms) => playerRef.current?.seekTo(ms)}
          onQuote={(source, text) => {
            setPinned((p) => [...p, { source, label: `Transcript lines ${String(source.locator.start)}–${String(source.locator.end)}` }]);
            update({ panel: "tutor" }, true);
            app.announce(`Quoted transcript lines attached to your next message: ${text.slice(0, 60)}`);
          }}
          onReportError={(source, text) => {
            setNoteText(`Transcript correction proposal for lines ${String(source.locator.start)}–${String(source.locator.end)}:\n"${text}"\nShould read: `);
            setNoteOpen(true);
          }} />
      </TabPanel>
      <TabPanel value="sources" className="min-h-0 flex-1 overflow-y-auto pt-3">
        <SourcesPanel courseId={courseId} slide={slide} others={lecture.other_materials} relatedByConcept={relatedByConcept} lectureQuestionCount={lectureQuestionCount}
          onShowLectureQuestions={() => update({ panel: "questions" }, true)} outlineHref={`/courses/${courseId}/outline?scope=${encodeURIComponent(`slide:${lectureId}:${page}`)}`}
          onPin={(source, label) => { setPinned((p) => [...p, { source, label }]); update({ panel: "tutor" }, true); }} />
        {slideNotes.length > 0 && (
          <section className="mt-4" aria-labelledby="notes-heading">
            <h3 id="notes-heading" className="ll-label mb-1">Your notes on this slide</h3>
            <ul className="flex flex-col gap-1">{slideNotes.map((n) => <li key={n.event_id} className="ll-card whitespace-pre-wrap p-2">{n.text}</li>)}</ul>
          </section>
        )}
      </TabPanel>
      <TabPanel value="questions" className="min-h-0 flex-1 overflow-y-auto pt-3">
        <LectureQuestionsPanel courseId={courseId} lecture={lecture} onGoToPage={(next) => { goTo(next); }} />
      </TabPanel>
    </Tabs>
  );

  const slideHeader = (
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-lg font-bold" title={slide?.title ?? lecture.title}>{slide?.title ?? lecture.title}</h1>
      <p className="truncate text-sm text-muted">{lecture.deck ? <>{lecture.deck.filename} · deck version {lecture.deck.version_id ?? "not yet identified"}{lecture.deck.registration === "unregistered" && " · not registered by the course updater"}
        {lecture.deck_choice.basis === "this_request" && " · shown by your choice on this device"}</> : "No deck is shown"}</p>
    </div>
  );

  return (
    <div className="ll-workspace" data-testid="lecture-workspace">
      <ReturnLink />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted">
          <Link to="/study" className="hover:underline">Courses</Link> › <Link to={`/courses/${courseId}`} className="hover:underline">{courseId.toUpperCase()}</Link> › <span aria-current="page" className="font-medium text-ink">{lecture.title}</span>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Slide">
            <IconButton size="sm" label="Previous slide" onClick={() => goTo(page - 1)} disabled={page <= 1}><ChevronLeft aria-hidden className="size-4" /></IconButton>
            <p className="min-w-[7.5rem] text-center font-medium tabular-nums" aria-live="polite" data-testid="slide-position">{total ? `Slide ${page} of ${total}` : "Slide count unavailable"}</p>
            <IconButton size="sm" label="Next slide" onClick={() => goTo(page + 1)} disabled={!total || page >= total}><ChevronRight aria-hidden className="size-4" /></IconButton>
          </div>
          <Button size="sm" onClick={() => setNoteOpen(true)} disabled={!slideRef}><NotebookPen aria-hidden className="size-4" /> Save note</Button>
          <Button size="sm" onClick={finishSession}>Finish session</Button>
          <IconButton size="sm" label={focus ? "Exit focus" : "Focus on the slide"} onClick={() => update({ focus: focus ? null : "1" }, true)}>{focus ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}</IconButton>
        </div>
      </div>

      {/* Narrow screens: explicit single-pane navigation with the same actions. */}
      <PaneTabs value={panel} onChange={(value) => update({ panel: value }, true)} />

      <div className="ll-workspace-grid" data-outline={navOpen ? "open" : "closed"} data-focus={focus ? "true" : "false"} data-testid="workspace-grid">
        {!focus && (
          <aside className="ll-pane hidden gap-2 wide:flex" aria-label="Lecture outline" data-testid="lecture-outline">
            <div className="flex items-center gap-1">
              <IconButton size="sm" variant="quiet" label={navOpen ? "Collapse lecture outline" : "Open lecture outline"} aria-expanded={navOpen} onClick={() => setNavOpen((open) => { store("ll.outline", open ? "closed" : "open"); return !open; })}>
                {navOpen ? <PanelLeftClose aria-hidden className="size-4" /> : <PanelLeftOpen aria-hidden className="size-4" />}
              </IconButton>
              {navOpen && <span className="ll-label flex-1 truncate">Lecture outline</span>}
              {navOpen && pdfUrl && (
                <IconButton size="sm" variant="quiet" label={thumbs ? "Hide slide thumbnails" : "Show slide thumbnails"} aria-pressed={thumbs} onClick={() => setThumbs((on) => { store("ll.outline.thumbs", on ? "0" : "1"); return !on; })}>
                  <Images aria-hidden className="size-4" />
                </IconButton>
              )}
            </div>
            {navOpen && (
              <>
                <input type="search" className="ll-input min-h-[36px] py-1" placeholder="Find a slide" aria-label="Find a slide" value={findSlide} onChange={(e) => setFindSlide(e.target.value)} />
                <Outline slides={shownSlides} page={page} pdfUrl={pdfUrl} thumbs={thumbs} onSelect={goTo} lectureQuestions={lectureQuestionCount} onShowQuestions={() => update({ panel: "questions" }, true)} />
              </>
            )}
          </aside>
        )}

        <section id="pane-slide" className={cn("ll-stage flex-col gap-2", panel === "slide" || focus ? "flex" : "hidden wide:flex")} aria-label="Slide and recording">
          <div className="ll-stage-slide">
            {lecture.display.kind === "choose_deck" ? (
              <div className="flex flex-col gap-3">
                {slideHeader}
                <Callout tone="unassessed" title="Choose the file to read for this unit">{lecture.display.reason} Nothing is picked for you by file name or size. Your choice is remembered on this device only; the course records are not changed.</Callout>
                <ul className="flex flex-col gap-2" aria-label="Candidate files">
                  {lecture.deck_choice.candidates.map((c) => (
                    <li key={c.source_id} className="ll-card flex flex-wrap items-center justify-between gap-2 p-3">
                      <span className="min-w-0"><span className="block break-words font-medium">{c.filename}</span>
                        <span className="text-sm text-muted">{c.bytes ? `${(c.bytes / 1_048_576).toFixed(1)} MB` : "size unknown"}{c.registration === "unregistered" ? " · not registered by the course updater" : ""}{c.rendition !== "native_pdf" ? " · needs a PDF rendition" : ""}</span></span>
                      <Button size="sm" onClick={() => chooseDeck(c.source_id)}>Show this file</Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : lecture.display.kind === "unavailable" || !pdfUrl ? (
              <div className="flex flex-col gap-3">
                {slideHeader}
                <Callout tone="caution" title="These slides cannot be displayed here">{lecture.display.reason} Nothing was regenerated in their place; the original file is untouched.</Callout>
              </div>
            ) : (
              <>
                {lecture.display.kind === "rendition_pdf" && <Callout tone="unassessed" title="Static PDF rendition">{lecture.display.note}</Callout>}
                <SlideCanvas url={pdfUrl} page={page} label={`Slide ${page} of ${total || "?"}${slide?.title ? `: ${slide.title}` : ""} — original source, colours unchanged`} onPageCount={setPageCount} hidden={hideSlide}
                  header={slideHeader} contain={wide} />
              </>
            )}
          </div>

          <ClipPlayer ref={playerRef} recordings={lecture.recordings} occurrences={occurrences} page={page} onTime={(ms, playing) => setPosition({ ms, playing })} onEditMatch={setEditing} onAddMatch={canAddMatch ? startAddMatch : undefined} announce={app.announce} />

          <div className="ll-stage-extras flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {pdfUrl && <Button size="sm" variant="quiet" aria-expanded={readable} onClick={() => setReadable((r) => !r)}>{readable ? "Hide" : "Show"} readable text</Button>}
              {alignment && <StatusChip tone={dispositionLabel(alignment.status === "suggested" ? "links_pending_review" : "").tone}>{alignment.status === "suggested" ? "Some links on this lecture are suggestions" : `Alignment: ${alignment.status.replace(/_/g, " ")}`}</StatusChip>}
              {slide && (slide.questions.length > 0 || slide.concepts.length > 0 || slide.related.length > 0) ? (
                <button type="button" className="ll-chip hover:underline" onClick={() => update({ panel: "sources" }, true)} data-testid="slide-links-chip">
                  On this slide: {[slide.questions.length ? `${slide.questions.length} question${slide.questions.length === 1 ? "" : "s"}` : "", slide.concepts.length ? `${slide.concepts.length} concept${slide.concepts.length === 1 ? "" : "s"}` : "",
                    slide.related.length ? `${slide.related.length} linked source${slide.related.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
                </button>
              ) : lectureQuestionCount > 0 ? (
                <button type="button" className="ll-chip hover:underline" onClick={() => update({ panel: "questions" }, true)} data-testid="slide-links-chip">No question names this slide · {lectureQuestionCount} lecture question{lectureQuestionCount === 1 ? "" : "s"}</button>
              ) : null}
              {lecture.other_materials.length > 0 && (
                <button type="button" className="ll-chip hover:underline" onClick={() => update({ panel: "sources" }, true)}>{lecture.other_materials.length} other file{lecture.other_materials.length === 1 ? "" : "s"} in this lecture unit</button>
              )}
              {lecture.deck_choice.basis === "this_request" && <Link className="ll-chip hover:underline" to={`/courses/${courseId}/lectures/${lectureId}`} onClick={() => store(`ll.deck.${courseId}.${lectureId}`, "")}>Choose another file</Link>}
            </div>
            {readable && pdfUrl && (
              <div className="ll-card p-3" aria-label="Readable text rendition">
                <p className="ll-label mb-1">Derived text rendition — not the original</p>
                {slide?.text ? <p className="ll-measure whitespace-pre-wrap">{slide.text}</p> : <p className="text-muted">{slide?.text_status === "not_prepared" ? "Text has not been extracted yet (preparation pending)." : "This slide has no extractable text layer. The original image above is the source; nothing was guessed."}</p>}
                <p className="mt-1 text-sm text-muted">Extracted automatically; layout, figures and equations may be incomplete.</p>
              </div>
            )}
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
            {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
          </div>
        </section>

        {!focus && (
          <aside id="pane-context" className={cn("ll-pane min-h-[32rem] min-w-0 wide:min-h-0", panel === "slide" ? "hidden wide:flex" : "flex")} aria-label="Context panel" data-return={here}>
            <div className="ll-card flex min-h-0 flex-1 flex-col p-3">{contextPanel}</div>
          </aside>
        )}
      </div>

      <AddMatchDialog draft={adding} onClose={() => setAdding(null)} onPreview={(startMs) => playerRef.current?.seekTo(startMs)} onSubmit={submitNewMatch} />
      <EditMatchDialog occurrence={editing} recording={lecture.recordings.find((r) => r.source_id === editing?.source.source_id)} onClose={() => setEditing(null)}
        onPreview={(startMs) => playerRef.current?.seekTo(startMs)} onSubmit={submitMatch} />

      <Dialog open={noteOpen} onOpenChange={setNoteOpen} title="Save a note on this slide" description="A note is your own work linked to this exact slide version. It is not sent to the tutor and it is not learning evidence."
        footer={<><Button onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" busy={noteBusy} disabled={!noteText.trim()} onClick={saveNote}>Save note</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Linked to: slide {page} · {lecture.deck?.filename} · version {lecture.deck?.version_id ?? "unknown"}</p>
          <Field label="Note" htmlFor="note-text"><textarea id="note-text" className="ll-input min-h-[7rem]" value={noteText} onChange={(e) => setNoteText(e.target.value)} /></Field>
          <fieldset className="grid grid-cols-4 gap-2">
            <legend className="mb-1 text-sm font-medium">Optional figure region (percent of the slide: left, top, width, height)</legend>
            {(["x", "y", "w", "h"] as const).map((key) => (
              <input key={key} className="ll-input" inputMode="numeric" aria-label={{ x: "Left percent", y: "Top percent", w: "Width percent", h: "Height percent" }[key]} placeholder={{ x: "left", y: "top", w: "width", h: "height" }[key]}
                value={region[key]} onChange={(e) => setRegion((r) => ({ ...r, [key]: e.target.value }))} />
            ))}
          </fieldset>
          <p className="text-sm text-muted">A region marks where on the slide your note points. It stays a pointer into the full source, not a claim about what the figure shows.</p>
        </div>
      </Dialog>
    </div>
  );
}
