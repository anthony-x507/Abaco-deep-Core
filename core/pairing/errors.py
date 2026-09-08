"""Exception hierarchy for the pairing module.

The pairing flow has several distinct failure modes (expired codes,
rate limiting, unknown devices, malformed input).  Defining granular
exceptions lets the FastAPI layer map each one to a precise HTTP status
code without parsing error strings.
"""

from __future__ import annotations


class PairingError(RuntimeError):
    """Base class for any error raised by the pairing module."""


class InvalidPairingCodeError(PairingError, ValueError):
    """Raised when a pairing code is malformed (wrong length/charset).

    Also raised by the validator when the supplied code simply does not
    exist in the registry — we do not distinguish "never existed" from
    "already consumed" on the wire to avoid leaking which codes are
    valid.
    """


class ExpiredPairingCodeError(PairingError):
    """Raised when a pairing code is well-formed but its TTL elapsed."""


class UsedPairingCodeError(PairingError):
    """Raised when a pairing code has already been redeemed."""


class SecretMismatchError(PairingError):
    """Raised when the secret bundled with the QR does not match.

    Treated as a hard failure (different from a code that simply does
    not exist) so legitimate scans that mistype the secret get a clear
    message while random probes see ``InvalidPairingCodeError``.
    """


class RateLimitedError(PairingError):
    """Raised when a caller exceeds the per-IP verification budget."""

    def __init__(self, message: str, *, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class UnknownDeviceError(PairingError, LookupError):
    """Raised when revocation targets a device_id we have never paired."""


class DeviceStoreError(PairingError):
    """Raised when the on-disk device store cannot be read or written."""


__all__ = [
    "DeviceStoreError",
    "ExpiredPairingCodeError",
    "InvalidPairingCodeError",
    "PairingError",
    "RateLimitedError",
    "SecretMismatchError",
    "UnknownDeviceError",
    "UsedPairingCodeError",
]
