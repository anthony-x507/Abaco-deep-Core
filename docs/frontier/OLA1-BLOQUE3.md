# Ola 1 / Bloque 3 — Evolution / pressure (deep half)

| Campo | Valor |
|-------|--------|
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **packages** | `abaco-effect-broker`, `abaco-mediacion-pilot`, `src/main/state/plugin-upgrade*` |
| **closes** | Pass 4 P4-3 sessionCaps widen; Pass 9 N6 market downgrade; Pass 10 N7 grant-map; deep runner drain (N8 deep path) |
| **invariants** | **INV-NO-WIDEN** · **INV-DOWNGRADE-HITL** · **INV-GRANT-MAP-CAP** · **INV-KILL-DRAINS** (deep) |
| **out of scope** | Desk F7; Bloque 1/2 redo; Python Bind `compatible_core` / sandbox `runner.py` wait-before-drain (python-core residual) |

## 3.1 INV-NO-WIDEN — `sessionCaps ⊆` pin

> Attenuation / evolution may only keep effective caps within the pinned manifest unless **HITL + `pinRevision`**. Digest change clears session overlays. Advisors never grant.

### Behaviour

1. `sessionCapsSubsetOfPin(pluginId, effects, resources)` — every requested effect/resource must already be in `MANIFEST_CAPS`.
2. `proposeContractEvolution` marks `widen: true` when the proposal is not ⊆ pin.
3. `acceptContractEvolution`:
   - always requires `hitl === true`;
   - if widen and `pinRevision !== true` → deny `caps-widen-requires-pin-revision` + audit `contract.widen_denied`;
   - if widen and HITL + `pinRevision` → apply session overlay, set `pin_revision`, audit `contract.pin_revision` (still no `patch.yml` / import-time pin mutation).
4. `clearSessionCapsForDigestChange(pluginId)` clears overlays + pending proposals (INV: digest change clears session overlays).

### Tests

- `packages/abaco-effect-broker/tests/no-widen-sessioncaps.test.mjs`
- Updated doctrine path in `f1-mediacion-closeout.test.mjs` (HITL alone insufficient to widen)

---

## 3.2 INV-DOWNGRADE-HITL — market downgrade + compatible_core policy

> `targetVersion < current` requires explicit grant (`allowDowngrade === true`). Empty `compatible_core` denies medium/high (portable predicate).

### Behaviour (deep)

1. `assertUpgradeDirection` in `plugin-upgrade-policy.mjs`:
   - missing `currentVersion` → fresh install (allow);
   - `compareSemver(target, current) < 0` without `allowDowngrade === true` → deny `downgrade-requires-explicit-grant`.
2. `upgradePluginToGeneration` refuses before install I/O when direction fails.
3. Recovery / safe-mode call sites pass `currentVersion` + `allowDowngrade: false`.
4. `compatible-core-policy.mjs`: medium/high (any effect beyond `ui.slot`-only; empty list = medium/high) requires non-empty `compatible_core` string. Empty/missing → `{ ok: false, reason: 'compatible-core-empty' }`.

### Residuals (python half)

- Runtime Bind empty `compatible_core` → allow (`sandbox/versions.py`) — **python-core** must deny for medium/high.
- Provider sandbox `runner.py` wait-before-drain — **python-core** INV-KILL-DRAINS.

### Tests

- `src/main/state/tests/plugin-upgrade-downgrade.test.mjs`
- `packages/abaco-effect-broker/tests/compatible-core-policy.test.mjs`

---

## 3.3 INV-GRANT-MAP-CAP + INV-KILL-DRAINS (deep)

> `openGrants ≤ MAX_OPEN_GRANTS`; mint rate ≤ `MAX_MINT_RATE_PER_SEC` per plugin identity; excess → throw + audit. Runner drains pipes concurrently before wait/close.

### Behaviour

1. Defaults: `MAX_OPEN_GRANTS = 64`, `MAX_MINT_RATE_PER_SEC = 8`.
2. `issueTaskGrant` checks open-cap then per-plugin 1s mint window; audits `grant.map_cap` / `grant.mint_rate`.
3. Operator surface: `getBrokerStats().grantMap`.
4. Tests may call `setGrantMapLimitsForTests(openMax, ratePerSec)` (reset restores defaults).
5. Deep runner path (`abaco-mediacion-pilot/ops.js`): concurrent stdout/stderr readers before `close`; `MAX_CHILD_OUTPUT_BYTES` cap; no `wait`-before-drain.

### Tests

- `packages/abaco-effect-broker/tests/grant-map-cap.test.mjs`
- `packages/abaco-mediacion-pilot/tests/kill-drains.test.mjs`

---

## Doctrine

- Tip-of-spear: no fleet freeze; session overlays only; Jev/Atena never in `authorize` / mint / upgrade grant.
- Artifact pin rotation for `ops.js` change: `PINNED_ARTIFACT['abaco-mediacion-pilot']` + SBOM hashes (review-visible TCB).

### Related

- Plan: `PLAN-CERRAR-CICLO-REACTIVO.md` Ola 1 Bloque 3
- Findings: `PASSES-1-5.md` P4-3; `PASSES-6-10.md` N6/N7/N8/N14; invariants #4, #7, #8, #9
