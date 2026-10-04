"""LL017: paired device keys, exact-byte manifest signatures and immutable bundle admission."""
from __future__ import annotations

import base64
import json

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from lecture_brain import contracts as c
from lecture_brain.journal import AdmissionOutcome, Journal
from lecture_brain.transport import signing
from lecture_brain.transport.bundles import inspect_bundle
from lecture_brain.transport.inbox import InboxScanner
from lecture_brain.transport.pairing import PairingError, PairingRegistry

from helpers import Device, make_request_bundle, pair, question_message


@pytest.fixture()
def journal(settings, clock):
    j = Journal.open(settings.journal_path, clock=clock, synced_roots=[])
    yield j
    j.close()


@pytest.fixture()
def pairing(journal):
    return PairingRegistry(journal)


@pytest.fixture()
def device(pairing):
    d = Device()
    pair(pairing, d)
    return d


# ---- signature representation --------------------------------------------------------------------
def test_signature_is_p1363_base64url_over_the_documented_message():
    key = signing.generate_private_key()
    manifest = b'{"contract":"ll.bundle/1"}'
    record = signing.sign_manifest(key, manifest, key_id="dev-test")
    assert c.validate("signature", record) == []
    sig = record["signature"]
    assert sig["algorithm"] == "ES256-P1363" and len(sig["value"]) == 86 and sig["manifest_sha256"] == c.sha256_hex(manifest)
    raw = base64.urlsafe_b64decode(sig["value"] + "==")
    assert len(raw) == 64
    # Independently verify with the library's DER form: r||s over "LL-BUNDLE-V1\n" + lowercase hex digest.
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    key.public_key().verify(der, b"LL-BUNDLE-V1\n" + c.sha256_hex(manifest).encode("ascii"), ec.ECDSA(hashes.SHA256()))
    assert signing.verify_manifest(key.public_key(), manifest, record) is True
    assert signing.verify_manifest(key.public_key(), manifest + b" ", record) is False
    assert signing.verify_manifest(signing.generate_private_key().public_key(), manifest, record) is False


def test_webcrypto_fixture_signature_verifies_in_python(repo):
    """Cross-language compatibility: a signature produced by WebCrypto (Node) verifies here."""
    fixture = json.loads((repo / "fixtures/crypto/webcrypto-p256-signature.json").read_text(encoding="utf-8"))
    public_key = signing.load_public_key_spki_b64(fixture["public_key_spki_b64"])
    manifest = base64.b64decode(fixture["manifest_b64"])
    assert signing.verify_manifest(public_key, manifest, fixture["signature_record"]) is True
    assert signing.fingerprint(public_key) == fixture["fingerprint"]
    tampered = bytearray(manifest)
    tampered[0] ^= 1
    assert signing.verify_manifest(public_key, bytes(tampered), fixture["signature_record"]) is False


def test_brain_key_is_created_once_and_reloaded(settings):
    first = signing.load_or_create_brain_key(settings.keys_dir)
    second = signing.load_or_create_brain_key(settings.keys_dir)
    assert signing.fingerprint(first.public_key()) == signing.fingerprint(second.public_key())


# ---- pairing -------------------------------------------------------------------------------------
def test_pairing_requires_reviewed_fingerprint_and_can_be_revoked(pairing):
    d = Device("device-phone")
    pairing.request(device_id=d.device_id, label="Phone", public_key_spki_b64=d.spki_b64, courses=["be505"], actions=None)
    with pytest.raises(PairingError):
        pairing.authorize(d.key_id, course_id="be505", action="ask")  # pending is not paired
    with pytest.raises(PairingError):
        pairing.approve(d.key_id, reviewed_fingerprint="0" * 64)
    pairing.approve(d.key_id, reviewed_fingerprint=d.fingerprint)
    assert pairing.authorize(d.key_id, course_id="be505", action="ask")["device_id"] == "device-phone"
    with pytest.raises(PairingError):
        pairing.authorize(d.key_id, course_id="cs542", action="ask")  # course not in allowlist
    pairing.revoke(d.key_id)
    with pytest.raises(PairingError):
        pairing.authorize(d.key_id, course_id="be505", action="ask")


