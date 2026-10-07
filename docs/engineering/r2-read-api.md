# R2 read API — implementation shapes

Status: implementation contract for amendment R2 (2026-10-05). `interface-contracts.md` (section "Remediation amendment R2")
governs the **meaning**; this file governs the **spelling** the Brain returns and the web app reads. Everything here is
read-side and app-private. Nothing is a wire contract of `contracts/v1`. All examples are synthetic.

Conventions: pages are 1-based physical PDF pages; media times are integer milliseconds from the original source start,
`[start_ms, end_ms)`; a field that does not apply is `null`, never a guessed value; every list is in a stable order.

## 1. Lecture view — `GET /api/courses/{course_id}/lectures/{lecture_id}[?deck=]`

Every field returned before R2 stays. R2 adds the fields below.

### 1.1 `source_map`

```jsonc
"source_map": {
  "state": "ready",                       // "ready" | "unavailable"
  "reason": null,                         // when unavailable: "no_deck" | "not_a_pdf" | "unreadable" | "not_built"
  "contract": "source-map/1",
  "map_revision": "a1b2c3d4e5f60718",
  "source": {"source_id": "src-deck-03", "version_id": "v1-…", "sha256": "…"},
  "page_index_base": 1, "page_count": 91, "page_layout": "slides",   // "slides" | "document" | "mixed"
  "printed_numbers_established": false,
  "pptx": null,                           // or {"source_id": "…", "state": "supported", "matched_pages": 40}
  "logical_slides": [
    {"id": "ls-0a1b2c3d4e-p22-24", "kind": "build_group",   // "single" | "build_group" | "step_group" | "duplicate_group" | "manual_group"
     "pages": [22, 23, 24], "title": "Example mechanism, step by step", "role": "instructional",
     "grouping": {"basis": "inferred", "state": "generated", "confidence": "high", "signals": ["same_heading", "ordered_text_containment"]}}
  ],
  "denominators": {"raw": 91, "instructional": 80, "by_role": {"instructional": 74, "worked_example_or_question": 5, "mixed": 1,
                   "objectives_or_summary": 2, "unknown": 1, "structural_title_or_section": 5, "administrative": 2, "blank": 1},
                   "uncertain": 3, "excluded": 8},
  "limitations": ["Text extraction cannot tell covered text from visible text."],
  "override_revision": 0
}
```

`step_group` is a run of pages with equal text whose drawings differ or were not compared (worded "step k of n");
`duplicate_group` is byte-equal content or equal picture digests (worded "copy k of n").

### 1.2 Per slide (`slides[]`, one entry per physical page)

