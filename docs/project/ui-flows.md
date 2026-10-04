# UI flow catalog — 0.8.0

32 connected flows specify the agreed private all-lecture product, including setup, failure,
correction, accessibility and lifecycle states. They are generated from `experience-spec.json`.
This is not 32 independent apps, backend workflows or always-running model agents. User interaction
is distinct from canonical evidence. New design defaults are in [UI decisions](ui-decisions.md).
Every flow consumes the [shared interaction/state contract](ui-state-and-interaction-contract.md)
and [global UI acceptance](ui-global-acceptance.json). No application tests have run.

## Index

| Flow | Experience | Feature | Stories | Workflows |
|---|---|---|---|---|
| UI01 | Connect the private workspace | workspace-access | US001, US002 | WF00, WF11 |
| UI02 | Connect, reconnect or sign out on another device | workspace-access | US003, US004 | WF00, WF10, WF11 |
| UI03 | Choose a course, lecture or resume point | workspace-access | US005, US006 | WF01, WF10 |
| UI04 | Search and jump without losing study context | workspace-access | US007, US008 | WF04, WF10 |
| UI05 | Add materials and inspect preparation coverage | workspace-access | US009, US010 | WF01, WF02, WF03, WF10 |
| UI06 | Study a slide and control the workspace | evidence-alignment | US011, US012 | WF02, WF10 |
| UI07 | Play the slide-specific recording | evidence-alignment | US013, US014 | WF02, WF10 |
| UI08 | Read and navigate the transcript | evidence-alignment | US015, US016 | WF02, WF04, WF10 |
| UI09 | Open linked questions, textbook passages and figures | evidence-alignment | US017, US018 | WF02, WF04, WF10 |
| UI10 | Correct a link or reconcile a source revision | evidence-alignment | US019, US020 | WF02, WF09, WF10 |
| UI11 | Get a quick answer without forced assessment | tutoring | US021, US022 | WF00, WF04, WF10 |
| UI12 | Understand a concept through guided conversation | tutoring | US023, US024 | WF00, WF04, WF06, WF10 |
| UI13 | Submit and assess a typed teach-back | tutoring | US025, US026 | WF00, WF05, WF10 |
| UI14 | Explain aloud and correct transcription | tutoring | US027, US028 | WF00, WF05, WF09, WF10 |
| UI15 | Practice a question with explicit assistance | tutoring | US029, US030 | WF00, WF05, WF06, WF10 |
| UI16 | Investigate a gap and return to the lecture | tutoring | US031, US032 | WF05, WF06, WF10 |
| UI17 | Challenge feedback, correct input or try again | tutoring | US033, US034 | WF05, WF09, WF10 |
| UI18 | Save a note, reference or figure question | evidence-alignment | US035, US036 | WF04, WF10 |
| UI19 | Explore a typed concept tree | progress | US037, US038 | WF03, WF10 |
| UI20 | Review learning gaps and choose study priorities | progress | US039, US040 | WF05, WF06, WF10 |
| UI21 | Inspect conversation and attempt history | progress | US041, US042 | WF09, WF10 |
| UI22 | Create or select meaningful review items | review | US043, US044 | WF03, WF07, WF10 |
| UI23 | Edit, suspend or retire a review item | review | US045, US046 | WF07, WF08, WF09, WF10 |
| UI24 | Run a review session and handle mistakes | review | US047, US048 | WF05, WF06, WF08, WF10 |
| UI25 | Inspect, cancel and recover a request | agent-dispatch | US049, US050 | WF00, WF11 |
| UI26 | Resume across devices and resolve competing drafts | workspace-access | US051, US052 | WF00, WF10, WF11 |
| UI27 | Continue during network, quota or native failures | agent-dispatch | US053, US054 | WF00, WF11 |
| UI28 | Choose light, dark or system appearance | workspace-access | US055, US056 | WF10 |
| UI29 | Configure provider, assistance and operating limits | agent-dispatch | US057, US058 | WF00, WF11 |
| UI30 | Export data and manage retention deliberately | workspace-access | US059, US060 | WF10, WF11 |
| UI31 | Finish or pause a study session | progress | US061, US062 | WF10 |
| UI32 | Inspect and authorize a bounded repair | agent-dispatch | US063, US064 | WF01, WF09, WF10, WF11 |

## UI01 — Connect the private workspace

**Feature:** `workspace-access` · **Stories:** US001, US002 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M01, M03, M14 · **Screens:** SC01, SC02, SC13

**Trigger:** First visit, explicit Add connection, or a missing required grant.

### Preconditions
- Single learner; no public signup, payment, team invitation or archive migration.
- Use the supported, separately authorized account flow; no copied tokens.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Connect course workspace | See what data will be read, which approved writes may later occur and what stays outside scope. |
| 2 | Choose the correct account and course folder bindings | Course IDs and terms are reconciled with existing configuration; same-name snapshots are not selected by guess. |
| 3 | Review requested access and confirm the supported authorization | Drive read, input submission, native route and writer status appear as separate checks. |
| 4 | Choose Open workspace | Available original sources can be browsed even when AI execution is not verified. |
| 5 | Open Setup details when a required capability is blocked | See the precise next action without an instruction to weaken permissions. |

### Alternatives and failure paths
- Denied or cancelled access returns to connection review without deleting existing records.
- A missing native bridge shows Native connection not verified; it is not labeled Connected because the PC is on.
- A mismatched term/course/root stops activation for that binding only.

### Read dependencies
- Course configuration and source identities
- Authorized capability/readiness receipts

### Writes and owner
- Connection/preference metadata: app configuration owner, no secret values in course Markdown
- No attempt, grade, catalog or publisher installation is created

### Completion
- The selected private sources resolve or their exact access gap is visible.
- No test run or live writer activation is inferred from accepting a screen.

### Responsive / accessibility details
- Keyboard-first form, password-manager-compatible supported authorization, explanatory errors.
- Mobile uses the same scoped steps rather than a desktop G: path.

**Related existing planned cases:** AC05, AC06, AC39, AC41, AC43, AC47. These remain NOT_RUN and are not replaced by the new UI cases.

## UI02 — Connect, reconnect or sign out on another device

**Feature:** `workspace-access` · **Stories:** US003, US004 · **Status:** specified, not implemented

**Workflows:** WF00, WF10, WF11 · **Memory:** M03, M12, M14, M15 · **Screens:** SC01, SC13, SC14

**Trigger:** Open the app on a new device or manage an existing device connection.

