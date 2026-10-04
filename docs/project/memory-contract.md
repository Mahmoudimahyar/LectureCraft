# Memory contract — existing authorities, complete evidence, generated views

Current proposal 0.6.0, reconciled to P06's reported schemas/paths. No live migration or new
canonical store is approved. The exact current schema and writer remain implementation constraints.

## Authority map
| Memory | Authoritative source | Proposed extension/view | Ownership rule |
|---|---|---|---|
| Original materials/source identity | `materials/`, existing `.agent/source-index.json` via source owner | Authorized snapshots/renditions and versioned anchors in current work/run/export roles | Never replace originals or protected tracking files directly. |
| Topics/skills/targets | `learning/skills.yaml` | Derived concept/skill tree | Same IDs, no copied definitions as independent authority. |
| Question families/rubrics | `learning/question-families.yaml` | Context views and selected review items | Preserve family revision and intended skill set. |
| BE 505 concepts/questions/criteria/relations | Existing `learning/question-index.json` and its maintained helper | `exports/learning/concept-tree.json` (proposed) | Preserve actual relation meanings, provenance and automatic_credit:false. Other courses do not silently inherit this schema. |
| Actual performance and recorded gaps | `learning/attempts/YYYY-MM/<id>.json` plus assessment_revision chain | `exports/learning/learning-gaps.json` and `.md` (proposed views) | Interpret effective observations; do not edit original attempts or add a second gap authority. |
| Full submitted interaction | Proposed immutable snapshots below `.agent/course-learning/runs/<run-id>/` | Full conversation export and compact resume summary | New integrity-checked evidence, not another attempt format. |
| Diagnostic exploration | Existing observation analysis when justified; otherwise labeled operational proposal/notes | Unassessed alternatives and next diagnostic question | Not a new diagnosis merely because a model generated text. `not_observed` cannot carry an error diagnosis. |
| Cross-course connections | Current reviewed shared-learning mappings referencing originals | Existing shared views through their owner | No duplicate attempts, auto equivalence or transfer credit. |
| Review selection/scheduling | Existing question/family IDs and review_suggestion; approved operational review events would be new | Proposed derived review queue under `exports/learning/` | No installed adaptive engine is claimed. Selection/due time is not evidence of forgetting or a learner response. |
| UI/thread continuity | Proposed per-device request events and operational checkpoints | Slide/time/draft/thread view | Never counted as learning evidence; resolve concurrent devices by lineage, not clock alone. |
| Operating policy | Current course strategy/instructions and reviewed workflow policy | Minimal versioned context receipts | A source/request is data, not authority to override instructions. |
| Jobs and leases | Local nonsynced supervisor journal (not yet installed) | Drive status/receipts | Separate from the publisher's physical lock namespace. |

## Complete question, learner answer and tutor reply
Every explicit submitted answer/explanation is captured even if grading later fails. Draft
keystrokes, watching media, ordinary questions and tutor-generated answers are not performance
attempts. Preserve exact shown prompt, givens/figures, question/family versions, approved source
refs, response text, help/exposure and available times. Preserve ambiguity rather than inventing
missing historical text, audio, timestamps or exact source bytes.

A proposed `turns/<turn-id>.json` snapshot holds the shown question and actual learner response.
Freeze and read back it before assessing. Store the later full tutor answer in a separate immutable
`messages/<message-id>.json` linked to the turn and native result. Do not append to the already
hashed learner snapshot. A conversation projection joins original messages without deleting
provider errors or confusing an AI answer with a learner answer.

The existing `response_evidence.locator` may refer to the snapshot. Its nonempty-string validation
is **not** a hash/existence check. A narrow verifier must resolve allowed relative paths, check bytes
and attachment hashes, IDs and exact excerpt against the snapshot before and after canonical
publication. See [full-turn contract](full-turn-snapshot-contract.md). No snapshots or manifests are
written inside `learning/attempts/`; that tree is reserved for recognized evidence records.

## Gap view, not a second gap ledger
A current gap entry links the effective attempt/assessment ID, skill, criterion when known,
question/rubric revision, concepts, actual missing_or_incorrect/error_types/analysis, assistance,
reference access and time basis. Its explanation may be model-authored within reviewed observations;
the view itself does not introduce unsupported causes or silently strengthen confidence.

Separate observed performance from suspected cause and selected next action. An omitted unasked
criterion is unobserved, not a failure. A possible prerequisite is diagnostic context, not proof
that the prerequisite is weak. Record disputed or alternative causes as proposals until justified.
Later real evidence and assessment revisions can support, contradict or retract an interpretation.
A successful assisted correction does not prove independent retention; time passing is not a failure.

