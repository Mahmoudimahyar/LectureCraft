# Workflows — current-system fit and proposed implementation 0.7.0

P05 and partial P06 describe the existing academic setup. These 12 end-to-end app contracts remain proposed and NOT_RUN. Status labels below separate implemented helpers/prompted behavior from the missing app workflow. No new schedules or live writers are activated.

The memory IDs refer to [the fit register](memory-workflow-fit.md). Existing source discovery is retained; no duplicate updater is added.

## WF00 — Observe, admit and dispatch

**Current:** MISSING_RESIDENT_LEARNING_DISPATCH; CANDIDATE_INTERFACE_UNVERIFIED. Existing scheduled jobs are real, but immediate submitted-task admission, independent native-thread roundtrip and app correlation are not operationally established.

**Decision:** BUILD_SUPERVISOR_ADAPTER_NOT_ANOTHER_TUTOR. Monitoring and queue control are ordinary software; native reasoning must be called only through a tested target/return boundary.

**Owner / execution:** supervisor / deterministic. **Priority:** control. **Memory:** M03, M06, M12, M14.

### Triggers

- Committed request manifest

- Allowed source-change hint

- Startup/reconnect reconciliation

- Due retry or review timer

### Read dependencies

- Registered roots and course identities

- Trusted workflow/provider/writer policies

- Inbox manifests and matching bytes

- Local runtime ledger and existing publication receipts

- Pinned native surface/version and effective target permissions; never assume danger-full-access config is a safe thread

- Actual existing updater completion/publication receipts, not only a scheduler success message

### Each processing round

1. Validate requester, course, workflow, parent turn, permissions, bounds and committed hashes; reject path/command injection.

2. Assign or reuse a stable request/job identity. Preserve client occurrence time separately from host receipt time.

3. Create the local journal entry transactionally, then export a receipt; duplicates reuse the original receipt. Same ID with different content conflicts.

4. Claim a ready job using one local lease, expected input revisions, a fencing generation and the course/thread concurrency key.

5. Dispatch only through the version-scoped, approved native route after its resident-process return path is proven. Installed queue help is a candidate; Windows 10050 is a failed default control connection, not a proven queue/root-cause diagnosis. Stage results and use the proper writer.

6. Schedule the next eligible item. When nothing is runnable, release model workers and wait for external events/timers.

### Staged writes

- Local runtime database/journal, leases and provider run IDs

### Published writes

- Inbox acknowledgement or rejection receipt

- exports/learning-app/jobs/<job-id>/state.json

- exports/learning-app/workflows/<workflow-id>/task.md (derived backlog view)

### Success criteria

- Each eligible committed request has one admitted identity or an explicit rejection; accepted outputs have traceable receipts.

- Idle queues cause no reasoning-model polling calls; blocked jobs do not prevent unrelated ready jobs.

### Waiting or blocked conditions

- Incomplete sync

- Unauthenticated/unauthorized request

- Unknown native entry point or missing capabilities

- Active thread/record conflict

- Quota/authentication/STOP

- Safe effective native permissions or process-readable terminal result unavailable

- Runtime version changes while a turn outcome is unknown

### Prohibited behavior

- Modify original materials, grades, learner judgments or provider credentials

- Let task text select arbitrary tools, shell commands, roots, models or spending

- Treat approved:true in Drive, native login category or queue exit as authority/completion

- Start an alternative server, use a different worker or broaden sandbox permissions silently

**Reported evidence:** P05 Q019-Q024; P06 A1-A3/B1-B3/B6.

## WF01 — Consume existing source discovery and publication

**Current:** EXISTS_SCHEDULED_UPDATER; DOWNSTREAM_HANDOFF_PARTIAL. The installed source refresh and protected publication have historical receipts; current processing is bounded (reported at most three sources per course/run).

**Decision:** KEEP_EXISTING_UPDATER_EXTEND_RECEIPTS_AND_BACKLOG. A second source scheduler/publisher creates conflicting identity/review decisions. A bounded batch is fine; forgetting the remaining backlog is not.

**Owner / execution:** existing-course-updater + supervisor adapter / deterministic_with_source_review. **Priority:** background. **Memory:** M01, M14.

### Triggers

- New/changed/deleted allowed source

- Initial all-lecture backlog

- Explicit rescan of a known source

### Read dependencies

- Complete existing metadata inventory

- Canonical source index and publication contracts

- Current source bytes when readable

- Existing source-refresh observations

### Each processing round

1. Read current existing updater source-audit/final-verification receipts and source publications; retain all-lecture coverage, including presently unindexed originals.

