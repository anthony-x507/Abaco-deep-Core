"""Data classes shared across the pairing module.

The pairing flow has two main entities:

* :class:`PairingCode` — a short-lived, one-time credential produced by
  the desktop and rendered as a QR code so a phone can claim it.
* :class:`PairedDevice` — a record of a phone that successfully
  redeemed a :class:`PairingCode`.  Each device gets a stable
  ``device_id`` (UUID4) that the desktop uses to address it later and
  a session token that the phone uses to authenticate subsequent
  calls.

Security model (Option A: secret-in-QR, hardened)
-------------------------------------------------

The QR payload (the :class:`PairingChallenge`) carries the pairing
``secret``.  Anyone who can see the QR therefore obtains a usable
credential, so the module is designed so that credential is worth as
little as possible:

* the code is single-use and expires after a short TTL (5 minutes by
  default);
* both code minting and code verification are rate-limited per caller
  IP;
* verification **never** grants anything more than the fixed
  remote-control permission set (see :data:`REMOTE_CONTROL_PERMISSIONS`
  in :mod:`core.pairing.devices`).  The permissions a device ends up
  with are decided by the desktop node, not by anything the phone
  claims about itself.

Because of the last point, ``device_type`` (and ``node_id``) are
**descriptive metadata only**.  A phone that lies and reports
``device_type="windows"`` still gets the same limited permission set as
a phone that reports ``"ios"``.  Elevated node-style permissions
(``read_files``/``write_files``/...) can only be granted explicitly by
an authenticated caller of
:meth:`core.pairing.devices.DeviceStore.add_device` — never inferred
from a client-supplied field.

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
    and the ``secret`` is a long random token bundled with the QR so the
    phone can prove it actually scanned the code rather than guessing.

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
            layer validates against the canonical set.  **Metadata
            only** — permissions are never derived from this value.
        node_id: For Mac/PC pairings, the node_id of the peer.  ``None``
            for phones.  Descriptive metadata only.
        paired_at: ISO-8601 UTC timestamp at which the pair completed.
        last_seen_at: ISO-8601 UTC timestamp of the most recent
            authenticated request from this device.
        public_key: Optional PEM-encoded public key reserved for future
            end-to-end encryption.  ``None`` for now.
        permissions: Tuple of capability strings granted to this device.
            Chosen by the desktop node at pairing time — never inferred
            from :attr:`device_type`.  Devices paired through the QR
            flow always receive the limited remote-control set (see
            :data:`core.pairing.devices.REMOTE_CONTROL_PERMISSIONS`).
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

    This is the *complete* handshake payload: it carries both the short
    ``code`` and the one-time ``secret`` so a phone that scans the QR
    has everything it needs to call ``POST /api/pairing/verify`` and
    complete the pairing without any manual transcription.  The phone
    reads this, opens the ``endpoint`` URL and posts back the ``code``
    and ``secret`` along with its own device metadata.

    Attributes:
        v: Schema version.  Currently always ``1``.
        host: Canonical host string the phone should display so the user
            can confirm they are pairing with the right desktop.
        code: The 8-character :attr:`PairingCode.code`.
        secret: The 64-character hex :attr:`PairingCode.secret`.  This
            is a single-use, short-lived credential; anyone able to read
            the QR can present it, so it only ever buys a single limited
            remote-control session.
        endpoint: Fully qualified URL the phone should POST to.
        expires_at: ISO-8601 UTC timestamp mirrored from the code.
        node_id: The desktop's own node_id, useful for logging on the
            phone side.
    """

    v: int
    host: str
    code: str
    secret: str
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
