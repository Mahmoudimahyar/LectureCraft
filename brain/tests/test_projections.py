"""LL016 / LL030 (+ inventory/search views): projections add structure and context, never new facts."""
from __future__ import annotations

import json

import pytest

from lecture_brain import contracts as c
from lecture_brain.journal import Journal
from lecture_brain.preparation import Preparation
from lecture_brain.projections import Projector

NOW = "2026-10-04T12:00:00Z"


@pytest.fixture()
def projector(settings, clock):
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    for course in settings.courses:
        prep.prepare_course(course)
    yield Projector(settings, journal, preparation=prep, now=lambda: NOW)
    journal.close()


def _no_invented_measures(view) -> None:
    text = json.dumps(view).lower()
    for banned in ("mastery_percent", "mastery_probability", "forgetting_interval", "exam_probability", '"mastery":'):
        assert banned not in text


def test_workspace_lists_all_courses_and_calls_zero_attempts_not_assessed(projector):
    view = projector.workspace_view()
    courses = {c_["course_id"]: c_ for c_ in view["courses"]}
    assert sorted(courses) == ["be505", "be562", "be572", "cs542", "ds551"] and view["fixture_label"].startswith("FIXTURE PROFILE")
    assert courses["cs542"]["assessed_label"] == "Not assessed" and courses["be505"]["assessed_label"] == "4 recorded attempts"
    assert courses["be505"]["lecture_units"] == 4 and view["coverage_totals"]["lecture_units"] == 11
    _no_invented_measures(view)


def test_course_view_keeps_every_unit_and_separates_preparation_from_learning(projector):
    view = projector.course_view("be505")
    lectures = {l["lecture_id"]: l for l in view["lectures"]}
    assert sorted(lectures) == ["lecture-01", "lecture-02", "lecture-03", "lecture-04"]
    assert lectures["lecture-01"]["disposition"] == "links_reviewed" and lectures["lecture-03"]["session_link"] == "none_recorded"
    assert [s["state"] for s in view["unlinked_sessions"]] == ["empty_unrecorded"]
    assert any(s["state"] == "registered_unavailable" for s in view["other_sources"])
    assert "outcome" not in json.dumps(view["lectures"])  # no learning evidence mixed into preparation rows
    be572 = {l["lecture_id"]: l for l in projector.course_view("be572")["lectures"]}
    assert be572["lecture-01"]["displayable"] is False and be572["lecture-02"]["displayable"] is False and be572["lecture-00"]["displayable"] is True


def test_lecture_view_links_slides_to_bounded_intervals_lines_and_related_sources(projector):
    view = projector.lecture_view("be505", "lecture-01")
    assert view["display"]["kind"] == "original_pdf" and view["page_count"] == 4 and view["deck"]["version_id"].startswith("v1-")
    slide2 = view["slides"][1]
    assert [(o["start_ms"], o["end_ms"], o["review_state"]) for o in slide2["occurrences"]] == [(15000, 30000, "confirmed"), (55000, 60000, "confirmed")]  # two disjoint occurrences
    assert [(t["start"], t["end"]) for t in slide2["transcript_ranges"]] == [(7, 12), (23, 24)]
    # Concept chips come from the owner's question/skill source references ("slide 2", "slides 2-3"), nothing else.
    assert {x["concept_id"] for x in slide2["concepts"]} == {"be505.concept.origin-of-replication", "be505.concept.promoter", "be505.concept.replication-vs-transcription"}
    assert {x["concept_id"] for x in view["slides"][3]["concepts"]} == {"be505.concept.selectable-marker"} and view["slides"][0]["concepts"] == []
    assert {q["question_id"] for q in slide2["questions"]} == {"BE505-L01-Q01", "BE505-L01-Q03"}
    chapter = slide2["related"][0]
    assert chapter["precision"] == "broad_reference" and chapter["review_state"] == "suggested"  # never presented as an exact page
    textbook = view["slides"][2]["related"][0]
    assert textbook["precision"] == "exact_page" and textbook["to"]["locator"] == {"kind": "page", "page": 2, "printed_label": "34"}
    transcript = view["transcripts"][0]
    assert len(transcript["lines"]) == 24 and transcript["timing"] == "annotated" and transcript["line_times"][0]["start_ms"] == 0
    assert view["recordings"][0]["duration_ms"] == 60000 and view["recordings"][0]["content"].startswith("sources/be505/")
    assert "solution" not in json.dumps(view).lower()


