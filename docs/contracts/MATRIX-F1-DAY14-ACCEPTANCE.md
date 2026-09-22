# MATRIX F1 day-14 — mediación demostrable

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-22 |
| **repo / tip** | `anthony-x507/Abaco-deep-Core` `main` `93c5f19` (v0.4.25, after logo #30) + this docs+test PR |
| **contrato** | `CONTRACT-F1-MEDIACION-DEEP.md` (2026-09-11) |
| **alcance** | Parallel track to the broker closeout agent. **No broker re-implementation.** Tests lock current `authorize()` / Janice cell behavior. Closeout PR #5 is closed; product broker already landed via F2/#6 + F1/#15 + F1.5/#16–#17 + F2.1/#7–#9. |
| **cómo correr** | `node reports/run-f1-day14-suite.mjs` from repo root (after `npm ci` in `desktop/src/dsh-desktop`). CI: `.github/workflows/desktop-ci.yml` (`npm test` + `node --test` contract list). |

Verdicts are **PASS / PARTIAL / FAIL / N-A** on the product tip. Evidence paths are repo-relative.

## Entregable día 14

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| E1 | Recorrido TS (Janice / desktop) | **PASS** | `desktop/src/dsh-desktop/test/abaco-f1-mediacion-broker.test.ts` (M1–M10 subset) · `desktop/src/dsh-desktop/test/abaco-f1-day14-acceptance.test.ts` (D14-1…D14-6) |
| E2 | Espejo Python del **mismo** efecto | **N-A** | F1-mediated STT is the TS voice route + broker + strangler cell. `core/voice/` is a separate FastAPI/whisper-cli path and does not call `authorize()`. Locked by `packages/abaco-effect-broker/tests/f1-day14-fail-closed.test.mjs` **D14-P**. |
| E3 | Suite fail-closed: denegó · 0 side-effect · audit · contador | **PASS** | Historical `assertDenyFour` in `test/abaco-f1-mediacion-broker.test.ts` · **D14-Q** + **D14-A\*** in `packages/abaco-effect-broker/tests/f1-day14-fail-closed.test.mjs` |
| E4 | Plugin piloto retirable sin reiniciar el núcleo | **PASS** (in-process) | `packages/abaco-effect-broker/tests/f1-day14-retire-contain.test.mjs` **D14-T1**: revoke → 0 fork → same `process.pid` → voice `authorize` still allow. Live Cordis disable in the packaged app is **LIVE smoke L3**. |
| E5 | Face / uso mínimo sin añadir autoridad al TCB | **PASS** | **D14-T2/T3** + vitest **D14-4**: piloto has no `client.js`, `apply()` registers 0 fetch routes, no `issueTaskGrant`, no `utilityProcess.fork`. Voice remains route owner. |

## Criterios de aceptación (Astra adaptados)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| A1 | Mediación: 0 efectos no autorizados en suite adversarial del alcance | **PASS** | Intersection `A_efectiva = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política`: **D14-A1…A8** (plugin / task / resource / forged grant / data≠control / compose.mutate / budget / TTL) + historical M1/M2/M5/M6/M7/M8 + F2 `f2-integration.test.mjs` unknown/disabled/breaker |
| A1b | Doctrine delta: admitted plugins still evolve / ship after denies | **PASS** | Unauthorized deny does not freeze voice. New grant after revoke still allows. Runtime widen is explicit `proposeContractEvolution` + HITL accept (session overlay; pins frozen; no rehab). Pin rotation stays review-time (`scripts/sign-manifest.mjs`). **D14-E1…E3**, vitest **D14-7**, closeout doctrine tests, admission **G7.4** |
| A2 | Contención: crash / block / OOM del worker no reinicia el core | **PASS** (cell) / **PARTIAL** (Electron) | Crash **D14-K1** + Pack B `utility-cell.test.mjs` **B4**. Hang/timeout **D14-K2** / **B5**. OOM-killer simulation (worker `SIGKILL`, no CI heap exhaust) **D14-K3**. Host here is the Node test process. Packaged Electron host survival is **LIVE smoke L4**. |
| A3 | Revocación: nuevas ops deny ≤1s (piloto local) | **PASS** | **D14-R** + vitest **D14-2**: `revokeGrant` then next `authorize` / `executeAuthorized` deny in ≤1000ms (sync). UI-visible revoke in the installed app is **LIVE smoke L5**. |
| A4 | Compact Deep **0.90 / 0.12** (and 8192) intact | **PASS** | `packages/abaco-context/presets/abaco/agent.cordis.yml` compaction-basic row. Locked by **D14-3**, Pack B **B10**, admission **G-compact**, STT **G5**, schema-pin **G9**. |
| A5 | Nunca tocar `~/Library/Application Support/dsh-desktop/` | **PASS** (source + decoy) | Broker audit dir is `$DSH_HOME\|$HOME/abaco-deep-core-audit-f1` (`packages/abaco-effect-broker/index.js`). userData is `abaco-deep-core` (`src/main/index.ts`). **D14-S** + vitest **D14-5**. Live Mac profile check is **LIVE smoke L1**. |

## Candados (standing order)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| C1 | Atena ≠ authorize (asesor, cero en hot-path) | **PASS** | `ADMISSION_ROLES.atena = advisor-never-grants`. `authorize()` body has no `Atena` / `atenaAdvise`. **D14-C**, admission **G-naming**, schema-pin **G8**, Pack B **B12**. |
| C2 | Janice = runtime | **PASS** | `ADMISSION_ROLES.janice = runtime`. Piloto is executor cell only (`manifest.f1.yml` inject `[]`, no grants). **D14-C**, **D14-T3**, historical “pilot is executor not grantor”. |
| C3 | No rehab of disabled plugins | **PASS** | `DISABLED_PLUGINS` = brand / device-identity / cloud-sync / onboarding / experimental. Patch after `TEMPORARILY DISABLED` has no brand insert. **D14-C**, **D14-6**, **B11**, **G-plugin**. |
| C4 | No `dsh-desktop` profile writes | **PASS** | Same as **A5**. |
| C5 | Doctrine delta: unauthorized blocked **and** admitted plugins still evolve/ship | **PASS** (automated) | Deny of brand/untrusted does not freeze voice. After revoke, a **new** grant on `abaco-voice` still allows. Pin rotation is review-time (`scripts/sign-manifest.mjs`), not a runtime lockout API. **D14-E1…E3**, vitest **D14-7**, admission **G7.4** (note-only edit keeps digest). Live ship (DMG / Update) is **LIVE smoke L2/L6**. |

## Controles 1–3 (already on main — regression lock)

| # | Control | Verdict | Evidence |
|---|---------|---------|----------|
| K1 | Broker de efectos + grants por tarea | **PASS** | `packages/abaco-effect-broker/index.js` · historical F1 12 tests · day-14 A/R suites |
| K2 | Ejecución aislada y supervisada (strangler-fork, honest) | **PASS** | `CELL_KIND = strangler-fork` · `packages/abaco-mediacion-pilot/CELL.md` · `utility-cell.test.mjs` B0–B13 · day-14 K/T |
| K3 | Admisión inmutable + datos≠control | **PASS** | `packages/abaco-effect-broker/tests/admission-immutable.test.mjs` G1–G7 + G-\* · F1.5 schema pin + memory packager (CI) |

## CI wiring (this PR)

| Suite | Where it runs |
|-------|----------------|
| Vitest F1 histórica + day-14 recorrido | `npm test` → `test/abaco-f1-*.test.ts` |
| Day-14 fail-closed / stay-out / Python N-A | `node --test packages/abaco-effect-broker/tests/f1-day14-fail-closed.test.mjs` |
| Day-14 retire + crash/hang/OOM sim | `node --test packages/abaco-effect-broker/tests/f1-day14-retire-contain.test.mjs` |
| F2-W5 threat-model (was in local runner, missing from root CI) | `node --test packages/abaco-memory/tests/threat-model.test.mjs` |
| Prior F1 / F1.5 / F2.1 contracts | unchanged rows in `.github/workflows/desktop-ci.yml` |

## LIVE smoke — Anthony / Leader, Mac only (cannot fake)

These require the **installed** `ABACO DEEP HARNES.app` (v0.4.24 or this PR’s later bump). Cloud CI has no Electron GUI, no TCC mic, no `~/Library/Application Support`.

1. **L1 userData stay-out.** After Update / DMG install, confirm the live profile is `~/Library/Application Support/abaco-deep-core/` (and `…/harness`). `~/Library/Application Support/dsh-desktop/` must not be created or written by this app. Do not delete either folder from CI/agent.
2. **L2 mediated mic.** In a real session, tap mic → local Whisper. Status JSON must show `mediated: true`. Transcribe must call `authorize()` before any child; deny → 403 + fail-closed hint, **no** silent OpenAI.
3. **L3 retire piloto without core restart.** Disable / unload `abaco-mediacion-pilot` from the live profile (or revoke the live grant) **without** quitting the app. Next transcribe must deny / fail-closed; chat / compact / other plugins stay up.
4. **L4 worker death in the packaged host.** Force the strangler worker to crash or hang mid-transcribe (or starve it). The Electron window must stay up; next unauthorized op still denies. Real process-wide OOM of Electron itself is outside the cell contract.
5. **L5 revoke ≤1s in UI.** After a live grant, revoke (or let TTL lapse). The next mic/transcribe in the same session must fail closed in ≤1s wall time.
6. **L6 compact + disabled set.** Long session still compacts at 0.90 / 0.12. Brand / onboarding / cloud-sync / device-identity / experimental stay out of the live insert list.

Done ≠ commits. Leader live smoke on the installed app is still the product gate.

## Fuera de F1 (not scored)

Wasm masivo, CAPMAS hops, Atena in hot-path, third-party MCP schemas, “cierra-teatro” global, PQC, inmune/10× marketing, notarize, fake `utilityProcess`.
