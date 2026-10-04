// SC04 Lecture workspace (UI06–UI10, UI18): large original slide, stable bounded player, and one
// context panel (Tutor · Transcript · Sources). Changing slide pauses playback and never autoplays;
// switching panel or theme never reloads the slide or the media. On narrow screens one pane shows at
// a time with the same actions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Maximize, Minimize, NotebookPen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, Callout, cn, Dialog, ErrorState, Field, IconButton, LoadingState, StatusChip, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { isoNow, newId } from "@/lib/bundle";
import type { SourceRef } from "@/lib/db";
import { getOrCreateDevice, nextSequence } from "@/lib/device";
import { dispositionLabel } from "@/lib/labels";
import { useLecture, useNotes, useResume } from "@/lib/queries";
import { draftAttachment, reviseAnnotation, sessionId, TERM } from "@/lib/requests";
import type { Occurrence } from "@/lib/types";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { useLocalRequests, useSubmitActions } from "@/features/tutor/actions";
import { RequestCard } from "@/features/tutor/RequestCard";
import { TutorPanel } from "@/features/tutor/TutorPanel";
import { ClipPlayer, type ClipPlayerHandle } from "./ClipPlayer";
import { SlideCanvas, SlideThumb } from "./SlideCanvas";
import { EditMatchDialog, SourcesPanel } from "./SourcesPanel";
import { TranscriptPanel } from "./TranscriptPanel";

type Panel = "slide" | "tutor" | "transcript" | "sources";

const PANES: Array<{ value: Panel; label: string }> = [{ value: "slide", label: "Slide" }, { value: "tutor", label: "Tutor" }, { value: "transcript", label: "Transcript" }, { value: "sources", label: "Sources" }];

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
          className={cn("min-h-[44px] min-w-0 border-b-2 border-transparent px-2 font-medium text-muted", value === pane.value && "border-accent text-accent")}>
          {pane.label}
        </button>
      ))}
    </div>
  );
}

