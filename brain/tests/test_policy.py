"""Teaching-policy projection: clause-level selection from the common tutoring policy and the course strategy.

Everything here runs on the synthetic fixture workspace and on files written inside a test's own folder. No
real policy file is read and no tutor is contacted; the tutor in the end-to-end cases is the labeled double.
"""
from __future__ import annotations

import hashlib
import json

import pytest

from lecture_brain.tutoring import policy as p


def _projection(settings) -> dict:
    return json.loads(p.projection_path(settings).read_text(encoding="utf-8"))


def _rewrite(settings, change) -> dict:
    data = _projection(settings)
    change(data)
    p.projection_path(settings).write_text(json.dumps(data, indent=1), encoding="utf-8")
    return data


def _clause(data, clause_id) -> dict:
    return next(c for c in data["clauses"] if c["clause_id"] == clause_id)


def _text_of(settings, data, clause_id) -> str:
    clause = _clause(data, clause_id)
    source = next(s for s in data["sources"] if s["label"] == clause["source"])
    root = settings.planner_root if source["scope"] == "common" else settings.course(source["scope"].split(":", 1)[1]).root
    return (root / source["path"]).read_bytes().decode("utf-8")[clause["span"]["char_start"]:clause["span"]["char_end"]]


# ---- 1. the projection file ---------------------------------------------------------------------------------------
def test_the_fixture_workspace_carries_a_synthetic_projection_in_the_versioned_format(settings):
    data = p.load_projection(p.projection_path(settings))
    assert data["contract"] == "ll.policy-projection/1" and data["projection_version"] == 1 and data["review_state"] == "drafted_unreviewed"
    assert set(data["required_categories"]) == set(p.REQUIRED_CATEGORIES) == {
        "mode_pacing", "direct_help", "optional_diagnostics", "assistant_error_and_asr_uncertainty", "alternatives", "assistance", "source_vs_added_clarification", "owner_save"}
    assert set(p.EXCLUSION_CATEGORIES) == {"identity", "learner_history", "planner_personal", "unrelated"}
    scopes = {s["label"]: s["scope"] for s in data["sources"]}
    assert scopes["planner/protocols/tutoring-policy.md"] == "common" and scopes["be505/learning-strategy.md"] == "course:be505"
    assert all(len(s["sha256"]) == 64 and s["bytes"] > 0 for s in data["sources"])
    for clause in data["clauses"]:
        assert set(clause) == {"clause_id", "source", "span", "text_sha256", "category", "applies_to", "include", "exclusion_reason", "restriction"}
        assert set(clause["span"]) == {"line_start", "line_end", "char_start", "char_end"} and set(clause["applies_to"]) == {"courses", "actions"}
        # Each clause is pinned to the exact text it was cut from.
        assert hashlib.sha256(_text_of(settings, data, clause["clause_id"]).encode("utf-8")).hexdigest() == clause["text_sha256"]
        assert clause["include"] or clause["exclusion_reason"]
    excluded = {c["category"] for c in data["clauses"] if not c["include"]}
    assert {"learner_history", "planner_personal", "unrelated"} <= excluded
    assert any(c["restriction"] and c["source"] == "be505/learning-strategy.md" for c in data["clauses"])


def test_a_projection_that_excludes_a_course_restriction_is_refused(settings):
    def relax(data):
        _clause(data, "be505.restriction-01").update(include=False, exclusion_reason="the common policy is thought to cover this")

    _rewrite(settings, relax)
    with pytest.raises(p.PolicyProjectionError, match="a projection cannot relax a course restriction"):
        p.load_projection(p.projection_path(settings))


@pytest.mark.parametrize("change,message", [
    (lambda d: _clause(d, "common.history-01").update(include=True, exclusion_reason=None), "cannot be included"),
    (lambda d: _clause(d, "common.personal-01").update(exclusion_reason=" "), "excluded without a reason"),
    (lambda d: _clause(d, "common.help-01")["span"].update(char_end=_clause(d, "common.diagnostic-01")["span"]["char_end"]), "overlap"),
    (lambda d: _clause(d, "be505.assistance-01")["applies_to"].update(courses=["cs542"]), "that course only"),
    (lambda d: _clause(d, "common.help-01").update(category="tone"), "unknown category"),
    (lambda d: _clause(d, "common.help-01").update(excluded=True), "each clause needs"),
    (lambda d: d.update(review_state="approved"), "review_state"),
    (lambda d: d["sources"][0].update(path="../outside.md"), "safe relative path"),
])
def test_a_malformed_projection_is_an_explicit_error(settings, change, message):
    _rewrite(settings, change)
    with pytest.raises(p.PolicyProjectionError, match=message):
        p.load_projection(p.projection_path(settings))


