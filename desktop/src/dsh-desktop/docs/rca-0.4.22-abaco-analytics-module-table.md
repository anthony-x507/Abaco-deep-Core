# RCA — 0.4.22 boot: `abaco-analytics` missed the module table

**Angle:** client-modules / module-table registration (Agent A)  
**Symptom:** packaged ABACO DEEP HARNES 0.4.22 dies at harness boot. Startup recovery UI (`Harness could not start` / `The plugin code could not be loaded`). Not Gatekeeper.  
**Exact log:**

```text
failed to import loader entry 8009188ec (abaco-analytics):
client-modules: require("./lib/summary.js") missed the module table
(build-time externals drift or dynamic dependency)
```

Live Mac already has the file at

`Contents/Resources/app/node_modules/abaco-analytics/lib/summary.js`

so this is **not** the 0.4.21 “file never packed” class of bug (`abaco-mcp-schema-pin`). The bytes are present; the **client require never consults the disk**.

---

## Hypothesis (report-only, then fix)

`abaco-analytics/client.js` is a `__ModuleLoader__` factory. Its `require` is the **frozen platform module table**, not Node. The factory did:

```js
require('./lib/summary.js')   // client.js:17 on 9ddad66 / 0.4.22
```

That specifier is not a seeded table id. `package.json` `exports["./lib/summary"]` is a Node ESM map and does **not** insert a table row. Hence the file can exist and the loader still throws.

This matches the written contract:

- `docs/TECH-plugin-loading.md:73` and `:184` — factory may only `require` table ids (`react`, `@deepseek-ai/*`); **never** `./lib/…`.
- `packages/abaco-voice/client.js:13-16` — same rule; voice already inlined its old `lib/` tree for this reason.
- `packages/abaco-documents/index.js:5-6` — “client module system only seeds `react` / `@deepseek-ai/*`”.
- `packages/dshmarket/tsdown.config.ts:22-55` — first-party clients keep only `CLIENT_EXTERNALS` as `require()`; everything else is `noExternal` (inlined) because “a require() the table cannot answer is a guaranteed runtime throw”.

The 0.4.22 error string is already classified as a plugin-load / Startup recovery failure in `src/preload/plugin-error-view.ts:17-19`.

---

## Exact mechanism that registers client requires into the module table

Three layers. Only the first two put ids in the table the factory can `require`.

### 1. Platform seed (what the table *contains*)

The host freezes a **platform module table** in DeepSeek Harness

`packages/client/web/src/platform.ts`

(cited in-repo at `packages/dshmarket/src/client/primitives.d.ts:3-4`). Seeded ids are the platform externals:

`react`, `react/jsx-runtime`, `react-dom`, `@deepseek-ai/*` (and the primitives package those first-party UI clients actually use).

Nothing walks `package.json` `exports`, nothing walks `lib/`, nothing registers `./lib/summary.js`.

### 2. Factory registration (how a plugin *joins* the loader)

Each plugin `client.js` is fetched by `@deepseek-ai/dsh-client-modules` (`ClientModuleRegistry`) as `/plugins/<name>/client.js` and executed. The file must start with:

```js
window.__ModuleLoader__.load({
  id: '<package-name>',
  factory: (require) => { … }
})
```

`__ModuleLoader__.load` registers **that one factory** under the package id. The `require` passed into `factory` is a **table lookup**, not `Module._load`. A miss is the “missed the module table (build-time externals drift or dynamic dependency)” throw.

`dsh-client-modules` also resolves the **package** for the loader entry (`nearestPackage`). The desktop patch

`patches/@deepseek-ai+dsh-client-modules+0.1.2-rc.1.patch`

adds a `createRequire(baseUrl).resolve(\`${expectedPackageName}/package.json\`)` fallback when `resolveSync` fails. That only finds the plugin *package*. It does **not** materialize relative factory requires into the table. That is why `summary.js` can sit next to `client.js` and still miss.

Hot-mount (`packages/dshmarket/src/hot.ts:60-62`, `:462`) only ensures a **live loader entry** exists so client-modules will *serve* the bundle. Serving ≠ seeding `./lib/summary.js`.

