// Shapes of the generated views served by the Brain (projections.py). Views are derived data: they
// carry no assessment facts of their own.
import type { SourceRef } from "./db";

export interface Capability {
  status: string;
  label: string;
  detail?: string;
  adapter?: string;
  installed?: boolean;
  configured?: boolean;
  last_proof_at?: string | null;
  disposable_proof?: DisposableProof;
}

export interface DisposableProof { classification: string; checked_at: string; thread_id: string | null; meaning: string }

export interface Capabilities {
  native: Capability;
  writer: Capability;
  drive: Capability;
  speech?: Capability;
  office_converter?: Capability;
  brain: { profile: string; paused: boolean; pause_reason?: { reason: string; at: string } | null };
  spending: { additional_paid_inference_budget_usd: number; paid_route_configured: boolean; note: string };
}

export interface BrainPublic {
  key_id: string;
  public_key_spki_b64: string;
  fingerprint: string;
}

export interface WorkspaceCourse {
  /** Questions in the course's own catalog (0 when the course has none). A count of what exists, not of what was answered. */
  catalogued_questions?: number;
  course_id: string;
  display_name: string;
  binding: string;
  problem: string | null;
  lecture_units?: number;
  sessions?: number;
  index_status?: string;
  recorded_attempts?: number;
  assessed_label?: string;
  due_items?: number;
  pending_requests?: number;
  preparation?: Record<string, number>;
}

export interface WorkspaceView {
  profile: string;
  fixture_label: string | null;
  term: string;
  generated_at: string;
  binding_revision: string;
  capabilities: Capabilities;
  courses: WorkspaceCourse[];
  coverage_totals: Record<string, number>;
  writes_are_staged: boolean;
  brain: BrainPublic;
  supervisor: { last_tick_at?: string | null; open: number; total: number };
}

export interface InventoryItem {
  source_id: string;
  kind: string;
  filename: string | null;
  state: string;
  registration: string;
  bytes: number | null;
  media_type: string | null;
  rendition?: string;
  disclosure?: string;
  source_date?: string | null;
}

export interface SessionView {
  session_id: string;
  date: string;
  state: string;
  linked_lecture_ids: string[];
  items: InventoryItem[];
}

export interface OtherMaterial {
  source_id: string;
  filename: string | null;
  role: "deck" | "extra";
  kind: string;
  state: string;
  registration: string;
  rendition: string;
  media_type: string | null;
  bytes: number | null;
  available: boolean;
}

export interface CourseLecture {
  lecture_id: string;
  title: string;
  session_link: string;
  deck: (InventoryItem & { rendition: string }) | null;
  displayable: boolean;
  /** Other files in the same lecture unit (further decks, notes); each is reachable from the lecture. */
  other_materials_count: number;
  sessions: SessionView[];
  disposition: string;
  pages: number | null;
  pages_confirmed: number;
  pages_suggested: number;
  pages_unresolved: number | null;
  /** How the displayed deck was chosen; "unresolved" means several equal candidates and no choice was made for you. */
  deck_choice: { state: "selected" | "unresolved" | "none"; basis: string | null; candidates: number };
  /** Questions of the catalog collections tied to this unit's files (whether or not they name a slide). */
  questions: { count: number; collections: string[] };
}

