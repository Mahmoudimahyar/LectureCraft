// User-facing wording for source, session and preparation states. Each state keeps its own label:
// missing, empty, unregistered, unrecorded and inaccessible are never merged into one "unavailable".
import type { Tone } from "@/components/ui";
import type {
  AssociationCause, AssociationNotRunReason, AssociationState, AudioUnprocessedReason, CatalogField, ConceptGraphEdge, ConceptGraphNode, ConceptGraphRevisions, ConceptGraphScope, EstablishedState,
  EvidenceObject, EvidenceState, EvidenceSummary, GraphEdgeFamily, GraphNodeKind, GraphScopeKind, GroupPositionKind, GroupingBasis, InferredFileState, LearnerDecision, LogicalSlideGrouping, LogicalSlideKind,
  MethodRef, NoLink, NoLinkReason, NoLinkState, NoRange, NoRangeState, PptxMatch, PriorExposure, QualityName, RangeOrigin, RangeRelation, RangeSupportScope, RecordingUnavailableReason, RelatedConceptBasis,
  RelatedQuestion, RoleState, SectionTieDetail, SlidePosition, SlideRole, SlideRoleValue, SourceMapUnavailableReason, SuggestedTieFields, SuggestionCoverage, SuggestionState, SuggestionVerdict,
  TextAlignmentState, TieCriterion, TieKind, TieWhere, TimingGenerated, TimingRange, TimingStage, TimingSummary, TimingTextAlignment, ViewRevisions,
} from "./types";

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
  // R2: the relations of the concept graph's assessment and source edges (open wording)
  question_has_criterion: "question has criterion", criterion_assesses_concept: "criterion assesses concept", criterion_assesses_skill: "criterion assesses skill",
  slide_supports: "supported on this slide", slide_supports_by_assessment: "supported on this slide, through a criterion that assesses it",
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

// =====================================================================================================================
// Remediation amendment R2 — wording. The words are those of docs/project/ui-state-and-interaction-contract.md, section
// "Remediation amendment R2" (and the R2 notes of the feature packets' ui-flow.md it refers to). Every map is a
// Record over its union, so a member without wording does not compile. Where the contract leaves a wording open the
// comment says "open wording": those words are this file's choice and are listed in the stream's report.
// =====================================================================================================================

// ---- short references whose parts must stay on one line (re-exported by ./r2) ---------------------------------------------
export const NBSP = " ";
const EN_DASH = "–";

/** Runs of consecutive pages, in order, each page once: [22, 23, 24, 31] → [[22, 24], [31, 31]]. */
export function pageRuns(pages: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(pages.filter((page) => Number.isInteger(page)))].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const page of sorted) {
    const last = runs[runs.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  return runs;
}
const runsText = (runs: ReadonlyArray<readonly [number, number]>): string => runs.map(([first, last]) => (first === last ? String(first) : `${first}${EN_DASH}${last}`)).join(", ");
/** "p. 12" */
export const pageRef = (page: number): string => `p.${NBSP}${page}`;
/** "p. 12", "pp. 22–24", "pp. 7, 9–14"; "" for no page. */
export function pagesRef(pages: readonly number[]): string {
  const runs = pageRuns(pages);
  if (runs.length === 0) return "";
  const [first] = runs;
  return runs.length === 1 && first && first[0] === first[1] ? pageRef(first[0]) : `pp.${NBSP}${runsText(runs)}`;
}
/** "1 h 20 min", "2 min 44 s", "55 s": whole seconds, each number tied to its unit. */
export function durationLabel(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = hours ? [`${hours}${NBSP}h`, ...(minutes ? [`${minutes}${NBSP}min`] : [])] : minutes ? [`${minutes}${NBSP}min`, ...(seconds ? [`${seconds}${NBSP}s`] : [])] : [`${seconds}${NBSP}s`];
  return parts.join(NBSP);
}
/** "Range 1 of 2" */
export const rangeOrdinalLabel = (index: number, total: number): string => ["Range", index, "of", total].join(NBSP);
/** "17:52", "1:08:20" */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
/** "17:52 – 20:36" */
export const timeSpanLabel = (startMs: number, endMs: number): string => `${clockLabel(startMs)}${NBSP}${EN_DASH}${NBSP}${clockLabel(endMs)}`;
const words = (value: string): string => value.replace(/_/g, " ");
/** One fact held on one line: every space of it becomes a non-breaking space, so a line breaks only between facts (design spec 9.11). */
export const nb = (text: string): string => text.replace(/ /g, NBSP);
/** A value this build has no words for, shown as recorded with its underscores as spaces; never mapped to the nearest known label (design spec 9.1). */
export const unlistedLabel = (value: string): string => words(value);
/** "1 question", "18 questions": the number tied to its noun. */
export const countLabel = (count: number, singular: string, plural: string = `${singular}s`): string => `${count}${NBSP}${count === 1 ? singular : plural}`;
/** "transcript lines 120–164", "transcript line 40"; several ranges after commas; "" for none. Lines are never worded as pages. */
export function transcriptLinesRef(lines: ReadonlyArray<readonly [number, number]>): string {
  const runs = lines.filter(([first, last]) => Number.isInteger(first) && Number.isInteger(last) && first <= last);
  const [head, ...rest] = runs.map(([first, last]) => (first === last ? String(first) : `${first}${EN_DASH}${last}`));
  if (head === undefined) return "";
  const one = runs.length === 1 && runs[0]![0] === runs[0]![1];
  return [nb(`transcript ${one ? "line" : "lines"} ${head}`), ...rest].join(", ");
}
const sentenceCase = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const listed = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// ---- workspace: tabs, lists, scopes, actions ------------------------------------------------------------------------------
export type ContextTabId = "tutor" | "questions" | "concepts" | "transcript" | "sources";
/** One panel, five text-labelled tabs in this order. */
export const CONTEXT_TABS: ReadonlyArray<{ id: ContextTabId; label: string }> = [
  { id: "tutor", label: "Tutor" }, { id: "questions", label: "Questions" }, { id: "concepts", label: "Concepts" }, { id: "transcript", label: "Transcript" }, { id: "sources", label: "Sources" },
];
/** Narrow screens: one focused pane at a time. */
export type PaneId = "slide" | ContextTabId;
/** The names of the six panes of a narrow screen (the UI contract's list). */
export const PANE_LABEL: Record<PaneId, string> = { slide: "Slide", tutor: "Tutor", questions: "Questions", concepts: "Concepts", transcript: "Transcript", sources: "Sources" };
/** The three lists of the Questions tab. */
export type QuestionListId = "this_slide" | "related_concepts" | "all_lecture";
/** The three lists of the Questions tab; each heading carries its count. */
export const QUESTION_LIST_LABEL: Record<QuestionListId, string> = { this_slide: "This slide", related_concepts: "Related concepts", all_lecture: "All lecture questions" };
/** One scope control: Course · Lecture · This slide. */
export const CONCEPT_SCOPE_LABEL: Record<GraphScopeKind, string> = { course: "Course", lecture: "Lecture", slide: "This slide" };
/** The R2 actions that carry a visible name. */
export type R2ActionId = "next_content" | "open_whole_recording" | "show_candidates" | "repeat" | "whole_recording" | "accept" | "reject" | "take_back" | "show_it" | "refresh" | "reload" | "concept_map";
/** The visible names of the R2 actions. "Take back" clears a decision on a suggested link; "Show it" opens the link the learner rejected. */
export const R2_ACTION: Record<R2ActionId, string> = {
  next_content: "Next content", open_whole_recording: "Open whole recording", show_candidates: "Show candidates", repeat: "Repeat", whole_recording: "Whole recording",
  accept: "Accept", reject: "Reject", take_back: "Take back", show_it: "Show it", refresh: "Refresh", reload: "Reload", concept_map: "Concept map",
};
/** The one muted line under Accept and Reject. */
export const DECISION_NOTE = "Your decision is kept on this device and survives new suggestions.";

// ---- recording ranges -----------------------------------------------------------------------------------------------------
export type NoRangeActionId = Extract<R2ActionId, "open_whole_recording" | "show_candidates" | "next_content">;
/** When there is no range, exactly one of six lines is shown, each with at most one action and each produced by its own cause. */
export const NO_RANGE_LINE: Record<NoRangeState, { label: string; meaning: string; action: NoRangeActionId | null }> = {
  not_discussed: { label: "Not discussed (searched)", meaning: "the whole recording was processed and matched, and no talk about this slide was found", action: "open_whole_recording" },
  audio_unprocessed: { label: "Audio not processed yet", meaning: "this recording has no timing yet; or only the stated part of it has, and nothing for this slide was found in that part", action: "open_whole_recording" },
  association_not_run: { label: "Not matched yet", meaning: "the recording has timing, but slide matching has not run on it with the current inputs; the cause is stated", action: "open_whole_recording" },
  ambiguous: { label: "Ambiguous", meaning: "several candidates, none good enough to show as the range", action: "show_candidates" },
  recording_unavailable: { label: "Recording unavailable", meaning: "no recording exists or it cannot be read", action: null },
  no_range_expected: { label: "Structural page", meaning: "no recording range is expected for a title, section, administrative or blank page, and none was found", action: "next_content" },
};
/** The one action of a no-range line, or null when the line offers none (the reason is stated instead). */
export function noRangeAction(state: NoRangeState): { id: NoRangeActionId; label: string } | null {
  const id = NO_RANGE_LINE[state].action;
  return id ? { id, label: R2_ACTION[id] } : null;
}
/** The stated cause of "Not matched yet". */
export const ASSOCIATION_CAUSE_LABEL: Record<AssociationCause, string> = {
  not_run: "not run yet", inputs_changed: "inputs changed since it ran", no_adequate_method: "no adequate matching method is available",
};
const CAUSE_ALIAS: Record<string, AssociationCause> = { stale: "inputs_changed", inputs_changed_since_run: "inputs_changed", no_method: "no_adequate_method", no_adequate_method_available: "no_adequate_method", not_run_yet: "not_run" };
/** The cause as the contract words it; a cause this build does not know is shown as recorded, never replaced by another. */
export function associationCauseLabel(cause: string | null | undefined): string | null {
  if (!cause) return null;
  const known = (cause in ASSOCIATION_CAUSE_LABEL ? cause : CAUSE_ALIAS[cause]) as AssociationCause | undefined;
  return known ? ASSOCIATION_CAUSE_LABEL[known] : words(cause);
}

/** Why "Recording unavailable": the reason is stated in place of an action. Open wording. */
export const RECORDING_UNAVAILABLE_REASON_LABEL: Record<RecordingUnavailableReason, string> = {
  recording_unreadable: "the recording cannot be read", no_recording_in_session: "no recording exists for this session", no_session_linked: "no session is linked to this lecture",
};
/** The reason as worded above; a reason this build does not know is shown as recorded. */
export function recordingUnavailableReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (RECORDING_UNAVAILABLE_REASON_LABEL as Record<string, string | undefined>)[reason] ?? words(reason);
}
/**
 * Why "Audio not processed yet" is shown. The first two are the contract's own cases. The third is one the contract's six
 * lines do not provide for: the Brain reports this state also when the WHOLE recording is transcribed and some transcript
 * lines could not be given a time — the line alone would then be untrue, so the reason is stated with it. Open wording.
 */