### 3. Build-time inlining (how first-party clients avoid a miss)

Harness / dshmarket clients are built with tsdown:

```ts
// packages/dshmarket/tsdown.config.ts:26, :51-55
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']
external: [...CLIENT_EXTERNALS],
noExternal: (source) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
```

Relative imports are **bundled into the factory**. They never become `require('./lib/…')` at runtime. Handwritten `abaco-*` `client.js` files skip this pass. The only safe pattern is: inline, or run the same tsdown allowlist.

`package.json` `exports` / files on disk / electron-builder `node_modules/**/*` are **Node/packaging** mechanisms. They are the 0.4.21 pin fix. They are not this table.

---

## Why 0.4.22 `abaco-analytics` specifically

| Site | Role | Verdict |
|---|---|---|
| `packages/abaco-analytics/client.js:17` (pre-fix) | `require('./lib/summary.js')` | **Table miss → boot abort** |
| `packages/abaco-analytics/lib/summary.js` | File exists in the .app | Irrelevant to factory `require` |
| `packages/abaco-analytics/package.json` `exports["./lib/summary"]` | Node ESM export | Does not seed the table |
| `build/dsh-desktop.patch.yml:155-157` | `insert` row `abaco-analytics` | Correct; plugin-safe; left alone |
| `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` | closure injection | Correct; file is reachable |
| Disabled rows (brand / device-identity / cloud-sync / onboarding / experimental) | Janice stay-out | **Untouched** |

`abaco-analytics` is the **only** handwritten client that shipped a relative `require`. Voice already documents the prohibition. Documents moved parsers to the host half for the same reason.

---

## Fix (plugin-safe, this PR)

Inline the summary helpers inside the `abaco-analytics` factory (same as `abaco-voice`). Keep `lib/summary.js` for Node unit tests. Do **not**:

- re-enable disabled plugins
- touch `authorize` / Atena
- add preload channels
- change `patch.yml` insert/disable rows
- invent a table-registration API for relative files (that would be freestyle against the frozen platform seed)

Regression: `test/client-module-table-externals.test.ts` fails the tree if any `__ModuleLoader__` factory `require`s a specifier outside the seed allowlist.

---

## Similar packages at risk

**Currently clean** (factory only `require('react')` or tsdown `CLIENT_EXTERNALS`):

- `abaco-voice`, `abaco-documents`, `abaco-agent-status`, `abaco-theme`, `abaco-browser`
- disabled (must stay disabled): `abaco-brand`, `abaco-device-identity`, `abaco-cloud-sync`, `abaco-onboarding`, `abaco-experimental`
- `dsh-desktop-client-ui`, `dsh-desktop-market-installer`
- tsdown: `dshmarket/client/client.js`, `ppt-runtime/{adapter,core}/lib/client.js`

**Highest future risk** — packages that already have a `lib/` tree **next to** a `client.js`. A later edit that `require`s those files from the factory will reproduce 0.4.22:

| Package | `lib/` today | Safe only if |
|---|---|---|
| `abaco-analytics` | `lib/summary.js` | stays inlined in `client.js` (this fix) |
| `abaco-voice` | `lib/recorder.js`, providers, … | host/Node only; client already inlined |
| `abaco-documents` | `lib/parsers.js` | host half + `/api/abaco-documents.extract` |

**Host-only `lib/` (no client.js today — not a table miss until someone adds a renderer factory that requires them):**

- `abaco-observability/lib/*`
- `abaco-vault/lib/plan.js`
- `abaco-context/lib/preset-installer.js`
- `abaco-memory/lib/*`

**tsdown drift:** expanding `CLIENT_EXTERNALS` without a matching `platform.ts` seed is the literal “build-time externals drift” half of the error. Do not add a specifier to `external` unless the platform table already seeds it.

**Not this bug:** missing `file:` production deps / electron-builder omit (0.4.21 `abaco-mcp-schema-pin`). Guarded separately by `test/abaco-packaged-local-imports.test.ts`.
