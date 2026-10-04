# Current data model — ownership plus exact adapter types

Retain canonical materials/source identities, skills.yaml, question-families.yaml, BE 505's existing
question index, original attempts and nonbranching assessment revisions. The existing actual schema
and writers must be imported under LL003, not guessed from audit excerpts. Existing enum meanings,
source version qualifications, same-intended-skill corrections and protected publisher ownership stand.

The new adapter formats are now defined in [contracts/index.json](../../contracts/index.json), with
local JSON Schemas and semantic reference checks. See [interface details](../engineering/interface-contracts.md)
for exact page/time/figure anchors, full-input snapshot, separately delivered tutor messages, context,
request/result, source-annotation revisions, review events, resume state and output manifests.

Concept trees and current learning gaps remain projections over canonical catalogs/effective original
assessments. New accepted timing annotations are durable source information under the existing
source-map owner; a generated export is not their only copy. Scheduling and resume own operational
facts only. The active SQLite journal is local, nonsynced and not a new gradebook or shared graph.

Historical source/record facts are in [the memory contract](memory-contract.md) and
[reported implementation fit](memory-workflow-fit.md). These reports are not new runtime validation.
