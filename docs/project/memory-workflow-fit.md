# Memory and workflow decisions — 0.7.0

## Scope and verdict

The foundation should be retained. Existing source/catalog/attempt authorities are not replaced. The actual missing layers are complete-input capture and verification, typed source alignment, durable diagnostic/review/session operations, focused projections, context preparation and resident supervision. Code and schema behavior in this report is reported by the managing agent, not independently rerun in this session.

This document compares the v0.6 design against P05 (October 2 audit) and the visible partial P06 report. It is a design recommendation and implementation plan, not a migration, runtime approval, native bridge verification or pedagogical validation.

## Three different sorts of memory

1. Existing academic authority: original sources, course catalogs, actual attempts and their approved corrections. Keep one owner per fact.
2. New operational facts: the exact new user submission, native request/result correlation, deliberate review selection/event and resume checkpoint. These are genuinely needed new records, not a second gradebook.
3. Derived views: concept trees, gap summaries, due lists, conversation summaries and status dashboards. They can be rebuilt; editing their appearance never changes canonical performance.

A new accepted timing annotation is a special case of new source information: unlike a gap summary, it cannot be reconstructed solely from old attempts. Extend the existing source-link owner to persist it; do not discard it as a cache or create another independent concept authority.

## Current-state memory inventory

| ID | Memory | Reported status | Decision |
|---|---|---|---|
| M01 | Source material, identity and version memory | EXISTS_PARTIAL_COVERAGE | KEEP_AND_EXTEND |
| M02 | Precise source links and media/rendition memory | PARTIAL_PROSE_LINKS | EXTEND_EXISTING_SOURCE_LINK_OWNER |
| M03 | Course policy, learning goals and preferences | EXISTS_PROMPTED_AND_CONFIGURED | KEEP_AND_WRAP |
| M04 | Concept, topic, skill and relationship memory | EXISTS_UNEVEN_STRUCTURAL_COVERAGE | KEEP_CANONICAL_DEFINITIONS_BUILD_PROJECTIONS |
| M05 | Question, rubric and answer-exposure memory | EXISTS_WITH_COURSE_DIFFERENCES | KEEP_AND_EXTEND_CONTENT_BOUNDARIES |
| M06 | Complete submitted interaction and attachments | PARTIAL_HISTORY_NO_VERIFIED_FULL_CAPTURE | BUILD_COMPATIBLE_IMMUTABLE_SIDECARS |
| M07 | Assessed attempts, assistance and correction history | EXISTS_WITH_REAL_ATTEMPTS_AND_SCHEMA_CORRECTIONS | KEEP_SCHEMA_REPAIR_AND_WRAP_WRITERS |
| M08 | Learning gaps, possible causes and remediation state | EVIDENCE_EXISTS_PROJECTIONS_AND_DIAGNOSIS_CONTROL_MISSING | DERIVE_GAP_VIEWS_BUILD_NONASSESSMENT_PROPOSALS |
| M09 | Progress summaries and learning-state displays | EXISTS_WITH_STALE_VIEWS | KEEP_RENDERERS_ADD_FRESHNESS_AND_RECEIPTS |
| M10 | Cross-course reference memory | EXISTS_LIMITED_REVIEWED_MAPPING | KEEP_OWNER_EXTEND_ONLY_BY_REVIEW |
| M11 | Review selection, scheduling and review-event memory | SUGGESTIONS_EXIST_EXECUTING_SCHEDULER_ABSENT | BUILD_OPERATIONAL_REVIEW_CONTRACT_REUSE_QUESTION_IDS |
| M12 | Session resume, drafts and device continuity | PARTIAL_NATIVE_HISTORY_NO_UNIFIED_STATE | BUILD_SMALL_OPERATIONAL_RESUME_STATE |
| M13 | Retrieved working context and compact summaries | PROMPTED_SELECTIVE_RETRIEVAL_PARTLY_IMPLEMENTED | REUSE_READERS_BUILD_CONTEXT_SELECTOR_AND_RECEIPT |
| M14 | Operational queue, native runs, receipts and recovery memory | EXISTING_JOB_LOGS_BUT_LEARNING_QUEUE_ABSENT | BUILD_THIN_SUPERVISOR_REUSE_EXISTING_JOBS_AND_WRITERS |
| M15 | Retention, historical evidence and backup/recovery lifecycle | PARTIAL_PROTOCOLS_NO_COMPLETE_LIFECYCLE_PROOF | KEEP_EXISTING_RECOVERY_ADD_REFERENTIAL_RETENTION |

### M01 — Source material, identity and version memory

**Current:** Originals and stable source/version records exist. Registration/coverage differs by course. No complete source-ID to Drive-file-ID mapping or immutable historical blob archive was established.

**Decision:** KEEP_AND_EXTEND. **Owner:** Existing course source owner and protected tracking publisher.

**Existing or proposed locations:** `materials/`; `.agent/source-index.json`; `existing source updater receipts`.

**Build/modify:**
1. Preserve IDs, path aliases, roles and source versions. Add a narrowly reviewed storage resolver mapping to Drive IDs without replacing academic identities.
2. Use source/version/locator to resolve current permitted bytes and a rendition. Verify bytes separately from metadata and remote-delivery claims.
3. Retain all-lecture inventory including empty, unavailable, unrecorded and unindexed material. Where old bytes are needed, retain authorized snapshots or report unavailability honestly.

