# Ola 2 / Bloque 2.A — Audit file seal (`effects.jsonl`)

| Campo | Valor |
|-------|--------|
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **package** | `desktop/.../packages/abaco-effect-broker` |
| **closes** | V1 GAP 2026-09-23 — on-disk `effects.jsonl` lacked independent `prev_hash` |
| **invariant** | **INV-AUDIT-CHAIN** (durable file parity with in-memory provenance) |
| **preserves** | **INV-DURABLE-AUDIT-FAIL-CLOSED** (mute → authorize breaker unchanged; tip-of-spear UI) |
| **out of scope** | Bloque 2.B UtilityProcess/market · Desk F7 HOLD · Ola 3 supply-chain |

## Behaviour

1. Every durable JSONL line is a sealed record: `{ seq, entry, prev_hash, hash }`.
2. `hash = sha256(canonicalize({ seq, entry, prev_hash }))` — same digest helper as `provenance.audit`.
3. Genesis tip = `GENESIS` / `DURABLE_GENESIS`. Chain links: line N `prev_hash` = line N-1 `hash`.
4. `verifyDurableLine` / `verifyDurableChain` / `verifyDurableEffectsFile` / `verifyDurableEffectsOnDisk` are **fail-closed** (tamper / bad JSON / broken link → `false`).
5. On append, if an existing file fails verify → throw `durable-effects-chain-invalid` → counted as durable failure → existing authorize `audit-unavailable` breaker (no empty catch).
6. In-memory `auditLog` + provenance hash-chain unchanged. Advisors never enter `authorize()`.

## Tests / CI

- `packages/abaco-effect-broker/tests/effects-jsonl-seal.test.mjs`
- Still green: `durable-audit-fail-closed.test.mjs`, `provenance.test.mjs`, `inv-12-contracts.test.mjs`
- Desktop CI Contract step lists `effects-jsonl-seal.test.mjs`

## Related

- Plan: Ola 2 Bloque 2.A (PLAN-CERRAR-CICLO-REACTIVO)
- V1: VERIFICACION-V1.md GAP effects.jsonl
- Prior: `OLA1-BLOQUE1-DURABLE-AUDIT.md` (INV-DURABLE-AUDIT-FAIL-CLOSED)
