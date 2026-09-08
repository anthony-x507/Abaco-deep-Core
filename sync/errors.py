"""Typed errors raised by the synchronization subsystem."""


class SyncError(Exception):
    """Base class for synchronization errors."""


class IdentityError(SyncError):
    """Raised when a persistent node identity cannot be created or loaded."""


class DiscoveryError(SyncError):
    """Raised when Tailscale peer discovery fails."""


class RegistryError(SyncError):
    """Raised when the peer registry cannot be read or updated."""


class ProtocolError(SyncError):
    """Raised when a sync payload or request violates the wire protocol."""


class AuthenticationError(ProtocolError):
    """Raised when an envelope has an invalid HMAC signature."""


class PeerUnavailableError(SyncError):
    """Raised when a requested peer cannot be reached."""


class LedgerError(SyncError):
    """Raised when a local ledger cannot be read or written."""
