"""Tests for :mod:`core.pairing.devices`."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

from core.pairing.devices import (
    ALLOWED_DEVICE_TYPES,
    DEFAULT_NODE_PERMISSIONS,
    DEFAULT_PERMISSIONS,
    DEFAULT_SESSION_TTL_SECONDS,
    DeviceStore,
)
from core.pairing.errors import DeviceStoreError, UnknownDeviceError
from core.pairing.models import PairedDevice


class TestDeviceStore(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "devices.json"
        self.store = DeviceStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_starts_empty(self) -> None:
        self.assertEqual(self.store.device_count(), 0)
        self.assertEqual(self.store.list_devices(), ())

    def test_add_phone_uses_default_permissions(self) -> None:
        device = self.store.add_device(device_name="iPhone de Anthony", device_type="ios")
        self.assertEqual(device.device_type, "ios")
        self.assertEqual(device.permissions, DEFAULT_PERMISSIONS)
        self.assertIsNone(device.node_id)
        self.assertEqual(self.store.device_count(), 1)

    def test_add_node_uses_extended_permissions(self) -> None:
        device = self.store.add_device(
            device_name="MacBook Pro",
            device_type="mac",
            node_id="mac-1",
        )
        self.assertEqual(device.permissions, DEFAULT_NODE_PERMISSIONS)
        self.assertEqual(device.node_id, "mac-1")

    def test_add_device_persists_to_disk(self) -> None:
        self.store.add_device(device_name="Pixel 8", device_type="android")
        self.assertTrue(self.path.exists())
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(payload["version"], 1)
        self.assertEqual(len(payload["devices"]), 1)
        self.assertEqual(len(payload["sessions"]), 0)

    def test_add_device_rejects_unknown_type(self) -> None:
        with self.assertRaises(ValueError):
            self.store.add_device(device_name="Windows Phone", device_type="windows-phone")

    def test_device_id_is_unique(self) -> None:
        first = self.store.add_device(device_name="A", device_type="ios")
        second = self.store.add_device(device_name="B", device_type="ios")
        self.assertNotEqual(first.device_id, second.device_id)
        self.assertEqual(self.store.device_count(), 2)

    def test_revoke_device(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        removed = self.store.revoke_device(device.device_id)
        self.assertEqual(removed.device_id, device.device_id)
        self.assertEqual(self.store.device_count(), 0)

    def test_revoke_unknown_raises(self) -> None:
        with self.assertRaises(UnknownDeviceError):
            self.store.revoke_device("dev-not-here")

    def test_revoke_invalidates_sessions(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        session = self.store.issue_session(device.device_id)
        self.assertIsNotNone(self.store.get_session(session.token))
        self.store.revoke_device(device.device_id)
        self.assertIsNone(self.store.get_session(session.token))

    def test_touch_last_seen_updates_timestamp(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        original_seen = device.last_seen_at
        # Sleep a hair so the wall clock advances at least one second.
        import time

        time.sleep(1.05)
        updated = self.store.touch_last_seen(device.device_id)
        self.assertNotEqual(updated.last_seen_at, original_seen)
        self.assertEqual(updated.device_id, device.device_id)

    def test_touch_last_seen_unknown_raises(self) -> None:
        with self.assertRaises(UnknownDeviceError):
            self.store.touch_last_seen("dev-missing")

    def test_list_devices_sorted_by_paired_at(self) -> None:
        # Pair in a deterministic order; rely on insertion order for the
        # sort stability (ISO strings sort chronologically).
        a = self.store.add_device(device_name="A", device_type="ios")
        b = self.store.add_device(device_name="B", device_type="android")
        self.assertEqual(self.store.list_devices(), (a, b))

    def test_get_device_returns_none_for_unknown(self) -> None:
        self.assertIsNone(self.store.get_device("dev-missing"))


class TestDeviceStoreSessionTokens(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "devices.json"
        self.store = DeviceStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_issue_session_records_token(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        session = self.store.issue_session(device.device_id)
        self.assertEqual(session.device_id, device.device_id)
        self.assertTrue(session.refreshable)
        self.assertEqual(len(session.token), 64)
        self.assertEqual(self.store.session_count(), 1)
        loaded = self.store.get_session(session.token)
        self.assertEqual(loaded, session)

    def test_issue_session_validates_ttl(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        with self.assertRaises(ValueError):
            self.store.issue_session(device.device_id, ttl_seconds=0)
        with self.assertRaises(ValueError):
            self.store.issue_session(device.device_id, ttl=-1)

    def test_revoke_sessions_for_device(self) -> None:
        device = self.store.add_device(device_name="A", device_type="ios")
        self.store.issue_session(device.device_id)
        self.store.issue_session(device.device_id)
        self.assertEqual(self.store.session_count(), 2)
        removed = self.store.revoke_sessions_for_device(device.device_id)
        self.assertEqual(removed, 2)
        self.assertEqual(self.store.session_count(), 0)


class TestDeviceStoreConcurrency(unittest.TestCase):
    """Make sure concurrent mutations don't lose writes."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "devices.json"
        self.store = DeviceStore(self.path)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_concurrent_adds_persist(self) -> None:
        def add(i: int) -> None:
            self.store.add_device(device_name=f"phone-{i}", device_type="ios")

        threads = [threading.Thread(target=add, args=(i,)) for i in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(self.store.device_count(), 20)
        # Reload from disk to confirm everything was flushed.
        reloaded = DeviceStore(self.path)
        self.assertEqual(reloaded.device_count(), 20)


class TestDeviceStoreCorruption(unittest.TestCase):
    def test_corrupt_json_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "devices.json"
            path.write_text("not json", encoding="utf-8")
            with self.assertRaises(DeviceStoreError):
                DeviceStore(path)

    def test_empty_file_is_ok(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "devices.json"
            path.write_text("", encoding="utf-8")
            store = DeviceStore(path)
            self.assertEqual(store.device_count(), 0)


class TestModuleConstants(unittest.TestCase):
    def test_allowed_device_types(self) -> None:
        self.assertEqual(
            ALLOWED_DEVICE_TYPES,
            frozenset({"ios", "android", "mac", "windows", "linux"}),
        )

    def test_default_permissions_present(self) -> None:
        self.assertIn("read_chat", DEFAULT_PERMISSIONS)
        self.assertIn("send_messages", DEFAULT_PERMISSIONS)
        self.assertIn("write_files", DEFAULT_NODE_PERMISSIONS)

    def test_default_session_ttl_is_thirty_days(self) -> None:
        self.assertEqual(DEFAULT_SESSION_TTL_SECONDS, 30 * 24 * 60 * 60)


class TestPairedDeviceShape(unittest.TestCase):
    def test_dataclass_is_frozen(self) -> None:
        device = PairedDevice(
            device_id="dev-x",
            device_name="A",
            device_type="ios",
            node_id=None,
            paired_at="2026-01-01T00:00:00Z",
            last_seen_at="2026-01-01T00:00:00Z",
        )
        with self.assertRaises(Exception):
            device.device_name = "B"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