**Reason:** Navigation and historical evidence require stable identity; filename equality, a Drive folder listing and a checksum alone are insufficient.

**Acceptance, NOT_RUN:** Reordered/renamed/re-exported source does not attach old notes to a new slide silently. All inventoried lectures remain accounted for; no old source is regenerated and presented as original.

**Consumed by:** WF01, WF02, WF03, WF04, WF05, WF07, WF09, WF10, WF11. **Reported evidence:** P05 Q025-Q036; lines 100-128, 232-243; P06 A6/B6 (partial).

### M02 — Precise source links and media/rendition memory

**Current:** BE 505 reviewed source maps link slide/page ranges to transcript lines; some renders/views exist. Verified recording intervals and universal typed anchors/renditions were not established.

**Decision:** EXTEND_EXISTING_SOURCE_LINK_OWNER. **Owner:** Existing source-map/catalog owner; new timing annotations need an explicit approved owned record.

**Existing or proposed locations:** `work/lecture-review/*-source-map.md`; `existing source/catalog references`; `.agent/course-learning/runs/<run-id>/proposals/ (proposed candidates)`; `exports/learning/alignment.json (proposed derived view)`; `.cache/ and exports/ for versioned allowed renditions`.

**Build/modify:**
1. Inspect originals, timing basis, transcript fidelity and visible video before selecting processing. Keep displayed-slide links distinct from concept-discussion links.
2. Derive normalized anchors from existing reviewed maps where possible. New reviewed timestamps are genuinely new annotations: adopt a minimal versioned representation under the SAME source-link owner, and declare which record is authoritative before publishing.
3. Do not pretend an export alone preserves a manual correction. Persist the accepted original assertion, predecessor, source versions, support and review status; regenerate exports from it.
4. Use many-to-many ranges, media time origin, page/printed-page distinctions, evidence and unresolved states. Never strengthen a paragraph/chapter reference into an exact page.

**Reason:** A gap summary is derived evidence, but a newly reviewed audio interval is new information and must have a durable owner. Treating both as disposable exports loses corrections.

**Acceptance, NOT_RUN:** An accepted correction survives deletion/rebuilding of derived alignment output. Old prose and normalized records cannot become two independently editable authorities for the same assertion. Unrecorded audio cannot yield a confirmed original recording interval.

**Consumed by:** WF02, WF03, WF04, WF05, WF09, WF10. **Reported evidence:** P05 Q031-Q042; lines 238-254, 446-454; P06 A5/B5 and v0.6 WF02.

### M03 — Course policy, learning goals and preferences

**Current:** Course instructions, context, learning strategies, mode and study-choice vocabulary exist. An automated receipt of what each native turn actually loaded is not universal.

**Decision:** KEEP_AND_WRAP. **Owner:** Course policy/strategy owner; user intent and permissions.

**Existing or proposed locations:** `AGENTS.md`; `course-context.md`; `learning-strategy.md`; `learning/skills.yaml`; `central protocols/`.

**Build/modify:**
1. Load trusted course/mode instructions explicitly and log selected versions in a bounded context receipt.
2. Keep develop/maintain/reference_only/defer/undecided choices distinct from performance. Preserve course-specific assistance boundaries.
3. No request, retrieved document, or generated summary can modify its own permissions, spending or trusted strategy.

**Reason:** A file existing is not evidence it entered the model context, and study priority is not competence.

**Acceptance, NOT_RUN:** Course A cannot inherit course B answer-reveal policy accidentally. A hostile source instruction cannot expand a tool or canonical write permission.

**Consumed by:** WF00, WF02, WF03, WF04, WF05, WF06, WF07, WF08. **Reported evidence:** P05 Q067-Q070, Q074/Q078, Q091-Q096; P06 B2.

### M04 — Concept, topic, skill and relationship memory

**Current:** Skills/topics and families exist in each course; BE 505 has a richer concept/question/criterion index. No uniform independent concept graph is installed or needed as duplicate authority.

**Decision:** KEEP_CANONICAL_DEFINITIONS_BUILD_PROJECTIONS. **Owner:** Owning course catalogs and reviewed shared mappings.

**Existing or proposed locations:** `learning/skills.yaml`; `learning/question-families.yaml`; `BE 505 learning/question-index.json`; `exports/learning/concept-tree.json (proposed view)`.

**Build/modify:**
1. Normalize read models over existing typed IDs. A display node references its true concept/topic/skill/question kind.
2. Keep strict_containment, partial_overlap and diagnostic_prerequisite on their actual question endpoints; do not relabel them as universal concept-part or curriculum prerequisites.
3. Create multilayer views with bounded traversal, visited-node guards and multiple references to one ID. Apply acyclicity only to a relation whose contract requires it; related/concept discussions can have cycles.
4. For an unmapped course concept, propose the smallest source-backed extension to that course owner; do not silently install the full BE 505 schema everywhere.

**Reason:** The useful graph already starts in the catalogs. A second definition store would split identities, misstate relationships and fragment learning history.

**Acceptance, NOT_RUN:** One concept in several tree branches produces one logical identity and no extra performances. Question containment is not converted into a false concept hierarchy; missing mapping is a system-coverage gap.

