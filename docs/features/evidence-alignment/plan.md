# evidence-alignment — implementation work

Behavior and intended checks remain in requirements.md, ui-flow.md and test-plan.md. Work is taken from the one [integrated backlog](../../delivery/backlog.json); do not maintain independent completion checkboxes here.

- **LL006: Implement local drafts and immutable submission capture** — R1; depends on LL004, LL005.
- **LL011: Render slides, figures and scoped source drawers** — R1; depends on LL005, LL009.
- **LL012: Implement clip playback and synchronized transcript controls** — R1; depends on LL011.
- **LL013: Implement durable owned source annotations and correction UI** — R2; depends on LL004, LL008, LL011, LL012.
- **LL015: Prepare and align all available lecture material** — R2; depends on LL012, LL013, LL014.
- **LL034: Execute real-browser interaction, accessibility and theme suite** — R5; depends on LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033.
- **LL035: Exercise real tutoring-to-save and all-lecture readiness** — R5; depends on LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030.
- **LL038: Package and approve the private whole-product release** — R5; depends on LL034, LL035, LL036, LL037.

Before code, convert the chosen task into a scope-bound Seed task record with actual paths and commands supported by that checkout. This packet does not ship the Seed runtime. A local contract-check PASS is not an application or live-provider PASS.
