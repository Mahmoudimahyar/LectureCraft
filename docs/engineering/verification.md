# Verification of build baseline 0.9.0

The package contains a finalized engineering specification and a small offline reference-validation
kit, **not an executable lecture-learning application**. No upstream Seed test suite, canonical academic
schema implementation, native client or browser application is included or claimed tested.

## Executed before packaging

- 48 local unit tests passed on Linux / Python 3.13.5, using already available jsonschema 4.26.0
  and referencing 0.37.0. No dependency installation was performed.
- 84 synthetic records matched their expected valid/invalid results across 14 new adapter record
  types plus common definitions. All 15 Draft 2020-12 schemas passed definition checks.
- Cross-record tests reject wrong scopes/threads/input identities, mismatched actions, malformed
  controls, and help inputs pretending to be assessments. Synthetic artifact checks exercise bytes,
  missing files, traversal, symlinks, extra files, duplicate names and lengths.
- 44 baseline checks passed: task graph, source/story/workflow/feature references, single-backlog
  consistency, preserved prior acceptance data, strictly inactive live gates, local document links,
  configuration and Python syntax, selected component references, and declared theme pairs.
- 50 solid-color token combinations met the selected text/nontext contrast floors. This is a numeric
  token check only; it is not a rendered UI, keyboard test, screen-reader test or WCAG certification.

The final archive is separately extracted; these commands rerun there and every manifest entry is
checked again. The companion `lecture-learning-build-baseline-v0.9.0-verification.json` records the
exact final archive hash/counts and post-export results, avoiding a self-referential archive checksum.
`python tools/check_baseline.py --manifest` additionally verifies the exact packaged file set.

## Not executed or established

Actual app UI/browser/device behavior; native dispatch/return/cancellation; Drive OAuth, signatures,
device pairing and media seeking; current academic writer compatibility and OS lock safety; all-lecture
processing and link quality; pedagogical evaluation; hosted CI; startup service; account grants;
security audit; public deployment or paid inference. The 292 inherited application acceptance cases
remain NOT_RUN. File/signature *shape* checks do not verify keys or grant permission.

The current academic system is represented by supplied reports, not live access. In particular, this
kit does not repair the reported BE 505 global-root writer or the source-hashing flag defect. The real
owner sources and isolation tests are required before using those paths. A mocked completion cannot
clear a live release gate.

## Reproduce offline checks

```bash
python -B tools/check_baseline.py --manifest
python -B tools/check_contracts.py
python -B -m unittest discover -s tests/contracts -v
```

Installation of the separately listed checker dependencies, if absent, needs an authorized local
environment and network. These commands themselves perform no installation/network calls. They are
not a substitute for later retained Seed checks and actual app verification under LL001–LL038.
