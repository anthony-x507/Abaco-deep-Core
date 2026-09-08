"""Local HTTP server endpoint for receiving signed sync envelopes."""

import hashlib
import hmac
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from .errors import AuthenticationError, ProtocolError
from .models import SyncEnvelope

Handler = Callable[[dict], list[dict]]


def sign_envelope(envelope: SyncEnvelope, secret: bytes) -> str:
    """Return a deterministic HMAC-SHA256 signature for an envelope."""
    content = json.dumps({
        "sender_node_id": envelope.sender_node_id,
        "receiver_node_id": envelope.receiver_node_id,
        "ledger_name": envelope.ledger_name,
        "operation": envelope.operation,
        "since_timestamp": envelope.since_timestamp,
        "records": list(envelope.records),
        "sent_at": envelope.sent_at,
    }, sort_keys=True, separators=(",", ":")).encode()
    return hmac.new(secret, content, hashlib.sha256).hexdigest()


def verify_envelope(envelope: SyncEnvelope, secret: bytes) -> None:
    """Validate an envelope's HMAC and raise on tampering."""
    expected = sign_envelope(envelope.with_signature("") if hasattr(envelope, "with_signature") else envelope, secret)
    supplied = envelope.signature
    envelope = SyncEnvelope(**{**envelope.__dict__, "signature": ""})
    expected = sign_envelope(envelope, secret)
    if not hmac.compare_digest(expected, supplied):
        raise AuthenticationError("Invalid sync envelope signature")


class SyncRequestHandler(BaseHTTPRequestHandler):
    """Serve JSON sync API requests."""

    handler: Handler

    def do_POST(self) -> None:
        """Handle pull and push requests."""
        if self.path not in ("/api/sync/pull", "/api/sync/push"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length))
            envelope = SyncEnvelope(
                sender_node_id=data["sender_node_id"], receiver_node_id=data.get("receiver_node_id"),
                ledger_name=data["ledger_name"], operation=data["operation"],
                since_timestamp=data.get("since_timestamp"), records=tuple(data.get("records", [])),
                signature=data["signature"], sent_at=data["sent_at"],
            )
            verify_envelope(envelope, self.server.sync_secret)  # type: ignore[attr-defined]
            records = self.server.sync_handler(envelope)  # type: ignore[attr-defined]
            self._send(200, {"ok": True, "records": records})
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": str(exc)})
        except AuthenticationError as exc:
            self._send(401, {"ok": False, "error": str(exc)})

    def _send(self, status: int, payload: dict) -> None:
        """Write a JSON response."""
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        """Keep request logging concise and optional."""


class MeshServer:
    """Threaded local HTTP server for mesh synchronization."""

    def __init__(self, host: str, port: int, secret: bytes, handler: Handler) -> None:
        self.server = ThreadingHTTPServer((host, port), SyncRequestHandler)
        self.server.sync_secret = secret  # type: ignore[attr-defined]
        self.server.sync_handler = handler  # type: ignore[attr-defined]

    def serve_forever(self) -> None:
        """Serve requests until stopped."""
        self.server.serve_forever()

    def stop(self) -> None:
        """Stop the server and close its socket."""
        self.server.shutdown()
        self.server.server_close()
