import os
import re
import tempfile
import unittest
from pathlib import Path

from sync.config import DEFAULT_SYNC_PORT, SyncConfig


class TestSyncConfigSecret(unittest.TestCase):
    def test_no_deterministic_default_secret(self):
        """Fresh configs without a secret file must not share a key."""
        first = SyncConfig(hmac_secret_file=None)
        second = SyncConfig(hmac_secret_file=None)
        self.assertNotEqual(first.hmac_secret, second.hmac_secret)
        for config in (first, second):
            self.assertIsInstance(config.hmac_secret, bytes)
            self.assertRegex(config.hmac_secret.decode(), re.compile(r"^[0-9a-f]{64}$"))

    def test_persists_secret_file_with_0600(self):
        with tempfile.TemporaryDirectory() as d:
            secret_file = Path(d) / "sub" / ".secret"
            first = SyncConfig(hmac_secret_file=secret_file)
            self.assertTrue(secret_file.exists())
            self.assertEqual(os.stat(secret_file).st_mode & 0o777, 0o600)
            self.assertEqual(secret_file.read_bytes().strip(), first.hmac_secret)
            # A second config must read the persisted secret, not generate a new one.
            second = SyncConfig(hmac_secret_file=secret_file)
            self.assertEqual(second.hmac_secret, first.hmac_secret)

    def test_explicit_secret_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            secret_file = Path(d) / ".secret"
            config = SyncConfig(hmac_secret=b"provisioned-secret", hmac_secret_file=secret_file)
            self.assertEqual(config.hmac_secret, b"provisioned-secret")
            self.assertFalse(secret_file.exists())

    def test_default_port(self):
        self.assertEqual(DEFAULT_SYNC_PORT, 8765)
        self.assertEqual(SyncConfig(hmac_secret=b"x").port, DEFAULT_SYNC_PORT)


if __name__ == "__main__":
    unittest.main()
