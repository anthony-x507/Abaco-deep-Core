"""Tests for :mod:`core.compaction.ledger_compactor`."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.compaction.errors import PathSafetyError
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import CompactionPolicy


def _write_ledger(path: Path, records: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
            handle.write("\n")


def _record(idx: int, occurred_at: str, *, event_type: str = "user.action") -> dict[str, object]:
    return {
        "event_id": f"evt-{idx:04d}",
        "event_type": event_type,
        "occurred_at": occurred_at,
        "payload": {"i": idx},
    }


def _fixed_clock(at: datetime):
    def _clock() -> str:
        return at.isoformat(timespec="seconds").replace("+00:00", "Z")
    return _clock


class TestLedgerCompactor(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ledger = self.root / "runtime" / "events.jsonl"
        self.ledger.parent.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_compact_archives_old_records(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat().replace("+00:00", "Z")
        records = [_record(i, old) for i in range(5)]
        _write_ledger(self.ledger, records)
        policy = CompactionPolicy(
            name="size",
            max_count=10,
            keep_recent=2,
            max_age_days=5,
        )
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        result = compactor.compact()
        self.assertEqual(result.records_archived, 3)
        self.assertEqual(result.records_kept, 2)
        # Main ledger has only the last two records.
        remaining = self.ledger.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(remaining), 2)
        # Archive exists and has three records.
        archive = Path(result.archive_path)
        self.assertTrue(archive.exists())
        archived_lines = archive.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(archived_lines), 3)

    def test_should_compact_size(self) -> None:
        big_line = json.dumps({"x": "y" * 200})
        _write_ledger(self.ledger, [{"big": "x" * 50} for _ in range(20)])
        policy = CompactionPolicy(name="s", max_bytes=10, keep_recent=1)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        should, kind, measured = compactor.should_compact()
        self.assertTrue(should)
        self.assertEqual(kind, "size")
        self.assertIsNotNone(measured)
        _ = big_line  # silence linters; used to demonstrate JSON size

    def test_should_compact_lines(self) -> None:
        _write_ledger(self.ledger, [_record(i, "2025-01-01T00:00:00Z") for i in range(10)])
        policy = CompactionPolicy(name="l", max_lines=5, keep_recent=2)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        should, kind, _ = compactor.should_compact()
        self.assertTrue(should)
        self.assertEqual(kind, "lines")

    def test_should_compact_count(self) -> None:
        _write_ledger(self.ledger, [_record(i, "2025-01-01T00:00:00Z") for i in range(3)])
        policy = CompactionPolicy(name="c", max_count=2, keep_recent=1)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        should, kind, _ = compactor.should_compact()
        self.assertTrue(should)
        self.assertEqual(kind, "count")

    def test_should_compact_age(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
        _write_ledger(self.ledger, [_record(0, old)])
        policy = CompactionPolicy(name="a", max_age_days=7, keep_recent=1)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        should, kind, measured = compactor.should_compact()
        self.assertTrue(should)
        self.assertEqual(kind, "age")
        # Allow a small timing window: the record was 30 days old when
        # the test wrote it, but a few milliseconds may have elapsed
        # before the compactor computed ``now``.
        self.assertGreaterEqual(int(measured or 0), 29)  # type: ignore[arg-type]

    def test_no_op_when_under_threshold(self) -> None:
        _write_ledger(self.ledger, [_record(i, "2025-01-01T00:00:00Z") for i in range(2)])
        policy = CompactionPolicy(name="c", max_count=10, keep_recent=5)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        result = compactor.compact()
        self.assertEqual(result.records_archived, 0)
        self.assertEqual(result.records_kept, 2)
        self.assertIn("no compaction triggered", result.summary)

    def test_path_safety_blocks_escape(self) -> None:
        _write_ledger(self.ledger, [_record(i, "2025-01-01T00:00:00Z") for i in range(3)])
        policy = CompactionPolicy(
            name="escape",
            max_count=1,
            keep_recent=1,
            archive_path_pattern="../../escape-{date}.jsonl",
        )
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        with self.assertRaises(PathSafetyError):
            compactor.compact()

    def test_force_compaction_archives_when_window_safe(self) -> None:
        _write_ledger(self.ledger, [_record(i, "2025-01-01T00:00:00Z") for i in range(3)])
        policy = CompactionPolicy(name="c", max_count=10, keep_recent=2)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        result = compactor.compact(force=True)
        self.assertEqual(result.records_archived, 1)
        self.assertEqual(result.records_kept, 2)

    def test_clock_is_honoured(self) -> None:
        old = (datetime(2020, 1, 1, tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z")
        _write_ledger(self.ledger, [_record(i, old) for i in range(3)])
        policy = CompactionPolicy(name="a", max_age_days=1, keep_recent=1)
        compactor = LedgerCompactor(
            self.ledger,
            project_root=self.root,
            policy=policy,
            clock=_fixed_clock(datetime(2025, 1, 1, tzinfo=timezone.utc)),
        )
        result = compactor.compact()
        self.assertEqual(result.records_archived, 2)
        self.assertEqual(result.records_kept, 1)

    def test_summary_includes_record_count(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
        _write_ledger(self.ledger, [_record(i, old) for i in range(3)])
        policy = CompactionPolicy(name="a", max_age_days=1, keep_recent=1)
        compactor = LedgerCompactor(self.ledger, project_root=self.root, policy=policy)
        result = compactor.compact()
        self.assertIn("records archived: 2", result.summary)


if __name__ == "__main__":
    unittest.main()