export const AUDIO_UNPROCESSED_REASON_LABEL: Record<AudioUnprocessedReason, string> = {
  no_generated_timing: "this recording has no timing yet",
  partly_processed: "only the stated part of it has timing, and nothing for this slide was found in that part",
  transcript_lines_without_time: "the recording is transcribed, but some transcript lines could not be given a time; nothing for this slide was found among the lines that have one",
};
/** Why "Audio not processed yet" is shown, in words; a reason without words here is shown as recorded; null for none. */
export function audioUnprocessedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (AUDIO_UNPROCESSED_REASON_LABEL as Record<string, string | undefined>)[reason] ?? words(reason);
}
/** What kept slide matching from running or from producing a result, as recorded beside the cause of "Not matched yet". Open wording. */
export const ASSOCIATION_NOT_RUN_REASON_LABEL: Record<AssociationNotRunReason, string> = {
  no_generated_timing: "nothing was generated for this recording", recording_unavailable: "the recording cannot be read",
  no_slide_text: "the slides have no text to match against", no_windows: "the generated text has no stretch of speech to match",
};
/** What kept slide matching from running, in words; a reason without words here is shown as recorded; null for none. */
export function associationNotRunReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (ASSOCIATION_NOT_RUN_REASON_LABEL as Record<string, string | undefined>)[reason] ?? words(reason);
}
/**
 * The reason stated beside a no-range line, read from the state's own detail: why the recording is unavailable, the
 * role of a structural page, why the audio counts as not processed, the cause of "Not matched yet" (with what kept
 * matching from running, when recorded). null when the state has no reason to state (the candidates of an ambiguous
 * page are its detail) or the Brain recorded none: nothing is made up.
 */
export function noRangeReason(noRange: NoRange): string | null {
  switch (noRange.state) {
    case "recording_unavailable":
      return recordingUnavailableReasonLabel(noRange.detail?.reason);
    case "no_range_expected": {
      const role = noRange.detail?.role;
      return role ? ((ROLE_LABEL as Record<string, string | undefined>)[role] ?? words(role)) : null;
    }
    case "audio_unprocessed":
      return audioUnprocessedReasonLabel(noRange.detail?.reason);
    case "association_not_run": {
      const parts = [associationCauseLabel(noRange.detail?.cause), associationNotRunReasonLabel(noRange.detail?.reason)].filter((part): part is string => part !== null);
      return parts.length ? parts.join(": ") : null;
    }
    case "ambiguous":
    case "not_discussed":
      return null;
    default: {
      const unhandled: never = noRange;
      return unhandled;
    }
  }
}

/** How a generated fact was established: three different labels. */
export const ESTABLISHED_LABEL: Record<EstablishedState, string> = { generated: "Generated", agent_reviewed: "Agent-reviewed", human_confirmed: "Human-confirmed" };
/**
 * What a row of the range list is, in the UI contract's three words (suggestion with its method, reviewed, entered by
 * you). A suggestion is never worded as confirmed; a second pass by an agent is still a suggestion. The review state is
 * never hidden by the origin: the course's study-map pairing with generated times is a suggestion until somebody checks it.
 */
export type RangeKind = "suggestion" | "suggestion_checked" | "reviewed" | "entered_by_you";
/** The four kinds in words; `rangeKindLabel` adds a suggestion's method. */
export const RANGE_KIND_LABEL: Record<RangeKind, string> = {
  suggestion: "Suggestion", suggestion_checked: "Suggestion, checked by a second pass", reviewed: "Reviewed", entered_by_you: "Entered by you",
};
/**
 * Where a range comes from. "manual" is a link a person entered or confirmed. "reviewed_source_map" is the course's
 * study-map pairing of pages with transcript lines: never worded with "source map", which in R2 names the app's own
 * generated page map of a deck. Open wording.
 */
export const RANGE_ORIGIN_LABEL: Record<RangeOrigin, string> = { pipeline: "Suggestion", manual: "Entered or confirmed by you", reviewed_source_map: "By the course's study map" };
/**
 * What a range is, from its origin, review state and method. A link a person made by hand (origin "manual", method
 * "manual" or none) is entered by you; a link some method or the course's study map made and a person confirmed is
 * reviewed; one a second pass checked is a checked suggestion; everything else is a suggestion.
 */
