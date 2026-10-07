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
  /** R2 (rows of a lecture view): every tie of the question, the course's own anchors first. Absent from an older Brain. */
  ties?: LectureQuestionTie[];
  /** R2: set when the question has no course anchor and no displayable suggestion; null when it has a tie. */
  no_link?: NoLink | null;
  /** R2: what is recorded about attempts on this question. */
  evidence?: EvidenceObject;
  /** R2: suggestions that are not ties (so a rejection can be taken back). */
  suggestion_history?: SuggestionHistory;
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
  // ---- R2 (r2-read-api.md 1.2 and 1.4); every field is absent from an older Brain ----
  /** What is known about this physical page: index, optional printed or PowerPoint number, logical slide, position in a group. */
  identity?: SlideIdentity;
  /** Content role of the page, independent of grouping, numbering and audio. */
  role?: SlideRole;
  /** Questions an anchor ties to this page's logical slide (granularity "page"). Kinds are never rewritten into one another. */
  question_ties?: SlideQuestionTie[];
  /** Ties of granularity "section" (the course's own study map): coarse, listed apart from `question_ties`. */
  section_ties?: SlideSectionTie[];
  /** Questions that share a concept with this logical slide and are not anchored here (capped at 30). */
  related_questions?: RelatedQuestion[];
  /** The number of related questions before the cap. */
  related_questions_total?: number;
  /** Every range the player can seek to for this page, earliest first. Already includes confirmed and manual annotations. */
  ranges?: TimingRange[];
  /** Exactly one of six states when `ranges` is empty; null otherwise. */
  no_range?: NoRange | null;
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
  questions: { collections: QuestionCollection[]; all: QuestionRow[]; gap: string | null; related_by_relationship: QuestionRow[]; note: string;
    /** R2: how the rows of `all` divide (course_anchor + agent_inferred + without_link = all; course_section is counted apart). */
    counts?: LectureQuestionCountsBlock; ties_version?: string };
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
  // ---- R2 (r2-read-api.md 1.1 and 1.3); every field is absent from an older Brain ----
  /** The source map of the displayed deck: the only source of slide identity. */
  source_map?: SourceMapBlock;
  /** Stage and per-recording facts of timing: generated text, text alignment, slide association. */
  timing?: LectureTiming;
  /** The revisions this view was built from; compare with a later view to say that this one is older (r2.isStale). */
  revisions?: ViewRevisions;
}

