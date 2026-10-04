> **0.6.0 precedence:** Read the [P06 reconciliation](../reviews/brain-pc-compatibility-2026-10-03.md)
> and [memory contract](memory-contract.md). Preserve existing catalogs/attempts; trees/gaps are exports.
> Sidecars use new run-area children and a new verifier. No global-root writer fixture invocation,
> parallel updater, automatic native routing or app permissions are established by the report.

> **0.5.0 operating update:** The user has fixed primary processing/publication on the always-on Brain PC; other devices exchange authorized inputs/outputs through Drive. Earlier laptop-off writer-placement/hosted-service proposals are not current requirements. The [Brain PC system](brain-pc-system.md), [workflow catalog](workflow-catalog.md), [memory contract](memory-contract.md) and [current readiness](build-readiness.md) govern the new design. The underlying source inventory, UI goals and existing-contract facts below are retained; no live integration is verified.

# Existing workspace contract — updated from returned audit

Authority: P05 (2026-10-02 managing-agent report). This session has the report and projected
examples, not complete live helper/schema bytes. Keep reported behavior separate from freshly
executed verification. Public app source and private course/runtime identities must not share
one distribution scope.

## Existing meanings to retain

Five course-owned workspaces and a main coordination workspace. Materials, authored work,
requirements/grades, learning attempts, generated views and shared links have separate owners.
Course/session/source/version, concept/skill/criterion/family/question and actual attempt IDs
are not interchangeable. `learn`, `assess`, `produce`, `maintain` remain modes; Ask/Explain/Review
are proposed interface activities. Outcomes stay `demonstrated`, `partial`, `not_demonstrated`,
`not_observed`, `uncertain`. Observe assistance/exposure per relevant skill; unknown does not
mean unaided. A question, read, replay, AI answer or generated card is not learner success.

The report finds 39 genuine attempts. Zero recorded attempts in CS 542/DS 551 means unassessed,
not unsuccessful. No actual assessment-revision chain was found; the correction contract is
present as a template and must be tested without manufacturing genuine history.

## Actual owner-specific interfaces (as reported, not invoked here)

| Operation | Reported path/interface | Scope and limit |
|---|---|---|
| Tracking read/check | `tools/course_tracking.py verify-published` | Publication consistency is not physical-source freshness. Its optional source-check flag has a reported branch bug. |
| Learning validation / view check | `tools/course_learning.py validate`, `verify-view` | Reuse current `course-learning-v1`, schemas and source identities. |
| BE 505 question lookup | `tools/study_index.py show --question ...` | Course-specific; must verify source/view freshness first. |
| BE 505 learning save | `tools/study_index.py save-attempt --candidate ...` | Existing exclusive-create/retry semantics and course lock. Global-root hashing caveat must be resolved before reuse against copies/other courses. |
| Other learning saves | Coordinated course-local no-clobber procedure | No universal central save executable was established. Do not invent a currently deployed endpoint. |
| Tracking publication | `tools/course_tracking_publish.py` | Separate request/baseline/candidate/source-hash protocol; Windows host/interpreter-specific guard. Not the learning-attempt writer. |
| Shared query | Existing shared reader | Refers back to original attempts; no automatic cross-course credit. |

Exact source report commands include absolute runtime requirements. Do not choose bare `python`
or another environment for the guarded publisher because it happens to import successfully.
`make-request`, `snapshot`, `fingerprint-current`, `publish`, `recover`, `save-attempt`, and
`refresh` may write files or locks. Inspect side effects before any future experiment.

## Publication receipts and conflicts

Persist candidate source/assessment identity, validate, exclusively create or check identical
same-ID retries, read back exact bytes, then separately verify regenerated views. Preserve the
raw learner response and original record across reassessment. Different bytes under one ID are
a conflict, not an overwrite or another attempt. AI recomputation of one answer is not a new
learner response. A receipt should distinguish answer available, proposal validated, canonical
attempt recorded, and derived-view current/stale.

The tracking publisher replaces five files sequentially with a marker last; readers must not
assume filesystem-wide atomicity. Some helpers may write views even on an identical attempt
retry. The coordinator must preserve original outcome meanings rather than collapsing every
exit-zero response into a new save. Lost confirmation requires reconciliation before retry.

## Writer placement

Current locks do not coordinate arbitrary other hosts, WSL, interpreters, direct file edits or
Drive sync. A proposed common app facade routes to existing authorities; it does not create
one global lock by wrapping a command. If choosing an always-on authority, coordinate every
other writer and explicitly migrate permissions/runtime. Until then, absent/busy/unproven
writer availability means staging, not canonical success or silent direct Drive writes.

## Reuse readiness versus repairs

Before depending on affected paths, inspect the current helper revisions and fix or isolate
the source-hash flag and BE 505 global-root defect with focused tests. Refresh stale views only
under a separate authorized repair. Do not edit real attempt counts to satisfy a hardcoded
legacy test. Do not broaden this app into grades, schedule/email publication or shared learning
maintenance. See [integration risks](integration-risk-register.md).
