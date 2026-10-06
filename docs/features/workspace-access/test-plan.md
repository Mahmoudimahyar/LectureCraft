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


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | How it is verified |
|---|---|
| R1-U1, R1-U5 | Browser geometry and computed-style test on Study and a lecture at 390×844, 768×1024, 1440×900, 1920×1080 and 2560×1440 in both themes, plus enlarged text; share of characters by computed font size. Private before/after screenshots on real content with the measurements beside them. |
| R1-U6 | Browser test of the Study page content. |
| R1-U7 | Browser test: type a draft, start playback, switch theme, collapse the outline, switch tabs; draft, position and slide pixels unchanged. |

The learner's own browser zoom was not measured and is not required for these checks.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow, case and task ids are unchanged; the mapped scenarios above keep their meaning and status. The `R2-…` checks are defined in the [requirements](requirements.md). R1's rows for R1-U1 and R1-U6 are superseded where they assert a share of the window or the R1 Study content; a test that asserts "at least 80% of the width" or a fixed 1152 px cap as success is removed, not loosened.

### Logic and failure tests (necessary, never sufficient)

| Check | How the logic is verified |
|---|---|
| R2-V4 – R2-V10 | No logic-only test closes these; see the on-screen table. Component tests where they exist (pane control state, remembered width and outline state, reduced-motion flag) support the on-screen rows and replace none of them. |
| R2-B1, R2-B2 | Unit test of the identity payload (commit, asset names, profile, port, per-course generation and map revision). Unit test of the stale comparison: loaded asset names that differ from the reported ones produce the stale state; equal names do not. |
| R2-B3 | Unit test of scope resolution: an unknown course, lecture or page and an empty scope parameter each resolve to an explained state, not to an error or an empty payload. |

### On-screen verification — required for every check

A check is covered only when its on-screen row below has passing evidence, together with its logic row where one exists, on the same build. Every row is a browser observation on the built preview whose identity is recorded (R2-B1), on the fixture profile (labelled synthetic), by ordinary navigation from Study unless the row says otherwise.

| Check | What is observed on screen |
|---|---|
| R2-V4 | Browser at 390×844 and 768×1024 in both themes: exactly one pane is visible; each of the six panes is reachable from the pane control; play/pause is operable from every pane; the document's scroll width equals the viewport width. |
| R2-V5 | Browser on Study, with and without a resume point: the first content block is Resume (or its explained absence), then courses and lectures; every number equals the API's total; no progress bar, percentage, date or chart element is present unless the fixture recorded the fact it shows; thumbnails are rendered from the fixture's first page or are absent. |
| R2-V6 | Browser on Study and on a lecture at 1440×900, 1920×1080 and 2560×1440: no rendered line of running prose is longer than 80 characters; on Study the left and right margins of the content column are equal within a few pixels and the page does not scroll sideways; on the lecture page the slide is fitted to its stage (R1-U2) and R2-V1 holds. No width cap and no share of the window is asserted for either view. Whether the home margins and the reading layout read as deliberate at each size is an item of the critique (R2-V10), not a pixel assertion. |
| R2-V7 | Browser census of the app's own visible text on the Study, Lecture and Concept screens in both themes, with every size measured as rendered — the computed font size multiplied by any scale a transform or a graph zoom applies to it: reading text is 16–18 px with a line height of at least 1.45; at most a tenth of the characters is below 14 px; nothing is below 12 px; the distinct sizes are values of the declared scale and number at most seven. Left out, and nothing else: text inside a source rendering (the slide's own page image with its selectable text layer, and embedded original figures), which keeps the source's typography. The identity line, the transport, the outline, the panel and the graph labels are counted. While the token source declares no type scale and no spacing scale, the scale clause cannot be evaluated and the check stays open. |
| R2-V8 | Browser census on the same screens: the greatest depth of nested bordered containers around reading content is one; every pill-styled element is an interactive filter, a state label of the shared contract or a link to a source reference, and a count or plain fact styled as a pill fails; the computed styles of the default, hover, focus-visible and selected states differ for tabs, outline entries, range rows and buttons, and the selected state has a cue that is not colour. Rendered contrast in both themes, by accessibility scan plus sampled pairs, in addition to the token pairs: text against its background at least 4.5:1 (3:1 for large text); the focus ring, the accent on its surface and every selected-state indicator at least 3:1 against what they adjoin. The numbers of bordered containers and of pills are recorded for the critique as information; they are not a pass criterion and are compared with no earlier build. |
| R2-V9 | Browser: type a draft, start playback inside a selected range, then switch theme, collapse the outline, resize the panel, change tab and (narrow) change pane; the draft, `currentTime`, selected range, slide, tab and panel width are unchanged and the slide's pixels are identical in both themes. With reduced motion, no transition or animation has a non-zero duration. |
| R2-V10 | The measured browser rows above, plus the critique record: thirty captures (three screens × five sizes × two themes) of the preview whose identity is recorded under R2-B1, with real content kept privately; a separate reviewer pass comparing them with both reference images; a findings table with a disposition per finding. The record states "designer-reviewed" at most. Absence of the record, a reviewer identical to the implementing pass, or a claim of user approval fails the check. |
| R2-B1 | Browser: Settings shows the commit, the names of the loaded script and style assets, the profile and port, and per course the preparation generation and source-map revision, as selectable text; the values equal those of the status interface and the names of the files the page actually loaded. The identity is copied into the evidence of R2-E1. |
| R2-B2 | Browser: with a page open, the preview is switched to another build; the open page shows the one stale line with Reload; after Reload the line is gone and Settings shows the new identity; no service worker is registered. |
| R2-B3 | Browser on the fixture profile: Study says once, in words, that it shows synthetic sample data; each unresolved scope shows an explained state with a way back and no blank panel. Only for these unresolved cases the test opens an address directly, because a link that no longer resolves is the case under test. |

The critique is a judgement and is reported as one. Measurements show that a criterion was met on the captured build; they do not show that the learner likes it.
