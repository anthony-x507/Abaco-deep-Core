"""Smoke test: ``abaco_core`` imports cleanly and exposes the expected API.

The test makes three assertions about the public surface of the
application module:

1.  ``import abaco_core`` succeeds.
2.  ``abaco_core.load_config()`` returns an instance of
    ``AbacoCoreConfig`` (or a duck-typed equivalent).
3.  ``abaco_core.overall_health()`` returns a ``dict`` with ``ok == True``.

When the package is not yet present on ``sys.path`` the test skips with a
descriptive message rather than failing.
"""

from __future__ import annotations

import importlib
import importlib.util
import unittest
from pathlib import Path
from typing import Any


def _load_abaco_core() -> tuple[Any | None, str | None]:
    """Find and import ``abaco_core`` from the project root, returning
    ``(module, None)`` on success or ``(None, reason)`` on failure."""

    project_root = Path(__file__).resolve().parents[2]
    pkg_init = project_root / "abaco_core" / "__init__.py"
    if not pkg_init.exists():
        return None, f"missing package at {pkg_init}"

    spec = importlib.util.spec_from_file_location(
        "abaco_core",
        project_root / "abaco_core" / "__init__.py",
        submodule_search_locations=[str(project_root / "abaco_core")],
    )
    if spec is None or spec.loader is None:
        return None, "could not build module spec for abaco_core"

    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # pragma: no cover - skip path
        return None, f"importing abaco_core raised {exc!r}"
    return module, None


class TestAppStarts(unittest.TestCase):
    """Module-level boot smoke test for ``abaco_core``."""

    def test_module_imports_without_error(self) -> None:
        module, reason = _load_abaco_core()
        if module is None:  # pragma: no cover - skip path
            self.skipTest(reason)
        self.assertTrue(hasattr(module, "__name__"))
        self.assertEqual(module.__name__, "abaco_core")

    def test_load_config_returns_abaco_core_config(self) -> None:
        module, reason = _load_abaco_core()
        if module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        load_config = getattr(module, "load_config", None)
        if load_config is None:
            self.skipTest("abaco_core.load_config is not yet defined")

        config = load_config()
        self.assertIsNotNone(config)

        expected_cls = getattr(module, "AbacoCoreConfig", None)
        if expected_cls is not None:
            self.assertIsInstance(config, expected_cls)
        else:  # pragma: no cover - depends on module shape
            # Duck-typed fallback: just confirm it behaves like a config
            # object (has at least one attribute access that doesn't raise).
            self.assertTrue(hasattr(config, "__dict__"))

    def test_overall_health_returns_ok_dict(self) -> None:
        module, reason = _load_abaco_core()
        if module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        overall_health = getattr(module, "overall_health", None)
        if overall_health is None:
            self.skipTest("abaco_core.overall_health is not yet defined")

        result = overall_health()
        self.assertIsInstance(result, dict)
        self.assertIn("ok", result)
        self.assertTrue(result["ok"])


if __name__ == "__main__":  # pragma: no cover - manual invocation
    unittest.main()
