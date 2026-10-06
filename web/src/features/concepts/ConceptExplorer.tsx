// The concept explorer (design specification 7): one read model at three scopes — Course, Lecture, This slide — on the
// same three-zone frame as the lecture workspace. The tree (the complete, keyboard-usable hierarchy) is in the outline
// zone, the map in the stage, the detail of the selected node in the context panel; below 1180 px one pane at a time:
// Outline, Map, Sources, Questions, Evidence. Scope, selection and pane are in the address (`scope`, `node`, `panel`).
//
// `courses/:courseId/outline` (the earlier address) keeps working: it redirects here with its parameters.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import { ArrowLeft, ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useApp } from "@/app/state";
import { BAND_CLASS, TextTabs, WorkspaceFrame, useWorkspaceFrame, type FramePane } from "@/app/WorkspaceFrame";
import { Button, IconButton, Segmented, StaleNotice, cn } from "@/components/ui";
import { CONCEPT_SCOPE_LABEL, R2_ACTION, conceptScopeHeading, countLabel, nb, staleViewLine } from "@/lib/labels";
import { useCourse, useLecture } from "@/lib/queries";
import { conceptGraphErrorCode, identityOf, isStale, isStructuralPage, nextContentPage } from "@/lib/r2";
import type { AnchorTieKind, ConceptGraphNode, ConceptGraphView, GraphScopeKind, LectureView, OutlineRow } from "@/lib/types";
import { ConceptDetail, DETAIL_TABS, detailCounts, isDetailTab, ownDetail, useNodeDetail, type DetailTabId } from "./ConceptDetail";
import { ConceptMap, useFocusGraph, useScopeGraph } from "./ConceptMap";
import { ConceptTree, type TreePlace } from "./ConceptTree";
import { conceptMapHref, firstTopic, openingNode, parseScope, revealPath, scopeParam, sourceTies, topicConceptCounts, type ParsedScope } from "./map-model";

export { parseScope } from "./map-model";

type ExplorerPane = "outline" | "map" | DetailTabId;
const PANE_IDS: readonly ExplorerPane[] = ["outline", "map", "sources", "questions", "evidence"];
const isPane = (value: string | null): value is ExplorerPane => !!value && (PANE_IDS as readonly string[]).includes(value);

/** A lecture address (`/courses/<c>/lectures/<l>?page=n`), read for the lecture and page the learner came from. */
export function lectureOfAddress(address: string | null | undefined): { lectureId: string; page: number | null } | null {
  const match = /\/lectures\/([^/?#]+)(?:\?([^#]*))?/.exec(address ?? "");
  if (!match) return null;
  const page = Number(new URLSearchParams(match[2] ?? "").get("page"));
  return { lectureId: decodeURIComponent(match[1]!), page: Number.isInteger(page) && page >= 1 ? page : null };
}
function lastLecture(courseId: string): string | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`ll.last.${courseId}`) ?? "null");
    const id = (value as { lectureId?: unknown } | null)?.lectureId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * How far the outline starts open. A slide holds a handful of entries, so its concepts and skills are listed at once; a
 * lecture lists its concepts; a course starts at its topics (a course of several hundred concepts is never listed at once).
 */
const OPEN_BY_SCOPE: Record<GraphScopeKind, ReadonlyArray<OutlineRow["kind"]>> = { course: [], lecture: ["topic"], slide: ["topic", "concept"] };

/** What a structural page is called in the sentence of 7.5. A role without words here is not worded as structural. */
const STRUCTURAL_PAGE: Record<string, string> = { structural_title_or_section: "a structural page (title or section)", administrative: "an administrative page", blank: "a blank page" };

