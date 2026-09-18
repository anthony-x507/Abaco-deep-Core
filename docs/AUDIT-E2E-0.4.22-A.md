# AUDIT E2E 0.4.22 — Agent A (independent)

| Field | Value |
|---|---|
| **Auditor** | Agent A (independent; no coordination with Agent B) |
| **Repo** | `anthony-x507/Abaco-deep-Core` |
| **Tip audited** | `b4fb3d80ea62991101411598de8068aa4d1458f4` (`origin/main`, merge of PR #20) |
| **Claimed product** | Mac desktop **ABACO DEEP HARNES** (Electron), Bundle ID `io.abaco.deepcore`, `package.json` `0.4.22` |
| **Date** | 2026-09-18 |
| **Method** | Read-only tree + `gh` (PRs, Latest Release assets, Actions runs) + contract/test source. **Did not** launch the notarized `.app` (Linux audit VM; `desktop/src/dsh-desktop/node_modules` absent). **Did not** unpack the 0.4.22 DMG. |
| **Prior audit** | `docs/AUDIT-2026-09.md` (2026-09-09) is **stale** on identity, `userData`, and which `abaco-*` rows mount. Do not treat it as current. |

This is a report, not a Release. No plugins were re-enabled. No packaging / notarize work was performed.

---

## Scorecard

| Area | Verdict | One-line why |
|---|---|---|
| **Repo health** | **FAIL** | Tip and Latest Release version match `0.4.22`, but GitHub Actions never runs: there is **no** repo-root `.github/workflows/`. Docs still teach a different product. |
| **Launch / boot** | **WARN** | Main → preload → Harness `--patch` → composer slots is coherent on paper. One enabled plugin (`abaco-voice`) can still throw during `apply()` and trip Startup recovery. Live cold-start not re-proven here. |
| **Plugins** | **PASS** | Disabled brand/device/sync/onboarding/experimental stay out of `patch.yml` and `DISABLED_PLUGINS`. Mounted rows use insert + inject. |
| **Packaging** | **WARN** | `abaco-mcp-schema-pin` is now a root `file:` dep (PR #19) and `asar: false` packs `node_modules/**/*`. 0.4.22 assets do **not** match the in-tree release-asset contract (no blockmaps, no `versions.json`, arm64-only). DMG contents not inspected. |
| **Updater** | **WARN** | Same `appId`, GitHub provider, `quitAndInstall(false, true)`. Latest feed is incomplete vs `test/release.test.ts` expectations; dual builder configs still exist. |
| **Dead / contradictory code** | **WARN** | Expected after the F1 / F1.5 / F2.1 merge wave. Parallel Python + `desktop/features/` product still in-tree; root docs are the loudest contradiction. |
| **Philosophy** | **WARN** | Atena is **not** on `authorize()`. Isolated `userData`. Plugin-first holds for the Electron tree. Repo-level story is still a Python monolith named “ABACO Deep Core”, and one plugin throw can still kill the tree. |

---

## 1. Repo health

### Tip, PRs, version

- Default branch: `main` @ `b4fb3d8` — *Merge pull request #20 from anthony-x507/chore/release-0.4.22*.
- `desktop/src/dsh-desktop/package.json` `version`: **`0.4.22`**; `appId`: **`io.abaco.deepcore`**; `productName`: **`ABACO DEEP HARNES`** (`package.json:2-3`, `:323-324`).
- Open PRs at audit time: **none**.
- Latest GitHub Release: **`v0.4.22`** (published 2026-09-18T01:58:11Z), title *v0.4.22 — packaging pin + notarized*, `targetCommitish: main`.
- Tag `v0.4.22` → same SHA as `origin/main`. **No version skew** between tip, tag, `package.json`, and `latest-mac.yml` (`version: 0.4.22`).
- README claims a `develop` branch (`README.md:32-33`). **`origin/develop` does not exist.**

### CI on main — FAIL

- `gh run list --branch main` → **empty**.
- Repo root has **no** `.github/` directory.
- The only workflows live at `desktop/src/dsh-desktop/.github/workflows/release.yml` and `backfill-archive.yml`. GitHub Actions only loads **repository-root** `.github/workflows/*`. Nested workflows are **dead for CI**.
- In-tree tests treat that nested path as the pipeline (`desktop/src/dsh-desktop/test/release.test.ts:286-313` reads `projectRoot/.github/workflows/release.yml`). Those tests can pass in the fork tree while **main never runs them on GitHub**.
- Implication: every 0.4.x Release, including 0.4.22, is **manual / out-of-band**. The nested `release.yml` (sign, notarize, smoke, `verify-release-assets.mjs`) is a script people can run locally, not a gate on `main`.

### Latest Release assets vs in-tree contract — FAIL/WARN

Published **v0.4.22** assets:

| Asset | Present |
|---|---|
| `abaco-deep-harnes-mac-arm64.dmg` (197.8 MB) | yes |
| `abaco-deep-harnes-mac-arm64.zip` (243.1 MB) | yes |
| `latest-mac.yml` (`version: 0.4.22`) | yes |
| `*.blockmap` | **no** (0.4.21 had both zip and dmg blockmaps) |
| `versions.json` | **no** |
| `latest-mac-arm64.yml` / `latest-mac-x64.yml` / `latest.yml` | **no** |
| mac x64 / Windows NSIS | **no** |

`test/release.test.ts:300-308` still expects the workflow to mention arm64+x64+Windows blockmaps and split yml files. `version-catalog.ts:26-27` fetches `…/releases/latest/download/versions.json` for the archive picker. That URL **404s** on Latest.

Release notes claim Developer ID + stapled notarization. `package.json:417` has `"notarize": false`. That is consistent with **manual** notarize after `electron-builder`, not with the nested workflow actually running. `build/electron-builder.dev.cjs` is a second config with different `artifactName`, `notarize`, and output dir (`build/artifacts/`). Two pipelines, one product.

### Docs / identity drift — FAIL

Root and ops docs still teach **ABACO Deep Core**, unsigned zip, Tailscale-required mesh, Python `entry_points`:

| Source | Teaches | Ship truth |
|---|---|---|
| `README.md:1-47` | “ABACO Deep Core”, unsigned `.app`, Python plugins, Tailscale | `ABACO DEEP HARNES.app`, `io.abaco.deepcore` |
| `docs/INSTALL.md:1-39` | `abaco-deep-core-mac-…zip`, `ABACO Deep Core.app`, unsigned | artifact `abaco-deep-harnes-mac-arm64.dmg` |
| `docs/QUICKSTART.md:6-8` | `abaco-deep-core-mac-arm64-0.1.0.zip` | 0.4.22 Harnes DMG |
| `build/verify-build.sh:21-40` | `APP_DISPLAY_NAME="ABACO Deep Core"`, glob `abaco-deep-core-mac-*.zip` | builder emits `ABACO DEEP HARNES.app` / `abaco-deep-harnes-*` |
| `FEATURES_STATUS.md`, `STATUS.md` | frontend = `desktop/features/*`; last updated 2026-09-08 | real UI = Cordis `packages/abaco-*` |
| `desktop/src/dsh-desktop/README.es.md:1-25` (and zh/ja/ru/pt) | **DSH Desktop** / DeepSeek Harness | English `README.md` is Harnes-branded |
| `pyproject.toml:1-4` | `abaco-deep-core` 0.1.0 Python shell | Electron 0.4.22 is the ship |

`CHANGELOG.md` for 0.4.19–0.4.22 is accurate about F1 / F1.5 / F2.1 and the 0.4.21 pin miss. It cannot repair the root README.

---

## 2. Launch / boot path (end-to-end)

### Sequence (evidence)

1. **Identity before ready** — `configureAppIdentity()` sets name `ABACO DEEP HARNES` and `userData` → `…/abaco-deep-core` (dev: `abaco-deep-core-dev`). Explicitly **not** upstream `dsh-desktop` (`src/main/index.ts:555-572`).
2. **Single-instance + `app.whenReady()` → `bootstrap()`** (`index.ts:3259-3277`).
3. **Launch root + desktop storage** — `<userData>/launch-root`, profile dir `…/harness/profiles/web`, file `desktop-storage.json` (`index.ts:2977-2986`).
4. **Hidden `BrowserWindow` + `HarnessRuntime`** — patch paths `dsh-desktop.patch.yml` / `dsh-desktop-safe.patch.yml` (`index.ts:2987-3014`, `harness-runtime.ts:435-439`).
5. **`launchHarness()`** — splash → `runtime.stop()` → `profile-startup-maintenance` (store pin, removals, generation, consistency) → `runtime.start()` (`index.ts:1274-1341`). Maintenance failure → `enterMigrationSafeRecovery()` + `SAFE_MODE_PROFILE` (`index.ts:1328-1334`).
6. **Child** — bundled Node + DSH `web --patch <yml> --no-open --host 127.0.0.1 --port N`, `DSH_HOME=<userData>/harness` (`harness-runtime.ts:236-251`, `:312`, `:469-481`).
7. **Ready** — stdout token + HTTP probe → `openHarness(url)` (`harness-runtime.ts:544-612`, `index.ts:3007-3012`).
8. **Preload first** — `setupDesktopStoragePersistence()` sync-loads storage and **patches `Storage.prototype`** before page scripts (`src/preload/desktop-storage.ts:3-40`). Exposes `dshDesktop`, `dshRecovery`, `dshSafeMode`, `dshAbacoBrowser`, directory picker (`src/preload/index.ts:175-253`, `:539-563`).
9. **Composer usable** — patch disables `ui-brand-official`, inserts `dsh-desktop-client-ui` (brand slots) + `abaco-voice` on `conversation.input.right` via `inputActions.setDraft`, **not** Cordis store (`build/dsh-desktop.patch.yml:11-16`, `:71-73`; `dsh-desktop-client-ui/client.js:123-137`; `abaco-voice/client.js` draft path).
10. **Health** — sidebar `[data-dsh-sidebar-root]` heartbeat; 60s boot confirmation (`index.ts:775-805`).

Safe mode uses `dsh-desktop-safe.patch.yml` (brand + HMR fallback only) — PPT / market / preset transfer cannot block recovery (`dsh-desktop-safe.patch.yml:1-11`).

### Bugs / races / dead branches on the boot path

| Item | Sev | Evidence |
|---|---|---|
| `abaco-voice` `apply()` **throws** if `connection.fetch` is missing — one enabled plugin can still brick the tree (“Startup recovery”) | High | `packages/abaco-voice/index.js:73-77` |
| `HarnessRuntime.beginLaunch()` is **never called** — launch clock still starts inside `start()`, so pre-`start()` maintenance is invisible in the “how long did launch take” story the comment describes | Low | `harness-runtime.ts:635-638` (sole hit in repo) |
| `prewarmShellEnvironment()` runs only inside `start()`, not overlapped with splash as comments imply | Low | `harness-runtime.ts:469` |
| Plugin-recovery evidence poll is 1.5s — fast renderer errors can miss the plugin id | Low | `index.ts:2039-2048` |
| macOS menu top-level label is still **`Harness`** | Low | `index.ts:2838` |
| Settings “Update” button `textContent` hardcoded `'Update'` | Low | `src/preload/index.ts:381` |
| Failed-patch message still says **“DSH Desktop patch was not found”** | Low | `harness-runtime.ts:441` |

Store inject: the localStorage shim is the product path (voice/documents use it because Cordis `provide`/`inject` broke brand/device/sync). That is **intentional isolation**, not a missing inject on the composer hot path. Fatal “store inject” on 0.4.21 was **`MODULE_NOT_FOUND` for `abaco-mcp-schema-pin`**, not this shim.

### Mic / STT vs “local Whisper on macOS”

**Host product path matches F2.1-C.** Default provider is `local-whisper-stt`; cloud ids without keys coerce to local (`abaco-voice/client.js:98-120`). Host routes authorize `host.fetch` then `proc.spawn` (`mlx_whisper` / `whisper` / `ffmpeg`) and execute via `abaco-mediacion-pilot` (`abaco-voice/index.js:73-205`; `docs/contracts/CONTRACT-F2.1-C-STT-MAC.md:32-46`). Non-Mac is fail-closed 503 + Linux §15/16 hint.

**Contradictions (WARN, not a silent-cloud FAIL):**

- `package.json:407` `NSMicrophoneUsageDescription` still says audio is sent to “tu proveedor STT elegido” and points users at **Web Speech** for local — while product STT is **on-device Whisper**, and `normalizeVoiceConfig` **rewrites** `web-speech-stt` → `local-whisper-stt` (`client.js:117-120`).
- Cloud STT (`openai-stt`, `deepgram-stt`) remains in Settings as key-gated opt-in (`client.js:764-788`, `:1194-1207`). Contract §3 allows explicit opt-in; it is **not** the product path. `denySilentCloudSttFallback` is host-side; client still *can* pick cloud when keys exist.
- Empty live-capture copy still nudges OpenAI/Deepgram (`client.js` ~1275). Stale comment “force MediaRecorder + cloud STT” remains (~1292).

This Linux VM would hit the 503 path by design. **Mac cold-start + mic** was not executed here.

---

## 3. Plugins

### Disabled stay disabled — PASS

`DISABLED_PLUGINS` is the broker source of truth and is mirrored to `tiers.DISABLED` at import (throw on drift) (`abaco-effect-broker/index.js:109-129`). `authorize()` re-checks (`index.js:647-665` region). `dsh-desktop.patch.yml:177-184` documents the five as **not inserted** (Cordis `provide`/`inject` violations). No `disabled: false` rehab rows after that NOTE. Tests lock the set (`admission-immutable.test.mjs`, `abaco-analytics.test.ts`, STT G5).

`abaco-brand/index.js:15-17` still does `ctx.abacoBrand = BRAND` (no `provide`). Correct that it stays disabled. Homepage in that dead module points at `Abaco-deep-Harnes` (`index.js:10-11`) — wrong repo slug.

**WARN:** `dshmarket` can write user-layer `disabled: false` (`packages/dshmarket/src/patch.ts`). Broker would still deny effects (`plugin-disabled`), but a manual row could remount `abaco-brand` and throw at boot. Not an automatic re-enable.

### Mounted composition

`dsh-desktop.patch.yml` inserts: theme, voice, mediacion-pilot, documents, agent-status, browser, memory, vault, observability, analytics, context — plus desktop client-ui, market-installer, ppt-composer, hmr-fallback, preset-transfer. `spill-policy` config only.

`PATCH_ENABLED` (`index.js:132-141`) lists theme/voice/documents/agent-status/browser/memory/mediacion-pilot/**effect-broker** and **omits** context, vault, observability, analytics. Effect-broker is **not** a Cordis row (imported by voice). Only voice + mediacion-pilot have pinned `manifest.f1.yml` (`index.js:157-160`). That is consistent with “only those two take grants” and inconsistent with “admission graph enumerates every mounted plugin.”

### Isolation from foreign `dsh-desktop` profile — PASS

`userData` is `abaco-deep-core` (`index.ts:562-572`). Child `DSH_HOME` is `<userData>/harness` (`harness-runtime.ts:312`). `~/.dsh` appears only as unset-env fallback in some host plugins (tests / CLI). Packaged launch sets `DSH_HOME`.

### One failed plugin vs core

Recovery UI exists (`plugin-recovery-view.ts`, `plugin-recovery-detection.ts`). `abaco-memory` degrades failed registrations (`abaco-memory/index.js` `attempt()` wrapper). **`abaco-voice` does not** — throw in `apply()` is the 0.4.21-class boot killer if `connection.fetch` or a sibling import fails.

---

## 4. Packaging

### Schema pin (0.4.21 regression) — PASS on source, WARN on artifact

- Root dep `abaco-mcp-schema-pin: file:packages/abaco-mcp-schema-pin` (`package.json:284`).
- `asar: false`; `files` includes `node_modules/**/*` (`package.json:325-341`).
- Broker/pilot import the pin; `test/abaco-packaged-local-imports.test.ts` stages a sibling `node_modules` layout. Early-return if `npm ci` was never run (`:128-133`) — **this audit environment would skip that proof**.
- CHANGELOG 0.4.22 (`CHANGELOG.md:8-13`) matches PR #19: 0.4.21 Startup `MODULE_NOT_FOUND` because the pin was not a root `file:` dep.

**Not proven here:** the published `.app` actually contains `Contents/Resources/app/node_modules/abaco-mcp-schema-pin`. Source + lockfile + test *intend* that. Unpacking the DMG is the only honesty check left.

Disabled plugins remain `file:` deps (`package.json:278-295`) and therefore **ship inside the .app** even though they never mount. Weight + confusion, not a re-enable.

`extraResources` copies patch yml, splash, recovery HTML — not the pin (pin is a Node package; that is correct **if** `node_modules` is packed).

---

## 5. Updater

Intended model: electron-updater, **same Bundle ID**, replace-in-place, not a clone farm.

| Check | Evidence | Verdict |
|---|---|---|
| Prod `appId` `io.abaco.deepcore` | `package.json:323` | PASS |
| Dev isolated `io.abaco.deepcore.dev` + `abaco-deep-core-dev` | `electron-builder.dev.cjs:5-6`, `index.ts:555-558` | PASS |
| Feed = this repo’s GitHub Releases | `package.json:392-397`, `version-catalog.ts:6-14`, `update-manager.ts:237-241` | PASS |
| Consent then `quitAndInstall(false, true)` | `update-manager.ts:212-218`; harness stop before quit `index.ts:3237-3243` | PASS |
| Updates off in dev builds | `index.ts:3235-3245` | PASS |
| 0.4.22 missing zip/dmg **blockmaps** | Latest assets vs 0.4.21 | WARN — full zip update can still work; delta updates cannot |
| `versions.json` missing on Latest | `version-catalog.ts:26-27` | WARN — archive picker 404 |
| `dist/` + `dist-dev/` + `build/artifacts/` | three output roots; `.gitignore` ignores `*.app` / `dist/` | WARN — ops ghost copies, not a second Bundle ID |
| No in-app `.bak` sweeper | update-manager has none | WARN (relies on electron-updater + operator hygiene) |

Not a clone farm in code. Operator risk remains: leftover `dist/*.app` next to `/Applications/ABACO DEEP HARNES.app` (Release notes already warn; `verify-build.sh` still looks for the old name).

---

## 6. Security / quarantine / Atena

| Contract | Verdict | Evidence |
|---|---|---|
| Atena never grants / never on `authorize()` | **PASS** | `authorize()` header `cero Atena` (`abaco-effect-broker/index.js:585-587`); G8 tests (`abaco-mcp-schema-pin/tests/schema-pin.test.mjs:323-337`); `atena-advise.js` is a stub **not** imported by pin `index.js:7`; admission `source === 'atena'` → `atena-cannot-grant` (`admission.js:60-63`, `:235-236`) |
| Janice = runtime | **PASS** | mediacion-pilot worker “NEVER issues grants” / “Cero Atena”; voice host comments |
| MemoryStore quarantine (F2.1-A) | **PASS** | `trustOf` / `initialStateFor` (`quarantine.js:55-113`); writes without trust fail-closed; `get()` uses `admittedEntries()`; promote only `host`/`user`; pre-F2.1 entries without `state` stay visible (documented `:118-119`) |
| F1.5 packager / MCP pin | **PASS** (source) | packager fail-closed; pin wrap fail-closed; shipped pin set empty |
| Suspicious input → Cordis-central | **PASS** on new writes | plugin/tool provenance starts `quarantined` |

---

## 7. Dead / contradictory code (candidates)

Confidence: **H** = verified unused or contradictory in this tree; **M** = strong inference; **L** = cosmetic / vendor-adjacent.

| Candidate | Confidence | Notes |
|---|---|---|
| Entire `desktop/features/` (upload, audio, browser, agent-status, button-bar, …) | **H** | Own README: “pure presentation… does not implement” (`desktop/features/README.md:7-9`). No imports from `src/` / electron-vite. Promised `pairing/` + `updater/` dirs **missing**. |
| Root Python `core/` + `sync/` as *shipped product* | **H** | Real code + tests; **not** in Electron `extraResources`. Parallel product. |
| Five disabled `abaco-*` still in `package.json` `file:` closure | **H** | brand, device-identity, cloud-sync, onboarding, experimental — packed, never mounted. |
| `FEATURES_STATUS.md` / `STATUS.md` | **H** | Map UI to `desktop/features/*`; dated 2026-09-08; claim Python updater “completo”. |
| Localized fork READMEs + `RELEASE_NOTES.md` | **H** | Still “DSH Desktop” / dshdesktop.com. |
| `build/verify-build.sh` + `scripts/bootstrap.sh` | **H** | Wrong app name / artifact glob; bootstrap calls a missing identity helper. |
| `HarnessRuntime.beginLaunch` | **H** | Defined, never called. |
| `PATCH_ENABLED` vs `patch.yml` insert set | **H** | Drift documented in §3. |
| `docs/AUDIT-2026-09.md` as current truth | **H** | Identity / userData / plugin mount claims superseded. |
| Dual electron-builder configs (`package.json` `build` vs `build/electron-builder.dev.cjs`) | **H** | Different `artifactName`, notarize, icons, out dirs. |
| `ppt:build` / `dsh-ppt-composer` | **M** | In the live patch; product-adjacent, not dead — but a large orthogonal surface. |
| `dshmarket` DeepSeek Harness user strings | **H** (if market installed) | `locales.ts:520-536` (“DeepSeek Harness”); compiled `client/client.js` mirrors. Market-installer is in the default patch. |
| `agent-status/__init__.py` under `desktop/features/` | **L** | Stray Python file in a TS tree. |

---

## Top 10 findings (severity)

1. **P0 — GitHub Actions never runs on this repo.** Workflows exist only under `desktop/src/dsh-desktop/.github/workflows/`. `gh run list` is empty. Releases (including 0.4.22) are ungated. *Fix: copy/adapt `release.yml` to repo-root `.github/workflows/` (do not “fix” by inventing a second appId).*
2. **P0 — Root docs / verify-build teach the wrong product.** `README.md:1-47`, `docs/INSTALL.md:17`, `docs/QUICKSTART.md:6-8`, `build/verify-build.sh:21-40` → `ABACO Deep Core.app` / unsigned zip `0.1.0`. Operators will look for a bundle that electron-builder does not emit.
3. **P1 — 0.4.22 Latest assets are incomplete vs the updater contract.** No `*.blockmap`, no `versions.json`, no x64/Windows artifacts (`version-catalog.ts:26-27`, `test/release.test.ts:300-308`). In-app Update to 0.4.22 can still do a full zip pull; archive picker and delta updates cannot.
4. **P1 — `abaco-voice` `apply()` throw can still kill boot.** `packages/abaco-voice/index.js:73-77`. Same failure class as 0.4.21 pin miss (Startup recovery), different trigger. Memory’s degrade wrapper is the pattern to copy — **do not** re-enable disabled plugins.
5. **P1 — Packaging honesty of the published `.app` is unproven in this audit.** Source + PR #19 + lockfile say the pin is packed. Nested CI that would smoke-import it does not run. Unpack `abaco-deep-harnes-mac-arm64.dmg` and assert `node_modules/abaco-mcp-schema-pin` exists.
6. **P2 — `PATCH_ENABLED` ≠ mounted `patch.yml` rows.** `abaco-effect-broker/index.js:132-141` vs `build/dsh-desktop.patch.yml:107-175`. Admission graph is grant-centric (only voice + pilot have manifests) but the comment claims “patch-enabled ids”. Drift invites the next agent to “rehab” rows or mount broker as a Cordis plugin.
7. **P2 — User-facing DeepSeek / DSH Desktop leftovers.** `dshmarket/.../locales.ts:523-536`; `README.es.md:1-25`; menu label `Harness` (`index.ts:2838`); failed-patch string “DSH Desktop patch” (`harness-runtime.ts:441`).
8. **P2 — Info.plist mic copy contradicts local-Whisper product.** `package.json:407-408` vs F2.1-C and `client.js:117-120`.
9. **P2 — Parallel dead product in-tree.** `desktop/features/` + Python `core/`/`sync/` + `FEATURES_STATUS.md` still describe Tailscale mesh + whisper.cpp + FastAPI as the app. Increases the chance a future merge re-wires the **foreign** tree or the **upstream `dsh-desktop` profile**.
10. **P3 — `notarize: false` in `package.json:417` vs Latest notes “notarized”.** Not a code bug if notarize is manual; it is an honesty gap. Nested workflow *would* notarize if it ever ran.

---

## Dead-code list (explicit)

See §7 table. Highest-confidence removals / quarantine (not this PR):

1. Stop teaching `desktop/features/` as the frontend (`FEATURES_STATUS.md`).
2. Mark `core/` + `sync/` as **library / future**, not the Mac app.
3. Keep the five disabled plugins **disabled**; optionally drop them from the packed `files` allowlist later (separate, tested PR — do not re-enable).
4. Delete or call `beginLaunch()`.
5. Align or comment `PATCH_ENABLED` as “grant-capable ids” not “all patch inserts”.

---

## Does the code match the intended product?

**The Electron tree at `desktop/src/dsh-desktop` mostly does; the repository as a whole does not.** On `main` @ 0.4.22 the shipping shell has the right Bundle ID and product name, isolates `userData` from upstream `dsh-desktop`, composes Janice via `patch.yml` + provide/inject-safe plugins, keeps Atena off `authorize()`, quarantines untrusted memory, and (in source) packs `abaco-mcp-schema-pin` so the 0.4.21 `MODULE_NOT_FOUND` should not recur. Disabled brand/device/sync/onboarding/experimental stay disabled. Local Whisper is the Mac STT product path. What does **not** match is the public repo surface: no root CI, Latest assets thinner than the updater tests, and docs/status/Python/features still selling “ABACO Deep Core” + Tailscale + unsigned zip. Until those are aligned, Anthony and a new clone will follow the wrong install path, and Leader cannot treat GitHub Actions as a gate.

---

## Suggested next 3 fixes (minimal)

1. **Root CI, no architecture change.** Add `.github/workflows/release.yml` at the **repo root** (move or `workflow_call` the existing nested file). Until then, `main` is ungated. Do not enable nested-only workflows and call it CI.
2. **Identity docs + `verify-build.sh` only.** Replace `ABACO Deep Core.app` / `abaco-deep-core-mac-*.zip` / “unsigned” with `ABACO DEEP HARNES.app` / `abaco-deep-harnes-mac-arm64.dmg` in `README.md`, `docs/INSTALL.md`, `docs/QUICKSTART.md`, `build/verify-build.sh`. Leave plugins and `userData` alone.
3. **Degrade `abaco-voice` `apply()` instead of `throw`** when `connection.fetch` is missing (same `attempt()` style as `abaco-memory`). Composer stays up; mic routes stay off. **Do not** re-enable disabled plugins to “fix” brand inject.

Optional ops (not a code PR): attach `abaco-deep-harnes-mac-arm64.zip.blockmap` + `versions.json` to `v0.4.22`, and unpack the DMG once to prove the pin directory exists.

---

## Methodology / limits

- Independent of Agent B. Citations are paths in this checkout @ `b4fb3d8`.
- `gh`: repo metadata, all PRs, Latest + 0.4.21 assets, `latest-mac.yml` body, empty Actions run list, missing `origin/develop`.
- Did **not** run `npm test` / `npm ci` (no `node_modules` in the fork tree on this VM).
- Did **not** boot Electron or exercise composer/mic in a browser.
- Did **not** inspect the notarized DMG’s `node_modules`.
- Vendor `@deepseek-ai/dsh*` package names are upstream; they are not scored as user-facing brand leaks except where UI copy says “DeepSeek Harness” / “DSH Desktop”.
