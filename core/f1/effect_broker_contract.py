"""Canonical F1 deny-reason mirror.

The source of truth for names is
``docs/contracts/f1-broker-deny-reasons.json``. This module never issues
grants and is never imported by a runtime hot-path.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

_REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = _REPO_ROOT / "docs" / "contracts" / "f1-broker-deny-reasons.json"


def load_contract() -> dict[str, Any]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


_CONTRACT = load_contract()
CONTRACT_DENY_REASONS = frozenset(_CONTRACT["deny_reasons"])
FOUR_ASSERTS = tuple(_CONTRACT["four_asserts"])


def deny_invariants_ok(event: Mapping[str, Any], *, deny_count_after: int, deny_count_before: int) -> bool:
    """Four fail-closed asserts for a deny audit event.

    1. decision === deny
    2. side_effect === false
    3. AuditEvent emitted (reason present)
    4. denyCount incremented
    """
    if event.get("decision") != "deny":
        return False
    if event.get("side_effect") is not False:
        return False
    if not event.get("reason"):
        return False
    if deny_count_after != deny_count_before + 1:
        return False
    return True
