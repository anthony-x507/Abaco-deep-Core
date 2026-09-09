"""Generation and parsing of pairing codes.

A pairing code is the short identifier shown in the QR.  It is meant
to be readable by humans (when displayed as text fallback) but short
enough to fit comfortably in a QR payload alongside the secret and the
endpoint URL.

The code uses an alphabet that excludes visually ambiguous characters
(``0``, ``O``, ``1``, ``I``) so that a user reading it off the screen
can re-type it if the camera scan fails.  The secret, by contrast, is
a 32-byte random value rendered as hex; **it travels in the QR payload**
and proves the scanner actually saw the QR rather than guessing.  The
secret is the only thing that lets a phone complete the pairing, so the
QR payload rendered here (see :func:`build_challenge` /
:func:`challenge_to_json`) always carries it — a phone that scans the QR
has everything it needs to call ``/api/pairing/verify``.

Because the secret is visible to anyone who can see the QR, the module
bounds its value: codes are single-use, expire after a short TTL, and a
successful redemption only ever yields the limited remote-control
permission set (never node file access).  See
:mod:`core.pairing.models` for the full security model.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Final

from core.pairing.errors import InvalidPairingCodeError
from core.pairing.models import PairingChallenge, PairingCode


#: Alphabet used for the short human-readable code.
#:
#: ``0``/``O`` and ``1``/``I``/``L`` are excluded because they are easy
#: to confuse on low-DPI screens.  We keep 32 symbols which is a nice
#: power of two so each character carries 5 bits of entropy.
CODE_ALPHABET: Final[str] = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

#: Length of the short code in characters.  8 characters * 5 bits/char
#: = 40 bits, well above the 32-bit entropy floor required for a
#: one-time code that also carries a 256-bit secret.
CODE_LENGTH: Final[int] = 8

#: Length of the random secret in bytes.  32 bytes = 256 bits.
SECRET_BYTES: Final[int] = 32

#: Default TTL for a freshly minted pairing code.
DEFAULT_CODE_TTL: Final[timedelta] = timedelta(minutes=5)

#: Schema version embedded in :class:`PairingChallenge` so future
#: revisions can be detected by the phone.
CHALLENGE_SCHEMA_VERSION: Final[int] = 1

#: Regular expression used to validate a code coming back from a phone.
#: Anchored, case-insensitive, no whitespace.
_CODE_RE: Final[re.Pattern[str]] = re.compile(r"^[A-HJ-NP-Z2-9]{8}$")


def _now_utc() -> datetime:
    """Return the current UTC time as a timezone-aware ``datetime``."""

    return datetime.now(timezone.utc)


def _isoformat_z(value: datetime) -> str:
    """Format a datetime as an ISO-8601 string with a ``Z`` suffix.

    The project standardizes on the ``Z`` form instead of ``+00:00`` to
    keep logs and JSON payloads identical across languages.
    """

    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def generate_code(*, node_id: str, ttl: timedelta = DEFAULT_CODE_TTL, clock=None) -> PairingCode:
    """Mint a fresh :class:`PairingCode`.

    Args:
        node_id: The desktop's own node_id, stored on the code so the
            desktop can later recognise codes it minted itself.
        ttl: How long the code stays valid.  Defaults to 5 minutes.
        clock: Optional callable returning ``datetime`` (UTC).  Useful
            in tests so the wall clock can be frozen.

    Returns:
        A new code with a freshly generated ``code`` and ``secret``.
        ``used`` is always ``False`` for a freshly minted code.
    """

    now = (clock or _now_utc)()
    expires = now + ttl
    code_chars = [secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH)]
    code = "".join(code_chars)
    secret = secrets.token_hex(SECRET_BYTES)
    return PairingCode(
        code=code,
        secret=secret,
        expires_at=_isoformat_z(expires),
        created_at=_isoformat_z(now),
        created_by_node_id=node_id,
        used=False,
        used_by_device_id=None,
    )


def normalise_code(raw: str) -> str:
    """Return ``raw`` normalised for storage or comparison.

    Strips surrounding whitespace and uppercases the input so users
    typing the code manually don't have to worry about case.  Raises
    :class:`InvalidPairingCodeError` if the result has the wrong shape.
    """

    if not isinstance(raw, str):  # type: ignore[unreachable]
        # Defensive: callers usually pass JSON-decoded strings, but the
        # validator may be invoked from non-JSON entry points too.
        raise InvalidPairingCodeError("code must be a string")
    candidate = raw.strip().upper()
    if not _CODE_RE.match(candidate):
        raise InvalidPairingCodeError(
            f"code must be {CODE_LENGTH} characters from {CODE_ALPHABET!r}"
        )
    return candidate


def code_is_expired(code: PairingCode, *, clock=None) -> bool:
    """Return ``True`` if the code's ``expires_at`` is in the past."""

    moment = clock or _now_utc
    deadline = datetime.fromisoformat(code.expires_at.replace("Z", "+00:00"))
    return moment() >= deadline


