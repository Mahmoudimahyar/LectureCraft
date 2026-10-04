# Native-agent and subscription-backed dispatch — research, 2026-10-02

> Status note added in 0.4.0: earlier provider/local-pilot options are historical research,
> not current accepted choices or installed features. The user selected ChatGPT first,
> all lectures, and Drive-backed cross-device access. P05 identifies existing Codex projects
> separately. Use [current reconciliation](../reviews/audit-reconciliation-2026-10-02.md)
> for what is established, and do not activate the older options from this file alone.


Status: researched feasibility, not an installed or tested integration. The user's goal is
an app question → file handoff → selected ChatGPT/Claude workflow → persisted answer → UI.
No provider is selected or authenticated here. All account, rollout, platform, compatibility,
permission and latency claims need a native acceptance test on the actual installation.

## Two materially different goals

1. Preserve a particular native conversation, its available tools and its ongoing workflow.
2. Avoid separately configured/billed inference keys, while supplying context from this app.

Those are not equivalent. File persistence is orthogonal: either route can retain request.md
and answer.md. Using a native app still invokes a provider remotely; using subscription-backed
Responses is still an API even without a separate developer key. A browser-to-local bridge also
has an interface. We should promise no *unapproved paid-model fallback*, not zero interfaces.

## Supported routes to verify

| ID | Surface | Relevant capability and limit | Research basis |
|---|---|---|---|
| R17 | Claude Code Channels | Pushes to an already running opted-in session; two-way reply tools; preview/allowlist restrictions. | [Channels](https://code.claude.com/docs/en/channels) |
| R18 | Claude channel protocol | Local stdio server plus event and reply tools. Ordinary MCP configuration alone does not start a turn. | [Reference](https://code.claude.com/docs/en/channels-reference) |
| R19 | Official fakechat demo | Browser → Code session → browser. Development fixture, no durable history or production access model. | [Anthropic source](https://github.com/anthropics/claude-plugins-official/blob/main/external_plugins/fakechat/README.md) |
| R20 | Claude native CLI | `claude -p` supports noninteractive execution and structured output; review its loaded instructions/permissions. | [Programmatic use](https://code.claude.com/docs/en/headless) |
| R21 | ChatGPT Work MCP Events | Subscribed Work Cloud chats receive signed webhooks. It is not an arbitrary local-file trigger in any ordinary chat. | [Events](https://developers.openai.com/plugins/build/mcp-events) |
| R22 | Sign in with ChatGPT | Authorized plan usage for eligible open-source/local apps; still Responses API; existing chats are not exposed. | [Overview](https://developers.openai.com/siwc/token-sharing-open-source) |
| R23 | Plan-usage preview constraints | Restricted Responses features; no audio/video or transcription API through this route. | [Limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) |
| R24 | Official Paste Perfect example | September 28, 2026 example of an open-source local app using authorized ChatGPT plan allowance without a user API key. | [Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) |
| R25 | Native-auth boundaries | Native Claude use versus third-party service credential intermediation; do not collect or relay Claude.ai tokens. | [Legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) |
| R26 | Runtime auth choice | Claude Code subscription/Console/provider paths differ; inspect the active path rather than infer billing from absence of a key. | [Authentication](https://code.claude.com/docs/en/authentication) |
| R27 | CLI alternative for OpenAI | Codex noninteractive execution is a possible explicit alternative, not the user's existing ChatGPT chat. | [Noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |
| R28 | Scheduled desktop tasks | Local timed jobs need an awake machine/app; timing is not an immediate file-change trigger. | [Claude scheduling](https://code.claude.com/docs/en/desktop-scheduled-tasks) |
| R29 | File watcher reuse | Chokidar handles filesystem notification details; a watcher is not a durable job queue. | [Maintainer repository](https://github.com/paulmillr/chokidar) |
| R30 | Plan-usage availability | Eligible Plus/Pro flows require explicit authorization; broader commercial/hosted availability is restricted. | [Quickstart](https://developers.openai.com/siwc/quickstart) |

These are official product/maintainer descriptions, not observations on this user's computer.
We found concrete official recipes, not evidence that an arbitrary community desktop wrapper
is stable, permitted or has learning-workflow correctness. No third-party plugin was installed.

## Compatibility details that could invalidate a naive implementation

ChatGPT's Events documentation requires MCP 2.0 revision 2026-07-28 and persistent webhook
subscriptions. The current Claude channel documentation explicitly says a v2-runtime channel
negotiating that revision does not register. Use separately pinned adapter contracts, not one
undifferentiated MCP event implementation. Existing Seed code/doc retrieval is not automatically
this application's event transport. An ordinary successful MCP tools/list is insufficient.

A ChatGPT webhook 2xx is receipt, not completed work. Delivery may be asynchronous, batched or
out of order; writes must be idempotent. Claude transport notification completion similarly
is not model acknowledgement. Require an application-level claim/result and visible timeout.
A dropped or rejected channel must never look like a completed answer in the app. [R18,R21]

Claude custom channels need applicable preview/admin permission or explicitly consented local
experimental testing. Do not silently enable development bypasses, replace an approved plugin,
or disable permission checks. The first native acceptance must inspect actual startup registration,
not just availability of a --channels flag. Native Code and ordinary Claude Desktop Chat/Cowork
are different surfaces and require separate proof. [R17-R18]

Do not add `--bare` to a subscription-backed Claude command without reading its auth semantics:
it skips OAuth/keychain and expects API/provider credentials. Normal `-p` loads configured
context/hooks/MCP without the same interactive trust ceremony. Use reviewed working/configuration
roots and explicit permissions; incoming course content cannot choose execution commands. [R20]

## Conditional recommendation

For the user's literal native-session goal, investigate Claude Code's documented two-way channel
and ChatGPT Work's subscribed Events path, contingent on the actual installed/account support.
For personal queued work without a permanently open session, investigate native CLI execution
with explicit session IDs, visible auth/billing and bounded tools. Never select the globally
most-recent session to answer a request from another course.

If the main goal is existing-plan usage rather than the native conversation, evaluate official
Sign in with ChatGPT. Its client must provide the course context; it does not inherit chat
history. Text/image/file support is model-dependent; audio and transcription need another
approved path. Do not advertise this as native ChatGPT voice/Deep Research/tool parity. [R22-R24]

Subscription allowance is limited, not free/unlimited compute. The app must pause on quota,
auth or consent failures and ask before changing provider or billing path. A user's authenticated
native tool is not permission to relay all classmates' work through one personal account.
Commercial/hosted distribution needs a fresh policy and provider-access review. [R25,R30]

## Rejected primary approaches

Do not base the core product on mouse coordinates, clipboard scraping, undocumented private
endpoints, copied browser cookies, or native app database edits. This is a maintainability and
security design decision, not a claim that every automation tool violates every provider rule.
Do not replace events with repeated AI polling just to check whether a file changed. A manual
one-click handoff is an honest fallback when a route is unavailable; it is not full automation.

## Verification status

Public primary sources reviewed. No desktop client, subscription entitlement, provider call,
model capability, file watcher, cloud relay, native plugin, scheduling feature or end-to-end
roundtrip was tested. No runtime/backend choice is approved. See the [acceptance plan](../project/testing.md)
and [decision fork](../decisions/0001-agent-dispatch.md).
