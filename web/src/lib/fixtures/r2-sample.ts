// SYNTHETIC sample objects of amendment R2, typed with ../types, for component tests and stories.
//
// Nothing here is course material: every id, title, prompt, rationale, time and digest was written for this file, and
// no number in it is a measurement. The lecture view is laid out so that every state a screen has to word occurs once:
//
//   page  1      structural title page                       no range expected
//   page  2      single page, printed "Slide 2"              two separate ranges + one section range; exact tie
//   pages 3-5    build group of three                        one group-level range; stated, suggested (checked and
//                                                            unchecked, partial with per-page support) ties
//   pages 6-7    step group of two                           page 6 ambiguous (candidates); page 7 a link the learner confirmed
//   page  8      worked example, printed 5 / PowerPoint 6    not discussed; suggested tie the learner confirmed
//   page  9      single page                                 audio not processed yet; the partial tie's other page
//   page 10      objectives or summary                       not matched yet (inputs changed)
//   page 11      role unknown                                recording unavailable
//   page 12      administrative page                         a range entered by the learner over a structural page
//
// The six no-range states stand side by side so each line can be rendered. A real lecture would not show "recording
// unavailable" on one page and ranges of that recording on another.
import type {
  ConceptGraphEdge, ConceptGraphNode, ConceptGraphRevisions, ConceptGraphView, CourseTieFields, CourseTimingView, EvidenceObject, EvidenceState, InferredAnchorsReadback, LectureQuestionTie,
  LectureSuggestedTie, LectureTiming, LectureView, LogicalSlide, NoLink, NoLinkReason, NoRange, NoRangeState, QuestionRow, RelatedConceptBasis, RelatedQuestion, SlideCourseTie, SlideIdentity,
  SlideQuestionTie, SlideRole, SlideRoleValue, SlideSectionTie, SlideSuggestedTie, SlideView, SourceIdentity, SourceMapDocument, SourceMapReady, SuggestionDecisionResponse, TieCriterion, TieWhere,
  TimingRange, TimingRecording, ViewRevisions,
} from "../types";

export const SAMPLE_COURSE_ID = "sample-course";
export const SAMPLE_LECTURE_ID = "lecture-90";
export const SAMPLE_PAGE_COUNT = 12;
const COLLECTION = "S90";
const DECK: SourceIdentity = { source_id: "src-sample-deck-90", version_id: "v1-dddddddddddd", sha256: "d".repeat(64) };
const RECORDING: SourceIdentity = { source_id: "src-sample-rec-90", version_id: "v1-eeeeeeeeeeee", sha256: "e".repeat(64) };
const MAP_REVISION = "a1b2c3d4e5f60718";
const GENERATION = "sp-sample90-p0008-0a1b2c3d";
const DURATION_MS = 4_800_000; // 1 h 20 min

// ---- evidence: every state once, prior exposure beside it --------------------------------------------------------------
export const sampleEvidence: Record<EvidenceState, EvidenceObject> = {
  unknown: { state: "unknown", assistance: null, prior_exposure: "unknown", attempts: 0, last_at: null },
  not_applicable: { state: "not_applicable", assistance: null, prior_exposure: "unknown", attempts: 0, last_at: null },
  not_separately_observed: { state: "not_separately_observed", assistance: null, prior_exposure: "unseen", attempts: 0, last_at: null },
  assisted: { state: "assisted", assistance: "solution_shown", prior_exposure: "seen", attempts: 1, last_at: "2026-09-20T15:00:00Z" },
  // Seen before and answered without help: prior exposure is its own phrase and is not assistance.
  independent: { state: "independent", assistance: null, prior_exposure: "seen", attempts: 2, last_at: "2026-09-22T09:30:00Z" },
};

// ---- source map --------------------------------------------------------------------------------------------------------
const logicalId = (first: number, last: number = first): string => `ls-dddddddddd-p${first}${last === first ? "" : `-${last}`}`;
const ROLE_OF_PAGE: Record<number, SlideRoleValue> = {
  1: "structural_title_or_section", 2: "instructional", 3: "instructional", 4: "instructional", 5: "instructional", 6: "instructional", 7: "instructional",
  8: "worked_example_or_question", 9: "instructional", 10: "objectives_or_summary", 11: "unknown", 12: "administrative",
};
const TITLE_OF_PAGE: Record<number, string | null> = {
  1: "Sample lecture 90 (synthetic)", 2: "A sample idea, stated", 3: "A sample mechanism, step by step", 4: "A sample mechanism, step by step", 5: "A sample mechanism, step by step",
  6: "A sample diagram in two states", 7: "A sample diagram in two states", 8: "Worked sample", 9: "A second sample idea", 10: "What this sample covered", 11: null, 12: "Sample housekeeping",
};
const single = (page: number): LogicalSlide => ({ id: logicalId(page), kind: "single", pages: [page], title: TITLE_OF_PAGE[page] ?? null, role: ROLE_OF_PAGE[page] ?? "unknown",
  grouping: { basis: "page", state: "generated", confidence: "high", signals: [] } });
const BUILD_GROUP: LogicalSlide = { id: logicalId(3, 5), kind: "build_group", pages: [3, 4, 5], title: "A sample mechanism, step by step", role: "instructional",
  grouping: { basis: "inferred", state: "generated", confidence: "high", signals: ["same_heading", "ordered_text_containment"] } };
const STEP_GROUP: LogicalSlide = { id: logicalId(6, 7), kind: "step_group", pages: [6, 7], title: "A sample diagram in two states", role: "instructional",
  grouping: { basis: "inferred", state: "agent_reviewed", confidence: "medium", signals: ["equal_text", "drawings_not_compared"] } };

export const sampleSourceMap: SourceMapReady = {
  state: "ready", reason: null, contract: "source-map/1", map_revision: MAP_REVISION, source: DECK, page_index_base: 1, page_count: SAMPLE_PAGE_COUNT, page_layout: "slides",
  printed_numbers_established: true,
  pptx: { source_id: "src-sample-pptx-90", state: "supported", matched_pages: 1 },
  logical_slides: [single(1), single(2), BUILD_GROUP, STEP_GROUP, single(8), single(9), single(10), single(11), single(12)],
  denominators: {
    raw: 12, instructional: 8,
    by_role: { instructional: 7, worked_example_or_question: 1, mixed: 0, objectives_or_summary: 1, unknown: 1, structural_title_or_section: 1, administrative: 1, blank: 0 },
    uncertain: 2, excluded: 2,
  },
  limitations: ["Text extraction cannot tell covered text from visible text."],
  override_revision: 1,
};

