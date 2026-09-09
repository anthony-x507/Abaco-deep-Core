"""Deterministic last-writer-wins conflict resolution.

Records are merged by stable key. The record with the newest timestamp wins.
When timestamps are equal the winner is chosen by a deterministic global rule
so that every node in the mesh resolves the tie identically and convergence is
not blocked by each node keeping its own copy:

1. The record carrying the lexicographically greatest authoring node id wins
   (candidate fields: ``node_id``, ``author_node_id``, ``origin_node_id``,
   ``node``; a missing attribution compares as ``""``).
2. If both records carry the same (or no) authoring node id, the record whose
   canonical JSON serialization is lexicographically greatest wins.
"""

import json
from typing import Any, Iterable

Record = dict[str, Any]
Conflict = dict[str, Any]

_AUTHOR_FIELDS = ("node_id", "author_node_id", "origin_node_id", "node")


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


def _authoring_node(record: Record) -> str:
    """Return the node id that authored a record, or ``""`` when unknown."""
    for field in _AUTHOR_FIELDS:
        value = record.get(field)
        if isinstance(value, str) and value:
            return value
    return ""


def _canonical_json(record: Record) -> str:
    """Return a stable, order-independent serialization of a record."""
    return json.dumps(record, sort_keys=True, separators=(",", ":"), default=str)


def _remote_wins_tie(remote: Record, local: Record) -> bool:
    """Return True when ``remote`` beats ``local`` on equal timestamps.

    The comparison is a total order over the two records, so the same winner
    is chosen regardless of which side of the merge each record came from.
    """
    remote_author = _authoring_node(remote)
    local_author = _authoring_node(local)
    if remote_author != local_author:
        return remote_author > local_author
    return _canonical_json(remote) > _canonical_json(local)


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
            continue
        remote_ts = _timestamp(record)
        local_ts = _timestamp(local)
        if remote_ts > local_ts or (remote_ts == local_ts and _remote_wins_tie(record, local)):
            conflicts.append({"key": key, "discarded": local, "kept": record})
            merged[key] = record
        else:
            conflicts.append({"key": key, "discarded": record, "kept": local})
    return list(merged.values()), conflicts
