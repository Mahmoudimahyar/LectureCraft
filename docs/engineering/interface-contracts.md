# New app interface contracts — v1 build baseline

These are new **adapter** contracts, not claims that native providers or existing course writers expose
these fields. Authoritative shapes are [contracts/index.json](../../contracts/index.json) and local JSON
Schemas; [check_contracts.py](../../tools/check_contracts.py) adds documented cross-field rules. All
fixture records are synthetic and must never be submitted to live inboxes or attempts. The existing
`course-learning-v1` and tracking schemas must be imported intact from authorized owner source in LL003.
This packet does not reconstruct or license that code from report excerpts.

## Contract inventory and ownership

| Contract | Purpose | Writer / consumer |
|---|---|---|
| control | Bounded cancellation, note, dispute and source hint proposals | Paired client → owning workflow |
| request | Deliberate command, stable input, scope and parent lineage | Paired client → supervisor |
| bundle / signature | Manifest entry, sizes, hashes, committed payload and signer | Sender → receiver |
| submission | Complete prompt, actual answer, conditions, timestamps and attachments | Capture layer → assessment/owner wrapper |
| message | Separately immutable learner question or delivered tutor text | Capture/result layer → conversation view |
| context | What permitted inputs/instructions were actually supplied | Context selector → provenance/reviewer |
| native-result | Observed exact run/target/terminal outcome | Native adapter → coordinator; not a writer receipt |
| publication | Verified owner result and separate view state | Writer facade → UI/projector |
| annotation | New versioned reviewed source association | Existing source-link owner → alignment view |
| review-item / review-event | Selected item and actual performed review | One review owner → scheduler/projection |
| resume | Nonperformance device checkpoint and draft lineage | Paired client → conflict-aware projection |
| view | Complete declared input/output generation | Projector → remote UI |

Paths in these records are relative to a trusted declared root; none may choose an executable, native
project, arbitrary absolute path or root. IDs resolve only through approved local bindings. Maximum
bounds are part of schema/policy, not permission to process sensitive content. Additional properties
are rejected; string `approved: true` cannot become authorization. Source locators use 1-based pages
and inclusive line ranges. Media is integer milliseconds `[start_ms,end_ms)` from original source start.
Figures use normalized x/y/width/height bounded within their stated page. Broad text locators remain
broad. Do not normalize Unicode, convert transcripts or re-encode attachments after capturing hashes.

## Exact file handoff

Each immutable request bundle is under an allowed course inbox. Payload files and `request.json` are
written first; `ready.json` is the manifest and is committed last. `task.md` is readable context, not
executable instructions or a mutable shared queue. The manifest names the entry record and every file,
size and SHA-256; no unlisted file is admitted. Late payload files leave the bundle pending. A local
complete hash set proves those local bytes, not current remote visibility. A result is another immutable
bundle with separate output and writer receipts. Generated `task.md` dashboards derive from the local
journal and never trigger their own workflow again.

Hash raw bytes using SHA-256. JSON is UTF-8 without BOM, duplicate properties or nonfinite numbers.
Senders serialize once; receivers verify those exact bytes rather than reserialize for signatures.
Manifest is at most 256 KiB; committed bundle at most 256 MiB/64 files. Each foreground text submission
is at most 200,000 characters and 16 attachments. Large original lecture media is referenced, not copied
into every request. Limits may be changed by reviewed configuration, never by task payload.

A signature is detached as `ready.sig.json`; manifest and signature do not hash themselves. Use
WebCrypto P-256 ECDSA with SHA-256 and 64-byte `r || s` P1363 output, base64url without padding. The
signed message is UTF-8 `LL-BUNDLE-V1\n` followed by the 64 lowercase ASCII hex characters of the raw
manifest SHA-256. The `algorithm` label is application-defined `ES256-P1363`, **not a JWS token**. Python
cryptography uses DER signatures; convert with its supported DSS encode/decode utilities. Never
implement elliptic-curve math. Test browser/Python cross-signature fixtures in LL017 before activation.
[REF19/REF20](../research/build-source-register.json) document the representation difference.

Device public keys are paired through a user-reviewed fingerprint/challenge on the Brain PC, with
course/action allowlists and revocation. Drive content does not enroll its own key. Browser private
keys use non-extractable WebCrypto storage where supported; XSS can still act as that browser, so CSP,
output sanitization, dependency review and explicit high-risk approval remain necessary. Brain private
keys stay in OS-protected local storage. The UI verifies signed results against its paired Brain key.
A signature proves possession of a paired key, not pedagogical truth or permission for arbitrary actions.

## Admission, replay and order

Admit only after signature/allowlist, schema, bounds and all file checks. `request_id` + content digest
is idempotent: same bytes reuse the original admission; different bytes conflict. `logical_input_id`
identifies the real learner response across transport retries; dispatch IDs identify computation attempts.
A new actual response gets a new input/attempt. Regrading the old response never adds a learner trial.

Device sequence counters must be unique, but must not discard a legitimate out-of-order independent
request simply because a larger number arrived first. Parent-dependent work waits for its referenced
parent; resume siblings are a visible conflict. A cancelled or superseded job cannot publish as the
current generation. Native completion unknown is not safe to retry blindly. Durable receipts and native
IDs are reconciled before redelivery. Expired requests require renewed user intent; keep captured input.
No exactly-once provider computation claim is made; target one accepted canonical publication.

## Complete evidence and writer boundary

A `submission` freezes the exact shown prompt, required figures, actual answer, known assistance and
client time basis. The later tutor reply is a separate `message`. If family/rubric or recognition is
unresolved, preserve the full input and show pending; do not fabricate a valid academic attempt.
The snapshot exists/readbacks before the attempt candidate references it. The wrapper verifies the
sidecar hash, scope, logical input, exact excerpt and attachment digests before and after owner save.
Existing locator strings alone do not perform those checks. Known timestamps stay distinct from host
receipt time; unknown occurrence remains null. New clock fields map explicitly to the actual current
academic schema, not by copying sidecar enum labels into it.

