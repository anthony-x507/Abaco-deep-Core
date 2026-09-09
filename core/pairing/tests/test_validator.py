"""Tests for :mod:`core.pairing.validator`."""

from __future__ import annotations

import threading
import unittest
from datetime import datetime, timedelta, timezone
from typing import Iterator

from core.pairing.codes import generate_code
from core.pairing.errors import (
    ExpiredPairingCodeError,
    InvalidPairingCodeError,
    RateLimitedError,
    SecretMismatchError,
    UsedPairingCodeError,
)
from core.pairing.models import PairingCode
from core.pairing.validator import (
    MINT_RATE_LIMIT_MAX_ATTEMPTS,
    MINT_RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_MAX_ATTEMPTS,
    RATE_LIMIT_WINDOW_SECONDS,
    PairingCodeRegistry,
)


class _Clock:
    """A controllable datetime clock used by tests."""

    def __init__(self, start: datetime) -> None:
        self._now = start

    def __call__(self) -> datetime:
        return self._now

    def advance(self, delta: timedelta) -> None:
        self._now = self._now + delta


class TestVerifySuccess(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = PairingCodeRegistry()
        self.frozen = _Clock(datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc))
        self.code = generate_code(node_id="desktop-1", clock=self.frozen)
        self.registry.register(self.code)

    def test_happy_path(self) -> None:
        consumed = self.registry.verify(
            code=self.code.code,
            secret=self.code.secret,
            ip="100.0.0.1",
            clock=self.frozen,
        )
        self.assertTrue(consumed.used)
        self.assertEqual(consumed.code, self.code.code)

    def test_second_use_raises(self) -> None:
        self.registry.verify(
            code=self.code.code,
            secret=self.code.secret,
            ip="100.0.0.1",
            clock=self.frozen,
        )
        with self.assertRaises(UsedPairingCodeError):
            self.registry.verify(
                code=self.code.code,
                secret=self.code.secret,
                ip="100.0.0.1",
                clock=self.frozen,
            )

    def test_mark_consumed_records_device_id(self) -> None:
        stamped = self.registry.mark_consumed(self.code.code, device_id="dev-123")
        self.assertEqual(stamped.used_by_device_id, "dev-123")
        self.assertTrue(stamped.used)

    def test_normalises_case(self) -> None:
        # The phone may lowercase the code before submitting.
        consumed = self.registry.verify(
            code=self.code.code.lower(),
            secret=self.code.secret,
            ip="100.0.0.1",
            clock=self.frozen,
        )
        self.assertEqual(consumed.code, self.code.code)


