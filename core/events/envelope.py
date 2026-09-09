"""Event envelope contract for ABACO Deep Core.

This is the in-repo mirror of ``abaco_core.events.envelope`` (ABACO Python
Core).  It is kept dependency-free and identical in behaviour so that
``abaco-deep-core`` emits byte-for-byte compatible envelopes from an
isolated checkout, without requiring the sibling ``abaco_core`` package.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


EVENT_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
SECRET_KEY_MARKERS = ("token", "secret", "api_key", "apikey", "password", "credential")
SECRET_VALUE_MARKERS = ("sk-", "xoxb-", "ghp_", "AIza")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class EventEnvelope:
    event_id: str
    event_type: str
    version: int
    occurred_at: str
    source: str
    actor_type: str
    actor_id: str | None
    subject_type: str
    subject_id: str
    payload: dict[str, Any]
    tenant_id: str | None = None
    correlation_id: str | None = None
    causation_id: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        return data

    def to_json_line(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")) + "\n"


@dataclass(frozen=True)
class EventValidationResult:
    ok: bool
    errors: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {"ok": self.ok, "errors": list(self.errors)}


def create_event(
    event_type: str,
    *,
    source: str,
    actor_type: str,
    subject_type: str,
    subject_id: str,
    payload: dict[str, Any] | None = None,
    actor_id: str | None = None,
    tenant_id: str | None = None,
    correlation_id: str | None = None,
    causation_id: str | None = None,
    tags: tuple[str, ...] = (),
) -> EventEnvelope:
    return EventEnvelope(
        event_id=str(uuid4()),
        event_type=event_type,
        version=1,
        occurred_at=utc_now_iso(),
        source=source,
        actor_type=actor_type,
        actor_id=actor_id,
        tenant_id=tenant_id,
        correlation_id=correlation_id,
        causation_id=causation_id,
        subject_type=subject_type,
        subject_id=subject_id,
        payload=payload or {},
        tags=tuple(tags),
    )


def event_from_dict(data: dict[str, Any]) -> EventEnvelope:
    tags = data.get("tags", ())
    return EventEnvelope(
        event_id=str(data["event_id"]),
        event_type=str(data["event_type"]),
        version=int(data["version"]),
        occurred_at=str(data["occurred_at"]),
        source=str(data["source"]),
        actor_type=str(data["actor_type"]),
        actor_id=data.get("actor_id"),
        tenant_id=data.get("tenant_id"),
        correlation_id=data.get("correlation_id"),
        causation_id=data.get("causation_id"),
        subject_type=str(data["subject_type"]),
        subject_id=str(data["subject_id"]),
        payload=dict(data.get("payload") or {}),
        tags=tuple(str(item) for item in tags),
    )


def _secret_marker_found(value: Any) -> bool:
    if isinstance(value, dict):
        for key, nested in value.items():
            key_clean = str(key).lower()
            if any(marker in key_clean for marker in SECRET_KEY_MARKERS):
                return True
            if _secret_marker_found(nested):
                return True
    elif isinstance(value, list | tuple):
        return any(_secret_marker_found(item) for item in value)
    elif isinstance(value, str):
        return any(marker in value for marker in SECRET_VALUE_MARKERS)
    return False


def validate_event(event: EventEnvelope) -> EventValidationResult:
    errors: list[str] = []
    if not event.event_id:
        errors.append("event_id is required")
    if not EVENT_TYPE_PATTERN.match(event.event_type):
        errors.append(f"event_type is invalid: {event.event_type}")
    if event.version != 1:
        errors.append("version must be 1")
    if not event.occurred_at.endswith("Z"):
        errors.append("occurred_at must be UTC ISO ending in Z")
    if not event.source:
        errors.append("source is required")
    if not event.actor_type:
        errors.append("actor_type is required")
    if not event.subject_type:
        errors.append("subject_type is required")
    if not event.subject_id:
        errors.append("subject_id is required")
    try:
        json.dumps(event.payload)
    except TypeError as exc:
        errors.append(f"payload is not JSON serializable: {exc}")
    if _secret_marker_found(event.payload):
        errors.append("payload contains secret marker")
    return EventValidationResult(ok=not errors, errors=tuple(errors))