```jsonc
{
  "page": 23, "title": "…", "text": "…", "text_status": "extracted",           // unchanged
  "identity": {
    "page_index": 23, "page_count": 91, "page_label": null,
    "printed_slide_number": null,          // or {"value": 21, "basis": "printed_on_page"}
    "pptx": null,                          // or {"slide_id": 261, "ordinal": 19, "match_basis": "…", "match_state": "…"}
    "logical_slide_id": "ls-0a1b2c3d4e-p22-24",
    "position": {"ordinal": 2, "of": 3, "kind": "build"},   // null for a single page; kind "build" | "step" | "copy"
    "label": "PDF page 23 of 91 · build 2 of 3",
    "label_parts": ["PDF page 23 of 91", "build 2 of 3"]
  },
  "role": {"value": "instructional", "state": "generated", "uncertain": false, "forced_requirements": true, "basis": ["…"]},

  "question_ties": [                       // questions tied to this page's logical slide by an anchor
    {"question_id": "L03-Q04", "collection": "L03", "number": 4, "title": "…", "prompt": "…", "prompt_in_index": true,
     "tie": "stated",                      // "exact" | "stated" | "agent_inferred"   (never rewritten into one another)
     "granularity": "page",                // "page": the tie names these pages; "section": the course's study map places the
                                           //   question somewhere in a range of pages (coarse; listed apart from page ties)
     "from": "course_locator",             // "course_locator" | "course_study_map" | "inferred_anchor_file"
     "section": null,                      // section ties only: {"page_ranges": [[5, 20]], "label": "…", "row": 1, "scope": "all" | "part" | null}
     "where": "on_this_page",              // "on_this_page" | "elsewhere_in_sequence" | "group_level"
     "support_pages": [23],                // member pages of THIS logical slide that the tie names
     "other_pages": [31],                  // pages of the same deck in the same tie outside this logical slide
     "transcript_lines": [[120, 164]],     // from the course's own locator; [] when none
     "criteria_supported": 2, "criteria_total": 3,   // null/null for exact and stated ties (the course names a page, not criteria)
     "coverage": null,                     // agent_inferred only: "main" | "partial"
     "state": null,                        // agent_inferred only: "agent_inferred" | "agent_reviewed"
     "verdict": null,                      // agent_inferred only: "upheld" | "narrowed" | null
     "rationale": null,                    // agent_inferred only: the producer's words
     "suggestion_id": null,                // agent_inferred only: stable id of the item
     "learner_decision": null,             // "confirmed" | "rejected" | null  (a separate local annotation)
     "why": "The course record names this page.",
     "evidence": {"state": "assisted", "assistance": "solution_shown", "prior_exposure": "seen", "attempts": 1, "last_at": "2026-09-20T15:00:00Z"}}
  ],
  "related_questions": [                   // tie "concept_related": share a concept with this logical slide, not anchored here
    {"question_id": "PS02-Q01", "collection": "PS02", "number": 1, "title": "…", "prompt_in_index": false,
     "tie": "concept_related", "via_concepts": [{"concept_id": "c-rate-law", "label": "Rate law"}], "lecture_ids": [],
     "evidence": {"state": "unknown", "assistance": null, "prior_exposure": "unknown", "attempts": 0, "last_at": null}}
  ],

  "ranges": [                              // every range the player can seek to for this page, earliest first
    {"range_id": "tl-3f9a…-o1", "recording": {"source_id": "src-rec-03", "version_id": "v1-…", "sha256": "…"},
     "timebase": "original_source_start", "start_ms": 1072000, "end_ms": 1236000,
     "relation": "discussed_during",       // "displayed_during" only with inspected frame evidence
     "occurrence_index": 1, "occurrences_total": 2,
     "support": {"scope": "build_group", "pages": [22, 23, 24], "builds": null},   // scope "page" | "build_group" | "region" | "section"
     "method": {"name": "lexical-sequence", "version": "2"},
     "origin": "pipeline",                 // "pipeline" | "manual" | "reviewed_source_map"
     "review_state": "generated",          // "generated" | "agent_reviewed" | "human_confirmed"
     "quality": {"acoustic": {"state": "generated_unreviewed", "basis": "…"},
                 "association": {"state": "candidate", "basis": "…"},
                 "group_mapping": {"state": "generated", "basis": "…"}},
     "why": "Follows the wording of the slide",
     "evidence": {"transcript_lines": [[120, 164]], "terms": ["rate", "law"], "shape": "sustained_clear"},
     "annotation_id": null}                // set for manual / human-confirmed links (ll.annotation/1 records)
  ],
  "no_range": null                         // when ranges is empty: {"state": …, "text": "…", "detail": {…}}
}
```

`no_range.state` is exactly one of `recording_unavailable`, `no_range_expected`, `audio_unprocessed`,
`association_not_run`, `ambiguous`, `not_discussed` (definitions in `interface-contracts.md`). `detail` carries the
reason, the processed window or the candidates. The pre-R2 `occurrences` list (annotation records) stays for
compatibility; `ranges` is the list the UI plays from and already includes confirmed and manual annotations.

`evidence.state` is one of `unknown`, `not_applicable`, `not_separately_observed`, `assisted`, `independent`.
`prior_exposure` (`unseen`, `seen`, `unknown`) is reported beside it and is never assistance by itself.

### 1.3 Lecture-level additions

