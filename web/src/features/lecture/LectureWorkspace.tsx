// SC04 Lecture workspace (design specification 5): the composition of the lecture's parts on app/WorkspaceFrame.
//
//   outline zone   LectureOutline                      (collapsible panel; a pane below 1180 px)
//   stage zone     Pager · the original page · Transport (the ONE media transport, directly under the slide)
//   context zone   ContextPanel: Tutor · Questions · Concepts · Transcript · Sources
//
// The stage (5.4). The slide and the bar are ONE block of one width, min(stage width, (stage height − bar height − 8 px)
// × page shape), centred sideways. Beside its neighbours the block sits at the foot of the stage, so the bar's bottom
// edge meets the bottom edge of the panel region and any slack is above the slide; alone in a pane it sits at the top.
// Nothing is drawn above the page but the band and nothing under the bar: what used to stand there (readable text, the
// learner's recent link corrections, a link conflict, notes) lives in the Sources tab, and a result of something the
// learner just did is said once in a line over the top of the stage.
//
// The address owns `page`, `panel` (a tab, or below 1180 px a pane), `focus`, `line` and `deck`; ./workspace-state holds
// what the parts share (selected range, the one player, fit). Changing page pauses playback and never autoplays;
// changing tab, pane, outline state, panel width, fit or theme never reloads the slide or the media and never clears a
// draft. The parts live in their own files (see ./contracts); this file keeps the flows that span them: notes, finishing
// a session, choosing among decks, correcting a link, a role or a grouping, the resume position.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useApp } from "@/app/state";
import { WorkspaceFrame, stageBlockWidth, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { ErrorGlyph } from "@/components/glyphs";
import { Button, Callout, cn, Dialog, ErrorState, Field, IconButton, LoadingState, Segmented, formatMs } from "@/components/ui";
import { apiGet, contentUrl, r2Paths } from "@/lib/api";
import { isoNow, newId } from "@/lib/bundle";
import type { SourceRef } from "@/lib/db";
import { getOrCreateDevice, nextSequence } from "@/lib/device";
import { groupRowLabel, groupingLabel, pagesRef } from "@/lib/labels";
import { queryKeys, useLecture, useNotes, useResume, useSourceMapOverride } from "@/lib/queries";
import { identityOf, isStructuralPage, nextContentPage, questionsForPage } from "@/lib/r2";
import { draftAttachment, reviseAnnotation, sessionId, TERM, newOccurrenceAnnotation } from "@/lib/requests";
import { usePageBox } from "@/lib/thumbs";
import type { LectureView, LogicalSlideKind, Occurrence, SlideRoleValue, SourceMapDocument, SourceMapOverrideRecord, SourceMapOverrideRequest } from "@/lib/types";
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
import { DEFAULT_PAGE_SHAPE, SlideCanvas } from "./SlideCanvas";
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
  return !target.closest('[role="tablist"],[role="radiogroup"],[role="menu"],[role="slider"],[role="separator"],[role="listbox"],[role="tree"],[role="dialog"],media-controller,[data-testid="slide-frame"][tabindex]');
}

// ---- the stage block (pure; web/tests/lib/lecture-source.test.ts) -----------------------------------------------------------
/** The gap between the slide and the bar. */
export const STAGE_GAP_PX = 8;
/** The bar keeps a usable width in a stage too short for the rule; the stage then scrolls inside itself. */
export const STAGE_MIN_BLOCK_PX = 320;

export interface StageBlock {
  /** Width of the one block the slide and the bar form. */
  width: number;
  /** Height of the slide at that width. */
  slideHeight: number;
  /** Empty stage left once the block is placed (0 when the stage is too short and scrolls). */
  slack: number;
}
/**
 * The block of 5.4 for a stage of the given content size (the panel less the band and the stage's own padding), a bar
 * of the given height and a page of the given shape (4:3 while unknown). The width is the rule's, never under
 * `STAGE_MIN_BLOCK_PX` (or the stage's width, when that is less). Nothing here depends on the range list, the tab or a
 * state of the bar.
 */
