# evidence-alignment — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

## UI06 — Study a slide and control the workspace

**Feature:** `evidence-alignment` · **Stories:** US011, US012 · **Status:** specified, not implemented

**Workflows:** WF02, WF10 · **Memory:** M01, M02, M12 · **Screens:** SC04, SC05

**Trigger:** Open a lecture or choose a thumbnail.

### Preconditions
- At least one permitted source or explicit unavailable state can be resolved.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose a slide thumbnail or previous/next control | The central canvas identifies the deck version and stable slide anchor. |
| 2 | Zoom or enter Focus | The slide becomes larger while return and media controls stay reachable. |
| 3 | Select Tutor, Transcript or Sources | One context panel changes; slide position and draft are preserved. |
| 4 | Change slide during playback | Current clip pauses by default; the new slide does not unexpectedly autoplay. |
| 5 | Inspect original versus readable text rendition | The original appearance stays distinguishable; extraction/OCR uncertainty is exposed. |

### Alternatives and failure paths
- A blank or unreadable slide is reported, not silently regenerated as source truth.
- If a draft is tied to the previous slide, keep its context chip and ask before changing its source scope.
- An unavailable animation/PPTX element is labeled as a static rendition with original access when permitted.

### Read dependencies
- Exact deck version and permitted rendition
- Current slide and draft/source anchors

### Writes and owner
- View preferences and resume state only

### Completion
- User remains oriented and can navigate/read without accidental playback, submission or lost draft.

### Responsive / accessibility details
- Previous/next shortcuts do not hijack typing, sliders or tree controls.
- Narrow screens show Slide as a full main pane with accessible zoom/pan and a text alternative where available.

**Related existing planned cases:** AC12, AC13, AC20, AC33. These remain NOT_RUN and are not replaced by the new UI cases.

## UI07 — Play the slide-specific recording

**Feature:** `evidence-alignment` · **Stories:** US013, US014 · **Status:** specified, not implemented

**Workflows:** WF02, WF10 · **Memory:** M01, M02, M12 · **Screens:** SC04, SC05

**Trigger:** Press Play this segment or choose an associated occurrence.

### Preconditions
- Actual playable media and a qualified interval exist; candidate status is visible.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Inspect recording label and interval | See source/session, discussion-versus-displayed basis, and confirmed/suggested status. |
| 2 | Press Play segment | Seek to the selected interval and show current media time within that range. |
| 3 | Pause, scrub, change speed, repeat or use jump controls | Controls retain one media position; seeking is clamped in clip mode. |
| 4 | Reach the end of the interval | Stop by default; repeat occurs only when selected. |
| 5 | Choose another occurrence or Whole recording | Explicitly switch the bounded range or enter labeled full-recording mode. |

### Alternatives and failure paths
- No timed match leaves full recording/transcript browsing available where permitted; it does not invent timestamps.
- Unsupported media or seek failure shows the actual problem without claiming playback.
- Changing theme or opening an ordinary source drawer never reloads the player; starting voice capture pauses lecture audio.

### Read dependencies
- Verified media identity, interval metadata, playable rendition
- Playback and accessibility preferences

### Writes and owner
- Playback position/preference; exposure where an assessed session actually shows material, not automatic competence

### Completion
- The selected interval plays within measured implementation tolerance and ends under the selected mode.
- No unrelated middle section is silently played between disjoint occurrences.

### Responsive / accessibility details
- Provide labeled keyboard-operable time slider and numeric time input as a non-drag alternative.
- No autoplay on initial page load or device resume; captions/transcript controls remain accessible.

**Related existing planned cases:** AC11, AC12, AC13, AC14. These remain NOT_RUN and are not replaced by the new UI cases.

## UI08 — Read and navigate the transcript

**Feature:** `evidence-alignment` · **Stories:** US015, US016 · **Status:** specified, not implemented

**Workflows:** WF02, WF04, WF10 · **Memory:** M01, M02, M12, M13 · **Screens:** SC04, SC05

**Trigger:** Open Transcript or select a transcript source chip.

