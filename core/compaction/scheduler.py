"""Scheduler that decides when to run compaction.

Three modes are supported, matching the spec:

* ``manual`` - the scheduler is a no-op; operators trigger compactions
  explicitly through the API or by calling
  :meth:`CompactionScheduler.run_now`.
* ``on_write`` - each call to :meth:`CompactionScheduler.notify_write`
  increments an internal counter; once it reaches ``writes_per_run``
  the scheduler triggers every registered compactor and resets the
  counter.
* ``interval`` - a daemon thread wakes up every ``interval_seconds``
  and runs every registered compactor that wants to run.

The scheduler is intentionally lightweight.  It does not own the
compactors - it just knows which :class:`~core.compaction.ledger_compactor.LedgerCompactor`
or :class:`~core.compaction.ticket_compactor.TicketCompactor` to call
and which :class:`~core.compaction.models.CompactionPolicy` to apply.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable

from core.compaction.errors import InvalidPolicyError, SchedulerError
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import CompactionPolicy, CompactionResult
from core.compaction.ticket_compactor import TicketCompactor


_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScheduledJob:
    """A compactor + policy pair registered with the scheduler."""

    name: str
    ledger_name: str
    policy: CompactionPolicy
    compactor: object


class CompactionScheduler:
    """Schedule compactors in ``manual``, ``on_write`` or ``interval`` mode."""

    def __init__(
        self,
        *,
        mode: str = "manual",
        interval_seconds: float = 60.0,
        writes_per_run: int = 50,
    ) -> None:
        if mode not in {"manual", "on_write", "interval"}:
            raise SchedulerError(f"unknown scheduler mode: {mode!r}", mode=mode)
        if interval_seconds <= 0:
            raise SchedulerError("interval_seconds must be > 0", mode=mode)
        if writes_per_run <= 0:
            raise InvalidPolicyError("writes_per_run must be > 0")
        self.mode = mode
        self.interval_seconds = float(interval_seconds)
        self.writes_per_run = int(writes_per_run)

        self._jobs: list[ScheduledJob] = []
        self._write_count = 0
        self._write_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._history: list[CompactionResult] = []

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        *,
        name: str,
        ledger_name: str,
        compactor: object,
        policy: CompactionPolicy,
    ) -> None:
        """Register a compactor + policy pair."""

        if not isinstance(compactor, (LedgerCompactor, TicketCompactor)):
            raise SchedulerError(
                "compactor must be a LedgerCompactor or TicketCompactor",
                mode=self.mode,
            )
        job = ScheduledJob(
            name=name,
            ledger_name=ledger_name,
            policy=policy,
            compactor=compactor,
        )
        self._jobs.append(job)

    @property
    def jobs(self) -> tuple[ScheduledJob, ...]:
        return tuple(self._jobs)

    @property
    def history(self) -> tuple[CompactionResult, ...]:
        return tuple(self._history)

    # ------------------------------------------------------------------
    # Manual
    # ------------------------------------------------------------------

    def run_now(
        self,
        *,
        force: bool = False,
        correlation_id: str | None = None,
        job_name: str | None = None,
    ) -> list[CompactionResult]:
        """Run every job (or a single one by name) on demand."""

        results: list[CompactionResult] = []
        for job in self._jobs:
            if job_name is not None and job.name != job_name:
                continue
            result = self._run_job(job, force=force, correlation_id=correlation_id)
            if result is not None:
                results.append(result)
        return results

    def _run_job(
        self,
        job: ScheduledJob,
        *,
        force: bool,
        correlation_id: str | None,
    ) -> CompactionResult | None:
        compactor = job.compactor
        compact_fn: Callable[..., CompactionResult] | None = getattr(
            compactor, "compact", None
        )
        if compact_fn is None:
            _LOGGER.warning("compactor for job %s has no compact() method", job.name)
            return None
        try:
            result = compact_fn(force=force, correlation_id=correlation_id)
        except Exception as exc:  # pragma: no cover - defensive
            _LOGGER.error("compaction failed for job %s: %s", job.name, exc)
            return None
        self._history.append(result)
        # Cap history to the last 100 runs to keep memory bounded.
        if len(self._history) > 100:
            self._history = self._history[-100:]
        return result

    # ------------------------------------------------------------------
    # on_write
    # ------------------------------------------------------------------

    def notify_write(self, count: int = 1) -> list[CompactionResult]:
        """Increment the on-write counter and trigger if threshold is met."""

        if self.mode != "on_write":
            return []
        if count <= 0:
            raise SchedulerError("count must be > 0", mode=self.mode)
        with self._write_lock:
            self._write_count += count
            if self._write_count < self.writes_per_run:
                return []
            self._write_count = 0
        return self.run_now(force=False)

    # ------------------------------------------------------------------
    # interval
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Start the background thread (only valid in ``interval`` mode)."""

        if self.mode != "interval":
            return
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="compaction-scheduler",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop the background thread (idempotent)."""

        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self.interval_seconds + 1.0)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            # ``wait`` returns True if the event was set during the
            # sleep, which lets ``stop()`` interrupt promptly.
            if self._stop_event.wait(self.interval_seconds):
                break
            try:
                self.run_now(force=False)
            except Exception as exc:  # pragma: no cover - defensive
                _LOGGER.error("scheduled compaction failed: %s", exc)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def stats(self) -> dict[str, object]:
        """Return a JSON-serialisable snapshot of the scheduler state."""

        return {
            "ok": True,
            "mode": self.mode,
            "interval_seconds": self.interval_seconds,
            "writes_per_run": self.writes_per_run,
            "job_count": len(self._jobs),
            "jobs": [
                {
                    "name": job.name,
                    "ledger_name": job.ledger_name,
                    "policy_name": job.policy.name,
                }
                for job in self._jobs
            ],
            "write_count": self._write_count,
            "history_size": len(self._history),
        }
