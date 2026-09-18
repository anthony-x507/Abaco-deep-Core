# AUDIT E2E 0.4.22 — Agent B (independent)

**Auditor:** Agent B (independent; no coordination with Agent A)  
**Repo:** `anthony-x507/Abaco-deep-Core`  
**Tip audited:** `main` / `v0.4.22` = `b4fb3d80ea62991101411598de8068aa4d1458f4` (Merge PR #20)  
**Product under test:** Mac desktop **ABACO DEEP HARNES** (Electron), Bundle ID `io.abaco.deepcore`  
**Date:** 2026-09-18  
**Method:** read-only investigation of git, GitHub, packaging manifests, boot path, plugin contracts, and in-repo tests. No Release packaging, no notarize, no merge to main.  
**Tests executed this audit:** `node --test` on admission / schema-pin / STT-mac / utility-cell / quarantine / packager / cascade / tiers → **129 pass / 0 fail**.

This report is evidence-first. Line citations are from this checkout unless noted as GitHub API / release assets.

---

## Scorecard

| Area | Verdict | One-line reason |
|------|---------|-----------------|
| **Repo health** | **FAIL** | No GitHub Actions at repo root; `gh run list` is empty. Nested `desktop/src/dsh-desktop/.github/workflows/release.yml` cannot run. Root docs still teach a different product. |
| **Launch / boot** | **WARN** | Identity + userData + patch inserts look coherent. Host-plane Cordis `apply` still fails the *whole tree* (Safe Mode). Disabled plugins remain landmines if re-inserted. |
| **Plugins** | **WARN** | Five plugins stay out of `patch.yml` (good). They still ship in `package.json` + `@deepseek-ai/dsh` patch with `apply()` that assigns `ctx.*` without `provide`. `PATCH_ENABLED` lags live inserts. |
| **Packaging** | **WARN** | 0.4.22 GitHub assets match `package.json` `0.4.22`. Schema pin is now a root `file:` dep (the 0.4.21 `MODULE_NOT_FOUND` is addressed in source). No CI gate; pin presence in the published `.app` is not proven here. |
| **Updater** | **WARN** | `electron-updater` + GitHub provider + same `appId` is the intended replace-in-place path. Missing `versions.json`; root unsigned pipeline uses a different artifact name. `mac.notarize: false` in the product config while the release claims notarized. |
| **Dead code** | **FAIL** | Parallel unused Python `core/` + `sync/`, orphan `desktop/features/*`, nested CI, unsigned `build/` scripts looking for `ABACO Deep Core.app`, unused `threat-model.js` module, localized DSH READMEs. |
| **Philosophy** | **WARN** | Plugin-first + disabled-stay-disabled + Atena-never-grants are *mostly* encoded. Advisory cascade (`janiceAdvise`) **does sit on the `authorize()` allow-path**. Janice/Atena names are swapped in `cascade.js`. One failed host plugin still kills core. |

**Overall:** the **shipped Electron product** at 0.4.22 is much closer to ABACO DEEP HARNES than the 2026-09-09 audit claimed, but the **repository as a whole still presents two products**, and several contracts are enforced by comments/tests rather than by isolation in the loader.

---

## 1. Repo health

### Default branch tip

| Fact | Evidence |
|------|----------|
| Default branch | `main` |
| Tip SHA | `b4fb3d80ea62991101411598de8068aa4d1458f4` |
| Tip message | `Merge pull request #20 from anthony-x507/chore/release-0.4.22` |
| `package.json` version | `0.4.22` (`desktop/src/dsh-desktop/package.json:2`) |
| `appId` / `productName` | `io.abaco.deepcore` / `ABACO DEEP HARNES` (`package.json:323-324`) |
| Git tag `v0.4.22` | points at the same SHA (GitHub `git/refs/tags/v0.4.22`) |
| Open PRs | **none** |
| Open issues | **none** |

### CI on main — FAIL

- There is **no** `/workspace/.github/` directory. GitHub Actions only loads workflows from the repository root.
- The only workflows live at `desktop/src/dsh-desktop/.github/workflows/release.yml` and `backfill-archive.yml` (upstream DSH layout). Those files cannot fire on this repo.
- `gh run list --branch main` and `gh run list` returned **zero runs**.
- Consequence: PRs #15–#20 merged with **no GitHub CI**. Packaging, typecheck, and `npm test` are honor-system / local.

### Latest Release vs `package.json`

GitHub Latest = `v0.4.22 — packaging pin + notarized` (published 2026-09-18T01:58:11Z).

| Asset | Present on v0.4.22 | Present on v0.4.21 |
|-------|--------------------|--------------------|
| `abaco-deep-harnes-mac-arm64.dmg` | yes (207,393,799 B) | yes |
| `abaco-deep-harnes-mac-arm64.zip` | yes (254,954,951 B) | yes (240,962,474 B) |
| `latest-mac.yml` | yes, `version: 0.4.22` | yes |
| `*.blockmap` | **no** | yes (dmg + zip) |
| `versions.json` | **no** (302 → 404) | not checked as Latest then |

`latest-mac.yml` for 0.4.22:

```yaml
version: 0.4.22
path: abaco-deep-harnes-mac-arm64.zip
# files: zip + dmg with sha512/size; no blockmap entries
```

Version **matches** `package.json`. Artifact **name** matches `artifactName` `abaco-deep-harnes-${os}-${arch}.${ext}` (`package.json:400`). Missing Intel / Windows assets (arm64-only Latest) is a product-scope choice, not a version drift.

### Docs / script drift — FAIL for identity at repo root

Root README, INSTALL, STATUS, and `build/verify-build.sh` still teach **ABACO Deep Core**, Python `entry_points`, Tailscale mesh, unsigned zip, and `/Applications/ABACO Deep Core.app`:

- `README.md:1,15-17,47` — “ABACO Deep Core”, Whisper.cpp + `say`, `xattr` on `ABACO Deep Core.app`
- `docs/INSTALL.md:12,16-17,39` — zip name `abaco-deep-core-mac-arm64-0.1.0.zip`, app `ABACO Deep Core.app`, “app not signed”
- `STATUS.md:5,84-85` — last updated 2026-09-08; “App sin firma hasta que llegue Apple Developer”
- `build/verify-build.sh:21-22,40` — `APP_DISPLAY_NAME="ABACO Deep Core"` and glob `abaco-deep-core-mac-*.zip` (will miss real `abaco-deep-harnes-mac-arm64.zip`)
- `build/electron-builder.dev.cjs:36` — `artifactName: 'abaco-deep-core-${os}-${arch}-${version}.${ext}'` vs production `abaco-deep-harnes-…`
- `pyproject.toml:2-4` — `abaco-deep-core` `0.1.0`, FastAPI/Tailscale product

Localized Electron READMEs still brand **DSH Desktop / DeepSeek Harness**: `desktop/src/dsh-desktop/README.es.md:1-25`, `README.zh.md:1-24` (English `README.md` was updated).

`mac.notarize` is **`false`** in the product electron-builder config (`package.json:417`) while the GitHub release body says “Developer ID signed + Apple notarized”. Nested workflow *would* notarize if it ran. Root `build/electron-builder.dev.cjs` still talks as if Developer ID has not arrived (`:4-12`) and also sets `notarize: true` (`:136`) — three contradictory notarize stories.

---

## 2. Launch / boot path (main → preload → renderer → plugins)

### Trace (what the code actually does)

1. **Main identity (before lock / `whenReady`)**  
   `configureAppIdentity()` (`src/main/index.ts:555-572, 3255`):  
   - prod: `app.setName('ABACO DEEP HARNES')`  
   - `userData` = `~/Library/Application Support/abaco-deep-core` (literal, **not** derived from name, **not** `dsh-desktop`)  
   - dev: `abaco-deep-core-dev`  
   Single-instance lock follows (`:3259`). Daemon LaunchAgent launches `app.exit(0)` (`:3248-3253`).

2. **`bootstrap()`** (`index.ts:2975-3027`)  
   launch-root → tray → splash window → `HarnessRuntime` with `dsh-desktop.patch.yml` / safe patch as extraResources → `utilityProcess` on darwin (`launchDisclaimedUtilityProcess`) → loopback `AbacoBrowserRpcServer` (bind failure does not kill the app).

3. **Preload** (`electron.vite.config.ts:21-65`, `src/preload/index.ts`)  
   Isolated CJS entries (`index`, `windows-menu`, `abaco-browser-chrome`) to avoid sandboxed `require("./chunks/…")`.  
   Bridges: `dshDesktopDirectoryPicker` (`preload/index.ts:175-177`), `dshAbacoBrowser` (`:189+`), updater, recovery. Boot-failure observer queues `harness:open-recovery` (`:115-136`).

4. **Harness child / plugin load**  
   Profile composition from `build/dsh-desktop.patch.yml` (copied to extraResources). Cordis loader. ABACO rows are `insert:` after stock UI. Failed **host-plane** `apply` is documented as a **full tree failure** (Safe Mode / Startup recovery), not a skipped plugin (`abaco-observability/index.js:62-72`, `abaco-memory/index.js:190-193`).

5. **Renderer / composer**  
   Stock DSH UI + client plugins (`abaco-voice/client.js`, `abaco-documents`, `abaco-theme`, …). Voice injects mic on `conversation.input.right` (`client.js:1836-1842`) and avoids Cordis proxy on `window` because `.store` / `.inputActions` throws `without inject` (`:1828-1833`).

### Launch verdict: WARN (not FAIL)

Cold start **can** reach composer if packaging includes the schema pin and no host plugin throws Invalid effect / without inject. That is a real improvement vs 0.4.21 (`CHANGELOG.md:13`). Remaining launch risks:

| Risk | Evidence | Severity |
|------|----------|----------|
| Host plugin throw → whole tree / Safe Mode | `abaco-observability/index.js:62-72`; Cordis `Invalid effect` | High |
| Disabled plugins re-inserted → `ctx.abacoBrand = …` without provide | `abaco-brand/index.js:15-16`; patch comment `:177-184` | High if rehab |
| `abaco-mcp-schema-pin` missing from `.app` | 0.4.21 `MODULE_NOT_FOUND`; 0.4.22 source has root dep; **binary not unpacked here** | High if regression |
| Preload relative require | mitigated by `isolatedEntries: true` (`electron.vite.config.ts:46`) | Low if tests stay green |
| GPU / renderer gone → recovery / relaunch | `index.ts:420-442` | Operational, designed |

This environment is Linux; the Mac `.app` was **not** launched. Launch PASS/FAIL for “composer usable on a notarized Mac” is therefore **not machine-verified**. Source + 0.4.22 changelog + pin tests support “packaging is *intended* to be correct.”

---

## 3. Plugins

### Enabled in `build/dsh-desktop.patch.yml` (insert rows)

`dsh-desktop-client-ui`, `dsh-desktop-market-installer`, `dsh-ppt-composer`, `dsh-desktop-hmr-fallback`, `dsh-desktop-preset-transfer`, `abaco-theme`, `abaco-voice`, `abaco-mediacion-pilot`, `abaco-documents`, `abaco-agent-status`, `abaco-browser`, `abaco-memory`, `abaco-vault`, `abaco-observability`, `abaco-analytics`, `abaco-context`.

Disabled **by omission** (comment only, not `disabled: true` rows): `abaco-brand`, `abaco-device-identity`, `abaco-cloud-sync`, `abaco-onboarding`, `abaco-experimental` (`patch.yml:177-184`). Tests lock this: `admission-immutable.test.mjs` G-plugin; `utility-cell.test.mjs` B11.

### Disabled plugins still in the binary — WARN

They remain:

- root `file:` dependencies (`package.json:279-295`)
- injected into `@deepseek-ai/dsh` via `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` (so profile `node_modules` can resolve them)
- with **unsafe** host `apply()`:

```15:16:desktop/src/dsh-desktop/packages/abaco-brand/index.js
export function apply(ctx) {
  ctx.abacoBrand = BRAND
```

```6:7:desktop/src/dsh-desktop/packages/abaco-cloud-sync/index.js
export function apply(ctx) {
  ctx.abacoSync = {
```

```14:48:desktop/src/dsh-desktop/packages/abaco-device-identity/index.js
  const store = ctx.get?.('secureStore') || ctx['secureStore']
  // ...
  ctx.abacoDevice = identity
```

Cordis rejects undeclared get/set (`without inject` / `without provide`) and that is exactly why they were pulled from the patch. **They are not loaded today.** If anyone “fixes boot” by adding `insert:` rows, they will kill Startup again. Comment says “TEMPORARILY DISABLED” (`patch.yml:177`) — that wording invites rehab, which the broker set `DISABLED_PLUGINS` (`index.js:110-116`) treats as FAIL.

Broker `PATCH_ENABLED` (`index.js:132-141`) does **not** include `abaco-vault`, `abaco-observability`, `abaco-analytics`, `abaco-context` even though they **are** patch inserts. Those plugins do not currently call `authorize()` for their happy path (tools/observers). Drift means a future grant from vault/memory-adjacent code would deny `plugin-disabled` despite the plugin being live in Cordis.

`abaco-effect-broker` is in `PATCH_ENABLED` but **not** a Cordis row — it is a library imported by voice/pilot. That is consistent with “broker is TCB, not an admitted plugin” (`index.js:152-155`).

### Provide/inject on live plugins — mostly PASS

Live host halves that touch `ctx` declare `inject` (`voice`/`documents`/`connection`; `memory`/`browser`/`vault`/`pilot`/`tools`; `observability` tokenMeter/session*). Theme/analytics/agent-status host `apply()` is empty. Memory wraps `start()` so a failure degrades instead of rejecting `apply` (`abaco-memory/index.js:303-310`). Context `apply` is synchronous and fire-and-forgets async work (`abaco-context/index.js:379-386`) specifically to avoid `TypeError: Invalid effect`.

---

## 4. Packaging

### Schema pin (0.4.21 regression)

| Check | Result |
|-------|--------|
| Root dep `abaco-mcp-schema-pin: file:packages/abaco-mcp-schema-pin` | `package.json:284` |
| Broker + pilot also declare `file:../abaco-mcp-schema-pin` | their `package.json` |
| Lockfile `node_modules/abaco-mcp-schema-pin` | `package-lock.json` |
| `asar: false` + `files` includes `node_modules/**/*` | `package.json:325,339-345` |
| Static test | `test/abaco-packaged-local-imports.test.ts` (not run here: no `vitest`/`node_modules` in this VM) |
| Sibling import of pin from broker | `abaco-effect-broker/index.js:38-41` |

**Source-level PASS** for the 0.4.21 `MODULE_NOT_FOUND` fix. **Binary-level unverified** (no unpack of the 207 MB DMG on this Linux agent). Zip grew ~14 MB vs 0.4.21 — more than a tiny pin package; not explained by this audit.

### Identity / install path

Production `appId` + `productName` are the single intended identity. `userData` is `abaco-deep-core`, not `dsh-desktop` (`index.ts:567-572`) — **PASS** vs “do not touch foreign dsh-desktop profile.”

Ops ghosts: docs still mention `dist/mac-arm64/ABACO DEEP HARNES.app`, Desktop copies, LaunchServices collisions (`docs/DECOUPLING.md:402-404`). `.gitignore` ignores `*.app`, `dist/`, `desktop/dist/` — good for the repo, not for a developer’s disk.

`nsis.allowToChangeInstallationDirectory: true` (`package.json:440`) is a Windows clone-farm footgun; out of Mac-product scope but contradicts “one install path.”

### extraResources

Patch yml, splash, recovery, safe-mode, browser chrome, harness-node-entry are listed (`package.json:346-390`). `core/` Python is **not** packaged (also noted in `docs/HANDOFF-FASE5.md`). That is correct for the Electron product and a FAIL vs root README’s Python shell.

---

## 5. Updater

- Implementation: `src/main/update/update-manager.ts` + `electron-updater` (`package.json:297`).
- Feed: GitHub provider `anthony-x507/Abaco-deep-Core` (`version-catalog.ts:6-14`; `package.json` `publish: github`).
- Same Bundle ID → replace-in-place is the intended model. No second `appId` in the production `build` block.
- `versions.json` is required for the in-app version picker (`version-catalog.ts:23-27`) and is **absent** from v0.4.22 assets (GitHub 302 to a missing file).
- 0.4.22 dropped `*.blockmap` vs 0.4.21 → delta updates unavailable; full zip still referenced in `latest-mac.yml`.
- Root unsigned pipeline (`build/electron-builder.dev.cjs`) uses a **different artifact name** (`abaco-deep-core-…`) and a generic feed story in `build/README.md:191-207`. Running that pipeline would publish a parallel identity.

Verdict: **WARN**. Main updater wiring is not a clone farm; the published feed is incomplete (`versions.json`, blockmaps) and a second unsigned pipeline still exists.

---

## 6. Security / quarantine / Atena

### MemoryStore quarantine — PASS (code + tests)

`abaco-memory/lib/quarantine.js` + `store.js`: plugin-data/untrusted born `quarantined`; `get()` / prompt renderer hide them; only host/user reviewers promote. `tests/quarantine.test.mjs` + packager G3 passed in this audit.

**Dead duplicate:** `abaco-memory/threat-model.js` is an in-memory fact model **explicitly not wired** to `MemoryStore` (`threat-model.js:24-25`). Pack A is the live path.

### F1.5 MCP pin — PASS (code + tests)

`abaco-mcp-schema-pin/index.js` does **not** import `atena-advise.js`. Atena stub (`atena-advise.js:20-24`) is advisory only. Schema-pin tests G1–G9 passed.

### Authorize hot-path vs Atena — FAIL against the written philosophy

Product rule: **Atena must NEVER grant and must NEVER sit on the authorize hot-path.**

What the code does:

- `authorize()` (`abaco-effect-broker/index.js:588+`) does **not** call `atenaAdvise`. Tests assert the word `Atena` is absent from the function body (`utility-cell.test.mjs` B12; schema-pin tests).
- On every **F1-would-allow** path, `authorize()` **does** call `cascadeEvaluate()` (`index.js:914-957`), which runs G3 `janiceAdvise()` (`cascade.js:275-286, 346`). Severity ≥ 3 becomes deny `cascade-escalation`. Advisory **cannot convert deny → allow** (good) but **does sit on the hot-path** and can convert allow → deny.
- `cascade.js:1-12` names that advisor **Janice**. Product naming: Janice = plugin runtime, Atena = advisory SLM. The runtime cell (`abaco-mediacion-pilot/index.js:2`) uses Janice correctly. The cascade uses Janice for the SLM stub. Tests then assert “Janice never decides” in some files and “Janice confirma el 3” in others.

Atena **never grants**. Atena-equivalent advisory **does sit on authorize**. Naming is internally contradictory. That is a philosophy mismatch, not a grant bug.

### STT vs “local Whisper on macOS” — PASS with WARN on leftovers

Product default is `local-whisper-stt` (`abaco-voice/client.js:50-53`, `normalize-config.js:54-55`). Cloud STT without a key is coerced to local (`normalize-config.js:177-185`). Silent OpenAI fallback is denied (`stt-mac-contract.js:51-60`). Non-Mac is fail-closed hint (`:39-43`). Host routes go through `authorize` then strangler-fork (`abaco-voice/index.js:1-12`). Contract tests G1–G7 passed.

WARN:

- OpenAI / Deepgram / Web Speech providers remain registered in `client.js` (opt-in cloud still exists; contract says cloud is not the *product* path, not that the UI must delete it).
- Info.plist mic string still emphasizes sending audio to a chosen STT provider (`package.json:407`); `NSSpeechRecognitionUsageDescription` (`:408`) does not match mlx-whisper.
- Local Whisper is **not bundled**; missing `mlx_whisper`/`ffmpeg`/HF cache is a user-visible fail-closed error, not a silent cloud hop.

---

## 7. Dead / contradictory code (candidates)

Confidence: **H** = unused or contradictory at tip; **M** = shipped but inert by design; **L** = upstream vendor / expected fork residue.

| Candidate | Why | Conf. |
|-----------|-----|-------|
| `desktop/features/**` (upload, audio, browser, pairing, updater, button-bar) | Self-described “pure presentation”; not imported by `electron.vite.config.ts` / `src/main`. Parallel to live `packages/abaco-*`. | H |
| `core/` Python + `sync/` Tailscale + `pyproject.toml` 0.1.0 | Not in `extraResources`; Electron product never starts FastAPI. Root README still sells this as the product. | H |
| `desktop/src/dsh-desktop/.github/workflows/*` | Nested; GitHub will not run. Still talks `dshdesktop.com` / ModelScope. | H |
| `build/make.sh`, `release-mac.sh`, `verify-build.sh`, `notarize-stub.sh` | Look for `ABACO Deep Core.app` / `abaco-deep-core-mac-*.zip`; contradict production artifact names and notarized Latest. | H |
| `abaco-memory/threat-model.js` | Standalone; “wiring into MemoryStore … NOT done here”. Live quarantine is `lib/quarantine.js`. | H |
| `packages/abaco-{brand,device-identity,cloud-sync,onboarding,experimental}` | Packed + dsh-patched; **not** in composition. Unsafe `apply()`. Onboarding client logs “wizard placeholder”. | M (inert) / H (rehab risk) |
| Localized `README.{zh,ja,es,pt,ru}.md` under dsh-desktop | Still “DSH Desktop” / DeepSeek Harness. English README updated. | H (docs) |
| `abaco-brand` homepage `Abaco-deep-Harnes` | Wrong repo (`abaco-brand/index.js:10-11` vs `Abaco-deep-Core`). Plugin disabled, so user-invisible unless rehab. | M |
| `cascade.js` `janiceAdvise` name | Dead *name* vs product glossary; function is live on authorize. | H (naming) |
| `preload` API `dshDesktopDirectoryPicker` | Upstream identifier; works, leaks DSH in the page world. | L |
| `@deepseek-ai/*` vendor tarballs | Required runtime; brand leak in npm names only. | L (expected) |
| `reports/` F2 worker markdown | Historical; cascade already wired. | M |
| `docs/AUDIT-2026-09.md` | Stale: claims `app.setName('DSH Desktop')` and `userData=dsh-desktop`. **False at this tip** (`index.ts:562-572`). | H (stale doc) |
| `STATUS.md` (2026-09-08) | Unsigned-app status; Apple Developer “pending”. Contradicts v0.4.22 notarized release. | H |
| Missing `versions.json` / blockmaps on Latest | Not code, but dead *feature* of version picker / delta updates. | H |

`dist/*.app` is not a git “feature”; it is an ops risk documented in DECOUPLING. Repo gitignore already drops `*.app` / `dist/`.

---

## Top 10 findings (severity)

1. **P0 — No CI on this GitHub repo.** Workflows live under `desktop/src/dsh-desktop/.github/`; `gh run list` is empty. 0.4.22 (and the pin fix) shipped without Actions. *Severity: P0 process / P1 regression risk.*

2. **P0 — Two products in one repo.** Electron tip is ABACO DEEP HARNES `io.abaco.deepcore`. Root `README.md:1-47`, `docs/INSTALL.md:12-39`, `build/verify-build.sh:21-40`, `pyproject.toml:2-4` still ship **ABACO Deep Core** / Python / Tailscale / unsigned zip. Users following INSTALL will not find the real app name or DMG.

3. **P1 — Host plugin failure still kills the core.** Cordis collects `apply` return as an effect; `Invalid effect` / uninjected `ctx.*` takes the tree to Safe Mode (`abaco-observability/index.js:62-72`). Contradicts “one failed plugin must not kill the core.” Memory/context paper over this locally; the loader contract is unchanged.

4. **P1 — Disabled plugins are packed landmines.** Not in `patch.yml` inserts (tests pass). Still in `package.json` and the dsh dependency patch. `abaco-brand/index.js:15-16`, `abaco-cloud-sync/index.js:6-7`, `abaco-device-identity/index.js:14,48` assign/read `ctx` without provide/inject. Rehab = Startup recovery.

5. **P1 — Advisory cascade sits on `authorize()`.** `index.js:927-957` → `cascade.js:275` `janiceAdvise`. Product: Atena never sits on authorize. Code: advisor cannot grant, **can deny**. Tests check the string `Atena` is absent from the function body, which does not catch `cascadeEvaluate`.

6. **P1 — Janice/Atena glossary split.** Pilot/CELL.md: Janice = runtime. `cascade.js:1-12,263-275`: Janice = G3 advisor. Tests encode both stories. Future “connect the real Janice LLM” on G3 would put an SLM on the grant path under the wrong name.

7. **P1 — Packaging honesty is source-fixed, binary-unproven, CI-ungated.** Pin is a root `file:` dep (`package.json:284`) with a good unit test file. Latest DMG was not unpacked here. No Actions to stop a repeat of 0.4.21.

8. **P2 — Updater feed incomplete.** No `versions.json` on v0.4.22 (picker 404). No blockmaps (no delta). `mac.notarize: false` (`package.json:417`) vs release title “notarized” — signing likely happened *outside* electron-builder; next `npm run package:mac` on a clean machine may ship un-notarized.

9. **P2 — `PATCH_ENABLED` lags composition.** Live: vault, observability, analytics, context (`patch.yml:131-174`). Broker set (`index.js:132-141`) omits them. Grants for those ids deny `plugin-disabled`. Admission graph tests compare patch rows to the graph, not to `PATCH_ENABLED`.

10. **P2 — Localized Electron READMEs + root STATUS/CHANGELOG header still leak DSH / Deep Core.** `README.es.md:1-25`, `README.zh.md:1-24`; `CHANGELOG.md:3` “ABACO Deep Core”; `abaco-brand/index.js:10` wrong GitHub URL `Abaco-deep-Harnes`.

---

## Does code match the intended product?

**Mostly for the Electron runtime; no for the repository as a published product story.** At `v0.4.22` the main process sets **ABACO DEEP HARNES** / `io.abaco.deepcore` / `userData=abaco-deep-core`, the composition loads Janice-style plugins (voice, documents, browser, memory quarantine, broker, MCP pin, strangler cell), disabled brand/sync/onboarding/experimental/device-identity stay **out of the patch**, Atena does **not grant**, and STT **defaults to local Whisper on darwin** without silent cloud fallback. That is the harness product Anthony asked for. It is **not** the Python/Tailscale “ABACO Deep Core” the root README still sells, GitHub CI does not exist to protect the pin regression, Cordis still lets one host plugin kill boot, and an advisory stub named Janice sits on `authorize()` contrary to the Atena hot-path rule. Treat 0.4.22 as a **usable Mac shell with an honest Bundle ID and a dishonest surrounding repo**, not as a finished plugin-isolated TCB.

---

## Suggested next 3 fixes (minimal)

1. **Add repo-root `.github/workflows` that `npm ci && npm test && npm run typecheck` in `desktop/src/dsh-desktop` on `main`/PRs**, plus a cheap packaging assertion (lockfile + `node_modules/abaco-mcp-schema-pin` after `npm ci`, or `electron-builder --dir` smoke on macOS). Do **not** enable nested upstream `release.yml` as-is (it still has `dshdesktop.com`).

2. **Stop teaching the wrong app.** Point root `README.md` / `docs/INSTALL.md` / `build/verify-build.sh` at `ABACO DEEP HARNES.app`, `abaco-deep-harnes-mac-arm64.dmg`, and `/Applications`. Leave Python `core/`/`sync/` labeled **unshipped / not in the .app** rather than re-enabling anything.

3. **Harden the two philosophy holes without rehab:** (a) keep disabled plugins out of `patch.yml` **and** add a test that their `apply` still has no `insert` *and* that `PATCH_ENABLED` ⊇ live `abaco-*` patch inserts except the broker library; (b) move `cascadeEvaluate` / `janiceAdvise` **off** `authorize()` (audit-only after the decision), or rename G3 to Atena and document that allow→deny is an explicit Leader exception. Do **not** re-enable brand/sync.

---

## Test evidence (this audit)

```
node --test \
  packages/abaco-effect-broker/tests/admission-immutable.test.mjs \
  packages/abaco-mcp-schema-pin/tests/schema-pin.test.mjs \
  packages/abaco-voice/tests/stt-mac-contract.test.mjs \
  packages/abaco-mediacion-pilot/tests/utility-cell.test.mjs \
  packages/abaco-memory/tests/quarantine.test.mjs \
  packages/abaco-memory/tests/packager-provenance.test.mjs \
  packages/abaco-effect-broker/tests/cascade.test.mjs \
  packages/abaco-effect-broker/tests/tiers.test.mjs
# → 129 pass, 0 fail
```

Not run: Vitest suite (`desktop/src/dsh-desktop/test/*.ts`) — no `node_modules` in this VM. Not run: packaged `.app` launch (Linux agent, no notarized bundle unpacked).

---

## What this audit did **not** do

- Coordinate with Agent A  
- Unpack or run `ABACO DEEP HARNES.app` / DMG  
- Notarize, Release, force-push, or merge to `main`  
- Re-enable disabled plugins or rewrite the harness  
- Change product code (report-only PR)
