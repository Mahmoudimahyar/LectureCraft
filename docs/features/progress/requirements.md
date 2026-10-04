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
