"""FastAPI handlers for the upload endpoints.

Endpoints
---------
- POST /api/uploads              multipart/form-data
- GET  /api/uploads              list (?thread_id=, ?node_id=)
- GET  /api/uploads/{file_id}    metadata
- GET  /api/uploads/{file_id}/content  raw bytes
- DELETE /api/uploads/{file_id}  soft-delete
"""

from __future__ import annotations

from dataclasses import dataclass

from .attachment import AttachmentRegistry
from .storage import FileStorage
from .validators import (
    FileTooLargeError,
    InvalidFilenameError,
    UnsupportedMimeTypeError,
    validate_upload,
)


@dataclass
class UploadResponse:
    """Lightweight response payload for /api/uploads."""

    file_id: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    thread_id: str | None


def handle_upload(
    *,
    storage: FileStorage,
    attachments: AttachmentRegistry,
    thread_id: str | None,
    node_id: str,
    filename: str,
    mime_type: str,
    content: bytes,
    tags: tuple[str, ...] = (),
) -> UploadResponse:
    """Validate, persist, and (if thread_id) attach the uploaded file."""

    safe_name = validate_upload(
        filename=filename,
        mime_type=mime_type,
        size_bytes=len(content),
    )
    stored = storage.store_bytes(
        original_name=safe_name,
        mime_type=mime_type,
        content=content,
        uploaded_by_node_id=node_id,
        thread_id=thread_id,
        tags=tags,
    )
    if thread_id:
        attachments.attach(thread_id=thread_id, file_id=stored.file.file_id)
    return UploadResponse(
        file_id=stored.file.file_id,
        original_name=stored.file.original_name,
        mime_type=stored.file.mime_type,
        size_bytes=stored.file.size_bytes,
        sha256=stored.file.sha256,
        thread_id=thread_id,
    )


def list_uploads(
    *,
    storage: FileStorage,
    thread_id: str | None = None,
    node_id: str | None = None,
    include_deleted: bool = False,
) -> list[dict[str, object]]:
    if thread_id:
        records = storage.list_for_thread(thread_id, include_deleted=include_deleted)
    elif node_id:
        records = storage.list_for_node(node_id, include_deleted=include_deleted)
    else:
        records = list(storage.iter_all(include_deleted=include_deleted))
    return [r.to_dict() for r in records]


def get_upload(*, storage: FileStorage, file_id: str) -> dict[str, object] | None:
    record = storage.get(file_id)
    if record is None or record.deleted_at is not None:
        return None
    return record.to_dict()


def read_upload_bytes(*, storage: FileStorage, file_id: str) -> bytes | None:
    return storage.read_bytes(file_id)


def delete_upload(*, storage: FileStorage, file_id: str) -> bool:
    return storage.soft_delete(file_id)


__all__ = [
    "UploadResponse",
    "handle_upload",
    "list_uploads",
    "get_upload",
    "read_upload_bytes",
    "delete_upload",
    "FileTooLargeError",
    "InvalidFilenameError",
    "UnsupportedMimeTypeError",
]
