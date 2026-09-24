# CONTRACT — Twelve merge-blocker invariants (INV-12)

| Campo | Valor |
|-------|--------|
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **purpose** | Named contracts + CI tests that fail the build if an Ola 1 invariant regresses |
| **source** | `PASSES-6-10.md` anti-whack-a-mole · `PLAN-CERRAR-CICLO-REACTIVO.md` |
| **tip-of-spear** | Jev / Atena never grant; `authorize()` is CODE-only |

## Applicability (this repo)

| INV | Applies | Primary house | CI lock |
|-----|---------|---------------|---------|
| **INV-AUDIT-CHAIN** | yes (provenance + durable file) | `provenance.js` + durable seal in `index.js` | `provenance.test.mjs` + `effects-jsonl-seal.test.mjs` + `inv-12-contracts` |
| **INV-DENY-OBSERVED** | yes | `index.js` `deny()` → `denyCount` + `pushAudit` | `inv-12-contracts` |
| **INV-TTL-BOUNDED** | yes | `issueTaskGrant` / authorize | `ttl-bounded.test.mjs` |
| **INV-NO-WIDEN** | yes | sessionCaps ⊆ pin + pinRevision | `no-widen-sessioncaps.test.mjs` |
| **INV-ISOLATION-CLASS** | yes | table below + F1 UtilityProcess pilot | `inv-12-contracts` |
| **INV-SANDBOX-ENV-MIN** | **python only** | python-core sandbox runner | N/A here |
| **INV-GRANT-MAP-CAP** | yes | openGrants + mint rate | `grant-map-cap.test.mjs` |
| **INV-KILL-DRAINS** | yes | mediacion-pilot `ops.js` | `kill-drains.test.mjs` |
| **INV-DOWNGRADE-HITL** | yes | `plugin-upgrade-policy.mjs` + compatible_core | downgrade + compatible-core tests |
| **INV-BOOTSTRAP-SEAL** | yes | `admission.sealLiveAdmission` | admission-immutable + inv-12 |
| **INV-JEV-NEVER-GRANTS** | yes | no Jev/Atena in authorize/mint | F1 + ola1 tests + inv-12 |
| **INV-DURABLE-AUDIT-FAIL-CLOSED** | yes | durable `effects.jsonl` breaker | `durable-audit-fail-closed.test.mjs` |

## INV-ISOLATION-CLASS table (piloto + Ola 2.B market)

| Kind | Isolation | Owner |
|------|-----------|-------|
| face (renderer / FacePlugin) | in-process TCB | python-core faces; Desk UI |
| high-risk provider | subprocess sandbox | python-core Phase S |
| F1-pilot mediation cell | UtilityProcess / strangler-fork | `abaco-mediacion-pilot` |
| **market / Cordis community** | **≠ in-process** (utility-process or strangler-fork; else **fail-closed deny**) | `isolation-class.mjs`; lab flag `ABACO_LAB_ALLOW_INPROCESS_MARKET` only |

Market plugins must not default to same-process main. Call `admitMarketPluginLoad` / `gateAuthorizeIsolation` before load or authorize. Soft-PASS forbidden.


## Residual (GAP dated, not soft-PASS)

- **INV-AUDIT-CHAIN / durable file:** **CLOSED** by Ola 2 Bloque 2.A — on-disk `effects.jsonl` lines carry independent `prev_hash` + `hash`; `verifyDurable*` fail-closed. See `docs/frontier/OLA2-BLOQUE-A.md`. Mute path remains **INV-DURABLE-AUDIT-FAIL-CLOSED**.
- **Update feed digest pin / refuse-launch:** **CLOSED** (code gate) by Ola 2 Bloque 2.C.1 — `update-feed-digest-pin.mjs`; broker pins != binary stamp refuses launch/authorize. See `docs/frontier/OLA2-BLOQUE-C.md`.
- **Desk F7 / Apple notarize:** HOLD (GH artifact quota / creds) — dated GAP `docs/frontier/GAP-NOTARIZE-2026-09-23.md`. **NOT soft-PASS.** Outside INV-12 until F7 frees.

## Rules

1. Each applicable INV string must appear in product code (not only docs).
2. Desktop CI Contract step must run the ola1 INV test files listed in `.github/workflows/desktop-ci.yml`.
3. Soft-PASS forbidden; use PASS / FAIL / GAP dated.