def test_action_allowlist_is_enforced(pairing):
    d = Device("device-readonly")
    pairing.request(device_id=d.device_id, label="Tablet", public_key_spki_b64=d.spki_b64, courses=["be505"], actions=["ask", "resume"])
    pairing.approve(d.key_id, reviewed_fingerprint=d.fingerprint)
    pairing.authorize(d.key_id, course_id="be505", action="ask")
    with pytest.raises(PairingError):
        pairing.authorize(d.key_id, course_id="be505", action="correct_assessment")


# ---- bundle inspection ---------------------------------------------------------------------------
def test_complete_signed_bundle_is_admissible(settings, pairing, device):
    directory = make_request_bundle(settings, device, request_id="req-ok", action="ask", payload=question_message(settings, "req-ok", "What does the origin do?"))
    result = inspect_bundle(directory, settings=settings, pairing=pairing, course_id="be505", now="2026-10-04T10:00:05Z")
    assert result.status == "complete", result.reason
    assert result.request["request_id"] == "req-ok" and result.payload["role"] == "learner_question"
    assert len(result.manifest_sha256) == 64


def test_bundle_without_manifest_or_with_late_files_stays_pending(settings, pairing, device):
    directory = make_request_bundle(settings, device, request_id="req-late", action="ask", payload=question_message(settings, "req-late", "Q"), commit=False)
    assert inspect_bundle(directory, settings=settings, pairing=pairing, course_id="be505", now="2026-10-04T10:00:05Z").status == "pending"
    complete = make_request_bundle(settings, device, request_id="req-late2", action="ask", payload=question_message(settings, "req-late2", "Q"))
    (complete / "payload.json").unlink()  # payload not yet synced
    assert inspect_bundle(complete, settings=settings, pairing=pairing, course_id="be505", now="2026-10-04T10:00:05Z").status == "pending"


@pytest.mark.parametrize("case", ["unlisted_file", "tampered_payload", "unpaired_key", "revoked_key", "wrong_course", "stale_binding", "bad_signature", "wrong_thread", "id_mismatch", "expired"])
def test_invalid_bundles_are_rejected_with_a_reason(settings, pairing, device, case):
    rid = f"req-{case.replace('_', '-')}"
    payload = question_message(settings, rid, "Q")
    kwargs = {}
    signer = device
    if case == "unpaired_key":
        signer = Device("device-stranger")
    if case == "stale_binding":
        kwargs["binding_revision"] = "0" * 64
    if case == "expired":
        kwargs["expires_at"] = "2026-10-04T10:00:03Z"
    if case == "wrong_thread":
        payload["thread_key"] = "some-other-thread"
    directory = make_request_bundle(settings, signer, request_id=rid, action="ask", payload=payload, **kwargs)
    course = "be505"
    if case == "unlisted_file":
        (directory / "extra.txt").write_bytes(b"x")
    if case == "tampered_payload":
        (directory / "payload.json").write_bytes((directory / "payload.json").read_bytes().replace(b'"Q"', b'"Z"'))
    if case == "revoked_key":
        pairing.revoke(device.key_id)
    if case == "wrong_course":
        course = "cs542"  # bundle found in another course's inbox
    if case == "bad_signature":
        sig = json.loads((directory / "ready.sig.json").read_text())
        sig["signature"]["value"] = "A" * 86
        (directory / "ready.sig.json").write_text(json.dumps(sig))
    if case == "id_mismatch":
        directory = directory.rename(directory.with_name("req-renamed"))
    result = inspect_bundle(directory, settings=settings, pairing=pairing, course_id=course, now="2026-10-04T10:00:05Z")
    expected = {"unlisted_file": "invalid", "tampered_payload": "invalid", "unpaired_key": "unauthorized", "revoked_key": "unauthorized", "wrong_course": "invalid",
                "stale_binding": "stale_binding", "bad_signature": "unauthorized", "wrong_thread": "invalid", "id_mismatch": "invalid", "expired": "expired"}[case]
    assert result.status == expected, (case, result.status, result.reason)
    assert result.reason


