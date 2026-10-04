# tutoring — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

## UI11 — Get a quick answer without forced assessment

**Feature:** `tutoring` · **Stories:** US021, US022 · **Status:** specified, not implemented

**Workflows:** WF00, WF04, WF10 · **Memory:** M01, M03, M05, M06, M12, M13, M14 · **Screens:** SC04, SC06, SC12

**Trigger:** Choose Quick answer or explicitly ask for brief help.

### Preconditions
- Course assistance rules and actual provider capability permit the request.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Quick answer and type the question | Composer shows the pinned slide/source context and actual configured native destination. |
| 2 | Press Send | Preserve the submitted question; show transport/queue state separately from answer completion. |
| 3 | Receive the answer | Direct answer first, concise explanation and source chips; no compulsory initial quiz. |
| 4 | Read the small assessment label | Not assessed in this exchange: receiving an answer does not establish understanding; previous evidence is unchanged. |
| 5 | Choose Go deeper, Try explaining or Save question | Continue under the chosen interaction, or move on immediately. |

### Alternatives and failure paths
- Quick answer is brevity, not authority to bypass course restrictions or source permission.
- If an actual explanation/answer was submitted for assessment, brief feedback may still assess it; quick style does not erase observed evidence.
- If help is requested mid-attempt, offer Submit my response first or Reveal help without assessment and record exposure.

### Read dependencies
- Question, source refs, course strategy, effective assistance policy and selected context

### Writes and owner
- Immutable question and delivered tutor message, request/context receipt
- No attempt solely because the learner requested/received an answer

### Completion
- A concise, source-grounded answer or clear limitation is delivered; no false success/failure is inferred for the learner.

### Responsive / accessibility details
- Streamed text does not repeatedly steal focus; status updates are modest.
- One obvious Send action; no forced timed exercise.

**Related existing planned cases:** AC18, AC39, AC75. These remain NOT_RUN and are not replaced by the new UI cases.

## UI12 — Understand a concept through guided conversation

**Feature:** `tutoring` · **Stories:** US023, US024 · **Status:** specified, not implemented

**Workflows:** WF00, WF04, WF06, WF10 · **Memory:** M01, M03, M04, M05, M06, M12, M13 · **Screens:** SC04, SC05, SC10, SC11

**Trigger:** Choose Understand/Go deeper or ask for a fuller explanation.

### Preconditions
- Use existing course-specific teaching depth and source restrictions.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Understand | Tutor starts from the active question and known relevant context, not a generic chapter dump. |
| 2 | Ask for an example, contrast, mechanism or connection | Explanation is layered and source-linked; uncertainty or external additions are labeled. |
| 3 | Choose a useful follow-up or type one | Continue in the same context while preserving a return to the slide. |
| 4 | Choose Try explaining or a short check | Only the explicitly submitted learner response enters assessment. |
| 5 | Choose Give me the short answer or Return to lecture | End the detour without penalties or invented completion credit. |

### Alternatives and failure paths
- Missing concept-tree nodes are a system-coverage issue; original material may still support help.
- A source disagreement is exposed, not resolved by silently overwriting course framing.
- Automatic outside research is not implied by an unclear internal source.

### Read dependencies
- Permitted source neighborhood, existing strategy, relevant effective attempts where authorized

### Writes and owner
- Visible conversation and operational next-question state
- Assessment only via explicit real-response path

### Completion
- Learner controls depth and can leave; sources and any limits remain visible.

### Responsive / accessibility details
- Responses use paragraphs, optional sections and readable math rather than wall-of-text panels.
- Narrow screens preserve the slide-return anchor.

**Related existing planned cases:** AC18, AC24, AC65, AC75. These remain NOT_RUN and are not replaced by the new UI cases.

## UI13 — Submit and assess a typed teach-back

**Feature:** `tutoring` · **Stories:** US025, US026 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF10 · **Memory:** M01, M03, M04, M05, M06, M07, M08, M09, M13, M14 · **Screens:** SC04, SC06, SC18, SC12

**Trigger:** Choose Explain back/Check my explanation and submit a real response.

