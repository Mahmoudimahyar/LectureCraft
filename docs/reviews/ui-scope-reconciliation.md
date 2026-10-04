# 0.8.0 UI scope reconciliation

The prior package did not yet incorporate the user's five preference answers and explicit theme
request. This update consolidates user-visible behavior while leaving operational proof unresolved.

- Main brief, site map, design direction, plan and readiness now use one current baseline instead of
  retaining old laptop-off/hosted-placement choices as active product questions.
- Quick answer is help style, not a false failed assessment or a reset of prior knowledge. Actual
  Explain back responses can be assessed even when concise feedback is requested.
- Full prospective visible Q/A remains required; historical excerpts are not backfilled by a model.
- All lecture units stay in scope, including missing, empty and unprocessed sources.
- The six existing feature owners are reused. 32 UI flows are not 32 backend workers or new agents.
- All six feature folders now have current ui-flow.md, test-plan.md and plan.md. Existing requirement
  context remains for provenance, with current story requirements indexed and explicitly authoritative
  for interface behavior. Markdown mirrors are generated from one experience-spec.json.
- Three theme choices and original-source color fidelity are specified. Images are references, not
  verified science, product data or evidence of connectivity. Unrelated generated architecture
  infographic claims are not imported into the design.
- All 76 previous workflow scenarios are retained exactly. UI-specific and global checks are separate,
  named and NOT_RUN. No executable JUnit case IDs, passing CI or browser results are invented.
- Exact native route, authorizations, writer isolation, retained audio duration, live data retention and
  scheduler/quality metrics still need concrete permitted implementation decisions/evidence.

Original uploaded archives and images remain unchanged. This packet is private and includes retained
course/workspace context; it is not a sanitized public Seed Repo release or an implementation.
