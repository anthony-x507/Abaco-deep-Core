# Ola 1 / Bloque 2 — Bounded task-grant TTL (item 2.2, deep half)

| Campo | Valor |
|-------|--------|
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **package** | `desktop/.../packages/abaco-effect-broker` |
| **closes** | Pass 7 / N12: broker `issueTaskGrant` accepted unbounded `ttlMs` (near-immortal grants) |
| **invariant** | **INV-TTL-BOUNDED** |
| **out of scope** | Python `expires_at` medium/high (python-core half of 2.2); Bloque 3 (`sessionCaps`, `MAX_OPEN_GRANTS`, market downgrade) |

## INV-TTL-BOUNDED

> No task grant is minted without a **finite, positive** `ttlMs`. Oversize values are **clamped** to `MAX_TASK_TTL_MS` (audit `grant.ttl_clamped`). Explicit **missing** (`null`) on medium/high effect sets and **immortal** inputs (`Infinity`, `≤0`, non-finite) are **rejected** at mint. `authorize()` denies any grant that is not TTL-bounded (`ttl-unbounded`) before spend. Advisors (Jev/Atena) never live in `authorize()` or mint.

### Behaviour

1. `MAX_TASK_TTL_MS` = 5 minutes (300_000). `DEFAULT_TASK_TTL_MS` = 60_000 when `ttlMs` is omitted (`undefined`).
2. Medium/high for this policy = any requested effect other than presentation-only `ui.slot` (empty list = medium/high, fail-closed).
3. `issueTaskGrant`:
   - `ttlMs === undefined` → default 60s (still bounded);
   - `ttlMs === null` + medium/high → throw `issueTaskGrant: ttl-missing`;
   - non-finite / `≤0` → throw `issueTaskGrant: ttl-immortal`;
   - `ttlMs > MAX_TASK_TTL_MS` → store `MAX_TASK_TTL_MS`, increment clamp counter, `pushAudit({ kind: 'grant.ttl_clamped' })`.
4. `authorize()` requires `isGrantTtlBounded(grant)` before allowing; else deny `ttl-unbounded`.
5. Auto-grant paths inside `authorize` always pass an explicit bounded `ttlMs` (60_000).
6. Operator surface: `getBrokerStats().ttl.clampCount` / `.maxTaskTtlMs`.

### Tests

- `packages/abaco-effect-broker/tests/ttl-bounded.test.mjs`
  - reject missing (`null`) on medium/high
  - reject immortal (`Infinity`, `0`)
  - clamp upper bound + audit
  - authorize denies unbound grant
  - no advisor symbols in `authorize` / mint helpers

### Related

- Plan: `PLAN-CERRAR-CICLO-REACTIVO.md` Ola 1 Bloque 2 §2.2
- Finding: `PASSES-6-10.md` Pass 7 #3 / N12 / invariant #3
- Sibling: Python enable `expires_at` (same INV, other repo)
