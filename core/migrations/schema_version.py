"""Schema version tracking on disk.

The schema version is stored at ``<data_dir>/schema_version.txt`` as a
single line containing the version string. The migrator reads this on
startup and writes a new value after a successful migration.
"""

from __future__ import annotations

from pathlib import Path


VERSION_FILENAME = "schema_version.txt"


def read_schema_version(data_dir: Path) -> str:
    """Return the version stored in ``data_dir/schema_version.txt``.

    Returns ``"0.0.0"`` when the file is missing or empty so fresh installs
    upgrade cleanly.
    """

    path = Path(data_dir) / VERSION_FILENAME
    if not path.is_file():
        return "0.0.0"
    return path.read_text(encoding="utf-8").strip() or "0.0.0"


def write_schema_version(data_dir: Path, version: str) -> None:
    """Write ``version`` to ``data_dir/schema_version.txt`` atomically."""

    path = Path(data_dir) / VERSION_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".txt.tmp")
    tmp.write_text(version, encoding="utf-8")
    tmp.replace(path)


def current_version() -> str:
    """Return the schema version that this code release ships with."""

    return "0.1.0"


__all__ = ["read_schema_version", "write_schema_version", "current_version", "VERSION_FILENAME"]
