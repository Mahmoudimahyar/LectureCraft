# New app interface contracts — v1 build baseline

These are new **adapter** contracts, not claims that native providers or existing course writers expose
these fields. Authoritative shapes are [contracts/index.json](../../contracts/index.json) and local JSON
Schemas; [check_contracts.py](../../tools/check_contracts.py) adds documented cross-field rules. All
fixture records are synthetic and must never be submitted to live inboxes or attempts. The existing
`course-learning-v1` and tracking schemas must be imported intact from authorized owner source in LL003.
This packet does not reconstruct or license that code from report excerpts.

## Contract inventory and ownership

| Contract | Purpose | Writer / consumer |
|---|---|---|
| control | Bounded cancellation, note, dispute and source hint proposals | Paired client → owning workflow |
| request | Deliberate command, stable input, scope and parent lineage | Paired client → supervisor |
| bundle / signature | Manifest entry, sizes, hashes, committed payload and signer | Sender → receiver |
| submission | Complete prompt, actual answer, conditions, timestamps and attachments | Capture layer → assessment/owner wrapper |
| message | Separately immutable learner question or delivered tutor text | Capture/result layer → conversation view |
| context | What permitted inputs/instructions were actually supplied | Context selector → provenance/reviewer |
| native-result | Observed exact run/target/terminal outcome | Native adapter → coordinator; not a writer receipt |
| publication | Verified owner result and separate view state | Writer facade → UI/projector |
| annotation | New versioned reviewed source association | Existing source-link owner → alignment view |
| review-item / review-event | Selected item and actual performed review | One review owner → scheduler/projection |
| resume | Nonperformance device checkpoint and draft lineage | Paired client → conflict-aware projection |
| view | Complete declared input/output generation | Projector → remote UI |

Paths in these records are relative to a trusted declared root; none may choose an executable, native
project, arbitrary absolute path or root. IDs resolve only through approved local bindings. Maximum
bounds are part of schema/policy, not permission to process sensitive content. Additional properties
are rejected; string `approved: true` cannot become authorization. Source locators use 1-based pages
and inclusive line ranges. Media is integer milliseconds `[start_ms,end_ms)` from original source start.
Figures use normalized x/y/width/height bounded within their stated page. Broad text locators remain
broad. Do not normalize Unicode, convert transcripts or re-encode attachments after capturing hashes.

## Exact file handoff

Each immutable request bundle is under an allowed course inbox. Payload files and `request.json` are
written first; `ready.json` is the manifest and is committed last. `task.md` is readable context, not
executable instructions or a mutable shared queue. The manifest names the entry record and every file,
size and SHA-256; no unlisted file is admitted. Late payload files leave the bundle pending. A local
complete hash set proves those local bytes, not current remote visibility. A result is another immutable
bundle with separate output and writer receipts. Generated `task.md` dashboards derive from the local
journal and never trigger their own workflow again.

Hash raw bytes using SHA-256. JSON is UTF-8 without BOM, duplicate properties or nonfinite numbers.
Senders serialize once; receivers verify those exact bytes rather than reserialize for signatures.
Manifest is at most 256 KiB; committed bundle at most 256 MiB/64 files. Each foreground text submission
is at most 200,000 characters and 16 attachments. Large original lecture media is referenced, not copied
into every request. Limits may be changed by reviewed configuration, never by task payload.

A signature is detached as `ready.sig.json`; manifest and signature do not hash themselves. Use
WebCrypto P-256 ECDSA with SHA-256 and 64-byte `r || s` P1363 output, base64url without padding. The
signed message is UTF-8 `LL-BUNDLE-V1\n` followed by the 64 lowercase ASCII hex characters of the raw
manifest SHA-256. The `algorithm` label is application-defined `ES256-P1363`, **not a JWS token**. Python
cryptography uses DER signatures; convert with its supported DSS encode/decode utilities. Never
implement elliptic-curve math. Test browser/Python cross-signature fixtures in LL017 before activation.
[REF19/REF20](../research/build-source-register.json) document the representation difference.

Device public keys are paired through a user-reviewed fingerprint/challenge on the Brain PC, with
course/action allowlists and revocation. Drive content does not enroll its own key. Browser private
keys use non-extractable WebCrypto storage where supported; XSS can still act as that browser, so CSP,
output sanitization, dependency review and explicit high-risk approval remain necessary. Brain private
keys stay in OS-protected local storage. The UI verifies signed results against its paired Brain key.
A signature proves possession of a paired key, not pedagogical truth or permission for arbitrary actions.

## Admission, replay and order

Admit only after signature/allowlist, schema, bounds and all file checks. `request_id` + content digest
is idempotent: same bytes reuse the original admission; different bytes conflict. `logical_input_id`
identifies the real learner response across transport retries; dispatch IDs identify computation attempts.
A new actual response gets a new input/attempt. Regrading the old response never adds a learner trial.