### Preconditions
- Transcript availability, source version and timing quality are explicit.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Transcript | See the matching version, speaker labels when available and timing qualification. |
| 2 | Play a verified linked segment | Highlight the current span only where alignment is supported. |
| 3 | Scroll away from playback | Suspend auto-follow and show Follow playback to resume; never pull the view back unexpectedly. |
| 4 | Select a timed line or text range | Seek only when mapped; Quote/Ask attaches the exact selected range and version. |
| 5 | Report a transcript/source error | Open a proposed correction route; original text is not overwritten from the reader. |

### Alternatives and failure paths
- An untimed transcript still supports reading/search and line references, but no fake current-word animation.
- Audio wording and transcript disagreement remains visible rather than silently asserting one is exact.
- Transcript reveal during a source-hidden practice is deliberate and records known exposure.

### Read dependencies
- Versioned raw transcript and timing annotations
- Current media time and source-disclosure condition

### Writes and owner
- Follow/scroll UI state; request source references
- Explicit correction proposal to source owner; exposure records only where relevant

### Completion
- Reading, following, quoting and seeking are accurate to the available evidence.

### Responsive / accessibility details
- Selectable text, speaker labels not color-only and no high-frequency live-region reading on every word.
- Phone has full-width transcript with an anchored mini player.

**Related existing planned cases:** AC11, AC18, AC21, AC63. These remain NOT_RUN and are not replaced by the new UI cases.

## UI09 — Open linked questions, textbook passages and figures

**Feature:** `evidence-alignment` · **Stories:** US017, US018 · **Status:** specified, not implemented

**Workflows:** WF02, WF04, WF10 · **Memory:** M01, M02, M05, M12, M13 · **Screens:** SC04, SC05, SC06

**Trigger:** Choose a connected-material card or answer citation.

### Preconditions
- Each link has a source identity, relationship type and qualified locator.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose a related problem or reading passage | A drawer or nested view shows why it is linked and its exact source/version. |
| 2 | Open the original question | All subparts, figures and givens remain accessible; a catalog prompt is not silently substituted. |
| 3 | Inspect a textbook passage | Show edition, PDF position and printed page when known as distinct fields. |
| 4 | Choose Ask, Practice or pin source | Carry selected sources explicitly into the next action. |
| 5 | Return to lecture | Restore origin slide, draft, panel and media time without autoplay. |

### Alternatives and failure paths
- A chapter-only relation remains chapter-level; no invented page appears.
- Permission-denied or unavailable content does not fall back to a different book/edition without consent.
- An answer-key source is not shown as the problem prompt; reveal follows the course policy.

### Read dependencies
- Source links and identities
- Full question/source prompt, figures and access rules

### Writes and owner
- Navigation stack and explicit context selection; no new attempt from opening a link

### Completion
- A correct source span opens with provenance and the learner can return without losing work.

### Responsive / accessibility details
- Desktop can pin source drawer; mobile uses a full view with Return to slide.
- Link names describe the source/subpart instead of repeated Click here labels.

**Related existing planned cases:** AC17, AC20, AC21. These remain NOT_RUN and are not replaced by the new UI cases.

## UI10 — Correct a link or reconcile a source revision

**Feature:** `evidence-alignment` · **Stories:** US019, US020 · **Status:** specified, not implemented

**Workflows:** WF02, WF09, WF10 · **Memory:** M01, M02, M12, M14 · **Screens:** SC04, SC05, SC14, SC12

**Trigger:** Choose Edit match/Report link, or a source revision invalidates an anchor.

### Preconditions
- Correction ownership and permission are known; no direct uncontrolled edit of protected source records.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Edit match | See the previous annotation, evidence, exact media/deck versions and editable candidate range. |
| 2 | Preview nearby context and adjust start/end or add an occurrence | Numeric fields and play preview show the proposed effect without saving. |
| 3 | Confirm a corrected association or Reject link | Submit a revision referencing its predecessor and source versions. |
| 4 | Watch publication status | Candidate, accepted annotation and refreshed view are separate; the current verified view persists until replacement is complete. |
| 5 | Reopen after reprocessing | The accepted correction remains and conflicts require explicit resolution. |

