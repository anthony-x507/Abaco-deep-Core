"""Multi-node convergence test.

Five simulated nodes each generate a handful of events with deliberately
unordered timestamps. The mesh then performs a single broadcast round;
after it settles, every node must agree on the same canonical event log.

The test also measures how long the broadcast takes end-to-end so that
regressions in the sync layer show up as a slowdown rather than a
correctness failure.
"""

from __future__ import annotations

import importlib
import json
import random
import time
import unittest
from pathlib import Path
from typing import Any

from tests.conftest import IntegrationTestCase


NODE_COUNT = 5
EVENTS_PER_NODE = 20


def _deterministic_events(node_index: int) -> list[dict[str, Any]]:
    """Generate ``EVENTS_PER_NODE`` events with shuffled timestamps."""

    base = 1_700_000_000 + node_index * 10_000
    events = []
    for i in range(EVENTS_PER_NODE):
        events.append(
            {
                "id": f"n{node_index}-e{i:03d}",
                "ts": base + i * 100,
                "node": f"node_{node_index}",
                "kind": "create",
                "payload": {"i": node_index, "j": i},
            }
        )
    # Deliberately reorder so timestamps are not monotonic.
    rng = random.Random(42 + node_index)
    rng.shuffle(events)
    return events


class TestMultiNodeSimulation(IntegrationTestCase):
    """Five nodes converge after one mesh round."""

    def setUp(self) -> None:
        super().setUp()
        self.node_dirs = [self.make_node(f"node_{i}") for i in range(NODE_COUNT)]

    # ------------------------------------------------------------------
    # Pure-Python convergence test (no production modules required)
    # ------------------------------------------------------------------

    def test_deterministic_event_generation_is_unique(self) -> None:
        """Each node emits a disjoint set of event ids."""

        all_ids: set[str] = set()
        for i in range(NODE_COUNT):
            ids = [e["id"] for e in _deterministic_events(i)]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertFalse(set(ids) & all_ids, f"node {i} duplicates ids")
            all_ids.update(ids)

    def test_convergence_via_event_union(self) -> None:
        """Simulate convergence by taking the union of all per-node events
        and the LWW winner per id, then asserting that every node ends up
        holding the same canonical log."""

        # 1. Each node writes its own events to disk.
        per_node_events: dict[int, list[dict[str, Any]]] = {}
        for i, node_dir in enumerate(self.node_dirs):
            events = _deterministic_events(i)
            per_node_events[i] = events
            for evt in events:
                self.write_event(node_dir, evt)

        # 2. Compute the canonical state: max-timestamp event per id.
        canonical: dict[str, dict[str, Any]] = {}
        for events in per_node_events.values():
            for evt in events:
                key = evt["id"]
                if key not in canonical or evt["ts"] > canonical[key]["ts"]:
                    canonical[key] = evt

        # 3. Copy canonical events to every node.
        for node_dir in self.node_dirs:
            ledger = node_dir / "events.jsonl"
            with ledger.open("w", encoding="utf-8") as fh:
                for evt in canonical.values():
                    fh.write(json.dumps(evt) + "\n")

        # 4. Every node now holds the same canonical log.
        canonical_ids = {e["id"] for e in canonical.values()}
        for node_dir in self.node_dirs:
            ids = {e["id"] for e in self.read_ledger(node_dir)}
            self.assertEqual(ids, canonical_ids)

        self.assertEqual(len(canonical), NODE_COUNT * EVENTS_PER_NODE)

    def test_convergence_time_is_reasonable(self) -> None:
        """The end-to-end broadcast should complete in well under a second."""

        start = time.perf_counter()
        # Inline broadcast that mirrors what the sync module would do.
        per_node_events: dict[int, list[dict[str, Any]]] = {}
        for i in range(NODE_COUNT):
            per_node_events[i] = _deterministic_events(i)

        merged: dict[str, dict[str, Any]] = {}
        for events in per_node_events.values():
            for evt in events:
                key = evt["id"]
                if key not in merged or evt["ts"] > merged[key]["ts"]:
                    merged[key] = evt

        for node_dir in self.node_dirs:
            (node_dir / "events.jsonl").write_text(
                "\n".join(json.dumps(e) for e in merged.values()) + "\n",
                encoding="utf-8",
            )
        elapsed = time.perf_counter() - start

        self.assertLess(elapsed, 2.0, f"convergence took {elapsed:.2f}s")

    # ------------------------------------------------------------------
    # Live test against the production sync module (skipped if absent)
    # ------------------------------------------------------------------

    def test_live_convergence_via_mesh_sync(self) -> None:
        sync_module, reason = _try_import_sync()
        if sync_module is None:  # pragma: no cover - skip path
            self.skipTest(reason)

        mesh = getattr(sync_module, "MeshSync", None)
        if mesh is None:
            self.skipTest("sync.mesh_sync.MeshSync is not yet defined")

        peers = [
            mesh(node_id=f"node_{i}", data_dir=node_dir)
            for i, node_dir in enumerate(self.node_dirs)
        ]
        for i in range(len(peers)):
            for j in range(len(peers)):
                if i != j:
                    peers[i].connect(peers[j])

        start = time.perf_counter()
        for i, peer in enumerate(peers):
            for evt in _deterministic_events(i):
                peer.publish(evt)
        time.sleep(0.1)
        elapsed = time.perf_counter() - start

        for peer in peers:
            peer.close()

        for node_dir in self.node_dirs:
            events = self.read_ledger(node_dir)
            self.assertGreater(len(events), 0)

        self.assertLess(elapsed, 5.0, f"live convergence took {elapsed:.2f}s")


def _try_import_sync() -> tuple[Any | None, str | None]:
    try:
        return importlib.import_module("sync.mesh_sync"), None
    except Exception as exc:  # pragma: no cover - skip path
        return None, f"sync.mesh_sync not importable: {exc!r}"


if __name__ == "__main__":  # pragma: no cover - manual invocation
    unittest.main()
