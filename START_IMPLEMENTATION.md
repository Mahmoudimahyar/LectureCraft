# Start implementation — one project, all local work

This folder is the code workspace. Put it on a LOCAL nonsynced disk; do not extract it into a
course folder or Fall 2026 Brain. Recommended: `C:\Users\Mahyar\source\lecture-learning`.
See [placement](docs/implementation/placement.md). Course materials remain on G:/Drive untouched.
This kit contains the 0.9.0 specification/contracts/tests plus the full-project execution handoff.
The actual Seed runtime could not be materialized here; a validated optional local importer is
provided. Its absence is honest provenance information, not permission to fabricate that runtime
or to halt the entire app's independent implementation.

## One-time start
Use **Claude Code** locally (terminal or the Claude Desktop Code tab), not ordinary Chat/Cowork
or a cloud session that cannot access your PC. Sign in yourself before leaving. Use a supported
Auto permission mode for this CODE workspace when available; it reduces routine prompts but
can still deny or ask about actions. Accept edits alone still asks for other commands. Never
select bypass permissions on a PC exposing your private courses/accounts merely to keep it busy.

Open this folder, inspect the execution charter, choose Auto when supported, and paste
PROMPTS/START_WITH_GOAL.txt as ONE message when /goal is available. It points to the full
PROMPTS/IMPLEMENT_ALL.md and defines the completion condition. Without /goal use the full
implementation prompt in the approved local Code session. That prompt
supplies a standing local implementation scope for all 38 tasks, not only the former LL-S01.
Do not run another product-interview prompt or a generic Seed initializer over these documents.

Before you leave, let Claude finish installation/preflight of the chosen local development tools
and surface actual human-only approvals once. Missing runtime permissions are not fixable by a
longer prompt. Leave the selected environment running and awake. Authentication and plan limits
can still interrupt execution; no few-hour completion guarantee is made.

## Included checks
On Windows, create the development environment without changing execution policy or the existing
academic publisher interpreter. The following assumes you are in the new code folder:
```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-doc-checks.txt
.\.venv\Scripts\python.exe tools/preflight.py
```
Use that environment's interpreter for the checks below (or `python` after normal activation):
```powershell
python -m pip install -r requirements-doc-checks.txt
python tools/check_baseline.py
python tools/check_contracts.py
python -m unittest discover -s tests/contracts -v
python -m unittest discover -s tests/handoff -v
python tools/preflight.py
python tools/build_board.py status
```
Use a repo-local virtualenv and its Python executable. These are handoff/contract checks, not app
acceptance. Once implementation begins, use its real unit/component/browser/adapter checks too.
Use `--manifest` only to verify the freshly extracted distribution; implementation rightly changes
packaged bytes. Never regenerate hashes simply to call old evidence current.

## Optional bounded unattended CLI session runner
After the above setup, a supported current native CLI and your local authorization:
```powershell
python tools/run_claude.py --execute --hours 8
```
Without --execute it only previews. This is an eight-hour maximum, NOT an estimate or guarantee.
The helper starts ONE native /goal process, not a custom retry loop. Native /goal owns its
continuation and can stop or pause on unmet capability, no progress, quota/auth or other errors.
The helper also stops its process tree on the configured time/STOP limit. It does not defeat
platform limits. It uses
Auto plus no-permission-prompts in supported print mode and an empty MCP config to avoid inheriting
unrelated connected accounts. If exact local repo MCP tools are verified later, use the normal Code
session instead of silently broadening this launcher. You can use this project without the helper. Native /goal evaluation sees the conversation,
not an independent test execution: retain actual test outputs and audit the final reports.

## Completion
The original release gates remain in docs/delivery/activation-gates.json. Code/local checks can be
complete while native/Drive/device/course publication is blocked. All evidence goes in .local/reports.
See [execution charter](docs/implementation/execution-charter.md) and [settings report contract](docs/operations/native-setup-report.md).
