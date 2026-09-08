import tempfile
import unittest
from pathlib import Path
from sync.node_identity import NodeIdentityStore

class TestNodeIdentity(unittest.TestCase):
    def test_persists(self):
        with tempfile.TemporaryDirectory() as d:
            store = NodeIdentityStore(Path(d) / "identity.json")
            one = store.load(); two = store.load()
            self.assertEqual(one.node_id, two.node_id)

if __name__ == "__main__": unittest.main()
