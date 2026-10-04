# ADR 0004 — one implementation baseline, not another discovery loop

Status: selected engineering design, 0.9.0. Basis: explicit user request to finalize roadmap,
versioning and specifications while preserving prior confirmed requirements. No live grant implied.

Decisions: static React/TypeScript UI plus modular same-user Python Brain; direct authorized Drive
transport; paired signed immutable requests/results; no public inbound PC endpoint; native adapter
only after exact-thread/process-return proof; existing owner schemas/writers retained; 14 new adapter
record types with strict local schemas; one R0–R5 backlog; independent app/spec/schema/source versions;
selected reusable UI/media/scheduler components; conservative policy defaults and measurable acceptance.

Alternatives rejected: new canonical graph/gap/attempt stores, hosted inference substitution, a second
source updater, private session database access, arbitrary desktop clicking, tiny-lecture product scope,
all-tests-before-code waterfall, and infinite reasoning-agent polling. Source scope and safety are not
traded for faster demonstration. Existing UI/story semantics remain unchanged.

Tradeoffs: the native interface and actual scoped Drive access remain empirical activation gates;
strict signed contracts add small pairing/validation work; app-shell hosting requires user-controlled
origin/deployment; full all-lecture preparation requires actual source-quality work. None is hidden
under a mock PASS. Fixtures/UI can proceed independently under approved implementation scope.

Consequences: LL001–LL038 and first scope LL-S01 tell the coding agent what to build next. Unknown
installed identities are populated by verified setup, not invented here. Dependency locks are generated
from real installation evidence, not guessed numerical versions. Actual acceptance is recorded outside
these specification documents. Superseded plans remain marked historical for provenance.