**Consumed by:** WF03, WF04, WF05, WF06, WF07, WF09, WF10. **Reported evidence:** P05 Q043-Q048; lines 255-260, 400-444; P06 B5.

### M05 — Question, rubric and answer-exposure memory

**Current:** All courses have family/rubric records; BE 505 has exact questions and criteria. Tutor-authored guides and original prompts have different authority; solution separation is not fully access-enforced.

**Decision:** KEEP_AND_EXTEND_CONTENT_BOUNDARIES. **Owner:** Existing family/question catalog owner.

**Existing or proposed locations:** `learning/question-families.yaml`; `BE 505 learning/question-index.json`; `original instructor prompts/figures`; `separate assessor guides`.

**Build/modify:**
1. Prefer existing questions and rubric versions, including diagrams and givens. Keep source prompts authoritative where catalog prompt is intentionally null.
2. Pin the intended family/skills before assessment and record whether the rubric is instructor-supplied or tutor-authored. A model answer is not automatically a key.
3. Prevent unintended answer material from entering question-only context. UI collapse is not permission control. Stage unsupported alternative answers/rubric changes for appropriate review.

**Reason:** A valid rubric reference can still be pedagogically incorrect; disclosure changes the meaning of a later attempt.

**Acceptance, NOT_RUN:** Question-only mode cannot obtain solution text through another supplied field. New question versions do not rewrite prompts/rubrics used by older attempts.

**Consumed by:** WF03, WF04, WF05, WF06, WF07, WF08, WF09, WF10. **Reported evidence:** P05 Q049-Q054; lines 261-266, 400-426; P06 B4/B5.

### M06 — Complete submitted interaction and attachments

**Current:** Native history and excerpts/locators exist. Guaranteed immutable capture of every submitted prompt/response plus full delivered reply and attachments is not implemented. Existing locators are not hash validators.

**Decision:** BUILD_COMPATIBLE_IMMUTABLE_SIDECARS. **Owner:** New operational evidence capture owner around the existing learning writer.

**Existing or proposed locations:** `.agent/course-learning/runs/<run-id>/turns/<turn-id>.json (proposed)`; `.agent/course-learning/runs/<run-id>/messages/<message-id>.json (proposed)`; `.agent/course-learning/runs/<run-id>/attachments/ and receipts/ (proposed)`.

**Build/modify:**
1. Capture full shown question, actual learner answer, modalities, required figures, assistance and time basis before inference. Preserve input even if grading fails or is unavailable.
2. Freeze and read back the learner snapshot; store later tutor messages separately. Transport retries keep one logical learner response even when dispatch/run IDs change.
3. Verify relative path, bytes, source and item identity, attachment digests and exact excerpt around publication. Unicode/transcript normalization must be explicit rather than silently changing original text.
4. Raw voice retention remains a separate choice. If only text is permitted, preserve the exact transcript as text evidence and mark the raw audio unavailable.
5. Do not put snapshots or new record kinds in learning/attempts, and do not backfill missing historical content with AI.

**Reason:** The user requested complete future interaction evidence; the existing compact record format can point to it without becoming a competing attempt schema.

**Acceptance, NOT_RUN:** Question/learner snapshot survives a model failure; later reply does not change its digest. An altered attachment, wrong course/turn or missing excerpt blocks a verified save/reuse claim. Identical native-result retry does not become a second learner message.

**Consumed by:** WF00, WF04, WF05, WF06, WF08, WF09, WF10, WF11. **Reported evidence:** P05 Q055-Q059; lines 272-276, 494-510; P06 B4 exact schema/locator limitations.

### M07 — Assessed attempts, assistance and correction history

**Current:** Immutable attempts and per-skill judgments are real. Assessment_revision is supported by contract/code; P05 found zero real revisions, so production correction behavior is not demonstrated merely by the schema.

**Decision:** KEEP_SCHEMA_REPAIR_AND_WRAP_WRITERS. **Owner:** Existing course-learning-v1 owner; BE 505 helper and other coordinated writers.

**Existing or proposed locations:** `learning/attempts/YYYY-MM/<id>.json`; `course_learning.py validation/rendering`; `BE 505 study_index.py save-attempt`.

**Build/modify:**
1. Keep exact required fields, outcome enums, time semantics and one intended family/skill set. New responses create new attempts; regrades create one connected nonbranching same-skill assessment-revision chain.
2. Use the full-turn verifier before and around the real save. Retain saved/already_saved/view-stale distinctions.
3. For other courses, build a tested common facade for the prescribed no-clobber procedure; do not claim an existing universal save executable.
4. Isolate/fix BE 505 global ROOT/path dependencies before any fixture save. Do not send learning attempts through the separate tracking publisher.

**Reason:** Replacing an established learner-history format creates risk without adding learning value. The missing work is reliable capture, actual integration and safer writer portability.

**Acceptance, NOT_RUN:** Same ID/same bytes reuses evidence; same ID/different bytes conflicts. No error diagnosis on not_observed; corrections preserve original question, response, occurrence time and skill set. View failure after saved attempt never causes a new attempt.

**Consumed by:** WF05, WF06, WF08, WF09, WF10, WF11. **Reported evidence:** P05 lines 164-171, 268-289, 498-510, 590-596; P06 B3/B4.

### M08 — Learning gaps, possible causes and remediation state

