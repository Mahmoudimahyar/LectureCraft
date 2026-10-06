# workspace-access — UI flows, 0.8.0

Generated subset of [experience-spec](../../project/experience-spec.json); do not edit the behavior
independently of the canonical record. These flows replace older feature UI prose. Read the
[shared rules](../../project/ui-state-and-interaction-contract.md) and
[user stories](../../project/user-stories.md). Application/native/writer/browser verification is NOT_RUN.

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


## Remediation amendment R2 (2026-10-05)

Second bounded change against baseline 0.9.0, recorded after the learner tested the build of amendment R1 and rejected it (owner instruction of 2026-10-05, kept as `PROMPTS/EXPERIENCE_REPAIR_V2.md`). Flow, story, workflow and screen ids and the step tables above are unchanged; where these notes and older text differ, these notes govern the listed behaviour only. Checks are defined in the [requirements](requirements.md); the direction in the [design system](../../project/design-system.md).

**UI03 — Choose a course, lecture or resume point (R2-V5, R2-V6, R2-C1, R2-B3).**
- Step 1: Study leads with Resume — the real course, lecture and page last opened, with one primary action — and then lists the configured courses for browsing. When nothing was opened yet it says so and browsing leads. No invented progress, dates or charts; every number is a real total.
- Step 2: a course header carries **Concept map** beside its lecture list and question bank entry. Lectures are browsed with their real titles and, where a deck exists, a thumbnail of its real first page.
- Step 4: Continue opens the page that was last open, identified by its physical page of its source version.
- Added alternative: a profile that is not the learner's real courses says once that it shows synthetic sample data; an unknown course or lecture shows an explained state with a way back.

**UI05 — Add materials and inspect preparation coverage (R2-T1, R2-T2, R2-T9, R2-T12, R2-S7, R2-S10, R2-B1).**
- Step 3: preparation details show, per course, every admitted recording and deck with its stage — inventoried, transcribed (with the covered window), text-aligned, slide-linked, reviewed — its counts and the cause of anything unresolved. Decks show raw and instructional page denominators as two labelled figures, always together, with the counts of excluded and uncertain roles and how those roles were established; the counts add up to the page count, and nothing is called complete on the instructional figure alone.
- Step 3, continued: local transcription shows processing time used and remaining under the persisted allowance, what is queued and why a run paused. Each generated transcription names the runner that produced it (tool, model, settings identity); the prepared downstream binding, once it exists, is listed as prepared, not active, with the same identity. Generated, agent-reviewed and human-confirmed are three different labels.
- Step 5: the work is continued by one resumable command; the app creates no schedule, and the page never implies that a paused queue is finished.

**UI28 — Choose light, dark or system appearance (R2-V7 – R2-V10, R2-B2).**
- Step 2 and after: switching theme keeps the draft, the playback position, the selected range, slide and tab and the panel width; the slide's own colours are identical in both themes.
- Both themes follow the approved references: light neutral surfaces, dark graphite surfaces, one restrained accent, reading text of 16–18 px.
- Settings also shows the build and data identity as text; when the open page is older than the build being served, one line says so and offers Reload.

