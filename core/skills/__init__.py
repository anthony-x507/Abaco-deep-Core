"""Skill management for abaco-deep-core.

A Skill is a learned capability: a reusable workflow the agent can invoke
when it sees a trigger pattern. Skills are generated either from manual
recordings of the user doing tasks in the embedded browser, or from
curated templates.
"""

from .models import Skill, SkillStep, SkillSource, SkillGenerationRequest, SkillGenerationResult
from .store import SkillStore
from .generator import SkillGenerator
from .validator import SkillValidator, validate_skill
from .templates import list_templates, render_template

__all__ = [
    "Skill",
    "SkillStep",
    "SkillSource",
    "SkillGenerationRequest",
    "SkillGenerationResult",
    "SkillStore",
    "SkillGenerator",
    "SkillValidator",
    "validate_skill",
    "list_templates",
    "render_template",
]