def test_signed_but_semantically_bad_input_is_still_rejected(settings, pairing, device):
    payload = question_message(settings, "req-bad", "Q")
    payload["assessment_disposition"] = "canonical_saved"  # a help question cannot claim an assessment
    directory = make_request_bundle(settings, device, request_id="req-bad", action="ask", payload=payload)
    result = inspect_bundle(directory, settings=settings, pairing=pairing, course_id="be505", now="2026-10-04T10:00:05Z")
    assert result.status == "invalid"


# ---- inbox scan → journal admission --------------------------------------------------------------
def test_scan_admits_once_and_replay_is_idempotent(settings, journal, pairing, device):
    make_request_bundle(settings, device, request_id="req-1", action="ask", payload=question_message(settings, "req-1", "Q1"), sequence=1)
    scanner = InboxScanner(settings, journal, pairing, now=lambda: "2026-10-04T10:00:05Z")
    first = scanner.scan()
    assert [a["request_id"] for a in first["admitted"]] == ["req-1"]
    again = scanner.scan()
    assert again["admitted"] == [] and again["rejected"] == []
    assert len(journal.jobs()) == 1 and journal.jobs()[0]["workflow"] == "WF04"
    receipts = journal.receipts(kind="admission")
    assert len(receipts) == 1 and receipts[0]["sha256"] == journal.admission("req-1")["manifest_sha256"]


def test_same_request_id_with_different_bytes_is_a_visible_conflict(settings, journal, pairing, device, tmp_path):
    make_request_bundle(settings, device, request_id="req-1", action="ask", payload=question_message(settings, "req-1", "Q1"), sequence=1)
    scanner = InboxScanner(settings, journal, pairing, now=lambda: "2026-10-04T10:00:05Z")
    scanner.scan()
    # A duplicate Drive item with the same request id but different content arrives under another folder name.
    other = make_request_bundle(settings, device, request_id="req-1", action="ask", payload=question_message(settings, "req-1", "Different"), sequence=1,
                                target_dir=settings.app_area("be505") / "inbox" / "req-1 (1)")
    result = scanner.scan()
    assert result["admitted"] == []
    assert any(r["status"] in {"invalid", "conflict"} for r in result["rejected"])
    assert len(journal.jobs()) == 1
    assert other.is_dir()  # input bytes are retained, never deleted by rejection


def test_out_of_order_sequences_admit_and_pending_bundles_wait(settings, journal, pairing, device):
    make_request_bundle(settings, device, request_id="req-5", action="ask", payload=question_message(settings, "req-5", "Q5"), sequence=5)
    scanner = InboxScanner(settings, journal, pairing, now=lambda: "2026-10-04T10:00:05Z")
    assert len(scanner.scan()["admitted"]) == 1
    make_request_bundle(settings, device, request_id="req-3", action="ask", payload=question_message(settings, "req-3", "Q3"), sequence=3)
    pending = make_request_bundle(settings, device, request_id="req-6", action="ask", payload=question_message(settings, "req-6", "Q6"), sequence=6, commit=False)
    result = scanner.scan()
    assert [a["request_id"] for a in result["admitted"]] == ["req-3"]
    assert [p["name"] for p in result["pending"]] == ["req-6"] and pending.is_dir()


def test_rejections_are_reported_once_per_content(settings, journal, pairing):
    stranger = Device("device-stranger")
    make_request_bundle(settings, stranger, request_id="req-x", action="ask", payload=question_message(settings, "req-x", "Q"))
    scanner = InboxScanner(settings, journal, pairing, now=lambda: "2026-10-04T10:00:05Z")
    assert scanner.scan()["rejected"][0]["status"] == "unauthorized"
    assert scanner.scan()["rejected"] == []  # already reported; no repeated churn
    assert journal.jobs() == []
    assert scanner.rejections()[0]["name"] == "req-x"