### Preconditions
- Full displayed question/context is identifiable; a valid rubric/family is used or explicitly pending.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Explain back | Show what to explain, source/reference visibility, full question and required figures. |
| 2 | Write the explanation | Draft stays attached to its original source context; autosave is labeled by actual durability. |
| 3 | Press Check my explanation | Freeze and retain full input before inference; repeated submit resolves to one logical response. |
| 4 | Review feedback | Show what was supported, partial, incorrect or not observed against actual criteria, with assistance and uncertainty. |
| 5 | Inspect save status | Input retained, assessment candidate, canonical attempt saved and view refreshed are independently visible. |
| 6 | Continue, dispute or attempt again | Later messages do not alter the frozen original; a new answer differs from regrading. |

### Alternatives and failure paths
- A missing rubric retains the response as Assessment pending; it does not invent schema-valid learning evidence.
- A valid alternative explanation is judged by criteria, not string matching to one model answer.
- A writer failure after evidence save retains that saved evidence and marks only the view/remaining step pending.

### Read dependencies
- Full question/source snapshot, intended family/revision/skills, actual context and help conditions

### Writes and owner
- Immutable full learner turn and attachment receipts
- Compatible attempt through course writer; full tutor message separate
- Derived learning-gap view

### Completion
- Full input is retained even on model failure; any assessment has transparent scope and verified publication status.

### Responsive / accessibility details
- Text editor supports readable math, preview and clear validation.
- Feedback is navigable by criterion; saves are announced without focus theft.

**Related existing planned cases:** AC19, AC20, AC21, AC22, AC23, AC49, AC50, AC51, AC61, AC62. These remain NOT_RUN and are not replaced by the new UI cases.

## UI14 — Explain aloud and correct transcription

**Feature:** `tutoring` · **Stories:** US027, US028 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF09, WF10 · **Memory:** M03, M05, M06, M07, M12, M13, M15 · **Screens:** SC18, SC04, SC06

**Trigger:** Press the microphone on an explanation/answer composer.

### Preconditions
- The selected transcription route and required data permissions are explicitly available; typing remains fallback.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Record | Explain microphone/process/retention policy before capture and pause lecture playback. |
| 2 | Start, pause or stop recording | Clear recording state, elapsed time and user control; no invisible always-listening mode. |
| 3 | Inspect the transcript | Correct recognized terms, symbols and wording; mark uncertain spans rather than guessing. |
| 4 | Choose Submit transcript or Retain audio under the approved option | Preserve transcript lineage and only the raw audio permitted by policy. |
| 5 | Receive feedback | Assess the confirmed available response; ambiguous recognition can cause clarification/abstention, not confident diagnosis. |

### Alternatives and failure paths
- Denied microphone or unavailable transcription keeps typed input available without paid fallback.
- Closing/navigating while recording prompts stop/cancel handling; no silent background capture.
- Correcting submitted transcription is a linked evidence/assessment correction, not overwriting an old snapshot.

### Read dependencies
- Device microphone grant, selected processing/retention policy, active task context

### Writes and owner
- Approved transcript/optional audio sidecars and lineage
- Only confirmed actual response reaches compatible attempt writer

### Completion
- The learner knows what was captured/transmitted/retained, can correct it, and no recognition guess becomes false learning evidence.

### Responsive / accessibility details
- Keyboard and screen-reader recording controls; visible plus non-color recording signal.
- No requirement to speak; media does not compete with the microphone.

**Related existing planned cases:** AC19, AC21, AC63, AC64. These remain NOT_RUN and are not replaced by the new UI cases.

## UI15 — Practice a question with explicit assistance

**Feature:** `tutoring` · **Stories:** US029, US030 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF06, WF10 · **Memory:** M01, M03, M05, M06, M07, M08, M12 · **Screens:** SC06, SC04, SC05

**Trigger:** Choose Practice from an existing question, lecture or concept.

### Preconditions
- The actual question/figures, course restrictions and source visibility are explicit.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open the question | See full prompt, givens and origin; choose supported reference conditions without a false secure-exam claim. |
| 2 | Attempt it | Keep answer editor separate from hidden solutions; preserve the shown question revision. |
| 3 | Request a hint or reveal sources | Record actual available help; reveal is deliberate and permitted by course policy. |
| 4 | Choose Submit answer | Evaluate the real answer with help conditions through WF05. |
| 5 | Ask for quick help or a diagnostic | Switch deliberately; allow submission of the current response before reveal or help without assessment. |

### Alternatives and failure paths
- A practice with sources hidden is self-study, not proof that external/native-session help was absent.
- An inaccessible/forbidden solution remains inaccessible, including through search and hidden client payloads.
- Skip or reveal without response does not create a fake failed attempt.

