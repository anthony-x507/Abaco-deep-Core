"""Wire models used by the mesh synchronization protocol."""

from dataclasses import dataclass
from typing import Any


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
    """A known node in the Tailscale mesh."""

    node_id: str
    hostname: str
    tailscale_ip: str | None
    tailscale_hostname: str | None
    last_seen_at: str
    is_online: bool


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
