# Architecture — selected build baseline 0.9.0

## One app, one execution host, existing academic owners

**Browser → Google Drive request/result transport → always-on Brain PC → exact native adapter → existing writers.**

The client is a React/TypeScript/Vite static SPA. On the PC a modular Python process coordinates
work. FastAPI serves only the optional local operator/status interface on loopback; remote phones
never pretend that their own localhost is the Brain. A small SQLite journal lives on nonsynced local
storage. SQLAlchemy/Alembic manage this operational database, not course-owned learning records.

The PC remains the normal execution host. Original course files remain in Drive, with existing
canonical source indexes, catalogs, attempts, correction chains, tracking and shared-learning owners.
New interaction snapshots and receipts use the existing operational role; source annotations extend
the source-link owner; concept/gap/progress views are generated. No duplicate graph, gap ledger,
learner attempt format or source-updater schedule is introduced.

## Browser distribution and data route

Build static assets with Vite. For cross-device access choose a versioned static HTTPS deployment
(Cloudflare Pages is the selected hosting target for the shell, subject to account/visibility/spending
approval). It stores app code only: no course files, conversations, Drive tokens, model keys or server
inference. An equivalent existing approved static host can replace it without changing data contracts.
The domain/account is an operator binding, not a design guess or a promise of free hosting. No inbound
public PC port or tunnel is required by the selected architecture. Local fixture development uses
localhost and must not be confused with cross-device production access.

The browser uses the official Google Identity Services token model and Drive v3 REST directly.
Full-archive reading requires an explicitly approved content scope; app-created requests use per-file
write scope where verified. A selected folder does not magically grant access to every child under
`drive.file`. Handle refused or partial grants without silently asking for full Drive write access.
The content-read scope may be broad at OAuth level: the application allowlist narrows behavior but
is not equivalent to a narrower provider grant. Actual scopes, account and configured origins are
proven in LL020. Short-lived access tokens stay in memory; renewal is user-driven when required.

The PC initially observes its existing DriveFS mount with bounded rescans. Events are hints, not
complete transactions. Request and result manifests are signed by paired device/Brain keys; all
payload hashes and allowed identities are checked. A compatible direct Drive change-cursor adapter
can replace rescanning only with its own explicit OAuth credentials/permissions and proof.

For large recordings the browser cannot append a bearer token to a durable URL. Use a measured
range-fetch/media adapter or prepared, versioned chunks read with authorization, bounded memory,
and ephemeral object URLs. Browser/codec/CORS/range support is tested, never inferred from a folder
listing. Desktop native Drive tools are separate from this browser client.

## Internal module boundaries

| Module | Input → output | Responsibility |
|---|---|---|
| web shell | routes + validated views → UI actions | Study/Review/Progress/Sources, light/dark, drafts, accessible media |
| transport | signed committed bundles → admission/result receipts | Identity, manifest verification, idempotency, no runtime command from payload |
| coordinator | eligible job + policy → one bounded native/tool action | Leases, fair work, cancellation, reconciliation, no LLM polling at idle |
| source/read adapters | actual owner records → typed read projections | Full inventory, source fidelity, versioned locators, no new authority |
| preparation | approved original material → candidate/confirmed owned annotations | Renditions, time alignment, source backed concepts, explicit gaps |
| tutoring | real question/response + permitted context → answer/proposed observations | Quick versus deep, pin rubrics, diagnosis, uncertainty |
| writer facade | verified sidecar + existing candidate → actual receipt | Exact proper writer, no-clobber, readback, view status separate |
| review | selected question + actual review event → due projection | One scheduler owner; no inferred forgetting or extra attempt |
| projections | canonical records + revisions → tree/gap/history views | Pure factual transforms; optional prose is attributed generated text |

## Native execution boundary

The reported installation exposes a candidate `codex queue` command; its default control connection
failed and no independent process-return path was verified. The adapter interface is finalized; the
installed transport binding is not fabricated. LL019 must prove the exact native target, effective
permissions, managed authentication, terminal result, interruption and tool availability. Existing
`send_message_to_thread` inside an agent is not proof a resident process can call it. No latest-thread
routing, private session database edits, desktop clicking, default danger-full-access inheritance, or
silently substituted `exec` worker/API conversation. If the desired route cannot be proven, the feature
stays disabled and the read-only interface remains usable until an explicitly revised requirement.

## Context and ownership

Every answer uses bounded actual context receipts. Course guidelines and references are read as
appropriate; request/source text never becomes an operating policy. Existing native context is not
assumed blind to previous solutions. Writer subprocesses run under their exact approved host/user/
interpreter and locks. A queue lock is not the tracking publisher lock. Uncooperative external writers
are explicit concurrency risk and cannot be made safe by pretending Drive sync is a distributed lock.

See [contracts](../engineering/interface-contracts.md), [stack](../engineering/stack.md),
[security](../engineering/security-and-privacy.md), and [one roadmap](../delivery/roadmap.md).
