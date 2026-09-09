"""Validation of pairing codes.

The validator is the only place that consumes a :class:`PairingCode` so
the rest of the system can rely on consistent error semantics:

* Unknown / malformed code → :class:`InvalidPairingCodeError` (→ HTTP 400)
* Expired code → :class:`ExpiredPairingCodeError` (→ HTTP 410)
* Already used → :class:`UsedPairingCodeError` (→ HTTP 409)
* Wrong secret → :class:`SecretMismatchError` (→ HTTP 401)

It also enforces per-IP rate limits so a brute force scan of the 40-bit
code space is impractical even though each code carries a 256-bit
secret.  Rate limits are bucketed so different endpoints never share a
budget:

* ``"verify"`` — attempts against ``POST /api/pairing/verify``
  (:data:`RATE_LIMIT_MAX_ATTEMPTS` per window).
* ``"mint"`` — attempts against ``POST /api/pairing/code``
  (:data:`MINT_RATE_LIMIT_MAX_ATTEMPTS` per window), so a LAN attacker
  cannot flood the desktop with pointless QR codes.

The pairing code registry is held in memory under a lock.  The store
itself does not need to be persistent: codes live for 5 minutes and a
restart nukes any in-flight codes, which is acceptable because the QR
on screen tells the user that scanning must happen in time.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Deque

from core.pairing.codes import code_is_expired, normalise_code
from core.pairing.errors import (
    ExpiredPairingCodeError,
    InvalidPairingCodeError,
    RateLimitedError,
    SecretMismatchError,
    UsedPairingCodeError,
)
from core.pairing.models import PairingCode


#: Default rate limit: at most this many verify attempts per IP per
#: ``RATE_LIMIT_WINDOW_SECONDS``.
RATE_LIMIT_MAX_ATTEMPTS: int = 5

#: Window over which :data:`RATE_LIMIT_MAX_ATTEMPTS` is counted.
RATE_LIMIT_WINDOW_SECONDS: int = 60

#: Default rate limit for code minting: at most this many mint attempts
#: per IP per ``MINT_RATE_LIMIT_WINDOW_SECONDS``.
MINT_RATE_LIMIT_MAX_ATTEMPTS: int = 10

#: Window over which :data:`MINT_RATE_LIMIT_MAX_ATTEMPTS` is counted.
MINT_RATE_LIMIT_WINDOW_SECONDS: int = 60


def _bucket_defaults(bucket: str, limit: int | None, window: int | None) -> tuple[int, int]:
    """Resolve rate-limit parameters for ``bucket``.

    Explicit ``limit``/``window`` overrides win; otherwise the defaults
    for the named bucket are used (``"verify"`` vs ``"mint"``).
    """

    if limit is None:
        limit = (
            MINT_RATE_LIMIT_MAX_ATTEMPTS
            if bucket == "mint"
            else RATE_LIMIT_MAX_ATTEMPTS
        )
    if window is None:
        window = (
            MINT_RATE_LIMIT_WINDOW_SECONDS
            if bucket == "mint"
            else RATE_LIMIT_WINDOW_SECONDS
        )
    return limit, window


class PairingCodeRegistry:
    """Thread-safe registry of in-flight pairing codes.

    The registry exposes the small set of operations the API needs:
    registering a freshly minted code, fetching one for the QR, and
    consuming one when the phone verifies it.  It also owns the per-IP
    rate-limit budgets for the two public pairing endpoints (see the
    module docstring for the bucket semantics).
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._codes: dict[str, PairingCode] = {}
        self._secrets: dict[str, str] = {}
        #: bucket name -> caller ip -> timestamps of recorded attempts.
        self._attempts: dict[str, dict[str, Deque[float]]] = {}

    # ------------------------------------------------------------------
    # Producer side
    # ------------------------------------------------------------------

    def register(self, code: PairingCode) -> None:
        """Store ``code`` so subsequent :meth:`verify` calls can find it."""

        with self._lock:
            self._codes[code.code] = code
            self._secrets[code.code] = code.secret

    def get(self, code: str) -> PairingCode | None:
        """Return the live code for ``code`` or ``None`` if unknown."""

        with self._lock:
            record = self._codes.get(normalise_code(code))
            if record is None:
                return None
            return replace(record)

    def discard(self, code: str) -> None:
        """Remove ``code`` from the registry."""

        with self._lock:
            self._codes.pop(code, None)
            self._secrets.pop(code, None)

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------

    def check_rate_limit(
        self,
        ip: str,
        *,
        bucket: str = "verify",
        limit: int | None = None,
        window_seconds: int | None = None,
        clock=None,
    ) -> None:
        """Raise :class:`RateLimitedError` if ``ip`` exceeded the budget.

        Args:
            ip: Caller IP (or any stable per-caller identifier).
            bucket: Which budget to charge — ``"verify"`` (default) or
                ``"mint"``.
            limit: Optional override of the bucket's max attempts.
            window_seconds: Optional override of the bucket's window.
            clock: Optional callable returning either ``float`` seconds
                (monotonic style, default) or ``datetime`` instances
                (wall-clock style, used by tests that already drive a
                ``datetime`` clock for expiry).  Datetimes are converted
                to a monotonic offset anchored at the Unix epoch.
        """

        max_attempts, window = _bucket_defaults(bucket, limit, window_seconds)
        moment = _to_moment(clock)
        window_start = moment - window
        with self._lock:
            bucket_ips = self._attempts.setdefault(bucket, {})
            stamps = bucket_ips.setdefault(ip, deque())
            while stamps and stamps[0] < window_start:
                stamps.popleft()
            if len(stamps) >= max_attempts:
                oldest = stamps[0]
                retry_after = max(1, int(window - (moment - oldest)))
                raise RateLimitedError(
                    f"too many pairing attempts from {ip}",
                    retry_after_seconds=retry_after,
                )

    def record_attempt(
        self,
        ip: str,
        *,
        bucket: str = "verify",
        clock=None,
    ) -> None:
        """Record that ``ip`` just attempted a call in ``bucket``."""

        moment = _to_moment(clock)
        with self._lock:
            bucket_ips = self._attempts.setdefault(bucket, {})
            bucket_ips.setdefault(ip, deque()).append(moment)

    # ------------------------------------------------------------------
    # Verification
    # ------------------------------------------------------------------

    def verify(
        self,
        *,
        code: str,
        secret: str,
        ip: str,
        clock=None,
    ) -> PairingCode:
        """Validate ``code`` and ``secret`` from a phone.

        Successful verification consumes the code (sets ``used`` to
        ``True``); the caller is expected to subsequently call
        :meth:`discard` once it has persisted the :class:`PairedDevice`.

        Raises:
            RateLimitedError: ``ip`` exceeded the verification budget.
            InvalidPairingCodeError: ``code`` is malformed or unknown.
            SecretMismatchError: ``code`` exists but ``secret`` is wrong.
            ExpiredPairingCodeError: ``code`` exists but TTL elapsed.
            UsedPairingCodeError: ``code`` was already redeemed.
        """

        normalised = normalise_code(code)
        self.check_rate_limit(ip, bucket="verify", clock=clock)
        # Always record the attempt — even malformed codes count, so an
        # attacker cannot probe the code space with malformed inputs.
        self.record_attempt(ip, bucket="verify", clock=clock)
        with self._lock:
            record = self._codes.get(normalised)
            stored_secret = self._secrets.get(normalised)
        if record is None or stored_secret is None:
            raise InvalidPairingCodeError("unknown pairing code")
        if code_is_expired(record, clock=_to_datetime_clock(clock)):
            raise ExpiredPairingCodeError(
                f"pairing code expired at {record.expires_at}"
            )
        if record.used:
            raise UsedPairingCodeError("pairing code already used")
        # Constant-time compare to avoid leaking timing information.
        if not secrets.compare_digest(stored_secret, str(secret)):
            raise SecretMismatchError("pairing code secret does not match")
        consumed = replace(record, used=True)
        with self._lock:
            self._codes[normalised] = consumed
        return consumed

    def mark_consumed(self, code: str, *, device_id: str) -> PairingCode:
        """Stamp ``used_by_device_id`` on ``code`` and return the record.

        The code stays in the registry (with ``used=True``) so that any
        subsequent attempted verification returns
        :class:`UsedPairingCodeError` rather than
        :class:`InvalidPairingCodeError`.  Call :meth:`discard` to
        remove the record from the registry once it is no longer
        useful for diagnostics.
        """

        normalised = normalise_code(code)
        with self._lock:
            record = self._codes.get(normalised)
            if record is None:
                raise InvalidPairingCodeError("unknown pairing code")
            stamped = replace(record, used=True, used_by_device_id=device_id)
            self._codes[normalised] = stamped
        return stamped


