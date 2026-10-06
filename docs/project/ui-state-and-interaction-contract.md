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


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only. The behaviours below are OPEN product failures: earlier LOCAL_TESTED results and R1 receipts do not cover the checks named `R2-…`. Direction and measures are in the [design system](design-system.md); data shapes in the [interface contracts](../engineering/interface-contracts.md).

### What R2 supersedes in R1, and why
- **"One panel, four tabs: Tutor, Transcript, This slide, Questions."** Superseded by the five destinations below. The learner could not find the concept views or the sources from the lecture, and "This slide" hid three different things behind one label.
- **"A question with no exact anchor is listed here with 'no slide named in the course record'."** That sentence is no longer an end state. The question stays listed, and it now carries one of the anchor states below; "no slide named" alone told the learner nothing they could act on.
- **The R1 no-timed-match line** ("Whole recording · no timing for this slide") used one sentence for every cause. Superseded by the six states below.
- **Concept access.** The 0.8 sentence "The concept tree lives under relevant source/progress context, not as an obligatory full-screen graph" stays true in that no graph is obligatory; R1's placement of the outline as a page under Progress is superseded as the *only* ordinary way in, because the learner did not discover it there.

### Lecture context panel (R2-V3, R2-V9)
- One panel, five text-labelled tabs in this order: **Tutor**, **Questions**, **Concepts**, **Transcript**, **Sources**. Each is reachable with one visible control at every desktop size; none is moved into an overflow menu. Facts about the selected slide that R1 kept in "This slide" now appear where they belong: its identity line at the canvas, its recording ranges at the transport, and a **This slide** scope inside Questions and inside Concepts.
- The panel is resizable: a draggable edge that is also a focusable separator (arrow keys change the width in steps, Home/End go to the bounds, the current value is announced). Bounds keep the stage at no less than 40% of the workspace width. The width is remembered per device and restored after reload.
- Resizing, collapsing the outline, switching tabs, changing theme and changing the focused pane on a narrow screen never unmount the media element, never clear or re-point a draft, and never lose the transcript or list scroll position.
- Narrow screens: one focused pane at a time (Slide, Tutor, Questions, Concepts, Transcript, Sources) from an explicit pane control; the transport stays reachable from every pane (R2-V4).

### Slide identity line (R2-S2, R2-S3, R2-S6)
The canvas states what is known, in this form and nothing stronger:

| Known | Shown |
|---|---|
| Physical page only | `PDF page 23 of 91` |
| Page belongs to a build sequence | `PDF page 23 of 91 · build 2 of 3` |
| Page repeats the page before it and adds nothing | `PDF page 24 of 91 · duplicate of page 23` (never "build") |
| A printed number is established on this page itself | the above plus `Slide 17`, with "printed on the page" as its basis on request |
| The source map holds a recorded match between this page and a slide of the unit's PowerPoint file | the above plus `Slide 17 (PowerPoint)`, with the basis and state of the match on request |
| Both exist and differ | both, each named by its kind |
| A PowerPoint file exists in the unit but no match is recorded for this page | nothing is added |
| Several slides on one handout page | `PDF page 5 of 12 · slide region 2 of 4` |
| Grouping uncertain | the page alone, with "grouping not established" in the details |

"Slide N" is never derived from the page index, and a recorded match is never ordinal equality: that a PowerPoint file has a seventeenth slide says nothing about PDF page 17. A PDF-only inferred group never shows a PowerPoint number. A PDF page label, when the file has one, is shown as a label and never used as the index. Previous/next move through pages; within a build sequence the control says so, and **Next content** jumps to the next page whose role is not structural.

### Content role of a page (R2-S7, R2-S8, R2-S9)
Each page shows one role — instructional, worked example or question, objectives or summary, structural (title or section), administrative, blank, mixed, unknown — with how it was established (generated, agent-reviewed, human-confirmed) and a control to correct it. "Structural page" below and in the checks means a page whose role is structural, administrative or blank; objectives, summary and unknown-role pages behave as ordinary content. On a structural page the workspace shows no prompt to explain back, no generated practice, no "no questions for this slide", no "no matching recording" and no empty concept branch; it offers **Next content** and the whole-lecture lists instead. A page that is only a figure or an equation is never treated as structural or blank because its text is sparse. Speech that is supported over a title page stays listed there, labelled as discussion of the topic and not as evidence of what was displayed.

### Recording ranges at the transport (R2-V2, R2-T7 – R2-T11)
- Two elements. The **transport bar** carries the controls and ONE line for the selected range: start–end times, what it is, and "range i of k" with previous/next when the slide has several. The **range list** shows every range of the selected slide as a row and opens from the bar as a disclosure over the stage; opening it never grows the bar (at most 128 CSS px on desktop), shrinks the slide, scrolls the page or adds a second player, and it is usable from the keyboard.
- Each row of the range list: start–end times, the recording, what it is (**suggestion** with its method, **reviewed**, or **entered by you**), and whether it applies to this page or to the whole build group. Ranges are shown without the learner having to confirm each one. A suggestion is never worded or styled as confirmed, and a suggestion built from superseded inputs (an older transcription, text alignment, grouping or method version) is not shown as current.
- Separate visits are separate rows. Nothing is drawn between them, and no range is produced by dividing the recording among slides.
- Three independent qualities are available on request and never merged into one figure: timestamp quality (acoustic), association quality (is this talk about this slide), and group-mapping quality (is this page correctly grouped).
- A range says that a slide was **discussed** during it. It says the slide was **shown** only where video frames of that recording were visible and inspected for that interval.
- Selecting a row moves the one player to its start and plays to its end, then stops. **Repeat** loops the range; **Whole recording** removes the bounds. Both are explicit and visible.
- When there is no range, exactly one of six lines is shown, each with at most one action and each produced by its own cause:

| State | Meaning | Action offered |
|---|---|---|
| Not discussed (searched) | the whole recording was processed and matched, and no talk about this slide was found | Open whole recording |
| Audio not processed yet | this recording has no timing yet; or only the stated part of it has, and nothing for this slide was found in that part | Open whole recording |
| Not matched yet | the recording has timing, but slide matching has not run on it with the current inputs; the cause is stated — not run yet, inputs changed since it ran, or no adequate matching method is available | Open whole recording |
| Ambiguous | several candidates, none good enough to show as the range | Show candidates |
| Recording unavailable | no recording exists or it cannot be read | none (the reason is stated) |
| Structural page | no recording range is expected for a title, section, administrative or blank page, and none was found | Next content |

A structural page is matched like any other page. When talk over it is supported, that range is shown (labelled as discussion of the topic) and the structural line is not.

### Transcript tab (R2-T3, R2-T4)
The course transcript and the generated speech text are two labelled things. A line of the course transcript shows a time only when a validated text-alignment mapping supports it; other lines show none. Selecting a timed line seeks the one player. Generated text states the window it covers and "generated, not reviewed".

### Question scopes and anchor states (R2-Q3, R2-Q5 – R2-Q8)
The Questions tab has three lists, each with its count in the heading: **This slide**, **Related concepts**, **All lecture questions**. The count equals the rows listed; All lecture questions equals the catalogued total of the lecture. Every row carries one basis label:

| Label | Meaning |
|---|---|
| Exact | a reviewed anchor of the course record names this page |
| Stated | the course record names this page; its page basis is not reviewed |
| Suggested link | an inferred candidate anchor: its supporting page or region as a link, "supports n of m criteria" with the criteria named (or the part of the prompt, where no criteria are catalogued), its rationale, and either "not yet checked" or "checked by a second pass" |
| Concept-related | reached through a shared concept or a question relation; not a claim about this slide |
| Inspected, no supporting page found | candidates were proposed for this question and the checking pass rejected them all; its reason is stated |
| No suggested link | no candidate is recorded for this question, with the recorded reason: none produced for this course yet, none recorded for this question, or made for an earlier version. The line does not say whether the question was examined, because the record does not |

A suggested link is rendered on the question's card wherever the card appears; data that exists only in a file is not a link. Every suggested link says which criteria it supports and whether that is in part; none says that a slide teaches the whole answer, also when all criteria are listed. A candidate the checking pass rejected is never shown as a link. A suggested link offers **Accept** and **Reject**: either is the learner's own local, versioned record — an accepted link reads "confirmed by you", a rejected one is no longer shown as a link and stays in the history — and regenerating the suggestions does not undo it. "Checked by a second pass" is agent work and is never worded as confirmed. In a build group each row says whether its support is **on this build**, **elsewhere in this sequence** (naming the build) or **group-level**. A source-page or build link on a question card opens that exact page of that exact source version and keeps the draft; Back returns. A structural page shows no forced This-slide list and still offers All lecture questions.

### Concepts (R2-C1 – R2-C11)
- Two ordinary ways in besides Progress: **Concept map** in every course header, and the **Concepts** tab of the lecture workspace.
- One scope control: **Course · Lecture · This slide**. The heading states the scope and how many concepts, skills and questions it holds. Inside a build group, This slide lists each entry once and says where its support is — **on this build**, **elsewhere in this sequence** (naming the build) or **group-level** — exactly as the Questions tab does; something first shown on a later build is never presented as shown on an earlier one.
- Two presentations of the same model with one shared selection: a hierarchy/outline (the keyboard-usable alternative; always available) and a graph of the selected node's neighbourhood. The graph opens grouped at topic level and expands on demand; it never draws every node at once. Its labels are at least 12 CSS px as rendered in the default view, after the graph's own zoom; the default view does not shrink below that to fit more, and what does not fit is reached by panning.
- A view built from older inputs than the current ones says so in one line and offers Refresh (R2-C11).
- Three edge families are told apart by label and line style, with a legend: assessment (question → criterion → concept or skill), source (taught or supported on a page), and prerequisite/overlap between concepts or questions.
- Selecting a node opens **Sources**, **Questions** and **Evidence** for it.
- Evidence wording uses five different states and never collapses them: **Unknown**, **Not applicable**, **Not separately observed**, **Assisted** (with the kind of assistance), **Independent**. Prior exposure alone is shown as prior exposure, not as assistance. No mastery label, no probability. A percentage appears only beside its explicit unique denominator and conditions; unknown is never drawn as zero.

### Build and data identity (R2-B1 – R2-B3)
Settings shows, as text the learner can read and copy: application build (commit and the names of the loaded script and style assets), the profile and port of the Brain it is talking to, and for each course the preparation generation and source-map revision in use. When the loaded page does not belong to the build the Brain now serves, one line says so and offers Reload. When the profile is not the learner's real courses, the Study page says once, in words, that it is showing synthetic sample data. A scope that resolves to nothing (an unknown course, lecture, page or an empty scope parameter) shows an explained state with a way back, never a blank panel.

### Test viewports
The candidate list of the 0.8 text is extended for these checks to 1440×900, 1920×1080, 2560×1440, 768×1024 and 390×844, each in Light and Dark.
