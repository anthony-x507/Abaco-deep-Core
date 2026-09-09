"""Tests for :mod:`core.pairing.codes`."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone

from core.pairing.codes import (
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
from core.pairing.errors import InvalidPairingCodeError
from core.pairing.models import PairingCode


class TestGenerateCode(unittest.TestCase):
    def test_returns_pairing_code(self) -> None:
        code = generate_code(node_id="desktop-1")
        self.assertIsInstance(code, PairingCode)
        self.assertEqual(len(code.code), CODE_LENGTH)
        self.assertEqual(len(code.secret), SECRET_BYTES * 2)
        self.assertFalse(code.used)
        self.assertIsNone(code.used_by_device_id)

    def test_uses_alphabet(self) -> None:
        code = generate_code(node_id="desktop-1")
        for char in code.code:
            self.assertIn(char, CODE_ALPHABET)

    def test_unique_codes(self) -> None:
        seen = set()
        for _ in range(50):
            seen.add(generate_code(node_id="x").code)
        # At 40 bits of entropy the chance of collision in 50 draws is
        # astronomically small; assert that we did see variety.
        self.assertGreater(len(seen), 40)

    def test_secret_is_hex(self) -> None:
        code = generate_code(node_id="x")
        int(code.secret, 16)  # raises if not hex

    def test_ttl_default(self) -> None:
        frozen = datetime(2026, 1, 1, tzinfo=timezone.utc)

        def clock() -> datetime:
            return frozen

        code = generate_code(node_id="x", clock=clock)
        self.assertEqual(
            code.expires_at,
            (frozen + DEFAULT_CODE_TTL).isoformat(timespec="seconds").replace("+00:00", "Z"),
        )
        self.assertFalse(code_is_expired(code, clock=clock))
        self.assertTrue(code_is_expired(code, clock=lambda: frozen + DEFAULT_CODE_TTL + timedelta(seconds=1)))

    def test_ttl_custom(self) -> None:
        frozen = datetime(2026, 1, 1, tzinfo=timezone.utc)
        code = generate_code(node_id="x", ttl=timedelta(seconds=30), clock=lambda: frozen)
        self.assertEqual(
            code.expires_at,
            (frozen + timedelta(seconds=30)).isoformat(timespec="seconds").replace("+00:00", "Z"),
        )


class TestNormaliseCode(unittest.TestCase):
    def test_strips_and_uppercases(self) -> None:
        self.assertEqual(normalise_code("  abc23456  "), "ABC23456")

    def test_rejects_wrong_length(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            normalise_code("ABC")
        with self.assertRaises(InvalidPairingCodeError):
            normalise_code("ABCDEFGHI")

    def test_rejects_disallowed_chars(self) -> None:
        # ``0`` and ``O`` are excluded from the alphabet.
        with self.assertRaises(InvalidPairingCodeError):
            normalise_code("ABCO2345")
        with self.assertRaises(InvalidPairingCodeError):
            normalise_code("ABC02345")

    def test_rejects_non_string(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            normalise_code(12345)  # type: ignore[arg-type]


class TestChallengeSerialization(unittest.TestCase):
    def _code(self) -> PairingCode:
        return PairingCode(
            code="ABC23456",
            secret="s" * 64,
            expires_at="2026-01-01T00:05:00Z",
            created_at="2026-01-01T00:00:00Z",
            created_by_node_id="node-x",
        )

    def test_round_trip(self) -> None:
        code = self._code()
        challenge = build_challenge(
            code=code,
            endpoint="http://100.x.x.x:8765/api/pairing/verify",
            host="abaco://node-x.tailscale-host",
            node_id="node-x",
        )
        payload = challenge_to_json(challenge)
        decoded = challenge_from_json(payload)
        self.assertEqual(decoded, challenge)

    def test_challenge_carries_secret(self) -> None:
        """The QR payload is the full handshake: code *and* secret.

        A phone that scans the QR (and nothing else) must be able to
        complete ``/verify`` — that is only possible if the secret
        travels inside the challenge payload.
        """
        code = self._code()
        challenge = build_challenge(
            code=code,
            endpoint="http://100.x.x.x:8765/api/pairing/verify",
            host="abaco://node-x.tailscale-host",
            node_id="node-x",
        )
        self.assertEqual(challenge.secret, code.secret)
        payload = json.loads(challenge_to_json(challenge))
        self.assertEqual(payload["code"], code.code)
        self.assertEqual(payload["secret"], code.secret)
        self.assertEqual(payload["endpoint"], "http://100.x.x.x:8765/api/pairing/verify")

    def test_rejects_challenge_without_secret(self) -> None:
        """A v1 payload without a secret is not a usable challenge."""
        payload = json.dumps(
            {
                "v": 1,
                "host": "h",
                "code": "ABC23456",
                "endpoint": "http://x/api",
                "expires_at": "2026-01-01T00:05:00Z",
                "node_id": "n",
            }
        )
        with self.assertRaises(InvalidPairingCodeError):
            challenge_from_json(payload)

    def test_rejects_wrong_version(self) -> None:
        payload = json.dumps(
            {
                "v": 99,
                "host": "h",
                "code": "ABC23456",
                "endpoint": "http://x/api",
                "expires_at": "2026-01-01T00:05:00Z",
                "node_id": "n",
            }
        )
        with self.assertRaises(InvalidPairingCodeError):
            challenge_from_json(payload)

    def test_rejects_invalid_json(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            challenge_from_json("{not-json")

    def test_rejects_missing_fields(self) -> None:
        payload = json.dumps({"v": 1, "code": "ABC23456"})
        with self.assertRaises(InvalidPairingCodeError):
            challenge_from_json(payload)

    def test_rejects_non_object(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            challenge_from_json("[1,2,3]")

    def test_build_challenge_rejects_bad_endpoint(self) -> None:
        code = self._code()
        with self.assertRaises(ValueError):
            build_challenge(
                code=code,
                endpoint="ftp://broken",
                host="h",
                node_id="n",
            )


if __name__ == "__main__":
    unittest.main()