### Preconditions
- Original course IDs remain unchanged.
- Current independent device/client access may still require proof.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open the private app on the new device | Connection flow names the current device and data scope; it never expects a G: mount. |
| 2 | Authorize the supported device access | Verify selected course identity and read permissions before offering current content. |
| 3 | Choose Restore study position | Show the last synchronized checkpoint and its age; do not assume it includes unsynced work. |
| 4 | Open Settings → Devices → Sign out | Explain local-only drafts, pending requests and retained synchronized history. |
| 5 | Resolve unsynced drafts, then confirm sign-out | Revoke supported device access and clear permitted local cached access without claiming provider-wide erasure. |

### Alternatives and failure paths
- Reauthentication does not redispatch pending requests.
- A sign-out during an accepted native job states that the PC job may continue; cancel it separately when desired.
- Device removal is not permission to erase the original course archive.

### Read dependencies
- Scoped account/device grants
- Resume and pending-request receipts

### Writes and owner
- Device connection/preference owner
- Draft export or cancellation only from the explicit selected action

### Completion
- The new device can verify permitted content or reports its limitation.
- Sign-out outcome distinguishes device access, pending work and retained history.

### Responsive / accessibility details
- No QR-only or pointer-only requirement.
- Resume never autoplays audio on a newly opened device.

**Related existing planned cases:** AC32, AC33, AC34, AC47. These remain NOT_RUN and are not replaced by the new UI cases.

## UI03 — Choose a course, lecture or resume point

**Feature:** `workspace-access` · **Stories:** US005, US006 · **Status:** specified, not implemented

**Workflows:** WF01, WF10 · **Memory:** M01, M09, M12 · **Screens:** SC02, SC03, SC04

**Trigger:** Open Study or return from a lecture.

### Preconditions
- An authorized current or explicitly stale inventory is available.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Study | See configured courses, a continue card and modest due/pending summaries rather than a wall of metrics. |
| 2 | Choose a course | See every inventoried lecture unit and its dated session relationships; missing sources remain visible. |
| 3 | Filter/search within the course | Preparation status stays separate from viewed or assessed evidence. |
| 4 | Choose a lecture or Continue | Open its exact source version and last valid position. |
| 5 | Inspect unavailable material status | See not supplied/not recorded/empty/inaccessible/unprocessed distinctions and available alternatives. |

### Alternatives and failure paths
- A recording reported never made has no fake processing spinner.
- Zero attempts displays Not assessed, not 0% ability.
- Filtering does not change the all-lecture coverage denominator.

### Read dependencies
- Course inventory, source statuses and latest readable views
- Resume reference and source version

### Writes and owner
- UI navigation/resume only; no learning attempt for viewing

### Completion
- A correct lecture opens or its availability is explained.
- All-lecture inventory is preserved irrespective of readiness.

### Responsive / accessibility details
- Cards/rows have descriptive accessible names.
- Phone uses a readable list, not miniaturized desktop thumbnails.

**Related existing planned cases:** AC09, AC13, AC74. These remain NOT_RUN and are not replaced by the new UI cases.

## UI04 — Search and jump without losing study context

**Feature:** `workspace-access` · **Stories:** US007, US008 · **Status:** specified, not implemented

**Workflows:** WF04, WF10 · **Memory:** M01, M04, M05, M12, M13 · **Screens:** SC17, SC04, SC05, SC06, SC10

**Trigger:** Use the search control or a keyboard shortcut outside text entry.

### Preconditions
- Search is limited to authorized indexed content; query does not authorize web research.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open search | Current course is the explicit default scope with an All my courses option. |
| 2 | Enter a term or question | Results are grouped by lecture/source, question and typed concept/skill, with source and indexing qualifications. |
| 3 | Choose an exact hit | Open the appropriate page, transcript range, question or concept with a return link. |
| 4 | Return to study | Restore slide, current draft and panel state; avoid automatic playback restart. |
| 5 | Clear or broaden the query | Explain no results versus unindexed/inaccessible material. |

### Alternatives and failure paths
- Search results cannot expose answer keys hidden by the current attempt policy.
- Text fragments without a verified locator open qualified source context, not a fabricated page/time.
- Large result sets remain bounded and keyboard navigable.

### Read dependencies
- Authorized source/catalog search view
- Active assistance and source-disclosure context

### Writes and owner
- Optional local search state; not a canonical attempt or automatic search-provider call

### Completion
- The selected result opens with its identity and return context preserved.

### Responsive / accessibility details
- Escape returns focus to the invoking control.
- Mobile search uses full-screen content with the same categories.

**Related existing planned cases:** AC17, AC18, AC39, AC75. These remain NOT_RUN and are not replaced by the new UI cases.

## UI05 — Add materials and inspect preparation coverage

**Feature:** `workspace-access` · **Stories:** US009, US010 · **Status:** specified, not implemented

**Workflows:** WF01, WF02, WF03, WF10 · **Memory:** M01, M02, M04, M14 · **Screens:** SC03, SC05, SC12

**Trigger:** Material arrives through Drive or the learner explicitly adds an authorized file.

### Preconditions
- Existing source updater remains the registration owner; app does not create a shadow scheduler.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Add authorized material or view detected changes | See selected destination/course and file roles before writing a submitted bundle. |
| 2 | Confirm the upload action | Show Uploading, available locally, and registered/processed states separately. |
| 3 | Open preparation details | See source registration, rendition, alignment and concept-link work independently. |
| 4 | Inspect a blocked item | Explain empty/unsupported/ambiguous ownership/permission status with a bounded next action. |
| 5 | Return to studying | Background work continues only within approved limits and never requires constant model polling. |

### Alternatives and failure paths
- Duplicate export is compared by identity/content, not automatically registered as new instructor material.
- New content can invalidate related output; accepted manual annotations remain preserved.
- The existing updater backlog cap is not bypassed to make the UI look finished.

### Read dependencies
- Existing updater receipts and complete inventory
- Authorized destination and source roles

### Writes and owner
- Approved upload/request bundle
- Source registration only through the current source owner
- Derived preparation/coverage views

### Completion
- Each detected/uploaded item has a truthful stage or reason it cannot proceed.
- All material stays within its existing ownership.

### Responsive / accessibility details
- Progress is labeled; unknown totals use indeterminate progress without made-up percentages.
- Uploading can continue independently of the visible course page only where actually supported.

**Related existing planned cases:** AC09, AC10, AC46, AC57, AC74. These remain NOT_RUN and are not replaced by the new UI cases.

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

