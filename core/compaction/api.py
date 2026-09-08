"""FastAPI router for the compaction module.

The router exposes the following endpoints:

* ``POST /api/compaction/run`` - trigger a manual compaction.
* ``GET  /api/compaction/status`` - inspect the scheduler state.
* ``GET  /api/compaction/policies`` - list the registered jobs.

The endpoints intentionally use ``dict`` responses so they can be
mounted on the project's main FastAPI app without coupling to a
specific pydantic model.  The router ships with a stand-alone
``create_app`` factory that makes it testable in isolation.

Note: importing :mod:`fastapi` and :mod:`pydantic` is deferred until
:func:`build_router` or :func:`create_app` is called so the rest of the
package keeps working even on minimal installs that only have the
``core`` module (the spec disallows new external dependencies).
"""

from __future__ import annotations

import threading
from typing import Any

from core.compaction.errors import CompactionError, InvalidPolicyError, PathSafetyError
from core.compaction.ledger_compactor import LedgerCompactor
from core.compaction.models import CompactionPolicy, CompactionResult
from core.compaction.policies import (
    count_based_policy,
    size_based_policy,
    time_based_policy,
)
from core.compaction.scheduler import CompactionScheduler
from core.compaction.ticket_compactor import TicketCompactor


# Re-exported at module level so ``from core.compaction.api import X``
# keeps working without forcing a fastapi import.
try:  # pragma: no cover - exercised only when fastapi is installed
    from fastapi import APIRouter, FastAPI, HTTPException  # noqa: F401
    from pydantic import BaseModel, Field  # noqa: F401

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when fastapi missing
    APIRouter = None  # type: ignore[assignment]
    FastAPI = None  # type: ignore[assignment]
    HTTPException = None  # type: ignore[assignment]
    BaseModel = None  # type: ignore[assignment]
    Field = None  # type: ignore[assignment]
    _FASTAPI_AVAILABLE = False


def _require_fastapi():
    """Raise an informative error when fastapi is missing."""

    if not _FASTAPI_AVAILABLE:
        raise RuntimeError(
            "fastapi is not installed; install it with "
            "`pip install fastapi pydantic` to use the compaction HTTP API"
        )


# ----------------------------------------------------------------------
# Request models
# ----------------------------------------------------------------------


class CompactionRunRequest(BaseModel):
    """Body for ``POST /api/compaction/run``."""

    ledger_name: str = Field(..., min_length=1, max_length=128)
    force: bool = False
    correlation_id: str | None = None


class PolicySpec(BaseModel):
    """Compact representation of a policy for the API."""

    name: str = Field(..., min_length=1)
    kind: str = Field(..., pattern="^(size|time|count)$")
    max_bytes: int | None = None
    max_lines: int | None = None
    max_age_days: int | None = None
    max_count: int | None = None
    keep_recent: int = 100


# ----------------------------------------------------------------------
# Router factory
# ----------------------------------------------------------------------


def build_router(
    *,
    scheduler: CompactionScheduler,
    compactors_by_ledger: dict[str, LedgerCompactor | TicketCompactor] | None = None,
) -> Any:
    """Return a router wired to the given scheduler and compactors."""

    _require_fastapi()
    router = APIRouter(prefix="/api/compaction", tags=["compaction"])
    compactors = dict(compactors_by_ledger or {})

    def _resolve_compactor(name: str) -> LedgerCompactor | TicketCompactor:
        compactor = compactors.get(name)
        if compactor is None:
            raise HTTPException(status_code=404, detail=f"unknown ledger: {name}")
        return compactor

    @router.post("/run", response_model=None)
    def run_compaction(body: CompactionRunRequest) -> dict[str, Any]:
        compactor = _resolve_compactor(body.ledger_name)
        try:
            result: CompactionResult = compactor.compact(
                force=body.force,
                correlation_id=body.correlation_id,
            )
        except PathSafetyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except InvalidPolicyError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except CompactionError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "ok": True,
            "result": _result_to_dict(result),
        }

    @router.get("/status")
    def status() -> dict[str, Any]:
        snapshot = scheduler.stats()
        snapshot["recent_runs"] = [_result_to_dict(r) for r in scheduler.history[-10:]]
        return snapshot

    @router.get("/policies")
    def policies() -> dict[str, Any]:
        return {
            "ok": True,
            "policies": [
                {
                    "name": job.name,
                    "ledger_name": job.ledger_name,
                    "policy_name": job.policy.name,
                }
                for job in scheduler.jobs
            ],
        }

    return router


def _result_to_dict(result: CompactionResult) -> dict[str, Any]:
    return {
        "policy_name": result.policy_name,
        "ledger_name": result.ledger_name,
        "records_archived": result.records_archived,
        "records_kept": result.records_kept,
        "bytes_before": result.bytes_before,
        "bytes_after": result.bytes_after,
        "summary": result.summary,
        "started_at": result.started_at,
        "finished_at": result.finished_at,
        "archive_path": result.archive_path,
    }


# ----------------------------------------------------------------------
# Stand-alone app
# ----------------------------------------------------------------------


# A module-level lock so the ``start`` button in tests can be exercised
# safely across threads without each test creating a fresh scheduler.
_default_scheduler_lock = threading.Lock()


def create_app(
    *,
    scheduler: CompactionScheduler | None = None,
    compactors: dict[str, LedgerCompactor | TicketCompactor] | None = None,
) -> Any:
    """Build a stand-alone FastAPI app for the compaction module."""

    _require_fastapi()
    scheduler = scheduler or CompactionScheduler()
    app = FastAPI(title="abaco-deep-core compaction API", version="0.1.0")
    app.include_router(build_router(scheduler=scheduler, compactors_by_ledger=compactors))
    return app


__all__ = [
    "CompactionRunRequest",
    "PolicySpec",
    "build_router",
    "create_app",
    "size_based_policy",
    "time_based_policy",
    "count_based_policy",
    "CompactionPolicy",
]
