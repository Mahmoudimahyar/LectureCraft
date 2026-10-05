# Shared interface, states and interaction contract — 0.8.0

This is a product contract, not an installed transport/status API. Existing canonical assessment
outcomes and publisher receipts remain unchanged. App status labels wrap verified facts; a screenshot
or a prepared file does not establish execution. This document applies to every UI flow.

## Overall screen anatomy

Desktop: global course-aware header/search, collapsible navigation, large source canvas with
stable player, one context panel. Main destinations are Study, Review, Progress, Sources; Activity
and Settings are utilities. The concept tree lives under relevant source/progress context, not
as an obligatory full-screen graph. No new calendar or sales dashboard.

Tutor has three prominent interaction choices: **Quick answer**, **Understand**, **Explain back**.
Transcript and Sources are adjacent panel tabs, not pedagogical modes. Practice opens a complete
question. Existing canonical `learn`, `assess`, `produce`, `maintain` values keep their meaning;
UI interaction kind and reply depth are separate metadata. Ordinary reading does not mandate a
quiz. A brief reply to an actual submitted answer may still contain a valid assessment.

Native source disclosure, original question visibility and known assistance are shown when
assessment matters. Opening permitted help during practice changes recorded exposure rather
than retrospectively claiming unaided performance. A UI with sources hidden cannot prove that
an existing native conversation contains no prior solution or that the learner used no external help.

## Orthogonal state dimensions

Do not flatten these into a single green Saved/Done indicator.

| Dimension | Examples of UI copy | Evidence required |
|---|---|---|
| Input persistence | Draft only; Saved on this device; Local save failed; Ready to send | Successful actual local retention; unavailable storage is not safe offline capture. |
| Transport/admission | Uploading; Waiting for complete files; Received by Brain; Request conflict | Complete matching bundle and admission receipt; remote client must verify received bytes. |
| Native work | Connection not verified; Queued; Running; Waiting for you; Permission needed; Quota wait; Completion unknown; Failed | Exact selected native run/turn state, not just process/app existence or a queue command return. |
| Visible answer | Partial response; Answer available; Source check needed; Obsolete result | Complete correlated result/message and source status. A syntactically valid response is not certified teaching accuracy. |
| Learning publication | Not assessed this exchange; Assessment pending; Awaiting course save; Saved to course; Conflicting revision | No performance record for pure help; actual writer/readback for saved records. |
| Derived view | Current; Rebuilding; Stale view; Unavailable | Declared input/version/receipt checks; a stale summary is not lost attempts. |
| Source preparation | Present/unindexed; Preparing; Suggested link; Reviewed link; Unresolved; Empty; Not recorded; Inaccessible; Historical bytes unavailable | Known inventory/source evidence and actual preparation result. |

Composite examples:
- A quick answer can be **Answer available / Not assessed this exchange**. That does not reset
  earlier learning evidence and should not produce a fake not_observed attempt.
- A submitted explanation can be **Received by Brain / Running / Assessment pending**.
- A delivered explanation may be **Answer available / Saved to course / Stale view**.
- A phone can receive a manifest but remain **Waiting for complete files** until its payload arrives.

## Submission lifecycle

Draft → explicit submit → frozen logical input ID → committed complete request → Brain admission →
exact native dispatch (only verified path) → correlated output → appropriate validated publication →
complete output bundle → client readback/display.

No per-keystroke dispatch. Double click, repeated sync or reconnect uses the same identity for the
same input. Same ID with different bytes conflicts. A new genuine answer is a new learner event.
A provider retry/regrade is not one. The learner can navigate while work runs. A late result is
recorded in Activity; it does not hijack the current slide or replace a superseding result.

Cancellation requested is distinct from terminal cancellation. Cancellation does not erase a
previously committed attempt or full input, and signing out does not guarantee cancellation.
Unknown outcomes require receipt reconciliation before retry. The UI cannot bypass native approvals,
change a global permission mode, steal locks or infer authorization from `approved: true` in a task.

## Media behavior

Start paused. Play segment seeks to one chosen bounded interval. Stop at its end by default;
Repeat is explicit. Another occurrence and whole recording have explicit labels. No silent playback
of minutes between disjoint ranges. Changing slides pauses media by default; ordinary theme/panel
changes preserve the media element and current position. Starting microphone capture pauses lecture
audio. Switching devices never autoplays. Actual seek tolerance is a measured implementation gate.

Transcript auto-follow works only with supported timing. User scroll suspends following until
Follow playback is selected. Quoting retains exact source/version/range. Untimed text has useful
line references without fabricated timestamps. Original slides and source colors remain unchanged
in both themes; any readable text alternative is a qualified derived rendition.

## Context, navigation and draft safety

A draft is pinned to the source/question it started from. Navigating to another slide does not
silently repoint the draft. The composer shows context chips; switching context is explicit and
creates the appropriate draft/turn lineage. Drawers remember the originating source, focused control,
scroll and playback time. Browser Back behaves as expected; no secret side effects on opening a view.