export function rangeKindOf(range: Pick<TimingRange, "origin" | "review_state"> & { method?: MethodRef | null }): RangeKind {
  if (range.origin === "manual") return !range.method || range.method.name === "manual" ? "entered_by_you" : "reviewed";
  return range.review_state === "human_confirmed" ? "reviewed" : range.review_state === "agent_reviewed" ? "suggestion_checked" : "suggestion";
}
/** The method as recorded: its name, and its version when one applies ("lexical-sequence 2"). */
export const methodLabel = (method: MethodRef | null | undefined): string => (method ? [method.name, method.version].filter((part) => part != null && part !== "").join(" ") : "");
/** A method's name in words (design spec 9.4). A name without words here is shown as it is. */
export const METHOD_WORDS: Record<string, string> = { "lexical-sequence": "wording match" };
/** "wording match" for lexical-sequence; any other method by its recorded name; "" for none. */
export const methodWords = (method: MethodRef | null | undefined): string => (method ? (METHOD_WORDS[method.name] ?? method.name) : "");
/** The words in the brackets of a suggestion made from the course's study map (origin "reviewed_source_map"). */
export const COURSE_STUDY_MAP_WORDS = "course study map";
type RangeKindInput = Pick<TimingRange, "origin" | "review_state"> & { method?: MethodRef | null };
/** "Suggestion (wording match)", "Suggestion (course study map)", "Suggestion, checked by a second pass (wording match)", "Reviewed", "Entered by you": a suggestion always with its method. */
export function rangeKindLabel(range: RangeKindInput): string {
  const kind = rangeKindOf(range);
  const method = range.origin === "reviewed_source_map" ? COURSE_STUDY_MAP_WORDS : methodWords(range.method);
  return (kind === "suggestion" || kind === "suggestion_checked") && method ? `${RANGE_KIND_LABEL[kind]} (${method})` : RANGE_KIND_LABEL[kind];
}
/** What a range is, in full, for the Qualities disclosure: who or what made it and whether anybody checked it (design spec 9.4). */
export function rangeKindInFull(range: RangeKindInput): string {
  switch (rangeKindOf(range)) {
    case "entered_by_you":
      return "You entered this range.";
    case "reviewed":
      return "A suggestion you confirmed.";
    case "suggestion_checked":
      return "Checked by a second pass. Not confirmed by you.";
    default:
      if (range.origin === "reviewed_source_map") return "The course's study map pairs these pages with transcript lines; the times of those lines are generated.";
      return range.method
        ? `Made by the method ${range.method.name}${range.method.version != null && range.method.version !== "" ? `, version ${range.method.version}` : ""}. Nobody has checked it.`
        : "Made by a method that was not recorded. Nobody has checked it.";
  }
}
/** A range says that a slide was discussed during it; shown only where video frames were visible and inspected. */
export const RANGE_RELATION_LABEL: Record<RangeRelation, string> = { discussed_during: "Discussed", displayed_during: "Shown" };
/** In Qualities, beside a range of relation "displayed_during". */
export const DISPLAYED_SENTENCE = "Frames of this recording were inspected for this interval.";
/** A supported range over a structural page. */
export const TOPIC_DISCUSSION_LABEL = "discussion of the topic";
/** The same in full, on the row and the range line of a range over a structural page. */
export const TOPIC_DISCUSSION_SENTENCE = "Discussion of the topic. Not evidence of what was displayed.";
/** Whether a range applies to this page or to the whole build group (the UI contract's words; `rangeSupportLine` words one range). */
export const RANGE_SUPPORT_LABEL: Record<RangeSupportScope, string> = {
  page: "this page", build_group: "the whole build group",
  region: "a region of this page", section: "a section of pages, with no time of this page alone", // open wording
};
const GROUP_PLURAL: Record<GroupPositionKind, string> = { build: "builds", step: "steps", copy: "copies", part: "parts" };
/**
 * Where one range applies, short for the range line and in full for its row: "this page"; "all 3 builds" and "the whole
 * group, pp. 22–24; no time is given per build" (`kind` is the page's position kind; without it the contract's "the
 * whole build group"); "a region of this page"; "a section of the lecture, pp. 20–27" and, in full, that the course's
 * study map states it and no time is given for this page alone. Pages are worded as pages, never as slide numbers.
 */
export function rangeSupportLine(support: TimingRange["support"] | null | undefined, kind?: GroupPositionKind | null): { short: string; full: string } {
  const pages = pagesRef(support?.pages ?? []);
  switch (support?.scope) {
    case "build_group": {
      const short = kind ? nb(`all ${support.pages.length} ${GROUP_PLURAL[kind]}`) : RANGE_SUPPORT_LABEL.build_group;
      return { short, full: `the whole group${pages ? `, ${pages}` : ""}; no time is given per ${kind ? POSITION_WORD[kind] : "page"}` };
    }
    case "section": {
      const short = `a section of the lecture${pages ? `, ${pages}` : ""}`;
      return { short, full: `${short}, by the course's study map; no time is given for this page alone` };
    }
    case "region":
      return { short: RANGE_SUPPORT_LABEL.region, full: RANGE_SUPPORT_LABEL.region };
    case "page":
    case undefined:
      return { short: RANGE_SUPPORT_LABEL.page, full: RANGE_SUPPORT_LABEL.page };
    default:
      return { short: words(String(support?.scope)), full: words(String(support?.scope)) };
  }
}
/** Three independent qualities, available on request and never merged into one figure. */
export const QUALITY_LABEL: Record<QualityName, { label: string; question: string }> = {
  acoustic: { label: "Timestamp quality", question: "are the times of the words right" },
  association: { label: "Association quality", question: "is this talk about this slide" },
  group_mapping: { label: "Group-mapping quality", question: "is this page correctly grouped" },
};
/** The state of one quality as a sentence, before its `basis` (shown verbatim). A state without words here is shown as recorded. */
export const QUALITY_STATE_SENTENCE: Record<string, string> = {
  generated_unreviewed: "Generated on this PC from the audio. Not reviewed.", candidate: "Candidate.", generated: "Generated.", agent_reviewed: "Agent-reviewed.", human_confirmed: "Human-confirmed.",
};
/** One quality's state as a sentence ("Candidate."), or the state as recorded. */
export const qualityStateLabel = (state: string): string => QUALITY_STATE_SENTENCE[state] ?? words(state);
/** The name of the recording of a lecture that has one; a lecture with several names each by its file. */
export const LECTURE_RECORDING_LABEL = "Lecture recording";
/** "Lecture recording" when the lecture has one recording, otherwise the file name of the one meant ("Recording" when it has none). */
export function recordingLabel(recordings: ReadonlyArray<{ source_id: string; filename?: string | null }>, sourceId: string): string {
  if (recordings.length === 1 && recordings[0]!.source_id === sourceId) return LECTURE_RECORDING_LABEL;
  return recordings.find((recording) => recording.source_id === sourceId)?.filename || "Recording";
}
/** The outline's second line for a page without a range. Never written for a structural page or when the recording is unavailable. */
export const NO_RANGE_OUTLINE_LINE = "No recording range";
/** Whether the outline writes "No recording range" for this state: the four states of a content page whose recording exists. */
export const noRangeInOutline = (state: NoRangeState): boolean => state === "not_discussed" || state === "audio_unprocessed" || state === "association_not_run" || state === "ambiguous";
/** Stage of a lecture's timing, in the words of the preparation details (inventoried, transcribed, slide-linked; design spec 9.10). */
export const TIMING_STAGE_LABEL: Record<TimingStage, string> = {
  no_recording: "No recording", audio_unprocessed: "Inventoried, not transcribed yet", partly_processed: "Transcribed in part", processed: "Transcribed, slides not linked yet", associated: "Slide-linked",
};
export const TEXT_ALIGNMENT_STATE_LABEL: Record<TextAlignmentState, string> = { // open wording
  accepted: "Text-aligned", refused: "Text alignment refused", no_transcript: "No course transcript", not_run: "Text alignment not run yet",
};
export const ASSOCIATION_STATE_LABEL: Record<AssociationState, string> = { // open wording
  current: "Slide-linked", stale: "Slide links are older than their inputs", not_run: "Slide matching not run yet",
};
/** Under the heading of Generated speech text. The UI contract's phrase is "generated, not reviewed"; where it was made is added. */
export const GENERATED_TEXT_NOTE = "Generated, not reviewed. Made on this PC.";
/** Under Generated speech text when nothing was generated for the recording. */
export const NO_GENERATED_TEXT_SENTENCE = "No speech text has been generated for this recording.";
const spans = (intervals: ReadonlyArray<unknown>): string[] => intervals.flatMap((interval) => {
  const [start, end] = Array.isArray(interval) ? [interval[0], interval[1]] : [(interval as { start_ms?: unknown } | null)?.start_ms, (interval as { end_ms?: unknown } | null)?.end_ms];
  return typeof start === "number" && typeof end === "number" && start < end ? [timeSpanLabel(start, end)] : [];
});
/** What generated speech text covers: "Covers 0:00 – 1:36:58 of the recording.", several parts listed, the unresolved parts said as gaps. The processed window alone is never coverage. */
export function generatedCoverageSentence(generated: Pick<TimingGenerated, "covered_intervals" | "unresolved_intervals"> | null | undefined): string {
  if (!generated) return NO_GENERATED_TEXT_SENTENCE;
  const covered = spans(generated.covered_intervals ?? []);
  if (covered.length === 0) return "Covers no part of the recording yet.";
  const gaps = spans(generated.unresolved_intervals ?? []);
  return `Covers ${listed(covered)} of the recording.${gaps.length ? ` Not resolved: ${listed(gaps)}.` : ""}`;
}
/** The closing line of the Course transcript section; null when the lecture has no course transcript (the section is absent). */
export function textAlignmentSentence(alignment: TimingTextAlignment | null | undefined): string | null {
  switch (alignment?.state) {
    case "accepted":
      return `${alignment.lines_aligned ?? 0} of ${countLabel(alignment.lines_total ?? 0, "line")} have a time. A line shows a time only where text alignment supports it; the times are generated and not reviewed.`;
    case "refused":
      return `The generated text and this transcript do not correspond well enough, so no line has a time${alignment.reason ? ` (${words(alignment.reason)})` : ""}.`;
    case "not_run":
      return "Times have not been worked out for this transcript.";
    default:
      return null;
  }
}
/** Under the speech-timing row of Sources: "61 ranges for 58 of 91 pages; 8 pages expect none." from the lecture's timing summary, or why no range is current. */
export function associationSentence(state: AssociationState, summary?: Pick<TimingSummary, "ranges" | "pages" | "pages_with_range" | "pages_no_range_expected"> | null): string {
  if (state === "stale") return "The ranges were made from earlier inputs and are not shown as current.";
  if (state === "not_run") return "Slide matching has not run.";
  if (!summary) return `${ASSOCIATION_STATE_LABEL.current}.`;
  const none = summary.pages_no_range_expected;
  return `${countLabel(summary.ranges, "range")} for ${summary.pages_with_range} of ${countLabel(summary.pages, "page")}; ${countLabel(none, "page")} ${none === 1 ? "expects" : "expect"} none.`;
}