2. Classify newly observed, changed, missing, empty, moved, unrecorded and still-hydrating material. A folder/date or unchanged stat does not establish source association/currentness.

3. Reuse or request a bounded scan through the current updater owner under approved policy. Do not add a competing scheduled scanner that independently interprets/publishes the same sources.

4. Prepare any registration candidate for the existing source/tracking publisher. A future small changed-source receipt extension belongs to that updater; it is not installed by this design.

5. Admit downstream WF02/WF03 once the relevant publication and actually checked source evidence agree. Distinguish no-op, staged, partial and changed publication; deduplicate by source/version/receipt.

6. Keep current per-run safety caps. To drain a larger initial backlog, obtain an approved continuation/receipt extension in the existing updater; the downstream supervisor does not bypass its publication or schedule policy.

### Staged writes

- Source inventory/registration candidate and exact consumed-source references

### Published writes

- Existing source index/publication bundle only through the current updater/publisher

- exports/learning-app/material-coverage.json (derived proposal)

- Operational receipt of consumed updater revision and unresolved availability

### Success criteria

- Every source in the bounded batch is accounted for and identities are preserved; registration receipt or explicit block recorded.

- All-lecture denominator remains visible across batches. Missing original media are not called processed or synthesized as original.

### Waiting or blocked conditions

- Source still changing

- Empty or inaccessible source

- Unexplained source identity conflict

- Required owner unavailable

### Prohibited behavior

- Change grades, deadlines or personal progress as a side effect

- Make a duplicate scheduled source-refresh publisher

- Treat generated study assets as instructor originals

- Infer physical-source freshness from the known ineffective verify-published --check-source-files branch

- Treat every receipt poll as a reason for a new model turn

**Reported evidence:** P05 Q019/Q025-Q036; P06 A7.

## WF02 — Prepare renditions and align evidence

**Current:** PARTIAL_SOURCE_MAPS_AND_RENDERS; TIMED_PIPELINE_MISSING. Reviewed slide-to-transcript-line maps and selected render assets exist; complete timing, typed anchors and browser media delivery do not.

**Decision:** BUILD_MISSING_PREPARATION_AND_TYPED_LINK_HANDOFF. Reuse existing reviewed work but do not call transcript line numbers recording seconds. Preserve new manual timing assertions durably.

**Owner / execution:** course-preparation / mixed. **Priority:** background. **Memory:** M01, M02, M03.

### Triggers

- Registered source version needs a rendition or alignment

- Approved alignment repair

### Read dependencies

- Exact deck, media and raw transcript revisions

- Existing BE505 slide-to-transcript-line maps

- Approved processing/data permissions

- Previous confirmed alignment corrections

### Each processing round

1. Preserve originals. Produce version-keyed text/page/rendition assets only with required conventional tools; use OCR only where native text/visual reading cannot suffice.

2. Determine whether the transcript is verbatim, edited or partial and whether video actually displays slides. Establish media identity, duration and time origin.

3. Reuse valid timestamps; otherwise perform approved local transcription/forced alignment. Original and corrected transcript versions remain distinct.

4. Associate spans with displayed slides and/or discussed concepts using available evidence. Permit repeats, overlaps, multiple intervals, clips and no reliable match.

5. Validate IDs, intervals, page bounds, edition/page mappings and immutable source revisions; preserve manual corrections and record review state.

6. Preserve reviewed source-map corrections through their owner, record exact evidence and publish a versioned derived alignment view. A missing current structured link store needs an explicit owner-compatible schema extension, not a silent parallel learning graph. Invalidate only dependencies affected.

7. Distinguish a cache from a newly reviewed source annotation. Before the first new precise interval is accepted, bind its durable versioned record to the existing source-link owner; exports remain projections, not the sole copy of a manual correction.

### Staged writes

- Extracted page/text/media metadata

- Timestamp candidates and aligned spans

- Validation and review-needed list

### Published writes

- .cache/learning-app/<source-version>/... (rebuildable local intermediates)

- exports/learning-app/renditions/<source-version>/... (permitted cross-device assets)

- Per-slide alignment coverage projection

- .agent/course-learning/runs/<run>/proposals/alignment.json and reviewed link evidence receipts (new child proposal)

- exports/learning/alignment.json (derived, source-version-specific proposal; underlying reviewed maps/source refs stay authoritative)

### Success criteria

- Artifacts match their input/tool revisions; every slide and relevant interval has a mapping/review/availability disposition.

