"""Configuration for local, peer-to-peer synchronization."""

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

#: Mesh-wide port every node's sync server listens on by default. Peers build
#: their endpoint URLs from this port unless they advertise another one.
DEFAULT_SYNC_PORT = 8765


@dataclass
class SyncConfig:
    """Runtime paths, network settings, and HMAC secret."""

    data_dir: Path = field(default_factory=lambda: Path.home() / ".abaco" / "sync")
    hmac_secret: bytes | None = None
    host: str = "0.0.0.0"
    port: int = DEFAULT_SYNC_PORT
    tailscale_status_timeout: float = 5.0
    hmac_secret_file: Path | None = field(default_factory=lambda: Path.home() / ".abaco" / "sync" / ".secret")
    ledgers: tuple[str, ...] = ("events", "tickets", "faces")

    def __post_init__(self) -> None:
        """Normalize paths and ensure a usable secret is available."""
        self.data_dir = Path(self.data_dir)
        if self.hmac_secret_file is not None:
            self.hmac_secret_file = Path(self.hmac_secret_file)
        if not self.hmac_secret:
            self.hmac_secret = self._load_or_create_secret()

    def _load_or_create_secret(self) -> bytes:
        """Load the persisted shared secret or generate and persist a random one.

        There is deliberately no deterministic fallback secret: a mesh shared
        secret must be provisioned explicitly (via ``hmac_secret`` or the
        secret file) so that nobody holding only the source code can forge
        signed envelopes. When neither is present, a fresh secret is generated
        with :func:`secrets.token_hex` and persisted atomically with owner-only
        permissions (``0o600``).
        """
        if self.hmac_secret_file is None:
            return secrets.token_hex(32).encode()
        path = self.hmac_secret_file
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            return path.read_bytes().strip()
        except FileNotFoundError:
            pass
        secret = secrets.token_hex(32).encode()
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        try:
            fd = os.open(path, flags, 0o600)
        except FileExistsError:  # another process created it first; reuse it
            return path.read_bytes().strip()
        with os.fdopen(fd, "wb") as handle:
            handle.write(secret)
        os.chmod(path, 0o600)  # guard against a permissive process umask
        return secret
