> **0.10.0 execution update:** the user requested full-project local implementation. Read
> [the execution charter](../implementation/execution-charter.md). The old LL-S01-only staging no
> longer limits ordinary local code work; original live gates and final acceptance are unchanged.

# Integrated roadmap and backlog — build baseline 0.9.0

R0–R5 is the sole active delivery sequence. Earlier U0–U5 and I01–I08 are mapped context, not separate competing roadmaps. All lectures remain in product scope. Estimates/calendar dates require measured throughput and the learner’s real deadline; task dependencies and exit evidence do not depend on invented dates.

| Milestone | Outcome | Candidate app label (not released) | Exit evidence |
|---|---|---|---|
| R0 | Engineering baseline and contracts | No product release | Current scope, one dependency DAG, exact new contracts, safe test boundaries and version policy. |
| R1 | Read-only study foundation | v0.1.0-alpha.1 candidate | All configured lecture entries visible; source-first interface works on fixtures; light/dark and safe local capture verified. Not complete tutoring. |
| R2 | Source preparation and trusted connections | v0.2.0-alpha.1 candidate | Versioned alignment/corrections, all-lecture coverage ledger and independently observed native/Drive adapters. No mock satisfies an external gate. |
| R3 | Complete tutoring and evidence loop | v0.3.0-alpha.1 candidate | Real authorized request → intended native turn → correlated answer → correct canonical writer; quick/deep/assessment distinctions, diagnosis and corrections. |
| R4 | Review, progress and continuity | v0.4.0-alpha.1 candidate | One selected review history, supported ratings, derived gaps, cross-device drafts, privacy/export and reliable recovery. |
| R5 | Whole-product personal acceptance | v1.0.0-rc.1 then v1.0.0 | All active flows, quality targets, all-lecture preparation and authorized supported devices pass; no unresolved critical integrity defects. Earlier alphas are not scope substitutions. |

Two tracks run concurrently: fixture/UI work and separately approved real-interface proofs. A failed native proof blocks its dependents, not the independent UI. Each milestone includes tests; R5 is integrated release acceptance, not the first testing phase.

## Task-ready records

| Task | Milestone | Outcome | Dependencies |
|---|---|---|---|
| LL001 | R0 | Create a separate Seed-based application workspace | none |
| LL002 | R0 | Resolve selected dependencies and reproducible locks | LL001 |
| LL003 | R0 | Capture real academic interfaces without invoking unsafe writers | LL001 |
| LL004 | R0 | Implement shared wire validation and generated client types | LL001 |
| LL005 | R1 | Build shared source-first shell, tokens and components | LL002, LL004 |
| LL006 | R1 | Implement local drafts and immutable submission capture | LL004, LL005 |
| LL007 | R1 | Implement local job journal and migration lifecycle | LL004 |
| LL008 | R1 | Isolate and wrap the real course writers | LL003, LL004, LL006 |
| LL009 | R1 | Normalize read-only catalogs and complete source inventory | LL003, LL004 |
| LL010 | R1 | Implement course navigation and bounded search | LL005, LL009 |
| LL011 | R1 | Render slides, figures and scoped source drawers | LL005, LL009 |
| LL012 | R1 | Implement clip playback and synchronized transcript controls | LL011 |
| LL013 | R2 | Implement durable owned source annotations and correction UI | LL004, LL008, LL011, LL012 |
| LL014 | R2 | Extend the existing updater receipt handoff | LL003, LL007, LL009 |
| LL015 | R2 | Prepare and align all available lecture material | LL012, LL013, LL014 |
| LL016 | R2 | Project typed concept structures from existing owners | LL009, LL013, LL014 |
| LL017 | R2 | Pair devices and implement signed immutable Drive bundles | LL002, LL004, LL006, LL007 |
| LL018 | R2 | Implement native adapter contract and safe local control | LL004, LL007 |
| LL019 | R2 | Prove one actual native desktop request and return | LL018 |
| LL020 | R2 | Prove second-device Drive read, paired input and output | LL017 |
| LL021 | R3 | Join coordinator, updater and owning writers | LL007, LL008, LL014, LL018, LL019, LL020 |
| LL022 | R3 | Implement quick answers and deeper sourced conversation | LL006, LL010, LL018 |
| LL023 | R3 | Implement criterion-aware teach-back and practice | LL006, LL008, LL009, LL022 |
| LL024 | R3 | Implement spoken teach-back with corrected text evidence | LL006, LL012, LL023 |
| LL025 | R3 | Calibrate alignment, tutor and assessment task evaluations | LL015, LL022, LL023, LL024 |
| LL026 | R3 | Implement diagnostic hypothesis and real WAITING_USER continuation | LL023 |
| LL027 | R3 | Implement disputes, capture corrections and genuine new answers | LL008, LL023 |
| LL028 | R4 | Implement selected rich questions and review items | LL009, LL016, LL023 |
| LL029 | R4 | Implement scheduler adapter and immutable review events | LL002, LL004, LL023, LL028 |
| LL030 | R4 | Implement evidence-linked progress and current gap views | LL016, LL027, LL029 |
| LL031 | R4 | Implement versioned resume and multi-device conflicts | LL006, LL017 |
| LL032 | R4 | Implement scoped export, retention and reference-safe cleanup | LL008, LL027, LL030, LL031 |
| LL033 | R4 | Implement activity, quota, lifecycle and bounded maintenance | LL021, LL031, LL032 |
| LL034 | R5 | Execute real-browser interaction, accessibility and theme suite | LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033 |
| LL035 | R5 | Exercise real tutoring-to-save and all-lecture readiness | LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030 |
| LL036 | R5 | Exercise backups, updates and rollback on copies | LL008, LL032, LL033 |
| LL037 | R5 | Configure protected delivery checks and release evidence | LL001, LL002, LL004 |
| LL038 | R5 | Package and approve the private whole-product release | LL034, LL035, LL036, LL037 |

The machine-readable [backlog](backlog.json) supplies proposed edit roots, owners, actual checks, workflow/story references and approval gates. No task is marked done or activated by this document. Dependency and permission gates must both pass. Checkpoint after one reviewable result; do not have agents compete on the same feature branch or canonical writer.
