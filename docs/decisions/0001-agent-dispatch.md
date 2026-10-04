> **Historical 0.4.0 decision discussion.** Current host placement and workflow direction are superseded by [ADR 0003](0003-always-on-brain-pc.md). Native capability claims below were proposals/research, not installed acceptance.

# D09 — file-based handoff with supported agent adapters

> Status note added in 0.4.0: earlier provider/local-pilot options are historical research,
> not current accepted choices or installed features. The user selected ChatGPT first,
> all lectures, and Drive-backed cross-device access. P05 identifies existing Codex projects
> separately. Use [current reconciliation](../reviews/audit-reconciliation-2026-10-02.md)
> for what is established, and do not activate the older options from this file alone.


Status: **PROPOSED / user choice and native verification pending**. Date: 2026-10-02.
This is not authorization to install, connect, send private content, schedule, or implement.

## Request

Use existing ChatGPT/Claude tools as the learning reasoning layer: a slide question is saved,
a workflow runs in the selected tool, and the answer returns to the app without a separate
paid API being the assumed default. Preserve existing course learning records and workflows.

## Decision fork

**Native-conversation path:** investigate Claude Code Channels and subscribed ChatGPT Work
Events, where the actual account/client allows them. Keep persistent session/subscription IDs.
This best preserves the requested native experience but depends on previews, cloud-mode/data
permission and distinct protocols. It does not control any arbitrary ordinary desktop chat.

**Usage/cost path:** if the aim is plan allowance rather than the existing native conversation,
evaluate official local Sign in with ChatGPT plan usage. It is still Responses API and does not
inherit chat history. Native Claude CLI execution is another candidate for personal on-demand
work. Codex is only an explicit alternative, never a silent substitution for requested ChatGPT.

**Fallback:** a manual user-confirmed handoff when supported automatic entry is unavailable.
Do not use UI clicking, stolen cookies, private endpoints, unlimited AI polling, or one mutable
prompt file as the production interface.

## Shared architecture proposed

One small authenticated local companion; request IDs and immutable bundles; bounded adapters;
context/permissions fixed from trusted configuration; staged results; deterministic validation;
existing course writer as the sole canonical-save boundary; UI status separated from learning
state. Files stay the inspectable record, not the scheduling logic or credential store. Remote
provider/cloud inputs require explicit separate permission from file storage location.

## Conditions before selecting an adapter

Confirm exact app/mode/version/account, available feature flags, current authentication/billing,
acceptable cloud processing, and desired preservation of native history/tools. Prove one real
user-authorized roundtrip with synthetic course input, including permission denial and duplicate
completion. Then try one authorized real source bundle and a staged record validated by the
existing contract before enabling production writes. No test results are claimed now.

## Costs and tradeoffs

Local native sessions avoid building their entire context/workflow layer, but require session
lifecycle and account constraints. An app-controlled runtime simplifies UI/results but needs its
own context and tool implementation. Both use limited allowances and provider processing. A
public hosted product has different access/terms requirements from a private native extension.
Prefer the smallest eligible route over a multi-provider orchestration system built on guesses.