def test_lecture_without_session_or_timing_is_explicit_not_fabricated(projector):
    l3 = projector.lecture_view("be505", "lecture-03")
    assert l3["recordings"] == [] and l3["transcripts"] == [] and all(s["occurrences"] == [] for s in l3["slides"])
    l2 = projector.lecture_view("be505", "lecture-02")
    assert all(o["review_state"] == "suggested" for s in l2["slides"] for o in s["occurrences"]) and l2["recordings"][0]["registration"] == "unregistered"
    blocked = projector.lecture_view("cs542", "lecture-01")
    assert blocked["display"]["kind"] == "unavailable" and "converter" in blocked["display"]["reason"] and blocked["slides"] == []
    assert projector.lecture_view("be505", "lecture-99") is None


def test_concept_projection_keeps_typed_ids_and_owner_relation_meanings(projector):
    view = projector.concepts_view("be505")
    nodes, edges = view["nodes"], view["edges"]
    assert nodes["be505.concept.promoter"]["type"] == "concept" and nodes["be505.skill.promoter.explain"]["type"] == "skill" and nodes["BE505-L01-Q03"]["type"] == "question"
    # The promoter concept sits under two topics but is one node (repeated identity, not a copy).
    promoter_parents = [e["from"] for e in edges if e["to"] == "be505.concept.promoter" and e["relation"] == "topic_includes_concept"]
    assert sorted(promoter_parents) == ["be505.topic.expression-control", "be505.topic.plasmids"] and list(nodes).count("be505.concept.promoter") == 1
    containment = next(e for e in edges if e["relation"] == "strict_containment")
    assert containment["scope"] == "question_to_question" and containment["automatic_credit"] is False
    assert not any(e["relation"] == "strict_containment" and nodes[e["from"]]["type"] != "question" for e in edges)  # never relabelled as concept hierarchy
    assert {e["relation"] for e in edges} >= {"diagnostic_prerequisite", "partial_overlap", "strict_containment"}
    assert nodes["be505.skill.inducible-control.explain"]["assessed"] is False and nodes["be505.skill.ori.explain"]["evidence_by_outcome"] == {"partial": 1, "demonstrated": 2}
    _no_invented_measures(view)
    shared = projector.concepts_view("cs542")
    link = next(e for e in shared["edges"] if e["relation"] == "shared_related")
    assert link["automatic_credit"] is False and link["other_courses"] == ["be562"]
    unmapped = shared["nodes"]["cs542.skill.mle-explain"]
    assert unmapped["mapping"] == "system_mapping_incomplete"  # a system coverage gap, not a statement about the learner


def test_neighbourhood_is_bounded_and_cycle_safe(projector):
    view = projector.concepts_view("be505")
    view["edges"].append({"from": "BE505-L02-Q01", "to": "BE505-L01-Q01", "relation": "partial_overlap", "provenance": "test cycle"})
    hood = Projector.neighborhood(view, "BE505-L01-Q03", depth=6, limit=8)
    assert hood["center"] == "BE505-L01-Q03" and len(hood["nodes"]) <= 8 and hood["truncated"] is True
    full = Projector.neighborhood(view, "BE505-L01-Q03", depth=10, limit=500)
    assert len(full["nodes"]) == len(set(full["nodes"])) and full["truncated"] is False
    assert Projector.neighborhood(view, "nope")["nodes"] == {}