**Current:** Missing/incorrect content, error categories and analysis already belong in observations. Narrative roadmaps and prompted diagnostics exist; no automated persistent hypothesis workflow or dedicated derived gap view was found.

**Decision:** DERIVE_GAP_VIEWS_BUILD_NONASSESSMENT_PROPOSALS. **Owner:** Effective canonical attempts/revisions for performance; operational proposals for unresolved explanations.

**Existing or proposed locations:** `existing observation fields and study roadmaps`; `.agent/course-learning/runs/<run-id>/proposals/<proposal-id>.json (proposed diagnostic work)`; `exports/learning/learning-gaps.json and learning-gaps.md (proposed views)`.

**Build/modify:**
1. Compute current evidence from effective correction chains and comparable skills/conditions, keeping supporting and contradicting attempts visible.
2. Separate observed error, possible cause, question that discriminates between causes, and chosen next action. Operational candidate causes must never count as diagnosed learner failures.
3. Use only actual criterion IDs where available; otherwise stay at validated skill/family granularity instead of inventing fine-grained measurements.
4. For each real next answer use WF05, then update or close the hypothesis under explicit policy. Assisted correction is not independent retention; passage of time is not forgetting evidence.
5. If a required diagnosis cannot be represented without ambiguity in current analysis, propose a reviewed extension to the existing observation owner, not a second canonical gap ledger.

**Reason:** The user needs a useful gap dashboard, not another database competing with the original evidence. Root causes are hypotheses until demonstrated.

**Acceptance, NOT_RUN:** Correcting a mistaken grader retracts the derived finding without deleting the original response. A failed advanced task cannot mark all graph ancestors weak. New conflicting/comparable evidence is visible; neither latest answer nor highest confidence blindly erases history.

**Consumed by:** WF05, WF06, WF07, WF08, WF09, WF10. **Reported evidence:** P05 Q047/Q055-Q060/Q075; lines 259, 272-277, 297-301; P06 B4/B5.

### M09 — Progress summaries and learning-state displays

**Current:** learning-state.md and helpers derive learning evidence; some saved views are stale. Counts and priorities are not calibrated mastery, retention or transfer probabilities.

**Decision:** KEEP_RENDERERS_ADD_FRESHNESS_AND_RECEIPTS. **Owner:** Existing course/shared rendering owners; outputs are derived.

**Existing or proposed locations:** `learning-state.md`; `existing study-map/learning exports`; `exports/learning/ derived additions`.

**Build/modify:**
1. Verify originals and effective revisions before deriving/displaying facts; show staleness when current regeneration is unavailable.
2. Build source-linked observations, assistance, timestamps and counterevidence into the UI; do not present unobserved as failure.
3. Define complete new projection input manifests including relevant schema/helper/policy versions. Do not retroactively call an old valid attempt false simply because a model/tool version later changed.

**Reason:** The existing summaries are useful. Unchecked freshness and overinterpreted percentages, not the Markdown format, are the weaknesses.

**Acceptance, NOT_RUN:** Deleting an export loses no canonical attempt; rebuilding reflects current effective revisions. Zero recorded attempts displays unassessed; stale view is not reported as lost history.

**Consumed by:** WF09, WF10, WF11. **Reported evidence:** P05 Q060/Q077/Q088/Q098; lines 277, 301, 312, 343-349; P06 B4/B5.

### M10 — Cross-course reference memory

**Current:** Reviewed shared mappings link limited course skills and reference original attempts. Broader staged work is not established as active.

**Decision:** KEEP_OWNER_EXTEND_ONLY_BY_REVIEW. **Owner:** Existing main shared-learning owner.

**Existing or proposed locations:** `shared-learning/concepts.yaml`; `shared_learning.py`; `existing shared generated views`.

**Build/modify:**
1. Read approved equivalence/related distinctions and original attempt IDs; stage new connections for the shared owner.
2. Show potential transfer as a question to test under the new conditions, never grant it from a connection alone.
3. Do not let an ordinary course tutor publish shared mappings or copy source attempts as new performances.

**Reason:** Cross-course browsing is valuable, but equivalence of labels/content is not evidence of the learner performing the new skill.

**Acceptance, NOT_RUN:** The same original attempt referenced by two courses is counted once in the shared view. Staged or related mappings cannot award equivalent performance.

**Consumed by:** WF03, WF09, WF10. **Reported evidence:** P05 Q048; lines 260, 353-362; P06 B5.

### M11 — Review selection, scheduling and review-event memory

**Current:** review_suggestion and study choices exist; no working adaptive scheduler, due queue or active two-way Anki integration was found.

**Decision:** BUILD_OPERATIONAL_REVIEW_CONTRACT_REUSE_QUESTION_IDS. **Owner:** One approved scheduling owner; canonical learning evidence remains in attempts.

**Existing or proposed locations:** `existing review_suggestion`; `proposed selected item/configuration and immutable review events under existing operational run role`; `exports/learning/review-queue.json and due.md (proposed derived schedule)`.

**Build/modify:**
1. Adopt an established scheduling implementation only after checking its required inputs and actual task fit; no fixed tool/version is selected by this source review.
2. Persist user selection/suspension, item/question revision, scheduler configuration/version, actual review time, attempt reference and supported rating basis.
3. Append one event per actual review; uncertain judgments require abstention/manual policy, not automatic failure. A changed item or corrected grading recomputes versioned due state without inserting a new learner review.
4. Scheduling metadata is authoritative for scheduling only. Do not create Calendar/Tasks events or reminders without separate permission.

