# Public-interface recheck versus the installed report

Checked 2026-10-03. Public pages may be newer than the reported alpha binary. They explain candidate
semantics, not the user's installed reachability, subscriptions, flags or effective permissions.
P06 is the supplied partial report; this session made no native process or Drive API call.

| Reference | Narrow supported conclusion |
|---|---|
| [App Server](https://developers.openai.com/codex/app-server) | Thread/turn protocol and terminal notifications are documented. Its app-server/WebSocket deployment carries an experimental warning. Per-turn model/cwd/sandbox overrides can become later thread defaults. |
| [CLI reference](https://developers.openai.com/codex/cli/reference) | General command documentation; the inspected page did not contain `codex queue`. Installed queue help in P06 is installation evidence, not proof of a stable published queue contract. |
| [Noninteractive mode](https://developers.openai.com/codex/noninteractive) | Explicit exec sessions and output are available; this does not prove equivalence with a particular desktop thread. |
| [Authentication](https://developers.openai.com/codex/auth) | ChatGPT and API-key sign-in are distinct; identity must remain managed by the supported client. |
| [Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes) | Cursor-based change retrieval is documented; the calling application needs its own authorized client context. |
| [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) | Scope selection is explicit; another agent's connector availability grants no credentials to a new app. |

Reported queue help is not invalidated by absence in a public reference, nor promoted to operational
support by generic docs. Do not use a new public flag against the installed build without checking
its actual help/schema. The pending update and default socket failure have no established causal
relationship. The first proof must match exact runtime/endpoint/thread identity, with no credentials
copied and no unsolicited transport exposure.

A read-only filesystem setting alone is not a guarantee against connector side effects. Verify
all relevant tools/approvals for a disposable target; do not globally lower safeguards or modify a
real course's per-turn defaults. No test call, native update, Drive upload or protocol repair was
performed during this recheck. No claim of model quality or cost improvement follows from it.