def test_gap_view_uses_effective_corrections_and_keeps_counterevidence(projector):
    view = projector.gaps_view("be505")
    rows = {r["skill_id"]: r for r in view["skills"]}
    ori = rows["be505.skill.ori.explain"]
    # The latest demonstration was given after a hint, and the earlier one on a question already seen: neither is recorded
    # unaided performance (the earlier rule counted the second one because it looked only at assistance and reference).
    assert ori["status"] == "demonstrated_assisted" and ori["episodes"] == 3 and ori["unaided_demonstrated"] == 0
    assert [e["condition"] for e in ori["history"]] == ["unaided", "prior_exposure", "assisted"]
    assert {e["outcome"] for e in ori["counterevidence"]} == {"partial", "demonstrated"} - {ori["latest"]["outcome"]} | {"partial"}
    integrate = rows["be505.skill.ori-vs-promoter.integrate"]
    assert integrate["status"] == "current_gap" and integrate["latest"]["outcome"] == "partial" and integrate["latest"]["revised"] is True  # the regrade is effective
    assert integrate["latest"]["assessment_id"] == "be505-20260908-l01-q03-regrade-01" and integrate["latest"]["assistance"] == "hint"
    assert integrate["gap"]["cause_status"] == "hypothesis_only" and integrate["latest"]["time_basis"] == "unknown" and integrate["latest"]["occurred_at"] is None
    assert rows["be505.skill.promoter.explain"]["status"] == "not_observed_only" and rows["be505.skill.promoter.explain"]["gap"] is None  # unobserved is not a failure
    assert rows["be505.skill.selection.interpret"]["status"] == "uncertain"
    assert rows["be505.skill.inducible-control.explain"]["status"] == "not_assessed" and rows["be505.skill.inducible-control.explain"]["latest"] is None
    assert integrate["study"]["priority"] == "high" and "not competence" in integrate["study"]["note"]
    assert view["summary"]["skills"] == 5 and view["recorded_attempts"] == 4 and view["assessment_revisions"] == 1
    _no_invented_measures(view)
    empty = projector.gaps_view("cs542")
    assert {r["status"] for r in empty["skills"]} == {"not_assessed"} and empty["recorded_attempts"] == 0


def test_stale_owner_view_is_flagged_while_evidence_stays_available(projector, settings):
    path = next((settings.course("be505").root / "learning/attempts/2026-09").glob("*-retry-02.json"))
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    view = projector.gaps_view("be505")
    assert view["owner_view_status"] == "stale" and any("stale" in n for n in view["notes"]) and view["recorded_attempts"] == 4


def test_history_shows_revisions_under_the_same_attempt_and_excerpt_only_limits(projector):
    view = projector.history_view("be505")
    by_id = {a["attempt_id"]: a for a in view["attempts"]}
    assert len(by_id) == 4
    regraded = by_id["be505-20260907-l01-q03-assisted-03"]
    assert [r["event_id"] for r in regraded["revisions"]] == ["be505-20260908-l01-q03-regrade-01"]
    assert regraded["original_observations"][0]["outcome"] == "not_demonstrated" and regraded["effective"]["observations"][0]["outcome"] == "partial"
    assert regraded["occurred_at"] is None and regraded["time_basis"] == "unknown"
    assert all(a["response"]["availability"] == "excerpt_only" and a["response"]["full_text"] is None for a in view["attempts"])  # legacy records: nothing reconstructed


def test_review_view_offers_existing_questions_first(projector):
    view = projector.review_view("be505")
    assert view["items"] == [] and view["due_count"] == 0
    assert [q["question_id"] for q in view["available_questions"]][:2] == ["BE505-L01-Q01", "BE505-L01-Q02"] and view["default_session_size"] == 10
    assert all("answer" not in q for q in view["available_questions"])


