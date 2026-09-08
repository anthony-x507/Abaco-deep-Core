"""Retention rules used by the compactor.

The retention layer is the single source of truth for "is this record
old enough to be archived?".  Both :class:`LedgerCompactor` and
:class:`TicketCompactor` delegate the actual decision to
:func:`decide_retention`, which keeps the policy logic testable in
isolation and prevents drift between the two compactors.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import CompactionPolicy, TicketArchivalRule


@dataclass(frozen=True)
class RetentionDecision:
    """Outcome of evaluating a retention policy on a single record."""

    record_index: int
    keep: bool
    reason: str


def _parse_timestamp(value: str) -> datetime | None:
    """Parse an ISO-8601 timestamp in a forgiving way.

    Returns ``None`` if the value cannot be parsed.  Callers treat
    ``None`` as "epoch 0" so old records always get archived.
    """

    if not value:
        return None
    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


def decide_retention(
    records: Iterable[dict[str, object]],
    policy: CompactionPolicy,
    *,
    now: datetime | None = None,
    timestamp_key: str = "occurred_at",
) -> list[RetentionDecision]:
    """Decide which records stay in the ledger and which are archived.

    The decision is based on the *order* of the input iterable, not on
    the ``timestamp_key`` value, because JSONL files are append-only and
    earlier lines are older.  ``timestamp_key`` is only consulted to
    determine *age* for ``max_age_days`` thresholds.
    """

    if policy.keep_recent < 0:
        raise InvalidPolicyError("keep_recent must be >= 0")

    record_list = list(records)
    total = len(record_list)
    keep_window_start = max(0, total - policy.keep_recent)

    current = now or datetime.now(timezone.utc)
    decisions: list[RetentionDecision] = []

    for index, record in enumerate(record_list):
        # Always respect the sliding window: the last ``keep_recent``
        # records stay regardless of any other threshold.
        if index >= keep_window_start:
            decisions.append(
                RetentionDecision(index, True, "within keep_recent window")
            )
            continue

        if policy.max_age_days is not None:
            ts_value = str(record.get(timestamp_key, ""))
            parsed = _parse_timestamp(ts_value)
            if parsed is None:
                # Unknown timestamps are treated as ancient so old data is
                # archived first.  This protects the operator from
                # accidental retention of malformed records.
                decisions.append(
                    RetentionDecision(index, False, "unparseable timestamp")
                )
                continue
            normalized = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
            age_days = (current - normalized).total_seconds() / 86400.0
            if age_days >= policy.max_age_days:
                decisions.append(
                    RetentionDecision(
                        index,
                        False,
                        f"age {age_days:.1f}d >= {policy.max_age_days}d",
                    )
                )
                continue

        decisions.append(
            RetentionDecision(index, False, "outside keep_recent window")
        )

    return decisions


def apply_retention(
    records: Iterable[dict[str, object]],
    decisions: Iterable[RetentionDecision],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Split records into (kept, archived) using the given decisions."""

    record_list = list(records)
    decision_list = list(decisions)
    if len(record_list) != len(decision_list):
        raise InvalidPolicyError(
            "decisions count does not match records count: "
            f"{len(decision_list)} vs {len(record_list)}"
        )
    kept: list[dict[str, object]] = []
    archived: list[dict[str, object]] = []
    for record, decision in zip(record_list, decision_list):
        if decision.keep:
            kept.append(record)
        else:
            archived.append(record)
    return kept, archived


def decide_ticket_retention(
    tickets: Iterable[dict[str, object]],
    rule: TicketArchivalRule,
    *,
    now: datetime | None = None,
    timestamp_key: str = "updated_at",
    status_key: str = "status",
) -> list[RetentionDecision]:
    """Retention decisions for tickets.

    Only tickets whose ``status`` is in ``rule.closed_statuses`` and
    whose ``updated_at`` is older than ``rule.max_age_days`` are
    archived.
    """

    current = now or datetime.now(timezone.utc)
    tickets_list = list(tickets)
    total = len(tickets_list)
    keep_window_start = max(0, total - rule.keep_recent)
    decisions: list[RetentionDecision] = []

    for index, ticket in enumerate(tickets_list):
        status = str(ticket.get(status_key, ""))
        if index >= keep_window_start:
            decisions.append(
                RetentionDecision(index, True, "within keep_recent window")
            )
            continue
        if status not in rule.closed_statuses:
            decisions.append(
                RetentionDecision(index, True, f"status '{status}' is open")
            )
            continue
        ts_value = str(ticket.get(timestamp_key, ""))
        parsed = _parse_timestamp(ts_value)
        if parsed is None:
            decisions.append(
                RetentionDecision(index, False, "unparseable timestamp")
            )
            continue
        normalized = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        age_days = (current - normalized).total_seconds() / 86400.0
        if age_days >= rule.max_age_days:
            decisions.append(
                RetentionDecision(
                    index,
                    False,
                    f"closed age {age_days:.1f}d >= {rule.max_age_days}d",
                )
            )
        else:
            decisions.append(
                RetentionDecision(index, True, f"closed only {age_days:.1f}d ago")
            )
    return decisions
