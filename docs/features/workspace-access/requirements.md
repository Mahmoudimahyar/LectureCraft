# Current UI requirement index — workspace-access, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| workspace-access:REQ-101 | US001 | Connect without reorganizing | UI01 |
| workspace-access:REQ-102 | US002 | Understand permissions | UI01 |
| workspace-access:REQ-103 | US003 | Use another device | UI02 |
| workspace-access:REQ-104 | US004 | Sign out safely | UI02 |
| workspace-access:REQ-105 | US005 | See every lecture | UI03 |
| workspace-access:REQ-106 | US006 | Resume the right lecture | UI03 |
| workspace-access:REQ-107 | US007 | Find relevant material | UI04 |
| workspace-access:REQ-108 | US008 | Return after exploring | UI04 |
| workspace-access:REQ-109 | US009 | Add without duplication | UI05 |
| workspace-access:REQ-110 | US010 | Know preparation status | UI05 |
| workspace-access:REQ-111 | US051 | Continue naturally | UI26 |
| workspace-access:REQ-112 | US052 | Resolve conflicts without losing responses | UI26 |
| workspace-access:REQ-113 | US055 | Study comfortably day and night | UI28 |
| workspace-access:REQ-114 | US056 | Preserve sources and focus when theming | UI28 |
| workspace-access:REQ-115 | US059 | Take my study history with me | UI30 |
| workspace-access:REQ-116 | US060 | Control retention honestly | UI30 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Portable course and source access — draft

The user selected Google Drive materials and cross-device use. Existing P05 folder IDs and
local source references are evidence to seed a resolver, not proof a portable UI is running.

| Requirement | Observable outcome / failure boundary |
|---|---|
| access:REQ-001 | Open configured course/lecture/source views on an approved second device without a G: mount. |
| access:REQ-002 | Resolve course/source/version/anchor to the expected authorized object and rendition. Same-name backup/candidate folders never win accidentally. |
| storage:REQ-001 | Preserve original identity and requested version through moves/renames; replacement or inaccessible old content becomes explicit unavailable/stale state. |
| storage:REQ-002 | Play and seek authorized original media using a verified retrieval path, without publishing signed URLs or credentials as durable identifiers. |
| storage:REQ-003 | Show all-lecture inventory states independent of source-index coverage. Missing/empty/unrecorded is not classified as still-processing forever. |
| storage:REQ-004 | Limit data to selected sources and approved processing. Permission changes are checked again at use; source content cannot expand tool authority. |
| storage:REQ-005 | Keep response staging, UI resume and assessed course evidence separate; label canonical receipt and derived-view freshness independently. |

Potential implementation: official Drive client/HTTP read primitives, an authenticated portable
resolver and version-keyed cached renditions. Runtime/provider/storage library choice is not made
here. Credential/account access and hosted material transfer require approval. No new app account
or Drive file mutation is created by defining this feature. See [P2](../../project/probe-and-acceptance-plan.md).

## Distinguish actor access and observed completeness
A Drive connector usable by one native agent does not establish a browser/companion OAuth client
or its write scope. Missing requested metadata stays unknown. Multiple same-name items need
content/request identities; a locally complete bundle is not remote delivery/freshness proof.
Filesystem notification is a rescan hint, not evidence that every file has synchronized.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | Requirement (stories) |
|---|---|
| R1-U1 | Every page uses the shared page frame; at 1920 px and 2560 px wide the content region uses the window (card collections at least 80% of the width beside navigation) while paragraphs keep a readable measure (US055, US005). |
| R1-U5 | Body text is at least 16 px; at most a small share of visible text is below 14 px; nothing is below 12 px (US055). |
| R1-U6 | The Study page leads with where to continue and shows readable course cards including questions available (US005, US006). |
| R1-U7 | Drafts, focus, media position and source colours survive theme, outline and panel changes (US055, US056). |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only.

The visual design is REOPENED as an open product failure despite green receipts: the learner saw the current build and rejects it. Earlier LOCAL_TESTED results and R1 receipts of the affected tasks do not cover the checks named `R2-…`. The direction is in the [design system](../../project/design-system.md); R2-V1 to R2-V3 (lecture workspace) are defined in the [evidence-alignment packet](../evidence-alignment/requirements.md).

**Superseded R1 sentences.** R1-U1's clause "card collections at least 80% of the width beside navigation" is withdrawn: a share of the window is not a success criterion, and neither is a 1152 px cap (R2-V6). R1-U6's "readable course cards including questions available" is replaced by R2-V5. R1-U5 and R1-U7 stay in force and are extended by R2-V7 and R2-V9. R1's test plan accepted screenshots "together with the measured geometry and a named human review"; R2-V10 replaces that with measured checks AND a recorded independent critique against the approved references.

