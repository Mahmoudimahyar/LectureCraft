# agent-dispatch — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US049 / agent-dispatch:REQ-101 | UI25 | UXAC145, UXAC146, UXAC147 | AC01, AC02, AC03, AC05, AC07, AC08, AC32, AC41, AC42, AC44, AC45, AC48, AC62 |
| US050 / agent-dispatch:REQ-102 | UI25 | UXAC148, UXAC149, UXAC150 | AC01, AC02, AC03, AC05, AC07, AC08, AC32, AC41, AC42, AC44, AC45, AC48, AC62 |
| US053 / agent-dispatch:REQ-103 | UI27 | UXAC157, UXAC158, UXAC159 | AC07, AC34, AC35, AC36, AC38, AC45, AC48 |
| US054 / agent-dispatch:REQ-104 | UI27 | UXAC160, UXAC161, UXAC162 | AC07, AC34, AC35, AC36, AC38, AC45, AC48 |
| US057 / agent-dispatch:REQ-105 | UI29 | UXAC169, UXAC170, UXAC171 | AC05, AC06, AC39, AC41, AC42, AC43, AC44, AC47 |
| US058 / agent-dispatch:REQ-106 | UI29 | UXAC172, UXAC173, UXAC174 | AC05, AC06, AC39, AC41, AC42, AC43, AC44, AC47 |
| US063 / agent-dispatch:REQ-107 | UI32 | UXAC187, UXAC188, UXAC189 | AC31, AC34, AC37, AC38, AC45, AC51, AC55, AC56, AC73, AC74 |
| US064 / agent-dispatch:REQ-108 | UI32 | UXAC190, UXAC191, UXAC192 | AC31, AC34, AC37, AC38, AC45, AC51, AC55, AC56, AC73, AC74 |

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
