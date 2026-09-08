"""Tests for ``core.uploads.handlers``.

These tests exercise the high-level helper functions that the FastAPI
router delegates to (``handle_upload``, ``list_uploads``,
``get_upload``, ``read_upload_bytes``, ``delete_upload``).  The FastAPI
router itself isn't started here so the suite has no external
dependencies beyond the project modules.
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from core.uploads import AttachmentRegistry, FileStorage
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
)


class TestHandleUpload(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_basic_upload_returns_file_id(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="hello.txt",
            mime_type="text/plain",
            content=b"hola",
        )
        self.assertTrue(resp.file_id)
        self.assertEqual(resp.mime_type, "text/plain")
        self.assertEqual(resp.size_bytes, 4)

    def test_upload_with_thread_creates_attachment_link(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id="t-1",
            node_id="node-A",
            filename="doc.pdf",
            mime_type="application/pdf",
            content=b"%PDF-1.4 fake",
        )
        self.assertEqual(resp.thread_id, "t-1")
        self.assertEqual(len(self.attachments.files_in_thread("t-1")), 1)

    def test_rejects_oversized_upload(self) -> None:
        with self.assertRaises(FileTooLargeError):
            handle_upload(
                storage=self.storage,
                attachments=self.attachments,
                thread_id=None,
                node_id="node-A",
                filename="huge.bin",
                mime_type="application/octet-stream",
                content=b"x" * (200 * 1024 * 1024),
            )

    def test_rejects_unsupported_mime(self) -> None:
        with self.assertRaises(UnsupportedMimeTypeError):
            handle_upload(
                storage=self.storage,
                attachments=self.attachments,
                thread_id=None,
                node_id="node-A",
                filename="virus.exe",
                mime_type="application/x-msdownload",
                content=b"MZ",
            )

    def test_rejects_path_traversal_filename(self) -> None:
        with self.assertRaises(InvalidFilenameError):
            handle_upload(
                storage=self.storage,
                attachments=self.attachments,
                thread_id=None,
                node_id="node-A",
                filename="../../etc/passwd",
                mime_type="text/plain",
                content=b"x",
            )


class TestListUploads(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-list-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_filter_by_thread(self) -> None:
        for i in range(2):
            handle_upload(
                storage=self.storage,
                attachments=self.attachments,
                thread_id="t-1",
                node_id="node-A",
                filename=f"a{i}.txt",
                mime_type="text/plain",
                content=f"x{i}".encode(),
            )
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id="t-2",
            node_id="node-A",
            filename="b.txt",
            mime_type="text/plain",
            content=b"y",
        )
        rows = list_uploads(storage=self.storage, thread_id="t-1")
        self.assertEqual(len(rows), 2)

    def test_filter_by_node(self) -> None:
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"a",
        )
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-B",
            filename="b.txt",
            mime_type="text/plain",
            content=b"b",
        )
        rows = list_uploads(storage=self.storage, node_id="node-A")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["uploaded_by_node_id"], "node-A")

    def test_no_filter_returns_all(self) -> None:
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"a",
        )
        handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id="t-1",
            node_id="node-B",
            filename="b.txt",
            mime_type="text/plain",
            content=b"b",
        )
        rows = list_uploads(storage=self.storage)
        self.assertEqual(len(rows), 2)


class TestGetUpload(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-get-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_returns_metadata_dict(self) -> None:
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
        self.assertEqual(meta["original_name"], "a.txt")

    def test_returns_none_for_unknown(self) -> None:
        self.assertIsNone(get_upload(storage=self.storage, file_id="nope"))

    def test_returns_none_for_deleted(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.txt",
            mime_type="text/plain",
            content=b"a",
        )
        self.storage.soft_delete(resp.file_id)
        self.assertIsNone(get_upload(storage=self.storage, file_id=resp.file_id))


class TestReadUploadBytes(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-bytes-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_returns_uploaded_bytes(self) -> None:
        resp = handle_upload(
            storage=self.storage,
            attachments=self.attachments,
            thread_id=None,
            node_id="node-A",
            filename="a.bin",
            mime_type="application/octet-stream",
            content=b"\x00\x01\x02",
        )
        self.assertEqual(
            read_upload_bytes(storage=self.storage, file_id=resp.file_id),
            b"\x00\x01\x02",
        )

    def test_returns_none_for_unknown(self) -> None:
        self.assertIsNone(read_upload_bytes(storage=self.storage, file_id="nope"))


class TestDeleteUpload(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-handlers-delete-"))
        self.storage = FileStorage(self.tmp / "uploads")
        self.attachments = AttachmentRegistry(
            self.storage, persist_path=self.tmp / "attachments.json"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_soft_delete_blocks_subsequent_read(self) -> None:
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

    def test_delete_unknown_returns_false(self) -> None:
        self.assertFalse(delete_upload(storage=self.storage, file_id="nope"))


if __name__ == "__main__":
    unittest.main()