### Alternatives and failure paths
- End before start or outside recording duration is rejected inline.
- A concurrent source/annotation change stops publication and offers compare, not last-write-wins.
- Undo creates an owned revision restoring intent; it does not erase the audit or older attempts.

### Read dependencies
- Previous annotation/version, source range bounds, writer permissions

### Writes and owner
- Durable owned source annotation revision
- Derived alignment view and dependency invalidation receipt
- No original recording/deck rewrite

### Completion
- The correct owner accepted a valid revision and the client can verify the resulting view, or an explicit conflict remains.

### Responsive / accessibility details
- Drag is optional; keyboard/numeric start/end editing is always available.
- On mobile, focused correction view shows one preview at a time.

**Related existing planned cases:** AC14, AC57, AC58. These remain NOT_RUN and are not replaced by the new UI cases.

## UI18 — Save a note, reference or figure question

**Feature:** `evidence-alignment` · **Stories:** US035, US036 · **Status:** specified, not implemented

**Workflows:** WF04, WF10 · **Memory:** M01, M02, M06, M12 · **Screens:** SC04, SC05, SC11

**Trigger:** Bookmark a source, select text/figure, or choose Save note.

### Preconditions
- Annotations are learner-authored work, not instructor sources or learning assessments.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Select a passage, slide region or source bookmark | Show the selected source/version and preview the intended capture. |
| 2 | Choose Note or Ask about this | A note stays authored work; a question explicitly submits permitted context to the tutor. |
| 3 | Save the note/bookmark | Show actual local/synchronized retention state and link back to the source. |
| 4 | Open saved items | Find note, source and associated conversation without duplicating the original material. |
| 5 | Edit or archive the note | Preserve needed referenced versions; do not rewrite the source or prior assessed input. |

### Alternatives and failure paths
- A figure selection is a contextual crop plus full-source link, not automatic scientific understanding.
- Handwritten/image attachment can be submitted as evidence; recognition is not claimed until verified or confirmed.
- If the source version disappears, keep the note and report unresolved original access.

### Read dependencies
- Selected source identity/range, note/version and access policy

### Writes and owner
- Learner-authored work/bookmark under existing work role through reviewed adapter
- Question request only on explicit Send; no attempt for a highlight

### Completion
- The note or contextual question stays linked to its original source and does not alter competence/history.

### Responsive / accessibility details
- Provide text/whole-slide selection alternative to precision dragging.
- No mandatory rich-text editor stack; use maintained accessible editor primitives when sufficient.

**Related existing planned cases:** AC20, AC33, AC49. These remain NOT_RUN and are not replaced by the new UI cases.


## Remediation amendment R1 (2026-10-05)

Bounded change against baseline 0.9.0 after the owner-reported failures of 2026-10-05. Story, flow, workflow and task ids are unchanged and the original release requirements stay in force; where this section and older text differ, this section governs the listed behaviour only. Earlier LOCAL_TESTED results for the affected tasks do not cover the checks named `R1-…` below.

**UI06 / UI07 / UI08 / UI09 — arrangement.** The steps of these flows are unchanged. Their surface is now: outline (left, collapsible) · slide stage with the single transport beneath · one context panel with tabs Tutor, Transcript, This slide, Questions. "Open linked questions" (UI09) starts from the **This slide** and **Questions** tabs; each entry shows its basis and opens the question, and a question without catalog wording offers Open original and, where verified, a display rendition.

**UI07 — no timed link.** The transport shows "Whole recording · no timing for this slide" with "Link this slide" as the single action (when linking is permitted) and a details disclosure. Generated speech text, when imported, appears in the Transcript tab under its own heading with its covered window and "generated, not reviewed".


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Flow, story, workflow and screen ids and the step tables above are unchanged. Earlier text, including the R1 notes above, is kept as history; where these notes and older text differ, these notes govern the listed behaviour only. Checks are defined in the [requirements](requirements.md); states in the [shared contract](../../project/ui-state-and-interaction-contract.md).

**Superseded R1 notes.** The R1 arrangement note named four tabs (Tutor, Transcript, This slide, Questions); R2 names five (Tutor, Questions, Concepts, Transcript, Sources) and a resizable panel. The R1 "no timed link" note used one line for every cause; R2 distinguishes six. "Link this slide" remains available as a manual action and is no longer the only way a range can appear.