/** Where a catalog locator points, as written: pages of a file, or line ranges of the unit's transcript. */
export interface QuestionAnchor {
  kind: "pages" | "transcript_lines";
  ranges: Array<[number, number]>;
  pages?: number[];
  source_id: string | null;
  lecture_id: string | null;
  /** "exact": this collection's slide numbers were confirmed as physical pages; "stated": named by the catalog, not yet confirmed. */
  basis: "exact" | "stated";
  from: "locator" | "page_field";
  /** True when the pages are slides of the deck the lecture is shown with; false for pages of any other file. */
  on_displayed_deck?: boolean;
  resolution?: string;
  named_source?: string;
}
export interface QuestionFile {
  source_id: string;
  filename: string | null;
  kind: string;
  available: boolean;
  displayable: boolean;
  disclosure: string;
  page: number | null;
  index_relation?: boolean;
  label?: string;
  note?: string;
  verification?: { method?: string; checked_at?: string; score?: number; scope?: string };
}
/** One question in a list: identity, why it is listed, where it points. Never criteria wording or guidance. */
export interface QuestionRow {
  question_id: string;
  version: number | null;
  collection: string | null;
  number: number | null;
  title: string | null;
  origin: string | null;
  topic: string | null;
  prompt: string;
  prompt_in_index: boolean;
  family_id: string | null;
  family_revision: number | null;
  criteria_count: number;
  criteria_authorship: "tutor_authored" | "catalog";
  lecture_ids: string[];
  membership: { basis: "cited_source_in_unit" | "not_a_lecture_file"; source_ids: string[] };
  anchors: QuestionAnchor[];
  anchor_state: "resolved" | "partial" | "unresolved";
  slide_anchor: "named" | "none";
  locator_text: string;
  qualifiers: string[];
  unparsed: string[];
  original: QuestionFile | null;
  display_rendition: QuestionFile | null;
  related_copy: QuestionFile | null;
  concept_ids: string[];
  via?: Array<{ question_id: string; relation: string; direction: string; automatic_credit: boolean }>;
}
export interface QuestionCollection {
  collection: string;
  count: number;
  lecture_ids?: string[];
  origins?: Record<string, number>;
  without_wording: number;
  slide_named: number;
  anchor_unresolved: number;
  page_basis_reviewed: boolean;
}
export interface QuestionBankView {
  course_id: string;
  total: number;
  matching: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  items: QuestionRow[];
  collections: QuestionCollection[];
  lectures: Array<{ lecture_id: string; title: string | null; collections: string[]; count: number; gap: string | null }>;
  guidance: { adapter: string | null; files: number; resolved: number; errors: Array<{ code: string; entry_id: string | null; file: string | null; detail: string }> };
  note: string;
}

export interface CourseView {
  question_bank: { total: number; collections: Array<{ collection: string; count: number; lecture_ids: string[] }> };
  course_id: string;
  display_name: string;
  index: { status: string; revision?: number; reason?: string; as_of?: string };
  lectures: CourseLecture[];
  unlinked_sessions: SessionView[];
  other_sources: InventoryItem[];
  recorded_attempts: number;
  learning_view_status: string;
  enumeration_truncated: boolean;
}

export interface Artifact {
  path: string;
  sha256: string;
  bytes: number;
  media_type: string;
}

export interface AnnotationRecord {
  contract: "ll.annotation/1";
  annotation_id: string;
  scope: { course_id: string; term: string };
  revision: number;
  supersedes: { record_id: string; artifact: Artifact } | null;
  relation: "displayed_during" | "discussed_during" | "explained_by" | "practiced_by";
  from: SourceRef;
  to: SourceRef;
  review_state: "suggested" | "confirmed" | "rejected";
  basis: string;
  support: Artifact[];
  reviewer_ref: string | null;
  created_at: string;
}

export interface LinkBase {
  annotation_id: string;
  revision: number;
  review_state: "suggested" | "confirmed" | "rejected";
  basis: string;
  relation: string;
  artifact: Artifact;
  record: AnnotationRecord;
}
export interface Occurrence extends LinkBase {
  source: SourceRef;
  start_ms: number;
  end_ms: number;
}
export interface TranscriptRange extends LinkBase {
  source: SourceRef;
  start: number;
  end: number;
}
export interface RelatedLink extends LinkBase {
  to: SourceRef;
  precision: string;
  filename: string | null;
  kind: string | null;
  disclosure: string;
  available: boolean;
}

export interface SlideView {
  page: number;
  title: string | null;
  text: string | null;
  text_status: "extracted" | "no_text_layer" | "not_prepared";
  concepts: Array<{ concept_id: string; label: string; basis: string }>;
  questions: Array<{ question_id: string; title: string | null; family_id: string | null; family_revision: number | null; prompt: string; prompt_in_index: boolean; collection: string | null;
    basis: "exact" | "stated"; why: string }>;
  occurrences: Occurrence[];
  transcript_ranges: TranscriptRange[];
  related: RelatedLink[];
}

