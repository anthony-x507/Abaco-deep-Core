"""Deterministic summary generation for compacted data.

The summariser never calls an external LLM.  It extracts a stable
textual digest from structured records so that:

* the same input always produces the same output (regression-safe),
* the cost of summarisation is bounded,
* tests do not depend on network calls or random tokens.

For ledgers the summary contains:

* record count and byte size,
* top event types,
* first / last timestamps,
* correlation IDs seen,
* key error markers.

For chat sessions the summary contains:

* number of summarised turns,
* role distribution,
* top "tools" referenced (heuristically detected via ``tool:`` or
  ``function_call`` markers),
* notable error strings.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Mapping


_ERROR_HINTS: tuple[str, ...] = (
    "error",
    "exception",
    "failed",
    "timeout",
    "traceback",
    "panic",
    "denied",
    "abort",
)


@dataclass(frozen=True)
class SummaryStats:
    """Aggregate stats computed from a set of records."""

    record_count: int
    byte_size: int
    top_types: tuple[tuple[str, int], ...]
    error_count: int
    first_timestamp: str = ""
    last_timestamp: str = ""
    correlation_ids: tuple[str, ...] = ()
    extras: Mapping[str, object] = field(default_factory=dict)


class SummaryGenerator:
    """Generate deterministic summaries.

    The class is intentionally stateless so it can be shared by every
    compactor.  Operators can pass a different ``top_n`` to control how
    many categories the summary includes.
    """

    def __init__(self, *, top_n: int = 5) -> None:
        if top_n <= 0:
            raise ValueError("top_n must be a positive integer")
        self.top_n = top_n

    # ------------------------------------------------------------------
    # Generic helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_event_type(record: Mapping[str, object]) -> str:
        return str(record.get("event_type") or record.get("type") or "<unknown>")

    @staticmethod
    def _extract_timestamp(record: Mapping[str, object]) -> str:
        return str(record.get("occurred_at") or record.get("timestamp") or "")

    @staticmethod
    def _stringify_payload(record: Mapping[str, object]) -> str:
        payload = record.get("payload")
        if payload is None:
            return ""
        if isinstance(payload, str):
            return payload
        if isinstance(payload, Mapping):
            parts: list[str] = []
            for key, value in payload.items():
                parts.append(f"{key}={value}")
            return " ".join(parts)
        return str(payload)

    def _is_error(self, record: Mapping[str, object]) -> bool:
        haystack = " ".join(
            [
                self._extract_event_type(record),
                self._stringify_payload(record),
            ]
        ).lower()
        return any(hint in haystack for hint in _ERROR_HINTS)

    # ------------------------------------------------------------------
    # Ledger summary
    # ------------------------------------------------------------------

    def summarize_ledger(
        self,
        records: Iterable[Mapping[str, object]],
        *,
        ledger_name: str,
    ) -> tuple[str, SummaryStats]:
        """Produce a (text, stats) summary of archived ledger records."""

        record_list = list(records)
        type_counter: Counter[str] = Counter()
        error_count = 0
        first_ts = ""
        last_ts = ""
        correlation_ids: list[str] = []
        byte_size = 0

        for record in record_list:
            type_counter[self._extract_event_type(record)] += 1
            if self._is_error(record):
                error_count += 1
            ts = self._extract_timestamp(record)
            if ts:
                if not first_ts:
                    first_ts = ts
                last_ts = ts
            cid = record.get("correlation_id")
            if not cid and isinstance(record.get("payload"), Mapping):
                cid = record["payload"].get("correlation_id")  # type: ignore[union-attr]
            if cid:
                correlation_ids.append(str(cid))
            # Approximate the byte size using the JSON-serialised form.
            # The caller already pays this cost on disk, so reusing it
            # here avoids re-encoding.
            try:
                import json

                byte_size += len(json.dumps(dict(record), default=str))
            except (TypeError, ValueError):
                byte_size += len(self._stringify_payload(record))

        top_types = tuple(type_counter.most_common(self.top_n))
        stats = SummaryStats(
            record_count=len(record_list),
            byte_size=byte_size,
            top_types=top_types,
            error_count=error_count,
            first_timestamp=first_ts,
            last_timestamp=last_ts,
            correlation_ids=tuple(dict.fromkeys(correlation_ids)),
        )

        lines: list[str] = []
        lines.append(f"# Compaction summary for ledger '{ledger_name}'")
        lines.append(f"records archived: {stats.record_count}")
        lines.append(f"approx bytes: {stats.byte_size}")
        if stats.first_timestamp or stats.last_timestamp:
            lines.append(f"window: {stats.first_timestamp or '?'} -> {stats.last_timestamp or '?'}")
        if top_types:
            rendered = ", ".join(f"{name}={count}" for name, count in top_types)
            lines.append(f"top event types: {rendered}")
        if stats.correlation_ids:
            preview = ", ".join(stats.correlation_ids[: self.top_n])
            lines.append(f"correlations: {preview}")
        if error_count:
            lines.append(f"errors detected: {error_count}")

        return "\n".join(lines), stats

    # ------------------------------------------------------------------
    # Session summary
    # ------------------------------------------------------------------

    def summarize_session(
        self,
        turns: Iterable[object],
        *,
        session_name: str,
    ) -> str:
        """Summarise a list of :class:`SessionTurn`-like objects."""

        turn_list = list(turns)
        role_counter: Counter[str] = Counter()
        tool_counter: Counter[str] = Counter()
        error_counter: Counter[str] = Counter()
        first_at = ""
        last_at = ""

        tool_pattern = re.compile(r"\b(?:tool|tool_call|function_call)[:=]\s*([a-zA-Z0-9_\.\-]+)")
        for turn in turn_list:
            role = getattr(turn, "role", "<unknown>")
            content = getattr(turn, "content", "")
            role_counter[str(role)] += 1
            for match in tool_pattern.finditer(str(content)):
                tool_counter[match.group(1)] += 1
            lowered = str(content).lower()
            if any(hint in lowered for hint in _ERROR_HINTS):
                # Extract the first error sentence as a hint.
                sentence_match = re.search(
                    r"([^.\n]*?(?:"
                    + "|".join(_ERROR_HINTS)
                    + r")[^.\n]*\.)",
                    str(content),
                    flags=re.IGNORECASE,
                )
                snippet = sentence_match.group(1).strip() if sentence_match else "error"
                error_counter[snippet[:80]] += 1
            occurred = getattr(turn, "occurred_at", "")
            if occurred:
                if not first_at:
                    first_at = str(occurred)
                last_at = str(occurred)

        lines: list[str] = []
        lines.append(f"# Session '{session_name}' compaction summary")
        lines.append(f"turns summarised: {len(turn_list)}")
        if first_at or last_at:
            lines.append(f"window: {first_at or '?'} -> {last_at or '?'}")
        if role_counter:
            rendered = ", ".join(
                f"{role}={count}" for role, count in role_counter.most_common(self.top_n)
            )
            lines.append(f"roles: {rendered}")
        if tool_counter:
            rendered = ", ".join(
                f"{tool}={count}" for tool, count in tool_counter.most_common(self.top_n)
            )
            lines.append(f"top tools: {rendered}")
        if error_counter:
            rendered = "; ".join(
                f"{snippet} (x{count})"
                for snippet, count in error_counter.most_common(self.top_n)
            )
            lines.append(f"errors: {rendered}")
        return "\n".join(lines)


def generate_session_summary(turns: Iterable[object], *, session_name: str) -> str:
    """Functional shortcut for :meth:`SummaryGenerator.summarize_session`."""

    return SummaryGenerator().summarize_session(turns, session_name=session_name)
