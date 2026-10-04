"""Typed READ boundary over the existing academic owners (LL003).

These modules read the owners' published files as bytes and return plain typed dictionaries.
They never import or execute an owner helper, never write, and never treat a successful read as
permission to write. A read that cannot be trusted (mixed bundle, identity mismatch, duplicate
keys) raises :class:`OwnerReadError` with a stable code instead of returning guessed data.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from ..contracts import ContractError, parse_json

MAX_OWNER_FILE_BYTES = 8 * 1024 * 1024
TERM = "2026-fall"


class OwnerReadError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class _UniqueLoader(yaml.SafeLoader):
    """YAML loader that rejects duplicate mapping keys, like the owner's own validator."""


def _construct_mapping(loader: _UniqueLoader, node: yaml.MappingNode, deep: bool = False) -> dict:
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(None, None, f"duplicate key {key!r}", key_node.start_mark)
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def read_owner_bytes(path: Path, *, what: str) -> bytes:
    try:
        if path.is_symlink():
            raise OwnerReadError("unsafe_path", f"{what} is a symlink")
        if path.stat().st_size > MAX_OWNER_FILE_BYTES:
            raise OwnerReadError("too_large", f"{what} exceeds the read limit")
        return path.read_bytes()
    except FileNotFoundError as exc:
        raise OwnerReadError("missing", f"{what} not found") from exc
    except OSError as exc:
        raise OwnerReadError("unreadable", f"{what} cannot be read: {exc}") from exc


def parse_owner_json(data: bytes, *, what: str) -> Any:
    try:
        return parse_json(data.removeprefix(b"\xef\xbb\xbf"), max_bytes=MAX_OWNER_FILE_BYTES)
    except ContractError as exc:
        raise OwnerReadError("invalid_record", f"{what}: {exc}") from exc


def parse_owner_yaml(data: bytes, *, what: str) -> Any:
    try:
        return yaml.load(data.decode("utf-8-sig"), Loader=_UniqueLoader)  # noqa: S506 - SafeLoader subclass
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise OwnerReadError("invalid_record", f"{what}: {exc}") from exc


def require_identity(record: dict, course_id: str, *, what: str, contract: str | None = None) -> None:
    if not isinstance(record, dict):
        raise OwnerReadError("invalid_record", f"{what} is not a mapping")
    if contract is not None and record.get("contract_version") != contract:
        raise OwnerReadError("unsupported_contract", f"{what} has contract {record.get('contract_version')!r}, expected {contract!r}")
    if record.get("course_id") != course_id or record.get("term") != TERM:
        raise OwnerReadError("identity_mismatch", f"{what} belongs to {record.get('course_id')!r}/{record.get('term')!r}, expected {course_id!r}/{TERM!r}")