**Reason:** The application genuinely lacks a scheduling process; implementing it does not require replacing the established learning history.

**Acceptance, NOT_RUN:** A question created but not selected never becomes automatically due. Identical review retry updates the schedule once, and no learner reply creates no review. A scheduler change preserves observed review history and identifies the policy used.

**Consumed by:** WF07, WF08, WF09, WF10, WF11. **Reported evidence:** P05 Q054/Q073-Q078; lines 266, 297-302; P06 A5/B5.

### M12 — Session resume, drafts and device continuity

**Current:** Session/thread IDs and roadmaps preserve some context. No unified cross-device last-slide/playback/draft/selected-question state was found.

**Decision:** BUILD_SMALL_OPERATIONAL_RESUME_STATE. **Owner:** User/device session events reconciled by the PC coordinator.

**Existing or proposed locations:** `existing native thread/session references and work roadmaps`; `proposed operational session checkpoints and per-device input revisions`; `exports/learning-app/ resume projection`.

**Build/modify:**
1. Keep app session, native thread, learner turn, request and dispatch attempt identities separate.
2. Persist slide/source revision, playback position, selected pane/question and saved draft under device revision/parent lineage. Clock time alone does not select the winner.
3. An edited submitted answer is new explicitly linked input; ordinary draft autosave is not assessment evidence. Capture and show wait/cancel/blocked states.

**Reason:** Cross-device continuity is new UX state, not new competence memory. It should survive restarts without grading activity the learner did not submit.

**Acceptance, NOT_RUN:** Two devices editing the same draft surface a conflict or preserved branches rather than silent last-write-wins. A stale slide position cannot resume on a different slide after deck revision.

**Consumed by:** WF00, WF04, WF06, WF08, WF09, WF10, WF11. **Reported evidence:** P05 Q016/Q022/Q076; lines 218, 229, 300; P06 B2/B5.

### M13 — Retrieved working context and compact summaries

**Current:** Instructions and maintained helpers support selective retrieval, but no universally enforced startup/context-budget service or full native-thread handoff was established.

**Decision:** REUSE_READERS_BUILD_CONTEXT_SELECTOR_AND_RECEIPT. **Owner:** Original source/catalog/attempt owners; context is derived ephemeral work evidence.

**Existing or proposed locations:** `existing source/catalog/shared lookup interfaces`; `.agent/course-learning/runs/<run-id>/receipts/ (proposed actual-context receipt)`; `operational compact summaries referencing original turns`.

**Build/modify:**
1. Retrieve trusted mode/course policy, exact presented material/rubric, relevant typed graph neighborhood and original effective attempts with counterevidence.
2. Frame the current attempt against the rubric before using prior judgments to hypothesize a cause. Do not let repeated negative summaries predetermine a grade.
3. Record what content and tool outputs were actually supplied, not only intended filenames; missing or uncertain native context remains explicit.
4. Pin inputs and generation policy for optional prose summaries, but do not claim that LLM wording is deterministically reproducible. Structured gap/tree fields should rebuild deterministically.
5. When a tree is absent, fall back to available original source; block only the claim that requires missing evidence.

**Reason:** Durable records are not useful unless the worker receives the right small subset. Summaries must not amplify stale or mistaken assessments.

**Acceptance, NOT_RUN:** A retracted assessment cannot survive as an unqualified weakness in a newer working summary. Hidden answer keys and unrelated private history are excluded from question-only requests. A referenced file is not recorded as loaded unless actual access is established.

**Consumed by:** WF03, WF04, WF05, WF06, WF10. **Reported evidence:** P05 Q016/Q052/Q069-Q070/Q088; lines 218, 264, 286-287, 312; P06 B2.

### M14 — Operational queue, native runs, receipts and recovery memory

**Current:** Scheduled native jobs and publication receipts exist. Resident learning-app admission, exact dispatch correlation and independent terminal return remain unproven; the default control connection failed in P06.

**Decision:** BUILD_THIN_SUPERVISOR_REUSE_EXISTING_JOBS_AND_WRITERS. **Owner:** PC supervisor for execution journal; course writers retain canonical authority.

**Existing or proposed locations:** `existing automation/ receipts and source updater jobs`; `local nonsynced PC job journal (proposed)`; `Drive immutable request/result bundles and exported task.md dashboards (proposed)`.

**Build/modify:**
1. Observe committed manifests, validate the authorized namespace and payload hashes, deduplicate, claim bounded ready work, then dispatch only through a verified native route.
2. Separate request/learner turn/dispatch attempt/native run/publication IDs; version-scoped leases only control accepted app publication, not arbitrary native side effects.
3. Persist before/after receipts and recognize uncertain completion. Continue other ready tasks while a blocked item awaits source, user, quota or approval.
4. Per-thread turns and canonical writes are serialized. Reuse the existing source updater instead of installing another polling LLM or source publisher.

**Reason:** The always-on PC provides the execution location, not a working trigger/return or universal lock by itself.

