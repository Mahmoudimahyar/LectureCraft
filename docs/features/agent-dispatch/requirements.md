# Current UI requirement index — agent-dispatch, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| agent-dispatch:REQ-101 | US049 | See what is actually happening | UI25 |
| agent-dispatch:REQ-102 | US050 | Cancel and retry safely | UI25 |
| agent-dispatch:REQ-103 | US053 | Keep studying during interruptions | UI27 |
| agent-dispatch:REQ-104 | US054 | Recover without unexpected spending | UI27 |
| agent-dispatch:REQ-105 | US057 | Know the actual AI destination | UI29 |
| agent-dispatch:REQ-106 | US058 | Set boundaries once | UI29 |
| agent-dispatch:REQ-107 | US063 | Understand repair actions | UI32 |
| agent-dispatch:REQ-108 | US064 | Verify recovery effects | UI32 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Agent dispatch requirements — discovery draft

U4 = the user's new file-trigger/native-agent request. P04 = the supplied operational report.
All mechanisms remain proposed; actual account/provider capabilities and data permissions OPEN.

| ID | Status | Behavioral contract |
|---|---|---|
| dispatch:REQ-001 | USER-REQUESTED | A submitted slide question can be routed to the user-selected ChatGPT or Claude surface and its answer returned to the app. Exact surface and session needs OPEN. |
| dispatch:REQ-002 | USER-REQUESTED | Persist human-readable question/answer handoffs without requiring a separately configured paid-model API as the assumed default. Whether authorized subscription-backed Responses is acceptable is OPEN. |
| dispatch:REQ-003 | PROPOSED | One explicit submit commits one immutable request; autosave, duplicate file events and answer writes must not invoke extra runs. |
| dispatch:REQ-004 | PROPOSED | Route by exact course/thread/provider binding. A different course's most recent native conversation must not be selected. |
| dispatch:REQ-005 | PROPOSED | A receiver acknowledgment is not a completed answer. UI distinguishes waiting, running, needs-input, blocked, unknown completion, failed and validated result. |
| dispatch:REQ-006 | PROPOSED | Native/provider quotas and unavailable features pause the request; no silent billed-API fallback or credential extraction. |
| dispatch:REQ-007 | PROPOSED | Late/retried/cancelled results cannot overwrite the currently accepted result or create duplicate student evidence. |
| dispatch:REQ-008 | PROPOSED | Preserve actual learner input/exposure/timestamps; model output is not a learner attempt. |
| dispatch:REQ-009 | PROPOSED / P04 | Invoke compatible existing course validators/writers for meaningful assessment publication; append linked corrections and preserve original attempts. |
| dispatch:REQ-010 | PROPOSED | Source locators and revisions supplied to the agent are current and scoped; assistant citations resolve to those same artifacts. |
| dispatch:REQ-011 | PROPOSED | Resume after local/helper/native restart by reconciling durable state; no blind reissue of unknown remote work. |
| dispatch:REQ-012 | PROPOSED | Prove a real native/account end-to-end roundtrip before labeling an adapter verified. Config presence and mocked tests are insufficient. |
| dispatch:REQ-013 | PROPOSED | Local helper and callbacks enforce origin/auth, path scope, payload bounds and safe rendering. No event/source text can grant filesystem or billing authority. |
| dispatch:REQ-014 | PROPOSED | Existing source browsing works while any AI provider is disconnected or blocked. |
| dispatch:REQ-015 | PROPOSED | Personal/native use and future multi-user distribution have distinct provider-policy reviews; one owner's subscription is not an assumed shared service credential. |

Non-goals: edit private client databases; silently install a plugin or schedule; scrape chat UI for
completion; build a distributed worker fleet; infer mastery from a finished request; auto-regenerate
stale course views without authorized scope; or require every provider to support every modality.

See [the protocol](../../project/dispatch-protocol.md), [research](../../research/agent-dispatch-feasibility.md)
and [existing contracts](../../project/existing-workspace-contract.md).

## Actual runtime identity after P05

ChatGPT is the user-selected first target. All six observed local course/planner projects in
P05 are Codex desktop projects. Reported native `send_message_to_thread` was not invoked and
is not an external ChatGPT endpoint contract. The selected adapter must establish actual
product/surface/project identity and permitted caller; do not treat scheduling success as a
per-question roundtrip. A request remains blocked or clearly manual if the intended route is
unavailable. No change to the requested provider or final UI placement is implied by a prototype.

Cross-device Drive reading and canonical save are separate capabilities. Native-in-chat UI,
standalone web UI, hosted bridge and writer placement remain design alternatives. All states
in [the protocol](../../project/dispatch-protocol.md) must work without assuming that local
G: exists on the viewing device. A queue does not itself keep a local AI session awake.

## Compatibility gate — 0.6.0
An installed queue command is a candidate only. The resident process must prove exact approved
native target and independent terminal-result retrieval. Native agent tools and CLI workers are
not interchangeable merely because UUIDs/logins look similar. Effective permissions and tool
capabilities must be established per target; broad config defaults may not be inherited silently.
A pending update/unknown outcome blocks unsafe retries. Follow the prepared-only native proof.
