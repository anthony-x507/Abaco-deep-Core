"""Tests for :mod:`core.compaction.events` and FastAPI surface."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from core.compaction.events import (
    emit_compaction_completed,
    emit_compaction_failed,
    emit_compaction_started,
)
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import CompactionPolicy, CompactionResult
from core.compaction.scheduler import CompactionScheduler


try:
    import fastapi  # noqa: F401
    from fastapi.testclient import TestClient
    from core.compaction.api import create_app

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    create_app = None  # type: ignore[assignment]
    TestClient = None  # type: ignore[assignment]
    _FASTAPI_AVAILABLE = False


class _FakeEventLedger:
    """Captures events without writing to disk."""

    def __init__(self) -> None:
        self.events = []

    def append(self, event) -> object:
        self.events.append(event)
        return event


class TestEmitEvents(unittest.TestCase):
    def test_started_event_shape(self) -> None:
        sink = _FakeEventLedger()
        event = emit_compaction_started(
            policy_name="p",
            ledger_name="events",
            trigger_kind="size",
            source="unit-test",
            correlation_id="corr-1",
            ledger=sink,
        )
        self.assertEqual(len(sink.events), 1)
        self.assertEqual(sink.events[0].event_type, "system.compaction.started")
        self.assertEqual(sink.events[0].subject_id, "events")
        self.assertEqual(sink.events[0].payload["policy_name"], "p")
        self.assertEqual(event.payload["trigger"], "size")
        self.assertEqual(sink.events[0].correlation_id, "corr-1")

    def test_completed_event_uses_result_fields(self) -> None:
        sink = _FakeEventLedger()
        result = CompactionResult(
            policy_name="p",
            ledger_name="events",
            records_archived=10,
            records_kept=2,
            bytes_before=1024,
            bytes_after=256,
            summary="ok",
            started_at="2025-01-01T00:00:00Z",
            finished_at="2025-01-01T00:00:01Z",
            archive_path="/tmp/archive.jsonl",
        )
        emit_compaction_completed(result, source="unit-test", ledger=sink)
        event = sink.events[0]
        self.assertEqual(event.event_type, "system.compaction.completed")
        self.assertEqual(event.payload["records_archived"], 10)
        self.assertEqual(event.payload["archive_path"], "/tmp/archive.jsonl")

    def test_failed_event_carries_error(self) -> None:
        sink = _FakeEventLedger()
        emit_compaction_failed(
            policy_name="p",
            ledger_name="events",
            error=RuntimeError("boom"),
            source="unit-test",
            ledger=sink,
        )
        event = sink.events[0]
        self.assertEqual(event.event_type, "system.compaction.failed")
        self.assertEqual(event.payload["error_type"], "RuntimeError")
        self.assertEqual(event.payload["error_message"], "boom")

    def test_emit_without_ledger_returns_envelope(self) -> None:
        event = emit_compaction_started(
            policy_name="p",
            ledger_name="events",
            trigger_kind="manual",
            source="unit-test",
        )
        self.assertEqual(event.event_type, "system.compaction.started")


class TestCompactionAPI(unittest.TestCase):
    def setUp(self) -> None:
        if not _FASTAPI_AVAILABLE:
            self.skipTest("fastapi is not installed in this environment")
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.ledger = root / "events.jsonl"
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        with self.ledger.open("w", encoding="utf-8") as handle:
            for i in range(10):
                handle.write(json.dumps({"i": i, "event_type": "x"}))
                handle.write("\n")
        self.compactor = LedgerCompactor(
            self.ledger,
            project_root=root,
            policy=CompactionPolicy(name="p", max_count=5, keep_recent=2),
        )
        self.scheduler = CompactionScheduler(mode="manual")
        self.scheduler.register(
            name="j1",
            ledger_name="events",
            compactor=self.compactor,
            policy=self.compactor.policy,
        )
        self.app = create_app(
            scheduler=self.scheduler, compactors={"events": self.compactor}
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        if not _FASTAPI_AVAILABLE:
            return
        self._tmp.cleanup()

    def test_status_endpoint(self) -> None:
        response = self.client.get("/api/compaction/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["mode"], "manual")
        self.assertEqual(data["job_count"], 1)

    def test_run_endpoint_unknown_ledger(self) -> None:
        response = self.client.post(
            "/api/compaction/run",
            json={"ledger_name": "missing", "force": False},
        )
        self.assertEqual(response.status_code, 404)

    def test_run_endpoint_success(self) -> None:
        response = self.client.post(
            "/api/compaction/run",
            json={"ledger_name": "events", "force": True},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["result"]["records_archived"], 8)

    def test_policies_endpoint(self) -> None:
        response = self.client.get("/api/compaction/policies")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["policies"]), 1)


if __name__ == "__main__":
    unittest.main()