**Acceptance, NOT_RUN:** Duplicate event never duplicates a learner attempt; same ID with different bytes conflicts. Unknown prior execution is reconciled before retry; idle state issues zero reasoning calls. A native tool seeing a response is not enough unless the resident process can obtain its terminal result.

**Consumed by:** WF00, WF01, WF04, WF05, WF08, WF10, WF11. **Reported evidence:** P05 Q019-Q024/Q061-Q066; lines 226-231, 278-283; P06 A1-A3/B1-B3/B6.

### M15 — Retention, historical evidence and backup/recovery lifecycle

**Current:** Immutable records and tracking recovery artifacts exist; no general full-turn retention/deletion or cross-device restore guarantee was established. Some historical bytes may no longer exist.

**Decision:** KEEP_EXISTING_RECOVERY_ADD_REFERENTIAL_RETENTION. **Owner:** Existing course/record owners and an approved backup/retention operator.

**Existing or proposed locations:** `existing attempt and publication recovery artifacts`; `.agent/course-learning/runs/ durable referenced sidecars`; `authorized backup location and inventory (not selected here)`.

**Build/modify:**
1. Referenced full-turn snapshots must not be deleted as generic run scratch. Distinguish durable evidence, pending proposals and disposable render caches.
2. Record retention choices for voice, images, messages, native/provider history and backup copies separately. A local delete is not provider-wide erasure.
3. Use dependency-aware export/deletion and explicit unavailable/redacted states without silently rewriting historical answers.
4. Exercise backups/restoration on a controlled copy and preserve newer records during recovery. No broad production cleanup is authorized.

**Reason:** An immutable attempt is not reproducible when its only full response/figure was cleaned from an operational directory. Retention is a real data contract.

**Acceptance, NOT_RUN:** Cleanup cannot remove a referenced snapshot while reporting the attempt fully verifiable. Restoration never overwrites newer valid state; local and provider deletion outcomes remain distinct.

**Consumed by:** WF09, WF11. **Reported evidence:** P05 Q034/Q095/Q099; lines 241, 324, 328; P06 B3/B4.

## Current-state workflow inventory

| ID | Workflow | Current situation | Recommended change |
|---|---|---|---|
| WF00 | Observe, admit and dispatch | Existing scheduled jobs are real, but immediate submitted-task admission, independent native-thread roundtrip and app correlation are not operationally established. | BUILD_SUPERVISOR_ADAPTER_NOT_ANOTHER_TUTOR |
| WF01 | Consume existing source discovery and publication | The installed source refresh and protected publication have historical receipts; current processing is bounded (reported at most three sources per course/run). | KEEP_EXISTING_UPDATER_EXTEND_RECEIPTS_AND_BACKLOG |
| WF02 | Prepare renditions and align evidence | Reviewed slide-to-transcript-line maps and selected render assets exist; complete timing, typed anchors and browser media delivery do not. | BUILD_MISSING_PREPARATION_AND_TYPED_LINK_HANDOFF |
| WF03 | Extend owned catalogs and project concept trees | Agents curate skills/families and the richer BE 505 question structure; no automatic all-lecture semantic extractor/tree publisher is established. | WRAP_EXISTING_CATALOG_OWNERS_ADD_BOUNDED_PROPOSALS_AND_VIEWS |
| WF04 | Answer a source-grounded question | There are real native explanations and reusable lookup helpers; their externally triggered app path, complete record capture and process-readable return remain missing. | KEEP_TUTOR_RETRIEVAL_BUILD_CORRELATED_FRONTEND_WRAPPER |
| WF05 | Assess a submitted explanation or answer | Actual attempts preserve outcome/assistance; BE 505 has a helper and other courses coordinated procedures. No general sidecar-integrity verifier or uniform safe save service exists. | KEEP_ASSESSMENT_SCHEMA_BUILD_CAPTURE_VALIDATE_SAVE_ADAPTER |
| WF06 | Diagnose and remediate a specific difficulty | Optional follow-up, help labeling and tutor-error acknowledgment exist in behavior/notes; no formal bounded multi-hypothesis workflow or waiting lifecycle is installed. | STRUCTURE_EXISTING_BEHAVIOR_WITH_OPERATIONAL_PROPOSALS |
| WF07 | Prepare questions and richer review cards | Question/family authoring and a substantial BE 505 bank exist; a uniform versioned selectable rich-card workflow does not. | REUSE_BANKS_EXTEND_REVIEW_PRESENTATION_AND_SELECTION |
| WF08 | Schedule and conduct deliberate review | Suggestions and reminders are not a functioning spaced-review system; no active adaptive review event engine or two-way card synchronization was found. | BUILD_ONE_OPERATIONAL_SCHEDULER_WITH_ESTABLISHED_ALGORITHM |
| WF09 | Apply reviewed corrections and invalidate dependents | assessment_revision and controlled tracking recovery are implemented contracts; P05 had no actual production assessment revisions and no universal dependency invalidation graph. | KEEP_REVISION_RULES_ADD_REVIEW_ROUTING_AND_DEPENDENCY_MANIFESTS |
| WF10 | Project memory, gaps and cross-device study state | Learning/shared renderers and some study exports exist, with reported stale views. No universal concept-tree/gap/review/resume view producer exists. | REUSE_RENDERERS_ADD_DERIVED_VIEWS_AND_EXACT_INPUT_MANIFESTS |
| WF11 | Supervise health, recovery and controlled maintenance | Some guarded publisher recovery and historical fixtures exist; no current companion or verified lock-screen/reboot/native-update/Drive-reconnect lifecycle was established. | KEEP_PUBLISHER_RECOVERY_BUILD_SUPERVISOR_RECONCILIATION |

