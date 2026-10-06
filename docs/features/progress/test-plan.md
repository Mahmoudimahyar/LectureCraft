# progress — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US037 / progress:REQ-101 | UI19 | UXAC109, UXAC110, UXAC111 | AC15, AC16, AC53, AC59, AC60, AC65 |
| US038 / progress:REQ-102 | UI19 | UXAC112, UXAC113, UXAC114 | AC15, AC16, AC53, AC59, AC60, AC65 |
| US039 / progress:REQ-103 | UI20 | UXAC115, UXAC116, UXAC117 | AC31, AC40, AC54, AC70, AC72 |
| US040 / progress:REQ-104 | UI20 | UXAC118, UXAC119, UXAC120 | AC31, AC40, AC54, AC70, AC72 |
| US041 / progress:REQ-105 | UI21 | UXAC121, UXAC122, UXAC123 | AC29, AC49, AC50, AC62, AC73 |
| US042 / progress:REQ-106 | UI21 | UXAC124, UXAC125, UXAC126 | AC29, AC49, AC50, AC62, AC73 |
| US061 / progress:REQ-107 | UI31 | UXAC181, UXAC182, UXAC183 | AC24, AC31, AC32, AC40, AC72 |
| US062 / progress:REQ-108 | UI31 | UXAC184, UXAC185, UXAC186 | AC24, AC31, AC32, AC40, AC72 |

## Verification layers

1. Contract/unit: identity, state transitions, permission boundaries, payload validation and stale/duplicate handling.
2. Browser integration: actual user actions and all alternative paths in this feature; desktop/narrow widths,
   light/dark/system, keyboard, focus, zoom and reduced motion. State fixtures prove UI behavior only.
3. Relevant real adapters: source/player seeking, Drive synchronization, native target/terminal return and
   owning writers must be exercised separately when this feature consumes them.
4. Reviewed content: alignment/assessment/diagnosis assertions require independently reviewed examples;
   DOM checks and valid JSON do not prove pedagogical correctness.

All applicable [global cases](../../project/ui-global-acceptance.json) apply. Do not manufacture passing
commands or silently skip required checks. Select exact existing-runner/JUnit mappings only after the
application stack and real case identities exist; no fake test-map.json is created in this docs packet.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | How it is verified |
|---|---|
| R1-G1–G4 | Projection tests: id counts by kind equal the catalogs; criteria reachable; instance ids distinct per branch; bounded traversal with a synthetic cycle; scope filters. Browser test of expand-on-demand and node selection. Private read-only count parity on the real catalog. |
| R1-F1–F4 | Projection tests with synthetic attempts covering each condition, a revised assessment chain, a combined multi-action skill and an attempt without criterion observations. Browser test of the wording. Private example extracted from real records with counts only. |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow, case and task ids are unchanged; the mapped scenarios above keep their meaning and status. The `R2-…` checks are defined in the [requirements](requirements.md). Logic is written test-first; then browser integration through ordinary navigation; then the visual critique of the Concept screens under R2-V10. An API node count, a direct URL or a rendered canvas alone verifies none of these checks.

### Logic and failure tests (necessary, never sufficient)

| Check | How the logic is verified |
|---|---|
| R2-C1 | No logic-only test closes this; see the on-screen table. |
| R2-C2, R2-C5 | Projection tests: the three scopes are filters of one read model; ids and counts by kind are identical between the outline payload and the graph payload for each scope; the slide scope of a page in a build group lists each entry once and carries, per entry, the member pages that support it, so that an entry supported only on build 3 reads "elsewhere in this sequence" for build 1 and "on this build" for build 3. |
| R2-C3, R2-C4 | Unit tests of the graph model: the topic-level view of the largest fixture course has a bounded number of drawn nodes and expanding adds only neighbours; outline and graph are built from the same nodes and relations. |
| R2-C6 | Projection test: edges carry one of the three families and the owner's relation label; a containment relation between questions is never emitted as a prerequisite. |
| R2-C7 | Projection test: a node's detail follows the fixture's joins for sources, questions and evidence; a node without a definition carries the coverage-gap state. |
| R2-C8 | Projection test on a fixture lecture with a three-build slide: each concept, question and performance appears once in slide and lecture scope; counts equal the ungrouped counts. |
| R2-C9, R2-C10 | Projection tests with synthetic attempts for each of the five states, including a seen-question attempt without help (prior exposure, not assisted) and a supplied-solution attempt (assisted). Tests that no payload carries a mastery or probability field and that every percentage carries numerator, denominator, unit and conditions. |
| R2-C11 | Unit tests: changing a build group, adding a source and accepting an anchor each change the revision the affected views were built from and leave other lectures' views and all attempts untouched; an accepted correction survives the refresh; a view read with older inputs reports stale. |

