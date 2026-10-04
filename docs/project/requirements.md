> **Current UI baseline 0.8.0:** [UI decisions](ui-decisions.md), [flow catalog](ui-flows.md),
> and [story requirements](user-stories.md) incorporate the latest user answers and theme request.
> Retained earlier requirements below preserve identity/history; their unresolved interaction wording
> is narrowed by the explicit current baseline. Runtime proof, source quality, exact permissions and
> implementation approval are still separate. No new academic authority or provider substitution.

# Initial requirements register

No implementation is approved. USER-REQUESTED features may still require scope sequencing.
U1 = first handwritten image; U2 = second handwritten image; U3 = current spoken/text message.
Behavioral refinements are PROPOSED unless explicitly present in the inputs.

| ID | Source/status | Required outcome and important boundary |
|---|---|---|
| ingest:REQ-001 | U3 / USER-REQUESTED | Connect existing per-course material and learning records without requiring the user to rebuild their archive. Exact connector and write policy OPEN. |
| navigate:REQ-001 | U3 / USER-REQUESTED | Open a course lecture and navigate slide by slide while retaining position and related context. |
| align:REQ-001 | U1,U3 / USER-REQUESTED | From a slide, play only its associated recording segment(s), show transcript, pause, resume and revisit. Boundary quality must be visible. |
| align:REQ-002 | U1,U3 / USER-REQUESTED | Surface related problem-set questions/subparts and textbook passages, with actionable source locations. |
| align:REQ-003 | U2 / USER-REQUESTED | Label each slide with relevant concepts. PROPOSED: use stable, course-aware concepts rather than merging identical labels automatically. |
| tutor:REQ-001 | U1,U3 / USER-REQUESTED | Ask questions in the context of the active slide, including its figures and relevant sources. |
| tutor:REQ-002 | U1,U3 / USER-REQUESTED | Explain understanding in the learner's own words and receive feedback on what is right, missing, or incorrect and on connections to other concepts. Voice modality priority OPEN. |
| tutor:REQ-003 | U1,U3 / USER-REQUESTED | Investigate a wrong answer for a possible prerequisite gap or misunderstanding, rather than only repeat the same card. Root cause remains a hypothesis until supported. |
| tutor:REQ-004 | U1,U3 / USER-REQUESTED | Persist questions, attempts, feedback and weakness history so a later session does not start from zero. Preserve existing IDs and distinguish historical from newly assessed evidence. |
| practice:REQ-001 | U1,U3 / USER-REQUESTED | Display already-saved important questions and generate useful new questions tied to the material. Preserve instructor/user/AI provenance. |
| practice:REQ-002 | U1 / USER-REQUESTED | Add, remove, edit and reject generated suggestions. PROPOSED: edits create versions rather than rewriting old attempts. |
| review:REQ-001 | U1,U3 / USER-REQUESTED | Create flashcards from chosen questions/concepts; review should incorporate learning-gap repair. Scheduling engine selection remains proposed. |
| progress:REQ-001 | U2 / USER-REQUESTED | Show the learner's understanding for the active slide. PROPOSED: evidence-backed dimensions and unknown states, not uncalibrated percentages. |
| progress:REQ-002 | U1 / USER-REQUESTED | Show importance/foundational relevance and assessment relevance. PROPOSED: show cited reasons, not unsupported exam probabilities. |
| design:REQ-001 | U3 / USER-REQUESTED | A beautiful, consistent, usable web experience with good UI/UX, not a set of disconnected chat/files screens. Visual implementation is NOT_RUN. |
| scope:REQ-001 | Prior context / PROPOSED | Learning/assessment remains optional by mode; browse and direct source review stay available without compelled quizzes. |
| integrity:REQ-001 | Seed/prior context / PROPOSED | Original files and existing course/source/attempt identities remain intact; changes require compatible adapters, not silent migrations. |
| safety:REQ-001 | PROPOSED | Source access, AI processing, retention, export and sharing use explicit permissions and privacy boundaries. No public distribution of course material by default. |

## Cross-feature invariants proposed for approval

A displayed quote must resolve to the correct source revision and location. A link can be a
candidate without being confirmed. A visit/read/replay, unanswered question, AI-generated answer
or synthetic test must not count as independent learner success. A concept-related link is not
an automatic prerequisite, equivalence or demonstrated transfer. One learner event can support
multiple views but remains one event. Unknown knowledge is not zero ability.

Data unavailable, processing, inference-uncertain, access-denied, stale, failed and genuinely
absent are distinct UI/API states. Browsing already-available slides should not be blocked because
an optional expensive AI operation failed.

## Dispatch addition and current-contract clarification