def build_challenge(
    *,
    code: PairingCode,
    endpoint: str,
    host: str,
    node_id: str,
) -> PairingChallenge:
    """Serialise a code into the JSON payload embedded in the QR.

    The payload carries the full handshake material — the short
    ``code`` **and** the one-time ``secret`` — so a phone that scans
    the QR can complete ``/api/pairing/verify`` without any manual
    transcription step.
    """

    if not endpoint.startswith(("http://", "https://", "abaco://")):
        raise ValueError("endpoint must be an http(s) or abaco:// URL")
    return PairingChallenge(
        v=CHALLENGE_SCHEMA_VERSION,
        host=host,
        code=code.code,
        secret=code.secret,
        endpoint=endpoint,
        expires_at=code.expires_at,
        node_id=node_id,
    )


def challenge_to_json(challenge: PairingChallenge) -> str:
    """Render a challenge as compact JSON for the QR encoder."""

    return json.dumps(
        {
            "v": challenge.v,
            "host": challenge.host,
            "code": challenge.code,
            "secret": challenge.secret,
            "endpoint": challenge.endpoint,
            "expires_at": challenge.expires_at,
            "node_id": challenge.node_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def challenge_from_json(payload: str) -> PairingChallenge:
    """Parse the JSON a phone receives after scanning the QR.

    Validates the schema version and the basic shape of the payload;
    detailed validation of the embedded URL happens upstream.  The
    ``secret`` field is required: since schema version ``1`` the QR is
    the full handshake payload and a challenge without a secret cannot
    complete the pairing.
    """

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise InvalidPairingCodeError(f"invalid JSON: {exc.msg}") from exc
    if not isinstance(data, dict):
        raise InvalidPairingCodeError("challenge payload must be a JSON object")
    version = data.get("v")
    if version != CHALLENGE_SCHEMA_VERSION:
        raise InvalidPairingCodeError(
            f"unsupported challenge schema version: {version!r}"
        )
    try:
        return PairingChallenge(
            v=version,
            host=str(data["host"]),
            code=normalise_code(str(data["code"])),
            secret=str(data["secret"]),
            endpoint=str(data["endpoint"]),
            expires_at=str(data["expires_at"]),
            node_id=str(data["node_id"]),
        )
    except KeyError as exc:  # pragma: no cover - defensive
        raise InvalidPairingCodeError(f"missing challenge field: {exc.args[0]}") from exc


__all__ = [
    "CHALLENGE_SCHEMA_VERSION",
    "CODE_ALPHABET",
    "CODE_LENGTH",
    "DEFAULT_CODE_TTL",
    "SECRET_BYTES",
    "build_challenge",
    "challenge_from_json",
    "challenge_to_json",
    "code_is_expired",
    "generate_code",
    "normalise_code",
]
