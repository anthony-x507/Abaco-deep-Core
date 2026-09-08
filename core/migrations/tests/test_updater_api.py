"""Tests for core/migrations/updater_api."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from core.migrations.updater_api import (
    detect_update,
    record_applied_update,
    run_migrations_after_update,
)
from core.migrations.schema_version import write_schema_version


class TestDetectUpdate(unittest.TestCase):
    def test_no_releases_returns_unavailable(self) -> None:
        info = detect_update(current_version="0.1.0", available_releases=[])
        self.assertFalse(info.available)
        self.assertEqual(info.new_version, "0.1.0")

    def test_newer_release_detected(self) -> None:
        releases = [
            {
                "tag_name": "v0.2.0",
                "prerelease": False,
                "draft": False,
                "body": "bug fixes",
                "published_at": "2026-09-08T10:00:00Z",
                "assets": [
                    {
                        "browser_download_url": "https://example.com/app.zip",
                        "size": 1234,
                        "digest": "sha512:abcdef",
                    },
                ],
            },
        ]
        info = detect_update(current_version="0.1.0", available_releases=releases)
        self.assertTrue(info.available)
        self.assertEqual(info.new_version, "0.2.0")
        self.assertEqual(info.release_notes, "bug fixes")
        self.assertEqual(info.sha512, "abcdef")
        self.assertEqual(info.size_bytes, 1234)

    def test_older_release_not_available(self) -> None:
        releases = [
            {
                "tag_name": "v0.0.5",
                "prerelease": False,
                "draft": False,
                "body": "old",
                "published_at": "",
                "assets": [],
            },
        ]
        info = detect_update(current_version="0.1.0", available_releases=releases)
        self.assertFalse(info.available)

    def test_yaml_feed_used_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            feed = Path(tmp) / "latest-mac.yml"
            feed.write_text(
                "version: 0.3.0\n"
                "path: app.zip\n"
                "sha512: feed-digest\n"
                "size: 9999\n"
                "releaseDate: 2026-09-08T11:00:00Z\n",
                encoding="utf-8",
            )
            info = detect_update(
                current_version="0.1.0",
                available_releases=[{"tag_name": "v0.2.0", "draft": True, "assets": []}],
                feed_path=feed,
            )
        self.assertTrue(info.available)
        self.assertEqual(info.new_version, "0.3.0")
        self.assertEqual(info.sha512, "feed-digest")


class TestRecordUpdate(unittest.TestCase):
    def test_record_includes_timestamp(self) -> None:
        applied = record_applied_update(
            from_version="0.1.0",
            to_version="0.2.0",
            migration_result={"applied": ["0.1.0->0.2.0"]},
        )
        self.assertEqual(applied.from_version, "0.1.0")
        self.assertEqual(applied.to_version, "0.2.0")
        self.assertIn("applied", applied.migration_result)
        self.assertTrue(applied.applied_at.endswith("Z"))


class TestMigrationsAfterUpdate(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-update-"))

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_runs_default_migration(self) -> None:
        write_schema_version(self.tmp, "0.0.0")
        result = run_migrations_after_update(self.tmp)
        self.assertTrue(result.ok)
        self.assertEqual(result.to_version, "0.1.0")


if __name__ == "__main__":
    unittest.main()