function identity(page: number, extra: Partial<SlideIdentity> = {}): SlideIdentity {
  const group = [BUILD_GROUP, STEP_GROUP].find((slide) => slide.pages.includes(page));
  const position = group ? { ordinal: group.pages.indexOf(page) + 1, of: group.pages.length, kind: group.kind === "build_group" ? "build" as const : "step" as const } : null;
  const parts = [`PDF page ${page} of ${SAMPLE_PAGE_COUNT}`, ...(position ? [`${position.kind} ${position.ordinal} of ${position.of}`] : [])];
  return { page_index: page, page_count: SAMPLE_PAGE_COUNT, page_label: null, printed_slide_number: null, pptx: null, logical_slide_id: group?.id ?? logicalId(page), position,
    label: parts.join(" · "), label_parts: parts, ...extra };
}
function role(page: number): SlideRole {
  const value = ROLE_OF_PAGE[page] ?? "unknown";
  const structural = value === "structural_title_or_section" || value === "administrative" || value === "blank";
  return { value, state: page === 12 ? "human_confirmed" : page === 8 ? "agent_reviewed" : "generated", uncertain: page === 10 || page === 11, forced_requirements: !structural,
    basis: structural ? ["short_text", "no_figure"] : value === "unknown" ? ["no_text_layer"] : ["body_text"] };
}

// ---- questions ---------------------------------------------------------------------------------------------------------
const questionId = (number: number): string => `${COLLECTION}-Q${String(number).padStart(2, "0")}`;
/** `pages`: the pages the producer says carry the criterion; null when it made no page-by-page statement. */
const criterion = (question: number, number: number, total: number, concept: 1 | 2 | 3, pages: number[] | null = null): TieCriterion => ({
  criterion_id: `${questionId(question)}.C${String(number).padStart(2, "0")}`, number, label: `Criterion ${number} of ${total}`, concept_id: `c-sample-${concept}`,
  concept_label: `Sample concept ${["one", "two", "three"][concept - 1]}`, skill_id: `s-sample-${concept}`, action_types: ["explain"], pages,
});
const NO_SUGGESTION: CourseTieFields = { criteria_supported: null, criteria_total: null, criteria: null, coverage: null, state: null, verdict: null, verdict_note: null, rationale: null, regions: null,
  suggestion_id: null, learner_decision: null };
const EVIDENCE_OF_QUESTION: Record<number, EvidenceObject> = {
  1: sampleEvidence.independent, 2: sampleEvidence.assisted, 3: sampleEvidence.unknown, 4: sampleEvidence.not_separately_observed,
  5: sampleEvidence.unknown, 6: sampleEvidence.unknown, 7: sampleEvidence.unknown, 8: sampleEvidence.unknown,
};
const evidenceOf = (number: number): EvidenceObject => ({ ...(EVIDENCE_OF_QUESTION[number] ?? sampleEvidence.unknown) });
const PROMPT_OF_QUESTION: Record<number, string | null> = {
  1: "Synthetic prompt 1: state the sample idea in one sentence.", 2: "Synthetic prompt 2: put the three steps of the sample mechanism in order.",
  3: "Synthetic prompt 3: name the two parts the last step adds.", 4: "Synthetic prompt 4: compare the second step with the second sample idea.",
  5: "Synthetic prompt 5: work the sample through with other numbers.", 6: "Synthetic prompt 6: say what the sample leaves out.",
  7: "Synthetic prompt 7: give your own example of the sample idea.", 8: null,
};

/** The three suggested links of the sample, as the lecture's question rows carry them. */
const SUGGESTED: Record<3 | 4 | 5, LectureSuggestedTie> = {
  // Checked by a second pass and kept as proposed; supports all the listed criteria — still never "the whole answer".
  3: { tie: "agent_inferred", lecture_id: SAMPLE_LECTURE_ID, source_id: DECK.source_id, pages: [5], logical_slide_ids: [BUILD_GROUP.id], transcript_lines: [], on_displayed_deck: true,
    granularity: "page", from: "inferred_anchor_file", catalog_field: null, section: null, criteria_supported: 2, criteria_total: 2,
    criteria: [criterion(3, 1, 2, 1, [5]), criterion(3, 2, 2, 2, [5])], coverage: "main",
    state: "agent_reviewed", verdict: "upheld", verdict_note: null, rationale: "Synthetic rationale: the last step of the sample mechanism shows both parts these two criteria ask about.", regions: null,
    suggestion_id: "ia-0000000000000003", learner_decision: null },
  // Not yet checked; partial; two pages in two logical slides, each supporting one criterion (stated page by page).
  4: { tie: "agent_inferred", lecture_id: SAMPLE_LECTURE_ID, source_id: DECK.source_id, pages: [4, 9], logical_slide_ids: [BUILD_GROUP.id, logicalId(9)], transcript_lines: [], on_displayed_deck: true,
    granularity: "page", from: "inferred_anchor_file", catalog_field: null, section: null, criteria_supported: 2, criteria_total: 3,
    criteria: [criterion(4, 1, 3, 1, [4]), criterion(4, 3, 3, 3, [9])], coverage: "partial",
    state: "agent_inferred", verdict: null, verdict_note: null,
    rationale: "Synthetic rationale: the second step shows what criterion 1 asks about and the second sample idea what criterion 3 asks about; nothing here supports criterion 2.",
    regions: [{ page: 4, box: [0.1, 0.3, 0.9, 0.7], region_id: "r1" }], suggestion_id: "ia-0000000000000004", learner_decision: null },
  // Narrowed by the checking pass, then accepted by the learner: it stays a suggested link, with "confirmed by you" beside it. Its producer made no page-by-page statement.
  5: { tie: "agent_inferred", lecture_id: SAMPLE_LECTURE_ID, source_id: DECK.source_id, pages: [8], logical_slide_ids: [logicalId(8)], transcript_lines: [], on_displayed_deck: true,
    granularity: "page", from: "inferred_anchor_file", catalog_field: null, section: null, criteria_supported: 1, criteria_total: 3, criteria: [criterion(5, 2, 3, 2)], coverage: "partial",
    state: "agent_reviewed", verdict: "narrowed", verdict_note: "Synthetic note of the checking pass: kept for criterion 2 only; the page does not show what criterion 1 asks about.",
    rationale: "Synthetic rationale: the worked sample carries out the step criterion 2 asks about.", regions: null,
    suggestion_id: "ia-0000000000000005", learner_decision: "confirmed" },
};
const SECTION = { page_ranges: [[2, 5]] as Array<[number, number]>, label: "Sample section: the idea and its mechanism", row: 1 };
const sectionTieOfRow = (scope: "all" | "part" | null): LectureQuestionTie => ({ tie: "stated", lecture_id: SAMPLE_LECTURE_ID, source_id: DECK.source_id, pages: [2, 3, 4, 5],
  logical_slide_ids: [logicalId(2), BUILD_GROUP.id], transcript_lines: [[118, 240]], on_displayed_deck: true, granularity: "section", from: "course_study_map", catalog_field: null,
  section: { ...SECTION, scope }, ...NO_SUGGESTION });
const courseTie = (tie: "exact" | "stated", pages: number[], logical: string[], lines: Array<[number, number]> = []): LectureQuestionTie => ({ tie, lecture_id: SAMPLE_LECTURE_ID,
  source_id: pages.length ? DECK.source_id : "src-sample-transcript-90", pages, logical_slide_ids: logical, transcript_lines: lines, on_displayed_deck: pages.length > 0, granularity: "page",
  from: "course_locator", catalog_field: "locator", section: null, ...NO_SUGGESTION });

