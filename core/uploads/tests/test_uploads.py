"""Tests for core/uploads."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from core.uploads import AttachmentRegistry, FileStorage, validate_upload
from core.uploads.handlers import (
    delete_upload,
    get_upload,
    handle_upload,
    list_uploads,
    read_upload_bytes,
)
from core.uploads.validators import (
    FileTooLargeError,
    InvalidFilenameError,
    UnsupportedMimeTypeError,
    is_mime_allowed,
    sanitize_filename,
)


class TestValidators(unittest.TestCase):
    def test_sanitize_strips_path_separators(self) -> None:
        self.assertEqual(sanitize_filename("../../etc/passwd"), ".._.._etc_passwd")

    def test_sanitize_rejects_empty(self) -> None:
        with self.assertRaises(InvalidFilenameError):
            sanitize_filename("")
        with self.assertRaises(InvalidFilenameError):
            sanitize_filename("   ")

    def test_sanitize_strips_control_chars(self) -> None:
        self.assertEqual(sanitize_filename("foo\x00bar"), "foo_bar")

    def test_mime_whitelist(self) -> None:
        self.assertTrue(is_mime_allowed("image/png"))
        self.assertTrue(is_mime_allowed("text/plain"))
        self.assertTrue(is_mime_allowed("application/pdf"))
        self.assertFalse(is_mime_allowed("application/x-executable"))
        self.assertFalse(is_mime_allowed(""))

    def test_size_limit(self) -> None:
        with self.assertRaises(FileTooLargeError):
            validate_upload(
                filename="big.bin",
                mime_type="application/octet-stream",
                size_bytes=200 * 1024 * 1024,
            )

    def test_unsupported_mime(self) -> None:
        with self.assertRaises(UnsupportedMimeTypeError):
            validate_upload(
                filename="virus.exe",
                mime_type="application/x-msdownload",
                size_bytes=10,
            )


class TestFileStorage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-uploads-"))
        self.storage = FileStorage(self.tmp)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_store_and_read(self) -> None:
        from hashlib import sha256
        content = b"hola mundo"
        stored = self.storage.store_bytes(
            original_name="hello.txt",
            mime_type="text/plain",
            content=content,
            uploaded_by_node_id="node-A",
            thread_id="thread-1",
        )
        self.assertEqual(stored.file.size_bytes, len(content))
        self.assertEqual(stored.file.sha256, sha256(content).hexdigest())
        self.assertEqual(self.storage.read_bytes(stored.file.file_id), content)

    def test_list_for_thread(self) -> None:
        for i in range(3):
            self.storage.store_bytes(
                original_name=f"f{i}.txt",
                mime_type="text/plain",
                content=f"x{i}".encode(),
                uploaded_by_node_id="node-A",
                thread_id="thread-1",
            )
        self.storage.store_bytes(
            original_name="other.txt",
            mime_type="text/plain",
            content=b"otro",
            uploaded_by_node_id="node-A",
            thread_id="thread-2",
        )
        records = self.storage.list_for_thread("thread-1")
        self.assertEqual(len(records), 3)
        self.assertTrue(all(r.thread_id == "thread-1" for r in records))

    def test_soft_delete_marks_but_keeps_bytes(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="node-A",
        )
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))
        self.assertIsNone(self.storage.read_bytes(stored.file.file_id))
        record = self.storage.get(stored.file.file_id)
        self.assertIsNotNone(record)
        self.assertIsNotNone(record.deleted_at)

    def test_soft_delete_idempotent(self) -> None:
        stored = self.storage.store_bytes(
            original_name="x.txt",
            mime_type="text/plain",
            content=b"x",
            uploaded_by_node_id="node-A",
        )
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))
        self.assertTrue(self.storage.soft_delete(stored.file.file_id))


class TestAttachmentRegistry(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-attach-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_attach_and_list(self) -> None:
        stored = self.storage.store_bytes(
            original_name="a.txt",
            mime_type="text/plain",
            content=b"a",
            uploaded_by_node_id="node-A",
        )
        self.attachments.attach(thread_id="t-1", file_id=stored.file.file_id)
        files = self.attachments.files_in_thread("t-1")
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].file_id, stored.file.file_id)

    def test_persistence_round_trip(self) -> None:
        stored = self.storage.store_bytes(
            original_name="b.txt",
            mime_type="text/plain",
            content=b"b",
            uploaded_by_node_id="node-A",
        )
        self.attachments.attach(thread_id="t-9", file_id=stored.file.file_id)
        reg2 = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )
        files = reg2.files_in_thread("t-9")
        self.assertEqual(len(files), 1)


class TestHandlers(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_handle_upload_attaches_to_thread(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id="t-1",
            node_id="node-A",
            filename="doc.pdf",
            mime_type="application/pdf",
            content=b"%PDF-1.4 fake",
        )
        self.assertEqual(resp.mime_type, "application/pdf")
        self.assertEqual(len(self.attachments.files_in_thread("t-1")), 1)

    def test_list_uploads_by_thread(self) -> None:
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id="t-1",
            node_id="node-A",
            filename="x.txt",
            mime_type="text/plain",
            content=b"x",
        )
        rows = list_uploads(storage=self.storage, thread_id="t-1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["original_name"], "x.txt")

    def test_get_upload_returns_metadata(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"a",
        )
        meta = get_upload(storage=self.storage, file_id=resp.file_id)
        self.assertIsNotNone(meta)
        self.assertEqual(meta["mime_type"], "text/plain")

    def test_read_upload_bytes(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"hola",
        )
        self.assertEqual(
            read_upload_bytes(storage=self.storage, file_id=resp.file_id),
            b"hola",
        )

    def test_delete_upload(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"a",
        )
        self.assertTrue(delete_upload(storage=self.storage, file_id=resp.file_id))
        self.assertIsNone(
            read_upload_bytes(storage=self.storage, file_id=resp.file_id)
        )


if __name__ == "__main__":
    unittest.main()
