"""Data classes shared across the compaction module.

These dataclasses are intentionally :py:func:`dataclasses.dataclass` with
``frozen=True`` so they are hashable and easy to compare in tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


CompactionMode = Literal["manual", "on_write", "interval"]


@dataclass(frozen=True)
class CompactionPolicy:
    """Configuration for a single compaction run.

    The policy is *declarative*: thresholds can be combined freely.  At
    least one of ``max_bytes``, ``max_lines``, ``max_age_days`` or
    ``max_count`` should be set, otherwise the policy never triggers.

    Attributes:
        name: Human-readable identifier used in audit events.
        max_bytes: Trigger when the ledger exceeds this many bytes.
        max_lines: Trigger when the ledger exceeds this many lines.
        max_age_days: Trigger when the oldest record is older than this.
        max_count: Trigger when the ledger exceeds this many records.
        keep_recent: How many records (or turns) to keep after compaction.
        archive_path_pattern: ``str.format`` template for archive file
            paths.  Must contain ``{ledger}`` and ``{date}`` placeholders.
        source: Logical source label (defaults to ``abaco-deep-core``).
    """

    name: str
    max_bytes: int | None = None
    max_lines: int | None = None
    max_age_days: int | None = None
    max_count: int | None = None
    keep_recent: int = 100
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl"
    source: str = "abaco-deep-core"


@dataclass(frozen=True)
class CompactionResult:
    """Outcome of a compaction run.

    Returned by :class:`LedgerCompactor.compact`,
    :class:`TicketCompactor.compact` and indirectly by the session
    compactor.  All fields are required so downstream code can rely on
    them being present.
    """

    policy_name: str
    ledger_name: str
    records_archived: int
    records_kept: int
    bytes_before: int
    bytes_after: int
    summary: str
    started_at: str
    finished_at: str
    archive_path: str


@dataclass(frozen=True)
class CompactionTrigger:
    """Reason why a compaction was triggered.

    Used by the scheduler and emitted in ``system.compaction.started``
    events so operators can correlate runs with their cause.
    """

    kind: Literal["size", "lines", "age", "count", "manual", "interval"]
    threshold: int | None = None
    measured: int | None = None
    note: str = ""


@dataclass(frozen=True)
class TicketArchivalRule:
    """Defines which tickets get archived.

    A ticket is archived when its status is in ``closed_statuses`` and
    its ``updated_at`` is older than ``max_age_days``.
    """

    name: str
    closed_statuses: tuple[str, ...] = ("closed", "cancelled", "archived", "completed", "failed")
    max_age_days: int = 30
    keep_recent: int = 50
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl"


@dataclass(frozen=True)
class SessionTurn:
    """A single turn of a chat session.

    The compactor only cares about the textual content for summarisation,
    but ``metadata`` is forwarded verbatim into the summary when present
    so callers can include things like token counts or tool calls.
    """

    index: int
    role: str
    content: str
    occurred_at: str = ""
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionWindowSummary:
    """The output of a session compaction."""

    kept_turns: tuple[SessionTurn, ...]
    summary_text: str
    summarized_turn_count: int
    kept_turn_count: int
    original_turn_count: int
    token_estimate_before: int
    token_estimate_after: int