function questionRow(number: number, extra: Partial<QuestionRow>): QuestionRow {
  const prompt = PROMPT_OF_QUESTION[number] ?? null;
  return {
    question_id: questionId(number), version: 1, collection: COLLECTION, number, title: `Sample question ${number}`, origin: "lecture", topic: null,
    prompt: prompt ?? "The wording of this question is kept in its source.", prompt_in_index: prompt !== null, family_id: null, family_revision: null, criteria_count: 3,
    criteria_authorship: "catalog", lecture_ids: [SAMPLE_LECTURE_ID], membership: { basis: "cited_source_in_unit", source_ids: [DECK.source_id] }, anchors: [], anchor_state: "unresolved",
    slide_anchor: "none", locator_text: "", qualifiers: [], unparsed: [], original: null, display_rendition: null, related_copy: null, concept_ids: [],
    ties: [], no_link: null, evidence: evidenceOf(number), suggestion_history: { stale: 0, rejected_by_verifier: 0, rejected_by_learner: [] }, ...extra,
  };
}
const QUESTION_ROWS: QuestionRow[] = [
  questionRow(1, { slide_anchor: "named", anchor_state: "resolved", ties: [courseTie("exact", [2], [logicalId(2)], [[120, 164]]), sectionTieOfRow("all")] }),
  questionRow(2, { slide_anchor: "named", anchor_state: "resolved", ties: [courseTie("stated", [3, 4, 5], [BUILD_GROUP.id]), sectionTieOfRow("all")] }),
  questionRow(3, { criteria_count: 2, ties: [SUGGESTED[3]] }),
  questionRow(4, { ties: [SUGGESTED[4]] }),
  questionRow(5, { ties: [sectionTieOfRow("part"), SUGGESTED[5]] }),
  // The two no-link lines.
  questionRow(6, { no_link: { state: "inspected_no_support", reason: "Synthetic note of the checking pass: the proposed page names the term and does not show what the criteria ask about." },
    suggestion_history: { stale: 0, rejected_by_verifier: 1, rejected_by_learner: [] } }),
  questionRow(7, { no_link: { state: "no_suggestion", reason: "no_item" } }),
  // Anchored by the course to transcript lines only: an anchor with no page. Its wording is kept in its source.
  questionRow(8, { anchor_state: "resolved", ties: [courseTie("exact", [], [], [[40, 52]])] }),
];

const slideBase = (number: number) => ({ question_id: questionId(number), collection: COLLECTION, number, title: `Sample question ${number}`, prompt: PROMPT_OF_QUESTION[number] ?? null,
  prompt_in_index: PROMPT_OF_QUESTION[number] != null, evidence: evidenceOf(number) });
const PLACE: Record<TieWhere, string> = { on_this_page: "this page", group_level: "every page of this sequence", elsewhere_in_sequence: "another page of this sequence, not this page" };
function courseTieOnSlide(number: number, tie: "exact" | "stated", where: TieWhere, support: number[], lines: Array<[number, number]> = []): SlideCourseTie {
  return { ...slideBase(number), tie, granularity: "page", from: "course_locator", catalog_field: "locator", section: null, where, support_pages: support, other_pages: [], transcript_lines: lines,
    ...NO_SUGGESTION,
    why: tie === "exact" ? `A reviewed anchor of the course record names ${PLACE[where]}.` : `The course record names ${PLACE[where]}; its page numbers have not been reviewed as physical pages.` };
}
function suggestedTieOnSlide(number: 3 | 4 | 5, where: TieWhere, support: number[], other: number[], here: number): SlideSuggestedTie {
  const { tie, criteria_supported, criteria_total, criteria, coverage, state, verdict, verdict_note, rationale, regions, suggestion_id, learner_decision } = SUGGESTED[number];
  return { ...slideBase(number), tie, granularity: "page", from: "inferred_anchor_file", catalog_field: null, section: null, where, support_pages: support, other_pages: other, transcript_lines: [],
    criteria_supported, criteria_total, criteria, criteria_supported_here: here, coverage, state, verdict, verdict_note, rationale, regions, suggestion_id, learner_decision,
    why: `Suggested by an agent pass from the content of ${PLACE[where]}; ${state === "agent_reviewed" ? "checked by a second agent pass." : "not yet checked by a second pass."}${learner_decision === "confirmed" ? " You confirmed this link." : ""}` };
}
const sectionTieOnSlide = (number: number, scope: "all" | "part" | null): SlideSectionTie => ({ ...slideBase(number), tie: "stated", granularity: "section", from: "course_study_map", catalog_field: null,
  section: { ...SECTION, scope }, where: null, support_pages: [], other_pages: [], transcript_lines: [[118, 240]], ...NO_SUGGESTION,
  why: "The course's study map places this question somewhere in pages 2 to 5; it names no page." });
const SECTION_TIES: SlideSectionTie[] = [sectionTieOnSlide(1, "all"), sectionTieOnSlide(2, "all"), sectionTieOnSlide(5, "part")];

const QUESTION_TIES_OF_PAGE: Record<number, SlideQuestionTie[]> = {
  2: [courseTieOnSlide(1, "exact", "on_this_page", [2], [[120, 164]])],
  3: [courseTieOnSlide(2, "stated", "group_level", [3, 4, 5]), suggestedTieOnSlide(3, "elsewhere_in_sequence", [5], [], 2), suggestedTieOnSlide(4, "elsewhere_in_sequence", [4], [9], 1)],
  4: [courseTieOnSlide(2, "stated", "group_level", [3, 4, 5]), suggestedTieOnSlide(3, "elsewhere_in_sequence", [5], [], 2), suggestedTieOnSlide(4, "on_this_page", [4], [9], 1)],
  5: [courseTieOnSlide(2, "stated", "group_level", [3, 4, 5]), suggestedTieOnSlide(3, "on_this_page", [5], [], 2), suggestedTieOnSlide(4, "elsewhere_in_sequence", [4], [9], 1)],
  8: [suggestedTieOnSlide(5, "on_this_page", [8], [], 1)],
  9: [suggestedTieOnSlide(4, "on_this_page", [9], [4], 1)],
};
const related = (id: string, collection: string, number: number, concept: 1 | 2 | 3, lectureIds: string[], evidence: EvidenceObject, basis: RelatedConceptBasis): RelatedQuestion => ({
  question_id: id, collection, number, title: `Sample question ${id}`, prompt_in_index: true, tie: "concept_related",
  via_concepts: [{ concept_id: `c-sample-${concept}`, label: `Sample concept ${["one", "two", "three"][concept - 1]}`, basis }], lecture_ids: lectureIds, evidence: { ...evidence } });
