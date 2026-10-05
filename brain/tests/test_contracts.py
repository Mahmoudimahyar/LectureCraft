"""LL004: shared wire validation in the Brain package agrees with every supplied case."""
from __future__ import annotations
import copy
import hashlib
import json
import pytest
from lecture_brain import contracts as c


def cases(repo):
    return json.loads((repo / "fixtures/contracts/cases.json").read_text(encoding="utf-8"))["cases"]


def test_all_supplied_cases_match_expected(repo):
    all_cases = cases(repo)
    assert len(all_cases) == 97  # 84 original cases + 13 derived-manifest / derived-segments cases (remediation R1-E)
    for case in all_cases:
        record = c.parse_json((repo / case["fixture"]).read_bytes())
        errors = c.validate(case["schema"], record)
        assert (not errors) == case["expected_valid"], (case["id"], errors)


def test_duplicate_keys_nonfinite_bom_and_size_fail_closed():
    with pytest.raises(c.ContractError):
        c.parse_json(b'{"x":1,"x":2}')
    with pytest.raises(c.ContractError):
        c.parse_json(b'{"x":NaN}')
    with pytest.raises(c.ContractError):
        c.parse_json(b'{"x":1e999}')
    with pytest.raises(c.ContractError):
        c.parse_json(b'\xef\xbb\xbf{"x":1}')
    with pytest.raises(c.ContractError):
        c.parse_json(b'{"x":"' + b"a" * 20 + b'"}', max_bytes=10)
    with pytest.raises(c.ContractError):
        c.parse_json(b'\xff\xfe')


def test_unknown_schema_is_never_fetched():
    with pytest.raises(c.ContractError):
        c.validate("remote-unknown", {})
    with pytest.raises(c.ContractError):
        c.validate("common", {})


def test_unsupported_version_and_approved_flag_rejected(fixture_json):
    req = fixture_json("request.valid.json")
    assert c.validate("request", req) == []
    v2 = dict(req, contract="ll.request/2")
    assert c.validate("request", v2)
    assert c.validate("request", dict(req, approved=True))


def test_path_limits(fixture_json):
    req = fixture_json("request.valid.json")
    for bad in ["CON", "x /a.json", "a/../b.json", "/abs.json", "a\b.json", "C:/x.json", "a/./b", "nul.txt", "trailingdot./x"]:
        r = copy.deepcopy(req)
        r["payload"]["path"] = bad
        assert c.validate("request", r), bad
    assert c.safe_relative("payload/message.json")
    assert not c.safe_relative("a" * 600)


def test_cross_record_identity(fixture_json):
    req = fixture_json("request.valid.json")
    question = fixture_json("message.valid.json")
    question.update(role="learner_question", assessment_disposition="not_assessed")
    assert c.validate_payload(req, question) == []
    wrong = copy.deepcopy(question)
    wrong["scope"]["course_id"] = "other-course"
    assert c.validate_payload(req, wrong)
    wrong = dict(question, thread_key="other-thread")
    assert c.validate_payload(req, wrong)
    assert c.validate_payload(req, dict(question, role="tutor"))
    assert c.validate_payload(req, dict(question, assessment_disposition="canonical_saved"))
    # A submitted answer is not a help question.
    assert c.validate_payload(req, fixture_json("submission.valid.json"))


def test_action_payload_mapping_is_closed(fixture_json):
    assert c.payload_schema_for("ask") == "message"
    assert c.payload_schema_for("explain") == "submission"
    with pytest.raises(c.ContractError):
        c.payload_schema_for("run_shell")


def test_explain_action_requires_matching_submission(fixture_json):
    req = dict(fixture_json("request.valid.json"), action="explain")
    sub = fixture_json("submission.valid.json")
    sub["logical_input_id"] = req["logical_input_id"]
    sub["scope"] = req["scope"]
    sub["interaction"] = "explain_back"
    assert c.validate_payload(req, sub) == []
    assert c.validate_payload(req, dict(sub, interaction="practice"))
    assert c.validate_payload(req, dict(sub, logical_input_id="another-input"))


def test_bundle_file_verification(tmp_path, fixture_json):
    root = tmp_path / "bundle"
    (root / "payload").mkdir(parents=True)
    (root / "request.json").write_bytes(b'{"a":1}')
    (root / "payload/message.json").write_bytes(b'{"b":2}')
    bundle = fixture_json("bundle.valid.json")
    bundle["record_path"] = "request.json"
    bundle["files"] = [c.artifact(root / "request.json", "request.json", "application/json"),
                       c.artifact(root / "payload/message.json", "payload/message.json", "application/json")]
    assert c.verify_files(root, bundle) == []
    # Unlisted late file leaves the bundle unadmittable.
    (root / "extra.bin").write_bytes(b"x")
    assert c.verify_files(root, bundle)
    (root / "extra.bin").unlink()
    # Byte change under the same name is a digest mismatch.
    (root / "payload/message.json").write_bytes(b'{"b":3}')
    assert c.verify_files(root, bundle)
    # Manifest and signature never hash themselves.
    (root / "payload/message.json").write_bytes(b'{"b":2}')
    (root / "ready.json").write_bytes(b"{}")
    (root / "ready.sig.json").write_bytes(b"{}")
    assert c.verify_files(root, bundle) == []


def test_canonical_bytes_are_stable_and_hash_raw():
    data = c.dump_json({"b": 1, "a": "é"})
    assert data == '{"a":"é","b":1}'.encode("utf-8")
    assert c.sha256_hex(data) == hashlib.sha256(data).hexdigest()
