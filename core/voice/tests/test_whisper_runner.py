"""Tests for :mod:`core.voice.whisper_runner`."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from core.voice.errors import (
    AudioInputError,
    WhisperBinaryNotFoundError,
    WhisperInvocationError,
    WhisperModelNotFoundError,
)
from core.voice.whisper_runner import WhisperRunner, _parse_whisper_payload


def _completed(*, stdout: str = "{}", stderr: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=["whisper-cli"],
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


def _build_payload() -> dict:
    return {
        "text": "Hola, mundo.",
        "language": "es",
        "duration": 3.5,
        "segments": [
            {"start": 0.0, "end": 1.5, "text": " Hola,"},
            {"start": 1.5, "end": 3.5, "text": " mundo."},
        ],
    }


class TestWhisperRunnerValidation(unittest.TestCase):
    def test_raises_when_binary_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            runner = WhisperRunner(
                whisper_binary=Path("/nope/whisper-cli"),
                model_path=model,
                runner=mock.Mock(),
            )
            with self.assertRaises(WhisperBinaryNotFoundError) as ctx:
                runner.transcribe(model)
        self.assertIn("whisper-cli", str(ctx.exception))
        self.assertIn("brew", str(ctx.exception))

    def test_raises_when_model_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=Path(tmp) / "missing.bin",
                runner=mock.Mock(),
            )
            with self.assertRaises(WhisperModelNotFoundError) as ctx:
                runner.transcribe(Path(tmp) / "audio.wav")
        self.assertIn("download", str(ctx.exception).lower())

    def test_raises_when_audio_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            runner = WhisperRunner(whisper_binary=binary, model_path=model, runner=mock.Mock())
            with self.assertRaises(AudioInputError):
                runner.transcribe(Path(tmp) / "absent.wav")


class TestWhisperRunnerHappyPath(unittest.TestCase):
    def test_parses_output_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"RIFF")

            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout=json.dumps(_build_payload()))),
            )

            result = runner.transcribe(audio, language="es")

        self.assertEqual(result.text, "Hola, mundo.")
        self.assertEqual(result.language, "es")
        self.assertEqual(result.duration_seconds, 3.5)
        self.assertEqual(len(result.segments), 2)
        self.assertEqual(result.model_used, "base")
        self.assertGreaterEqual(result.inference_seconds, 0.0)

    def test_handles_nested_result_payload(self) -> None:
        payload = {"result": _build_payload()}
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"")
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout=json.dumps(payload))),
            )
            result = runner.transcribe(audio)
        self.assertEqual(result.text, "Hola, mundo.")

    def test_adds_translate_flag_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"")

            fake_runner = mock.Mock(
                return_value=_completed(stdout=json.dumps(_build_payload()))
            )
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=fake_runner,
            )
            runner.transcribe(audio, translate_to_english=True)
            argv = fake_runner.call_args[0][0]
            self.assertIn("--translate", argv)

    def test_uses_sidecar_when_stdout_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "whisper-cli"
            binary.write_bytes(b"")
            model = Path(tmp) / "ggml-base.bin"
            model.write_bytes(b"")
            audio = Path(tmp) / "clip.wav"
            audio.write_bytes(b"")
            sidecar = audio.with_suffix(".json")
            sidecar.write_text(json.dumps(_build_payload()), encoding="utf-8")

            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout="")),
            )
            result = runner.transcribe(audio)
        self.assertEqual(result.text, "Hola, mundo.")


class TestWhisperRunnerFailures(unittest.TestCase):
    def _setup(self):
        tmp = tempfile.TemporaryDirectory()
        binary = Path(tmp.name) / "whisper-cli"
        binary.write_bytes(b"")
        model = Path(tmp.name) / "ggml-base.bin"
        model.write_bytes(b"")
        audio = Path(tmp.name) / "clip.wav"
        audio.write_bytes(b"")
        return tmp, binary, model, audio

    def test_non_zero_exit_code_raises(self) -> None:
        tmp, binary, model, audio = self._setup()
        try:
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(returncode=1, stderr="decode error")),
            )
            with self.assertRaises(WhisperInvocationError) as ctx:
                runner.transcribe(audio)
            self.assertIn("decode error", str(ctx.exception))
        finally:
            tmp.cleanup()

    def test_invalid_json_raises(self) -> None:
        tmp, binary, model, audio = self._setup()
        try:
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout="not-json {")),
            )
            with self.assertRaises(WhisperInvocationError):
                runner.transcribe(audio)
        finally:
            tmp.cleanup()

    def test_non_object_root_raises(self) -> None:
        tmp, binary, model, audio = self._setup()
        try:
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout="[1,2,3]")),
            )
            with self.assertRaises(WhisperInvocationError) as ctx:
                runner.transcribe(audio)
            self.assertIn("JSON", str(ctx.exception))
        finally:
            tmp.cleanup()

    def test_unparseable_output_with_no_sidecar_raises(self) -> None:
        tmp, binary, model, audio = self._setup()
        try:
            runner = WhisperRunner(
                whisper_binary=binary,
                model_path=model,
                runner=mock.Mock(return_value=_completed(stdout="")),
            )
            # No sidecar file exists here.
            with self.assertRaises(WhisperInvocationError):
                runner.transcribe(audio)
        finally:
            tmp.cleanup()


class TestWhisperParser(unittest.TestCase):
    def test_defaults_when_payload_missing(self) -> None:
        result = _parse_whisper_payload({}, model_used="base", inference_seconds=0.0)
        self.assertEqual(result.text, "")
        self.assertEqual(result.language, "")
        self.assertEqual(result.segments, ())
        self.assertEqual(result.duration_seconds, 0.0)

    def test_handles_non_list_segments(self) -> None:
        payload = {"text": "hi", "language": "en", "segments": "not-a-list"}
        result = _parse_whisper_payload(payload, model_used="base", inference_seconds=0.0)
        self.assertEqual(result.segments, ())

    def test_handles_non_dict_segments(self) -> None:
        payload = {"text": "hi", "language": "en", "segments": [None, "x", 7]}
        result = _parse_whisper_payload(payload, model_used="base", inference_seconds=0.0)
        self.assertEqual(result.segments, ())


if __name__ == "__main__":
    unittest.main()
