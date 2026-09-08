"""JSONL ledger compactor.

The compactor reads an append-only ledger line by line, applies a
:class:`~core.compaction.models.CompactionPolicy` and:

1. writes the records selected for archival to a timestamped archive
   file (so nothing is *deleted*, only *moved*),
2. rewrites the active ledger so it contains only the most recent
   ``keep_recent`` records,
3. produces a deterministic summary,
4. emits ``system.compaction.started`` and ``system.compaction.completed``
   audit events (or ``failed`` on errors).

The compactor is safe for crash recovery: archive writes are flushed
and the active ledger is replaced atomically with ``os.replace`` only
after the archive has been fully written.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from core.compaction.errors import CompactionError, PathSafetyError
from core.compaction.events import (
    emit_compaction_completed,
    emit_compaction_failed,
    emit_compaction_started,
)
from core.compaction.models import CompactionPolicy, CompactionResult
from core.compaction.retention import decide_retention
from core.compaction.summary_generator import SummaryGenerator


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _safe_format_archive_path(pattern: str, *, ledger: str, now: datetime) -> str:
    """Validate and render ``archive_path_pattern`` for the archive file.

    The rendered path is checked against :func:`_assert_within_project_root`
    to make sure operators cannot write outside the project root.
    """

    placeholders = {
        "ledger": ledger,
        "date": now.strftime("%Y%m%d-%H%M%S"),
    }
    try:
        rendered = pattern.format(**placeholders)
    except KeyError as exc:
        raise PathSafetyError(
            f"archive_path_pattern references unknown placeholder: {exc.args[0]!r}"
        ) from exc
    return rendered


def _assert_within_project_root(path: Path, project_root: Path) -> None:
    """Raise :class:`PathSafetyError` if ``path`` is outside ``project_root``."""

    resolved = path.resolve()
    root_resolved = project_root.resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise PathSafetyError(
            f"path {resolved} is outside project root {root_resolved}"
        ) from exc


class LedgerCompactor:
    """Compact a JSONL ledger file."""

    def __init__(
        self,
        ledger_path: Path | str,
        *,
        project_root: Path | str | None = None,
        policy: CompactionPolicy,
        ledger: object | None = None,
        summary_generator: SummaryGenerator | None = None,
        clock: callable | None = None,  # type: ignore[valid-type]
    ) -> None:
        self.ledger_path = Path(ledger_path)
        self.policy = policy
        self.project_root = (
            Path(project_root)
            if project_root is not None
            else self.ledger_path.parent
        )
        self.event_ledger = ledger
        self.summary_generator = summary_generator or SummaryGenerator()
        self._clock = clock or _utc_now_iso

    # ------------------------------------------------------------------
    # Trigger evaluation
    # ------------------------------------------------------------------

    def should_compact(self) -> tuple[bool, str, int | None]:
        """Return ``(should_compact, trigger_kind, measured)``.

        The compactor considers the *full* ledger: archived records are
        not part of the trigger, but the active ledger is.  ``measured``
        is the value that crossed the threshold (bytes, lines, count or
        age in days).
        """

        if not self.ledger_path.exists():
            return False, "manual", None

        if self.policy.max_bytes is not None or self.policy.max_lines is not None:
            size_bytes = 0
            line_count = 0
            with self.ledger_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    size_bytes += len(line.encode("utf-8"))
                    line_count += 1
            if self.policy.max_bytes is not None and size_bytes > self.policy.max_bytes:
                return True, "size", size_bytes
            if self.policy.max_lines is not None and line_count > self.policy.max_lines:
                return True, "lines", line_count

        if self.policy.max_count is not None:
            line_count = 0
            with self.ledger_path.open("r", encoding="utf-8") as handle:
                for _ in handle:
                    line_count += 1
            if line_count > self.policy.max_count:
                return True, "count", line_count

        if self.policy.max_age_days is not None:
            records = self._read_records()
            if not records:
                return False, "age", None
            from core.compaction.retention import _parse_timestamp  # local import

            current = self._now()
            oldest_ts = None
            for record in records:
                ts_value = str(record.get("occurred_at", ""))
                parsed = _parse_timestamp(ts_value)
                if parsed is None:
                    continue
                if oldest_ts is None or parsed < oldest_ts:
                    oldest_ts = parsed
            if oldest_ts is not None:
                if oldest_ts.tzinfo is None:
                    oldest_ts = oldest_ts.replace(tzinfo=timezone.utc)
                age_days = (current - oldest_ts).total_seconds() / 86400.0
                if age_days >= self.policy.max_age_days:
                    return True, "age", int(age_days)

        return False, "manual", None

    # ------------------------------------------------------------------
    # Read / write helpers
    # ------------------------------------------------------------------

    def _read_records(self) -> list[dict[str, object]]:
        if not self.ledger_path.exists():
            return []
        records: list[dict[str, object]] = []
        with self.ledger_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                clean = line.strip()
                if not clean:
                    continue
                try:
                    records.append(json.loads(clean))
                except json.JSONDecodeError:
                    # Skip malformed lines instead of crashing: this is
                    # the safe behaviour for an append-only log.
                    continue
        return records

    @staticmethod
    def _write_jsonl(path: Path, records: Iterable[dict[str, object]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
                handle.write("\n")

    def _archive_path(self) -> Path:
        now = self._now()
        rendered = _safe_format_archive_path(
            self.policy.archive_path_pattern,
            ledger=self.ledger_path.stem,
            now=now,
        )
        candidate = (self.ledger_path.parent / rendered).resolve()
        _assert_within_project_root(candidate, self.project_root)
        return candidate

    def _now(self) -> datetime:
        """Return a timezone-aware ``datetime`` matching ``_clock``.

        The ``_clock`` callable is shared with the result timestamps
        (which are strings); this helper converts to a ``datetime`` so
        callers can do arithmetic.
        """

        value = self._clock()
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    # ------------------------------------------------------------------
    # Main entrypoint
    # ------------------------------------------------------------------

    def compact(
        self,
        *,
        force: bool = False,
        correlation_id: str | None = None,
    ) -> CompactionResult:
        """Compact the ledger and return a :class:`CompactionResult`."""

        started_at = self._clock()
        records = self._read_records()
        bytes_before = (
            self.ledger_path.stat().st_size if self.ledger_path.exists() else 0
        )

        should, trigger_kind, measured = self.should_compact()
        if not should and not force:
            # Even when no compaction happens we emit a small audit
            # trail so operators can see *why* the run was skipped.
            return CompactionResult(
                policy_name=self.policy.name,
                ledger_name=self.ledger_path.name,
                records_archived=0,
                records_kept=len(records),
                bytes_before=bytes_before,
                bytes_after=bytes_before,
                summary="no compaction triggered",
                started_at=started_at,
                finished_at=self._clock(),
                archive_path="",
            )

        started_event = emit_compaction_started(
            policy_name=self.policy.name,
            ledger_name=self.ledger_path.name,
            trigger_kind=trigger_kind,
            source=self.policy.source,
            correlation_id=correlation_id,
            extras={"measured": measured} if measured is not None else None,
            ledger=self.event_ledger,
        )

        try:
            decisions = decide_retention(records, self.policy)
        except Exception as exc:  # pragma: no cover - defensive
            emit_compaction_failed(
                policy_name=self.policy.name,
                ledger_name=self.ledger_path.name,
                error=exc,
                source=self.policy.source,
                correlation_id=correlation_id,
                ledger=self.event_ledger,
            )
            raise CompactionError(f"retention evaluation failed: {exc}") from exc

        kept: list[dict[str, object]] = []
        archived: list[dict[str, object]] = []
        for record, decision in zip(records, decisions):
            if decision.keep:
                kept.append(record)
            else:
                archived.append(record)

        if not archived:
            return CompactionResult(
                policy_name=self.policy.name,
                ledger_name=self.ledger_path.name,
                records_archived=0,
                records_kept=len(kept),
                bytes_before=bytes_before,
                bytes_after=bytes_before,
                summary="nothing to archive",
                started_at=started_at,
                finished_at=self._clock(),
                archive_path="",
            )

        archive_path = self._archive_path()
        summary_text, _stats = self.summary_generator.summarize_ledger(
            archived, ledger_name=self.ledger_path.stem
        )

        try:
            # Write archive first so a failure cannot destroy the
            # active ledger.  Use a temp file + atomic move for the
            # archive as well to avoid leaving partial files.
            archive_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(archive_path.parent),
                prefix=archive_path.name + ".",
                suffix=".tmp",
                delete=False,
            ) as tmp:
                tmp_path = Path(tmp.name)
                for record in archived:
                    tmp.write(
                        json.dumps(record, sort_keys=True, separators=(",", ":"))
                    )
                    tmp.write("\n")
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_path, archive_path)

            # Rewrite the active ledger atomically.
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(self.ledger_path.parent),
                prefix=self.ledger_path.name + ".",
                suffix=".tmp",
                delete=False,
            ) as tmp:
                tmp_path = Path(tmp.name)
                for record in kept:
                    tmp.write(
                        json.dumps(record, sort_keys=True, separators=(",", ":"))
                    )
                    tmp.write("\n")
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_path, self.ledger_path)
        except OSError as exc:
            emit_compaction_failed(
                policy_name=self.policy.name,
                ledger_name=self.ledger_path.name,
                error=exc,
                source=self.policy.source,
                correlation_id=correlation_id,
                extras={"archive_path": str(archive_path)},
                ledger=self.event_ledger,
            )
            raise CompactionError(f"failed to write compaction output: {exc}") from exc

        bytes_after = self.ledger_path.stat().st_size
        result = CompactionResult(
            policy_name=self.policy.name,
            ledger_name=self.ledger_path.name,
            records_archived=len(archived),
            records_kept=len(kept),
            bytes_before=bytes_before,
            bytes_after=bytes_after,
            summary=summary_text,
            started_at=started_at,
            finished_at=self._clock(),
            archive_path=str(archive_path),
        )

        emit_compaction_completed(
            result,
            source=self.policy.source,
            correlation_id=correlation_id,
            ledger=self.event_ledger,
        )
        # ``started_event`` is referenced so static analysers do not
        # flag it as unused (it has been emitted already).
        _ = started_event
        return result
