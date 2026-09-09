"""Phone-pairing module for abaco-deep-core.

This package provides a complete QR-based device pairing flow:

* :mod:`core.pairing.codes` — generates one-time codes and builds the
  JSON challenge rendered inside the QR (the QR payload carries the
  code *and* the one-time secret so the phone can complete the flow).
* :mod:`core.pairing.validator` — verifies codes presented by the
  phone, including per-IP rate limiting for both minting and
  verification.
* :mod:`core.pairing.devices` — persists the list of paired devices
  to disk (mode ``0o600``, location configurable).  Permissions are
  never inferred from a client-supplied ``device_type``.
* :mod:`core.pairing.api` — FastAPI router exposing the pairing flow
  over HTTP.  Device-management endpoints require an admin bearer
  token; mint and verify are rate limited per caller IP.
* :mod:`core.pairing.models` — dataclasses shared across the package.
* :mod:`core.pairing.errors` — exception hierarchy.

Security model: see the module docstring of
:mod:`core.pairing.api` (Option A — the QR carries the full handshake,
but a successful pairing only ever yields the limited remote-control
permission set, never node file access).

Quickstart::

    from datetime import timedelta
    from core.pairing import (
        DeviceStore, PairingCodeRegistry, generate_code,
    )

    store = DeviceStore("/var/lib/abaco/paired-devices.json")
    registry = PairingCodeRegistry()
    code = generate_code(node_id="desktop-001", ttl=timedelta(minutes=5))
    registry.register(code)

    # ... phone scans QR, calls /api/pairing/verify ...
    consumed = registry.verify(code=code.code, secret=code.secret, ip="100.x.x.x")
    device = store.add_device(device_name="iPhone de Anthony", device_type="ios")
    registry.mark_consumed(consumed.code, device_id=device.device_id)
    session = store.issue_session(device.device_id)
"""

from __future__ import annotations

from core.pairing.codes import (
    CHALLENGE_SCHEMA_VERSION,
    CODE_ALPHABET,
    CODE_LENGTH,
    DEFAULT_CODE_TTL,
    SECRET_BYTES,
    build_challenge,
    challenge_from_json,
    challenge_to_json,
    code_is_expired,
    generate_code,
    normalise_code,
)
from core.pairing.devices import (
    ALLOWED_DEVICE_TYPES,
    DEFAULT_SESSION_TTL_SECONDS,
    NODE_PERMISSIONS,
    REMOTE_CONTROL_PERMISSIONS,
    DeviceStore,
)
from core.pairing.errors import (
    DeviceStoreError,
    ExpiredPairingCodeError,
    InvalidPairingCodeError,
    PairingError,
    RateLimitedError,
    SecretMismatchError,
    UnknownDeviceError,
    UsedPairingCodeError,
)
from core.pairing.models import (
    PairingChallenge,
    PairingCode,
    PairedDevice,
    SessionToken,
)
from core.pairing.validator import (
    MINT_RATE_LIMIT_MAX_ATTEMPTS,
    MINT_RATE_LIMIT_WINDOW_SECONDS,
    PairingCodeRegistry,
    RATE_LIMIT_MAX_ATTEMPTS,
    RATE_LIMIT_WINDOW_SECONDS,
)

# ``api`` and its ``create_app`` factory are imported lazily because they
# require the optional ``fastapi`` and ``qrcode`` packages.  Importing
# them eagerly would break minimal installs that only rely on the
# in-memory helpers above.


__all__ = [
    "ALLOWED_DEVICE_TYPES",
    "CHALLENGE_SCHEMA_VERSION",
    "CODE_ALPHABET",
    "CODE_LENGTH",
    "DEFAULT_CODE_TTL",
    "DEFAULT_SESSION_TTL_SECONDS",
    "DeviceStore",
    "DeviceStoreError",
    "ExpiredPairingCodeError",
    "InvalidPairingCodeError",
    "MINT_RATE_LIMIT_MAX_ATTEMPTS",
    "MINT_RATE_LIMIT_WINDOW_SECONDS",
    "NODE_PERMISSIONS",
    "PairingChallenge",
    "PairingCode",
    "PairingCodeRegistry",
    "PairingError",
    "PairedDevice",
    "RATE_LIMIT_MAX_ATTEMPTS",
    "RATE_LIMIT_WINDOW_SECONDS",
    "REMOTE_CONTROL_PERMISSIONS",
    "RateLimitedError",
    "SECRET_BYTES",
    "SecretMismatchError",
    "SessionToken",
    "UnknownDeviceError",
    "UsedPairingCodeError",
    "build_challenge",
    "challenge_from_json",
    "challenge_to_json",
    "code_is_expired",
    "generate_code",
    "normalise_code",
]