export interface QuestionView {
  course_id: string;
  question_id: string;
  /** R2: the question's own links, as the lecture lists state them and with no deck on screen; null or absent from a Brain that states none. */
  ties?: QuestionRow["ties"] | null;
  no_link?: QuestionRow["no_link"] | null;
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
  /** R2 (slide scope): where the node's support is, relative to the selected page; null when no support names it. */
  where?: TieWhere | null;
  /** R2 (slide scope): the member pages on which the node's support is recorded. */
  support_pages?: number[];
  /** R2: the node's evidence in the compact form a graph node carries. */
  evidence?: EvidenceObject | null;
}
export interface OutlineView {
  course_id: string;
  scope: { kind: string; basis: string; note: string; questions_in_scope: number; gap?: string | null; lecture_id?: string; page?: number; anchored_questions?: string[]; related_questions?: string[];
    questions_without_slide_anchor?: string[];
    /** R2 (slide scope): the logical slide of the page, its member pages and identity label, the page's role, and questions in scope through a suggested link only. */
    logical_slide_id?: string | null; label?: string | null; pages?: number[]; role?: Pick<SlideRole, "value" | "forced_requirements"> | null; suggested_questions?: string[];
    /** R2 (slide scope): questions tied to this slide that are not questions of this lecture's collections (a suggested link may tie one); the scope's note says so. */
    questions_of_other_collections?: string[] };
  canonical_counts: Record<"topic" | "concept" | "skill" | "question_family" | "question" | "criterion" | "question_relationship", number>;
  rows: OutlineRow[];
  total_children: number;
  truncated: boolean;
  note: string;
}
export interface OutlineNodeView {
  node: { node_id: string; kind: string; label: string };
  parents: Array<{ node_id: string; kind: string; label: string }>;
  /**
   * R2 rows add `pages`, `label`, `tie`, `logical_slide_ids` and `href`, and state `from` as the list of catalog objects the row comes from.
   * A row stays the kind it is (`OutlineSourceKind`): pages, transcript lines (`ranges` are then line ranges) or a broad text reference.
   * `href` is null for a row the record does not make openable (no file is identified); `locator_text` is null for a row that is not text.
   */
  sources: Array<{ source_id: string | null; basis: string; from: string | string[]; kind?: OutlineSourceKind | (string & {}); ranges?: Array<[number, number]>; locator_text?: string | null;
    lecture_id?: string | null; pages?: number[]; label?: string; tie?: AnchorTieKind; logical_slide_ids?: string[]; href?: string | null }>;
  sources_total: number;
  /** R2 rows add how the question is bound to the node, the criteria through which it is (identity only) and the question's evidence. */
  questions: Array<QuestionRow & { tie_to_node?: OutlineQuestionTieToNode; criterion_ids?: string[] }>;
  questions_total: number;
  /** R1 keys (`unit`, `skills`) stay; R2 adds the five-state evidence of the node with its observations and their composition. */
  evidence: { unit: string; note?: string; skills: Array<{ skill_id: string; label: string; status: string; facet: string; episodes: number; observations_by_condition: Record<string, number>; unaided_demonstrated: number }>; skills_total: number }
    & Partial<NodeEvidence>;
  links: Array<{ relation: string; other: string; other_label: string; direction: string; automatic_credit: boolean }>;
  /** R2, concepts only: the catalog's definition, or the stated gap when it records none. Never filled in by the app. */
  definition?: ConceptDefinition | null;
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

// =====================================================================================================================
// Remediation amendment R2 — read-side shapes. Spelling: docs/engineering/r2-read-api.md (with its section 1.4);
// meaning: docs/engineering/interface-contracts.md, section "Remediation amendment R2". Pages are 1-based physical PDF
// pages; media times are integer milliseconds from the original source start, [start_ms, end_ms); a field that does
// not apply is null, never a guessed value. Helpers over these shapes: ./r2.ts; wording: ./labels.ts.
// =====================================================================================================================

/** The bytes something was made for. */
export interface SourceIdentity { source_id: string; version_id: string | null; sha256: string | null }
/** [start_ms, end_ms) in integer milliseconds. */
export type MsInterval = [number, number];
/** Inclusive transcript line range. Lines are never pages and never times. */
export type LineRange = [number, number];
/** How a generated fact was established. Three different labels; "agent_reviewed" is never "human_confirmed". */
export type EstablishedState = "generated" | "agent_reviewed" | "human_confirmed";
/** `version` is null for a link a person entered or that an annotation record carries (no method version applies). */
export interface MethodRef { name: string; version: string | null }

// ---- 1.1 source map ------------------------------------------------------------------------------------------------
export type SlideRoleValue = "instructional" | "worked_example_or_question" | "objectives_or_summary" | "structural_title_or_section" | "administrative" | "blank" | "mixed" | "unknown";
export type RoleState = EstablishedState;
/** `step_group`: equal text whose drawings differ or were not compared ("step k of n"). `duplicate_group`: byte-equal content or equal picture digests. */
export type LogicalSlideKind = "single" | "build_group" | "step_group" | "duplicate_group" | "manual_group";
export type SourceMapUnavailableReason = "no_deck" | "not_a_pdf" | "unreadable" | "not_built";
export type PageLayout = "slides" | "document" | "mixed";
export type GroupingBasis = "page" | "inferred" | "pptx" | "override";
/** `confidence` is "not_established" for a page kept on its own because grouping it with a neighbour was uncertain. */
export interface LogicalSlideGrouping { basis: GroupingBasis; state: EstablishedState; confidence: string | null; signals: string[] }
export interface LogicalSlide {
  id: string;
  kind: LogicalSlideKind;
  /** Member pages in order; a single page has one. */
  pages: number[];
  title: string | null;
  role: SlideRoleValue;
  grouping: LogicalSlideGrouping;
}
/** Raw and instructional denominators are two figures, always shown together; the role counts add up to `raw`. */
export interface SourceMapDenominators {
  raw: number;
  /** Pages whose role is instructional, worked example or question, or mixed. */
  instructional: number;
  by_role: Record<SlideRoleValue, number>;
  /** raw − instructional − excluded: the pages of objectives-or-summary and of unknown role. */
  uncertain: number;
  /** Pages of a no-forced-requirement role (structural, administrative, blank). A page of unknown role is never counted here. */
  excluded: number;
}
/** `state` is the state of the recorded alignment between the PowerPoint file's slides and these pages; never assumed. */
export interface SourceMapPptx { source_id: string | null; state: string | null; matched_pages: number }
export interface SourceMapReady {
  state: "ready";
  reason: null;
  contract: string;
  map_revision: string;
  source: SourceIdentity;
  page_index_base: number;
  page_count: number;
  page_layout: PageLayout | null;
  printed_numbers_established: boolean;
  /** Set only when a PowerPoint file of the unit was actually parsed. */
  pptx: SourceMapPptx | null;
  logical_slides: LogicalSlide[];
  denominators: SourceMapDenominators;
  limitations: string[];
  override_revision: number;
}
/** No map: it says why, counts the pages the view lists and claims nothing else. Each page is then identified by its index only. */
export interface SourceMapUnavailable {
  state: "unavailable";
  reason: SourceMapUnavailableReason;
  contract?: string;
  map_revision?: null;
  source?: SourceIdentity | null;
  page_index_base?: number;
  page_count?: number | null;
  page_layout?: null;
  printed_numbers_established?: boolean;
  pptx?: null;
  logical_slides?: LogicalSlide[];
  denominators?: { raw: number | null; instructional: null; by_role: null; uncertain: null; excluded: null } | null;
  limitations?: string[];
  override_revision?: number | null;
}
export type SourceMapBlock = SourceMapReady | SourceMapUnavailable;

/**
 * One learner correction, `{op, pages, value?, reason}`. `group`: adjacent pages that are one slide (`value` may name the
 * kind). `split`: each page stands alone. `split_before`: the one page starts a new slide. `role` / `printed_number` /
 * `regions`: the one page gets `value`. `revert`: `value` lists the revisions to undo (undo is a further revision).
 */
export type SourceMapOverrideRequest =
  | { op: "group"; pages: number[]; value?: Exclude<LogicalSlideKind, "single">; reason: string }
  | { op: "split"; pages: number[]; value?: undefined; reason: string }
  | { op: "split_before"; pages: [number]; value?: undefined; reason: string }
  | { op: "role"; pages: [number]; value: SlideRoleValue; reason: string }
  | { op: "printed_number"; pages: [number]; value: number | null; reason: string }
  | { op: "regions"; pages: [number]; value: Array<{ box: [number, number, number, number]; label?: string | null; title?: string | null; printed_number?: number | null }>; reason: string }
  | { op: "revert"; pages?: number[]; value: number[]; reason: string };
export type SourceMapOverrideOp = SourceMapOverrideRequest["op"];
/** One stored correction. Immutable; undo is a further revision. */
export interface SourceMapOverrideRecord {
  revision: number;
  reason?: string;
  created_at?: string;
  author?: { kind: string; ref?: string | null; learner_authority?: boolean } | string;
  op?: Record<string, unknown>;
  replaces?: number[];
  [key: string]: unknown;
}
/**
 * `GET …/source-map`: the `source_map` object of the lecture view (its fields at the top, spelled the same) and beside it
 * every page as the lecture view shows it, the history of corrections, and `map` — the full stored map of the displayed
 * deck in the source map's own spelling (null when there is none).
 */
export type SourceMapDocument = SourceMapBlock & {
  course_id: string;
  lecture_id: string;
  deck: { source_id: string | null; filename: string | null; registration: string | null } | null;
  pages: Array<{ page: number; identity: SlideIdentity; role: SlideRole }>;
  overrides: SourceMapOverrideRecord[];
  override_problems: unknown[];
  map: Record<string, unknown> | null;
};

// ---- 1.2 per slide: identity and role ------------------------------------------------------------------------------
/** The word for a page's place in its group: a build adds to the page before it, a step changes it, a copy repeats it; a part belongs to a group joined by a correction that names no kind. */
export type GroupPositionKind = "build" | "step" | "copy" | "part";
export interface SlidePosition { ordinal: number; of: number; kind: GroupPositionKind }
/** `basis`: "printed_on_page", or "correction" when the learner corrected it. */
export interface PrintedSlideNumber { value: number; basis: string }
/** A recorded match between THIS page and a slide of the unit's PowerPoint file. Never ordinal equality. */
export interface PptxMatch { slide_id: number; ordinal: number; match_basis: string | null; match_state: string }
export interface SlideIdentity {
  page_index: number;
  /** null only when neither a map nor the view states a count. */
  page_count: number | null;
  /** The PDF's own page label, as written in the file; shown as a label, never used as the index. */
  page_label: string | null;
  printed_slide_number: PrintedSlideNumber | null;
  pptx: PptxMatch | null;
  /** null when there is no source map (or the page is not a page of the mapped file): the page is identified by its index only. */
  logical_slide_id: string | null;
  /** null for a single page. */
  position: SlidePosition | null;
  /** The Brain's own wording. Screens word the identity through r2.identityOf, which follows the UI contract. */
  label: string;
  label_parts: string[];
}
export interface SlideRole {
  value: SlideRoleValue;
  /** null for the unknown role of a page without a source map. */
  state: RoleState | null;
  uncertain: boolean;
  /** false for a structural, administrative or blank page: no prompt, practice, concept requirement or missing-match warning is forced. */
  forced_requirements: boolean;
  basis: string[];
}

// ---- evidence ------------------------------------------------------------------------------------------------------
/** Five different states, never collapsed. */
export type EvidenceState = "unknown" | "not_applicable" | "not_separately_observed" | "assisted" | "independent";
/** Reported beside the state; never assistance by itself. */
export type PriorExposure = "unseen" | "seen" | "unknown";
export interface EvidenceObject {
  state: EvidenceState;
  /** The recorded kind, only when assisted (`reference_<value>` for reference-only help, `mixed` for several kinds). */
  assistance: string | null;
  prior_exposure: PriorExposure;
  /** Attempts that separately observed the thing. Unknown is never drawn as zero work. */
  attempts: number;
  /** Absent on graph nodes. */
  last_at?: string | null;
}
export interface EvidenceObservation {
  attempt_id: string;
  recorded_at: string | null;
  outcome: string | null;
  state: EvidenceState;
  assistance: string | null;
  prior_exposure: PriorExposure;
  question_id: string | null;
  skill_id?: string | null;
}
export interface EvidenceSummary { independent: number; assisted: number; not_separately_observed: number; unknown?: number; observations?: number; attempts?: number; unit?: string }
/** `outline/node` → `evidence`: the state of the latest attempt that separately observed the node, every observation once, and the composition. */
export interface NodeEvidence extends EvidenceObject { observations: EvidenceObservation[]; summary: EvidenceSummary }

// ---- 1.2 / 1.3 / 1.4 question ties ---------------------------------------------------------------------------------
/** Four kinds of tie; no rebuild changes one into another. */
export type TieKind = "exact" | "stated" | "agent_inferred" | "concept_related";
/** The kinds that name pages (or a section of pages). */
export type AnchorTieKind = Exclude<TieKind, "concept_related">;
/** "page": the tie names these pages. "section": the course's study map places the question somewhere in a range of pages. */
export type TieGranularity = "page" | "section";
export type TieFrom = "course_locator" | "course_study_map" | "inferred_anchor_file";
/** Where a tie's support is, relative to the selected page of its logical slide. */
export type TieWhere = "on_this_page" | "elsewhere_in_sequence" | "group_level";
/** How the named pages relate to the LISTED criteria. Neither value says that a slide teaches the whole answer. */
export type SuggestionCoverage = "main" | "partial";
/** Both are agent work. */
export type SuggestionState = "agent_inferred" | "agent_reviewed";
/**
 * What the checking pass said. "rejected" reaches a view only on a link the learner had confirmed: the Brain keeps the
 * learner's confirmation over a later rejection by the checking pass (the item stays listed with state "agent_reviewed",
 * `learner_decision: "confirmed"` and the pass's note in `verdict_note`). The API document names "upheld" and
 * "narrowed" only, and the UI contract says a rejected candidate is never shown as a link: the three disagree, so such
 * a link is never worded as "checked" — labels.suggestionStatus words it.
 */
export type SuggestionVerdict = "upheld" | "narrowed" | "rejected";
/** The learner's own local record beside a suggested link. */
export type LearnerDecision = "confirmed" | "rejected";
/**
 * A criterion by identity only: never its wording. `pages`: the pages the producer says carry this criterion, or null
 * when it made no page-by-page statement (the data behind "this page supports k of m"). Absent from an older Brain.
 */
export interface TieCriterion { criterion_id: string; number: number; label: string; concept_id: string | null; concept_label: string | null; skill_id: string | null; action_types: string[];
  pages?: number[] | null }
/** Which statement of the course catalog a course anchor is: its locator (where the question's content is) or its page field (where the question itself is printed). */
export type CatalogField = "locator" | "page";
/** A bounded region of a page, as fractions of the page from its top left. */
export interface TieRegion { page: number; box: [number, number, number, number]; region_id?: string | null }
export interface SectionTieDetail { page_ranges: Array<[number, number]>; label: string | null; row: number | null; scope: "all" | "part" | null }

/** Fields that only a suggested link carries; null on the course's own anchors. */
export interface CourseTieFields {
  criteria_supported: null;
  criteria_total: null;
  criteria: null;
  coverage: null;
  state: null;
  verdict: null;
  verdict_note?: null;
  rationale: null;
  regions: null;
  suggestion_id: null;
  learner_decision: null;
}
export interface SuggestedTieFields {
  /** n of "supports n of m criteria". */
  criteria_supported: number;
  /** m: the question's catalogued criteria of that version. 0 when none are catalogued. */
  criteria_total: number;
  criteria: TieCriterion[];
  coverage: SuggestionCoverage;
  state: SuggestionState;
  /** null until a second pass checked it. "rejected" only on a link the learner's confirmation keeps (see SuggestionVerdict). */
  verdict: SuggestionVerdict | null;
  /** The checking pass's own note, in its words; null when it wrote none or has not run. Absent from an older Brain. */
  verdict_note?: string | null;
  /** The producer's words. Never guidance, never an expected answer. */
  rationale: string;
  regions: TieRegion[] | null;
  suggestion_id: string;
  learner_decision: LearnerDecision | null;
}
interface SlideTieCommon {
  question_id: string;
  collection: string | null;
  number: number | null;
  title: string | null;
  /** null when the course index holds no wording for the question. */
  prompt: string | null;
  prompt_in_index: boolean;
  /** Member pages of THIS logical slide that the tie names. */
  support_pages: number[];
  /** Pages of the same deck in the same tie outside this logical slide. */
  other_pages: number[];
  /** From the course's own locator; [] when none. */
  transcript_lines: LineRange[];
  /** Which statement of the course catalog a course anchor is ("locator": where its content is; "page": where the question itself is printed); null on section ties and suggested links. */
  catalog_field?: CatalogField | null;
  why: string;
  evidence: EvidenceObject;
}
export interface SlideCourseTie extends SlideTieCommon, CourseTieFields {
  tie: "exact" | "stated";
  granularity: "page";
  from: "course_locator" | "course_study_map";
  section: null;
  where: TieWhere;
  criteria_supported_here?: null;
}
export interface SlideSuggestedTie extends SlideTieCommon, SuggestedTieFields {
  tie: "agent_inferred";
  granularity: "page";
  from: "inferred_anchor_file";
  section: null;
  where: TieWhere;
  /** How many of the question's criteria THIS page (or the member pages of this logical slide) supports. */
  criteria_supported_here?: number | null;
}
/** A tie of `slides[].question_ties`. */
export type SlideQuestionTie = SlideCourseTie | SlideSuggestedTie;
/** A tie of `slides[].section_ties`: a course statement about a range of pages, never a page anchor and never converted into one. */
export interface SlideSectionTie extends SlideTieCommon, CourseTieFields {
  tie: "exact" | "stated";
  granularity: "section";
  from: "course_study_map";
  section: SectionTieDetail;
  where: TieWhere | null;
  criteria_supported_here?: null;
}
/**
 * Where the support of a shared concept comes from: the concepts recorded for the slide's pages, or only what a
 * SUGGESTED link says these pages support. A question reached through a suggestion alone is said to be.
 */
export type RelatedConceptBasis = "page_concepts" | "suggested_link";
/** `slides[].related_questions`: shares a concept with this logical slide; not a claim about the slide. */
export interface RelatedQuestion {
  question_id: string;
  collection: string | null;
  number: number | null;
  title: string | null;
  prompt_in_index: boolean;
  tie: "concept_related";
  /** `basis` is absent from an older Brain. */
  via_concepts: Array<{ concept_id: string; label: string; basis?: RelatedConceptBasis }>;
  lecture_ids: string[];
  evidence: EvidenceObject;
}

interface LectureTieCommon {
  lecture_id: string | null;
  source_id: string | null;
  /** [] for a question the course anchors to transcript lines only. */
  pages: number[];
  logical_slide_ids: string[];
  transcript_lines?: LineRange[];
  /** True when the pages are pages of the deck the lecture is shown with. */
  on_displayed_deck: boolean;
  /** Only on the ties of a question view (no deck is on screen there): the pages are pages of the slides of `lecture_id`. */
  on_lecture_deck?: boolean;
  granularity?: TieGranularity;
  from?: TieFrom;
  catalog_field?: CatalogField | null;
  section?: SectionTieDetail | null;
}
export interface LectureCourseTie extends LectureTieCommon, CourseTieFields { tie: "exact" | "stated" }
export interface LectureSuggestedTie extends LectureTieCommon, SuggestedTieFields { tie: "agent_inferred" }
/** A tie of `questions.all[].ties`. */
export type LectureQuestionTie = LectureCourseTie | LectureSuggestedTie;

/** Why `no_suggestion`: no file for the course, no item for the question, items made for an earlier version, the learner rejected the link, or the file cannot be read. */
export type NoLinkReason = "no_file" | "no_item" | "stale" | "rejected_by_learner" | "file_unreadable";
/** One of two lines for a question with no course anchor and no displayable suggestion. */
export type NoLink =
  | { state: "inspected_no_support"; /** The checking pass's own reason, in its words. */ reason: string }
  | { state: "no_suggestion"; reason: NoLinkReason };
export type NoLinkState = NoLink["state"];
export interface SuggestionHistory {
  stale: number;
  rejected_by_verifier: number;
  rejected_by_learner: Array<{ suggestion_id: string; lecture_id: string | null; source_id: string | null; pages: number[]; learner_decision: "rejected" }>;
  /**
   * Decisions of the learner on suggestions that are not shown now, each with why it is not: the checking pass rejected the
   * item ("rejected_by_verifier"), it was made for an earlier version ("stale"), or the file no longer holds it
   * ("not_in_file", "no_file", "file_unreadable").
   */
  decisions_not_shown?: Array<{ suggestion_id: string; lecture_id?: string | null; source_id?: string | null; pages?: number[]; learner_decision?: LearnerDecision; reason?: string; [key: string]: unknown }>;
}
/** course_anchor + agent_inferred + without_link = all. course_section counts questions the course's study map places in a section; never part of course_anchor.
 *  course_anchor_with_suggestion is a PART of course_anchor: anchored by the course (to whatever file) and also carrying a current suggested link to pages. */
export interface LectureQuestionCountsBlock { all: number; course_anchor: number; agent_inferred: number; without_link: number; course_section?: number; course_anchor_with_suggestion?: number }

// ---- 1.2 ranges ----------------------------------------------------------------------------------------------------
/** "displayed_during" only with inspected frame evidence; otherwise a range says the slide was discussed. */
export type RangeRelation = "discussed_during" | "displayed_during";
/** "section": a course-stated pairing of pages with transcript lines; it appears on every page it names and carries no per-page time. */
export type RangeSupportScope = "page" | "build_group" | "region" | "section";
export type RangeOrigin = "pipeline" | "manual" | "reviewed_source_map";
export type RangeReviewState = EstablishedState;
/** Three independent qualities, never merged into one figure. */
export type QualityName = "acoustic" | "association" | "group_mapping";
export interface QualityFacet { state: string; basis: string }
export interface TimingRange {
  range_id: string;
  recording: SourceIdentity;
  timebase: "original_source_start";
  start_ms: number;
  end_ms: number;
  relation: RangeRelation;
  /** 1-based position among the separate visits of this slide. Separate visits are separate ranges. */
  occurrence_index: number;
  occurrences_total: number;
  /** A build_group range applies to the group and carries no per-build times. */
  support: { scope: RangeSupportScope; pages: number[]; builds: number[] | null };
  method: MethodRef;
  origin: RangeOrigin;
  review_state: RangeReviewState;
  quality: Record<QualityName, QualityFacet>;
  /** null when the link records no reason. */
  why: string | null;
  evidence: { transcript_lines?: LineRange[]; terms?: string[]; shape?: string | null; [key: string]: unknown };
  /** Set for manual and human-confirmed links (ll.annotation/1 records). */
  annotation_id: string | null;
}

export type NoRangeState = "recording_unavailable" | "no_range_expected" | "audio_unprocessed" | "association_not_run" | "ambiguous" | "not_discussed";
/**
 * Why slide matching has no result under the current inputs: not run yet, inputs changed since it ran, or no adequate
 * matching method is available (the UI contract's three phrases). The Brain of today writes the first two only; what
 * kept a run from producing anything is in `detail.reason` (AssociationNotRunReason).
 */
export type AssociationCause = "not_run" | "inputs_changed" | "no_adequate_method";
/** What kept slide matching from running or from producing a result for a recording, as recorded beside the cause. */
export type AssociationNotRunReason = "no_generated_timing" | "recording_unavailable" | "no_slide_text" | "no_windows";
/**
 * Why a page of a recording with timing still reads "audio not processed": nothing was generated, only part of the
 * recording has timing, or the whole recording is transcribed and some transcript lines could not be given a time.
 */
export type AudioUnprocessedReason = "no_generated_timing" | "partly_processed" | "transcript_lines_without_time";
/** Why there is no recording to play. */
export type RecordingUnavailableReason = "recording_unreadable" | "no_recording_in_session" | "no_session_linked";
/** A candidate of an ambiguous slide: an occurrence that was not clear enough to show, or an interval whose wording fits several slides. */
export interface NoRangeCandidate {
  start_ms: number;
  end_ms: number;
  kind?: "occurrence" | "ambiguous_interval";
  range_id?: string | null;
  recording_source_id?: string | null;
  why_not_shown?: string | null;
  /** The logical slides an ambiguous interval lies between. */
  between?: string[];
  [key: string]: unknown;
}
/** `detail` carries the reason, the processed part or the candidates. The API document does not spell its keys; the ones typed below are those the Brain writes. Read them through r2.noRangeDetail. */
export interface NoRangeDetail { rejected_suggestions?: number; [key: string]: unknown }
/** A slide without a range carries exactly one of six states, each with its own cause. */
export type NoRange =
  | { state: "recording_unavailable"; text: string; detail: NoRangeDetail & { reason?: RecordingUnavailableReason | (string & {}) | null } }
  | { state: "no_range_expected"; text: string; detail: NoRangeDetail & { role?: SlideRoleValue } }
  | { state: "audio_unprocessed"; text: string; detail: NoRangeDetail & { /** [recording source id, start_ms, end_ms] of each part that has timing. */ processed?: Array<[string, number, number]>;
      reason?: AudioUnprocessedReason | (string & {}) | null;
      /** Per recording with timing: how much of it is covered and how many transcript lines received a time. */
      coverage?: Array<{ recording_source_id: string; coverage_fraction: number | null; covers_whole_recording: boolean; unresolved_ms: number; lines_aligned: number | null; lines_total: number | null }> } }
  | { state: "association_not_run"; text: string; detail: NoRangeDetail & { cause?: AssociationCause | (string & {}) | null; /** The inputs that changed. */ differs?: string[];
      reason?: AssociationNotRunReason | (string & {}) | null } }
  | { state: "ambiguous"; text: string; detail: NoRangeDetail & { candidates?: NoRangeCandidate[] } }
  | { state: "not_discussed"; text: string; detail: NoRangeDetail };

// ---- 1.3 lecture timing and revisions ------------------------------------------------------------------------------
export type TimingStage = "no_recording" | "audio_unprocessed" | "partly_processed" | "processed" | "associated";
export interface TimingGenerated {
  generation: string;
  text_origin: string;
  review_state: string;
  /** What was resolved. The processed window alone is never coverage. */
  covered_intervals: MsInterval[];
  /** Parts whose text was withheld: neither speech nor silence is known there. */
  unresolved_intervals: Array<MsInterval | { start_ms: number; end_ms: number; reason?: string | null }>;
  unresolved_ms: number;
  coverage_fraction: number | null;
  covers_whole_recording: boolean | null;
}
export type TextAlignmentState = "accepted" | "refused" | "no_transcript" | "not_run";
export interface TimingTextAlignment { state: TextAlignmentState; reason: string | null; lines_aligned: number | null; lines_total: number | null; method: MethodRef | null }
export type AssociationState = "current" | "stale" | "not_run";
export interface TimingAssociation {
  state: AssociationState;
  cause: string | null;
  method: MethodRef | null;
  built_at: string | null;
  ranges: number | null;
  unassigned_ms: number | null;
  /** What the association was built from; a part that does not apply (nothing was built) is null. */
  inputs: { recording_sha256: string | null; generation: string | null; map_revision: string | null; method_version: string | null } | null;
}
export interface TimingRecording {
  source_id: string;
  filename: string | null;
  duration_ms: number | null;
  /** null when nothing was generated for this recording. */
  generated: TimingGenerated | null;
  text_alignment: TimingTextAlignment;
  association: TimingAssociation;
}
export interface TimingSummary {
  pages: number;
  pages_with_range: number;
  pages_no_range_expected: number;
  pages_without_range: number;
  ranges: number;
  human_confirmed: number;
  agent_reviewed: number;
  generated: number;
}
export interface LectureTiming { stage: TimingStage; recordings: TimingRecording[]; summary: TimingSummary }
/**
 * The revisions a lecture view was built from. A view is current only when all match. Every key is optional: the API
 * document lists all six, and the Brain of today states `timing_links` only (a key that is absent claims nothing).
 */
export interface ViewRevisions {
  deck_sha256?: string | null;
  map_revision?: string | null;
  question_index_sha256?: string | null;
  inferred_anchors_sha256?: string | null;
  /** One entry per recording whose timing links are current; `links_revision` is null when the document states none. */
  timing_links?: Array<{ recording_source_id: string; links_revision: string | null }>;
  evidence_revision?: string | null;
}

// ---- 2 other routes ------------------------------------------------------------------------------------------------
/** The speech runner's row for a recording; `state` is "not_listed" (with nulls) when the runner does not list it. */
export interface TimingQueue { state: string; chunks_done: number | null; chunks_total: number | null; seconds_covered: number | null; position?: number | null }
export interface TimingAllowance { ceiling_seconds: number; used_seconds: number; remaining_seconds: number }
/** Measured values only; nothing estimates what remains. */
export interface CourseTimingSummary {
  lectures?: number;
  stages?: Partial<Record<TimingStage, number>>;
  recordings?: number;
  recordings_with_generated?: number;
  recordings_associated?: number;
  covered_ms?: number;
  unresolved_ms?: number;
  duration_ms?: number;
  ranges?: number;
  [key: string]: unknown;
}
/** `GET /api/courses/{c}/timing`: per lecture and recording the stage, coverage and queue; the allowance of local transcription; the one resumable command. */
export interface CourseTimingView {
  course_id: string;
  /** null when the allowance ledger is absent or unreadable. */
  allowance: TimingAllowance | null;
  resume_command: string | null;
  /** The command that rebuilds the course's timing links. */
  build_command?: string | null;
  lectures: Array<{
    lecture_id: string;
    title: string | null;
    stage: TimingStage;
    /** Where the lecture's stored timing links stand against the current inputs. */
    links?: { state: string; differs: string[]; built_at: string | null };
    recordings: Array<TimingRecording & { queue?: TimingQueue | null }>;
  }>;
  summary: CourseTimingSummary;
  note?: string;
}

/** `GET /api/courses/{c}/inferred-anchors`: counts and ids only, no prose of the file. */
export interface InferredAnchorsCollectionRow {
  collection: string | null;
  questions: number;
  accepted: number;
  stale: number;
  rejected_by_verifier: number;
  refused: number;
  questions_with_suggestion: number;
  questions_inspected_no_support: number;
  questions_without_suggestion: number;
}
/**
 * Where the suggestions file of a course stands: read and made for the current question catalog ("ok"); none exists;
 * it cannot be read; it was made for an earlier question catalog (its items are then stale, not current links); or the
 * catalog itself could not be read, so the file was not compared with it.
 */
export type InferredFileState = "ok" | "missing" | "unreadable" | "made_for_earlier_catalog" | "catalog_unavailable";
/** A decision of the learner that no current link carries, by identity only. */
export interface InferredDecisionRef { suggestion_id: string; decision: SuggestionDecision; revision: number; decided_at: string | null; question_id?: string | null; lecture_id?: string | null;
  source_id?: string | null; pages?: number[] | null }
export interface InferredAnchorsReadback {
  course_id?: string;
  contract?: string;
  reader?: string;
  file: { state: InferredFileState; produced_at: string | null; sha256: string | null; question_index_matches: boolean | null };
  file_reason?: string | null;
  accepted: number;
  /** Refused entries by reason. A refused entry is never repaired. */
  refused: Record<string, number>;
  stale: number;
  rejected_by_verifier: number;
  by_collection: InferredAnchorsCollectionRow[];
  no_candidate?: number;
  stale_by_reason?: Record<string, number>;
  /** The learner's decisions in force, and those no current link carries: on a stale item, on one the checking pass rejected, or on one the file no longer holds. */
  decisions?: { confirmed: number; rejected: number; cleared: number; orphaned?: InferredDecisionRef[]; on_stale?: InferredDecisionRef[]; on_rejected_by_verifier?: InferredDecisionRef[];
    problems?: unknown[]; [key: string]: unknown };
  note?: string;
  [key: string]: unknown;
}

/** "cleared" takes a decision back. */
export type SuggestionDecision = LearnerDecision | "cleared";
export interface SuggestionDecisionRequest { decision: SuggestionDecision; expected_revision?: number }
export interface SuggestionDecisionResponse {
  course_id: string;
  suggestion_id: string;
  /** The decision in force. null (with revision 0 and status "unchanged") when a clear was asked for and nothing had been decided. */
  decision: SuggestionDecision | null;
  revision: number;
  /** "unchanged": the same decision was already in force; nothing was written. */
  status: "recorded" | "unchanged";
  decided_at: string | null;
  question_id: string | null;
}

// ---- 3 concept graph -----------------------------------------------------------------------------------------------
export type GraphNodeKind = "topic" | "concept" | "skill" | "question" | "criterion";
/** assessment: question → criterion → concept or skill. source: taught or supported on a page. structure: containment, prerequisite, overlap. */
export type GraphEdgeFamily = "assessment" | "source" | "structure";
export type GraphScopeKind = "course" | "lecture" | "slide";
/** The `scope` parameter: `course`, `lecture:<lecture_id>` or `slide:<lecture_id>:<page>`. */
export type ConceptGraphScopeParam = "course" | `lecture:${string}` | `slide:${string}:${number}`;
export interface ConceptGraphScope {
  kind: GraphScopeKind;
  lecture_id: string | null;
  page: number | null;
  logical_slide_id: string | null;
  /** The identity label of the selected page (slide scope). */
  label: string | null;
  /** Member pages of the logical slide, so a support page can be named as a build. */
  pages: number[];
  /** Why a scope is empty, or that the page is structural and nothing is required of it. */
  note: string | null;
}
export interface ConceptGraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** null where a count does not apply. */
  counts: { skills: number | null; questions: number | null };
  /** false for a node drawn although it lies outside the scope (a related question, or a focus outside the scope). */
  in_scope: boolean;
  /** Slide scope only. */
  where: TieWhere | null;
  support_pages: number[];
  evidence: EvidenceObject | null;
}
export interface ConceptGraphEdge {
  id: string;
  /** A source edge starts at `scope.logical_slide_id` (or `slide:<lecture>:<page>`), which is not a node: the page is drawn from `scope`. */
  from: string;
  to: string;
  family: GraphEdgeFamily;
  /** The owner's label, or `slide_supports` / `slide_supports_by_assessment` on source edges. */
  relation: string;
  provenance: string;
  automatic_credit: boolean;
  /** Source edges only. */
  tie: AnchorTieKind | null;
  support_pages: number[] | null;
}
/**
 * What a concept graph was built from. A key that does not apply is null (the course graph draws neither a slide nor an
 * anchor: no `map_revision`, no `anchor_revision`). `anchor_revision` changes when an anchor of the lecture is added,
 * moved or removed and when a suggested link is accepted, rejected or cleared. The API document lists the first three
 * and `scope_revision`; the Brain also states the skills catalog, the anchor revision and the policy revision
 * (interface-contracts R2, "Revisions and invalidation"), optional here for a Brain that omits them.
 */
