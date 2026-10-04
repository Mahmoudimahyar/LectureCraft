"""Device pairing registry on the Brain PC.

A device key becomes usable only after the user reviews its fingerprint on the Brain and approves
it with an explicit course/action allowlist. Nothing arriving through Drive can enrol, widen or
re-activate a key. A valid signature proves possession of a paired key — not permission for
arbitrary actions and not pedagogical truth.
"""
from __future__ import annotations

import json
import secrets
from typing import Iterable

import sqlalchemy as sa

from ..journal import Journal
from ..journal import schema as t
from . import signing

ALL_ACTIONS = ("ask", "explain", "practice", "diagnose", "select_review", "edit_review", "review_answer", "correct_assessment", "correct_source",
               "save_note", "resume", "cancel", "source_hint")


class PairingError(PermissionError):
    pass


class PairingRegistry:
    def __init__(self, journal: Journal):
        self._journal = journal

    def _row(self, conn: sa.Connection, key_id: str) -> dict | None:
        row = conn.execute(sa.select(t.devices).where(t.devices.c.key_id == key_id)).first()
        if row is None:
            return None
        data = dict(row._mapping)
        data["courses"] = json.loads(data["courses"])
        data["actions"] = json.loads(data["actions"])
        return data

    def request(self, *, device_id: str, label: str, public_key_spki_b64: str, courses: Iterable[str], actions: Iterable[str] | None) -> dict:
        """Register a pending pairing request (loopback operator surface only). Returns the challenge to display."""
        public_key = signing.load_public_key_spki_b64(public_key_spki_b64)
        key_id = signing.key_id_for(public_key)
        allowed_actions = list(actions) if actions is not None else list(ALL_ACTIONS)
        unknown = set(allowed_actions) - set(ALL_ACTIONS)
        if unknown:
            raise PairingError(f"Unknown actions requested: {sorted(unknown)}")
        with self._journal.tx() as conn:
            existing = self._row(conn, key_id)
            if existing is not None:
                if existing["state"] == "revoked":
                    raise PairingError("This key was revoked; pair a new key instead of re-activating it")
                return self._public(existing)
            challenge = secrets.token_hex(4)
            conn.execute(t.devices.insert().values(key_id=key_id, device_id=device_id, label=label[:200], public_key_spki=public_key_spki_b64,
                                                   fingerprint=signing.fingerprint(public_key), courses=json.dumps(sorted(set(courses))),
                                                   actions=json.dumps(sorted(allowed_actions)), state="pending", challenge=challenge, created_at=self._journal.now()))
            return self._public(self._row(conn, key_id))

    def approve(self, key_id: str, *, reviewed_fingerprint: str) -> dict:
        """Operator approval: the fingerprint the user reviewed must equal the stored key's fingerprint."""
        with self._journal.tx() as conn:
            row = self._row(conn, key_id)
            if row is None:
                raise PairingError("Unknown pairing request")
            if row["state"] == "revoked":
                raise PairingError("Revoked keys cannot be approved")
            if not secrets.compare_digest(row["fingerprint"], reviewed_fingerprint.strip().lower().replace(" ", "").replace(":", "")):
                raise PairingError("Reviewed fingerprint does not match this device key")
            conn.execute(t.devices.update().where(t.devices.c.key_id == key_id).values(state="paired", approved_at=self._journal.now(), challenge=None))
            return self._public(self._row(conn, key_id))

    def revoke(self, key_id: str) -> dict:
        with self._journal.tx() as conn:
            if self._row(conn, key_id) is None:
                raise PairingError("Unknown device key")
            conn.execute(t.devices.update().where(t.devices.c.key_id == key_id).values(state="revoked", revoked_at=self._journal.now()))
            return self._public(self._row(conn, key_id))

    def authorize(self, key_id: str, *, course_id: str, action: str) -> dict:
        """Return the paired device when the key may request ``action`` for ``course_id``; raise otherwise."""
        with self._journal.tx() as conn:
            row = self._row(conn, key_id)
        if row is None:
            raise PairingError("Signer key is not paired with this Brain")
        if row["state"] != "paired":
            raise PairingError(f"Signer key is {row['state']}, not paired")
        if course_id not in row["courses"]:
            raise PairingError(f"Device is not allowed to act on course {course_id}")
        if action not in row["actions"]:
            raise PairingError(f"Device is not allowed to request action {action}")
        return row

    def public_key(self, key_id: str):
        with self._journal.tx() as conn:
            row = self._row(conn, key_id)
        if row is None:
            raise PairingError("Signer key is not paired with this Brain")
        return signing.load_public_key_spki_b64(row["public_key_spki"])

    def devices(self) -> list[dict]:
        with self._journal.tx() as conn:
            keys = conn.execute(sa.select(t.devices.c.key_id).order_by(t.devices.c.created_at)).scalars().all()
            return [self._public(self._row(conn, k)) for k in keys]

    @staticmethod
    def _public(row: dict) -> dict:
        return {k: row[k] for k in ("key_id", "device_id", "label", "fingerprint", "courses", "actions", "state", "challenge", "created_at", "approved_at", "revoked_at")}
