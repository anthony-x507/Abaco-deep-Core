"""FastAPI router for the pairing module.

The router exposes the following endpoints:

* ``POST /api/pairing/code``  - mint a fresh one-time code.
* ``GET  /api/pairing/qr/{code}`` - return the QR PNG for an existing code.
* ``POST /api/pairing/verify`` - phone-side completion handshake.
* ``GET  /api/paired-devices`` - list currently paired devices
  (requires the admin bearer token).
* ``DELETE /api/paired-devices/{device_id}`` - revoke a device
  (requires the admin bearer token).

Design & security model (chosen: Option A — secret in the QR, hardened)
-----------------------------------------------------------------------

The QR payload carries the full handshake material — short ``code``
plus one-time ``secret`` — so a phone that scans the QR can complete
``/api/pairing/verify`` on its own.  A credential visible in a QR is
inherently stealable, so its value is deliberately bounded:

1. Codes are single-use and expire after a short TTL (5 minutes).
2. Code minting **and** verification are rate-limited per caller IP.
3. Verification grants *only* the fixed remote-control permission set
   (:data:`~core.pairing.devices.REMOTE_CONTROL_PERMISSIONS`) — never
   node file access.  A phone that lies about being a ``windows``
   machine gets exactly the same limited set as one that reports
   ``ios``; elevated permissions require an explicit, authenticated
   grant outside this router.
4. The device-management endpoints (list/revoke) are protected by an
   admin bearer token.  When no token is configured they are not
   registered at all (fail closed) rather than left open.
5. Rate limiting keys on the *direct socket peer* address
   (``request.client``).  The ``X-Forwarded-For`` header is ignored
   because it is client-controlled and trivially spoofable.

Residual risks (documented): anyone who can see a live QR — or who can
reach the desktop over the network — can mint/claim a pairing before
the legitimate user.  All they obtain is one short-lived, limited
remote-control session, and the phone always displays the desktop
``host`` for the user to confirm before pairing.  Networks that expose
these endpoints should additionally require the mounting app to bind
them to a trusted interface (loopback/Tailscale) and serve them over
TLS.

The router ships with a stand-alone :func:`create_app` factory so it
can be exercised by tests without the rest of the project.

The endpoints use ``dict`` responses so the router can be mounted on
the project's main FastAPI app without coupling to a specific pydantic
model.  ``fastapi`` and ``pydantic`` are imported lazily so the rest of
the package keeps working on minimal installs.
"""

from __future__ import annotations

import base64
import io
import os
import secrets
import threading
from dataclasses import asdict
from typing import Any

