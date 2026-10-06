// Amendment R2: the wording maps of web/src/lib/labels.ts. The words asserted here are those of
// docs/project/ui-state-and-interaction-contract.md, section "Remediation amendment R2"; a map that lacks a member of
// its union does not compile (Record<Union, …>), and this file checks at run time that no wording is empty.
import { describe, expect, it } from "vitest";
import {
  ASSOCIATION_CAUSE_LABEL, ASSOCIATION_NOT_RUN_REASON_LABEL, ASSOCIATION_STATE_LABEL, AUDIO_UNPROCESSED_REASON_LABEL, CATALOG_FIELD_LABEL, CONCEPT_SCOPE_LABEL, CONTEXT_TABS, EDGE_FAMILY, EDGE_LEGEND,
  ESTABLISHED_LABEL, EVIDENCE_STATE, GRAPH_NODE_KIND_LABEL, GROUPING_NOT_ESTABLISHED, INFERRED_FILE_STATE_LABEL, KEPT_BY_CONFIRMATION_LABEL,
  LEARNER_DECISION_LABEL, LOGICAL_SLIDE_KIND_LABEL, NO_LINK_LINE, NO_LINK_REASON_LABEL, NO_RANGE_LINE, PANE_LABEL, POSITION_WORD, PRIOR_EXPOSURE_LABEL, QUALITY_LABEL, QUESTION_LIST_LABEL,
  R2_ACTION, RANGE_KIND_LABEL, RANGE_ORIGIN_LABEL, RANGE_RELATION_LABEL, RANGE_SUPPORT_LABEL, RELATED_BASIS_LABEL, REVISION_KEY_LABEL, ROLE_LABEL, ROLE_STATE_LABEL, SECTION_SCOPE_LABEL, SECTION_TIE,
  RECORDING_UNAVAILABLE_REASON_LABEL, SOURCE_MAP_UNAVAILABLE_LABEL, SUGGESTION_CHECK_LINE, SUGGESTION_COVERAGE_LABEL, TEXT_ALIGNMENT_STATE_LABEL, TIE_KIND, TIE_WHERE_LABEL, TIMING_STAGE_LABEL, TOPIC_DISCUSSION_LABEL,
  assistanceKindLabel, associationCauseLabel, associationNotRunReasonLabel, audioUnprocessedReasonLabel, criteriaSupportLabel, duplicateOfLabel, edgeLegendKind, edgeLegendKinds, edgeRelationLabel, evidenceLabel,
  methodLabel, noLinkLine, noRangeAction, noRangeReason, pageSupportLabel, pdfLabelLabel, pdfPageLabel,
  positionLabel, pptxSlideLabel, printedSlideLabel, rangeKindLabel, rangeKindOf, recordingUnavailableReasonLabel, regionLabel, revisionKeyLabel, sectionTieLabel, staleViewLine, suggestionCheckLabel,
  suggestionCheckOf, suggestionStatus, whereLabel,
  DECISION_NOTE, DEFINITION_GAP_SENTENCE, DISPLAYED_SENTENCE, ESTABLISHED_WORDS, GENERATED_TEXT_NOTE, GROUPING_BASIS_LABEL, LECTURE_RECORDING_LABEL, NARROWED_SENTENCE, NO_CRITERIA_SENTENCE, NO_GENERATED_TEXT_SENTENCE,
  NO_LINK_REASON_SENTENCE, NO_PPTX_MATCH_LABEL, NO_RANGE_OUTLINE_LINE, NOT_ESTABLISHED, PRINTED_BASIS_LABEL, TIE_SENTENCE, TOPIC_DISCUSSION_SENTENCE, associationSentence, conceptScopeHeading, copyOfOneSlideLabel,
  countLabel, criterionName, establishedWords, evidenceAttemptsLabel, evidenceLine, evidenceSummarySentence, generatedCoverageSentence, groupRowLabel, groupingLabel, methodWords, nb, noLinkSentence,
  noRangeInOutline, nodeCountsLabel, pageSupportCount, pageSupportSentence, pptxMatchLabel, printedBasisLabel, qualityStateLabel, rangeKindInFull, rangeSupportLine, recordingLabel, relatedSentence,
  roleStateLabel, sectionHeading, sectionTieSentence, suggestedLinkLabel, supportSentence, textAlignmentSentence, transcriptLinesRef, unlistedLabel,
} from "@/lib/labels";
import {
  sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide, sampleEvidence, sampleInferredAnchors, sampleInferredAnchorsEarlierCatalog, sampleLectureView, sampleNoLinkReasons, sampleNoRange,
  sampleRangeBuildGroup, sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual, sampleRangeSecondVisit, sampleRangeSection, sampleRevisions, sampleTieKeptByConfirmation,
} from "@/lib/fixtures/r2-sample";
import type {
  AssociationCause, AssociationNotRunReason, AssociationState, AudioUnprocessedReason, CatalogField, EstablishedState, EvidenceState, GraphEdgeFamily, GraphNodeKind, GraphScopeKind, GroupPositionKind,
  InferredFileState, LearnerDecision, LogicalSlideKind, NoLinkReason, NoLinkState, NoRange, NoRangeState, PriorExposure, QualityName, RangeOrigin, RangeRelation, RangeSupportScope, RelatedConceptBasis,
  SlideRoleValue, SourceMapUnavailableReason, SuggestionCoverage, SuggestionVerdict, TextAlignmentState, TieKind, TieWhere, TimingStage,
} from "@/lib/types";

/** One fact held on one line: every space of it is a non-breaking space (design specification 9.11). */
const nbsp = (text: string): string => text.replace(/ /g, "\u00a0");
/** Every string anywhere inside a wording map. */
function wordings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(wordings);
  if (value && typeof value === "object") return Object.values(value).flatMap(wordings);
  return [];
}
/** The members of a union, written out once: `satisfies` keeps each list a list of that union, and the Record type of the map makes a member missing from the map a compile error. */
const NO_RANGE_STATES = ["recording_unavailable", "no_range_expected", "audio_unprocessed", "association_not_run", "ambiguous", "not_discussed"] as const satisfies readonly NoRangeState[];
const TIE_KINDS = ["exact", "stated", "agent_inferred", "concept_related"] as const satisfies readonly TieKind[];
const TIE_WHERES = ["on_this_page", "elsewhere_in_sequence", "group_level"] as const satisfies readonly TieWhere[];
const EVIDENCE_STATES = ["unknown", "not_applicable", "not_separately_observed", "assisted", "independent"] as const satisfies readonly EvidenceState[];
const PRIOR_EXPOSURES = ["unseen", "seen", "unknown"] as const satisfies readonly PriorExposure[];
const ROLES = ["instructional", "worked_example_or_question", "objectives_or_summary", "structural_title_or_section", "administrative", "blank", "mixed", "unknown"] as const satisfies readonly SlideRoleValue[];
const ESTABLISHED = ["generated", "agent_reviewed", "human_confirmed"] as const satisfies readonly EstablishedState[];
const QUALITIES = ["acoustic", "association", "group_mapping"] as const satisfies readonly QualityName[];
const STAGES = ["no_recording", "audio_unprocessed", "partly_processed", "processed", "associated"] as const satisfies readonly TimingStage[];
const NO_LINK_STATES = ["inspected_no_support", "no_suggestion"] as const satisfies readonly NoLinkState[];
const NO_LINK_REASONS = ["no_file", "no_item", "stale", "rejected_by_learner", "file_unreadable"] as const satisfies readonly NoLinkReason[];
const ORIGINS = ["pipeline", "manual", "reviewed_source_map"] as const satisfies readonly RangeOrigin[];
const RELATIONS = ["discussed_during", "displayed_during"] as const satisfies readonly RangeRelation[];
const SUPPORT_SCOPES = ["page", "build_group", "region", "section"] as const satisfies readonly RangeSupportScope[];
const POSITION_KINDS = ["build", "step", "copy", "part"] as const satisfies readonly GroupPositionKind[];
const CAUSES = ["not_run", "inputs_changed", "no_adequate_method"] as const satisfies readonly AssociationCause[];
const VERDICTS = ["upheld", "narrowed", "rejected"] as const satisfies readonly SuggestionVerdict[];
const AUDIO_REASONS = ["no_generated_timing", "partly_processed", "transcript_lines_without_time"] as const satisfies readonly AudioUnprocessedReason[];
const NOT_RUN_REASONS = ["no_generated_timing", "recording_unavailable", "no_slide_text", "no_windows"] as const satisfies readonly AssociationNotRunReason[];
const FILE_STATES = ["ok", "missing", "unreadable", "made_for_earlier_catalog", "catalog_unavailable"] as const satisfies readonly InferredFileState[];
const RELATED_BASES = ["page_concepts", "suggested_link"] as const satisfies readonly RelatedConceptBasis[];
const CATALOG_FIELDS = ["locator", "page"] as const satisfies readonly CatalogField[];
const COVERAGES = ["main", "partial"] as const satisfies readonly SuggestionCoverage[];
const DECISIONS = ["confirmed", "rejected"] as const satisfies readonly LearnerDecision[];
const FAMILIES = ["assessment", "source", "structure"] as const satisfies readonly GraphEdgeFamily[];
const NODE_KINDS = ["topic", "concept", "skill", "question", "criterion"] as const satisfies readonly GraphNodeKind[];
const SCOPE_KINDS = ["course", "lecture", "slide"] as const satisfies readonly GraphScopeKind[];
const SLIDE_KINDS = ["single", "build_group", "step_group", "duplicate_group", "manual_group"] as const satisfies readonly LogicalSlideKind[];
const ALIGNMENT_STATES = ["accepted", "refused", "no_transcript", "not_run"] as const satisfies readonly TextAlignmentState[];
const ASSOCIATION_STATES = ["current", "stale", "not_run"] as const satisfies readonly AssociationState[];
const MAP_REASONS = ["no_deck", "not_a_pdf", "unreadable", "not_built"] as const satisfies readonly SourceMapUnavailableReason[];

