"""Disk persistence for uploaded files."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .models import UploadedFile, make_uploaded_file
from .validators import safe_join_under


DEFAULT_DATA_DIR = Path.home() / ".abaco-deep-core" / "uploads"


@dataclass(frozen=True)
class StoredUpload:
    """Result of writing a file to storage."""

    file: UploadedFile
    absolute_path: Path


class FileStorage:
    """Append-only JSONL metadata + content-addressed file blobs."""

    def __init__(self, data_dir: Path = DEFAULT_DATA_DIR) -> None:
        self.data_dir = Path(data_dir)
        self.metadata_path = self.data_dir / "metadata.jsonl"
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ write

    def store_bytes(
        self,
        *,
        original_name: str,
        mime_type: str,
        content: bytes,
        uploaded_by_node_id: str,
        thread_id: str | None = None,
        tags: tuple[str, ...] = (),
        metadata: dict[str, object] | None = None,
    ) -> StoredUpload:
        """Persist ``content`` to disk under a fresh UUID.

        Atomicity:
            The file is first written to a sibling temp file and then renamed
            into place. The metadata line is appended only after the rename
            succeeds.
        """

        if not original_name or not original_name.strip():
            raise ValueError("original_name is required")
        digest = sha256(content).hexdigest()
        file_id = str(uuid4())
        ext = _infer_extension(original_name, mime_type)
        relative_path = _year_month_path(file_id) + (f".{ext}" if ext else "")
        absolute = Path(safe_join_under(str(self.data_dir), relative_path))
        absolute.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            with tempfile.NamedTemporaryFile(
                dir=str(absolute.parent), delete=False, prefix=".upload-"
            ) as tmp:
                tmp.write(content)
                tmp_path = Path(tmp.name)
            os.replace(tmp_path, absolute)

            uploaded = make_uploaded_file(
                file_id=file_id,
                original_name=original_name,
                mime_type=mime_type,
                size_bytes=len(content),
                sha256=digest,
                storage_path=relative_path,
                uploaded_by_node_id=uploaded_by_node_id,
                thread_id=thread_id,
                tags=tags,
                metadata=metadata,
            )
            self._append_metadata(uploaded)

        return StoredUpload(file=uploaded, absolute_path=absolute)

    # ------------------------------------------------------------------- read

    def get(self, file_id: str) -> UploadedFile | None:
        for record in self.iter_all(include_deleted=True):
            if record.file_id == file_id:
                return record
        return None

    def read_bytes(self, file_id: str) -> bytes | None:
        record = self.get(file_id)
        if record is None or record.deleted_at is not None:
            return None
        absolute = Path(safe_join_under(str(self.data_dir), record.storage_path))
        if not absolute.is_file():
            return None
        return absolute.read_bytes()

    def list_for_thread(
        self, thread_id: str, *, include_deleted: bool = False
    ) -> list[UploadedFile]:
        return [
            r for r in self.iter_all(include_deleted=include_deleted)
            if r.thread_id == thread_id
        ]

    def list_for_node(
        self, node_id: str, *, include_deleted: bool = False
    ) -> list[UploadedFile]:
        return [
            r for r in self.iter_all(include_deleted=include_deleted)
            if r.uploaded_by_node_id == node_id
        ]

    def iter_all(self, *, include_deleted: bool = False) -> Iterable[UploadedFile]:
        if not self.metadata_path.is_file():
            return iter(())
        with self.metadata_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                clean = line.strip()
                if not clean:
                    continue
                record = UploadedFile.from_dict(json.loads(clean))
                if record.deleted_at is None or include_deleted:
                    yield record

    # ------------------------------------------------------------------ delete

    def soft_delete(self, file_id: str) -> bool:
        """Mark the record deleted. Does NOT remove the bytes from disk."""
        records = list(self.iter_all(include_deleted=True))
        if not any(r.file_id == file_id for r in records):
            return False

        target = next(r for r in records if r.file_id == file_id)
        if target.deleted_at is not None:
            return True

        from datetime import datetime, timezone
        deleted_at = (
            datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
        new_record = UploadedFile(
            file_id=target.file_id,
            original_name=target.original_name,
            mime_type=target.mime_type,
            size_bytes=target.size_bytes,
            sha256=target.sha256,
            storage_path=target.storage_path,
            uploaded_at=target.uploaded_at,
            uploaded_by_node_id=target.uploaded_by_node_id,
            thread_id=target.thread_id,
            tags=target.tags,
            metadata=target.metadata,
            deleted_at=deleted_at,
        )

        with self._lock:
            tmp = self.metadata_path.with_suffix(".jsonl.tmp")
            with self.metadata_path.open("r", encoding="utf-8") as src:
                lines = src.readlines()
            with tmp.open("w", encoding="utf-8") as dst:
                for line in lines:
                    clean = line.strip()
                    if not clean:
                        dst.write(line)
                        continue
                    record = UploadedFile.from_dict(json.loads(clean))
                    if record.file_id == file_id:
                        dst.write(json.dumps(new_record.to_dict()) + "\n")
                    else:
                        dst.write(line)
            os.replace(tmp, self.metadata_path)
        return True

    def purge(self, file_id: str) -> bool:
        """Hard-delete: remove bytes + metadata line."""
        record = self.get(file_id)
        if record is None:
            return False
        absolute = Path(safe_join_under(str(self.data_dir), record.storage_path))
        if absolute.is_file():
            absolute.unlink()
        return self.soft_delete(file_id)

    # --------------------------------------------------------------- helpers

    def _append_metadata(self, record: UploadedFile) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            with self.metadata_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record.to_dict()) + "\n")


def _year_month_path(file_id: str) -> str:
    """Bucket uploads by year/month to keep directories small.

    Uses a deterministic prefix from the UUID so the same id maps to the
    same directory across calls.
    """
    # Use the first two chars of the UUID to distribute writes.
    prefix_a = file_id[:2] or "00"
    prefix_b = file_id[2:4] or "00"
    return f"{prefix_a}/{prefix_b}/{file_id}"


def _infer_extension(original_name: str, mime_type: str) -> str:
    """Best-effort extension inference for storage layout."""
    from .validators import extension_for

    ext = extension_for(original_name)
    if ext:
        return ext
    # Common fallbacks by mime type.
    fallback = {
        "application/pdf": "pdf",
        "application/json": "json",
        "application/zip": "zip",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "text/plain": "txt",
    }
    return fallback.get(mime_type, "bin")