export function stageBlock({ stageWidth, stageHeight, barHeight, aspect }: { stageWidth: number; stageHeight: number; barHeight: number; aspect: number | null | undefined }): StageBlock {
  const shape = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_PAGE_SHAPE;
  if (!(stageWidth > 0) || !(stageHeight > 0)) return { width: 0, slideHeight: 0, slack: 0 };
  const ruled = stageBlockWidth({ stageWidth, stageHeight, barHeight, aspect: shape });
  const width = Math.max(Math.min(Math.floor(stageWidth), STAGE_MIN_BLOCK_PX), ruled);
  const slideHeight = Math.round(width / shape);
  return { width, slideHeight, slack: Math.max(0, Math.floor(stageHeight - slideHeight - STAGE_GAP_PX - barHeight)) };
}

// ---- correcting the grouping of a page (pure) -------------------------------------------------------------------------------
export type GroupingChoiceId = "join_previous" | "join_next" | "start_here" | "split_all" | `take_back:${number}`;
export interface GroupingChoice {
  id: GroupingChoiceId;
  label: string;
  /** What the correction does, in page numbers. */
  detail: string;
  /** The pages the correction names. A join may also state what the pages are (`value`). `revert` undoes `revisions`. */
  op: "group" | "split" | "split_before" | "revert";
  pages: number[];
  revisions?: number[];
}
const run = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
/**
 * The corrections that apply to the grouping of one page, from what the view says about it and its neighbours: join its
 * slide with the one before or after (a group is always a run of adjacent pages), start a new slide at this page, or let
 * every page of its group stand alone. Empty when the view carries no source map: there is nothing to correct against.
 */
export function groupingChoices(lecture: LectureView, page: number): GroupingChoice[] {
  if (lecture.source_map?.state !== "ready") return [];
  const here = identityOf(lecture, page);
  if (!here.known || here.outOfRange) return [];
  const group = [...here.groupPages].sort((a, b) => a - b);
  const first = group[0] ?? page;
  const last = group[group.length - 1] ?? page;
  const count = here.pageCount ?? lecture.page_count ?? 0;
  const choices: GroupingChoice[] = [];
  if (group.length > 1 && page !== first) {
    choices.push({ id: "start_here", label: "This page starts a new slide", op: "split_before", pages: [page],
      detail: `${pagesRef(run(first, page - 1))} ${page - 1 === first ? "stands" : "stay"} as before; ${pagesRef(run(page, last))} ${page === last ? "becomes its own slide" : "become the next slide"}.` });
  }
  if (group.length > 1) choices.push({ id: "split_all", label: "Each of these pages is its own slide", op: "split", pages: group, detail: `${pagesRef(group)} are no longer grouped.` });
  if (first > 1) {
    const before = identityOf(lecture, first - 1).groupPages;
    const pages = run(Math.min(...before, first - 1), last);
    choices.push({ id: "join_previous", label: group.length > 1 ? "These pages belong with the page before them" : "This page belongs with the page before it", op: "group", pages, detail: `${pagesRef(pages)} become one slide.` });
  }
  if (count > 0 && last < count) {
    const after = identityOf(lecture, last + 1).groupPages;
    const pages = run(first, Math.max(...after, last + 1));
    choices.push({ id: "join_next", label: group.length > 1 ? "The next page belongs with these" : "The next page belongs with this one", op: "group", pages, detail: `${pagesRef(pages)} become one slide.` });
  }
  return choices;
}
type JoinKind = "none" | Exclude<LogicalSlideKind, "single" | "manual_group">;
const JOIN_KINDS: Array<{ value: JoinKind; label: string }> = [{ value: "none", label: "Not said" }, { value: "build_group", label: "Builds" }, { value: "step_group", label: "Steps" }, { value: "duplicate_group", label: "Copies" }];
const DEFAULT_REASON = "Corrected by the learner in the lecture workspace";
const TAKE_BACK_REASON = "Taken back by the learner in the lecture workspace";
/** The request a chosen grouping correction sends. */
export function groupingRequest(choice: GroupingChoice, kind: JoinKind, reason: string): SourceMapOverrideRequest {
  if (choice.op === "revert") return { op: "revert", value: choice.revisions ?? [], reason: reason.trim() || TAKE_BACK_REASON };
  const why = reason.trim() || DEFAULT_REASON;
  if (choice.op === "group") return kind === "none" ? { op: "group", pages: choice.pages, reason: why } : { op: "group", pages: choice.pages, value: kind, reason: why };
  if (choice.op === "split_before") return { op: "split_before", pages: [choice.pages[0]!], reason: why };
  return { op: "split", pages: choice.pages, reason: why };
}

