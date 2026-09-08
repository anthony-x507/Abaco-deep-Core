"""Built-in skill templates for common workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .models import Skill, SkillStep


@dataclass(frozen=True)
class SkillTemplate:
    template_id: str
    name: str
    description: str
    trigger_patterns: tuple[str, ...]
    steps: tuple[SkillStep, ...]
    preconditions: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "description": self.description,
            "trigger_patterns": list(self.trigger_patterns),
            "steps": [
                {
                    "action": s.action,
                    "selector": s.selector,
                    "value": s.value,
                    "notes": s.notes,
                    "timeout_ms": s.timeout_ms,
                }
                for s in self.steps
            ],
            "preconditions": list(self.preconditions),
        }


_TEMPLATES: tuple[SkillTemplate, ...] = (
    SkillTemplate(
        template_id="google-search",
        name="Google search",
        description="Open google.com and search for a query.",
        trigger_patterns=(r"googlear\s+(?P<q>.+)", r"buscar\s+en\s+google\s+(?P<q>.+)"),
        steps=(
            SkillStep(action="navigate", value="https://www.google.com", notes="Open Google"),
            SkillStep(action="type", selector="input[name='q']", value="${q}", notes="Type query"),
            SkillStep(action="click", selector="input[name='btnK']", notes="Submit search"),
        ),
    ),
    SkillTemplate(
        template_id="github-open-issue",
        name="Open a new GitHub issue",
        description="Navigate to a GitHub repo and open a new issue pre-filled with a title.",
        trigger_patterns=(r"abrir\s+issue\s+en\s+(?P<repo>[\w\-/]+)",),
        steps=(
            SkillStep(
                action="navigate",
                value="https://github.com/${repo}/issues/new",
                notes="Open the new-issue form",
            ),
        ),
        preconditions=("user must be logged in to GitHub",),
    ),
    SkillTemplate(
        template_id="twitter-post",
        name="Post a tweet",
        description="Open Twitter and post a tweet.",
        trigger_patterns=(r"twittear\s+(?P<msg>.+)", r"postear\s+en\s+twitter\s+(?P<msg>.+)"),
        steps=(
            SkillStep(action="navigate", value="https://twitter.com/compose/post", notes="Compose"),
            SkillStep(
                action="type",
                selector="div[contenteditable='true']",
                value="${msg}",
                notes="Type tweet",
            ),
            SkillStep(action="click", selector="button[data-testid='tweetButton']", notes="Post"),
        ),
        preconditions=("user must be logged in to Twitter",),
    ),
)


def list_templates() -> tuple[SkillTemplate, ...]:
    """Return all built-in templates."""
    return _TEMPLATES


def render_template(
    template_id: str,
    params: Mapping[str, str],
    *,
    skill_id: str | None = None,
) -> Skill | None:
    """Render a template into a Skill, substituting ``${param}`` placeholders."""

    from datetime import datetime, timezone
    from uuid import uuid4

    template = next((t for t in _TEMPLATES if t.template_id == template_id), None)
    if template is None:
        return None
    rendered_steps = tuple(
        SkillStep(
            action=_substitute(step.action, params),
            selector=_substitute(step.selector, params) if step.selector else None,
            value=_substitute(step.value, params) if step.value else None,
            notes=_substitute(step.notes, params),
            timeout_ms=step.timeout_ms,
        )
        for step in template.steps
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return Skill(
        skill_id=skill_id or f"skill-{uuid4()}",
        name=template.name,
        description=template.description,
        trigger_patterns=template.trigger_patterns,
        steps=rendered_steps,
        preconditions=template.preconditions,
        source=None,
        created_at=now,
        updated_at=now,
        version=1,
    )


def _substitute(value: str | None, params: Mapping[str, str]) -> str | None:
    if value is None:
        return None
    out = value
    for key, val in params.items():
        out = out.replace(f"${{{key}}}", val)
    return out


__all__ = ["SkillTemplate", "list_templates", "render_template"]
