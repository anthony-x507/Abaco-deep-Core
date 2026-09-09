"""End-to-end tests for the pairing FastAPI router."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover - fastapi optional in minimal installs
    TestClient = None  # type: ignore[assignment]

from core.pairing.api import build_router, create_app
from core.pairing.codes import challenge_from_json
from core.pairing.devices import DeviceStore, REMOTE_CONTROL_PERMISSIONS
from core.pairing.validator import PairingCodeRegistry


ADMIN_TOKEN = "test-admin-token"
ADMIN_HEADERS = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


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
            admin_token=ADMIN_TOKEN,
        )
        from fastapi import FastAPI

        self.app = FastAPI()
        self.app.include_router(self.router)
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _mint(self) -> dict:
        return self.client.post("/api/pairing/code", json={}).json()

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

    def test_qr_payload_contains_secret(self) -> None:
        """The QR JSON is a self-sufficient handshake payload."""
        created = self._mint()
        challenge = challenge_from_json(created["qr_payload"])
        self.assertEqual(challenge.code, created["code"])
        self.assertEqual(challenge.secret, created["secret"])

    def test_qr_endpoint_returns_png(self) -> None:
        created = self._mint()
        code = created["code"]
        resp = self.client.get(f"/api/pairing/qr/{code}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "image/png")
        self.assertTrue(resp.content.startswith(b"\x89PNG"))

    def test_qr_endpoint_unknown_code_is_404(self) -> None:
        resp = self.client.get("/api/pairing/qr/ZZZZZZZZ")
        self.assertEqual(resp.status_code, 404)

    def test_full_pairing_flow_from_qr_payload_only(self) -> None:
        """A phone that only knows what the QR contains can pair.

        This is the regression test for the core bug: previously the QR
        payload omitted the secret, so a phone that scanned the QR had
        no way to complete ``/verify``.
        """
        created = self._mint()
        challenge = challenge_from_json(created["qr_payload"])  # what the QR carries
        verify = self.client.post(
            "/api/pairing/verify",
            json={
                "code": challenge.code,
                "secret": challenge.secret,
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
                "code": challenge.code,
                "secret": challenge.secret,
                "device_name": "iPhone",
                "device_type": "ios",
            },
        )
        self.assertEqual(second.status_code, 409)

    def test_claimed_windows_phone_gets_no_file_permissions(self) -> None:
        """device_type is metadata: lying must not escalate permissions."""
        created = self._mint()
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "evil laptop",
                "device_type": "windows",
                "node_id": "claimed-peer-node",
            },
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        device = resp.json()["device"]
        self.assertEqual(tuple(device["permissions"]), REMOTE_CONTROL_PERMISSIONS)
        self.assertNotIn("read_files", device["permissions"])
        self.assertNotIn("write_files", device["permissions"])
        # Same guarantee at the store level.
        stored = self.store.list_devices()[0]
        self.assertEqual(stored.permissions, REMOTE_CONTROL_PERMISSIONS)

    def test_secret_mismatch_is_401(self) -> None:
        created = self._mint()
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
        created = self._mint()
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
        created = self._mint()
        self.client.post(
            "/api/pairing/verify",
            json={
                "code": created["code"],
                "secret": created["secret"],
                "device_name": "Pixel 8",
                "device_type": "android",
            },
        )
        resp = self.client.get("/api/paired-devices", headers=ADMIN_HEADERS)
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["devices"][0]["device_type"], "android")

    def test_list_devices_requires_admin_token(self) -> None:
        resp = self.client.get("/api/paired-devices")
        self.assertEqual(resp.status_code, 401)
        wrong = self.client.get(
            "/api/paired-devices",
            headers={"Authorization": "Bearer nope"},
        )
        self.assertEqual(wrong.status_code, 401)

    def test_revoke_device(self) -> None:
        created = self._mint()
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
        resp = self.client.delete(
            f"/api/paired-devices/{device_id}", headers=ADMIN_HEADERS
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.store.device_count(), 0)
        # A second revoke should now 404.
        again = self.client.delete(
            f"/api/paired-devices/{device_id}", headers=ADMIN_HEADERS
        )
        self.assertEqual(again.status_code, 404)

    def test_revoke_requires_admin_token(self) -> None:
        created = self._mint()
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
        self.assertEqual(resp.status_code, 401)

    def test_revoke_unknown_device_is_404(self) -> None:
        resp = self.client.delete(
            "/api/paired-devices/dev-missing", headers=ADMIN_HEADERS
        )
        self.assertEqual(resp.status_code, 404)

    def test_management_endpoints_absent_without_admin_token(self) -> None:
        """Fail closed: no token configured => no management endpoints."""
        router = build_router(
            registry=self.registry,
            store=self.store,
            node_id="node-test",
            endpoint_base="http://100.0.0.1:8765",
            admin_token=None,
        )
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        self.assertEqual(client.get("/api/paired-devices").status_code, 404)
        self.assertEqual(
            client.delete("/api/paired-devices/dev-x").status_code, 404
        )

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

    def test_x_forwarded_for_cannot_bypass_rate_limit(self) -> None:
        """Rate limiting keys on the socket peer, not on spoofable headers."""
        for idx in range(5):
            resp = self.client.post(
                "/api/pairing/verify",
                json={
                    "code": "ZZZZZZZZ",
                    "secret": "x",
                    "device_name": "evil",
                    "device_type": "android",
                },
                headers={"X-Forwarded-For": f"203.0.113.{idx}"},
            )
            self.assertEqual(resp.status_code, 400, resp.text)
        # A fresh spoofed X-Forwarded-For must NOT reset the budget.
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": "ZZZZZZZZ",
                "secret": "x",
                "device_name": "evil",
                "device_type": "android",
            },
            headers={"X-Forwarded-For": "203.0.113.200"},
        )
        self.assertEqual(resp.status_code, 429)

    def test_mint_is_rate_limited(self) -> None:
        from fastapi import FastAPI

        registry = PairingCodeRegistry()
        router = build_router(
            registry=registry,
            store=self.store,
            node_id="node-test",
            endpoint_base="http://100.0.0.1:8765",
            admin_token=ADMIN_TOKEN,
            mint_rate_limit_max_attempts=3,
        )
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        for _ in range(3):
            resp = client.post("/api/pairing/code", json={})
            self.assertEqual(resp.status_code, 200, resp.text)
        blocked = client.post("/api/pairing/code", json={})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["detail"]["error"], "rate_limited")

    def test_mint_and_verify_budgets_do_not_interfere(self) -> None:
        # Minting a handful of codes must not exhaust the verify budget.
        for _ in range(3):
            self._mint()
        resp = self.client.post(
            "/api/pairing/verify",
            json={
                "code": "ZZZZZZZZ",
                "secret": "x",
                "device_name": "evil",
                "device_type": "android",
            },
        )
        self.assertEqual(resp.status_code, 400)  # unknown code, not 429


class TestCreateApp(unittest.TestCase):
    def test_create_app_generates_and_exposes_admin_token(self) -> None:
        _require_test_client()
        with tempfile.TemporaryDirectory() as tmp:
            store_path = Path(tmp) / "state" / "devices.json"
            app = create_app(
                node_id="node-app",
                endpoint_base="http://127.0.0.1:8765",
                store_path=str(store_path),
            )
            self.assertTrue(app.state.admin_token)
            client = TestClient(app)
            # Mint works (bootstrap is open + rate limited) ...
            minted = client.post("/api/pairing/code", json={})
            self.assertEqual(minted.status_code, 200)
            # ... but device management needs the generated token.
            self.assertEqual(client.get("/api/paired-devices").status_code, 401)
            ok = client.get(
                "/api/paired-devices",
                headers={"Authorization": f"Bearer {app.state.admin_token}"},
            )
            self.assertEqual(ok.status_code, 200)
            self.assertTrue(ok.json()["ok"])

    def test_create_app_respects_admin_token_argument(self) -> None:
        _require_test_client()
        app = create_app(admin_token="chosen-token")
        client = TestClient(app)
        resp = client.get(
            "/api/paired-devices",
            headers={"Authorization": "Bearer chosen-token"},
        )
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