- Machine-proposed links are labeled as such. Confirmed matching quality requires independent reviewed examples; artifact publication alone is not alignment proof.

### Waiting or blocked conditions

- Recording never captured or unavailable

- No allowed transcription route

- Unstable source versions

- Unsupported format

- Ambiguous correspondence requiring review

- Untested discovered transcription package or unapproved processing/data scope

### Prohibited behavior

- Invent a time interval or textbook page

- Overwrite raw transcripts or original decks

- Treat omitted material as a fully verified match

**Reported evidence:** P05 Q037-Q042; P06 A5/B5.

## WF03 — Extend owned catalogs and project concept trees

**Current:** EXISTS_AS_TUTOR_CATALOG_WORK; CONTINUOUS_PIPELINE_AND_TREES_MISSING. Agents curate skills/families and the richer BE 505 question structure; no automatic all-lecture semantic extractor/tree publisher is established.

**Decision:** WRAP_EXISTING_CATALOG_OWNERS_ADD_BOUNDED_PROPOSALS_AND_VIEWS. New material should extend the owned catalog, not spawn a duplicate graph authority or prerequisite forest.

**Owner / execution:** course-preparation / mixed. **Priority:** background. **Memory:** M01, M02, M03, M04, M05, M10, M13.

### Triggers

- New usable content or approved graph/source-link correction

- A tutoring task encounters a genuinely unmapped concept

### Read dependencies

- Existing learning/skills.yaml and learning/question-families.yaml

- BE 505 learning/question-index.json where installed; reviewed shared mappings

- Source/version anchors and existing reviewed source maps

- Previous accepted catalog revisions and projection manifests

### Each processing round

1. Resolve existing concept, skill, criterion, question and family IDs before proposing anything new. Identical labels across courses do not establish equivalence.

2. Extract source-supported additions or changes as proposals for the owning catalog. Missing concepts in another course are a coverage gap; do not mislabel a topic as a skill or install a second canonical catalog.

3. Validate only the owning contract's relationship types, direction and graph constraints. Do not reinterpret question strict_containment as an arbitrary concept taxonomy.

4. Build hierarchical/tree projections referencing the same IDs in multiple branches; guard traversal against cycles and mark nonhierarchical/uncertain relationships. No automatic prerequisite failure or learning credit.

5. Publish permitted catalog changes via its coordinated owner, under genuine approved scope. Preserve old rubric/family revisions and review merges, retirement and shared equivalence separately.

6. Render concept-tree views with exact input/tool/schema revisions and freshness. Rebuild views, not definitions, for layout changes. Stop at the requested coverage boundary.

### Staged writes

- Concept/edge/alias delta

- Evidence list and catalog-change proposals

### Published writes

- Existing canonical skills/families/question catalogs only through their approved owner

- exports/learning/concept-tree.json and optional lecture/slide Markdown views (derived child proposals)

### Success criteria

- No duplicate logical identities, forbidden cycles or broken references; nodes/edges retain provenance and structural review status.

- Each available source slice in scope is covered or explicitly unresolved. Published graph structure does not prove semantic correctness or learner competence.

### Waiting or blocked conditions

- Conflicting concept meanings

- Unsafe proposed merge

- Missing source/rubric evidence

- Catalog writer or review required

### Prohibited behavior

- Create a second authoritative definition for an existing concept

- Automatically merge cross-course skills

- Expand indefinitely into every prerequisite of every prerequisite

- Create learning/concepts/revisions as another authoritative definition store

- Invent missing hierarchy or publish a generated tree as verified subject truth

**Reported evidence:** P05 Q043-Q048; P06 B5.

## WF04 — Answer a source-grounded question

**Current:** EXISTS_NATIVE_TUTORING; APP_TRIGGER_FULL_CAPTURE_NOT_IMPLEMENTED. There are real native explanations and reusable lookup helpers; their externally triggered app path, complete record capture and process-readable return remain missing.

**Decision:** KEEP_TUTOR_RETRIEVAL_BUILD_CORRELATED_FRONTEND_WRAPPER. The teaching behavior exists. The app needs exact context, request identity and visible history without treating help as failure.

**Owner / execution:** tutor / mixed. **Priority:** interactive. **Memory:** M01, M02, M03, M04, M05, M06, M12, M13, M14.

### Triggers

- User submits Ask

- Explicit follow-up asking for explanation or a connection

### Read dependencies

- Full submitted question and referenced visual/source snapshot

- Course mode and assistance policy

- Relevant concept neighborhood and source spans

