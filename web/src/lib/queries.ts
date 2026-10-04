// TanStack Query hooks: a cache of read projections and request receipts. It owns no academic record.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGet } from "./api";
import { getBrain } from "./device";
import { transport } from "./requests";
import { verifyResult, type ResultEnvelope, type VerifiedResult } from "./transport";
import type { ActivityView, ConceptsView, CourseView, HistoryView, LectureView, ProgressView, QuestionView, ResumeState, ReviewView, SearchIndex, SettingsView, WorkspaceView } from "./types";

const view = <T,>(key: unknown[], path: string, options: { enabled?: boolean; refetchInterval?: number | false } = {}): UseQueryResult<T, Error> =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useQuery<T, Error>({ queryKey: key, queryFn: ({ signal }) => apiGet<T>(path, signal), enabled: options.enabled ?? true, refetchInterval: options.refetchInterval ?? false, retry: false, staleTime: 5_000 });

export const useWorkspace = () => view<WorkspaceView>(["workspace"], "workspace", { refetchInterval: 20_000 });
export const useCourse = (courseId?: string) => view<CourseView>(["course", courseId], `courses/${courseId}`, { enabled: !!courseId });
export const useLecture = (courseId?: string, lectureId?: string) => view<LectureView>(["lecture", courseId, lectureId], `courses/${courseId}/lectures/${lectureId}`, { enabled: !!courseId && !!lectureId });
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
