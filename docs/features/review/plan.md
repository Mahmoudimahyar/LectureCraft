# review — implementation work

Behavior and intended checks remain in requirements.md, ui-flow.md and test-plan.md. Work is taken from the one [integrated backlog](../../delivery/backlog.json); do not maintain independent completion checkboxes here.

- **LL028: Implement selected rich questions and review items** — R4; depends on LL009, LL016, LL023.
- **LL029: Implement scheduler adapter and immutable review events** — R4; depends on LL002, LL004, LL023, LL028.
- **LL034: Execute real-browser interaction, accessibility and theme suite** — R5; depends on LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033.
- **LL035: Exercise real tutoring-to-save and all-lecture readiness** — R5; depends on LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030.
- **LL038: Package and approve the private whole-product release** — R5; depends on LL034, LL035, LL036, LL037.

Before code, convert the chosen task into a scope-bound Seed task record with actual paths and commands supported by that checkout. This packet does not ship the Seed runtime. A local contract-check PASS is not an application or live-provider PASS.
