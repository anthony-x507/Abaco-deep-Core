"""Optional backend audio recorder.

The frontend *usually* uses the MediaRecorder API directly in the
browser shell, so this module is only invoked when the user records
audio from a CLI / agent flow (e.g. an automated test agent).  The
recorder shells out to either ``sox`` or ``ffmpeg``; whichever is
present wins.  Both tools produce a WAV file the
:class:`~core.voice.whisper_runner.WhisperRunner` can consume.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Sequence

from core.voice.errors import RecorderError
from core.voice.models import AudioClip


def _find_recorder() -> tuple[str, Sequence[str]] | None:
    """Return ``(executable, base_argv)`` for the first available recorder.

    ``sox`` is preferred because the arguments are simpler.  Falls back
    to ``ffmpeg`` (which is always present on macOS via Homebrew
    ``ffmpeg`` or the in-tree build).  Returns ``None`` if neither
    binary is on disk.
    """

    sox = shutil.which("sox")
    if sox:
        return sox, ()
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        # ``-f avfoundation`` is the macOS audio capture backend in
        # ffmpeg; ``-i :0`` selects the default microphone.  Other
        # platforms need different ``-f`` values.
        return ffmpeg, ("-y", "-f", "avfoundation", "-i", ":0")
    return None


class AudioRecorder:
    """Record audio from the default microphone to a WAV file.

    Example::

        recorder = AudioRecorder()
        recorder.start()
        time.sleep(3)
        clip = recorder.stop()
        print(clip.path)

    The class is intentionally tiny: it manages a single subprocess at
    a time and exposes a thread-safe :meth:`stop`.
    """

    def __init__(
        self,
        output_path: Path | None = None,
        *,
        sample_rate: int = 16_000,
        channels: int = 1,
        recorder: str | None = None,
        runner=subprocess.Popen,
    ) -> None:
        self.sample_rate = int(sample_rate)
        self.channels = int(channels)
        self._process: subprocess.Popen[bytes] | None = None
        self._started_at: float | None = None
        self._output_path: Path | None = Path(output_path) if output_path else None
        self._explicit_recorder = recorder
        self._runner = runner
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def is_recording(self) -> bool:
        """Return ``True`` if a recording is in progress."""

        return self._process is not None and self._process.poll() is None

    def start(self, output_path: Path | None = None) -> Path:
        """Start recording and return the destination path.

        Raises :class:`RecorderError` if a recording is already running
        or no recorder is installed.
        """

        with self._lock:
            if self.is_recording:
                raise RecorderError("a recording is already in progress")
            target = Path(output_path) if output_path else self._output_path
            if target is None:
                raise RecorderError("output_path is required when starting a new recording")
            target.parent.mkdir(parents=True, exist_ok=True)
            command = self._build_argv(target)
            if command is None:
                raise RecorderError(
                    "neither `sox` nor `ffmpeg` is installed; "
                    "install one with `brew install sox` to record audio"
                )

            env = os.environ.copy()
            try:
                process = self._runner(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    env=env,
                    preexec_fn=os.setsid if hasattr(os, "setsid") else None,
                )
            except FileNotFoundError as exc:
                raise RecorderError(f"recorder executable not found: {exc}") from exc
            except OSError as exc:
                raise RecorderError(f"failed to start recorder: {exc}") from exc

            self._process = process
            self._output_path = target
            self._started_at = time.monotonic()
            return target

    def stop(self, *, on_complete: Callable[[AudioClip], None] | None = None) -> AudioClip:
        """Stop the current recording and return an :class:`AudioClip`.

        Sends ``SIGINT`` to ``sox``/``ffmpeg`` so they flush their
        WAV header cleanly.  ``on_complete`` is invoked with the clip
        just before this method returns – useful for streaming
        integrations.
        """

        with self._lock:
            process = self._process
            target = self._output_path
            started_at = self._started_at
            if process is None or target is None or started_at is None:
                raise RecorderError("no recording in progress")

            try:
                process.send_signal(signal.SIGINT)
                try:
                    stderr = process.communicate(timeout=5)[1] or b""
                except subprocess.TimeoutExpired:  # pragma: no cover
                    process.kill()
                    stderr = process.communicate(timeout=5)[1] or b""
            finally:
                self._process = None
                self._started_at = None

        duration = max(0.0, time.monotonic() - started_at)
        if process.returncode not in (0, None) and not target.exists():
            raise RecorderError(
                f"recorder exited with code {process.returncode}: {stderr.decode(errors='replace').strip()}"
            )
        clip = AudioClip(
            path=target,
            sample_rate=self.sample_rate,
            channels=self.channels,
            duration_seconds=duration,
        )
        if on_complete is not None:
            on_complete(clip)
        return clip

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_argv(self, output_path: Path) -> list[str] | None:
        """Return the recorder command line for ``output_path``."""

        if self._explicit_recorder == "sox":
            return [
                "sox",
                "-d",
                "-r",
                str(self.sample_rate),
                "-c",
                str(self.channels),
                str(output_path),
            ]
        if self._explicit_recorder == "ffmpeg":
            return [
                "ffmpeg",
                "-y",
                "-f",
                "avfoundation",
                "-i",
                ":0",
                "-ar",
                str(self.sample_rate),
                "-ac",
                str(self.channels),
                str(output_path),
            ]

        resolved = _find_recorder()
        if resolved is None:
            return None
        binary, prefix = resolved
        argv = list(prefix)
        if binary.endswith("sox"):
            argv.extend(
                [
                    binary,
                    "-d",
                    "-r",
                    str(self.sample_rate),
                    "-c",
                    str(self.channels),
                    str(output_path),
                ]
            )
        else:
            argv.extend(
                [
                    binary,
                    "-ar",
                    str(self.sample_rate),
                    "-ac",
                    str(self.channels),
                    str(output_path),
                ]
            )
        return argv


__all__ = ["AudioRecorder"]
