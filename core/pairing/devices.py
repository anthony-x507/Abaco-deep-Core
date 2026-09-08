"""Persistence for paired devices.

Devices are stored on disk as a single JSON document.  We do not use a
relational database here because:

* The list is tiny (a handful of phones per operator).
* We want zero external dependencies and atomic file replacement via
  ``os.replace`` is enough to guarantee consistency on crash.

The :class:`DeviceStore` is intentionally synchronous and process-local;
the API layer wraps it in a thread lock when serving concurrent
requests.
"""

from __future__ import annotations

import json
import os
import secrets
import tempfile
import threading
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from core.pairing.errors import DeviceStoreError, UnknownDeviceError
from core.pairing.models import PairedDevice, SessionToken


#: Default permissions granted to a freshly paired phone.  Read-only chat
#: access keeps the surface small while still proving the link works.
DEFAULT_PERMISSIONS: tuple[str, ...] = (
    "read_chat",
    "send_messages",
    "read_tickets",
)

#: Default permissions granted when the peer is another node (Mac/PC)
#: rather than a phone.  Nodes get full read/write access because they
#: run the same client and need parity with the desktop.
DEFAULT_NODE_PERMISSIONS: tuple[str, ...] = (
    "read_chat",
    "send_messages",
    "read_tickets",
    "write_tickets",
    "read_files",
    "write_files",
)


#: Canonical set of accepted :attr:`PairedDevice.device_type` values.
ALLOWED_DEVICE_TYPES: frozenset[str] = frozenset(
    {"ios", "android", "mac", "windows", "linux"}
)


#: TTL for a freshly issued session token.  Tokens can be refreshed
#: before they expire; a refresh mints a new token and replaces the old
#: one.
DEFAULT_SESSION_TTL_SECONDS: int = 30 * 24 * 60 * 60  # 30 days


def _now_iso_z() -> str:
    """Return ``datetime.now(UTC)`` as an ISO-8601 string with ``Z``."""

    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _device_from_dict(payload: dict[str, object]) -> PairedDevice:
    """Build a :class:`PairedDevice` from its JSON representation."""

    permissions = payload.get("permissions") or ()
    if isinstance(permissions, list):
        permissions_tuple: tuple[str, ...] = tuple(str(p) for p in permissions)
    else:
        permissions_tuple = tuple(permissions)  # type: ignore[arg-type]
    return PairedDevice(
        device_id=str(payload["device_id"]),
        device_name=str(payload["device_name"]),
        device_type=str(payload["device_type"]),
        node_id=payload.get("node_id") if payload.get("node_id") is not None else None,
        paired_at=str(payload["paired_at"]),
        last_seen_at=str(payload["last_seen_at"]),
        public_key=payload.get("public_key") if payload.get("public_key") is not None else None,
        permissions=permissions_tuple,
    )


def _session_from_dict(payload: dict[str, object]) -> SessionToken:
    """Build a :class:`SessionToken` from its JSON representation."""

    return SessionToken(
        token=str(payload["token"]),
        device_id=str(payload["device_id"]),
        issued_at=str(payload["issued_at"]),
        expires_at=str(payload["expires_at"]),
        refreshable=bool(payload.get("refreshable", True)),
    )


