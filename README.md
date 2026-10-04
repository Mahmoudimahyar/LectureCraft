# Lecture Learning — full-project Claude implementation kit

**Package 0.10.0 · Product specification 0.9.0 · Application not yet implemented.**
One private checkout with the complete design, 38-task backlog, 32 UI flows, 64 stories,
12 workflows, 15 memory responsibilities, contract fixtures and continuous-build handoff.
This is the repository to give Claude Code, not a deployed tutor or an overnight guarantee.

Start: [implementation instructions](START_IMPLEMENTATION.md) ·
[one-message Claude goal](PROMPTS/START_WITH_GOAL.txt) · [full prompt](PROMPTS/IMPLEMENT_ALL.md) ·
[code/data placement](docs/implementation/placement.md) ·
[standing local scope](docs/implementation/execution-charter.md) ·
[roadmap](docs/delivery/roadmap.md) · [native settings report](docs/operations/native-setup-report.md).

## What changed from the previous baseline
The user's request now covers ALL local implementation work, not only LL-S01. Local task facets
separate code construction/testing from human-only live activation, so missing native transport
or OAuth does not stall unrelated UI, persistence and test work. Original acceptance gates and
all-lecture scope are preserved. Repeated routine coding permission questions are not required;
actual platform controls, privacy, account limits and live mutation boundaries still apply.

Recommended extraction: `%USERPROFILE%\source\lecture-learning` on a nonsynced local disk.
Keep the five courses and Fall 2026 Brain in their existing G:/Drive folders. Do not place this
Git/venv/node_modules checkout inside a course/planner or put the university archive under Git.

## Included tooling
The retained offline contract/specification checks are executable now. Build-board progress,
command receipts, preflight, bounded optional Claude CLI launcher and safe local Seed-source
importer are also included. All model/application work is left to the coding agent. See the
companion verification report for what actually ran during preparation.

The genuine Seed Repo archive could not be materialized in this environment. The kit does not
claim its runtime/tests are bundled. An exact local import is supported from your Downloads
when that existing ZIP is available; otherwise Claude must record the upstream gap and continue
independent app work. [Details](docs/implementation/foundation-provenance.md).

## Checks
```text
python tools/check_baseline.py
python tools/check_contracts.py
python -m unittest discover -s tests/contracts -v
python -m unittest discover -s tests/handoff -v
python tools/preflight.py
python tools/build_board.py status
```
Dependencies for these offline checks are in requirements-doc-checks.txt; application locks
must come from real resolution of the selected stack, not guessed latest versions. No .env
secret is needed for offline checks. Known source examples, transcripts and diagrams here are
illustrative/reported material, not live course state. Keep this packet private.

Do not call a successful fixture, local unit test, generated UI image or queued request proof
of live tutoring, accurate diagnosis, source alignment, durable canonical saving or release
readiness. Claude must produce actual browser/test reports and the remaining settings/actions.

[Local validation boundaries](docs/implementation/validation.md) · [Checked native documentation](docs/implementation/research-sources.json)