U4 = latest native/file-dispatch request; P04 = supplied current-operation report, not a live audit.
The [dispatch feature](../features/agent-dispatch/requirements.md) adds request routing, native-session
eligibility, completion acknowledgment, durable result return and scoped course publication.
ChatGPT-first native preference is preserved. A different app-managed inference route remains unapproved; exact native surface and any spending need explicit verification/consent.

Current-contract refinement: distinguish concept, skill, criterion, question family, question
instance and actual attempt. Reuse the exact assessment outcome vocabulary and checked save
sequence. Neither a completed AI job nor an unanswered question increments learning evidence.
Stale summaries and limited cross-course mappings remain visible; new outputs do not auto-grant
transfer credit or reclassify prior observations.

## Accepted scope refinements from the user and P05 audit

These supersede earlier sample-limited/local-only proposals. No build/deployment permission is implied.

| ID | Status | Contract |
|---|---|---|
| scope:REQ-002 | USER-CONFIRMED | Private single-learner first release. |
| scope:REQ-003 | USER-CONFIRMED | All configured courses/lectures and available relevant materials are in scope; small validation samples are not the release boundary. |
| access:REQ-001 | USER-CONFIRMED | Cross-device access with Google Drive as material storage; a G:-only UI does not fulfill this requirement. |
| dispatch:REQ-016 | USER-CONFIRMED_TARGET | ChatGPT first. A Codex or Claude run must never be silently labeled a ChatGPT roundtrip. |
| access:REQ-002 | PROPOSED/P05 | Resolve course/source/version/anchor independently of local path, retaining Drive identity, permission and byte-version evidence separately. |
| align:REQ-004 | PROPOSED/P05 | Account for empty, absent, unindexed and learner-reported-unrecorded sources explicitly. Do not fabricate recording intervals or synthetic instructor audio. |
| align:REQ-005 | PROPOSED/P05 | Existing TXT line associations are not recording timestamps; derive times only after verifying exact media/transcript correspondence. |
| integrity:REQ-002 | PROPOSED/P05 | Route attempts through course-learning ownership and academic tracking through its separate publisher; no universal writer is assumed. |
| integrity:REQ-003 | PROPOSED/P05 | Source freshness checks must actually consume/check source evidence; publication consistency alone is insufficient. |
| continuity:REQ-001 | PROPOSED | Preserve an acknowledged learner submission durably across interruption and show queued versus canonical-save receipt honestly. Primary writer host is the user-confirmed always-on Brain PC; actual owning writer/runtime compatibility remains to be verified. |

All numerical link/latency tolerances require reviewed evaluation evidence. Requirements above
are not implementation tests passed. Existing report observations and proposed extensions stay
separate; current course records are not silently transformed into the proposed data model.

## 0.5.0 — always-on workflows and complete learning memory

| ID | Status | Contract |
|---|---|---|
| execution:REQ-001 | USER-CONFIRMED | Primary PC remains the computation/native-project host; other interfaces exchange work via Drive. |
| execution:REQ-002 | USER-REQUESTED | Dedicated workflows continue until no eligible tasks remain; waiting learners/sources and limits are explicit, not silently abandoned. |
| execution:REQ-003 | DESIGN-PROPOSED | Deterministic watcher/supervisor admits committed bundles, coordinates role queues and idles without model polling. |
| memory:REQ-001 | USER-REQUESTED | Retain full visible prompt and every submitted learner explanation/answer with source/concept links, time basis and actual delivered tutor response. |
| memory:REQ-002 | DESIGN-PROPOSED | Preserve original v1 attempts; link full turn records via compatible fields/sidecar, no invalid schema expansion or invented old content. |
| memory:REQ-003 | USER-REQUESTED_WITH_DESIGN | Persist multilayer concept structure and timestamped gaps; typed graph/trees and evidence-backed gap-event projection distinguish facts from causes. |
| memory:REQ-004 | DESIGN-PROPOSED | Asking for help, assistant completion, generated card, time passing and related prerequisite do not create learner failure/success. |
| workflow:REQ-001 | DESIGN-PROPOSED | WF00–WF11 define triggers, dependencies, steps, staged/published outputs, receipts, success and blocked/never actions. |
| delivery:REQ-001 | DESIGN-PROPOSED | Front ends wait for complete hash-valid result bundles; uploaded, received, answered and canonical-saved are distinct. |

No native trigger, file-write automation or new source processing has been executed. See the
[workflow contracts](workflow-catalog.md) and [acceptance scenarios](workflow-acceptance.md).


## UI/story requirement extension

`experience-spec.json` defines 64 additional feature-namespaced behavior requirements with story/flow
and planned acceptance IDs. Each of the six feature packets links those IDs without guessing actual
implementation test identities. Light/Dark/System, time-adaptive help, complete source context,
source-fidelity rendering and explicit failure/save states are included. Original requirement IDs
are retained; broad goals are refined, not deleted because only part of an implementation is ready.