// ---- question ties --------------------------------------------------------------------------------------------------------
/** Every row carries one basis label. */
export const TIE_KIND: Record<TieKind, { label: string; meaning: string }> = {
  exact: { label: "Exact", meaning: "a reviewed anchor of the course record names this page" },
  stated: { label: "Stated", meaning: "the course record names this page; its page basis is not reviewed" },
  agent_inferred: { label: "Suggested link", meaning: "an inferred candidate anchor" },
  concept_related: { label: "Concept-related", meaning: "reached through a shared concept or a question relation; not a claim about this slide" },
};
/** The sentence after the label of a course tie that names this page (design spec 9.6). */
export const TIE_SENTENCE: Record<"exact" | "stated", string> = {
  exact: "A reviewed anchor of the course record names this page.", stated: "The course record names this page. Its page basis is not reviewed.",
};
/**
 * How far a suggested link was checked. All three are agent work; none is a confirmation. The first two are the
 * contract's phrases. The third is for a link the checking pass REJECTED and the learner's own confirmation keeps
 * listed (types.SuggestionVerdict): it is never worded as "checked". Open wording for the third.
 */
export type SuggestionCheck = "not_checked" | "checked" | "rejected_by_check";
/** The three check lines of a suggested link; word a tie through `suggestionCheckLabel` or `suggestionStatus`. */
export const SUGGESTION_CHECK_LINE: Record<SuggestionCheck, string> = { not_checked: "not yet checked", checked: "checked by a second pass", rejected_by_check: "rejected by a second pass" };
const CHECK_OF_STATE: Record<SuggestionState, SuggestionCheck> = { agent_inferred: "not_checked", agent_reviewed: "checked" };
/** Every verdict says which line it gives, so a verdict added later cannot be worded by accident. */
const CHECK_OF_VERDICT: Record<SuggestionVerdict, SuggestionCheck> = { upheld: "checked", narrowed: "checked", rejected: "rejected_by_check" };
/** The check line of one suggested link. A rejection is never hidden by the state recorded beside it; otherwise the state decides. */
export function suggestionCheckOf(tie: Pick<SuggestedTieFields, "state" | "verdict">): SuggestionCheck {
  if (tie.verdict != null && CHECK_OF_VERDICT[tie.verdict] === "rejected_by_check") return "rejected_by_check";
  return CHECK_OF_STATE[tie.state] ?? "not_checked";
}
/** "not yet checked", "checked by a second pass" or "rejected by a second pass". Word a tie through this, never through its state alone. */
export const suggestionCheckLabel = (tie: Pick<SuggestedTieFields, "state" | "verdict">): string => SUGGESTION_CHECK_LINE[suggestionCheckOf(tie)];
/** How the named pages relate to the listed criteria. Neither says that a slide teaches the whole answer. */
export const SUGGESTION_COVERAGE_LABEL: Record<SuggestionCoverage, string> = { // open wording
  main: "the main place these criteria are taught", partial: "supports these criteria in part",
};
/** The learner's own record beside a suggested link. */
export const LEARNER_DECISION_LABEL: Record<LearnerDecision, string> = { confirmed: "confirmed by you", rejected: "rejected by you" };
/** Beside a link the checking pass rejected: why it is still listed. Open wording. */
export const KEPT_BY_CONFIRMATION_LABEL = "kept because you confirmed it";
/**
 * The words beside a suggested link: how far it was checked, and the learner's own decision. A link the checking pass
 * rejected is listed only because the learner confirmed it, and its row says both ("rejected by a second pass" · "kept
 * because you confirmed it"); the pass's reason is the tie's `verdict_note`.
 */
export function suggestionStatus(tie: Pick<SuggestedTieFields, "state" | "verdict" | "learner_decision">): { check: SuggestionCheck; checkLabel: string; decisionLabel: string | null } {
  const check = suggestionCheckOf(tie);
  const decisionLabel = tie.learner_decision == null ? null
    : check === "rejected_by_check" && tie.learner_decision === "confirmed" ? KEPT_BY_CONFIRMATION_LABEL : (LEARNER_DECISION_LABEL[tie.learner_decision] ?? words(String(tie.learner_decision)));
  return { check, checkLabel: SUGGESTION_CHECK_LINE[check], decisionLabel };
}
/**
 * The one basis label of a suggested link (design spec 9.6): "Suggested link, not yet checked", "Suggested link,
 * checked by a second pass", "Suggested link, confirmed by you". A link the checking pass rejected and the learner's
 * confirmation keeps says both, so the confirmation never hides the rejection. Never Exact or Stated.
 */
