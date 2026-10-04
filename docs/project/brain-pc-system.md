# Brain PC: complete proposed operating system

## Decisions now fixed by the user
Private one-learner release; all configured lectures and available materials; Google Drive-backed
cross-device interfaces; native OpenAI/ChatGPT priority with the actual Codex/desktop route to be
verified; primary PC always on; every submitted explanation/answer is retained in full with
concept-linked, timestamped observations and continued conversation. No sample-only product,
mandatory hosted reasoning service or unapproved billed inference substitution.

## Recommended system boundary
```text
Phone / tablet / browser / desktop interface
  → authorized Drive request bundle (one immutable request, commit manifest last)
  → Brain PC observer + conventional supervisor
  → durable local journal and named workflow queue
  → source preparation / tutor / review worker in the verified native environment
  → staged results + typed evidence
  → deterministic validation + actual owning course writer
  → immutable result bundle + canonical save receipt + derived views
  → Drive → every authorized interface
```
Google Drive provides authorized file transport/storage, not queue locks, model wake-up, or atomic
multi-file publication. The front end must address Drive IDs on non-Windows devices, not assume G:.
A browser/mobile build still needs a tested Drive authentication/storage adapter. This design does
not solve it by exposing PC filesystem paths or making course folders public. Hosting static UI is
a separate deployment choice; no always-on cloud reasoning/writer service is required by default.

## Small number of logical roles
| Role | Workflows | Responsibility |
|---|---|---|
| Supervisor (ordinary code) | WF00, WF11 | Watch/reconcile, admit/route, lease, recovery, limits; no model at idle. |
| Course-preparation worker | WF01–WF03 | Consume existing updater receipts, prepare material and extend owned catalogs/projections. |
| Tutor worker, scoped by course/thread | WF04–WF06 | Questions, explanation assessment, diagnostic/remedial interaction. |
| Review worker | WF07–WF08 | Useful question/card preparation and actual review scheduling/interactions. |
| Integrity/publication service | WF09–WF10 + common commit steps | Own record adapters, correction, projection and output consistency. |

These are profiles/modules, not five new services or twelve permanently running LLMs. Reuse the
current source updater, course context, question helpers, record validators, publisher and known
writer runtime. Tutor/preparation models write proposals to staging; narrow code publishes accepted
records. A native agent with unrestricted shell permissions can bypass this arrangement; genuine
OS/file permissions and cooperative legacy routes must be verified, not asserted by a prompt.

## End-to-end loop
1. Submit one bounded request or discover one changed source version. Commit all input bytes.
2. Validate source/course/user/mode identity and classify the workflow from trusted policy.
3. Journal it and process when dependencies and permissions are satisfied.
4. Read only the necessary versioned source and concept neighborhood, not all course memory.
5. Perform deterministic steps with existing code and probabilistic steps with the verified agent.
6. Validate staged output; compare expected record versions; commit through the record owner.
7. Record precise receipts, update downstream projections and schedule only necessary next jobs.
8. Drain the next eligible job; idle or wait for an external event when no work is runnable.

## Core invariants
- Original sources/catalogs and canonical assessments retain their owners; full interaction,
  diagnostic proposals, scheduling and job state are distinct operational records. A generated summary or native completion message is not a new fact.
- Every actual learner submission has one stable capture; repeated notification/retry does not
  create another learner attempt. Reassessment is an assessment revision, not another answer.
- Inputs and graphs/rubrics are snapshot-bound. A changed current graph cannot rewrite old grading.
- Proposed machine source links are not verified audio alignment, and unknown skill is not failure.
- All lectures stay in the coverage denominator, including unrecorded, empty and unavailable cases.
- Brain PC operational storage is local and nonsynced. Its backup is taken consistently by the
  chosen storage engine; not a blind copy of a live database plus missing journal files.
- No arbitrary task Markdown supplies tool permissions, executable code, credentials or model policy.
- The app reports uploaded, received, running, answered, canonical-saved and projected states
  separately. No local write alone proves remote synchronized visibility.

## Minimum implementation sequence
Use the focused proof handoff to prepare and obtain approval for one native-process roundtrip
first; add Drive and safe writer integration as separate later tests. Next add durable complete input
capture, canonical-save adapters and negative cases. Finally connect the full all-lecture backlog,
content graph, assessment/diagnostic loop, review and cross-device playback. This is sequencing,
not reduced product scope. Each probabilistic family receives task-specific reviewed evaluations.

Details: [dispatch](dispatch-protocol.md), [worker lifecycle](worker-lifecycle.md),
[workflow catalog](workflow-catalog.md), [memory](memory-contract.md),
[teach-back](tutoring-assessment-flow.md), [acceptance](workflow-acceptance.md).

## Standing workflow policy before activation
Specify permitted courses/source kinds, model/runtime/data scopes, maximum concurrent workers,
per-item repair/retry limits, daily allowance budget, safe catalog/source changes that may publish
automatically, and exceptions that need user review. Do not request approval for every ordinary
turn once that policy is genuinely approved; do not infer the policy from a file saying approved.
Creation of a daemon or schedule is a separate actual action, not accomplished by this packet.

## 0.6.0 reconciliation: implementation authority takes precedence
P06 is partial but establishes enough to revise the design. The supervisor/native/writer route
remains proposed, not installed. `codex queue` is reported help evidence, not a verified production
adapter; the exact independent-process return path is the immediate gate. Inherent defaults may
be broad; restrict only an explicitly approved disposable proof target, not existing courses.

The existing updater remains source discovery/publication owner. WF01 now consumes its receipts;
it is not a competing continuous source interpreter. Concept-tree and gap views reference existing
catalogs/attempts; prior separate canonical graph/gap directories are withdrawn. Full-turn snapshots
use new children under .agent/course-learning/runs, with explicit verification, not a new attempt
schema. Review/resume state remains operational. The current [workflow registry](workflow-catalog.md)
and [memory contract](memory-contract.md) resolve previous path proposals.

Do not use the report's global-root BE 505 writer on fixtures by passing --root. A verified local
publication cannot prove remote Drive receipt. Intake across devices requires a separately proven
client identity, not copied credentials from an agent connector.