export interface ConceptGraphRevisions {
  question_index_sha256: string | null;
  map_revision: string | null;
  evidence_revision: string | null;
  scope_revision: string;
  skills_sha256?: string | null;
  anchor_revision?: string | null;
  policy_revision?: string | null;
}
export interface ConceptGraphView {
  course_id: string;
  graph_version: string;
  scope: ConceptGraphScope;
  nodes: ConceptGraphNode[];
  edges: ConceptGraphEdge[];
  focus: string | null;
  truncated: boolean;
  /** How many nodes the limit left out. */
  dropped: number;
  /** What the scope holds, each id once; unaffected by focus and limit. */
  totals: Record<GraphNodeKind, number>;
  revisions: ConceptGraphRevisions;
}
export type ConceptGraphErrorCode = "unknown_scope" | "unknown_focus";
/**
 * The error document (404). A malformed request answers 422. The read layer turns either spelling — this document, or
 * the `{detail: "Unknown scope" | "Unknown focus"}` the Brain of today answers — into an ApiError; r2.conceptGraphErrorCode tells which.
 */
export interface ConceptGraphError { course_id: string; graph_version: string; error: { code: ConceptGraphErrorCode; detail: string } }

// ---- outline/node additions ----------------------------------------------------------------------------------------
/** What a source row of a node names: pages of a file, transcript lines, or a broad reference in words. */
export type OutlineSourceKind = "pages" | "transcript_lines" | "text";
export type OutlineQuestionTieToNode = "assessment" | "self" | "criterion_of_question";
export interface ConceptDefinition { state: "catalog" | "coverage_gap"; text: string | null; reason: string | null }

// ---- health --------------------------------------------------------------------------------------------------------
// The build identity of `GET /api/health` is typed where it is read (./build.ts) and re-exported here under the names of
// the API document, so the R2 shapes can be imported from one module.
export type { AssetNames, CoursePreparationIdentity, ServedIdentity, ServedIdentity as HealthBuildIdentity, ServedWebBuild } from "./build";
import type { ServedIdentity as BuildIdentity } from "./build";
/** `GET /api/health`. `build` is absent from an older Brain process. */
export interface HealthView { build?: BuildIdentity; [key: string]: unknown }