- Compact prior thread state with original references

### Each processing round

1. WF00 captures the full committed user-visible question and permitted attachments before inference in an immutable operational turn snapshot.

2. Resolve the intended course/source versions and valid owned-catalog projection; use verified source context directly if the concept view is incomplete. Record what instructions/evidence actually entered the native turn.

3. Retrieve minimal permissible context. Conflicts and missing evidence are stated, not silently filled from another course or inaccessible chat.

4. Generate a concise source-grounded answer using the selected native worker and approved capabilities.

5. Validate output references, content bounds, course/turn identity and render safety; publish the visible answer and delivery manifest.

6. Update thread continuity/resume projection. A request for help does not automatically become an assessment or weakness.

### Staged writes

- Answer draft, source-reference list, context manifest

### Published writes

- .agent/course-learning/runs/<run>/messages/<message-id>.json (full delivered tutor reply, separate from the frozen learner input)

- exports/learning-app/results/<request>/<generation>/... (derived/transport reply bundle)

- Operational session summary referencing original messages, generated by WF10

### Success criteria

- Correct request/thread receives a complete source-linked answer or an explicit uncertainty result; full submitted/delivered text is preserved.

- No learner attempt or gap is fabricated merely from asking.

### Waiting or blocked conditions

- Ambiguous question or source identity

- Course restriction

- Missing native dispatch or modality

- Unapproved outbound context

### Prohibited behavior

- Claim unseen course history was loaded

- Leak answer keys outside the mode policy

- Award understanding because the assistant answered

**Reported evidence:** P05 Q014/Q016/Q017/Q052/Q067-Q072; P06 B1/B2/B4.

## WF05 — Assess a submitted explanation or answer

**Current:** EXISTS_REAL_ASSESSMENTS; FULL_CAPTURE_AND_COMMON_WRITER_FACADE_MISSING. Actual attempts preserve outcome/assistance; BE 505 has a helper and other courses coordinated procedures. No general sidecar-integrity verifier or uniform safe save service exists.

**Decision:** KEEP_ASSESSMENT_SCHEMA_BUILD_CAPTURE_VALIDATE_SAVE_ADAPTER. The correct improvement is a reliable interface to existing history, not a replacement gradebook or every-answer-is-new-performance rule.

**Owner / execution:** tutor / mixed. **Priority:** interactive. **Memory:** M01, M02, M03, M04, M05, M06, M07, M08, M13, M14.

### Triggers

- User explicitly submits an explanation/answer

- Learner replies to a diagnostic or review prompt

### Read dependencies

- Exact presented prompt and full learner response/attachments

- Question/family/rubric revisions and source evidence

- Relevant canonical catalog revisions and projected subtree inputs

- Actual assistance/exposure before submission

- Relevant previous assessed responses only after initial independent assessment framing

### Each processing round

1. Persist and read back the exact prompt, learner response, attachments, occurrence time/basis and reference/assistance conditions before inference. Unknown timing/recognition stays qualified.

2. Select the actual family/rubric revision, or prepare a provisional source-grounded rubric for review before judging the answer. Accept justified alternative answers; generated references are not instructor keys.

3. Assess exactly the intended skills using existing outcomes and required analysis fields. No error diagnosis on not_observed. An unasked concept, graph hole or transcription ambiguity is not a learner failure.

4. Validate the immutable sidecar bytes and content/item identity with the proposed wrapper, then stage the unchanged course-learning-v1 candidate. The existing locator string alone does not validate its target.

5. Use the correct course writer under its real guard. Do not pass --root to the installed global-root BE 505 save/refresh as a fixture strategy. A future other-course facade must be tested before claiming common save semantics.

6. Read back a canonical attempt or a verified already_saved result. Keep staged hypotheses as diagnostic proposals; only published effective observations support gap views. If the evidence saved but its view failed, report both facts without duplicating the attempt.

7. Capture the complete delivered tutor message separately from frozen input; return sourced feedback and the distinct save/view receipt. Schedule WF06/WF10 or selected review work once.

8. A captured response without an available valid intended family remains ASSESSMENT_PENDING in operational state. Register/review a supported family and reassess against pinned intent before creating a canonical record; never invent unobserved errors or a successful record to empty the queue.

### Staged writes

- Source-grounded rubric/criterion review

- Immutable full-input snapshot and wrapper verification receipt

- Compatible attempt candidate and diagnostic proposal

- Tutor feedback and canonical publication intent

### Published writes

- .agent/course-learning/runs/<run>/turns/<turn-id>.json and referenced attachments (new child proposal)