const MAPS: Array<[string, Record<string, unknown>, readonly string[]]> = [
  ["NO_RANGE_LINE", NO_RANGE_LINE, NO_RANGE_STATES], ["TIE_KIND", TIE_KIND, TIE_KINDS], ["TIE_WHERE_LABEL", TIE_WHERE_LABEL, TIE_WHERES], ["EVIDENCE_STATE", EVIDENCE_STATE, EVIDENCE_STATES],
  ["PRIOR_EXPOSURE_LABEL", PRIOR_EXPOSURE_LABEL, PRIOR_EXPOSURES], ["ROLE_LABEL", ROLE_LABEL, ROLES], ["ROLE_STATE_LABEL", ROLE_STATE_LABEL, ESTABLISHED], ["ESTABLISHED_LABEL", ESTABLISHED_LABEL, ESTABLISHED],
  ["QUALITY_LABEL", QUALITY_LABEL, QUALITIES], ["TIMING_STAGE_LABEL", TIMING_STAGE_LABEL, STAGES], ["NO_LINK_LINE", NO_LINK_LINE, NO_LINK_STATES], ["NO_LINK_REASON_LABEL", NO_LINK_REASON_LABEL, NO_LINK_REASONS],
  ["RANGE_ORIGIN_LABEL", RANGE_ORIGIN_LABEL, ORIGINS], ["RANGE_RELATION_LABEL", RANGE_RELATION_LABEL, RELATIONS], ["RANGE_SUPPORT_LABEL", RANGE_SUPPORT_LABEL, SUPPORT_SCOPES],
  ["POSITION_WORD", POSITION_WORD, POSITION_KINDS], ["ASSOCIATION_CAUSE_LABEL", ASSOCIATION_CAUSE_LABEL, CAUSES],
  ["SUGGESTION_CHECK_LINE", SUGGESTION_CHECK_LINE, ["not_checked", "checked", "rejected_by_check"]],
  ["AUDIO_UNPROCESSED_REASON_LABEL", AUDIO_UNPROCESSED_REASON_LABEL, AUDIO_REASONS], ["ASSOCIATION_NOT_RUN_REASON_LABEL", ASSOCIATION_NOT_RUN_REASON_LABEL, NOT_RUN_REASONS],
  ["INFERRED_FILE_STATE_LABEL", INFERRED_FILE_STATE_LABEL, FILE_STATES], ["RELATED_BASIS_LABEL", RELATED_BASIS_LABEL, RELATED_BASES], ["CATALOG_FIELD_LABEL", CATALOG_FIELD_LABEL, CATALOG_FIELDS],
  ["EDGE_LEGEND", EDGE_LEGEND, ["assessment", "source", "hierarchy", "prerequisite_or_overlap"]],
  ["SUGGESTION_COVERAGE_LABEL", SUGGESTION_COVERAGE_LABEL, COVERAGES], ["LEARNER_DECISION_LABEL", LEARNER_DECISION_LABEL, DECISIONS], ["EDGE_FAMILY", EDGE_FAMILY, FAMILIES],
  ["GRAPH_NODE_KIND_LABEL", GRAPH_NODE_KIND_LABEL, NODE_KINDS], ["CONCEPT_SCOPE_LABEL", CONCEPT_SCOPE_LABEL, SCOPE_KINDS], ["LOGICAL_SLIDE_KIND_LABEL", LOGICAL_SLIDE_KIND_LABEL, SLIDE_KINDS],
  ["TEXT_ALIGNMENT_STATE_LABEL", TEXT_ALIGNMENT_STATE_LABEL, ALIGNMENT_STATES], ["ASSOCIATION_STATE_LABEL", ASSOCIATION_STATE_LABEL, ASSOCIATION_STATES],
  ["SOURCE_MAP_UNAVAILABLE_LABEL", SOURCE_MAP_UNAVAILABLE_LABEL, MAP_REASONS], ["SECTION_SCOPE_LABEL", SECTION_SCOPE_LABEL, ["all", "part"]],
  ["RANGE_KIND_LABEL", RANGE_KIND_LABEL, ["suggestion", "suggestion_checked", "reviewed", "entered_by_you"]],
  ["RECORDING_UNAVAILABLE_REASON_LABEL", RECORDING_UNAVAILABLE_REASON_LABEL, ["recording_unreadable", "no_recording_in_session", "no_session_linked"]],
  ["QUESTION_LIST_LABEL", QUESTION_LIST_LABEL, ["this_slide", "related_concepts", "all_lecture"]],
  ["PANE_LABEL", PANE_LABEL, ["slide", "tutor", "questions", "concepts", "transcript", "sources"]],
  ["R2_ACTION", R2_ACTION, ["next_content", "open_whole_recording", "show_candidates", "repeat", "whole_recording", "accept", "reject", "take_back", "show_it", "refresh", "reload", "concept_map"]],
  ["NO_LINK_REASON_SENTENCE", NO_LINK_REASON_SENTENCE, NO_LINK_REASONS], ["ESTABLISHED_WORDS", ESTABLISHED_WORDS, ESTABLISHED], ["TIE_SENTENCE", TIE_SENTENCE, ["exact", "stated"]],
  ["PRINTED_BASIS_LABEL", PRINTED_BASIS_LABEL, ["printed_on_page", "correction"]],
  ["REVISION_KEY_LABEL", REVISION_KEY_LABEL, ["deck_sha256", "map_revision", "question_index_sha256", "inferred_anchors_sha256", "timing_links", "evidence_revision", "scope_revision",
    "skills_sha256", "anchor_revision", "policy_revision"]],
];

describe("every member of every R2 union has wording", () => {
  it.each(MAPS)("%s names exactly the members of its union, and none of its wording is empty", (_name, map, members) => {
    expect(Object.keys(map).sort()).toEqual([...members].sort());
    const found = wordings(map);
    expect(found.length).toBeGreaterThanOrEqual(members.length);
    for (const text of found) {
      expect(text.trim()).not.toBe("");
      expect(text).toBe(text.trim());
    }
  });

  it("keeps different states under different words (nothing is merged into one label)", () => {
    const distinct = (labels: string[]) => expect(new Set(labels).size).toBe(labels.length);
    distinct(NO_RANGE_STATES.map((state) => NO_RANGE_LINE[state].label));
    distinct(TIE_KINDS.map((kind) => TIE_KIND[kind].label));
    distinct(EVIDENCE_STATES.map((state) => EVIDENCE_STATE[state].label));
    distinct(ROLES.map((role) => ROLE_LABEL[role]));
    distinct(ESTABLISHED.map((state) => ESTABLISHED_LABEL[state]));
    distinct(QUALITIES.map((name) => QUALITY_LABEL[name].label));
    distinct(STAGES.map((stage) => TIMING_STAGE_LABEL[stage]));
    distinct(NO_LINK_REASONS.map((reason) => NO_LINK_REASON_LABEL[reason]));
    distinct(Object.values(RANGE_KIND_LABEL));
    distinct(PRIOR_EXPOSURES.map((value) => PRIOR_EXPOSURE_LABEL[value]));
  });
});

describe("recording ranges: the six no-range lines", () => {
  it("uses the contract's line for each state, word for word", () => {
    expect(NO_RANGE_STATES.map((state) => [state, NO_RANGE_LINE[state].label])).toEqual([
      ["recording_unavailable", "Recording unavailable"], ["no_range_expected", "Structural page"], ["audio_unprocessed", "Audio not processed yet"],
      ["association_not_run", "Not matched yet"], ["ambiguous", "Ambiguous"], ["not_discussed", "Not discussed (searched)"],
    ]);
    expect(NO_RANGE_LINE.not_discussed.meaning).toBe("the whole recording was processed and matched, and no talk about this slide was found");
    expect(NO_RANGE_LINE.ambiguous.meaning).toBe("several candidates, none good enough to show as the range");
    expect(NO_RANGE_LINE.recording_unavailable.meaning).toBe("no recording exists or it cannot be read");
  });

  it("offers at most one action per line: three open the whole recording, one shows candidates, one goes to the next content, one offers nothing", () => {
    expect(NO_RANGE_STATES.map((state) => noRangeAction(state)?.label ?? null)).toEqual([null, "Next content", "Open whole recording", "Open whole recording", "Show candidates", "Open whole recording"]);
    expect(noRangeAction("ambiguous")).toEqual({ id: "show_candidates", label: "Show candidates" });
    expect(noRangeAction("recording_unavailable")).toBeNull(); // the reason is stated instead
    expect(recordingUnavailableReasonLabel("recording_unreadable")).toBe("the recording cannot be read");
    expect(recordingUnavailableReasonLabel("no_recording_in_session")).toBe("no recording exists for this session");
    expect(recordingUnavailableReasonLabel("no_session_linked")).toBe("no session is linked to this lecture");
    expect(recordingUnavailableReasonLabel("something_else")).toBe("something else"); // shown as recorded
    expect(recordingUnavailableReasonLabel(null)).toBeNull();
    for (const state of NO_RANGE_STATES) expect(noRangeAction(sampleNoRange[state].state)?.label).toBe(noRangeAction(state)?.label);
  });

  it("states the cause of 'Not matched yet' in the contract's three phrases and never invents one", () => {
    expect(CAUSES.map((cause) => ASSOCIATION_CAUSE_LABEL[cause])).toEqual(["not run yet", "inputs changed since it ran", "no adequate matching method is available"]);
    expect(associationCauseLabel("inputs_changed")).toBe("inputs changed since it ran");
    expect(associationCauseLabel("stale")).toBe("inputs changed since it ran"); // the association's own state name
    expect(associationCauseLabel(null)).toBeNull();
    expect(associationCauseLabel("something_new")).toBe("something new"); // an unknown cause is shown as recorded, not replaced
  });
});

