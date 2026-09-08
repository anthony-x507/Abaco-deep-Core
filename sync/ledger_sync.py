"""Offline-first JSONL ledger synchronization and LWW merging."""

import json
from pathlib import Path
from typing import Iterable

from .conflict_resolver import resolve
from .errors import LedgerError


class LedgerSync:
    """Read, merge, and atomically rewrite one local JSONL ledger."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def path_for(self, ledger_name: str) -> Path:
        """Return the local path for a ledger, preventing traversal."""
        if not ledger_name or Path(ledger_name).name != ledger_name:
            raise LedgerError("Invalid ledger name")
        return self.root / f"{ledger_name}.jsonl"

    def read(self, ledger_name: str) -> list[dict]:
        """Read all valid JSON objects from a ledger."""
        path = self.path_for(ledger_name)
        if not path.exists():
            return []
        try:
            return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        except (OSError, json.JSONDecodeError) as exc:
            raise LedgerError(f"Cannot read ledger {ledger_name}") from exc

    def write(self, ledger_name: str, records: Iterable[dict]) -> None:
        """Atomically write records as JSONL."""
        path = self.path_for(ledger_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text("".join(json.dumps(record, sort_keys=True) + "\n" for record in records))
        temporary.replace(path)

    def merge(self, ledger_name: str, remote_records: list[dict]) -> tuple[list[dict], list[dict]]:
        """Merge remote records into the local ledger and report conflicts."""
        merged, conflicts = resolve(self.read(ledger_name), remote_records)
        self.write(ledger_name, merged)
        return merged, conflicts

    def state(self, ledger_name: str) -> dict[str, int | str | None]:
        """Return count and last timestamp for a ledger."""
        records = self.read(ledger_name)
        timestamps = [r.get("updated_at") or r.get("occurred_at") for r in records]
        timestamps = [value for value in timestamps if isinstance(value, str)]
        return {"count": len(records), "last_timestamp": max(timestamps) if timestamps else None}