- Existing learning/attempts/YYYY-MM/<attempt-id>.json through the appropriate owner

- .agent/course-learning/runs/<run>/messages/<message-id>.json and receipts/<receipt>.json

- exports/learning/learning-gaps.json and learning-gaps.md only as WF10-derived views

### Success criteria

- One submitted learner response is retained once and every meaningful assessed criterion has an observed or explicitly uncertain/not-observed outcome.

- Attempt publication is idempotent and read back; gaps cite the exact response and assessment. Feedback is correlated and the independent/assisted conditions are not rewritten.

### Waiting or blocked conditions

- Required prompt/visual missing

- Unresolved transcription ambiguity affecting judgment

- Invalid assessment references

- Unsafe/conflicting writer

- Provider quota or permission

### Prohibited behavior

- Require agreement with one generated wording

- Store an AI-written answer as the learner response

- Count a retry or second grader as a second learner attempt

- Claim unasked prerequisite failure

- Modify a hashed learner snapshot to add a later assistant answer

- Treat existence of a locator string as checked full-response persistence

- Write a separate canonical gap-event history or report analysis as independent learner evidence

**Reported evidence:** P05 Q055-Q066/Q072; P06 B4.

## WF06 — Diagnose and remediate a specific difficulty

**Current:** EXISTS_PROMPTED_DIAGNOSIS; PERSISTENT_WAITING_WORKFLOW_MISSING. Optional follow-up, help labeling and tutor-error acknowledgment exist in behavior/notes; no formal bounded multi-hypothesis workflow or waiting lifecycle is installed.

**Decision:** STRUCTURE_EXISTING_BEHAVIOR_WITH_OPERATIONAL_PROPOSALS. Mistakes have alternative explanations. Persistent proposals help continuity without falsely creating canonical root-cause diagnoses.

**Owner / execution:** tutor / mixed. **Priority:** interactive. **Memory:** M03, M04, M05, M06, M07, M08, M12, M13.

### Triggers

- Learner accepts diagnostic follow-up

- A submitted diagnostic answer links to an open hypothesis

### Read dependencies

- Parent attempt and criterion-level observations

- Specific gap hypotheses and evidence

- Small relevant prerequisite neighborhood

- Course policy, shown hints and prior exposure

### Each processing round

1. List plausible explanations such as conceptual confusion, missing prerequisite, method slip, notation, ambiguous prompt, recognition error or grader mistake; avoid prematurely selecting one.

2. Choose one discriminating question or worked contrast grounded in sources. Default to a short detour; deeper diagnosis is opt-in.

3. Save and display the question/hint with its tested criteria and exposure event. Release the worker and mark WAITING_USER; do not invent a reply or poll an LLM for one.

4. A real learner reply creates a new WF05 job tied to the parent session and diagnostic prompt, not a rerun of the original answer.

5. Use the new evidence to support, contradict, narrow or leave hypotheses open. Offer targeted explanation plus an optional different transfer example.

6. Stop when the requested detour is complete, the learner declines, or review is needed. Root-cause uncertainty remains explicit.

7. On later correction, derive the current gap interpretation from the effective canonical assessment chain; an unresolved suspicion remains labeled separately and never becomes a second competence record.

### Staged writes

- Diagnostic hypothesis set and minimal distinguishing question

- Remediation plan constrained to requested depth

### Published writes

- Immutable operational diagnostic turns and tutor messages

- Observed assistance/exposure captured in the corresponding learner event

- Unresolved diagnostic proposals under the existing run area; any assessment change through canonical assessment_revision

- Optional review suggestions with provenance, not automatic calendar tasks

### Success criteria

- An appropriate diagnostic/remediation step is delivered and recorded, or new evidence updates the hypothesis without fabricated competence.

- Question delivery can complete a turn while the wider diagnostic activity waits for the learner.

### Waiting or blocked conditions

- No discriminating evidence

- Learner has not replied

- Course assistance restriction

- Conflicting assessment requiring review

### Prohibited behavior

- Run until the model decides the learner has mastered everything

- Mark all ancestors weak

- Erase earlier evidence after a hinted success

**Reported evidence:** P05 Q047/Q071/Q075; P06 B5.

## WF07 — Prepare questions and richer review cards

**Current:** EXISTS_QUESTION_AUTHORING; RICH_CARD_SELECTION_LIFECYCLE_PARTIAL. Question/family authoring and a substantial BE 505 bank exist; a uniform versioned selectable rich-card workflow does not.

