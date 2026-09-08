"""Tests for :mod:`core.compaction.session_compactor`."""

from __future__ import annotations

import unittest

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import SessionTurn
from core.compaction.session_compactor import SessionCompactor


class TestSessionCompactor(unittest.TestCase):
    def test_keeps_recent_and_summarises_old(self) -> None:
        turns = [
            SessionTurn(0, "user", "hi"),
            SessionTurn(1, "assistant", "hello"),
            SessionTurn(2, "user", "tell me about cats"),
            SessionTurn(3, "assistant", "cats are mammals"),
            SessionTurn(4, "user", "and dogs?"),
            SessionTurn(5, "assistant", "dogs are too"),
        ]
        compactor = SessionCompactor(keep_recent=2)
        summary = compactor.compact(turns, session_name="chat")
        self.assertEqual(summary.kept_turn_count, 2)
        self.assertEqual(summary.summarized_turn_count, 4)
        self.assertEqual(summary.original_turn_count, 6)
        self.assertEqual(summary.kept_turns[-1].index, 5)
        self.assertIn("chat", summary.summary_text)

    def test_token_estimates(self) -> None:
        long_content = "lorem ipsum " * 200
        turns = [
            SessionTurn(0, "user", long_content),
            SessionTurn(1, "assistant", long_content),
            SessionTurn(2, "user", long_content),
        ]
        compactor = SessionCompactor(keep_recent=1)
        summary = compactor.compact(turns, session_name="s")
        # Long content with keep_recent=1 should compress dramatically.
        self.assertLess(summary.token_estimate_after, summary.token_estimate_before)

    def test_keep_zero_drops_all(self) -> None:
        turns = [SessionTurn(0, "user", "x")]
        compactor = SessionCompactor(keep_recent=0)
        summary = compactor.compact(turns, session_name="s")
        self.assertEqual(summary.kept_turn_count, 0)
        self.assertEqual(summary.summarized_turn_count, 1)
        self.assertIn("turns summarised: 1", summary.summary_text)

    def test_keep_all(self) -> None:
        turns = [SessionTurn(i, "user", f"turn {i}") for i in range(3)]
        compactor = SessionCompactor(keep_recent=10)
        summary = compactor.compact(turns, session_name="s")
        self.assertEqual(summary.kept_turn_count, 3)
        self.assertEqual(summary.summarized_turn_count, 0)
        # When nothing is summarised the summary text is empty.
        self.assertEqual(summary.summary_text, "")

    def test_invalid_keep_recent(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            SessionCompactor(keep_recent=-1)

    def test_empty_input(self) -> None:
        compactor = SessionCompactor(keep_recent=2)
        summary = compactor.compact([], session_name="empty")
        self.assertEqual(summary.original_turn_count, 0)
        self.assertEqual(summary.token_estimate_before, 0)


if __name__ == "__main__":
    unittest.main()