## UI11 — Get a quick answer without forced assessment

**Feature:** `tutoring` · **Stories:** US021, US022 · **Status:** specified, not implemented

**Workflows:** WF00, WF04, WF10 · **Memory:** M01, M03, M05, M06, M12, M13, M14 · **Screens:** SC04, SC06, SC12

**Trigger:** Choose Quick answer or explicitly ask for brief help.

### Preconditions
- Course assistance rules and actual provider capability permit the request.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Quick answer and type the question | Composer shows the pinned slide/source context and actual configured native destination. |
| 2 | Press Send | Preserve the submitted question; show transport/queue state separately from answer completion. |
| 3 | Receive the answer | Direct answer first, concise explanation and source chips; no compulsory initial quiz. |
| 4 | Read the small assessment label | Not assessed in this exchange: receiving an answer does not establish understanding; previous evidence is unchanged. |
| 5 | Choose Go deeper, Try explaining or Save question | Continue under the chosen interaction, or move on immediately. |

### Alternatives and failure paths
- Quick answer is brevity, not authority to bypass course restrictions or source permission.
- If an actual explanation/answer was submitted for assessment, brief feedback may still assess it; quick style does not erase observed evidence.
- If help is requested mid-attempt, offer Submit my response first or Reveal help without assessment and record exposure.

### Read dependencies
- Question, source refs, course strategy, effective assistance policy and selected context

### Writes and owner
- Immutable question and delivered tutor message, request/context receipt
- No attempt solely because the learner requested/received an answer

### Completion
- A concise, source-grounded answer or clear limitation is delivered; no false success/failure is inferred for the learner.

### Responsive / accessibility details
- Streamed text does not repeatedly steal focus; status updates are modest.
- One obvious Send action; no forced timed exercise.

**Related existing planned cases:** AC18, AC39, AC75. These remain NOT_RUN and are not replaced by the new UI cases.

## UI12 — Understand a concept through guided conversation

**Feature:** `tutoring` · **Stories:** US023, US024 · **Status:** specified, not implemented

**Workflows:** WF00, WF04, WF06, WF10 · **Memory:** M01, M03, M04, M05, M06, M12, M13 · **Screens:** SC04, SC05, SC10, SC11

**Trigger:** Choose Understand/Go deeper or ask for a fuller explanation.

### Preconditions
- Use existing course-specific teaching depth and source restrictions.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Understand | Tutor starts from the active question and known relevant context, not a generic chapter dump. |
| 2 | Ask for an example, contrast, mechanism or connection | Explanation is layered and source-linked; uncertainty or external additions are labeled. |
| 3 | Choose a useful follow-up or type one | Continue in the same context while preserving a return to the slide. |
| 4 | Choose Try explaining or a short check | Only the explicitly submitted learner response enters assessment. |
| 5 | Choose Give me the short answer or Return to lecture | End the detour without penalties or invented completion credit. |

### Alternatives and failure paths
- Missing concept-tree nodes are a system-coverage issue; original material may still support help.
- A source disagreement is exposed, not resolved by silently overwriting course framing.
- Automatic outside research is not implied by an unclear internal source.

### Read dependencies
- Permitted source neighborhood, existing strategy, relevant effective attempts where authorized

### Writes and owner
- Visible conversation and operational next-question state
- Assessment only via explicit real-response path

### Completion
- Learner controls depth and can leave; sources and any limits remain visible.

### Responsive / accessibility details
- Responses use paragraphs, optional sections and readable math rather than wall-of-text panels.
- Narrow screens preserve the slide-return anchor.

**Related existing planned cases:** AC18, AC24, AC65, AC75. These remain NOT_RUN and are not replaced by the new UI cases.

## UI13 — Submit and assess a typed teach-back

**Feature:** `tutoring` · **Stories:** US025, US026 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF10 · **Memory:** M01, M03, M04, M05, M06, M07, M08, M09, M13, M14 · **Screens:** SC04, SC06, SC18, SC12

**Trigger:** Choose Explain back/Check my explanation and submit a real response.

### Preconditions
- Full displayed question/context is identifiable; a valid rubric/family is used or explicitly pending.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Explain back | Show what to explain, source/reference visibility, full question and required figures. |
| 2 | Write the explanation | Draft stays attached to its original source context; autosave is labeled by actual durability. |
| 3 | Press Check my explanation | Freeze and retain full input before inference; repeated submit resolves to one logical response. |
| 4 | Review feedback | Show what was supported, partial, incorrect or not observed against actual criteria, with assistance and uncertainty. |
| 5 | Inspect save status | Input retained, assessment candidate, canonical attempt saved and view refreshed are independently visible. |
| 6 | Continue, dispute or attempt again | Later messages do not alter the frozen original; a new answer differs from regrading. |

### Alternatives and failure paths
- A missing rubric retains the response as Assessment pending; it does not invent schema-valid learning evidence.
- A valid alternative explanation is judged by criteria, not string matching to one model answer.
- A writer failure after evidence save retains that saved evidence and marks only the view/remaining step pending.

### Read dependencies
- Full question/source snapshot, intended family/revision/skills, actual context and help conditions

### Writes and owner
- Immutable full learner turn and attachment receipts
- Compatible attempt through course writer; full tutor message separate
- Derived learning-gap view

### Completion
- Full input is retained even on model failure; any assessment has transparent scope and verified publication status.

### Responsive / accessibility details
- Text editor supports readable math, preview and clear validation.
- Feedback is navigable by criterion; saves are announced without focus theft.

**Related existing planned cases:** AC19, AC20, AC21, AC22, AC23, AC49, AC50, AC51, AC61, AC62. These remain NOT_RUN and are not replaced by the new UI cases.

## UI14 — Explain aloud and correct transcription

**Feature:** `tutoring` · **Stories:** US027, US028 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF09, WF10 · **Memory:** M03, M05, M06, M07, M12, M13, M15 · **Screens:** SC18, SC04, SC06

**Trigger:** Press the microphone on an explanation/answer composer.

### Preconditions
- The selected transcription route and required data permissions are explicitly available; typing remains fallback.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Record | Explain microphone/process/retention policy before capture and pause lecture playback. |
| 2 | Start, pause or stop recording | Clear recording state, elapsed time and user control; no invisible always-listening mode. |
| 3 | Inspect the transcript | Correct recognized terms, symbols and wording; mark uncertain spans rather than guessing. |
| 4 | Choose Submit transcript or Retain audio under the approved option | Preserve transcript lineage and only the raw audio permitted by policy. |
| 5 | Receive feedback | Assess the confirmed available response; ambiguous recognition can cause clarification/abstention, not confident diagnosis. |

