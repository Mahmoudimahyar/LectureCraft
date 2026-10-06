# Design system direction and component behavior — 0.8.0

The user accepted the source-first screen direction and explicitly requested Light/Dark modes.
This is the current product design baseline, not implemented components, CSS or tested usability.
The [shared UI contract](ui-state-and-interaction-contract.md) and [UI decisions](ui-decisions.md)
control behavior; generated image content is not source material or an architecture requirement.

## Primary visual reference

[Light and dark workspace reference](../../assets/design/light-dark-workspace-reference.png)
shows the intended restrained blue-accent application theme and unchanged white source slide.
[Earlier source-first interaction reference](../../assets/design/source-first-layout-reference.png)
shows useful slide-dominant layout and quick-help framing; its alternate palette is not a second
simultaneously required brand. The mockups contain illustrative lecture text/timing, not verified
source links, grades, assessment accuracy or live integrations. Earlier architecture infographics
are deliberately not included as normative architecture.

## Component families to reuse

| Responsibility | Shared behavior to preserve |
|---|---|
| Shell/navigation | Four destinations, scoped search, active course, Activity and Settings; responsive focused mode. |
| Slide/source canvas | Original source fidelity, accessible controls, bounded versioned locator, zoom/focus, explicit rendition limits. |
| Player/transcript | One stable media instance, explicit clip/whole mode, pause/repeat/rate, qualified highlights and user-controlled follow. |
| Source chip / related item | Exact source/version/anchor with type/reason; no answer leakage or guessed page. |
| Tutor composer | Clear interaction choice, pinned source context, draft durability and explicit submit; no autosave dispatch. |
| Question / evidence / feedback card | Complete prompt and assistance, actual criteria, uncertainty and history; no unsupported percent mastery. |
| Dialog/drawer | Correct focus/keyboard/return semantics and small-screen full view. |
| Tree/list/chart | True typed IDs/relations, bounded expansion, nonvisual alternatives and qualified evidence. |
| Status / activity / conflict | Orthogonal states with a real next action, not duplicated banners, fake percent progress or ambiguous Saved. |
| Theme/motion controls | Light/Dark/System per device, reduced motion, original source content unchanged, no media reload. |

Prefer maintained accessible UI primitives and existing viewer/player/editor utilities. Use CSS
or a single justified motion layer where sufficient rather than stacking animation frameworks.
The package selections are in [the stack decision](../engineering/stack.md); exact dependency locks and license verification are LL002 execution outputs. No dependency is installed or certified by this baseline. The token names, not these prose
component labels, should keep semantics consistent; implementation class names are not prescribed.

Both themes need semantic surfaces, foreground/muted text, border/focus, accent and evidence states.
Error, caution, success, unassessed and uncertain must use wording/symbols as well as color. Test
real error/loading/empty/disabled/focus states, not only the polished happy screenshot.

## Selected tokens
[design-tokens.json](design-tokens.json) defines the current semantic light/dark palette, system-font typography, spacing and motion durations. These values are design inputs, not proof of rendered contrast or usability; use the shared state contract and real UI checks. No font files are included.

