"""Audit events emitted by the compaction module.

The compactors emit three event types using
:func:`core.events.envelope.create_event` (the in-repo mirror of the
``abaco_core.events.envelope`` contract):

* ``system.compaction.started``
* ``system.compaction.completed``
* ``system.compaction.failed``

The emitter accepts an optional *ledger* so callers can route the event
through any object exposing an ``append(event)`` method (e.g. the
``abaco_core.events.ledger.AppendOnlyEventLedger`` when running embedded
next to the full ABACO Python Core package) or have it returned as a
plain envelope for tests.
"""

from __future__ import annotations

from typing import Any

from core.compaction.models import CompactionResult
from core.events.envelope import create_event


def _build_payload(
    *,
    policy_name: str,
    ledger_name: str,
    trigger_kind: str,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "policy_name": policy_name,
        "ledger_name": ledger_name,
        "trigger": trigger_kind,
    }
    if extras:
        payload.update(extras)
    return payload


def emit_compaction_started(
    *,
    policy_name: str,
    ledger_name: str,
    trigger_kind: str,
    source: str,
    correlation_id: str | None = None,
    extras: dict[str, Any] | None = None,
    ledger: object | None = None,
) -> Any:
    """Emit ``system.compaction.started``.

    Parameters:
        policy_name: Name of the active :class:`CompactionPolicy`.
        ledger_name: Logical ledger name (used as ``subject_id``).
        trigger_kind: One of ``"size"``, ``"lines"``, ``"age"``,
            ``"count"``, ``"manual"`` or ``"interval"``.
        source: Value forwarded to ``EventEnvelope.source``.
        correlation_id: Optional correlation id propagated from the
            trigger (e.g. an API request).
        extras: Additional keys merged into the payload.
        ledger: Optional object exposing an ``append(event)`` method
            (e.g. an ``abaco_core.events.ledger.AppendOnlyEventLedger``
            when running embedded).  When provided the event is
            appended; otherwise the envelope is returned so the caller
            can handle it.
    """

    payload = _build_payload(
        policy_name=policy_name,
        ledger_name=ledger_name,
        trigger_kind=trigger_kind,
        extras=extras,
    )
    event = create_event(
        "system.compaction.started",
        source=source,
        actor_type="system",
        subject_type="compaction",
        subject_id=ledger_name,
        payload=payload,
        correlation_id=correlation_id,
        tags=("compaction", trigger_kind),
    )
    if ledger is not None and hasattr(ledger, "append"):
        ledger.append(event)
    return event


def emit_compaction_completed(
    result: CompactionResult,
    *,
    source: str,
    correlation_id: str | None = None,
    extras: dict[str, Any] | None = None,
    ledger: object | None = None,
) -> Any:
    """Emit ``system.compaction.completed``."""

    payload = _build_payload(
        policy_name=result.policy_name,
        ledger_name=result.ledger_name,
        trigger_kind="manual",
        extras={
            "records_archived": result.records_archived,
            "records_kept": result.records_kept,
            "bytes_before": result.bytes_before,
            "bytes_after": result.bytes_after,
            "archive_path": result.archive_path,
            "started_at": result.started_at,
            "finished_at": result.finished_at,
        },
    )
    if extras:
        payload.update(extras)
    event = create_event(
        "system.compaction.completed",
        source=source,
        actor_type="system",
        subject_type="compaction",
        subject_id=result.ledger_name,
        payload=payload,
        correlation_id=correlation_id,
        tags=("compaction", "completed"),
    )
    if ledger is not None and hasattr(ledger, "append"):
        ledger.append(event)
    return event


def emit_compaction_failed(
    *,
    policy_name: str,
    ledger_name: str,
    error: BaseException,
    source: str,
    correlation_id: str | None = None,
    extras: dict[str, Any] | None = None,
    ledger: object | None = None,
) -> Any:
    """Emit ``system.compaction.failed``."""

    payload = _build_payload(
        policy_name=policy_name,
        ledger_name=ledger_name,
        trigger_kind="manual",
        extras={
            "error_type": type(error).__name__,
            "error_message": str(error),
        },
    )
    if extras:
        payload.update(extras)
    event = create_event(
        "system.compaction.failed",
        source=source,
        actor_type="system",
        subject_type="compaction",
        subject_id=ledger_name,
        payload=payload,
        correlation_id=correlation_id,
        tags=("compaction", "failed"),
    )
    if ledger is not None and hasattr(ledger, "append"):
        ledger.append(event)
    return event
