# Current UI requirement index — evidence-alignment, 0.8.0

Current user-visible behavior is defined by the following story requirements in
[experience-spec.json](../../project/experience-spec.json) and the generated [flow packet](ui-flow.md).
These do not replace existing academic schemas. Historic feature discovery text follows for source
traceability; where earlier interaction/hosting wording differs, the 0.8 UI decisions and current
memory/workflow/native-proof contracts control. Actual transport readiness remains unverified.

| Requirement | Story | Behavior | Flow |
|---|---|---|---|
| evidence-alignment:REQ-101 | US011 | Read without clutter | UI06 |
| evidence-alignment:REQ-102 | US012 | Navigate predictably | UI06 |
| evidence-alignment:REQ-103 | US013 | Listen to relevant content | UI07 |
| evidence-alignment:REQ-104 | US014 | Control recording behavior | UI07 |
| evidence-alignment:REQ-105 | US015 | Read along accurately | UI08 |
| evidence-alignment:REQ-106 | US016 | Use transcript evidence | UI08 |
| evidence-alignment:REQ-107 | US017 | Connect study to practice | UI09 |
| evidence-alignment:REQ-108 | US018 | Keep source exploration reversible | UI09 |
| evidence-alignment:REQ-109 | US019 | Correct inaccurate matching | UI10 |
| evidence-alignment:REQ-110 | US020 | Handle source changes honestly | UI10 |
| evidence-alignment:REQ-111 | US035 | Keep useful references | UI18 |
| evidence-alignment:REQ-112 | US036 | Ask about a figure or written work | UI18 |

## Retained feature discovery context

> **Current operating contract (0.5.0):** use the always-on [Brain PC system](../../project/brain-pc-system.md), [workflow catalog](../../project/workflow-catalog.md), [memory contract](../../project/memory-contract.md) and [dispatch protocol](../../project/dispatch-protocol.md). These supersede earlier hosted/local-placement assumptions; full submitted Q/A and all-lecture scope are preserved. Existing feature goals below remain, but native execution and new write paths are NOT_RUN.

# Evidence linking and exact source navigation

Status: core user request; automatic inference behavior and thresholds are proposed.

## Behavioral contract

Selecting a slide returns the correct course/deck/source version, its concept links, relevant
recording intervals/transcript anchors, related question/subparts and textbook passages. Each
relationship is typed and inspectable. A proposed link must never be displayed as human-confirmed.
A missing source is not proof that no relationship exists.

Playback uses the original media plus interval metadata; it need not store a new audio file per
slide. For the illustrative 02:32–05:49 interval, the play-segment control seeks to 152 seconds,
plays through the requested end boundary, and stops/returns according to an explicit preference.
Actual seek/stop tolerances depend on the implementation and media; define them from the pilot
instead of claiming frame-perfect browser behavior now. Support pause/resume, segment replay,
range correction and a separate whole-recording action. A slide with several clips offers each
occurrence and optional sequential playback; it does not play intervening unrelated minutes.

## Proposed inference pipeline

Prefer explicit platform/export metadata and existing timestamped transcripts. For screen
recordings, use visual slide comparison plus timing evidence where available. For audio-only
recordings, retrieve candidates from transcript/slide content and lecture order, but permit
returns, skips and off-slide discussion. Existing data, ordered matching and semantic models
are evidence sources, not guarantees. MaViLS is relevant multimodal alignment research [R09].

Separate temporal alignment from semantic relevance. 'The slide is on screen' is not identical
to 'the instructor is explaining this slide'. Slide animations, repeated titles, equations
spoken differently from their printed form, unvoiced diagrams, discussion detours and repeated
visits are required evaluation cases. Audio-only ambiguity should produce an uncertain range
or no match, not confident fabricated timestamps.

Textbook/question matching first proposes exact versioned anchors from indexed sources;
semantic similarity alone does not prove a passage teaches the same claim or that an assignment
question can be solved with a single slide. Record why the link was proposed and allow rejection.
Use subparts where a problem spans multiple topics. Never treat a solution answer as the same
source as the question. Source formatting/metadata extraction precedes OCR; use OCR only where
native text or visual evidence is inadequate and verify equations/figure labels carefully.

## Corrections and invalidation

The learner can inspect adjacent media context, change start/end, add another interval, switch
source version, or reject the link. User changes are versioned and must survive indexing retries.
If a recording, deck or textbook edition changes, flag affected anchors/derived content for
review without erasing historic attempts. Reordering a slide does not silently retarget old links.

