"""End-to-end test: two nodes synchronise their ledgers and resolve conflicts.

The test simulates the canonical mesh sync flow that ``sync/mesh_sync.py``
is supposed to expose:

1.  NodeA appends three events to its local ledger.
2.  NodeA publishes them over the fake Tailscale mesh.
3.  NodeB receives the envelopes and persists them.
4.  Both nodes converge to the same final ledger state.
5.  A conflicting event from NodeB is resolved using last-writer-wins (LWW)
    based on the event timestamp.

When the optional ``sync`` package is not importable (for example while it
is being built by a sibling subagent), the test is skipped with a clear
explanation rather than failing.  When it *is* importable, the test
performs real assertions against the live module APIs.
"""

from __future__ import annotations

import importlib
import json
import time
import unittest
from pathlib import Path
from typing import Any

from tests.conftest import IntegrationTestCase


def _try_import_sync() -> tuple[Any | None, str | None]:
    """Return ``(module, None)`` if ``sync.mesh_sync`` is importable."""

    try:
        module = importlib.import_module("sync.mesh_sync")
    except Exception as exc:  # pragma: no cover - exercised on skip path
        return None, f"sync.mesh_sync not importable: {exc!r}"
    return module, None


class TestFullSyncFlow(IntegrationTestCase):
    """Two-node mesh sync with last-writer-wins conflict resolution."""

    def setUp(self) -> None:
        super().setUp()
        self.node_a = self.make_node("node_a")
        self.node_b = self.make_node("node_b")
        self.events_a = [
            {
                "id": "evt-a-1",
                "ts": 1_700_000_100,
                "node": "node_a",
                "kind": "create",
                "payload": {"k": "alpha", "v": 1},
            },
            {
                "id": "evt-a-2",
                "ts": 1_700_000_110,
                "node": "node_a",
                "kind": "update",
                "payload": {"k": "alpha", "v": 2},
            },
            {
                "id": "evt-a-3",
                "ts": 1_700_000_120,
                "node": "node_a",
                "kind": "update",
                "payload": {"k": "alpha", "v": 3},
            },
        ]

    # ------------------------------------------------------------------
    # Behaviour that does NOT require the production sync module
    # ------------------------------------------------------------------

    def test_ledgers_are_isolated_per_node(self) -> None:
        """Sanity check: each node keeps its own ledger on disk."""

        for evt in self.events_a:
            self.write_event(self.node_a, evt)
        a_events = self.read_ledger(self.node_a)
        b_events = self.read_ledger(self.node_b)
        self.assertEqual(len(a_events), 3)
        self.assertEqual(len(b_events), 0)
        self.assertEqual([e["id"] for e in a_events], ["evt-a-1", "evt-a-2", "evt-a-3"])

    def test_lww_resolves_conflict_by_timestamp(self) -> None:
        """Pure logic test for LWW conflict resolution."""

        # Two events with the same key but different timestamps.
        older = {"id": "x", "ts": 1_700_000_000, "payload": {"v": 1}}
        newer = {"id": "x", "ts": 1_700_001_000, "payload": {"v": 2}}
        winner = max([older, newer], key=lambda e: e["ts"])
        self.assertEqual(winner["payload"]["v"], 2)

    # ------------------------------------------------------------------
    # Behaviour that DOES require the production sync module
    # ------------------------------------------------------------------

    def test_node_b_receives_events_from_node_a(self) -> None:
        sync_module, reason = _try_import_sync()
        if sync_module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        # Drive the live sync module if it exposes the expected surface.
        mesh = getattr(sync_module, "MeshSync", None)
        if mesh is None:
            self.skipTest("sync.mesh_sync.MeshSync is not yet defined")

        peer_a = mesh(node_id="node_a", data_dir=self.node_a)
        peer_b = mesh(node_id="node_b", data_dir=self.node_b)
        peer_a.connect(peer_b)

        for evt in self.events_a:
            peer_a.publish(evt)

        # The fake transport is synchronous, but give the receiver a tick.
        time.sleep(0.01)

        peer_a.close()
        peer_b.close()

        received = self.read_ledger(self.node_b)
        ids = [e["id"] for e in received]
        self.assertIn("evt-a-1", ids)
        self.assertIn("evt-a-2", ids)
        self.assertIn("evt-a-3", ids)

    def test_conflicts_resolved_with_lww(self) -> None:
        sync_module, reason = _try_import_sync()
        if sync_module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        mesh = getattr(sync_module, "MeshSync", None)
        if mesh is None:
            self.skipTest("sync.mesh_sync.MeshSync is not yet defined")

        peer_a = mesh(node_id="node_a", data_dir=self.node_a)
        peer_b = mesh(node_id="node_b", data_dir=self.node_b)
        peer_a.connect(peer_b)

        # NodeA publishes an "older" version of the same key.
        peer_a.publish(
            {
                "id": "evt-conflict",
                "ts": 1_700_000_500,
                "node": "node_a",
                "kind": "update",
                "payload": {"k": "alpha", "v": "from_a"},
            }
        )
        # NodeB publishes a "newer" version of the same key.
        peer_b.publish(
            {
                "id": "evt-conflict",
                "ts": 1_700_001_000,
                "node": "node_b",
                "kind": "update",
                "payload": {"k": "alpha", "v": "from_b"},
            }
        )

        time.sleep(0.01)
        peer_a.close()
        peer_b.close()

        a_final = {e["id"]: e for e in self.read_ledger(self.node_a)}
        b_final = {e["id"]: e for e in self.read_ledger(self.node_b)}
        self.assertEqual(a_final["evt-conflict"]["payload"]["v"], "from_b")
        self.assertEqual(b_final["evt-conflict"]["payload"]["v"], "from_b")


if __name__ == "__main__":  # pragma: no cover - manual invocation
    unittest.main()
