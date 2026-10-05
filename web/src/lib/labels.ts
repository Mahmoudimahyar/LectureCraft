// User-facing wording for source, session and preparation states. Each state keeps its own label:
// missing, empty, unregistered, unrecorded and inaccessible are never merged into one "unavailable".
import type { Tone } from "@/components/ui";

export const SOURCE_STATE: Record<string, { label: string; tone: Tone; detail: string }> = {
  registered_readable: { label: "Available", tone: "success", detail: "Registered by the course updater and readable." },
  present_unindexed: { label: "Present, not registered", tone: "neutral", detail: "The file is in the course folder but the course updater has not registered it. It can still be opened here." },
  present_unindexed_empty: { label: "Empty file", tone: "caution", detail: "The file exists but has zero bytes." },
  registered_empty: { label: "Empty file", tone: "caution", detail: "Registered, but the file has zero bytes. Nothing can be shown from it." },
  registered_unavailable: { label: "Not supplied yet", tone: "unassessed", detail: "The course lists this source but no file has been supplied." },
  registered_missing_on_disk: { label: "Inaccessible", tone: "danger", detail: "Registered, but the file is not at its recorded location on this PC." },
  registered_path_outside_course: { label: "Outside the course folder", tone: "danger", detail: "The course index points this source at a location outside the course folder. It is listed but never opened from there." },
  registered_unreadable: { label: "Unreadable", tone: "danger", detail: "Registered, but it could not be read." },
};

export const SESSION_STATE: Record<string, { label: string; tone: Tone }> = {
  transcript_and_recording: { label: "Recording and transcript", tone: "success" },
  transcript_only_no_recording: { label: "Transcript only — no recording file", tone: "neutral" },
  recording_only_no_transcript: { label: "Recording only — no transcript", tone: "neutral" },
  empty_unrecorded: { label: "Nothing recorded for this session", tone: "unassessed" },
  other_material_only: { label: "Other material only", tone: "neutral" },
};

export function dispositionLabel(disposition: string): { label: string; tone: Tone; detail: string | null } {
  const [kind, ...rest] = disposition.split(":");
  const detail = rest.join(":").trim() || null;
  switch (kind) {
    case "links_reviewed":
      return { label: "Slide links reviewed", tone: "success", detail };
    case "links_pending_review":
      return { label: "Suggested links to review", tone: "caution", detail };
    case "slides_ready_no_alignment":
      return { label: "Slides ready — no recording linked", tone: "neutral", detail };
    case "not_processed":
      return { label: "Not prepared yet", tone: "unassessed", detail: "Preparation has not run for this lecture. The slides can still be opened if a PDF exists." };
    case "blocked":
      return { label: "Needs setup", tone: "caution", detail };
    case "no_source":
      return { label: "No usable slides", tone: "unassessed", detail };
    default:
      return { label: disposition, tone: "neutral", detail };
  }
}

export const KIND_LABEL: Record<string, string> = {
  lecture_slides: "Slides", lecture_transcript: "Transcript", lecture_recording: "Recording", assignment_brief: "Problem set", assignment_solution: "Solutions (restricted)",
  textbook: "Textbook", practice_set: "Practice set", assessment: "Assessment", syllabus: "Syllabus", course_admin: "Course admin", material: "Material",
};
export const kindLabel = (kind: string | null | undefined): string => (kind ? (KIND_LABEL[kind] ?? kind.replace(/_/g, " ")) : "Source");

export const REVIEW_STATE: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: "Reviewed link", tone: "success" },
  suggested: { label: "Suggested link (not reviewed)", tone: "caution" },
  rejected: { label: "Rejected link", tone: "danger" },
};

