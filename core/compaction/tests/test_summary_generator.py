"""Tests for :mod:`core.compaction.summary_generator`."""

from __future__ import annotations

import unittest

from core.compaction.models import SessionTurn
from core.compaction.summary_generator import (
    SummaryGenerator,
    generate_session_summary,
)


def _record(event_type: str, *, occurred_at: str = "2025-01-01T00:00:00Z", **payload):
    return {
        "event_type": event_type,
        "occurred_at": occurred_at,
        "payload": payload,
    }


class TestLedgerSummary(unittest.TestCase):
    def test_summary_is_deterministic(self) -> None:
        records = [
            _record("user.login", occurred_at="2025-01-01T00:00:00Z", user="alice"),
            _record("user.login", occurred_at="2025-01-02T00:00:00Z", user="bob"),
            _record("system.error", occurred_at="2025-01-03T00:00:00Z", msg="boom"),
        ]
        gen = SummaryGenerator(top_n=3)
        text1, stats1 = gen.summarize_ledger(records, ledger_name="events")
        text2, stats2 = gen.summarize_ledger(records, ledger_name="events")
        self.assertEqual(text1, text2)
        self.assertEqual(stats1.record_count, 3)
        self.assertEqual(stats1.error_count, 1)
        self.assertEqual(dict(stats1.top_types), {"user.login": 2, "system.error": 1})

    def test_summary_includes_window(self) -> None:
        records = [
            _record("a", occurred_at="2025-01-01T00:00:00Z"),
            _record("b", occurred_at="2025-06-01T00:00:00Z"),
        ]
        gen = SummaryGenerator()
        text, _ = gen.summarize_ledger(records, ledger_name="events")
        self.assertIn("2025-01-01", text)
        self.assertIn("2025-06-01", text)

    def test_summary_handles_empty_input(self) -> None:
        gen = SummaryGenerator()
        text, stats = gen.summarize_ledger([], ledger_name="events")
        self.assertIn("records archived: 0", text)
        self.assertEqual(stats.record_count, 0)

    def test_summary_includes_correlation_ids(self) -> None:
        records = [
            _record("x", correlation_id="c1"),
            _record("y", correlation_id="c2"),
            _record("z", correlation_id="c1"),
        ]
        gen = SummaryGenerator()
        text, stats = gen.summarize_ledger(records, ledger_name="events")
        self.assertIn("c1", text)
        self.assertIn("c2", text)
        self.assertEqual(set(stats.correlation_ids), {"c1", "c2"})

    def test_invalid_top_n(self) -> None:
        with self.assertRaises(ValueError):
            SummaryGenerator(top_n=0)


class TestSessionSummary(unittest.TestCase):
    def test_role_distribution(self) -> None:
        turns = [
            SessionTurn(0, "user", "hello"),
            SessionTurn(1, "assistant", "hi"),
            SessionTurn(2, "user", "how are you?"),
        ]
        gen = SummaryGenerator()
        text = gen.summarize_session(turns, session_name="chat")
        self.assertIn("user=2", text)
        self.assertIn("assistant=1", text)

    def test_tool_extraction(self) -> None:
        turns = [
            SessionTurn(0, "assistant", "calling tool:web_search for cats"),
            SessionTurn(1, "assistant", "tool:web_search returned"),
            SessionTurn(2, "user", "thanks"),
        ]
        gen = SummaryGenerator()
        text = gen.summarize_session(turns, session_name="chat")
        self.assertIn("web_search", text)

    def test_error_extraction(self) -> None:
        turns = [
            SessionTurn(0, "assistant", "ok"),
            SessionTurn(1, "assistant", "Something failed: timeout talking to upstream."),
            SessionTurn(2, "user", "retry"),
        ]
        gen = SummaryGenerator()
        text = gen.summarize_session(turns, session_name="chat")
        self.assertIn("timeout", text)

    def test_function_call_marker(self) -> None:
        turns = [
            SessionTurn(0, "assistant", "function_call=get_weather args=city"),
        ]
        gen = SummaryGenerator()
        text = gen.summarize_session(turns, session_name="chat")
        self.assertIn("get_weather", text)

    def test_shortcut_helper(self) -> None:
        text = generate_session_summary(
            [SessionTurn(0, "user", "hello")], session_name="s"
        )
        self.assertIn("Session 's'", text)


if __name__ == "__main__":
    unittest.main()
