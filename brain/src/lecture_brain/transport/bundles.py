"""Immutable signed bundles: build (sender side) and inspect (receiver side).

Payload files are written first, the detached signature next and ``ready.json`` (the manifest)
last, so a reader that sees a manifest can expect every listed file to follow. A bundle is only
*complete* when exactly the listed files are present with the listed sizes and digests; until then
it is *pending*, never an error and never admitted.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric import ec

from .. import contracts as c
from ..config import Settings
from ..fsutil import publish_exclusive
from . import signing
from .pairing import PairingError, PairingRegistry

MANIFEST = "ready.json"
SIGNATURE = "ready.sig.json"
_MEDIA = {".json": "application/json", ".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
          ".webm": "audio/webm", ".wav": "audio/wav", ".m4a": "audio/mp4"}


def _media_type(path: str) -> str:
    return _MEDIA.get(Path(path).suffix.lower(), "application/octet-stream")


def write_bundle(directory: Path, *, kind: str, bundle_id: str, scope: dict, record_path: str, files: dict[str, bytes], signer_key_id: str,
                 private_key: ec.EllipticCurvePrivateKey, created_at: str, predecessor_manifest: str | None = None, commit: bool = True) -> dict:
    """Write an immutable bundle. With ``commit=False`` the manifest is withheld (payload still syncing)."""
    if len(files) > c.MAX_BUNDLE_FILES:
        raise c.ContractError("Bundle file limit exceeded")
    artifacts = []
    for rel, data in sorted(files.items()):
        if not c.safe_relative(rel) or rel in {MANIFEST, SIGNATURE}:
            raise c.ContractError(f"Unsafe bundle path: {rel}")
        publish_exclusive(directory / rel, data)
        artifacts.append(c.artifact_for_bytes(data, rel, _media_type(rel)))
    manifest = {"contract": "ll.bundle/1", "bundle_id": bundle_id, "kind": kind, "scope": scope, "created_at": created_at, "signer_key_id": signer_key_id,
                "record_path": record_path, "files": artifacts, "predecessor_manifest": predecessor_manifest}
    c.require_valid("bundle", manifest)
    manifest_bytes = c.dump_json(manifest)
    if len(manifest_bytes) > c.MAX_MANIFEST_BYTES:
        raise c.ContractError("Manifest size limit exceeded")
    if commit:
        publish_exclusive(directory / SIGNATURE, c.dump_json(signing.sign_manifest(private_key, manifest_bytes, key_id=signer_key_id)))
        publish_exclusive(directory / MANIFEST, manifest_bytes)
    return {"manifest": manifest, "manifest_sha256": c.sha256_hex(manifest_bytes)}


@dataclass
class Inspection:
    status: str  # complete | pending | invalid | unauthorized | stale_binding | expired
    reason: str | None = None
    manifest: dict | None = None
    manifest_sha256: str | None = None
    request: dict | None = None
    payload: Any = None
    device: dict | None = None


def _time(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def read_manifest(directory: Path) -> tuple[bytes, dict] | None:
    path = directory / MANIFEST
    if not path.is_file():
        return None
    if path.stat().st_size > c.MAX_MANIFEST_BYTES:
        raise c.ContractError("Manifest size limit exceeded")
    data = path.read_bytes()
    return data, c.parse_json(data, max_bytes=c.MAX_MANIFEST_BYTES)


def inspect_bundle(directory: Path, *, settings: Settings, pairing: PairingRegistry, course_id: str, now: str) -> Inspection:
    """Decide whether a request bundle found in ``course_id``'s inbox may be admitted.

    Order: manifest presence → schema → exact files → signature/pairing → entry record → typed
    payload → trusted-binding checks. Nothing in the payload selects a root, thread, executable or
    permission; those come only from the local binding.
    """
    try:
        loaded = read_manifest(directory)
    except c.ContractError as exc:
        return Inspection("invalid", f"manifest: {exc}")
    if loaded is None:
        return Inspection("pending", "manifest not committed yet")
    manifest_bytes, manifest = loaded
    errors = c.validate("bundle", manifest)
    if errors:
        return Inspection("invalid", "manifest: " + "; ".join(errors[:3]))
    digest = c.sha256_hex(manifest_bytes)
    if manifest["kind"] != "request":
        return Inspection("invalid", "not a request bundle", manifest, digest)
    if manifest["scope"]["course_id"] != course_id:
        return Inspection("invalid", f"bundle is scoped to {manifest['scope']['course_id']} but was found in the {course_id} inbox", manifest, digest)

    listed = {f["path"]: f for f in manifest["files"]}
    present = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()} - {MANIFEST, SIGNATURE}
    if not (directory / SIGNATURE).is_file() or (set(listed) - present):
        return Inspection("pending", "waiting for complete files", manifest, digest)
    file_errors = c.verify_files(directory, manifest)
    if file_errors:
        return Inspection("invalid", "; ".join(sorted(set(file_errors))), manifest, digest)

    try:
        signature = c.parse_json((directory / SIGNATURE).read_bytes(), max_bytes=4096)
    except c.ContractError as exc:
        return Inspection("unauthorized", f"signature unreadable: {exc}", manifest, digest)
    if c.validate("signature", signature) or signature["signature"]["key_id"] != manifest["signer_key_id"]:
        return Inspection("unauthorized", "signature record invalid or signed by a different key than the manifest names", manifest, digest)

    try:
        request = c.parse_json((directory / manifest["record_path"]).read_bytes())
    except c.ContractError as exc:
        return Inspection("invalid", f"request: {exc}", manifest, digest)
    errors = c.validate("request", request)
    if errors:
        return Inspection("invalid", "request: " + "; ".join(errors[:3]), manifest, digest)

    try:
        device = pairing.authorize(manifest["signer_key_id"], course_id=course_id, action=request["action"])
        public_key = pairing.public_key(manifest["signer_key_id"])
    except PairingError as exc:
        return Inspection("unauthorized", str(exc), manifest, digest, request)
    if not signing.verify_manifest(public_key, manifest_bytes, signature):
        return Inspection("unauthorized", "signature does not cover these manifest bytes", manifest, digest, request)
    if device["device_id"] != request["device_id"]:
        return Inspection("unauthorized", "request names a different device than the signing key belongs to", manifest, digest, request)

    if directory.name != request["request_id"]:
        return Inspection("invalid", "bundle folder name differs from its request id", manifest, digest, request)
    if request["scope"] != manifest["scope"]:
        return Inspection("invalid", "request scope differs from manifest scope", manifest, digest, request)
    entry = listed.get(request["payload"]["path"])
    if entry is None or entry["sha256"] != request["payload"]["sha256"] or entry["bytes"] != request["payload"]["bytes"]:
        return Inspection("invalid", "payload named by the request is not the payload listed in the manifest", manifest, digest, request)
    try:
        payload = c.parse_json((directory / request["payload"]["path"]).read_bytes())
    except c.ContractError as exc:
        return Inspection("invalid", f"payload: {exc}", manifest, digest, request)
    errors = c.validate_payload(request, payload)
    if errors:
        return Inspection("invalid", "payload: " + "; ".join(errors[:3]), manifest, digest, request)

    binding = settings.course(course_id)
    if not binding.usable:
        return Inspection("invalid", f"course binding unusable: {binding.problem}", manifest, digest, request, payload, device)
    if request["scope"]["term"] != binding.term or request["thread_key"] != binding.thread_key:
        return Inspection("invalid", "request targets a thread/term outside the trusted binding", manifest, digest, request, payload, device)
    if request["binding_revision"] != settings.binding_revision:
        return Inspection("stale_binding", "request was built against a different binding revision; renew it on the device", manifest, digest, request, payload, device)
    if request["expires_at"] is not None and _time(request["expires_at"]) <= _time(now):
        return Inspection("expired", "request expired before admission; captured input is kept and needs renewed intent", manifest, digest, request, payload, device)
    return Inspection("complete", None, manifest, digest, request, payload, device)
