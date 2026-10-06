// TanStack Query hooks: a cache of read projections and request receipts. It owns no academic record.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type Query, type QueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost, r2Paths, type ConceptGraphQuery } from "./api";
import { fetchServedIdentity, type ServedIdentity } from "./build";
import { getBrain } from "./device";
import { transport } from "./requests";
import { verifyResult, type ResultEnvelope, type VerifiedResult } from "./transport";
import type { QuestionBankView } from "./types";
import type { ActivityView, ConceptsView, CourseView, HistoryView, LectureView, ProgressView, QuestionView, ResumeState, ReviewView, SearchIndex, SettingsView, WorkspaceView } from "./types";
import type {
  ConceptGraphView, CourseTimingView, InferredAnchorsReadback, LectureTiming, SourceMapBlock, SourceMapDocument, SourceMapOverrideRequest, SuggestionDecision, SuggestionDecisionRequest,
  SuggestionDecisionResponse,
} from "./types";

const view = <T,>(key: unknown[], path: string, options: { enabled?: boolean; refetchInterval?: number | false } = {}): UseQueryResult<T, Error> =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useQuery<T, Error>({ queryKey: key, queryFn: ({ signal }) => apiGet<T>(path, signal), enabled: options.enabled ?? true, refetchInterval: options.refetchInterval ?? false, retry: false, staleTime: 5_000 });

export const useWorkspace = () => view<WorkspaceView>(["workspace"], "workspace", { refetchInterval: 20_000 });
export const useCourse = (courseId?: string) => view<CourseView>(["course", courseId], `courses/${courseId}`, { enabled: !!courseId });
export const useLecture = (courseId?: string, lectureId?: string, deck?: string | null) =>
  view<LectureView>(queryKeys.lecture(courseId, lectureId, deck), `courses/${courseId}/lectures/${lectureId}${deck ? `?deck=${encodeURIComponent(deck)}` : ""}`, { enabled: !!courseId && !!lectureId });

export interface QuestionBankFilter { collection?: string; lecture?: string; q?: string; origin?: string; anchor?: string }
export const QUESTION_PAGE = 25;
/** The question bank, one page at a time. Totals come from the Brain with every page; nothing is cut off silently. */
export function useQuestionBank(courseId: string | undefined, filter: QuestionBankFilter) {
  return useInfiniteQuery<QuestionBankView, Error>({
    queryKey: ["question-bank", courseId, filter],
    enabled: !!courseId,
    retry: false,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ offset: String(pageParam), limit: String(QUESTION_PAGE) });
      for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
      return apiGet<QuestionBankView>(`courses/${courseId}/questions?${query.toString()}`, signal);
    },
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
}
export const useQuestion = (courseId?: string, questionId?: string) => view<QuestionView>(["question", courseId, questionId], `courses/${courseId}/questions/${encodeURIComponent(questionId ?? "")}`, { enabled: !!courseId && !!questionId });
export const useConcepts = (courseId?: string) => view<ConceptsView>(["concepts", courseId], `courses/${courseId}/concepts`, { enabled: !!courseId });
export const useProgress = (courseId?: string) => view<ProgressView>(["progress", courseId], `courses/${courseId}/progress`, { enabled: !!courseId });
export const useHistory = (courseId?: string) => view<HistoryView>(["history", courseId], `courses/${courseId}/history`, { enabled: !!courseId });
export const useReview = (courseId?: string) => view<ReviewView>(["review", courseId], `courses/${courseId}/review`, { enabled: !!courseId });
export const useSearchIndex = (courseId?: string, enabled = true) => view<SearchIndex>(["search-index", courseId], `courses/${courseId}/search-index`, { enabled: !!courseId && enabled });
export const useResume = (courseId?: string) => view<ResumeState>(["resume", courseId], `courses/${courseId}/resume`, { enabled: !!courseId });
export const useActivity = (poll = true) => view<ActivityView>(["activity"], "activity", { refetchInterval: poll ? 3_000 : false });
export const useSettings = () => view<SettingsView>(["settings"], "settings");
export const useNotes = (courseId?: string) =>
  view<{ course_id: string; notes: Array<{ event_id: string; created_at: string; text: string; sources: Array<{ source_id: string; locator: { kind: string; page?: number } }> }>; note: string }>(["notes", courseId], `courses/${courseId}/notes`, { enabled: !!courseId });

