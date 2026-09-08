"""Tests for :mod:`core.compaction.ticket_compactor`."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.compaction.models import TicketArchivalRule
from core.compaction.ticket_compactor import TicketCompactor


def _ticket(idx: int, status: str, updated_at: str) -> dict[str, object]:
    return {
        "ticket_id": f"t-{idx:04d}",
        "title": f"issue {idx}",
        "description": "x",
        "status": status,
        "updated_at": updated_at,
    }


class TestTicketCompactor(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ledger = self.root / "tickets.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write(self, tickets: list[dict[str, object]]) -> None:
        with self.ledger.open("w", encoding="utf-8") as handle:
            for ticket in tickets:
                handle.write(json.dumps(ticket, sort_keys=True, separators=(",", ":")))
                handle.write("\n")

    def test_archives_closed_old(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat().replace("+00:00", "Z")
        new = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        tickets = [
            _ticket(0, "closed", old),
            _ticket(1, "closed", old),
            _ticket(2, "closed", new),
            _ticket(3, "open", old),
        ]
        self._write(tickets)
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=1)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        result = compactor.compact()
        # Only the very old closed tickets get archived (the one with
        # recent updated_at is kept; the open one is always kept).
        self.assertEqual(result.records_archived, 2)
        self.assertEqual(result.records_kept, 2)
        archive = Path(result.archive_path)
        self.assertTrue(archive.exists())
        archived_lines = archive.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(archived_lines), 2)

    def test_no_op_when_nothing_to_archive(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        self._write([_ticket(0, "closed", old)])
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=10)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        result = compactor.compact()
        self.assertEqual(result.records_archived, 0)
        self.assertIn("no compaction triggered", result.summary)

    def test_force_compaction(self) -> None:
        recent = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        self._write([_ticket(0, "closed", recent)])
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=1)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        result = compactor.compact(force=True)
        # Force moves the closed record even though it is recent.
        self.assertEqual(result.records_archived, 1)
        self.assertEqual(result.records_kept, 0)

    def test_should_compact(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat().replace("+00:00", "Z")
        self._write([_ticket(0, "closed", old)])
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=1)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        should, kind, measured = compactor.should_compact()
        self.assertTrue(should)
        self.assertEqual(kind, "age")
        self.assertGreaterEqual(int(measured or 0), 1)

    def test_summary_contains_record_count(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat().replace("+00:00", "Z")
        self._write([_ticket(0, "closed", old), _ticket(1, "closed", old)])
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=0)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        result = compactor.compact()
        self.assertIn("records archived: 2", result.summary)

    def test_open_ticket_never_archived(self) -> None:
        old = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat().replace("+00:00", "Z")
        self._write([_ticket(0, "open", old)])
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=0)
        compactor = TicketCompactor(self.ledger, rule=rule, project_root=self.root)
        result = compactor.compact()
        self.assertEqual(result.records_archived, 0)


if __name__ == "__main__":
    unittest.main()
