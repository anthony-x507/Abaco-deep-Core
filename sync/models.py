"""Wire models used by the mesh synchronization protocol."""

from dataclasses import dataclass
from typing import Any

from .config import DEFAULT_SYNC_PORT


@dataclass(frozen=True)
class NodeIdentity:
    """Persistent identity and current network information for this node."""

    node_id: str
    hostname: str
    tailscale_ip: str | None
    tailscale_hostname: str | None
    created_at: str
    last_seen_at: str


@dataclass(frozen=True)
class Peer:
    """A known node in the Tailscale mesh.

    The mesh-wide convention is that every node serves sync on
    ``DEFAULT_SYNC_PORT``; a peer that advertises a different listener may
    set ``reachable_host`` and ``reachable_port`` to override it.
    """

    node_id: str
    hostname: str
    tailscale_ip: str | None
    tailscale_hostname: str | None
    last_seen_at: str
    is_online: bool
    reachable_host: str | None = None
    reachable_port: int | None = None

    @property
    def endpoint(self) -> str | None:
        """Return this peer's full sync base URL, or None when unreachable."""
        if self.reachable_host and self.reachable_port:
            return f"http://{self.reachable_host}:{self.reachable_port}"
        if self.tailscale_ip:
            return f"http://{self.tailscale_ip}:{DEFAULT_SYNC_PORT}"
        return None


@dataclass(frozen=True)
class SyncEnvelope:
    """Signed synchronization request or response."""

    sender_node_id: str
    receiver_node_id: str | None
    ledger_name: str
    operation: str
    since_timestamp: str | None
    records: tuple[dict[str, Any], ...]
    signature: str
    sent_at: str
