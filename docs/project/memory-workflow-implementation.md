> Current implementation authority: [exact adapter contracts](../engineering/interface-contracts.md) and [R0–R5 backlog](../delivery/backlog.json). This retained design explains rationale; its earlier illustrative shapes and I/U sequencing are not competing schemas or schedules. Existing academic ownership constraints remain binding.

# Bounded implementation plan — 0.7.0

Design recommendation; no live change, runtime start, canonical save or repair has been authorized
by this file. Full schemas and implementation bytes have not been supplied here; P05/P06 are reports.
A pure fixture adapter must not call the installed BE 505 writer assuming --root changes its globals.

## Build the smallest connected units

| Unit | Keep | New/modified component | Consumer and completion gate |
|---|---|---|---|
| I01 — Read adapters and typed identities | Current catalogs, source indexes, validators, course strategy | Bounded read view that preserves actual topic/concept/skill/question/criterion types and revision qualifications | WF03-WF10; wrong course/revision and unsupported edge meanings blocked. No bulk schema migration. |
| I02 — Capture and safe publication boundary | Existing attempt and assessment_revision formats, appropriate publisher locks | Immutable prompt/learner snapshot, separate tutor messages, attachment verifier, course-specific commit facade | WF04-WF06; input survives grading failure, full evidence resolves/hash-matches, idempotency/view-failure receipts pass on isolated copies. |
| I03 — Derived memory and revision impact | Existing renderers and original records | Concept tree, gap view, actual-context receipt, dependency/freshness manifest and resume projection | WF09/WF10; deletable exports regenerate without new competence facts or loss of accepted source annotations. |
| I04 — Owned source-preparation handoff | Existing scheduled source updater and protected publisher | Changed-source/backlog receipt extension in that owner, timing/rendition candidates, reviewed typed annotation extension | WF01-WF03; all-lecture denominator, preserved manual correction and source-version coverage; no duplicate updater/schedule. |
| I05 — Real native/Drive transport and supervisor | Current managed sign-in, trusted project/root binding, current writers | Version-scoped resident adapter, durable journal, committed envelopes, single-thread turns and publication gate | WF00/WF11; independent process obtains terminal native result, effective permissions explicit, Drive read/write identity separately verified. |
| I06 — Tutorial/diagnostic state | Existing course policies and rubric/attempt semantics | Pin criteria before grading, preserve alternate answers/uncertainty, labeled multi-hypothesis proposal, WAITING_USER continuation | WF04-WF06; reviewed examples, real subsequent responses, no automatic prerequisite failure or changed assessment skill set. |
| I07 — Rich review and scheduling | Existing questions/families and optional suggestions | Versioned item selection/suspension, supported rating adapter, approved scheduler, immutable review events and due projection | WF07/WF08; one event per real review, explicit uncertain/assisted policy, no auto calendar effects. |
| I08 — Retention, lifecycle and end-to-end learning UI | Existing recovery ownership and protected boundaries | Backup/restore fixtures, reference-aware cleanup, cancellation/restart reconciliation, usable cross-device flows | WF11 plus all consumers; no lost full response, wrong-course write, duplicate publication or fake remote-completion claim. |

I01-I03 fixture design can proceed independently of native transport. I05 is required before
unattended integration claims; it is not permission to keep trying unverified transports or use
bypass settings. Native/platform changes remain their own authorized proof. I04 source extraction
quality and I06 assessment quality need independent reviewed data, not only schema tests.

## One complete answer round

1. The interface deliberately submits a question/explanation with immutable input identity, source
   refs, question version, time basis and help conditions. Drafts are separate UI state.
2. WF00 accepts a complete authorized bundle once and saves a job receipt. It does not grade anything.
3. WF05 freezes the full presented prompt/actual response/necessary figures before reasoning. Reuse
   a logical turn ID across transport retries; choose a different attempt ID only for a real new answer.
4. Load the existing family/rubric and intended skills. If absent, retain captured input and stage
   a reviewable compatible mapping; do not fabricate a valid canonical candidate.
5. The selected native worker receives actual checked context, returns a source-grounded assessment
   and optional hypotheses. The reference answer is tutor-authored unless there is stronger evidence.
6. Verify full sidecar identity/bytes/excerpt/attachments and candidate schema; call the correct
   owning writer under its real guard. Record saved/already_saved/pending/view-stale distinctly.
7. Store delivered tutor text as a different immutable message. After publication, WF10 derives
   observations/gaps and resume context. If canonical publication is blocked, helpful feedback can
   still be shown as provisional where policy permits, never as verified saved learning evidence.
8. If a diagnostic is chosen, WF06 delivers one distinguishing question and releases the worker.
   Only the user's actual reply starts a new WF05 cycle. The agent never creates a reply to drain work.
9. If review is selected, WF07/WF08 record selection and actual later review event; scheduler state
   is not a judgment that the learner forgot. An assessment correction changes interpretations, not
   the original message, occurrence time, or count of reviews performed.

## The shared processing round

Claim ready work under an expected input/authority revision → read required content → perform one
bounded operation → stage → validate → publish through its owner → read back → record completion
and downstream dependency → release capacity and take the next eligible item.

Waiting on the learner, source, review, permission or quota is not a running reasoning job. Blocked
items do not stop unrelated work. Background tasks receive fair turns but cannot extend their own
catalog/diagnostic scope indefinitely. Existing source updater safety caps remain until its owner
approves a continuation policy; no shadow cron is added to evade them. The all-lecture coverage
frontier reports pending/unavailable items rather than falsely marking the archive finished.

## Evidence required, not yet run

Application acceptance is in workflow-acceptance.json. New MW review cases are appended there as
AC57 onward. Unit checks on a future implementation must separately validate structural integrity,
actual native connection, permitted media accuracy, pedagogical assessments and real UI behavior.
The documentation check only verifies internal references and packaging; it validates no learning
claim, tool operation or runtime permission.

## Remaining decisions and known repairs

No further broad memory/workflow interview is needed. Before implementation, the owning agent must
supply the actual relevant schema/writer interfaces to the implementer, and the already-defined safe
native proof must be approved. Exact source-annotation record semantics, operational review/rating
policy and retention limits are bounded design decisions, not authority for a parallel memory store.

The reported global ROOT/save-path defect requires isolated refactoring/tests; do not invoke the
installed writer with a fake root. The verify-published source-check flag requires repair or an
honest separate source audit. Stale derived summaries need owner-controlled rebuilding, not history
recreation. Do not hard-code the current production attempt count into a unit-test expectation.
