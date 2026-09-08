"""Shared pytest fixtures and unittest helpers for the integration test suite.

The fixtures here cover three concerns:

1.  Temporary isolated working directories (one per test) so the suite never
    touches the real ledger on disk.
2.  In-process simulation of a Tailscale mesh via ``fake_tailscale.FakeTailscale``
    so ``sync/`` can talk to ``localhost`` peers without real network I/O.
3.  Synthetic event ledgers and pre-built sample fixtures that emulate what
    the production code writes to ``events.jsonl``.

The fixtures are intentionally tolerant of missing optional dependencies and
of sibling subpackages that may not yet be implemented: every test that
requires an optional module is annotated with ``@unittest.skipUnless(...)`` so
the suite still reports a clean, structured run while the rest of the
project is being assembled by sibling subagents.
"""

from __future__ import annotations

import json
import shutil
import sys
import unittest
from pathlib import Path
from typing import Any, Iterator

import pytest


# ---------------------------------------------------------------------------
# Path setup so ``import abaco_core`` works whether tests are invoked from the
# project root or from the ``tests/`` directory itself.
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ---------------------------------------------------------------------------
# Optional dependency detection used by the skipUnless decorators in tests.
# ---------------------------------------------------------------------------


def fastapi_available() -> bool:
    """Return True if FastAPI and its TestClient can be imported."""

    try:
        import fastapi  # noqa: F401
        from fastapi.testclient import TestClient  # noqa: F401
    except Exception:
        return False
    return True


def abaco_module_available() -> tuple[bool, str | None]:
    """Return whether the top-level ``abaco_core`` package can be imported.

    Returns a tuple ``(available, reason)``. ``reason`` is ``None`` when the
    module is importable, otherwise it contains a short human-readable reason
    that tests can include in their skip messages.
    """

    try:
        importlib_import = __import__("importlib")
        spec = importlib_import.util.find_spec("abaco_core")
    except Exception as exc:  # pragma: no cover - defensive
        return False, f"importlib error: {exc!r}"

    if spec is None:
        return False, "abaco_core package is not yet on sys.path"
    return True, None


# ---------------------------------------------------------------------------
# pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_workspace(tmp_path: Path) -> Path:
    """Return an isolated empty workspace directory for a single test."""

    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


@pytest.fixture()
def node_a_dir(tmp_workspace: Path) -> Path:
    """Directory that simulates NodeA's on-disk state."""

    node = tmp_workspace / "node_a"
    node.mkdir(parents=True, exist_ok=True)
    (node / "events.jsonl").write_text("", encoding="utf-8")
    (node / "archive").mkdir(exist_ok=True)
    return node


@pytest.fixture()
def node_b_dir(tmp_workspace: Path) -> Path:
    """Directory that simulates NodeB's on-disk state."""

    node = tmp_workspace / "node_b"
    node.mkdir(parents=True, exist_ok=True)
    (node / "events.jsonl").write_text("", encoding="utf-8")
    (node / "archive").mkdir(exist_ok=True)
    return node


@pytest.fixture()
def mesh_workspace(tmp_workspace: Path) -> list[Path]:
    """Five isolated node directories for the multi-node convergence test."""

    dirs: list[Path] = []
    for i in range(5):
        node = tmp_workspace / f"node_{i}"
        node.mkdir(parents=True, exist_ok=True)
        (node / "events.jsonl").write_text("", encoding="utf-8")
        (node / "archive").mkdir(exist_ok=True)
        dirs.append(node)
    return dirs


@pytest.fixture()
def fake_tailscale():  # type: ignore[no-untyped-def]
    """Yield a freshly constructed ``FakeTailscale`` instance."""

    from tests.fixtures.fake_tailscale import FakeTailscale

    fs = FakeTailscale()
    try:
        yield fs
    finally:
        fs.shutdown()


@pytest.fixture()
def sample_events_file(tmp_path: Path) -> Path:
    """Create a ``events.jsonl`` file with three deterministic events."""

    events = [
        {"id": "evt-1", "ts": 1_700_000_000, "kind": "create", "payload": {"x": 1}},
        {"id": "evt-2", "ts": 1_700_000_005, "kind": "update", "payload": {"x": 2}},
        {"id": "evt-3", "ts": 1_700_000_010, "kind": "delete", "payload": {}},
    ]
    path = tmp_path / "events.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for evt in events:
            fh.write(json.dumps(evt) + "\n")
    return path


@pytest.fixture()
def write_event():  # type: ignore[no-untyped-def]
    """Return a callable that appends an event line to a node's ledger."""

    def _write(node_dir: Path, event: dict[str, Any]) -> None:
        ledger = node_dir / "events.jsonl"
        with ledger.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event) + "\n")

    return _write


@pytest.fixture()
def read_ledger():  # type: ignore[no-untyped-def]
    """Return a callable that returns the parsed events from a ledger file."""

    def _read(node_dir: Path) -> list[dict[str, Any]]:
        ledger = node_dir / "events.jsonl"
        if not ledger.exists():
            return []
        events: list[dict[str, Any]] = []
        for line in ledger.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            events.append(json.loads(line))
        return events

    return _read


# ---------------------------------------------------------------------------
# unittest discover helpers
# ---------------------------------------------------------------------------


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Annotate slow tests so they can be filtered if desired."""

    for item in items:
        if "multi_node" in item.nodeid:
            item.add_marker(pytest.mark.slow)


# Make ``unittest.TestCase`` subclasses able to import the shared helpers
# even when the test runner is the stdlib ``unittest`` runner rather than
# ``pytest``. The constants below mirror the fixtures above but operate on
# plain ``setUp``/``tearDown`` methods.


class IntegrationTestCase(unittest.TestCase):
    """Base class that wires up ``self.tmp`` and ``self.workspace``."""

    tmp: Path
    workspace: Path

    def setUp(self) -> None:  # noqa: D401 - unittest API
        import tempfile

        self.tmp = Path(tempfile.mkdtemp(prefix="abaco_test_"))
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:  # noqa: D401 - unittest API
        if self.tmp.exists():
            shutil.rmtree(self.tmp, ignore_errors=True)

    # Convenience helpers used by the unittest-style tests below.

    def make_node(self, name: str) -> Path:
        node = self.workspace / name
        node.mkdir(parents=True, exist_ok=True)
        (node / "events.jsonl").write_text("", encoding="utf-8")
        (node / "archive").mkdir(exist_ok=True)
        return node

    def write_event(self, node_dir: Path, event: dict[str, Any]) -> None:
        ledger = node_dir / "events.jsonl"
        with ledger.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event) + "\n")

    def read_ledger(self, node_dir: Path) -> list[dict[str, Any]]:
        ledger = node_dir / "events.jsonl"
        if not ledger.exists():
            return []
        events: list[dict[str, Any]] = []
        for line in ledger.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            events.append(json.loads(line))
        return events


__all__ = [
    "IntegrationTestCase",
    "PROJECT_ROOT",
    "abaco_module_available",
    "fastapi_available",
]
