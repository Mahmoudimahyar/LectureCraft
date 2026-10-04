> Current implementation authority: [exact adapter contracts](../engineering/interface-contracts.md) and [R0–R5 backlog](../delivery/backlog.json). This retained design explains rationale; its earlier illustrative shapes and I/U sequencing are not competing schemas or schedules. Existing academic ownership constraints remain binding.

# Committed file request → exact native route → verified output

Version 0.6.0. Design only; no resident process, OAuth client, queue dispatch or save is installed.
P06 reports installed queue help but one failed default App Server control connection. The native
integration is **not operationally verified**. See [native bridge proof](native-bridge-proof.md).

## Preserve the user intent and exact runtime identity
One learner, all lectures, Drive-backed interfaces, the existing always-on Windows PC, dedicated
backlog-draining workflows and native OpenAI-first execution remain in scope. The reported login
category is ChatGPT, but that does not prove an ordinary ChatGPT conversation, desktop course tools,
or the effective settings of a selected Codex thread. Do not silently choose a separate CLI worker.

The resident supervisor's trusted mapping resolves course ID to canonical root, project, thread and
workflow policy. An incoming request selects an allowed action, not arbitrary executable/root/thread,
model, permission or spending. A readonly filesystem setting does not alone disable connector or
network tools; effective access and the human approval route are separate preconditions.

## Input transport and its limits
The proposed `.agent/learning-app/inbox/<request-id>/` contains readable `task.md`, structured
`request.json`, submitted content/attachments, then `ready.json` listing their hashes and lengths.
Draft edits do not trigger inference. Every submitted payload is immutable; edits create a linked
new revision. A per-workflow exported `task.md` is a generated dashboard, not a multiwriter queue.
This inbox location is still a proposed narrow extension, not installed course authority.

A filesystem event is a hint. A bounded rescan verifies every declared file and manifest before
admission; missing chunks wait. Local matching bytes establish the local bundle, **not** global
Drive freshness, final sync completion, remote durability or another device's receipt. A later
same-ID/different-content submission conflicts. Arbitrary mtime/size stability is insufficient.

Drive connector tools in an agent do not become companion credentials. An independent browser/PC
client needs its own approved API identity and scope, or a demonstrated supported existing route.
Repeated same-name uploads can be distinct Drive items: deduplicate by authorized actor, logical
request ID and content identity, never filename alone. Renames/versions need explicit binding.

A Drive changes cursor is an optional conventional fallback only after its client is authorized.
Persist cursor progress with admitted work; handle pages/reconnect/unknown fields. No public HTTP
listener, credential copying or new cloud service is required by this design. Missing checksum or
revision metadata remains unknown, not false proof. The report ends midway through its Drive
section; no unseen conclusions or tests are inferred.

## Do not create another source updater
User questions enter WF00 independently. For source changes, consume the existing course-source-
refresh source-audit and publication receipts through WF01. That updater stays the interpretation/
registration owner and its publisher stays the replacement authority. An approved small changed-
source receipt extension may reduce latency; do not install another scheduled updater or treat a
native completion notification as its final verified bundle. All lectures remain in coverage even
when current registration is partial or originals are unavailable.

## Native adapter selection: candidate, not certificate
P06 reports CLI 0.159.0-alpha.12.1 exposes `codex queue --thread <UUID> --message <TEXT>`. This is
installation-specific help evidence. Its process-facing terminal readback, failure, cancellation,
permission and desktop-session behavior remain untested. The one failed `app-server daemon version`
check returned Windows 10050; it does not prove the queue was tested, the desktop has no server,
or an updater/socket mismatch caused the failure. Do not fix speculative causes or expose ports.

Prefer this queue candidate for the exact-target proof only when the target and return path can be
established. Internal send_message_to_thread/read_thread/wait tools can cross-check; they cannot
stand in for the independent process's result channel. A queued exit is not a completed turn.
A newly launched exec/resume or stdio App Server is not assumed to own the desktop's course threads.

App Server remains an explicitly approved preview if used. Record the installed protocol and actual
thread/turn IDs; terminal completion differs from interruption acknowledgement. Configuration
changes may persist in a thread: do not borrow live coursework as a test target. Preserve managed
sign-in; no credential/session-database inspection, UI scraping, Git conversion, bypass flags or
silent model/API substitution. Effective danger-full-access defaults cannot be inherited blindly.

## Admission and work state
Use a local nonsynced transactional journal. Claim one job with request identity, input digest,
thread/course key, lease and generation. At most one active turn per thread. Idempotent admission
and publication are targets; exactly-once provider computation is not claimed. A timeout after
possible acceptance enters uncertain-completion reconciliation, not automatic resend.

On cancellation or source/provider-policy changes, fence the obsolete generation. Preserve the
late result but prevent it from publishing as current. The supervisor drains authorized runnable
jobs and waits at idle without model calls. WAITING_USER/SOURCE/REVIEW, AUTH_REQUIRED, QUOTA_WAIT,
STOP and unresolved results are visible; they do not become successful completed tasks.

## Canonical output and complete response memory
Capture/read back the full learner input in the existing operational run area before inference.
The later tutor reply is another immutable message, not an update to that hashed input. The new
wrapper checks sidecar existence, digest, attachment/item/course/question identity and excerpt
correspondence; the existing nonempty locator check is not enough. Follow the
[full-turn contract](full-turn-snapshot-contract.md).

The correct course writer handles learning; the separate tracking publisher handles tracking.
Other courses' common save facade is not implemented. BE 505 global-root save/refresh must not be
called on a purported fixture by passing --root. A written attempt followed by view failure is a
saved record plus a stale view, not an all-or-nothing failure warranting a new attempt.

Return native completion, raw response saved, assessment proposed, canonical evidence saved,
derived view current and second-device visibility as distinct facts. Final output bundles carry
request/generation/source/record IDs and hashes. Publish the local manifest after readback; remote
clients verify it against actual files and can retain the last complete view during partial sync.
