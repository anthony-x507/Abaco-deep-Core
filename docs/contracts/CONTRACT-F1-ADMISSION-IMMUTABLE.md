# CONTRACT F1 — admission immutable (control-3)

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-17 |
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **padre** | F1 P3 pinned manifests (PR #6) · `CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP` (local box; reconstructed here) · Pack B control-2 cell |
| **estado** | control-3 gate — session admission graph is sealed |

## Meta

The host session admission graph is **immutable** after seal. Only the control plane (pinned `manifest.f1.yml`, existing `patch.yml` insert rows, existing Electron preload keys) may contribute nodes. Skills, docs, memory, and tool-results **must not** enter the graph, activate preload, or add `patch.yml` rows.

P3 pins (`PINNED_MANIFEST_DIGEST` + frozen `MANIFEST_CAPS`) stay the integrity TCB. Control-3 adds the **session graph** and a deny-by-default mutation API. `authorize()` remains the only path to protected sinks.

## In / out

| In | Out |
|----|-----|
| Sealed admission graph (`admission.js`) | New preload channel |
| Deny runtime mutation (even from `host`) | New `patch.yml` insert rows |
| Fail-closed on tampered / unparseable / id-mismatched manifests | Rehab of brand/onboarding/sync/device/experimental |
| Non-control sources cannot enter the graph | Fake Electron `utilityProcess` |
| Atena never grants; Janice = runtime | Version bump / Release |
| Tests G1–G7 + broker/freeze/naming/plugin/compact/cell | Touch `~/Library/Application Support/dsh-desktop/` |

## Host session rules

1. **Deny-by-default.** Unknown source, unknown action, missing identity → deny, `side_effect: false`.
2. **Protected effects** still call `authorize()` **before** spawn / IPC / fetch (F1 + Pack B + Pack C unchanged).
3. **Atena NEVER grants.** `source: 'atena'` → `atena-cannot-grant`. Atena is not in `authorize()`.
4. **Janice = runtime only.** Executor cell / plugins; never a grantor of admission.
5. **Skills / docs / memory / tool-results** are non-control. They cannot contribute nodes, cannot widen caps, cannot activate preload, cannot add `patch.yml` rows.
6. **Pin rotation** is a code-review change to broker source (`sign-manifest.mjs` → `PINNED_MANIFEST_DIGEST`). It is not a runtime API.

## Gates

| # | Gate | PASS when |
|---|------|-----------|
| G1 | Control-plane seal | Live graph `sealed && ok`; admitted = `{abaco-voice, abaco-mediacion-pilot}`; pins match canonical manifests; non-control contributors / forbidden read paths → empty graph |
| G2 | Skills | `skill` / `skills` propose `enter-graph` / `add-plugin` / `widen-caps` / preload / patch.yml → deny `source-not-control`; graph bytes unchanged |
| G3 | Docs | `docs` same deny; 0 mutation |
| G4 | Memory | `memory` same deny; Pack A quarantine not weakened |
| G5 | Tool-results | `tool-results` same deny |
| G6 | Preload + patch.yml | `activate-preload` → `preload-activation-forbidden`; `add-patch-yml-row` → `patch-yml-immutable`; vite preload keys stay the sealed trio; live `patch.yml` digest matches the graph snapshot |
| G7 | Fail-closed | Tampered manifest → digest/id/parse fail; missing identity / unknown action / unknown source → deny; live propose audits deny; 0 side-effect |
| G-broker | Host rules | Non-control channels → `authorize` deny `no-identity`; voice status happy path still allow |
| G-freeze | T-A-4 | `MANIFEST_CAPS` and graph arrays throw `TypeError` on push |
| G-naming | Janice / Atena | Janice = runtime; Atena cannot grant; `authorize()` body has no `Atena` |
| G-plugin | Plugin-safe | Disabled set intact; no rehab insert after `TEMPORARILY DISABLED` |
| G-compact | Compact lock | `0.90 / 0.12 / 8192` |
| G-cell | Pack B honesty | `CELL_KIND` remains `strangler-fork` |

## Naming

- **Janice** = plugin runtime (executor).
- **Atena** = advisor. Never in `authorize()`, never a grantor of admission.