### Alternatives and failure paths
- Denied microphone or unavailable transcription keeps typed input available without paid fallback.
- Closing/navigating while recording prompts stop/cancel handling; no silent background capture.
- Correcting submitted transcription is a linked evidence/assessment correction, not overwriting an old snapshot.

### Read dependencies
- Device microphone grant, selected processing/retention policy, active task context

### Writes and owner
- Approved transcript/optional audio sidecars and lineage
- Only confirmed actual response reaches compatible attempt writer

### Completion
- The learner knows what was captured/transmitted/retained, can correct it, and no recognition guess becomes false learning evidence.

### Responsive / accessibility details
- Keyboard and screen-reader recording controls; visible plus non-color recording signal.
- No requirement to speak; media does not compete with the microphone.

**Related existing planned cases:** AC19, AC21, AC63, AC64. These remain NOT_RUN and are not replaced by the new UI cases.

## UI15 — Practice a question with explicit assistance

**Feature:** `tutoring` · **Stories:** US029, US030 · **Status:** specified, not implemented

**Workflows:** WF00, WF05, WF06, WF10 · **Memory:** M01, M03, M05, M06, M07, M08, M12 · **Screens:** SC06, SC04, SC05

**Trigger:** Choose Practice from an existing question, lecture or concept.

### Preconditions
- The actual question/figures, course restrictions and source visibility are explicit.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open the question | See full prompt, givens and origin; choose supported reference conditions without a false secure-exam claim. |
| 2 | Attempt it | Keep answer editor separate from hidden solutions; preserve the shown question revision. |
| 3 | Request a hint or reveal sources | Record actual available help; reveal is deliberate and permitted by course policy. |
| 4 | Choose Submit answer | Evaluate the real answer with help conditions through WF05. |
| 5 | Ask for quick help or a diagnostic | Switch deliberately; allow submission of the current response before reveal or help without assessment. |

### Alternatives and failure paths
- A practice with sources hidden is self-study, not proof that external/native-session help was absent.
- An inaccessible/forbidden solution remains inaccessible, including through search and hidden client payloads.
- Skip or reveal without response does not create a fake failed attempt.

### Read dependencies
- Question/family/rubric/source version and course assistance rules

### Writes and owner
- Actual response snapshot and assistance/exposure record; compatible assessment via WF05

### Completion
- A real answer is assessed under the recorded conditions, or help/skip is captured without invented performance.

### Responsive / accessibility details
- Accessible question/figure text alternatives do not leak restricted solutions.
- Hint and reveal controls are separated from Submit and have clear labels.

**Related existing planned cases:** AC20, AC21, AC27. These remain NOT_RUN and are not replaced by the new UI cases.

## UI16 — Investigate a gap and return to the lecture

**Feature:** `tutoring` · **Stories:** US031, US032 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF10 · **Memory:** M03, M04, M05, M06, M07, M08, M12, M13 · **Screens:** SC04, SC06, SC10, SC11

**Trigger:** Choose Understand this gap or accept a diagnostic suggestion after feedback.

### Preconditions
- A real observation or explicitly labeled uncertain hypothesis exists; not every wrong answer has one known cause.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Inspect the proposed issue | Show the observed response and possible causes, not a permanent label. |
| 2 | Choose a short diagnostic | Present one discriminating question, with Skip/Just explain/Return options. |
| 3 | Answer or pause | Wait for real input and release the reasoning worker; a saved pending question does not run itself. |
| 4 | Review the updated interpretation | Supporting and contradictory evidence are linked; a new response may refute the first hypothesis. |
| 5 | Choose Go deeper or Return to slide | Deeper follow-up is optional, bounded, and resumes the original study context. |

### Alternatives and failure paths
- Default detour is short (normally up to two follow-up prompts); further depth needs a fresh user choice, not an infinite loop.
- No response leaves the issue pending, not failed or resolved.
- A wrong advanced answer does not mark every prerequisite ancestor weak.

### Read dependencies
- Effective attempts, typed relationships, source references and pending diagnostic state

### Writes and owner
- Operational diagnostic proposals and visible messages
- Actual next answers assessed through WF05; gap view derives from effective records

### Completion
- The next discriminating step is delivered or actual evidence refines the hypothesis; learner can stop without penalty.

### Responsive / accessibility details
- One question at a time with a persistent Return to slide action.
- No badge animation or notification implies the gap is resolved from merely reading help.

**Related existing planned cases:** AC24, AC25, AC40, AC65, AC66. These remain NOT_RUN and are not replaced by the new UI cases.

## UI17 — Challenge feedback, correct input or try again

**Feature:** `tutoring` · **Stories:** US033, US034 · **Status:** specified, not implemented

**Workflows:** WF05, WF09, WF10 · **Memory:** M05, M06, M07, M08, M09, M14 · **Screens:** SC06, SC11, SC12, SC14

**Trigger:** Select Report an issue, Correct transcript or Try again on feedback.

### Preconditions
- The original response and assessment references are visible; editing history is not unrestricted.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose the correction type | Distinguish wrong assessment, wrong captured input, source/rubric issue and genuinely new answer. |
| 2 | Inspect original and proposed correction | Preserve exact original content, time and assessment lineage. |
| 3 | Submit the correction for the appropriate owner | Show Pending review/verification; no immediate mastery change from clicking Disagree. |
| 4 | Inspect the resulting revision | Regrade preserves the same original intended skills; schema-changing rubric issues need a separate reviewed path. |
| 5 | Choose Try again when learning has changed | Capture a new real response instead of overwriting or disguising it as a regrade. |

### Alternatives and failure paths
- Conflicting correction branches stop for reconciliation.
- Changing a source/model/visualization does not automatically regrade every historical attempt.
- A saved input recognition error requires linked evidence correction; original text is not edited in place.

### Read dependencies
- Original turn/assessment, question family and correction rules

### Writes and owner
- Owned assessment_revision or appropriate source/input correction proposal
- New attempt only for new actual response
- Derived gap/progress/schedule recalculation references original events

### Completion
- The correction is accepted with correct lineage or visibly pending/conflicted; original evidence survives.

### Responsive / accessibility details
- Comparison is readable on mobile as Before/Proposed views with clear context.
- Destructive-looking actions explain history preservation rather than offering Delete failed attempt.

