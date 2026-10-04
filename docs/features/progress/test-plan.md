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