// ---- Remediation amendment R2: the read routes of docs/engineering/r2-read-api.md -----------------------------------------
/** Cache keys of the R2 views (and of the lecture view they extend), so every screen reads and refreshes the same entries. */
export const queryKeys = {
  lecture: (courseId?: string, lectureId?: string, deck?: string | null): unknown[] => ["lecture", courseId, lectureId, deck ?? null],
  /** One entry per scope, focus, depth and limit of one course. */
  conceptGraph: (courseId: string | undefined, query: ConceptGraphQuery = {}): unknown[] => ["concept-graph", courseId, query.scope ?? "course", query.focus ?? null, query.depth ?? 1, query.limit ?? null],
  courseTiming: (courseId?: string): unknown[] => ["course-timing", courseId],
  inferredAnchors: (courseId?: string): unknown[] => ["inferred-anchors", courseId],
  sourceMap: (courseId?: string, lectureId?: string, deck?: string | null): unknown[] => ["source-map", courseId, lectureId, deck ?? null],
  servedIdentity: (): unknown[] => ["served-identity"],
};

/** Scope, focus, depth and limit of `useConceptGraph`, and whether the query runs. */
export interface ConceptGraphOptions extends ConceptGraphQuery {
  /** false keeps the request back (for example while the Concepts tab is closed). */
  enabled?: boolean;
}
/**
 * The concept graph of one scope: `course`, `lecture:<id>` or `slide:<lecture>:<page>` (api.conceptScope builds them).
 * Without `focus` it holds the scope's topics, concepts and skills; with `focus` that node's neighbourhood. An unknown
 * scope or focus is an error (r2.conceptGraphErrorCode tells which), shown as an explained state, never a blank panel.
 */
export const useConceptGraph = (courseId?: string, options: ConceptGraphOptions = {}) =>
  view<ConceptGraphView>(queryKeys.conceptGraph(courseId, options), r2Paths.conceptGraph(courseId ?? "", options), { enabled: !!courseId && (options.enabled ?? true) });
/** Per lecture and recording: stage, coverage, queue; the allowance of local transcription and the one resumable command. */
/** Stages, coverage and ranges per lecture. Pass `{ queue: false }` where no transcription queue is shown (Study, Library): that answer is much cheaper. */
export const useCourseTiming = (courseId?: string, options: { queue?: boolean } = {}) =>
  view<CourseTimingView>([...queryKeys.courseTiming(courseId), options.queue === false ? "lean" : "full"], r2Paths.courseTiming(courseId ?? "", options), { enabled: !!courseId });
/** Readback of the suggested question links of a course: counts and ids only. */
export const useInferredAnchors = (courseId?: string) => view<InferredAnchorsReadback>(queryKeys.inferredAnchors(courseId), r2Paths.inferredAnchors(courseId ?? ""), { enabled: !!courseId });
/** The source map of the lecture's displayed deck (or of `deck`): the lecture view's `source_map` object, every page's identity and role, the history of corrections and the full stored map. */
export const useSourceMap = (courseId?: string, lectureId?: string, deck?: string | null) =>
  view<SourceMapDocument>(queryKeys.sourceMap(courseId, lectureId, deck), r2Paths.sourceMap(courseId ?? "", lectureId ?? "", deck), { enabled: !!courseId && !!lectureId });