export function suggestedLinkLabel(tie: Pick<SuggestedTieFields, "state" | "verdict" | "learner_decision">): string {
  const { check, checkLabel, decisionLabel } = suggestionStatus(tie);
  const label = TIE_KIND.agent_inferred.label;
  if (check === "rejected_by_check") return [label, checkLabel, ...(decisionLabel ? [decisionLabel] : [])].join(", ");
  return `${label}, ${tie.learner_decision === "confirmed" ? LEARNER_DECISION_LABEL.confirmed : checkLabel}`;
}
/** After the support sentence of a link whose verdict is "narrowed". */
export const NARROWED_SENTENCE = "The second pass kept fewer pages or criteria than first proposed.";
/** Through what a related question is reached. A question reached only through what a SUGGESTION says the slide supports is said to be. Open wording. */
export const RELATED_BASIS_LABEL: Record<RelatedConceptBasis, string> = {
  page_concepts: "through a concept recorded for this slide", suggested_link: "through a concept that a suggested link says this slide supports",
};
/** Which statement of the course catalog an Exact or Stated anchor is: where the question's content is, or only where the question itself is printed. Open wording. */
export const CATALOG_FIELD_LABEL: Record<CatalogField, string> = {
  locator: "the course record names where its content is", page: "the course catalog records where the question itself is printed",
};
/** "supports 2 of 3 criteria" — also when n equals m; "no criteria are catalogued" when the question has none. */
export function criteriaSupportLabel(supported: number, total: number): string {
  return total > 0 ? `supports ${nb(`${supported} of ${total} criteria`)}` : "no criteria are catalogued";
}
/** "this page supports 1 of 3"; null when per-page support was not recorded. */
export function pageSupportLabel(here: number | null | undefined, total: number): string | null {
  return typeof here === "number" && total > 0 ? `this page supports ${nb(`${here} of ${total}`)}` : null;
}
/** "This page supports 1 of 4." as a sentence after the support sentence; null when per-page support was not recorded. */
export const pageSupportSentence = (here: number | null | undefined, total: number): string | null => {
  const label = pageSupportLabel(here, total);
  return label ? `${sentenceCase(label)}.` : null;
};
/**
 * How many criteria the page on screen supports: the Brain's count per page when it sent one; otherwise the tie's own
 * count when the tie's support is this page alone; otherwise null (the sentence is left out). Never the tie's count divided.
 */
export function pageSupportCount(tie: { criteria_supported_here?: number | null; criteria_supported: number | null; support_pages: readonly number[] }, page: number): number | null {
  if (typeof tie.criteria_supported_here === "number") return tie.criteria_supported_here;
  return tie.support_pages.length === 1 && tie.support_pages[0] === page && typeof tie.criteria_supported === "number" ? tie.criteria_supported : null;
}
/** A criterion by its number and concept label, the only words the API gives for it: "criterion 1 (Rate law)". Its catalogued wording is never shown here. */
export const criterionName = (criterion: Pick<TieCriterion, "number" | "concept_label">): string =>
  `${nb(`criterion ${criterion.number}`)}${criterion.concept_label ? ` (${criterion.concept_label})` : ""}`;
/** In place of the support sentence when the question has no catalogued criteria. */
export const NO_CRITERIA_SENTENCE = "No criteria are catalogued for this question. The link supports the part of the prompt named below.";
/**
 * The support sentence of a suggested link: "Supports 2 of 4 criteria: criterion 1 (Rate law) and criterion 3
 * (Half-life)."; with `pages` (the lecture-wide list) "p. 40 supports …"; "each in part" when the coverage is partial.
 * Never "teaches", "answers" or "the whole question", also when the count is 4 of 4. The rationale follows verbatim.
 */
export function supportSentence(tie: Pick<SuggestedTieFields, "criteria_supported" | "criteria_total" | "criteria" | "coverage">, pages: readonly number[] = []): string {
  if (!(tie.criteria_total > 0)) return NO_CRITERIA_SENTENCE;
  const runs = pageRuns(pages);
  const single = runs.length === 1 && runs[0]![0] === runs[0]![1];
  const subject = runs.length === 0 ? "Supports" : `${pagesRef(pages)} ${single ? "supports" : "support"}`;
  const named = listed((tie.criteria ?? []).map(criterionName));
  return `${subject} ${nb(`${tie.criteria_supported} of ${tie.criteria_total} criteria`)}${tie.coverage === "partial" ? ", each in part" : ""}${named ? `: ${named}` : ""}.`;
}
/** In a build group each row says where its support is. */
export const TIE_WHERE_LABEL: Record<TieWhere, string> = { on_this_page: "on this build", elsewhere_in_sequence: "elsewhere in this sequence", group_level: "group-level" };
/** The word for one page of a group. A copy or a step is never called a build. */
export const POSITION_WORD: Record<GroupPositionKind, string> = { build: "build", step: "step", copy: "copy", part: "part" };
/**
 * Where a tie's or a concept's support is, relative to the selected page (lower case, no full stop): "on this build",
 * "on this build and on build 1" (the tie also names other pages of the group), "elsewhere in this sequence: build 3",
 * "group-level", with `total` "group-level: all 3 builds". `named` are the positions (1-based) of the OTHER supporting
 * pages in the group. `kind` null is a page in no group: "on this page".
 */
export function whereLabel(where: TieWhere, kind: GroupPositionKind | null | undefined = "build", named: readonly number[] = [], total?: number): string {
  const word = kind ? POSITION_WORD[kind] : "page";
  const plural = kind ? GROUP_PLURAL[kind] : "pages";
  const others = named.length ? nb(`${named.length === 1 ? word : plural} ${listed(named.map(String))}`) : "";
  if (where === "group_level") return kind && total ? `${TIE_WHERE_LABEL.group_level}: ${nb(`all ${total} ${plural}`)}` : TIE_WHERE_LABEL.group_level;
  if (where === "on_this_page") return `on this ${word}${others ? ` and on ${others}` : ""}`;
  return others ? `${TIE_WHERE_LABEL.elsewhere_in_sequence}: ${others}` : TIE_WHERE_LABEL.elsewhere_in_sequence;
}
/** A tie of granularity "section": the course's own study map places the question somewhere in a range of pages. Listed apart from page ties, never as a page anchor. */
export const SECTION_TIE: { label: string; meaning: string } = {
  label: "Stated for a part of the lecture", meaning: "the course's study map places this question somewhere in these pages; it names no page",
};
/** Whether the course's study map places the whole question or part of it in the section. */
export const SECTION_SCOPE_LABEL: Record<"all" | "part", string> = { all: "the whole question", part: "part of the question" };
/** The pages of a section as pages ("pp. 20–27"); "" when the map gives none. A page index is never worded as a slide number. */
function sectionPages(section: SectionTieDetail | null | undefined): string {
  const runs = (section?.page_ranges ?? []).filter(([first, last]) => Number.isInteger(first) && Number.isInteger(last) && first <= last);
  const [only] = runs;
  return runs.length === 0 ? "" : runs.length === 1 && only && only[0] === only[1] ? pageRef(only[0]) : `pp.${NBSP}${runsText(runs)}`;
}
/** "Stated for a part of the lecture (pp. 5–20)", with "part of the question" when the map restricts it. */
export function sectionTieLabel(section: SectionTieDetail | null | undefined): string {
  const pages = sectionPages(section);
  return `${SECTION_TIE.label}${pages ? ` (${pages})` : ""}${section?.scope === "part" ? `, ${SECTION_SCOPE_LABEL.part}` : ""}`;
}
/** The sentence of a section tie: "The course's study map places it in pp. 20–27 and names no single page." ("part of it" when the map restricts it). */
export function sectionTieSentence(section: SectionTieDetail | null | undefined): string {
  return `The course's study map places ${section?.scope === "part" ? "part of it" : "it"} in ${sectionPages(section) || "a part of the lecture"} and names no single page.`;
}
/** The sub-heading the section ties are listed under, apart from the page ties: "In this part of the lecture, by the course's study map: pp. 20–27", with the map's own label when it gives one. */
export function sectionHeading(section: SectionTieDetail | null | undefined): string {
  const pages = sectionPages(section);
  return `In this part of the lecture, by the course's study map${pages ? `: ${pages}` : ""}${section?.label ? ` (${section.label})` : ""}`;
}
/**
 * The sentence after "Concept-related": "Through 'Rate law'. Not a claim about this slide." When every concept that
 * leads to the question is known for the slide only through a suggested link, the sentence says so.
 */
