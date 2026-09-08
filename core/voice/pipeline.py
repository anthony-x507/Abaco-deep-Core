"""High-level STT + TTS orchestration.

The :class:`VoicePipeline` glues the runners together so the FastAPI
layer and CLI tools only need one entry point.  Both runners are
injected, which keeps the module free of any state and trivially
mockable.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from core.voice.audio_player import AudioPlayer
from core.voice.audio_recorder import AudioRecorder
from core.voice.errors import VoiceError
from core.voice.models import (
    STTRequest,
    TTSRequest,
    WhisperResult,
)
from core.voice.tts_runner import TTSRunner
from core.voice.whisper_runner import WhisperRunner


@dataclass(frozen=True)
class TranscriptTurn:
    """One half of a STT+TTS round trip."""

    audio_path: Path
    result: WhisperResult


@dataclass(frozen=True)
class SpokenTurn:
    """One rendered TTS turn, returned with metadata."""

    audio_path: Path
    text: str
    voice: str
    rate: int


@dataclass(frozen=True)
class VoicePipelineStats:
    """Counters useful for diagnostics."""

    stt_runs: int = 0
    tts_runs: int = 0
    last_language: str = ""


class VoicePipeline:
    """Compose STT and TTS so other layers can call a single API."""

    def __init__(
        self,
        whisper_runner: WhisperRunner | None = None,
        tts_runner: TTSRunner | None = None,
        recorder: AudioRecorder | None = None,
        player: AudioPlayer | None = None,
    ) -> None:
        self.whisper_runner = whisper_runner or WhisperRunner()
        self.tts_runner = tts_runner or TTSRunner()
        self.recorder = recorder
        self.player = player
        self._stats = VoicePipelineStats()
        # Mutating ``_stats`` reads from a fresh dataclass each time to
        # keep callers from holding on to a stale snapshot.
        self._mut_stats = VoicePipelineStats()

    # ------------------------------------------------------------------
    # Bookkeeping helpers
    # ------------------------------------------------------------------

    @property
    def stats(self) -> VoicePipelineStats:
        return VoicePipelineStats(
            stt_runs=self._mut_stats.stt_runs,
            tts_runs=self._mut_stats.tts_runs,
            last_language=self._mut_stats.last_language,
        )

    def _record_stt(self, result: WhisperResult) -> None:
        self._mut_stats = VoicePipelineStats(
            stt_runs=self._mut_stats.stt_runs + 1,
            tts_runs=self._mut_stats.tts_runs,
            last_language=result.language,
        )

    def _record_tts(self, *, voice: str) -> None:
        self._mut_stats = VoicePipelineStats(
            stt_runs=self._mut_stats.stt_runs,
            tts_runs=self._mut_stats.tts_runs + 1,
            last_language=self._mut_stats.last_language,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def transcribe_file(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        translate_to_english: bool = False,
    ) -> TranscriptTurn:
        """Transcribe ``audio_path`` and return a :class:`TranscriptTurn`.

        Thin wrapper that folds :class:`WhisperRunner.transcribe` into a
        dataclass so the API layer does not need to know about whisper.
        """

        result = self.whisper_runner.transcribe(
            audio_path,
            language=language,
            translate_to_english=translate_to_english,
        )
        self._record_stt(result)
        return TranscriptTurn(audio_path=Path(audio_path), result=result)

    def transcribe_request(self, request: STTRequest) -> TranscriptTurn:
        """Transcribe using an :class:`STTRequest`."""

        return self.transcribe_file(
            request.audio_path,
            language=request.language,
            translate_to_english=request.translate_to_english,
        )

    def speak(
        self,
        text: str,
        *,
        voice: str = "es_Mexico",
        rate: int = 200,
    ) -> None:
        """Speak ``text`` through the speaker using :class:`TTSRunner`."""

        self.tts_runner.speak(text, voice=voice, rate=rate)
        self._record_tts(voice=voice)

    def speak_request(self, request: TTSRequest) -> None:
        """Speak a :class:`TTSRequest`."""

        self.speak(request.text, voice=request.voice, rate=request.rate)

    def render_to_file(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str = "es_Mexico",
        rate: int = 200,
    ) -> SpokenTurn:
        """Render ``text`` to ``output_path`` and return the metadata."""

        resolved = self.tts_runner.save_to_file(
            text,
            output_path,
            voice=voice,
            rate=rate,
        )
        self._record_tts(voice=voice)
        return SpokenTurn(
            audio_path=resolved,
            text=text,
            voice=voice,
            rate=rate,
        )

    def render_request(
        self,
        request: TTSRequest,
        output_path: Path,
    ) -> SpokenTurn:
        """Render a :class:`TTSRequest` to ``output_path``."""

        return self.render_to_file(
            request.text,
            output_path,
            voice=request.voice,
            rate=request.rate,
        )

    def round_trip(
        self,
        text: str,
        *,
        voice: str = "es_Mexico",
        rate: int = 200,
    ) -> SpokenTurn:
        """Convenience: render ``text`` to a temp file using the given voice."""

        import tempfile  # local import to keep the module light
        with tempfile.TemporaryDirectory(prefix="abaco-voice-") as tmp:
            tmpdir = Path(tmp)
            return self.render_to_file(
                text,
                tmpdir / "reply.aiff",
                voice=voice,
                rate=rate,
            )

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def describe(self) -> dict[str, Any]:
        """Return a JSON-friendly snapshot of the pipeline configuration."""

        return {
            "whisper_binary": str(self.whisper_runner.whisper_binary),
            "model_path": str(self.whisper_runner.model_path),
            "say_binary": getattr(self.tts_runner, "say_binary", "say"),
            "recorder_available": self.recorder is not None,
            "player_available": self.player is not None,
            "stats": {
                "stt_runs": self.stats.stt_runs,
                "tts_runs": self.stats.tts_runs,
                "last_language": self.stats.last_language,
            },
        }


def pipeline_from_mapping(
    payload: Mapping[str, Any],
) -> tuple[STTRequest | None, TTSRequest | None]:
    """Decode an HTTP payload into request objects.

    The payload may contain zero, one or both requests::

        {"stt": {...}, "tts": {...}}

    ``None`` is returned for any absent block so the caller can decide
    what to do (most callers will reject the request with HTTP 400).
    """

    stt_payload = payload.get("stt")
    tts_payload = payload.get("tts")
    stt: STTRequest | None = None
    tts: TTSRequest | None = None
    if isinstance(stt_payload, Mapping):
        path = Path(str(stt_payload.get("audio_path", "")))
        stt = STTRequest(
            audio_path=path,
            language=stt_payload.get("language"),
            translate_to_english=bool(stt_payload.get("translate_to_english", False)),
        )
    if isinstance(tts_payload, Mapping):
        tts = TTSRequest(
            text=str(tts_payload.get("text", "") or ""),
            voice=str(tts_payload.get("voice", "es_Mexico") or "es_Mexico"),
            rate=int(tts_payload.get("rate", 200) or 200),
        )
    return stt, tts


__all__ = [
    "SpokenTurn",
    "TranscriptTurn",
    "VoicePipeline",
    "VoicePipelineStats",
    "pipeline_from_mapping",
]


# ``VoiceError`` is imported above so it is part of the namespace but
# unused at runtime.  Re-export under a no-op pattern to keep type
# checkers happy without affecting behaviour.
_ = VoiceError