## Acceptance examples (not executed)

A confirmed interval resolves to the correct media and transcript; missing timestamps are
visible and correctable; a revisited slide has separate ranges; a question with two concept
requirements can link to multiple slides; textbook printed page and PDF index remain distinct;
reimport creates no duplicate sources; invalid times and nonexistent source anchors fail;
correcting a link updates its view without altering original files; a stale transcript does not
supply precise current citations; a source access denial does not fall back to another user's
material. Quantitative alignment/latency thresholds are OPEN pending representative data.

## Audit-driven scope and source truth (0.4.0)

All lectures remain release scope. P05 reports 37 units/31 sessions with 30 original recording/TXT
pairs. Existing BE 505 maps connect page ranges and transcript lines, not verified media times.
Prefer those reviewed associations as seeds; establish transcript fidelity/time origin before
force-aligning audio. The CS 542 MP4 content requires inspection before a visual-slide algorithm
is selected. Do not transcribe/retrieve all media without the needed data/processing permission.

The reported empty BE 572 L01 PDF, empty CS 542 L01 folder and BE 562 learner-reported unrecorded
lecture need honest per-source state. A slide-only explanation remains available where supported,
but a generated study voice cannot be presented as the missing original lecturer. Textbook
chapter references are not specific passage links until actual source anchors are reviewed.

An all-lecture inventory with unprocessed items is not a completed matching system. Acceptance
tracks per-lecture supplied material, reviewed correspondence, usable time boundaries and
explicit unresolved exceptions separately. Sampling validates the method, not the whole archive.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

| Check | Requirement (stories) |
|---|---|
| R1-U2 | The slide is fitted to the stage without distortion and without an inner scrollbar at 100% fit (US011, US012). |
| R1-U3 | One transport: exactly one play/pause, one timeline, one time readout; 96–128 px tall on desktop; inside the window without page scrolling at 1440×900, 1920×1080, 2560×1440 (US013, US014). |
| R1-U4 | With no timed link the transport says so in one line with one action; no interval is fabricated (US013). |
| R1-Q2 | The lecture context lists This slide / Related concepts / All lecture questions with the basis of each entry (US017). |
| R1-Q3 | Catalog locators are normalized at read time into typed anchors: slide pages, transcript line ranges, other-source pages. A page list is never widened into a range, and line numbers are never treated as pages or seconds. Coarse locators stay qualified (US017, US020). |
| R1-Q5 | The displayed deck follows the course index's source kind and explicit references; a question sheet is a related source (US011, US017). |
| R1-T1 | Generated speech timing is imported only from a verified manifest, applies to the generated text, states its window, and never marks a lecture as processed or a slide as matched (US015, US016, US019). |
| R1-T2 | Reviewed timing, generated timing, text-similarity suggestions and scheduling are reported as four separate facts (US010, US019). |


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Story, flow, workflow and task ids are unchanged and the original release requirements stay in force. Earlier text, including the R1 section above, is kept as history; where this section and older text differ, this section governs the listed behaviour only.

The requirements below are REOPENED as open product failures despite green receipts: the learner still cannot obtain usable slide-to-recording ranges or question-to-slide links, and rejects the visual design. Earlier LOCAL_TESTED results and R1 receipts of the affected tasks do not cover the checks named `R2-…`. Each check is stated with the outcome by which the learner would notice its failure; a passing mechanical test alone closes none of them.

**Superseded R1 sentences.** R1-T1's "never marks a lecture as processed or a slide as matched" still holds for the *import* alone; R2-T adds separate, labelled stages after it (text alignment, slide-link suggestions) and a per-recording stage readback. R1's "no speech run is part of this plan" is superseded within the local allowance of R2-T2, because the owner authorised offline transcription for this pass. R1-Q2's "basis of each entry" is extended by the anchor states of R2-Q3 and R2-Q5; "no slide named" is no longer an end state. R1-U3's count, height and reachability rules stay and apply to the transport bar as R2-V2 defines it; the look they were verified on does not. R1-U4's single no-match line is replaced by the six states of R2-T9.

**"Structural page"** in the checks below is shorthand for a page whose content role is structural title or section, administrative or blank (the three roles that force nothing). Objectives, summary and unknown-role pages are not structural pages.