Routes use stable scoped identifiers, not `G:` paths, raw response text, secrets or expiring download
URLs. A route is not an authorization grant. Source access is checked before display. Concept/question
labels may repeat across courses without identity merging. Display node type and relationship meaning.

## Responsive behavior

Content-driven desktop/tablet/phone arrangements share the same actions. On narrow screens, show
one main pane with explicit Slide/Tutor/Transcript/Sources navigation and reachable media controls.
Avoid shrinking a multi-column desktop until equations are unreadable. Zoom/pan belongs to the source
canvas, while app controls reflow. Preserve drafts through rotation and panel switching. The on-screen
keyboard must not cover Send or the current error. Actions cannot require hover, tiny graph targets,
precision dragging, speech, a stylus, or a particular OS filesystem mount.

Candidate implementation test viewports: 360×800, 390×844, 768×1024, 1280×800, 1440×900. These are
proposed test fixtures, not a claim that all browsers/devices were verified or a reason to exclude
other widths. Test actual intended browser/device combinations before release.

## Appearance and motion

Three-way Light/Dark/System control; per-device override. One semantic token system defines surfaces,
text, muted text, borders, accent, focus, success, caution, failure and unassessed/uncertain states.
The most recent side-by-side mockup is the visual reference, but its illustrative content is not a
course source or implementation. Source images stay original. No forced dark inversion for PDFs.

Theme switch must not lose focus/draft, reload media, cancel work or count as learning. System setting
applies before the first visible frame where supported by the chosen implementation. Prefer small
opacity/position changes for orientation; avoid infinite shimmers, parallax, confetti and animated
mastery. Reduced motion uses direct state changes with the same information. Optional illustration
is never necessary to understand a task or result.

## Accessibility target and limits

Use WCAG 2.2 AA as the application design/test target, with selected additional usability preferences.
Normal-text contrast target 4.5:1; large text 3:1; essential nontext controls/focus 3:1 where applicable.
24 CSS px-or-spacing exceptions are the AA target-size criterion; choose 44px primary touch controls
as a product preference, not a misstatement of AA. Test text enlargement, narrow reflow, keyboard use,
visible unobscured focus, non-color status, and meaningful names. A source slide may require contained
2D scrolling; the surrounding application still reflows. No source PDF accessibility certification
is inferred from using a library or exposing a transcript field.

Tabs and modal dialogs follow WAI APG keyboard/focus patterns. Close returns focus to the invoking
control or an explicit next logical position. Use polite announcements for meaningful state changes,
not one announcement per streamed token or highlighted word. Honor OS/app reduced motion; disabling
nonessential interaction animation is an additional design choice aligned with WCAG 2.3.3 (AAA), not
an invented AA rule. Caption/transcript/figure alternatives need their own accurate content review.

## Reuse policy

Reuse existing maintained, accessible primitives and native capabilities before bespoke components.
A common library does not guarantee our integrated focus/contrast/keyboard behavior. Do not stack
several overlapping animation libraries or use graphics where a simple list/tree is more usable.
Choose a bounded viewer/player/editor/motion implementation through source/version/license review
and relevant fixture tests. No provider APIs, libraries or paid tools are installed by this spec.

References (external design guidance, not existing project facts):
- [WCAG 2.2 reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [WAI modal dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Interaction animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

### Lecture context panel
One panel, four tabs: **Tutor**, **Transcript**, **This slide**, **Questions**. Only one is visible at a time; switching tabs never unmounts the media element or clears a draft.

### Question scopes in a lecture
Three separate groups, each stating why a question is there:
1. **This slide** — the course record names this physical page. Basis shown: `exact` (page basis reviewed) or `stated` (named by the catalog, page basis not reviewed).
2. **Related concepts** — reached through shared concepts or a question-to-question relationship. Always labelled as related, never as belonging to the slide.
3. **All lecture questions** — every question whose collection belongs to this lecture, whether or not it names a slide. A question with no exact anchor is listed here with "no slide named in the course record".

A lecture with no catalogued collection shows that gap; nothing is generated to fill it.

### Question bank
Reachable from Review, from each course's lecture list and from the lecture context. Shows real totals per collection, search, filters (collection, origin, anchor state) and incremental loading with the true total always visible. No silent truncation anywhere.

### Questions without wording in the catalog
Identity, collection and rubric presence are kept. The page offers **Open original** (the authoritative file) and, when the course index relates a displayable copy to that original and the copy was verified, a **display rendition** labelled as such. Tutor-authored criteria are labelled as tutor-authored, not as the instructor's point scheme.

### Deck selection
The displayed deck of a unit is chosen from the course index's source kind and explicit references, never from file-name order or size. Other files of the unit stay listed as related sources. When the evidence conflicts the candidates are offered in a local selector and the choice is stored as app configuration.

### Evidence wording
"Shown" without its condition is not used. Each recorded demonstration states its condition: unaided, with assistance (which), after prior exposure, or conditions unknown. Only unaided, unexposed, observed responses count as recorded unaided performance.

### Tutor replies
When the tutor itemizes support, added explanation is marked quietly and course-supported text is left unmarked. No uncertainty phrase is added to supported statements.
