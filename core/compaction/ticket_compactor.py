"""Ticket ledger compactor.

Tickets that have been in a terminal state (``closed``, ``cancelled``,
``archived``, ``completed``, ``failed``) for more than
``max_age_days`` are moved to a timestamped archive file.  The active
ledger keeps the last ``keep_recent`` records untouched, mirroring the
behaviour of :class:`LedgerCompactor` for regular event ledgers.

The compactor operates on a JSONL file that stores one ticket record
per line.  When running embedded next to ABACO Python Core, those lines
mirror the shape of an ``abaco_core.tickets.models.TicketRecord``, but
this module never imports ``abaco_core.tickets`` - any line with the
keys ``status`` and ``updated_at`` is treated as a ticket - so the
module remains usable in isolation.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from core.compaction.errors import CompactionError, PathSafetyError
from core.compaction.events import (
    emit_compaction_completed,
    emit_compaction_failed,
    emit_compaction_started,
)
from core.compaction.models import CompactionResult, TicketArchivalRule
from core.compaction.retention import decide_ticket_retention
from core.compaction.summary_generator import SummaryGenerator


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _assert_within_project_root(path: Path, project_root: Path) -> None:
    resolved = path.resolve()
    try:
        resolved.relative_to(project_root.resolve())
    except ValueError as exc:
        raise PathSafetyError(
            f"path {resolved} is outside project root {project_root.resolve()}"
        ) from exc


class TicketCompactor:
    """Compact a JSONL ticket ledger."""

    def __init__(
        self,
        ledger_path: Path | str,
        *,
        rule: TicketArchivalRule,
        project_root: Path | str | None = None,
        ledger: object | None = None,
        summary_generator: SummaryGenerator | None = None,
        clock: callable | None = None,  # type: ignore[valid-type]
    ) -> None:
        self.ledger_path = Path(ledger_path)
        self.rule = rule
        self.project_root = (
            Path(project_root)
            if project_root is not None
            else self.ledger_path.parent
        )
        self.event_ledger = ledger
        self.summary_generator = summary_generator or SummaryGenerator()
        self._clock = clock or _utc_now_iso

    # ------------------------------------------------------------------
    # Trigger
    # ------------------------------------------------------------------

    def should_compact(self) -> tuple[bool, str, int | None]:
        """Determine whether the ticket ledger should be compacted."""

        if not self.ledger_path.exists():
            return False, "manual", None

        tickets = self._read_tickets()
        if not tickets:
            return False, "manual", None

        value = self._clock()
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        current = datetime.fromisoformat(value)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)

        from core.compaction.retention import _parse_timestamp  # local import

        archived_candidates = 0
        for ticket in tickets:
            status = str(ticket.get("status", ""))
            if status not in self.rule.closed_statuses:
                continue
            parsed = _parse_timestamp(str(ticket.get("updated_at", "")))
            if parsed is None:
                archived_candidates += 1
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            age_days = (current - parsed).total_seconds() / 86400.0
            if age_days >= self.rule.max_age_days:
                archived_candidates += 1

        if archived_candidates:
            return True, "age", archived_candidates
        return False, "manual", None

    # ------------------------------------------------------------------
    # IO
    # ------------------------------------------------------------------

    def _read_tickets(self) -> list[dict[str, object]]:
        if not self.ledger_path.exists():
            return []
        tickets: list[dict[str, object]] = []
        with self.ledger_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                clean = line.strip()
                if not clean:
                    continue
                try:
                    tickets.append(json.loads(clean))
                except json.JSONDecodeError:
                    continue
        return tickets

    def _archive_path(self) -> Path:
        value = self._clock()
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        now = datetime.fromisoformat(value)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        pattern = self.rule.archive_path_pattern
        placeholders = {
            "ledger": self.ledger_path.stem,
            "date": now.strftime("%Y%m%d-%H%M%S"),
        }
        try:
            rendered = pattern.format(**placeholders)
        except KeyError as exc:
            raise PathSafetyError(
                f"archive_path_pattern references unknown placeholder: {exc.args[0]!r}"
            ) from exc
        candidate = (self.ledger_path.parent / rendered).resolve()
        _assert_within_project_root(candidate, self.project_root)
        return candidate

    # ------------------------------------------------------------------
    # Compact
    # ------------------------------------------------------------------

    def compact(
        self,
        *,
        force: bool = False,
        correlation_id: str | None = None,
    ) -> CompactionResult:
        started_at = self._clock()
        tickets = self._read_tickets()
        bytes_before = (
            self.ledger_path.stat().st_size if self.ledger_path.exists() else 0
        )

        should, trigger_kind, measured = self.should_compact()
        if not should and not force:
            return CompactionResult(
                policy_name=self.rule.name,
                ledger_name=self.ledger_path.name,
                records_archived=0,
                records_kept=len(tickets),
                bytes_before=bytes_before,
                bytes_after=bytes_before,
                summary="no compaction triggered",
                started_at=started_at,
                finished_at=self._clock(),
                archive_path="",
            )

        value = self._clock()
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        current = datetime.fromisoformat(value)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)

        emit_compaction_started(
            policy_name=self.rule.name,
            ledger_name=self.ledger_path.name,
            trigger_kind=trigger_kind,
            source="abaco-deep-core",
            correlation_id=correlation_id,
            extras={"measured": measured} if measured is not None else None,
            ledger=self.event_ledger,
        )

        try:
            decisions = decide_ticket_retention(
                tickets,
                self.rule,
                now=current,
            )
        except Exception as exc:
            emit_compaction_failed(
                policy_name=self.rule.name,
                ledger_name=self.ledger_path.name,
                error=exc,
                source="abaco-deep-core",
                correlation_id=correlation_id,
                ledger=self.event_ledger,
            )
            raise CompactionError(f"ticket retention failed: {exc}") from exc

        kept: list[dict[str, object]] = []
        archived: list[dict[str, object]] = []
        for ticket, decision in zip(tickets, decisions):
            if decision.keep and not force:
                kept.append(ticket)
            else:
                archived.append(ticket)

        if not archived and not force:
            return CompactionResult(
                policy_name=self.rule.name,
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
                for ticket in archived:
                    tmp.write(json.dumps(ticket, sort_keys=True, separators=(",", ":")))
                    tmp.write("\n")
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_path, archive_path)

            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=str(self.ledger_path.parent),
                prefix=self.ledger_path.name + ".",
                suffix=".tmp",
                delete=False,
            ) as tmp:
                tmp_path = Path(tmp.name)
                for ticket in kept:
                    tmp.write(json.dumps(ticket, sort_keys=True, separators=(",", ":")))
                    tmp.write("\n")
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_path, self.ledger_path)
        except OSError as exc:
            emit_compaction_failed(
                policy_name=self.rule.name,
                ledger_name=self.ledger_path.name,
                error=exc,
                source="abaco-deep-core",
                correlation_id=correlation_id,
                extras={"archive_path": str(archive_path)},
                ledger=self.event_ledger,
            )
            raise CompactionError(f"failed to write ticket archive: {exc}") from exc

        bytes_after = self.ledger_path.stat().st_size
        result = CompactionResult(
            policy_name=self.rule.name,
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
            source="abaco-deep-core",
            correlation_id=correlation_id,
            ledger=self.event_ledger,
        )
        return result