**Decision:** REUSE_BANKS_EXTEND_REVIEW_PRESENTATION_AND_SELECTION. The goal is useful coverage, not many generated cards. A new prompt may reuse a family without duplicating its definition.

**Owner / execution:** review / mixed. **Priority:** background. **Memory:** M01, M03, M04, M05, M08, M11.

### Triggers

- User selects Generate/Add to review

- Approved bounded preparation goal finds uncovered criteria

- Specific selected gap suggests a useful review item

### Read dependencies

- Existing question/criterion/family catalog

- Source-grounded learning targets and permitted solutions

- Relevant gap evidence

- Current selected review items

### Each processing round

1. Reuse existing questions before generating near-duplicates. Select a bounded objective such as one diagram interpretation or concept contrast.

2. Prepare a versioned prompt, rubric, source references, expected alternatives and help policy; keep solution context separate from question-only delivery.

3. Check solvability, correct references, duplicate family/criterion coverage and difficulty claims; leave unsupported items as suggestions.

4. Offer selection/edit/suspend controls. Only items selected by the learner or an explicit reviewed auto-selection policy enter the active schedule.

5. Publish through catalog/review owners. Stop after the requested item/coverage budget, not an infinite complete-concept question expansion.

### Staged writes

- Question/card/family proposals and semantic-quality review

### Published writes

- Existing question/family/rubric catalogs through their owner

- Review-selection/card specifications under an approved operational run child (proposal, not a competence catalog)

- exports/learning/review-items.json (derived selectable view)

### Success criteria

- Each requested item is source-linked, answerable/reviewed to the recorded level, versioned and nonduplicate, or explicitly rejected/pending.

- No creation event is treated as a learner attempt.

### Waiting or blocked conditions

- No source-grounded answer/rubric

- Restricted solution use

- Duplicate or contradictory question

- Selection/review not yet granted

### Prohibited behavior

- Create a card for every noun

- Automatically publish uncertain generated answers as authoritative

- Rewrite previous card versions used by attempts

**Reported evidence:** P05 Q049-Q054; P06 B5.

## WF08 — Schedule and conduct deliberate review

**Current:** NOT_FOUND_EXECUTING_REVIEW_SCHEDULER. Suggestions and reminders are not a functioning spaced-review system; no active adaptive review event engine or two-way card synchronization was found.

**Decision:** BUILD_ONE_OPERATIONAL_SCHEDULER_WITH_ESTABLISHED_ALGORITHM. Scheduling is a genuinely missing conventional service. Misconception diagnosis remains WF06 and competence remains canonical attempts.

**Owner / execution:** review / deterministic_with_tutor_delivery. **Priority:** interactive_or_timer. **Memory:** M03, M05, M06, M07, M08, M11, M12, M14.

### Triggers

- User opens Review

- A selected review item becomes due

- New eligible assessed review response arrives

### Read dependencies

- Selected card revisions

- Review-event history and scheduler version

- Assistance-aware results and gap summaries

- Learner session preferences

### Each processing round

1. Use a maintained scheduling implementation after evaluation; the algorithm chooses timing, not the scientific reason for an error.

2. Build a bounded due queue and show the source-linked question. No background agent answers on the learner behalf.

3. Route a real response to WF05 and optional WF06; preserve source access and hints.

4. Map only supported evidence/user grading into scheduler ratings. Uncertain assessment or unobserved skill is not an automatic failure rating.

5. Append one review event and regenerate schedule state. Corrected assessments replay applicable scheduling history rather than creating duplicate reviews.

6. Pause, suspend or finish on user intent; a due item is not a new Calendar task.

7. Keep selection/suspension and grading-derived scheduler events versioned and separate from observed attempts. Changed eligibility/rating produces a new derived schedule/configuration, not another historical learner review.

### Staged writes

- Due-session plan and proposed scheduler update

### Published writes

- Actual submitted answers and resulting canonical attempts through WF05

- Operational review-event receipts referencing attempt/question revisions, in the existing run namespace (proposed scheduling contract)

- exports/learning/review-queue.json and due.md (derived, not evidence of learner performance)

### Success criteria

- Due selection is reproducible from selected cards/events/config; genuine responses update schedule once; missing learner input leaves a waiting state.

- No forgetting or elapsed time is misrepresented as an observed failure.

### Waiting or blocked conditions

- Missing selected card version

- Conflicting review events

- Uncertain rating

- Learner paused or no response

### Prohibited behavior

- Run a compulsory study session in the background

- Treat assistant explanations as reviews

