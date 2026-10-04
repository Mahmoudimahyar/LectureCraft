// Submission actions shared by the tutor panel, practice, review and activity screens.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { apiPost } from "@/lib/api";
import { newId } from "@/lib/bundle";
import { listLocalRequests, type DraftContext, type LocalRequest, type SourceRef } from "@/lib/db";
import { askPayload, controlPayload, stableIds, submissionPayload, submit, type Conditions, type SubmitOutcome } from "@/lib/requests";
import type { BundleFile } from "@/lib/bundle";
import type { Artifact, QuestionRecord } from "@/lib/types";

export const useLocalRequests = (courseId?: string) =>
  useQuery<LocalRequest[]>({ queryKey: ["local-requests", courseId], queryFn: () => listLocalRequests(courseId), enabled: !!courseId, staleTime: 0 });

export interface AskInput {
  courseId: string;
  text: string;
  depth: "quick" | "standard" | "deep";
  sources: SourceRef[];
  context: DraftContext;
  parentRequestId?: string | null;
  draftKey: string;
}

export interface AnswerInput {
  courseId: string;
  text: string;
  action: "explain" | "practice" | "review_answer" | "diagnose";
  question: QuestionRecord;
  conditions: Conditions;
  context: DraftContext;
  parentRequestId?: string | null;
  draftKey: string;
  transcriptionRevision?: string | null;
}

const INTERACTION = { explain: "explain_back", practice: "practice", review_answer: "review_answer", diagnose: "diagnostic_answer" } as const;

export function useSubmitActions() {
  const app = useApp();
  const queryClient = useQueryClient();
  const bindingRevision = app.workspace?.binding_revision ?? "";

  const after = useCallback(async (courseId: string, outcome: SubmitOutcome) => {
    await queryClient.invalidateQueries({ queryKey: ["local-requests", courseId] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    app.announce(outcome.delivery === "uploaded" ? "Sent. Waiting for the Brain to receive it." : outcome.delivery === "retained_locally" ? "Kept on this device; it will be sent when the Brain is reachable." : "Not sent and not stored. Copy your text.");
    return outcome;
  }, [queryClient, app]);

  const ask = useCallback(async (input: AskInput) => {
    const ids = await stableIds(`ask:${input.depth}`, input.draftKey, input.text);
    const outcome = await submit({ courseId: input.courseId, bindingRevision, action: "ask", depth: input.depth, requestId: ids.requestId, logicalInputId: ids.logicalInputId,
      payload: askPayload(input.courseId, ids.requestId, input.text, input.sources), parentRequestId: input.parentRequestId, label: input.context.label, context: input.context, text: input.text });
    return after(input.courseId, outcome);
  }, [bindingRevision, after]);

  const answer = useCallback(async (input: AnswerInput) => {
    const ids = await stableIds(input.action, input.draftKey, input.text);
    const payload = submissionPayload({ courseId: input.courseId, requestId: ids.requestId, logicalInputId: ids.logicalInputId, question: input.question, text: input.text,
      interaction: INTERACTION[input.action], conditions: input.conditions, transcriptionRevision: input.transcriptionRevision });
    const outcome = await submit({ courseId: input.courseId, bindingRevision, action: input.action, depth: "standard", requestId: ids.requestId, logicalInputId: ids.logicalInputId, payload,
      parentRequestId: input.parentRequestId, label: input.context.label, context: input.context, text: input.text });
    return after(input.courseId, outcome);
  }, [bindingRevision, after]);

  const control = useCallback(async (courseId: string, action: "cancel" | "save_note" | "correct_assessment" | "source_hint", command: Record<string, unknown>, meta: { label: string; text: string; context?: DraftContext; attachments?: BundleFile[] }) => {
    const requestId = newId("req");
    const outcome = await submit({ courseId, bindingRevision, action, depth: "standard", requestId, logicalInputId: `input-${requestId}`, payload: controlPayload(courseId, requestId, { kind: action, ...command }),
      label: meta.label, context: meta.context ?? { label: meta.label }, text: meta.text, attachments: meta.attachments });
    return after(courseId, outcome);
  }, [bindingRevision, after]);

  const record = useCallback(async (courseId: string, action: "correct_source" | "select_review" | "edit_review" | "resume", payload: Record<string, unknown>, meta: { label: string; text: string; context?: DraftContext; attachments?: BundleFile[] }) => {
    const requestId = newId("req");
    const outcome = await submit({ courseId, bindingRevision, action, depth: "standard", requestId, logicalInputId: `input-${requestId}`, payload, label: meta.label, context: meta.context ?? { label: meta.label },
      text: meta.text, attachments: meta.attachments });
    return after(courseId, outcome);
  }, [bindingRevision, after]);

  const cancel = useCallback((courseId: string, targetRequestId: string) =>
    control(courseId, "cancel", { target_request_id: targetRequestId, reason: "Cancelled by the learner" }, { label: "Cancel request", text: `Cancel ${targetRequestId}` }), [control]);

  const dispute = useCallback((courseId: string, attempt: { record_id: string; artifact: Artifact }, reason: string) =>
    control(courseId, "correct_assessment", { attempt, reason, support: [] }, { label: "Dispute of an assessment", text: reason }), [control]);

  const reconcile = useCallback(async (requestId: string) => {
    const result = await apiPost<{ state: string }>(`activity/${encodeURIComponent(requestId)}/reconcile`);
    void queryClient.invalidateQueries();
    return result;
  }, [queryClient]);

  const retry = useCallback(async (requestId: string) => {
    const result = await apiPost<{ state: string; note: string }>(`activity/${encodeURIComponent(requestId)}/retry`);
    void queryClient.invalidateQueries();
    return result;
  }, [queryClient]);

  return { ask, answer, control, record, cancel, dispute, reconcile, retry, bindingRevision };
}
