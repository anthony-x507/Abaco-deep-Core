"""Python mirror of the F1 broker fail-closed contract."""

from __future__ import annotations

import unittest
from pathlib import Path

from core.f1.effect_broker_contract import (
    CONTRACT_DENY_REASONS,
    CONTRACT_PATH,
    FOUR_ASSERTS,
    deny_invariants_ok,
    load_contract,
)

BROKER_JS = (
    Path(__file__).resolve().parents[3]
    / "desktop"
    / "src"
    / "dsh-desktop"
    / "packages"
    / "abaco-effect-broker"
    / "index.js"
)


class TestF1BrokerContractMirror(unittest.TestCase):
    def test_fixture_is_canonical(self) -> None:
        spec = load_contract()
        self.assertTrue(CONTRACT_PATH.is_file())
        self.assertEqual(spec["deny_reasons"], sorted(CONTRACT_DENY_REASONS, key=spec["deny_reasons"].index))
        self.assertEqual(len(FOUR_ASSERTS), 4)
        self.assertIn("decision === deny", FOUR_ASSERTS)

    def test_broker_source_contains_every_contract_reason(self) -> None:
        src = BROKER_JS.read_text(encoding="utf-8")
        missing = [reason for reason in CONTRACT_DENY_REASONS if f"'{reason}'" not in src]
        self.assertEqual(missing, [], f"broker missing deny reasons: {missing}")

    def test_four_asserts_accept_a_real_deny_event(self) -> None:
        event = {
            "decision": "deny",
            "side_effect": False,
            "reason": "no-identity",
            "plugin_id": None,
        }
        self.assertTrue(deny_invariants_ok(event, deny_count_before=0, deny_count_after=1))

    def test_four_asserts_reject_swallowed_deny(self) -> None:
        swallowed = {
            "decision": "allow",
            "side_effect": False,
            "reason": "no-identity",
        }
        self.assertFalse(deny_invariants_ok(swallowed, deny_count_before=0, deny_count_after=1))
        side_effect = {
            "decision": "deny",
            "side_effect": True,
            "reason": "no-identity",
        }
        self.assertFalse(deny_invariants_ok(side_effect, deny_count_before=0, deny_count_after=1))
        no_counter = {
            "decision": "deny",
            "side_effect": False,
            "reason": "no-identity",
        }
        self.assertFalse(deny_invariants_ok(no_counter, deny_count_before=3, deny_count_after=3))

    def test_authorize_source_has_no_atena(self) -> None:
        src = BROKER_JS.read_text(encoding="utf-8")
        start = src.index("export function authorize")
        body = src[start:]
        self.assertNotIn("Atena", body)


if __name__ == "__main__":
    unittest.main()
