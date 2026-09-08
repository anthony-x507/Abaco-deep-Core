"""Data classes shared across the voice module.

Frozen dataclasses keep the contracts simple and make ``WhisperResult``
objects trivially comparable in tests (they are hashable by value).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# A whisper model name.  whisper-cli accepts ``tiny``, ``base``,
# ``small``, ``medium``, ``large`` (and ``tiny.en``/``base.en`` etc.).
WhisperModelName = str


@dataclass(frozen=True)
class WhisperResult:
    """Outcome of a whisper.cpp transcription run.

    The result is intentionally rich: ``segments`` preserves the
    per-chunk timing produced by whisper (used for waveform alignment
    in the frontend), while ``inference_seconds`` lets the UI show how
    long the model took relative to ``duration_seconds``.

    Attributes:
        text: Full transcription, joined from the segment list.
        language: ISO 639-1 code (e.g. ``"es"``, ``"en"``) reported by
            whisper.  Empty string when whisper could not auto-detect.
        duration_seconds: Audio duration reported by whisper.
        segments: Tuple of segment dicts as produced by
            ``--output-json`` (each contains ``start``, ``end`` and
            ``text``).  Kept as a tuple so the dataclass stays hashable.
        model_used: The whisper model name (``"base"``, ``"tiny"``...).
        inference_seconds: Wall-clock time spent in whisper-cli.
    """

    text: str
    language: str
    duration_seconds: float
    segments: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    model_used: str = "base"
    inference_seconds: float = 0.0


@dataclass(frozen=True)
class TTSRequest:
    """Parameters for a single TTS invocation.

    ``voice`` defaults to ``"es_Mexico"`` because the project's primary
    locale is Spanish (Mexico); ``rate`` is in words per minute and
    matches the ``-r`` flag of macOS ``say``.
    """

    text: str
    voice: str = "es_Mexico"
    rate: int = 200


@dataclass(frozen=True)
class VoiceInfo:
    """A voice available on the host as reported by ``say -v ?``.

    ``say`` returns one line per voice in the format::

        Name    Lang    Sample Text

    ``Sample Text`` may contain spaces, which is why we split on the
    first two tab-like runs of whitespace (in practice ``say`` uses a
    fixed column layout so splitting on two-tab-windows works fine).
    """

    name: str
    language: str
    sample_text: str
    locale: str = ""

    def as_dict(self) -> dict[str, str]:
        """Return a JSON-friendly representation."""

        return {
            "name": self.name,
            "language": self.language,
            "locale": self.locale,
            "sample_text": self.sample_text,
        }


@dataclass(frozen=True)
class STTRequest:
    """Parameters for a single STT invocation.

    Attributes:
        audio_path: Path to the audio file to transcribe.
        language: ISO 639-1 code to force, or ``None`` for auto-detect.
        translate_to_english: When ``True``, ask whisper to translate
            the audio into English (requires a multilingual model).
    """

    audio_path: Path
    language: str | None = None
    translate_to_english: bool = False


@dataclass(frozen=True)
class AudioClip:
    """A recorded audio clip, stored on disk before STT/TTS roundtrip."""

    path: Path
    sample_rate: int
    channels: int
    duration_seconds: float
    format: str = "wav"


__all__ = [
    "AudioClip",
    "STTRequest",
    "TTSRequest",
    "VoiceInfo",
    "WhisperModelName",
    "WhisperResult",
]