### Lecture workspace (visual) — flows UI06, UI07, UI09

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-V1 | Collapsible lecture outline, large original-source canvas, one context panel. At default pane sizes the stage is at least half of the workspace width at 1440×900, 1920×1080 and 2560×1440; collapsing the outline is one action, gives its width to the slide and is remembered (US011, US012 · UI06). | The slide looking like a thumbnail between larger side panels, slide text unreadable at fit, or the outline not giving its space back. |
| R2-V2 | ONE compact media control system on the lecture page whichever tab is open: one play/pause, one timeline, one time readout, with the selected range and scope beside it. No tab, card or drawer has a second player. Compact has a measure: the transport bar — the controls, the timeline, the time readout and the one line of the selected range — is at most 128 CSS px tall on desktop and stays inside the window without page scrolling (R1-U3 kept). When a slide has several ranges the bar shows the selected one with "range i of k" and previous/next, and the full range list opens from the bar over the stage; it never grows the bar, pushes the transport out of the window or adds a second player (US013, US014 · UI07). | Two play buttons or two timelines anywhere on the page, a range that can only be played from a different control than the one that shows the time, or a transport that grows until the slide shrinks or the page scrolls when a slide has several ranges. |
| R2-V3 | A resizable context panel with five text-labelled tabs in this order — Tutor, Questions, Concepts, Transcript, Sources — each one visible action away; resize by drag and by keyboard, bounded so the stage keeps at least 40% of the workspace, width remembered per device (US011, US017, US037 · UI06, UI09, UI19). | Not finding Concepts or Sources from a lecture, a tab hidden in a menu, a panel that cannot be widened to read a long answer, or a width that resets on reload. |

### Slide identity and content roles (R2-S) — flows UI06, UI10, workflow WF02

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-S1 | ONE versioned read-side source map per deck version answers "which page, which logical slide, which build" for navigation, transcript, player, questions, Concepts and search. No consumer computes its own (US011, US012, US020 · UI06, UI10). | Two parts of the lecture page disagreeing about where they are: the outline highlights one page while Questions or Concepts list items of another, or a search hit opens a different page than it named. |
| R2-S2 | Identity kinds stay distinct and are never substituted for one another: source id, version and content hash; physical PDF page index with its explicit base (1) and the optional PDF page label; printed slide number only if established; PPTX slide id and ordinal only when a PPTX of that unit exists; the app's logical-slide identity with its evidence and revision; page/build variant or bounded region; recording occurrence. PPTX slide N is never assumed to be PDF page N (US011, US017, US020 · UI06, UI09, UI10). | A number whose kind is unstated or wrong: a PDF page presented as "Slide N", a PowerPoint number on a deck that has no PowerPoint, or a question's page 7 opening the seventh PowerPoint slide instead of physical page 7. |
| R2-S3 | Build/reveal sequences: consecutive pages are proposed as one logical slide only from several signals together (adjacency, layout, actual labels, text containment and difference, visual change). Every member stays an addressable build ("build 2 of 3"); content first shown on a later build is not attributed to an earlier one (US011, US012 · UI06). | A reveal sequence looking like unrelated slides each with its own empty lists, a single build that cannot be opened, or a concept revealed on the last build listed on the first. |
| R2-S4 | No false merges. Repeated headings, similar images, distinct derivation steps and repeated topics are not merged; when grouping is uncertain each page is its own logical slide. An adjacent page that repeats its neighbour and adds nothing is a duplicate ("duplicate of page N"), never a build; the same page shown again later in the deck stays its own slide. A handout page holding several slides exposes each as its own bounded region. Nothing is removed from the page inventory (US011, US020 · UI06, UI10). | Two different slides shown as one so that one of them cannot be opened, questioned or timed on its own; a repeated identical page announced as "build 2 of 2" as if something had been revealed; or a four-up handout page offering one target. |
| R2-S5 | Group, split and role corrections are versioned local annotations with predecessor and history, kept in the app's private area, never written to the course. They survive every rebuild. A deep link made before a map change still opens the same physical page of the same source version, or says the link was made for another version (US019, US020 · UI10). | A grouping the learner corrected coming back wrong after a rebuild, a saved link or bookmark opening a different page, or no way to see what the grouping was before. |
| R2-S6 | The visible wording states only what is known, for example "PDF page 23 of 91 · build 2 of 3"; "Slide 17" is added only when a number is established on that page itself, or when the source map records a match between that page and a PowerPoint slide (a PowerPoint file merely existing in the unit grounds nothing, and ordinal equality is not a match). A PDF-only inferred group never claims a recovered PowerPoint number (US011, US012 · UI06). | "Slide 23" on a page that is PDF page 23 of a deck whose printed slide number there is different or absent, or whose PowerPoint source has fewer slides than the PDF has pages. |
| R2-S7 | The content role of every page — instructional, worked example or question, objectives or summary, structural title or section, administrative, blank, mixed, unknown — is classified separately from numbering, grouping and audio discussion, with its evidence and its state (generated, agent-reviewed, human-confirmed), and can be corrected (US010, US011 · UI05, UI06). | A role that is invisible, cannot be corrected, or is presented as reviewed when it was only generated. |
| R2-S8 | A structural page gets no forced teach-back, no generated practice, no concept requirement and no missing-match warning; it offers Next content and whole-lecture access. Speech supported over a title page stays discoverable there, labelled as topical discussion, not as displayed-page evidence (US011, US013, US017 · UI06, UI07, UI09). | A cover or section page showing "no questions for this slide" or "no matching recording", a prompt to explain it back, an empty concept branch, or no way on to the next content page; or real speech over a title page being hidden. |
| R2-S9 | A page that is only an image or an equation is never suppressed, skipped or classified structural or blank because its extracted text is sparse (US011 · UI06). | A figure-only or equation-only slide missing from the outline, skipped by Next content, or labelled structural. |
| R2-S10 | Raw and instructional denominators are reported separately wherever coverage is shown, with the counts of the other roles (objectives or summary, unknown listed as uncertain, structural pages listed as excluded) so that they add up to the page count; every page stays in the inventory. Re-labelling pages changes no page's own state and never the raw numerator or denominator. The instructional figure depends on roles by definition: it moves only by the pages that were re-labelled, the raw figure is always shown beside it, the count of pages outside it is shown with how their roles were established, an unknown role is never counted as excluded, and nothing is called complete on the instructional figure alone (US010 · UI05). | A coverage figure with one unexplained denominator, totals that do not add up to the page count, or a figure that looks better after pages were merely re-labelled with nothing on screen saying how many pages were set aside and by whom. |
| R2-S11 | A replaced or reordered deck gets a new source-map revision for the new bytes. Links, annotations and question anchors made for the old version are kept with that version and flagged for review; none is silently retargeted to the page that now has the same number (US020 · UI10). | After a deck update, an old recording range or question link appearing on a different slide without any notice. |