describe("recording ranges: what a range is", () => {
  it("words a pipeline suggestion as a suggestion with its method, also after a second pass checked it", () => {
    expect(rangeKindOf(sampleRangeFirstVisit)).toBe("suggestion");
    expect(rangeKindLabel(sampleRangeFirstVisit)).toBe("Suggestion (wording match)"); // the method in words; its name and version are in the full line
    expect(rangeKindOf(sampleRangeSecondVisit)).toBe("suggestion_checked");
    expect(rangeKindLabel(sampleRangeSecondVisit)).toBe("Suggestion, checked by a second pass (wording match)");
    expect(rangeKindLabel(sampleRangeBuildGroup)).toBe("Suggestion (wording match)"); // a range for a whole build group is a suggestion like any other
    expect(methodLabel({ name: "lexical-sequence", version: "2" })).toBe("lexical-sequence 2");
    expect(methodLabel({ name: "manual", version: null })).toBe("manual"); // no version applies: none is printed
    expect(rangeKindLabel({ origin: "pipeline", review_state: "generated", method: { name: "transcript-cue-match", version: null } })).toBe("Suggestion (transcript-cue-match)");
  });

  it("words a confirmed range as reviewed, a manual one as entered by you, and a course pairing with generated times as a suggestion by the course's study map", () => {
    expect(rangeKindOf(sampleRangeConfirmed)).toBe("reviewed"); // a link made by a method that the learner confirmed: reviewed, not entered
    expect(rangeKindLabel(sampleRangeConfirmed)).toBe("Reviewed");
    expect(rangeKindOf({ origin: "pipeline", review_state: "human_confirmed" })).toBe("reviewed");
    expect(rangeKindOf(sampleRangeManual)).toBe("entered_by_you");
    expect(rangeKindLabel(sampleRangeManual)).toBe("Entered by you");
    // The course's study map pairs pages with transcript lines; the TIMES of those lines are generated. It is a
    // suggestion like any other until somebody checks or confirms it, and its review state is never hidden by its origin.
    expect(rangeKindOf(sampleRangeSection)).toBe("suggestion");
    expect(rangeKindLabel(sampleRangeSection)).toBe("Suggestion (course study map)");
    expect(rangeKindLabel({ ...sampleRangeSection, review_state: "agent_reviewed" })).toBe("Suggestion, checked by a second pass (course study map)");
    expect(rangeKindLabel({ ...sampleRangeSection, review_state: "human_confirmed" })).toBe("Reviewed");
    expect(rangeKindOf({ origin: "manual", review_state: "generated" })).toBe("entered_by_you"); // the origin decides: what the learner entered is never a suggestion
  });

  it("keeps the words 'source map' for the app's own page map: a range that the course states is never said to come from one", () => {
    // In R2 "source map" names the generated page map of a deck (source-map/1). The course's pairing of pages with
    // transcript lines, and a link kept in the course's reviewed source links, are the course's record.
    for (const text of [...wordings(RANGE_KIND_LABEL), ...wordings(RANGE_ORIGIN_LABEL), ...wordings(RANGE_SUPPORT_LABEL)]) expect(text).not.toMatch(/source map/i);
    expect(RANGE_ORIGIN_LABEL.reviewed_source_map).toBe("By the course's study map");
  });

  it("never words a suggestion as confirmed or reviewed", () => {
    for (const kind of ["suggestion", "suggestion_checked"] as const) expect(RANGE_KIND_LABEL[kind]).not.toMatch(/confirm|review/i);
    expect(SUGGESTION_CHECK_LINE.checked).toBe("checked by a second pass");
    for (const text of wordings(SUGGESTION_CHECK_LINE)) expect(text).not.toMatch(/confirm/i);
  });

  it("states the reason of a no-range line from the state's own detail, each reason in its own words", () => {
    expect(noRangeReason(sampleNoRange.recording_unavailable)).toBe("the recording cannot be read");
    expect(noRangeReason(sampleNoRange.no_range_expected)).toBe("Structural (title or section)");
    expect(noRangeReason(sampleNoRange.audio_unprocessed)).toBe("only the stated part of it has timing, and nothing for this slide was found in that part");
    expect(noRangeReason(sampleNoRange.association_not_run)).toBe("inputs changed since it ran");
    expect(noRangeReason(sampleNoRange.ambiguous)).toBeNull(); // the candidates are the detail
    expect(noRangeReason(sampleNoRange.not_discussed)).toBeNull();
    // what kept matching from running has words of its own beside the cause
    const noText: NoRange = { state: "association_not_run", text: "", detail: { cause: "not_run", differs: [], reason: "no_slide_text" } };
    expect(noRangeReason(noText)).toBe("not run yet: the slides have no text to match against");
    expect(NOT_RUN_REASONS.map((reason) => associationNotRunReasonLabel(reason))).toEqual(["nothing was generated for this recording", "the recording cannot be read",
      "the slides have no text to match against", "the generated text has no stretch of speech to match"]);
    expect(associationNotRunReasonLabel("some_new_reason")).toBe("some new reason"); // shown as recorded
    expect(associationNotRunReasonLabel(null)).toBeNull();
    expect(noRangeReason({ state: "association_not_run", text: "", detail: {} })).toBeNull(); // no cause was recorded: none is made up
  });

  it("does not leave 'Audio not processed yet' standing alone over a recording that is transcribed in full", () => {
    // The Brain reports this state also when the whole recording has text and some transcript lines got no time. The
    // six lines of the contract have none for that; the stated reason says what is the case.
    const untimed: NoRange = { state: "audio_unprocessed", text: "", detail: { processed: [["src-sample-rec-90", 0, 4_800_000]], reason: "transcript_lines_without_time" } };
    expect(noRangeReason(untimed)).toBe("the recording is transcribed, but some transcript lines could not be given a time; nothing for this slide was found among the lines that have one");
    expect(noRangeReason(untimed)).not.toMatch(/no timing yet|not processed/i);
    expect(AUDIO_REASONS.map((reason) => audioUnprocessedReasonLabel(reason)![0])).toEqual(["t", "o", "t"]);
    expect(audioUnprocessedReasonLabel("no_generated_timing")).toBe("this recording has no timing yet");
    expect(audioUnprocessedReasonLabel("something_else")).toBe("something else");
    expect(audioUnprocessedReasonLabel(undefined)).toBeNull();
  });

  it("says discussed, and shown only for the relation that needs inspected frames; names the three qualities apart", () => {
    expect(RANGE_RELATION_LABEL).toEqual({ discussed_during: "Discussed", displayed_during: "Shown" });
    expect(TOPIC_DISCUSSION_LABEL).toBe("discussion of the topic");
    expect(QUALITIES.map((name) => QUALITY_LABEL[name].label)).toEqual(["Timestamp quality", "Association quality", "Group-mapping quality"]);
    expect(RANGE_SUPPORT_LABEL.page).toBe("this page");
    expect(RANGE_SUPPORT_LABEL.build_group).toBe("the whole build group");
  });

  it("keeps generated, agent-reviewed and human-confirmed as three labels", () => {
    expect(ESTABLISHED.map((state) => ESTABLISHED_LABEL[state])).toEqual(["Generated", "Agent-reviewed", "Human-confirmed"]);
    expect(ROLE_STATE_LABEL).toEqual(ESTABLISHED_LABEL);
  });
});