/** Speech text generated outside the app and imported from a verified manifest. Its times belong to this text only. */
export interface GeneratedText {
  generation: string;
  created_at: string;
  window: { start_ms: number; end_ms: number };
  duration_ms: number | null;
  coverage_fraction: number | null;
  covers_whole_recording: boolean | null;
  text_origin: string;
  review_state: string;
  note: string;
  producer: { tool?: string | null; model?: string | null; language?: string | null };
  segments: Array<{ start_ms: number; end_ms: number; text: string }>;
  segments_total: number;
}
export interface RecordingView {
  generated_text?: GeneratedText | null;
  source_id: string;
  version_id: string | null;
  sha256: string | null;
  filename: string;
  media_type: string;
  state: string;
  registration: string;
  session_id: string;
  content: string;
  duration_ms: number | null;
  bytes: number | null;
  /** The recording file as a citable artifact (present once its bytes are identified). */
  artifact: Artifact | null;
}

export interface TranscriptView {
  source_id: string;
  version_id: string | null;
  sha256: string | null;
  filename: string;
  session_id: string;
  lines: string[];
  timing: "annotated" | "untimed";
  timing_note: string | null;
  line_times: Array<{ annotation_id: string; review_state: string; start: number; end: number; start_ms: number; end_ms: number; recording_source_id: string }>;
}

export interface LectureView {
  course_id: string;
  lecture_id: string;
  title: string;
  session_link: string;
  deck: { source_id: string; version_id: string | null; sha256: string | null; filename: string; state: string; registration: string; rendition: string } | null;
  display: { kind: "original_pdf" | "rendition_pdf" | "unavailable" | "choose_deck"; content?: string; note?: string; reason?: string };
  deck_choice: { state: "selected" | "unresolved" | "none"; basis: string | null; source_id: string | null;
    candidates: Array<{ source_id: string; filename: string; bytes: number | null; registration: string; rendition: string; state: string }> };
  /** The lecture's own questions (by collection), questions reached through a relationship, and the gap when there is no collection. */
  questions: { collections: QuestionCollection[]; all: QuestionRow[]; gap: string | null; related_by_relationship: QuestionRow[]; note: string };
  /** Four separate facts about timing: reviewed links, suggested links, text-match suggestions, generated speech text. None implies another. */
  timing_summary: { reviewed_links: number; suggested_links: number; text_match_suggestions: number; generated_text_recordings: number; scheduled_preparation: string };
  page_count: number | null;
  slides: SlideView[];
  recordings: RecordingView[];
  transcripts: TranscriptView[];
  sessions: Array<{ session_id: string; state: string }>;
  preparation: Record<string, { status: string; reason?: string; note?: string }>;
  other_materials: OtherMaterial[];
  link_conflicts: Array<{ conflict_id: string; annotation_id: string; proposed: AnnotationRecord; current: AnnotationRecord | null }>;
}

export interface QuestionView {
  course_id: string;
  question_id: string;
  title: string | null;
  /** The question's wording, or — when the course index holds none — a pointer to the original page (never invented wording). */
  prompt: string;
  prompt_in_index: boolean;
  prompt_status: string | null;
  collection: string | null;
  origin: string | null;
  source_refs: Array<{ source_id: string; version_id: string; locator: string }>;
  page: number | null;
  family: { family_id: string; revision: number; skill_ids: string[] } | null;
  rubric_available: boolean;
  criteria_count: number;
  criteria_note: string;
  relationships: Array<{ from_question: string; to_question: string; relation: string; rationale?: string; automatic_credit: boolean }>;
  evidence: Array<{ attempt_id: string; recorded_at: string; assessment_id: string; outcomes: Record<string, string>; link_scope: string }>;
  number: number | null;
  lecture_ids: string[];
  membership: QuestionRow["membership"];
  anchors: QuestionAnchor[];
  anchor_state: QuestionRow["anchor_state"];
  slide_anchor: QuestionRow["slide_anchor"];
  locator_text: string;
  qualifiers: string[];
  original: QuestionFile | null;
  display_rendition: QuestionFile | null;
  related_copy: QuestionFile | null;
  criteria_authorship: "tutor_authored" | "catalog";
  source_note: string | null;
}

