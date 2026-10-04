# Current UI requirement index — workspace-access, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| workspace-access:REQ-101 | US001 | Connect without reorganizing | UI01 |
| workspace-access:REQ-102 | US002 | Understand permissions | UI01 |
| workspace-access:REQ-103 | US003 | Use another device | UI02 |
| workspace-access:REQ-104 | US004 | Sign out safely | UI02 |
| workspace-access:REQ-105 | US005 | See every lecture | UI03 |
| workspace-access:REQ-106 | US006 | Resume the right lecture | UI03 |
| workspace-access:REQ-107 | US007 | Find relevant material | UI04 |
| workspace-access:REQ-108 | US008 | Return after exploring | UI04 |
| workspace-access:REQ-109 | US009 | Add without duplication | UI05 |
| workspace-access:REQ-110 | US010 | Know preparation status | UI05 |
| workspace-access:REQ-111 | US051 | Continue naturally | UI26 |
| workspace-access:REQ-112 | US052 | Resolve conflicts without losing responses | UI26 |
| workspace-access:REQ-113 | US055 | Study comfortably day and night | UI28 |
| workspace-access:REQ-114 | US056 | Preserve sources and focus when theming | UI28 |
| workspace-access:REQ-115 | US059 | Take my study history with me | UI30 |
| workspace-access:REQ-116 | US060 | Control retention honestly | UI30 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Portable course and source access — draft

The user selected Google Drive materials and cross-device use. Existing P05 folder IDs and
local source references are evidence to seed a resolver, not proof a portable UI is running.

| Requirement | Observable outcome / failure boundary |
|---|---|
| access:REQ-001 | Open configured course/lecture/source views on an approved second device without a G: mount. |
| access:REQ-002 | Resolve course/source/version/anchor to the expected authorized object and rendition. Same-name backup/candidate folders never win accidentally. |
| storage:REQ-001 | Preserve original identity and requested version through moves/renames; replacement or inaccessible old content becomes explicit unavailable/stale state. |
| storage:REQ-002 | Play and seek authorized original media using a verified retrieval path, without publishing signed URLs or credentials as durable identifiers. |
| storage:REQ-003 | Show all-lecture inventory states independent of source-index coverage. Missing/empty/unrecorded is not classified as still-processing forever. |
| storage:REQ-004 | Limit data to selected sources and approved processing. Permission changes are checked again at use; source content cannot expand tool authority. |
| storage:REQ-005 | Keep response staging, UI resume and assessed course evidence separate; label canonical receipt and derived-view freshness independently. |

Potential implementation: official Drive client/HTTP read primitives, an authenticated portable
resolver and version-keyed cached renditions. Runtime/provider/storage library choice is not made
here. Credential/account access and hosted material transfer require approval. No new app account
or Drive file mutation is created by defining this feature. See [P2](../../project/probe-and-acceptance-plan.md).

## Distinguish actor access and observed completeness
A Drive connector usable by one native agent does not establish a browser/companion OAuth client
or its write scope. Missing requested metadata stays unknown. Multiple same-name items need
content/request identities; a locally complete bundle is not remote delivery/freshness proof.
Filesystem notification is a rescan hint, not evidence that every file has synchronized.
