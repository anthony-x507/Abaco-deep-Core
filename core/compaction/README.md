# core.compaction - Automatic Context Compaction

Reversible, deterministic compaction for ledgers, tickets and chat
sessions in the `abaco-deep-core` project.

## Goals

* Bound the size of append-only JSONL ledgers so they stay queryable.
* Archive closed tickets instead of leaving them on the hot path.
* Compress chat sessions that exceed a token budget without losing
  recent context.
* Always keep the original data: compactors move records to a
  timestamped archive file and leave a deterministic summary behind.
* Emit `system.compaction.{started,completed,failed}` events through
  `core.events.envelope` so every run is auditable.

## Layout

| File | Purpose |
|------|---------|
| `__init__.py`           | Public API; re-exports the submodule surface (self-contained, no `sys.path` mutation). |
| `errors.py`             | `CompactionError`, `InvalidPolicyError`, `PathSafetyError`, `SchedulerError`. |
| `models.py`             | Frozen dataclasses (`CompactionPolicy`, `CompactionResult`, `SessionTurn`, `TicketArchivalRule`, `CompactionTrigger`). |
| `policies.py`           | `size_based_policy`, `time_based_policy`, `count_based_policy` factories. |
| `retention.py`          | `decide_retention`, `decide_ticket_retention`, `apply_retention`. |
| `summary_generator.py`  | Deterministic heuristic summariser (`SummaryGenerator`). |
| `events.py`             | Audit event emitters (`emit_compaction_started/completed/failed`). |
| `ledger_compactor.py`   | `LedgerCompactor`: archives old JSONL records atomically. |
| `ticket_compactor.py`   | `TicketCompactor`: archives closed tickets older than N days. |
| `session_compactor.py`  | `SessionCompactor`: keeps last K turns + summary. |
| `scheduler.py`          | `CompactionScheduler`: manual / on_write / interval modes. |
| `api.py`                | FastAPI router (`/api/compaction/{run,status,policies}`). |
| `tests/`                | unittest test suite (71 tests). |

## Quick start

```python
from pathlib import Path
from core.compaction import (
    LedgerCompactor,
    size_based_policy,
    CompactionScheduler,
)

policy = size_based_policy("events-bytes", max_bytes=1_000_000, keep_recent=200)
compactor = LedgerCompactor(
    Path("runtime/events/events.jsonl"),
    project_root=Path("."),
    policy=policy,
)

scheduler = CompactionScheduler(mode="interval", interval_seconds=300)
scheduler.register(
    name="events",
    ledger_name="events",
    compactor=compactor,
    policy=policy,
)
scheduler.start()
```

## Trigger strategies

* **Size-based** – trigger when the ledger exceeds `max_bytes` or
  `max_lines`.
* **Time-based** – trigger when the oldest record is older than
  `max_age_days`.
* **Count-based** – trigger when the record count exceeds `max_count`.

A policy may combine multiple strategies; the first one to cross its
threshold wins.

## Reversibility

Compact operations write the archive first and only then rewrite the
active ledger.  The active ledger is replaced atomically with
`os.replace` after the temp file is flushed and `fsync`-ed.  If a crash
happens in between, the original ledger is preserved and the archive
can be removed safely.

## Auditability

Each compaction emits:

* `system.compaction.started` (payload: policy, ledger, trigger,
  measured value),
* `system.compaction.completed` (payload: counters, archive path,
  timestamps),
* `system.compaction.failed` (payload: error type, message).

Events are emitted through `core.events.envelope.create_event` (the
in-repo mirror of the `abaco_core.events.envelope` contract) and
appended to any supplied ledger object exposing `.append(event)` (e.g.
`abaco_core.events.ledger.AppendOnlyEventLedger` when running embedded
next to the full ABACO Python Core package).  If no ledger is passed,
the event envelope is returned so callers (and tests) can inspect it.

## Safety

* Path safety: archive paths are resolved and checked against the
  project root.  Paths containing `..` segments that escape the root
  raise `PathSafetyError`.
* Policy validation: thresholds must be positive integers; the
  `keep_recent` window must be non-negative.
* Unknown timestamps are treated as "ancient" so malformed records are
  archived before well-formed ones.

## Tests

```bash
# Run with the system Python (fastapi tests will be skipped):
python3 -m py_compile core/compaction/*.py core/compaction/tests/*.py
python3 -m unittest discover core/compaction/tests -v

# Run with fastapi + httpx installed (all tests):
python3 -m unittest discover core/compaction/tests -v
```

Current coverage: **71 tests** (67 always-on + 4 fastapi-gated), all
passing.

## Limitations

* The HTTP API requires `fastapi` and `httpx`; if those are missing
  the rest of the package keeps working but `build_router` and
  `create_app` raise `RuntimeError`.
* Summary generation is heuristic and deterministic on purpose.  It
  does *not* call an LLM, so the output is intentionally terse.
* `CompactionScheduler.start()` spins a daemon thread per scheduler;
  long-running processes that create many schedulers should reuse a
  single instance.
* The compactor rewrites the entire active ledger on every run.  For
  very large ledgers (gigabytes) consider switching to a streaming
  copy strategy or moving compaction to a separate worker process.