export function relatedSentence(via: RelatedQuestion["via_concepts"] | null | undefined): string {
  const concepts = via ?? [];
  if (concepts.length === 0) return "Not a claim about this slide.";
  const onlySuggested = concepts.every((concept) => concept.basis === "suggested_link");
  return `Through ${listed(concepts.map((concept) => `'${concept.label}'`))}${onlySuggested ? `, ${concepts.length === 1 ? "a concept" : "concepts"} that a suggested link says this slide supports` : ""}. Not a claim about this slide.`;
}
/**
 * A question with no course anchor and no displayable suggestion shows one of two lines. The meaning of the first is
 * wider than the contract's table cell ("candidates were proposed … and the checking pass rejected them all"): the
 * same state is recorded for a question that was examined and for which no page was found, where nothing was proposed
 * (r2-read-api.md 1.3, the file's `no_candidate` list). The reason shown is the recorded one in both cases.
 */
export const NO_LINK_LINE: Record<NoLinkState, { label: string; meaning: string }> = {
  inspected_no_support: { label: "Inspected, no supporting page found",
    meaning: "this question was examined and no supporting page was found: every proposed candidate was rejected by the checking pass, or none was proposed; the recorded reason is stated" },
  no_suggestion: { label: "No suggested link", meaning: "no candidate is recorded for this question, with the recorded reason" },
};
/** The recorded reason of "No suggested link". The line never says whether the question was examined, because the record does not. */
export const NO_LINK_REASON_LABEL: Record<NoLinkReason, string> = {
  no_file: "none produced for this course yet", no_item: "none recorded for this question", stale: "made for an earlier version",
  rejected_by_learner: "you rejected the link that was suggested", file_unreadable: "the suggestions file could not be read", // open wording
};
/** The label and the recorded reason (a short phrase) of a no-link line; `noLinkSentence` gives the reason as a sentence. */
export function noLinkLine(noLink: NoLink): { label: string; reason: string } {
  return { label: NO_LINK_LINE[noLink.state].label, reason: noLink.state === "no_suggestion" ? (NO_LINK_REASON_LABEL[noLink.reason] ?? words(String(noLink.reason))) : noLink.reason };
}
/** The recorded reason of "No suggested link" as the sentence that follows the label (design spec 9.7). With "rejected_by_learner" the row offers "Show it". */
export const NO_LINK_REASON_SENTENCE: Record<NoLinkReason, string> = {
  no_file: "None has been produced for this course yet.", no_item: "None is recorded for this question.", stale: "The suggestions were made for an earlier version.",
  rejected_by_learner: "You rejected the one that was suggested.", file_unreadable: "The suggestions file could not be read.",
};
/** The sentence after the label of a no-link line: the reason's sentence, the checking pass's own words verbatim, or a reason this build does not know as recorded. */
export function noLinkSentence(noLink: NoLink): string {
  return noLink.state === "no_suggestion" ? (NO_LINK_REASON_SENTENCE[noLink.reason] ?? words(String(noLink.reason))) : noLink.reason;
}

// ---- evidence -------------------------------------------------------------------------------------------------------------
/**
 * Five different states, never collapsed. No mastery label, no probability. A state says under which conditions
 * something was observed, not how it went: "Independent" is an attempt recorded with no assistance and no reference,
 * whatever its outcome. No state is therefore drawn in an outcome colour (success, caution, danger); the label tells
 * Assisted from Independent.
 */
export const EVIDENCE_STATE: Record<EvidenceState, { label: string; tone: Tone }> = {
  unknown: { label: "Unknown", tone: "unassessed" },
  not_applicable: { label: "Not applicable", tone: "unassessed" },
  not_separately_observed: { label: "Not separately observed", tone: "unassessed" },
  assisted: { label: "Assisted", tone: "neutral" },
  independent: { label: "Independent", tone: "neutral" },
};
/** Prior exposure alone is shown as prior exposure, not as assistance. */
export const PRIOR_EXPOSURE_LABEL: Record<PriorExposure, string> = { seen: "prior exposure", unseen: "no prior exposure", unknown: "prior exposure not recorded" };
/** The kinds of assistance of an evidence object, in the words of design spec 9.8. */
export const EVIDENCE_ASSISTANCE_LABEL: Record<string, string> = {
  hint: "after a hint", formula_provided: "formula provided", worked_example: "after a worked example", solution_shown: "solution shown", mixed: "mixed help",
  reference_notes: "notes open", reference_tools: "tools used", reference_mixed: "references open", unknown: "kind of help not recorded",
};
/** Beside "Assisted" when no kind was recorded. */
export const ASSISTANCE_NOT_RECORDED = EVIDENCE_ASSISTANCE_LABEL.unknown!;
/** The kind of assistance as recorded: "after a hint", "notes open" for reference-only help; a kind without words here is shown as recorded; null for none. */
export function assistanceKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  const known = EVIDENCE_ASSISTANCE_LABEL[kind];
  if (known) return known;
  if (kind.startsWith("reference_")) {
    const reference = kind.slice("reference_".length);
    return REFERENCE_LABEL[reference] ?? `reference: ${words(reference)}`;
  }
  return ASSISTANCE_LABEL[kind] ?? words(kind);
}
/** The state with the kind of assistance inside the label, and prior exposure as a separate phrase: { "Assisted: solution shown", "prior exposure" }. */
export function evidenceLabel(evidence: Pick<EvidenceObject, "state" | "assistance" | "prior_exposure">): { state: string; priorExposure: string } {
  const label = EVIDENCE_STATE[evidence.state]?.label ?? words(String(evidence.state));
  const state = evidence.state === "assisted" ? `${label}: ${assistanceKindLabel(evidence.assistance) ?? ASSISTANCE_NOT_RECORDED}` : label;
  return { state, priorExposure: PRIOR_EXPOSURE_LABEL[evidence.prior_exposure] ?? words(String(evidence.prior_exposure)) };
}
/**
 * What stands beside the state: "2 attempts"; "1 attempt on a combined question" for Not separately observed; for
 * Unknown "no recorded attempt" or, when attempts exist, "how it was done was not recorded". null where nothing is
 * said: Not applicable, and a state with no recorded count (never written as 0).
 */
export function evidenceAttemptsLabel(evidence: Pick<EvidenceObject, "state" | "attempts">): string | null {
  const attempts = Number.isFinite(evidence.attempts) ? evidence.attempts : 0;
  if (evidence.state === "not_applicable") return null;
  if (evidence.state === "unknown") return attempts > 0 ? "how it was done was not recorded" : "no recorded attempt";
  if (attempts <= 0) return null;
  return evidence.state === "not_separately_observed" ? `${countLabel(attempts, "attempt")} on a combined question` : countLabel(attempts, "attempt");
}
/**
 * One row's evidence in the order of design spec 9.8: the state with its kind, the attempts, then prior exposure —
 * "Assisted: solution shown · 1 attempt · prior exposure". Prior exposure is added only when the question was seen
 * (an observation line states it in words either way: PRIOR_EXPOSURE_LABEL); it is never a state and never assistance.
 */
