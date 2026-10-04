"""Small filesystem primitives: exclusive (no-clobber) publication and durable replace."""
from __future__ import annotations

from pathlib import Path
import os
import uuid


class ExclusiveConflict(FileExistsError):
    """The destination already exists with different bytes."""


def _write_temp(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".tmp-{uuid.uuid4().hex[:16]}")  # short: deep course paths approach MAX_PATH on Windows
    with open(tmp, "xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    return tmp


def publish_exclusive(path: Path, data: bytes) -> str:
    """Create ``path`` with ``data`` only if it does not exist. Never overwrites, never truncates.

    Returns ``"created"`` or ``"identical"`` (same bytes already there → idempotent retry).
    Raises :class:`ExclusiveConflict` when different bytes are present. The file appears complete or
    not at all: bytes are written to a temporary sibling first, then linked/renamed into place.
    """
    if path.exists():
        if path.read_bytes() == data:
            return "identical"
        raise ExclusiveConflict(f"{path.name} already exists with different bytes")
    tmp = _write_temp(path, data)
    try:
        if os.name == "nt":
            os.rename(tmp, path)  # fails with FileExistsError when the destination exists
        else:
            os.link(tmp, path)
    except FileExistsError:
        if path.read_bytes() == data:
            return "identical"
        raise ExclusiveConflict(f"{path.name} already exists with different bytes") from None
    finally:
        if tmp.exists():
            tmp.unlink()
    if path.read_bytes() != data:  # read back exact bytes
        raise OSError(f"Readback mismatch after writing {path}")
    return "created"


def replace_atomic(path: Path, data: bytes) -> None:
    """Durably replace a *derived/operational* file (views, state). Never used for evidence."""
    tmp = _write_temp(path, data)
    try:
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