export interface ConceptNode {
  id: string;
  type: "topic" | "concept" | "skill" | "question_family" | "question" | "shared_concept";
  label: string;
  course_id: string;
  assessed?: boolean;
  evidence_by_outcome?: Record<string, number>;
  mapping?: string;
  ability?: string;
  cross_course?: boolean;
}
export interface ConceptEdge {
  from: string;
  to: string;
  relation: string;
  provenance: string;
  rationale?: string;
  automatic_credit?: boolean;
  scope?: string;
  other_courses?: string[];
}
export interface ConceptsView {
  course_id: string;
  nodes: Record<string, ConceptNode>;
  edges: ConceptEdge[];
  roots: string[];
  note: string;
}

export interface Episode {
  attempt_id: string;
  assessment_id: string;
  revised: boolean;
  conflict: boolean;
  outcome: string;
  assistance: string;
  reference_access: string;
  confidence: string;
  analysis: string;
  missing_or_incorrect: string[];
  error_types: string[];
  recorded_at: string;
  occurred_at: string | null;
  time_basis: string;
  mode: string;
  question_prompt: string;
  question_id?: string | null;
  /** The condition this observation was recorded under; only "unaided" observed demonstrations qualify as unaided performance. */
  condition: "unaided" | "assisted" | "prior_exposure" | "conditions_unknown";
  condition_reasons: string[];
  prior_exposure: string;
  qualifying_unaided: boolean;
}
export interface SkillFacet { facet: string | null; state: "mapped" | "combined" | "unclassified"; tokens: string[]; token_basis: string; candidates: string[]; rationale: string; mapping_version: number }
export interface FacetRow {
  facet: string;
  label: string;
  target_skills: number;
  qualifying_unaided_skills: number;
  observed_other_skills: number;
  uncertain_skills: number;
  unassessed_skills: number;
  observations_by_condition: Record<string, number>;
  observations_by_outcome: Record<string, number>;
  note?: string;
}
export interface OutlineRow {
  instance_id: string;
  node_id: string;
  kind: "topic" | "concept" | "skill" | "question" | "criterion";
  label: string;
  relation: string;
  depth: number;
  repeated_on_path: boolean;
  has_children: boolean;
  questions?: number;
  skills?: number;
  status?: string;
  facet?: string;
  episodes?: number;
  collection?: string | null;
  slide_anchor?: string;
  on_parent_skill?: boolean;
}
export interface OutlineView {
  course_id: string;
  scope: { kind: string; basis: string; note: string; questions_in_scope: number; gap?: string | null; lecture_id?: string; page?: number; anchored_questions?: string[]; related_questions?: string[];
    questions_without_slide_anchor?: string[] };
  canonical_counts: Record<"topic" | "concept" | "skill" | "question_family" | "question" | "criterion" | "question_relationship", number>;
  rows: OutlineRow[];
  total_children: number;
  truncated: boolean;
  note: string;
}
export interface OutlineNodeView {
  node: { node_id: string; kind: string; label: string };
  parents: Array<{ node_id: string; kind: string; label: string }>;
  sources: Array<{ source_id: string | null; basis: string; from: string; kind?: string; ranges?: Array<[number, number]>; locator_text?: string; lecture_id?: string | null }>;
  sources_total: number;
  questions: QuestionRow[];
  questions_total: number;
  evidence: { unit: string; note?: string; skills: Array<{ skill_id: string; label: string; status: string; facet: string; episodes: number; observations_by_condition: Record<string, number>; unaided_demonstrated: number }>; skills_total: number };
  links: Array<{ relation: string; other: string; other_label: string; direction: string; automatic_credit: boolean }>;
}

