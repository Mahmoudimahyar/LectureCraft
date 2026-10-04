# tutoring — implementation work

Behavior and intended checks remain in requirements.md, ui-flow.md and test-plan.md. Work is taken from the one [integrated backlog](../../delivery/backlog.json); do not maintain independent completion checkboxes here.

- **LL006: Implement local drafts and immutable submission capture** — R1; depends on LL004, LL005.
- **LL008: Isolate and wrap the real course writers** — R1; depends on LL003, LL004, LL006.
- **LL022: Implement quick answers and deeper sourced conversation** — R3; depends on LL006, LL010, LL018.
- **LL023: Implement criterion-aware teach-back and practice** — R3; depends on LL006, LL008, LL009, LL022.
- **LL024: Implement spoken teach-back with corrected text evidence** — R3; depends on LL006, LL012, LL023.
- **LL025: Calibrate alignment, tutor and assessment task evaluations** — R3; depends on LL015, LL022, LL023, LL024.
- **LL026: Implement diagnostic hypothesis and real WAITING_USER continuation** — R3; depends on LL023.
- **LL027: Implement disputes, capture corrections and genuine new answers** — R3; depends on LL008, LL023.
- **LL034: Execute real-browser interaction, accessibility and theme suite** — R5; depends on LL010, LL011, LL012, LL013, LL016, LL022, LL023, LL024, LL026, LL027, LL028, LL029, LL030, LL031, LL032, LL033.
- **LL035: Exercise real tutoring-to-save and all-lecture readiness** — R5; depends on LL015, LL019, LL020, LL021, LL025, LL026, LL027, LL029, LL030.
- **LL038: Package and approve the private whole-product release** — R5; depends on LL034, LL035, LL036, LL037.

Before code, convert the chosen task into a scope-bound Seed task record with actual paths and commands supported by that checkout. This packet does not ship the Seed runtime. A local contract-check PASS is not an application or live-provider PASS.