/**
 * The learner's own corrections of the source map that are in force and touch one page, newest first: of its role, and
 * of its grouping (a group that holds it, an ungrouping that names it, a new slide started at it or right after it).
 * Read from the history `GET …/source-map` returns; a correction that was superseded or already taken back is left out.
 * Taking one back is a further revision (`revert`), never a deletion.
 */
export function learnerCorrections(overrides: readonly SourceMapOverrideRecord[] | null | undefined, page: number): { role: SourceMapOverrideRecord[]; grouping: SourceMapOverrideRecord[] } {
  const role: SourceMapOverrideRecord[] = [];
  const grouping: SourceMapOverrideRecord[] = [];
  for (const record of overrides ?? []) {
    const author = typeof record.author === "string" ? record.author : record.author?.kind;
    if (author !== "learner" || record.status !== "applied" || record.reverted_by != null) continue;
    const op = (record.op ?? {}) as { type?: unknown; page?: unknown; pages?: unknown; before_page?: unknown };
    const pages = Array.isArray(op.pages) ? op.pages.filter((entry): entry is number => typeof entry === "number") : [];
    if (op.type === "role" && op.page === page) role.push(record);
    else if (op.type === "group" && pages.includes(page)) grouping.push(record);
    else if (op.type === "split" && (pages.includes(page) || op.before_page === page || op.before_page === page + 1)) grouping.push(record);
  }
  const newest = (a: SourceMapOverrideRecord, b: SourceMapOverrideRecord): number => b.revision - a.revision;
  return { role: role.sort(newest), grouping: grouping.sort(newest) };
}
/** One of the learner's grouping corrections as a choice of the dialog: what it was, and that taking it back restores what held before it. */
export function takeBackChoice(record: SourceMapOverrideRecord): GroupingChoice {
  const op = (record.op ?? {}) as { type?: unknown; pages?: unknown; before_page?: unknown };
  const pages = Array.isArray(op.pages) ? op.pages.filter((entry): entry is number => typeof entry === "number").sort((a, b) => a - b) : [];
  const what = op.type === "group" ? `you grouped ${pagesRef(pages)}` : pages.length ? `you ungrouped ${pagesRef(pages)}` : typeof op.before_page === "number" ? `you started a new slide at ${pagesRef([op.before_page])}` : "your correction";
  return { id: `take_back:${record.revision}`, label: "Take back your correction", op: "revert", pages, revisions: [record.revision],
    detail: `Earlier ${what}. Taking it back restores what held before it; it stays in the history.` };
}

/** What the learner is told once, over the top of the stage. */
interface StageNotice {
  text: string;
  /** One way on from the message. */
  action?: { label: string; run: () => void };
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
  const sourceMapOverride = useSourceMapOverride(courseId, lectureId, deckChoice);
  const [pinned, setPinned] = useState<PinnedSource[]>([]);
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [adding, setAdding] = useState<NewMatchDraft | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [region, setRegion] = useState({ x: "", y: "", w: "", h: "" });
  const [noteBusy, setNoteBusy] = useState(false);
  const [readable, setReadable] = useState(false);
  const [hideSlide, setHideSlide] = useState(false);
  const [notice, setNotice] = useState<StageNotice | null>(null);