interface ExplorerState {
  courseId: string;
  scope: ParsedScope;
  scopeText: string;
  selected: string | null;
  tab: DetailTabId;
  lecture: LectureView | null;
  place: TreePlace | null;
  /** The lecture and page offered by the scope switch while the scope is wider. */
  lectureId: string | null;
  page: number | null;
  /** The course's lectures are still being read: which lecture the switch would open is not known yet. */
  lecturesLoading: boolean;
  /** The scope is about to open on a node that is still being looked up: its opening view is not put up in between. */
  openingPending: boolean;
  setScope: (kind: GraphScopeKind, lectureId?: string | null, page?: number | null) => void;
  select: (nodeId: string | null) => void;
  selectOutside: (nodeId: string) => void;
  /** The way back to the lecture: its full name ("Back to page 5") and its short form beside an arrow ("Page 5"). */
  back: { to: string; label: string; short: string } | null;
  /** The address of the explorer as it is now, for links that leave it. */
  here: string;
}

// ---- the scope switch and what the scope is ---------------------------------------------------------------------------------
/**
 * Which segments the scope switch holds, from the first paint on. Course and Lecture are always there, so the band
 * does not shift when the course's lectures arrive: Lecture is disabled until a lecture is known (while the course is
 * read, or for a course that lists none). This slide is there when a page is known, which the address says at once.
 */
export function scopeSegments(state: { lectureId: string | null; page: number | null; lecturesLoading: boolean }): Array<{ value: GraphScopeKind; label: string; disabled: boolean; why: string | null }> {
  return [
    { value: "course", label: CONCEPT_SCOPE_LABEL.course, disabled: false, why: null },
    { value: "lecture", label: CONCEPT_SCOPE_LABEL.lecture, disabled: !state.lectureId, why: state.lectureId ? null : state.lecturesLoading ? "Reading the course's lectures…" : "This course lists no lecture" },
    ...(state.page ? [{ value: "slide" as const, label: CONCEPT_SCOPE_LABEL.slide, disabled: !state.lectureId, why: null }] : []),
  ];
}
function ScopeSwitch({ state, className }: { state: ExplorerState; className?: string }) {
  const options = scopeSegments(state).map((option) => ({ value: option.value, label: option.label, disabled: option.disabled, title: option.why ?? undefined }));
  return <Segmented label="Scope of the concept map" value={state.scope.kind} onChange={(kind) => state.setScope(kind)} options={options} className={cn("flex-none flex-nowrap", className)} />;
}

function BackLink({ state, compact = false }: { state: ExplorerState; compact?: boolean }) {
  if (!state.back) return null;
  // One focused pane: the header already has an arrow back to the course, so this one says where it goes ("Page 5").
  return compact
    ? <Link to={state.back.to} aria-label={state.back.label} title={state.back.label} className="ll-tbtn flex-none whitespace-nowrap px-2"><ArrowLeft aria-hidden /><span>{state.back.short}</span></Link>
    : <Link to={state.back.to} className="ll-tbtn flex-none whitespace-nowrap"><ArrowLeft aria-hidden /><span>{state.back.label}</span></Link>;
}

