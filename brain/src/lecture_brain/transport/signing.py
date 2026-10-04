"""Exact-byte manifest signatures (LL017).

P-256 ECDSA with SHA-256. The signed message is UTF-8 ``LL-BUNDLE-V1\\n`` followed by the 64
lowercase hex characters of the raw manifest SHA-256. The wire form is the 64-byte ``r || s``
(IEEE P1363) value, base64url without padding, labelled ``ES256-P1363`` — an application label,
not a JWS. Python ``cryptography`` produces DER signatures; conversion uses its supported DSS
encode/decode helpers. No elliptic-curve arithmetic is implemented here.
"""
from __future__ import annotations

from pathlib import Path
import base64
import hashlib
import os

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

ALGORITHM = "ES256-P1363"
_PREFIX = b"LL-BUNDLE-V1\n"


def generate_private_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def public_key_spki(public_key: ec.EllipticCurvePublicKey) -> bytes:
    return public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def public_key_spki_b64(public_key: ec.EllipticCurvePublicKey) -> str:
    return base64.b64encode(public_key_spki(public_key)).decode("ascii")


def load_public_key_spki_b64(text: str) -> ec.EllipticCurvePublicKey:
    key = serialization.load_der_public_key(base64.b64decode(text, validate=True))
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("Device key must be a P-256 public key")
    return key


def fingerprint(public_key: ec.EllipticCurvePublicKey) -> str:
    """SHA-256 of the SPKI DER encoding, lowercase hex. Shown to the user for pairing review."""
    return hashlib.sha256(public_key_spki(public_key)).hexdigest()


def key_id_for(public_key: ec.EllipticCurvePublicKey, prefix: str = "dev") -> str:
    return f"{prefix}-{fingerprint(public_key)[:24]}"


def signing_message(manifest_bytes: bytes) -> bytes:
    return _PREFIX + hashlib.sha256(manifest_bytes).hexdigest().encode("ascii")


def sign_manifest(private_key: ec.EllipticCurvePrivateKey, manifest_bytes: bytes, *, key_id: str) -> dict:
    der = private_key.sign(signing_message(manifest_bytes), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return {"contract": "ll.signature/1", "signature": {"algorithm": ALGORITHM, "key_id": key_id,
                                                         "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(), "value": _b64url(raw)}}


def verify_manifest(public_key: ec.EllipticCurvePublicKey, manifest_bytes: bytes, record: dict) -> bool:
    """True only when the detached signature covers exactly these manifest bytes."""
    try:
        sig = record["signature"]
        if record.get("contract") != "ll.signature/1" or sig["algorithm"] != ALGORITHM:
            return False
        if sig["manifest_sha256"] != hashlib.sha256(manifest_bytes).hexdigest():
            return False
        raw = _b64url_decode(sig["value"])
        if len(raw) != 64:
            return False
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        public_key.verify(der, signing_message(manifest_bytes), ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, KeyError, TypeError, ValueError):
        return False


def load_or_create_brain_key(keys_dir: Path) -> ec.EllipticCurvePrivateKey:
    """The Brain's own signing key, kept in local (nonsynced) application state.

    Protection is the user-profile ACL of the local state directory; the key is never written to
    Drive, a course folder, Git or any log. (An OS keystore binding is a listed hardening item.)
    """
    path = keys_dir / "brain-signing-key.pem"
    if path.is_file():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("Brain key file is not an EC private key")
        return key
    keys_dir.mkdir(parents=True, exist_ok=True)
    key = generate_private_key()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(pem)
    return key