# ---- 2. the builder ----------------------------------------------------------------------------------------------
def test_included_clauses_are_supplied_in_a_stable_order_and_excluded_ones_are_listed_with_their_reason(settings):
    data = _projection(settings)
    built = p.build_policy(settings, "be505", "explain")
    assert built["projection_version"] == 1 and built["review_state"] == "drafted_unreviewed" and built["projection_state"] == "loaded" and built["text_supplied"] is True
    # Common clauses first in file order, then the course's own.
    assert built["clauses_included"] == ["common.pacing-01", "common.help-01", "common.diagnostic-01", "common.error-01", "common.alternatives-01", "common.assistance-01",
                                         "common.source-01", "common.save-01", "be505.modes-01", "be505.assistance-01", "be505.restriction-01"]
    positions = [built["text"].index(_text_of(settings, data, clause_id)) for clause_id in built["clauses_included"]]
    assert positions == sorted(positions) and built["text"].index("Common tutoring rules") < positions[0] and positions[7] < built["text"].index("Rules of this course") < positions[8]
    assert built["clauses_excluded"] == [{"id": "common.personal-01", "reason": "names the fixture learner and a planner schedule"},
                                         {"id": "common.history-01", "reason": "describes the fixture learner's own attempt history"},
                                         {"id": "common.unrelated-01", "reason": "not about tutoring"},
                                         {"id": "be505.history-01", "reason": "describes the fixture learner's own attempt history"}]
    for excluded in built["clauses_excluded"]:
        assert _text_of(settings, data, excluded["id"]) not in built["text"]
    assert "Robin Sample" not in built["text"] and "parking permit" not in built["text"]
    assert built["sources"] == [{"label": s["label"], "scope": s["scope"], "sha256": s["sha256"], "expected_sha256": s["sha256"], "state": "current"}
                                for s in data["sources"] if s["scope"] in {"common", "course:be505"}]
    assert built["gaps"] == []
    # The order does not depend on how the projection file happens to list its clauses.
    _rewrite(settings, lambda d: d["clauses"].reverse())
    again = p.build_policy(settings, "be505", "explain")
    assert again["clauses_included"] == built["clauses_included"] and again["text"] == built["text"]


def test_a_clause_applies_only_to_its_actions_and_a_required_area_left_empty_is_a_gap(settings):
    data = _projection(settings)
    for action in ("explain", "practice", "review_answer", "correct_assessment"):
        assert "common.alternatives-01" in p.build_policy(settings, "be505", action)["clauses_included"]
    ask = p.build_policy(settings, "be505", "ask")
    assert "common.alternatives-01" not in ask["clauses_included"] and _text_of(settings, data, "common.alternatives-01") not in ask["text"]
    assert {"id": "common.alternatives-01", "reason": "not_applicable:action"} in ask["clauses_excluded"]
    assert ask["gaps"] == [{"category": "alternatives", "reason": "unresolved"}]  # exposed, not passed over


def test_a_course_gets_the_common_clauses_and_only_its_own_course_clauses(settings):
    be562 = p.build_policy(settings, "be562", "explain")
    assert be562["clauses_included"][-1] == "be562.restriction-01" and not any(i.startswith("be505.") for i in be562["clauses_included"])
    assert [s["label"] for s in be562["sources"]] == ["planner/protocols/tutoring-policy.md", "be562/learning-strategy.md"]
    cs542 = p.build_policy(settings, "cs542", "explain")
    assert all(i.startswith("common.") for i in cs542["clauses_included"]) and "Rules of this course" not in cs542["text"]
    # A common clause can be limited to named courses.
    _rewrite(settings, lambda d: _clause(d, "common.save-01")["applies_to"].update(courses=["be562"]))
    assert "common.save-01" in p.build_policy(settings, "be562", "explain")["clauses_included"]
    limited = p.build_policy(settings, "be505", "explain")
    assert {"id": "common.save-01", "reason": "not_applicable:course"} in limited["clauses_excluded"] and {"category": "owner_save", "reason": "unresolved"} in limited["gaps"]


