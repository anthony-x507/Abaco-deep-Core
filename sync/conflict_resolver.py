"""Deterministic last-writer-wins conflict resolution."""

from datetime import datetime, timezone
from typing import Any, Iterable

from .errors import ProtocolError

Record = dict[str, Any]
Conflict = dict[str, Any]


def _timestamp(record: Record) -> str:
    """Extract the supported record timestamp."""
    value = record.get("updated_at") or record.get("occurred_at")
    if not isinstance(value, str):
        return ""
    return value


def _key(record: Record) -> str:
    """Return a stable key for a record."""
    for field in ("id", "uuid", "key", "ticket_id", "event_id", "face_id"):
        if field in record:
            return str(record[field])
    return "|" + "|".join(f"{key}={record[key]}" for key in sorted(record))


def resolve(local_records: Iterable[Record], remote_records: Iterable[Record]) -> tuple[list[Record], list[Conflict]]:
    """Merge records by stable key, retaining the newest timestamp."""
    merged: dict[str, Record] = {}
    conflicts: list[Conflict] = []
    for record in local_records:
        merged[_key(record)] = record
    for record in remote_records:
        key = _key(record)
        local = merged.get(key)
        if local is None:
            merged[key] = record
        elif _timestamp(record) > _timestamp(local):
            conflicts.append({"key": key, "discarded": local, "kept": record})
            merged[key] = record
        else:
            conflicts.append({"key": key, "discarded": record, "kept": local})
    return list(merged.values()), conflicts
