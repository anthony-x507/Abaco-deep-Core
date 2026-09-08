"""FastAPI router exposing the voice module over HTTP.

The router is purposely small and follows the same conventions used by
``core.compaction.api``: importing ``fastapi`` is deferred until the
router is built so the module keeps working without an HTTP server.

Endpoints (mounted at ``/api/voice``):

* ``GET  /voices``         – list available macOS voices.
* ``POST /tts``            – render text to an AIFF file on disk.
* ``POST /tts/speak``      – speak text through the default audio device.
* ``POST /stt``            – transcribe an uploaded audio file.
* ``GET  /status``         – pipeline stats & binary availability.

Upload endpoints accept multipart/form-data so the desktop shell can
``POST`` a ``Blob`` recorded with ``MediaRecorder`` without any extra
serialisation.
"""

from __future__ import annotations

import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from core.voice.errors import (
    AudioInputError,
    TTSInvocationError,
    WhisperBinaryNotFoundError,
    WhisperInvocationError,
    WhisperModelNotFoundError,
)
from core.voice.models import TTSRequest, VoiceInfo, WhisperResult
from core.voice.pipeline import VoicePipeline
from core.voice.tts_runner import TTSRunner
from core.voice.whisper_runner import WhisperRunner
from core.voice.voices import list_voices as list_voices_impl


try:  # pragma: no cover - exercised only when fastapi is installed
    from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile  # noqa: F401
    from pydantic import BaseModel, Field  # noqa: F401

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised when fastapi missing
    APIRouter = None  # type: ignore[assignment]
    FastAPI = None  # type: ignore[assignment]
    HTTPException = None  # type: ignore[assignment]
    BaseModel = None  # type: ignore[assignment]
    Field = None  # type: ignore[assignment]
    File = None  # type: ignore[assignment]
    Form = None  # type: ignore[assignment]
    UploadFile = None  # type: ignore[assignment]
    _FASTAPI_AVAILABLE = False


def _require_fastapi() -> None:
    if not _FASTAPI_AVAILABLE:
        raise RuntimeError(
            "fastapi is not installed; install it with "
            "`pip install fastapi pydantic` to use the voice HTTP API"
        )


# ----------------------------------------------------------------------
# Request models
# ----------------------------------------------------------------------


if _FASTAPI_AVAILABLE:  # pragma: no cover - import-guarded

    class TTSRequestBody(BaseModel):
        text: str = Field(..., min_length=1, max_length=8000)
        voice: str = Field(default="es_Mexico", max_length=64)
        rate: int = Field(default=200, ge=80, le=400)
        output_filename: str | None = Field(default=None, max_length=128)


    class STTRequestBody(BaseModel):
        """Request metadata for ``POST /api/voice/stt``.

        The actual audio bytes arrive as ``multipart/form-data`` (the
        ``file`` field).  This body holds the optional knobs.
        """

        language: str | None = Field(default=None, max_length=8)
        translate_to_english: bool = False


else:  # pragma: no cover - import-guarded

    class TTSRequestBody:  # type: ignore[no-redef]
        text: str = ""
        voice: str = "es_Mexico"
        rate: int = 200
        output_filename: str | None = None

        def __init__(self, **kwargs: Any) -> None:  # pragma: no cover
            for key, value in kwargs.items():
                setattr(self, key, value)


    class STTRequestBody:  # type: ignore[no-redef]
        language: str | None = None
        translate_to_english: bool = False


# ----------------------------------------------------------------------
# Router factory
# ----------------------------------------------------------------------