**Related existing planned cases:** AC22, AC29, AC30, AC52, AC54, AC69. These remain NOT_RUN and are not replaced by the new UI cases.

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

## UI19 — Explore a typed concept tree

**Feature:** `progress` · **Stories:** US037, US038 · **Status:** specified, not implemented

**Workflows:** WF03, WF10 · **Memory:** M01, M04, M05, M07, M08, M10 · **Screens:** SC10, SC04, SC06, SC09

**Trigger:** Select a concept chip or open Concepts from progress.

### Preconditions
- The view is generated from existing catalog IDs and reviewed relationship semantics.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open the concept/skill detail | Display its actual type, source support and relationship labels. |
| 2 | Expand a branch | Show bounded related entities; repeated appearances refer to one ID and cyclic associations are handled safely. |
| 3 | Inspect associated evidence | Separate related questions from actual assessed performances and note source/assessment freshness. |
| 4 | Choose a source, question or optional prerequisite check | Navigate with explicit context; no automatic competence transfer. |
| 5 | Return to the slide | Restore the prior study view. |

### Alternatives and failure paths
- An unmapped node is System mapping incomplete, not User does not know this.
- Question containment is not relabeled as concept hierarchy.
- Cross-course equivalent/related relationships require their current reviewed meaning and never create new attempts.

### Read dependencies
- Typed catalogs, existing question relationships, reviewed shared mappings and effective evidence

### Writes and owner
- UI expansion/context state; no new canonical concept or assessment from navigation

### Completion
- Structure is navigable without changing or overstating the underlying relationship/learning evidence.

### Responsive / accessibility details
- Provide an accessible list/tree detail alternative to a canvas diagram.
- Arrow keys act on focused tree, not global slide navigation; large graphs use bounded expansion.

**Related existing planned cases:** AC15, AC16, AC53, AC59, AC60, AC65. These remain NOT_RUN and are not replaced by the new UI cases.

## UI20 — Review learning gaps and choose study priorities

**Feature:** `progress` · **Stories:** US039, US040 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF10 · **Memory:** M03, M04, M07, M08, M09, M10 · **Screens:** SC09, SC10, SC11

**Trigger:** Open Progress or a slide evidence summary.

### Preconditions
- Data freshness and evidence scope are shown; source preparation and learning are distinct.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Progress | See observed skills, unassessed areas, assistance and freshness rather than an unexplained mastery percent. |
| 2 | Select a gap | Inspect supporting and contradicting actual attempts, criteria and uncertain cause. |
| 3 | Filter by skill action, course or reference conditions | Avoid mixing hinted recall with independent application. |
| 4 | Inspect importance | Show assessment relevance, foundational role and personal priority separately with supporting reasons. |
| 5 | Choose Practice, Defer or a study priority | Save the deliberate preference through its owner; no obligation/grade/calendar change occurs. |

### Alternatives and failure paths
- Zero records means Not assessed.
- A stale view retains a warning and original evidence access; it does not present obsolete weakness as current fact.
- A due review or passage of time does not prove forgetting or an exam probability.

### Read dependencies
- Effective assessments, canonical study choices and declared source relevance

### Writes and owner
- Derived gap/progress display; explicit study choice only via current catalog owner

### Completion
- Learner can inspect the evidence behind a priority and choose a next action without false measurements.

### Responsive / accessibility details
- Status uses text and symbols as well as color; chart/table alternatives.
- No shame/streak penalty language; compare like conditions explicitly.

**Related existing planned cases:** AC31, AC40, AC54, AC70, AC72. These remain NOT_RUN and are not replaced by the new UI cases.

## UI21 — Inspect conversation and attempt history

**Feature:** `progress` · **Stories:** US041, US042 · **Status:** specified, not implemented

**Workflows:** WF09, WF10 · **Memory:** M01, M05, M06, M07, M08, M09, M12, M15 · **Screens:** SC11, SC09, SC04

**Trigger:** Open a prior session, feedback evidence link or historical attempt.

### Preconditions
- Legacy excerpt-only records and complete prospective capture are clearly distinguished.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open History | Filter sessions/attempts by course, source, skill and actual available time. |
| 2 | Choose a turn or attempt | See exact available question/response, tutor reply, conditions and separate save states. |
| 3 | Inspect revisions | Show original and effective assessments with reasons, without counting regrades as new answers. |
| 4 | Open the source reference | Resolve the historical version or report unavailable bytes explicitly. |
| 5 | Continue the conversation or Try again | Create a new current turn with declared old/current source context, never edit the historical response. |

### Alternatives and failure paths
- Missing older full text is labeled Excerpt only; no reconstructed conversation is presented as original.
- Provider retry responses are grouped under the same submitted turn with obsolete/alternate status.
- A correction with unknown response time does not acquire a fabricated occurrence timestamp.

### Read dependencies
- Immutable turns/messages, attempt/revision chain, source versions and receipts

### Writes and owner
- Read view/resume state; new request only on explicit continuation

### Completion
- The learner can trace current judgments to actual original evidence and see provenance limitations.

### Responsive / accessibility details
- Use readable chronological/thread views, explicit time zones and expandable technical details.
- Do not rely on an infinite canvas or hover-only history controls.

**Related existing planned cases:** AC29, AC49, AC50, AC62, AC73. These remain NOT_RUN and are not replaced by the new UI cases.

## UI22 — Create or select meaningful review items

**Feature:** `review` · **Stories:** US043, US044 · **Status:** specified, not implemented

**Workflows:** WF03, WF07, WF10 · **Memory:** M01, M03, M04, M05, M11 · **Screens:** SC07, SC06, SC04

**Trigger:** Choose Save for later/Create review item or open relevant existing questions.

### Preconditions
- Questions and scheduling state have separate ownership; generation alone is not review selection.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open related/saved questions | Prefer existing instructor/user/catalog questions before generating alternatives. |
| 2 | Choose an existing item, Create my own question, or Request suggestions | For an authored item, enter the prompt, givens/figures and intended skill with an explicit learner-authored origin; for suggestions, show sources and bound generation. Reuse a matching question/family rather than creating a duplicate. |
| 3 | Preview or supply answer guidance/rubric under permitted disclosure | Edit wording or reject unsuitable items; distinguish learner-authored or tutor-authored guidance from instructor keys. A saved draft without a supported rubric is not ready for AI grading. |
| 4 | Choose Save only or Add to review | A deliberate selection creates scheduling state only when the approved scheduler is active. |
| 5 | Return to lecture | No automatic stack of unsolicited cards blocks the study flow. |