### Read dependencies
- Question/family/rubric/source version and course assistance rules

### Writes and owner
- Actual response snapshot and assistance/exposure record; compatible assessment via WF05

### Completion
- A real answer is assessed under the recorded conditions, or help/skip is captured without invented performance.

### Responsive / accessibility details
- Accessible question/figure text alternatives do not leak restricted solutions.
- Hint and reveal controls are separated from Submit and have clear labels.

**Related existing planned cases:** AC20, AC21, AC27. These remain NOT_RUN and are not replaced by the new UI cases.

## UI16 — Investigate a gap and return to the lecture

**Feature:** `tutoring` · **Stories:** US031, US032 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF10 · **Memory:** M03, M04, M05, M06, M07, M08, M12, M13 · **Screens:** SC04, SC06, SC10, SC11

**Trigger:** Choose Understand this gap or accept a diagnostic suggestion after feedback.

### Preconditions
- A real observation or explicitly labeled uncertain hypothesis exists; not every wrong answer has one known cause.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Inspect the proposed issue | Show the observed response and possible causes, not a permanent label. |
| 2 | Choose a short diagnostic | Present one discriminating question, with Skip/Just explain/Return options. |
| 3 | Answer or pause | Wait for real input and release the reasoning worker; a saved pending question does not run itself. |
| 4 | Review the updated interpretation | Supporting and contradictory evidence are linked; a new response may refute the first hypothesis. |
| 5 | Choose Go deeper or Return to slide | Deeper follow-up is optional, bounded, and resumes the original study context. |

### Alternatives and failure paths
- Default detour is short (normally up to two follow-up prompts); further depth needs a fresh user choice, not an infinite loop.
- No response leaves the issue pending, not failed or resolved.
- A wrong advanced answer does not mark every prerequisite ancestor weak.

### Read dependencies
- Effective attempts, typed relationships, source references and pending diagnostic state

### Writes and owner
- Operational diagnostic proposals and visible messages
- Actual next answers assessed through WF05; gap view derives from effective records

### Completion
- The next discriminating step is delivered or actual evidence refines the hypothesis; learner can stop without penalty.

### Responsive / accessibility details
- One question at a time with a persistent Return to slide action.
- No badge animation or notification implies the gap is resolved from merely reading help.

**Related existing planned cases:** AC24, AC25, AC40, AC65, AC66. These remain NOT_RUN and are not replaced by the new UI cases.

## UI17 — Challenge feedback, correct input or try again

**Feature:** `tutoring` · **Stories:** US033, US034 · **Status:** specified, not implemented

**Workflows:** WF05, WF09, WF10 · **Memory:** M05, M06, M07, M08, M09, M14 · **Screens:** SC06, SC11, SC12, SC14

**Trigger:** Select Report an issue, Correct transcript or Try again on feedback.

### Preconditions
- The original response and assessment references are visible; editing history is not unrestricted.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose the correction type | Distinguish wrong assessment, wrong captured input, source/rubric issue and genuinely new answer. |
| 2 | Inspect original and proposed correction | Preserve exact original content, time and assessment lineage. |
| 3 | Submit the correction for the appropriate owner | Show Pending review/verification; no immediate mastery change from clicking Disagree. |
| 4 | Inspect the resulting revision | Regrade preserves the same original intended skills; schema-changing rubric issues need a separate reviewed path. |
| 5 | Choose Try again when learning has changed | Capture a new real response instead of overwriting or disguising it as a regrade. |

### Alternatives and failure paths
- Conflicting correction branches stop for reconciliation.
- Changing a source/model/visualization does not automatically regrade every historical attempt.
- A saved input recognition error requires linked evidence correction; original text is not edited in place.

### Read dependencies
- Original turn/assessment, question family and correction rules

### Writes and owner
- Owned assessment_revision or appropriate source/input correction proposal
- New attempt only for new actual response
- Derived gap/progress/schedule recalculation references original events

### Completion
- The correction is accepted with correct lineage or visibly pending/conflicted; original evidence survives.

### Responsive / accessibility details
- Comparison is readable on mobile as Before/Proposed views with clear context.
- Destructive-looking actions explain history preservation rather than offering Delete failed attempt.

**Related existing planned cases:** AC22, AC29, AC30, AC52, AC54, AC69. These remain NOT_RUN and are not replaced by the new UI cases.

