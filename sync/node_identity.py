"""Persistent node identity management."""

import json
import platform
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .errors import IdentityError
from .models import NodeIdentity


class NodeIdentityStore:
    """Load or create the local node identity."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def load(self) -> NodeIdentity:
        """Return the persisted identity, creating it when necessary."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            try:
                return NodeIdentity(**json.loads(self.path.read_text()))
            except (OSError, ValueError, TypeError) as exc:
                raise IdentityError(f"Invalid identity file: {self.path}") from exc
        identity = self.create()
        self.save(identity)
        return identity

    def create(self) -> NodeIdentity:
        """Create a UUID-v4 identity with host and Tailscale metadata."""
        now = datetime.now(timezone.utc).isoformat()
        tailscale_ip, tailscale_hostname = _tailscale_addresses()
        return NodeIdentity(
            node_id=str(uuid.uuid4()),
            hostname=socket.gethostname() or platform.node(),
            tailscale_ip=tailscale_ip,
            tailscale_hostname=tailscale_hostname,
            created_at=now,
            last_seen_at=now,
        )

    def touch(self, identity: NodeIdentity) -> NodeIdentity:
        """Return an identity with an updated last-seen timestamp."""
        return NodeIdentity(
            node_id=identity.node_id,
            hostname=identity.hostname,
            tailscale_ip=_tailscale_addresses()[0],
            tailscale_hostname=_tailscale_addresses()[1],
            created_at=identity.created_at,
            last_seen_at=datetime.now(timezone.utc).isoformat(),
        )

    def save(self, identity: NodeIdentity) -> None:
        """Persist an identity atomically."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(identity.__dict__, sort_keys=True))
        temporary.replace(self.path)


def _tailscale_addresses() -> tuple[str | None, str | None]:
    """Discover local Tailscale address without failing offline startup."""
    try:
        from .peer_discovery import discover_tailscale_status
        status = discover_tailscale_status()
        return status.get("self_ip"), status.get("self_hostname")
    except Exception:
        return None, None