export function evidenceLine(evidence: Pick<EvidenceObject, "state" | "assistance" | "prior_exposure" | "attempts">): string {
  const { state, priorExposure } = evidenceLabel(evidence);
  return [state, evidenceAttemptsLabel(evidence), evidence.prior_exposure === "seen" ? priorExposure : null].filter((part): part is string => part !== null).join(" · ");
}
/** `evidence.summary` as one sentence of counts with its denominator: "Of 3 recorded observations: 0 independent, 1 assisted, 2 not separately observed." No percentage. */
export function evidenceSummarySentence(summary: Pick<EvidenceSummary, "independent" | "assisted" | "not_separately_observed" | "unknown" | "observations">): string {
  const unknown = summary.unknown ?? 0;
  const total = summary.observations ?? summary.independent + summary.assisted + summary.not_separately_observed + unknown;
  return `Of ${countLabel(total, "recorded observation")}: ${summary.independent} independent, ${summary.assisted} assisted, ${summary.not_separately_observed} not separately observed${unknown > 0 ? `, ${unknown} unknown` : ""}.`;
}

// ---- slide identity and role ----------------------------------------------------------------------------------------------
// Each part of the identity line is one fact: its words are held together by non-breaking spaces, and the line breaks
// only between parts (" · "). A test that compares with plain spaces normalises white space first.
/** "PDF page 23 of 91"; the page alone when the count is not known. */
export const pdfPageLabel = (page: number, pageCount: number | null | undefined): string => nb(pageCount ? `PDF page ${page} of ${pageCount}` : `PDF page ${page}`);
/** "build 2 of 3", "step 1 of 2", "copy 1 of 2", "part 2 of 3" */
export const positionLabel = (position: SlidePosition): string => nb(`${POSITION_WORD[position.kind] ?? words(String(position.kind))} ${position.ordinal} of ${position.of}`);
/** A page that repeats the page before it and adds nothing: "duplicate of page 23" (never "build"). */
export const duplicateOfLabel = (page: number): string => nb(`duplicate of page ${page}`);
/** On request, for a repeat: "Copy 2 of 2 of one slide". */
export const copyOfOneSlideLabel = (position: SlidePosition): string => `${nb(`Copy ${position.ordinal} of ${position.of}`)} of one slide`;
/** A number established on the page itself: "Slide 17" — "Slide 17 (printed)" when a differing PowerPoint number stands beside it, so each is named by its kind. Never derived from the page index. */
export const printedSlideLabel = (value: number, named = false): string => nb(named ? `Slide ${value} (printed)` : `Slide ${value}`);
/** A recorded match with a slide of the unit's PowerPoint file: "Slide 17 (PowerPoint)". */
export const pptxSlideLabel = (ordinal: number): string => nb(`Slide ${ordinal} (PowerPoint)`);
/** Several slides on one handout page: "slide region 2 of 4". */
export const regionLabel = (ordinal: number, of: number): string => nb(`slide region ${ordinal} of ${of}`);
/** A PDF page label, shown as a label and never used as the index. */
export const pdfLabelLabel = (label: string): string => nb(`PDF label ${label}`);
/** On request, how a printed slide number is known. */
export const PRINTED_BASIS_LABEL: Record<"printed_on_page" | "correction", string> = { printed_on_page: "printed on the page", correction: "entered as a correction" };
/** The basis of a printed number in words; a basis without words here is shown as recorded. */
export const printedBasisLabel = (basis: string): string => (PRINTED_BASIS_LABEL as Record<string, string | undefined>)[basis] ?? words(basis);
/** On request, when the unit has a PowerPoint file and no match is recorded for the page (nothing is added to the identity line). */
export const NO_PPTX_MATCH_LABEL = "No match is recorded for this page";
/** Shown in the details when the grouping of a page is uncertain or unknown. */
export const GROUPING_NOT_ESTABLISHED = "grouping not established";
export const LOGICAL_SLIDE_KIND_LABEL: Record<LogicalSlideKind, string> = { // open wording
  single: "Single page", build_group: "Build sequence", step_group: "Step sequence", duplicate_group: "Duplicate pages", manual_group: "Grouped by a correction",
};
const GROUP_ROW_NOUN: Record<Exclude<LogicalSlideKind, "single" | "manual_group">, [string, string]> = { build_group: ["build", "builds"], step_group: ["step", "steps"], duplicate_group: ["copy", "copies"] };
/**
 * The count line of a group row of the outline, in the group's own word: "3 builds, pp. 22–24", "4 steps, pp. 30–33",
 * "2 copies, pp. 40–41", "3 pages grouped by you, pp. 50–52" ("grouped by a correction" unless the grouping is
 * human-confirmed). null for a single page, which has no count line.
 */
export function groupRowLabel(kind: LogicalSlideKind, pages: readonly number[], groupingState?: EstablishedState | null): string | null {
  if (kind === "single") return null;
  const count = kind === "manual_group" ? `${countLabel(pages.length, "page")} grouped by ${groupingState === "human_confirmed" ? "you" : "a correction"}` : countLabel(pages.length, ...GROUP_ROW_NOUN[kind]);
  const where = pagesRef(pages);
  return where ? `${count}, ${where}` : count;
}
/** How a grouping came about; a page on its own has no basis to state. */
export const GROUPING_BASIS_LABEL: Record<GroupingBasis, string | null> = { page: null, inferred: "inferred from the file", pptx: "from the PowerPoint file", override: "set by a correction" };
/** A grouping in words, on request: its basis, how it was established, then its signals as a plain list: "inferred from the file, generated: same heading, ordered text containment". */
export function groupingLabel(grouping: LogicalSlideGrouping): string {
  const basis = grouping.basis in GROUPING_BASIS_LABEL ? GROUPING_BASIS_LABEL[grouping.basis] : words(String(grouping.basis));
  const head = [basis, establishedWords(grouping.state)].filter((part): part is string => !!part).join(", ");
  const signals = (grouping.signals ?? []).map(words);
  return signals.length ? `${head}: ${signals.join(", ")}` : head;
}
/** Each page shows one role. */
export const ROLE_LABEL: Record<SlideRoleValue, string> = {
  instructional: "Instructional", worked_example_or_question: "Worked example or question", objectives_or_summary: "Objectives or summary",
  structural_title_or_section: "Structural (title or section)", administrative: "Administrative", blank: "Blank", mixed: "Mixed", unknown: "Unknown",
};
/** How a role was established. */
export const ROLE_STATE_LABEL: Record<RoleState, string> = ESTABLISHED_LABEL;
/** The same three states inside a line (roles, groupings, matches): "generated", "agent-reviewed", "human-confirmed". */
export const ESTABLISHED_WORDS: Record<EstablishedState, string> = { generated: "generated", agent_reviewed: "agent-reviewed", human_confirmed: "human-confirmed" };
/** For a role, grouping or match whose state is null. */
export const NOT_ESTABLISHED = "not established";
/** How something was established, in words; null is "not established"; a state without words here is shown as recorded. */
export const establishedWords = (state: string | null | undefined): string => (state ? ((ESTABLISHED_WORDS as Record<string, string | undefined>)[state] ?? words(state)) : NOT_ESTABLISHED);
/** Beside the role in the role button: "generated", "agent-reviewed, uncertain", "not established". */
export const roleStateLabel = (role: Pick<SlideRole, "state" | "uncertain">): string => `${establishedWords(role.state)}${role.uncertain ? ", uncertain" : ""}`;
/** On request, the basis and state of a PowerPoint match: "matched by title and text, generated". A match is recorded, never ordinal equality. */
export const pptxMatchLabel = (match: Pick<PptxMatch, "match_basis" | "match_state">): string =>
  `${match.match_basis ? `matched by ${words(match.match_basis)}` : "matched"}, ${establishedWords(match.match_state)}`;
export const SOURCE_MAP_UNAVAILABLE_LABEL: Record<SourceMapUnavailableReason, string> = { // open wording
  no_deck: "No slides file is chosen for this lecture", not_a_pdf: "The slides file is not a PDF", unreadable: "The slides file could not be read", not_built: "The source map has not been built yet",
};

// ---- suggestions file -----------------------------------------------------------------------------------------------------
/** Where the suggestions file of a course stands. An earlier catalog and an unreadable file are two different things. Open wording. */
export const INFERRED_FILE_STATE_LABEL: Record<InferredFileState, string> = {
  ok: "Suggestions file read", missing: "None produced for this course yet", unreadable: "The suggestions file could not be read",
  made_for_earlier_catalog: "Made for an earlier version of the question catalog", catalog_unavailable: "The question catalog could not be read, so the file was not compared with it",
};

