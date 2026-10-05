# Current UI requirement index — progress, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| progress:REQ-101 | US037 | See how ideas connect | UI19 |
| progress:REQ-102 | US038 | Inspect rather than infer knowledge | UI19 |
| progress:REQ-103 | US039 | Understand my gaps | UI20 |
| progress:REQ-104 | US040 | Prioritize without invented probabilities | UI20 |
| progress:REQ-105 | US041 | See what I actually said | UI21 |
| progress:REQ-106 | US042 | Understand changes over time | UI21 |
| progress:REQ-107 | US061 | Stop without losing the thread | UI31 |
| progress:REQ-108 | US062 | Keep study aligned with my schedule | UI31 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Evidence-based understanding and importance

The user requests a slide-level understanding signal and a signal of importance/exam relevance.
Retain both ideas, but do not merge them or present an uncalibrated number as knowledge.

## Understanding: proposed evidence view

Track dimensions such as recall, explanation, application and cross-context transfer for the
concepts/skills represented on the slide. A dimension can be not assessed, demonstrated with
help, demonstrated independently on specific items, inconsistent, or due for a fresh check.
These labels are proposed UI language, not a psychometric scale validated for this user.

When showing a numeric result, display its real denominator, rubric/version, sampled tasks,
assistance level, date and limitations. '3 of 4 sampled criteria demonstrated without hints'
is meaningful as an observation. It is not '75% of the slide understood'. A slide view aggregates
relevant concept evidence but must reveal important unassessed prerequisites. Do not infer
mastery from time spent, videos watched, files imported, sophisticated questions or AI agreement.

Knowledge tracing offers established approaches to estimating skill states from performance
[R06], but arbitrary course data do not automatically justify a calibrated mastery model. Start
with transparent evidence and benchmark any probabilistic learner-state model before displaying
its values as probabilities. Missing historical logs are unknown evidence, not proof of failure.

## Importance: proposed separate reasons

Display assessment relevance from actual syllabus/objectives/instructor statements/permitted
past assessment material; foundational relevance from justified prerequisite relationships;
and personal study priority from current goals, due reviews and evidenced gaps. Instructor
emphasis inferred from a transcript is a candidate signal, not an exam guarantee.

Avoid a precise exam probability without a defined target event, sufficient relevant historical
data, held-out validation and calibration. If those are absent, say 'relevance uncertain' or
show the documented reason. A low exam-evidence label must not hide a concept needed for other
important skills. The user can correct priority assumptions and exclude genuinely irrelevant
material without deleting its source.

## Audit and correction

Every learner-state update should identify its supporting attempt(s), scoring method and
confidence/uncertainty. Assessments may be corrected or superseded; original responses remain.
No synthetic testing event enters the real learner history. Cross-course mappings preserve
identity and needed depth; a related concept is not an equivalent skill or proof of transfer.

Acceptance tests include no-evidence unknown state, hinted versus independent success,
contested AI grading, correct equivalent answers, revised sources, contradictory recent
attempts, dated priority rationale, and no fabricated exam probability on a new course.

## Authoritative evidence reconciliation — 0.6.0
Learning gaps are projected from existing effective skill observations and linked corrections.
Never create a second authoritative gap ledger or diagnose not_observed. Concept trees reuse
existing catalog IDs/revisions; repeated branches do not duplicate concepts or performances.
Full-turn integrity is verified by the new operational wrapper and does not redefine the attempt
format. A source/correction/projection version must remain visible where it affects interpretation.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | Requirement (stories) |
|---|---|
| R1-G1 | One typed read model serves Course, Lecture and Slide scopes and an accessible outline. Every admitted topic, concept, skill, family, question, criterion and relationship is present exactly once by canonical id; presentation rows carry separate instance ids (US037, US038). |
| R1-G2 | Nodes are grouped and expanded on demand; traversal is bounded and visits a node once; cross-links and cycles are shown as links, not as tree children (US037). |
| R1-G3 | Question relations keep the owner's labels and `automatic_credit: false`. Collection membership is not a slide or session anchor (US037, US038). |
| R1-G4 | Selecting a node offers Sources, Questions and Evidence. Slide scope comes from typed anchors only; related items are separated; missing anchors are visible (US038). |
| R1-F1 | Evidence is shown with its recorded condition. Solution shown, hints, notes, prior exposure and unknown conditions never count as recorded unaided performance (US038, US039). |
| R1-F2 | Performance facets come from a versioned read-side mapping with a rationale per rule. Where the record does not support a finer conclusion the view says "Not separately observed" or "Unclassified". A missing error tag is never read as success (US039, US040). |
| R1-F3 | Coverage figures always carry target set, unit (skills or criteria, never mixed), rule version, conditions, numerator, denominator and the unassessed / uncertain remainder. No mastery or exam probability. Importance stays ordinal (US040). |
| R1-F4 | Listing criteria is not evidence about them: where attempts carry no criterion observations the view says so (US038). |