Device sequence counters must be unique, but must not discard a legitimate out-of-order independent
request simply because a larger number arrived first. Parent-dependent work waits for its referenced
parent; resume siblings are a visible conflict. A cancelled or superseded job cannot publish as the
current generation. Native completion unknown is not safe to retry blindly. Durable receipts and native
IDs are reconciled before redelivery. Expired requests require renewed user intent; keep captured input.
No exactly-once provider computation claim is made; target one accepted canonical publication.

## Complete evidence and writer boundary

A `submission` freezes the exact shown prompt, required figures, actual answer, known assistance and
client time basis. The later tutor reply is a separate `message`. If family/rubric or recognition is
unresolved, preserve the full input and show pending; do not fabricate a valid academic attempt.
The snapshot exists/readbacks before the attempt candidate references it. The wrapper verifies the
sidecar hash, scope, logical input, exact excerpt and attachment digests before and after owner save.
Existing locator strings alone do not perform those checks. Known timestamps stay distinct from host
receipt time; unknown occurrence remains null. New clock fields map explicitly to the actual current
academic schema, not by copying sidecar enum labels into it.

BE 505's real `saved` / `already_saved` outcomes and saved-evidence/view-error exception map into the
publication receipt. Other courses require the inspected coordinated procedure. `incomplete` is not
`blocked-no-write`: reconcile partial effects. An attempt save with stale view remains saved. Only an
owner-verified complete canonical record earns a saved receipt. A no-assessment quick answer yields
`kind:none/status:not_requested` rather than an invented attempt. Existing publisher statuses are
preserved in private detailed receipts, not rewritten by the model.

## Annotations, review and derivatives

New timing assertions persist under the existing source-link owner in a reviewed sidecar registry
beside current source maps (selected adapter convention `work/lecture-review/source-links/`). One
revision JSON is immutable, with predecessor and input hashes. Old prose and new records cannot both
be edited independently as authority for the same link; migration is a scoped owner task. Rendering
`exports/learning/alignment.json` cannot be the only copy of a manually confirmed time annotation.

Selected review uses existing questions/families. `saved_only` is not due. v1 auto-scheduling requires
an actual linked canonical attempt, an explicitly supported rating and known no-assistance-before-answer
conditions. For uncertainty or assisted learning, store practice and let the learner choose a reminder;
do not feed a fabricated failure/success rating to FSRS. A later correction revises computed scheduling
state without adding another performed review. Initial FSRS desired retention target is 0.90 as a
scheduler setting, not a claim of measured learner retention; record actual installed defaults/version.
Disable random scheduling fuzz for reproducibility or persist its seed before enabling it deliberately.

Views list inputs, generator/policy and outputs. They add no new assessment facts. Factual projections
are deterministic; optional summary prose is generated evidence-linked text, not guaranteed identical
bytes on rerun. View freshness does not mean an old assessment becomes false after a tool update.

## Internal module ports (to implement; not existing endpoints)

`SourceReader.list/resolve`, `Capture.freeze/verify`, `Dispatcher.submit/status/interrupt`,
`LearningWriter.validate/commit/verify`, `Projection.build`, and `Scheduler.apply_event` consume the
versioned records above. Writer records are allowed only for the bound owner. The local operator
surface exposes health/configuration/status; it does not offer a remote arbitrary shell or unrestricted
file read. Third-party SDK protocol types are not relabeled as these application envelopes.

## Validation boundaries

The supplied 84 cases exercise structural and cross-field rules on synthetic data. File checks are
reference tests, not concurrent filesystem containment, cryptographic pairing, real native receipts,
or production schema compatibility. LL003/LL017/LL019/LL020/LL035 provide those separate required proofs.

## Request action to typed payload

`contracts/index.json` owns the closed `action_payloads` mapping. `ask` accepts only a
learner-question message labeled not assessed; explain/practice/diagnose/review_answer accept
a frozen submission with the corresponding activity. select_review/edit_review accept a review
item proposal; correct_source an annotation proposal; resume a device checkpoint. cancel,
save_note, correct_assessment and source_hint use the closed control union. No control request
contains a shell command, arbitrary root/thread selection, granted permission or replacement
canonical assessment. The receiver resolves the target and owning writer after authorization.

`validate_payload` checks the outer action, inner type, course/term, relevant request/thread,
logical input and device identities. It does not authorize a request or execute it. Every action
is still checked against paired-key scope, current ownership, expected revisions and payload
bytes before use. A cancel message is a request to cancel, not terminal cancellation; assessment
disputes carry the existing attempt reference and reasons, not a second learner answer.

`explain` in the wire action enum means a learner's **Explain back** submission, not a request
that the tutor explain something. Asking for an explanation uses `ask` with standard/deep
depth. A quick-depth response to a genuine submitted answer may still be assessed; reply
length and evidence kind are independent. This avoids converting ordinary help into failure.
