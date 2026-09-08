"""Attachment registry: associates uploaded files with chat threads."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .models import UploadedFile
from .storage import FileStorage


@dataclass(frozen=True)
class AttachmentLink:
    """An uploaded file bound to a thread and an optional message id."""

    thread_id: str
    file_id: str
    message_id: str | None


class AttachmentRegistry:
    """In-memory index of attachments per thread.

    Persists to a JSON file at ``data_dir/attachments.json`` when constructed
    with a ``persist_path`` so the index survives restarts.
    """

    def __init__(self, storage: FileStorage, *, persist_path: Path | None = None) -> None:
        self.storage = storage
        self.persist_path = persist_path
        self._links: dict[tuple[str, str], AttachmentLink] = {}
        if persist_path is not None and persist_path.is_file():
            import json

            with persist_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            for entry in raw.get("links", []):
                link = AttachmentLink(
                    thread_id=str(entry["thread_id"]),
                    file_id=str(entry["file_id"]),
                    message_id=entry.get("message_id"),
                )
                self._links[(link.thread_id, link.file_id)] = link

    # ------------------------------------------------------------------ write

    def attach(
        self,
        *,
        thread_id: str,
        file_id: str,
        message_id: str | None = None,
    ) -> AttachmentLink:
        record = self.storage.get(file_id)
        if record is None:
            raise KeyError(f"file not found: {file_id}")
        link = AttachmentLink(thread_id=thread_id, file_id=file_id, message_id=message_id)
        self._links[(thread_id, file_id)] = link
        self._persist()
        return link

    def detach(self, *, thread_id: str, file_id: str) -> bool:
        existed = self._links.pop((thread_id, file_id), None) is not None
        if existed:
            self._persist()
        return existed

    # ------------------------------------------------------------------- read

    def files_in_thread(self, thread_id: str) -> list[UploadedFile]:
        out: list[UploadedFile] = []
        for (tid, fid), _link in self._links.items():
            if tid != thread_id:
                continue
            record = self.storage.get(fid)
            if record is not None and record.deleted_at is None:
                out.append(record)
        return out

    def thread_ids_for_file(self, file_id: str) -> list[str]:
        return [tid for (tid, fid) in self._links if fid == file_id]

    def all_links(self) -> list[AttachmentLink]:
        return list(self._links.values())

    # ------------------------------------------------------------------ persist

    def _persist(self) -> None:
        if self.persist_path is None:
            return
        import json

        self.persist_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "links": [
                {
                    "thread_id": link.thread_id,
                    "file_id": link.file_id,
                    "message_id": link.message_id,
                }
                for link in self._links.values()
            ]
        }
        tmp = self.persist_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self.persist_path)