describe("question ties", () => {
  it("uses the contract's basis labels", () => {
    expect(TIE_KINDS.map((kind) => TIE_KIND[kind].label)).toEqual(["Exact", "Stated", "Suggested link", "Concept-related"]);
    expect(TIE_KIND.exact.meaning).toBe("a reviewed anchor of the course record names this page");
    expect(TIE_KIND.stated.meaning).toBe("the course record names this page; its page basis is not reviewed");
    expect(TIE_KIND.concept_related.meaning).toBe("reached through a shared concept or a question relation; not a claim about this slide");
    expect(SUGGESTION_CHECK_LINE.not_checked).toBe("not yet checked");
    expect(SUGGESTION_CHECK_LINE.checked).toBe("checked by a second pass");
    expect(suggestionCheckLabel({ state: "agent_inferred", verdict: null })).toBe("not yet checked");
    expect(suggestionCheckLabel({ state: "agent_reviewed", verdict: "upheld" })).toBe("checked by a second pass");
    expect(suggestionCheckLabel({ state: "agent_reviewed", verdict: "narrowed" })).toBe("checked by a second pass");
    expect(suggestionCheckLabel({ state: "agent_reviewed", verdict: null })).toBe("checked by a second pass");
    expect(LEARNER_DECISION_LABEL.confirmed).toBe("confirmed by you");
  });

  it("never words a link the checking pass rejected as checked: it says that it was rejected, and that it is kept because the learner confirmed it", () => {
    // The Brain keeps a link the learner confirmed when the checking pass rejects it afterwards (verdict "rejected",
    // state "agent_reviewed", learner_decision "confirmed"). The row must say both, never only "checked by a second pass".
    expect(VERDICTS.map((verdict) => suggestionCheckOf({ state: "agent_reviewed", verdict }))).toEqual(["checked", "checked", "rejected_by_check"]);
    expect(suggestionCheckOf({ state: "agent_inferred", verdict: "rejected" })).toBe("rejected_by_check"); // a rejection is never hidden by the state beside it
    expect(suggestionCheckLabel({ state: "agent_reviewed", verdict: "rejected" })).toBe("rejected by a second pass");
    expect(suggestionCheckLabel({ state: "agent_reviewed", verdict: "rejected" })).not.toMatch(/checked/);
    expect(sampleTieKeptByConfirmation).toMatchObject({ tie: "agent_inferred", state: "agent_reviewed", verdict: "rejected", learner_decision: "confirmed" });
    expect(suggestionStatus(sampleTieKeptByConfirmation)).toEqual({ check: "rejected_by_check", checkLabel: "rejected by a second pass", decisionLabel: "kept because you confirmed it" });
    expect(KEPT_BY_CONFIRMATION_LABEL).toBe("kept because you confirmed it");
    // the ordinary cases keep the contract's words
    expect(suggestionStatus({ state: "agent_reviewed", verdict: "narrowed", learner_decision: "confirmed" })).toEqual({ check: "checked", checkLabel: "checked by a second pass", decisionLabel: "confirmed by you" });
    expect(suggestionStatus({ state: "agent_inferred", verdict: null, learner_decision: null })).toEqual({ check: "not_checked", checkLabel: "not yet checked", decisionLabel: null });
    expect(suggestionStatus({ state: "agent_inferred", verdict: null, learner_decision: "rejected" }).decisionLabel).toBe("rejected by you");
    // every suggested tie of the sample lecture is worded without an exception
    for (const slide of sampleLectureView.slides) for (const tie of slide.question_ties ?? []) if (tie.tie === "agent_inferred") expect(suggestionStatus(tie).check).not.toBe("rejected_by_check");
  });

  it("says through what a related question is reached, and which statement of the catalog a course anchor is", () => {
    expect(RELATED_BASIS_LABEL.page_concepts).toBe("through a concept recorded for this slide");
    expect(RELATED_BASIS_LABEL.suggested_link).toBe("through a concept that a suggested link says this slide supports");
    expect(RELATED_BASIS_LABEL.suggested_link).toMatch(/suggested link/); // reached only through a suggestion: said so
    expect(CATALOG_FIELD_LABEL.locator).toBe("the course record names where its content is");
    expect(CATALOG_FIELD_LABEL.page).toBe("the course catalog records where the question itself is printed");
    const bases = sampleLectureView.slides.flatMap((slide) => slide.related_questions ?? []).flatMap((row) => row.via_concepts.map((via) => via.basis));
    expect(new Set(bases)).toEqual(new Set(RELATED_BASES));
  });

  it("words the state of the suggestions file, an earlier catalog apart from a file that cannot be read", () => {
    expect(INFERRED_FILE_STATE_LABEL[sampleInferredAnchors.file.state]).toBe("Suggestions file read");
    expect(sampleInferredAnchorsEarlierCatalog.file.state).toBe("made_for_earlier_catalog");
    expect(INFERRED_FILE_STATE_LABEL.made_for_earlier_catalog).toBe("Made for an earlier version of the question catalog; suggestions for questions that have not changed since are still shown");
    expect(INFERRED_FILE_STATE_LABEL.missing).toBe("None produced for this course yet");
    expect(new Set(FILE_STATES.map((state) => INFERRED_FILE_STATE_LABEL[state])).size).toBe(FILE_STATES.length);
  });

  it("counts supported criteria as n of m and never as the whole answer, also when n equals m", () => {
    expect(criteriaSupportLabel(2, 3)).toBe(`supports ${nbsp("2 of 3 criteria")}`);
    expect(criteriaSupportLabel(1, 1)).toBe(`supports ${nbsp("1 of 1 criteria")}`);
    expect(criteriaSupportLabel(2, 2)).not.toMatch(/whole|all|every|complete/i);
    expect(criteriaSupportLabel(0, 0)).toBe("no criteria are catalogued");
    expect(pageSupportLabel(1, 3)).toBe(`this page supports ${nbsp("1 of 3")}`);
    expect(pageSupportLabel(null, 3)).toBeNull(); // per-page support was not recorded: nothing is said
    expect(SUGGESTION_COVERAGE_LABEL.partial).toMatch(/in part/);
  });

  it("says where the support is in a group, names the build, and never calls a copy or a step a build", () => {
    expect(TIE_WHERES.map((where) => TIE_WHERE_LABEL[where])).toEqual(["on this build", "elsewhere in this sequence", "group-level"]);
    expect(whereLabel("on_this_page", "build")).toBe("on this build");
    expect(whereLabel("elsewhere_in_sequence", "build", [3])).toBe(`elsewhere in this sequence: ${nbsp("build 3")}`);
    expect(whereLabel("elsewhere_in_sequence", "build", [1, 3])).toBe(`elsewhere in this sequence: ${nbsp("builds 1 and 3")}`);
    expect(whereLabel("elsewhere_in_sequence", "build")).toBe("elsewhere in this sequence");
    expect(whereLabel("group_level", "build", [1, 2, 3])).toBe("group-level");
    expect(whereLabel("group_level", "build", [], 3)).toBe(`group-level: ${nbsp("all 3 builds")}`); // with the size of the group
    expect(whereLabel("group_level", "step", [], 2)).toBe(`group-level: ${nbsp("all 2 steps")}`);
    expect(whereLabel("on_this_page", "step")).toBe("on this step");
    expect(whereLabel("on_this_page", "part")).toBe("on this part");
    expect(whereLabel("on_this_page", "build", [1])).toBe(`on this build and on ${nbsp("build 1")}`); // a tie that names this page and another one says both
    expect(whereLabel("elsewhere_in_sequence", "copy", [2])).toBe(`elsewhere in this sequence: ${nbsp("copy 2")}`);
    expect(whereLabel("on_this_page", "copy")).not.toMatch(/build/);
    expect(whereLabel("on_this_page", null)).toBe("on this page"); // a page that is in no group (the Concepts tab's words for a single page)
    expect(whereLabel("group_level", null)).toBe("group-level");
  });

  it("words the two no-link lines and their recorded reasons", () => {
    expect(NO_LINK_LINE.inspected_no_support.label).toBe("Inspected, no supporting page found");
    expect(NO_LINK_LINE.no_suggestion.label).toBe("No suggested link");
    expect(NO_LINK_REASON_LABEL.no_file).toBe("none produced for this course yet");
    expect(NO_LINK_REASON_LABEL.no_item).toBe("none recorded for this question");
    expect(NO_LINK_REASON_LABEL.stale).toBe("made for an earlier version");
    expect(noLinkLine({ state: "no_suggestion", reason: "no_item" })).toEqual({ label: "No suggested link", reason: "none recorded for this question" });
    // the checking pass's own words are the reason of the other line
    expect(noLinkLine({ state: "inspected_no_support", reason: "A synthetic note." })).toEqual({ label: "Inspected, no supporting page found", reason: "A synthetic note." });
    // "No suggested link" says nothing about whether the question was examined
    for (const reason of NO_LINK_REASONS) expect(`${NO_LINK_LINE.no_suggestion.label} ${NO_LINK_REASON_LABEL[reason]}`).not.toMatch(/inspect|examin/i);
    const rows = sampleLectureView.questions.all.filter((row) => row.no_link);
    expect(rows.map((row) => noLinkLine(row.no_link!).label).sort()).toEqual(["Inspected, no supporting page found", "No suggested link"]);
    for (const reason of NO_LINK_REASONS) expect(noLinkLine(sampleNoLinkReasons[reason])).toEqual({ label: "No suggested link", reason: NO_LINK_REASON_LABEL[reason] });
  });

  it("does not say that candidates were proposed when the record is that the question was examined and none was found", () => {
    // "Inspected, no supporting page found" is also the line of a confirmed record that no page was found (nothing was
    // proposed, so nothing was rejected). The meaning covers both; the reason shown is the recorded one.
    expect(NO_LINK_LINE.inspected_no_support.meaning).toBe("this question was examined and no supporting page was found: every proposed candidate was rejected by the checking pass, or none was proposed; the recorded reason is stated");
    expect(noLinkLine({ state: "inspected_no_support", reason: "Synthetic: no page of the deck shows this." }).reason).toBe("Synthetic: no page of the deck shows this.");
  });

  it("words a section tie as the course's coarse statement, apart from page ties", () => {
    expect(SECTION_TIE.label).not.toBe(TIE_KIND.stated.label);
    expect(sectionTieLabel({ page_ranges: [[5, 20]], label: null, row: 1, scope: "all" })).toBe("Stated for a part of the lecture (pp.\u00a05–20)");
    expect(sectionTieLabel({ page_ranges: [[2, 5], [9, 9]], label: null, row: 2, scope: "part" })).toBe("Stated for a part of the lecture (pp.\u00a02–5, 9), part of the question");
    expect(sectionTieLabel({ page_ranges: [], label: null, row: null, scope: null })).toBe("Stated for a part of the lecture");
    expect(SECTION_TIE.label).toBe("Stated for a part of the lecture");
  });
});

