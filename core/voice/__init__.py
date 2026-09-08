"""Voice support for abaco-deep-core.

This package wraps two local tools:

* **STT** – :mod:`core.voice.whisper_runner` shells out to the
  ``whisper-cli`` binary from `whisper.cpp
  <https://github.com/ggerganov/whisper.cpp>`_.
* **TTS** – :mod:`core.voice.tts_runner` shells out to macOS's
  built-in ``say`` command.

The frontend can use :mod:`core.voice.audio_recorder` /
:mod:`core.voice.audio_player` for backend recording and playback,
but is expected to use the browser's ``MediaRecorder`` API and the
``<audio>`` element directly.

Quickstart::

    from core.voice import VoicePipeline, WhisperRunner, TTSRunner

    pipeline = VoicePipeline()
    spoken = pipeline.render_to_file("hola mundo", Path("/tmp/hola.aiff"))
    transcript = pipeline.transcribe_file(spoken.audio_path)
    print(transcript.result.text)
"""

from __future__ import annotations


# Re-export everything so ``from core.voice import X`` keeps working
# without forcing callers to dig through nested modules.
from core.voice.audio_player import AudioPlayer
from core.voice.audio_recorder import AudioRecorder
from core.voice.errors import (
    AudioInputError,
    BinaryNotFoundError,
    PlayerError,
    RecorderError,
    TTSInvocationError,
    TTSSaveError,
    VoiceError,
    WhisperBinaryNotFoundError,
    WhisperInvocationError,
    WhisperModelNotFoundError,
)
from core.voice.models import (
    AudioClip,
    STTRequest,
    TTSRequest,
    VoiceInfo,
    WhisperModelName,
    WhisperResult,
)
from core.voice.pipeline import (
    SpokenTurn,
    TranscriptTurn,
    VoicePipeline,
    VoicePipelineStats,
    pipeline_from_mapping,
)
from core.voice.tts_runner import TTSRunner
from core.voice.voices import (
    DEFAULT_VOICE,
    filter_by_language,
    list_voices,
    pick_default_voice,
)
from core.voice.whisper_runner import WhisperRunner


__all__ = [
    "AudioClip",
    "AudioInputError",
    "AudioPlayer",
    "AudioRecorder",
    "BinaryNotFoundError",
    "DEFAULT_VOICE",
    "PlayerError",
    "RecorderError",
    "SpokenTurn",
    "STTRequest",
    "TTSInvocationError",
    "TTSRequest",
    "TTSRunner",
    "TTSSaveError",
    "TranscriptTurn",
    "VoiceError",
    "VoiceInfo",
    "VoicePipeline",
    "VoicePipelineStats",
    "WhisperBinaryNotFoundError",
    "WhisperInvocationError",
    "WhisperModelName",
    "WhisperModelNotFoundError",
    "WhisperResult",
    "WhisperRunner",
    "filter_by_language",
    "list_voices",
    "pick_default_voice",
    "pipeline_from_mapping",
]
