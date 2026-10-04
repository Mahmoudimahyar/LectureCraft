# Installation, configuration and operation contract

This is the runbook to implement, not commands for a resident service already included here.
Actual implemented CLI names and receipts must be tested and documented by LL001/LL033 before use.

1. Create a separate private app checkout based on the reviewed Seed release. Do not `git init` or
   initialize the actual course/planner folders as an app. Preserve historical templates and records.
2. Resolve selected dependencies into real full lockfiles in isolated Python/Node environments. Never
   replace the approved Windows publisher interpreter with the app environment merely for convenience.
3. Run offline contract/fixture tests first. Start the app only with synthetic profile and explicit
   fixture banner; no native connection, Drive OAuth, recording, data capture or writes implied.
4. Bind planner/source roots from actual configuration. Inventory exact helper/schema hashes and lock
   behavior. Do not import a global-root writer and assume `--root` makes it harmless.
5. Review Google OAuth client, origin, scope and device pairing. Store keys in platform facilities,
   not .env, Drive notes or chats. Deploy only the static shell after explicit hosting/visibility grant.
6. Perform the defined disposable native and Drive proofs. Record exact runtime/version, target,
   permissions, tools and actual result path. A queue command or open app is not readiness.
7. Enable authorized real source reads and processing. Use existing updater ownership and a reviewed
   continuation policy for the full archive. No shadow schedule. Inspect quality and coverage gates.
8. Enable canonical learning publication only after sidecar, owner lock, crash/no-op/view-failure and
   restore tests. Retain `saved`, `already_saved`, blocked and incomplete distinctions.
9. Start the resident process as the approved interactive Windows user. Startup at login is optional
   and separately authorized. Lock-screen continuation, logout/reboot and update recovery are tests,
   not assumptions. Expose STOP and status through the local operator interface.

## Normal rounds and limits

One native turn at a time initially, plus one bounded deterministic preparation worker. Foreground
requests take priority between work units; fair background turns prevent starvation. Active rescan
5 seconds and idle 15 seconds are tunable initial settings, not promises about Drive latency. Keep
local queue/WAL off synced paths. A lease expiry alone never authorizes a duplicate canonical write.
Bounded retries are for known safe transport failures; ambiguous native completion is reconciled.

Pause on native version/auth change, unavailable canonical root, bad signature, grant revocation,
recovery-needed writer receipt, or explicit STOP. Finish/reconcile already committed operations and
report pending work. Do not kill another publisher, steal locks, reinstall native clients or change
firewall/sandbox settings automatically. Relevant queued input stays retained; unrelated source reading
can remain available. No tokens are spent on asking a model whether there is new work.

## Configuration needed from the operator (not more product brainstorming)

Actual planner path; approved publisher executable; paired device and Brain key IDs; Google client ID,
allowed origins/returned grants; native product/project/thread binding; enabled data-processing grants;
local nonsynced state location and capacity; selected media model/converter identities. None is invented
in this packet. Discovery tools may resolve them under permission. Secret values never go in chat or
checked-in `.env.example`. The app must explain each missing binding without switching technologies.

## Backup/update/restore

Before a migration, stop new admission, reconcile active effects and back up a consistent journal plus
referenced evidence. Verify restored copies with current compatible readers. Preserve newer canonical
records, including snapshots whose path contains `runs/`. Do not auto-restore a whole old course folder.
Version frontend assets independently; prompt to update without dropping a draft. Test native updates
and reconnect after reauth; the same old token/session path is not assumed valid. Keep at least one
verified compatible app backup until the replacement passes, with retention bounded by user policy.