describe("evidence", () => {
  it("uses five different states and shows prior exposure as its own phrase", () => {
    expect(EVIDENCE_STATES.map((state) => EVIDENCE_STATE[state].label)).toEqual(["Unknown", "Not applicable", "Not separately observed", "Assisted", "Independent"]);
    expect(evidenceLabel(sampleEvidence.assisted)).toEqual({ state: "Assisted: solution shown", priorExposure: "prior exposure" });
    expect(evidenceLabel(sampleEvidence.independent)).toEqual({ state: "Independent", priorExposure: "prior exposure" }); // seen before, no help: not assistance
    expect(evidenceLabel(sampleEvidence.unknown)).toEqual({ state: "Unknown", priorExposure: "prior exposure not recorded" });
    expect(evidenceLabel({ state: "assisted", assistance: null, prior_exposure: "unseen" })).toEqual({ state: "Assisted: kind of help not recorded", priorExposure: "no prior exposure" });
    expect(evidenceLabel({ state: "assisted", assistance: "unknown", prior_exposure: "unseen" }).state).toBe("Assisted: kind of help not recorded");
    expect(evidenceLabel({ state: "independent", assistance: "hint", prior_exposure: "unseen" }).state).toBe("Independent"); // a kind is worded only on Assisted
    for (const value of PRIOR_EXPOSURES) expect(PRIOR_EXPOSURE_LABEL[value]).not.toMatch(/assist/i);
  });

  it("names the kind of assistance, including reference-only help, without inventing words for an unknown kind", () => {
    expect(assistanceKindLabel("hint")).toBe("after a hint");
    expect(["hint", "formula_provided", "worked_example", "solution_shown", "mixed", "reference_notes", "reference_tools", "reference_mixed", "unknown"].map((kind) => assistanceKindLabel(kind))).toEqual([
      "after a hint", "formula provided", "after a worked example", "solution shown", "mixed help", "notes open", "tools used", "references open", "kind of help not recorded"]);
    expect(assistanceKindLabel("reference_slide_rule")).toBe("reference: slide rule");
    expect(assistanceKindLabel("some_new_kind")).toBe("some new kind");
    expect(assistanceKindLabel(null)).toBeNull();
  });

  it("uses no mastery or probability word anywhere in the evidence wording", () => {
    for (const text of [...wordings(EVIDENCE_STATE), ...wordings(PRIOR_EXPOSURE_LABEL)]) expect(text).not.toMatch(/master|probab|%|score|proficien/i);
  });

  it("draws no evidence state in an outcome colour: a state says under which conditions something was observed, not how it went", () => {
    // "Independent" is an attempt recorded with no assistance and no reference, whatever its outcome: an unaided wrong
    // answer is independent too, so the state is never drawn as a success (nor any state as a failure).
    for (const state of EVIDENCE_STATES) expect(["neutral", "unassessed"]).toContain(EVIDENCE_STATE[state].tone);
    expect(EVIDENCE_STATE.independent.tone).toBe("neutral");
  });
});

describe("slide identity and roles", () => {
  it("words a position by its kind and a repeat as a duplicate", () => {
    // each part of the identity line is one fact: its words stay on one line (non-breaking spaces), and the line breaks only between parts
    expect(pdfPageLabel(23, 91)).toBe(nbsp("PDF page 23 of 91"));
    expect(pdfPageLabel(23, 91)).not.toContain(" ");
    expect(pdfPageLabel(23, null)).toBe(nbsp("PDF page 23"));
    expect(positionLabel({ ordinal: 2, of: 3, kind: "build" })).toBe(nbsp("build 2 of 3"));
    expect(positionLabel({ ordinal: 1, of: 2, kind: "step" })).toBe(nbsp("step 1 of 2"));
    expect(positionLabel({ ordinal: 2, of: 2, kind: "copy" })).toBe(nbsp("copy 2 of 2"));
    expect(positionLabel({ ordinal: 1, of: 2, kind: "part" })).toBe(nbsp("part 1 of 2"));
    expect(duplicateOfLabel(23)).toBe(nbsp("duplicate of page 23"));
    expect(duplicateOfLabel(23)).not.toMatch(/build/);
    expect(printedSlideLabel(17)).toBe(nbsp("Slide 17"));
    expect(printedSlideLabel(17, true)).toBe(nbsp("Slide 17 (printed)"));
    expect(pptxSlideLabel(17)).toBe(nbsp("Slide 17 (PowerPoint)"));
    expect(regionLabel(2, 4)).toBe(nbsp("slide region 2 of 4"));
    expect(pdfLabelLabel("iv")).toBe(nbsp("PDF label iv"));
    expect(GROUPING_NOT_ESTABLISHED).toBe("grouping not established");
  });

  it("names the eight roles as the contract lists them", () => {
    expect(ROLES.map((role) => ROLE_LABEL[role])).toEqual(["Instructional", "Worked example or question", "Objectives or summary", "Structural (title or section)", "Administrative", "Blank", "Mixed", "Unknown"]);
  });
});

describe("workspace wording", () => {
  it("lists the five context tabs in the contract's order, and the six panes of a narrow screen", () => {
    expect(CONTEXT_TABS.map((tab) => tab.label)).toEqual(["Tutor", "Questions", "Concepts", "Transcript", "Sources"]);
    expect(CONTEXT_TABS.map((tab) => tab.id)).toEqual(["tutor", "questions", "concepts", "transcript", "sources"]);
    expect(PANE_LABEL.slide).toBe("Slide");
    for (const tab of CONTEXT_TABS) expect(PANE_LABEL[tab.id]).toBe(tab.label);
  });

  it("names the question lists, the concept scopes, the edge families and the actions", () => {
    expect(QUESTION_LIST_LABEL).toEqual({ this_slide: "This slide", related_concepts: "Related concepts", all_lecture: "All lecture questions" });
    expect(CONCEPT_SCOPE_LABEL).toEqual({ course: "Course", lecture: "Lecture", slide: "This slide" });
    expect(FAMILIES.map((family) => EDGE_FAMILY[family].label)).toEqual(["Assessment", "Source", "Structure"]);
    expect(R2_ACTION.next_content).toBe("Next content");
    expect(R2_ACTION.whole_recording).toBe("Whole recording");
    expect(R2_ACTION.repeat).toBe("Repeat");
    expect(R2_ACTION.accept).toBe("Accept");
    expect(R2_ACTION.reject).toBe("Reject");
    expect(R2_ACTION.refresh).toBe("Refresh");
    expect(R2_ACTION.reload).toBe("Reload");
    expect(R2_ACTION.concept_map).toBe("Concept map");
  });

  it("names the stages of lecture timing with the preparation words of the flow", () => {
    expect(STAGES.map((stage) => TIMING_STAGE_LABEL[stage])).toEqual(["No recording", "Inventoried, not transcribed yet", "Transcribed in part", "Transcribed, slides not linked yet", "Slide-linked"]);
  });
});

describe("concept graph: legend and freshness", () => {
  it("never calls a line of the outline a prerequisite or an overlap", () => {
    // The family "structure" holds two things: what a topic or concept holds in the outline, and the owner's relations
    // between questions. A course or lecture graph without a focus draws only the first.
    expect(edgeLegendKind({ family: "structure", relation: "topic_includes_concept" })).toBe("hierarchy");
    expect(edgeLegendKind({ family: "structure", relation: "topic_includes_skill" })).toBe("hierarchy");
    expect(edgeLegendKind({ family: "structure", relation: "concept_assessed_as_skill" })).toBe("hierarchy");
    expect(edgeLegendKind({ family: "structure", relation: "partial_overlap" })).toBe("prerequisite_or_overlap");
    expect(edgeLegendKind({ family: "structure", relation: "diagnostic_prerequisite" })).toBe("prerequisite_or_overlap");
    expect(edgeLegendKind({ family: "assessment", relation: "question_has_criterion" })).toBe("assessment");
    expect(edgeLegendKind({ family: "source", relation: "slide_supports" })).toBe("source");
    expect(EDGE_LEGEND.prerequisite_or_overlap.label).toBe("Prerequisite or overlap"); // the contract's words, for the edges they are true of
    expect(EDGE_LEGEND.hierarchy.label).toBe("Outline");
    expect(EDGE_LEGEND.assessment).toMatchObject({ label: "Assessment", family: "assessment" });
    expect(EDGE_LEGEND.source).toMatchObject({ label: "Source", family: "source" });
    for (const kind of ["hierarchy", "prerequisite_or_overlap"] as const) expect(EDGE_LEGEND[kind].family).toBe("structure");
    const course = sampleConceptGraphCourse.edges.map((edge) => EDGE_LEGEND[edgeLegendKind(edge)].label);
    expect(new Set(course)).toEqual(new Set(["Outline"]));
    for (const family of FAMILIES) expect(`${EDGE_FAMILY[family].label} ${EDGE_FAMILY[family].meaning}`).not.toMatch(/^Prerequisite or overlap/);
    expect(EDGE_FAMILY.structure.meaning).toMatch(/outline/);
    expect(EDGE_FAMILY.structure.meaning).toMatch(/prerequisite or overlap/);
  });

  it("lists in the legend only what is drawn, in one order, and words each relation by its own label", () => {
    expect(edgeLegendKinds(sampleConceptGraphCourse.edges)).toEqual(["hierarchy"]);
    expect(edgeLegendKinds(sampleConceptGraphLecture.edges)).toEqual(["assessment", "hierarchy", "prerequisite_or_overlap"]);
    expect(edgeLegendKinds([...sampleConceptGraphSlide.edges].reverse())).toEqual(["assessment", "source", "hierarchy", "prerequisite_or_overlap"]);
    expect(edgeLegendKinds([])).toEqual([]);
    expect(edgeRelationLabel("topic_includes_concept")).toBe("topic includes concept");
    expect(edgeRelationLabel("strict_containment")).toBe("is fully contained in"); // a containment between questions is worded as containment, never as a prerequisite
    expect(edgeRelationLabel("strict_containment")).not.toMatch(/prerequisite/);
    expect(edgeRelationLabel("question_has_criterion")).toBe("question has criterion");
    expect(edgeRelationLabel("slide_supports")).toBe("supported on this slide");
    expect(edgeRelationLabel("some_owner_label")).toBe("some owner label"); // the owner's label as recorded
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) for (const edge of graph.edges) expect(edgeRelationLabel(edge.relation).trim()).not.toBe("");
  });

  it("has words for every revision key a view can report as changed, and prints none as undefined", () => {
    const keys = new Set([...Object.keys(sampleRevisions), ...Object.keys(sampleConceptGraphCourse.revisions), ...Object.keys(sampleConceptGraphSlide.revisions)]);
    expect([...keys].sort()).toEqual(["anchor_revision", "deck_sha256", "evidence_revision", "inferred_anchors_sha256", "map_revision", "policy_revision", "question_index_sha256", "scope_revision",
      "skills_sha256", "timing_links"]);
    for (const key of keys) expect((REVISION_KEY_LABEL as Record<string, string | undefined>)[key]).toBeTruthy();
    expect(revisionKeyLabel("anchor_revision")).toBe("the question links of this lecture");
    expect(revisionKeyLabel("skills_sha256")).toBe("the skills catalog");
    expect(revisionKeyLabel("policy_revision")).toBe("the app's policy settings");
    expect(revisionKeyLabel("a_key_of_a_later_brain")).toBe("a key of a later brain"); // shown as recorded, never "undefined"
  });

  it("says in one line that a view is older than its inputs, naming what changed, and says nothing when it is current", () => {
    expect(staleViewLine([])).toBeNull();
    // the five lines of the design specification (9.9), one per key
    expect(staleViewLine(["question_index_sha256"])).toBe("This list was made before the question catalog changed.");
    expect(staleViewLine(["map_revision"])).toBe("This list was made before the slide groups or roles changed.");
    expect(staleViewLine(["deck_sha256"])).toBe("This list was made before the slide groups or roles changed.");
    expect(staleViewLine(["inferred_anchors_sha256"])).toBe("This list was made before the suggested links changed.");
    expect(staleViewLine(["timing_links"])).toBe("These ranges were made before the recording ranges were rebuilt.");
    expect(staleViewLine(["evidence_revision"])).toBe("This list was made before a new attempt was recorded.");
    // several keys: the reasons are joined in one sentence, each once
    expect(staleViewLine(["evidence_revision", "question_index_sha256"])).toBe("This list was made before a new attempt was recorded and the question catalog changed.");
    expect(staleViewLine(["map_revision", "deck_sha256", "map_revision"])).toBe("This list was made before the slide groups or roles changed.");
    expect(staleViewLine(["map_revision", "timing_links", "scope_revision"])).toBe("This list was made before the slide groups or roles changed, the recording ranges were rebuilt and what this scope holds changed.");
    // the keys of a concept graph that the specification's table does not list
    expect(staleViewLine(["anchor_revision"])).toBe("This list was made before the question links of this lecture changed.");
    expect(staleViewLine(["skills_sha256", "policy_revision"])).toBe("This list was made before the skills catalog changed and the app's policy settings changed.");
    // the caller may name what it shows
    expect(staleViewLine(["anchor_revision"], "view")).toBe("This view was made before the question links of this lecture changed.");
    expect(staleViewLine(["timing_links"], "list")).toBe("This list was made before the recording ranges were rebuilt.");
    expect(staleViewLine(["unknown_key"])).toBe("This list was made before unknown key changed."); // a key of a later Brain, as recorded
    expect(staleViewLine(["unknown_key"])).not.toMatch(/undefined/);
  });
});