### Alternatives and failure paths
- Repeated numeric variation may reuse a family; new reasoning requires appropriate version/owner review.
- Missing original figure prevents a complete valid question; do not silently discard it.
- If scheduler is not configured, Save for later remains available and no due date is invented.

### Read dependencies
- Current question/family/source identities, selection preferences and allowed generation policy

### Writes and owner
- Owned question/family revisions when required; operational saved/selected-item records
- No performance attempt or calendar event

### Completion
- A chosen, source-linked item has a version and explicit saved/scheduled status.

### Responsive / accessibility details
- Question previews are accessible and do not require animated card flips.
- Batch selection is bounded and reversible without altering original instructor material.

**Related existing planned cases:** AC26, AC28, AC68. These remain NOT_RUN and are not replaced by the new UI cases.

## UI23 — Edit, suspend or retire a review item

**Feature:** `review` · **Stories:** US045, US046 · **Status:** specified, not implemented

**Workflows:** WF07, WF08, WF09, WF10 · **Memory:** M05, M07, M11 · **Screens:** SC07, SC06, SC14

**Trigger:** Use the item menu in saved questions/review.

### Preconditions
- Original instructor material and prior attempts must remain intact.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open an item menu | Offer Edit my item, Suspend, Resume, Remove from review and source/history details as permitted. |
| 2 | Edit a learner/AI-authored item | Explain that substantive changes create a new version; original-source questions are not overwritten. |
| 3 | Confirm suspension/removal | Change review selection only and show that historical responses remain. |
| 4 | Resolve apparent duplicates | Keep canonical IDs and reference the preferred item; do not automatically merge different skills or histories. |
| 5 | Inspect schedule after a version change | Recompute according to declared policy or await review, without inventing a new review event. |

### Alternatives and failure paths
- Concurrent edits compare bases before publishing.
- A source-backed prompt needs owner review rather than a private silent replacement masquerading as the original.
- Undo selection changes restores the selection intent; it does not delete executed review history.

### Read dependencies
- Question/version, selection and review event history, edit ownership

### Writes and owner
- Question revision through owner; operational selection/suspension event; derived schedule

### Completion
- Current review behavior changes deliberately while historical evidence stays attributable.

### Responsive / accessibility details
- Confirm destructive selection actions with clear scope; offer non-drag menu actions.
- Do not label Remove from review as Delete all evidence.

**Related existing planned cases:** AC26, AC29, AC67, AC68. These remain NOT_RUN and are not replaced by the new UI cases.

## UI24 — Run a review session and handle mistakes

**Feature:** `review` · **Stories:** US047, US048 · **Status:** specified, not implemented

**Workflows:** WF05, WF06, WF08, WF10 · **Memory:** M03, M05, M06, M07, M08, M11, M12 · **Screens:** SC07, SC08, SC06, SC11

**Trigger:** Choose Start review for selected/due items.

### Preconditions
- Actual selected items, rating policy and source-disclosure rules are available.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose course or review scope and a suggested session size | Queue presents selected items and lets the learner stop freely. |
| 2 | Attempt the first item before reveal where appropriate | Capture the actual answer and known help conditions. |
| 3 | Request a hint, reveal or submit | Feedback and scheduling distinguish performed response, skipped item and uncertain grading. |
| 4 | After a mistake choose Diagnose, Show source or Continue | A short detour remains optional; no endless automatic prerequisite drill. |
| 5 | Finish or stop early | One review event per actual review; future due state follows the declared supported rating, and pending grades stay explicit. |

### Alternatives and failure paths
- Uncertain assessment is not automatically a failing scheduler rating.
- A recalled definition and a long application task need a supported rating/selection policy; no claim of identical calibrated scheduling.
- Duplicate event delivery changes the schedule once; self-ratings are labeled separately from independently observed criteria.

### Read dependencies
- Selected items, due computation/policy, actual prompt and relevant assistance boundaries

### Writes and owner
- Actual response via WF05; immutable review event referencing its attempt or supported explicit self-rating
- Derived due state, no Calendar mutation

### Completion
- Actual performed reviews and assistance are recorded once; uncertainty/skip do not masquerade as failure.

### Responsive / accessibility details
- Show answer uses an explicit accessible control, not a hover/reveal trap.
- No forced timer or streak punishment; pause preserves the current item and draft.

**Related existing planned cases:** AC24, AC27, AC28, AC40, AC67, AC68. These remain NOT_RUN and are not replaced by the new UI cases.

## UI25 — Inspect, cancel and recover a request

**Feature:** `agent-dispatch` · **Stories:** US049, US050 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M03, M06, M07, M12, M14 · **Screens:** SC12, SC04, SC14

**Trigger:** Open Activity, a submission status chip or a pending-result notification.

### Preconditions
- Request, turn, native run, write receipt and view state are separately identifiable.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open request detail | See source/course, actual destination and input/transport/execution/save phases. |
| 2 | Navigate elsewhere while it runs | Pending result stays in Activity; completion does not steal the current lecture. |
| 3 | Choose Cancel | Show Cancellation requested until terminal state is verified; preserve captured learner input. |
| 4 | If interrupted, choose Check status | Reconcile existing native/writer receipts before offering a safe retry. |
| 5 | Retry or choose another explicitly approved route | Preserve the same logical learner response and new dispatch identity; obsolete results cannot overwrite the accepted generation. |

### Alternatives and failure paths
- An unknown possible completion is not automatically retried.
- A late response after cancellation is retained as late/obsolete, not displayed as the current result or auto-published.
- No real learner attempt is erased by cancelling model generation; deleting data is a different scoped operation.

### Read dependencies
- Committed request/input, native state and writer/view receipts

### Writes and owner
- Cancellation/reconciliation/dispatch-attempt records through supervisor
- No forged approval or new learner attempt from retries

### Completion
- Each job has an honest status and permitted next action; terminal publication uses current identity/generation.

### Responsive / accessibility details
- Status text and expandable details instead of fake percent-complete animation.
- Important approval/cancel actions retain focus and clear consequence copy.

**Related existing planned cases:** AC01, AC02, AC03, AC05, AC07, AC08, AC32, AC41, AC42, AC44, AC45, AC48, AC62. These remain NOT_RUN and are not replaced by the new UI cases.

## UI26 — Resume across devices and resolve competing drafts

