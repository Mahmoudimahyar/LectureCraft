# ADR 0003 — always-on Brain PC and file-backed workflow design

Date: 2026-10-03. Requirement status: user-confirmed. Detailed engineering: recommended specification, not deployed or tested.
Supersedes the unresolved writer-hosting assumption in ADR 0002; that document remains historical.

The user states the primary PC is always on and contains Codex and the proper course projects.
Other interfaces operate over Google Drive files. Preserve the single-learner, all-lecture and
cross-device requirements, the native ChatGPT/OpenAI preference, and no silently billed API fallback.
Record the actual native product/mode/version/thread before execution rather than treating product
names, accounts, desktop windows and programmatic threads as interchangeable.

The chosen location of computation is no longer a user question. Recommend one conventional local
supervisor and designated native-worker profiles, using the existing runtime-specific canonical
writers. Other devices submit immutable commands and read verified output bundles. They do not
become independent writers of the learning history, graph, grade records or scheduler state.
Approved original-material changes still occur through existing ownership and produce versioned
reprocessing. Manual outside writers remain a disclosed coordination boundary.

The user also requires every submitted learner explanation/question-answer to retain complete
visible prompt/answer, associated concept evidence, dates and learning-gap assessments. This expands
new app-captured evidence beyond the existing excerpt-based records; it does not authorize scraping
all historical chats, fabricating missing older content, recording keystrokes, or retaining hidden
model reasoning. New full interaction records link to existing attempts without rewriting schema.

A dedicated worker means a stable workflow, policy, queue and memory scope, not an LLM that spends
all day polling files. Drain all eligible work, checkpoint between bounded items, wait for real
learner/input events and idle without model calls. No-runnable-work is not every-lecture-fully-linked.
Missing media, permission, human review, uncertain completion and quota remain explicit states.

No host installation, recurring job, native dispatch, data migration, schema patch or canonical
write is authorized by drafting this document. Actual workflow enablement needs verified interfaces
and a scoped standing-operation approval. Existing schedules are not replaced automatically.