def build_router(
    *,
    pipeline: VoicePipeline,
    tts_runner: TTSRunner,
    whisper_runner: WhisperRunner,
    upload_dir: Path | None = None,
) -> Any:
    """Return a FastAPI router wired to the supplied runners.

    Args:
        pipeline: The :class:`VoicePipeline` used for stats.
        tts_runner: The :class:`TTSRunner` driving macOS ``say``.
        whisper_runner: The :class:`WhisperRunner` driving whisper.cpp.
        upload_dir: Where uploaded audio blobs are stored while they
            are transcribed.  Defaults to a temporary directory that
            is cleaned up on process exit.
    """

    _require_fastapi()
    router = APIRouter(prefix="/api/voice", tags=["voice"])
    owned_upload_dir: tempfile.TemporaryDirectory | None = None
    if upload_dir is None:
        owned_upload_dir = tempfile.TemporaryDirectory(prefix="abaco-voice-")
        upload_dir = Path(owned_upload_dir.name)
    upload_dir.mkdir(parents=True, exist_ok=True)

    def _voice_to_dict(voice: VoiceInfo) -> dict[str, str]:
        return voice.as_dict()

    @router.get("/voices")
    def voices() -> dict[str, Any]:
        try:
            data = list_voices_impl(say_binary=tts_runner.say_binary)
        except TTSInvocationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"ok": True, "voices": [_voice_to_dict(v) for v in data]}

    @router.post("/tts")
    def tts(body: TTSRequestBody) -> dict[str, Any]:
        request = TTSRequest(text=body.text, voice=body.voice, rate=body.rate)
        filename = body.output_filename or f"reply-{uuid.uuid4().hex}.aiff"
        target = upload_dir / filename
        try:
            saved = tts_runner.save_request(request, target)
        except TTSInvocationError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {
            "ok": True,
            "audio_path": str(saved),
            "audio_url": f"/api/voice/audio/{saved.name}",
            "voice": body.voice,
            "rate": body.rate,
            "text": body.text,
            "bytes": saved.stat().st_size,
        }

    @router.post("/tts/speak")
    def tts_speak(body: TTSRequestBody) -> dict[str, Any]:
        request = TTSRequest(text=body.text, voice=body.voice, rate=body.rate)
        try:
            tts_runner.speak_request(request)
        except TTSInvocationError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {"ok": True, "spoken": body.text}

    @router.post("/stt")
    async def stt(  # noqa: D401 - FastAPI requires async signature
        file: UploadFile = File(...),
        language: str | None = Form(default=None),
        translate_to_english: bool = Form(default=False),
    ) -> dict[str, Any]:
        suffix = Path(file.filename or "").suffix or ".wav"
        target = upload_dir / f"upload-{uuid.uuid4().hex}{suffix}"
        target.write_bytes(await file.read())
        try:
            result: WhisperResult = whisper_runner.transcribe(
                target,
                language=language,
                translate_to_english=translate_to_english,
            )
        except WhisperBinaryNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except WhisperModelNotFoundError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except WhisperInvocationError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except AudioInputError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            try:
                target.unlink(missing_ok=True)
            except OSError:  # pragma: no cover - best effort cleanup
                pass
        return _whisper_result_to_dict(result)

    @router.get("/status")
    def status() -> dict[str, Any]:
        return {
            "ok": True,
            "pipeline": pipeline.describe(),
            "binary_available": _binary_status(whisper_runner),
        }

    def _cleanup() -> None:  # pragma: no cover - lifecycle hook
        if owned_upload_dir is not None:
            try:
                owned_upload_dir.cleanup()
            except OSError:
                pass

    router._cleanup = _cleanup  # type: ignore[attr-defined]
    return router


def _binary_status(whisper_runner: WhisperRunner) -> dict[str, bool | str]:
    binary = whisper_runner.whisper_binary
    model = whisper_runner.model_path
    return {
        "binary_exists": binary.exists(),
        "binary_path": str(binary),
        "model_exists": model.exists(),
        "model_path": str(model),
    }


def _whisper_result_to_dict(result: WhisperResult) -> dict[str, Any]:
    return {
        "ok": True,
        "text": result.text,
        "language": result.language,
        "duration_seconds": result.duration_seconds,
        "segments": list(result.segments),
        "model_used": result.model_used,
        "inference_seconds": result.inference_seconds,
    }


# ----------------------------------------------------------------------
# Stand-alone app
# ----------------------------------------------------------------------


_default_pipeline_lock = threading.Lock()


def create_app(
    *,
    pipeline: VoicePipeline | None = None,
    upload_dir: Path | None = None,
) -> Any:
    """Build a stand-alone FastAPI app exposing the voice endpoints."""

    _require_fastapi()
    with _default_pipeline_lock:
        pipeline = pipeline or VoicePipeline()
    app = FastAPI(title="abaco-deep-core voice API", version="0.1.0")
    app.include_router(
        build_router(
            pipeline=pipeline,
            tts_runner=pipeline.tts_runner,
            whisper_runner=pipeline.whisper_runner,
            upload_dir=upload_dir,
        )
    )
    return app


__all__ = [
    "STTRequestBody",
    "TTSRequestBody",
    "build_router",
    "create_app",
]