/** The lecture as a picker (lecture scope), the identity line of the page (slide scope), or how many lectures the course has. */
function ScopeSubject({ state }: { state: ExplorerState }) {
  const course = useCourse(state.courseId);
  const lectures = course.data?.lectures ?? [];
  if (state.scope.kind === "course") return lectures.length ? <p className="min-w-0 text-ui text-muted">All {countLabel(lectures.length, "lecture")}</p> : null;
  if (state.scope.kind === "slide" && state.scope.page) {
    const label = state.lecture ? identityOf(state.lecture, state.scope.page).label : null;
    return <p className="ll-num line-clamp-2 min-w-0 text-ui leading-5" data-testid="concept-scope-identity">{label ?? `PDF page ${state.scope.page}`}</p>;
  }
  const title = lectures.find((entry) => entry.lecture_id === state.scope.lectureId)?.title ?? state.lecture?.title ?? "Lecture";
  if (lectures.length < 2) return <p className="line-clamp-2 min-w-0 text-ui leading-5">{title}</p>;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="ll-tbtn h-auto min-h-9 min-w-0 whitespace-normal py-0 text-left" aria-label={`Lecture: ${title}`}>
        <span className="line-clamp-2 min-w-0 leading-5">{title}</span><ChevronDown aria-hidden className="flex-none" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="ll-pop z-50 max-h-[min(70dvh,32rem)] min-w-[14rem] max-w-[min(92vw,26rem)] overflow-y-auto p-1">
          <DropdownMenu.RadioGroup value={state.scope.lectureId ?? ""} onValueChange={(id) => state.setScope("lecture", id, null)} aria-label="Lecture">
            {lectures.map((entry) => <DropdownMenu.RadioItem key={entry.lecture_id} value={entry.lecture_id} className="ll-menu-item">{entry.title}</DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** What an empty slide scope says (7.5): the page's role and the lecture scope, or the Brain's own note. Never an empty branch, never a warning. */
function EmptyScope({ state, note }: { state: ExplorerState; note: string | null }) {
  const { scope, lecture } = state;
  if (scope.kind !== "slide" || !scope.page || !scope.lectureId) return <p className="ll-measure text-read text-muted">{note ?? "Nothing in the course catalog falls in this scope."}</p>;
  const role = lecture?.slides.find((slide) => slide.page === scope.page)?.role?.value;
  const structural = lecture && isStructuralPage(lecture, scope.page) && role && STRUCTURAL_PAGE[role];
  const next = lecture ? nextContentPage(lecture, scope.page) : null;
  return (
    <div className="grid justify-items-start gap-2" data-testid="concept-scope-empty">
      <p className="ll-measure text-read text-muted">
        {structural ? `${identityOf(lecture, scope.page).label} is ${structural}. Concepts are listed for the lecture.` : note ?? "Nothing in the course record and no suggested link names this slide."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => state.setScope("lecture")}>Show this lecture</Button>
        {structural && next !== null && <Button size="sm" onClick={() => state.setScope("slide", scope.lectureId, next)}>{R2_ACTION.next_content}</Button>}
      </div>
    </div>
  );
}

/**
 * Lecture and slide scope: the questions of the selected concept or skill that the scope holds, read from the node's
 * own neighbourhood (a neighbour is drawn there only when it belongs to the scope). The detail lists the course's
 * questions and marks these. null when that cannot be said in full: in the course scope, for another kind of node,
 * for a neighbourhood cut by its limit, or when the questions found are not as many as the node's own count.
 */
export function questionsInScope(graph: ConceptGraphView | null | undefined, node: Pick<ConceptGraphNode, "id" | "kind" | "counts"> | null | undefined, scopeKind: GraphScopeKind): ReadonlySet<string> | null {
  if (scopeKind === "course" || !graph || !node || graph.focus !== node.id || (node.kind !== "concept" && node.kind !== "skill") || graph.truncated || (graph.dropped ?? 0) > 0) return null;
  const ids = new Set(graph.nodes.filter((entry) => entry.kind === "question" && entry.in_scope !== false).map((entry) => entry.id));
  return ids.size === node.counts?.questions ? ids : null;
}

// ---- zones -----------------------------------------------------------------------------------------------------------------
function OutlineZone({ state, heading, note, unknownScope, reveal, conceptCounts, ties }: { state: ExplorerState; heading: string | null; note: string | null; unknownScope: string | null; reveal: string[];
  conceptCounts: ReadonlyMap<string, number> | null; ties: ReadonlyMap<string, AnchorTieKind> | null }) {
  const frame = useWorkspaceFrame();
  const framed = frame.arrangement === "frame";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="concept-outline">
      {framed && <div className={cn(BAND_CLASS, "pl-4 pr-2")}><h2 className="text-ui font-semibold">Outline</h2></div>}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 pb-4 [scrollbar-width:thin] max-[1179px]:p-3">
        <div className={cn(!framed && "mx-auto w-full max-w-[640px]")}>
          {unknownScope ? (
            <div className="grid justify-items-start gap-2 p-2">
              <p className="ll-measure text-read text-muted">{unknownScope}</p>
              <Button size="sm" onClick={() => state.setScope("course")}>Show the course</Button>
            </div>
          ) : (
            <>
              {heading && <p className="ll-num px-2 pb-2 pt-1 text-ui text-muted" data-testid="outline-scope-count">{heading}</p>}
              <ConceptTree courseId={state.courseId} scope={state.scopeText} scopeKind={state.scope.kind} selected={state.selected} onSelect={(row: OutlineRow) => state.select(row.node_id)} place={state.place}
                conceptCounts={conceptCounts} ties={ties} reveal={reveal} openKinds={OPEN_BY_SCOPE[state.scope.kind]} label="Concept outline" testId="outline-tree"
                empty={<div className="p-2">{framed ? <p className="text-ui text-muted">Nothing is listed for this page. The map pane says why.</p> : <EmptyScope state={state} note={note} />}</div>} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StageZone({ state, scopeName, slideLabel, note, unknownScope, notice }: { state: ExplorerState; scopeName: string; slideLabel: string | null; note: string | null; unknownScope: string | null; notice: ReactNode }) {
  const frame = useWorkspaceFrame();
  const framed = frame.arrangement === "frame";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {framed && (
        <div className={cn(BAND_CLASS, "min-w-0 gap-2 pl-3 pr-2")} data-testid="concept-band">
          <IconButton label={frame.outlineOpen ? "Hide the outline" : "Show the outline"} aria-pressed={frame.outlineOpen} onClick={frame.toggleOutline} data-testid="outline-toggle" className="flex-none">
            {frame.outlineOpen ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
          </IconButton>
          <ScopeSwitch state={state} />
          <div className="flex min-w-0 flex-1 items-center pl-1"><ScopeSubject state={state} /></div>
          <BackLink state={state} />
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", framed ? "pb-1 pl-3 pt-3" : "px-3 pt-3")}>
        {unknownScope ? (
          <div className="grid justify-items-start gap-2">
            <p className="ll-measure text-read text-muted">{unknownScope}</p>
            <Button size="sm" onClick={() => state.setScope("course")}>Show the course</Button>
          </div>
        ) : (
          <ConceptMap courseId={state.courseId} scope={state.scopeText} scopeKind={state.scope.kind} selected={state.selected} onSelect={state.select} onSelectOutside={state.selectOutside} scopeName={scopeName}
            slideLabel={slideLabel} place={state.place} opening={state.openingPending} empty={<EmptyScope state={state} note={note} />} notice={notice} />
        )}
      </div>
    </div>
  );
}

function DetailZone({ state, counts, onTab }: { state: ExplorerState; counts: Record<DetailTabId, number | null>; onTab: (tab: DetailTabId) => void }) {
  const frame = useWorkspaceFrame();
  const framed = frame.arrangement === "frame";
  const focus = useFocusGraph(state.courseId, state.scopeText, state.selected);
  const graphNode = focus.data?.nodes.find((node) => node.id === state.selected) ?? null;
  const scopeQuestions = useMemo(() => questionsInScope(focus.data, graphNode, state.scope.kind), [focus.data, graphNode, state.scope.kind]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="concept-detail-zone">
      {framed && (
        <div className={cn(BAND_CLASS, "items-stretch pl-[calc(var(--ll-panel-pad,16px)-10px)] pr-3")}>
          {state.selected
            ? <TextTabs label="About the selected item" idPrefix="ll-concept-tab-" value={state.tab} onChange={(id) => isDetailTab(id) && onTab(id)}
                tabs={DETAIL_TABS.map((entry) => ({ id: entry.id, label: entry.label, count: counts[entry.id] ?? undefined, controls: "ll-concept-detail" }))} />
            : <span className="flex-1" />}
        </div>
      )}
      <div id="ll-concept-detail" role={framed && state.selected ? "tabpanel" : undefined} aria-labelledby={framed && state.selected ? `ll-concept-tab-${state.tab}` : undefined}
        className={cn("flex min-h-0 flex-1 flex-col", framed && "ll-region my-3 overflow-hidden")}>
        <ConceptDetail courseId={state.courseId} nodeId={state.selected} tab={state.tab} scope={state.scope} graphNode={graphNode} tie={state.scope.kind === "slide" && state.selected ? sourceTies(focus.data).get(state.selected) ?? null : null}
          scopeQuestions={scopeQuestions} place={state.place} returnTo={state.here} onClear={() => state.select(null)} framed={framed} />
      </div>
    </div>
  );
}

// ---- the explorer ----------------------------------------------------------------------------------------------------------
export function ConceptExplorer() {
  const { courseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const app = useApp();
  const scope = useMemo(() => parseScope(params.get("scope")), [params]);
  const scopeText = scopeParam(scope.kind, scope.lectureId, scope.page);
  const selected = params.get("node");
  const panel = params.get("panel");
  const state = location.state as { returnTo?: string; returnLabel?: string } | null;

  // The lecture and the page the learner came with stay offered while the scope is wider.
  const came = useMemo(() => lectureOfAddress(state?.returnTo), [state?.returnTo]);
  const [origin, setOrigin] = useState<{ lectureId: string | null; page: number | null }>(() => ({ lectureId: scope.lectureId ?? came?.lectureId ?? lastLecture(courseId), page: scope.page ?? (came && (!scope.lectureId || came.lectureId === scope.lectureId) ? came.page : null) }));
  useEffect(() => {
    setOrigin((current) => ({ lectureId: scope.lectureId ?? current.lectureId, page: scope.page ?? (scope.lectureId && scope.lectureId !== current.lectureId ? null : current.page) }));
  }, [scope.lectureId, scope.page]);
  const course = useCourse(courseId);
  const lectureId = scope.lectureId ?? origin.lectureId ?? course.data?.lectures[0]?.lecture_id ?? null;
  const page = scope.page ?? (lectureId === origin.lectureId ? origin.page : null);

  const [lastTab, setLastTab] = useState<DetailTabId>("sources");
  const tab: DetailTabId = isDetailTab(panel) ? panel : lastTab;
  const pane: ExplorerPane = isPane(panel) ? panel : "outline";

  const write = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true, state: location.state });
  }, [params, setParams, location.state]);
  const setScope = useCallback((kind: GraphScopeKind, toLecture?: string | null, toPage?: number | null) => {
    const value = scopeParam(kind, toLecture === undefined ? lectureId : toLecture, toPage === undefined ? page : toPage);
    write({ scope: value === "course" ? null : value });
  }, [write, lectureId, page]);
  const select = useCallback((nodeId: string | null) => write({ node: nodeId }), [write]);
  const selectOutside = useCallback((nodeId: string) => write({ scope: null, node: nodeId }), [write]);
  const showPane = useCallback((id: string) => {
    if (isDetailTab(id)) setLastTab(id);
    write({ panel: id });
  }, [write]);

  // ---- what the scope holds ------------------------------------------------------------------------------------------------
  const lectureQuery = useLecture(courseId, scope.kind === "course" ? undefined : scope.lectureId ?? undefined);
  const lecture = lectureQuery.data ?? null;
  const base = useScopeGraph(courseId, scopeText);
  const focus = useFocusGraph(courseId, scopeText, selected);
  const detail = useNodeDetail(courseId, selected);
  const counts = detailCounts(ownDetail(detail));

  // ---- the opening selection: "Concept map" opens on something drawn, with its detail beside it ---------------------------
  // Once for each scope that is entered without a selection: a lecture opens on its first topic (with three topics or
  // fewer the map draws all of them with their concepts, with more it draws that topic with its concepts), a slide of
  // three topics or fewer likewise; the course scope entered from a lecture opens on that lecture's first topic. The
  // course scope entered from Study keeps its topic cards. Written into the address like any selection, so Back, a
  // reload and a shared link show the same thing.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const scopeKey = `${courseId}|${scopeText}`;
  const undecided = openedFor !== scopeKey;
  const cameLecture = scope.kind === "course" && !selected && undecided ? came?.lectureId ?? null : null;
  const cameGraph = useScopeGraph(courseId, cameLecture ? scopeParam("lecture", cameLecture, null) : "course", !!cameLecture);
  const opening = scope.kind === "course"
    ? { ready: !cameLecture || !cameGraph.isLoading, node: cameLecture ? firstTopic(cameGraph.data) : null }
    : { ready: !base.isLoading, node: openingNode(base.data) };
  const focusNode = focus.data?.nodes.find((node) => node.id === selected) ?? null;
  useEffect(() => {
    if (!undecided) return;
    if (selected) {
      // Entered with a selection: decided once the scope is known to hold it (one it does not hold is cleared below, and the scope then opens).
      if ((focusNode && focusNode.in_scope !== false) || focus.isError) setOpenedFor(scopeKey);
      return;
    }
    if (!opening.ready) return;
    setOpenedFor(scopeKey);
    if (opening.node) write({ node: opening.node });
  }, [undecided, selected, focusNode, focus.isError, scopeKey, opening.ready, opening.node, write]);
  // The course scope entered from a lecture: until that lecture's topic is known the topic cards are not put up, only to be replaced.
  const openingPending = scope.kind === "course" && !selected && undecided && !!cameLecture && (!opening.ready || !!opening.node);
  const place = useMemo<TreePlace | null>(() => {
    if (scope.kind !== "slide" || !scope.page || !lecture) return null;
    const identity = identityOf(lecture, scope.page);
    return { page: scope.page, position: identity.position, groupPages: identity.groupPages };
  }, [scope.kind, scope.page, lecture]);

  // A selection that the new scope does not hold selects nothing; the scope then opens as if it had been entered without one.
  useEffect(() => {
    if (selected && focusNode && focusNode.in_scope === false) select(null);
  }, [selected, focusNode, select]);

  const unknownScope = base.isError && conceptGraphErrorCode(base.error) === "unknown_scope" ? `${base.error?.message ?? "This scope does not exist"}. The course scope lists everything.` : null;
  const totals = base.data?.totals ?? null;
  const emptySlide = scope.kind === "slide" && !!totals && totals.concept + totals.skill + totals.question + totals.topic === 0;
  const lectureTitle = course.data?.lectures.find((entry) => entry.lecture_id === scope.lectureId)?.title ?? lecture?.title ?? null;
  const heading = totals && base.data && !emptySlide ? conceptScopeHeading(base.data.scope, totals, lectureTitle) : null;
  // The course's name is in the workspace view Study already read: it is there before the course view arrives.
  const courseName = course.data?.display_name ?? app.workspace?.courses.find((entry) => entry.course_id === courseId)?.display_name ?? null;
  const scopeName = scope.kind === "slide" ? CONCEPT_SCOPE_LABEL.slide : scope.kind === "lecture" ? lectureTitle ?? "This lecture" : courseName ?? "This course";
  const slideLabel = scope.kind === "slide" && scope.page && lecture ? identityOf(lecture, scope.page).label : null;
  const conceptCounts = useMemo(() => topicConceptCounts(base.data), [base.data]);
  const reveal = useMemo(() => revealPath(focus.data), [focus.data]);
  // Slide scope: how each entry is tied to the slide, so a row can say that a suggested link is all there is.
  const ties = useMemo(() => (scope.kind === "slide" ? new Map([...sourceTies(base.data), ...sourceTies(focus.data)]) : null), [scope.kind, base.data, focus.data]);

  // The stale notice (9.9): the concept views against the lecture view in hand, and the focused view against the scope's own.
  const staleKeys = useMemo(() => [...new Set([
    ...(lecture ? isStale(base.data?.revisions, lecture.revisions, { shared: true }) : []),
    ...(lecture ? isStale(focus.data?.revisions, lecture.revisions, { shared: true }) : []),
    ...(focus.data && base.data ? isStale(focus.data.revisions, base.data.revisions) : []), // two reads of one scope: every key is compared
  ])], [base.data, focus.data, lecture]);
  const staleLine = staleViewLine(staleKeys, "view");
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["concept-graph", courseId] });
    void queryClient.invalidateQueries({ queryKey: ["outline", courseId] });
    void queryClient.invalidateQueries({ queryKey: ["outline-node", courseId] });
    if (scope.lectureId) void queryClient.invalidateQueries({ queryKey: ["lecture", courseId, scope.lectureId] });
  }, [queryClient, courseId, scope.lectureId]);
  const notice = staleLine ? <StaleNotice onRefresh={refresh} className="mb-3 flex-none">{staleLine}</StaleNotice> : null;

  const backTo = state?.returnTo ?? (lectureId && (came || scope.lectureId) ? `/courses/${courseId}/lectures/${lectureId}${page ? `?page=${page}` : ""}` : null);
  const backPage = lectureOfAddress(backTo)?.page ?? null;
  const explorer: ExplorerState = {
    courseId, scope, scopeText, selected, tab, lecture, place, lectureId, page, lecturesLoading: course.isLoading, openingPending, setScope, select, selectOutside,
    back: backTo ? { to: backTo, label: backPage ? `Back to page ${backPage}` : state?.returnLabel ?? "Back to the lecture", short: backPage ? nb(`Page ${backPage}`) : "Lecture" } : null,
    here: `${conceptMapHref(courseId, scopeText, selected)}`,
  };
  const note = base.data?.scope.note ?? null;
  const panes: FramePane[] = [
    { id: "outline", label: "Outline", zone: "outline" }, { id: "map", label: "Map", zone: "stage" },
    ...DETAIL_TABS.map((entry) => ({ id: entry.id, label: entry.label, zone: "context" as const, count: selected ? counts[entry.id] ?? undefined : undefined })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="concept-explorer" data-scope={scopeText}>
      <h1 className="sr-only">Concept map</h1>
      {/* One focused pane: the scope and the way back sit above the pane switch. From 1180 px they are in the map's band. */}
      <div className="flex flex-none items-center gap-2 border-b border-hairline bg-surface px-2 py-1.5 frame:hidden" data-testid="concept-scope-bar">
        <BackLink state={explorer} compact />
        <ScopeSwitch state={explorer} className="min-w-0 flex-1 min-[600px]:flex-none" />
      </div>
      <div className="min-h-0 flex-1">
        <WorkspaceFrame kind="concepts" testId="concept-frame" pane={pane} onPaneChange={showPane} paneSwitchLabel="Concept map pane"
          labels={{ outline: "Concept outline", stage: "Concept map", context: "Selected item" }} panes={panes}
          outline={<OutlineZone state={explorer} heading={heading} note={note} unknownScope={unknownScope} reveal={reveal} conceptCounts={conceptCounts} ties={ties} />}
          stage={<StageZone state={explorer} scopeName={scopeName} slideLabel={slideLabel} note={note} unknownScope={unknownScope} notice={notice} />}
          context={<DetailZone state={explorer} counts={counts} onTab={showPane} />} />
      </div>
    </div>
  );
}

/** The earlier address of the concept outline, kept as a way in. */
export function ConceptOutlineRedirect() {
  const { courseId = "" } = useParams();
  const location = useLocation();
  return <Navigate to={{ pathname: `/courses/${courseId}/concepts`, search: location.search }} state={location.state} replace />;
}
