"""Data classes shared across the pairing module.

The pairing flow has two main entities:

* :class:`PairingCode` — a short-lived, one-time credential produced by
  the desktop and rendered as a QR code so a phone can claim it.
* :class:`PairedDevice` — a record of a phone that successfully
  redeemed a :class:`PairingCode`.  Each device gets a stable
  ``device_id`` (UUID4) that the desktop uses to address it later and
  a session token that the phone uses to authenticate subsequent
  calls.

All dataclasses use ``frozen=True`` so they can be hashed and compared
in tests without worrying about accidental mutation.
"""

from __future__ import annotations

from dataclasses import dataclass, field


DeviceType = str  # "ios" | "android" | "mac" | "windows" | "linux"


@dataclass(frozen=True)
class PairingCode:
    """A one-time code rendered in the desktop QR.

    The ``code`` is the short human-friendly identifier (8 alphanumerics)
    and the ``secret`` is a long random token that travels in the QR
    payload so the phone can prove it actually scanned the code rather
    than guessing.

    Attributes:
        code: 8-character alphanumeric identifier (uppercase A-Z + 2-9).
        secret: 64-char hex (32 bytes) random secret bundled with the QR.
        expires_at: ISO-8601 UTC timestamp after which the code is dead.
        created_at: ISO-8601 UTC timestamp when the code was minted.
        created_by_node_id: Identifier of the desktop node that minted it.
        used: Whether the code has been redeemed already.
        used_by_device_id: The :class:`PairedDevice.device_id` that
            redeemed it, if any.
    """

    code: str
    secret: str
    expires_at: str
    created_at: str
    created_by_node_id: str
    used: bool = False
    used_by_device_id: str | None = None


@dataclass(frozen=True)
class PairedDevice:
    """A phone (or another node) that successfully paired with the desktop.

    Attributes:
        device_id: Stable UUID4 string identifying the device.
        device_name: Human-readable name supplied by the phone on pair
            (e.g. ``"iPhone de Anthony"``).
        device_type: One of ``ios``, ``android``, ``mac``, ``windows``,
            ``linux``.  Free-form strings are accepted but the API
            layer validates against the canonical set.
        node_id: For Mac/PC pairings, the node_id of the peer.  ``None``
            for phones.
        paired_at: ISO-8601 UTC timestamp at which the pair completed.
        last_seen_at: ISO-8601 UTC timestamp of the most recent
            authenticated request from this device.
        public_key: Optional PEM-encoded public key reserved for future
            end-to-end encryption.  ``None`` for now.
        permissions: Tuple of capability strings granted to this device.
            Defaults to read-only chat access; the desktop may later
            extend this through a separate permission API.
    """

    device_id: str
    device_name: str
    device_type: str
    node_id: str | None
    paired_at: str
    last_seen_at: str
    public_key: str | None = None
    permissions: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class SessionToken:
    """Opaque session token returned to a freshly paired device.

    The token is a 32-byte random secret (rendered as hex).  It is
    stored server-side keyed by ``device_id`` and is required on every
    subsequent authenticated request until it expires.

    Attributes:
        token: 64-character hex string (32 bytes of entropy).
        device_id: The paired device this token authenticates.
        issued_at: ISO-8601 UTC timestamp when the token was minted.
        expires_at: ISO-8601 UTC timestamp at which the token dies.
        refreshable: Whether the device can later exchange the token
            for a new one.  Currently always ``True``.
    """

    token: str
    device_id: str
    issued_at: str
    expires_at: str
    refreshable: bool = True


@dataclass(frozen=True)
class PairingChallenge:
    """The JSON payload rendered inside the QR code.

    The phone reads this, opens the ``endpoint`` URL and posts back the
    ``code`` and ``secret`` along with its own device metadata.

    Attributes:
        v: Schema version.  Currently always ``1``.
        host: Canonical host string the phone should display so the user
            can confirm they are pairing with the right desktop.
        code: The 8-character :attr:`PairingCode.code`.
        endpoint: Fully qualified URL the phone should POST to.
        expires_at: ISO-8601 UTC timestamp mirrored from the code.
        node_id: The desktop's own node_id, useful for logging on the
            phone side.
    """

    v: int
    host: str
    code: str
    endpoint: str
    expires_at: str
    node_id: str


__all__ = [
    "DeviceType",
    "PairingChallenge",
    "PairingCode",
    "PairedDevice",
    "SessionToken",
]