// Page 2: the shared concept is recorded for the page itself. Pages 3 to 5: the concept is known for the slide only through
// what a SUGGESTED link says it supports, so the related question is reached through a suggestion and is marked so.
const RELATED_OF_PAGE: Record<number, RelatedQuestion[]> = {
  2: [related(questionId(3), COLLECTION, 3, 1, [SAMPLE_LECTURE_ID], sampleEvidence.unknown, "page_concepts"), related("P90-Q01", "P90", 1, 1, [], sampleEvidence.unknown, "page_concepts")],
  3: [related(questionId(1), COLLECTION, 1, 1, [SAMPLE_LECTURE_ID], sampleEvidence.independent, "suggested_link")],
  4: [related(questionId(1), COLLECTION, 1, 1, [SAMPLE_LECTURE_ID], sampleEvidence.independent, "suggested_link")],
  5: [related(questionId(1), COLLECTION, 1, 1, [SAMPLE_LECTURE_ID], sampleEvidence.independent, "suggested_link")],
};

// ---- cases a screen must word that the sample lecture does not hold --------------------------------------------------------
/**
 * A suggested link the checking pass REJECTED after the learner had confirmed it: the Brain keeps it listed (verdict
 * "rejected", state "agent_reviewed", learner_decision "confirmed", the pass's note in `verdict_note`). Never worded as
 * "checked by a second pass": labels.suggestionStatus gives "rejected by a second pass" and "kept because you confirmed it".
 * It is not part of `sampleLectureView`; render it as a row of page 9 to see the state.
 */
export const sampleTieKeptByConfirmation: SlideSuggestedTie = {
  question_id: questionId(10), collection: COLLECTION, number: 10, title: "Sample question 10", prompt: "Synthetic prompt 10: say what the second sample idea adds to the first.", prompt_in_index: true,
  evidence: { ...sampleEvidence.unknown },
  tie: "agent_inferred", granularity: "page", from: "inferred_anchor_file", catalog_field: null, section: null, where: "on_this_page", support_pages: [9], other_pages: [],
  transcript_lines: [], criteria_supported: 1, criteria_total: 3, criteria: [criterion(10, 1, 3, 3, [9])], criteria_supported_here: 1, coverage: "partial", state: "agent_reviewed", verdict: "rejected",
  verdict_note: "Synthetic note of the checking pass: the page names the term and does not show what criterion 1 asks about.",
  rationale: "Synthetic rationale: the second sample idea is what criterion 1 asks about.", regions: null, suggestion_id: "ia-0000000000000006", learner_decision: "confirmed",
  why: "Suggested by an agent pass from the content of this page; a second agent pass rejected it. You confirmed this link, so it is kept.",
};
/** "No suggested link" with each recorded reason, for the line under a question that has neither a course anchor nor a link. */
export const sampleNoLinkReasons: Record<NoLinkReason, NoLink> = {
  no_file: { state: "no_suggestion", reason: "no_file" },
  no_item: { state: "no_suggestion", reason: "no_item" },
  stale: { state: "no_suggestion", reason: "stale" },
  rejected_by_learner: { state: "no_suggestion", reason: "rejected_by_learner" },
  file_unreadable: { state: "no_suggestion", reason: "file_unreadable" },
};
/**
 * A question whose only suggested link the learner rejected: no tie is shown, the line is "No suggested link" with that
 * reason, and the rejected link stays in `suggestion_history.rejected_by_learner` so the rejection can be taken back.
 */
export const sampleQuestionRowRejectedByLearner: QuestionRow = questionRow(9, {
  title: "Sample question 9", prompt: "Synthetic prompt 9: say which of two sample ideas a new case belongs to.", prompt_in_index: true,
  ties: [], no_link: sampleNoLinkReasons.rejected_by_learner,
  suggestion_history: { stale: 0, rejected_by_verifier: 0,
    rejected_by_learner: [{ suggestion_id: "ia-0000000000000009", lecture_id: SAMPLE_LECTURE_ID, source_id: DECK.source_id, pages: [9], learner_decision: "rejected" }] },
});

// ---- ranges ------------------------------------------------------------------------------------------------------------
const QUALITY: TimingRange["quality"] = {
  acoustic: { state: "generated_unreviewed", basis: "Word times of generated speech text; nobody has listened to them." },
  association: { state: "candidate", basis: "Shared wording and the order of the slides." },
  group_mapping: { state: "generated", basis: "The grouping of these pages is a generated suggestion." },
};
function range(id: string, start_ms: number, end_ms: number, extra: Partial<TimingRange>): TimingRange {
  return { range_id: id, recording: RECORDING, timebase: "original_source_start", start_ms, end_ms, relation: "discussed_during", occurrence_index: 1, occurrences_total: 1,
    support: { scope: "page", pages: [], builds: null }, method: { name: "lexical-sequence", version: "2" }, origin: "pipeline", review_state: "generated", quality: QUALITY,
    why: "Follows the wording of the slide", evidence: { transcript_lines: [], terms: ["sample", "idea"], shape: "sustained_clear" }, annotation_id: null, ...extra };
}
/** Page 2, first visit: a suggestion that nobody checked. */
export const sampleRangeFirstVisit = range("tl-sample-p2-o1", 1_072_000, 1_236_000, { occurrence_index: 1, occurrences_total: 2, support: { scope: "page", pages: [2], builds: null },
  evidence: { transcript_lines: [[120, 164]], terms: ["sample", "idea"], shape: "sustained_clear" } });
/** Page 2, second visit: a suggestion a second pass checked. Separate from the first; nothing between them is played. */
export const sampleRangeSecondVisit = range("tl-sample-p2-o2", 2_470_000, 2_525_000, { occurrence_index: 2, occurrences_total: 2, support: { scope: "page", pages: [2], builds: null },
  review_state: "agent_reviewed", why: "Comes back to it while a later page is discussed", evidence: { transcript_lines: [[402, 411]], terms: ["sample"], shape: "brief_return" } });
/** Pages 2 to 5: the course's own pairing of pages with transcript lines. It appears on every page it names and carries no per-page time. */
export const sampleRangeSection = range("tl-sample-sec-r1", 1_050_000, 1_640_000, { support: { scope: "section", pages: [2, 3, 4, 5], builds: null }, origin: "reviewed_source_map",
  method: { name: "course-study-map", version: "1" }, why: "The course's study map pairs these pages with transcript lines 118 to 240", evidence: { transcript_lines: [[118, 240]] } });
/** Pages 3 to 5: one suggested range for the whole build group. It carries no per-build times. */
export const sampleRangeBuildGroup = range("tl-sample-g3-5-o1", 1_236_000, 1_580_000, { support: { scope: "build_group", pages: [3, 4, 5], builds: null },
  evidence: { transcript_lines: [[165, 228]], terms: ["sample", "mechanism"], shape: "sustained_clear" } });
