# review — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

## UI22 — Create or select meaningful review items

**Feature:** `review` · **Stories:** US043, US044 · **Status:** specified, not implemented

**Workflows:** WF03, WF07, WF10 · **Memory:** M01, M03, M04, M05, M11 · **Screens:** SC07, SC06, SC04

**Trigger:** Choose Save for later/Create review item or open relevant existing questions.

### Preconditions
- Questions and scheduling state have separate ownership; generation alone is not review selection.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open related/saved questions | Prefer existing instructor/user/catalog questions before generating alternatives. |
| 2 | Choose an existing item, Create my own question, or Request suggestions | For an authored item, enter the prompt, givens/figures and intended skill with an explicit learner-authored origin; for suggestions, show sources and bound generation. Reuse a matching question/family rather than creating a duplicate. |
| 3 | Preview or supply answer guidance/rubric under permitted disclosure | Edit wording or reject unsuitable items; distinguish learner-authored or tutor-authored guidance from instructor keys. A saved draft without a supported rubric is not ready for AI grading. |
| 4 | Choose Save only or Add to review | A deliberate selection creates scheduling state only when the approved scheduler is active. |
| 5 | Return to lecture | No automatic stack of unsolicited cards blocks the study flow. |

### Alternatives and failure paths
- Repeated numeric variation may reuse a family; new reasoning requires appropriate version/owner review.
- Missing original figure prevents a complete valid question; do not silently discard it.
- If scheduler is not configured, Save for later remains available and no due date is invented.

### Read dependencies
- Current question/family/source identities, selection preferences and allowed generation policy

### Writes and owner
- Owned question/family revisions when required; operational saved/selected-item records
- No performance attempt or calendar event

### Completion
- A chosen, source-linked item has a version and explicit saved/scheduled status.

### Responsive / accessibility details
- Question previews are accessible and do not require animated card flips.
- Batch selection is bounded and reversible without altering original instructor material.

**Related existing planned cases:** AC26, AC28, AC68. These remain NOT_RUN and are not replaced by the new UI cases.

## UI23 — Edit, suspend or retire a review item

**Feature:** `review` · **Stories:** US045, US046 · **Status:** specified, not implemented

**Workflows:** WF07, WF08, WF09, WF10 · **Memory:** M05, M07, M11 · **Screens:** SC07, SC06, SC14

**Trigger:** Use the item menu in saved questions/review.

### Preconditions
- Original instructor material and prior attempts must remain intact.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open an item menu | Offer Edit my item, Suspend, Resume, Remove from review and source/history details as permitted. |
| 2 | Edit a learner/AI-authored item | Explain that substantive changes create a new version; original-source questions are not overwritten. |
| 3 | Confirm suspension/removal | Change review selection only and show that historical responses remain. |
| 4 | Resolve apparent duplicates | Keep canonical IDs and reference the preferred item; do not automatically merge different skills or histories. |
| 5 | Inspect schedule after a version change | Recompute according to declared policy or await review, without inventing a new review event. |

### Alternatives and failure paths
- Concurrent edits compare bases before publishing.
- A source-backed prompt needs owner review rather than a private silent replacement masquerading as the original.
- Undo selection changes restores the selection intent; it does not delete executed review history.

### Read dependencies
- Question/version, selection and review event history, edit ownership

### Writes and owner
- Question revision through owner; operational selection/suspension event; derived schedule

### Completion
- Current review behavior changes deliberately while historical evidence stays attributable.

### Responsive / accessibility details
- Confirm destructive selection actions with clear scope; offer non-drag menu actions.
- Do not label Remove from review as Delete all evidence.

**Related existing planned cases:** AC26, AC29, AC67, AC68. These remain NOT_RUN and are not replaced by the new UI cases.

## UI24 — Run a review session and handle mistakes

**Feature:** `review` · **Stories:** US047, US048 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF08, WF10 · **Memory:** M03, M05, M06, M07, M08, M11, M12 · **Screens:** SC07, SC08, SC06, SC11

**Trigger:** Choose Start review for selected/due items.

### Preconditions
- Actual selected items, rating policy and source-disclosure rules are available.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose course or review scope and a suggested session size | Queue presents selected items and lets the learner stop freely. |
| 2 | Attempt the first item before reveal where appropriate | Capture the actual answer and known help conditions. |
| 3 | Request a hint, reveal or submit | Feedback and scheduling distinguish performed response, skipped item and uncertain grading. |
| 4 | After a mistake choose Diagnose, Show source or Continue | A short detour remains optional; no endless automatic prerequisite drill. |
| 5 | Finish or stop early | One review event per actual review; future due state follows the declared supported rating, and pending grades stay explicit. |

### Alternatives and failure paths
- Uncertain assessment is not automatically a failing scheduler rating.
- A recalled definition and a long application task need a supported rating/selection policy; no claim of identical calibrated scheduling.
- Duplicate event delivery changes the schedule once; self-ratings are labeled separately from independently observed criteria.

### Read dependencies
- Selected items, due computation/policy, actual prompt and relevant assistance boundaries

### Writes and owner
- Actual response via WF05; immutable review event referencing its attempt or supported explicit self-rating
- Derived due state, no Calendar mutation

### Completion
- Actual performed reviews and assistance are recorded once; uncertainty/skip do not masquerade as failure.

### Responsive / accessibility details
- Show answer uses an explicit accessible control, not a hover/reveal trap.
- No forced timer or streak punishment; pause preserves the current item and draft.

**Related existing planned cases:** AC24, AC27, AC28, AC40, AC67, AC68. These remain NOT_RUN and are not replaced by the new UI cases.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Flow, story, workflow and screen ids and the step tables above are unchanged; where these notes and older text differ, these notes govern the listed behaviour only. Checks are defined in the [requirements](requirements.md) and the [evidence-alignment requirements](../evidence-alignment/requirements.md).

**UI22 — Create or select meaningful review items (R2-Q1, R2-Q3 – R2-Q7, R2-Q10).**
- Step 1 ("Open related/saved questions"): from a lecture the existing questions are offered in three lists with counts — This slide, Related concepts, All lecture questions — and from Review in the question bank. Every catalogued question is in one of them, with or without a slide, audio or catalogued wording.
- Step 1, continued: each question states how it is tied to content — exact, stated, suggested link, concept-related, inspected with no supporting page found, or no suggested link with its recorded reason. A suggested link names its supporting page or region, the criteria it supports ("n of m") and why, and says whether a second pass has checked it; it is never worded as the course's own mapping or as the whole answer.
- Step 2: choosing an existing item keeps its source-page links. Opening one shows that page of that source version and returning restores the selection and any draft.
- Step 3: answer guidance stays behind the permitted-disclosure step; neither a list row nor a suggested link's rationale reveals it.
- Unchanged: Save only versus Add to review, and no schedule or attempt from selecting or linking.

