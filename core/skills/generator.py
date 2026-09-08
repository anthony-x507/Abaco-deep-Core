"""Skill generator backed by the Claude API.

Uses the Anthropic messages API to ask Claude to summarise a recording
into a structured Skill. The HTTP call goes through ``urllib`` so the
generator has no extra dependencies.

If the API call fails, the generator falls back to a deterministic
heuristic that simply turns each recorded action into a single step.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping
from uuid import uuid4

from .models import (
    Skill,
    SkillGenerationRequest,
    SkillGenerationResult,
    SkillSource,
    SkillStep,
)
from .validator import validate_skill


CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


SYSTEM_PROMPT = """You are a Skill generator. The user will give you a list of recorded browser actions and (optionally) a description of the goal.

Return ONLY a JSON object with this exact shape (no prose, no markdown fence):

{
  "name": "short skill name in Spanish",
  "description": "one sentence describing what the skill does",
  "trigger_patterns": ["regex1", "regex2"],
  "steps": [
    {
      "action": "navigate | click | type | wait | extract | call_api | screenshot | scroll | select",
      "selector": "css selector or null",
      "value": "text or URL or null",
      "notes": "optional context for the executor",
      "timeout_ms": 0
    }
  ],
  "preconditions": ["the user must be logged in to X"]
}

Keep steps minimal, deterministic, and idempotent."""


@dataclass(frozen=True)
class SkillGenerator:
    """Generate Skills from recordings using the Claude API.

    Attributes:
        api_key: Anthropic API key.  When empty, the generator falls back
            to the heuristic mode.
        model: Model identifier (default ``claude-sonnet-4-5``).
        timeout: Per-call timeout in seconds.
        api_url: Override for the Anthropic API endpoint (mostly for
            tests).
    """

    api_key: str = ""
    model: str = "claude-sonnet-4-5"
    timeout: float = 60.0
    api_url: str = CLAUDE_API_URL

    def generate(
        self,
        request: SkillGenerationRequest,
    ) -> SkillGenerationResult:
        """Generate a Skill from the request, or fall back to heuristic mode."""

        start = time.monotonic()
        if not request.api_key and not self.api_key:
            skill = self._fallback(request)
            return SkillGenerationResult(
                skill=skill,
                raw_response="<heuristic-fallback: no API key>",
                model_used="heuristic",
                generation_seconds=time.monotonic() - start,
                fallback_used=True,
            )

        user_payload = json.dumps(request.to_prompt_payload(), ensure_ascii=False)
        body = json.dumps({
            "model": self.model,
            "max_tokens": 2048,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_payload}],
        }).encode("utf-8")

        api_key = request.api_key or self.api_key
        req = urllib.request.Request(
            self.api_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": ANTHROPIC_VERSION,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            skill = self._fallback(request)
            return SkillGenerationResult(
                skill=skill,
                raw_response=f"<error: {exc}>",
                model_used=self.model,
                generation_seconds=time.monotonic() - start,
                fallback_used=True,
            )

        try:
            payload = json.loads(raw)
            content_blocks = payload.get("content", [])
            text = "".join(
                block.get("text", "")
                for block in content_blocks
                if isinstance(block, Mapping)
            ).strip()
            skill_dict = json.loads(_extract_json(text))
        except (json.JSONDecodeError, KeyError, IndexError):
            skill = self._fallback(request)
            return SkillGenerationResult(
                skill=skill,
                raw_response=raw,
                model_used=self.model,
                generation_seconds=time.monotonic() - start,
                fallback_used=True,
            )

        skill = self._build_skill(
            skill_dict=skill_dict,
            request=request,
        )
        return SkillGenerationResult(
            skill=skill,
            raw_response=raw,
            model_used=self.model,
            generation_seconds=time.monotonic() - start,
            fallback_used=False,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_skill(
        self,
        *,
        skill_dict: Mapping[str, Any],
        request: SkillGenerationRequest,
    ) -> Skill:
        steps = tuple(
            SkillStep(
                action=str(s.get("action", "wait")),
                selector=s.get("selector"),
                value=s.get("value"),
                notes=str(s.get("notes", "")),
                timeout_ms=int(s.get("timeout_ms", 0) or 0),
            )
            for s in skill_dict.get("steps", [])
            if isinstance(s, Mapping)
        )
        from datetime import datetime, timezone

        now = (
            datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
        skill = Skill(
            skill_id=f"skill-{uuid4()}",
            name=str(skill_dict.get("name", "Untitled skill")),
            description=str(skill_dict.get("description", "")),
            trigger_patterns=tuple(
                str(p) for p in skill_dict.get("trigger_patterns", [])
            ),
            steps=steps,
            preconditions=tuple(
                str(p) for p in skill_dict.get("preconditions", [])
            ),
            source=SkillSource(
                kind="recording",
                recording_id=(
                    request.recording_actions[0].get("session_id", "")
                    if request.recording_actions
                    else None
                ),
                template_id=None,
                model=self.model,
                author_node_id=request.author_node_id,
            ),
            created_at=now,
            updated_at=now,
            version=1,
            enabled=True,
        )
        # Validate and return; if invalid, mark disabled.
        ok, _errors = validate_skill(skill)
        if not ok:
            skill = Skill(
                skill_id=skill.skill_id,
                name=skill.name,
                description=skill.description,
                trigger_patterns=skill.trigger_patterns,
                steps=skill.steps,
                preconditions=skill.preconditions,
                source=skill.source,
                created_at=skill.created_at,
                updated_at=skill.updated_at,
                version=skill.version,
                tags=skill.tags,
                enabled=False,
            )
        return skill

    def _fallback(self, request: SkillGenerationRequest) -> Skill:
        """Turn each recorded action into a step directly, no LLM."""
        from datetime import datetime, timezone

        steps = []
        for action in request.recording_actions:
            act = str(action.get("action_type", "wait"))
            selector = action.get("selector")
            value = action.get("text") or action.get("url")
            steps.append(
                SkillStep(
                    action=act if act in {"navigate", "click", "type", "wait", "screenshot", "scroll"} else "wait",
                    selector=str(selector) if selector else None,
                    value=str(value) if value else None,
                    notes="heuristic fallback",
                )
            )
        if not steps:
            steps = [SkillStep(action="wait", notes="empty recording")]
        now = (
            datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
        return Skill(
            skill_id=f"skill-{uuid4()}",
            name=request.description[:80] or "Skill from recording",
            description=request.description or "Generated heuristically from recording",
            trigger_patterns=(),
            steps=tuple(steps),
            preconditions=(),
            source=SkillSource(
                kind="recording",
                recording_id=(
                    request.recording_actions[0].get("session_id", "")
                    if request.recording_actions
                    else None
                ),
                model="heuristic",
                author_node_id=request.author_node_id,
            ),
            created_at=now,
            updated_at=now,
            version=1,
            enabled=False,
        )


def _extract_json(text: str) -> str:
    """Extract the first JSON object from a model response."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found")
    return text[start : end + 1]


__all__ = ["SkillGenerator", "CLAUDE_API_URL", "SYSTEM_PROMPT"]