const PERSON_QUALITY = (entered: boolean): TimingRange["quality"] => ({
  acoustic: entered ? { state: "human_entered", basis: "Times as entered or confirmed by a person." } : { state: "recorded_unreviewed", basis: "Times as recorded with the link; nobody has reviewed them." },
  association: { state: "human_confirmed", basis: "Confirmed by a person for this page." },
  group_mapping: { state: "not_applicable", basis: "Recorded for this page itself." },
});
/** Page 7: a link some method made and the learner confirmed (an annotation record) — reviewed, not entered. It is for this page, not for its step group. */
export const sampleRangeConfirmed = range("an-ann-sample-0001-r2", 1_600_000, 1_690_000, { support: { scope: "page", pages: [7], builds: null }, origin: "manual", review_state: "human_confirmed",
  method: { name: "transcript-cue-match", version: null }, why: "A link a person entered or confirmed.", evidence: { transcript_lines: [], terms: [], shape: null }, annotation_id: "ann-sample-0001",
  quality: PERSON_QUALITY(false) });
/** Page 12: entered by the learner over an administrative page — discussion of the topic, not evidence of what was displayed. */
export const sampleRangeManual = range("an-ann-sample-0002-r1", 4_100_000, 4_160_000, { support: { scope: "page", pages: [12], builds: null }, origin: "manual", review_state: "human_confirmed",
  method: { name: "manual", version: null }, why: "A link a person entered or confirmed.", evidence: { transcript_lines: [], terms: [], shape: null }, annotation_id: "ann-sample-0002",
  quality: PERSON_QUALITY(true) });
const RANGES_OF_PAGE: Record<number, TimingRange[]> = {
  2: [sampleRangeSection, sampleRangeFirstVisit, sampleRangeSecondVisit],
  3: [sampleRangeSection, sampleRangeBuildGroup], 4: [sampleRangeSection, sampleRangeBuildGroup], 5: [sampleRangeSection, sampleRangeBuildGroup],
  7: [sampleRangeConfirmed],
  12: [sampleRangeManual],
};
/** One object per state, with the keys the Brain writes into `detail`. */
export const sampleNoRange: Record<NoRangeState, NoRange> = {
  no_range_expected: { state: "no_range_expected", text: "No recording range is expected for this page.", detail: { role: "structural_title_or_section" } },
  ambiguous: { state: "ambiguous", text: "Possible matches were found, none clear enough to show as this page's range.",
    detail: { candidates: [
      { kind: "occurrence", range_id: "tl-sample-c6-o1", recording_source_id: RECORDING.source_id, start_ms: 1_700_000, end_ms: 1_760_000, why_not_shown: "another slide fits this stretch about as well", between: [] },
      { kind: "ambiguous_interval", range_id: null, recording_source_id: RECORDING.source_id, start_ms: 3_010_000, end_ms: 3_055_000, why_not_shown: "the wording fits several slides about equally",
        between: [logicalId(6, 7), logicalId(9)] },
    ] } },
  not_discussed: { state: "not_discussed", text: "The whole recording was processed and matched; nothing was found for this page.", detail: {} },
  audio_unprocessed: { state: "audio_unprocessed", text: "Only part of the recording has timing so far; nothing was found for this page in that part.",
    detail: { processed: [[RECORDING.source_id, 0, 2_400_000]], reason: "partly_processed" } },
  association_not_run: { state: "association_not_run", text: "The recording has timing, but slide matching has not run with the current inputs.", detail: { cause: "inputs_changed", differs: ["map_revision"] } },
  recording_unavailable: { state: "recording_unavailable", text: "The recording of this lecture cannot be read.", detail: { reason: "recording_unreadable" } },
};
const NO_RANGE_OF_PAGE: Record<number, NoRange> = {
  1: sampleNoRange.no_range_expected, 6: sampleNoRange.ambiguous, 8: sampleNoRange.not_discussed, 9: sampleNoRange.audio_unprocessed,
  10: sampleNoRange.association_not_run, 11: sampleNoRange.recording_unavailable,
};

// ---- timing ------------------------------------------------------------------------------------------------------------
const processedRecording: TimingRecording = {
  source_id: RECORDING.source_id, filename: "sample-recording-90.m4a", duration_ms: DURATION_MS,
  generated: { generation: GENERATION, text_origin: "generated_speech_text", review_state: "generated_unreviewed", covered_intervals: [[0, DURATION_MS]], unresolved_intervals: [], unresolved_ms: 0,
    coverage_fraction: 1, covers_whole_recording: true },
  text_alignment: { state: "accepted", reason: null, lines_aligned: 310, lines_total: 420, method: { name: "anchored-token-alignment", version: "2" } },
  association: { state: "current", cause: null, method: { name: "lexical-sequence", version: "2" }, built_at: "2026-10-06T03:00:00Z", ranges: 4, unassigned_ms: 912_000,
    inputs: { recording_sha256: "e".repeat(64), generation: GENERATION, map_revision: MAP_REVISION, method_version: "2" } },
};
export const sampleLectureTiming: LectureTiming = {
  stage: "associated", recordings: [processedRecording],
  summary: { pages: 12, pages_with_range: 6, pages_no_range_expected: 1, pages_without_range: 5, ranges: 6, human_confirmed: 2, agent_reviewed: 1, generated: 3 },
};
/** The revisions of the sample lecture view: all six keys of the API document are stated (the type makes each optional, for a Brain that states fewer). */
export const sampleRevisions: Required<ViewRevisions> = {
  deck_sha256: "d".repeat(64), map_revision: MAP_REVISION, question_index_sha256: "1".repeat(64), inferred_anchors_sha256: "2".repeat(64),
  timing_links: [{ recording_source_id: RECORDING.source_id, links_revision: "9f8e7d6c5b4a3210" }], evidence_revision: "0123456789abcdef",
};
/** What a later read reports after a regrouping and a rebuild of the timing links: two keys differ. */
export const sampleRevisionsLater: Required<ViewRevisions> = { ...sampleRevisions, map_revision: "b2c3d4e5f6071829",
  timing_links: [{ recording_source_id: RECORDING.source_id, links_revision: "0a1b2c3d4e5f6071" }] };

// ---- the lecture view --------------------------------------------------------------------------------------------------
function slide(page: number): SlideView {
  const ranges = RANGES_OF_PAGE[page] ?? [];
  return {
    page, title: TITLE_OF_PAGE[page] ?? null, text: page === 11 ? null : `Synthetic text of sample page ${page}.`, text_status: page === 11 ? "no_text_layer" : "extracted",
    concepts: [], questions: [], occurrences: [], transcript_ranges: [], related: [],
    identity: identity(page, page === 1 ? { page_label: "i" } : page === 2 ? { printed_slide_number: { value: 2, basis: "printed_on_page" } }
      : page === 8 ? { printed_slide_number: { value: 5, basis: "printed_on_page" }, pptx: { slide_id: 263, ordinal: 6, match_basis: "title_and_text", match_state: "generated" } } : {}),
    role: role(page),
    question_ties: QUESTION_TIES_OF_PAGE[page] ?? [],
    section_ties: page >= 2 && page <= 5 ? SECTION_TIES : [],
    related_questions: RELATED_OF_PAGE[page] ?? [],
    related_questions_total: (RELATED_OF_PAGE[page] ?? []).length,
    ranges,
    no_range: ranges.length ? null : NO_RANGE_OF_PAGE[page] ?? null,
  };
}