- Create external reminders without separate permission

- Activate reminders or build an independent mastery/learning authority from scheduled dates

**Reported evidence:** P05 Q073-Q078; P06 A5/B5.

## WF09 — Apply reviewed corrections and invalidate dependents

**Current:** CORRECTION_CONTRACT_EXISTS; GENERAL_CHANGE_ORCHESTRATION_MISSING. assessment_revision and controlled tracking recovery are implemented contracts; P05 had no actual production assessment revisions and no universal dependency invalidation graph.

**Decision:** KEEP_REVISION_RULES_ADD_REVIEW_ROUTING_AND_DEPENDENCY_MANIFESTS. Different errors require different owners. A changed graph label or tool version must not silently rewrite learner history.

**Owner / execution:** integrity / mixed. **Priority:** interactive_or_maintenance. **Memory:** M01, M02, M04, M05, M06, M07, M08, M09, M10, M11, M12, M15.

### Triggers

- Learner disputes an assessment

- Manual source/interval/graph correction

- Revised source, rubric, policy or processing version

### Read dependencies

- Exact target revision and original evidence

- Current assessment chain and source/graph catalog

- Dependency manifest and outstanding jobs

- Authorized change scope

### Each processing round

1. Classify the issue: original data correction, assessment revision, graph/link change, recognition correction, or newly requested behavior.

2. Retain original text/times and existing record identities; propose a minimal revision with reason and expected previous version.

3. Use the owning writer and compare-and-publish policy. Assessment revisions replace interpretations for the same attempt; a new actual response is a different attempt.

4. Fence superseded in-flight publication and invalidate affected projections/caches/contexts only. Changes in graph wording do not automatically regrade old attempts.

5. Regenerate relevant views and replay affected review state. Preserve disputed states and notify dependent work of stale references.

6. Return a revision-linked receipt, not a silent overwrite.

7. Preserve the same skills and nonbranching chronological assessment_revision chain required by the actual validator. New assessed skills need an appropriate reviewed family/attempt path, not a silently widened correction.

### Staged writes

- Correction/reassessment candidate and dependency impact list

### Published writes

- Existing assessment_revision record where applicable

- New concept/alignment/card/source versions via owning writer

- Derived gap-view rebuild from the effective assessment revision (no separate canonical retraction ledger)

- Invalidation and supersession receipts

### Success criteria

- The authorized correction is traceable to its predecessor, preserves originals and invalidates all declared dependents without expanding scope.

- A conflicting branch is exposed rather than silently chosen by timestamp.

### Waiting or blocked conditions

- Stale expected revision

- Missing original evidence

- Unapproved material change

- Conflicting correction branches

- Unsafe publisher

### Prohibited behavior

- Edit old learner words to agree with a grade

- Delete inconvenient evidence

- Turn an inferred graph change into a new successful attempt

**Reported evidence:** P05 Q036/Q059/Q088; lines 498-510; P06 B4/B5.

## WF10 — Project memory, gaps and cross-device study state

**Current:** EXISTS_LEARNING_RENDERERS; NEW_PROJECTIONS_AND_RESUME_MISSING. Learning/shared renderers and some study exports exist, with reported stale views. No universal concept-tree/gap/review/resume view producer exists.

**Decision:** REUSE_RENDERERS_ADD_DERIVED_VIEWS_AND_EXACT_INPUT_MANIFESTS. Rebuilding trusted views is safer than asking an LLM to overwrite one cumulative memory file. Current facts must come from original effective evidence.

**Owner / execution:** integrity / deterministic_with_bounded_summaries. **Priority:** after_commit. **Memory:** M01, M02, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14.

### Triggers

- Verified attempt/correction/graph/review publication

- Per-device resume or preference command

- Explicit stale-view repair within permission

### Read dependencies

- Validated current catalogs/source identities and effective assessment_revision chains

- Immutable full-input snapshots, separately captured tutor messages and verified receipts

- Operational review events, session resume state and last verified export manifest

- Approved shared-learning links and original attempt references

### Each processing round

1. Validate required original records and effective corrections; distinguish stale derived text from lost attempts.

2. Derive gap summaries from assessment analysis/missing_or_incorrect/error_types and supplied conditions. not_observed carries no diagnosis; the latest corrected assessment can retract an earlier finding.

3. Build concept trees from existing IDs/relation semantics with freshness/provenance. The same concept can appear in multiple displayed branches without multiple definitions or performances.

4. Summarize relevant conversation/resume state from immutable visible turns; do not fabricate missing historical audio or answers, nor treat the summary as independent competence.