### On-screen verification — required for every check

A check is covered only when BOTH its logic row above and its on-screen row below have passing evidence on the same build. A projection or unit test alone leaves the check OPEN. Every row is a browser observation by ordinary navigation from Study — no typed address, no request made by the test itself — on the fixture profile (labelled synthetic). The Concept screens are also part of the critique of R2-V10.

| Check | What is observed on screen |
|---|---|
| R2-C1 | Browser test that starts on Study and uses only visible, labelled controls: course header → Concept map; lecture → Concepts tab. Repeated at 390×844 through the pane control. |
| R2-C2 | Browser: switching between Course, Lecture and This slide changes the heading (scope and counts) and the rows, and the heading's counts equal the rows; moving to another slide changes the This-slide set; with a member of a build group selected, each concept is listed once and reads "on this build", "elsewhere in this sequence" (naming the build) or "group-level" — on build 1 a concept supported only on build 3 does not read as on this build; a scope that holds nothing says why. |
| R2-C3 | Browser: the graph opens at topic level with a bounded number of drawn nodes, expands on demand and keeps the selection when switching to the outline and back. Every label is at least 12 px as rendered: its text height on screen after the graph's own zoom and any CSS transform (computed font size multiplied by the scale of the viewport transform), in the default view and after each expansion. The default view does not fit more nodes by shrinking below that size; what does not fit is reached by panning. No two node boxes overlap in the default view. Zooming out further is the learner's own action and is not measured. |
| R2-C4 | Keyboard-only browser test: every node reachable in the graph is reachable, expandable and selectable in the outline, with the same relations and detail, and arrow keys there do not change the slide. Accessibility scan of both presentations in both themes. |
| R2-C5 | Browser: for each scope the heading counts are the same in the outline and in the graph, and a node selected in one shows the same detail in the other. |
| R2-C6 | Browser: three distinguishable line styles with a legend; each drawn relation names its family; a containment relation between questions is not drawn as a prerequisite. |
| R2-C7 | Browser: selecting a concept shows Sources, Questions and Evidence with rows that follow the fixture's joins; a source row opens the named page or build in the lecture; an empty tab says why; a node without a definition shows the coverage-gap wording. |
| R2-C8 | Browser on the three-build fixture slide: each concept and question appears once in This slide and in Lecture scope; the heading counts are the same on every build of the group and equal the ungrouped counts; the history lists each performance once. |
| R2-C9 | Browser: the evidence panel words five synthetic attempts with five different labels; the seen-question attempt reads as prior exposure and not as assisted; the supplied-solution attempt reads as assisted with its kind; unknown is drawn neither as zero nor as a failure. |
| R2-C10 | Browser on the Concept, gap and history screens: no mastery label and no probability; every percentage shown has its numerator, denominator and conditions beside it; a concept without any record is not worded or coloured as weak; on a structural page the This-slide scope says the page is structural and offers the lecture scope, with no unassessed-concept warning. |
| R2-C11 | Browser: with the Concepts tab open on a fixture lecture, a slide is regrouped and a suggested anchor is accepted through the interface; the Concepts view then shows a stale notice with Refresh, or refreshes by itself, and shows the new state; the accepted correction is still listed afterwards; the Concepts view of another lecture shows no notice and is unchanged. |

Private read-only parity on the real catalogs is reported with counts taken at run time; no count is a constant of this plan.