### WF00 — Observe, admit and dispatch

**Current / decision:** MISSING_RESIDENT_LEARNING_DISPATCH; CANDIDATE_INTERFACE_UNVERIFIED → BUILD_SUPERVISOR_ADAPTER_NOT_ANOTHER_TUTOR.

**Required writes and consumer:** Local journal/claims first; then correlated acknowledgment, staged result and Drive-visible receipts. Never route by the globally last chat.

**Reason:** Monitoring and queue control are ordinary software; native reasoning must be called only through a tested target/return boundary.

**Completion/proof:** A synthetic independent-process roundtrip must verify target, permissions and terminal return; duplicates, cancelled generations and zero idle model calls are separate cases.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF01 — Consume existing source discovery and publication

**Current / decision:** EXISTS_SCHEDULED_UPDATER; DOWNSTREAM_HANDOFF_PARTIAL → KEEP_EXISTING_UPDATER_EXTEND_RECEIPTS_AND_BACKLOG.

**Required writes and consumer:** Existing source publication only via its owner; a small receipt extension identifies changed source versions, actual checks, processed frontier and remaining work for downstream preparation.

**Reason:** A second source scheduler/publisher creates conflicting identity/review decisions. A bounded batch is fine; forgetting the remaining backlog is not.

**Completion/proof:** Several batches account for every inventoried source without a new competing updater; repeated receipt is a no-op; empty/unrecorded items never become aligned.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF02 — Prepare renditions and align evidence

**Current / decision:** PARTIAL_SOURCE_MAPS_AND_RENDERS; TIMED_PIPELINE_MISSING → BUILD_MISSING_PREPARATION_AND_TYPED_LINK_HANDOFF.

**Required writes and consumer:** Versioned cache/renditions; candidate anchors; reviewed owner-compatible alignment record; derived source-linked export with coverage and uncertainty.

**Reason:** Reuse existing reviewed work but do not call transcript line numbers recording seconds. Preserve new manual timing assertions durably.

**Completion/proof:** Repeated/off-slide/partial-transcript cases and manual correction replay are checked against real media; confirmed quality is separate from syntax-valid export.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF03 — Extend owned catalogs and project concept trees

**Current / decision:** EXISTS_AS_TUTOR_CATALOG_WORK; CONTINUOUS_PIPELINE_AND_TREES_MISSING → WRAP_EXISTING_CATALOG_OWNERS_ADD_BOUNDED_PROPOSALS_AND_VIEWS.

**Required writes and consumer:** Scoped catalog deltas through owner; source-backed proposal/evidence receipts; concept-tree export with typed nodes and original relation semantics.

**Reason:** New material should extend the owned catalog, not spawn a duplicate graph authority or prerequisite forest.

**Completion/proof:** Stable IDs reused, incompatible relation directions rejected, duplicate visual branches yield one logical node, and no student assessment is created.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF04 — Answer a source-grounded question

**Current / decision:** EXISTS_NATIVE_TUTORING; APP_TRIGGER_FULL_CAPTURE_NOT_IMPLEMENTED → KEEP_TUTOR_RETRIEVAL_BUILD_CORRELATED_FRONTEND_WRAPPER.

**Required writes and consumer:** Full committed question sidecar, actual-context receipt, separate delivered answer, verified result manifest and later resume projection.

**Reason:** The teaching behavior exists. The app needs exact context, request identity and visible history without treating help as failure.

**Completion/proof:** Correct source/figure/question version reaches the correct thread and user; no attempt is fabricated merely because an explanation was requested.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF05 — Assess a submitted explanation or answer

**Current / decision:** EXISTS_REAL_ASSESSMENTS; FULL_CAPTURE_AND_COMMON_WRITER_FACADE_MISSING → KEEP_ASSESSMENT_SCHEMA_BUILD_CAPTURE_VALIDATE_SAVE_ADAPTER.

**Required writes and consumer:** Frozen learner turn before inference; pinned rubric/conditions receipt; validated existing-format attempt or explicit pending state; separate tutor reply; writer/readback receipt; view-update request.

**Reason:** The correct improvement is a reliable interface to existing history, not a replacement gradebook or every-answer-is-new-performance rule.

**Completion/proof:** Unknown timing stays unknown; unsupported family/skill set blocks the candidate but not original capture; retries/regrading do not duplicate the response; saved evidence survives renderer failure.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF06 — Diagnose and remediate a specific difficulty

**Current / decision:** EXISTS_PROMPTED_DIAGNOSIS; PERSISTENT_WAITING_WORKFLOW_MISSING → STRUCTURE_EXISTING_BEHAVIOR_WITH_OPERATIONAL_PROPOSALS.

**Required writes and consumer:** Candidate cause/question/proposal; immutable delivered diagnostic prompt and actual subsequent answer; WF05 assessment; derived gap view after valid canonical changes.

**Reason:** Mistakes have alternative explanations. Persistent proposals help continuity without falsely creating canonical root-cause diagnoses.

