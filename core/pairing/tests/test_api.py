"""End-to-end tests for the pairing FastAPI router."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover - fastapi optional in minimal installs
    TestClient = None  # type: ignore[assignment]

from core.pairing.api import build_router
from core.pairing.devices import DeviceStore
from core.pairing.validator import PairingCodeRegistry


def _require_test_client() -> None:
    if TestClient is None:
        raise unittest.SkipTest("fastapi is not installed")


class TestPairingAPI(unittest.TestCase):
    def setUp(self) -> None:
        _require_test_client()
        self.tmp = tempfile.TemporaryDirectory()
        self.store = DeviceStore(Path(self.tmp.name) / "devices.json")
        self.registry = PairingCodeRegistry()
        self.router = build_router(
            registry=self.registry,
            store=self.store,
            node_id="node-test",
            endpoint_base="http://100.0.0.1:8765",
        )
        from fastapi import FastAPI

        self.app = FastAPI()
        self.app.include_router(self.router)
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_create_code_returns_qr_payload(self) -> None:
        resp = self.client.post("/api/pairing/code", json={})
        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(len(payload["code"]), 8)
        self.assertTrue(payload["qr_data_url"].startswith("data:image/png;base64,"))
        self.assertEqual(payload["endpoint"], "http://100.0.0.1:8765/api/pairing/verify")
        # Stored in registry.
        self.assertIsNotNone(self.registry.get(payload["code"]))

    def test_qr_endpoint_returns_png(self) -> None:
        created = self.client.post("/api/pairing/code", json={}).json()
        code = created["code"]
        resp = self.client.get(f"/api/pairing/qr/{code}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "image/png")
        self.assertTrue(resp.content.startswith(b"\x89PNG"))

    def test_qr_endpoint_unknown_code_is_404(self) -> None:
        resp = self.client.get("/api/pairing/qr/ZZZZZZZZ")
        self.assertEqual(resp.status_code, 404)

    def test_full_pairing_flow(self) -> None:
        created = self.client.post("/api/pairing/code", json={}).json()
        verify = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "iPhone de Anthony",
                "device_type": "ios",
            },
        )
        self.assertEqual(verify.status_code, 200, verify.text)
        data = verify.json()
        self.assertTrue(data["ok"])
        self.assertIn("device_id", data)
        self.assertEqual(len(data["session_token"]), 64)
        self.assertEqual(data["device"]["device_type"], "ios")

        # The code is now consumed; a second verify must fail.
        second = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "iPhone",
                "device_type": "ios",
            },
        )
        self.assertEqual(second.status_code, 409)

    def test_secret_mismatch_is_401(self) -> None:
        created = self.client.post("/api/pairing/code", json={}).json()
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": "wrong-secret",
                "device_name": "evil phone",
                "device_type": "android",
            },
        )
        self.assertEqual(resp.status_code, 401)

    def test_unknown_code_is_400(self) -> None:
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": "ZZZZZZZZ",
                "secret": "x",
                "device_name": "evil",
                "device_type": "android",
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_invalid_device_type_is_400(self) -> None:
        created = self.client.post("/api/pairing/code", json={}).json()
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "evil",
                "device_type": "windows-phone",
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_list_devices(self) -> None:
        # Pair one device first.
        created = self.client.post("/api/pairing/code", json={}).json()
        self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "Pixel 8",
                "device_type": "android",
            },
        )
        resp = self.client.get("/api/paired-devices")
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["devices"][0]["device_type"], "android")

    def test_revoke_device(self) -> None:
        created = self.client.post("/api/pairing/code", json={}).json()
        verify = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "Pixel 8",
                "device_type": "android",
            },
        ).json()
        device_id = verify["device_id"]
        resp = self.client.delete(f"/api/paired-devices/{device_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.store.device_count(), 0)
        # A second revoke should now 404.
        again = self.client.delete(f"/api/paired-devices/{device_id}")
        self.assertEqual(again.status_code, 404)

    def test_revoke_unknown_device_is_404(self) -> None:
        resp = self.client.delete("/api/paired-devices/dev-missing")
        self.assertEqual(resp.status_code, 404)

    def test_rate_limit_blocks_after_five_attempts(self) -> None:
        for _ in range(5):
            self.client.post(
                "/api/pairing/verify",
                json={
                    "code": "ZZZZZZZZ",
                    "secret": "x",
                    "device_name": "evil",
                    "device_type": "android",
                },
            )
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": "ZZZZZZZZ",
                "secret": "x",
                "device_name": "evil",
                "device_type": "android",
            },
        )
        self.assertEqual(resp.status_code, 429)
        self.assertIn("retry_after_seconds", resp.json()["detail"])
        self.assertIn("Retry-After", resp.headers)


if __name__ == "__main__":
    unittest.main()