### Timing to the player (R2-T) — flows UI05, UI07, UI08, UI10, workflow WF02

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-T1 | The existing timing proof is imported through the tested importer by adapting the producer's manifest on the consumer side. Every input and output hash and the recording's source id, version and content hash are checked; the producer's files are not changed; nothing in its window is recognised a second time (US010, US015 · UI05, UI08). | The Transcript tab of that lecture showing no generated timed text for the proof's window after the import; or showing it without its window, as if the lecture were timed. |
| R2-T2 | Further transcription runs offline with the verified local runtime: one worker, at most four CPU threads, bounded resumable chunks with checkpoints, under a cumulative processing allowance of four hours that is persisted across restarts and never reset by a retry. It pauses safely at the ceiling, on a stop request, on a resource failure or on a source conflict and keeps the remaining queue. Nothing is downloaded or installed; output stays in the app's private state; course transcripts and the producer's proof are never overwritten. The existing proposed downstream preparation task is bound to this SAME runner (same command, same settings identity) as a prepared, inactive record, only after real consumption was demonstrated, and without a schedule (US010 · UI05). | Coverage not saying how much processing time is used and left; a restart or retry resetting the used time or redoing finished chunks; processing running past four hours; a paused run losing its queue; or a later job that would transcribe with another tool or other settings than the one shown as verified, or that appears on a schedule nobody approved. |
| R2-T3 | Chunking is correct at the edges: chunk offsets are applied once, overlapping seams are de-duplicated, silence and partial final chunks are handled, and no time lies outside the original recording (US015 · UI08). | A sentence near a seam appearing twice or not at all, a generated line that plays audio from somewhere else, or a time after the recording's end. |
| R2-T4 | Generated words are kept separate from the course's original transcript text. A time reaches an original line only through a validated text-alignment mapping that records, per line, whether it aligned; unaligned lines carry no time (US015, US016 · UI08). | Generated wording mixed into or replacing the course transcript, or an original line showing a time that nothing supports. |
| R2-T5 | Slide association is scored over time windows and logical slides from page content, known transcript-line source maps, supported terminology and concepts, neighbouring windows and sequence evidence, by a sequence model that permits skips, repeats, backward jumps and unassigned intervals. The word "slide" is not required for a revisit (US013, US019 · UI07, UI10). | A slide the lecturer returned to showing only its first range; a skipped slide getting a range anyway; every slide receiving a range in strictly rising order whatever was said; minutes of digression attached to the nearest slide. |
| R2-T6 | The association method is benchmarked against the current lexical baseline on the same labelled references, reported side by side, with thresholds fixed before the held-out answers are read. Where no adequate semantic method is available with the existing tools, that precise gap is stated and lexical similarity is not certified as alignment (US019 · UI10). | Ranges presented as coming from a better method while the readback has no side-by-side with the baseline, or the comparison quoting numbers tuned on the answers. |
| R2-T7 | A timing link binds the recording's source version, the timebase, start and end, the logical slide, optional page or build support, the method, the evidence and a quality state. Acoustic timestamp quality, semantic association quality and group-mapping quality are three separate fields. That a slide was on screen is stated only where video frames of that recording were actually visible and inspected for that interval; otherwise a link says the slide was discussed, never that it was displayed (US013, US019 · UI07, UI10). | A range with a single "confidence" or with no statement of how it was produced; not being able to tell whether the doubt concerns the timestamps, the association or the grouping; or a range saying the slide was shown during it when the recording is audio only or nobody looked at its frames. |
| R2-T8 | Disjoint occurrences stay separate links. Recording time is never distributed evenly or proportionally over slides. A link made for a build group is labelled group-level and is not split into invented per-build ranges (US013, US014 · UI07). | Two visits shown as one long range that includes the minutes between them; all slides having ranges of the same length; each build of a group showing its own made-up sub-range. |
| R2-T9 | A slide without a range shows which of six different things is true, each produced by its own cause: not discussed (the whole recording was processed and matched); audio not processed yet (none of it, or only the stated part, in which nothing was found); not matched yet (the recording has timing but slide matching has not run on it with the current inputs — not run, inputs changed, or no adequate method available); ambiguous match; recording unavailable; or structural page, where no range is expected. A structural page is still matched like any other page: a supported range over it is shown as a range (US010, US013 · UI05, UI07). | The same sentence appearing for different causes, so that "not processed yet" cannot be told from "searched and not discussed"; a transcribed lecture whose slides all say "not discussed" or "not processed" when in truth matching never ran; or a title page whose real discussion is withheld because title pages are "not matched". |
| R2-T10 | Suggestions are rendered and labelled as suggestions, with their method, without requiring the learner to confirm each one. They are never marked human-confirmed or quality-qualified without that evidence. Reviewed and manual links are preserved across rebuilds and take precedence. A suggestion is current only for the inputs it was built from (recording bytes, timing generation, text alignment, source-map revision, method version); built from superseded inputs it is not shown as a current range. Start–end times are shown beside each linked segment and in the selected slide's context (US013, US019 · UI07, UI10). | Useful ranges hidden until each is approved; a generated range shown as confirmed; a link the learner fixed being replaced after a rebuild; a range that was made for an older transcription or an older grouping still shown as if current; a range shown without its times. |
| R2-T11 | Selecting a match seeks the one real player to its start and playback stops at its end, unless Repeat or Whole recording is chosen (US013, US014 · UI07). | Clicking a range and the player not moving, playback running on past the end, or Repeat and Whole recording not changing that. |
| R2-T12 | Each course publishes stage, coverage and backlog for every admitted recording and deck (inventoried, transcribed with its window, text-aligned, slide-linked, reviewed), each with its unresolved cause, and one resumable command continues the work. No schedule is created (US009, US010 · UI05). | A course's recordings or decks missing from coverage, a stage without counts or cause, a large unmapped backlog hidden behind one passing sample, or the command starting over instead of resuming. |
| R2-T13 | One complete real lecture is the end-to-end reference, including substantive content beyond the opening: fully transcribed within the allowance, aligned, linked and usable in the ordinary lecture view. It is a reference, not a limit of scope, and it does not establish acoustic or semantic accuracy (US013, US015 · UI07, UI08). | No real lecture that can be studied from its first to its last content slide with ranges beyond the opening minutes; or that lecture being reported as validated without anyone having listened. |

