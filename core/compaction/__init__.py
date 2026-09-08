"""Automatic context compaction for abaco-deep-core.

This package provides reversible, deterministic compaction for:

* Event ledgers (JSONL append-only files)
* Ticket ledgers (closed/cancelled/archived tickets)
* Chat sessions (sliding window + incremental summaries)

All compactors:

* Move data to a timestamped archive file (no deletion of originals)
* Leave only ``keep_recent`` records in the active ledger
* Emit ``system.compaction.{started,completed,failed}`` events through
  ``abaco_core.events.envelope``
* Read their thresholds from :class:`~core.compaction.models.CompactionPolicy`
  instances (no hard-coded magic numbers in business code)

The package is designed to run inside the ``abaco-deep-core`` checkout,
which sits next to the ``abaco_core`` Python package.  When this module
is imported, it makes sure the parent directory containing ``abaco_core``
is on ``sys.path`` so that ``from abaco_core.events.envelope import ...``
resolves correctly even when the package is used as a drop-in folder.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _ensure_abaco_core_importable() -> None:
    """Make sure ``abaco_core`` is importable.

    The compaction module lives at ``<root>/core/compaction`` where
    ``<root>`` is the ``abaco-deep-core`` checkout.  ``abaco_core`` is a
    sibling package, one directory up.  When the module is loaded from
    an editable install or a test runner that does not know about the
    sibling, this hook inserts the sibling into :data:`sys.path`.
    """

    if "abaco_core" in sys.modules:
        return

    here = Path(__file__).resolve()
    for ancestor in here.parents:
        candidate = ancestor / "abaco_core" / "__init__.py"
        if candidate.is_file():
            ancestor_str = str(ancestor)
            if ancestor_str not in sys.path:
                sys.path.insert(0, ancestor_str)
            return

    # As a last resort, fall back to the environment variable
    # ``ABACO_CORE_PARENT`` so an operator can point at the right
    # directory without modifying the source tree.
    fallback = os.environ.get("ABACO_CORE_PARENT")
    if fallback and fallback not in sys.path:
        sys.path.insert(0, fallback)


_ensure_abaco_core_importable()

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
