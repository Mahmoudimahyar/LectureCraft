# review — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US043 / review:REQ-101 | UI22 | UXAC127, UXAC128, UXAC129 | AC26, AC28, AC68 |
| US044 / review:REQ-102 | UI22 | UXAC130, UXAC131, UXAC132 | AC26, AC28, AC68 |
| US045 / review:REQ-103 | UI23 | UXAC133, UXAC134, UXAC135 | AC26, AC29, AC67, AC68 |
| US046 / review:REQ-104 | UI23 | UXAC136, UXAC137, UXAC138 | AC26, AC29, AC67, AC68 |
| US047 / review:REQ-105 | UI24 | UXAC139, UXAC140, UXAC141 | AC24, AC27, AC28, AC40, AC67, AC68 |
| US048 / review:REQ-106 | UI24 | UXAC142, UXAC143, UXAC144 | AC24, AC27, AC28, AC40, AC67, AC68 |

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
| R1-Q1, R1-Q1b | Projection and API tests on the fixture catalog (extended with a collection that names no slide, a question without wording and a lecture without a collection); browser test of the bank (totals, load more, search, filter). Private read-only parity run: catalog → adapter → API → collection → rendered list, counts taken from the catalog at run time. |
| R1-Q4 | Projection test and browser test of the original/rendition actions. |
| R1-Q6 | Unit tests: id join, version mismatch, dual-identifier conflict, duplicate, unknown id; payload tests proving no guidance field in question, review, search or lecture views. Private count on the real maps. |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow, case and task ids are unchanged; the mapped scenarios above keep their meaning and status. The `R2-…` checks are defined in the [requirements](requirements.md) and, for R2-Q2 to R2-Q9, in the [evidence-alignment test plan](../evidence-alignment/test-plan.md).

### Logic and failure tests (necessary, never sufficient)

| Check | How the logic is verified |
|---|---|
| R2-Q1 | Projection and API tests on the fixture catalog (a question with no slide, one with no audio, one without wording, one in a collection of a lecture without a deck): each is present in the bank, in its lecture list and in search. |
| R2-Q10 | Payload tests: question, lecture-question, search, concept and inferred-anchor payloads contain no guidance field and no guidance text of the fixture (searched by a marker string planted in the fixture guidance). Unit test: an inferred-anchor item whose rationale reproduces guidance text of its question is refused. |

### On-screen verification — required for every check

A check is covered only when BOTH its logic row above and its on-screen row below have passing evidence on the same build. Every row is a browser observation by ordinary navigation from Study on the fixture profile (labelled synthetic); "private" parts are run once on the real profile and reported as counts only.

| Check | What is observed on screen |
|---|---|
| R2-Q1 | Browser: each of the four fixture questions above is found in the question bank, in its lecture's All lecture questions list and by search; the question without wording still offers Open original; the rendered totals equal the API totals. Private read-only reconciliation on the real catalogs: catalog → projection → API → rendered count, each taken at run time and reported side by side; a difference fails. |
| R2-Q10 | Browser: the marker string planted in the fixture guidance is absent from the rendered text of question cards, suggested-link rationales, search results and the concept views before an attempt, and present only where disclosure is permitted after one. |