/** What the Brain says it is serving (`GET /api/health` → `build`); null from an older process that states no identity. */
export const useServedIdentity = (poll = false): UseQueryResult<ServedIdentity | null, Error> =>
  useQuery<ServedIdentity | null, Error>({ queryKey: queryKeys.servedIdentity(), queryFn: ({ signal }) => fetchServedIdentity(signal), retry: false, staleTime: 5_000, refetchInterval: poll ? 60_000 : false });

/** One cache filter: every entry under `queryKey` that the predicate (when given) accepts. */
export interface Invalidation { queryKey: unknown[]; predicate?: (query: Query) => boolean }
/** Concept views of one course whose scope holds the lecture: the course scope, that lecture's scope and its slide scopes. */
const scopeHoldsLecture = (lectureId: string) => (query: Query): boolean => {
  const scope = query.queryKey[2];
  return scope === "course" || scope === `lecture:${lectureId}` || (typeof scope === "string" && scope.startsWith(`slide:${lectureId}:`));
};
/**
 * The views each change of app-private state alters, as data (interface-contracts R2, "Revisions and invalidation":
 * a changed build group or anchor invalidates the Slide and Lecture views of that lecture and the Course view's
 * entries for it, and nothing else). The three mutations below apply them; nothing else is refetched.
 */
export const invalidatedBy = {
  /** A decision on a suggested link: the tie may sit on any lecture's deck, so the course's lecture views, its concept views and the readback. */
  suggestionDecision: (courseId: string): Invalidation[] => [
    { queryKey: ["lecture", courseId] }, { queryKey: ["concept-graph", courseId] }, { queryKey: ["outline", courseId] }, { queryKey: ["outline-node", courseId] }, { queryKey: ["inferred-anchors", courseId] },
  ],
  /** A correction of grouping, role, number or regions: this lecture (identity, ties' places, ranges go stale), its stored map, concept views that hold it, course timing, and the map revision in the served identity. */
  sourceMapOverride: (courseId: string, lectureId: string): Invalidation[] => [
    { queryKey: ["lecture", courseId, lectureId] }, { queryKey: ["source-map", courseId, lectureId] },
    { queryKey: ["concept-graph", courseId], predicate: scopeHoldsLecture(lectureId) }, { queryKey: ["outline", courseId], predicate: scopeHoldsLecture(lectureId) }, { queryKey: ["outline-node", courseId] },
    { queryKey: ["course-timing", courseId] }, { queryKey: ["served-identity"] },
  ],
  /** A rebuild of the derived timing links: this lecture's ranges and timing, and the course timing view. */
  timingBuild: (courseId: string, lectureId: string): Invalidation[] => [{ queryKey: ["lecture", courseId, lectureId] }, { queryKey: ["course-timing", courseId] }],
};
/** Invalidates every query an `invalidatedBy` entry lists (used by the three R2 mutations). */
export async function applyInvalidations(client: QueryClient, filters: Invalidation[]): Promise<void> {
  await Promise.all(filters.map((filter) => client.invalidateQueries(filter)));
}
const need = (value: string | undefined, what: string): string => {
  if (!value) throw new Error(`No ${what} is selected.`);
  return value;
};

/** What `useSuggestionDecision` is called with: the suggested link and the learner's decision on it. */
export interface SuggestionDecisionInput {
  suggestionId: string;
  /** "confirmed" (Accept), "rejected" (Reject) or "cleared" (take the decision back). */
  decision: SuggestionDecision;
  /** The revision this decision is made against; a different one in force answers 409. */
  expectedRevision?: number;
}
/**
 * Accept, reject or clear a suggested question link. It is the learner's own local, versioned record: it outranks the
 * suggestions file and survives its regeneration; nothing is written to the course. A conflict (409) refreshes the same
 * views, so the decision in force is what is shown.
 */
