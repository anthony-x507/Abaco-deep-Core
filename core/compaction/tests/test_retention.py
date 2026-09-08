"""Tests for :mod:`core.compaction.retention`."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import CompactionPolicy, TicketArchivalRule
from core.compaction.retention import (
    RetentionDecision,
    apply_retention,
    decide_retention,
    decide_ticket_retention,
)


def _record(index: int, occurred_at: str) -> dict[str, object]:
    return {"index": index, "occurred_at": occurred_at}


class TestDecideRetention(unittest.TestCase):
    def test_keep_recent_window(self) -> None:
        records = [_record(i, f"2025-01-{i + 1:02d}T00:00:00Z") for i in range(5)]
        policy = CompactionPolicy(name="p", keep_recent=2)
        decisions = decide_retention(records, policy)
        kept = [d for d in decisions if d.keep]
        self.assertEqual(len(kept), 2)
        self.assertEqual([d.record_index for d in kept], [3, 4])

    def test_age_based_archival(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(days=10)
        new = datetime.now(timezone.utc) - timedelta(days=1)
        records = [
            _record(0, old.isoformat().replace("+00:00", "Z")),
            _record(1, new.isoformat().replace("+00:00", "Z")),
        ]
        policy = CompactionPolicy(name="p", max_age_days=5, keep_recent=1)
        decisions = decide_retention(records, policy)
        # Record 0 is old AND outside keep_recent; record 1 is in window.
        self.assertFalse(decisions[0].keep)
        self.assertTrue(decisions[1].keep)

    def test_age_within_window_keeps(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(days=10)
        records = [_record(0, old.isoformat().replace("+00:00", "Z"))]
        policy = CompactionPolicy(name="p", max_age_days=5, keep_recent=5)
        decisions = decide_retention(records, policy)
        self.assertTrue(decisions[0].keep)

    def test_unparseable_timestamp_archived(self) -> None:
        records = [{"occurred_at": "not-a-date"}]
        policy = CompactionPolicy(name="p", max_age_days=1, keep_recent=0)
        decisions = decide_retention(records, policy)
        self.assertFalse(decisions[0].keep)

    def test_invalid_keep_recent_raises(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            decide_retention([], CompactionPolicy(name="p", keep_recent=-1))


class TestApplyRetention(unittest.TestCase):
    def test_splits_kept_and_archived(self) -> None:
        records = [{"id": i} for i in range(4)]
        decisions = [
            RetentionDecision(0, True, "kept"),
            RetentionDecision(1, False, "archived"),
            RetentionDecision(2, True, "kept"),
            RetentionDecision(3, False, "archived"),
        ]
        kept, archived = apply_retention(records, decisions)
        self.assertEqual([r["id"] for r in kept], [0, 2])
        self.assertEqual([r["id"] for r in archived], [1, 3])

    def test_count_mismatch_raises(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            apply_retention([{"a": 1}], [RetentionDecision(0, True, "x"), RetentionDecision(1, False, "y")])


class TestTicketRetention(unittest.TestCase):
    def test_closed_old_archived(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(days=40)
        new = datetime.now(timezone.utc) - timedelta(days=1)
        tickets = [
            {"status": "closed", "updated_at": old.isoformat().replace("+00:00", "Z")},
            {"status": "closed", "updated_at": new.isoformat().replace("+00:00", "Z")},
            {"status": "open", "updated_at": old.isoformat().replace("+00:00", "Z")},
        ]
        rule = TicketArchivalRule(name="r", max_age_days=30, keep_recent=0)
        decisions = decide_ticket_retention(tickets, rule)
        self.assertFalse(decisions[0].keep)
        self.assertTrue(decisions[1].keep)
        self.assertTrue(decisions[2].keep)

    def test_custom_closed_statuses(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(days=40)
        tickets = [
            {"status": "done", "updated_at": old.isoformat().replace("+00:00", "Z")},
        ]
        rule = TicketArchivalRule(
            name="r", closed_statuses=("done",), max_age_days=30, keep_recent=0
        )
        decisions = decide_ticket_retention(tickets, rule)
        self.assertFalse(decisions[0].keep)


if __name__ == "__main__":
    unittest.main()
