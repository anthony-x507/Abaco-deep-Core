import unittest
from sync.conflict_resolver import resolve


class TestConflictResolver(unittest.TestCase):
    def test_lww_and_conflict(self):
        merged, conflicts = resolve([{"id": "1", "updated_at": "2024-01-01"}], [{"id": "1", "updated_at": "2025-01-01"}])
        self.assertEqual(merged, [{"id": "1", "updated_at": "2025-01-01"}])
        self.assertEqual(conflicts[0]["discarded"]["updated_at"], "2024-01-01")

    def test_tie_prefers_greatest_node_id(self):
        local = {"id": "1", "updated_at": "2024-01-01", "node_id": "node-a", "payload": "a"}
        remote = {"id": "1", "updated_at": "2024-01-01", "node_id": "node-b", "payload": "b"}
        # From A's perspective: remote (node-b) is greater and must win.
        merged, _ = resolve([local], [remote])
        self.assertEqual(merged, [remote])
        # From B's perspective: its own record (node-b) must win too, so both
        # nodes converge on the same winner instead of keeping their own copy.
        merged, _ = resolve([remote], [local])
        self.assertEqual(merged, [remote])

    def test_tie_without_node_attribution_converges(self):
        local = {"id": "1", "updated_at": "2024-01-01", "payload": "a"}
        remote = {"id": "1", "updated_at": "2024-01-01", "payload": "b"}
        first, _ = resolve([local], [remote])
        second, _ = resolve([remote], [local])
        self.assertEqual(first, second)
        self.assertEqual(len(first), 1)


if __name__ == "__main__":
    unittest.main()
