# tutoring — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US021 / tutoring:REQ-101 | UI11 | UXAC061, UXAC062, UXAC063 | AC18, AC39, AC75 |
| US022 / tutoring:REQ-102 | UI11 | UXAC064, UXAC065, UXAC066 | AC18, AC39, AC75 |
| US023 / tutoring:REQ-103 | UI12 | UXAC067, UXAC068, UXAC069 | AC18, AC24, AC65, AC75 |
| US024 / tutoring:REQ-104 | UI12 | UXAC070, UXAC071, UXAC072 | AC18, AC24, AC65, AC75 |
| US025 / tutoring:REQ-105 | UI13 | UXAC073, UXAC074, UXAC075 | AC19, AC20, AC21, AC22, AC23, AC49, AC50, AC51, AC61, AC62 |
| US026 / tutoring:REQ-106 | UI13 | UXAC076, UXAC077, UXAC078 | AC19, AC20, AC21, AC22, AC23, AC49, AC50, AC51, AC61, AC62 |
| US027 / tutoring:REQ-107 | UI14 | UXAC079, UXAC080, UXAC081 | AC19, AC21, AC63, AC64 |
| US028 / tutoring:REQ-108 | UI14 | UXAC082, UXAC083, UXAC084 | AC19, AC21, AC63, AC64 |
| US029 / tutoring:REQ-109 | UI15 | UXAC085, UXAC086, UXAC087 | AC20, AC21, AC27 |
| US030 / tutoring:REQ-110 | UI15 | UXAC088, UXAC089, UXAC090 | AC20, AC21, AC27 |
| US031 / tutoring:REQ-111 | UI16 | UXAC091, UXAC092, UXAC093 | AC24, AC25, AC40, AC65, AC66 |
| US032 / tutoring:REQ-112 | UI16 | UXAC094, UXAC095, UXAC096 | AC24, AC25, AC40, AC65, AC66 |
| US033 / tutoring:REQ-113 | UI17 | UXAC097, UXAC098, UXAC099 | AC22, AC29, AC30, AC52, AC54, AC69 |
| US034 / tutoring:REQ-114 | UI17 | UXAC100, UXAC101, UXAC102 | AC22, AC29, AC30, AC52, AC54, AC69 |

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
| R1-P1–P4 | Unit tests on synthetic policy files and a synthetic projection: inclusion, exclusion with reason, stale hash, missing required area, restriction that cannot be excluded, applicability by course and action. Consumer test through the labelled local double: the prompt and the context receipt list the clauses. Private read-only build against the current real files, recorded as ids, spans and hashes only. |
| R1-P5 | Parser tests for segments (downgrade, malformed, absent); component check of the marker. |
| R1-P6 | No live call; the pilot ledger file's hash is recorded before and after the run. |
