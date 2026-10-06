# progress — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

## UI19 — Explore a typed concept tree

**Feature:** `progress` · **Stories:** US037, US038 · **Status:** specified, not implemented

**Workflows:** WF03, WF10 · **Memory:** M01, M04, M05, M07, M08, M10 · **Screens:** SC10, SC04, SC06, SC09

**Trigger:** Select a concept chip or open Concepts from progress.

### Preconditions
- The view is generated from existing catalog IDs and reviewed relationship semantics.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open the concept/skill detail | Display its actual type, source support and relationship labels. |
| 2 | Expand a branch | Show bounded related entities; repeated appearances refer to one ID and cyclic associations are handled safely. |
| 3 | Inspect associated evidence | Separate related questions from actual assessed performances and note source/assessment freshness. |
| 4 | Choose a source, question or optional prerequisite check | Navigate with explicit context; no automatic competence transfer. |
| 5 | Return to the slide | Restore the prior study view. |

### Alternatives and failure paths
- An unmapped node is System mapping incomplete, not User does not know this.
- Question containment is not relabeled as concept hierarchy.
- Cross-course equivalent/related relationships require their current reviewed meaning and never create new attempts.

### Read dependencies
- Typed catalogs, existing question relationships, reviewed shared mappings and effective evidence

### Writes and owner
- UI expansion/context state; no new canonical concept or assessment from navigation

### Completion
- Structure is navigable without changing or overstating the underlying relationship/learning evidence.

### Responsive / accessibility details
- Provide an accessible list/tree detail alternative to a canvas diagram.
- Arrow keys act on focused tree, not global slide navigation; large graphs use bounded expansion.

**Related existing planned cases:** AC15, AC16, AC53, AC59, AC60, AC65. These remain NOT_RUN and are not replaced by the new UI cases.

## UI20 — Review learning gaps and choose study priorities

**Feature:** `progress` · **Stories:** US039, US040 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF10 · **Memory:** M03, M04, M07, M08, M09, M10 · **Screens:** SC09, SC10, SC11

**Trigger:** Open Progress or a slide evidence summary.

### Preconditions
- Data freshness and evidence scope are shown; source preparation and learning are distinct.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Progress | See observed skills, unassessed areas, assistance and freshness rather than an unexplained mastery percent. |
| 2 | Select a gap | Inspect supporting and contradicting actual attempts, criteria and uncertain cause. |
| 3 | Filter by skill action, course or reference conditions | Avoid mixing hinted recall with independent application. |
| 4 | Inspect importance | Show assessment relevance, foundational role and personal priority separately with supporting reasons. |
| 5 | Choose Practice, Defer or a study priority | Save the deliberate preference through its owner; no obligation/grade/calendar change occurs. |

### Alternatives and failure paths
- Zero records means Not assessed.
- A stale view retains a warning and original evidence access; it does not present obsolete weakness as current fact.
- A due review or passage of time does not prove forgetting or an exam probability.

### Read dependencies
- Effective assessments, canonical study choices and declared source relevance

### Writes and owner
- Derived gap/progress display; explicit study choice only via current catalog owner

### Completion
- Learner can inspect the evidence behind a priority and choose a next action without false measurements.

### Responsive / accessibility details
- Status uses text and symbols as well as color; chart/table alternatives.
- No shame/streak penalty language; compare like conditions explicitly.

**Related existing planned cases:** AC31, AC40, AC54, AC70, AC72. These remain NOT_RUN and are not replaced by the new UI cases.

## UI21 — Inspect conversation and attempt history

**Feature:** `progress` · **Stories:** US041, US042 · **Status:** specified, not implemented

**Workflows:** WF09, WF10 · **Memory:** M01, M05, M06, M07, M08, M09, M12, M15 · **Screens:** SC11, SC09, SC04

**Trigger:** Open a prior session, feedback evidence link or historical attempt.

### Preconditions
- Legacy excerpt-only records and complete prospective capture are clearly distinguished.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open History | Filter sessions/attempts by course, source, skill and actual available time. |
| 2 | Choose a turn or attempt | See exact available question/response, tutor reply, conditions and separate save states. |
| 3 | Inspect revisions | Show original and effective assessments with reasons, without counting regrades as new answers. |
| 4 | Open the source reference | Resolve the historical version or report unavailable bytes explicitly. |
| 5 | Continue the conversation or Try again | Create a new current turn with declared old/current source context, never edit the historical response. |

### Alternatives and failure paths
- Missing older full text is labeled Excerpt only; no reconstructed conversation is presented as original.
- Provider retry responses are grouped under the same submitted turn with obsolete/alternate status.
- A correction with unknown response time does not acquire a fabricated occurrence timestamp.

### Read dependencies
- Immutable turns/messages, attempt/revision chain, source versions and receipts

### Writes and owner
- Read view/resume state; new request only on explicit continuation

### Completion
- The learner can trace current judgments to actual original evidence and see provenance limitations.

### Responsive / accessibility details
- Use readable chronological/thread views, explicit time zones and expandable technical details.
- Do not rely on an infinite canvas or hover-only history controls.