def test_search_index_is_bounded_typed_and_never_contains_answer_keys(projector):
    index = projector.search_index("be505")
    types = {e["type"] for e in index["entries"]}
    assert types == {"lecture", "slide", "transcript", "question", "concept", "skill", "source"}
    text = json.dumps(index).lower()
    assert "solutions" not in text and "does not show expression of the gene of interest." not in text
    hit = next(e for e in index["entries"] if e["type"] == "transcript" and "replication is not transcription" in e["text"].lower())
    assert hit["ref"]["lecture_id"] == "lecture-01" and hit["ref"]["line"] == 17
    cs = projector.search_index("cs542")
    assert cs["unindexed"] and "not prepared or not displayable" in cs["unindexed"][0]["reason"]


def test_question_view_withholds_criteria_and_answers_before_an_attempt(projector):
    view = projector.question_view("be505", "BE505-L01-Q03")
    assert view["family"]["skill_ids"] == ["be505.skill.ori-vs-promoter.integrate", "be505.skill.ori.explain", "be505.skill.promoter.explain"]
    text = json.dumps(view)
    assert "observable" not in text and "Copy number is unchanged" not in text and view["criteria_count"] == 3 and view["answer_guidance"] == "restricted"
    assert {r["relation"] for r in view["relationships"]} == {"diagnostic_prerequisite", "strict_containment", "partial_overlap"}
    assert view["evidence"][0]["attempt_id"] == "be505-20260907-l01-q03-assisted-03"
    assert projector.question_view("be505", "NOPE") is None and projector.question_view("cs542", "X") is None


def test_file_views_carry_valid_view_records_with_no_new_assessment_facts(projector, settings):
    records = projector.write_views("be505", generation=3)
    assert {r["kind"] for r in records} == {"inventory", "concept_tree", "gaps", "history", "due"}
    for record in records:
        assert c.validate("view", record) == [] and record["contains_new_assessment_facts"] is False and record["generation"] == 3
        output = settings.app_area("be505") / record["outputs"][0]["path"]
        assert c.sha256_hex(output.read_bytes()) == record["outputs"][0]["sha256"]
    assert not (settings.course("be505").root / "learning" / "gaps.json").exists()  # no second gap ledger beside the owner's records


# ---- lecture units with several files (real courses have many) -----------------------------------
@pytest.fixture()
def multi_file_unit(settings, clock):
    """lecture-03 gets an empty file that sorts first, a second readable deck and a non-deck extra."""
    import shutil

    root = settings.course("be505").root
    unit = root / "materials/lectures/lecture-03"
    original = next(unit.glob("*.pdf"))
    (unit / "000 placeholder.pdf").write_bytes(b"")
    shutil.copy(root / "materials/lectures/lecture-01" / next((root / "materials/lectures/lecture-01").glob("*.pdf")).name, unit / "Second reading.pdf")
    (unit / "notes for the unit.txt").write_text("Synthetic extra material.\n", encoding="utf-8")
    journal = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    prep = Preparation(settings, converter=None, now=lambda: NOW)
    prep.prepare_course("be505")
    yield Projector(settings, journal, preparation=prep, now=lambda: NOW), original.name, prep
    journal.close()


def test_unit_with_several_files_offers_its_readable_candidates_and_lists_every_other_file(multi_file_unit):
    projector, original_name, prep = multi_file_unit
    row = next(l for l in projector.course_view("be505")["lectures"] if l["lecture_id"] == "lecture-03")
    # Two readable files and nothing in the course index that says which is the deck: neither is picked by name or size.
    assert row["deck"] is None and row["deck_choice"] == {"state": "unresolved", "basis": None, "candidates": 2}
    assert row["disposition"].startswith("no_source") and "2 candidate files" in row["disposition"]
    assert row["other_materials_count"] == 4
    view = projector.lecture_view("be505", "lecture-03")
    # An empty file that happens to sort first is not a candidate while readable files exist.
    assert sorted(c_["filename"] for c_ in view["deck_choice"]["candidates"]) == sorted([original_name, "Second reading.pdf"])
    chosen = next(c_ for c_ in view["deck_choice"]["candidates"] if c_["filename"] == original_name)
    view = projector.lecture_view("be505", "lecture-03", deck=chosen["source_id"])
    assert view["deck"]["filename"] == original_name and view["page_count"] >= 2
    others = {m["filename"]: m for m in view["other_materials"]}
    assert set(others) == {"000 placeholder.pdf", "Second reading.pdf", "notes for the unit.txt"}
    assert others["000 placeholder.pdf"]["available"] is False and others["notes for the unit.txt"]["available"] is True
    other_deck = next(m for m in view["other_materials"] if m["role"] == "deck" and m["available"])
    assert other_deck["media_type"] == "application/pdf" and other_deck["source_id"]
    assert all(set(m) == {"source_id", "filename", "role", "kind", "state", "registration", "rendition", "media_type", "bytes", "available"} for m in view["other_materials"])
    # The unit keeps one identity and is counted once in the all-lecture denominator.
    assert sum(1 for l in prep.coverage()["courses"]["be505"]["lectures"]) == 4


