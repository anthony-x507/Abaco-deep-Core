"""Data migrations for abaco-deep-core.

A migration is a pure function that transforms the on-disk data from one
schema version to the next. Each migration has a unique ``from_version``
and ``to_version`` and a callable that takes the data directory.

The migrator walks the list of registered migrations, applies each one
in order, and stops once the data directory is at the target version.

Migration registry:

    from core.migrations import register, migrate, current_version

    register("0.1.0", "0.2.0", _migrate_v0_1_to_v0_2)
    result = migrate(data_dir, target_version="0.2.0")
"""

from .migrator import Migration, MigrationResult, run as migrate
from .backup import backup_data_dir, BackupResult, list_backups, prune_backups
from .restore import restore_backup, RestoreResult
from .schema_version import read_schema_version, write_schema_version, current_version

__all__ = [
    "Migration",
    "MigrationResult",
    "migrate",
    "backup_data_dir",
    "BackupResult",
    "list_backups",
    "prune_backups",
    "restore_backup",
    "RestoreResult",
    "read_schema_version",
    "write_schema_version",
    "current_version",
]