**Related existing planned cases:** AC29, AC49, AC50, AC62, AC73. These remain NOT_RUN and are not replaced by the new UI cases.

## UI31 — Finish or pause a study session

**Feature:** `progress` · **Stories:** US061, US062 · **Status:** specified, not implemented

**Workflows:** WF10 · **Memory:** M03, M06, M07, M09, M11, M12, M14 · **Screens:** SC16, SC04, SC07, SC12

**Trigger:** Choose Finish session, pause, or return after an interrupted departure.

### Preconditions
- Only actual events can appear as learned/performed; obligations remain separately owned.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Finish session | Show last position, questions asked, actual assessed attempts and explicit pending work. |
| 2 | Review unresolved points | Offer selected next steps without claiming every viewed slide was mastered. |
| 3 | Choose Save items for later, Review now or Done | Record only deliberate review choices; no auto calendar or deadline edits. |
| 4 | Check pending save/transport state | Explain what is retained and what remains pending before closing. |
| 5 | Return later | Continue from verified resume state; leaving does not automatically cancel accepted background work. |

### Alternatives and failure paths
- A quick-answer-only session reports no assessed performance without calling the session a failure.
- Closing the browser may be interrupted; durability claims come from prior receipts, not guaranteed unload events.
- Study-time indicators are observational and do not establish knowledge.

### Read dependencies
- Actual session events, effective learning evidence, selected review and checkpoint

### Writes and owner
- Operational session summary/resume and deliberate selection only

### Completion
- Learner knows where to resume, what was actually done, and whether any publication remains pending.

### Responsive / accessibility details
- No forced recap quiz, streak punishment or modal on every navigation.
- Pending work has a direct Activity link; session summary can be revisited.

**Related existing planned cases:** AC24, AC31, AC32, AC40, AC72. These remain NOT_RUN and are not replaced by the new UI cases.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

**UI19 — See how ideas connect.** Entry points: Progress ("Concept outline"), a lecture's outline, and the This-slide tab. The outline opens at topic level for the chosen scope (course, lecture, slide); expanding a node loads its children. A selected node shows Sources, Questions and Evidence. The earlier single-node page remains as the detail view.

**UI20 / UI21 — gaps and history.** Status wording now carries the recorded condition (unaided, with assistance, after prior exposure, conditions unknown). A facet summary groups recorded observations by facet and condition and lists what is not separately observed.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Flow, story, workflow and screen ids and the step tables above are unchanged. Earlier text, including the R1 notes above, is kept as history; where these notes and older text differ, these notes govern the listed behaviour only. Checks are defined in the [requirements](requirements.md); states in the [shared contract](../../project/ui-state-and-interaction-contract.md).

**Superseded R1 note.** R1 listed the entry points of UI19 as Progress ("Concept outline"), a lecture's outline and the This-slide tab. Those remain possible but are no longer sufficient: the learner did not find the views there. R2 adds the two ordinary entry points below and a graph presentation beside the outline.

**UI19 — Explore a typed concept tree (R2-C1 – R2-C8, R2-C11).**
- Trigger, extended: **Concept map** in a course header (Study home and the course lecture list), the **Concepts** tab of the lecture workspace, a concept chip, or Concepts from Progress. None requires a typed address.
- Step 1: the view opens in the scope it was entered from — Course from the course header, Lecture or This slide from the lecture — and one control switches between Course, Lecture and This slide. The heading states the scope and its counts.
- Step 2: the hierarchy opens at topic level and expands on demand; the graph shows the selected node with its neighbours, using distinct line styles and a legend for assessment, source and prerequisite/overlap relations. Outline and graph share one selection.
- Step 3: selecting a node opens Sources, Questions and Evidence. Evidence separates related questions from recorded performances and uses the five states of R2-C9.
- Step 4: a source opens its exact page or build in the lecture; a question opens its card; nothing is credited by navigating.
- Step 5: returning restores the slide, the tab, the draft and the playback position.
- Added alternatives: in a build group each concept and question appears once and says whether its support is on this build, elsewhere in this sequence or group-level; the graph's labels stay at least 12 px as rendered in the default view; on a structural page the This-slide scope says the page is structural and offers the lecture scope instead of an empty branch; a view older than its inputs says so and offers Refresh.

**UI20 — Review learning gaps and choose study priorities (R2-C9, R2-C10).**
- Step 1 and 2: a gap states which of the five evidence states applies to each supporting record. Prior exposure is shown as prior exposure, not as assistance. No mastery label and no probability appear; a percentage is shown only with its explicit unique denominator and conditions, and unknown is never drawn as zero.
- Step 3: filters never mix assisted with independent records.

**UI21 — Inspect conversation and attempt history (R2-C8, R2-C9).**
- Step 2: an attempt shows its recorded conditions in the same five-state wording used in the concept views; a performance is listed once however many builds its slide has.
- Step 4: a source reference opens the page of the historical source version through the source map, or reports that those bytes are unavailable.