## Token-level verification
The offline checker measures 50 declared solid-color text/focus/border pairs using the W3C
sRGB contrast definition. It does not measure rendered interfaces, disabled states,
transparency, images, focus geometry or overall accessibility. Actual browser and device
verification remains required. References: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
and [nontext contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

### Layout (direction B)
- **Lecture workspace:** three regions — a collapsible lecture outline on the left, the slide stage in the middle, ONE tabbed context panel on the right. Collapsing the outline is the focus arrangement; there is no second layout to choose.
- **Slide stage:** the original slide is fitted inside the available height and width without distortion (contain); it never scrolls inside its own frame at 100% fit. The transport sits directly under it.
- **Transport:** one Media Chrome control hierarchy over the one media element: one primary play/pause, one timeline, one time readout, speed, volume, scope (segment or whole recording), repeat. Secondary actions (link editing, file details) live behind an accessible disclosure. Default desktop height 96–128 CSS px and reachable without scrolling the page at 1440×900, 1920×1080 and 2560×1440.
- **No timed match:** one short line with one action and optional details. No interval is invented to fill it.
- **Narrow screens:** one usable pane at a time (slide, context); controls stay reachable; readable reflow has priority over the desktop dimensions.
- **Content width:** one shared page frame with three tiers (default, wide ≥ 1280 px, extra-wide ≥ 1800 px). Collections of cards use the width; paragraphs keep a readable measure (about 60–80 characters).

### Type
- Body text starts at 16 CSS px. Ordinary secondary information is 14 px. Smaller text (never below 12 px) is reserved for sparse metadata such as keyboard hints and thumbnail numbers.
- Verification uses computed styles of rendered text, not the root font size or a scaled image.

### Study page
A "continue studying" workspace: the place to resume first, then readable course cards showing lecture units, questions available and recorded evidence. Not an administrative grid.

### Preserved
Drafts, focus, media position and original image colours survive theme, outline and panel changes. Light/Dark/System and reduced motion apply to every new surface. Tokens and component families above are reused; no second motion or styling system is introduced.


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected its visual design (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only. The visual design is an OPEN product failure: earlier LOCAL_TESTED results and the R1 receipts do not cover the checks named `R2-…`, and no measurement alone closes them.

### What R2 supersedes in R1, and why
- **"Layout (direction B)" as a look.** The three-region arrangement (outline · slide stage · one context panel) is kept. The visual treatment that was built for it is rejected by the learner who used it. The owner instruction does not list the learner's reasons; it gives the remedy — not an admin-console card wall, comfortable 16–18 px reading text with restrained metadata, a coherent type and spacing scale, fewer nested borders and pills, deliberate states and balanced pane proportions — and this amendment takes that remedy as its brief without attributing more to the learner. R1's geometry checks were reported as passing on the build the learner rejected, so passing geometry is no longer evidence that the design is acceptable.
- **"Content width: one shared page frame with three tiers … collections of cards use the width"** and the R1-U1 clause "card collections at least 80% of the width". Superseded by separate appearance decisions for the home and the reading views (R2-V6). Neither a 1152 px cap nor a window filled to 99% is a success criterion.
- **"Study page … readable course cards showing lecture units, questions available and recorded evidence."** Superseded by R2-V5: Resume first, then course and lecture browsing. Counts stay real; nothing that looks like progress is drawn unless a recorded fact stands behind it.
- **The four-tab context panel** of R1 is superseded by five named destinations (R2-V3); see the [shared contract](ui-state-and-interaction-contract.md).

R1-U2 (slide fitted, undistorted, no inner scrollbar), R1-U3 (one transport), R1-U5 (type floor) and R1-U7 (preservation) stay in force as lower bounds; R2 adds to them. R1-U3's height bound survives and is now tied to a named element: the **transport bar** (below) is at most 128 CSS px tall on desktop and inside the window without page scrolling; the 96 px lower figure of R1 is no longer a requirement. The **range list** is a separate element and is not part of that height. R1-U4's single no-match line is replaced by the six states of R2-T9; its rule that no interval is invented stays.

### Direction
The approved references are the brief: the [light and dark workspace reference](../../assets/design/light-dark-workspace-reference.png) (primary: palette, surfaces, compact transport, unchanged white slide in both themes) and the [source-first layout reference](../../assets/design/source-first-layout-reference.png) (interaction: collapsible navigator, dominant slide, "play this slide's recording" with its range, tutor panel with comfortable reading text). Their [README](../../assets/design/README.md) applies: labels, numbers and timings in the images are illustrative, and this specification wins where they differ (for example the images show "Slide 24 of 91" and three tabs; R2-S6 and R2-V3 govern the real wording and tabs).

A refined, source-first academic workspace: light neutral surfaces, dark graphite surfaces, ONE restrained accent (the blue of the primary reference; the green of the earlier reference is not a second brand), clear typography and layered space. Depth comes from surface tone and spacing first; a border is drawn only where two regions of the same tone meet or a control needs an edge. The original slide is the one visually loud object on the lecture page. It is not an admin console.

### Lecture workspace — the reading view (R2-V1, R2-V2, R2-V3)
- **Collapsible lecture outline** on the left: one action collapses it, the freed width goes to the slide, and the choice is remembered on the device.
- **Large original-source canvas**: at default pane sizes the stage is at least half of the workspace width at 1440×900, 1920×1080 and 2560×1440, and the slide is the largest single object on the page.
- **ONE compact media control system** attached to the canvas, in two named parts. The **transport bar**: one play/pause, one timeline, one time readout, speed, volume, scope and Repeat, plus ONE line for the selected range (start–end, what it is, and "range i of k" with previous/next when the slide has several). It is at most 128 CSS px tall on desktop. The **range list**: every range of the selected slide as a row, opened from the bar as a disclosure that lies over the stage; it does not grow the bar, shrink the slide, scroll the page or unmount the player, and it is fully usable from the keyboard. No tab, drawer or card renders a second player or a second set of transport buttons.
- **A RESIZABLE context panel** with five obvious, text-labelled destinations in this order: **Tutor · Questions · Concepts · Transcript · Sources**. It is resized by dragging its edge and from the keyboard, within bounds that keep the stage dominant, and its width is remembered on the device. Exact states are in the shared contract.

### Study home — the browsing view (R2-V5, R2-V6)
The home page answers two questions in this order: *where was I?* (Resume: the real course, lecture and page last opened, one primary action) and *what is there?* (the configured courses and their lectures, with real titles, real thumbnails rendered from the real first page, or none). It shows no invented progress, dates, facts or decorative charts. Its width is its own decision: a deliberate, centred browsing measure with balanced margins on wide screens. The reading view is a separate decision: it is laid out for the slide (R2-V1) and may use the window or keep outer margins on a very wide screen; only running prose is held to a measure. No test asserts a width cap or a share of the window for either view.

### Type, spacing and measure (R2-V7)
- Reading text — tutor replies, transcript lines, question prompts and options, concept and evidence detail, source excerpts, the composer — is 16–18 CSS px with a line height of at least 1.45.
- Metadata is smaller and restrained: 12–14 px, never below 12 px, and by character count at most a tenth of the visible text of the Study, Lecture and Concept screens is below 14 px.
- One type scale and one spacing scale, declared once in the token source. Every font size and every gap between regions on those screens is a value of the declared scale; a screen uses at most seven sizes of it. R2 fixes the bounds above, not the scale's values. The token source declares a base size and a spacing list today and no type scale; declaring the scale is part of the visual implementation, and until it exists this clause cannot be evaluated and R2-V7 is open, not passed.
- Sizes are taken as rendered: where a zoom or a transform scales text (the concept graph), the size the learner sees is what counts, not the declared font size.
- These rules cover the app's own text. Text inside a source rendering — the slide's page image with its selectable text layer, and embedded original figures — keeps the source's own typography and is the only text left out of the census; the identity line, the transport, the outline, the panel and graph labels are in it.
- Running prose keeps a bounded measure: no rendered line of prose is longer than 80 characters (about 45–80 is the target).

### Surfaces, borders, pills and states (R2-V8)
- Reading content sits inside at most ONE bordered container. A bordered card inside a bordered card inside a bordered panel is a defect.
- A pill or chip is used only for a real state, a filter or a source reference the learner can act on; counts and plain facts are text, not pills. These two rules are the criterion. The numbers of bordered containers and pills on each screen are recorded for the critique as information; no comparison with the R1 build is a pass criterion, because no R1 count was recorded and the fixture content changes under R2.
- Every interactive control has four visibly different states: default, hover, keyboard focus (a visible ring that is not obscured) and active/selected. Selection is never shown by colour alone.
- Meaningful contrast as rendered, in both themes: text at least 4.5:1 against its background (3:1 for large text); the accent on its surface, the focus ring and every selected-state indicator at least 3:1 against what they adjoin. The declared token pairs are the first check and the rendered page is the second; a new accent or state colour is added to the declared pairs.

### Narrow screens (R2-V4)
At 390×844 and 768×1024 the workspace shows ONE focused pane at a time — Slide, Tutor, Questions, Concepts, Transcript or Sources — chosen from an explicit pane control, with the one transport reachable from every pane. It never renders several compressed columns, and the page never scrolls sideways.

### Preserved (R2-V9)
The slide keeps its original colours in both themes. A draft, the playback position, the selected range, the selected slide, the selected tab and the panel width survive a theme change, an outline collapse, a panel resize, a tab change and a pane change on narrow screens. With reduced motion every transition becomes a direct state change carrying the same information.

### Acceptance (R2-V10)
Both parts are required; neither substitutes for the other.
1. **Measured checks** in a real browser on the built preview whose identity is recorded (R2-B1): the proportions, counts, computed type sizes, measure, nesting depth and state differences above, at 1440×900, 1920×1080, 2560×1440, 768×1024 (tablet) and 390×844 (phone), in Light and in Dark.
2. **A recorded independent visual critique** of the Study, Lecture and Concept screens at those five sizes in both themes (thirty captures of the actual preview with real content, kept privately), made in a separate pass by a reviewer other than the implementing pass, with both reference images beside them. It judges hierarchy, reading comfort, proportions, density, alignment and resemblance to the approved direction; each finding is recorded with its disposition (fixed in code, accepted with a reason, or open). Poor results are answered by changing code, never by regenerating screenshots.

The strongest label this process can produce is **designer-reviewed**. **User-approved** is a statement only the learner can make; no report, check or receipt may state it on the learner's behalf.

### Not success criteria
A fixed content cap (1152 px or any other), a share of the window (99% or any other), the number of screenshots, controls merely fitting inside the viewport, a count of borders or pills relative to an earlier build, or a regenerated screenshot baseline.

### Whether the measures can hold together
The thresholds above were checked for joint feasibility by arithmetic only, not on a rendered build. For example at 1440 px wide, an outline of about 240 px and a context panel of about 420 px (wide enough for five text-labelled tabs) leave a stage of about 780 px, which is 54% of the workspace; a transport bar of at most 128 px under a slide fitted to that stage fits a 900 px window. These figures illustrate feasibility and are not requirements. If a rendered build shows two measures to conflict, the conflict is recorded as a decision with its reason; no threshold is loosened silently to make a run pass.

The ten checks are defined with their stories in the [workspace-access](../features/workspace-access/requirements.md) and [evidence-alignment](../features/evidence-alignment/requirements.md) packets. Token values, if changed for this direction, change in [design-tokens.json](design-tokens.json) and must keep the declared contrast pairs; R2 itself changes no token.
