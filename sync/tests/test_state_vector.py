import unittest
from sync.state_vector import StateVector

class TestStateVector(unittest.TestCase):
    def test_cursor(self):
        vector = StateVector()
        vector.observe("a", "2024-01-01")
        vector.observe("a", "2023-01-01")
        self.assertTrue(vector.needs("a", "2025-01-01"))
        self.assertFalse(vector.needs("a", "2023-01-01"))

if __name__ == "__main__": unittest.main()