class DeviceStore:
    """JSON-on-disk store of paired devices and their session tokens.

    The store keeps the entire state in memory and flushes to disk on
    every mutation.  This is acceptable because the dataset is small and
    we want crash-resilience: a successful ``os.replace`` means the new
    state is durable.

    Args:
        path: Where the JSON document lives.  Parent directories are
            created on demand.
    """

    def __init__(self, path: os.PathLike[str] | str) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._devices: dict[str, PairedDevice] = {}
        self._sessions: dict[str, SessionToken] = {}
        self._load()

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load the JSON document from disk if it exists."""

        if not self._path.exists():
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            raise DeviceStoreError(f"cannot read device store: {exc}") from exc
        if not raw.strip():
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise DeviceStoreError(f"device store is corrupt: {exc.msg}") from exc
        if not isinstance(data, dict):
            raise DeviceStoreError("device store root must be a JSON object")
        devices_raw = data.get("devices") or []
        sessions_raw = data.get("sessions") or []
        if not isinstance(devices_raw, list) or not isinstance(sessions_raw, list):
            raise DeviceStoreError("device store entries must be arrays")
        self._devices = {
            str(entry["device_id"]): _device_from_dict(entry) for entry in devices_raw
        }
        self._sessions = {
            str(entry["token"]): _session_from_dict(entry) for entry in sessions_raw
        }

    def _flush(self) -> None:
        """Atomically write the in-memory state to disk."""

        payload = {
            "version": 1,
            "devices": [
                {
                    **asdict(device),
                    "permissions": list(device.permissions),
                }
                for device in self._devices.values()
            ],
            "sessions": [asdict(session) for session in self._sessions.values()],
        }
        serialised = json.dumps(payload, indent=2, sort_keys=True)
        # ``NamedTemporaryFile`` with ``delete=False`` lets us ``os.replace``
        # it on top of the target atomically on POSIX and Windows.
        directory = self._path.parent
        fd, tmp_name = tempfile.mkstemp(
            prefix=".devices-", suffix=".json.tmp", dir=directory
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(serialised)
            os.replace(tmp_name, self._path)
        except OSError as exc:
            # Best-effort cleanup of the stray temp file.
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise DeviceStoreError(f"cannot write device store: {exc}") from exc

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def path(self) -> Path:
        """Return the path the store was configured with."""

        return self._path

    def list_devices(self) -> tuple[PairedDevice, ...]:
        """Return all paired devices, sorted by ``paired_at`` ascending."""

        with self._lock:
            return tuple(
                sorted(self._devices.values(), key=lambda d: d.paired_at)
            )

    def get_device(self, device_id: str) -> PairedDevice | None:
        """Return the device with ``device_id`` or ``None`` if absent."""

        with self._lock:
            return self._devices.get(device_id)

    def add_device(
        self,
        *,
        device_name: str,
        device_type: str,
        node_id: str | None = None,
        public_key: str | None = None,
        permissions: Iterable[str] | None = None,
    ) -> PairedDevice:
        """Persist a freshly paired device and return it.

        Args:
            device_name: Human-readable name reported by the phone.
            device_type: One of ``ios``, ``android``, ``mac``, ``windows``,
                ``linux``.  Raises :class:`ValueError` for any other value.
            node_id: For Mac/PC peer pairings, the peer's node_id.
            public_key: Optional PEM-encoded key for future E2E.
            permissions: Override the default permission set.  ``None``
                selects the appropriate default based on ``device_type``.

        Returns:
            The newly created :class:`PairedDevice` with a fresh UUID.
        """

        if device_type not in ALLOWED_DEVICE_TYPES:
            raise ValueError(
                f"device_type must be one of {sorted(ALLOWED_DEVICE_TYPES)}"
            )
        if permissions is None:
            chosen_permissions = (
                DEFAULT_NODE_PERMISSIONS
                if device_type in {"mac", "windows", "linux"}
                else DEFAULT_PERMISSIONS
            )
        else:
            chosen_permissions = tuple(permissions)
        now = _now_iso_z()
        device = PairedDevice(
            device_id=f"dev-{uuid.uuid4()}",
            device_name=device_name,
            device_type=device_type,
            node_id=node_id,
            paired_at=now,
            last_seen_at=now,
            public_key=public_key,
            permissions=chosen_permissions,
        )
        with self._lock:
            self._devices[device.device_id] = device
            self._flush()
        return device

    def revoke_device(self, device_id: str) -> PairedDevice:
        """Remove ``device_id`` from the store.

        Raises:
            UnknownDeviceError: when no device with that id exists.
        """

        with self._lock:
            device = self._devices.pop(device_id, None)
            if device is None:
                raise UnknownDeviceError(f"unknown device_id: {device_id}")
            # Invalidate any session tokens belonging to the device.
            stale_tokens = [
                token for token, session in self._sessions.items()
                if session.device_id == device_id
            ]
            for token in stale_tokens:
                self._sessions.pop(token, None)
            self._flush()
        return device

    def touch_last_seen(self, device_id: str) -> PairedDevice:
        """Update ``last_seen_at`` for ``device_id`` to ``now``.

        Returns:
            The updated :class:`PairedDevice`.

        Raises:
            UnknownDeviceError: if ``device_id`` is unknown.
        """

        now = _now_iso_z()
        with self._lock:
            device = self._devices.get(device_id)
            if device is None:
                raise UnknownDeviceError(f"unknown device_id: {device_id}")
            updated = PairedDevice(
                device_id=device.device_id,
                device_name=device.device_name,
                device_type=device.device_type,
                node_id=device.node_id,
                paired_at=device.paired_at,
                last_seen_at=now,
                public_key=device.public_key,
                permissions=device.permissions,
            )
            self._devices[device_id] = updated
            self._flush()
        return updated

    # ------------------------------------------------------------------
    # Session tokens
    # ------------------------------------------------------------------

    def issue_session(
        self,
        device_id: str,
        *,
        ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS,
        ttl: int | None = None,
    ) -> SessionToken:
        """Mint a new :class:`SessionToken` for ``device_id``.

        The caller is responsible for verifying the device exists
        before calling this; if it does not exist we still record the
        token (the caller is presumably the validator which already
        validated the pairing code).
        """

        if ttl is not None:
            ttl_seconds = ttl
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        now = datetime.now(timezone.utc)
        expires = now + timedelta(seconds=ttl_seconds)
        token = SessionToken(
            token=secrets.token_hex(32),
            device_id=device_id,
            issued_at=now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            expires_at=expires.isoformat(timespec="seconds").replace("+00:00", "Z"),
            refreshable=True,
        )
        with self._lock:
            self._sessions[token.token] = token
            self._flush()
        return token

    def get_session(self, token: str) -> SessionToken | None:
        """Return the session for ``token`` or ``None`` if absent."""

        with self._lock:
            return self._sessions.get(token)

    def revoke_sessions_for_device(self, device_id: str) -> int:
        """Remove every session attached to ``device_id`` and return the count."""

        with self._lock:
            stale = [
                key for key, session in self._sessions.items()
                if session.device_id == device_id
            ]
            for key in stale:
                self._sessions.pop(key, None)
            if stale:
                self._flush()
        return len(stale)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def device_count(self) -> int:
        with self._lock:
            return len(self._devices)

    def session_count(self) -> int:
        with self._lock:
            return len(self._sessions)


__all__ = [
    "ALLOWED_DEVICE_TYPES",
    "DEFAULT_NODE_PERMISSIONS",
    "DEFAULT_PERMISSIONS",
    "DEFAULT_SESSION_TTL_SECONDS",
    "DeviceStore",
]