**Feature:** `workspace-access` · **Stories:** US051, US052 · **Status:** specified, not implemented

**Workflows:** WF00, WF10, WF11 · **Memory:** M01, M06, M12, M14 · **Screens:** SC02, SC04, SC14, SC11

**Trigger:** Open another device, return after interruption or receive a conflicting checkpoint.

### Preconditions
- Only verified synchronized state can be offered as current cross-device memory.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open Continue | Display the available checkpoint, source revision, device and received time. |
| 2 | Choose the checkpoint | Restore slide, panel, draft references and paused playback. |
| 3 | Receive a competing unsynced draft/checkpoint | Show both origins; compare, keep one or retain both as separate drafts. |
| 4 | Choose how to continue | Use lineage/source identity rather than device clock alone; do not merge submitted response snapshots. |
| 5 | Submit the chosen draft | Commit a clear new or existing request identity under normal deduplication. |

### Alternatives and failure paths
- Unrelated timestamp skew cannot decide authoritative evidence.
- Historical source remap requires explicit verified identity; current page ordinal alone is insufficient.
- A draft is not safe on another device until its received state is verified.

### Read dependencies
- Per-device checkpoints, draft lineage, submitted input and source revision

### Writes and owner
- Operational resume/decision records; immutable committed responses unchanged

### Completion
- The learner can resume or resolve conflict without silent loss, overwrite or duplicate performance.

### Responsive / accessibility details
- No auto-audio when restoring; mobile overlays preserve visible resume state.
- Compare long drafts accessibly and provide export before explicit discard.

**Related existing planned cases:** AC03, AC33, AC62. These remain NOT_RUN and are not replaced by the new UI cases.

## UI27 — Continue during network, quota or native failures

**Feature:** `agent-dispatch` · **Stories:** US053, US054 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M01, M06, M12, M14, M15 · **Screens:** SC04, SC12, SC13

**Trigger:** Connectivity, storage, authentication, quota or native execution becomes unavailable.

### Preconditions
- Always-on PC is a normal availability assumption, not a no-failure guarantee.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Inspect the connection banner | Identify device/Drive/Brain/native/writer issue without exposing credentials. |
| 2 | Continue permitted cached browsing or drafting | Mark cache age and actual draft durability; unavailable files do not pretend to be offline-ready. |
| 3 | Submit while delivery is unavailable | Offer an explicitly retained outbox item only when persistence succeeds; otherwise offer export/copy and a clear warning. |
| 4 | Reconnect or reauthenticate through the supported flow | Reconcile committed bundles and prior effects before dispatching. |
| 5 | Resume an eligible task | Apply limits and permissions; no silent provider, model-API or account substitution. |

### Alternatives and failure paths
- Browser storage full/private-mode limits mean Local save failed, not Saved offline.
- The app never claims universal offline playback or worker availability on a sleeping/logged-out PC.
- Repeated failures isolate that request; they do not create an infinite reasoning loop.

### Read dependencies
- Connection/capability status, cache manifest, local draft and pending request state

### Writes and owner
- Local/transport outbox when supported, health/reconciliation receipts
- No unapproved spending, service restart or provider reconfiguration

### Completion
- The learner knows what is retained and what is blocked; recovery neither loses input nor duplicates committed effects.

### Responsive / accessibility details
- Persistent relevant errors have readable recovery actions; do not spam repeated toasts.
- Offline banner is textually distinct from an empty course or no learning evidence.

**Related existing planned cases:** AC07, AC34, AC35, AC36, AC38, AC45, AC48. These remain NOT_RUN and are not replaced by the new UI cases.

## UI28 — Choose light, dark or system appearance

**Feature:** `workspace-access` · **Stories:** US055, US056 · **Status:** specified, not implemented

**Workflows:** WF10 · **Memory:** M03, M12 · **Screens:** SC13, SC04, SC07, SC09

**Trigger:** Use the theme control or Appearance settings.

### Preconditions
- Both themes share one component/state system; original source images and scientific colors remain original.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Light, Dark or System | All app-owned panels, controls, charts, dialogs and status variants use consistent semantic tokens. |
| 2 | Return to the lecture | Original slides/images retain their colors and white/colored backgrounds; surrounding dark UI does not invert the source. |
| 3 | Choose text scale and motion preference | Reflow controls and remove nonessential movement; preserve necessary information. |
| 4 | Reload or change the OS theme in System mode | Apply the correct theme before first visible rendering and honor the explicit local override. |
| 5 | Switch devices | System follows that device; one explicit change does not force an unwanted theme onto another active device. |

### Alternatives and failure paths
- Theme changes must not reload media, submit forms, cancel a request, erase draft input or alter learning records.
- Theme storage unavailable still allows the current session preference; durability limits are stated where necessary.
- Future document recoloring is not part of this baseline; readable text rendition is separate and labeled.

### Read dependencies
- Per-device theme/motion/text-size preference and OS setting

### Writes and owner
- Operational appearance preference only; zero model calls or learner judgments

### Completion
- All UI states work in both modes with source fidelity, stable work/media, and accessible controls.

### Responsive / accessibility details
- Keyboard focus, errors and disabled states must be tested in both modes.
- Honor reduced motion; card-flip/slide transitions never carry unique information.

**Related existing planned cases:** AC33. These remain NOT_RUN and are not replaced by the new UI cases.

## UI29 — Configure provider, assistance and operating limits

**Feature:** `agent-dispatch` · **Stories:** US057, US058 · **Status:** specified, not implemented

**Workflows:** WF00, WF11 · **Memory:** M03, M12, M13, M14 · **Screens:** SC13, SC12, SC01

**Trigger:** Open Settings → AI and Brain, or a missing-capability action.

### Preconditions
- Actual product/surface is displayed independently of sign-in category; no user task can set permissions.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open AI and Brain | Show installed, configured, verified and unavailable capabilities separately with last proof/version scope. |
| 2 | Inspect data/context settings | Select permitted content categories and default help preferences without treating them as live actor grants. |
| 3 | Choose a supported provider route | Preview actual product/thread/mode and separate activation/permission needs. |
| 4 | Set approved operating limits | Specify no additional inference spend by default, background priorities and explicit pause behavior. |
| 5 | Apply allowed preferences | Changes affect future requests; current request identity, question and assessment conditions remain unchanged. |

