"""Exception hierarchy for the compaction module.

The errors are intentionally small and granular so callers can react to
specific failure modes (bad configuration, path safety violations, etc.)
without parsing string messages.
"""

from __future__ import annotations


class CompactionError(RuntimeError):
    """Base class for any error raised by the compaction module."""


class InvalidPolicyError(CompactionError, ValueError):
    """Raised when a :class:`~core.compaction.models.CompactionPolicy` is malformed.

    Examples: zero ``keep_recent``, negative thresholds, conflicting
    size+count constraints that would always trigger.
    """


class PathSafetyError(CompactionError, ValueError):
    """Raised when a compaction operation would escape the project root.

    The compactor refuses to write to absolute paths, ``..`` segments
    that resolve outside the project root, or symlinks that point at
    locations the operator did not approve.
    """


class SchedulerError(CompactionError):
    """Raised by :class:`~core.compaction.scheduler.CompactionScheduler`."""

    def __init__(self, message: str, *, mode: str | None = None) -> None:
        super().__init__(message)
        self.mode = mode
