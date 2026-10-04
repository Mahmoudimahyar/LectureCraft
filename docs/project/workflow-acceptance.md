# Workflow acceptance plan — 0.7.0

Every case is NOT_RUN. Document consistency checks are not application tests.

| ID | Workflow | Scenario | Required result | Status |
|---|---|---|---|---|
| AC01 | WF00 | Committed payload arrives after its manifest | Wait; do not run on incomplete bytes. | NOT_RUN |
| AC02 | WF00 | Same request/event delivered repeatedly | One admitted identity and one accepted publication; no duplicate learner attempt. | NOT_RUN |
| AC03 | WF00 | Same request ID with different payload | Explicit conflict, never last-write-wins. | NOT_RUN |
| AC04 | WF00 | Unrelated output Markdown changes | No ingestion/tutor feedback loop. | NOT_RUN |
| AC05 | WF00 | Exact native course/thread wrong or inaccessible | Block dispatch; never use latest or another project silently. | NOT_RUN |
| AC06 | WF00 | Authenticated native roundtrip from external PC process | Observed request/result IDs, selected context, exit/turn status and receipt; not just tool discovery. | NOT_RUN |
| AC07 | WF00 | Provider/session dies after possible result/save | Reconcile actual receipt before retry; uncertain is not failure-safe replay. | NOT_RUN |
| AC08 | WF00 | Cancelled/superseded worker returns late | Fence publication; preserve staged obsolete result without overwriting. | NOT_RUN |
| AC09 | WF01 | All configured lecture/session inventory | Every item included with indexed/pending/empty/absent/unrecorded distinctions. | NOT_RUN |
| AC10 | WF01 | Source updater already exists | One owner; no competing publication job or new unauthorized cron. | NOT_RUN |
| AC11 | WF02 | Existing transcript is edited/partial | Time mapping shows limitations; no invented verbatim alignment. | NOT_RUN |
| AC12 | WF02 | Repeated slides, overlap and off-slide explanation | Multiple typed intervals and reviewed timing, not one-to-one assumption. | NOT_RUN |
| AC13 | WF02 | Missing recording/empty file | Explicit unavailable downstream state; all-lecture scope retained. | NOT_RUN |
| AC14 | WF02 | Manual alignment correction then rebuild | Preserve correction/lineage; stale source correction requires review. | NOT_RUN |
| AC15 | WF03 | Existing concept with several parents | Reuse canonical typed IDs; build a bounded tree projection without duplicate definitions or prohibited cycles. Related edges need not make the entire graph a DAG. | NOT_RUN |
| AC16 | WF03 | Same label across courses or proposed prerequisite | No automatic equivalence, mandated requirement or transferred learner credit. | NOT_RUN |
| AC17 | WF03 | Content link unsupported or contradictory | Keep proposed/review state; schema validity is not factual acceptance. | NOT_RUN |
| AC18 | WF04 | Ask requests explanation with notes/figure | Correct source/version and permitted output; no false competence attempt. | NOT_RUN |
| AC19 | WF05 | Full typed/spoken answer submitted then provider fails | Complete available input preserved once; assessment pending, not lost/failed learner. | NOT_RUN |
| AC20 | WF05 | Question includes diagram/numerical givens | Capture correct visible snapshot and reference; no missing-figure claim of completeness. | NOT_RUN |
| AC21 | WF05 | Valid alternate solution, unasked criterion or bad transcript | Avoid false negative; use uncertainty/not_observed and correction path. | NOT_RUN |
| AC22 | WF05 | Tutor answer/rubric is incorrect | Source-reviewed assessment can be disputed/revised; generated reference not ground truth. | NOT_RUN |
| AC23 | WF05 | Existing schema rejects added full-answer fields | Use compatible evidence locator/sidecar; no unvalidated schema mutation. | NOT_RUN |
| AC24 | WF06 | Learner does not answer diagnostic question | WAITING_USER, release model; no autonomous invented response. | NOT_RUN |
| AC25 | WF06 | One wrong application with several prerequisites | Hypotheses bounded; no blanket failure labels for descendants. | NOT_RUN |
| AC26 | WF07 | Generated question overlaps existing family/source | Deduplicate/version appropriately; no attempt or schedule from generation alone. | NOT_RUN |
| AC27 | WF08 | Assisted correct response and unknown/uncertain grading | Preserve conditions; no automatic independent mastery or false fail scheduling. | NOT_RUN |
| AC28 | WF08 | Review becomes due at idle | Due state/task only, no phantom learner answer or automatic calendar modification. | NOT_RUN |
| AC29 | WF09 | Regrade same response vs genuine new response | Assessment revision vs new attempt distinguished; original content/time preserved. | NOT_RUN |
| AC30 | WF09 | Concurrent conflicting assessment corrections | Expected-version conflict exposed, not latest-clock winner. | NOT_RUN |
| AC31 | WF10 | Canonical attempt saved but renderer fails | Saved record receipt survives; projection clearly stale and independently recoverable. | NOT_RUN |
| AC32 | WF10 | New output manifest reaches phone before referenced files | Keep old verified snapshot/pending state until complete bytes. | NOT_RUN |
| AC33 | WF10 | Two devices submit different edits at the same time | Host/parent ordering and conflict handling, not blindly trust client clocks. | NOT_RUN |
| AC34 | WF11 | Brain app/supervisor/auth/Drive restart | Recover queue/jobs and current identity; no false always-on availability claim. | NOT_RUN |
| AC35 | WF11 | Empty eligible queues | No LLM polling; bounded deterministic health work only. | NOT_RUN |
| AC36 | WF11 | Quota or repeated deterministic failure | Pause/escalate with budget and no provider/billing switch. | NOT_RUN |
| AC37 | WF11 | Writer lock namespace / runtime changes | Block unsafe canonical write; never substitute interpreter or delete lock. | NOT_RUN |
| AC38 | WF11 | Database backup/restore and staged inputs | Consistent state restored on disposable copy; no duplicate commits after recovery. | NOT_RUN |
| AC39 | WF00 | Hostile task/source includes commands, tokens or traversal | Treat as data, validate scope; cannot grant permissions or execute arbitrary commands. | NOT_RUN |
| AC40 | WF10 | Gap marked resolved after hinted fix then time passes | Keep assistance and criterion limits; time changes review_due, not observed performance. | NOT_RUN |
| AC41 | WF00 | Queue visible in help; default control command fails | Mark capability unverified; no claim queue was attempted, missing server or root cause diagnosed. | NOT_RUN |
| AC42 | WF00 | Native tool sees final reply but resident process has no readback | Report partial native observation, not end-to-end process bridge PASS. | NOT_RUN |
| AC43 | WF00 | Global config allows broad tools while target settings are unknown | Block dispatch until exact effective disposable-target restrictions and human approval channel are established. | NOT_RUN |
| AC44 | WF00 | CLI/session UUID resolves to a new worker, not intended desktop target | Mark separate-worker result; no silent substitution of product or context. | NOT_RUN |
| AC45 | WF11 | Update/restart occurs after uncertain accepted turn | Fence old generation and reconcile original run before resend; no speculative socket/daemon/firewall repair. | NOT_RUN |
| AC46 | WF01 | Existing updater already processes changed sources | Consume verified receipts; no additional canonical updater or schedule, and no physical-source proof from ignored flag. | NOT_RUN |
| AC47 | WF00 | Drive upload tool exposed only inside native agent | Independent client remains unauthorized/unverified; no credential copying or automatic API access claim. | NOT_RUN |
| AC48 | WF00 | Two Drive files share name; commit manifest arrives before payload | Use logical request and content identity; wait for complete matching local bytes and keep remote-currentness unknown. | NOT_RUN |
| AC49 | WF05 | Nonempty locator points at missing or modified full snapshot | Wrapper blocks canonical assessment publication with explicit evidence issue; do not accept old validator string check alone. | NOT_RUN |
| AC50 | WF05 | Tutor answer arrives after input snapshot was hashed | Save as separate immutable message; original learner bytes/hash remain unchanged. | NOT_RUN |
| AC51 | WF05 | Attempt saved but view generation fails; retry repeats same input | Reconcile actual saved/already_saved receipt and exact bytes; one original attempt, separate stale-view outcome. | NOT_RUN |
| AC52 | WF09 | Correction changes intended skills or branches chronology | Existing correction validator rejects; do not silently create a second interpretation chain. | NOT_RUN |
| AC53 | WF03 | One concept appears beneath multiple tree branches | Reference one canonical ID; no duplicate definition, implied prerequisite failure or automatic learning credit. | NOT_RUN |
| AC54 | WF10 | Corrected assessment retracts a reported misunderstanding | Derived gap view follows effective revision; no stale parallel gap ledger or diagnosis attached to not_observed. | NOT_RUN |
| AC55 | WF05 | Fixture command supplies --root to installed global-root BE 505 writer | Do not invoke; require demonstrated path isolation/refactor of a controlled copy before mutation testing. | NOT_RUN |
| AC56 | WF11 | Received report ends halfway through Drive admission paragraph | Mark input incomplete; preserve only supplied evidence and do not fabricate remaining procedures/test results. | NOT_RUN |
| AC57 | WF02 | Deleting derived alignment export after a reviewed timing correction | Rebuild the same accepted correction from the source-link owner record; export was not its only copy. | NOT_RUN |
| AC58 | WF02 | Legacy prose and normalized annotation disagree | Expose exact revision/owner conflict; never silently treat both as independent current truth. | NOT_RUN |
| AC59 | WF03 | Question strict_containment is displayed as concept prerequisite | Reject stronger interpretation; preserve actual question endpoints and relation semantics. | NOT_RUN |
| AC60 | WF03 | Association graph contains legitimate cycles | Bound traversal and preserve related links; enforce acyclicity only where the actual relation contract requires it. | NOT_RUN |
| AC61 | WF05 | Complete learner response has no valid mapped family yet | Persist full input and mark assessment pending; stage legitimate family mapping rather than save invalid/guessed canonical evidence. | NOT_RUN |
| AC62 | WF05 | Same logical response retried with another native run ID | Preserve one learner turn/attempt identity; additional run IDs remain dispatch metadata. | NOT_RUN |
| AC63 | WF05 | Normalized transcript excerpt does not exactly match original capture | Preserve original and any explicit recognition revision; do not silently change snapshot text to satisfy verifier. | NOT_RUN |
| AC64 | WF05 | User permits transcript retention but not raw audio retention | Retain exact permitted transcript with modality limitations; never claim a saved original voice file. | NOT_RUN |
| AC65 | WF06 | Missing graph node treated as evidence of learner ignorance | Report system mapping gap, not a learner error or prerequisite diagnosis. | NOT_RUN |
| AC66 | WF06 | Later answer supports a different cause than the first hypothesis | Keep counterevidence and update operational hypothesis/real assessment only under proper lineage. | NOT_RUN |
| AC67 | WF08 | Two commands deliver the same review event after reconnect | One schedule update, one original attempt; duplicate transport is not another review. | NOT_RUN |
| AC68 | WF08 | Scheduler policy changes after a past review | Preserve actual event/time/attempt history and record the new derived schedule/configuration. | NOT_RUN |
| AC69 | WF09 | Model or visualization version changes without new learner evidence | Invalidate relevant generated views/context as appropriate; never automatically rewrite original judgments or create a new attempt. | NOT_RUN |
| AC70 | WF10 | Gap-view grouping mixes hinted recall with unassisted application | Keep distinct performance/conditions and cite original episodes; no aggregate mastery claim. | NOT_RUN |
| AC71 | WF10 | A prose summary is regenerated under the same source revision | Keep actual generation provenance; deterministic facts remain correct without claiming identical model wording. | NOT_RUN |
| AC72 | WF10 | A summary repeats a subsequently retracted weakness | Invalidate/rebuild from effective assessments; summary does not resurrect old interpretation as new evidence. | NOT_RUN |
| AC73 | WF11 | Generic run cleanup encounters full response referenced by an attempt | Treat referenced sidecar as durable evidence; approved retention/deletion must preserve or explicitly qualify dependencies. | NOT_RUN |
| AC74 | WF01 | Initial archive exceeds the existing updater per-run batch cap | Maintain backlog and all-lecture frontier; continue only through owner-approved policy, without a duplicate publisher or unapproved schedule. | NOT_RUN |
| AC75 | WF04 | Missing concept tree but original source/rubric is available | Answer from the available permitted original source with mapping limitation; do not force whole-archive completion first. | NOT_RUN |
| AC76 | WF00 | New memory item exists but no workflow consumes its output | Registration/design validation flags the missing producer/consumer or classifies it intentionally inactive; file presence is not integration. | NOT_RUN |
