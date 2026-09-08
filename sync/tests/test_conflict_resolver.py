import unittest
from sync.conflict_resolver import resolve

class TestConflictResolver(unittest.TestCase):
    def test_lww_and_conflict(self):
        merged, conflicts = resolve([{"id": "1", "updated_at": "2024-01-01"}], [{"id": "1", "updated_at": "2025-01-01"}])
        self.assertEqual(merged, [{"id": "1", "updated_at": "2025-01-01"}])
        self.assertEqual(conflicts[0]["discarded"]["updated_at"], "2024-01-01")

if __name__ == "__main__": unittest.main()
