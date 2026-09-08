"""File upload backend for abaco-deep-core.

Provides endpoints to upload, retrieve, list, and delete files attached to chat
threads. Files are stored on disk under ``~/.abaco-deep-core/uploads/`` with
metadata persisted as JSONL.
"""

from .models import UploadedFile
from .storage import FileStorage
from .validators import validate_upload, FileTooLargeError, UnsupportedMimeTypeError
from .attachment import AttachmentRegistry

__all__ = [
    "UploadedFile",
    "FileStorage",
    "AttachmentRegistry",
    "validate_upload",
    "FileTooLargeError",
    "UnsupportedMimeTypeError",
]
