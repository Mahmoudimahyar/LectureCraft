# Development, checks and private release policy

Use a private application Git repository separate from the non-Git academic workspace. Import the
reviewed Seed foundation without overwriting modified instructions or resetting history. Main stays
reviewed; agents use short-lived scoped branches and small commits. Commit messages describe actual
behavior, not claims that a model verified everything. Retain upstream test/profile and approval checks.
No generated course materials, tokens, local client configs, app databases or raw learner artifacts in Git.

## Check profiles to implement

- Always: baseline contracts/docs, type checks, unit and integration regressions, secret/static checks.
- UI changes: real browser flows, light/dark snapshots where useful, keyboard and accessibility checks.
- Adapter changes: strict fixture negative cases plus the applicable actual native/Drive/writer proof.
- Model/prompt/rubric changes: reviewed held-out task evaluations and regression/abstention checks.
- Release: all active story/workflow/UI global cases, full-archive coverage, supported devices, recovery,
  actual permissions and a clean packaged-artifact verification.

An optional integration may be omitted from a scoped fixture PR with a truthful boundary; the complete
product's required live integration cannot be waived with mocks. If a native test cannot run in hosted
CI, require a reviewed signed/digested local evidence artifact tied to the exact code/config/native
version. That is separate evidence, not a GitHub runner passing the native test. Missing critical
results block release. Fix defects; never loosen expectations or delete tests merely for a green badge.

Use the actual Seed approval and GitHub policy contracts. Configuration files are proposals until
remote repository rules, identities and permissions are installed and read back. No hidden auto-deploy
workflow. Set required checks on the real repository only with authorization. No arbitrary action or
unreviewed dependency pin is invented in this design package; LL037 records the actual setup.

Every app release includes commit/tag, spec baseline hash, protocol compatibility, dependency locks,
SBOM/license notices, known limits, test/evaluation receipts, supported browser/native versions and
upgrade/rollback instructions. Build from a reviewed clean tree; independently extract/install test
and verify hashes. Only then create the immutable prerelease tag and deliberately promote. A visual
prototype or document package cannot be labeled a complete personal learning application.
