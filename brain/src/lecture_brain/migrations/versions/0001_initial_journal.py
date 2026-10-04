"""Initial operational journal: admissions, jobs, dispatches, receipts, events, devices, kv.

Revision ID: 0001_initial
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admissions",
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
    op.create_index("ix_admissions_logical_input", "admissions", ["logical_input_id"])
    op.create_table(
        "jobs",
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
    op.create_index("ix_jobs_state_priority", "jobs", ["state", "priority", "created_at"])
    op.create_index("ix_jobs_thread", "jobs", ["thread_key", "state"])
    op.create_table(
        "dispatches",
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
    op.create_index("ix_dispatches_job", "dispatches", ["job_id"])
    op.create_table(
        "receipts",
        sa.Column("receipt_id", sa.String(128), primary_key=True),
        sa.Column("job_id", sa.String(64), sa.ForeignKey("jobs.job_id"), nullable=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("generation", sa.Integer, nullable=True),
        sa.Column("ref", sa.Text, nullable=True),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column("payload", sa.Text, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.Float, nullable=False),
    )
    op.create_index("ix_receipts_job", "receipts", ["job_id", "kind"])
    op.create_table(
        "events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("kind", sa.String(48), nullable=False),
        sa.Column("detail", sa.Text, nullable=False, server_default="{}"),
        sa.Column("at", sa.Float, nullable=False),
    )
    op.create_index("ix_events_job", "events", ["job_id", "id"])
    op.create_table(
        "devices",
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
    op.create_table(
        "kv",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("updated_at", sa.Float, nullable=False),
    )


def downgrade() -> None:
    for name in ("kv", "devices", "events", "receipts", "dispatches", "jobs", "admissions"):
        op.drop_table(name)
