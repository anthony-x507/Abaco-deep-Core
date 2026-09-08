"""Framework-independent sync API functions returning dictionaries."""

from typing import Any

from .ledger_sync import LedgerSync
from .mesh_client import MeshClient
from .models import NodeIdentity, Peer, SyncEnvelope
from .node_identity import NodeIdentityStore
from .peer_registry import PeerRegistry


class SyncAPI:
    """Small facade for HTTP adapters and local callers."""

    def __init__(self, identity: NodeIdentity, registry: PeerRegistry, ledgers: LedgerSync, client: MeshClient) -> None:
        self.identity = identity
        self.registry = registry
        self.ledgers = ledgers
        self.client = client

    def get_identity(self) -> dict[str, Any]:
        """Return identity data for the API."""
        return self.identity.__dict__

    def get_peers(self) -> list[dict[str, Any]]:
        """Return known peers for the API."""
        return [peer.__dict__ for peer in self.registry.list()]

    def get_state(self) -> dict[str, Any]:
        """Return node ID and per-ledger summary state."""
        return {"node_id": self.identity.node_id, "ledgers": {name: self.ledgers.state(name) for name in self.ledgers.root.glob("*.jsonl")}}

    def pull(self, envelope: SyncEnvelope) -> dict[str, Any]:
        """Merge incoming records and return the resulting records."""
        records, conflicts = self.ledgers.merge(envelope.ledger_name, list(envelope.records))
        return {"ok": True, "records": records, "conflicts": conflicts}

    def push(self, peer: Peer, records: list[dict], ledger_name: str = "events") -> dict[str, Any]:
        """Push records to one peer and return its response."""
        if not peer.tailscale_ip:
            return {"ok": False, "error": "peer has no Tailscale address"}
        from datetime import datetime, timezone
        from .mesh_server import sign_envelope
        envelope = SyncEnvelope(self.identity.node_id, peer.node_id, ledger_name, "push", None, tuple(records), "", datetime.now(timezone.utc).isoformat())
        envelope = SyncEnvelope(**{**envelope.__dict__, "signature": sign_envelope(envelope, self.client.secret)})
        result = self.client.push(f"http://{peer.tailscale_ip}", envelope)
        return {"ok": True, "records": result}

    def broadcast(self, records: list[dict], ledger_name: str = "events") -> dict[str, Any]:
        """Attempt to push records to every online peer."""
        responses = [self.push(peer, records, ledger_name) for peer in self.registry.list() if peer.is_online]
        return {"ok": bool(responses), "responses": responses}
