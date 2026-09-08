import tempfile
import unittest
from pathlib import Path
from sync.ledger_sync import LedgerSync

class TestLedgerSync(unittest.TestCase):
    def test_jsonl_merge(self):
        with tempfile.TemporaryDirectory() as d:
            ledgers = LedgerSync(Path(d)); ledgers.write("events", [{"id": "1", "updated_at": "2024-01-01"}])
            records, conflicts = ledgers.merge("events", [{"id": "1", "updated_at": "2025-01-01"}])
            self.assertEqual(records[0]["updated_at"], "2025-01-01")
            self.assertEqual(len(conflicts), 1)

if __name__ == "__main__": unittest.main()
