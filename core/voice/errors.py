"""Exception hierarchy for the voice module.

Errors are split into granular subclasses so the FastAPI layer can map
each one to the correct HTTP status code without parsing message text.
"""

from __future__ import annotations


class VoiceError(RuntimeError):
    """Base class for any error raised by the voice module."""


class BinaryNotFoundError(VoiceError, FileNotFoundError):
    """Raised when an external binary (whisper-cli, say, sox, ffmpeg) is
    not on disk or returned a non-zero exit code without producing output.

    Subclasses include enough context that the caller does not have to
    inspect strings to decide whether to ask the user to install the
    binary or retry.
    """


class WhisperBinaryNotFoundError(BinaryNotFoundError):
    """``whisper-cli`` could not be located on disk."""


class WhisperModelNotFoundError(BinaryNotFoundError):
    """The configured whisper ``.bin`` model is missing."""


class WhisperInvocationError(VoiceError):
    """``whisper-cli`` ran but exited with a non-zero status (or produced
    unreadable output)."""


class AudioInputError(VoiceError, ValueError):
    """Raised when an audio path does not exist or is not readable."""


class TTSInvocationError(VoiceError):
    """Raised when the macOS ``say`` command fails or is unavailable."""


class TTSSaveError(VoiceError):
    """Raised when generating an audio file with ``say -o`` fails."""


class RecorderError(VoiceError):
    """Raised when an audio recorder (backend ``sox``/``ffmpeg``) fails."""


class PlayerError(VoiceError):
    """Raised when audio playback (``afplay``/``ffplay``) fails."""


__all__ = [
    "AudioInputError",
    "BinaryNotFoundError",
    "PlayerError",
    "RecorderError",
    "TTSInvocationError",
    "TTSSaveError",
    "VoiceError",
    "WhisperBinaryNotFoundError",
    "WhisperInvocationError",
    "WhisperModelNotFoundError",
]