def test_single_file_units_list_no_other_files(projector):
    view = projector.lecture_view("be505", "lecture-01")
    assert view["other_materials"] == []
    assert {l["lecture_id"]: l["other_materials_count"] for l in projector.course_view("be505")["lectures"]} == {"lecture-01": 0, "lecture-02": 0, "lecture-03": 0, "lecture-04": 1}


def test_files_the_course_index_has_not_registered_are_identified_by_their_content(projector, settings):
    """Most real decks and recordings are not in the course's source index. They still need an exact identity, or a
    slide could not be cited, annotated or linked. It is derived from the bytes and labeled as such (disk-…)."""
    import hashlib

    root562 = settings.course("be562").root
    deck_path = root562 / "materials/lectures/lecture-02/Fixture 562 Lecture 02.pdf"
    digest = hashlib.sha256(deck_path.read_bytes()).hexdigest()
    deck = projector.lecture_view("be562", "lecture-02")["deck"]
    assert deck["registration"] == "unregistered" and deck["sha256"] == digest and deck["version_id"] == f"disk-{digest[:12]}"

    view = projector.lecture_view("be505", "lecture-02")
    recording = next(r for r in view["recordings"] if r["registration"] == "unregistered")
    wav = next((settings.course("be505").root / "materials/sessions").rglob("Fixture Lec 2 Sep 8.wav"))
    assert recording["sha256"] == hashlib.sha256(wav.read_bytes()).hexdigest() and recording["version_id"].startswith("disk-")
    assert all(t["version_id"] and t["sha256"] for t in view["transcripts"])
    # Registered files keep the version the course index gave them.
    assert view["deck"]["registration"] == "registered" and view["deck"]["version_id"].startswith("v1-")
    # A changed file gets a new identity instead of silently keeping the old one.
    deck_path.write_bytes(deck_path.read_bytes() + b"\n%% changed\n")
    assert projector.lecture_view("be562", "lecture-02")["deck"]["sha256"] != digest


# ---- questions whose wording the course index does not hold -----------------------------------------
def test_a_question_without_wording_in_the_index_is_usable_and_points_to_its_original(projector):
    """Real problem-set entries keep `prompt: null` with a note that the original page is authoritative. Search,
    review and practice must work for them, and nothing may invent the wording."""
    view = projector.question_view("be505", "BE505-PS01-Q02")
    assert view["prompt_in_index"] is False
    assert "Fixture PS01.pdf" in view["prompt"] and "page 2" in view["prompt"] and "Original source is authoritative" in view["prompt"]
    assert "burden" not in view["prompt"]  # neither the criterion nor the answer leaks into the stand-in text
    assert projector.question_view("be505", "BE505-L01-Q01")["prompt_in_index"] is True

    entries = projector.search_index("be505")["entries"]  # used to fail outright on such a question
    hit = next(e for e in entries if e["type"] == "question" and e["ref"]["question_id"] == "BE505-PS01-Q02")
    assert hit["title"] == "Problem set 1, question 2" and isinstance(hit["text"], str)
    offered = next(q for q in projector.review_view("be505")["available_questions"] if q["question_id"] == "BE505-PS01-Q02")
    assert isinstance(offered["prompt"], str) and offered["prompt_in_index"] is False
    assert all(isinstance(q["prompt"], str) for q in projector.review_view("be505")["available_questions"])


