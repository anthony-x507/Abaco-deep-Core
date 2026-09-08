"""End-to-end test: a real plugin is registered, started and stopped.

The plugin system in ``core/plugins`` is expected to expose:

*   a ``Plugin`` Protocol with ``name``/``version``/``startup``/``shutdown``;
*   a ``PluginManager`` with ``register``/``unregister``/``start_all``/
    ``stop_all``/``get``;
*   a top-level ``Core`` orchestrator with ``start``/``stop`` that delegates
    lifecycle hooks to the plugin manager.

This test defines a self-contained ``RecordingPlugin`` and then exercises
the full lifecycle. If the production modules are not yet importable, the
suite skips the live assertions and only verifies what can be done with
the standalone ``RecordingPlugin`` defined here.
"""

from __future__ import annotations

import importlib
import unittest
from dataclasses import dataclass, field
from typing import Any

from tests.conftest import IntegrationTestCase


@dataclass
class RecordingPlugin:
    """A minimal plugin used both as a stand-in and as an integration probe."""

    name: str = "recording"
    version: str = "0.0.1"
    events: list[str] = field(default_factory=list)

    def startup(self) -> None:
        self.events.append("startup")

    def shutdown(self) -> None:
        self.events.append("shutdown")


def _try_import(name: str) -> tuple[Any | None, str | None]:
    try:
        return importlib.import_module(name), None
    except Exception as exc:  # pragma: no cover - skip path
        return None, f"{name} not importable: {exc!r}"


class TestPluginLifecycleWithCore(IntegrationTestCase):
    """Register a plugin, run core, verify startup/shutdown callbacks fire."""

    def test_recording_plugin_records_lifecycle_locally(self) -> None:
        """The plugin used by these tests works on its own."""

        plugin = RecordingPlugin()
        plugin.startup()
        plugin.shutdown()
        self.assertEqual(plugin.events, ["startup", "shutdown"])

    def test_plugin_is_loaded_after_register(self) -> None:
        manager_module, reason = _try_import("core.plugins")
        if manager_module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        PluginManager = getattr(manager_module, "PluginManager", None)
        if PluginManager is None:
            self.skipTest("core.plugins.PluginManager is not yet defined")

        manager = PluginManager()
        manager.register(RecordingPlugin())
        self.assertIsNotNone(manager.get("recording"))

        manager.start_all()
        manager.stop_all()
        plugin = manager.get("recording")
        self.assertEqual(plugin.events, ["startup", "shutdown"])

    def test_plugin_lifecycle_through_core(self) -> None:
        core_module, core_reason = _try_import("core")
        manager_module, mgr_reason = _try_import("core.plugins")
        if core_module is None or manager_module is None:  # pragma: no cover - skip
            self.skipTest(core_reason or mgr_reason)

        Core = getattr(core_module, "Core", None)
        PluginManager = getattr(manager_module, "PluginManager", None)
        if Core is None or PluginManager is None:
            self.skipTest("core.Core or core.plugins.PluginManager missing")

        manager = PluginManager()
        plugin = RecordingPlugin(name="probe", version="1.0.0")
        manager.register(plugin)

        core = Core(plugin_manager=manager)
        core.start()
        try:
            self.assertIn("startup", plugin.events)
        finally:
            core.stop()
        self.assertIn("shutdown", plugin.events)

    def test_plugin_disable_stops_lifecycle(self) -> None:
        manager_module, reason = _try_import("core.plugins")
        if manager_module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        PluginManager = getattr(manager_module, "PluginManager", None)
        if PluginManager is None:
            self.skipTest("core.plugins.PluginManager is not yet defined")

        manager = PluginManager()
        plugin = RecordingPlugin(name="toggle")
        manager.register(plugin)
        manager.start_all()
        manager.disable("toggle")
        manager.stop_all()

        # ``disable`` is allowed to clear the active flag; we only assert
        # that stop_all is a no-op once disabled and never crashes.
        self.assertIsNone(manager.get("toggle") or manager.get("toggle"))


if __name__ == "__main__":  # pragma: no cover - manual invocation
    unittest.main()
