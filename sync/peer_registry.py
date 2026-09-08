"""Persistent registry of known Tailscale peers."""

import json
from datetime import datetime, timezone
from pathlib import Path

from .errors import RegistryError
from .models import Peer


class PeerRegistry:
    """Store and retrieve peer metadata on the local node."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def list(self) -> list[Peer]:
        """Load all known peers."""
        if not self.path.exists():
            return []
        try:
            return [Peer(**item) for item in json.loads(self.path.read_text())]
        except (OSError, ValueError, TypeError) as exc:
            raise RegistryError(f"Invalid peer registry: {self.path}") from exc

    def upsert(self, peer: Peer) -> None:
        """Insert a peer or replace its existing entry."""
        peers = {item.node_id: item for item in self.list() if item.node_id != peer.node_id}
        peers[peer.node_id] = peer
        self._save(list(peers.values()))

    def remove(self, node_id: str) -> None:
        """Remove a peer from the registry."""
        self._save([item for item in self.list() if item.node_id != node_id])

    def get(self, node_id: str) -> Peer | None:
        """Return one peer by node ID."""
        return next((item for item in self.list() if item.node_id == node_id), None)

    def _save(self, peers: list[Peer]) -> None:
        """Write the registry atomically."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps([peer.__dict__ for peer in peers], sort_keys=True))
        temporary.replace(self.path)


def peer_from_status(status: dict, now: str | None = None) -> Peer:
    """Convert Tailscale status fields into a :class:`Peer`."""
    ips = status.get("TailscaleIPs") or status.get("TailscaleIPs", [])
    return Peer(
        node_id=str(status.get("NodeID") or status.get("ID") or status.get("HostName", "unknown")),
        hostname=str(status.get("HostName") or status.get("HostName", "unknown")),
        tailscale_ip=(ips[0] if ips else status.get("TailscaleIP")),
        tailscale_hostname=status.get("DNSName"),
        last_seen_at=now or datetime.now(timezone.utc).isoformat(),
        is_online=bool(status.get("Online", True)),
    )