// ---- design specification, section 9: "State mapping from the read API" ------------------------------------------------------
// The words below are those of .local/reports/experience-repair-v2/design/final/DESIGN_SPEC.md, section 9, except where
// the UI contract names other words (the contract wins; those cases are asserted in the blocks above).
describe("design specification 9: one fact on one line, and a value without words", () => {
  it("binds a fact with non-breaking spaces and ties a count to its noun", () => {
    expect(nb("Range 1 of 2")).toBe("Range 1 of 2");
    expect(nb("")).toBe("");
    expect(countLabel(1, "question")).toBe("1 question");
    expect(countLabel(18, "question")).toBe("18 questions");
    expect(countLabel(0, "question")).toBe("0 questions");
    expect(countLabel(2, "copy", "copies")).toBe("2 copies");
    expect(transcriptLinesRef([[120, 164]])).toBe(nbsp("transcript lines 120–164"));
    expect(transcriptLinesRef([[40, 40]])).toBe(nbsp("transcript line 40"));
    expect(transcriptLinesRef([[120, 164], [402, 411]])).toBe(`${nbsp("transcript lines 120–164")}, ${nbsp("402–411")}`);
    expect(transcriptLinesRef([])).toBe("");
  });

  it("shows a value this build has no words for as recorded, never as the nearest known label", () => {
    expect(unlistedLabel("some_new_value")).toBe("some new value");
    expect(establishedWords("odd_state")).toBe("odd state");
    expect(qualityStateLabel("human_entered")).toBe("human entered");
    expect(printedBasisLabel("other_basis")).toBe("other basis");
  });
});

describe("design specification 9.2 and 9.3: identity on request, groups and how something was established", () => {
  it("words the basis of a printed number and of a PowerPoint match", () => {
    expect(PRINTED_BASIS_LABEL).toEqual({ printed_on_page: "printed on the page", correction: "entered as a correction" });
    expect(printedBasisLabel("printed_on_page")).toBe("printed on the page");
    expect(pptxMatchLabel({ match_basis: "title_and_text", match_state: "generated" })).toBe("matched by title and text, generated");
    expect(pptxMatchLabel({ match_basis: null, match_state: "agent_reviewed" })).toBe("matched, agent-reviewed");
    expect(NO_PPTX_MATCH_LABEL).toBe("No match is recorded for this page");
    expect(copyOfOneSlideLabel({ ordinal: 2, of: 2, kind: "copy" })).toBe(`${nbsp("Copy 2 of 2")} of one slide`);
  });

  it("says how a role, a grouping or a match was established in three words, and 'not established' for none", () => {
    expect(ESTABLISHED_WORDS).toEqual({ generated: "generated", agent_reviewed: "agent-reviewed", human_confirmed: "human-confirmed" });
    expect(NOT_ESTABLISHED).toBe("not established");
    expect(establishedWords(null)).toBe("not established");
    expect(establishedWords("human_confirmed")).toBe("human-confirmed");
    expect(roleStateLabel({ state: "generated", uncertain: true })).toBe("generated, uncertain");
    expect(roleStateLabel({ state: "human_confirmed", uncertain: false })).toBe("human-confirmed");
    expect(roleStateLabel({ state: null, uncertain: false })).toBe("not established");
    for (const slide of sampleLectureView.slides) expect(roleStateLabel(slide.role!)).toMatch(/^(generated|agent-reviewed|human-confirmed)(, uncertain)?$/);
  });

  it("words a group row by the group's own word and its pages, and a grouping by its basis, state and signals", () => {
    expect(groupRowLabel("build_group", [3, 4, 5])).toBe("3 builds, pp. 3–5");
    expect(groupRowLabel("step_group", [6, 7])).toBe("2 steps, pp. 6–7");
    expect(groupRowLabel("duplicate_group", [40, 41])).toBe("2 copies, pp. 40–41");
    expect(groupRowLabel("manual_group", [50, 51, 52], "human_confirmed")).toBe("3 pages grouped by you, pp. 50–52");
    expect(groupRowLabel("manual_group", [50, 51, 52], "generated")).toBe("3 pages grouped by a correction, pp. 50–52");
    expect(groupRowLabel("manual_group", [50, 51, 52])).toBe("3 pages grouped by a correction, pp. 50–52"); // "by you" only for a grouping the learner confirmed
    expect(groupRowLabel("single", [9])).toBeNull(); // a single page has no count line
    expect(GROUPING_BASIS_LABEL).toEqual({ page: null, inferred: "inferred from the file", pptx: "from the PowerPoint file", override: "set by a correction" });
    expect(groupingLabel({ basis: "inferred", state: "generated", confidence: "high", signals: ["same_heading", "ordered_text_containment"] })).toBe("inferred from the file, generated: same heading, ordered text containment");
    expect(groupingLabel({ basis: "override", state: "human_confirmed", confidence: null, signals: [] })).toBe("set by a correction, human-confirmed");
    expect(groupingLabel({ basis: "page", state: "generated", confidence: "high", signals: [] })).toBe("generated");
  });

  it("says in full what a range over a structural page is", () => {
    expect(TOPIC_DISCUSSION_SENTENCE).toBe("Discussion of the topic. Not evidence of what was displayed.");
  });
});