export const JOB_STATE: Record<string, { label: string; tone: Tone }> = {
  READY: { label: "Queued", tone: "neutral" }, CLAIMED: { label: "Queued", tone: "neutral" }, RUNNING: { label: "Running", tone: "accent" }, STAGED: { label: "Answer staged", tone: "accent" },
  COMMIT_PENDING: { label: "Saving to course", tone: "accent" }, SUCCEEDED: { label: "Completed", tone: "success" }, WAITING_SYNC: { label: "Waiting for an earlier request", tone: "neutral" },
  WAITING_SOURCE: { label: "Waiting for a source", tone: "caution" }, WAITING_USER: { label: "Waiting for you", tone: "caution" }, WAITING_REVIEW: { label: "Assessment pending", tone: "caution" },
  QUOTA_WAIT: { label: "Quota wait", tone: "caution" }, AUTH_REQUIRED: { label: "Connection not verified", tone: "caution" }, FAILED_RETRYABLE: { label: "Retry scheduled", tone: "caution" },
  FAILED_FINAL: { label: "Failed", tone: "danger" }, UNCERTAIN_COMPLETION: { label: "Completion unknown", tone: "caution" }, CANCELLED: { label: "Cancelled", tone: "unassessed" },
  SUPERSEDED: { label: "Superseded", tone: "unassessed" },
};

export const ASSISTANCE_LABEL: Record<string, string> = {
  none: "no help recorded", hint: "after a hint", formula_provided: "formula provided", worked_example: "after a worked example", solution_shown: "solution shown", mixed: "mixed help", unknown: "help unknown",
  none_reported: "no help reported", formula: "formula provided", worked_solution: "solution shown",
};
export const REFERENCE_LABEL: Record<string, string> = { none: "no references", notes: "notes/sources open", tools: "tools used", mixed: "mixed references", unknown: "references unknown", none_reported: "no references reported", sources: "sources open" };
export const TIME_BASIS_LABEL: Record<string, string> = {
  recorded_now: "recorded when it happened", historical_exact: "exact time recorded later", historical_approximate: "approximate time", unknown: "time of the response not known",
};
export const RELATION_LABEL: Record<string, string> = {
  strict_containment: "is fully contained in", partial_overlap: "partly overlaps with", diagnostic_prerequisite: "is a diagnostic step for", topic_includes_concept: "topic includes concept",
  topic_includes_skill: "topic includes skill", concept_assessed_as_skill: "concept is assessed as skill", skill_practiced_by_family: "skill is practised by question family",
  family_instance: "question family has question", shared_related: "related across courses (reviewed)", shared_equivalent: "equivalent across courses (reviewed)",
};
export const NODE_TYPE_LABEL: Record<string, string> = { topic: "Topic", concept: "Concept", skill: "Skill", question_family: "Question family", question: "Question", shared_concept: "Shared concept" };

/** Skill status: a demonstration always says under which recorded condition it was given (R1-F1). */
export const SKILL_STATUS: Record<string, { label: string; tone: Tone }> = {
  not_assessed: { label: "Not assessed", tone: "unassessed" },
  not_observed_only: { label: "Not observed yet", tone: "unassessed" },
  current_gap: { label: "Gap seen in latest response", tone: "caution" },
  uncertain: { label: "Latest assessment uncertain", tone: "unassessed" },
  demonstrated_unaided: { label: "Demonstrated unaided", tone: "success" },
  demonstrated_assisted: { label: "Demonstrated with assistance", tone: "neutral" },
  demonstrated_after_exposure: { label: "Demonstrated on a question seen before", tone: "neutral" },
  demonstrated_conditions_unknown: { label: "Demonstrated; conditions not recorded", tone: "unassessed" },
};
export const CONDITION_LABEL: Record<string, string> = { unaided: "unaided", assisted: "with assistance", prior_exposure: "after prior exposure", conditions_unknown: "conditions not recorded" };
export const FACET_LABEL: Record<string, string> = {
  recall: "Recall", conceptual_explanation: "Conceptual explanation", formulation_method_choice: "Formulation and method choice", algebra_numerical_execution: "Algebra and numerical execution",
  coding_execution: "Coding and execution", interpretation: "Interpretation", transfer: "Transfer", combined: "Combined target (not separately observed)", unclassified: "Unclassified",
};
