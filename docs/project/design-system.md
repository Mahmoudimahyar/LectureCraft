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