describe("design specification 9.4 and 9.5: recording ranges", () => {
  it("words the method, and says in full what each kind of range is", () => {
    expect(methodWords({ name: "lexical-sequence", version: "2" })).toBe("wording match");
    expect(methodWords({ name: "transcript-cue-match", version: null })).toBe("transcript-cue-match"); // any other name as it is
    expect(methodWords(null)).toBe("");
    expect(rangeKindInFull(sampleRangeFirstVisit)).toBe("Made by the method lexical-sequence, version 2. Nobody has checked it.");
    expect(rangeKindInFull({ origin: "pipeline", review_state: "generated", method: { name: "transcript-cue-match", version: null } })).toBe("Made by the method transcript-cue-match. Nobody has checked it.");
    expect(rangeKindInFull({ origin: "pipeline", review_state: "generated", method: null })).toBe("Made by a method that was not recorded. Nobody has checked it.");
    expect(rangeKindInFull(sampleRangeSection)).toBe("The course's study map pairs these pages with transcript lines; the times of those lines are generated.");
    expect(rangeKindInFull(sampleRangeSecondVisit)).toBe("Checked by a second pass. Not confirmed by you.");
    expect(rangeKindInFull(sampleRangeManual)).toBe("You entered this range.");
    expect(rangeKindInFull(sampleRangeConfirmed)).toBe("A suggestion you confirmed.");
    for (const range of [sampleRangeFirstVisit, sampleRangeSecondVisit, sampleRangeSection, sampleRangeBuildGroup]) expect(rangeKindInFull(range)).not.toMatch(/you (entered|confirmed)/);
  });

  it("says where a range applies: this page, the whole group in the group's own word, a region, or a section of the lecture", () => {
    expect(rangeSupportLine(sampleRangeFirstVisit.support)).toEqual({ short: "this page", full: "this page" });
    expect(rangeSupportLine(sampleRangeBuildGroup.support, "build")).toEqual({ short: nbsp("all 3 builds"), full: "the whole group, pp. 3–5; no time is given per build" });
    expect(rangeSupportLine({ scope: "build_group", pages: [6, 7], builds: null }, "step")).toEqual({ short: nbsp("all 2 steps"), full: "the whole group, pp. 6–7; no time is given per step" });
    expect(rangeSupportLine(sampleRangeBuildGroup.support)).toEqual({ short: "the whole build group", full: "the whole group, pp. 3–5; no time is given per page" }); // the kind of group is not known here
    expect(rangeSupportLine({ scope: "region", pages: [5], builds: null })).toEqual({ short: "a region of this page", full: "a region of this page" });
    expect(rangeSupportLine(sampleRangeSection.support)).toEqual({ short: "a section of the lecture, pp. 2–5",
      full: "a section of the lecture, pp. 2–5, by the course's study map; no time is given for this page alone" });
    expect(rangeSupportLine(sampleRangeSection.support).full).not.toMatch(/slides? \d/); // page indices are never worded as slide numbers
  });

  it("words the three qualities' states, the displayed relation and the recording", () => {
    expect(qualityStateLabel("generated_unreviewed")).toBe("Generated on this PC from the audio. Not reviewed.");
    expect(qualityStateLabel("candidate")).toBe("Candidate.");
    expect(qualityStateLabel("generated")).toBe("Generated.");
    expect(qualityStateLabel("agent_reviewed")).toBe("Agent-reviewed.");
    expect(qualityStateLabel("human_confirmed")).toBe("Human-confirmed.");
    expect(DISPLAYED_SENTENCE).toBe("Frames of this recording were inspected for this interval.");
    expect(LECTURE_RECORDING_LABEL).toBe("Lecture recording");
    expect(recordingLabel([{ source_id: "a", filename: "one.m4a" }], "a")).toBe("Lecture recording");
    expect(recordingLabel([{ source_id: "a", filename: "one.m4a" }, { source_id: "b", filename: "two.m4a" }], "b")).toBe("two.m4a");
    expect(recordingLabel([{ source_id: "a", filename: "one.m4a" }, { source_id: "b", filename: null }], "b")).toBe("Recording");
    expect(recordingLabel([], "c")).toBe("Recording");
  });

  it("writes 'No recording range' in the outline for four of the six states only", () => {
    expect(NO_RANGE_OUTLINE_LINE).toBe("No recording range");
    expect(NO_RANGE_STATES.filter((state) => noRangeInOutline(state))).toEqual(["audio_unprocessed", "association_not_run", "ambiguous", "not_discussed"]);
    expect(noRangeInOutline("no_range_expected")).toBe(false); // never on a structural page
    expect(noRangeInOutline("recording_unavailable")).toBe(false);
  });
});

describe("design specification 9.6 and 9.7: question ties", () => {
  it("gives each course tie its sentence, and a section tie its heading and sentence in pages", () => {
    expect(TIE_SENTENCE).toEqual({ exact: "A reviewed anchor of the course record names this page.", stated: "The course record names this page. Its page basis is not reviewed." });
    expect(sectionTieSentence({ page_ranges: [[20, 27]], label: null, row: 1, scope: "all" })).toBe("The course's study map places it in pp. 20–27 and names no single page.");
    expect(sectionTieSentence({ page_ranges: [[20, 27]], label: null, row: 1, scope: "part" })).toBe("The course's study map places part of it in pp. 20–27 and names no single page.");
    expect(sectionTieSentence({ page_ranges: [], label: null, row: null, scope: null })).toBe("The course's study map places it in a part of the lecture and names no single page.");
    expect(sectionHeading({ page_ranges: [[20, 27]], label: null, row: 1, scope: "all" })).toBe("In this part of the lecture, by the course's study map: pp. 20–27");
    expect(sectionHeading({ page_ranges: [[2, 5]], label: "Sample section", row: 1, scope: "all" })).toBe("In this part of the lecture, by the course's study map: pp. 2–5 (Sample section)");
    expect(sectionHeading({ page_ranges: [], label: null, row: null, scope: null })).toBe("In this part of the lecture, by the course's study map");
    // a page index is never worded as a slide number (UI contract: "Slide N" is never derived from the page index)
    expect(`${sectionHeading({ page_ranges: [[20, 27]], label: null, row: 1, scope: "all" })} ${sectionTieSentence({ page_ranges: [[20, 27]], label: null, row: 1, scope: "all" })}`).not.toMatch(/slides? \d/);
  });

  it("labels a suggested link by how far it got, and never hides a rejection by the checking pass behind the learner's confirmation", () => {
    expect(suggestedLinkLabel({ state: "agent_inferred", verdict: null, learner_decision: null })).toBe("Suggested link, not yet checked");
    expect(suggestedLinkLabel({ state: "agent_reviewed", verdict: "upheld", learner_decision: null })).toBe("Suggested link, checked by a second pass");
    expect(suggestedLinkLabel({ state: "agent_reviewed", verdict: "narrowed", learner_decision: null })).toBe("Suggested link, checked by a second pass");
    expect(suggestedLinkLabel({ state: "agent_reviewed", verdict: "narrowed", learner_decision: "confirmed" })).toBe("Suggested link, confirmed by you");
    expect(suggestedLinkLabel({ state: "agent_inferred", verdict: null, learner_decision: "confirmed" })).toBe("Suggested link, confirmed by you");
    expect(suggestedLinkLabel(sampleTieKeptByConfirmation)).toBe("Suggested link, rejected by a second pass, kept because you confirmed it");
    expect(NARROWED_SENTENCE).toBe("The second pass kept fewer pages or criteria than first proposed.");
    for (const text of [suggestedLinkLabel({ state: "agent_reviewed", verdict: "upheld", learner_decision: null }), NARROWED_SENTENCE]) expect(text).not.toMatch(/confirmed|verified|reviewed by you/i);
    expect(DECISION_NOTE).toBe("Your decision is kept on this device and survives new suggestions.");
    expect(R2_ACTION.take_back).toBe("Take back");
    expect(R2_ACTION.show_it).toBe("Show it");
  });

  it("writes the support sentence with the criteria named by number and concept, in part when partial, and never as the whole answer", () => {
    const partial = sampleLectureView.slides[3]!.question_ties!.find((tie) => tie.question_id === "S90-Q04")!;
    if (partial.tie !== "agent_inferred") throw new Error("the sample's fourth question carries a suggested link");
    expect(criterionName(partial.criteria[0]!)).toBe(`${nbsp("criterion 1")} (Sample concept one)`);
    expect(criterionName({ number: 2, concept_label: null })).toBe(nbsp("criterion 2"));
    expect(supportSentence(partial)).toBe(`Supports ${nbsp("2 of 3 criteria")}, each in part: ${nbsp("criterion 1")} (Sample concept one) and ${nbsp("criterion 3")} (Sample concept three).`);
    expect(supportSentence(partial, [4, 9])).toBe(`pp. 4, 9 support ${nbsp("2 of 3 criteria")}, each in part: ${nbsp("criterion 1")} (Sample concept one) and ${nbsp("criterion 3")} (Sample concept three).`);
    expect(supportSentence({ ...partial, coverage: "main" }, [4])).toBe(`p. 4 supports ${nbsp("2 of 3 criteria")}: ${nbsp("criterion 1")} (Sample concept one) and ${nbsp("criterion 3")} (Sample concept three).`);
    const all = sampleLectureView.slides[4]!.question_ties!.find((tie) => tie.question_id === "S90-Q03")!;
    if (all.tie !== "agent_inferred") throw new Error("the sample's third question carries a suggested link");
    expect(supportSentence(all)).toBe(`Supports ${nbsp("2 of 2 criteria")}: ${nbsp("criterion 1")} (Sample concept one) and ${nbsp("criterion 2")} (Sample concept two).`);
    expect(supportSentence(all)).not.toMatch(/whole|all |every|complete|teaches|answers|covers/i); // also when n equals m
    expect(supportSentence({ criteria_supported: 0, criteria_total: 0, criteria: [], coverage: "partial" })).toBe(NO_CRITERIA_SENTENCE);
    expect(NO_CRITERIA_SENTENCE).toBe("No criteria are catalogued for this question. The link supports the part of the prompt named below.");
    expect(supportSentence({ criteria_supported: 1, criteria_total: 3, criteria: [], coverage: "main" })).toBe(`Supports ${nbsp("1 of 3 criteria")}.`); // the criteria were not named: none is made up
  });

  it("counts what this page supports from the count per page, else only for a tie of this page alone, and never by dividing", () => {
    expect(pageSupportCount({ criteria_supported_here: 1, criteria_supported: 2, support_pages: [4, 5] }, 4)).toBe(1);
    expect(pageSupportCount({ criteria_supported_here: 0, criteria_supported: 2, support_pages: [4, 5] }, 4)).toBe(0);
    expect(pageSupportCount({ criteria_supported: 2, support_pages: [4] }, 4)).toBe(2);
    expect(pageSupportCount({ criteria_supported_here: null, criteria_supported: 2, support_pages: [4] }, 4)).toBe(2);
    expect(pageSupportCount({ criteria_supported: 2, support_pages: [4, 5] }, 4)).toBeNull(); // not recorded per page: the sentence is left out
    expect(pageSupportCount({ criteria_supported: 2, support_pages: [5] }, 4)).toBeNull();
    expect(pageSupportSentence(1, 4)).toBe(`This page supports ${nbsp("1 of 4")}.`);
    expect(pageSupportSentence(null, 4)).toBeNull();
  });

  it("says through which concept a related question is reached, that it is no claim about the slide, and when only a suggestion leads to it", () => {
    expect(relatedSentence([{ concept_id: "c1", label: "Rate law" }])).toBe("Through 'Rate law'. Not a claim about this slide.");
    expect(relatedSentence([{ concept_id: "c1", label: "Rate law" }, { concept_id: "c2", label: "Half-life" }])).toBe("Through 'Rate law' and 'Half-life'. Not a claim about this slide.");
    expect(relatedSentence([{ concept_id: "c1", label: "Rate law", basis: "suggested_link" }])).toBe("Through 'Rate law', a concept that a suggested link says this slide supports. Not a claim about this slide.");
    expect(relatedSentence([{ concept_id: "c1", label: "Rate law", basis: "page_concepts" }, { concept_id: "c2", label: "Half-life", basis: "suggested_link" }])).toBe("Through 'Rate law' and 'Half-life'. Not a claim about this slide.");
    expect(relatedSentence([])).toBe("Not a claim about this slide.");
  });

  it("gives each recorded reason of 'No suggested link' its sentence, and never says whether the question was examined", () => {
    expect(NO_LINK_REASON_SENTENCE).toEqual({
      no_file: "None has been produced for this course yet.", no_item: "None is recorded for this question.", stale: "The suggestions were made for an earlier version.",
      rejected_by_learner: "You rejected the one that was suggested.", file_unreadable: "The suggestions file could not be read.",
    });
    for (const reason of NO_LINK_REASONS) expect(noLinkSentence(sampleNoLinkReasons[reason])).toBe(NO_LINK_REASON_SENTENCE[reason]);
    for (const text of wordings(NO_LINK_REASON_SENTENCE)) expect(text).not.toMatch(/inspect|examin/i);
    expect(noLinkSentence({ state: "inspected_no_support", reason: "A synthetic note." })).toBe("A synthetic note."); // the checking pass's own words
  });
});

