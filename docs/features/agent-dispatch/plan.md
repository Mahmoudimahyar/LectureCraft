# agent-dispatch — implementation work

Behavior and intended checks remain in requirements.md, ui-flow.md and test-plan.md. Work is taken from the one [integrated backlog](../../delivery/backlog.json); do not maintain independent completion checkboxes here.

- **LL007: Implement local job journal and migration lifecycle** — R1; depends on LL004.
- **LL018: Implement native adapter contract and safe local control** — R2; depends on LL004, LL007.
- **LL019: Prove one actual native desktop request and return** — R2; depends on LL018.
- **LL020: Prove second-device Drive read, paired input and output** — R2; depends on LL017.
- **LL021: Join coordinator, updater and owning writers** — R3; depends on LL007, LL008, LL014, LL018, LL019, LL020.
- **LL033: Implement activity, quota, lifecycle and bounded maintenance** — R4; depends on LL021, LL031, LL032.
- **LL034: Execute real-browser interaction, accessibility and theme suite** — R5; depends on LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033.
- **LL035: Exercise real tutoring-to-save and all-lecture readiness** — R5; depends on LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030.
- **LL036: Exercise backups, updates and rollback on copies** — R5; depends on LL008, LL032, LL033.
- **LL038: Package and approve the private whole-product release** — R5; depends on LL034, LL035, LL036, LL037.

Before code, convert the chosen task into a scope-bound Seed task record with actual paths and commands supported by that checkout. This packet does not ship the Seed runtime. A local contract-check PASS is not an application or live-provider PASS.
