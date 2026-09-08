"""Data models for file uploads."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class UploadedFile:
    """Metadata for a file uploaded to the local node."""

    file_id: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    storage_path: str
    uploaded_at: str
    uploaded_by_node_id: str
    thread_id: str | None = None
    tags: tuple[str, ...] = ()
    metadata: dict[str, object] = field(default_factory=dict)
    deleted_at: str | None = None

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        return data

    @staticmethod
    def from_dict(data: dict[str, object]) -> "UploadedFile":
        return UploadedFile(
            file_id=str(data["file_id"]),
            original_name=str(data["original_name"]),
            mime_type=str(data["mime_type"]),
            size_bytes=int(data["size_bytes"]),
            sha256=str(data["sha256"]),
            storage_path=str(data["storage_path"]),
            uploaded_at=str(data["uploaded_at"]),
            uploaded_by_node_id=str(data["uploaded_by_node_id"]),
            thread_id=data.get("thread_id") if data.get("thread_id") is not None else None,
            tags=tuple(str(t) for t in data.get("tags", [])),
            metadata=dict(data.get("metadata") or {}),
            deleted_at=data.get("deleted_at") if data.get("deleted_at") is not None else None,
        )


def make_uploaded_file(
    *,
    file_id: str,
    original_name: str,
    mime_type: str,
    size_bytes: int,
    sha256: str,
    storage_path: str,
    uploaded_by_node_id: str,
    thread_id: str | None = None,
    tags: tuple[str, ...] = (),
    metadata: dict[str, object] | None = None,
    uploaded_at: str | None = None,
) -> UploadedFile:
    """Factory that fills in the upload timestamp automatically."""

    return UploadedFile(
        file_id=file_id,
        original_name=original_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        sha256=sha256,
        storage_path=storage_path,
        uploaded_at=uploaded_at or _utc_now_iso(),
        uploaded_by_node_id=uploaded_by_node_id,
        thread_id=thread_id,
        tags=tags,
        metadata=metadata or {},
    )
