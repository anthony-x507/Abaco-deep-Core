"""Wrapper around the macOS ``say`` command (text-to-speech).

The :class:`TTSRunner` exposes three operations:

* :meth:`TTSRunner.speak` – speak ``text`` through the default audio
  device (blocks until ``say`` exits).
* :meth:`TTSRunner.save_to_file` – render ``text`` to an ``.aiff`` on
  disk.  ``say -o`` accepts a path *without* an extension and appends
  ``.aiff`` automatically; the wrapper makes that explicit by switching
  to ``--file-format=AIFF`` so the output filename is always honoured.
* :meth:`TTSRunner.list_voices` – see :func:`core.voice.voices.list_voices`.

On non-macOS hosts ``say`` is not present and the runner raises
:class:`TTSInvocationError` with a clear message.  Tests inject a fake
``say`` script via the ``say_binary`` argument.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

from core.voice.errors import TTSInvocationError, TTSSaveError
from core.voice.models import TTSRequest, VoiceInfo
from core.voice.voices import list_voices as _list_voices


class TTSRunner:
    """Speak text using the macOS ``say`` command.

    Args:
        say_binary: Override for the ``say`` executable path.  Tests use
            this to point at a stub script that records its argv
            instead of speaking.
        timeout: Per-invocation wall-clock timeout in seconds.
    """

    def __init__(
        self,
        say_binary: str | None = None,
        *,
        timeout: float = 60.0,
        runner=subprocess.run,
    ) -> None:
        self.say_binary = say_binary or "say"
        self.timeout = float(timeout)
        self._runner = runner

    # ------------------------------------------------------------------
    # Subprocess plumbing
    # ------------------------------------------------------------------

    def _run(self, argv: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        try:
            completed = self._runner(
                list(argv),
                check=False,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError as exc:
            raise TTSInvocationError(
                f"`say` not found (looked for {self.say_binary!r}); macOS is required for TTS"
            ) from exc
        except OSError as exc:
            raise TTSInvocationError(f"failed to invoke `say`: {exc}") from exc

        if check and completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            raise TTSInvocationError(
                f"`say` exited with code {completed.returncode}: "
                f"{stderr or stdout or '<no output>'}"
            )
        return completed

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def speak(
        self,
        text: str,
        *,
        voice: str = "es_Mexico",
        rate: int = 200,
    ) -> None:
        """Speak ``text`` through the default audio output.

        Blocks until ``say`` exits.  A failure raises
        :class:`TTSInvocationError`.
        """

        if not text:
            # ``say`` with empty input fails with code 71 on macOS.
            # We treat empty input as a no-op instead so callers can
            # defensively call ``speak`` on ``""``.
            return

        argv = [self.say_binary, "-v", voice, "-r", str(int(rate)), text]
        self._run(argv)

    def save_to_file(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str = "es_Mexico",
        rate: int = 200,
    ) -> Path:
        """Render ``text`` to ``output_path`` and return the resolved path.

        ``say -o`` writes an AIFF file using the path *plus* the format
        suffix determined by ``--file-format``.  The wrapper appends
        ``.aiff`` if the caller omits an extension, mirroring the
        convention used elsewhere in the project.
        """

        if not text:
            raise TTSSaveError("cannot synthesise empty text to file")

        out = Path(output_path)
        if out.suffix == "":
            out = out.with_suffix(".aiff")
        out.parent.mkdir(parents=True, exist_ok=True)

        # ``--file-format=AIFF`` makes ``say`` honour the exact path we
        # passed and avoids race conditions when output_path already
        # exists with a different extension.
        argv = [
            self.say_binary,
            "-v",
            voice,
            "-r",
            str(int(rate)),
            "--file-format=AIFF",
            "-o",
            str(out),
            text,
        ]
        self._run(argv)
        if not out.exists():
            raise TTSSaveError(f"`say -o` did not produce {out!s}")
        return out

    def list_voices(self) -> list[VoiceInfo]:
        """Return every :class:`VoiceInfo` reported by ``say -v ?``.

        Thin wrapper around :func:`core.voice.voices.list_voices` so
        callers do not have to import two modules.
        """

        return _list_voices(say_binary=self.say_binary)

    # Convenience: accept an object instead of an argv-style call.
    def speak_request(self, request: TTSRequest) -> None:
        """Speak a :class:`TTSRequest`."""

        self.speak(request.text, voice=request.voice, rate=request.rate)

    def save_request(
        self,
        request: TTSRequest,
        output_path: Path,
    ) -> Path:
        """Render a :class:`TTSRequest` to ``output_path``."""

        return self.save_to_file(
            request.text,
            output_path,
            voice=request.voice,
            rate=request.rate,
        )


def tts_request_from_mapping(payload: Mapping[str, Any]) -> TTSRequest:
    """Build a :class:`TTSRequest` from an HTTP-friendly mapping."""

    text = str(payload.get("text", "") or "")
    voice = str(payload.get("voice", "es_Mexico") or "es_Mexico")
    rate = int(payload.get("rate", 200) or 200)
    return TTSRequest(text=text, voice=voice, rate=rate)


def voices_to_json(voices: Sequence[VoiceInfo]) -> str:
    """Dump :class:`VoiceInfo` objects as JSON for the HTTP layer."""

    return json.dumps([v.as_dict() for v in voices], ensure_ascii=False)


__all__ = [
    "TTSRunner",
    "tts_request_from_mapping",
    "voices_to_json",
]
