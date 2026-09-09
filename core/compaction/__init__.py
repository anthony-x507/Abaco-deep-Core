"""Automatic context compaction for abaco-deep-core.

This package provides reversible, deterministic compaction for:

* Event ledgers (JSONL append-only files)
* Ticket ledgers (closed/cancelled/archived tickets)
* Chat sessions (sliding window + incremental summaries)

All compactors:

* Move data to a timestamped archive file (no deletion of originals)
* Leave only ``keep_recent`` records in the active ledger
* Emit ``system.compaction.{started,completed,failed}`` events through
  ``core.events.envelope`` (the in-repo mirror of the
  ``abaco_core.events.envelope`` contract)
* Read their thresholds from :class:`~core.compaction.models.CompactionPolicy`
  instances (no hard-coded magic numbers in business code)

The package is self-contained: it imports only from ``core.*`` and the
Python standard library, so a plain checkout of ``abaco-deep-core`` works
without the sibling ``abaco_core`` Python package on ``sys.path``.
"""

from __future__ import annotations

# Re-export the public API so that ``from core.compaction import X`` works.
from core.compaction.errors import (
    CompactionError,
    InvalidPolicyError,
    PathSafetyError,
    SchedulerError,
)
from core.compaction.events import emit_compaction_completed, emit_compaction_failed, emit_compaction_started
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import (
    CompactionPolicy,
    CompactionResult,
    CompactionTrigger,
    SessionTurn,
    SessionWindowSummary,
    TicketArchivalRule,
)
from core.compaction.policies import (
    count_based_policy,
    size_based_policy,
    time_based_policy,
)
from core.compaction.retention import (
    RetentionDecision,
    apply_retention,
    decide_retention,
)
from core.compaction.scheduler import CompactionScheduler
from core.compaction.session_compactor import SessionCompactor
from core.compaction.summary_generator import SummaryGenerator, generate_session_summary
from core.compaction.ticket_compactor import TicketCompactor


__all__ = [
    "CompactionError",
    "CompactionPolicy",
    "CompactionResult",
    "CompactionScheduler",
    "CompactionTrigger",
    "InvalidPolicyError",
    "LedgerCompactor",
    "PathSafetyError",
    "RetentionDecision",
    "SchedulerError",
    "SessionCompactor",
    "SessionTurn",
    "SessionWindowSummary",
    "SummaryGenerator",
    "TicketArchivalRule",
    "TicketCompactor",
    "apply_retention",
    "count_based_policy",
    "decide_retention",
    "emit_compaction_completed",
    "emit_compaction_failed",
    "emit_compaction_started",
    "generate_session_summary",
    "size_based_policy",
    "time_based_policy",
]