BE 505's real `saved` / `already_saved` outcomes and saved-evidence/view-error exception map into the
publication receipt. Other courses require the inspected coordinated procedure. `incomplete` is not
`blocked-no-write`: reconcile partial effects. An attempt save with stale view remains saved. Only an
owner-verified complete canonical record earns a saved receipt. A no-assessment quick answer yields
`kind:none/status:not_requested` rather than an invented attempt. Existing publisher statuses are
preserved in private detailed receipts, not rewritten by the model.

## Annotations, review and derivatives

New timing assertions persist under the existing source-link owner in a reviewed sidecar registry
beside current source maps (selected adapter convention `work/lecture-review/source-links/`). One
revision JSON is immutable, with predecessor and input hashes. Old prose and new records cannot both
be edited independently as authority for the same link; migration is a scoped owner task. Rendering
`exports/learning/alignment.json` cannot be the only copy of a manually confirmed time annotation.

Selected review uses existing questions/families. `saved_only` is not due. v1 auto-scheduling requires
an actual linked canonical attempt, an explicitly supported rating and known no-assistance-before-answer
conditions. For uncertainty or assisted learning, store practice and let the learner choose a reminder;
do not feed a fabricated failure/success rating to FSRS. A later correction revises computed scheduling
state without adding another performed review. Initial FSRS desired retention target is 0.90 as a
scheduler setting, not a claim of measured learner retention; record actual installed defaults/version.
Disable random scheduling fuzz for reproducibility or persist its seed before enabling it deliberately.

Views list inputs, generator/policy and outputs. They add no new assessment facts. Factual projections
are deterministic; optional summary prose is generated evidence-linked text, not guaranteed identical
bytes on rerun. View freshness does not mean an old assessment becomes false after a tool update.

## Internal module ports (to implement; not existing endpoints)

`SourceReader.list/resolve`, `Capture.freeze/verify`, `Dispatcher.submit/status/interrupt`,
`LearningWriter.validate/commit/verify`, `Projection.build`, and `Scheduler.apply_event` consume the
versioned records above. Writer records are allowed only for the bound owner. The local operator
surface exposes health/configuration/status; it does not offer a remote arbitrary shell or unrestricted
file read. Third-party SDK protocol types are not relabeled as these application envelopes.

## Validation boundaries

The supplied 84 cases exercise structural and cross-field rules on synthetic data. File checks are
reference tests, not concurrent filesystem containment, cryptographic pairing, real native receipts,
or production schema compatibility. LL003/LL017/LL019/LL020/LL035 provide those separate required proofs.

## Request action to typed payload

`contracts/index.json` owns the closed `action_payloads` mapping. `ask` accepts only a
learner-question message labeled not assessed; explain/practice/diagnose/review_answer accept
a frozen submission with the corresponding activity. select_review/edit_review accept a review
item proposal; correct_source an annotation proposal; resume a device checkpoint. cancel,
save_note, correct_assessment and source_hint use the closed control union. No control request
contains a shell command, arbitrary root/thread selection, granted permission or replacement
canonical assessment. The receiver resolves the target and owning writer after authorization.

`validate_payload` checks the outer action, inner type, course/term, relevant request/thread,
logical input and device identities. It does not authorize a request or execute it. Every action
is still checked against paired-key scope, current ownership, expected revisions and payload
bytes before use. A cancel message is a request to cancel, not terminal cancellation; assessment
disputes carry the existing attempt reference and reasons, not a second learner answer.

`explain` in the wire action enum means a learner's **Explain back** submission, not a request
that the tutor explain something. Asking for an explanation uses `ask` with standard/deep
depth. A quick-depth response to a genuine submitted answer may still be assessed; reply
length and evidence kind are independent. This avoids converting ordinary help into failure.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

