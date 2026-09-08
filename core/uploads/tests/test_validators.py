"""Tests for ``core.uploads.validators``.

This module is a thin, additional test file dedicated to the validator
helpers.  It complements the broader tests in ``test_uploads.py`` with
fine-grained cases that focus on the validation surface (sanitisation,
MIME whitelist and size guard).
"""

from __future__ import annotations

import unittest

from core.uploads.validators import (
    FileTooLargeError,
    InvalidFilenameError,
    UnsupportedMimeTypeError,
    extension_for,
    is_mime_allowed,
    sanitize_filename,
    validate_upload,
    MAX_FILE_BYTES,
)


class TestSanitiseFilename(unittest.TestCase):
    def test_replaces_path_separators_with_underscore(self) -> None:
        self.assertEqual(sanitize_filename("../../etc/passwd"), ".._.._etc_passwd")

    def test_replaces_windows_separators(self) -> None:
        self.assertEqual(sanitize_filename(r"..\..\boot.ini"), ".._.._boot.ini")

    def test_replaces_control_characters(self) -> None:
        self.assertEqual(sanitize_filename("foo\x00bar"), "foo_bar")
        self.assertEqual(sanitize_filename("foo\x7fbar"), "foo_bar")
        self.assertEqual(sanitize_filename("foo\nbar"), "foo_bar")

    def test_replaces_pipe_and_colon(self) -> None:
        # Characters that are illegal on Windows filesystems.
        self.assertEqual(sanitize_filename('a:b|c?d"e<f>g'), "a_b_c_d_e_f_g")

    def test_rejects_empty_string(self) -> None:
        with self.assertRaises(InvalidFilenameError):
            sanitize_filename("")

    def test_rejects_whitespace_only(self) -> None:
        with self.assertRaises(InvalidFilenameError):
            sanitize_filename("   ")

    def test_truncates_at_255_chars(self) -> None:
        long = "a" * 1024
        cleaned = sanitize_filename(long)
        self.assertEqual(len(cleaned), 255)

    def test_strips_trailing_dots(self) -> None:
        # Windows refuses filenames that end with dots.
        self.assertEqual(sanitize_filename("hello..."), "hello")

    def test_rejects_when_only_dots(self) -> None:
        with self.assertRaises(InvalidFilenameError):
            sanitize_filename("...")


class TestMimeWhitelist(unittest.TestCase):
    def test_image_prefix_is_allowed(self) -> None:
        for mime in ("image/png", "image/jpeg", "image/webp", "image/gif"):
            self.assertTrue(is_mime_allowed(mime), mime)

    def test_text_prefix_is_allowed(self) -> None:
        for mime in ("text/plain", "text/html", "text/csv", "text/markdown"):
            self.assertTrue(is_mime_allowed(mime), mime)

    def test_exact_application_types(self) -> None:
        for mime in (
            "application/pdf",
            "application/json",
            "application/zip",
            "application/octet-stream",
        ):
            self.assertTrue(is_mime_allowed(mime), mime)

    def test_executable_types_are_blocked(self) -> None:
        for mime in (
            "application/x-msdownload",
            "application/x-executable",
            "application/x-sh",
        ):
            self.assertFalse(is_mime_allowed(mime), mime)

    def test_empty_string_is_rejected(self) -> None:
        self.assertFalse(is_mime_allowed(""))


class TestSizeValidation(unittest.TestCase):
    def test_negative_size_is_rejected(self) -> None:
        with self.assertRaises(FileTooLargeError):
            validate_upload(
                filename="x.bin",
                mime_type="application/octet-stream",
                size_bytes=-1,
            )

    def test_size_over_limit_is_rejected(self) -> None:
        with self.assertRaises(FileTooLargeError):
            validate_upload(
                filename="x.bin",
                mime_type="application/octet-stream",
                size_bytes=MAX_FILE_BYTES + 1,
            )

    def test_size_at_limit_is_accepted(self) -> None:
        # Should not raise.
        validate_upload(
            filename="x.bin",
            mime_type="application/octet-stream",
            size_bytes=MAX_FILE_BYTES,
        )

    def test_unsupported_mime_is_rejected(self) -> None:
        with self.assertRaises(UnsupportedMimeTypeError):
            validate_upload(
                filename="virus.exe",
                mime_type="application/x-msdownload",
                size_bytes=10,
            )


class TestExtensionFor(unittest.TestCase):
    def test_returns_lowercased_extension(self) -> None:
        self.assertEqual(extension_for("file.PDF"), "pdf")

    def test_strips_leading_dot(self) -> None:
        self.assertEqual(extension_for("file.txt"), "txt")

    def test_empty_for_no_extension(self) -> None:
        self.assertEqual(extension_for("README"), "")

    def test_handles_unicode(self) -> None:
        self.assertEqual(extension_for("café.JSON"), "json")


if __name__ == "__main__":
    unittest.main()
