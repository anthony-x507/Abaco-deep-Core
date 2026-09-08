import unittest
from datetime import datetime, timezone
from sync.models import SyncEnvelope
from sync.mesh_server import sign_envelope, verify_envelope

class TestMeshProtocol(unittest.TestCase):
    def test_signature(self):
        envelope = SyncEnvelope("a", None, "events", "pull", None, (), "", datetime.now(timezone.utc).isoformat())
        envelope = SyncEnvelope(**{**envelope.__dict__, "signature": sign_envelope(envelope, b"secret")})
        verify_envelope(envelope, b"secret")

if __name__ == "__main__": unittest.main()
