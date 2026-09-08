"""Configuration for local, peer-to-peer synchronization."""

from dataclasses import dataclass, field
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5


@dataclass
class SyncConfig:
    """Runtime paths, network settings, and HMAC secret."""

    data_dir: Path = field(default_factory=lambda: Path.home() / ".abaco" / "sync")
    hmac_secret: bytes = field(default_factory=lambda: _default_secret())
    host: str = "0.0.0.0"
    port: int = 8765
    tailscale_status_timeout: float = 5.0
    hmac_secret_file: Path | None = field(default_factory=lambda: Path.home() / ".abaco" / "sync" / ".secret")
    ledgers: tuple[str, ...] = ("events", "tickets", "faces")

    def __post_init__(self) -> None:
        """Normalize paths and ensure a usable secret is available."""
        self.data_dir = Path(self.data_dir)
        if not self.hmac_secret:
            self.hmac_secret = self._load_or_create_secret()
        if self.hmac_secret_file is not None:
            self.hmac_secret_file = Path(self.hmac_secret_file)

    def _load_or_create_secret(self) -> bytes:
        """Load the persisted shared secret or create one atomically."""
        if self.hmac_secret_file is None:
            return uuid4().hex.encode()
        self.hmac_secret_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            return self.hmac_secret_file.read_bytes().strip()
        except FileNotFoundError:
            secret = uuid4().hex.encode()
            self.hmac_secret_file.write_bytes(secret)
            return secret


def _default_secret() -> bytes:
    """Return a deterministic placeholder until a persisted secret is loaded."""
    return str(uuid5(NAMESPACE_URL, "abaco-sync-development-secret")).encode()
