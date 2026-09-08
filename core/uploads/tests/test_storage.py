"""Tests for ``core.uploads.storage``.

These tests focus on the on-disk persistence layer:

* bytes are written under ``data_dir/{year_prefix}/{file_id}.ext``,
* the JSONL ledger receives one record per upload,
* soft-delete keeps the bytes but flips ``deleted_at``,
* ``purge`` removes both the bytes and the record.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

from core.uploads.storage import FileStorage


class TestFileStorage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-storage-"))
        self.storage = FileStorage(self.tmp)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_store_writes_file_under_data_dir(self) -> None:
        content = b"hola mundo"
        stored = self.storage.store_bytes(
            original_name="hello.txt",
            mime_type="text/plain",
            content=content,
            uploaded_by_node_id="node-A",
        )
        # The bytes must exist somewhere under self.tmp.
        self.assertTrue(stored.absolute_path.is_file())
        self.assertTrue(
            stored.absolute_path.resolve().is_relative_to(self.tmp.resolve())
        )
        self.assertEqual(stored.absolute_path.read_bytes(), content)

    def test_sha256_is_computed(self) -> None:
        content = b"abc"
        stored = self.storage.store_bytes(
            original_name="a.txt",
            mime_type="text/plain",
            content=content,
            uploaded_by_node_id="n",
        )
        self.assertEqual(stored.file.sha256, sha256(content).hexdigest())

    def test_size_bytes_matches_content_length(self) -> None:
        content = b"x" * 42
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=content,
            uploaded_by_node_id="n",
        )
        self.assertEqual(stored.file.size_bytes, 42)

    def test_extension_is_inferred_for_known_mime(self) -> None:
        stored = self.storage.store_bytes(
            original_name="document",
            mime_type="application/pdf",
            content=b"%PDF-fake",
            uploaded_by_node_id="n",
        )
        self.assertTrue(stored.absolute_path.name.endswith(".pdf"))

    def test_metadata_jsonl_is_appended(self) -> None:
        for i in range(3):
            self.storage.store_bytes(
                original_name=f"f{i}.txt",
                mime_type="text/plain",
                content=f"x{i}".encode(),
                uploaded_by_node_id="n",
            )
        with self.storage.metadata_path.open("r", encoding="utf-8") as handle:
            lines = [ln.strip() for ln in handle if ln.strip()]
        self.assertEqual(len(lines), 3)
        for line in lines:
            record = json.loads(line)
            self.assertIn("file_id", record)
            self.assertIn("sha256", record)

    def test_get_returns_record(self) -> None:
        stored = self.storage.store_bytes(
            original_name="a.txt",
            mime_type="text/plain",
            content=b"a",
            uploaded_by_node_id="n",
        )
        record = self.storage.get(stored.file.file_id)
        self.assertIsNotNone(record)
        self.assertEqual(record.file_id, stored.file.file_id)
        self.assertEqual(record.original_name, "a.txt")

    def test_get_returns_none_for_unknown(self) -> None:
        self.assertIsNone(self.storage.get("does-not-exist"))

    def test_read_bytes_round_trip(self) -> None:
        content = b"round-trip"
        stored = self.storage.store_bytes(
            original_name="rt.txt",
            mime_type="text/plain",
            content=content,
            uploaded_by_node_id="n",
        )
        self.assertEqual(self.storage.read_bytes(stored.file.file_id), content)

    def test_list_for_thread_filters_correctly(self) -> None:
        self.storage.store_bytes(
            original_name="t1.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
            thread_id="thread-1",
        )
        self.storage.store_bytes(
            original_name="t2.txt",
            mime_type="text/plain",
            content=b"y",
            uploaded_by_node_id="n",
            thread_id="thread-2",
        )
        records = self.storage.list_for_thread("thread-1")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].thread_id, "thread-1")

    def test_list_for_node_filters_correctly(self) -> None:
        self.storage.store_bytes(
            original_name="a.txt",
            mime_type="text/plain",
            content=b"a",
            uploaded_by_node_id="node-A",
        )
        self.storage.store_bytes(
            original_name="b.txt",
            mime_type="text/plain",
            content=b"b",
            uploaded_by_node_id="node-B",
        )
        records = self.storage.list_for_node("node-A")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].uploaded_by_node_id, "node-A")

    def test_soft_delete_marks_metadata(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
        )
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))
        record = self.storage.get(stored.file.file_id)
        self.assertIsNotNone(record)
        self.assertIsNotNone(record.deleted_at)

    def test_soft_delete_hides_record_from_default_listing(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
        )
        self.storage.soft_delete(stored.file.file_id)
        # Default iter_all excludes deleted records.
        self.assertEqual(len(list(self.storage.iter_all())), 0)

    def test_soft_delete_includes_when_requested(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
        )
        self.storage.soft_delete(stored.file.file_id)
        all_records = list(self.storage.iter_all(include_deleted=True))
        self.assertEqual(len(all_records), 1)

    def test_soft_delete_idempotent(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
        )
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))
        # Calling again must still report success (already deleted).
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))

    def test_soft_delete_unknown_returns_false(self) -> None:
        self.assertFalse(self.storage.soft_delete("does-not-exist"))

    def test_purge_removes_bytes_and_marks(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="n",
        )
        absolute = stored.absolute_path
        self.assertTrue(absolute.is_file())
        self.assertTrue(self.storage.purge(stored.file.file_id))
        self.assertFalse(absolute.is_file())
        record = self.storage.get(stored.file.file_id)
        self.assertIsNotNone(record)
        self.assertIsNotNone(record.deleted_at)

    def test_empty_metadata_path_returns_empty_iter(self) -> None:
        self.assertEqual(list(self.storage.iter_all()), [])


if __name__ == "__main__":
    unittest.main()