  /** Said once: shown over the top of the stage and read out. */
  const tell = useCallback((text: string, action?: StageNotice["action"]) => {
    setNotice({ text, action });
    app.announce(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.announce]);

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

  // A converted file is labelled as such: once when it is opened, and for as long as it is shown under Sources.
  const renditionNote = lecture.display.kind === "rendition_pdf" ? `Static PDF rendition, not the original file. ${lecture.display.note ?? ""}`.trim() : null;
  useEffect(() => {
    if (renditionNote) setNotice({ text: renditionNote });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, lecture.deck?.source_id, renditionNote]);

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
  // `panel` names the tab and, in the one-pane arrangement, the pane: one call opens Sources in either.
  const showSources = useCallback(() => showTab("sources"), [showTab]);

  const submitMatch = async (occurrence: Occurrence, change: { startMs: number; endMs: number; state: "confirmed" | "rejected" | "suggested" }) => {
    const record = reviseAnnotation({ record: occurrence.record, artifact: occurrence.artifact }, {
      review_state: change.state, startMs: change.startMs, endMs: change.endMs,
      reviewer_ref: change.state === "suggested" ? null : "learner", basis: change.state === "suggested" ? occurrence.basis : "manual_review",
    });
    await actions.record(courseId, "correct_source", record as unknown as Record<string, unknown>, {
      label: `Link correction · page ${page}`, text: `${change.state === "rejected" ? "Reject" : change.state === "suggested" ? "Undo review of" : "Confirm"} link ${occurrence.annotation_id} → revision ${record.revision}`,
      context: { lectureId, page, label: `Page ${page}` },
    });
    tell("Correction sent. The current reviewed view stays in place until the new revision is accepted.", { label: "See its state", run: showSources });
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
    tell("Link sent. It appears on this page once the Brain has recorded it.", { label: "See its state", run: showSources });
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
      tell(outcome.delivery === "uploaded" ? "Note sent to the Brain. It appears under this page in Sources once it is received." : `Note kept on this device (${outcome.reason ?? "not sent yet"}).`);
      setNoteOpen(false);
      setNoteText("");
      setRegion({ x: "", y: "", w: "", h: "" });
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["notes", courseId] }), 2500);
    } catch (error) {
      tell((error as Error).message);
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
      await sourceMapOverride.mutateAsync({ op: "role", pages: [page], value: role, reason: DEFAULT_REASON });
      tell("The role of this page was recorded as your correction.");
    } catch (error) {
      tell(`The role could not be recorded: ${(error as Error).message}`);
    }
  };
  // The learner's own correction of this page's role is undone by a further revision; the history is read when asked for.
  const takeBackRole = async () => {
    try {
      const history = await queryClient.fetchQuery({ queryKey: queryKeys.sourceMap(courseId, lectureId, deckChoice), staleTime: 0,
        queryFn: ({ signal }) => apiGet<SourceMapDocument>(r2Paths.sourceMap(courseId, lectureId, deckChoice), signal) });
      const mine = learnerCorrections(history.overrides, page).role[0];
      if (!mine) {
        tell("No correction of yours is in force for the role of this page.");
        return;
      }
      await sourceMapOverride.mutateAsync({ op: "revert", value: [mine.revision], reason: TAKE_BACK_REASON });
      tell("Your correction was taken back. The role is again what held before it.");
    } catch (error) {
      tell(`The correction could not be taken back: ${(error as Error).message}`);
    }
  };
  const pin = (source: SourceRef, label: string) => {
    setPinned((current) => [...current, { source, label }]);
    showTab("tutor");
  };
  // The readable text is a derived rendition and never stands in the page's place: it opens under Sources, beside the slide.
  const showReadable = (shown: boolean) => {
    setReadable(shown);
    if (shown) {
      showSources();
      window.setTimeout(() => document.getElementById("readable-text")?.scrollIntoView({ block: "nearest" }), 50);
    }
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
        {readable && pdfUrl && (
          <section id="readable-text" aria-label="Readable text rendition" className="flex flex-col gap-1" data-testid="readable-text">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-head font-semibold">Readable text of this page</h3>
              <IconButton size="sm" label="Hide readable text" onClick={() => setReadable(false)}><X aria-hidden /></IconButton>
            </div>
            <p className="ll-measure text-ui text-muted"><span className="ll-num">{pageName}.</span> Derived text rendition, not the original. Extracted automatically; layout, figures and equations may be incomplete.</p>
            {slide?.text ? <p className="ll-measure whitespace-pre-wrap">{slide.text}</p>
              : <p className="ll-measure text-muted">{slide?.text_status === "not_prepared" ? "Text has not been extracted yet (preparation pending)." : "This page has no extractable text layer. The original page is the source; nothing was guessed."}</p>}
          </section>
        )}
        {lecture.link_conflicts.length > 0 && (
          <Callout tone="caution" title="A link correction conflicts with another revision" actions={<Link className="ll-btn ll-btn-sm" to={`/activity/conflicts/${encodeURIComponent(lecture.link_conflicts[0]!.conflict_id)}?course=${courseId}&lecture=${lectureId}`}>Compare and resolve</Link>}>
            Both versions are kept. The reviewed link stays as it was until you choose.
          </Callout>
        )}
        {corrections.length > 0 && (
          <section aria-label="Your recent link corrections" className="flex flex-col gap-2">
            <h3 className="text-head font-semibold">Your recent link corrections</h3>
            {corrections.map((r) => <RequestCard key={r.requestId} request={r} showContext />)}
          </section>
        )}
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
          {renditionNote && <p className="ll-measure mt-1 text-ui text-muted">{renditionNote}</p>}
        </section>
      </TabScroll>
    ),
  };

  const stage = (
    <StageZone focus={focus} hideSlide={hideSlide} pdfUrl={pdfUrl} notice={notice} onDismissNotice={() => setNotice(null)} onPageCount={onPageCount} chooseDeck={chooseDeck} onShowFiles={showSources}
      pager={(
        <Pager lecture={lecture} page={page} total={total} onGoTo={goTo} onNote={slideRef ? () => setNoteOpen(true) : undefined} fit={state.fit} onFit={state.setFit} focus={focus}
          onFocus={(on) => update({ focus: on ? "1" : null }, true)} onFinishSession={() => void finishSession()} readable={readable} onReadable={pdfUrl ? showReadable : undefined}
          onChooseAnotherFile={lecture.deck_choice.basis === "this_request" ? chooseAnotherFile : undefined} onCorrectPage={lecture.source_map?.state === "ready" ? state.correctGrouping : undefined}
          onSetRole={lecture.source_map?.state === "ready" ? setRole : undefined} onTakeBackRole={lecture.source_map?.state === "ready" ? takeBackRole : undefined} />
      )}
      transport={(
        <TransportSlot onEditMatch={setEditing} onAddMatch={canAddMatch ? startAddMatch : undefined} onNextContent={nextContent !== null ? () => goTo(nextContent) : undefined} announce={app.announce} />
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
      <GroupingDialog open={state.groupingOpen} onClose={state.closeGrouping} lecture={lecture} page={page} deck={deckChoice}
        onSubmit={async (request) => {
          await sourceMapOverride.mutateAsync(request);
          tell(request.op === "revert" ? "Your correction was taken back. The grouping is again what held before it." : "The grouping was recorded as your correction. The file itself is unchanged.");
        }} />

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

// ---- the grouping correction ------------------------------------------------------------------------------------------------
function GroupingDialog({ open, onClose, lecture, page, deck, onSubmit }: { open: boolean; onClose: () => void; lecture: LectureView; page: number; deck: string | null;
  onSubmit: (request: SourceMapOverrideRequest) => Promise<void> }) {
  // The learner's own corrections in force here are read from the history while the dialog is open: each can be taken back.
  const history = useQuery<SourceMapDocument, Error>({ queryKey: queryKeys.sourceMap(lecture.course_id, lecture.lecture_id, deck), enabled: open && lecture.source_map?.state === "ready", retry: false, staleTime: 0,
    queryFn: ({ signal }) => apiGet<SourceMapDocument>(r2Paths.sourceMap(lecture.course_id, lecture.lecture_id, deck), signal) });
  const choices = useMemo(() => [...learnerCorrections(history.data?.overrides, page).grouping.map(takeBackChoice), ...groupingChoices(lecture, page)], [lecture, page, history.data]);
  const identity = identityOf(lecture, page);
  const [chosen, setChosen] = useState<GroupingChoiceId | null>(null);
  const [kind, setKind] = useState<JoinKind>("none");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setChosen(null);
      setKind("none");
      setReason("");
      setError(null);
    }
  }, [open, page]);
  const choice = choices.find((entry) => entry.id === chosen) ?? null;
  const group = identity.groupPages.length > 1 && identity.logicalSlideKind ? groupRowLabel(identity.logicalSlideKind, identity.groupPages, identity.grouping?.state ?? null) : null;
  const send = async () => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(groupingRequest(choice, kind, reason));
      onClose();
    } catch (failure) {
      setError((failure as Error).message || "The correction could not be recorded.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Correct the grouping of this page"
      description="Your correction is kept as its own versioned record on this PC and takes precedence over what was worked out from the file. The file is never changed, and every page stays reachable."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!choice} onClick={() => void send()}>Record the correction</Button></>}>
      <div className="flex flex-col gap-4" data-testid="grouping-dialog">
        <p className="ll-measure">
          <b className="font-semibold">{identity.label}.</b>{" "}
          {group ? <>Now: {group}{identity.grouping ? <span className="text-muted"> ({groupingLabel(identity.grouping)})</span> : null}.</> : <>Now: a slide of its own.</>}
        </p>
        {choices.length === 0 ? <p className="text-ui text-muted">Nothing can be corrected here: this file has no source map, or the page is not one of its pages.</p> : (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-ui font-semibold">What is right?</legend>
            {choices.map((entry) => (
              <label key={entry.id} className={cn("flex cursor-pointer items-start gap-3 rounded-row p-2 hover:bg-pad", chosen === entry.id && "bg-tint hover:bg-tint-strong")}>
                <input type="radio" name="grouping-choice" className="mt-1 size-4 flex-none accent-[var(--ll-accent-text)]" checked={chosen === entry.id} onChange={() => setChosen(entry.id)} />
                <span className="min-w-0">
                  <span className={cn("block", chosen === entry.id && "font-semibold text-accent-text")}>{entry.label}</span>
                  <span className="ll-num block text-ui text-muted">{entry.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {choice?.op === "group" && (
          <div className="flex flex-col gap-1">
            <p className="text-ui font-semibold" id="grouping-kind">What these pages are to each other</p>
            <Segmented label="What these pages are to each other" value={kind} onChange={setKind} options={JOIN_KINDS} />
            <p className="text-ui text-muted">A build adds to the page before it, a step changes it, a copy repeats it. Leave it unsaid when none fits.</p>
          </div>
        )}
        {choices.length > 0 && <Field label="Why (optional)" htmlFor="grouping-reason"><input id="grouping-reason" className="ll-input" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>}
        {error && <p role="alert" className="ll-err"><ErrorGlyph /><span>{error}</span></p>}
      </div>
    </Dialog>
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

/** The content box of an element (its padding left out), keeping the last real size: a hidden pane measures 0 and must not resize the slide. */
function useContentBox<T extends HTMLElement>(): [(node: T | null) => void, { width: number; height: number }] {
  const [node, setNode] = useState<T | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!node) return;
    const read = (width: number, height: number) => {
      if (!(width > 0) || !(height > 0)) return;
      const next = { width: Math.floor(width), height: Math.floor(height) };
      setBox((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    const style = getComputedStyle(node);
    read(node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) read(rect.width, rect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, box];
}

/** The height of an element as drawn (its border box), keeping the last real one. */
function useHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    const read = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      if (next > 0) setHeight((current) => (current === next ? current : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, height];
}

interface StageZoneProps {
  focus: boolean;
  hideSlide: boolean;
  pdfUrl: string | null;
  notice: StageNotice | null;
  onDismissNotice: () => void;
  onPageCount: (count: number) => void;
  chooseDeck: (sourceId: string) => void;
  /** Opens the files of the lecture (the Sources tab): the one action of a deck that cannot be displayed. */
  onShowFiles: () => void;
  pager: React.ReactNode;
  transport: React.ReactNode;
}

/**
 * The stage: the band, then the original page with the one transport directly under it, as one block of one width.
 * The structure is the same in every arrangement and for every fit, so the page and the media element are never
 * remounted; only the sizes change.
 */
function StageZone({ focus, hideSlide, pdfUrl, notice, onDismissNotice, onPageCount, chooseDeck, onShowFiles, pager, transport }: StageZoneProps) {
  const { lecture, page, total, slide, fit } = useLectureWorkspace();
  const frame = useWorkspaceFrame();
  const [areaRef, area] = useContentBox<HTMLDivElement>();
  const [barRef, barHeight] = useHeight<HTMLDivElement>();
  const { shape } = usePageBox(pdfUrl, page);

  const alone = frame.arrangement === "panes";
  const choosing = lecture.display.kind === "choose_deck";
  const showsPage = !choosing && lecture.display.kind !== "unavailable" && !!pdfUrl;
  /** The block is sized by the rule (the whole page, or the place of a deck that cannot be shown); otherwise it fills the stage and the page scrolls inside it. */
  const ruled = !choosing && (!showsPage || fit === "page");
  const block = stageBlock({ stageWidth: area.width, stageHeight: area.height, barHeight, aspect: showsPage ? shape : DEFAULT_PAGE_SHAPE });
  const identity = identityOf(lecture, page);
  const label = `${total ? identity.label : `Page ${page}`}${slide?.title ? `: ${slide.title}` : ""} — original source, colours unchanged`;

  // A message about something just done leaves by itself; one that needs the learner (it has an action) stays until closed.
  useEffect(() => {
    if (!notice || notice.action) return;
    const id = window.setTimeout(onDismissNotice, 12_000);
    return () => window.clearTimeout(id);
  }, [notice, onDismissNotice]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="lecture-stage">
      {pager}
      <div ref={areaRef} className={cn("flex min-h-0 flex-1 flex-col items-center", frame.arrangement === "frame" ? "py-3" : "p-3", ruled ? "overflow-y-auto overflow-x-hidden [scrollbar-width:thin]" : "overflow-hidden")}
        data-testid="stage-area" data-fit={fit} data-slack={ruled ? block.slack : undefined}>
        <div className={cn("flex flex-none flex-col gap-2", ruled ? (alone ? "mb-auto" : "mt-auto") : "min-h-0 w-full flex-1", choosing && "max-w-[46rem]")} style={ruled ? { width: block.width } : undefined} data-testid="stage-block">
          <div className={cn("flex flex-col", !ruled && "min-h-0 flex-1")} data-testid="stage-slide">
            {choosing ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
            ) : !showsPage ? (
              <div role="status" className="grid place-items-center overflow-auto rounded-row bg-pad p-4 text-center" style={{ height: block.slideHeight || undefined, minHeight: block.slideHeight ? undefined : "12rem" }} data-testid="slide-unavailable">
                <div className="flex max-w-[34rem] flex-col items-center gap-2">
                  <p className="ll-err"><ErrorGlyph /><span>These slides cannot be displayed here</span></p>
                  <p className="text-ui text-muted">{lecture.display.reason} Nothing was regenerated in their place; the original file is untouched.</p>
                  <Button size="sm" onClick={onShowFiles}>Files of this lecture</Button>
                </div>
              </div>
            ) : (
              <SlideCanvas url={pdfUrl} page={page} label={label} onPageCount={onPageCount} hidden={hideSlide} fit={fit} pageWidth={fit === "page" ? block.width : null} />
            )}
          </div>
          <div ref={barRef} className="flex-none" data-testid="stage-bar">{transport}</div>
        </div>
      </div>
      {notice && !focus && (
        <div role="status" className="ll-pop absolute left-1/2 top-[calc(var(--ll-band-h,48px)+12px)] z-20 flex w-max max-w-[min(36rem,calc(100%-24px))] -translate-x-1/2 items-start gap-2 py-1.5 pl-3 pr-1.5 text-ui max-[599px]:top-14" data-testid="stage-notice">
          <p className="min-w-0 py-1">{notice.text}{notice.action && <>{" "}<button type="button" className="ll-link whitespace-nowrap" onClick={() => { notice.action!.run(); onDismissNotice(); }}>{notice.action.label}</button></>}</p>
          <IconButton size="sm" label="Dismiss this message" onClick={onDismissNotice}><X aria-hidden /></IconButton>
        </div>
      )}
    </div>
  );
}
