"""Validators for incoming uploads."""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import PurePosixPath

# Whitelist of MIME types accepted.
ALLOWED_MIME_PREFIXES: tuple[str, ...] = (
    "image/",
    "text/",
    "audio/",
    "video/",
)

ALLOWED_MIME_EXACT: frozenset[str] = frozenset({
    "application/pdf",
    "application/json",
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/octet-stream",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
})

# Maximum size per file (100 MB).
MAX_FILE_BYTES: int = 100 * 1024 * 1024

# Reserved / suspicious filename characters (sanitized on display only).
_FILENAME_FORBIDDEN = re.compile(r"[\x00-\x1f\x7f/\\:*?\"<>|]")


class UploadValidationError(ValueError):
    """Base class for upload validation failures."""


class FileTooLargeError(UploadValidationError):
    """Raised when the file exceeds the configured size limit."""


class UnsupportedMimeTypeError(UploadValidationError):
    """Raised when the MIME type is not in the allow-list."""


class InvalidFilenameError(UploadValidationError):
    """Raised when the filename is empty, too long, or has control chars."""


def sanitize_filename(original: str) -> str:
    """Return a safe display filename. Strips control chars and path separators."""
    if not original or not original.strip():
        raise InvalidFilenameError("filename is empty")
    cleaned = _FILENAME_FORBIDDEN.sub("_", original).strip().strip(".")
    if len(cleaned) > 255:
        cleaned = cleaned[:255]
    if not cleaned:
        raise InvalidFilenameError("filename becomes empty after sanitization")
    return cleaned


def is_mime_allowed(mime: str) -> bool:
    """Return True if ``mime`` is in the allow-list."""
    if not mime:
        return False
    if mime in ALLOWED_MIME_EXACT:
        return True
    return any(mime.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES)


def safe_join_under(root: str, *parts: str) -> str:
    """Join ``parts`` under ``root`` and ensure the result does not escape."""
    candidate = os.path.normpath(os.path.join(root, *parts))
    root_norm = os.path.normpath(root)
    if candidate != root_norm and not candidate.startswith(root_norm + os.sep):
        raise ValueError(f"path escapes root: {candidate}")
    return candidate


def validate_upload(
    *,
    filename: str,
    mime_type: str,
    size_bytes: int,
) -> str:
    """Validate the upload inputs and return the sanitized filename.

    Raises:
        InvalidFilenameError: filename is empty or has control chars.
        FileTooLargeError: size_bytes > MAX_FILE_BYTES.
        UnsupportedMimeTypeError: mime_type not allowed.
    """

    safe_name = sanitize_filename(filename)
    if size_bytes < 0:
        raise FileTooLargeError("negative size")
    if size_bytes > MAX_FILE_BYTES:
        raise FileTooLargeError(
            f"file too large: {size_bytes} bytes > {MAX_FILE_BYTES}"
        )
    if not is_mime_allowed(mime_type):
        raise UnsupportedMimeTypeError(f"mime type not allowed: {mime_type!r}")
    return safe_name


def extension_for(filename: str) -> str:
    """Return the lower-cased extension without the dot, or empty string."""
    name = unicodedata.normalize("NFC", filename)
    ext = PurePosixPath(name).suffix.lower().lstrip(".")
    return ext
