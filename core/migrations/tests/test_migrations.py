"""Tests for core/migrations."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from core.migrations import (
    BackupResult,
    Migration,
    MigrationResult,
    backup_data_dir,
    current_version,
    list_backups,
    migrate,
    prune_backups,
    read_schema_version,
    restore_backup,
    write_schema_version,
)
from core.migrations.migrator import clear_registry, register


class TestSchemaVersion(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-mig-"))

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_default_version(self) -> None:
        self.assertEqual(read_schema_version(self.tmp), "0.0.0")

    def test_round_trip(self) -> None:
        write_schema_version(self.tmp, "1.2.3")
        self.assertEqual(read_schema_version(self.tmp), "1.2.3")


class TestMigrator(unittest.TestCase):
    def setUp(self) -> None:
        clear_registry()
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-mig-"))

    def tearDown(self) -> None:
        import shutil
        clear_registry()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_migrations_returns_empty(self) -> None:
        result = migrate(self.tmp, target_version=current_version())
        self.assertEqual(result.from_version, "0.0.0")
        # No-op migration runs by default; result should be ok.
        self.assertTrue(result.ok, result.errors)

    def test_migration_runs(self) -> None:
        sentinel = self.tmp / "sentinel.txt"

        def add_sentinel(data_dir: Path) -> None:
            sentinel.write_text("created", encoding="utf-8")

        register("0.1.0", "0.2.0", add_sentinel, description="add sentinel")
        write_schema_version(self.tmp, "0.1.0")
        result = migrate(self.tmp, target_version="0.2.0")
        self.assertTrue(result.ok)
        self.assertEqual(result.to_version, "0.2.0")
        self.assertTrue(sentinel.exists())

    def test_missing_middleware_records_error(self) -> None:
        write_schema_version(self.tmp, "0.5.0")
        result = migrate(self.tmp, target_version="0.5.1")
        # No migration registered for 0.5.0→0.5.1, but the built-in
        # migration from 0.0.0→0.1.0 doesn't match either, so the result
        # is not ok because we never reached 0.5.1.
        self.assertFalse(result.ok)


class TestBackupAndRestore(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-backup-"))
        self.data_dir = self.tmp / "data"
        self.data_dir.mkdir()
        (self.data_dir / "chats.jsonl").write_text('{"hello":"world"}\n', encoding="utf-8")
        (self.data_dir / "settings.json").write_text('{"theme":"dark"}', encoding="utf-8")
        (self.data_dir / "__pycache__").mkdir()
        (self.data_dir / "__pycache__" / "x.pyc").write_bytes(b"junk")

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_backup_skips_pycache(self) -> None:
        result = backup_data_dir(self.data_dir)
        self.assertIsInstance(result, BackupResult)
        # __pycache__ should not be in includes
        self.assertNotIn("__pycache__", result.includes)

    def test_backup_then_restore_preserves_files(self) -> None:
        backup = backup_data_dir(self.data_dir)
        new_dir = self.tmp / "data2"
        restore = restore_backup(backup.archive_path, new_dir, overwrite=True)
        self.assertTrue(restore.ok)
        self.assertTrue((new_dir / "chats.jsonl").exists())

    def test_list_and_prune(self) -> None:
        for _ in range(4):
            backup_data_dir(self.data_dir)
        backup_dir = self.tmp / "data" / ".." / "backups"
        archives = list_backups(backup_dir.resolve())
        self.assertEqual(len(archives), 4)
        deleted = prune_backups(backup_dir.resolve(), keep=2)
        self.assertEqual(deleted, 2)
        self.assertEqual(len(list_backups(backup_dir.resolve())), 2)


if __name__ == "__main__":
    unittest.main()
