import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from sync.api import SyncAPI
from sync.ledger_sync import LedgerSync
from sync.models import Peer


class _FakeClient:
    def __init__(self) -> None:
        self.secret = b"secret"
        self.urls: list[str] = []

    def push(self, url: str, envelope) -> list[dict]:
        self.urls.append(url)
        return [dict(envelope.records[0])] if envelope.records else []


def _peer(tailscale_ip: str | None = "100.64.0.5", **overrides) -> Peer:
    fields = dict(
        node_id="remote",
        hostname="remote-host",
        tailscale_ip=tailscale_ip,
        tailscale_hostname="remote-host.tailnet.ts.net",
        last_seen_at="2024-01-01T00:00:00+00:00",
        is_online=True,
    )
    fields.update(overrides)
    return Peer(**fields)


class TestSyncAPI(unittest.TestCase):
    def _api(self, root: Path) -> tuple[SyncAPI, _FakeClient]:
        client = _FakeClient()
        identity = SimpleNamespace(node_id="local-node")
        api = SyncAPI(identity, None, LedgerSync(root), client)
        return api, client

    def test_get_state_uses_ledger_basenames(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            ledgers = LedgerSync(root)
            ledgers.write("events", [{"id": "1", "updated_at": "2024-01-01"}])
            ledgers.write("faces", [])
            # A stray temporary file must not be treated as a ledger.
            (root / "tickets.jsonl.tmp").write_text("{}")
            api, _ = self._api(root)
            state = api.get_state()
            self.assertEqual(state["node_id"], "local-node")
            self.assertEqual(set(state["ledgers"]), {"events", "faces"})
            self.assertEqual(state["ledgers"]["events"]["count"], 1)

    def test_push_uses_peer_endpoint_with_default_port(self):
        with tempfile.TemporaryDirectory() as d:
            api, client = self._api(Path(d))
            response = api.push(_peer(), [{"id": "1", "updated_at": "2024-01-01"}])
            self.assertTrue(response["ok"])
            self.assertEqual(client.urls, ["http://100.64.0.5:8765"])

    def test_push_uses_advertised_endpoint_when_present(self):
        with tempfile.TemporaryDirectory() as d:
            api, client = self._api(Path(d))
            peer = _peer(reachable_host="sync.internal", reachable_port=9000)
            api.push(peer, [{"id": "1", "updated_at": "2024-01-01"}])
            self.assertEqual(client.urls, ["http://sync.internal:9000"])

    def test_push_rejects_peer_without_endpoint(self):
        with tempfile.TemporaryDirectory() as d:
            api, _ = self._api(Path(d))
            response = api.push(_peer(tailscale_ip=None), [{"id": "1", "updated_at": "2024-01-01"}])
            self.assertFalse(response["ok"])


if __name__ == "__main__":
    unittest.main()
