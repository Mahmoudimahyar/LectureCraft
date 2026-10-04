# evidence-alignment — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US011 / evidence-alignment:REQ-101 | UI06 | UXAC031, UXAC032, UXAC033 | AC12, AC13, AC20, AC33 |
| US012 / evidence-alignment:REQ-102 | UI06 | UXAC034, UXAC035, UXAC036 | AC12, AC13, AC20, AC33 |
| US013 / evidence-alignment:REQ-103 | UI07 | UXAC037, UXAC038, UXAC039 | AC11, AC12, AC13, AC14 |
| US014 / evidence-alignment:REQ-104 | UI07 | UXAC040, UXAC041, UXAC042 | AC11, AC12, AC13, AC14 |
| US015 / evidence-alignment:REQ-105 | UI08 | UXAC043, UXAC044, UXAC045 | AC11, AC18, AC21, AC63 |
| US016 / evidence-alignment:REQ-106 | UI08 | UXAC046, UXAC047, UXAC048 | AC11, AC18, AC21, AC63 |
| US017 / evidence-alignment:REQ-107 | UI09 | UXAC049, UXAC050, UXAC051 | AC17, AC20, AC21 |
| US018 / evidence-alignment:REQ-108 | UI09 | UXAC052, UXAC053, UXAC054 | AC17, AC20, AC21 |
| US019 / evidence-alignment:REQ-109 | UI10 | UXAC055, UXAC056, UXAC057 | AC14, AC57, AC58 |
| US020 / evidence-alignment:REQ-110 | UI10 | UXAC058, UXAC059, UXAC060 | AC14, AC57, AC58 |
| US035 / evidence-alignment:REQ-111 | UI18 | UXAC103, UXAC104, UXAC105 | AC20, AC33, AC49 |
| US036 / evidence-alignment:REQ-112 | UI18 | UXAC106, UXAC107, UXAC108 | AC20, AC33, AC49 |

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