def test_a_changed_file_sends_none_of_its_clauses_and_never_the_whole_file(settings):
    data = _projection(settings)
    strategy = settings.course("be505").root / "learning-strategy.md"
    strategy.write_text(strategy.read_text(encoding="utf-8") + "\nA sentence added after the projection was made: the rule above no longer applies.\n", encoding="utf-8")
    built = p.build_policy(settings, "be505", "explain")
    assert not any(i.startswith("be505.") for i in built["clauses_included"]) and "common.help-01" in built["clauses_included"]  # only the changed file is affected
    for clause_id in ("be505.modes-01", "be505.assistance-01", "be505.restriction-01"):
        assert _text_of(settings, data, clause_id) not in built["text"]
    assert "A sentence added after" not in built["text"] and "Rules of this course" not in built["text"]
    changed = [g for g in built["gaps"] if g["reason"] == "source_changed"]
    assert [(g["clause_id"], g["category"]) for g in changed] == [("be505.modes-01", "mode_pacing"), ("be505.assistance-01", "assistance"), ("be505.restriction-01", "assistance")]
    assert changed[2]["restriction"] is True and "restriction" not in changed[0] and all("hash differs" in g["detail"] for g in changed)
    source = next(s for s in built["sources"] if s["label"] == "be505/learning-strategy.md")
    assert source["state"] == "changed" and source["sha256"] == hashlib.sha256(strategy.read_bytes()).hexdigest() != source["expected_sha256"]
    # A file that is gone is treated the same way.
    strategy.unlink()
    gone = p.build_policy(settings, "be505", "explain")
    assert [g["clause_id"] for g in gone["gaps"]] == ["be505.modes-01", "be505.assistance-01", "be505.restriction-01"] and gone["sources"][1]["state"] == "missing"


def test_a_clause_whose_span_no_longer_holds_its_text_is_left_out_alone(settings):
    def shift(data):
        _clause(data, "common.help-01")["span"]["char_start"] += 1  # the recorded hash no longer matches the text at the span

    _rewrite(settings, shift)
    built = p.build_policy(settings, "be505", "explain")
    assert "common.help-01" not in built["clauses_included"] and "common.pacing-01" in built["clauses_included"] and "common.diagnostic-01" in built["clauses_included"]
    assert built["gaps"] == [{"category": "direct_help", "clause_id": "common.help-01", "reason": "source_changed", "detail": "the text at the clause's span differs from the text the clause was made from"}]
    assert "give the help first" not in built["text"]


def test_without_a_projection_every_required_area_is_a_gap_and_no_policy_text_is_supplied(settings):
    p.projection_path(settings).unlink()
    built = p.build_policy(settings, "be505", "ask")
    assert built["text"] == "" and built["text_supplied"] is False and built["projection_state"] == "absent" and built["clauses_included"] == [] and built["sources"] == []
    assert built["gaps"] == [{"category": category, "reason": "no_projection"} for category in p.REQUIRED_CATEGORIES]


def test_an_unusable_projection_supplies_nothing_and_says_why(settings):
    _rewrite(settings, lambda d: _clause(d, "be505.restriction-01").update(include=False, exclusion_reason="dropped"))
    built = p.build_policy(settings, "be505", "explain")
    assert built["text"] == "" and built["projection_state"] == "invalid" and "cannot relax a course restriction" in built["projection_error"]
    assert built["gaps"] == [{"category": category, "reason": "projection_invalid"} for category in p.REQUIRED_CATEGORIES]


def test_an_unreviewed_projection_of_real_folders_is_held_back_until_the_owner_has_reviewed_it(workspace, tmp_path):
    from lecture_brain.config import load_settings

    local = load_settings("local", env={}, planner_config=workspace / "University" / "Fixture Brain" / "planner-config.yaml", state_dir=tmp_path / "local-state")
    held = p.build_policy(local, "be505", "explain")
    assert held["text"] == "" and held["text_supplied"] is False and held["clauses_included"] == [] and "not been reviewed" in held["held_reason"]
    assert "be505.restriction-01" in held["clauses_held"] and len(held["clauses_held"]) == 11
    assert held["gaps"] == [{"category": category, "reason": "projection_unreviewed"} for category in p.REQUIRED_CATEGORIES]
    _rewrite(local, lambda d: d.update(review_state="owner_reviewed"))
    reviewed = p.build_policy(local, "be505", "explain")
    assert reviewed["text_supplied"] is True and reviewed["clauses_included"] == held["clauses_held"] and reviewed["clauses_held"] == [] and reviewed["gaps"] == [] and reviewed["held_reason"] is None


