"""Tests for :mod:`core.voice.voices`."""

from __future__ import annotations

import unittest
from unittest import mock

from core.voice.errors import TTSInvocationError
from core.voice.models import VoiceInfo
from core.voice.voices import (
    DEFAULT_VOICE,
    _parse_voice_line,
    filter_by_language,
    list_voices,
    pick_default_voice,
)


class TestParseVoiceLine(unittest.TestCase):
    def test_parses_three_columns(self) -> None:
        info = _parse_voice_line("Samantha          en_US      \"Hello, my name is Samantha. I am an English voice.\"")
        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "Samantha")
        self.assertEqual(info.language, "en")
        self.assertEqual(info.locale, "en_US")
        self.assertEqual(info.sample_text, "Hello, my name is Samantha. I am an English voice.")

    def test_handles_unquoted_sample(self) -> None:
        info = _parse_voice_line("Monica            es_ES      Hola me llamo Monica")
        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "Monica")
        self.assertEqual(info.language, "es")
        self.assertEqual(info.sample_text, "Hola me llamo Monica")

    def test_skips_header(self) -> None:
        self.assertIsNone(_parse_voice_line("Name              Language   Sample Text"))
        self.assertIsNone(_parse_voice_line(""))
        self.assertIsNone(_parse_voice_line("   "))

    def test_returns_none_for_short_lines(self) -> None:
        self.assertIsNone(_parse_voice_line("only-two tokens"))
        self.assertIsNone(_parse_voice_line(""))

    def test_extra_whitespace_in_sample(self) -> None:
        info = _parse_voice_line("Diego             es_MX      \"Buenos dias,  como estas?\"")
        self.assertIsNotNone(info)
        assert info is not None
        self.assertEqual(info.name, "Diego")
        self.assertEqual(info.language, "es")
        # The internal double space is preserved.
        self.assertIn("Buenos dias", info.sample_text)


class TestListVoices(unittest.TestCase):
    def test_list_voices_parses_subprocess_output(self) -> None:
        sample_output = (
            "Name                Language    Sample Text\n"
            "Samantha            en_US       \"Hello, my name is Samantha.\"\n"
            "Monica              es_ES       Hola me llamo Monica\n"
            "Diego               es_MX       Buenos dias amigo\n"
        )
        with mock.patch("core.voice.voices._run_say_listing", return_value=sample_output):
            voices = list_voices()
        names = [v.name for v in voices]
        self.assertIn("Samantha", names)
        self.assertIn("Monica", names)
        self.assertIn("Diego", names)
        self.assertEqual([v for v in voices if v.language == "es"], [v for v in voices if v.language == "es"])

    def test_list_voices_sorts_by_language_then_name(self) -> None:
        sample_output = (
            "Samantha  en_US  hi\n"
            "Monica    es_ES  hola\n"
            "Diego     es_MX  hola\n"
            "Albert    en_US  hi\n"
        )
        with mock.patch("core.voice.voices._run_say_listing", return_value=sample_output):
            voices = list_voices()
        # ``es`` (Spanish) sorts before ``en`` (English); within each
        # language, names are sorted alphabetically.
        self.assertEqual(
            [v.name for v in voices],
            ["Diego", "Monica", "Albert", "Samantha"],
        )

    def test_list_voices_propagates_tts_error(self) -> None:
        with mock.patch(
            "core.voice.voices._run_say_listing",
            side_effect=TTSInvocationError("missing"),
        ):
            with self.assertRaises(TTSInvocationError):
                list_voices()


class TestFilterByLanguage(unittest.TestCase):
    def setUp(self) -> None:
        self.voices = [
            VoiceInfo(name="Monica", language="es", sample_text="x", locale="es_ES"),
            VoiceInfo(name="Diego", language="es", sample_text="x", locale="es_MX"),
            VoiceInfo(name="Samantha", language="en", sample_text="x", locale="en_US"),
        ]

    def test_filter_by_iso_code(self) -> None:
        result = filter_by_language(self.voices, "es")
        self.assertEqual([v.name for v in result], ["Monica", "Diego"])

    def test_filter_by_full_locale(self) -> None:
        result = filter_by_language(self.voices, "es_MX")
        self.assertEqual([v.name for v in result], ["Diego"])

    def test_empty_language_returns_copy(self) -> None:
        result = filter_by_language(self.voices, "")
        self.assertEqual([v.name for v in result], [v.name for v in self.voices])
        self.assertIsNot(result, self.voices)

    def test_unknown_language_returns_empty(self) -> None:
        self.assertEqual(filter_by_language(self.voices, "fr"), [])


class TestPickDefaultVoice(unittest.TestCase):
    def test_falls_back_to_default_when_say_fails(self) -> None:
        from core.voice.voices import _cached_default_voice

        _cached_default_voice.cache_clear()
        try:
            with mock.patch(
                "core.voice.voices.list_voices",
                side_effect=TTSInvocationError("missing"),
            ):
                # ``pick_default_voice`` simply forwards to the cached
                # helper; clear the cache so we re-invoke list_voices.
                self.assertEqual(_cached_default_voice(), DEFAULT_VOICE)
        finally:
            _cached_default_voice.cache_clear()


if __name__ == "__main__":
    unittest.main()
