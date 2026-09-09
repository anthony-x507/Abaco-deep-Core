"""Peer model: a remote node known to this Mac."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from .config import DEFAULT_SYNC_PORT


@dataclass(frozen=True)
class Peer:
    """A remote node participating in mesh sync.

    The mesh-wide convention is that every node serves sync on
    ``DEFAULT_SYNC_PORT`` (the same port ``SyncConfig.port`` defaults to); a
    peer that advertises a different listener may set ``reachable_host`` and
    ``reachable_port`` to override it.
    """

    node_id: str
    hostname: str
    tailscale_ip: str | None
    tailscale_hostname: str | None
    last_seen_at: str
    is_online: bool
    reachable_host: str | None = None
    reachable_port: int | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    @property
    def endpoint(self) -> str | None:
        if self.reachable_host and self.reachable_port:
            return f"http://{self.reachable_host}:{self.reachable_port}"
        if self.tailscale_ip:
            return f"http://{self.tailscale_ip}:{DEFAULT_SYNC_PORT}"
        return None
