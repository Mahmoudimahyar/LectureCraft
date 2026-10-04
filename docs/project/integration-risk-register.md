> **0.5.0 operating update:** The user has fixed primary processing/publication on the always-on Brain PC; other devices exchange authorized inputs/outputs through Drive. Earlier laptop-off writer-placement/hosted-service proposals are not current requirements. The [Brain PC system](brain-pc-system.md), [workflow catalog](workflow-catalog.md), [memory contract](memory-contract.md) and [current readiness](build-readiness.md) govern the new design. The underlying source inventory, UI goals and existing-contract facts below are retained; no live integration is verified.

# Integration blockers and bounded repair recommendations

All findings below are **reported in P05**, not reproduced by this design session. No repair is
authorized by uploading the audit. Verify the actual current source revision before a fix.
Source claims refer to P05 headings/question IDs; status is OPEN until evidence is supplied.

| ID | Reported finding | Risk to this app | Proposed response and focused regression |
|---|---|---|---|
| R01 | Six verified course/planner projects are Codex desktop; ChatGPT cloud access is not equivalent. Q001/Q013/Q018 | Wrong product/thread while UI says ChatGPT. | Product-qualified binding and genuine external-entry-to-ChatGPT-to-result probe; reject Codex substitution. |
| R02 | `verify-published --check-source-files` returns before handling source hashing. Executive discrepancies/Q089 | UI calls a publication check proof of physical-source freshness. | Inspect branch/CLI semantics; fix or use explicit safe source audit. Modify a fixture source with unchanged publication and require detection when the flag is requested; baseline check retains its narrower meaning. |
| R03 | BE 505 candidate hashing uses module-global root despite alternate `--root`. Executable details | Cross-course/sandbox validation silently reads wrong source. | Explicit root dependency throughout helper paths. Test two roots with different bytes and reject wrong-root candidates; instrument fixtures so tests cannot touch live courses. |
| R04 | Legacy BE 505 test expects 13 attempts while real history contains 17. Executive discrepancies | Genuine new learning makes tests look broken, inviting destructive reset. | Decouple fixed test fixtures from evolving production counts. Test preservation, uniqueness, actual IDs and append behavior; never delete valid history to restore a number. |
| R05 | Three stale learning views; saved shared view zero versus seven eligible referenced attempts in current derivation. Health matrix | Learner shown stale/absent-looking evidence. | Gate reads on freshness or label known staleness; authorized rebuild only from validated originals. Preserve zero as unobserved when truly no attempts. |
| R06 | `study_index.py show` does not automatically establish all freshness. Q052 | Old lookup becomes a grounded answer. | Wrapper invokes the right current checks or carries explicit stale status; mutate fixture source/catalog and block confident reuse. |
| R07 | Windows tracking lock namespace differs by runtime; learning uses a different course guard. Q061-Q066 | Cross-device writes collide or wrong publisher handles attempts. | One explicitly designated owner per record class, current runtime/lock proof and concurrency/duplicate tests. No distributed guarantee from a synced lock file. |
| R08 | Source IDs lack complete Drive file-ID mapping; old-version bytes not universally archived. Q008/Q034 | Wrong file/copy or unsupported historical read. | Scoped resolver, alias/revision validation and explicit unavailable-history state. Test moves, same-name snapshot folders, replacement, permission loss and limited versions. |
| R09 | No established recorded-time alignment and missing/empty source cases. Q027/Q037-Q042 | Fabricated clips or textbook links. | Separate metadata/line/timing/semantic evidence; report missing sources. Validate on audio and actual slide-video cases, then evaluate complete inventory coverage. |
| R10 | Source-refresh is timed scanning; send_message_to_thread is available only as a native tool and NOT_RUN. Q020/Q018 | A file change is mistaken for a user-triggered completed request. | Separate committed submit, delivery, invocation, result and publication receipts. No arbitrary file edit grants execution. |
| R11 | Answers/collapsed assessor content not enforced as permission boundary. Q051 | Tests labeled unaided despite leaked solutions. | Filter assessor content before constructing learner context; test direct retrieval, rendered UI and prior exposure. |
| R12 | Course identity planner/shared fields are null; current planner routing exists. Q003 | Agent resolves wrong authority or invents parallel config. | Reuse current authoritative resolution and record conflict; owner-reviewed minimal reconciliation later. |
| R13 | Legacy BE 562 email destination; evening source refresh incomplete at audit observation. Matrix 3 | Unrelated setup changes or historical incomplete status treated as current failure. | Preserve running jobs and ownership. Recheck only when needed; no source cleanup or new schedule from this design pass. |

R02/R03 are trust-boundary implementation issues, not harmless cosmetic cleanup. They do not
invalidate all prior audit conclusions: P05 explicitly attributes the morning refresh's 150
physical-source hashes to a **separate source audit**, not to the ineffective CLI flag. Keep
that evidence distinction. Full helper hashes, code and safe fixtures are needed for repair;
SHA prefixes and record projections in the report are not executable contracts.

Lower-priority historical prose/view cleanup is not permission to rebuild catalogs, rewrite
release manifests, reset learning, change scheduled jobs or migrate the writer host. Blocking
one path should not prevent independent read-only design or source viewing.

## P06 findings and tighter boundaries (0.6.0)

| ID | Reported evidence | Required handling |
|---|---|---|
| R14 | Alpha CLI queue help; default App Server control connection failed with Windows 10050. | Mark capability candidate, not operational. Isolate root cause/readback before code depends on it; no speculative daemon/socket/firewall repairs. |
| R15 | danger-full-access/elevated setup appears in user config; thread effective settings unknown. | Explicit safe disposable target and human approval channel. readonly file permissions alone do not constrain all tools/network. Do not alter real course thread defaults. |
| R16 | Desktop update pending; version-bound CLI path. | User-approved stable runtime window, re-resolved executable/protocol identity after update. Do not assume restart cures the failure. |
| R17 | Response locator accepts a string but does not verify its referenced full snapshot. | New wrapper validates digest, identity, content/item correspondence and readback around the existing writer. Freeze input; later tutor reply is a new message. |
| R18 | No separate graph/gap/session/review authority installed. | Withdraw parallel graph/gap ledgers; project canonical IDs/assessments to exports. Operational extensions do not grade by their existence. |
| R19 | Native connector exposes upload tools but independent client scopes/revision metadata unverified. | Authenticate each actor correctly; missing metadata is unknown; local manifest hashes are not global Drive-currentness proof. |
| R20 | Existing updater has source/final receipts, not a subscription endpoint. | Reuse receipts/owner; a small approved extension there rather than duplicate updater/job. |
| R21 | Focused report cuts off at B.6. | Mark incomplete input and request only its missing tail; no assumptions about later test details or transcription packages. |

R03 is stronger than an input-hash issue: P06 reports save/refresh also use global paths.
Do not invoke the installed writer against any disposable root until isolation is actually
established. A documentation-only packet does not authorize that repair or a production test.