class TestVerifyFailureModes(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = PairingCodeRegistry()
        self.frozen = _Clock(datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc))
        self.code = generate_code(node_id="desktop-1", clock=self.frozen)
        self.registry.register(self.code)

    def test_unknown_code(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            self.registry.verify(
                code="ZZZZZZZZ",
                secret="anything",
                ip="100.0.0.1",
                clock=self.frozen,
            )

    def test_secret_mismatch(self) -> None:
        with self.assertRaises(SecretMismatchError):
            self.registry.verify(
                code=self.code.code,
                secret="not-the-secret",
                ip="100.0.0.1",
                clock=self.frozen,
            )

    def test_expired_code(self) -> None:
        self.frozen.advance(timedelta(minutes=10))
        with self.assertRaises(ExpiredPairingCodeError):
            self.registry.verify(
                code=self.code.code,
                secret=self.code.secret,
                ip="100.0.0.1",
                clock=self.frozen,
            )

    def test_malformed_code(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            self.registry.verify(
                code="!!!",
                secret="x",
                ip="100.0.0.1",
                clock=self.frozen,
            )


class TestRateLimit(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = PairingCodeRegistry()
        self.frozen = _Clock(datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc))

    def _make_code(self) -> PairingCode:
        return generate_code(node_id="desktop-1", clock=self.frozen)

    def test_blocks_after_budget(self) -> None:
        # Use a code that doesn't exist so each attempt fails fast, but
        # each one still consumes the rate limit budget.
        ip = "100.0.0.99"
        for _ in range(RATE_LIMIT_MAX_ATTEMPTS):
            with self.assertRaises(InvalidPairingCodeError):
                self.registry.verify(
                    code="ZZZZZZZZ",
                    secret="x",
                    ip=ip,
                    clock=self.frozen,
                )
        with self.assertRaises(RateLimitedError) as ctx:
            self.registry.verify(
                code="ZZZZZZZZ",
                secret="x",
                ip=ip,
                clock=self.frozen,
            )
        self.assertGreater(ctx.exception.retry_after_seconds, 0)
        self.assertLessEqual(
            ctx.exception.retry_after_seconds, RATE_LIMIT_WINDOW_SECONDS
        )

    def test_separate_ips_have_independent_budgets(self) -> None:
        for _ in range(RATE_LIMIT_MAX_ATTEMPTS):
            with self.assertRaises(InvalidPairingCodeError):
                self.registry.verify(
                    code="ZZZZZZZZ", secret="x", ip="10.0.0.1", clock=self.frozen
                )
        # A different IP can still try.
        with self.assertRaises(InvalidPairingCodeError):
            self.registry.verify(
                code="ZZZZZZZZ", secret="x", ip="10.0.0.2", clock=self.frozen
            )

    def test_window_resets(self) -> None:
        ip = "10.0.0.3"
        for _ in range(RATE_LIMIT_MAX_ATTEMPTS):
            with self.assertRaises(InvalidPairingCodeError):
                self.registry.verify(
                    code="ZZZZZZZZ", secret="x", ip=ip, clock=self.frozen
                )
        # Advance past the window.
        self.frozen.advance(timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS + 1))
        with self.assertRaises(InvalidPairingCodeError):
            self.registry.verify(
                code="ZZZZZZZZ", secret="x", ip=ip, clock=self.frozen
            )


class TestMintRateLimit(unittest.TestCase):
    """The mint budget is separate from the verify budget."""

    def setUp(self) -> None:
        self.registry = PairingCodeRegistry()
        self.frozen = _Clock(datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc))

    def test_blocks_after_mint_budget(self) -> None:
        ip = "100.0.0.50"
        for _ in range(MINT_RATE_LIMIT_MAX_ATTEMPTS):
            self.registry.record_attempt(ip, bucket="mint", clock=self.frozen)
        with self.assertRaises(RateLimitedError) as ctx:
            self.registry.check_rate_limit(ip, bucket="mint", clock=self.frozen)
        self.assertGreater(ctx.exception.retry_after_seconds, 0)
        self.assertLessEqual(
            ctx.exception.retry_after_seconds, MINT_RATE_LIMIT_WINDOW_SECONDS
        )

    def test_mint_window_resets(self) -> None:
        ip = "100.0.0.51"
        for _ in range(MINT_RATE_LIMIT_MAX_ATTEMPTS):
            self.registry.record_attempt(ip, bucket="mint", clock=self.frozen)
        self.frozen.advance(timedelta(seconds=MINT_RATE_LIMIT_WINDOW_SECONDS + 1))
        self.registry.check_rate_limit(ip, bucket="mint", clock=self.frozen)  # no raise

    def test_mint_and_verify_budgets_are_independent(self) -> None:
        # Exhaust the verify budget for this IP ...
        ip = "100.0.0.52"
        for _ in range(RATE_LIMIT_MAX_ATTEMPTS):
            with self.assertRaises(InvalidPairingCodeError):
                self.registry.verify(
                    code="ZZZZZZZZ", secret="x", ip=ip, clock=self.frozen
                )
        with self.assertRaises(RateLimitedError):
            self.registry.verify(
                code="ZZZZZZZZ", secret="x", ip=ip, clock=self.frozen
            )
        # ... but the mint budget for the same IP is still untouched.
        self.registry.check_rate_limit(ip, bucket="mint", clock=self.frozen)

    def test_custom_bucket_limit_is_honoured(self) -> None:
        ip = "100.0.0.53"
        self.registry.record_attempt(ip, bucket="mint", clock=self.frozen)
        self.registry.record_attempt(ip, bucket="mint", clock=self.frozen)
        with self.assertRaises(RateLimitedError):
            self.registry.check_rate_limit(
                ip, bucket="mint", limit=2, window_seconds=60, clock=self.frozen
            )


class TestRegistryCRUD(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = PairingCodeRegistry()
        self.frozen = _Clock(datetime(2026, 1, 1, tzinfo=timezone.utc))
        self.code = generate_code(node_id="x", clock=self.frozen)
        self.registry.register(self.code)

    def test_get_returns_copy(self) -> None:
        snapshot = self.registry.get(self.code.code)
        self.assertEqual(snapshot, self.code)

    def test_get_returns_none_for_unknown(self) -> None:
        self.assertIsNone(self.registry.get("ZZZZZZZZ"))

    def test_discard_removes_code(self) -> None:
        self.registry.discard(self.code.code)
        self.assertIsNone(self.registry.get(self.code.code))


class TestRegistryConcurrency(unittest.TestCase):
    def test_concurrent_verifications(self) -> None:
        registry = PairingCodeRegistry()
        frozen = _Clock(datetime(2026, 1, 1, tzinfo=timezone.utc))
        codes = [generate_code(node_id="x", clock=frozen) for _ in range(20)]
        for code in codes:
            registry.register(code)

        successes: list[str] = []
        failures: list[Exception] = []
        lock = threading.Lock()

        def attempt(idx: int, code: PairingCode) -> None:
            try:
                consumed = registry.verify(
                    code=code.code,
                    secret=code.secret,
                    # Use a unique IP per attempt so the rate limiter
                    # does not interfere with the concurrency check.
                    ip=f"10.0.0.{idx + 1}",
                    clock=frozen,
                )
                with lock:
                    successes.append(consumed.code)
            except Exception as exc:  # pragma: no cover - debug helper
                with lock:
                    failures.append(exc)

        threads = [threading.Thread(target=attempt, args=(i, c)) for i, c in enumerate(codes)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(successes), len(codes))
        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main()
