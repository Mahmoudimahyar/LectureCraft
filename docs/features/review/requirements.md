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
