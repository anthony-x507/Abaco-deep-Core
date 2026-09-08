"""Validator for Skill objects."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Skill, SkillStep


_ALLOWED_ACTIONS: frozenset[str] = frozenset({
    "navigate",
    "click",
    "type",
    "wait",
    "extract",
    "call_api",
    "screenshot",
    "scroll",
    "select",
})


@dataclass(frozen=True)
class ValidationError:
    field: str
    message: str


class SkillValidator:
    """Validates a Skill is structurally well-formed and safe to execute."""

    def __init__(self) -> None:
        self.errors: list[ValidationError] = []

    def validate(self, skill: Skill) -> tuple[bool, tuple[ValidationError, ...]]:
        self.errors.clear()
        if not skill.skill_id:
            self.errors.append(ValidationError("skill_id", "must not be empty"))
        if not skill.name or not skill.name.strip():
            self.errors.append(ValidationError("name", "must not be empty"))
        if not skill.description or not skill.description.strip():
            self.errors.append(
                ValidationError("description", "must not be empty")
            )
        for pattern in skill.trigger_patterns:
            try:
                re.compile(pattern)
            except re.error as exc:
                self.errors.append(
                    ValidationError(
                        "trigger_patterns",
                        f"invalid regex {pattern!r}: {exc}",
                    )
                )
        if not skill.steps:
            self.errors.append(
                ValidationError("steps", "must have at least one step")
            )
        for i, step in enumerate(skill.steps):
            self._validate_step(i, step)
        return (not self.errors, tuple(self.errors))

    def _validate_step(self, index: int, step: SkillStep) -> None:
        prefix = f"steps[{index}]"
        if step.action not in _ALLOWED_ACTIONS:
            self.errors.append(
                ValidationError(
                    f"{prefix}.action",
                    f"unknown action {step.action!r}; allowed: {sorted(_ALLOWED_ACTIONS)}",
                )
            )
        if step.action in {"click", "type", "extract", "select", "screenshot"} and not step.selector:
            self.errors.append(
                ValidationError(
                    f"{prefix}.selector",
                    f"action {step.action!r} requires a selector",
                )
            )
        if step.action == "navigate" and not step.value:
            self.errors.append(
                ValidationError(
                    f"{prefix}.value",
                    "navigate requires a URL in 'value'",
                )
            )
        if step.action == "type" and step.value is None:
            self.errors.append(
                ValidationError(
                    f"{prefix}.value",
                    "type requires text in 'value'",
                )
            )


def validate_skill(skill: Skill) -> tuple[bool, tuple[ValidationError, ...]]:
    """Functional helper that uses a fresh validator."""
    return SkillValidator().validate(skill)


__all__ = ["SkillValidator", "validate_skill", "ValidationError"]