### Visual design (R2-V) — flows UI03, UI06, UI28

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-V4 | On narrow screens (390×844 and 768×1024) the lecture workspace shows one focused pane at a time — Slide, Tutor, Questions, Concepts, Transcript or Sources — from an explicit pane control, with the one transport reachable from every pane and no sideways page scroll (US011, US055 · UI06, UI28). | Several squeezed columns on a phone or tablet, a pane that cannot be reached, or having to leave the pane to pause playback. |
| R2-V5 | The Study home leads with Resume (the real course, lecture and page last opened, one primary action; when there is none it says so) and then offers course and lecture browsing with real titles and real thumbnails or none. It shows no invented progress, dates, facts or decorative charts; every number is a real total (US005, US006 · UI03). | Having to hunt for where to continue; a progress bar, percentage, date or chart nobody recorded; a placeholder picture posing as a slide. |
| R2-V6 | Appearance is decided separately for the home and the reading views. Home: a deliberate, centred browsing measure with balanced margins on wide screens. Reading view: laid out for the slide (R2-V1), free to use the window or to keep outer margins on a very wide screen. In both, no rendered line of running prose is longer than 80 characters. Neither a width cap (1152 px or any other) nor a share of the window (99% or any other) is a success criterion or is asserted by any test; whether a layout reads as deliberate is judged in the critique of R2-V10 (US055, US011 · UI03, UI06, UI28). | Text lines that run across a wide monitor, a home page stretched into wide empty strips or squeezed into a narrow column with dead margins, or a lecture page whose slide stays small while space around it is unused. |
| R2-V7 | Reading text is 16–18 CSS px with line height at least 1.45; metadata is 12–14 px, never below 12 px, and at most a tenth of visible characters on the Study, Lecture and Concept screens is below 14 px. One type scale and one spacing scale, declared in the token source: every size on those screens is a value of the declared scale and a screen uses at most seven sizes. Sizes are taken as rendered (after any zoom or transform, so graph labels count at the size the learner sees). This applies to the app's own text; text inside a source rendering — the slide's page image with its selectable text layer, and embedded original figures — keeps the source's typography and is the only text left out (US055 · UI28). | Squinting at tutor replies, transcript or question text; a page where most text is small grey metadata; sizes and gaps that look arbitrary from block to block. |
| R2-V8 | Fewer nested borders and pills, stated absolutely: reading content sits in at most one bordered container; a pill is used only for a state, a filter or an actionable source reference, never for a count or a plain fact. Every control has distinct default, hover, keyboard-focus and active or selected states, and selection is not shown by colour alone. The accent, the focus ring, the selected-state indicators and all text keep meaningful contrast as rendered in both themes: at least 4.5:1 for text (3:1 for large text) and 3:1 for non-text indicators against what they adjoin. Counts of borders and pills are recorded for the critique and are not compared with an earlier build as a criterion (US055 · UI28). | Boxes inside boxes inside boxes, rows of look-alike pills, not being able to tell which tab, slide or range is selected, losing the focus ring, or pale text and a selected state that barely differ from their surroundings. |
| R2-V9 | The slide keeps its original colours in both themes. A draft, the playback position, the selected range, slide and tab and the panel width survive a theme change, an outline collapse, a panel resize, a tab change and a pane change. Reduced motion turns every transition into a direct state change with the same information (US055, US056 · UI28, UI06, UI07). | A slide tinted or inverted in Dark; typed text, the place in the recording or the panel width lost after switching theme or pane; animation that continues with reduced motion set. |
| R2-V10 | Acceptance needs BOTH measured checks AND a recorded independent visual critique of the Study, Lecture and Concept screens against the two approved references at 1440×900, 1920×1080, 2560×1440, 768×1024 and 390×844 in Light and Dark, made by a reviewer other than the implementing pass, with every finding dispositioned. Its strongest result is "designer-reviewed"; "user-approved" is recorded only when the learner says so (US055, US056 · UI28). | A report calling the design approved or fixed when the learner has not said so; screenshots that were regenerated but look the same; a critique with no findings and no comparison with the references. |

### Build and data identity (R2-B) — flows UI03, UI05, screen SC13

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-B1 | The app states its own identity as readable, copyable text in Settings: the commit of the build, the names of the loaded script and style assets, the profile and port of the Brain, and for each course the preparation generation and source-map revision in use — the preparation status the learner is otherwise shown in UI05. The Brain reports the same over its status interface (US010 · UI05, SC13). | Not being able to tell whether the page in front of them is the build a report describes; a report naming a build that Settings does not show. |
| R2-B2 | A stale page is detected and said: when the loaded assets do not belong to the build the Brain now serves, one line says so and offers Reload. No service worker or cache keeps an old shell silently (US055 · UI28, SC13). | Still seeing the old interface after an update with nothing saying so; "fixed" changes that never appear in their own browser. |
| R2-B3 | The data in view is identified: a profile that is not the learner's real courses says once on Study that it shows synthetic sample data, and a scope that resolves to nothing (unknown course, lecture, page, or an empty scope parameter) shows an explained state with a way back (US005, US010 · UI03, UI05). | Sample courses mistaken for their own, or a blank panel after following a link. |

R2-T12 (per-course stage, coverage and backlog) and R2-S10 (raw and instructional denominators) are defined in the evidence-alignment packet and are shown in the preparation coverage of UI05.
