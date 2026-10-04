> Current implementation authority: [exact adapter contracts](../engineering/interface-contracts.md) and [R0–R5 backlog](../delivery/backlog.json). This retained design explains rationale; its earlier illustrative shapes and I/U sequencing are not competing schemas or schedules. Existing academic ownership constraints remain binding.

# Full-turn snapshots: compatible evidence without replacing course-learning-v1

Proposed adapter contract, not an implemented validator or schema migration. P06 B.4 reports that
response_evidence requires a nonempty locator/excerpt but does not resolve its target or digest.
Additional properties being syntactically allowed does not give them validation semantics.

## Locations and immutable phases
The smallest proposed extension uses the existing course operational run role:

```text
<course>/.agent/course-learning/runs/<run-id>/
  turns/<turn-id>.json              # exact question + actual learner input; immutable
  messages/<message-id>.json         # later full delivered tutor message; immutable
  attachments/<content-id>           # only necessary authorized evidence bytes
  receipts/<receipt-id>.json         # input hashes, assessment/writer identity, save outcome
  proposals/<proposal-id>.json       # uncommitted assessment/catalog/diagnostic proposals
```

These children require local path/retention approval. They are not new schemas for
`learning/attempts/`. The snapshot cannot be silently discarded as scratch after its turn is used
as evidence. Question text and supplied figures must be complete for the submitted task or marked
incomplete. Preserve original versus corrected speech transcription and exact available modalities.
Do not generate nonexistent historic source or voice data.

## One compatible publication transaction
1. Receive the committed request, verify its authenticated namespace and every declared file.
2. Assign/reuse turn and request IDs. Write the learner snapshot exclusively; read back its exact
   bytes and digest. Same ID/different bytes is a conflict; do not overwrite or truncate.
3. Bind source/question/family/rubric versions and actual help conditions. Derive an assessment
   only from the response; incompleteness may block grading without losing captured input.
4. Prepare the normal v1 candidate outside attempts. Use the existing exact prompt, excerpt and
   locator fields; do not replace the schema or assume unknown fields are meaningful.
5. Before publish, the new wrapper verifies snapshot course/term/turn/request, size, hash, allowed
   path, attachment refs, exact excerpt inclusion and expected source/rubric identity. Recheck
   the same captured evidence immediately around the owner's actual commit. Preserve trusted
   root binding; request text never provides arbitrary paths, executables or native thread IDs.
6. Invoke the proper writer. BE 505 uses its current helper at its actual bound root after required
   fixes/isolation; other courses need a tested adapter for their prescribed procedure. The
   tracking publisher is never a fallback learning writer.
7. Read back the canonical record and its snapshot; record the actual receipt plus separate view
   freshness. BE 505 `saved`/`already_saved` and saved-evidence/view-failure have distinct meanings.
8. Store the visible tutor reply separately when delivered, linking native item/turn and input
   generation. Render a joined conversation only from verified constituent files. Source capture,
   model completion, canonical save, projection refresh and remote visibility remain distinct.

## Nonempty locator is not proof
A proposed locator may contain an allowed course-relative snapshot path, verified digest and
native response identifier. The wrapper must not merely parse a sha256 string and accept it.
It checks actual bytes. The native result item ID comes from trusted runtime evidence when exposed,
not a model assertion or an arbitrary ID in Drive content. If the native interface supplies no item
identity, retain that limitation; do not fabricate it. Body hashes show consistency, not truthful
content, identity, permission, or absence of other concurrent writers.

## Corrections and exceptions
An `assessment_revision` preserves original response/prompt/occurrence time and replaces the same
skills' observations. A transcript correction is a new referenced capture with an explicit reason;
it does not modify the original hashed snapshot. Keep interpretation lineage in a reviewed
operational receipt when the existing correction schema has no snapshot-specific field. Never
invent a canonical field silently. A genuinely new learner answer gets a new attempt.

Missing/changed snapshot or attachments: keep raw input if possible, block the purported verified
commit/reuse, and show the precise failure. Do not repair hashes, fall back to a similar file, or
regenerate missing evidence with AI. Orphan snapshots can remain staged after failed publication;
resuming first checks canonical identity, not just whether a process exited.

## Fixture safety requirements
P06 reports BE 505 input hashing uses global ROOT and save/refresh uses global paths. Passing a
fixture `--root` alone is **not containment**. No installed writer may be exercised against a
supposed fixture until its global/path dependencies are inspected and replaced in an isolated
approved copy with a test that proves it cannot reach live roots. The tracking source-hash flag
must be separately fixed or avoided with an honest explicit source audit. No live regression test
or attempted repair is authorized by this document.

Minimum proposed tests: missing snapshot, hash mismatch, wrong course/turn, missing figure, excerpt
not in original, repeated identical save, conflicting same ID, changed input during validation,
correction branch, view failure after original commit, restart after uncertain outcome, and
attempts-directory traversal rejecting unrecognized artifacts. All remain NOT_RUN here.
