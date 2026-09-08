"""Backup helpers for the migrator and the auto-updater.

A backup zips the entire user data directory (minus volatile caches) into
a single archive under ``<data_dir>/../backups/``. Backups are named with
a UTC timestamp so the user can spot the newest one quickly.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


VOLATILE_DIRS: frozenset[str] = frozenset({
    "__pycache__",
    ".pytest_cache",
    "cache",
    "tmp",
    "logs",
})

VOLATILE_SUFFIXES: tuple[str, ...] = (".pyc", ".pyo")


@dataclass(frozen=True)
class BackupResult:
    """Outcome of :func:`backup_data_dir`."""

    backup_id: str
    archive_path: Path
    created_at: str
    size_bytes: int
    file_count: int
    includes: tuple[str, ...]
    source_dir: Path

    def to_dict(self) -> dict[str, object]:
        return {
            "backup_id": self.backup_id,
            "archive_path": str(self.archive_path),
            "created_at": self.created_at,
            "size_bytes": self.size_bytes,
            "file_count": self.file_count,
            "includes": list(self.includes),
            "source_dir": str(self.source_dir),
        }


def default_backup_dir(data_dir: Path) -> Path:
    """Return the directory where backups are stored."""
    return Path(data_dir).resolve().parent / "backups"


def backup_data_dir(
    data_dir: Path,
    *,
    backup_dir: Path | None = None,
    include: Iterable[str] | None = None,
) -> BackupResult:
    """Create a ZIP archive of ``data_dir``.

    Args:
        data_dir: Directory to archive.
        backup_dir: Where to write the ZIP. Defaults to a sibling ``backups`` dir.
        include: Optional iterable of top-level entries to include
            (defaults to everything except ``VOLATILE_DIRS``).
    """

    source = Path(data_dir)
    if not source.is_dir():
        raise ValueError(f"data_dir is not a directory: {source}")

    target_dir = Path(backup_dir) if backup_dir else default_backup_dir(source)
    target_dir.mkdir(parents=True, exist_ok=True)

    timestamp = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    )
    backup_id = f"backup-{timestamp}"
    archive_path = target_dir / f"{backup_id}.zip"

    included_top = set(include) if include is not None else None
    file_count = 0

    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in sorted(source.iterdir()):
            if included_top is not None and entry.name not in included_top:
                continue
            if entry.name in VOLATILE_DIRS:
                continue
            if entry.is_dir():
                for path in entry.rglob("*"):
                    if _should_skip(path):
                        continue
                    rel = path.relative_to(source)
                    zf.write(path, str(rel))
                    file_count += 1
            else:
                if _should_skip(entry):
                    continue
                zf.write(entry, entry.name)
                file_count += 1

    size = archive_path.stat().st_size
    return BackupResult(
        backup_id=backup_id,
        archive_path=archive_path,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        size_bytes=size,
        file_count=file_count,
        includes=tuple(sorted(p.name for p in source.iterdir() if not _should_skip(p))),
        source_dir=source,
    )


def list_backups(backup_dir: Path) -> tuple[Path, ...]:
    """List existing backup archives, newest first."""
    if not backup_dir.is_dir():
        return ()
    archives = sorted(backup_dir.glob("backup-*.zip"), reverse=True)
    return tuple(archives)


def prune_backups(backup_dir: Path, *, keep: int = 3) -> int:
    """Delete old backups keeping only ``keep`` newest; return number deleted."""
    archives = list_backups(backup_dir)
    if len(archives) <= keep:
        return 0
    to_delete = archives[keep:]
    for path in to_delete:
        try:
            path.unlink()
        except OSError:
            pass
    return len(to_delete)


def _should_skip(path: Path) -> bool:
    if path.is_dir() and path.name in VOLATILE_DIRS:
        return True
    if path.suffix in VOLATILE_SUFFIXES:
        return True
    if path.name in {".DS_Store"}:
        return True
    return False


__all__ = [
    "BackupResult",
    "backup_data_dir",
    "default_backup_dir",
    "list_backups",
    "prune_backups",
]
