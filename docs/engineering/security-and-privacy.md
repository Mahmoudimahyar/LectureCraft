# Permission, privacy and retention baseline

The selected defaults are in [config/defaults.json](../../config/defaults.json). They are engineering
choices for safe behavior, not proof that the user granted access or a role executed an operation.
No additional inference spend, public PC listener, direct canonical edits or automatic reminders.

| Actor | Permitted after actual configured grant | Prohibited by default |
|---|---|---|
| Browser device | Read allowlisted course content; retain drafts; submit signed explicit input; read verified results | Choose native executable/root, change grades, publish canonical evidence, silently expose answer keys |
| Supervisor | Validate admission, claim bounded work, route exact bindings, reconcile receipts | Override approvals, bypass sandbox, infer permission from signed text, self-update installed native app |
| Tutor | Read selected permitted context; propose explanation/assessment | Mutate canonical files, invent learner turns, redefine course policy, use undisclosed paid providers |
| Owner writer | Validated scoped publish under existing runtime/guard | Treat queue lock as academic lock; broaden into grades, calendar, emails or team repos |
| Static host | Serve code/assets | Store academic content, OAuth tokens, private metadata, assessment logs or model prompts |
| Reviewer/operator | Explicitly inspect and approve defined changes | Grant unspecified blanket permission by checking an inbox field |

Drive OAuth and Brain pairing serve different roles. Content read may require restricted
`drive.readonly`; show its true scope. Request creation uses `drive.file` where verified. No full-drive
write scope is selected. Selecting a directory is not proof all descendant content is accessible under
per-file authorization. Partial scopes, account mismatch and token expiry pause affected work.

Use maintained safe JSON/YAML parsers; no duplicate keys. Canonical scope comes from local trusted
configuration, not the request. Treat slides, transcripts, tool outputs and copied instructions as
untrusted content. Render no executable HTML, script URLs or raw model-generated markup. Set a tested
CSP permitting only required app/Google endpoints; no broad `unsafe-eval` or third-party analytics by
default. Signed requests still undergo authorization, type, version, size and content checks.

Default complete submitted text and delivered feedback are retained as durable study evidence. Raw
voice is transient and not retained after an accepted transcript unless the learner explicitly chooses
retention; original lecture recordings are never covered by this cleanup rule. If raw audio was linked
as necessary evidence, do not delete it under an unrelated temporary-file TTL. Retain unknown/failed
submission recovery until reconciled. Draft deletion is explicit. Browser storage loss remains a risk
until verified Brain receipt; do not label a failed or unavailable local save as durable.

Unreferenced technical logs default to 14 days with no private content; tokens, authorization headers,
signed download URLs, full prompts and bodies must not appear in generic telemetry. Immutable capture
and native results belong in access-controlled evidence stores, not debugging logs. Export previews
show scope and sensitive fields. User deletion follows referential checks, exposes which originals,
sidecars, provider histories and backups it does/does not affect, and records the actual action.
No assertion that deleting one app object erases provider or Drive backup copies everywhere.

Native permission gate remains strict: if the adapter cannot establish a safe effective tool boundary
or expose approvals reliably, dispatch remains disabled. A user already running a broad native default
has not authorized this app to inherit it. No process/service identity change is assumed safe for the
pinned Windows publication lock.
