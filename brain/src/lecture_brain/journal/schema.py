"""Table definitions for the local operational journal.

This is queue/receipt state for the supervisor. It is deliberately NOT an academic store: no
attempts, grades, catalogs, concept graphs or gap ledgers live here.
"""
from __future__ import annotations

import sqlalchemy as sa

metadata = sa.MetaData()

admissions = sa.Table(
    "admissions",
    metadata,
    sa.Column("request_id", sa.String(128), primary_key=True),
    sa.Column("manifest_sha256", sa.String(64), nullable=False),
    sa.Column("logical_input_id", sa.String(128), nullable=False),
    sa.Column("device_id", sa.String(128), nullable=False),
    sa.Column("sequence", sa.Integer, nullable=False),
    sa.Column("course_id", sa.String(63), nullable=False),
    sa.Column("term", sa.String(128), nullable=False),
    sa.Column("thread_key", sa.String(128), nullable=False),
    sa.Column("action", sa.String(32), nullable=False),
    sa.Column("depth", sa.String(16), nullable=False),
    sa.Column("parent_request_id", sa.String(128), nullable=True),
    sa.Column("bundle_ref", sa.Text, nullable=False),
    sa.Column("submitted_at", sa.String(40), nullable=False),
    sa.Column("expires_at", sa.String(40), nullable=True),
    sa.Column("admitted_at", sa.Float, nullable=False),
    sa.UniqueConstraint("device_id", "sequence", name="uq_admissions_device_sequence"),
)

jobs = sa.Table(
    "jobs",
    metadata,
    sa.Column("job_id", sa.String(64), primary_key=True),
    sa.Column("request_id", sa.String(128), sa.ForeignKey("admissions.request_id"), nullable=True, unique=True),
    sa.Column("workflow", sa.String(16), nullable=False),
    sa.Column("course_id", sa.String(63), nullable=False),
    sa.Column("thread_key", sa.String(128), nullable=False),
    sa.Column("state", sa.String(32), nullable=False),
    sa.Column("priority", sa.Integer, nullable=False),
    sa.Column("generation", sa.Integer, nullable=False, server_default="1"),
    sa.Column("lease_owner", sa.String(128), nullable=True),
    sa.Column("lease_token", sa.Integer, nullable=False, server_default="0"),
    sa.Column("lease_expires_at", sa.Float, nullable=True),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("next_attempt_at", sa.Float, nullable=True),
    sa.Column("waiting_reason", sa.Text, nullable=True),
    sa.Column("cancel_requested", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("input_digest", sa.String(64), nullable=False),
    sa.Column("detail", sa.Text, nullable=False, server_default="{}"),
    sa.Column("created_at", sa.Float, nullable=False),
    sa.Column("updated_at", sa.Float, nullable=False),
)

dispatches = sa.Table(
    "dispatches",
    metadata,
    sa.Column("dispatch_id", sa.String(128), primary_key=True),
    sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.job_id"), nullable=False),
    sa.Column("generation", sa.Integer, nullable=False),
    sa.Column("adapter", sa.String(64), nullable=False),
    sa.Column("native_thread_id", sa.String(128), nullable=True),
    sa.Column("native_turn_id", sa.String(128), nullable=True),
    sa.Column("state", sa.String(32), nullable=False),
    sa.Column("started_at", sa.Float, nullable=False),
    sa.Column("observed_at", sa.Float, nullable=True),
    sa.Column("result_ref", sa.Text, nullable=True),
    sa.Column("failure_code", sa.String(128), nullable=True),
)

receipts = sa.Table(
    "receipts",
    metadata,
    sa.Column("receipt_id", sa.String(128), primary_key=True),
    sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.job_id"), nullable=True),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("generation", sa.Integer, nullable=True),
    sa.Column("ref", sa.Text, nullable=True),
    sa.Column("sha256", sa.String(64), nullable=True),
    sa.Column("payload", sa.Text, nullable=False, server_default="{}"),
    sa.Column("created_at", sa.Float, nullable=False),
)

events = sa.Table(
    "events",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("job_id", sa.String(64), nullable=True),
    sa.Column("request_id", sa.String(128), nullable=True),
    sa.Column("kind", sa.String(48), nullable=False),
    sa.Column("detail", sa.Text, nullable=False, server_default="{}"),
    sa.Column("at", sa.Float, nullable=False),
)

devices = sa.Table(
    "devices",
    metadata,
    sa.Column("key_id", sa.String(128), primary_key=True),
    sa.Column("device_id", sa.String(128), nullable=False),
    sa.Column("label", sa.String(200), nullable=False),
    sa.Column("public_key_spki", sa.Text, nullable=False),
    sa.Column("fingerprint", sa.String(64), nullable=False),
    sa.Column("courses", sa.Text, nullable=False, server_default="[]"),
    sa.Column("actions", sa.Text, nullable=False, server_default="[]"),
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("challenge", sa.String(128), nullable=True),
    sa.Column("created_at", sa.Float, nullable=False),
    sa.Column("approved_at", sa.Float, nullable=True),
    sa.Column("revoked_at", sa.Float, nullable=True),
)

kv = sa.Table(
    "kv",
    metadata,
    sa.Column("key", sa.String(128), primary_key=True),
    sa.Column("value", sa.Text, nullable=False),
    sa.Column("updated_at", sa.Float, nullable=False),
)
