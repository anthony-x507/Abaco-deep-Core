"""Thin wrapper around the ``whisper-cli`` binary shipped by whisper.cpp.

The wrapper is intentionally small: it shells out, parses the JSON
output and returns a :class:`~core.voice.models.WhisperResult`.  All
side-effects (binary detection, model file detection, timeouts) live
here so callers stay declarative.

Usage::

    runner = WhisperRunner()
    result = runner.transcribe(Path("clip.wav"), language="es")
    print(result.text)

The wrapper ships with sensible defaults for an Apple Silicon Mac:

* ``whisper_binary`` defaults to ``/opt/homebrew/bin/whisper-cli``.
* ``model_path`` defaults to ``~/.abaco-deep-core/models/ggml-base.bin``.

To install the model manually::

    mkdir -p ~/.abaco-deep-core/models
    cd ~/.abaco-deep-core/models
    curl -L -o ggml-base.bin \\
        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

Or simply run::

    whisper-cli -m ~/.abaco-deep-core/models/ggml-base.bin
``whisper-cli`` will download the model on first run when the file is
missing.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Mapping, Sequence

from core.voice.errors import (
    AudioInputError,
    WhisperBinaryNotFoundError,
    WhisperInvocationError,
    WhisperModelNotFoundError,
)
from core.voice.models import WhisperResult


# Default locations tuned for an Apple Silicon mac running Homebrew.
# Linux CI / Windows users can pass explicit paths.
_DEFAULT_BINARY = Path("/opt/homebrew/bin/whisper-cli")
_DEFAULT_INTEL_BINARY = Path("/usr/local/bin/whisper-cli")
_DEFAULT_MODEL_DIR = Path.home() / ".abaco-deep-core" / "models"
_DEFAULT_MODEL_NAME = "ggml-base.bin"


def _default_binary() -> Path:
    """Return the most likely location of ``whisper-cli``.

    Resolution order: ``PATH`` lookup, ``/opt/homebrew/bin``, ``/usr/local/bin``.
    Empty :class:`Path` if not found anywhere (the caller decides what
    to do).
    """

    found = shutil.which("whisper-cli")
    if found:
        return Path(found)
    if _DEFAULT_BINARY.exists():
        return _DEFAULT_BINARY
    if _DEFAULT_INTEL_BINARY.exists():
        return _DEFAULT_INTEL_BINARY
    return _DEFAULT_BINARY  # canonical path even if missing


def _default_model_path() -> Path:
    """Return ``~/.abaco-deep-core/models/ggml-base.bin``.

    The directory is *not* created here – :class:`WhisperRunner` only
    reads from it.  Missing files raise
    :class:`WhisperModelNotFoundError` at ``transcribe`` time.
    """

    return _DEFAULT_MODEL_DIR / _DEFAULT_MODEL_NAME


def _looks_like_whisper_json(text: str) -> bool:
    """Heuristic to detect the JSON output ``whisper-cli --output-json``."""

    stripped = text.lstrip()
    return stripped.startswith("{") and stripped.rstrip().endswith("}")


def _parse_whisper_payload(payload: Mapping[str, Any], *, model_used: str, inference_seconds: float) -> WhisperResult:
    """Turn the JSON payload returned by whisper-cli into a :class:`WhisperResult`.

    whisper.cpp uses two slightly different top-level shapes depending
    on the build:

    * Older builds: ``{"text": "...", "segments": [...], "language": "en"}``
    * Newer builds: same shape but may add ``"duration"``, ``"result": {...}``,
      or nest everything under ``"result"``.

    The wrapper normalises both: we look for ``"text"``/``"segments"``/``"language"``
    at the top level first, then fall back to the nested ``"result"``.
    """

    container = payload
    if "result" in payload and isinstance(payload["result"], Mapping):
        # New whisper-cli wraps everything in a ``result`` key.
        candidate = payload["result"]
        if isinstance(candidate, Mapping) and ("text" in candidate or "segments" in candidate):
            container = candidate

    raw_text = container.get("text", "") or ""
    language = (container.get("language") or "").strip()
    duration = float(container.get("duration") or 0.0)
    raw_segments = container.get("segments") or []
    if not isinstance(raw_segments, list):
        raw_segments = []

    segments: list[dict[str, Any]] = []
    for seg in raw_segments:
        if not isinstance(seg, Mapping):
            continue
        segments.append(
            {
                "start": float(seg.get("start", seg.get("t0", 0.0)) or 0.0),
                "end": float(seg.get("end", seg.get("t1", 0.0)) or 0.0),
                "text": str(seg.get("text", "")).strip(),
            }
        )

    return WhisperResult(
        text=str(raw_text).strip(),
        language=language,
        duration_seconds=duration,
        segments=tuple(segments),
        model_used=model_used,
        inference_seconds=inference_seconds,
    )


def _binary_invocations(runner: "WhisperRunner") -> Sequence[str]:
    """Return the argv that would be used to invoke whisper-cli.

    Exposed mainly so tests can introspect the command without running
    the subprocess.
    """

    return runner._build_argv(Path("/dev/null"), language=None, translate_to_english=False)


class WhisperRunner:
    """Run whisper.cpp over an audio file and return a :class:`WhisperResult`.

    Attributes:
        whisper_binary: Path to the ``whisper-cli`` executable.
        model_path: Path to the ``ggml-*.bin`` model file.
        timeout: Wall-clock timeout for a single transcription in seconds.
        extra_args: Optional list of arguments forwarded verbatim to
            ``whisper-cli`` (must follow whisper.cpp's CLI grammar).
    """

    def __init__(
        self,
        whisper_binary: Path | None = None,
        model_path: Path | None = None,
        *,
        timeout: float = 120.0,
        extra_args: Sequence[str] | None = None,
        env: Mapping[str, str] | None = None,
        runner=subprocess.run,
    ) -> None:
        resolved_binary = whisper_binary if whisper_binary is not None else _default_binary()
        resolved_model = model_path if model_path is not None else _default_model_path()
        self.whisper_binary = Path(resolved_binary)
        self.model_path = Path(resolved_model)
        self.timeout = float(timeout)
        self.extra_args: tuple[str, ...] = tuple(extra_args or ())
        self._env: dict[str, str] = dict(env) if env is not None else {
            **os.environ,
            # whisper-cli reads these to silence progress output we do
            # not want in tests: ``WHISPER_PRINT_PROGRESS=0`` and
            # ``WHISPER_SAMPLE_RATE`` is left to whisper to infer.
            "WHISPER_PRINT_PROGRESS": "0",
        }
        self._runner = runner

    # ------------------------------------------------------------------
    # Validation helpers
    # ------------------------------------------------------------------

    def _ensure_binary(self) -> None:
        """Raise :class:`WhisperBinaryNotFoundError` if whisper-cli is missing."""

        if not self.whisper_binary.exists():
            raise WhisperBinaryNotFoundError(
                f"whisper-cli not found at {self.whisper_binary!s}; "
                "install it with `brew install whisper-cpp` or set "
                "`whisper_binary` explicitly."
            )

    def _ensure_model(self) -> None:
        """Raise :class:`WhisperModelNotFoundError` if the model file is missing."""

        if not self.model_path.exists():
            raise WhisperModelNotFoundError(
                f"whisper model not found at {self.model_path!s}; "
                "download it with:\n"
                f"  mkdir -p {self.model_path.parent}\n"
                f"  curl -L -o {self.model_path} "
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"
                f"{self.model_path.name}\n"
                "Or simply run `whisper-cli -m <path>` once – whisper-cli "
                "downloads the model on first use."
            )

    # ------------------------------------------------------------------
    # Command construction
    # ------------------------------------------------------------------

    def _build_argv(
        self,
        audio_path: Path,
        *,
        language: str | None,
        translate_to_english: bool,
    ) -> list[str]:
        """Compute the argv for ``whisper-cli``.

        Always uses ``--output-json`` so the result is parseable.  The
        ``--no-timestamps`` flag is intentionally *not* set so that the
        frontend can render per-segment waveforms.
        """

        argv: list[str] = [
            str(self.whisper_binary),
            "-m",
            str(self.model_path),
            "-f",
            str(audio_path),
            "--output-json",
        ]
        if language:
            argv.extend(["-l", language])
        if translate_to_english:
            argv.append("--translate")
        if self.extra_args:
            argv.extend(self.extra_args)
        return argv

    # ------------------------------------------------------------------
    # Subprocess handling
    # ------------------------------------------------------------------

    def _run(self, argv: list[str]) -> subprocess.CompletedProcess[str]:
        """Execute ``argv`` using the injectable runner.

        Wrapping the invocation makes the class trivial to mock in
        tests: pass a ``runner`` callable that returns a fake
        :class:`subprocess.CompletedProcess`.
        """

        return self._runner(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=self.timeout,
            env=self._env,
        )

    @staticmethod
    def _completed(
        *,
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        """Build a fake :class:`CompletedProcess` for tests."""

        return subprocess.CompletedProcess(
            args=["whisper-cli"],
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        translate_to_english: bool = False,
    ) -> WhisperResult:
        """Transcribe ``audio_path`` and return a :class:`WhisperResult`.

        Args:
            audio_path: WAV/MP3/etc. file readable by whisper.cpp.
            language: Force an ISO 639-1 code (``"es"``, ``"en"``);
                ``None`` enables whisper's auto-detection.
            translate_to_english: Pass ``--translate`` to whisper-cli
                (requires a multilingual ``.bin`` model, e.g. ``base``).
        """

        self._ensure_binary()
        self._ensure_model()

        path = Path(audio_path)
        if not path.exists():
            raise AudioInputError(f"audio file does not exist: {path!s}")
        if not path.is_file():
            raise AudioInputError(f"audio path is not a file: {path!s}")

        argv = self._build_argv(
            path,
            language=language,
            translate_to_english=translate_to_english,
        )
        model_used = self.model_path.stem.replace("ggml-", "")
        started = time.monotonic()
        completed = self._run(argv)
        inference_seconds = time.monotonic() - started

        stdout = completed.stdout or ""
        stderr = completed.stderr or ""

        if completed.returncode != 0:
            raise WhisperInvocationError(
                f"whisper-cli exited with code {completed.returncode}: "
                f"{stderr.strip() or stdout.strip() or '<no output>'}"
            )

        if not _looks_like_whisper_json(stdout):
            # ``whisper-cli`` writes the JSON to stdout *and* to a sidecar
            # file with the audio file's stem.  When ``stdout`` happens
            # to be empty (very small models, odd TTY capture) we try to
            # read the sidecar.
            sidecar = path.with_suffix(".json")
            if sidecar.exists():
                stdout = sidecar.read_text(encoding="utf-8")
            if not _looks_like_whisper_json(stdout):
                raise WhisperInvocationError(
                    "whisper-cli produced no parseable JSON output; "
                    f"stderr={stderr.strip()!r}"
                )

        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise WhisperInvocationError(
                f"whisper-cli returned invalid JSON: {exc}; stderr={stderr.strip()!r}"
            ) from exc

        if not isinstance(payload, dict):
            raise WhisperInvocationError(
                "whisper-cli JSON root is not an object "
                f"(got {type(payload).__name__})"
            )

        return _parse_whisper_payload(
            payload,
            model_used=model_used,
            inference_seconds=inference_seconds,
        )


__all__ = ["WhisperRunner"]