# ---- whole-inventory preparation: every readable file of a unit, and sessions the index links to no lecture ----------
def test_every_readable_pdf_of_a_unit_is_prepared_and_searchable_by_page(projector, settings):
    """A unit's further files (papers, a second deck) are course material too: their text is prepared privately, keyed to
    the exact bytes, and a search hit opens the original at that page — not only the unit's main deck."""
    view = projector.lecture_view("be562", "lecture-02")
    reading = next(m for m in view["other_materials"] if m["filename"] == "Fixture 562 Reading A.pdf")
    prep = projector.preparation
    stored = json.loads((prep.prepared_dir("be562", "lecture-02") / "other" / f"{reading['source_id']}.json").read_text(encoding="utf-8"))
    assert stored["filename"] == "Fixture 562 Reading A.pdf" and len(stored["sha256"]) == 64 and stored["pages"] and any(stored["pages"])
    state = prep.state("be562", "lecture-02")
    assert state["stages"]["other_files"]["prepared"] == 1 and state["stages"]["other_files"]["pages"] == len(stored["pages"])
    hits = [e for e in projector.search_index("be562")["entries"] if e["ref"].get("source_id") == reading["source_id"] and "page" in e["ref"]]
    assert [h["ref"]["page"] for h in hits] == [n for n, text in enumerate(stored["pages"], start=1) if text]
    assert all(h["type"] == "source" and h["title"] == f"Fixture 562 Reading A.pdf — page {h['ref']['page']}" and "lecture_id" not in h["ref"] for h in hits)
    assert hits[0]["text"] == stored["pages"][hits[0]["ref"]["page"] - 1][:1500]
    # The text file that sits in the unit is listed but is not a paged document.
    assert state["stages"]["other_files"]["not_paged"] == 1
    # Changing the file re-prepares it: the stored text always belongs to the bytes on disk.
    path = settings.course("be562").root / "materials" / "lectures" / "lecture-02" / "Fixture 562 Reading A.pdf"
    replacement = next((settings.course("be505").root / "materials" / "lectures" / "lecture-01").glob("*.pdf")).read_bytes()
    path.write_bytes(replacement)
    prep.prepare_course("be562")
    again = json.loads((prep.prepared_dir("be562", "lecture-02") / "other" / f"{reading['source_id']}.json").read_text(encoding="utf-8"))
    assert again["sha256"] != stored["sha256"] and again["sha256"] == c.sha256_hex(replacement)


def test_transcripts_of_sessions_not_linked_to_a_lecture_are_searchable_and_open_as_sources(projector):
    """The course index links many real sessions to no lecture. Their transcripts are still the learner's material:
    searchable by line, opened as the source itself — never attached to a guessed lecture."""
    course = projector.course_view("be572")
    session = next(s for s in course["unlinked_sessions"] if s["state"] != "empty_unrecorded")
    entries = projector.search_index("be572")["entries"]
    hits = [e for e in entries if e["type"] == "source" and "line" in e["ref"]]
    assert hits and all("lecture_id" not in h["ref"] for h in hits)
    assert all(h["title"].startswith(f"Session {session['date']} transcript — line ") for h in hits)
    assert [h["ref"]["line"] for h in hits] == sorted(h["ref"]["line"] for h in hits) and hits[0]["text"].strip()
    # A linked session's transcript keeps its lecture context; it is not duplicated as a bare source.
    be505 = projector.search_index("be505")["entries"]
    assert not [e for e in be505 if e["type"] == "source" and "line" in e["ref"]] and any(e["type"] == "transcript" for e in be505)
    # Answer material never becomes searchable through this path either.
    assert not [e for e in entries + be505 if "solution" in e["title"].lower()]
