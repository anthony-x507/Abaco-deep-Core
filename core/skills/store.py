"""JSON-on-disk persistence for Skills."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .models import Skill


def _now_iso_z() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


class SkillStore:
    """Append-only JSONL store for skills.

    Each skill is one JSON object per line. Lookups go through an in-memory
    index. Writes are atomic via ``os.replace``.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._index: dict[str, int] = {}  # skill_id -> line number
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        with self._lock:
            self._index.clear()
            with self.path.open("r", encoding="utf-8") as handle:
                for i, line in enumerate(handle):
                    clean = line.strip()
                    if not clean:
                        continue
                    record = json.loads(clean)
                    self._index[str(record["skill_id"])] = i

    def list_skills(self, *, enabled_only: bool = False) -> list[Skill]:
        if not self.path.exists():
            return []
        out: list[Skill] = []
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                clean = line.strip()
                if not clean:
                    continue
                skill = Skill.from_dict(json.loads(clean))
                if enabled_only and not skill.enabled:
                    continue
                out.append(skill)
        return out

    def get(self, skill_id: str) -> Skill | None:
        with self._lock:
            line_no = self._index.get(skill_id)
        if line_no is None:
            return None
        with self.path.open("r", encoding="utf-8") as handle:
            for i, line in enumerate(handle):
                if i != line_no:
                    continue
                return Skill.from_dict(json.loads(line.strip()))
        return None

    def save(self, skill: Skill) -> Skill:
        """Append or replace a skill by skill_id."""
        with self._lock:
            existing_line = self._index.get(skill.skill_id)
            if existing_line is not None:
                # Rewrite the file replacing the matching line.
                tmp = self.path.with_suffix(".jsonl.tmp")
                with self.path.open("r", encoding="utf-8") as src, tmp.open(
                    "w", encoding="utf-8"
                ) as dst:
                    for i, line in enumerate(src):
                        if i == existing_line:
                            dst.write(json.dumps(skill.to_dict()) + "\n")
                        else:
                            dst.write(line)
                os.replace(tmp, self.path)
            else:
                with self.path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(skill.to_dict()) + "\n")
                self._index[skill.skill_id] = len(self._index)
            return skill

    def delete(self, skill_id: str) -> bool:
        with self._lock:
            if skill_id not in self._index:
                return False
            tmp = self.path.with_suffix(".jsonl.tmp")
            with self.path.open("r", encoding="utf-8") as src, tmp.open(
                "w", encoding="utf-8"
            ) as dst:
                for line in src:
                    clean = line.strip()
                    if not clean:
                        dst.write(line)
                        continue
                    if json.loads(clean).get("skill_id") == skill_id:
                        continue
                    dst.write(line)
            os.replace(tmp, self.path)
            self._index.pop(skill_id, None)
        return True

    @staticmethod
    def make_id(prefix: str = "skill") -> str:
        return f"{prefix}-{uuid.uuid4()}"


__all__ = ["SkillStore"]