### Questions to content (R2-Q) — flow UI09, workflows WF02, WF03

R2-Q1 and R2-Q10 are defined in the [review packet](../review/requirements.md).

| Check | Requirement (stories · flow) | The learner would notice a failure as |
|---|---|---|
| R2-Q2 | The authoritative criteria, concepts and skills of each question are joined to the page / logical-slide map. Reviewed anchors are used first and are shown as exact; a page named by an anchor is matched by its physical page, never by a slide ordinal (US017, US037 · UI09, UI19). | A question with a reviewed page map missing from those pages, appearing under a slide that does not contain its page, or criteria and concepts on its card that lead nowhere. |
| R2-Q3 | For coarse or unmapped questions, candidate anchors are INFERRED separately from the actual prompt, criteria and rendered teaching content. Each candidate has its supporting page(s) or region(s) with source version, the question version, the criteria it supports (or, where none are catalogued, the part of the prompt) and a rationale, is stored as an attributable local suggestion in the fixed private format, and is rendered on the question's card as a **Suggested link** that says whether a second pass has checked it. A question with no anchor and no displayable candidate shows one of two lines and never "no slide named" alone: "Inspected, no supporting page found" with the reason, when its candidates were rejected by the checking pass; or "No suggested link" with the recorded reason (none produced for the course, none recorded for the question, or made for an earlier version). The second line makes no claim about whether the question was examined, because the record does not say (US017 · UI09). | An unmapped question saying only "no slide named", with no candidate and no reason; a candidate that exists in a file but appears on no card; a candidate without its page, rationale or the criteria it supports; or a line claiming that somebody looked, or that nobody did, when the record says neither. |
| R2-Q4 | Inference guards: shared vocabulary alone is insufficient; a link names the criteria it supports ("supports n of m criteria", in part where it is partial) and never claims a slide teaches the whole answer; nothing is inferred from problem-set numbering; no prompt, grading weight or figure requirement is invented. The reader refuses what it can check (unknown question, page outside the deck, criterion that is not the question's, empty rationale, other bytes or version); what it cannot check — that a rationale is more than shared words — is the producer's rule and the checking pass's verdict, so an unchecked candidate says "not yet checked" and a rejected one is never shown as a link (US017, US043 · UI09, UI22). | A suggested slide that merely shares words with the question presented like a checked one; a card implying one slide answers a multi-part question; a problem-set question attached to a lecture by its number; a requirement the original question does not contain. |
| R2-Q5 | Exact source maps, agent-inferred associations and generic concept-related questions are three distinct kinds with distinct labels; a rebuild never promotes one into another. Within suggestions, "not yet checked" and "checked by a second pass" are both agent work; the learner's own confirmation or rejection is a separate recorded state that outranks them and survives regeneration (US017 · UI09). | Not being able to tell a reviewed link from a suggestion or from "shares a concept"; a suggestion appearing as exact after a rebuild. |
| R2-Q6 | The lecture shows This slide, Related concepts and All lecture questions, each with its count; a count equals its rows and All lecture questions equals the lecture's catalogued total. In a build group each row says whether its support is on this build, elsewhere in the sequence (naming the build) or group-level (US017, US043 · UI09, UI22). | A count that differs from the rows under it, lecture questions that cannot be reached from a slide, or not knowing which build of a sequence a question refers to. |
| R2-Q7 | Question cards carry clickable source-page or build links. Opening one returns to that exact page of that exact source version and preserves the draft; Back returns to the question (US017, US018 · UI09). | A page reference that is plain text, a link that opens another version or the wrong page, or a draft that is gone after following it. |
| R2-Q8 | A structural page has no forced This-slide questions; the lecture's questions stay reachable from it (US017 · UI09). | A title page showing an empty "questions for this slide" warning, or no route from it to the lecture's questions. |
| R2-Q9 | The three examples named in the owner instruction are validated privately against the real course record: the question with a reviewed physical-page map and a separate transcript-line map appears on exactly those physical pages and its line map is not treated as pages; the coarse question an earlier pilot placed on one page is anchored only by what its actual source and criteria support, or stays unanchored with the reason; the problem-set question keeps its source-owned wording, gains only justified related slides and no invented drawing requirement, and its companion PDF is used as a rendition only after it was checked against the original (US017, US043 · UI09, UI22). | Any of those three questions shown on a page the course record or its own content does not support, or shown with wording or a requirement the original does not have. |