```jsonc
"questions": {                             // existing object; each row of "all" gains "ties", "no_link", "evidence"
  "all": [{"question_id": "L01-Q03", "…": "…",
           "ties": [{"tie": "agent_inferred", "lecture_id": "lecture-01", "source_id": "src-deck-01", "pages": [12, 13],
                     "logical_slide_ids": ["ls-…-p12-13"], "criteria_supported": 2, "criteria_total": 2, "coverage": "main",
                     "state": "agent_reviewed", "verdict": "upheld", "rationale": "…", "suggestion_id": "ia-…", "learner_decision": null,
                     "on_displayed_deck": true}],
           "no_link": null,                // or {"state": "inspected_no_support" | "no_suggestion", "reason": "…"}
           "evidence": {"state": "unknown", "assistance": null, "prior_exposure": "unknown", "attempts": 0, "last_at": null}}],
  "counts": {"all": 20, "course_anchor": 12, "agent_inferred": 6, "without_link": 2, "course_section": 20, "course_anchor_with_suggestion": 1}
},
"timing": {
  "stage": "associated",                   // "no_recording" | "audio_unprocessed" | "partly_processed" | "processed" | "associated"
  "recordings": [
    {"source_id": "src-rec-03", "filename": "…", "duration_ms": 5818965,
     "generated": {"generation": "sp-…", "text_origin": "generated_speech_text", "review_state": "generated_unreviewed",
                   "covered_intervals": [[0, 5818965]], "unresolved_intervals": [], "unresolved_ms": 0,
                   "coverage_fraction": 1.0, "covers_whole_recording": true},          // null when nothing was generated
     "text_alignment": {"state": "accepted", "reason": null, "lines_aligned": 310, "lines_total": 420,
                        "method": {"name": "anchored-token-alignment", "version": "2"}}, // state "accepted" | "refused" | "no_transcript" | "not_run"
     "association": {"state": "current", "cause": null, "method": {"name": "lexical-sequence", "version": "2"},
                     "built_at": "2026-10-06T03:00:00Z", "ranges": 61, "unassigned_ms": 912000,
                     "inputs": {"recording_sha256": "…", "generation": "sp-…", "map_revision": "…", "method_version": "2"}}}  // state "current" | "stale" | "not_run"
  ],
  "summary": {"pages": 91, "pages_with_range": 58, "pages_no_range_expected": 8, "pages_without_range": 25,
              "ranges": 61, "human_confirmed": 0, "agent_reviewed": 0, "generated": 61}
},
"revisions": {"deck_sha256": "…", "map_revision": "…", "question_index_sha256": "…", "inferred_anchors_sha256": null,
              "timing_links": [{"recording_source_id": "src-rec-03", "links_revision": "…"}], "evidence_revision": "…"}
```

`course_anchor + agent_inferred + without_link = all`: each question is counted once, by the strongest link it carries.
`course_anchor_with_suggestion` is a part of `course_anchor`, not a fourth kind: the questions the course anchors (to
whatever file, a question sheet included) that ALSO carry a current suggested link to pages. A list is never worded
"0 with a suggested link" while such questions are in it.