**UI06 — Study a slide and control the workspace (R2-V1, R2-V3, R2-S1 – R2-S4, R2-S6 – R2-S9).**
- Step 1: the canvas identifies the deck version and states the slide identity as known — "PDF page N of M", with "· build i of k" inside a build sequence and "Slide n" only when grounded. The outline shows logical slides; a build sequence is one entry that expands to its builds, an adjacent repeat is marked "duplicate of page N" and never as a build, a handout page expands to its regions, and every physical page is reachable.
- Step 2: collapsing the outline or entering Focus enlarges the slide; the one transport stays reachable.
- Step 3: the context panel has five tabs and can be resized by drag or keyboard; the slide position, the draft, the playback position and the selected range are preserved.
- Added alternative: on a structural page (title or section) the workspace offers **Next content** and whole-lecture access, and shows no prompt to explain back, no generated practice and no missing-match warning. A figure-only or equation-only page is ordinary content.
- Added alternative: the page's content role and how it was established are shown in the slide details and can be corrected there.

**UI07 — Play the slide-specific recording (R2-V2, R2-T5, R2-T7 – R2-T11, R2-T13).**
- Step 1: the transport bar shows the selected range of the slide in one line (start–end, its kind, and "range i of k" with previous/next); the range list, opened from the bar over the stage, shows every range as a row with start–end times, its kind (suggestion with method, reviewed, entered by you) and whether it belongs to this page or to the whole build group. Suggestions are shown without a confirmation step and are never worded as confirmed; a range says "discussed", and "shown" only where video frames were inspected.
- Step 2: selecting a range moves the one player to its start.
- Step 4: playback stops at the end of the range; Repeat and Whole recording are the two explicit ways to change that.
- Step 5: separate visits are separate rows; nothing between them is played.
- Replaced failure path: with no range, exactly one of six lines is shown — not discussed (searched), audio not processed yet, not matched yet (with its cause), ambiguous (show candidates), recording unavailable, structural page (no range expected). A structural page with supported talk shows that range instead.

**UI08 — Read and navigate the transcript (R2-T1, R2-T3, R2-T4).**
- Step 1: the course transcript and the generated speech text are separate, labelled parts; the generated part states its covered window.
- Step 2 and 4: a course-transcript line shows a time and seeks the player only when the validated text-alignment mapping supports that line; other lines keep their line reference and show no time.
- The imported timing proof appears here for its own window and nowhere as a timed lecture.

**UI09 — Open linked questions, textbook passages and figures (R2-Q2 – R2-Q9, R2-S8).**
- Trigger: the **Questions** tab, with three lists and their counts — This slide, Related concepts, All lecture questions.
- Step 1: every row states its basis (exact, stated, suggested link, concept-related, inspected with no supporting page found, or no suggested link with its recorded reason). A suggested link is shown on the card itself with its supporting page or region, "supports n of m criteria", its rationale and whether a second pass has checked it; a partial link says it is partial; Accept and Reject record the learner's own decision. In a build group a row says "on this build", "elsewhere in this sequence" or "group-level".
- Step 2: a question without catalogued wording keeps Open original (R1-Q4 stays).
- Step 5: a source-page or build link on a card opens that page of that source version; the draft, the panel and the playback position are kept, and Back returns to the card.
- Added alternative: a structural page shows no forced This-slide list; All lecture questions stays available.

**UI10 — Correct a link or reconcile a source revision (R2-S5, R2-S11, R2-T6, R2-T7, R2-T10).**
- Step 1: Edit match also shows the method, the evidence and the three separate qualities of the link (timestamps, association, group mapping).
- Step 3: besides time corrections, the learner can group pages into one logical slide, split a group, mark a handout region and correct a page's content role. Each is a new local revision naming its predecessor; nothing is written to the course.
- Step 5: after any rebuild the accepted correction is still in force and outranks a regenerated suggestion.
- Added alternative: when the deck's bytes change, links and anchors made for the earlier version are listed for review with that version; none moves to the page that now has the same number. A deep link made earlier opens the page it was made for or says which version it belonged to.