export const sampleLectureView: LectureView = {
  course_id: SAMPLE_COURSE_ID, lecture_id: SAMPLE_LECTURE_ID, title: "Sample lecture 90 (synthetic)", session_link: "linked",
  deck: { ...DECK, filename: "sample-deck-90.pdf", state: "registered_readable", registration: "registered", rendition: "original" },
  display: { kind: "original_pdf", content: `courses/${SAMPLE_COURSE_ID}/sources/${DECK.source_id}/content` },
  deck_choice: { state: "selected", basis: "index_kind", source_id: DECK.source_id, candidates: [] },
  questions: {
    collections: [{ collection: COLLECTION, count: 8, lecture_ids: [SAMPLE_LECTURE_ID], without_wording: 1, slide_named: 2, anchor_unresolved: 0, page_basis_reviewed: false }],
    all: QUESTION_ROWS, gap: null, related_by_relationship: [], note: "Synthetic sample.",
    counts: { all: 8, course_anchor: 3, agent_inferred: 3, without_link: 2, course_section: 3 }, ties_version: "question-ties/1",
  },
  timing_summary: { reviewed_links: 2, suggested_links: 3, text_match_suggestions: 0, generated_text_recordings: 1, scheduled_preparation: "none" },
  page_count: SAMPLE_PAGE_COUNT,
  slides: Array.from({ length: SAMPLE_PAGE_COUNT }, (_, index) => slide(index + 1)),
  recordings: [{ source_id: RECORDING.source_id, version_id: RECORDING.version_id, sha256: RECORDING.sha256, filename: "sample-recording-90.m4a", media_type: "audio/mp4", state: "registered_readable",
    registration: "registered", session_id: "session-90", content: `courses/${SAMPLE_COURSE_ID}/sources/${RECORDING.source_id}/content`, duration_ms: DURATION_MS, bytes: null, artifact: null }],
  transcripts: [], sessions: [{ session_id: "session-90", state: "transcript_and_recording" }], preparation: {}, other_materials: [], link_conflicts: [],
  source_map: sampleSourceMap, timing: sampleLectureTiming, revisions: sampleRevisions,
};

/** The same lecture as an older Brain would send it: no R2 field anywhere. Screens must still render it without inventing identity, ties or ranges. */
export const sampleLectureViewWithoutR2: LectureView = (() => {
  const { source_map: _map, timing: _timing, revisions: _revisions, questions, slides, ...rest } = sampleLectureView;
  const { counts: _counts, ties_version: _version, ...block } = questions;
  return {
    ...rest,
    questions: { ...block, all: block.all.map(({ ties: _ties, no_link: _link, evidence: _evidence, suggestion_history: _history, ...row }) => row) },
    slides: slides.map(({ identity: _identity, role: _role, question_ties: _q, section_ties: _s, related_questions: _r, related_questions_total: _t, ranges: _ranges, no_range: _none, ...page }) => page),
  };
})();

/** `GET …/source-map` for the sample deck: the block, every page as the lecture view shows it, one correction in the history, and a placeholder for the stored map. */
export const sampleSourceMapDocument: SourceMapDocument = {
  ...sampleSourceMap, course_id: SAMPLE_COURSE_ID, lecture_id: SAMPLE_LECTURE_ID, deck: { source_id: DECK.source_id, filename: "sample-deck-90.pdf", registration: "registered" },
  pages: sampleLectureView.slides.map((entry) => ({ page: entry.page, identity: entry.identity!, role: entry.role! })),
  overrides: [{ revision: 1, reason: "Synthetic: page 12 is housekeeping, not teaching content.", created_at: "2026-10-06T02:00:00Z", author: { kind: "learner", ref: "lecture-view" },
    op: { type: "role", page: 12, role: "administrative" }, replaces: [] }],
  override_problems: [], map: { contract: "source-map/1", note: "Synthetic placeholder for the stored map in the source map's own spelling." },
};

// ---- concept graph: one model at three scopes --------------------------------------------------------------------------
// The seven keys the Brain's concept graph states (six inputs and the scope). `anchor_revision` is the one that changes
// when a suggested link is accepted, rejected or cleared. The course graph draws neither a slide nor an anchor: both null there.
const GRAPH_REVISIONS: Omit<Required<ConceptGraphRevisions>, "scope_revision"> = { question_index_sha256: "1".repeat(64), skills_sha256: "3".repeat(64), map_revision: MAP_REVISION,
  anchor_revision: "a4c0a4c0a4c0a4c0", policy_revision: "90110c1e90110c1e", evidence_revision: "0123456789abcdef" };
const TOTALS = { topic: 2, concept: 3, skill: 3, question: 8, criterion: 20 };
const node = (id: string, kind: ConceptGraphNode["kind"], label: string, extra: Partial<ConceptGraphNode> = {}): ConceptGraphNode => ({ id, kind, label,
  counts: { skills: kind === "topic" || kind === "concept" ? 1 : null, questions: kind === "question" || kind === "criterion" ? null : 2 }, in_scope: true, where: null, support_pages: [],
  evidence: { state: "unknown", assistance: null, prior_exposure: "unknown", attempts: 0 }, ...extra });
const compact = ({ last_at: _last, ...evidence }: EvidenceObject): EvidenceObject => evidence;
const edge = (id: string, family: ConceptGraphEdge["family"], relation: string, from: string, to: string, extra: Partial<ConceptGraphEdge> = {}): ConceptGraphEdge => ({ id: `e-${id}`, from, to,
  family, relation, provenance: family === "source" ? "course anchor (as stated)" : relation.includes("skill") && family === "structure" ? "skills catalog" : "question index", automatic_credit: false,
  tie: null, support_pages: null, ...extra });

const TOPIC_A = node("t-sample-a", "topic", "Sample topic A", { counts: { skills: 2, questions: 5 }, evidence: compact(sampleEvidence.assisted) });
const TOPIC_B = node("t-sample-b", "topic", "Sample topic B", { counts: { skills: 0, questions: 0 }, evidence: compact(sampleEvidence.not_applicable) });
const CONCEPT_1 = node("c-sample-1", "concept", "Sample concept one", { counts: { skills: 1, questions: 3 }, evidence: compact(sampleEvidence.independent) });
const CONCEPT_2 = node("c-sample-2", "concept", "Sample concept two", { counts: { skills: 1, questions: 2 }, evidence: compact(sampleEvidence.assisted) });
const CONCEPT_3 = node("c-sample-3", "concept", "Sample concept three", { counts: { skills: 1, questions: 1 } });
const SKILL_1 = node("s-sample-1", "skill", "Explain sample concept one", { counts: { skills: null, questions: 3 }, evidence: compact(sampleEvidence.independent) });
const SKILL_2 = node("s-sample-2", "skill", "Apply sample concept two", { counts: { skills: null, questions: 2 }, evidence: compact(sampleEvidence.assisted) });
const SKILL_3 = node("s-sample-3", "skill", "Interpret sample concept three", { counts: { skills: null, questions: 1 }, evidence: compact(sampleEvidence.not_separately_observed) });
const STRUCTURE = {
  topicA1: edge("000000000001", "structure", "topic_includes_concept", TOPIC_A.id, CONCEPT_1.id),
  topicA2: edge("000000000002", "structure", "topic_includes_concept", TOPIC_A.id, CONCEPT_2.id),
  topicB3: edge("000000000003", "structure", "topic_includes_concept", TOPIC_B.id, CONCEPT_3.id),
  concept1: edge("000000000004", "structure", "concept_assessed_as_skill", CONCEPT_1.id, SKILL_1.id),
  concept2: edge("000000000005", "structure", "concept_assessed_as_skill", CONCEPT_2.id, SKILL_2.id),
  concept3: edge("000000000006", "structure", "concept_assessed_as_skill", CONCEPT_3.id, SKILL_3.id),
};