### Alternatives and failure paths
- An experimental candidate remains labeled and unverified until its real acceptance passes.
- Changing provider after submission creates a new explicit dispatch under the same learner input, not a new attempt.
- No token/cookie copy, global permissive sandbox inheritance, automatic install or silent capability substitution.

### Read dependencies
- Verified bindings/configuration, trusted course policy, allowed budgets and consent policy

### Writes and owner
- Owned configuration/preferences and approval-required change proposal, not arbitrary canonical writes

### Completion
- The user can distinguish configured intent from tested capability and control future behavior safely.

### Responsive / accessibility details
- Advanced details stay collapsible; core status is understandable without reading tool logs.
- No unsafe one-click Disable safeguards button.

**Related existing planned cases:** AC05, AC06, AC39, AC41, AC42, AC43, AC44, AC47. These remain NOT_RUN and are not replaced by the new UI cases.

## UI30 — Export data and manage retention deliberately

**Feature:** `workspace-access` · **Stories:** US059, US060 · **Status:** specified, not implemented

**Workflows:** WF10, WF11 · **Memory:** M01, M03, M06, M07, M11, M12, M15 · **Screens:** SC13, SC11, SC12

**Trigger:** Choose Data and privacy → Export, Retention or Remove local data.

### Preconditions
- Provider history, course originals, full captured evidence and cache are different scopes.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Select export scope | Preview course/session/items, originals inclusion rights, and whether credential/private runtime fields are excluded. |
| 2 | Confirm a private export | Build a versioned bundle with relevant records, references and available attachment integrity. |
| 3 | Inspect retention settings | Distinguish raw teach-back audio, text evidence, operational logs, reproducible cache and referenced sidecars. |
| 4 | Request deletion or local cleanup | Show dependencies, what can actually be removed and what requires an owning-writer/user decision. |
| 5 | Review the receipt | State removed, retained, blocked and out-of-scope copies; never claim global provider erasure. |

### Alternatives and failure paths
- A full response referenced by an attempt is not disposable run scratch.
- Deletion of canonical evidence requires an explicitly approved referential deletion policy; until implemented, provide an honest scoped request/blocked status, not a fake Delete all button.
- Public sharing is not the default export; original copyrighted/private course material is not bundled without permission.

### Read dependencies
- Reference graph, retention preferences, evidence and authorized export scope

### Writes and owner
- Explicit export bundle and scoped retention/cleanup receipts
- Canonical records only through separately approved owner workflow

### Completion
- The export/removal outcome has verifiable scope, preserving or explicitly resolving references rather than silently orphaning evidence.

### Responsive / accessibility details
- Destructive actions require a readable scope confirmation and cancellation path.
- Export can be retried without recreating attempts; local download success is distinct from deletion.

**Related existing planned cases:** AC38, AC49, AC64, AC73. These remain NOT_RUN and are not replaced by the new UI cases.

## UI31 — Finish or pause a study session

**Feature:** `progress` · **Stories:** US061, US062 · **Status:** specified, not implemented

**Workflows:** WF10 · **Memory:** M03, M06, M07, M09, M11, M12, M14 · **Screens:** SC16, SC04, SC07, SC12

**Trigger:** Choose Finish session, pause, or return after an interrupted departure.

### Preconditions
- Only actual events can appear as learned/performed; obligations remain separately owned.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Choose Finish session | Show last position, questions asked, actual assessed attempts and explicit pending work. |
| 2 | Review unresolved points | Offer selected next steps without claiming every viewed slide was mastered. |
| 3 | Choose Save items for later, Review now or Done | Record only deliberate review choices; no auto calendar or deadline edits. |
| 4 | Check pending save/transport state | Explain what is retained and what remains pending before closing. |
| 5 | Return later | Continue from verified resume state; leaving does not automatically cancel accepted background work. |

### Alternatives and failure paths
- A quick-answer-only session reports no assessed performance without calling the session a failure.
- Closing the browser may be interrupted; durability claims come from prior receipts, not guaranteed unload events.
- Study-time indicators are observational and do not establish knowledge.

### Read dependencies
- Actual session events, effective learning evidence, selected review and checkpoint

### Writes and owner
- Operational session summary/resume and deliberate selection only

### Completion
- Learner knows where to resume, what was actually done, and whether any publication remains pending.

### Responsive / accessibility details
- No forced recap quiz, streak punishment or modal on every navigation.
- Pending work has a direct Activity link; session summary can be revisited.

**Related existing planned cases:** AC24, AC31, AC32, AC40, AC72. These remain NOT_RUN and are not replaced by the new UI cases.

## UI32 — Inspect and authorize a bounded repair

**Feature:** `agent-dispatch` · **Stories:** US063, US064 · **Status:** specified, not implemented

**Workflows:** WF01, WF09, WF10, WF11 · **Memory:** M01, M02, M07, M09, M14, M15 · **Screens:** SC13, SC15, SC12

**Trigger:** A stale view, source inconsistency or interrupted publication requires operator attention.

### Preconditions
- Same person acting as operator; actual owner/permissions and safe runtime constraints still apply.

### User actions and visible responses
| Step | User action | Visible response |
|---|---|---|
| 1 | Open maintenance detail | Explain whether the problem is source availability, invalid record, stale view or uncertain publication. |
| 2 | Choose an offered safe repair preview | Show exact inputs, target owner, expected writes, dependency effects and what will remain unchanged. |
| 3 | Approve the specific allowed operation | Run under the correct verified writer identity; no restart/install/permission expansion is hidden. |
| 4 | Inspect receipt and readback | Distinguish repaired projection, original evidence already saved, blocked dependency and unresolved native outcome. |
| 5 | Return to studying | Only affected views change; prior history and unrelated jobs remain intact. |

### Alternatives and failure paths
- No live call to a global-root writer is made under the fiction that --root safely redirects it.
- A stale summary can be rebuilt; missing original content cannot be invented from that summary.
- Unknown native completion is reconciled, not reset by deleting locks or creating a new attempt.

### Read dependencies
- Existing owner validators, current-state/source hashes, repair/recovery contract

### Writes and owner
- Authorized owner repair, readback and recovery receipts; no new learner performance

### Completion
- A bounded repair has verified effects or a specific blocked outcome without collateral changes.

### Responsive / accessibility details
- Plain explanation first with technical evidence expandable.
- Approval screens identify changes clearly and never equate a task-file flag with human approval.

**Related existing planned cases:** AC31, AC34, AC37, AC38, AC45, AC51, AC55, AC56, AC73, AC74. These remain NOT_RUN and are not replaced by the new UI cases.

