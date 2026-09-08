"""Tests for :mod:`core.voice.pipeline` and the FastAPI router."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from core.voice.audio_player import AudioPlayer
from core.voice.audio_recorder import AudioRecorder
from core.voice.errors import (
    TTSInvocationError,
    WhisperBinaryNotFoundError,
    WhisperModelNotFoundError,
)
from core.voice.models import STTRequest, TTSRequest, WhisperResult
from core.voice.pipeline import (
    SpokenTurn,
    TranscriptTurn,
    VoicePipeline,
    pipeline_from_mapping,
)
from core.voice.tts_runner import TTSRunner
from core.voice.whisper_runner import WhisperRunner

try:
    import fastapi  # noqa: F401
    from fastapi.testclient import TestClient

    from core.voice.api import create_app

    _FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    TestClient = None  # type: ignore[assignment]
    create_app = None  # type: ignore[assignment]
    _FASTAPI_AVAILABLE = False


# ----------------------------------------------------------------------
# Pipeline
# ----------------------------------------------------------------------


class _FakeWhisperRunner:
    def __init__(self, result: WhisperResult) -> None:
        self._result = result
        self.calls: list[dict[str, object]] = []
        self.whisper_binary = Path("/tmp/whisper-cli")
        self.model_path = Path("/tmp/ggml-base.bin")
        self.timeout = 1.0

    def transcribe(self, audio_path, *, language=None, translate_to_english=False):
        self.calls.append(
            {
                "audio_path": Path(audio_path),
                "language": language,
                "translate_to_english": translate_to_english,
            }
        )
        return self._result


class _FakeTTSRunner:
    def __init__(self) -> None:
        self.speak_calls: list[tuple[str, str, int]] = []
        self.save_calls: list[tuple[str, Path, str, int]] = []
        self.say_binary = "say"

    def speak(self, text, *, voice="es_Mexico", rate=200):
        self.speak_calls.append((text, voice, rate))

    def save_to_file(self, text, output_path, *, voice="es_Mexico", rate=200):
        self.save_calls.append((text, Path(output_path), voice, rate))
        return Path(output_path)


class TestPipeline(unittest.TestCase):
    def test_transcribe_file_delegates_and_records_stats(self) -> None:
        result = WhisperResult(
            text="hola",
            language="es",
            duration_seconds=1.0,
            segments=(),
            model_used="base",
            inference_seconds=0.1,
        )
        whisper = _FakeWhisperRunner(result)
        tts = _FakeTTSRunner()
        pipeline = VoicePipeline(whisper_runner=whisper, tts_runner=tts)  # type: ignore[arg-type]

        turn = pipeline.transcribe_file(Path("/tmp/audio.wav"), language="es")

        self.assertIsInstance(turn, TranscriptTurn)
        self.assertEqual(turn.result, result)
        self.assertEqual(turn.audio_path, Path("/tmp/audio.wav"))
        self.assertEqual(whisper.calls, [
            {
                "audio_path": Path("/tmp/audio.wav"),
                "language": "es",
                "translate_to_english": False,
            }
        ])
        self.assertEqual(pipeline.stats.stt_runs, 1)
        self.assertEqual(pipeline.stats.last_language, "es")

    def test_transcribe_request(self) -> None:
        result = WhisperResult(
            text="hi", language="en", duration_seconds=0.0,
        )
        whisper = _FakeWhisperRunner(result)
        tts = _FakeTTSRunner()
        pipeline = VoicePipeline(whisper_runner=whisper, tts_runner=tts)  # type: ignore[arg-type]
        pipeline.transcribe_request(
            STTRequest(audio_path=Path("/tmp/a.wav"), language="en")
        )
        self.assertEqual(whisper.calls[0]["language"], "en")

    def test_speak_records_tts_runs(self) -> None:
        tts = _FakeTTSRunner()
        pipeline = VoicePipeline(whisper_runner=_FakeWhisperRunner(  # type: ignore[arg-type]
            WhisperResult(text="x", language="en", duration_seconds=0.0)
        ), tts_runner=tts)  # type: ignore[arg-type]
        pipeline.speak("hola", voice="es_MX", rate=180)
        self.assertEqual(tts.speak_calls, [("hola", "es_MX", 180)])
        self.assertEqual(pipeline.stats.tts_runs, 1)

    def test_render_to_file(self) -> None:
        tts = _FakeTTSRunner()
        pipeline = VoicePipeline(
            whisper_runner=_FakeWhisperRunner(  # type: ignore[arg-type]
                WhisperResult(text="x", language="en", duration_seconds=0.0)
            ),
            tts_runner=tts,  # type: ignore[arg-type]
        )
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "out.aiff"
            turn = pipeline.render_to_file("hola", target, voice="es_MX", rate=180)
        self.assertIsInstance(turn, SpokenTurn)
        self.assertEqual(turn.text, "hola")
        self.assertEqual(turn.voice, "es_MX")
        self.assertEqual(tts.save_calls[0][:2], ("hola", target))

    def test_round_trip_uses_temp_dir(self) -> None:
        tts = _FakeTTSRunner()
        pipeline = VoicePipeline(
            whisper_runner=_FakeWhisperRunner(  # type: ignore[arg-type]
                WhisperResult(text="x", language="en", duration_seconds=0.0)
            ),
            tts_runner=tts,  # type: ignore[arg-type]
        )
        with mock.patch.object(Path, "with_suffix", wraps=Path("x").with_suffix):
            turn = pipeline.round_trip("hola")
        self.assertTrue(turn.audio_path.name.endswith(".aiff"))

    def test_describe_includes_recorder_and_player_flags(self) -> None:
        tts = _FakeTTSRunner()
        whisper = _FakeWhisperRunner(
            WhisperResult(text="x", language="en", duration_seconds=0.0)
        )
        pipeline = VoicePipeline(
            whisper_runner=whisper,  # type: ignore[arg-type]
            tts_runner=tts,  # type: ignore[arg-type]
            recorder=AudioRecorder(),  # type: ignore[arg-type]
            player=AudioPlayer(),  # type: ignore[arg-type]
        )
        description = pipeline.describe()
        self.assertTrue(description["recorder_available"])
        self.assertTrue(description["player_available"])
        self.assertIn("stats", description)


class TestPipelineFromMapping(unittest.TestCase):
    def test_both_requests(self) -> None:
        stt, tts = pipeline_from_mapping(
            {
                "stt": {"audio_path": "/tmp/x.wav", "language": "es"},
                "tts": {"text": "hi", "voice": "es_MX", "rate": 180},
            }
        )
        self.assertIsInstance(stt, STTRequest)
        self.assertIsInstance(tts, TTSRequest)
        self.assertEqual(stt.language, "es")
        self.assertEqual(tts.voice, "es_MX")
        self.assertEqual(tts.rate, 180)

    def test_missing_blocks_become_none(self) -> None:
        stt, tts = pipeline_from_mapping({})
        self.assertIsNone(stt)
        self.assertIsNone(tts)


# ----------------------------------------------------------------------
# FastAPI surface (only when fastapi is installed)
# ----------------------------------------------------------------------


@unittest.skipUnless(_FASTAPI_AVAILABLE, "fastapi is not installed")
class TestVoiceAPI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.upload_dir = Path(self._tmp.name)

        # Inject mock whisper/tts runners into a real VoicePipeline.
        self.whisper_mock = mock.Mock(spec=WhisperRunner)
        self.whisper_mock.whisper_binary = Path("/tmp/whisper-cli")
        self.whisper_mock.model_path = Path("/tmp/ggml-base.bin")
        self.whisper_mock.transcribe = mock.Mock(
            return_value=WhisperResult(
                text="hola",
                language="es",
                duration_seconds=1.2,
                segments=({"start": 0.0, "end": 1.0, "text": "hola"},),
                model_used="base",
                inference_seconds=0.4,
            )
        )

        # The real TTSRunner with a fake subprocess.
        self.tts_runner = TTSRunner(
            say_binary="say",
            runner=lambda *a, **kw: mock.Mock(
                returncode=0, stdout="", stderr=""
            )(  # placeholder; overridden just below
                *a, **kw
            ),
        )
        # Replace runner with a mock that always succeeds and writes a
        # dummy file so the post-check passes.
        runner = mock.Mock(side_effect=self._fake_tts_runner)
        self.tts_runner._runner = runner  # type: ignore[attr-defined]

        self.pipeline = VoicePipeline(
            whisper_runner=self.whisper_mock,  # type: ignore[arg-type]
            tts_runner=self.tts_runner,
        )
        self.app = create_app(
            pipeline=self.pipeline,
            upload_dir=self.upload_dir,
        )
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _fake_tts_runner(self, argv, **kwargs):
        # ``say -o path text`` – create the path so save_to_file accepts it.
        if "-o" in argv:
            idx = argv.index("-o")
            target = Path(argv[idx + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"FAKEAUDIO")
        return mock.Mock(returncode=0, stdout="", stderr="")

    def test_get_voices(self) -> None:
        with mock.patch("core.voice.api.list_voices_impl") as mock_lv:
            from core.voice.models import VoiceInfo
            mock_lv.return_value = [
                VoiceInfo(name="Monica", language="es", sample_text="x", locale="es_ES")
            ]
            response = self.client.get("/api/voice/voices")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["voices"][0]["name"], "Monica")

    def test_get_voices_propagates_tts_error(self) -> None:
        with mock.patch(
            "core.voice.api.list_voices_impl",
            side_effect=TTSInvocationError("missing"),
        ):
            response = self.client.get("/api/voice/voices")
        self.assertEqual(response.status_code, 503)

    def test_tts_endpoint_returns_audio_path(self) -> None:
        response = self.client.post(
            "/api/voice/tts",
            json={"text": "hola", "voice": "es_MX", "rate": 180},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["audio_path"].endswith(".aiff"))
        self.assertEqual(body["voice"], "es_MX")
        self.assertEqual(body["rate"], 180)
        self.assertTrue(Path(body["audio_path"]).exists())

    def test_tts_invalid_payload(self) -> None:
        response = self.client.post("/api/voice/tts", json={"text": ""})
        self.assertEqual(response.status_code, 422)

    def test_speak_endpoint(self) -> None:
        response = self.client.post(
            "/api/voice/tts/speak",
            json={"text": "hola", "voice": "es_MX", "rate": 180},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_stt_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"RIFF")
            with audio.open("rb") as f:
                response = self.client.post(
                    "/api/voice/stt",
                    files={"file": ("clip.wav", f, "audio/wav")},
                    data={"language": "es"},
                )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["text"], "hola")
        self.assertEqual(body["language"], "es")
        self.assertEqual(body["model_used"], "base")
        self.whisper_mock.transcribe.assert_called_once()

    def test_stt_propagates_missing_binary(self) -> None:
        self.whisper_mock.transcribe.side_effect = WhisperBinaryNotFoundError(
            "install brew"
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"RIFF")
            with audio.open("rb") as f:
                response = self.client.post(
                    "/api/voice/stt",
                    files={"file": ("clip.wav", f, "audio/wav")},
                )
        self.assertEqual(response.status_code, 503)

    def test_stt_propagates_missing_model(self) -> None:
        self.whisper_mock.transcribe.side_effect = WhisperModelNotFoundError(
            "no model"
        )
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"RIFF")
            with audio.open("rb") as f:
                response = self.client.post(
                    "/api/voice/stt",
                    files={"file": ("clip.wav", f, "audio/wav")},
                )
        self.assertEqual(response.status_code, 503)

    def test_status(self) -> None:
        response = self.client.get("/api/voice/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertIn("binary_available", body)


if __name__ == "__main__":
    unittest.main()
