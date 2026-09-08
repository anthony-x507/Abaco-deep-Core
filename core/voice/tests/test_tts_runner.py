"""Tests for :mod:`core.voice.tts_runner`."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from core.voice.errors import TTSInvocationError, TTSSaveError
from core.voice.models import TTSRequest
from core.voice.tts_runner import TTSRunner, voices_to_json


def _completed(*, returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        args=["say"],
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


class TestSpeak(unittest.TestCase):
    def test_speak_invokes_say_with_voice_and_rate(self) -> None:
        runner = mock.Mock(return_value=_completed())
        tts = TTSRunner(say_binary="say", runner=runner)
        tts.speak("hola", voice="es_MX", rate=180)
        runner.assert_called_once()
        argv = runner.call_args[0][0]
        self.assertEqual(argv[:5], ["say", "-v", "es_MX", "-r", "180"])
        self.assertEqual(argv[-1], "hola")

    def test_speak_is_noop_for_empty_text(self) -> None:
        runner = mock.Mock()
        tts = TTSRunner(runner=runner)
        tts.speak("")
        runner.assert_not_called()

    def test_speak_raises_on_failure(self) -> None:
        runner = mock.Mock(return_value=_completed(returncode=71, stderr="boom"))
        tts = TTSRunner(runner=runner)
        with self.assertRaises(TTSInvocationError) as ctx:
            tts.speak("hola")
        self.assertIn("boom", str(ctx.exception))

    def test_speak_missing_binary(self) -> None:
        def fail(argv, **_kwargs):
            # Mimic ``subprocess.run``'s signature: argv is the first
            # positional arg, plus various keyword args we ignore.
            raise FileNotFoundError(2, "No such file")

        tts = TTSRunner(say_binary="say", runner=fail)
        with self.assertRaises(TTSInvocationError) as ctx:
            tts.speak("hola")
        self.assertIn("not found", str(ctx.exception).lower())


class TestSaveToFile(unittest.TestCase):
    def test_save_to_file_uses_output_path_with_aiff_extension(self) -> None:
        runner = mock.Mock(return_value=_completed())
        # The runner writes no actual file, but we need the binary to
        # see a file on disk for the post-check.  We mock that part too.
        with tempfile.TemporaryDirectory() as tmp:
            target_dir = Path(tmp)
            target = target_dir / "reply"  # no suffix → .aiff added
            tts = TTSRunner(runner=runner)
            with mock.patch.object(Path, "exists", return_value=True):
                resolved = tts.save_to_file("hola", target)
        self.assertEqual(resolved, target.with_suffix(".aiff"))
        argv = runner.call_args[0][0]
        self.assertIn("--file-format=AIFF", argv)
        self.assertIn("-o", argv)
        self.assertIn(str(resolved), argv)

    def test_save_to_file_propagates_say_failure(self) -> None:
        runner = mock.Mock(return_value=_completed(returncode=1, stderr="nope"))
        tts = TTSRunner(runner=runner)
        with self.assertRaises(TTSInvocationError):
            tts.save_to_file("hola", Path("/tmp/whatever.aiff"))

    def test_save_rejects_empty_text(self) -> None:
        tts = TTSRunner(runner=mock.Mock())
        with self.assertRaises(TTSSaveError):
            tts.save_to_file("", Path("/tmp/whatever.aiff"))

    def test_save_raises_when_file_not_produced(self) -> None:
        runner = mock.Mock(return_value=_completed())
        tts = TTSRunner(runner=runner)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "absent.aiff"
            with self.assertRaises(TTSSaveError):
                tts.save_to_file("hola", target)


class TestListVoices(unittest.TestCase):
    def test_list_voices_delegates_to_voices_module(self) -> None:
        from core.voice.models import VoiceInfo

        fake = [VoiceInfo(name="Monica", language="es", sample_text="x", locale="es_ES")]
        with mock.patch("core.voice.tts_runner._list_voices", return_value=fake) as lsv:
            tts = TTSRunner(say_binary="say")
            out = tts.list_voices()
        self.assertEqual(out, fake)
        lsv.assert_called_once_with(say_binary="say")


class TestRequestHelpers(unittest.TestCase):
    def test_speak_request(self) -> None:
        runner = mock.Mock(return_value=_completed())
        tts = TTSRunner(runner=runner)
        tts.speak_request(TTSRequest(text="hola", voice="es_MX", rate=180))
        argv = runner.call_args[0][0]
        self.assertEqual(argv[-1], "hola")
        self.assertIn("-v", argv)
        self.assertIn("es_MX", argv)

    def test_save_request(self) -> None:
        runner = mock.Mock(return_value=_completed())
        tts = TTSRunner(runner=runner)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "x.aiff"
            with mock.patch.object(Path, "exists", return_value=True):
                resolved = tts.save_request(
                    TTSRequest(text="hola", voice="es_MX", rate=180),
                    target,
                )
        self.assertEqual(resolved, target)


class TestVoicesToJson(unittest.TestCase):
    def test_voices_to_json(self) -> None:
        from core.voice.models import VoiceInfo

        voices = [VoiceInfo(name="Samantha", language="en", sample_text="x", locale="en_US")]
        raw = voices_to_json(voices)
        self.assertIn("Samantha", raw)
        self.assertIn("en_US", raw)


if __name__ == "__main__":
    unittest.main()
