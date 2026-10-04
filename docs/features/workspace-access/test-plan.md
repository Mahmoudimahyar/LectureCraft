# workspace-access — intended verification, 0.8.0

Stable plan, not a live result report. Exact cases below are generated from the current UI baseline.
Put future command logs/screenshots/results outside this approved feature-spec directory. A planned
test does not need to exist before TDD, but release acceptance requires actual executed evidence.

## Mapped scenarios

| Story / requirement | Flow | UI case IDs | Existing workflow coverage |
|---|---|---|---|
| US001 / workspace-access:REQ-101 | UI01 | UXAC001, UXAC002, UXAC003 | AC05, AC06, AC39, AC41, AC43, AC47 |
| US002 / workspace-access:REQ-102 | UI01 | UXAC004, UXAC005, UXAC006 | AC05, AC06, AC39, AC41, AC43, AC47 |
| US003 / workspace-access:REQ-103 | UI02 | UXAC007, UXAC008, UXAC009 | AC32, AC33, AC34, AC47 |
| US004 / workspace-access:REQ-104 | UI02 | UXAC010, UXAC011, UXAC012 | AC32, AC33, AC34, AC47 |
| US005 / workspace-access:REQ-105 | UI03 | UXAC013, UXAC014, UXAC015 | AC09, AC13, AC74 |
| US006 / workspace-access:REQ-106 | UI03 | UXAC016, UXAC017, UXAC018 | AC09, AC13, AC74 |
| US007 / workspace-access:REQ-107 | UI04 | UXAC019, UXAC020, UXAC021 | AC17, AC18, AC39, AC75 |
| US008 / workspace-access:REQ-108 | UI04 | UXAC022, UXAC023, UXAC024 | AC17, AC18, AC39, AC75 |
| US009 / workspace-access:REQ-109 | UI05 | UXAC025, UXAC026, UXAC027 | AC09, AC10, AC46, AC57, AC74 |
| US010 / workspace-access:REQ-110 | UI05 | UXAC028, UXAC029, UXAC030 | AC09, AC10, AC46, AC57, AC74 |
| US051 / workspace-access:REQ-111 | UI26 | UXAC151, UXAC152, UXAC153 | AC03, AC33, AC62 |
| US052 / workspace-access:REQ-112 | UI26 | UXAC154, UXAC155, UXAC156 | AC03, AC33, AC62 |
| US055 / workspace-access:REQ-113 | UI28 | UXAC163, UXAC164, UXAC165 | AC33 |
| US056 / workspace-access:REQ-114 | UI28 | UXAC166, UXAC167, UXAC168 | AC33 |
| US059 / workspace-access:REQ-115 | UI30 | UXAC175, UXAC176, UXAC177 | AC38, AC49, AC64, AC73 |
| US060 / workspace-access:REQ-116 | UI30 | UXAC178, UXAC179, UXAC180 | AC38, AC49, AC64, AC73 |

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
