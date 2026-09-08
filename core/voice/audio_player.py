"""Backend audio player.

The frontend usually plays audio with the HTML ``<audio>`` element via
the ``recording URL`` returned by the API.  This module offers a
backend counterpart that uses ``afplay`` (macOS) or ``ffplay`` (any
platform) to play a file.

The player is intentionally synchronous – :meth:`play` blocks until
playback ends or :meth:`stop` is invoked from another thread.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path

from core.voice.errors import AudioInputError, PlayerError


def _find_player() -> str | None:
    """Return the first available audio player binary.

    ``afplay`` ships with macOS, ``ffplay`` ships with ffmpeg.
    """

    afplay = shutil.which("afplay")
    if afplay:
        return afplay
    return shutil.which("ffplay")


class AudioPlayer:
    """Play a WAV/AIFF/MP3 file using a system binary.

    Args:
        player_binary: Override for the player executable.  Defaults to
            ``afplay`` when present, otherwise ``ffplay``.
        runner: Callable used to invoke the subprocess.  Override in
            tests with a recording stub.
    """

    def __init__(
        self,
        player_binary: str | None = None,
        *,
        runner=subprocess.Popen,
    ) -> None:
        binary = player_binary or _find_player()
        self.player_binary = binary or "afplay"
        self._runner = runner
        self._process: subprocess.Popen[bytes] | None = None
        self._lock = threading.Lock()

    @property
    def is_playing(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def play(self, audio_path: Path) -> None:
        """Play ``audio_path`` and block until it finishes.

        Non-blocking callers can spawn a thread around this method or
        use :meth:`play_async` instead.
        """

        path = Path(audio_path)
        if not path.exists():
            raise AudioInputError(f"audio file does not exist: {path!s}")
        if not path.is_file():
            raise AudioInputError(f"audio path is not a file: {path!s}")

        argv = [self.player_binary, str(path)]
        if self.player_binary.endswith("ffplay"):
            argv[1:1] = ["-autoexit", "-nodisp", "-loglevel", "error"]

        with self._lock:
            if self.is_playing:
                raise PlayerError("another playback is already in progress")
            try:
                process = self._runner(
                    argv,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
            except FileNotFoundError as exc:
                raise PlayerError(
                    f"audio player not found ({self.player_binary!r}); "
                    "install macOS `afplay` or `ffmpeg`/`ffplay`"
                ) from exc
            except OSError as exc:
                raise PlayerError(f"failed to start audio player: {exc}") from exc

            self._process = process
        try:
            rc = process.wait()
        finally:
            with self._lock:
                self._process = None
        if rc != 0:
            raise PlayerError(f"audio player exited with code {rc}")

    def play_async(self, audio_path: Path) -> subprocess.Popen[bytes]:
        """Start playback in the background and return the Popen handle."""

        path = Path(audio_path)
        if not path.exists():
            raise AudioInputError(f"audio file does not exist: {path!s}")

        argv = [self.player_binary, str(path)]
        if self.player_binary.endswith("ffplay"):
            argv[1:1] = ["-autoexit", "-nodisp", "-loglevel", "error"]
        try:
            process = self._runner(
                argv,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise PlayerError(
                f"audio player not found ({self.player_binary!r})"
            ) from exc
        except OSError as exc:
            raise PlayerError(f"failed to start audio player: {exc}") from exc
        self._process = process
        return process

    def stop(self) -> None:
        """Stop the current playback (if any)."""

        with self._lock:
            process = self._process
            if process is None:
                return
            try:
                process.terminate()
            except OSError:  # pragma: no cover - already gone
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:  # pragma: no cover
                process.kill()
            self._process = None


__all__ = ["AudioPlayer"]
