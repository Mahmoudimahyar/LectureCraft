# Focused dispatch documentation recheck — 2026-10-02

> Status note added in 0.4.0: earlier provider/local-pilot options are historical research,
> not current accepted choices or installed features. The user selected ChatGPT first,
> all lectures, and Drive-backed cross-device access. P05 identifies existing Codex projects
> separately. Use [current reconciliation](../reviews/audit-reconciliation-2026-10-02.md)
> for what is established, and do not activate the older options from this file alone.


Purpose: keep a major decision in the whole-project review grounded in current primary sources.
This does not repeat the whole competitor or learning-science survey. None of the following
was tested against the user's installation; no integration or privacy choice is approved.

## Official documentation observed

**Claude Code Channels:** current documentation describes event delivery into an already-running,
opted-in session, research-preview status and account/organization controls. A successful
configuration is not proof that the actual channel registered, returned an answer, or respected
this application's course boundary. The fakechat example is a useful synthetic experiment, not
our reliable production queue. [S1]

**Claude Code programmatic use:** `-p` supports noninteractive calls. The documented `--bare`
path changes context/auth behavior and does not use subscription login. A chosen scripted path
must inspect actual permissions, loaded hooks/context and billing rather than adding flags
because they sound safer or cheaper. [S2]

**ChatGPT MCP Events:** official instructions describe subscribed Work chats, with Work/Cloud
selection on desktop. A webhook acknowledgment is receipt, not completed reasoning; asynchronous,
batched or out-of-order events require request IDs and idempotent final publication. This does
not establish arbitrary ordinary desktop-chat file triggering. [S3]

**Sign in with ChatGPT plan usage:** official documentation offers eligible plan-backed Responses
requests for the described open-source/local integrations, but explicitly does not provide
existing ChatGPT conversations or account context. It is an API route and requires an explicit
choice separate from the native-chat goal. [S4]

**Plan-usage preview constraints:** the documented route supports model-appropriate text/images/files
but not audio/video input or the transcription API. Voice capture/transcription and native feature
parity therefore remain separate design and consent decisions. [S5]

## Decision consequence

Keep G03 unresolved until the user selects the required experience. G04 requires actual version,
account, surface and feature verification; do not silently switch to Codex, a different native mode
or separately billed inference. The first test should use synthetic material, limited tools and a
complete request/response callback, including failure/duplicate cases. Source or marketing pages
are not native acceptance evidence, and a user requesting a review does not authorize that test.

## Sources (accessed 2026-10-02)

- S1: https://code.claude.com/docs/en/channels
- S2: https://code.claude.com/docs/en/headless
- S3: https://developers.openai.com/plugins/build/mcp-events
- S4: https://developers.openai.com/siwc/token-sharing-open-source
- S5: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

Repository snapshots and protocol versions must be pinned/rechecked at implementation; this is
current source review, not executable integration metadata or a guarantee of the user's rollout.
