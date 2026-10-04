# Versioning and compatibility policy

## Independent version spaces

| Item | Current baseline / future format | Meaning |
|---|---|---|
| Seed Repo | Reference foundation 0.5.0-rc.1 | Upstream developer tooling; not bundled or newly verified here. |
| This build/spec packet | 0.9.0, immutable archive + SHA-256 manifest | Engineering baseline, not an app release or percentage complete. |
| Application | First executable candidate `0.1.0-alpha.1`; later whole product `1.0.0-rc.1` | Version only when actual code/behavior is built and tested. |
| New wire contracts | `ll.<name>/1`, schema-set 1.0.0 + exact schema hash | Independent of UI releases; existing course schemas unchanged. |
| Existing sources/rubrics/attempts | Existing stable identities and revisions | Never renumber or rewrite to match a new app version. |
| Generated view | Input hashes, generator/policy revision, generation | Replaceable output; no independent learning fact. |
| Native adapter | Executable/protocol version + binding fingerprint + capability receipt | Reverify after runtime changes before enabling dispatch. |

A patch release fixes behavior without changing promised external contracts. A minor app release adds
compatible behavior. Breaking app interfaces require a major app release after 1.0; pre-1.0 releases
must still document compatibility and never silently corrupt data. Published tags/assets are immutable.
Do not call this packet an installed 0.9 application.

## Strict wire evolution

The schemas deliberately reject unknown fields. Consequently, adding a field is not automatically
compatible with older readers. Emit a new contract-major for changed accepted shapes/meaning, or keep
emitting the old complete shape to old clients after explicit capability negotiation. A documentation
clarification changes no wire version; a validation change that rejects formerly valid records is not
silently shipped as a patch. Save the raw original record and selected schema identity. Unknown major
versions pause and request an update; never strip fields and pretend validation succeeded.

Maintain an explicit reader/writer compatibility table per released app/Brain pair. Browser and Brain
may update at different times. Serve versioned immutable assets and display an update-needed state;
never reload a form with an unsaved draft or reroute a running native turn automatically.

## Specification changes

Use stable requirement/story/workflow IDs. Before a material change, identify affected tasks, acceptance
cases, permissions, schemas and evidence. Record the decision and rationale, regenerate dependent
views, and obtain any changed scope permission. Cosmetic wording that preserves semantics does not
need to invent new behavior IDs. Store actual run results outside frozen feature specs. A spec change
invalidates the relevant test mapping/evidence; it does not rewrite old learner assessments.

## Updates and rollback

Back up the local journal consistently before migrations. Keep existing academic records append-only
under their owners. Reversible app rollback must use a reader compatible with the current contract and
journal schema. Do not run an older writer against newer records, or restore yesterday's Drive folder
over newer valid evidence. Rollback can disable a feature while preserving input, queued jobs and
current files. Retain an auditable update receipt and recheck native capability after desktop updates.

Dependency versions are locked in LL002 from real registry/install evidence. Do not invent lockfiles
now. Exact generated-component source revisions and license notices accompany the executable build.
