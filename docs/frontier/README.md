# Plugin Frontiers — índice docs

| Campo | Valor |
|-------|--------|
| **pack** | Plugin Frontiers (naming + G47 + research + Ola 1–3) |
| **fecha** | 2026-09-25 |
| **teatro** | ABACO DEEP HARNES ≤ v0.4.26 — tip-of-spear; Ola 1–3 CLOSED on main (`97c1943`) |
| **política** | Docs-only en este árbol salvo PRs de runtime explícitos |

## Empezar aquí

| Doc | Rol |
|-----|-----|
| **[`EVOLUTION-MAP-2026-09-25.md`](EVOLUTION-MAP-2026-09-25.md)** | **SSOT handoff** — what worked / what did not / HOLD / next rules (cold agent) |
| **[`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md)** | **PAPER unificado G47** — plugins vs tradicional + Jev pulse (síntesis A+B+C) |
| [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) | Defense frontier: isolation, SBOM/provenance/pin, kill switch. Complements the paper; does not restate S1–S8 |
| [`FRONTIER-PERMISSIONS-CAPABILITIES-2026.md`](FRONTIER-PERMISSIONS-CAPABILITIES-2026.md) | Frontier pública (caps, attestation, least-privilege) → refuerzos Bind/Janice. Complementa el paper; no lo reescribe. |
| [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) | Lock: Janice = runtime; Atena = advisory; Jev never grants; connectors HOLD |
| [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md) | Contratos F1 / F1.5 / F2.1 + Ola 1–3 — ley vs teatro |

## Ola 1–3 / GAPs (runtime closed on main)

Runtime Ola 1–3 is **CLOSED on `main`** (PRs #51–#58). GAPs below are dated HOLD — **NOT soft-PASS**.

| Doc | Rol |
|-----|-----|
| [`OLA1-BLOQUE1-DURABLE-AUDIT.md`](OLA1-BLOQUE1-DURABLE-AUDIT.md) | INV-DURABLE-AUDIT-FAIL-CLOSED (#51) |
| [`OLA1-BLOQUE2-TTL.md`](OLA1-BLOQUE2-TTL.md) | INV-TTL-BOUNDED (#52) |
| [`OLA1-BLOQUE3.md`](OLA1-BLOQUE3.md) | INV-NO-WIDEN / INV-DOWNGRADE-HITL / INV-GRANT-MAP-CAP (#53) |
| [`OLA2-BLOQUE-A.md`](OLA2-BLOQUE-A.md) | INV-AUDIT-CHAIN effects.jsonl prev_hash (#55) |
| [`OLA2-BLOQUE-B.md`](OLA2-BLOQUE-B.md) | INV-ISOLATION-CLASS market UtilityProcess or deny (#56) |
| [`OLA2-BLOQUE-C.md`](OLA2-BLOQUE-C.md) | Update-feed digest pin refuse-launch (#57) |
| [`OLA3-BLOQUE.md`](OLA3-BLOQUE.md) | D6 provenance stamp + pin/marketplace gates (#58) |
| [`GAP-NOTARIZE-2026-09-23.md`](GAP-NOTARIZE-2026-09-23.md) | Apple notarize / Desk F7 HOLD |
| [`GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md`](GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md) | Sigstore stamp-only HOLD |
| [`MARKETPLACE-OPEN-CHECKLIST.md`](MARKETPLACE-OPEN-CHECKLIST.md) | Go / no-go marketplace open |
| [`PIN-ROTATION-RELEASE-GATE.md`](PIN-ROTATION-RELEASE-GATE.md) | Pin rotation = release gate only |
| [`SWEET-SPOT-STRESS-C.md`](SWEET-SPOT-STRESS-C.md) | Digest pin + SBOM admission (#46) |

## G47 — Jev / Security Pulse

| Doc | Rol |
|-----|-----|
| [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) | Paper Leader (piloto Anthony 2026-09-22) |
| [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) | Feasibility PILOT — CODE-first; never grants |
| [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) | Compare: ROI Jev en host plugin vs monolito |
| [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) | Wire audit TypeSafe advanced (state, EntryType, fan-out, confidence, composite) vs `decide_tech.py`. Docs only. No pulse rewrite |
| [`JEV-EVERYDAY-FIVE-MODES-2026.md`](JEV-EVERYDAY-FIVE-MODES-2026.md) | Cinco modos de uso diario (fork, margen, potencial, PASS blando, cadencia). Receta Leader/Cloud/Desk/Deep/Python Core. Docs only. Jev rankea; no otorga |
| [`JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md`](JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md) | Sweet spot cotidiano: cuándo llamar, bandas encima de 0.55/0.5, márgenes, calibración, presupuesto de un día de Leader. Docs only. No authorize |
| [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md) | Cinco poderes cotidianos (ranker, márgenes, potentiabilities, honestidad, cadencia). Advise-only. Docs only. No reabre el pulse ni el wire |
| [`JEV-INCORPORACION-ESENCIAL-PLAN-2026.md`](JEV-INCORPORACION-ESENCIAL-PLAN-2026.md) | Plan Leader: incorporar Jev a lo esencial (E0–E4). Docs only. Jev never grants. Cruza FIVE-MODES / SWEET-SPOT (#48) / POTENTIALITIES (#49) |
| [`JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md`](JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md) | Procedimiento esencial ~30 s: CALL / modo / APPLY / journal. Docs only. Sin runtime |
| [`research/README.md`](research/README.md) | Serie research A / B / C (fuentes del paper) |

## Portable / Python Core

| Doc | Rol |
|-----|-----|
| [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) | Qué hereda el hub Python; Bind deny-by-default |
| [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md) | Clean architecture for plugin hosts (catalog, Bind, FacePlugin, sandbox). Docs only. **Not** G47 research C |

## Research drafts (fuentes — no reescribir desde el paper)

| Slot | Draft |
|------|-------|
| A | [`research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md`](research/01-TRADITIONAL-SOFTWARE-VULNERABILITIES.md) |
| B | [`research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md`](research/02-PLUGIN-VULN-TRADEOFFS-AND-WHY-BETTER.md) |
| C | [`research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md`](research/03-JEV-RULES-CLEANER-FRONTIERS-PULSE.md) |