`no_link.state` is `inspected_no_support` when every item for the question version was rejected by the verifying pass,
or when the file's optional top-level list `no_candidate` holds a record for that question version (`{question_id,
question_version, why, verifier: {confirmed, note}}` — a question that was examined and for which no page of the unit's
deck was found; decision D77 adds this optional list to `ll.inferred-anchors/1`). Otherwise it is `no_suggestion` with the
recorded reason (`no_file`, `no_item`, `stale`).

### 1.4 Additions fixed while building (2026-10-06)

- **Section ties.** `slides[].section_ties` lists ties of `granularity: "section"` (the course's own study map, D78) apart from
  `question_ties`; they are counted in `questions.counts.course_section` and never in `course_anchor`. A range whose
  `support.scope` is `"section"` is a course-stated pairing of pages with transcript lines (`origin: "reviewed_source_map"`); it
  appears on every page it names and carries no per-page time.
- **Per-page support.** An `agent_inferred` tie on a slide also carries `criteria_supported_here`: how many of the question's
  criteria THIS page (or the member pages of this logical slide) supports, from the item's optional `per_page` list. Tie rows carry
  `criteria`: `null` for course anchors, otherwise `[{criterion_id, number, label, concept_id, concept_label, skill_id, action_types}]`
  — identity only, never wording — and `regions`.
- **Lecture rows.** `questions.all[].ties[]` also carry `transcript_lines`; a question anchored only to transcript lines has one tie
  row with `pages: []`. `questions.all[].suggestion_history {stale, rejected_by_verifier, rejected_by_learner}` lets a rejection be
  taken back. `slides[].related_questions_total` reports the total when the list is capped at 30. `questions.ties_version`.
- **`no_link.reason`** may also be `rejected_by_learner` or `file_unreadable`.
- **Decision route.** Body `{decision, expected_revision?}`; answer `{course_id, suggestion_id, decision, revision, status:
  "recorded" | "unchanged", decided_at, question_id}`; 400 bad body, 404 unknown course or not a current link, 409 conflict.
- **Concept graph.** Top level adds `dropped` and `revisions.scope_revision`; `scope` adds `pages` and `note`; edges add `tie` and
  `support_pages` (source edges only; a source edge starts at `scope.logical_slide_id`, which is not a node — the page is drawn from
  `scope`); relations `slide_supports` and `slide_supports_by_assessment`; node `counts` entries are `null` where a count does not
  apply; errors are `{course_id, graph_version, error: {code: "unknown_scope" | "unknown_focus", detail}}` with 404, and 422 for a
  malformed request. Node detail adds `sources_total`, `questions_total`, `definition` (concept only), `basis` and `from` on source
  rows, `criterion_ids` on question rows, `skill_id` on observation rows.
- **Evidence.** `independent` needs both no assistance and no reference recorded as none; reference-only help is `assisted` with
  kind `reference_<value>`; an attempt with neither recorded is `unknown`. Aggregates state the latest attempt that separately
  observed the thing and carry their composition in `summary`.

- **Session link.** `session_link` on a lecture (course view rows and the lecture view) is `owner_related_sources` (the course index
  links the session), `none_recorded`, or `suggested_by_file_name` (D79): the one session the index links to no unit whose
  recording or transcript file name carries exactly this unit's lecture number, offered only when the private read
  configuration switches it on. `session_link_evidence` is then `{state: "suggested", rule, number, session_id, files, note}`, or
  `{state: "ambiguous", number, candidates, note}` when several sessions carry the number (nothing is offered). Every range of a
  lecture whose session link is suggested rests on that suggestion and the screen says so.

- **Suggestions and a changed catalog (D80).** Items and `no_candidate` records may carry `question_sha256`. `GET …/inferred-anchors`
  keeps `file.state: "made_for_earlier_catalog"` when the file names another question index and adds `checked_per_question`: the
  number of entries kept because their own question digest still matches. Stale reasons are `question_version_differs`,
  `question_changed`, `source_bytes_differ`, `source_unavailable`, `earlier_catalog` (no digest recorded) and `catalog_unavailable`.

## 2. Other routes

| Route | Returns |
|---|---|
| `GET /api/courses/{c}/timing[?queue=false]` | `{course_id, allowance: {ceiling_seconds, used_seconds, remaining_seconds} or null, resume_command, build_command, queue_included, lectures: [{lecture_id, title, stage, links: {state, differs, built_at}, summary: {pages, pages_with_range}, recordings: [the same objects as 1.3 plus queue {state, chunks_done, chunks_total, seconds_covered}]}], summary, note}`. A lecture's `summary` is read from its stored links alone: `pages` is the page count of the deck the links were built for (`null` when nothing was built), `pages_with_range` the pages a shown link names while the links are current (`null` when they are stale or missing); the learner's own links and rejections are applied in the lecture view only. `queue=false` leaves out the transcription queue, the allowance and the resume command (`queue` is `null` on every recording) and then reads no other course. |
| `GET /api/courses/{c}/questions/{q}` | The question view as before, plus the question's OWN links: `ties` (the objects of `questions.all[].ties`, section 1.2, with `on_displayed_deck: false` and empty `logical_slide_ids`: no deck is on screen; each tie also says `on_lecture_deck`, true when its pages are pages of the slides of its `lecture_id`, so the page opens them in the lecture), `no_link` and `suggestion_history`. They are stated whatever lecture the question's collection belongs to, or none: a problem-set question is in no lecture's list and shows its suggested slide pages here. All three are `null` when they cannot be read; the page then lists the catalog's `anchors`. |
| `POST /api/courses/{c}/lectures/{l}/timing/build` | Rebuilds the lecture's derived timing links from current inputs (app-private file only); returns the lecture's `timing` object |
| `GET /api/courses/{c}/lectures/{l}/source-map` | The full stored map of the displayed deck, with override history |
| `POST /api/courses/{c}/lectures/{l}/source-map/overrides` | Body `{op, pages, value?, reason}`; a learner correction as a new immutable revision; returns the new `source_map` block |
| `GET /api/courses/{c}/inferred-anchors` | Readback: `{file: {state, produced_at, sha256, question_index_matches}, accepted, refused: {reason: n}, stale, rejected_by_verifier, by_collection: [...]}` |
| `POST /api/courses/{c}/suggestions/{suggestion_id}/decision` | Body `{decision: "confirmed" \| "rejected" \| "cleared"}`; a versioned local annotation that outranks the file |
| `GET /api/courses/{c}/concept-graph?scope=&focus=&depth=&limit=` | Section 3 |
| `GET /api/courses/{c}/outline/node?id=` | Existing; R2 adds `sources`, `questions`, `evidence` (section 3) |
| `GET /api/health` | Existing; `build` object as implemented in `api.py` |

Every non-GET route above changes only app-private state and is pinned in `brain/tests/test_boundaries.py`.

## 3. Concept graph — `GET /api/courses/{c}/concept-graph`

`scope` is `course`, `lecture:<lecture_id>` or `slide:<lecture_id>:<page>`. `focus` (a node id) with `depth` 1–3 returns
the neighbourhood of one node; without `focus` the graph is the scope's topics, concepts and skills (questions and
criteria appear when a concept or skill is focused, so a course graph stays readable). `limit` caps nodes (default 150).

```jsonc
{"course_id": "…", "graph_version": "concept-graph/1",
 "scope": {"kind": "slide", "lecture_id": "lecture-03", "page": 23, "logical_slide_id": "ls-…", "label": "PDF page 23 of 91 · build 2 of 3"},
 "nodes": [{"id": "c-rate-law", "kind": "concept",          // "topic" | "concept" | "skill" | "question" | "criterion"
            "label": "Rate law", "counts": {"skills": 2, "questions": 5},
            "in_scope": true, "where": "on_this_page",      // slide scope only: on_this_page | elsewhere_in_sequence | group_level | null
            "support_pages": [23],
            "evidence": {"state": "not_separately_observed", "assistance": null, "prior_exposure": "unknown", "attempts": 0}}],
 "edges": [{"id": "e1", "from": "t-kinetics", "to": "c-rate-law", "family": "structure",   // "assessment" | "source" | "structure"
            "relation": "topic_includes_concept", "provenance": "question index", "automatic_credit": false}],
 "focus": null, "truncated": false, "totals": {"topic": 6, "concept": 40, "skill": 55, "question": 20, "criterion": 61},
 "revisions": {"question_index_sha256": "…", "map_revision": "…", "evidence_revision": "…"}}
