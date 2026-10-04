# Code, course data, and runtime placement

Recommended (new path; not claimed to exist):
```text
C:\Users\Mahyar\source\lecture-learning\       This code checkout + local venv/node_modules
C:\Users\Mahyar\AppData\Local\LectureLearning\  Future nonsynced app journal/cache
G:\My Drive\University\Boston University\
    Fall 2026 Brain\                                 Existing planner/tools/config
    BE 505\                                         Existing course
    BE 562\
    BE 572\
    CS 542\
    DS 551\
```
Keep the app logically alongside the academic system, NOT nested inside any course or planner.
There is no need for a physical G: sibling to access those paths. Do not move/rename the six roots,
put the whole university folder under Git, or synchronize .git, venv, node_modules or a live SQLite
journal through Drive. Optional later code backups are clean versioned source archives, not another
active development checkout participating in file sync.

The original planner-config.yaml remains the authority for configured course roots. The app's local
binding file points to it; it is not a second editable course registry. The supplied default path
is a candidate from the audit. Verify it and course identities instead of picking similarly named
migration snapshots. Per-source Drive IDs still need the documented resolver; G: is a Windows route,
not a portable URL to send to the phone.

Code may be edited in Windows or an isolated development environment, but canonical publication
must use the actually verified Windows host/user/interpreter and owning writer. A WSL interpreter,
venv, scheduled system account or copied module does not share that protection automatically.
Do not execute installed BE 505 save/refresh against a fixture by setting --root: global paths are
reported in those helpers. Read source first and refactor only an isolated copy until reviewed.

Development .local/build and .local/reports live inside this nonsynced checkout and are ignored.
Private permitted owner-interface snapshots go in .local/academic-reference, not fixture source or
Git. All future real course inputs and writes obey their individual contracts. The kit creates none.
