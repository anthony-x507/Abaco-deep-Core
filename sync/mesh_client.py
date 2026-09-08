"""HTTP client for communication with mesh peers."""

import json
import urllib.request
from typing import Any

from .errors import PeerUnavailableError, ProtocolError
from .models import SyncEnvelope


class MeshClient:
    """Push and pull signed envelopes over HTTP."""

    def __init__(self, secret: bytes, timeout: float = 5.0) -> None:
        self.secret = secret
        self.timeout = timeout

    def request(self, peer_url: str, envelope: SyncEnvelope) -> list[dict[str, Any]]:
        """Send an envelope and decode the peer's record response."""
        payload = json.dumps({
            "sender_node_id": envelope.sender_node_id,
            "receiver_node_id": envelope.receiver_node_id,
            "ledger_name": envelope.ledger_name,
            "operation": envelope.operation,
            "since_timestamp": envelope.since_timestamp,
            "records": list(envelope.records),
            "signature": envelope.signature,
            "sent_at": envelope.sent_at,
        }, separators=(",", ":")).encode()
        endpoint = "push" if envelope.operation == "push" else "pull"
        request = urllib.request.Request(
            f"{peer_url.rstrip('/')}/api/sync/{endpoint}", data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read())
        except (OSError, ValueError) as exc:
            raise PeerUnavailableError(f"Cannot reach peer {peer_url}") from exc
        if not isinstance(result, dict) or not result.get("ok"):
            raise ProtocolError(str(result))
        return list(result.get("records", []))

    def push(self, peer_url: str, envelope: SyncEnvelope) -> list[dict[str, Any]]:
        """Request a push from a peer."""
        return self.request(peer_url, envelope)