# ---- 3. the consumer: what a tutor is given, and the record of it --------------------------------------------------------
@pytest.fixture()
def env(settings, clock):
    from test_coordinator import Env

    e = Env(settings, clock)  # the labeled fixture tutor: a test double, no inference
    yield e
    e.journal.close()


def _prompts(env, monkeypatch) -> list[str]:
    sent, original = [], env.adapter.submit

    def spy(submission_):
        sent.append(submission_.prompt)
        return original(submission_)

    monkeypatch.setattr(env.adapter, "submit", spy)
    return sent


def test_the_prompt_carries_the_included_clauses_only_and_the_receipt_lists_what_was_left_out(env, monkeypatch):
    data = _projection(env.settings)
    sent = _prompts(env, monkeypatch)
    env.ask()
    env.coordinator.tick()
    prompt, result = sent[0], env.result("req-ask")
    policy = result["detail"]["policy"]
    assert prompt.index("COURSE INSTRUCTIONS") < prompt.index("TEACHING POLICY") < prompt.index("SOURCES (numbered)")
    assert policy["clauses_included"] and all(" ".join(_text_of(env.settings, data, clause_id).split()) in prompt for clause_id in policy["clauses_included"])
    assert policy["clauses_excluded"] and all(_text_of(env.settings, data, e["id"]) not in prompt for e in policy["clauses_excluded"])
    assert "Robin Sample" not in prompt and "parking permit" not in prompt
    # Neither file is supplied whole any more; the course's own AGENTS.md still is.
    assert "# Fixture tutoring policy" not in prompt and "# Fixture learning strategy" not in prompt and "--- AGENTS.md ---" in prompt
    # The rule area with no clause for a help request is named to the tutor, once.
    assert prompt.count("Rule areas not available in this request: alternative answers and methods.") == 1
    # The record: projection identity, clause ids on both sides with reasons, source hashes and gaps.
    assert policy["contract"] == "ll.policy-receipt/1" and policy["projection_version"] == 1 and policy["review_state"] == "drafted_unreviewed" and policy["action"] == "ask"
    assert {"id": "common.history-01", "reason": "describes the fixture learner's own attempt history"} in policy["clauses_excluded"]
    assert {"id": "common.alternatives-01", "reason": "not_applicable:action"} in policy["clauses_excluded"] and policy["gaps"] == [{"category": "alternatives", "reason": "unresolved"}]
    assert [(s["label"], s["state"]) for s in policy["sources"]] == [("planner/protocols/tutoring-policy.md", "current"), ("be505/learning-strategy.md", "current")]
    assert all(len(s["sha256"]) == 64 for s in policy["sources"]) and "text" not in policy
    # The signed context receipt names the supplied clause text and this record by hash.
    from lecture_brain import contracts as c

    context = result["context"]
    assert c.validate("context", context) == []
    by_label = {a["path"]: a for a in context["instructions"]}
    assert list(by_label) == ["AGENTS.md", "policy-projection/supplied-clauses.md", "policy-projection/selection-receipt.json"]
    assert by_label["policy-projection/selection-receipt.json"]["sha256"] == c.sha256_hex(c.dump_json(policy))
    assert by_label["policy-projection/supplied-clauses.md"]["sha256"] == policy["text_sha256"] and policy["text_bytes"] == by_label["policy-projection/supplied-clauses.md"]["bytes"]
    assert "projection v1 (drafted_unreviewed)" in context["selection_note"] and "alternatives" in context["selection_note"]


def test_an_assessment_gets_the_assessment_clauses_and_no_gap_line(env, monkeypatch):
    sent = _prompts(env, monkeypatch)
    env.explain()
    env.coordinator.tick()
    policy = env.result("req-exp")["detail"]["policy"]
    assert "common.alternatives-01" in policy["clauses_included"] and "be505.restriction-01" in policy["clauses_included"] and policy["gaps"] == []
    assert "accept a correct answer that uses a different method" in sent[0] and "Rule areas not available" not in sent[0]


