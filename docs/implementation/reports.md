# Required build reports (ignored .local/reports/)

`WHAT_WORKS.md`: actual implemented features, entry URLs/commands, fixture/local/live qualification,
remaining incomplete areas, version/commit and evidence. No screenshot-only feature completion.

`TEST_REPORT.md`: exact commands and revision, exit/status/counts, red→green evidence, browser
screenshots/console/network findings, known skips and unrun integration/evaluation. Package/contract
checks are not application checks. Reference evidence paths rather than dumping raw source/history.

`NATIVE_SETUP_REPORT.md`: follow docs/operations/native-setup-report.md. No speculative toggle names.

`ACTIONS_REQUIRED.md`: minimal nonroutine manual actions, why, precise affected tasks, permission/data/
cost consequence, safe verification and rollback. Missing OAuth or native target must not be hidden.

`RESUME.md`: last completed unit, task states, current files/commands, any running local processes,
next eligible work, unresolved failure hypotheses. No private hidden reasoning or credentials.

The JSON ledger is .local/build/state.json and its append-only events/command receipts. One worker
owns it at a time. A stale lock is never deleted while a build might still be running. Parallel
subagents may work on isolated read/review scopes, but the main worker owns integration and writes.