export function useSuggestionDecision(courseId?: string): UseMutationResult<SuggestionDecisionResponse, Error, SuggestionDecisionInput> {
  const client = useQueryClient();
  return useMutation<SuggestionDecisionResponse, Error, SuggestionDecisionInput>({
    mutationFn: async ({ suggestionId, decision, expectedRevision }) => {
      const body: SuggestionDecisionRequest = expectedRevision === undefined ? { decision } : { decision, expected_revision: expectedRevision };
      return apiPost<SuggestionDecisionResponse>(r2Paths.suggestionDecision(need(courseId, "course"), suggestionId), body);
    },
    onSuccess: async (answer) => {
      if (courseId && answer.status !== "unchanged") await applyInvalidations(client, invalidatedBy.suggestionDecision(courseId));
    },
    onError: async (error) => {
      if (courseId && error instanceof ApiError && error.status === 409) await applyInvalidations(client, invalidatedBy.suggestionDecision(courseId));
    },
  });
}
/**
 * Record one correction of the source map (group, split, split before, role, printed number, regions, revert) as a new
 * immutable revision; answers the new `source_map` block. A refusal is an ApiError whose `code` is the source map's own
 * (422 `invalid_override`; 409 `learner_correction_in_force`, `override_conflict`, …) and changes nothing.
 */
export function useSourceMapOverride(courseId?: string, lectureId?: string, deck?: string | null): UseMutationResult<SourceMapBlock, Error, SourceMapOverrideRequest> {
  const client = useQueryClient();
  return useMutation<SourceMapBlock, Error, SourceMapOverrideRequest>({
    mutationFn: async (body) => apiPost<SourceMapBlock>(r2Paths.sourceMapOverrides(need(courseId, "course"), need(lectureId, "lecture"), deck), body),
    onSuccess: async () => {
      if (courseId && lectureId) await applyInvalidations(client, invalidatedBy.sourceMapOverride(courseId, lectureId));
    },
  });
}
/** Rebuild the lecture's derived timing links from the current inputs (app-private file only; reviewed and manual links are never touched); answers the lecture's `timing` object. */
export function useTimingBuild(courseId?: string, lectureId?: string): UseMutationResult<LectureTiming, Error, void> {
  const client = useQueryClient();
  return useMutation<LectureTiming, Error, void>({
    mutationFn: async () => apiPost<LectureTiming>(r2Paths.timingBuild(need(courseId, "course"), need(lectureId, "lecture"))),
    onSuccess: async () => {
      if (courseId && lectureId) await applyInvalidations(client, invalidatedBy.timingBuild(courseId, lectureId));
    },
  });
}

export interface RequestStatus {
  envelope: ResultEnvelope;
  verified: VerifiedResult | null;
  verificationError: string | null;
}

const SETTLED = new Set(["SUCCEEDED", "FAILED_FINAL", "CANCELLED", "SUPERSEDED", "WAITING_USER", "WAITING_REVIEW", "AUTH_REQUIRED", "QUOTA_WAIT", "UNCERTAIN_COMPLETION", "WAITING_SOURCE"]);

/** Poll one request until it settles. A result is shown only after its signature and file digests verify. */
export function useRequestStatus(courseId?: string, requestId?: string | null): UseQueryResult<RequestStatus, Error> {
  return useQuery<RequestStatus, Error>({
    queryKey: ["request", courseId, requestId],
    enabled: !!courseId && !!requestId,
    retry: false,
    queryFn: async () => {
      const envelope = await transport.getResult(courseId!, requestId!);
      const brain = await getBrain();
      if (!envelope.result) return { envelope, verified: null, verificationError: null };
      if (!brain) return { envelope, verified: null, verificationError: "This device has no paired Brain key, so the result cannot be verified." };
      try {
        return { envelope, verified: await verifyResult(envelope, brain, courseId!), verificationError: null };
      } catch (error) {
        return { envelope, verified: null, verificationError: (error as Error).message };
      }
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1_000;
      const state = data.envelope.job?.state;
      if (data.verified && state && SETTLED.has(state)) return false;
      if (state && SETTLED.has(state) && !data.envelope.result && state !== "SUCCEEDED") return 5_000;
      return 1_000;
    },
  });
}