def test_with_no_projection_the_tutor_is_told_the_rule_areas_are_unavailable_and_gets_no_policy_file_text(env, monkeypatch):
    p.projection_path(env.settings).unlink()
    sent = _prompts(env, monkeypatch)
    env.ask()
    env.coordinator.tick()
    prompt, result = sent[0], env.result("req-ask")
    assert "Fixture policy:" not in prompt and "Modes learn/assess" not in prompt and "--- AGENTS.md ---" in prompt
    assert "(No teaching-policy clause was supplied for this request.)" in prompt and "Rule areas not available in this request: mode and pacing, direct help" in prompt
    assert [a["path"] for a in result["context"]["instructions"]] == ["AGENTS.md", "policy-projection/selection-receipt.json"]
    assert result["detail"]["policy"]["projection_state"] == "absent" and len(result["detail"]["policy"]["gaps"]) == 8


# ---- 4. course-supported statements versus added explanation -------------------------------------------------------------
from lecture_brain.tutoring.outputs import output_format_instructions, parse_tutor_output  # noqa: E402
from lecture_brain.tutoring.prompts import build_prompt  # noqa: E402

SUPPORTED = "Replication of the plasmid starts at the origin."
ADDED = "A useful picture: the origin is the starting line, not the engine."


def _reply(segments=..., reply=..., **more) -> str:
    body = {"reply_markdown": f"{SUPPORTED}\n\n{ADDED}" if reply is ... else reply, "sources_used": [0], "uncertainty": None, "assessment": None, "diagnostic": None, **more}
    if segments is not ...:
        body["segments"] = segments
    return json.dumps({k: v for k, v in body.items() if v is not ... })


def _parse(text: str, max_sources: int = 2):
    return parse_tutor_output(text, expect_assessment=False, intended_skill_ids=[], max_sources=max_sources)


def test_a_reply_itemized_into_supported_and_added_parts_is_kept_as_given_with_no_added_hedging():
    out = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": [0]}, {"text": ADDED, "support": "added_explanation", "sources": []}]))
    assert out.support_itemized is True
    assert out.segments == [{"text": SUPPORTED, "support": "course_source", "sources": [0]}, {"text": ADDED, "support": "added_explanation", "sources": []}]
    # What is shown is exactly the parts in order; nothing is appended to a supported part and no note or uncertainty is invented.
    assert out.reply_markdown == "\n\n".join(s["text"] for s in out.segments) == f"{SUPPORTED}\n\n{ADDED}"
    assert out.problems == [] and out.uncertainty is None and out.sources_used == [0]


def test_a_part_marked_course_supported_without_a_supplied_source_is_downgraded_and_noted():
    out = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": []}, {"text": ADDED, "support": "course_source", "sources": [7]}], sources_used=[]))
    assert out.support_itemized is True and [s["support"] for s in out.segments] == ["added_explanation", "added_explanation"] and all(s["sources"] == [] for s in out.segments)
    assert out.segments[0]["text"] == SUPPORTED  # the wording itself is untouched
    assert any("named no supplied source" in note for note in out.problems) and any("not supplied" in note for note in out.problems)
    assert out.sources_used == []
    # With no source supplied at all, nothing can be marked course-supported.
    none = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": [0]}, {"text": ADDED, "support": "added_explanation", "sources": []}], sources_used=[]), max_sources=0)
    assert [s["support"] for s in none.segments] == ["added_explanation", "added_explanation"]


def test_an_out_of_range_index_is_dropped_and_the_valid_one_keeps_the_part_supported():
    out = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": [1, 5, True]}, {"text": ADDED, "support": "added_explanation", "sources": [0]}], sources_used=[0]))
    assert out.segments[0] == {"text": SUPPORTED, "support": "course_source", "sources": [1]}
    assert out.segments[1]["sources"] == []  # an added explanation carries no citation: a listed source would look like support
    assert out.sources_used == [0, 1]  # the reply's sources are those it listed plus those its supported parts rely on
    assert out.problems == ["the reply cited a source that was not supplied; that citation was dropped"]


@pytest.mark.parametrize("segments", [..., None, "all of it", [], [{"text": SUPPORTED}], [{"text": "", "support": "course_source", "sources": [0]}],
                                      [{"text": SUPPORTED, "support": "verified", "sources": [0]}, {"text": ADDED, "support": "added_explanation", "sources": []}],
                                      [SUPPORTED, ADDED]])
def test_a_reply_without_usable_parts_is_kept_exactly_as_before_and_marked_not_itemized(segments):
    before = _parse(_reply())
    out = _parse(_reply(segments))
    assert out.support_itemized is False and out.segments is None
    assert (out.reply_markdown, out.sources_used, out.uncertainty, out.structured) == (before.reply_markdown, before.sources_used, before.uncertainty, True)
    given_nothing = segments is ... or segments is None or segments == []  # no itemization offered: nothing to remark on
    assert out.problems == ([] if given_nothing else ["the reply's support marking could not be read; support is not itemized"])