export interface SkillRow {
  skill_id: string;
  label: string;
  ability: string | null;
  topic_ids: string[];
  concept_id: string | null;
  status: "not_assessed" | "not_observed_only" | "current_gap" | "uncertain" | "demonstrated_unaided" | "demonstrated_assisted" | "demonstrated_after_exposure" | "demonstrated_conditions_unknown";
  facet: SkillFacet;
  observations_by_condition: Record<string, number>;
  episodes: number;
  latest: Episode | null;
  gap: { observed: Record<string, unknown>; cause_status: string; note: string } | null;
  counterevidence: Array<{ attempt_id: string; outcome: string; assistance: string; recorded_at: string }>;
  unaided_demonstrated: number;
  study: { priority: string | null; priority_reason: string | null; need_basis: string | null; study_decision: string | null; note: string };
  history: Episode[];
}

export interface ProgressView {
  course_id: string;
  skills: SkillRow[];
  summary: Record<string, number>;
  recorded_attempts: number;
  assessment_revisions: number;
  owner_view_status: string;
  notes: string[];
  facets: { mapping_version: number; conditions_version: string; unit: string; target_set: string; numerator: string; rows: FacetRow[]; notes: string[] };
  rules: { evidence_conditions: string; facet_mapping: number };
  criterion_evidence: { criteria_in_catalog: number; attempts_with_criterion_observations: number; note: string };
}

export interface HistoryAttempt {
  attempt_id: string;
  session_id: string;
  recorded_at: string;
  occurred_at: string | null;
  time_basis: string;
  mode: string;
  question: { prompt: string; question_id?: string; family_id: string; family_revision: number };
  response: { excerpt: string; full_text: string | null; availability: string; capture: Artifact | null };
  original_observations: Array<Record<string, unknown> & { skill_id: string; outcome: string }>;
  effective: { assessment_id: string; observations: Array<Record<string, unknown> & { skill_id: string; outcome: string; analysis: string }>; chain: string[]; conflict: boolean };
  revisions: Array<{ event_id: string; reason: string; recorded_at: string }>;
  artifact: Artifact;
}

export interface HistoryView {
  course_id: string;
  attempts: HistoryAttempt[];
  conversations: Array<{ run_id: string; entries: Array<{ kind: string; at: string; text: string | null; request_id?: string; disposition?: string; prompt?: string; interaction?: string }> }>;
  note: string;
}

export interface QuestionRecord {
  question_id: string | null;
  family_id: string | null;
  family_revision: number | null;
  prompt: string;
  sources: SourceRef[];
  attachments: Artifact[];
}

export interface ReviewRow {
  item_id: string;
  revision: number;
  kind: string;
  selection: "saved_only" | "active" | "suspended" | "retired";
  question: QuestionRecord;
  performed_reviews: number;
  scheduled_reviews: number;
  practice_only_reviews: number;
  pending_grades: number;
  due_at: string | null;
  is_due: boolean;
  schedule_note: string | null;
  artifact: Artifact;
}

export interface ReviewView {
  course_id: string;
  items: ReviewRow[];
  due_count: number;
  available_questions: Array<{ question_id: string; title: string | null; prompt: string; prompt_in_index: boolean; origin: string | null; collection?: string | null; family_id: string | null; family_revision: number | null; source_refs: Array<{ source_id: string; version_id: string; locator: string }> }>;
  /** Every catalogued question not yet in the list (no cut-off). */
  available_total: number;
  default_session_size: number;
  scheduler_config: Artifact;
  note: string;
}

export interface ActivityJob {
  job_id: string;
  request_id: string | null;
  course_id: string;
  workflow: string;
  action: string | null;
  depth: string | null;
  logical_input_id: string | null;
  state: string;
  reason: string | null;
  cancel_requested: boolean;
  generation: number;
  created_at: number;
  updated_at: number;
  phases: { input: string; transport: string; native: string; answer: string; publication: string; publication_reason: string | null };
  dispatches: number;
  actions: string[];
}

