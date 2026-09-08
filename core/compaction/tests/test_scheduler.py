"""Tests for :mod:`core.compaction.scheduler`."""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.compaction.errors import InvalidPolicyError, SchedulerError
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import CompactionPolicy
from core.compaction.scheduler import CompactionScheduler
from core.compaction.ticket_compactor import TicketCompactor
from core.compaction.models import TicketArchivalRule


def _write_records(path: Path, n: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for i in range(n):
            record = {
                "event_type": "user.action",
                "occurred_at": "2025-01-01T00:00:00Z",
                "payload": {"i": i},
            }
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
            handle.write("\n")


class TestSchedulerManual(unittest.TestCase):
    def test_run_now_executes_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ledger = root / "events.jsonl"
            _write_records(ledger, 5)
            compactor = LedgerCompactor(
                ledger,
                project_root=root,
                policy=CompactionPolicy(name="c", max_count=3, keep_recent=1),
            )
            scheduler = CompactionScheduler(mode="manual")
            scheduler.register(
                name="j1",
                ledger_name="events",
                compactor=compactor,
                policy=compactor.policy,
            )
            results = scheduler.run_now()
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].records_archived, 4)
            self.assertEqual(results[0].records_kept, 1)
            self.assertEqual(scheduler.stats()["history_size"], 1)

    def test_run_now_unknown_job_name_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ledger = root / "events.jsonl"
            _write_records(ledger, 5)
            compactor = LedgerCompactor(
                ledger,
                project_root=root,
                policy=CompactionPolicy(name="c", max_count=3, keep_recent=1),
            )
            scheduler = CompactionScheduler(mode="manual")
            scheduler.register(
                name="j1",
                ledger_name="events",
                compactor=compactor,
                policy=compactor.policy,
            )
            results = scheduler.run_now(job_name="missing")
            self.assertEqual(results, [])

    def test_invalid_mode(self) -> None:
        with self.assertRaises(SchedulerError):
            CompactionScheduler(mode="nope")

    def test_invalid_writes_per_run(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            CompactionScheduler(mode="on_write", writes_per_run=0)

    def test_register_rejects_non_compactor(self) -> None:
        scheduler = CompactionScheduler()
        with self.assertRaises(SchedulerError):
            scheduler.register(
                name="x",
                ledger_name="x",
                compactor=object(),
                policy=CompactionPolicy(name="p"),
            )


class TestSchedulerOnWrite(unittest.TestCase):
    def test_notify_write_triggers_at_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ledger = root / "events.jsonl"
            _write_records(ledger, 5)
            compactor = LedgerCompactor(
                ledger,
                project_root=root,
                policy=CompactionPolicy(name="c", max_count=3, keep_recent=1),
            )
            scheduler = CompactionScheduler(mode="on_write", writes_per_run=3)
            scheduler.register(
                name="j1",
                ledger_name="events",
                compactor=compactor,
                policy=compactor.policy,
            )
            # First two notifications should not trigger anything.
            self.assertEqual(scheduler.notify_write(), [])
            self.assertEqual(scheduler.notify_write(), [])
            # Third one tips the counter and triggers a compaction.
            results = scheduler.notify_write()
            self.assertEqual(len(results), 1)
            self.assertEqual(scheduler.stats()["write_count"], 0)

    def test_notify_write_in_manual_mode_is_noop(self) -> None:
        scheduler = CompactionScheduler(mode="manual")
        self.assertEqual(scheduler.notify_write(), [])

    def test_notify_write_rejects_non_positive(self) -> None:
        scheduler = CompactionScheduler(mode="on_write", writes_per_run=2)
        with self.assertRaises(SchedulerError):
            scheduler.notify_write(count=0)


class TestSchedulerInterval(unittest.TestCase):
    def test_start_and_stop_runs_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ledger = root / "events.jsonl"
            _write_records(ledger, 5)
            compactor = LedgerCompactor(
                ledger,
                project_root=root,
                policy=CompactionPolicy(name="c", max_count=3, keep_recent=1),
            )
            scheduler = CompactionScheduler(mode="interval", interval_seconds=0.05)
            scheduler.register(
                name="j1",
                ledger_name="events",
                compactor=compactor,
                policy=compactor.policy,
            )
            scheduler.start()
            try:
                # Wait long enough for at least one tick.
                time.sleep(0.2)
            finally:
                scheduler.stop()
            # Either the compactor ran (history >= 1) or the threshold
            # is no longer met because the compactor already ran.
            self.assertGreaterEqual(scheduler.stats()["history_size"], 1)

    def test_start_is_idempotent(self) -> None:
        scheduler = CompactionScheduler(mode="interval", interval_seconds=60)
        scheduler.start()
        try:
            scheduler.start()  # should not raise
        finally:
            scheduler.stop()

    def test_stop_without_start(self) -> None:
        scheduler = CompactionScheduler(mode="interval", interval_seconds=60)
        scheduler.stop()  # should not raise


class TestSchedulerTicketCompactor(unittest.TestCase):
    def test_runs_ticket_compactor(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ledger = root / "tickets.jsonl"
            old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat().replace("+00:00", "Z")
            with ledger.open("w", encoding="utf-8") as handle:
                for i in range(3):
                    handle.write(json.dumps({
                        "ticket_id": f"t{i}",
                        "status": "closed",
                        "updated_at": old,
                    }))
                    handle.write("\n")
            rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=0)
            compactor = TicketCompactor(ledger, rule=rule, project_root=root)
            scheduler = CompactionScheduler(mode="manual")
            scheduler.register(
                name="t1",
                ledger_name="tickets",
                compactor=compactor,
                policy=CompactionPolicy(name=rule.name, keep_recent=rule.keep_recent),
            )
            results = scheduler.run_now()
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0].records_archived, 3)


if __name__ == "__main__":
    unittest.main()
