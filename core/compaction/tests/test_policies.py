"""Tests for :mod:`core.compaction.policies`."""

from __future__ import annotations

import unittest

from core.compaction.errors import InvalidPolicyError
from core.compaction.models import CompactionPolicy
from core.compaction.policies import (
    count_based_policy,
    size_based_policy,
    time_based_policy,
)


class TestSizeBasedPolicy(unittest.TestCase):
    def test_requires_threshold(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            size_based_policy("noop")

    def test_builds_with_bytes(self) -> None:
        policy = size_based_policy("bytes", max_bytes=4096, keep_recent=10)
        self.assertEqual(policy.name, "bytes")
        self.assertEqual(policy.max_bytes, 4096)
        self.assertIsNone(policy.max_lines)
        self.assertEqual(policy.keep_recent, 10)

    def test_builds_with_lines(self) -> None:
        policy = size_based_policy("lines", max_lines=500)
        self.assertEqual(policy.max_lines, 500)
        self.assertIsNone(policy.max_bytes)

    def test_rejects_non_positive_threshold(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            size_based_policy("bad", max_bytes=0)
        with self.assertRaises(InvalidPolicyError):
            size_based_policy("bad", max_lines=-1)


class TestTimeBasedPolicy(unittest.TestCase):
    def test_builds(self) -> None:
        policy = time_based_policy("daily", max_age_days=7)
        self.assertEqual(policy.max_age_days, 7)
        self.assertEqual(policy.keep_recent, 100)

    def test_requires_age(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            time_based_policy("daily", max_age_days=0)


class TestCountBasedPolicy(unittest.TestCase):
    def test_builds(self) -> None:
        policy = count_based_policy("cap", max_count=500, keep_recent=20)
        self.assertEqual(policy.max_count, 500)
        self.assertEqual(policy.keep_recent, 20)
        self.assertIsInstance(policy, CompactionPolicy)

    def test_rejects_zero(self) -> None:
        with self.assertRaises(InvalidPolicyError):
            count_based_policy("cap", max_count=0)


class TestPolicyDefaults(unittest.TestCase):
    def test_archive_pattern_default(self) -> None:
        policy = count_based_policy("p", max_count=10)
        self.assertIn("{ledger}", policy.archive_path_pattern)
        self.assertIn("{date}", policy.archive_path_pattern)

    def test_policy_is_frozen(self) -> None:
        policy = count_based_policy("p", max_count=10)
        with self.assertRaises(Exception):
            policy.name = "other"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