from core.pairing.codes import (
    build_challenge,
    challenge_to_json,
    generate_code,
)
from core.pairing.devices import (
    ALLOWED_DEVICE_TYPES,
    DEFAULT_SESSION_TTL_SECONDS,
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
from core.pairing.models import PairedDevice
from core.pairing.validator import (
    MINT_RATE_LIMIT_MAX_ATTEMPTS,
    MINT_RATE_LIMIT_WINDOW_SECONDS,
    PairingCodeRegistry,
)


try:  # pragma: no cover - exercised only when fastapi is installed
    import qrcode as _qrcode
    from fastapi import APIRouter, FastAPI, Header, HTTPException, Request
    from fastapi.responses import Response
    from pydantic import BaseModel, Field

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised when fastapi is missing
    _qrcode = None  # type: ignore[assignment]
    APIRouter = None  # type: ignore[assignment]
    FastAPI = None  # type: ignore[assignment]
    Header = None  # type: ignore[assignment]
    HTTPException = None  # type: ignore[assignment]
    Request = None  # type: ignore[assignment]
    Response = None  # type: ignore[assignment]
    BaseModel = None  # type: ignore[assignment]
    Field = None  # type: ignore[assignment]
    _FASTAPI_AVAILABLE = False


def _require_fastapi() -> None:
    if not _FASTAPI_AVAILABLE:
        raise RuntimeError(
            "fastapi is not installed; install it with "
            "`pip install fastapi pydantic qrcode` to use the pairing HTTP API"
        )


def _require_qrcode() -> None:
    if _qrcode is None:
        raise RuntimeError(
            "qrcode is not installed; install it with `pip install qrcode[pil]`"
        )


# ----------------------------------------------------------------------
# Request models
# ----------------------------------------------------------------------


class _Base(BaseModel):  # type: ignore[misc]
    """Convenience alias so static analysers keep working."""

    model_config = {"extra": "forbid"}


class CodeRequest(_Base):  # type: ignore[misc]
    """Optional overrides for ``POST /api/pairing/code``."""

    node_id: str | None = Field(default=None, max_length=128)
    ttl_seconds: int | None = Field(default=None, ge=1, le=3600)


class VerifyRequest(_Base):  # type: ignore[misc]
    """Body for ``POST /api/pairing/verify``.

    Note that the client cannot request any permission set here —
    ``extra`` is forbidden and the granted permissions are fixed by the
    node (see :data:`~core.pairing.devices.REMOTE_CONTROL_PERMISSIONS`).
    """

    code: str = Field(..., min_length=1, max_length=64)
    secret: str = Field(..., min_length=1, max_length=256)
    device_name: str = Field(..., min_length=1, max_length=128)
    device_type: str = Field(..., min_length=1, max_length=32)
    node_id: str | None = Field(default=None, max_length=128)
    public_key: str | None = Field(default=None, max_length=4096)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _device_to_dict(device: PairedDevice) -> dict[str, Any]:
    payload = asdict(device)
    payload["permissions"] = list(device.permissions)
    return payload


def _render_qr_png(data: str) -> bytes:
    """Render ``data`` as a PNG using the ``qrcode`` library."""

    _require_qrcode()
    image = _qrcode.make(data)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _render_qr_data_url(data: str) -> str:
    """Return a ``data:image/png;base64,...`` URL for the QR."""

    png = _render_qr_png(data)
    encoded = base64.b64encode(png).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _client_ip(request) -> str:
    """Return the caller's direct socket peer address.

    ``X-Forwarded-For`` is deliberately ignored: it is client-controlled
    and trivially spoofable, so trusting it would let an attacker reset
    rate-limit budgets or impersonate another caller's IP.  Deployments
    behind a trusted reverse proxy must make the proxy rewrite the peer
    seen by the ASGI server (e.g. via ``--proxy-headers`` in uvicorn)
    instead of relying on the raw header here.
    """

    if hasattr(request, "client") and request.client is not None:
        return request.client.host or "unknown"
    return "unknown"


def _default_store_path() -> str:
    """Resolve the default on-disk store location.

    Prefers the ``ABACO_PAIRING_STORE_PATH`` environment variable so
    deployments can point the store at a private, persistent directory
    instead of the world-writable ``/tmp``.  The store file itself is
    always written with mode ``0o600`` (see
    :class:`core.pairing.devices.DeviceStore`).
    """

    return os.environ.get("ABACO_PAIRING_STORE_PATH", "/tmp/abaco-pairing-devices.json")


# ----------------------------------------------------------------------
# Router factory
# ----------------------------------------------------------------------


def build_router(
    *,
    registry: PairingCodeRegistry,
    store: DeviceStore,
    node_id: str,
    endpoint_base: str,
    host_label: str | None = None,
    code_ttl_seconds: int = 300,
    session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS,
    admin_token: str | None = None,
    mint_rate_limit_max_attempts: int = MINT_RATE_LIMIT_MAX_ATTEMPTS,
    mint_rate_limit_window_seconds: int = MINT_RATE_LIMIT_WINDOW_SECONDS,
) -> Any:
    """Build the FastAPI router.

    Args:
        registry: In-memory pairing code registry.
        store: Persistent store of paired devices.
        node_id: This desktop's node id, embedded in every QR.
        endpoint_base: Externally reachable URL of this desktop
            (e.g. ``http://100.x.x.x:8765``).
        host_label: Optional override for the ``host`` field rendered
            inside the QR.  Defaults to ``f"abaco://{node_id}.tailscale-host"``.
        code_ttl_seconds: TTL applied to freshly minted codes.
        session_ttl_seconds: TTL applied to freshly issued session tokens.
        admin_token: Secret used to authorize the device-management
            endpoints (``GET /paired-devices`` and
            ``DELETE /paired-devices/{device_id}``), sent as
            ``Authorization: Bearer <admin_token>``.  When ``None``
            (the default) those endpoints are **not registered** — the
            router fails closed rather than exposing device management
            without authentication.
        mint_rate_limit_max_attempts: Per-IP budget for code minting.
        mint_rate_limit_window_seconds: Window (seconds) for minting
            budget.

    Returns:
        A :class:`fastapi.APIRouter` instance ready to be mounted.
    """

    _require_fastapi()
    _require_qrcode()
    router = APIRouter(prefix="/api", tags=["pairing"])
    host = host_label or f"abaco://{node_id}.tailscale-host"

    def _raise_http_rate_limited(exc: RateLimitedError) -> HTTPException:
        return HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "retry_after_seconds": exc.retry_after_seconds,
                "message": str(exc),
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )

    @router.post("/pairing/code", response_model=None)
    def create_code(request: Request, body: CodeRequest | None = None) -> dict[str, Any]:
        # Minting is rate limited per caller IP so a LAN attacker cannot
        # flood the desktop with QR codes (each of which costs CPU to
        # render and occupies the in-memory registry for its TTL).
        ip = _client_ip(request)
        try:
            registry.check_rate_limit(
                ip,
                bucket="mint",
                limit=mint_rate_limit_max_attempts,
                window_seconds=mint_rate_limit_window_seconds,
            )
            registry.record_attempt(ip, bucket="mint")
        except RateLimitedError as exc:
            raise _raise_http_rate_limited(exc) from exc

        ttl = body.ttl_seconds if body and body.ttl_seconds else code_ttl_seconds
        effective_node = (
            body.node_id if body and body.node_id else node_id
        )
        code = generate_code(node_id=effective_node, ttl=_ttl_to_timedelta(ttl))
        registry.register(code)
        endpoint = f"{endpoint_base.rstrip('/')}/api/pairing/verify"
        challenge = build_challenge(
            code=code,
            endpoint=endpoint,
            host=host,
            node_id=effective_node,
        )
        qr_payload = challenge_to_json(challenge)
        return {
            "ok": True,
            "code": code.code,
            "secret": code.secret,
            "expires_at": code.expires_at,
            "created_at": code.created_at,
            "node_id": effective_node,
            "host": host,
            "endpoint": endpoint,
            "qr_payload": qr_payload,
            "qr_data_url": _render_qr_data_url(qr_payload),
        }

    @router.get("/pairing/qr/{code}")
    def get_qr(code: str) -> Response:
        record = registry.get(code)
        if record is None:
            raise HTTPException(status_code=404, detail="unknown pairing code")
        endpoint = f"{endpoint_base.rstrip('/')}/api/pairing/verify"
        challenge = build_challenge(
            code=record,
            endpoint=endpoint,
            host=host,
            node_id=record.created_by_node_id,
        )
        png = _render_qr_png(challenge_to_json(challenge))
        return Response(content=png, media_type="image/png")

    @router.post("/pairing/verify", response_model=None)
    def verify(request: Request, body: VerifyRequest) -> dict[str, Any]:
        ip = _client_ip(request)
        # device_type is validated for metadata sanity only — see
        # ``REMOTE_CONTROL_PERMISSIONS``: the permission grant below is
        # fixed and independent of anything the client declares.
        if body.device_type not in ALLOWED_DEVICE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "device_type must be one of "
                    f"{sorted(ALLOWED_DEVICE_TYPES)}"
                ),
            )
        try:
            consumed = registry.verify(
                code=body.code,
                secret=body.secret,
                ip=ip,
            )
        except RateLimitedError as exc:
            raise _raise_http_rate_limited(exc) from exc
        except InvalidPairingCodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except SecretMismatchError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except ExpiredPairingCodeError as exc:
            raise HTTPException(status_code=410, detail=str(exc)) from exc
        except UsedPairingCodeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except PairingError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        try:
            device = store.add_device(
                device_name=body.device_name,
                device_type=body.device_type,
                node_id=body.node_id,
                public_key=body.public_key,
                # The node-side grant: every device that completes the QR
                # flow gets the limited remote-control set.  Never more,
                # regardless of what the client claimed about itself.
                permissions=REMOTE_CONTROL_PERMISSIONS,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except DeviceStoreError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        registry.mark_consumed(consumed.code, device_id=device.device_id)
        try:
            session = store.issue_session(
                device.device_id, ttl_seconds=session_ttl_seconds
            )
        except DeviceStoreError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "ok": True,
            "device_id": device.device_id,
            "device": _device_to_dict(device),
            "session_token": session.token,
            "session_expires_at": session.expires_at,
            "node_id": consumed.created_by_node_id,
        }

    # Device-management endpoints: only registered when an admin token is
    # configured.  With ``admin_token=None`` they do not exist at all, so
    # there is no unauthenticated path that can list or revoke devices.
    if admin_token is not None:

        def _authorize_admin(authorization: str | None) -> None:
            expected = f"Bearer {admin_token}"
            if not authorization or not secrets.compare_digest(authorization, expected):
                raise HTTPException(
                    status_code=401,
                    detail="a valid admin bearer token is required",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        @router.get("/paired-devices", response_model=None)
        def list_devices(
            authorization: str | None = Header(default=None),
        ) -> dict[str, Any]:
            _authorize_admin(authorization)
            devices = store.list_devices()
            return {
                "ok": True,
                "count": len(devices),
                "devices": [_device_to_dict(d) for d in devices],
            }

        @router.delete("/paired-devices/{device_id}", response_model=None)
        def revoke(
            device_id: str,
            authorization: str | None = Header(default=None),
        ) -> dict[str, Any]:
            _authorize_admin(authorization)
            try:
                removed = store.revoke_device(device_id)
            except UnknownDeviceError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except DeviceStoreError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            return {
                "ok": True,
                "revoked": _device_to_dict(removed),
            }

    return router


def _ttl_to_timedelta(seconds: int):  # type: ignore[no-untyped-def]
    from datetime import timedelta

    return timedelta(seconds=seconds)


# ----------------------------------------------------------------------
# Stand-alone app
# ----------------------------------------------------------------------


def create_app(
    *,
    node_id: str | None = None,
    endpoint_base: str = "http://127.0.0.1:8765",
    store_path: str | None = None,
    registry: PairingCodeRegistry | None = None,
    store: DeviceStore | None = None,
    admin_token: str | None = None,
) -> Any:
    """Build a stand-alone FastAPI app for the pairing module.

    The default configuration uses an in-memory device store unless
    ``store_path`` is given.  When no ``store_path`` is given either,
    the store location is resolved from the ``ABACO_PAIRING_STORE_PATH``
    environment variable (falling back to a ``/tmp`` path; the file is
    always written with mode ``0o600``).

    If no ``admin_token`` is supplied, a random one is generated and
    exposed on ``app.state.admin_token`` so the process that owns the
    app (e.g. the desktop UI) can call the device-management endpoints.
    Treat it as a secret.
    """

    _require_fastapi()
    _require_qrcode()
    effective_node = node_id or "node-local"
    if store is None:
        if store_path is None:
            store_path = _default_store_path()
        store = DeviceStore(store_path)
    registry = registry or PairingCodeRegistry()
    effective_admin_token = admin_token or secrets.token_urlsafe(32)
    app = FastAPI(title="abaco-deep-core pairing API", version="0.1.0")
    app.state.admin_token = effective_admin_token
    app.include_router(
        build_router(
            registry=registry,
            store=store,
            node_id=effective_node,
            endpoint_base=endpoint_base,
            admin_token=effective_admin_token,
        )
    )
    return app


__all__ = [
    "CodeRequest",
    "VerifyRequest",
    "build_router",
    "create_app",
    "DeviceStore",
    "PairingCodeRegistry",
]