export function LectureWorkspace() {
  const { courseId = "", lectureId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const queryClient = useQueryClient();
  const lectureQuery = useLecture(courseId, lectureId);
  const notes = useNotes(courseId);
  const resume = useResume(courseId);
  const actions = useSubmitActions();
  const localRequests = useLocalRequests(courseId);
  const playerRef = useRef<ClipPlayerHandle>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [findSlide, setFindSlide] = useState("");
  const [position, setPosition] = useState({ ms: 0, playing: false });
  const [pinned, setPinned] = useState<Array<{ source: SourceRef; label: string }>>([]);
  const [editing, setEditing] = useState<Occurrence | null>(null);
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
  const panel = (["slide", "tutor", "transcript", "sources"].includes(params.get("panel") ?? "") ? params.get("panel") : "slide") as Panel;
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
    try {
      window.localStorage.setItem(`ll.last.${courseId}`, JSON.stringify({ lectureId, page }));
    } catch {
      /* per-device convenience only */
    }
  }, [courseId, lectureId, page, lecture]);

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

  if (lectureQuery.isLoading) return <LoadingState label="Opening lecture…" />;
  if (lectureQuery.isError || !lecture) return <ErrorState error={lectureQuery.error} retry={() => void lectureQuery.refetch()} />;

  const pdfUrl = lecture.display.content ? contentUrl(lecture.display.content) : null;
  const slides = lecture.slides.length ? lecture.slides : Array.from({ length: total }, (_, i) => ({ page: i + 1, title: null as string | null }));
  const shownSlides = findSlide.trim() ? slides.filter((s) => `${s.page} ${(s as { title: string | null }).title ?? ""} ${(s as { text?: string | null }).text ?? ""}`.toLowerCase().includes(findSlide.toLowerCase())) : slides;
  const alignment = lecture.preparation.alignment;

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
          cursor: { lecture_id: lectureId, source: slideRef, position_ms: playerRef.current ? playerRef.current.currentMs() : null, panel, draft: draft?.artifact ?? null }, updated_at: isoNow() };
        await actions.record(courseId, "resume", checkpoint, { label: "Study position", text: `Slide ${page} of ${lecture.title}`, context: { lectureId, page, label: `Slide ${page}` }, attachments: draft ? [draft.file] : [] });
      } catch {
        /* the wrap-up page reports what is and is not synchronised */
      }
    }
    navigate(`/study/sessions/${sessionId()}/summary?course=${courseId}&lecture=${lectureId}&page=${page}`);
  };

  const contextPanel = (
    <Tabs value={panel === "slide" ? "tutor" : panel} onValueChange={(value) => update({ panel: value }, true)} className="flex h-full min-h-0 flex-col">
      <TabList label="Context panel" className="hidden wide:flex">
        <Tab value="tutor">Tutor</Tab>
        <Tab value="transcript">Transcript</Tab>
        <Tab value="sources">Sources</Tab>
      </TabList>
      <TabPanel value="tutor" forceMount className="min-h-0 flex-1 pt-3 data-[state=inactive]:hidden">
        <TutorPanel courseId={courseId} lecture={lecture} page={page} slideRef={slideRef} pinned={pinned} onUnpin={(i) => setPinned((p) => p.filter((_, n) => n !== i))}
          onPauseMedia={() => playerRef.current?.pause()} onGoToPage={goTo} hideSlide={hideSlide} onHideSlide={setHideSlide} />
      </TabPanel>
      <TabPanel value="transcript" className="min-h-0 flex-1 pt-3">
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
        <SourcesPanel courseId={courseId} slide={slide} others={lecture.other_materials} onPin={(source, label) => { setPinned((p) => [...p, { source, label }]); update({ panel: "tutor" }, true); }} />
        {slideNotes.length > 0 && (
          <section className="mt-4" aria-labelledby="notes-heading">
            <h3 id="notes-heading" className="ll-label mb-1">Your notes on this slide</h3>
            <ul className="flex flex-col gap-1">{slideNotes.map((n) => <li key={n.event_id} className="ll-card whitespace-pre-wrap p-2 text-sm">{n.text}</li>)}</ul>
          </section>
        )}
      </TabPanel>
    </Tabs>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="lecture-workspace">
      <ReturnLink />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link to="/study" className="hover:underline">Courses</Link> › <Link to={`/courses/${courseId}`} className="hover:underline">{courseId.toUpperCase()}</Link> › <span aria-current="page" className="font-medium text-ink">{lecture.title}</span>
        </nav>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setNoteOpen(true)} disabled={!slideRef}><NotebookPen aria-hidden className="size-4" /> Save note</Button>
          <Button size="sm" onClick={finishSession}>Finish session</Button>
          <IconButton size="sm" label={focus ? "Exit focus" : "Focus on the slide"} onClick={() => update({ focus: focus ? null : "1" }, true)}>{focus ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}</IconButton>
        </div>
      </div>

      {/* Narrow screens: explicit single-pane navigation with the same actions. */}
      <PaneTabs value={panel} onChange={(value) => update({ panel: value }, true)} />

      <div className={cn("grid gap-4", focus ? "grid-cols-1" : "wide:grid-cols-[auto_minmax(0,1fr)_minmax(22rem,30rem)]")}>
        {!focus && (
          <aside className={cn("hidden wide:block", navOpen ? "w-[13rem]" : "w-[3rem]")} aria-label="Slide navigator">
            <div className="sticky top-[76px] flex max-h-[calc(100dvh-96px)] flex-col gap-2">
              <IconButton size="sm" variant="quiet" label={navOpen ? "Collapse slide navigator" : "Open slide navigator"} onClick={() => setNavOpen((o) => !o)}>
                {navOpen ? <PanelLeftClose aria-hidden className="size-4" /> : <PanelLeftOpen aria-hidden className="size-4" />}
              </IconButton>
              {navOpen && pdfUrl && (
                <>
                  <input type="search" className="ll-input min-h-[36px] py-1 text-sm" placeholder="Find a slide" aria-label="Find a slide" value={findSlide} onChange={(e) => setFindSlide(e.target.value)} />
                  <ol className="min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Slides">
                    {shownSlides.map((s) => <li key={s.page}><SlideThumb url={pdfUrl} page={s.page} active={s.page === page} title={(s as { title: string | null }).title} onSelect={() => goTo(s.page)} /></li>)}
                  </ol>
                </>
              )}
            </div>
          </aside>
        )}

        <section id="pane-slide" className={cn("min-w-0 flex-col gap-3", panel === "slide" || focus ? "flex" : "hidden wide:flex")} aria-label="Slide and recording">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-bold">{slide?.title ?? lecture.title}</h1>
              <p className="text-sm text-muted">{lecture.deck?.filename} · deck version {lecture.deck?.version_id ?? "not yet identified"} {lecture.deck?.registration === "unregistered" && "· not registered by the course updater"}</p>
            </div>
            <p className="text-sm font-medium" aria-live="polite" data-testid="slide-position">{total ? `Slide ${page} of ${total}` : "Slide count unavailable"}</p>
          </div>

          {lecture.display.kind === "unavailable" || !pdfUrl ? (
            <Callout tone="caution" title="These slides cannot be displayed here">{lecture.display.reason} Nothing was regenerated in their place; the original file is untouched.</Callout>
          ) : (
            <>
              {lecture.display.kind === "rendition_pdf" && <Callout tone="unassessed" title="Static PDF rendition">{lecture.display.note}</Callout>}
              <SlideCanvas url={pdfUrl} page={page} label={`Slide ${page} of ${total || "?"}${slide?.title ? `: ${slide.title}` : ""} — original source, colours unchanged`} onPageCount={setPageCount} hidden={hideSlide} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="quiet" aria-expanded={readable} onClick={() => setReadable((r) => !r)}>{readable ? "Hide" : "Show"} readable text</Button>
                {alignment && <StatusChip tone={dispositionLabel(alignment.status === "suggested" ? "links_pending_review" : "").tone}>{alignment.status === "suggested" ? "Some links on this lecture are suggestions" : `Alignment: ${alignment.status.replace(/_/g, " ")}`}</StatusChip>}
              </div>
              {readable && (
                <div className="ll-card p-3 text-sm" aria-label="Readable text rendition">
                  <p className="ll-label mb-1">Derived text rendition — not the original</p>
                  {slide?.text ? <p className="whitespace-pre-wrap">{slide.text}</p> : <p className="text-muted">{slide?.text_status === "not_prepared" ? "Text has not been extracted yet (preparation pending)." : "This slide has no extractable text layer. The original image above is the source; nothing was guessed."}</p>}
                  <p className="mt-1 text-xs text-muted">Extracted automatically; layout, figures and equations may be incomplete.</p>
                </div>
              )}
            </>
          )}

          <ClipPlayer ref={playerRef} recordings={lecture.recordings} occurrences={occurrences} page={page} onTime={(ms, playing) => setPosition({ ms, playing })} onEditMatch={setEditing} announce={app.announce} />

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
          {lecture.other_materials.length > 0 && (
            <p className="text-sm"><button type="button" className="ll-chip hover:underline" onClick={() => update({ panel: "sources" }, true)}>{lecture.other_materials.length} other file{lecture.other_materials.length === 1 ? "" : "s"} in this lecture unit</button></p>
          )}

          {(slide?.concepts.length || slide?.related.length || slide?.questions.length) ? (
            <div className="flex flex-col gap-2 text-sm">
              {slide!.concepts.length > 0 && (
                <div className="flex flex-wrap items-center gap-2"><span className="ll-label">On this slide</span>
                  {slide!.concepts.map((c) => <Link key={c.concept_id} className="ll-chip hover:underline" to={`/courses/${courseId}/concepts/${encodeURIComponent(c.concept_id)}`} state={{ returnTo: `/courses/${courseId}/lectures/${lectureId}?page=${page}`, returnLabel: "Return to slide" }}>{c.label}</Link>)}
                </div>
              )}
              {(slide!.related.length > 0 || slide!.questions.length > 0) && (
                <div className="flex flex-wrap items-center gap-2"><span className="ll-label">Connected material</span>
                  {slide!.questions.map((q) => <Link key={q.question_id} className="ll-chip hover:underline" to={`/courses/${courseId}/questions/${encodeURIComponent(q.question_id)}`} state={{ returnTo: `/courses/${courseId}/lectures/${lectureId}?page=${page}`, returnLabel: "Return to slide" }}>{q.title ?? q.question_id}</Link>)}
                  {slide!.related.length > 0 && <button type="button" className="ll-chip hover:underline" onClick={() => update({ panel: "sources" }, true)}>{slide!.related.length} linked source{slide!.related.length === 1 ? "" : "s"}</button>}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/40 pt-3">
            <Button onClick={() => goTo(page - 1)} disabled={page <= 1}><ChevronLeft aria-hidden className="size-4" /> Previous slide</Button>
            <span className="text-sm text-muted max-sm:hidden">Continue at your own pace</span>
            <Button variant="primary" onClick={() => goTo(page + 1)} disabled={!total || page >= total}>Next slide <ChevronRight aria-hidden className="size-4" /></Button>
          </div>
        </section>

        {!focus && (
          <aside id="pane-context" className={cn("min-h-[32rem] min-w-0 wide:sticky wide:top-[76px] wide:h-[calc(100dvh-96px)]", panel === "slide" ? "hidden wide:block" : "block")} aria-label="Context panel">
            <div className="ll-card h-full p-3">{contextPanel}</div>
          </aside>
        )}
      </div>

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
          <p className="text-xs text-muted">A region marks where on the slide your note points. It stays a pointer into the full source, not a claim about what the figure shows.</p>
        </div>
      </Dialog>
    </div>
  );
}
