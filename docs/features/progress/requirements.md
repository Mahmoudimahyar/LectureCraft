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


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only.

The requirement below is REOPENED as an open product failure despite green receipts: the learner cannot find or use course, lecture and slide concept maps. Earlier LOCAL_TESTED results and R1 receipts of the affected tasks do not cover the checks named `R2-…`. An API that returns nodes, a direct URL or a node count satisfies none of them.

**Superseded R1 sentences.** R1 placed the concept outline as a page under Progress, also reachable from a lecture's outline and the This-slide tab; as the only ordinary routes these are superseded by R2-C1, because the learner did not discover them. R1-G1 to R1-G4 and R1-F1 to R1-F4 stay in force. The decision not to add a graph view (D46) is superseded by R2-C3 and decision D61: the learner asked for a map and could not use the outline alone. R1-F1's four conditions are extended to the five evidence states of R2-C9.

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-C1 | Explicit **Concept map** access in every course header and a **Concepts** tab in the lecture workspace, both reached by ordinary navigation from Study; the Progress entry remains (US037 · UI19). | Not finding any concept view without being told a URL; a course page or a lecture page with no visible control that opens it. |
| R2-C2 | One scope control offers Course, Lecture and This slide. Changing it changes the visible set and the heading states the scope and its counts; This slide follows the selected logical slide. Inside a build group each entry is listed once and says where its support is: on this build, elsewhere in this sequence (naming the build), or group-level; something first shown on a later build is never presented as shown on an earlier one (US037, US038 · UI19). | The same list whatever scope is chosen, an empty panel with no explanation, a slide scope that shows another slide's concepts, or a concept revealed on the last build listed on the first as if it were already there. |
| R2-C3 | A readable hierarchy AND a graph of the selected node's neighbourhood, laid out by one layout engine: grouped at topic level, expanded on demand, selection retained across both, labels readable in the default view — at least 12 CSS px as rendered, that is after the graph's own zoom and any transform, not merely as a declared font size. The default view never fits more nodes by shrinking below that; what does not fit is reached by panning. All nodes are never drawn at once at small scale (US037 · UI19). | A wall of tiny overlapping nodes, labels that cannot be read without zooming, a selection lost when switching between outline and graph, or no graph at all. |
| R2-C4 | A keyboard-usable outline alternative offers everything the graph offers: the same nodes, relations, expansion, selection and detail. Arrow keys act on the focused tree only (US037 · UI19). | Something reachable only by pointing at a node in the graph; arrow keys in the tree changing the slide. |
| R2-C5 | One typed read model serves all three scopes and both presentations. The same ids and the same counts appear in outline and graph; no second graph store exists (US037, US038 · UI19). | Outline and graph disagreeing about what belongs to a lecture, or a concept counted differently in two places. |
| R2-C6 | Three edge families stay distinct in data and on screen, by label and line style with a legend: question → criterion → concept or skill; source (taught or supported on a page); prerequisite or overlap. Question containment is never drawn as a prerequisite (US037 · UI19). | Not being able to tell "this question assesses it" from "this slide teaches it" from "needed first". |
| R2-C7 | Selecting a node opens Sources, Questions and Evidence, each following the actual data joins. A source opens its exact page or build. Criteria are available in the detail even when not drawn. A missing definition is shown as a coverage gap or a source-backed proposal, never as an invented catalog fact (US038 · UI19). | Selecting a concept and seeing nothing happen, tabs that are empty without saying why, or a source link that opens the wrong page. |
| R2-C8 | Build grouping never duplicates concepts, questions or performances: a logical slide with several builds lists each once, and no count multiplies with the number of builds (US037, US038 · UI19). | The same concept or question listed once per build, or totals that grow when pages are grouped. |
| R2-C9 | Five evidence states are different and are worded differently: unknown, not applicable, not separately observed, assisted, independent. Prior exposure alone is not assistance (a seen question is not a shown solution); a solution that was actually supplied stays assisted (US038, US039 · UI19, UI20). | An attempt after merely having seen the question shown as "assisted"; an unknown shown as a failure or as zero; "not applicable" and "not observed" looking the same. |
| R2-C10 | No mastery label and no probability. A percentage appears only with its explicit unique denominator and conditions; uncertainty is not zero. Coarse assessments stay coarse: listing every criterion of a course is not having assessed them. A structural page has no forced assessed concept branch, and no failure of prerequisites is inferred from counts or graph degree (US038, US040 · UI19, UI20). | A percentage with no "of what"; a concept coloured as weak because nothing was recorded; a title page showing an unassessed-concept warning. |
| R2-C11 | Views are invalidated by revisions of their inputs — source, question catalog, source map, anchors, policy. Adding a source, changing a build group or changing an anchor refreshes the affected Course, Lecture and Slide views, keeps accepted corrections, and alters no attempt and no unrelated archive. A view older than its inputs says so (US038, US020 · UI19, UI10). | Regrouping a slide or accepting an anchor and the Concepts tab still showing the old state with no stale notice; a correction disappearing after a refresh. |
