"""Migration runner.

A migration is a callable that mutates the data directory in place.
The runner composes a list of migrations into an upgrade path and applies
them sequentially. Each step's output (a short summary) is collected into
a :class:`MigrationResult`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from .schema_version import current_version, read_schema_version, write_schema_version


MigrationStep = Callable[[Path], None]


@dataclass(frozen=True)
class Migration:
    """One named upgrade step."""

    from_version: str
    to_version: str
    apply: MigrationStep
    description: str = ""

    def run(self, data_dir: Path) -> None:
        self.apply(Path(data_dir))


@dataclass(frozen=True)
class MigrationResult:
    """Summary returned by :func:`migrate`."""

    from_version: str
    to_version: str
    ok: bool
    applied: tuple[str, ...] = ()
    skipped: tuple[str, ...] = ()
    errors: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, object]:
        return {
            "from_version": self.from_version,
            "to_version": self.to_version,
            "ok": self.ok,
            "applied": list(self.applied),
            "skipped": list(self.skipped),
            "errors": list(self.errors),
        }


_REGISTRY: list[Migration] = []

# Built-in migrations shipped with the codebase (registered at import
# time below). They are kept separate from user registrations so that
# ``clear_registry()`` can drop user migrations without losing the
# default upgrade path (``0.0.0`` -> ``current_version()``).
_BUILTINS: list[Migration] = []


def _register_builtin(
    from_version: str,
    to_version: str,
    apply: MigrationStep,
    *,
    description: str = "",
) -> None:
    """Register a migration that is part of the shipped upgrade path."""

    migration = Migration(
        from_version=from_version,
        to_version=to_version,
        apply=apply,
        description=description,
    )
    _BUILTINS.append(migration)
    _REGISTRY.append(migration)


def register(
    from_version: str,
    to_version: str,
    apply: MigrationStep,
    *,
    description: str = "",
) -> None:
    """Register a migration step.

    The registry is process-local. Tests that need a clean registry should
    use :func:`clear_registry`.
    """

    _REGISTRY.append(
        Migration(
            from_version=from_version,
            to_version=to_version,
            apply=apply,
            description=description,
        )
    )


def clear_registry() -> None:
    """Drop user-registered migrations; keep the built-in ones. Tests only."""

    _REGISTRY.clear()
    _REGISTRY.extend(_BUILTINS)


def registered_migrations() -> tuple[Migration, ...]:
    """Return the current set of migrations, sorted by from_version."""

    return tuple(sorted(_REGISTRY, key=lambda m: m.from_version))


def run(
    data_dir: Path,
    *,
    target_version: str | None = None,
    registry: Iterable[Migration] | None = None,
) -> MigrationResult:
    """Apply migrations sequentially until ``target_version`` is reached.

    Args:
        data_dir: Root directory containing user data.
        target_version: Version to upgrade to. Defaults to :func:`current_version`.
        registry: Override the registry (mostly for tests).

    Returns:
        A :class:`MigrationResult` summarising what was applied.
    """

    data_dir = Path(data_dir)
    target = target_version or current_version()
    start = read_schema_version(data_dir)
    migrations = (
        sorted(registry, key=lambda m: m.from_version)
        if registry is not None
        else registered_migrations()
    )

    applied: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    cursor = start
    for migration in migrations:
        if migration.from_version != cursor:
            skipped.append(f"{migration.from_version}->{migration.to_version}")
            continue
        try:
            migration.run(data_dir)
            write_schema_version(data_dir, migration.to_version)
            applied.append(f"{migration.from_version}->{migration.to_version}")
            cursor = migration.to_version
        except Exception as exc:  # noqa: BLE001 - report any failure
            errors.append(f"{migration.from_version}->{migration.to_version}: {exc}")
            break
        if cursor == target:
            break

    ok = cursor == target and not errors
    return MigrationResult(
        from_version=start,
        to_version=cursor,
        ok=ok,
        applied=tuple(applied),
        skipped=tuple(skipped),
        errors=tuple(errors),
    )


# ----------------------------------------------------------------------
# Built-in migrations
# ----------------------------------------------------------------------


def _noop_migration(data_dir: Path) -> None:
    """Placeholder used to mark a version bump without any data change."""
    return None


# 0.0.0 -> 0.1.0: initial schema, no data manipulation needed yet.
_register_builtin(
    "0.0.0",
    "0.1.0",
    _noop_migration,
    description="Initial schema: nothing to migrate.",
)


__all__ = [
    "Migration",
    "MigrationResult",
    "MigrationStep",
    "clear_registry",
    "register",
    "registered_migrations",
    "run",
]