/** Course scope, no focus: the scope's topics, concepts and skills; structure edges only (questions and criteria appear when a node is focused). */
export const sampleConceptGraphCourse: ConceptGraphView = {
  course_id: SAMPLE_COURSE_ID, graph_version: "concept-graph/1",
  scope: { kind: "course", lecture_id: null, page: null, logical_slide_id: null, label: null, pages: [], note: null },
  nodes: [TOPIC_A, TOPIC_B, CONCEPT_1, CONCEPT_3, CONCEPT_2, SKILL_2, SKILL_1, SKILL_3],
  edges: Object.values(STRUCTURE),
  focus: null, truncated: false, dropped: 0, totals: TOTALS, revisions: { ...GRAPH_REVISIONS, map_revision: null, anchor_revision: null, scope_revision: "c0c0c0c0c0c0c0c0" },
};

const Q3 = node(questionId(3), "question", "Sample question 3", { counts: { skills: 1, questions: null } });
const Q3C1 = node(`${questionId(3)}.C01`, "criterion", "Criterion 1 of 2", { counts: { skills: null, questions: null } });
/** Drawn although it lies outside the scope: reached through the owner's question-to-question relation. */
const OUTSIDE = node("P90-Q01", "question", "Sample question P90-Q01", { counts: { skills: 1, questions: null }, in_scope: false });
const ASSESSMENT = {
  q3c1: edge("000000000011", "assessment", "question_has_criterion", Q3.id, Q3C1.id),
  c1concept: edge("000000000012", "assessment", "criterion_assesses_concept", Q3C1.id, CONCEPT_1.id),
  c1skill: edge("000000000013", "assessment", "criterion_assesses_skill", Q3C1.id, SKILL_1.id),
};
const OVERLAP = edge("000000000021", "structure", "partial_overlap", Q3.id, OUTSIDE.id);

/** Lecture scope, focused on a concept: its neighbourhood with questions and criteria; structure and assessment edges; one node outside the scope. */
export const sampleConceptGraphLecture: ConceptGraphView = {
  course_id: SAMPLE_COURSE_ID, graph_version: "concept-graph/1",
  scope: { kind: "lecture", lecture_id: SAMPLE_LECTURE_ID, page: null, logical_slide_id: null, label: null, pages: [], note: "Questions of the collections tied to this lecture." },
  nodes: [CONCEPT_1, TOPIC_A, SKILL_1, Q3, Q3C1, OUTSIDE], // the focus first; a question before its criteria, as the Brain orders them
  edges: [STRUCTURE.topicA1, STRUCTURE.concept1, ASSESSMENT.q3c1, ASSESSMENT.c1concept, ASSESSMENT.c1skill, OVERLAP],
  focus: CONCEPT_1.id, truncated: false, dropped: 0, totals: { topic: 1, concept: 2, skill: 2, question: 8, criterion: 20 },
  revisions: { ...GRAPH_REVISIONS, scope_revision: "1ec71ec71ec71ec7" },
};

const SLIDE_SOURCE = BUILD_GROUP.id;
const onSlide = (base: ConceptGraphNode, where: TieWhere | null, pages: number[]): ConceptGraphNode => ({ ...base, where, support_pages: pages });
const Q2 = node(questionId(2), "question", "Sample question 2", { counts: { skills: 1, questions: null }, evidence: compact(sampleEvidence.assisted) });
const Q4 = node(questionId(4), "question", "Sample question 4", { counts: { skills: 2, questions: null }, evidence: compact(sampleEvidence.not_separately_observed) });
const Q4C1 = node(`${questionId(4)}.C01`, "criterion", "Criterion 1 of 3", { counts: { skills: null, questions: null }, evidence: compact(sampleEvidence.not_separately_observed) });
const suggested = { tie: "agent_inferred" as const, provenance: "suggested link (agent-inferred)" };

/** Slide scope on page 4 (build 2 of 3), focused on a concept: all three edge families, the three places of support, and one node outside the scope. */
export const sampleConceptGraphSlide: ConceptGraphView = {
  course_id: SAMPLE_COURSE_ID, graph_version: "concept-graph/1",
  scope: { kind: "slide", lecture_id: SAMPLE_LECTURE_ID, page: 4, logical_slide_id: SLIDE_SOURCE, label: "PDF page 4 of 12 · build 2 of 3", pages: [3, 4, 5],
    note: "What the course record or a suggested link ties to this slide, each entry once. Support pages name the pages of the slide on which the support is recorded." },
  nodes: [
    onSlide(CONCEPT_1, "on_this_page", [4, 5]), TOPIC_A, onSlide(SKILL_1, "on_this_page", [4, 5]),
    onSlide(Q2, "group_level", [3, 4, 5]), Q3, onSlide(Q3C1, "elsewhere_in_sequence", [5]), Q4, onSlide(Q4C1, "on_this_page", [4]), OUTSIDE,
  ],
  edges: [
    STRUCTURE.topicA1, STRUCTURE.concept1, OVERLAP,
    ASSESSMENT.q3c1, ASSESSMENT.c1concept, ASSESSMENT.c1skill,
    edge("000000000014", "assessment", "question_has_criterion", Q4.id, Q4C1.id), edge("000000000015", "assessment", "criterion_assesses_concept", Q4C1.id, CONCEPT_1.id),
    edge("000000000031", "source", "slide_supports", SLIDE_SOURCE, Q2.id, { tie: "stated", support_pages: [3, 4, 5] }),
    edge("000000000032", "source", "slide_supports", SLIDE_SOURCE, Q3C1.id, { ...suggested, support_pages: [5] }),
    edge("000000000033", "source", "slide_supports", SLIDE_SOURCE, Q4C1.id, { ...suggested, support_pages: [4] }),
    edge("000000000034", "source", "slide_supports_by_assessment", SLIDE_SOURCE, CONCEPT_1.id, { ...suggested, support_pages: [4, 5] }),
    edge("000000000035", "source", "slide_supports_by_assessment", SLIDE_SOURCE, SKILL_1.id, { ...suggested, support_pages: [4, 5] }),
  ],
  focus: CONCEPT_1.id, truncated: false, dropped: 0, totals: { topic: 1, concept: 1, skill: 1, question: 3, criterion: 2 },
  revisions: { ...GRAPH_REVISIONS, scope_revision: "511de511de511de5" },
};