**Completion/proof:** Two or three bounded diagnostic steps are a proposed default, not a forced minimum; WAITING_USER releases the worker; no new evidence is imagined to finish the queue.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF07 — Prepare questions and richer review cards

**Current / decision:** EXISTS_QUESTION_AUTHORING; RICH_CARD_SELECTION_LIFECYCLE_PARTIAL → REUSE_BANKS_EXTEND_REVIEW_PRESENTATION_AND_SELECTION.

**Required writes and consumer:** Catalog-owned question/family revision only when needed; separate selected review-item/configuration and source-linked derived view; no learner attempt.

**Reason:** The goal is useful coverage, not many generated cards. A new prompt may reuse a family without duplicating its definition.

**Completion/proof:** Source-supported solvability, valid alternatives, disclosure boundaries and intentional selection are checked; item edits do not rewrite old reviewed content.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF08 — Schedule and conduct deliberate review

**Current / decision:** NOT_FOUND_EXECUTING_REVIEW_SCHEDULER → BUILD_ONE_OPERATIONAL_SCHEDULER_WITH_ESTABLISHED_ALGORITHM.

**Required writes and consumer:** Versioned item selection/configuration; one review event per submitted response tied to WF05 attempt; deterministic due queue; explicit suspended/uncertain state.

**Reason:** Scheduling is a genuinely missing conventional service. Misconception diagnosis remains WF06 and competence remains canonical attempts.

**Completion/proof:** The same review is applied once; no answer gives WAITING_USER; assisted/uncertain results are not silently independent success or failure; regrade changes projections, not historical event count.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF09 — Apply reviewed corrections and invalidate dependents

**Current / decision:** CORRECTION_CONTRACT_EXISTS; GENERAL_CHANGE_ORCHESTRATION_MISSING → KEEP_REVISION_RULES_ADD_REVIEW_ROUTING_AND_DEPENDENCY_MANIFESTS.

**Required writes and consumer:** Existing-format assessment revision or source/catalog annotation through owner; expected-predecessor checks; supersession receipts; scoped regeneration tasks.

**Reason:** Different errors require different owners. A changed graph label or tool version must not silently rewrite learner history.

**Completion/proof:** Same intended skills, original prompt/response/time, single nonbranching correction chain; competing branches stop; view-only edit does not regrade an attempt.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF10 — Project memory, gaps and cross-device study state

**Current / decision:** EXISTS_LEARNING_RENDERERS; NEW_PROJECTIONS_AND_RESUME_MISSING → REUSE_RENDERERS_ADD_DERIVED_VIEWS_AND_EXACT_INPUT_MANIFESTS.

**Required writes and consumer:** Existing views through owners; proposed tree/gap/review exports; actual-source-linked session summary; complete export manifest and app task dashboards.

**Reason:** Rebuilding trusted views is safer than asking an LLM to overwrite one cumulative memory file. Current facts must come from original effective evidence.

**Completion/proof:** Deterministic structured facts rebuild from owned inputs. Model-written prose summaries are identified as replaceable generated wording, not guaranteed byte-identical regeneration or new observations.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

### WF11 — Supervise health, recovery and controlled maintenance

**Current / decision:** PARTIAL_EXISTING_RECOVERY; RESIDENT_LIFECYCLE_UNVERIFIED → KEEP_PUBLISHER_RECOVERY_BUILD_SUPERVISOR_RECONCILIATION.

**Required writes and consumer:** Minimal local health/incident/backup receipts and Drive-visible status; verified repair/recovery results; no unapproved model/tool/permission change.

**Reason:** Always-on hardware does not make authentication, synchronization or native execution outcomes infallible. Recovery must preserve exact prior effects.

**Completion/proof:** Reconcile uncertain native and canonical receipts before retry; preserve referenced sidecars in backup/cleanup; old lock is not deleted blindly; no autonomous expensive self-repair loop.

The complete triggers, ordered steps, staged/published files, blockers and prohibited actions are in [the workflow catalog](workflow-catalog.md).

## Preserved constraints

All lectures remain in the product scope, with honest coverage and bounded processing. The PC remains the execution host. No model API-billing fallback, native-platform substitution, task-file self-authorization, duplicate source scheduler, hidden global graph or compulsory user quiz is added.

The latest report still leaves independent PC-process/native-thread terminal retrieval unresolved. Its failed default control connection does not prove a cause or authorize restarting/reconfiguring a daemon. This review does not repeat product-interface claims or attempt that connection.

The native bridge remains a release gate for unattended integration, not a reason to defer pure fixtures for snapshots, mapping views, queue state transitions or the UI. Implementation authorization is separate from accepting a logical design.

## What not to build

Do not create an authoritative memory.md, second concept/gap database, separate canonical attempt format, replacement course hierarchy, auto-merge of cross-course skills, copied history for each card, graph-based automatic credit, or an always-reasoning polling fleet.

A report filename or declared hash is not validation. A source version is not preserved merely because its digest is known. A successful native answer is not a canonical save. A saved attempt with a failed renderer is not an unsaved attempt.

## Implementation sequence

See [the bounded implementation plan](memory-workflow-implementation.md) for fixture-first work packages, explicit consumers and acceptance. No proposal path below .agent/ or exports/ is created in the live system by this documentation package.
