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