// ---- course timing: a processed, a partly processed and an unprocessed recording, and a lecture without one ----------------
const partlyProcessed: TimingRecording = {
  source_id: "src-sample-rec-91", filename: "sample-recording-91.m4a", duration_ms: 4_200_000,
  generated: { generation: "sp-sample91-p0003-1b2c3d4e", text_origin: "generated_speech_text", review_state: "generated_unreviewed", covered_intervals: [[0, 1_500_000], [1_560_000, 1_800_000]],
    unresolved_intervals: [[1_500_000, 1_560_000]], unresolved_ms: 60_000, coverage_fraction: 0.4143, covers_whole_recording: false }, // pairs, like the covered parts
  text_alignment: { state: "not_run", reason: null, lines_aligned: 0, lines_total: 0, method: { name: "anchored-token-alignment", version: "2" } },
  association: { state: "stale", cause: "inputs_changed", method: { name: "lexical-sequence", version: "2" }, built_at: "2026-10-05T22:10:00Z", ranges: 0, unassigned_ms: 0,
    inputs: { recording_sha256: "f".repeat(64), generation: "sp-sample91-p0002-9a8b7c6d", map_revision: "c3d4e5f607182930", method_version: "2" } },
};
const unprocessed: TimingRecording = {
  source_id: "src-sample-rec-92", filename: "sample-recording-92.m4a", duration_ms: 3_600_000, generated: null,
  text_alignment: { state: "not_run", reason: null, lines_aligned: 0, lines_total: 0, method: { name: "anchored-token-alignment", version: "2" } },
  association: { state: "not_run", cause: "not_run", method: { name: "lexical-sequence", version: "2" }, built_at: null, ranges: 0, unassigned_ms: 0,
    inputs: { recording_sha256: "9".repeat(64), generation: null, map_revision: null, method_version: "2" } },
};
export const sampleCourseTiming: CourseTimingView = {
  course_id: SAMPLE_COURSE_ID,
  allowance: { ceiling_seconds: 14_400, used_seconds: 5_400, remaining_seconds: 9_000 },
  resume_command: "python -m lecture_brain --profile fixture speech-run --course sample-course",
  build_command: "python -m lecture_brain --profile fixture timing-build --course sample-course --all",
  lectures: [
    { lecture_id: SAMPLE_LECTURE_ID, title: "Sample lecture 90 (synthetic)", stage: "associated", links: { state: "current", differs: [], built_at: "2026-10-06T03:00:00Z" },
      recordings: [{ ...processedRecording, queue: { state: "complete", chunks_done: 8, chunks_total: 8, seconds_covered: 4_800, position: 1 } }] },
    { lecture_id: "lecture-91", title: "Sample lecture 91 (synthetic)", stage: "partly_processed", links: { state: "stale", differs: ["generation"], built_at: "2026-10-05T22:10:00Z" },
      recordings: [{ ...partlyProcessed, queue: { state: "partial", chunks_done: 3, chunks_total: 7, seconds_covered: 1_740, position: 2 } }] },
    { lecture_id: "lecture-92", title: "Sample lecture 92 (synthetic)", stage: "audio_unprocessed", links: { state: "missing", differs: [], built_at: null },
      recordings: [{ ...unprocessed, queue: { state: "queued", chunks_done: 0, chunks_total: 6, seconds_covered: 0, position: 3 } }] },
    { lecture_id: "lecture-93", title: "Sample lecture 93 (synthetic)", stage: "no_recording", links: { state: "missing", differs: [], built_at: null }, recordings: [] },
  ],
  summary: { lectures: 4, stages: { no_recording: 1, audio_unprocessed: 1, partly_processed: 1, processed: 0, associated: 1 }, recordings: 3, recordings_with_generated: 2, recordings_associated: 1,
    covered_ms: 6_540_000, unresolved_ms: 60_000, duration_ms: 12_600_000, ranges: 4 },
  note: "Synthetic sample. Stages and times as written for this file; nothing here is a measurement.",
};

// ---- suggestions: readback and one decision ------------------------------------------------------------------------------
export const sampleInferredAnchors: InferredAnchorsReadback = {
  course_id: SAMPLE_COURSE_ID, contract: "ll.inferred-anchors/1", reader: "inferred-anchors-reader/1",
  file: { state: "ok", produced_at: "2026-10-05T12:00:00Z", sha256: "2".repeat(64), question_index_matches: true }, file_reason: null,
  accepted: 3, refused: {}, stale: 0, rejected_by_verifier: 1,
  by_collection: [{ collection: COLLECTION, questions: 8, accepted: 3, stale: 0, rejected_by_verifier: 1, refused: 0, questions_with_suggestion: 3, questions_inspected_no_support: 1, questions_without_suggestion: 4 }],
  no_candidate: 0, stale_by_reason: {}, decisions: { confirmed: 1, rejected: 0, cleared: 0 },
  note: "Suggestions are agent work kept apart from the course record.",
};
/**
 * The same course after its question catalog changed: the file was made for an earlier catalog, so none of its items is
 * a current link (accepted 0), every one counts as stale, and each question reads "No suggested link — made for an
 * earlier version". Apart from a file that cannot be read ("unreadable") and from none at all ("missing").
 */
export const sampleInferredAnchorsEarlierCatalog: InferredAnchorsReadback = {
  course_id: SAMPLE_COURSE_ID, contract: "ll.inferred-anchors/1", reader: "inferred-anchors-reader/1",
  file: { state: "made_for_earlier_catalog", produced_at: "2026-10-05T12:00:00Z", sha256: "2".repeat(64), question_index_matches: false }, file_reason: null,
  accepted: 0, refused: {}, stale: 4, rejected_by_verifier: 0,
  by_collection: [{ collection: COLLECTION, questions: 8, accepted: 0, stale: 4, rejected_by_verifier: 0, refused: 0, questions_with_suggestion: 0, questions_inspected_no_support: 0, questions_without_suggestion: 8 }],
  no_candidate: 0, stale_by_reason: { earlier_catalog: 4 },
  decisions: { confirmed: 0, rejected: 0, cleared: 0, orphaned: [],
    on_stale: [{ suggestion_id: "ia-0000000000000005", decision: "confirmed", revision: 1, decided_at: "2026-10-06T04:30:00Z", question_id: questionId(5), lecture_id: SAMPLE_LECTURE_ID,
      source_id: DECK.source_id, pages: [8] }],
    on_rejected_by_verifier: [], problems: [] },
  note: "Suggestions are agent work kept apart from the course record.",
};
export const sampleSuggestionDecision: SuggestionDecisionResponse = {
  course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000004", decision: "confirmed", revision: 1, status: "recorded", decided_at: "2026-10-06T04:30:00Z", question_id: questionId(4),
};
