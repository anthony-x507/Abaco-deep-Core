# Ola 2 / Bloque 2.B — Isolation market / faces (INV-ISOLATION-CLASS)

| Campo | Valor |
|-------|--------|
| **repos** | `anthony-x507/Abaco-deep-Core` (+ python-core Face execute) |
| **closes** | PASSES MED Cordis market in-process; FacePlugin TCB notes |
| **invariant** | **INV-ISOLATION-CLASS** |
| **out of scope** | `effects.jsonl` / durable audit append (carril A); MANIFEST_CAPS / digest+SBOM / Bind weaken; Cloud Agents |

## 2.B.1 Market / Cordis — UtilityProcess or fail-closed deny

> Market plugins must **not** default to same-process main. Prefer UtilityProcess
> (or the F1 strangler-fork cell). Otherwise **deny**.

### Behaviour (deep)

1. `isolation-class.mjs` freezes the INV-ISOLATION-CLASS table with an explicit
   **market** row: default isolation `deny` (not in-process).
2. Allowed market classes: `utility-process`, `strangler-fork` (F1 pilot path).
3. `admitMarketPluginLoad` / `assertMarketIsolation` — load-time gate.
4. `gateAuthorizeIsolation` — wired at the start of `authorize()` when
   `origin` / `channel.origin` / `channel.market` marks market.
5. Lab-only escape: `ABACO_LAB_ALLOW_INPROCESS_MARKET=1` (never implied by Jev/Atena).
6. F1 mediacion-pilot path kept; CELL.md documents market reuse of strangler-fork.

### Tests

- `packages/abaco-effect-broker/tests/isolation-class.test.mjs`
- Extended `inv-12-contracts.test.mjs` market row assertions
- Desktop CI Contract step includes the isolation-class test

## 2.B.2 FacePlugin execute — digest pin + no ambient FS/net

Owned primarily by **python-core** (FacePlugin host). Deep documents the TCB
row: faces remain in-process TCB with digest seal on execute and no ambient
FS/net capabilities in the call context. Prefer UtilityProcess/WASI cell where
already stubbed (future); do not widen `should_run_in_subprocess` fail-open.

## 2.B.3 CI — market ≠ in-process unless lab flag

Contract table + product markers + behavioural tests fail the build if market
is reintroduced as in-process default without the lab flag.

## Doctrine

- Tip-of-spear; Jev never grants.
- Prefer fail-closed over soft widen.
- Do not touch effects.jsonl (carril A).
- Do not weaken MANIFEST_CAPS / digest+SBOM / Bind gates from Ola 1.
