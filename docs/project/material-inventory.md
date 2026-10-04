# All-lecture evidence inventory — audit snapshot

Source: P05, managing-agent audit dated 2026-10-02, Matrix 2 and Q025-Q042.
This design session read the report, not the original media. Counts are physical files,
including duplicates, HTML assets and exported bundles. No coverage percentage can be
computed by dividing the source-index record count by the physical file count.

All configured courses and lectures remain in product scope. Small reviewed examples are
interface tests, not a reduced three-lecture release. Later arrivals join the same inventory.

| Course | Numbered units | Dated sessions | Recording/TXT pairs | All material files | Bytes | Key exceptions |
|---|---:|---:|---:|---:|---:|---|
| BE 505 | 7 | 7 | 7 M4A | 59 | 571,529,459 | Precise recording intervals unverified. L07 has no cataloged diagnostic set. Textbook references in examined maps are broad, not precise passages. |
| BE 562 | 7 | 7 | 6 M4A | 63 | 276,838,285 | L02 deck present but unindexed. Sep 22 session folder empty. Roadmap records the learner report that Lecture 6 was not recorded; not merely a transcription backlog. |
| BE 572 | 14 | 7 | 7 M4A | 220 | 539,957,756 | L01 PDF is zero bytes. L03-L13 packets not fully source-indexed. L13 has information only. HTML assets and ZIP/extracted duplicates are physical files, not independent lectures. |
| CS 542 | 6 | 6 | 6 MP4 | 83 | 595,258,046 | L01 folder empty. L04-L06 PPTX present but unindexed. Three of six transcripts present but unindexed. Video screen/slide visibility was not verified; MP4 alone does not establish it. |
| DS 551 | 3 | 4 | 4 M4A | 81 | 182,283,547 | All three present lecture PDFs are unindexed. No L04 deck found in inventoried lecture area; absence from scope is not proof it never existed. No precise slide-time alignment established. |

Total: **37 units, 31 session folders, 30 recording/TXT pairs, 506 material files,
2,165,867,093 bytes**. Within lecture/session trees: 246 files and 1,711,362,279 bytes.
The report records 175 source-index entries with 168 distinct current paths. This is a
snapshot, not a lifetime cap or proof all files were scientifically reviewed.

Representative transcripts lacked observed timing; not every line was inspected. Until
verified, do not claim a usable timestamp layer. CS 542 video files require inspection to
establish whether slides are visible. No audio/video playback was performed in P05.

## Link evidence to retain without upgrading its certainty

- BE 505 L02 pages 26-32 → transcript lines 175-211 → selected mass-action questions.
- BE 505 L04 pages 23-26 in the recorded v2 source → lines 226-313 → diagnostics/PS02 Q01.
- BE 505 L06 reviewed session reaches slide 73; later deck slides are deferred material.

These are report-described prose/source-map associations (P05, example alignment chains),
not verified recording intervals or complete textbook passage anchors. In particular, a
later slide absent from the sampled session is not evidence it was never taught elsewhere.

## Proposed inventory states (UI vocabulary, not course schema changes)

Track file presence, source registration, content review, rendition readiness, timestamp
alignment and link review separately. Distinguish present-unindexed, empty/unreadable,
not-found-in-scope, learner-reported-not-recorded, access-denied, stale and unresolved.
Never make a missing original recording look like a generated instructor recording.
A newly generated study explanation may be offered only as visibly separate authored content.

For each unit, the release view must account for every supplied artifact and every known
exception. All confidently evidenced relationships should be actionable; unresolved matches
must not be fabricated to reach a nominal 100% completion bar. See [acceptance](probe-and-acceptance-plan.md).
