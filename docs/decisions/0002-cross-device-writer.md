> **Historical 0.4.0 decision discussion.** Current host placement and workflow direction are superseded by [ADR 0003](0003-always-on-brain-pc.md). Native capability claims below were proposals/research, not installed acceptance.

# ADR 0002 — portable access and canonical writer placement

Status: **PROPOSED / USER DECISION REQUIRED**, not implemented.
Accepted inputs: one learner, all lectures, Google Drive, cross-device access and ChatGPT first.
P05 reports Windows-specific tracking coordination and nonuniform course-learning save paths.

Recommendation conditional on user choice: use a portable reader/native bridge with minimal
hosted staging and the current approved Windows learning-write environment initially, **only
if** durable queued responses with delayed canonical publication are acceptable. The advantage
is preserving existing runtime behavior. The cost is that canonical assessed progress waits
for that writer, and another device must clearly see that pending state.

If canonical saves must also work when the primary machine is off, prefer one approved
always-on writer authority after focused portability/concurrency work and coordinated changes
to other participating writers. Do not claim the current Windows guard already works on a hosted
Linux process or another Windows interpreter. Source reading itself does not need arbitrary
canonical writes. Keep academic tracking separate from learning attempts.

A pure G:-based implementation is not the accepted final cross-device product. A standalone
API-backed tutoring app or embedded ChatGPT UI is not silently chosen by this ADR. Hosting/data
consent, budget, exact native entry point and desired final interaction surface remain relevant.
No migration, schedule or account change is authorized until the concrete proposal is accepted.
