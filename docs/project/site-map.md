# Site map and screen map — 0.8.0

Product-flow baseline, not implemented routes or a chosen hosting technology. Resolving an ID never
grants access. Desktop screenshots are approved direction, not a claim that source/player/native
connections exist. UI terms retain the existing memory/workflow contracts.

```text
Private workspace connection
└── Study
    ├── All courses / Continue
    └── Course
        ├── All lecture units + related dated sessions
        └── Lecture workspace
            ├── Slide canvas / thumbnails / Focus
            ├── Bounded player / occurrences / whole recording
            ├── Tutor: Quick answer · Understand · Explain back
            ├── Transcript: follow · search · quote
            └── Sources: problems · textbook · figures · concepts
Review
├── Due and selected items
├── Available questions and suggested items
└── Review session → feedback → optional diagnosis
Progress
├── Observed skills / learning gaps / priority
├── Typed concept and question relationships
└── Original attempts / assessment revisions / study history
Sources
└── Course inventory · versions · preparation · link corrections
Global utilities
├── Search (course by default, explicit cross-course scope)
├── Activity (requests · staged/saved results · conflicts)
├── Settings (appearance · access · AI/Brain · limits · data)
└── Session wrap-up / Resume
```

No standalone calendar, email, grade editor, team management or payment pages are added.
Saved notes/references live in their source/session context. Concept and source details open
as drawers on wide screens or focused pages on narrow screens. Browser Back and Return to slide
restore context without restarting audio. See [all flows](ui-flows.md), [stories](user-stories.md),
and [shared behavior](ui-state-and-interaction-contract.md).

## Screen register

| ID | Screen | Form | Route / context | Purpose |
|---|---|---|---|---|
| SC01 | Connect workspace | page | /connect | Private access, explicit account/scope selection and separate provider/writer readiness. |
| SC02 | Study home | page | /study | All configured courses, continue cards and honest preparation coverage; no marketing landing page. |
| SC03 | Course lecture list | page | /courses/:courseId | All lecture units and sessions, source availability and processing state without conflating preparation with learning. |
| SC04 | Lecture workspace | page | /courses/:courseId/lectures/:lectureId | Large versioned slide, collapsible thumbnails, persistent player, Tutor/Transcript/Sources context panel. |
| SC05 | Source detail | page_or_drawer | /courses/:courseId/sources/:sourceId | Resolve a permitted versioned page/time/figure anchor; preserve origin and support explicit return. |
| SC06 | Question and practice | page_or_drawer | /courses/:courseId/questions/:questionId | Complete prompt/figures, reference conditions, response editor, hints and feedback; never an isolated text-only paraphrase of a diagram problem. |
| SC07 | Questions and review | page | /review | Due, selected, available questions and suggestions; active scheduling is distinct from simply saving an item. |
| SC08 | Review session | page | /review/sessions/:sessionId | One item at a time, actual response, review feedback and optional detour; no fictional reviews on skip. |
| SC09 | Progress and learning gaps | page | /progress | Observed skill evidence, assistance, freshness and priority; no invented universal mastery score. |
| SC10 | Concept detail | page_or_drawer | /courses/:courseId/concepts/:typedId | Typed concept/skill/question relationships and source/attempt references; tree is a projection. |
| SC11 | Study history | page_or_drawer | /history/:sessionId | Exact submitted questions/responses, delivered replies and assessment revisions, not hidden model reasoning. |
| SC12 | Activity and request detail | page_or_drawer | /activity/:requestId? | Separate local capture, transport, native turn, answer, canonical save and view states with relevant actions. |
| SC13 | Settings | page | /settings/:section? | Appearance, access, data, notifications and operator controls. No credentials displayed or permissions granted from arbitrary task content. |
| SC14 | Conflict resolution | dialog_or_page | /activity/conflicts/:conflictId | Preserve both versions and resolve deliberate edits without last-write-wins for evidence. |
| SC15 | Repair preview | dialog_or_page | /settings/maintenance/:operationId | Explicit bounded repair scope and verified outcome; no autonomous lock deletion or history recreation. |
| SC16 | Session wrap-up | page_or_drawer | /study/sessions/:sessionId/summary | Where the user stopped, actual work, pending saves and optional next actions; no automatic calendar changes. |
| SC17 | Search | overlay_or_page | /search | Scope to current course by default; source, lecture, question and concept results retain types, versions and access. |
| SC18 | Response capture | component_dialog | Invoked capture component | Typed text, recording controls, transcript correction and attachment review. No audio upload before applicable permission. |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0 (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Screen ids, routes and the four main destinations are unchanged. Two things in the map above are amended, because the learner could not reach them by ordinary navigation:

```text
Study
├── Resume (first) / All courses
└── Course
    ├── Concept map                      (new entry in every course header; scope Course)
    ├── All lecture units + related dated sessions
    └── Lecture workspace
        ├── Collapsible lecture outline (logical slides · builds · regions)
        ├── Slide canvas with its identity line / Focus
        ├── ONE media control system (ranges · Repeat · Whole recording)
        └── Resizable context panel
            ├── Tutor: Quick answer · Understand · Explain back
            ├── Questions: This slide · Related concepts · All lecture questions
            ├── Concepts: Course · Lecture · This slide (outline and graph)
            ├── Transcript: course transcript · generated speech text
            └── Sources: files of the unit · versions · preparation
```

SC04's context panel is Tutor / Questions / Concepts / Transcript / Sources (it was Tutor / Transcript / Sources in 0.8 and Tutor / Transcript / This slide / Questions in R1). SC10 (Concept detail) is additionally reached from **Concept map** in a course header and from the **Concepts** tab; no address has to be typed. SC13 (Settings) also shows the build and data identity. Checks: R2-V3, R2-V5, R2-C1, R2-C2, R2-B1, defined in the feature packets under `docs/features/`.
