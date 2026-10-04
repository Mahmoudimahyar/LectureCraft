# agent-dispatch — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

## UI25 — Inspect, cancel and recover a request

**Feature:** `agent-dispatch` · **Stories:** US049, US050 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M03, M06, M07, M12, M14 · **Screens:** SC12, SC04, SC14

**Trigger:** Open Activity, a submission status chip or a pending-result notification.

### Preconditions
- Request, turn, native run, write receipt and view state are separately identifiable.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open request detail | See source/course, actual destination and input/transport/execution/save phases. |
| 2 | Navigate elsewhere while it runs | Pending result stays in Activity; completion does not steal the current lecture. |
| 3 | Choose Cancel | Show Cancellation requested until terminal state is verified; preserve captured learner input. |
| 4 | If interrupted, choose Check status | Reconcile existing native/writer receipts before offering a safe retry. |
| 5 | Retry or choose another explicitly approved route | Preserve the same logical learner response and new dispatch identity; obsolete results cannot overwrite the accepted generation. |

### Alternatives and failure paths
- An unknown possible completion is not automatically retried.
- A late response after cancellation is retained as late/obsolete, not displayed as the current result or auto-published.
- No real learner attempt is erased by cancelling model generation; deleting data is a different scoped operation.

### Read dependencies
- Committed request/input, native state and writer/view receipts

### Writes and owner
- Cancellation/reconciliation/dispatch-attempt records through supervisor
- No forged approval or new learner attempt from retries

### Completion
- Each job has an honest status and permitted next action; terminal publication uses current identity/generation.

### Responsive / accessibility details
- Status text and expandable details instead of fake percent-complete animation.
- Important approval/cancel actions retain focus and clear consequence copy.

**Related existing planned cases:** AC01, AC02, AC03, AC05, AC07, AC08, AC32, AC41, AC42, AC44, AC45, AC48, AC62. These remain NOT_RUN and are not replaced by the new UI cases.

## UI27 — Continue during network, quota or native failures

**Feature:** `agent-dispatch` · **Stories:** US053, US054 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M01, M06, M12, M14, M15 · **Screens:** SC04, SC12, SC13

**Trigger:** Connectivity, storage, authentication, quota or native execution becomes unavailable.

### Preconditions
- Always-on PC is a normal availability assumption, not a no-failure guarantee.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Inspect the connection banner | Identify device/Drive/Brain/native/writer issue without exposing credentials. |
| 2 | Continue permitted cached browsing or drafting | Mark cache age and actual draft durability; unavailable files do not pretend to be offline-ready. |
| 3 | Submit while delivery is unavailable | Offer an explicitly retained outbox item only when persistence succeeds; otherwise offer export/copy and a clear warning. |
| 4 | Reconnect or reauthenticate through the supported flow | Reconcile committed bundles and prior effects before dispatching. |
| 5 | Resume an eligible task | Apply limits and permissions; no silent provider, model-API or account substitution. |

### Alternatives and failure paths
- Browser storage full/private-mode limits mean Local save failed, not Saved offline.
- The app never claims universal offline playback or worker availability on a sleeping/logged-out PC.
- Repeated failures isolate that request; they do not create an infinite reasoning loop.

### Read dependencies
- Connection/capability status, cache manifest, local draft and pending request state

### Writes and owner
- Local/transport outbox when supported, health/reconciliation receipts
- No unapproved spending, service restart or provider reconfiguration

### Completion
- The learner knows what is retained and what is blocked; recovery neither loses input nor duplicates committed effects.

### Responsive / accessibility details
- Persistent relevant errors have readable recovery actions; do not spam repeated toasts.
- Offline banner is textually distinct from an empty course or no learning evidence.

**Related existing planned cases:** AC07, AC34, AC35, AC36, AC38, AC45, AC48. These remain NOT_RUN and are not replaced by the new UI cases.

## UI29 — Configure provider, assistance and operating limits

**Feature:** `agent-dispatch` · **Stories:** US057, US058 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M03, M12, M13, M14 · **Screens:** SC13, SC12, SC01

**Trigger:** Open Settings → AI and Brain, or a missing-capability action.

### Preconditions
- Actual product/surface is displayed independently of sign-in category; no user task can set permissions.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open AI and Brain | Show installed, configured, verified and unavailable capabilities separately with last proof/version scope. |
| 2 | Inspect data/context settings | Select permitted content categories and default help preferences without treating them as live actor grants. |
| 3 | Choose a supported provider route | Preview actual product/thread/mode and separate activation/permission needs. |
| 4 | Set approved operating limits | Specify no additional inference spend by default, background priorities and explicit pause behavior. |
| 5 | Apply allowed preferences | Changes affect future requests; current request identity, question and assessment conditions remain unchanged. |

### Alternatives and failure paths
- An experimental candidate remains labeled and unverified until its real acceptance passes.
- Changing provider after submission creates a new explicit dispatch under the same learner input, not a new attempt.
- No token/cookie copy, global permissive sandbox inheritance, automatic install or silent capability substitution.

### Read dependencies
- Verified bindings/configuration, trusted course policy, allowed budgets and consent policy

### Writes and owner
- Owned configuration/preferences and approval-required change proposal, not arbitrary canonical writes

### Completion
- The user can distinguish configured intent from tested capability and control future behavior safely.

### Responsive / accessibility details
- Advanced details stay collapsible; core status is understandable without reading tool logs.
- No unsafe one-click Disable safeguards button.

**Related existing planned cases:** AC05, AC06, AC39, AC41, AC42, AC43, AC44, AC47. These remain NOT_RUN and are not replaced by the new UI cases.

## UI32 — Inspect and authorize a bounded repair

**Feature:** `agent-dispatch` · **Stories:** US063, US064 · **Status:** specified, not implemented

**Workflows:** WF01, WF09, WF10, WF11 · **Memory:** M01, M02, M07, M09, M14, M15 · **Screens:** SC13, SC15, SC12

**Trigger:** A stale view, source inconsistency or interrupted publication requires operator attention.

### Preconditions
- Same person acting as operator; actual owner/permissions and safe runtime constraints still apply.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open maintenance detail | Explain whether the problem is source availability, invalid record, stale view or uncertain publication. |
| 2 | Choose an offered safe repair preview | Show exact inputs, target owner, expected writes, dependency effects and what will remain unchanged. |
| 3 | Approve the specific allowed operation | Run under the correct verified writer identity; no restart/install/permission expansion is hidden. |
| 4 | Inspect receipt and readback | Distinguish repaired projection, original evidence already saved, blocked dependency and unresolved native outcome. |
| 5 | Return to studying | Only affected views change; prior history and unrelated jobs remain intact. |

### Alternatives and failure paths
- No live call to a global-root writer is made under the fiction that --root safely redirects it.
- A stale summary can be rebuilt; missing original content cannot be invented from that summary.
- Unknown native completion is reconciled, not reset by deleting locks or creating a new attempt.

### Read dependencies
- Existing owner validators, current-state/source hashes, repair/recovery contract

### Writes and owner
- Authorized owner repair, readback and recovery receipts; no new learner performance

### Completion
- A bounded repair has verified effects or a specific blocked outcome without collateral changes.

### Responsive / accessibility details
- Plain explanation first with technical evidence expandable.
- Approval screens identify changes clearly and never equate a task-file flag with human approval.

**Related existing planned cases:** AC31, AC34, AC37, AC38, AC45, AC51, AC55, AC56, AC73, AC74. These remain NOT_RUN and are not replaced by the new UI cases.

