"""Restore a backup archive into a target data directory."""

from __future__ import annotations

import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RestoreResult:
    """Outcome of :func:`restore_backup`."""

    archive_path: Path
    target_dir: Path
    restored_files: int
    ok: bool
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "archive_path": str(self.archive_path),
            "target_dir": str(self.target_dir),
            "restored_files": self.restored_files,
            "ok": self.ok,
            "error": self.error,
        }


def restore_backup(
    archive_path: Path,
    target_dir: Path,
    *,
    overwrite: bool = False,
) -> RestoreResult:
    """Restore ``archive_path`` into ``target_dir``.

    Args:
        archive_path: Path to the ZIP created by :func:`core.migrations.backup.backup_data_dir`.
        target_dir: Destination directory. Created if missing.
        overwrite: If ``False`` (default) the function refuses to overwrite
            files that already exist. If ``True`` it replaces them.
    """

    archive_path = Path(archive_path)
    target_dir = Path(target_dir)
    if not archive_path.is_file():
        return RestoreResult(
            archive_path=archive_path,
            target_dir=target_dir,
            restored_files=0,
            ok=False,
            error=f"backup not found: {archive_path}",
        )

    target_dir.mkdir(parents=True, exist_ok=True)
    count = 0

    try:
        with zipfile.ZipFile(archive_path, "r") as zf:
            with tempfile.TemporaryDirectory(dir=target_dir.parent) as staging:
                staging_path = Path(staging)
                zf.extractall(staging_path)
                for entry in staging_path.rglob("*"):
                    rel = entry.relative_to(staging_path)
                    destination = target_dir / rel
                    if entry.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                        continue
                    if destination.exists() and not overwrite:
                        # Skip pre-existing files unless the caller asked
                        # for an explicit overwrite. This is the safe
                        # default for restore-after-update: the new app
                        # version owns the schema, we only fill missing.
                        continue
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(entry, destination)
                    count += 1
    except (zipfile.BadZipFile, OSError) as exc:
        return RestoreResult(
            archive_path=archive_path,
            target_dir=target_dir,
            restored_files=count,
            ok=False,
            error=str(exc),
        )

    return RestoreResult(
        archive_path=archive_path,
        target_dir=target_dir,
        restored_files=count,
        ok=True,
    )


__all__ = ["RestoreResult", "restore_backup"]
