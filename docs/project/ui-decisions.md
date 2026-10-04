# UI decisions — design baseline 0.8.0

The user asked to finalize flows and stories. This document makes concrete interaction decisions
so implementers do not invent them during coding. User-confirmed goals are separated from new
designer-selected defaults. No live installation, native request, account change, spending,
canonical-write activation, product build or test run is authorized by this file.

## Source and precedence

| Basis | Meaning |
|---|---|
| Current user decisions | One learner, all lectures, Drive-backed material, always-on PC, native OpenAI/ChatGPT preference with exact product honest, full prospective Q/A, controlled continuous workflows. |
| Later user preference answers | Time-adaptive help: brief direct answer when rushed, deeper explanation/diagnosis when desired. Receiving an answer does not establish understanding; it also does not prove ignorance. Minimal relevant permitted context and no added spending without approval were accepted principles. Exact grants, retention durations and operating limits still need implementation configuration. |
| Accepted visual direction | Large slide, stable player, context panel, coherent responsive design. Light, Dark and System now form the appearance requirement. The last light/dark mockup is the primary visual reference; diagrams/text/timestamps inside it are illustrative, not real course evidence. |
| Existing system reports (P05/P06) | Preserve actual catalog/attempt/writer boundaries and their known limits. Reports are not new live validation. |
| This UI baseline | Defines defaults below for review/implementation; these are design decisions, not claimed observed behavior. |

**Current UI authority:** `experience-spec.json` owns flow/story/acceptance IDs, routes and behavior
records. Markdown catalogs and feature packets render that specification. Shared state and
interaction rules live in `ui-state-and-interaction-contract.md`; all planned checks remain NOT_RUN.
Existing academic schemas, source ownership and memory/workflow contracts are not replaced.
Historical research reports remain dated evidence. The architecture infographics generated earlier
are not authoritative: any implication of automatic mastery, a separate canonical gap store,
Calendar writes or an already working desktop trigger is rejected.

## Chosen interaction defaults

| ID | Decision | Basis / why |
|---|---|---|
| UXD01 | Four main destinations: Study, Review, Progress, Sources. Activity is a global status/history utility and Settings a secondary destination. History is available from study/progress. | Designer default using approved mock direction; avoid a project-management dashboard or a new calendar app. |
| UXD02 | Desktop: collapsible slide navigator, dominant slide/player, one context panel with Tutor / Transcript / Sources. | Accepted design direction; preserves space for scientific content. |
| UXD03 | Tutor presents Quick answer / Understand / Explain back. Practice is entered from a question. These UI activities do not replace canonical learn/assess/produce/maintain modes. | Current user preference + compatibility. |
| UXD04 | Quick help supplies the answer first and does not create a learner attempt merely for asking. Not assessed in this exchange preserves prior evidence. A real submitted answer can receive brief assessment when that is the chosen action. | User explicitly distinguishes quick assistance from demonstrated understanding. |
| UXD05 | Guided depth is voluntary. A diagnostic normally asks at most two follow-up prompts before offering Continue deeper/Return; one prompt at a time with WAITING_USER. | Designer default respecting busy schedule; not a rigid maximum or forced interaction. |
| UXD06 | Clip playback stops at the selected interval end by default. Repeat, another occurrence and whole-recording mode are explicit. Changing slides pauses media; returning/resuming on another device does not autoplay. | Designer default for predictable context. No unsupported frame-perfect tolerance is asserted. |
| UXD07 | Opening normal source drawers preserves player state; voice capture pauses lecture audio. Transcript auto-follow suspends when the learner scrolls away. | Designer default preventing competing audio and scroll takeover. |
| UXD08 | Complete input is retained before inference. Snapshot edits are not allowed after submit; correction and new response are separate actions. | Existing-memory compatibility and user's full-evidence requirement. |
| UXD09 | Saving a question and selecting it for scheduled review are separate actions. Suggestions do not create a backlog or calendar task by themselves. | Existing policy + accepted voluntary-review direction. |
| UXD10 | Display criterion/skill evidence with assistance and source support, not a fabricated mastery or exam-probability percentage. Unobserved and uncertain remain distinct. | Source-supported semantics. |
| UXD11 | Source viewing, transcription/citation quality, native completion, canonical save and generated-view freshness have separate states. Error status should be actionable but not visually dominate ordinary studying. | Prevents false claims and repetitive alerts. |
| UXD12 | Light / Dark / System defaults to System per device. Explicit override persists on that device. Do not force another active device to switch theme. Original slides/images are never inverted or recolored by app theme. | User theme requirement + designer source-fidelity default. |
| UXD13 | Honor OS reduced motion, allow additional app reduction, and use restrained movement only for orientation. Prefer static state over animated pseudo-progress. | Accessibility design requirement; not a claim of tested conformance. |
| UXD14 | Narrow screens use a single main pane with Slide / Tutor / Transcript / Sources selection and reachable mini player. Navigation is progressive disclosure, not miniature desktop columns. | Cross-device requirement + designer default. |
| UXD15 | New data/integration permissions are requested at the relevant action through a supported channel; routine already authorized source reading/submission should not prompt repeatedly. Draft autosave never dispatches reasoning. | Low-friction use while preserving authority. |
| UXD16 | App histories and exports are private. Notes are learner-authored work, not new instructor authority. No calendar, email, grades, assignment submission or global course restructure is added. | Current ownership boundary. |
| UXD17 | A configured missing capability has an honest blocked/fallback state, but a blocker is not permission to call the full agreed release complete. Unsupported speech/native/media behavior needs separate evidence. | Prevents a mock interface being sold as an integration. |
| UXD18 | No new library/framework is selected by a screenshot. Prefer maintained accessible primitives, a real source renderer/player, and minimal compatible motion; pin and test selected interfaces separately. | User reuse-first requirement; avoid custom rebuilding and dependency bloat. |

## Deliberately outside the first private-release design

Public multi-user hosting, team permissions and billing; marketplace/class rankings; automatic
Calendar/Gmail/LMS edits; a new canonical graph/gap gradebook; automatic transfer credit;
secure proctored-exam claims; always-listening voice; unverified handwriting-to-math grading;
video/avatar tutoring; two-way Anki history synchronization; live collaborative co-editing;
automatic original-source deletion or automatic native app repairs. These require a new scoped
requirement if needed. Text/figure/image evidence and short spoken responses are designed here;
full duplex voice and handwriting recognition are not silently promised.

## Remaining engineering/activation gates, not another broad product interview

Actual native target and independent terminal result; independent Drive access and complete
bundles; inspected writer/schema compatibility and isolation; approved transcription/retention
settings; actual device/browser acceptance; chosen scheduler/rating behavior; bounded source
matching and assessment-quality thresholds. Existing global-root and source-hash caveats remain.
The flows define what the user sees when blocked and when the capability truly works.
