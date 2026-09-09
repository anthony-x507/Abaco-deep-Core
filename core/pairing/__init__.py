"""Phone-pairing module for abaco-deep-core.

This package provides a complete QR-based device pairing flow:

* :mod:`core.pairing.codes` — generates one-time codes and builds the
  JSON challenge rendered inside the QR.
* :mod:`core.pairing.validator` — verifies codes presented by the
  phone, including rate limiting.
* :mod:`core.pairing.devices` — persists the list of paired devices
  to disk.
* :mod:`core.pairing.api` — FastAPI router exposing the pairing flow
  over HTTP.
* :mod:`core.pairing.models` — dataclasses shared across the package.
* :mod:`core.pairing.errors` — exception hierarchy.

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
    device = store.add_device(
        device_name="iPhone de Anthony", device_type="ios"
    )
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
    DEFAULT_NODE_PERMISSIONS,
    DEFAULT_PERMISSIONS,
    DEFAULT_SESSION_TTL_SECONDS,
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
    "DEFAULT_NODE_PERMISSIONS",
    "DEFAULT_PERMISSIONS",
    "DEFAULT_SESSION_TTL_SECONDS",
    "DeviceStore",
    "DeviceStoreError",
    "ExpiredPairingCodeError",
    "InvalidPairingCodeError",
    "PairingChallenge",
    "PairingCode",
    "PairingCodeRegistry",
    "PairingError",
    "PairedDevice",
    "RATE_LIMIT_MAX_ATTEMPTS",
    "RATE_LIMIT_WINDOW_SECONDS",
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
