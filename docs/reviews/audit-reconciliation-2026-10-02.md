# Reconciliation of the returned managing-agent audit

Basis: **P05**, `Pasted text(1).txt`, the 2026-10-02 managing-agent response to Q001-Q108.
Its OBS/CODE/CFG/HIST/DOC labels belong to that report. This session did not rerun its
commands or access the six live workspaces. Its statement that 91 protected files were
unchanged is reported evidence, not a new 91-file comparison by this design session.
The raw report contains private identities/paths and is not copied into this docs package.
See [source provenance](../research/audit-evidence.json).

## Accepted user decisions, not merely another proposal

- Private single-learner first release.
- All lectures and available relevant slides/recordings/transcripts, across configured courses.
  The earlier one-course/three-lecture product limit was rejected. Sampling is for validation.
- ChatGPT first; Claude compatibility later. Codex is not silently substituted for ChatGPT.
- Google Drive remains the material store; the experience must be cross-device.
- Existing learning meaning, IDs, originals and history are preserved. No separately billed
  inference fallback, hosted publication, writer relocation or account activation is authorized.

These are requirements, not authorization to install, publish, schedule or write course data.

## Corrections to earlier working assumptions

| Assumption | Audit finding | Design consequence |
|---|---|---|
| Each course is already connected to the requested ChatGPT project. | The six observed local projects are Codex desktop projects; one CS 542 ChatGPT cloud project exists without proven equivalent access. (Q001/Q013/Q018) | Bind product, surface, project and conversation separately. Verify actual ChatGPT dispatch; do not reuse Codex IDs as ChatGPT IDs. |
| A G: path makes the app portable. | G: is a Windows Drive volume; only limited connector/current-byte comparison established. (Q007-Q012) | Preserve course/source IDs and add Drive file resolution independent of mount paths. |
| Markdown changes already wake a chat. | Current source-refresh is scheduled bounded scanning, not an immediate file event request/reply bridge. (Q019-Q024) | Detecting a change, invoking a session, getting an answer and publishing evidence need explicit contracts. |
| Transcript lines already give clip times. | 30 TXT transcripts; samples have no observed timing. Existing links use transcript lines, not verified audio intervals. (Q037-Q042) | Verify transcript fidelity, establish text/audio timing, then connect to slides. |
| One current writer works identically everywhere. | Separate tracking publisher and learning mechanisms; BE 505 has a course-specific helper; most courses do not have a universal save command. (Q061-Q066) | Route by record owner; do not send learning attempts through tracking publication. |
| All test/history reports imply current verification. | Historical tests, current read checks and untested runtime seams differ. A source-hash option and a root override have reported problems. | Repair or isolate those paths before depending on them; no invented successful test. |

## What is reusable

Course/source/version identities; skills, criteria and question-family revisions; immutable
learner attempts; assistance and exposure semantics; the existing modes; BE 505 question lookup
and 205 relationship records; validated shared read derivations; original material and selected
source maps. There are 39 reported genuine attempts, not 39 independent unassisted successes.
Zero attempts in a course means no recorded evidence, not no knowledge. (P05, health matrix.)

## What is not already implemented

A portable per-source Drive resolver; browser-ready source/media serving; exact slide/audio
intervals; request/result correlation across an external app and actual ChatGPT; a consistent
course-learning writer facade; shared slide/playback/draft state; executing adaptive review;
calibrated diagnosis/grading evaluations. Existing question catalog coverage is unequal.
These are app workstreams, not reasons to rebuild every existing contract.

## Limits in the returned report that stay open

The report's projections are not complete candidate schemas. Listed tool availability is not
proof an external caller can invoke it. Folder IDs and one 173-byte Drive/local match do not
establish large-media playback or all-file synchronization. MP4 is not proof of visible slides.
No real correction chain exists; test it synthetically rather than manufacturing student history.
Its recommendation for a ChatGPT-embedded UI is a proposal, not the user's acceptance of a
replacement for the standalone web-app experience. Three immediate deployment choices remain,
but this does not settle every later UX, retention, assessment or performance tolerance.

No underlying repair, data ingest, provider message, scheduler change or app runtime test was
performed while incorporating this audit. [Integration risks](../project/integration-risk-register.md)
and [proposed probes](../project/probe-and-acceptance-plan.md) identify the next bounded work.
