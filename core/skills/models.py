"""Data classes for skills.

The module exposes two parallel shapes:

* The original authoring dataclasses (``Skill``, ``SkillStep``,
  ``SkillSource``, ``SkillGenerationRequest``, ``SkillGenerationResult``)
  used by the existing store / generator / templates.
* The spec-shaped dataclasses (``SpecSkill``, ``RecordedAction``,
  ``RecordingSession``, ``SkillStoreConfig``) used by the embedded
  browser feature.  The TypeScript half writes these as JSON; the
  Python half reads them, validates, persists them, and renders them
  back to the renderer.

The two shapes share the same physical storage (``SkillStore``), but
the spec-shaped ``Skill`` is canonical for everything that crosses the
TypeScript ↔ Python boundary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence


# ----------------------------------------------------------------------
# Spec-shaped dataclasses (mirror the TypeScript types in
# ``desktop/features/browser/types.ts``)
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class RecordedAction:
    """A single captured browser action.

    Mirrors ``RecordedAction`` in ``types.ts``.
    """

    timestamp: str
    url: str
    action_type: str  # 'click' | 'type' | 'navigate' | 'scroll' | 'screenshot' | 'wait'
    selector: str | None = None
    text: str | None = None
    screenshot_path: str | None = None
    notes: str | None = None

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "RecordedAction":
        return cls(
            timestamp=str(payload.get("timestamp", "")),
            url=str(payload.get("url", "")),
            action_type=str(payload.get("action_type", "wait")),
            selector=payload.get("selector"),
            text=payload.get("text"),
            screenshot_path=payload.get("screenshot_path"),
            notes=payload.get("notes"),
        )

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "timestamp": self.timestamp,
            "url": self.url,
            "action_type": self.action_type,
        }
        if self.selector is not None:
            out["selector"] = self.selector
        if self.text is not None:
            out["text"] = self.text
        if self.screenshot_path is not None:
            out["screenshot_path"] = self.screenshot_path
        if self.notes is not None:
            out["notes"] = self.notes
        return out


@dataclass(frozen=True)
class RecordingSession:
    """A complete recording session.

    Mirrors ``RecordingSession`` in ``types.ts``.
    """

    session_id: str
    started_at: str
    ended_at: str
    actions: tuple[RecordedAction, ...]
    final_url: str
    title: str
    source_path: str | None = None

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "RecordingSession":
        return cls(
            session_id=str(payload.get("session_id", "")),
            started_at=str(payload.get("started_at", "")),
            ended_at=str(payload.get("ended_at", "")),
            actions=tuple(
                RecordedAction.from_dict(a)
                for a in payload.get("actions", ())
                if isinstance(a, Mapping)
            ),
            final_url=str(payload.get("final_url", "")),
            title=str(payload.get("title", "")),
            source_path=payload.get("source_path"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "actions": [a.to_dict() for a in self.actions],
            "final_url": self.final_url,
            "title": self.title,
            **({"source_path": self.source_path} if self.source_path else {}),
        }


@dataclass(frozen=True)
class SpecSkill:
    """The spec-shaped Skill produced by the Claude generator.

    Field names mirror the task description exactly:

    * ``source_recording_id`` — the ``RecordingSession.session_id`` this
      skill came from (empty string when generated from a template).
    * ``generated_by_model`` — the LLM identifier, e.g.
      ``"claude-sonnet-4.5"``; ``"heuristic"`` when the offline fallback
      was used.

    The dataclass is hashable (frozen=True) so the store can use it as
    a cache key.  ``steps`` is a tuple of plain dicts to keep the JSON
    contract trivial.
    """

    skill_id: str
    name: str
    description: str
    trigger_patterns: tuple[str, ...]
    steps: tuple[dict[str, Any], ...]
    preconditions: tuple[str, ...]
    source_recording_id: str
    generated_by_model: str
    created_at: str
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "skill_id": self.skill_id,
            "name": self.name,
            "description": self.description,
            "trigger_patterns": list(self.trigger_patterns),
            "steps": [dict(s) for s in self.steps],
            "preconditions": list(self.preconditions),
            "source_recording_id": self.source_recording_id,
            "generated_by_model": self.generated_by_model,
            "created_at": self.created_at,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "SpecSkill":
        return cls(
            skill_id=str(payload["skill_id"]),
            name=str(payload.get("name", "")),
            description=str(payload.get("description", "")),
            trigger_patterns=tuple(str(p) for p in payload.get("trigger_patterns", ())),
            steps=tuple(dict(s) for s in payload.get("steps", ()) if isinstance(s, Mapping)),
            preconditions=tuple(str(p) for p in payload.get("preconditions", ())),
            source_recording_id=str(payload.get("source_recording_id", "")),
            generated_by_model=str(payload.get("generated_by_model", "")),
            created_at=str(payload.get("created_at", "")),
            version=int(payload.get("version", 1)),
        )


@dataclass(frozen=True)
class SkillStoreConfig:
    """Where the skill store keeps its files.

    The default ``root`` is ``~/.abaco-deep-core/skills`` which matches
    the path described in the task spec.  Tests pass an explicit
    ``root`` (typically a ``tempfile.mkdtemp`` directory).
    """

    root: str
    file_mode: int = 0o600

    @classmethod
    def default(cls) -> "SkillStoreConfig":
        import os
        return cls(root=os.path.join(os.path.expanduser("~"), ".abaco-deep-core", "skills"))


def skill_to_dict(skill: SpecSkill) -> dict[str, Any]:
    """Functional alias of :meth:`SpecSkill.to_dict`."""

    return skill.to_dict()


def skill_from_dict(payload: Mapping[str, Any]) -> SpecSkill:
    """Functional alias of :meth:`SpecSkill.from_dict`."""

    return SpecSkill.from_dict(payload)


@dataclass(frozen=True)
class SkillStep:
    """One executable step inside a Skill."""

    action: str                    # 'navigate', 'click', 'type', 'wait', 'extract', 'call_api'
    selector: str | None = None    # CSS selector or URL
    value: str | None = None       # Text to type, value to extract, etc.
    notes: str = ""
    timeout_ms: int = 0


@dataclass(frozen=True)
class Skill:
    """A reusable, executable workflow."""

    skill_id: str
    name: str
    description: str
    trigger_patterns: tuple[str, ...] = ()
    steps: tuple[SkillStep, ...] = ()
    preconditions: tuple[str, ...] = ()
    source: "SkillSource" = None  # type: ignore[assignment]
    created_at: str = ""
    updated_at: str = ""
    version: int = 1
    tags: tuple[str, ...] = ()
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "skill_id": self.skill_id,
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
            "source": self.source.to_dict() if self.source else None,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "version": self.version,
            "tags": list(self.tags),
            "enabled": self.enabled,
        }

    @staticmethod
    def from_dict(payload: Mapping[str, Any]) -> "Skill":
        steps = tuple(
            SkillStep(
                action=str(s["action"]),
                selector=s.get("selector"),
                value=s.get("value"),
                notes=str(s.get("notes", "")),
                timeout_ms=int(s.get("timeout_ms", 0)),
            )
            for s in payload.get("steps", [])
        )
        source_data = payload.get("source")
        source = SkillSource.from_dict(source_data) if source_data else None
        return Skill(
            skill_id=str(payload["skill_id"]),
            name=str(payload["name"]),
            description=str(payload.get("description", "")),
            trigger_patterns=tuple(str(p) for p in payload.get("trigger_patterns", ())),
            steps=steps,
            preconditions=tuple(str(p) for p in payload.get("preconditions", ())),
            source=source,
            created_at=str(payload.get("created_at", "")),
            updated_at=str(payload.get("updated_at", "")),
            version=int(payload.get("version", 1)),
            tags=tuple(str(t) for t in payload.get("tags", ())),
            enabled=bool(payload.get("enabled", True)),
        )


@dataclass(frozen=True)
class SkillSource:
    """Where a skill came from."""

    kind: str                  # 'recording', 'manual', 'template'
    recording_id: str | None = None
    template_id: str | None = None
    model: str = ""            # e.g. 'claude-sonnet-4.5' for AI-generated
    author_node_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "recording_id": self.recording_id,
            "template_id": self.template_id,
            "model": self.model,
            "author_node_id": self.author_node_id,
        }

    @staticmethod
    def from_dict(payload: Mapping[str, Any]) -> "SkillSource":
        return SkillSource(
            kind=str(payload.get("kind", "manual")),
            recording_id=payload.get("recording_id"),
            template_id=payload.get("template_id"),
            model=str(payload.get("model", "")),
            author_node_id=str(payload.get("author_node_id", "")),
        )


@dataclass(frozen=True)
class SkillGenerationRequest:
    """Inputs for generating a skill from a recording or text description."""

    recording_actions: tuple[dict[str, Any], ...] = ()
    description: str = ""
    model: str = "claude-sonnet-4.5"
    author_node_id: str = ""
    api_key: str = ""

    def to_prompt_payload(self) -> dict[str, Any]:
        return {
            "description": self.description,
            "actions": [dict(a) for a in self.recording_actions],
        }


@dataclass(frozen=True)
class SkillGenerationResult:
    """The raw result returned by the generator."""

    skill: Skill
    raw_response: str
    model_used: str
    generation_seconds: float
    fallback_used: bool = False
