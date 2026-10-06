# Current UI requirement index — review, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| review:REQ-101 | US043 | Use good questions rather than a large backlog | UI22 |
| review:REQ-102 | US044 | Choose whether an item is scheduled | UI22 |
| review:REQ-103 | US045 | Keep cards useful | UI23 |
| review:REQ-104 | US046 | Manage duplicates safely | UI23 |
| review:REQ-105 | US047 | Practice at useful intervals | UI24 |
| review:REQ-106 | US048 | Get adaptive help without fake scheduling evidence | UI24 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Questions, flashcards and adaptive review

Existing saved questions must be discoverable on the relevant slides/concepts, not discarded
and regenerated. Preserve instructor questions, user-authored questions and AI proposals as
different origins. A question can assess several concepts; a concept can be assessed by several
question families. Source provenance, rubric/reference-answer quality and difficulty assumptions
must remain inspectable.

The user may add/edit/remove/reject suggestions and select what becomes a card. Editing changes
a version; it does not rewrite earlier answers. Rejecting a bad AI question should not imply
that the user failed to understand the topic. Pending/draft/generated-approved states need clear
visual treatment. Repeated or trivial cards should be detected before entering the queue.

## Two different policies

An established scheduler such as FSRS is a candidate for when to revisit an item [R05,R12].
The tutor's remediation policy decides what skill to investigate and how to help after an error.
Do not invent a second memory algorithm merely to add AI, and do not equate a scheduled recall
estimate with conceptual mastery. Export to Anki is an OPEN integration decision, not promised
in V1 and not authorization to alter an existing deck.

Support concise recall cards where appropriate plus explanation, contrast, diagram labeling,
formula assumptions, worked-step reasoning and application items. Only selected formats enter
the pilot based on real course inputs. A long derivation may be better a guided exercise than a
large back-of-card answer. Preserve source links from every approved generated learning item.

Record independent success separately from helped/revealed responses. The raw event should
retain what actually happened before any mapping to a scheduler rating. Changing card content
or rubric may require scheduling reset/review; that transition must be explicit. A follow-up
variant is not automatically an independent equivalent item if it merely repeats the answer.

After a mistake: optional bounded investigation → targeted repair → fresh check → appropriate
later revisit. Avoid adding every possible diagnostic question as a permanent card. Let the
learner defer items and review load; do not create compulsory study blocks or hidden reminders.

Acceptance: a chosen card opens its source; a changed question preserves historic attempts;
an error/timeout retries without duplicating history; a missing answer key is not marked
verified; a hint or reveal is retained; a rejected suggestion does not reappear as newly approved;
review scheduling and diagnosis can fail independently without corrupting either state.

## Scheduling does not create competence history
P06 found no installed adaptive scheduler. Any review selection/event log is a proposed narrow
operational feature referencing existing questions and canonical attempts, not another source of
learner outcomes. Due dates and unresolved diagnostic notes do not imply failed knowledge. Exact
new path/schema and its writer need review; the previous learning/review authority proposal is withdrawn.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | Requirement (stories) |
|---|---|
| R1-Q1 | A complete question bank per course: every catalogued question is listed under its collection with the real total; collections are joined to lecture units by the files their questions cite, not by a slide match (US043, US017). |
| R1-Q1b | Lists load incrementally with the true total shown; search and filters operate on the whole collection; no list is silently cut (US043). |
| R1-Q4 | A question without catalog wording keeps its identity and its source-opening actions (US043, US045). |
| R1-Q6 | Assessor guidance is joined by the owner's entry id with revision applicability checked; conflicting, duplicate and unknown entries are reported as errors; guidance never reaches question-only views, search or the learner's context (US045). |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only.

Linking questions to the content they test is REOPENED as an open product failure despite green receipts. Earlier LOCAL_TESTED results and R1 receipts of the affected tasks do not cover the checks named `R2-…`. R1-Q1, R1-Q1b, R1-Q4 and R1-Q6 stay in force. R2-Q2 to R2-Q9 (anchors, inferred candidates, the three lecture lists, links, the validated examples) are defined in the [evidence-alignment packet](../evidence-alignment/requirements.md) and apply to every list of questions in Review as well.

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-Q1 | Every catalogued question stays reachable — in the bank, in its lecture's list and by search — including questions whose wording is not in the catalog, which keep their source-opening actions. No question is removed because it has no slide or no audio. Totals are reconciled catalog → projection → API → rendered list at run time (US043, US017 · UI22, UI09). | A catalogued question that cannot be found, a rendered total that differs from the catalog's, or a question without wording that lost Open original. |
| R2-Q10 | Assessor guidance stays out of every question-only payload, and an inferred anchor exposes no guidance: its rationale names criteria or subparts by identity and label, never by the expected answer (US045, US043 · UI23, UI22). | An answer, a rubric sentence or a marking note visible on a question card, in a suggested link's rationale, in search or in the concept views before an attempt. |
