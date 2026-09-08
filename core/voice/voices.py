"""Discover and filter the voices installed on macOS.

The :func:`list_voices` wrapper runs ``say -v ?`` and parses the tabular
output.  The output is roughly::

    Name                 Language    Sample Text
    Samantha             en_US       "Hello, my name is Samantha..."
    ...

The columns are separated by runs of whitespace.  ``Sample Text`` may
contain internal spaces (and is conventionally wrapped in quotes by
``say``), so we partition the line into the first three whitespace-
separated tokens and treat the rest as the sample.

The module purposely tolerates the small layout differences between
macOS releases (some lines drop the quotes, some are padded with extra
spaces) by stripping each token individually.
"""

from __future__ import annotations

import re
import subprocess
from functools import lru_cache

from core.voice.errors import TTSInvocationError
from core.voice.models import VoiceInfo


DEFAULT_VOICE = "es_Mexico"
"""Default voice used when nothing else is specified.

``es_Mexico`` ships with every recent macOS release; it is the most
predictable default for the primary project locale (Spanish, Mexico).
"""

# ``say`` pads columns with at least two spaces in practice; any run of
# two or more whitespace characters is treated as a column separator.
_COLUMN_SPLIT = re.compile(r"\s{2,}")


def _parse_voice_line(line: str) -> VoiceInfo | None:
    """Convert a single ``say -v ?`` line into a :class:`VoiceInfo`.

    Returns ``None`` for empty lines, headers or anything that does not
    contain at least three whitespace-separated tokens.  The function is
    intentionally permissive so it never crashes on a malformed line –
    bad lines are simply skipped.
    """

    stripped = line.strip()
    if not stripped or stripped.lower().startswith(("name", "voice", "---")):
        return None

    parts = _COLUMN_SPLIT.split(stripped, maxsplit=2)
    if len(parts) < 3:
        return None

    name, language, sample_text = (token.strip() for token in parts)
    # ``say`` wraps the sample in double-quotes when the text contains
    # spaces.  Strip them so callers get the raw sample.
    if sample_text.startswith('"') and sample_text.endswith('"'):
        sample_text = sample_text[1:-1]
    locale = language
    lang_code = language.split("_", 1)[0] if "_" in language else language
    return VoiceInfo(
        name=name,
        language=lang_code,
        locale=locale,
        sample_text=sample_text,
    )


def _run_say_listing(say_binary: str | None = None) -> str:
    """Run ``say -v ?`` and return stdout.

    ``say_binary`` is exposed mostly for testing; production callers
    should not pass anything.  Raises :class:`TTSInvocationError` when
    ``say`` cannot be executed or returns a non-zero exit code.
    """

    binary = say_binary or "say"
    args = [binary, "-v", "?"]
    try:
        completed = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError as exc:  # pragma: no cover - macOS only
        raise TTSInvocationError(
            f"`say` not found; macOS is required to list voices (looked for {binary!r})"
        ) from exc
    except OSError as exc:  # pragma: no cover - sandboxed envs
        raise TTSInvocationError(f"failed to invoke `say`: {exc}") from exc

    if completed.returncode != 0:
        raise TTSInvocationError(
            f"`say -v ?` exited with code {completed.returncode}: {completed.stderr.strip()}"
        )

    return completed.stdout


def list_voices(*, say_binary: str | None = None) -> list[VoiceInfo]:
    """Return every :class:`VoiceInfo` reported by ``say``.

    The result is sorted by ``language`` then by ``name`` to keep the
    HTTP response stable across invocations (raw ``say`` ordering
    varies slightly between macOS releases).

    Args:
        say_binary: Optional override for the ``say`` executable path.
            Useful in tests and on Linux CI runners where a stub is
            installed.
    """

    raw = _run_say_listing(say_binary=say_binary)
    voices: list[VoiceInfo] = []
    for line in raw.splitlines():
        info = _parse_voice_line(line)
        if info is not None:
            voices.append(info)
    # Spanish (``es``) is the project's primary locale; surface those
    # voices first, then the rest sorted alphabetically.  Within each
    # language bucket names are sorted alphabetically for stability.
    voices.sort(
        key=lambda info: (
            0 if info.language.lower().startswith("es") else 1,
            info.language,
            info.name,
        )
    )
    return voices


@lru_cache(maxsize=1)
def _cached_default_voice() -> str:
    """Return the first Spanish voice, falling back to :data:`DEFAULT_VOICE`.

    Cached because ``say -v ?`` is a subprocess and we only need one
    answer.  Raises :class:`TTSInvocationError` only if ``say`` itself
    is missing; an empty list falls back to ``DEFAULT_VOICE``.
    """

    try:
        voices = list_voices()
    except TTSInvocationError:
        return DEFAULT_VOICE
    spanish = [v for v in voices if v.language.lower().startswith("es")]
    return spanish[0].name if spanish else DEFAULT_VOICE


def pick_default_voice() -> str:
    """Best-effort default voice: first Spanish voice, else first overall.

    Public wrapper around the cached lookup so the API layer can stay
    declarative.
    """

    return _cached_default_voice()


def filter_by_language(voices: list[VoiceInfo], language: str) -> list[VoiceInfo]:
    """Return voices whose ``language`` or ``locale`` matches ``language``.

    The match is case-insensitive and accepts either an ISO 639-1 code
    (``"es"``) or a full locale (``"es_MX"``).
    """

    needle = (language or "").strip().lower()
    if not needle:
        return list(voices)
    return [
        voice
        for voice in voices
        if voice.language.lower() == needle
        or voice.locale.lower() == needle
        or voice.locale.lower().startswith(f"{needle}_")
    ]


__all__ = [
    "DEFAULT_VOICE",
    "filter_by_language",
    "list_voices",
    "pick_default_voice",
]