5. Publish complete versioned derived output and manifest after local readback. Client checks matching bytes before rendering; local output is not proof of remote delivery.

6. Limit shared-learning publication to the existing owner/approved scope. Reference original evidence once and retain unmeasured independence, retention and transfer.

### Staged writes

- Rebuilt gap/review/context/UX projections and hash manifest

### Published writes

- Existing learning-state.md and course/shared views only through respective owners

- exports/learning/concept-tree.json

- exports/learning/learning-gaps.json and learning-gaps.md

- exports/learning/review-queue.json when the new scheduler is approved

- Operational session summary referencing immutable turns; exported UI resume pointer

- Complete derived-output manifests and per-workflow task.md dashboards

### Success criteria

- Structured factual projections reproduce from effective canonical records and declared versions. Optional model-written prose is revision-linked, replaceable generated output; byte-identical regeneration and new learner facts are not claimed.

- Remote readers validate complete manifests or keep the last verified view with an explicit stale/pending badge.

### Waiting or blocked conditions

- Invalid underlying record

- Incomplete synced output bundle

- Conflicting UI event branch

- Owner unavailable

### Prohibited behavior

- Treat a generated summary as new primary evidence

- Call zero recorded attempts zero knowledge

- Claim remote visibility from a local filesystem write

**Reported evidence:** P05 Q060/Q076-Q088/Q098; P06 B4/B5.

## WF11 — Supervise health, recovery and controlled maintenance

**Current:** PARTIAL_EXISTING_RECOVERY; RESIDENT_LIFECYCLE_UNVERIFIED. Some guarded publisher recovery and historical fixtures exist; no current companion or verified lock-screen/reboot/native-update/Drive-reconnect lifecycle was established.

**Decision:** KEEP_PUBLISHER_RECOVERY_BUILD_SUPERVISOR_RECONCILIATION. Always-on hardware does not make authentication, synchronization or native execution outcomes infallible. Recovery must preserve exact prior effects.

**Owner / execution:** supervisor / deterministic_with_explicit_repair_proposals. **Priority:** control. **Memory:** M01, M06, M07, M09, M11, M12, M14, M15.

### Triggers

- Heartbeat timeout

- Process/app/network/Drive restart

- Pending unknown completion

- Configured health/backup/evaluation timer

### Read dependencies

- Local journal, leases, published manifests and writer receipts

- Actual provider/runtime/permission status

- Disk/backlog/Drive sync observations

- Approved backup, retry and retention policy

### Each processing round

1. Detect unavailable runtime, expired auth/quota, stalled leases and unsynced/outdated manifests without using LLM polling.

2. Recover input jobs from immutable requests; reconcile provider run IDs and canonical receipts before retrying any ambiguous execution.

3. Resume only safe checkpointed work with a fresh fencing generation. Keep late outputs quarantined; never restore an older state over a newer valid record.

4. Escalate nonretryable failures and apply bounded backoff for transient ones. Isolate blocked jobs so other approved work continues.

5. Create consistent backups through the supported store/record contracts and exercise restores on disposable copies; retention/deletion requires its own reviewed policy.

6. Run configured adapter/quality regressions only on relevant changes. Propose new model/tool/prompt versions with evaluation; never self-promote them.

7. On update/authentication/Drive reconnect, suspend affected dispatch and reconcile the exact runtime/run outcome before rerouting. Windows error 10050 is not permission to alter a daemon, socket or firewall.

8. Retention/cleanup classifies full-turn snapshots referenced by canonical attempts as durable evidence even though stored below operational runs; do not sweep them as cache.

### Staged writes

- Recovery decision, before/after checks and repair proposal when needed

### Published writes

- Local health/journal/backup evidence

- exports/learning-app/health.json (minimal nonsensitive status)

- One actionable blocked/stale report or verified recovery receipt

### Success criteria

- Every interrupted item is reconciled or explicitly blocked; no false success, duplicate learner event, unsafe retry or silent model switch.

- No workload at idle consumes model calls, and alerts do not reveal sensitive content.

### Waiting or blocked conditions

- Missing durable input/receipt

- Authentication or quota

- Disk/storage corruption

- Unknown live writer

- Required manual recovery approval

### Prohibited behavior

- Delete another process lock blindly

- Copy a live SQLite database alone as a consistent backup

- Auto-install new tools or enable new paid inference

- Erase learning history as cleanup

**Reported evidence:** P05 Q064-Q066/Q095-Q101; P06 A3/B3/B4.
