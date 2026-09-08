"""Tests for core/skills."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from core.skills import (
    Skill,
    SkillGenerator,
    SkillSource,
    SkillStep,
    SkillStore,
    list_templates,
    render_template,
    validate_skill,
)
from core.skills.generator import _extract_json
from core.skills.models import SkillGenerationRequest


class TestSkillStore(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="abaco-skills-"))
        self.store = SkillStore(self.tmp / "skills.jsonl")

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_save_and_get(self) -> None:
        skill = Skill(
            skill_id="skill-1",
            name="Test",
            description="Test skill",
            steps=(SkillStep(action="navigate", value="https://example.com"),),
        )
        self.store.save(skill)
        loaded = self.store.get("skill-1")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.name, "Test")

    def test_save_then_update(self) -> None:
        skill = Skill(
            skill_id="skill-2",
            name="v1",
            description="",
            steps=(SkillStep(action="wait"),),
        )
        self.store.save(skill)
        updated = Skill(
            skill_id="skill-2",
            name="v2",
            description="updated",
            steps=(SkillStep(action="wait"),),
        )
        self.store.save(updated)
        loaded = self.store.get("skill-2")
        self.assertEqual(loaded.name, "v2")

    def test_delete(self) -> None:
        skill = Skill(
            skill_id="skill-3",
            name="x",
            description="x",
            steps=(SkillStep(action="wait"),),
        )
        self.store.save(skill)
        self.assertTrue(self.store.delete("skill-3"))
        self.assertIsNone(self.store.get("skill-3"))

    def test_list_skills(self) -> None:
        for i in range(3):
            self.store.save(
                Skill(
                    skill_id=f"skill-{i}",
                    name=f"n{i}",
                    description="d",
                    steps=(SkillStep(action="wait"),),
                    enabled=(i % 2 == 0),
                )
            )
        all_skills = self.store.list_skills()
        self.assertEqual(len(all_skills), 3)
        enabled = self.store.list_skills(enabled_only=True)
        self.assertEqual(len(enabled), 2)


class TestValidator(unittest.TestCase):
    def test_valid_skill(self) -> None:
        skill = Skill(
            skill_id="s",
            name="Valid",
            description="ok",
            trigger_patterns=(r"hello",),
            steps=(
                SkillStep(action="navigate", value="https://example.com"),
                SkillStep(action="wait", timeout_ms=500),
            ),
        )
        ok, errors = validate_skill(skill)
        self.assertTrue(ok, errors)

    def test_missing_steps(self) -> None:
        skill = Skill(skill_id="s", name="n", description="d")
        ok, errors = validate_skill(skill)
        self.assertFalse(ok)
        self.assertTrue(any("steps" in e.field for e in errors))

    def test_invalid_regex(self) -> None:
        skill = Skill(
            skill_id="s",
            name="n",
            description="d",
            trigger_patterns=("[unclosed",),
            steps=(SkillStep(action="wait"),),
        )
        ok, errors = validate_skill(skill)
        self.assertFalse(ok)

    def test_unknown_action(self) -> None:
        skill = Skill(
            skill_id="s",
            name="n",
            description="d",
            steps=(SkillStep(action="teleport"),),
        )
        ok, errors = validate_skill(skill)
        self.assertFalse(ok)

    def test_click_requires_selector(self) -> None:
        skill = Skill(
            skill_id="s",
            name="n",
            description="d",
            steps=(SkillStep(action="click"),),
        )
        ok, errors = validate_skill(skill)
        self.assertFalse(ok)


class TestTemplates(unittest.TestCase):
    def test_list_templates(self) -> None:
        templates = list_templates()
        self.assertGreater(len(templates), 0)

    def test_render_template_substitutes(self) -> None:
        skill = render_template("google-search", {"q": "abaco deep core"})
        self.assertIsNotNone(skill)
        self.assertIn("abaco deep core", skill.steps[1].value)

    def test_render_unknown_returns_none(self) -> None:
        self.assertIsNone(render_template("does-not-exist", {}))


class TestGeneratorFallback(unittest.TestCase):
    def test_fallback_when_no_api_key(self) -> None:
        gen = SkillGenerator(api_key="")
        req = SkillGenerationRequest(
            recording_actions=(
                {"action_type": "navigate", "url": "https://example.com"},
                {"action_type": "click", "selector": "button.submit"},
            ),
            description="Fallback test",
            author_node_id="node-A",
        )
        result = gen.generate(req)
        self.assertTrue(result.fallback_used)
        self.assertEqual(len(result.skill.steps), 2)


class TestExtractJson(unittest.TestCase):
    def test_extracts_object(self) -> None:
        text = 'Here you go: {"name":"x"} cheers!'
        self.assertEqual(_extract_json(text), '{"name":"x"}')

    def test_no_json_raises(self) -> None:
        with self.assertRaises(ValueError):
            _extract_json("nothing here")


if __name__ == "__main__":
    unittest.main()
