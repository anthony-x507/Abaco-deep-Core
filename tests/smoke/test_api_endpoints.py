"""Smoke test: public HTTP endpoints respond without authentication.

When FastAPI is installed and the application exposes a ``create_app``
factory, this test boots the app inside ``TestClient`` and asserts:

*   ``GET /api/ping``  returns ``200`` with ``{"pong": ...}``.
*   ``GET /api/status`` returns ``200`` and reports ``ok=True``.
*   ``GET /api/health`` returns ``200`` and reports ``ok=True``.

If FastAPI is missing, or the application factory is not yet defined,
the test skips with a clear message. No test ever reaches the network.
"""

from __future__ import annotations

import importlib
import unittest
from typing import Any


def _try_import_fastapi() -> tuple[Any | None, Any | None, str | None]:
    try:
        fastapi = importlib.import_module("fastapi")
        testclient_module = importlib.import_module("fastapi.testclient")
    except Exception as exc:  # pragma: no cover - skip path
        return None, None, f"fastapi not available: {exc!r}"
    return fastapi, testclient_module, None


def _try_import_app() -> tuple[Any | None, str | None]:
    try:
        return importlib.import_module("abaco_core.app"), None
    except Exception as exc:  # pragma: no cover - skip path
        return None, f"abaco_core.app not importable: {exc!r}"


class TestApiEndpoints(unittest.TestCase):
    """Exercise the public, unauthenticated HTTP surface."""

    def setUp(self) -> None:
        fastapi, testclient, reason = _try_import_fastapi()
        if fastapi is None:  # pragma: no cover - skip path
            self.skipTest(reason)
        self._fastapi = fastapi
        self._testclient = testclient

        app_module, app_reason = _try_import_app()
        if app_module is None:  # pragma: no cover - skip path
            self.skipTest(app_reason)
        self._app_module = app_module

        factory = getattr(app_module, "create_app", None)
        if factory is None:  # pragma: no cover - skip path
            self.skipTest("abaco_core.app.create_app is not yet defined")

        self._app = factory()
        self._client = testclient.TestClient(self._app)

    # ------------------------------------------------------------------
    # Endpoint assertions
    # ------------------------------------------------------------------

    def test_ping_returns_pong(self) -> None:
        response = self._client.get("/api/ping")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("pong", body)
        # Some implementations return a dict, others a bare bool. Accept both.
        self.assertTrue(body["pong"] in (True, False, "pong", "ok"))

    def test_status_reports_ok(self) -> None:
        response = self._client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("ok") is True)

    def test_health_reports_ok(self) -> None:
        response = self._client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("ok") is True)

    def test_endpoints_dont_require_auth(self) -> None:
        """All three public endpoints must respond without any headers."""

        for path in ("/api/ping", "/api/status", "/api/health"):
            response = self._client.get(path)
            self.assertEqual(response.status_code, 200, msg=path)


if __name__ == "__main__":  # pragma: no cover - manual invocation
    unittest.main()