def _to_datetime_clock(clock):
    """Adapt a callable so it can drive :func:`codes.code_is_expired`.

    Production code passes ``None`` (the helper uses real wall time).
    Tests typically pass a callable returning ``datetime`` instances
    that have been advanced in lock-step with :func:`codes.generate_code`
    so that ``expires_at`` and the clock stay in sync.

    For monotonic clocks we convert the offset into a synthetic
    ``datetime`` anchored at the Unix epoch.  In that mode the test
    must also generate codes through a clock anchored at the same
    epoch so comparisons remain coherent.
    """

    if clock is None:
        return None
    sample = clock()
    if isinstance(sample, datetime):
        return clock

    def _wrapper() -> datetime:
        return datetime.fromtimestamp(0, tz=timezone.utc) + timedelta(
            seconds=float(clock())
        )

    return _wrapper


def _to_moment(clock) -> float:
    """Convert a clock callable into a monotonic-style ``float`` seconds.

    ``None`` uses :func:`time.monotonic`.  A ``datetime``-returning
    callable is converted into seconds since the Unix epoch so that
    arithmetic works the same way as in production.
    """

    if clock is None:
        return time.monotonic()
    sample = clock()
    if isinstance(sample, datetime):
        delta = sample - datetime.fromtimestamp(0, tz=timezone.utc)
        return delta.total_seconds()
    return float(sample)


__all__ = [
    "MINT_RATE_LIMIT_MAX_ATTEMPTS",
    "MINT_RATE_LIMIT_WINDOW_SECONDS",
    "PairingCodeRegistry",
    "RATE_LIMIT_MAX_ATTEMPTS",
    "RATE_LIMIT_WINDOW_SECONDS",
]