// ---- concepts -------------------------------------------------------------------------------------------------------------
/**
 * The three edge families of the data (one line style each). The family "structure" holds two different things — the
 * lines of the outline (a topic includes a concept or a skill, a concept is assessed as a skill) and the owner's
 * relations between questions (prerequisite, overlap) — and a course or lecture graph without a focus draws only the
 * first. The contract's legend words the family "prerequisite/overlap", which would be untrue of an outline line, so
 * the family is named "Structure" here and the LEGEND below words each edge by what it is. Open wording for the name.
 */
export const EDGE_FAMILY: Record<GraphEdgeFamily, { label: string; meaning: string }> = {
  assessment: { label: "Assessment", meaning: "question → criterion → concept or skill" },
  source: { label: "Source", meaning: "taught or supported on a page" },
  structure: { label: "Structure", meaning: "the lines of the outline, and prerequisite or overlap between concepts or questions" },
};
/** What a legend line names. The contract's three families, with the structure family told apart into the outline's own lines and the relations between questions. */
export type EdgeLegendKind = "assessment" | "source" | "hierarchy" | "prerequisite_or_overlap";
/** In legend order. `family` is the data family (and the line style) the entry belongs to. "Outline" is open wording; the other three labels are the contract's. */
export const EDGE_LEGEND: Record<EdgeLegendKind, { label: string; meaning: string; family: GraphEdgeFamily }> = {
  assessment: { label: "Assessment", meaning: "question → criterion → concept or skill", family: "assessment" },
  source: { label: "Source", meaning: "taught or supported on a page", family: "source" },
  hierarchy: { label: "Outline", meaning: "a topic includes a concept or a skill; a concept is assessed as a skill", family: "structure" },
  prerequisite_or_overlap: { label: "Prerequisite or overlap", meaning: "prerequisite or overlap between concepts or questions, under the course's own relation label", family: "structure" },
};
const LEGEND_ORDER: readonly EdgeLegendKind[] = ["assessment", "source", "hierarchy", "prerequisite_or_overlap"];
/** The relations of the family "structure" that are lines of the outline; every other relation of that family is the owner's label between two questions. */
const HIERARCHY_RELATIONS: ReadonlySet<string> = new Set(["topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill"]);
/** Which legend line an edge belongs to. A line of the outline is never worded as a prerequisite or an overlap. */
export function edgeLegendKind(edge: Pick<ConceptGraphEdge, "family" | "relation">): EdgeLegendKind {
  switch (edge.family) {
    case "assessment":
      return "assessment";
    case "source":
      return "source";
    case "structure":
      return HIERARCHY_RELATIONS.has(edge.relation) ? "hierarchy" : "prerequisite_or_overlap";
    default: {
      const unhandled: never = edge.family;
      return unhandled;
    }
  }
}
/** The legend lines of what is drawn, each once, in legend order: a legend never names a kind of edge the view does not show. */
export function edgeLegendKinds(edges: ReadonlyArray<Pick<ConceptGraphEdge, "family" | "relation">>): EdgeLegendKind[] {
  const drawn = new Set(edges.map(edgeLegendKind));
  return LEGEND_ORDER.filter((kind) => drawn.has(kind));
}
/** One relation in words: the owner's own label ("is fully contained in", "partly overlaps with"), or the relation as recorded when this build has no words for it. A containment is never worded as a prerequisite. */
export const edgeRelationLabel = (relation: string): string => RELATION_LABEL[relation] ?? words(relation);
/** The five kinds of node of the concept model. */
export const GRAPH_NODE_KIND_LABEL: Record<GraphNodeKind, string> = { topic: "Topic", concept: "Concept", skill: "Skill", question: "Question", criterion: "Criterion" };
/** What changed when a view is older than its inputs (r2.isStale returns these keys): the keys of a lecture view and of a concept graph. Open wording. */
export type RevisionKey = keyof ViewRevisions | keyof ConceptGraphRevisions;
/** Each revision key as the name of the input it stands for; `staleViewLine` words what happened to it. */
export const REVISION_KEY_LABEL: Record<RevisionKey, string> = {
  deck_sha256: "the slides file", map_revision: "the grouping of the slides", question_index_sha256: "the question catalog", inferred_anchors_sha256: "the suggested links",
  timing_links: "the recording ranges", evidence_revision: "the recorded attempts", scope_revision: "what this scope holds",
  skills_sha256: "the skills catalog", anchor_revision: "the question links of this lecture", policy_revision: "the app's policy settings",
};
/** One revision key in words; a key this build does not know is shown as recorded, never as "undefined". */
export const revisionKeyLabel = (key: string): string => (REVISION_KEY_LABEL as Record<string, string | undefined>)[key] ?? words(key);
/**
 * What happened to each input, as the clause after "was made before" (design spec 9.9 for the five keys of a lecture
 * view; the keys only a concept graph states are worded here). Two keys with one clause are said once.
 */
export const REVISION_REASON: Record<RevisionKey, string> = {
  question_index_sha256: "the question catalog changed", map_revision: "the slide groups or roles changed", deck_sha256: "the slide groups or roles changed",
  inferred_anchors_sha256: "the suggested links changed", timing_links: "the recording ranges were rebuilt", evidence_revision: "a new attempt was recorded",
  anchor_revision: "the question links of this lecture changed", skills_sha256: "the skills catalog changed", policy_revision: "the app's policy settings changed", scope_revision: "what this scope holds changed",
};
/** What a stale notice stands over. */
export type StaleSubject = "list" | "ranges" | "view";
const STALE_SUBJECT: Record<StaleSubject, string> = { list: "This list was made before", ranges: "These ranges were made before", view: "This view was made before" };
/**
 * The one line of a view that is older than its inputs (R2-C11), as its first element with Refresh beside it; null
 * when nothing changed. `keys` are what r2.isStale returned; several reasons are joined in one sentence. Without
 * `subject` the line speaks of "these ranges" when only the timing links changed and of "this list" otherwise.
 */
export function staleViewLine(keys: readonly string[], subject?: StaleSubject): string | null {
  const reasons = [...new Set(keys.map((key) => (REVISION_REASON as Record<string, string | undefined>)[key] ?? `${words(key)} changed`))];
  if (reasons.length === 0) return null;
  const about = subject ?? (keys.every((key) => key === "timing_links") ? "ranges" : "list");
  return `${STALE_SUBJECT[about]} ${listed(reasons)}.`;
}
/** The heading of a concept view: its scope and how many concepts, skills and questions it holds. `lectureName` is the lecture's own short name ("Lecture 03"). */
export function conceptScopeHeading(scope: Pick<ConceptGraphScope, "kind">, totals: Pick<Record<GraphNodeKind, number>, "concept" | "skill" | "question">, lectureName?: string | null): string {
  const name = scope.kind === "slide" ? "On this slide" : scope.kind === "lecture" ? (lectureName ? nb(lectureName) : CONCEPT_SCOPE_LABEL.lecture) : CONCEPT_SCOPE_LABEL.course;
  return `${name}: ${countLabel(totals.concept, "concept")}, ${countLabel(totals.skill, "skill")}, ${countLabel(totals.question, "question")}`;
}
/** A node's counts: "2 skills, 5 questions". A count that does not apply (null) is left out, never written 0; "" when neither applies. */
export function nodeCountsLabel(counts: ConceptGraphNode["counts"] | null | undefined): string {
  return [counts?.skills != null ? countLabel(counts.skills, "skill") : null, counts?.questions != null ? countLabel(counts.questions, "question") : null].filter((part): part is string => part !== null).join(", ");
}
/** In a node's detail when `definition.state` is "coverage_gap". */
export const DEFINITION_GAP_SENTENCE = "The catalog holds no definition for this concept.";