describe("design specification 9.8: evidence beside a state", () => {
  it("says the attempts beside each state, and never draws unknown as zero work", () => {
    expect(evidenceAttemptsLabel({ state: "independent", attempts: 2 })).toBe("2 attempts");
    expect(evidenceAttemptsLabel({ state: "assisted", attempts: 1 })).toBe("1 attempt");
    expect(evidenceAttemptsLabel({ state: "not_separately_observed", attempts: 1 })).toBe("1 attempt on a combined question");
    expect(evidenceAttemptsLabel({ state: "unknown", attempts: 0 })).toBe("no recorded attempt");
    expect(evidenceAttemptsLabel({ state: "unknown", attempts: 3 })).toBe("how it was done was not recorded");
    expect(evidenceAttemptsLabel({ state: "not_applicable", attempts: 0 })).toBeNull();
    expect(evidenceAttemptsLabel({ state: "not_separately_observed", attempts: 0 })).toBeNull(); // no count is recorded: none is written as 0
    expect(evidenceAttemptsLabel({ state: "unknown", attempts: 0 })).not.toMatch(/0/);
  });

  it("orders the line as state with its kind, attempts, then prior exposure, which is shown only when the question was seen", () => {
    expect(evidenceLine(sampleEvidence.assisted)).toBe("Assisted: solution shown · 1 attempt · prior exposure");
    expect(evidenceLine(sampleEvidence.independent)).toBe("Independent · 2 attempts · prior exposure"); // seen before, no help: Independent, with prior exposure beside it
    expect(evidenceLine(sampleEvidence.unknown)).toBe("Unknown · no recorded attempt");
    expect(evidenceLine(sampleEvidence.not_applicable)).toBe("Not applicable");
    expect(evidenceLine(sampleEvidence.not_separately_observed)).toBe("Not separately observed"); // unseen adds nothing to a row
  });

  it("writes the summary as counts with their denominator", () => {
    expect(evidenceSummarySentence({ independent: 0, assisted: 1, not_separately_observed: 2, observations: 3 })).toBe("Of 3 recorded observations: 0 independent, 1 assisted, 2 not separately observed.");
    expect(evidenceSummarySentence({ independent: 1, assisted: 0, not_separately_observed: 0 })).toBe("Of 1 recorded observation: 1 independent, 0 assisted, 0 not separately observed.");
    expect(evidenceSummarySentence({ independent: 1, assisted: 0, not_separately_observed: 0, unknown: 2 })).toBe("Of 3 recorded observations: 1 independent, 0 assisted, 0 not separately observed, 2 unknown.");
    expect(evidenceSummarySentence({ independent: 1, assisted: 1, not_separately_observed: 0 })).not.toMatch(/%|master|score/i);
  });
});

describe("design specification 9.9 and 9.10: concepts and timing", () => {
  it("states the scope in the heading with how many concepts, skills and questions it holds", () => {
    const totals = { topic: 1, concept: 3, skill: 5, question: 2, criterion: 9 };
    expect(conceptScopeHeading({ kind: "slide" }, totals)).toBe("On this slide: 3 concepts, 5 skills, 2 questions");
    expect(conceptScopeHeading({ kind: "lecture" }, { ...totals, concept: 8, skill: 12, question: 20 }, "Lecture 03")).toBe("Lecture 03: 8 concepts, 12 skills, 20 questions");
    expect(conceptScopeHeading({ kind: "lecture" }, totals)).toBe("Lecture: 3 concepts, 5 skills, 2 questions");
    expect(conceptScopeHeading({ kind: "course" }, { ...totals, concept: 1, skill: 1, question: 1 })).toBe("Course: 1 concept, 1 skill, 1 question");
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) expect(conceptScopeHeading(graph.scope, graph.totals)).toMatch(/^(Course|Lecture|On this slide): \d+ concepts?, \d+ skills?, \d+ questions?$/);
  });

  it("leaves a count that does not apply out of a node's line, and says that the catalog holds no definition", () => {
    expect(nodeCountsLabel({ skills: 2, questions: 5 })).toBe("2 skills, 5 questions");
    expect(nodeCountsLabel({ skills: null, questions: 1 })).toBe("1 question");
    expect(nodeCountsLabel({ skills: 0, questions: 0 })).toBe("0 skills, 0 questions"); // a recorded zero is a count; null is not
    expect(nodeCountsLabel({ skills: null, questions: null })).toBe("");
    expect(DEFINITION_GAP_SENTENCE).toBe("The catalog holds no definition for this concept.");
  });

  it("states what generated speech text covers, with its gaps, and that it is generated and not reviewed", () => {
    const whole = { generation: "g", text_origin: "generated_speech_text", review_state: "generated_unreviewed", covered_intervals: [[0, 5_818_000]] as Array<[number, number]>, unresolved_intervals: [], unresolved_ms: 0,
      coverage_fraction: 1, covers_whole_recording: true };
    expect(generatedCoverageSentence(whole)).toBe("Covers 0:00 – 1:36:58 of the recording.");
    expect(generatedCoverageSentence({ ...whole, covered_intervals: [[0, 1_500_000], [1_560_000, 1_800_000]], unresolved_intervals: [[1_500_000, 1_560_000]] }))
      .toBe("Covers 0:00 – 25:00 and 26:00 – 30:00 of the recording. Not resolved: 25:00 – 26:00.");
    expect(generatedCoverageSentence({ ...whole, covered_intervals: [] })).toBe("Covers no part of the recording yet.");
    expect(generatedCoverageSentence(null)).toBe(NO_GENERATED_TEXT_SENTENCE);
    expect(NO_GENERATED_TEXT_SENTENCE).toBe("No speech text has been generated for this recording.");
    expect(GENERATED_TEXT_NOTE).toMatch(/generated, not reviewed/i); // the UI contract's phrase
    expect(GENERATED_TEXT_NOTE).toBe("Generated, not reviewed. Made on this PC.");
  });

  it("words text alignment and slide matching as sentences, with the counts the Brain reports", () => {
    const method = { name: "anchored-token-alignment", version: "2" };
    expect(textAlignmentSentence({ state: "accepted", reason: null, lines_aligned: 310, lines_total: 420, method }))
      .toBe("310 of 420 lines have a time. A line shows a time only where text alignment supports it; the times are generated and not reviewed.");
    expect(textAlignmentSentence({ state: "refused", reason: "low_agreement", lines_aligned: 0, lines_total: 420, method })).toBe("The generated text and this transcript do not correspond well enough, so no line has a time (low agreement).");
    expect(textAlignmentSentence({ state: "refused", reason: null, lines_aligned: 0, lines_total: 420, method })).toBe("The generated text and this transcript do not correspond well enough, so no line has a time.");
    expect(textAlignmentSentence({ state: "not_run", reason: null, lines_aligned: null, lines_total: null, method: null })).toBe("Times have not been worked out for this transcript.");
    expect(textAlignmentSentence({ state: "no_transcript", reason: null, lines_aligned: null, lines_total: null, method: null })).toBeNull(); // the section is absent
    const summary = { pages: 91, pages_with_range: 58, pages_no_range_expected: 8, pages_without_range: 25, ranges: 61, human_confirmed: 0, agent_reviewed: 0, generated: 61 };
    expect(associationSentence("current", summary)).toBe("61 ranges for 58 of 91 pages; 8 pages expect none.");
    expect(associationSentence("current", { ...summary, ranges: 1, pages_no_range_expected: 1 })).toBe("1 range for 58 of 91 pages; 1 page expects none.");
    expect(associationSentence("current")).toBe("Slide-linked.");
    expect(associationSentence("stale", summary)).toBe("The ranges were made from earlier inputs and are not shown as current.");
    expect(associationSentence("not_run")).toBe("Slide matching has not run.");
  });
});
