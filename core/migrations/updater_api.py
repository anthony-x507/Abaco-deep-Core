"""Auto-update endpoints and helpers.

These endpoints expose information about available updates without
performing the actual install (the install is driven by electron-updater
in the renderer). The Python side is responsible for:

* Tracking which versions have been applied.
* Triggering data migrations after a successful update.
* Surfacing release notes for the UI dialog.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .migrations import migrate, read_schema_version, current_version, MigrationResult


@dataclass(frozen=True)
class UpdateInfo:
    """Information about an available update."""

    available: bool
    current_version: str
    new_version: str
    release_notes: str = ""
    download_url: str = ""
    sha512: str = ""
    size_bytes: int = 0
    is_prerelease: bool = False
    published_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AppliedUpdate:
    """Record of an applied update for the change log."""

    from_version: str
    to_version: str
    applied_at: str
    migration_result: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def detect_update(
    *,
    current_version: str,
    available_releases: list[Mapping[str, Any]],
    feed_path: Path | None = None,
) -> UpdateInfo:
    """Compare ``current_version`` against ``available_releases``.

    ``available_releases`` is expected to be a list of dicts with at least
    ``tag_name``, ``prerelease``, ``body``, ``published_at``,
    ``assets[0].browser_download_url``, ``assets[0].size``,
    ``assets[0].digest``.

    If ``feed_path`` points to a ``latest.yml`` (electron-updater format)
    the function prefers values parsed from there.
    """

    candidate = _pick_candidate(available_releases, feed_path)
    if candidate is None:
        return UpdateInfo(
            available=False,
            current_version=current_version,
            new_version=current_version,
        )

    new_version = str(candidate.get("tag_name") or current_version).lstrip("v")
    available = _is_newer(new_version, current_version)
    asset = _first_asset(candidate.get("assets"))
    download_url = str(asset.get("browser_download_url", "")) if asset else ""
    digest = str(asset.get("digest", "")) if asset else ""
    size = int(asset.get("size", 0) or 0) if asset else 0
    return UpdateInfo(
        available=available,
        current_version=current_version,
        new_version=new_version,
        release_notes=str(candidate.get("body") or ""),
        download_url=download_url,
        sha512=digest.split(":", 1)[1] if ":" in digest else digest,
        size_bytes=size,
        is_prerelease=bool(candidate.get("prerelease", False)),
        published_at=str(candidate.get("published_at", "")),
    )


def record_applied_update(
    *,
    from_version: str,
    to_version: str,
    migration_result: Mapping[str, Any] | None = None,
) -> AppliedUpdate:
    """Build an :class:`AppliedUpdate` with the current timestamp."""

    return AppliedUpdate(
        from_version=from_version,
        to_version=to_version,
        applied_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        migration_result=dict(migration_result or {}),
    )


def run_migrations_after_update(
    data_dir: Path,
    *,
    target_version: str | None = None,
) -> MigrationResult:
    """Run data migrations after the app has been updated.

    Returns the same :class:`MigrationResult` as :func:`migrate`. The
    caller is expected to surface failures to the user (a dialog asking
    to roll back or report a bug).
    """

    return migrate(data_dir, target_version=target_version)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _pick_candidate(
    releases: list[Mapping[str, Any]],
    feed_path: Path | None,
) -> Mapping[str, Any] | None:
    if not releases:
        return None
    if feed_path is not None and feed_path.is_file():
        try:
            feed = _parse_yaml_feed(feed_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            feed = None
        if feed is not None:
            return {
                "tag_name": feed.get("version", ""),
                "body": "",
                "published_at": feed.get("releaseDate", ""),
                "assets": [
                    {
                        "browser_download_url": feed.get("path", ""),
                        "size": feed.get("size", 0),
                        "digest": f"sha512:{feed.get('sha512', '')}",
                    },
                ],
                "prerelease": False,
            }
    # Pick the first non-draft, latest release.
    for release in releases:
        if not release.get("draft", False):
            return release
    return releases[0]


def _first_asset(assets: Any) -> Mapping[str, Any]:
    if isinstance(assets, list) and assets:
        return assets[0]
    return {}


def _parse_yaml_feed(content: str) -> Mapping[str, Any]:
    """Best-effort parse of electron-updater's ``latest.yml`` format.

    The file is plain YAML with simple ``key: value`` lines, so we can
    parse it without a YAML dependency.
    """
    result: dict[str, Any] = {}
    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


def _is_newer(new: str, current: str) -> bool:
    """Return True if ``new`` is strictly newer than ``current`` semver."""

    def key(v: str) -> tuple[int, ...]:
        try:
            return tuple(int(part) for part in v.split("."))
        except ValueError:
            return (0,)

    return key(new) > key(current)


__all__ = [
    "UpdateInfo",
    "AppliedUpdate",
    "detect_update",
    "record_applied_update",
    "run_migrations_after_update",
]