```

Node detail (`outline/node`) adds:

```jsonc
"sources": [{"lecture_id": "lecture-03", "source_id": "…", "pages": [22, 23], "label": "PDF pages 22–23 of 91", "tie": "stated",
             "logical_slide_ids": ["ls-…"], "href": "/courses/<c>/lectures/lecture-03?page=22"}],
"questions": [{"question_id": "…", "title": "…", "collection": "…", "tie_to_node": "assessment", "evidence": {…}}],
"evidence": {"state": "assisted", "observations": [{"attempt_id": "…", "recorded_at": "…", "outcome": "…", "state": "assisted",
             "assistance": "solution_shown", "prior_exposure": "seen", "question_id": "…"}],
             "summary": {"independent": 0, "assisted": 1, "not_separately_observed": 0}}
```

## 4. Module seams in the Brain

The lecture view is assembled in `Projector.lecture_view` and then enriched, in this order, by pure functions that
mutate the view and read only what they are handed:

| Module | Function | Adds |
|---|---|---|
| `slide_identity.py` | `enrich(view, *, source_map, reason=None)` | `source_map`, `slides[].identity`, `slides[].role` |
| `question_ties.py` | `enrich(view, *, bank, index, source_map, inferred, decisions, evidence_of, concepts_of_page, section_ties)` | `slides[].question_ties`, `slides[].related_questions`, `questions.all[].ties/no_link/evidence`, `questions.counts` |
| `timing_links.py` | `enrich(view, *, source_map, links, generated)` | `slides[].ranges`, `slides[].no_range`, `timing` |

Each module registers its own routes through `register(app, runtime, locked)`, called from `create_app`.