### Question and source resolution (read side; nothing is written to the course)
- **Admission** to a course's question bank is by the catalog's own `collection` field. A collection belongs to a lecture unit when the source ids its questions cite are files of that unit (exact id join against the inventory). No id or title substring and no slide match is used.
- **Typed anchors.** Each catalog locator is normalized into zero or more anchors: `slide_pages` (one-based physical pages of the cited deck, as lists and closed ranges exactly as written), `transcript_lines` (line ranges of the unit's transcript), `source_page` (a page of another named source), plus `qualifiers` (free text kept verbatim). Each anchor has a `basis`: `exact` when the page basis of that collection is recorded as reviewed in app configuration, `stated` otherwise. A locator with no parsable anchor yields `anchor_state: "unresolved"` and the original text.
- **Original and rendition.** `open_original` names the authoritative source. A `display_rendition` is offered only when the course index relates a displayable file to that original and a recorded verification of the two exists; it is labelled a rendition.
- **Deck selection.** Candidates of a unit are ranked by (displayable) × (index kind is the lecture-slides kind) × (cited by the unit's questions or related transcript). File order and size are never criteria. Equal best candidates produce `deck_choice: "unresolved"` with the candidate list; a local override in the app's private configuration selects one.
- **Guidance.** The assessor-guidance adapter is versioned. It joins by the owner's entry id, accepts `id` or `question_id` (both present and different is an error), checks the entry or file version against the question version, and reports duplicate and unknown entries. Guidance is returned only to the assessment context builder.

### Outline and evidence read model
- One model: nodes `{id, kind, label, …}` for topic, concept, skill, family, question, criterion; typed edges with provenance; scopes `course`, `lecture:<id>`, `slide:<lecture>:<page>`. Presentation rows are `{instance_id, node_id, parent_instance_id}`. Children are returned per expansion with a traversal bound and a visited set.
- Evidence conditions per observation: `unaided`, `assisted` (with the recorded kind), `prior_exposure`, `conditions_unknown`. `qualifying_unaided` requires demonstrated ∧ no assistance ∧ no reference ∧ no prior exposure ∧ an observed response, read from the effective assessment revision.
- Facet mapping: a versioned document (`mapping_version`, rules `{action token → facet | unclassified, rationale}`) applied at read time. Observations on skills with several action tokens stay combined.
- Coverage records: `{target_set, unit, rule_version, conditions, numerator, denominator, unassessed, uncertain}`.

### Policy context
- Projection document: `{projection_version, review_state, sources[{label, scope, sha256}], clauses[{clause_id, source, span, text_sha256, category, applies_to, include, exclusion_reason, restriction}], required_categories}`. The context receipt records projection version, included and excluded clause ids, source hashes and gaps.
- Tutor output may carry `segments[{text, support, sources}]`; `support` is `course_source` or `added_explanation`.


## Remediation amendment R1 — derived timing import (2026-10-05)

Consumer contract for speech timing produced OUTSIDE this app. The app runs no speech tool and has no audio worker: `brain/src/lecture_brain/derived.py` only checks, copies and reads. Schemas `contracts/v1/derived-manifest.schema.json` and `contracts/v1/derived-segments.schema.json`; consumer version `derived-consumer-1`. Proven on synthetic fixtures only (`brain/tests/test_derived.py`); no real manifest has been received.

- **Output root** (written by the runner and by nothing else): output files first, `manifest.json` last. A root without a manifest, or with a status other than `complete`, is incomplete and refused.
- **Manifest `ll.derived-manifest/1`**, one generation for ONE recording: `contract`, `status: "complete"`, `kind: "speech_timing"`, `course_id`, `generation`, `created_at`, `consumer_version`, `recording {source_id, sha256, bytes, duration_ms | null}`, `producer {tool, tool_version, model, language, parameters_sha256}`, `window {start_ms, end_ms}` (the part of the recording that was processed), `time_base: "clip_relative"`, `clip_offset_ms`, `input_fingerprint`, `segments_path`, `outputs[]` (1–32 common artifacts: relative forward-slash `path`, `sha256`, `bytes`, `media_type`), `text_origin: "generated_speech_text"`, `review_state: "generated_unreviewed"`, `establishes: []`.
- **Segments `ll.derived-segments/1`**: the same `course_id`, recording `source_id`, `generation`, `time_base`, `clip_offset_ms` and labels, plus `segments[{index, clip_start_ms, clip_end_ms, text, words?[{clip_start_ms, clip_end_ms, text, probability?}]}]`. A segment or word may also state `start_ms`/`end_ms` (both or neither).
- **Time rule.** File times are clip-relative. Recording time is `clip time + clip_offset_ms`, computed in one function and applied once. A stated `start_ms`/`end_ms` that differs from that sum is refused; so are an offset after the window start, a segment with start ≥ end, any time outside the window (±500 ms), and a window past the recording's end (±500 ms).
- **Input fingerprint**: sha256 of the canonical JSON of `{contract: "ll.derived-input/1", consumer_version, recording {sha256, bytes}, window {start_ms, end_ms}, clip_offset_ms, producer {tool, tool_version, model, language, parameters_sha256}}`. The importer recomputes it.
- **Import** (`lecture-brain import-derived --course <id> --root <dir>`, repeatable `--root`, `--max-imports`): an explicitly selected root; strict JSON; schema; every path a plain relative path to a plain file inside the root (no absolute path, drive, `..`, backslash, symlink or junction; the root itself is not a link and is not inside a course, planner or app-state folder); every output's size and sha256; caps (manifest 262,144 bytes, 32 MiB per output, 64 MiB in total, 20,000 segments, 400,000 words; media types `application/json`, `text/plain`, `text/vtt`); the recording's CURRENT identity from the inventory (`unknown_source`, `not_a_recording`, `source_unavailable`, `changed_input`). Nothing in a root is executed.
- **Store**: `<app area>/derived/<source_id>/<generation>/` — the verified bytes are written, read back, and the manifest is written last. A stored generation is never rewritten: identical bytes again are a no-op (`reused: true`), other bytes under the same id are `generation_conflict`, older generations stay. A stop request (`derived-import.stop` in the app state folder, or the caller's check) between steps leaves no manifest; the leftovers are invisible to readers and replaced by the next import.
- **Read** (`Derived.current`, `lecture-brain derived-status --course <id>`): the newest stored generation whose recording sha256 and size equal the current ones, in recording time, with `window`, `duration_ms`, `coverage_fraction`, `covers_whole_recording` and the labels above. States: `current`, `superseded`, `stale` (made from other bytes: kept, never served), `invalid`, `incomplete`. Windows of several generations are not merged.
- **Receipts**: each outcome is one journal receipt of kind `derived-import` with outcome `imported`, `no_change`, `rejected` (with the reason code) or `cancelled`. No job and no second queue are created; the source-refresh path (`updater.py`, workflow WF02) does not call this module.
- **What this does not establish**: generated text is new text, not the course transcript and not its line numbering; generated times are unreviewed; no slide association, annotation or review state is created from them; the public file route is unchanged (it serves PDF renditions only). Nothing here schedules or starts a runner.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including both R1 sections above, is kept as history; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results and R1 receipts do not cover the checks named `R2-…`.

Everything below is a **read-side, app-private** contract: it is built from the course's files, which are only read, and it lives in the app's private state area. Nothing here is written to a course, a catalog, an attempt, a shared mapping or the planner, and nothing here is a wire contract of `contracts/v1`; no existing strict `ll.…/1` schema is widened (a change of those needs a new major, as decision D52 records). Field names are those of this specification. Where the implementation's schema spells a field differently, the schema governs the spelling and this section governs the meaning; a meaning that is missing from the implementation is a defect.

**Superseded R1 sentences.** In the derived-timing section: "The app runs no speech tool and has no audio worker" and "Nothing here schedules or starts a runner" are superseded by the speech-runner contract below, only within its allowance and only by an explicit command; scheduling stays excluded. "No real manifest has been received" is out of date: a real proof exists in the producer's own format and is adapted on the consumer side. "No slide association, annotation or review state is created from them" still holds for the import step; the separate stages below may create *labelled suggestions* from imported or generated timing. "Windows of several generations are not merged" still holds across generations; the chunks of one recording made under one identical input identity are parts of one generation.

### Source anchor (R2-S2, R2-S6, R2-Q2, R2-Q7)
The 0.9 rule stays: pages are 1-based, line ranges inclusive, media integer milliseconds `[start_ms,end_ms)` from the original source start, regions normalized inside their page, broad text locators stay broad. R2 adds what an anchor handed to any consumer must carry:
- `source {source_id, version_id, sha256}` — the bytes the anchor was made for. An anchor is never resolved against other bytes without saying so.
- Exactly one locator kind, never converted into another: `page` (`page_index` with `page_index_base: 1`, and `page_label` only as written in the file), `region` (a page plus a normalized box), `lines` (of the named transcript version), `media` (with `timebase: "original_source_start"`), `text` (broad).
- Optional derived context from the source map: `logical_slide {id, map_revision}` and `build {ordinal, of}`. They accompany the page locator; they never replace it.
- `printed_slide_number {value, basis: "printed_on_page"}` only when a number is established on the page itself. `pptx {slide_id, ordinal, match_basis, match_state}` only when the source map records a match between THIS page and a slide of a parsed PowerPoint file of the unit. Both are absent otherwise; neither is ever computed from the page index, and a PowerPoint file that merely exists in the unit adds nothing to a page without a recorded match.
- A line number is not a page and not a time. A PowerPoint ordinal is not a PDF page index. A problem-set number is not a locator.
- Deep links keep addressing the physical page of the displayed deck (the existing `page` parameter) and may add the version. A link made earlier opens the page it was made for; when the deck's bytes differ from the link's version, the page says so instead of silently showing the page that now has that number.

### Source map `source-map/1` (R2-S1 – R2-S6, R2-S11)
One map per deck version; the ONLY source of slide identity for navigation, transcript, media, questions, Concepts and search. It is an app-private read-side document, so its identifier carries no `ll.` wire prefix; override records are `source-map-override/1`.
- Header: `contract`, `course_id`, `lecture_id`, `source {source_id, version_id, sha256, kind}`, `page_index_base: 1`, `page_count`, `map_revision`, `built_from {builder_version, signals_version, override_revisions, pptx}` where `pptx` is `{source_id, version_id, sha256}` of a PowerPoint file of the same unit or `null`.
- `pages`: every physical page `1..page_count` exactly once — `page_index`, `page_label | null`, `printed_slide_number | null`, `pptx {slide_id, ordinal, match_basis, match_state} | null`, `logical_slide_id`, `build {ordinal, of} | null`, `regions` (each `{region_id, box, logical_slide_id}`; only for a page holding several slides), `role {value, basis, state}`, `text_state` (`embedded`, `sparse`, `none`) and whether the page carries a figure or an equation.
- `logical_slides`: `logical_slide_id`, `kind` (`single`, `build_group`, `duplicate_group`, `handout_region`), `members` (pages, with build ordinal or region), `grouping {basis, signals, state, revision}`, `title | null`.
- **Grouping.** `basis` is `page` (the default: one page, one logical slide), `inferred`, `pptx` or `override`. An inferred build group needs at least two independent signals among adjacency, layout, actual labels, text containment and difference, and visual change, and joins adjacent pages only. A repeated heading or a similar image alone joins nothing. Uncertain means `page`. `state` is `generated`, `agent_reviewed` or `human_confirmed`.
- **Builds and duplicates are different groups.** A build group needs each later member to contain the earlier one AND to add content; its members are builds ("build 2 of 3"). An adjacent page that repeats its neighbour and adds nothing is a `duplicate_group` member, worded "duplicate of page N" and never as a build. The same page appearing again later in the deck (not adjacent) is not grouped at all: it stays its own logical slide.
- **PowerPoint.** `pptx` fields exist only when a `.pptx` of that unit was actually parsed (identity, order, titles, text, hidden flag; the parser renders nothing and writes nothing). The correspondence of a PowerPoint slide to PDF pages is itself a recorded match with its basis and state; it is never ordinal equality. A PDF-only map has no PowerPoint field anywhere.
- **Identity through change.** Every record stored against a logical slide also stores its supporting member pages. After a regrouping, records are re-resolved through those pages. Page addresses of one source version never change meaning. New bytes get a new map with a new `map_revision`; the old map stays readable; records made for the old version are flagged for review and are not retargeted (R2-S11).
- **Group-level facts.** A link made for a build group applies to the group and says so. It is not split into per-build facts, and content first visible on a later build is recorded against that build's page.

### Content role (R2-S7 – R2-S10)
`role.value` is one of `instructional`, `worked_example_or_question`, `objectives_or_summary`, `structural_title_or_section`, `administrative`, `blank`, `mixed`, `unknown`; `role.basis` lists the evidence; `role.state` is `generated`, `agent_reviewed` or `human_confirmed`. The role is independent of grouping, numbering and audio discussion.
- Sparse text is not evidence of a structural or blank page: a page with a figure or an equation is content unless other evidence says otherwise, and `unknown` is preferred to a wrong role.
- **No-forced-requirement roles:** `structural_title_or_section`, `administrative` and `blank`. "Structural page" in the `R2-…` checks is shorthand for a page with one of these three roles. Such pages are excluded from prompts, generated practice, concept requirements and missing-match warnings, and stay in the inventory and in navigation. `objectives_or_summary` and `unknown` are NOT among them and keep the ordinary behaviour.
- **Denominators (R2-S10).** A coverage readout carries the `raw` denominator (every page) and the `instructional` denominator (pages whose role is `instructional`, `worked_example_or_question` or `mixed`), and beside them the counts of the other roles — `objectives_or_summary`, `unknown` (listed as uncertain) and the no-forced-requirement roles (listed as excluded) — so that the counts add up to the page count. A role change alters no page's own state (its links, anchors and stage stay what they were) and never the raw figure, neither its numerator nor its denominator. The instructional figure depends on roles by definition: a re-labelling moves it by exactly the pages whose role changed, and the readout shows the count of pages outside the instructional denominator together with how their roles were established (generated, agent-reviewed, human-confirmed). The raw figure is always shown beside the instructional one, a page of `unknown` role is never counted as excluded, and no statement of completeness is derived from the instructional figure alone.
- A supported audio interval over a structural page is kept as a link whose relation is discussion of the topic, not display of the page. Structural pages are candidates of the association like every other page; their role may lower a prior and never excludes them.

### Overrides (R2-S5)
Group, split, handout-region and role corrections are versioned local annotations: `override_id`, `revision`, `supersedes` (id and bytes of the predecessor), `target` (source version and pages or region), `action`, `value`, `author` (`learner` or `agent_review`), `reason`, `created_at`. One immutable record per revision in the app's private area; a second, different record with the same revision is a conflict, never last-write-wins; undo is a new revision. Overrides are applied on every build and outrank inference. They are not carried to new source bytes automatically.

### Timing proof adapter (R2-T1)
The producer's bundle keeps its own contract, `private-timing-output-manifest-v1` (a manifest naming `job_key`, the recording `source {course_id, source_id, version_id, sha256}` and `outputs` with path, size and sha256; a timing file with the clip offset, the decoded duration, the time coordinate, segments with words, and uncovered intervals). The consumer adapts; the producer is not rewritten and its root is never written to.
- The adapter checks every listed output's size and sha256, checks the recording triple against the CURRENT inventory, converts seconds to integer milliseconds by one stated rounding rule, and hands the result to the existing import path, so the same path, hash, bound, identity and immutability checks of the R1 import apply.
- The stored generation records the producer manifest's sha256, the adapter version, the covered window and the labels `generated_speech_text` and `generated_unreviewed`. Importing the same bundle again is a no-op.
- The proof covers a window of one recording. It is never reported as a timed lecture, as coverage of the recording, or as slide alignment.

### Speech runner and allowance (R2-T2, R2-T3)
- **Start.** Only by an explicit, resumable command of the app's CLI. Not started by the server, not scheduled, no second queue.
- **Runtime binding.** Configuration names an existing interpreter and an existing model directory outside the repository environment; both are verified to exist and nothing is installed or downloaded. Offline environment and local-files-only loading are forced. CPU, one worker, at most four threads. The effective settings are hashed into the generation's input identity.
- **Units.** Bounded chunks of one recording: `chunk_index`, `start_ms`, `end_ms`, `overlap_ms`. A finished chunk is checkpointed (output, hash, measured processing time) before it counts. Resume skips every chunk whose checkpoint is valid for the same input identity.
- **Seams and bounds.** A chunk's offset is applied once, in one function. Words in the overlap of two chunks are de-duplicated by one stated rule. Silence produces no words and no error. A short final chunk is valid. No time lies outside `[0, duration]` of the original recording.
- **Allowance ledger.** Persisted in the app's private state: the ceiling of this pass (four hours) and the cumulative processing wall time used under it. Every started unit of work is charged, including failed, interrupted and retried ones; work found unsettled after a crash is charged conservatively, never less than what demonstrably ran. The total only grows: it survives restarts and is never reset, lowered or edited, and the ceiling is not raised by a later, larger number. An unreadable ledger is refused, not replaced by an empty one. Charged time never exceeds the ceiling: either no chunk starts unless the remaining allowance covers that chunk's own time limit, or a chunk still running at the ceiling is stopped there. In both cases the time spent is charged and the output of an unfinished chunk is discarded. How the ledger is laid out (one document or a log, seconds or milliseconds) is the implementation's choice; the properties in this bullet are the contract.
- **Pause states.** `ceiling_reached`, `stop_requested`, `resource_failure`, `source_conflict` (the recording's bytes changed), each recorded with the remaining queue. Independent work continues.
- **Outputs.** Generations in the existing derived store, under its immutability and staleness rules. Course transcripts, the producer's proof and the model cache are inputs and are never written.
- **Readback.** Per course and recording: stage, covered windows, measured processing time, queue position and pause cause; plus allowance used and remaining. Measured time is reported as measured; nothing is extrapolated to the corpus.
- **Downstream binding (R2-T2).** The existing proposed downstream preparation task is bound to this SAME runner — the same command and the same settings identity — as a prepared, inactive record that names both. It is prepared only after real consumption of the runner's output was demonstrated (R2-T13); a binding that would start another tool or other settings is refused; and it creates no schedule. No schedule is activated by this amendment.

### Timing import and speech runner as implemented (2026-10-05, after independent review; R2-T1 – R2-T3)
What the two sections above mean in the code (`brain/src/lecture_brain/derived.py`, `brain/src/lecture_brain/speech/`). Where a name here differs from a word above, the word above keeps its meaning and this name is its spelling: `stopped` is the pause state `stop_requested`; `paused` with reason `resource_failure` is the pause state `resource_failure`. Proven with a labelled fake worker and with the real worker script run against labelled stub modules (`brain/tests/test_speech.py`, `brain/tests/test_derived.py`); the real runtime was exercised only by the runs recorded under `.local/reports/experience-repair-v2/timing/`.
- **Adapter (`speech/producer_bundle.py`, version `producer-bundle-adapter-1`).** `import-derived --root <bundle>` recognises a manifest whose contract is `private-timing-output-manifest-v1`, verifies it with the importer's own reader and stores ONE generation `pb1-<first 20 hex of job_key>` in the app's contract: `segments.json`, `provenance.json` (document `derived-provenance/1`) and the producer's files byte for byte under `producer/`. Seconds become integer milliseconds by round-half-even of `seconds × 1000`; recording time is clip time plus the clip offset, added once. Refusals beyond those of the R1 import: `bundle_incomplete`, `job_key_mismatch`, `source_mismatch`, `unsupported_status`, `time_base_mismatch`, `timing_invalid`, `count_mismatch`, `provenance_invalid`, `absolute_time_mismatch` (the producer's own statement of a word's recording time is not offset plus clip time) and `offset_unverified` (a clip that does not start at zero and has words carries no such statement, so an offset the producer already applied could not be noticed).
- **`Derived.import_prepared(course_id, manifest_bytes, outputs, origin)`.** Admission of a generation the app's own runner assembled in memory with `assemble_generation`: the same contract, fingerprint, identity, duration, window, segment, size and digest checks, the same store and the same `derived-import` receipt as a root on disk; `origin` stands where a root path would. A generation that carries `derived-provenance/1` must state `unresolved_intervals` readably — whole milliseconds, inside the window, in order, not overlapping, each with a reason — or is refused `provenance_invalid`; one whose `origin` is `speech_runner` must also name a merge policy the reader serves (`withhold-repetition-1`, `withhold-repetition-2`) or is refused `unserved_merge_policy`.
- **Processed is not covered.** `window` is what was processed. `unresolved_intervals [{start_ms, end_ms, reason}]` are parts of it whose text the runner withheld because it failed the repetition check (the recogniser's own compression ratio above its own threshold, or one word making up half of a segment of eight or more words): neither speech nor silence is known there. `Derived.current` and `derived-status` return `covered_intervals [{start_ms, end_ms}]` (the window minus the unresolved intervals, exact), `unresolved_intervals`, `unresolved_seconds`, `coverage_fraction` (resolved time over the recording's duration), `processed_fraction` (the window over the duration) and `covers_whole_recording`, which is false while anything is unresolved. A consumer that shows or aligns coverage reads `covered_intervals`; the window alone is never coverage.
- **Which generation is served.** Among stored generations made from the recording's current bytes: the one with the most resolved time, the newest among equals. States: `current`, `superseded`, `unserved_policy` (a runner generation that names no served merge policy or no unresolved intervals — published before text was withheld; kept, never served, also not when every other generation is damaged), `stale`, `invalid`, `incomplete`.
- **Binding (`config/local-bindings/speech.json`, private).** `interpreter`, `model_dir`, optional `model_bin_sha256`, `threads` (1–4), `workers` (1), `ceiling_seconds` (at most 14,400), `grant_id`, and `state_dir`: the ONE state directory the grant's ledger lives in (relative paths from the repository). Outside the fixture profile a binding without `state_dir`, or a command for another state directory, is refused `state_dir_not_bound`: another `--state-dir` or profile does not open a second allowance under the same grant.
- **Chunks and seams.** Chunk results are `speech-chunk/1` files (`work/<work id>/chunk-<n>.json`: words in chunk-local seconds plus `offset_ms`, `decoded_ms`, `end_of_stream`, the recording's sha256, `settings_sha256`, `decoding`). The settings of the verified proof are the primary pass. A chunk of which a tenth of the words or a minute fails the repetition check is decoded once more with the second-pass settings; the pass that keeps more accepted words is kept (rule `most-accepted-words-1`; with equal counts the one with less failed text, the first pass on a full tie), and `decoding` records both passes, `selection {rule, kept, why}` and `second_pass_sha256` — the digest of the second-pass settings and the selection rule, also stated in the published provenance per chunk, so a later edit of either is visible. The overlap rule ("one stated rule" above): the two decodings are spliced at the word both contain (same text, middles at most 250 ms apart) nearest the middle of the overlap; only when no word matches does the middle itself decide, and the merge counts both kinds of seam.
- **Generation ids of the runner.** `sp-<work id>-p<chunks merged, 4 digits>-<8 hex>`, the suffix being a digest of the published content (segments, provenance, producer, window). Other chunk results, another merge rule or an edit of the publication code therefore give another generation and never a `generation_conflict`; what was published whole by other publication code is published again by the next run.
- **Recording states (`speech-status`, document `speech-status/1`).** `queued`, `partial`, `complete` (every chunk published, nothing unresolved), `complete_with_unresolved` (every chunk published, part of the recording withheld), `source_conflict`, `failed` (with `media_missing`, `media_unreadable`, `duration_unknown`, `chunk_failed` or `publish_rejected`), `not_in_frozen_queue`. Per recording: `seconds_processed`, `seconds_published`, `seconds_covered`, `coverage_fraction`, `covers_whole_recording`, `covered_intervals`, `unresolved_intervals`, `unresolved_seconds`, chunks done and total, `last_error`, `resource_failures`, `lecture_ids` (as the inventory links them NOW; `lecture_ids_frozen` is the copy in the queue). A chunk fails an attempt when its audio cannot be decoded, when the worker dies or stalls inside it, or when the supervisor does not accept the result the worker wrote (the reason is shown); two failed attempts set the recording aside until `--retry-failed`.
- **Run outcomes and the `speech-run` receipt.** One receipt of kind `speech-run` per run, no-change run, refusal, error and interrupt, with `outcome` (`ran`, `no_change`, `refused`, `failed`), `state`, `reason`, `detail`, `run_id`, `runner`, `profile`, `grant_id`, `allowance {ceiling_seconds, used_before, used_after, remaining_seconds, recovered_seconds}`, `wall_seconds`, `chunks_completed`, `media_seconds`, `words`, `segments`, `published[]` (generation, window end, `complete`, `covers_whole_recording`, covered and unresolved seconds, import status), `remaining`, `queue`, `selection`, `pause` and `at`. States: `completed`, `no_change`, `max_chunks_reached`, `max_seconds_reached`, `ceiling_reached` (`allowance_exhausted`, `hard_ceiling`), `stopped` (`stop_file_present`, `stop_file`, `interrupted`), `paused` (`worker_failed`, `worker_startup_failed`; on later runs `resource_failure`), `failed` (`worker_died`, `worker_stalled`, `worker_lease_lost`, `worker_launch_failed`, `publish_rejected`, `internal_error`), `refused` (`no_binding`, `binding_invalid`, `state_dir_not_bound`, `interpreter_missing`, `model_missing`, `worker_missing`, `already_running`, `unknown_course`, `unknown_priority`, `invalid_argument`, `queue_unreadable`, `queue_binding_mismatch`, `ledger_missing`, `ledger_unreadable`, `grant_mismatch`, `ledger_behind_journal`). The command exits 0 for the first five states and for `stopped`, 130 after an interrupt, 1 otherwise.
- **Resource failure.** A failure the worker reports (memory, model, runtime; also one that keeps it from starting) pauses the queue: no chunk is counted as failed, no recording is set aside, the pause is stored with the queue, later runs start no worker and are not charged, and `speech-run --retry-failed` continues with the recording concerned tried last. However a run ends, its child is stopped, its reservation is settled with the wall time that passed, and its receipt is written. The job also carries the ceiling as a clock time, at which a worker left without a supervisor stops by itself.
- **Not established here.** Acoustic accuracy; that a second pass repairs repetition loops in general; reproducibility of a second pass that falls back to a temperature above zero (it is not seeded); behaviour of the real runtime on every container format of the corpus.

### Text-alignment mapping (R2-T4)
Transfers times from generated words to lines of the course's ORIGINAL transcript without changing either. It records the transcript `{source_id, version_id, sha256}`, the generation it used, the method and its rule version with thresholds fixed in that version, whether the mapping as a whole was accepted (generated text and transcript must actually correspond; otherwise the whole mapping is refused with a reason and no line is timed), and per line: its number, whether it is `aligned` or the named reason it is not (too few of its own words matched, outside the transcribed window, empty), and for aligned lines only a start and an end with the matched and total word counts. Aligned times do not run backwards against line order. No time is interpolated over an unmatched line, and none is produced outside what was transcribed. A line that is not `aligned` has no time anywhere in the app. The original transcript's hash before and after is recorded.

### Timing link (R2-T5 – R2-T11)
The read-side record every range on screen comes from:
- `recording {source_id, version_id, sha256}`, `timebase: "original_source_start"`, `start_ms`, `end_ms` (start < end, inside the recording);
- `logical_slide {id, map_revision}`, `deck {source_id, version_id, sha256}`, `support {scope, pages, builds}` with `scope` one of `page`, `build_group`, `region`;
- `relation` (`discussed_during` or `displayed_during`), `occurrence_index`;
- `method {name, version}` and `evidence` (references to the page content, transcript lines, terms, neighbouring windows and sequence evidence that support it; frame evidence is its own kind and names the inspected frame times);
- `quality {acoustic, association, group_mapping}` — three separate objects, each with its own state and basis; no combined score exists;
- `review_state`: `generated`, `agent_reviewed`, `human_confirmed` or `rejected`; `origin`: `pipeline`, `manual` or `reviewed_source_map`.

Rules: one link per occurrence; disjoint occurrences are never merged and the time between them belongs to neither. No start or end is derived by dividing a duration among slides. A `build_group` link carries no per-build times. The association procedure may leave intervals unassigned and may assign a slide zero, one or several occurrences in any order. Human-confirmed and manually entered links stay `ll.annotation/1` records under their owner; pipeline suggestions are derived data kept under this contract in the app's private area (one file per lecture, `timing-links/<lecture_id>.json`, keyed by the inputs that produced it; they are not `ll.annotation/1` records); on read a confirmed or rejected annotation outranks a suggestion for the same occurrence, and a rebuild never deletes or downgrades it.

**Video frames (R2-T7).** `displayed_during` and frame evidence are recorded only where frames of that recording were actually visible and were inspected for that interval. An audio-only recording, or a video whose frames nobody inspected, yields `discussed_during` at most; no link claims that a slide was on screen without that evidence.

**Currentness (R2-T10).** A pipeline suggestion is current only for the inputs it was built from: the recording's bytes, the derived-timing generation, the text-alignment mapping version, the source-map revision and the method version. When any of them differs the suggestion is stale: it is not shown as a current range and is rebuilt or listed for review. Human-confirmed and manually entered links are not derived data; a rebuild never invalidates them, and they are flagged for review only when the bytes they were made for change (R2-S11).

A slide without a link carries exactly one of six states. Their conditions exclude one another, so each state has its own cause:
- `recording_unavailable` (with the reason) — there is no recording, or it cannot be read. Stated first, whatever the page's role.
- `no_range_expected` — the recording is available, the page has a no-forced-requirement role and nothing was found for it. Nothing is missing and no warning is shown. This is not an exclusion from matching: a supported interval over such a page is a link, not this state.
- `audio_unprocessed` (with the processed window, which may be empty) — for any other page: no reviewed or generated timing covers any part of the recording; or timing covers only part of it, the association ran over that part under the current inputs and found nothing for this slide there.
- `association_not_run` (with the cause: not run yet on this recording, inputs changed since it ran, or no adequate association method is available — R2-T6) — timing exists for all or part of the recording, but no association result exists under the current inputs.
- `ambiguous` (with the candidates) — the association ran and produced candidates for this slide, none good enough to show as its range.
- `not_discussed` — only when timing covers the whole recording, the association ran over all of it under the current inputs and produced nothing for this slide, not even a candidate.

The benchmark of R2-T6 writes, for the lexical baseline and for the selected method on the same labelled references: the reference set's identity and size, the fixed thresholds, and the results with their denominators.

### Inferred question anchor `ll.inferred-anchors/1` (R2-Q3 – R2-Q5, R2-Q10)
Candidate links from questions to teaching content, kept apart from the course's own anchors. The file format is the one fixed for this pass; this section gives its meaning and adds no field to it.

- **File.** One private file per course in the app's state area, `inferred-anchors/<course_id>.json`, never in a course folder: `contract: "ll.inferred-anchors/1"`, `course_id`, `produced_at`, `producer`, `question_index_sha256` (the question index the candidates were made against) and `items`.
- **Item.** `question_id`, `question_version`, `lecture_id`, `source_id` and `source_sha256` (the deck bytes that were inspected), `pages` (physical, 1-based, of that deck), `regions` (`null`, or bounded regions of those pages), `criteria` (ids of the question's criteria that the pages support), `coverage` (`"main"` or `"partial"`), `rationale`, `state` (`"agent_inferred"` or `"agent_reviewed"`) and `verifier {verdict, note}` with `verdict` `"upheld"`, `"narrowed"` or `"rejected"`.

Meaning:
- `coverage` describes how the named pages relate to the LISTED criteria, not to the whole question. `"main"`: they are the principal place where those criteria are taught. `"partial"`: they support only part of what those criteria ask. Neither value says that a slide teaches the whole answer, and the format has no value that does. How much of a question a link covers is computed on read, by comparing `criteria` with the question's catalogued criteria of that version, and is shown as "supports n of m criteria"; a card names the supported criteria and never words a link as the whole answer, also when n equals m.
- `state: "agent_inferred"`: produced and not checked by a second pass. `state: "agent_reviewed"`: a separate verifying pass recorded `verifier.verdict` — `upheld` (kept as produced), `narrowed` (kept with fewer pages or criteria than first proposed; the item holds the narrowed result) or `rejected` (kept in the file for audit and never displayed as a link). Both states are agent work. A learner's confirmation or rejection is not a value of this file: it is a separate versioned local annotation, like an override, which outranks the file and survives its regeneration.
- `rationale` says what on the named pages supports which listed criterion, in the producer's words. It quotes no assessor guidance and no expected answer (R2-Q10).
- `criteria` is empty only for a question whose catalog entry has no criteria; the rationale then names the part of the prompt the pages support, and the card says that no criteria are catalogued.

Accepting items on read (nothing is repaired or guessed):
- **Refused**, with the reason counted in the coverage readback: an unknown `question_id`; a `course_id` or `lecture_id` that does not match; a `source_id` that is not a deck of that lecture's unit; no page, or a page outside the deck; a criterion id that is not a criterion of that question; an empty `rationale`; a value outside the vocabularies above; `state: "agent_reviewed"` without a verdict; a rationale that reproduces guidance text of that question.
- **Stale**, kept and not shown as a current link: `question_version` differs from the catalog's; `source_sha256` differs from the current deck bytes; or the file's `question_index_sha256` differs from the current question index, in which case the whole file is listed as made for an earlier catalog.
- **What the reader cannot check and does not pretend to:** that a rationale is more than shared vocabulary, and that nothing was inferred from problem-set numbering. These are rules for the producer — a candidate needs content on the page that supports a named criterion; a number is not evidence; no prompt, grading weight or figure requirement is added — and the verifying pass is where a violation is rejected. Until an item is `agent_reviewed` it is displayed as a suggestion that has not been checked.

What a question shows. The four kinds of tie — `exact` and `stated` (the course's own anchors, R1), `agent_inferred` (an item of this file that is not `rejected`) and `concept_related` — are distinct values, and no rebuild changes one into another. A question with no exact or stated anchor and no displayable item shows one of two lines:
- **Inspected, no supporting page found** — every item for this question version was `rejected`; the verifier's note is the reason.
- **No suggested link** — there is no item for this question version, with the recorded reason: no suggestions file exists for the course; the file holds no item for the question; or its items are stale. The fixed format has no record of a question that was examined without any candidate, so this line makes no statement about whether the question was examined, and nothing may word it as inspected or as uninspected.

**Amended 2026-10-06 (D80).** The whole-file rule above ("the whole file is listed as made for an earlier catalog" and every item
stale) is replaced: an entry that records `question_sha256` is judged by its own question. It is current while that digest equals
the digest of the question as catalogued today, and stale (`question_changed`) when it differs, whichever question index the file
names. Only an entry without a recorded digest, in a file made for another index, is stale for that reason alone. The file is still
reported as made for an earlier catalog.

### Concept read model additions (R2-C5 – R2-C11)
- Edges carry a `family` — `assessment` (question → criterion → concept or skill), `source` (a page or logical slide teaches or supports a node; with the anchor kind above) or `structure` (prerequisite, overlap, containment with the owner's label) — besides the owner's relation label and provenance.
- Scopes are filters of one model: `course`, `lecture:<id>`, `slide:<lecture>:<page>`. The slide scope of a page inside a build group lists what is supported anywhere in its logical slide, each entry once by canonical id (R2-C8), and every entry carries `support_pages`: the member pages on which its support is recorded. The view words each entry relative to the selected page — **on this build**, **elsewhere in this sequence** (naming the build), or **group-level** when the support was recorded for the group and not for a page. An entry supported only on a later build is never presented as shown on an earlier one (R2-S3). Questions use the same three labels (R2-Q6).
- Evidence state per observation: `unknown`, `not_applicable`, `not_separately_observed`, `assisted` (with the recorded kind) or `independent`. Prior exposure is a separate recorded condition (`unseen`, `seen`, `unknown`) reported beside the state; it is not assistance. `qualifying_unaided` of R1 keeps its definition.
- No field expresses mastery or probability. A percentage is a coverage record of R1 with its numerator, unique denominator, unit, conditions and remainder.

### Revisions and invalidation (R2-C11, R2-S11, R2-T10)
Every derived view lists the revisions it was built from: source versions (decks, transcripts and recordings), question-catalog revision, `map_revision` per deck, the derived-timing generation and the text-alignment mapping version per recording, the association method version, anchor revision (reviewed and inferred), policy revision and evidence revision. A view is current only when all match; a timing link built from a superseded generation, mapping, map revision or method version is stale by this rule. A changed build group or anchor invalidates the Slide and Lecture views of that lecture and the Course view's entries for it, and nothing else. Accepted corrections are inputs and survive. No attempt is altered. The existing preparation queue does the rebuild; there is no second graph authority and no schedule.

### Build identity (R2-B1, R2-B2)
The status interface returns `app_version`, `commit`, whether the working tree was modified at build time, `assets {script, style}`, `profile`, `port`, and per course `preparation_generation`, `map_revisions` and derived-generation ids. The page compares the assets it loaded with those reported and says when they differ. No path outside the app, no secret and no course text is part of this record.

### What these contracts do not establish
Acoustic accuracy of generated timestamps, semantic accuracy of any association, correctness of any inferred anchor, grouping or role, educational validity, or the learner's approval. A suggestion is a suggestion; `agent_reviewed` is not `human_confirmed`; a stored record is not a canonical course fact.
