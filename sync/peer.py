"""Peer model: a remote node known to this Mac."""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Peer:
    """A remote node participating in mesh sync."""

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
            return f"http://{self.tailscale_ip}:7777"
        return None
