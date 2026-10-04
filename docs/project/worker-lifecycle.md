# Dedicated workflow workers without endless model polling

## Persistence and role identity
Dedicated means a fixed workflow contract, scoped queue, source/context selection, allowed tools,
output rules, checkpoints and memory. Session reuse is optional and validated; files and canonical
records, not an ever-growing prompt, preserve state. The conventional supervisor stays running.
The reasoning model runs only for tasks needing reasoning and can exit or suspend at a checkpoint.

Proposed groups: supervisor; course preparation; tutor per course/thread; review; integrity/writer.
Use one implementation with modules/adapters before introducing distributed agents or services.
Initial concurrency recommendation is one interactive reasoning slot plus one bounded background
slot when actual runtime/provider/resource limits allow. At minimum keep a priority-aware serial
fallback. Publication remains serial per protected resource/owning writer. Do not share a mutable
native thread across concurrent user/preparation/review conversations. Human edits in that same
thread need explicit serialization or a separate identified agent thread.

## Job state contract (new app metadata, not existing course-schema enums)
`RECEIVED -> VALIDATED -> READY -> CLAIMED -> RUNNING -> STAGED -> COMMIT_PENDING -> SUCCEEDED`.
Other states: WAITING_SYNC, WAITING_SOURCE, WAITING_USER, WAITING_REVIEW, QUOTA_WAIT,
AUTH_REQUIRED, FAILED_RETRYABLE, FAILED_FINAL, UNCERTAIN_COMPLETION, CANCELLED, SUPERSEDED.
A valid no-op gets an explicit succeeded no-op receipt. A job that accounts for an unavailable
source can complete its inventory step without making downstream alignment successful.
A dependency may be satisfied by an allowed explicit disposition, never by silently converting
BLOCKED into PASS. Waiting for a learner response is not a running AI task.

## Each processing round
Read only newly eligible input; validate current permissions and revision bindings; claim once;
perform one bounded source slice, assessment turn or deterministic operation; stage/check/publish;
read back; record receipt and next dependency; release lease; take another item. Continue across
batches until all eligible items are processed. The all-lecture coverage denominator never shrinks.
Stop a batch on time/context/resource cap and immediately schedule its saved continuation when
allowed. That is not stopping the overall workflow after a few lectures.

Prioritize (1) retained learner input/commit recovery, (2) interactive replies/assessments, (3)
user-selected review/needed source preparation, (4) archive backfill and routine projections.
Age background work to avoid permanent starvation. A long media task uses bounded segments and
checkpointing; don't kill uncommitted publication to preempt it. Use quota-aware caps and pauses;
no assumptions of unlimited subscription capacity.

## Bounded repair and escalation
Recommended starting policy: at most two attempts for a recognized safely retryable failure per
unchanged item, then surface a blocked record. Tune from evidence. Authentication, permission,
malformed instruction, unsafe write, changed source and uncertain prior execution require specific
resolution rather than retries. Transient network/availability failures use bounded exponential
backoff and stored next-attempt time. New evidence or user resolution can reopen a blocked task.
An LLM may propose a repair but cannot alter its own policy, install software or raise spending.

## No work left
The proper terminal condition is no runnable task under the current known input frontier and
approved budgets. Record totals for succeeded, still pending, waiting on user/source/review, failed
and unrecorded material. It is not 'all concepts known' or 'all gaps resolved'. An incorrect answer
cannot trigger agents to invent further learner attempts until a dashboard looks mastered.

## Deduplication and feedback-loop prevention
Each job has request ID, workflow revision, course/term, input digest, parent IDs, dispatch attempt,
lease owner/generation, checkpoints and receipts. Incremental source work keys on source/version
plus stage/tool version; generated outputs are not new instructor inputs. WF10 projections do not
retrigger assessment or source ingestion. A new diagnostic question does not become a response.
Only matching current claim generations can publish. Source/context/rubric changes invalidate the
appropriate pending work; original observations remain tied to what was actually presented.

## Execution storage and startup
Recommend SQLite or an equivalent conventional transactional journal on the Brain PC's local
nonsynced application-data directory. Do not put a live database/WAL or runtime locks on Drive.
The existing canonical publisher's physical lock namespace is a separate constraint; run it with
the verified host/user/interpreter and do not silently switch to a generic Windows service account.
An autostart process needs approved least-privilege permissions and watchdog/restart settings;
'normally always on' does not prove operation after logout, app update or expired sign-in.

Journal/provider receipt recovery distinguishes received-not-started, running, output-staged,
canonical-record-saved, derived-view-stale and synced-to-reader. Keep full learner input durable
before invoking AI. Back up consistently; after disk loss reconstruct from verified requests and
receipts without blindly replaying commits. External source producers/legacy writers still need
their own coordinated contracts. Prompt rules alone do not enforce filesystem permissions.

## Version-scoped native leases and evidence authority (0.6.0)
The latest report adds an installed queue candidate, not a working wake-up. A lease authorizes
neither broad default tools nor an arbitrary request-provided native target. Verify trusted
course/project/root/thread binding and effective permissions; require an independent terminal
result channel. Pending native approval pauses the job and must surface to the user, never be
satisfied by a Drive field. If the adapter cannot preserve approvals, block unattended dispatch.

On timeout, update/restart or reconnect, retain actual run/turn IDs and reconcile the original
turn before resending. Fencing prevents accepting obsolete results but cannot undo native work.
A visible answer or queue exit is not canonical-save evidence. A saved learner record with a
failed projection needs view repair only, not a second learner attempt.

Workers extend existing catalogs/assessments under their owners. Diagnostic hypotheses and
scheduling are operational records, not a parallel competence authority. The existing updater
and its protected publisher remain the source pipeline; the supervisor consumes their verified
receipts and drives only missing downstream processing. No additional scheduler is installed.