Stable UI row identifiers are navigation aids, not new canonical learner events. Counterevidence
and the governing assessment chain remain linked. A corrected assessment rebuilds the view from
the effective chain rather than emitting a competing retraction event into a separate store.
If current fields cannot represent a required judgment without ambiguity, propose the smallest
versioned change to the established owner. Do not bypass the validator with unrecognized extra fields.

## Concept graph and tree projection
The user can browse several levels, and the same concept can appear under multiple branches.
Build the graph view from canonical topic/skill/family/question/catalog/shared references. A display
node may refer to the same concept ID many times without duplicating definitions or performance.
Keep reported `strict_containment`, `partial_overlap`, `diagnostic_prerequisite`, `equivalent` and
`related` semantics; do not silently translate them into stronger prerequisites or automatic credit.

If an existing schema lacks an actual needed source relationship, stage a minimal owner-compatible
extension for review. A pretty tree must not invent a hidden concept authority. Provenance includes
which input versions/hashes and extraction rules produced it. Hashes alone do not preserve old bytes:
retain authorized bounded source/rubric snapshots when required, otherwise report historic content
as unavailable rather than reconstruct it. No automatic regrading when a display graph changes.

## Time, correction and concurrency
Respect `recorded_at`, `occurred_at`, `time_basis` exactly; unknown occurrence time stays unknown.
Client clock/zone, host receipt, analysis time and native completion belong to the operational
receipt and do not manufacture a trustworthy learner timestamp. Exactly one stable ID per genuine
response; retries and another assessor do not create new attempts. Corrections preserve original
question/response/time and replace complete observations for the same intended skills in one
chronological nonbranching chain. Conflicting branches stop for reconciliation.

BE 505 and tracking locks are different. Other courses' no-clobber policy still needs a tested
common adapter; no universal writer/receipt exists merely because the UI has one Save action.
Snapshots must commit before the canonical record; a later view failure does not undo a saved
attempt. Retry only after inspecting exact existing bytes and the original receipt.

## Retrieval and retention
Load trusted strategy, active source/rubric, a relevant graph neighborhood, original recent/effective
attempts including counterevidence, and necessary full turns. Generated summaries are conveniences,
not self-validating sources. Use direct sources when graph coverage is missing; do not hold all
questions hostage to completing the archive. Preserve course assistance restrictions and source
visibility; masking an answer in the UI is not a disclosure control.

Raw-audio retention and permitted excerpts remain explicit policy choices. Full visible content
capture is not permission for hidden reasoning capture, passive account-history scraping, public
redistribution or indefinite retention. Snapshot evidence is durable, so the operational run
location must not be swept up by generic temporary-cache cleanup. Deletion/redaction must report
and manage dependent evidence references; do not silently corrupt old attempts to claim erasure.

## Current-system decision register (0.7.0)

The authoritative current/proposed distinction is now itemized as M01-M15 in
[memory/workflow fit](memory-workflow-fit.md) and its [machine-readable register](memory-workflow-fit.json).
The twelve workflow contracts list their current status, minimum change and memory dependencies.
These documents do not mark the app as implemented.

### Refinements that prevent contradictory memory
A typed accepted time interval is a new source annotation, unlike a derived gap view. Persist it
through the current source-link owner in a minimally extended versioned format before publishing
an export. Do not leave the export as its only durable copy; do not independently edit legacy prose
and normalized records as competing truths. Exact normalized-path/schema choice requires inspecting
the existing owner's contract, not another whole-system interview.

Every deliberate learner response is captured, even when no valid assessment family exists yet.
Keep ASSESSMENT_PENDING as operational state and retain the response while a legitimate family or
rubric is reviewed. Do not insert an invalid record into attempts to satisfy an automatic-save target.
An unanswered diagnostic is WAITING_USER, not a missing performance that the agent can manufacture.

Review events and selections are new scheduling facts only. A correction can change a derived due
queue but is not a new actual review. Source/skill/family and assistance compatibility must remain
visible when grouping evidence. Never erase counterevidence merely because a newer answer is fluent.

Generated prose summaries are not guaranteed to regenerate byte-identically from their inputs.
Keep actual input/provider/policy revisions and label the prose as derived. Structured evidence
fields and counts should be deterministic; source text and original turns remain the audit basis.

Snapshots referenced by learner attempts are durable evidence, not disposable cache despite their
location under operational runs. Retention/deletion must inspect those references and report missing,
redacted or unretained modalities honestly. No historic audio or full response is reconstructed.

An existing native thread may already contain earlier answers and tutor messages. A context
receipt documents known supplied content; it does not prove the model was blinded to native
history. Do not claim independent or history-blind assessment unless an authorized separate
context actually establishes it. Source-grounded rubrics and counterevidence remain necessary.