def test_parts_that_do_not_make_up_the_reply_are_not_used():
    out = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": [0]}]))  # the second paragraph of the reply is not in any part
    assert out.support_itemized is False and out.segments is None and out.reply_markdown == f"{SUPPORTED}\n\n{ADDED}"
    assert out.problems == ["the reply's itemized parts did not match its text; the reply is shown whole and support is not itemized"]
    # Only spacing may differ between the reply and its parts; the parts then are the reply.
    spaced = _parse(_reply([{"text": SUPPORTED + " ", "support": "course_source", "sources": [0]}, {"text": "\n" + ADDED, "support": "added_explanation", "sources": []}], reply=f"{SUPPORTED} {ADDED}"))
    assert spaced.support_itemized is True and spaced.reply_markdown == f"{SUPPORTED}\n\n{ADDED}" and spaced.problems == []


def test_a_reply_given_only_as_parts_is_built_from_them():
    out = _parse(_reply([{"text": SUPPORTED, "support": "course_source", "sources": [0]}, {"text": ADDED, "support": "added_explanation", "sources": []}], reply=None))
    assert out.structured is True and out.support_itemized is True and out.reply_markdown == f"{SUPPORTED}\n\n{ADDED}"
    plain = _parse("The origin is where copying starts.")
    assert plain.structured is False and plain.support_itemized is False and plain.segments is None


def test_every_reply_depth_is_asked_to_itemize_support(settings):
    material = {"instruction_text": "x", "spans": [], "attempts": [], "rubric": [], "assessor_guidance": None}
    for depth in ("quick", "standard", "deep"):
        prompt, _ = build_prompt(action="ask", depth=depth, material=material, question_text="What does the origin do?", policy=settings.policy)
        assert '"segments": [{"text":' in prompt and "course_source|added_explanation" in prompt
    for flags in ({"expect_assessment": True, "expect_diagnostic": True}, {"expect_assessment": False, "expect_diagnostic": False}):
        text = output_format_instructions(**flags)
        assert '"segments"' in text and "Do not add hedging" in text


def _itemizing(env, monkeypatch, mark):
    """Wrap the labeled fixture tutor so its own synthetic reply also arrives split into parts (still a test double, no inference)."""
    from lecture_brain.native import NativeObservation

    original = env.adapter.submit

    def submit(submission_):
        observation = original(submission_)
        body = json.loads(observation.text)
        body["segments"] = [{"text": part, **mark(i, part)} for i, part in enumerate(body["reply_markdown"].split("\n\n"))]
        return NativeObservation(observation.state, observation.native_turn_id, json.dumps(body), observation.failure_code, observation.detail)

    monkeypatch.setattr(env.adapter, "submit", submit)


def test_the_stored_reply_and_its_signed_detail_carry_the_parts_and_which_source_supports_each(env, monkeypatch):
    from helpers import source_ref

    _itemizing(env, monkeypatch, lambda i, part: {"support": "course_source", "sources": [0]} if part.startswith("From the pinned source") else {"support": "course_source", "sources": []} if i == 1
               else {"support": "added_explanation", "sources": []})
    env.ask()
    env.coordinator.tick()
    result = env.result("req-ask")
    detail, message = result["detail"], result["message"]
    assert detail["support_itemized"] is True and [s["support"] for s in detail["segments"]] == ["added_explanation", "added_explanation", "course_source"]
    # The parts are the stored reply, and a supported part points at the message's own source list.
    assert message["text"] == "\n\n".join(s["text"] for s in detail["segments"])
    assert detail["segments"][2]["sources"] == [0] and message["sources"] == [source_ref(env.root)] and detail["segments"][0]["sources"] == []
    assert any("named no supplied source" in note for note in detail["problems"])  # the part that claimed support without a source
    stored = json.loads(next(env.settings.runs_area("be505").rglob(f"messages/{message['message_id']}.json")).read_text(encoding="utf-8"))
    assert stored["text"] == message["text"]


def test_a_reply_that_was_not_itemized_says_so_and_is_otherwise_unchanged(env):
    env.ask()
    env.coordinator.tick()
    result = env.result("req-ask")
    assert result["detail"]["support_itemized"] is False and result["detail"]["segments"] is None
    assert result["message"]["text"].startswith("**[Fixture tutor") and result["detail"]["problems"] == []
