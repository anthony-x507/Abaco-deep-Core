"""Pre-built :class:`CompactionPolicy` factories.

These helpers construct policies for the three trigger strategies
mentioned in the spec:

* :func:`size_based_policy` - archive when the ledger crosses N bytes/lines.
* :func:`time_based_policy` - archive when records are older than N days.
* :func:`count_based_policy` - archive when the ledger has more than N records.

They are thin constructors that validate their inputs through
:class:`~core.compaction.errors.InvalidPolicyError` so the rest of the
codebase can rely on a policy being well-formed.
"""

from __future__ import annotations

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import CompactionPolicy


def _validate(name: str, keep_recent: int, **thresholds: int | None) -> None:
    """Raise :class:`InvalidPolicyError` if any field is bad."""

    if not name or not name.strip():
        raise InvalidPolicyError("policy name must be a non-empty string")
    if keep_recent < 0:
        raise InvalidPolicyError(f"keep_recent must be >= 0, got {keep_recent}")
    for field_name, value in thresholds.items():
        if value is None:
            continue
        if value <= 0:
            raise InvalidPolicyError(
                f"{field_name} must be a positive integer, got {value!r}"
            )


def size_based_policy(
    name: str,
    *,
    max_bytes: int | None = None,
    max_lines: int | None = None,
    keep_recent: int = 100,
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl",
    source: str = "abaco-deep-core",
) -> CompactionPolicy:
    """Build a size-based compaction policy.

    At least one of ``max_bytes`` or ``max_lines`` must be provided.
    """

    if max_bytes is None and max_lines is None:
        raise InvalidPolicyError(
            "size_based_policy requires max_bytes or max_lines"
        )
    _validate(name, keep_recent, max_bytes=max_bytes, max_lines=max_lines)
    return CompactionPolicy(
        name=name,
        max_bytes=max_bytes,
        max_lines=max_lines,
        keep_recent=keep_recent,
        archive_path_pattern=archive_path_pattern,
        source=source,
    )


def time_based_policy(
    name: str,
    *,
    max_age_days: int,
    keep_recent: int = 100,
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl",
    source: str = "abaco-deep-core",
) -> CompactionPolicy:
    """Build a time-based compaction policy."""

    _validate(name, keep_recent, max_age_days=max_age_days)
    return CompactionPolicy(
        name=name,
        max_age_days=max_age_days,
        keep_recent=keep_recent,
        archive_path_pattern=archive_path_pattern,
        source=source,
    )


def count_based_policy(
    name: str,
    *,
    max_count: int,
    keep_recent: int = 100,
    archive_path_pattern: str = "archive/{ledger}-{date}.jsonl",
    source: str = "abaco-deep-core",
) -> CompactionPolicy:
    """Build a count-based compaction policy."""

    _validate(name, keep_recent, max_count=max_count)
    return CompactionPolicy(
        name=name,
        max_count=max_count,
        keep_recent=keep_recent,
        archive_path_pattern=archive_path_pattern,
        source=source,
    )
