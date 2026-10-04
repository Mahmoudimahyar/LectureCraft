# workspace-access — implementation work

Behavior and intended checks remain in requirements.md, ui-flow.md and test-plan.md. Work is taken from the one [integrated backlog](../../delivery/backlog.json); do not maintain independent completion checkboxes here.

- **LL005: Build shared source-first shell, tokens and components** — R1; depends on LL002, LL004.
- **LL009: Normalize read-only catalogs and complete source inventory** — R1; depends on LL003, LL004.
- **LL010: Implement course navigation and bounded search** — R1; depends on LL005, LL009.
- **LL014: Extend the existing updater receipt handoff** — R2; depends on LL003, LL007, LL009.
- **LL015: Prepare and align all available lecture material** — R2; depends on LL012, LL013, LL014.
- **LL017: Pair devices and implement signed immutable Drive bundles** — R2; depends on LL002, LL004, LL006, LL007.
- **LL020: Prove second-device Drive read, paired input and output** — R2; depends on LL017.
- **LL031: Implement versioned resume and multi-device conflicts** — R4; depends on LL006, LL017.
- **LL032: Implement scoped export, retention and reference-safe cleanup** — R4; depends on LL008, LL027, LL030, LL031.
- **LL034: Execute real-browser interaction, accessibility and theme suite** — R5; depends on LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033.
- **LL035: Exercise real tutoring-to-save and all-lecture readiness** — R5; depends on LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030.
- **LL036: Exercise backups, updates and rollback on copies** — R5; depends on LL008, LL032, LL033.
- **LL038: Package and approve the private whole-product release** — R5; depends on LL034, LL035, LL036, LL037.

Before code, convert the chosen task into a scope-bound Seed task record with actual paths and commands supported by that checkout. This packet does not ship the Seed runtime. A local contract-check PASS is not an application or live-provider PASS.