export interface ActivityView {
  jobs: ActivityJob[];
  counts: { jobs: number; dispatches: number; admissions: number; by_state: Record<string, number> };
  rejections: Array<{ name: string; course_id: string; status: string; reason: string | null; at: string; request_id: string | null }>;
  pending_bundles: Array<{ course_id: string; name: string; reason: string }>;
  supervisor: { paused: boolean };
  note: string;
}

export interface SearchEntry {
  type: "lecture" | "slide" | "transcript" | "question" | "concept" | "skill" | "source";
  title: string;
  text: string;
  ref: { lecture_id?: string; page?: number; line?: number; source_id?: string; question_id?: string; node_id?: string };
}
export interface SearchIndex {
  course_id: string;
  display_name: string;
  entries: SearchEntry[];
  unindexed: Array<{ what: string; reason: string }>;
  max_results: number;
  note: string;
}

export interface SettingsView {
  profile: string;
  fixture_label: string | null;
  binding_revision: string;
  capabilities: Capabilities;
  brain: BrainPublic;
  devices: Array<{ key_id: string; device_id: string; label: string; fingerprint: string; courses: string[]; actions: string[]; state: string; created_at: number; approved_at: number | null; revoked_at: number | null }>;
  courses: Array<{ course_id: string; display_name: string; status: string; problem: string | null; thread_key: string; native_thread_bound: boolean }>;
  limits: Record<string, number>;
  retention: Array<{ class: string; default: string; removable: string; policy_value: unknown }>;
  fixture_modes: string[] | null;
  fixture_mode: string | null;
}

export interface ResumeHead {
  checkpoint_id: string;
  device_id: string;
  session_id: string;
  sequence: number;
  cursor: { lecture_id: string; source: SourceRef; position_ms: number | null; panel: "slide" | "tutor" | "transcript" | "sources"; draft: Artifact | null };
  updated_at: string;
  parent: string | null;
  artifact: Artifact;
  autoplay: false;
}
export interface ResumeState {
  course_id: string;
  current: ResumeHead | null;
  conflict: { heads: ResumeHead[]; note: string } | null;
  checkpoints: number;
}

export interface PublicationRecord {
  contract: "ll.publication/1";
  receipt_id: string;
  request_id: string;
  writer_id: string;
  kind: "attempt" | "assessment_revision" | "source_annotation" | "catalog" | "review" | "none";
  status: "saved" | "already_saved" | "blocked" | "incomplete" | "not_requested";
  canonical_record: { record_id: string; artifact: Artifact } | null;
  view_status: "current" | "stale" | "unavailable" | "not_applicable";
  captured_submission: Artifact | null;
  observed_at: string;
  reason: string | null;
}

export interface MessageRecord {
  contract: "ll.message/1";
  message_id: string;
  request_id: string;
  role: "learner_question" | "tutor";
  text: string;
  sources: SourceRef[];
  created_at: string;
  assessment_disposition: "not_assessed" | "provisional" | "canonical_saved" | "unavailable";
  reply_to_turn: string | null;
}

export interface ResultDetail {
  problems?: string[];
  uncertainty?: string | null;
  diagnostic?: { hypotheses: Array<{ statement: string; supporting: string; alternative_causes: string[] }>; next_prompt: string | null; status?: string; followups_used?: number; followups_limit?: number } | null;
  observations?: Array<{ skill_id: string; outcome: string; analysis: string; missing_or_incorrect: string[]; error_types: string[]; assessment_confidence: string }> | null;
  criteria?: Array<{ skill_id: string; observable: string; criterion_id?: string }>;
  conditions?: Record<string, string>;
  previous_outcomes?: Record<string, string>;
  review_event?: { event_id?: string; apply_schedule?: boolean; rating?: string | null; rating_basis?: string; note?: string | null; error?: string };
  target_state?: string;
  conflict_id?: string;
  capture_correction?: { attempt_id: string };
  /** True when the tutor itemized the reply into parts; false or absent means one citation list for the whole reply. */
  support_itemized?: boolean;
  /** The reply's parts in order (joined by a blank line they are the reply text). `sources` are positions in the message's `sources`. */
  segments?: Array<{ text: string; support: "course_source" | "added_explanation"; sources: number[] }> | null;
}
