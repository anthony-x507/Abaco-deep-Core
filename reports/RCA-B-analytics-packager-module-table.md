# RCA B — packager / materialize (`abaco-analytics` module table)

Boot: `failed to import loader entry … (abaco-analytics): client-modules: require("./lib/summary.js") missed the module table`. File is present on disk in the installed `.app` at `Contents/Resources/app/node_modules/abaco-analytics/lib/summary.js`.

## Exact packager gap

Two different “materializations” were collapsed into one:

| Layer | What 0.4.22 / electron-builder does | What the renderer actually needs |
| --- | --- | --- |
| Disk | Root `file:` dep + `asar: false` + `files: ["node_modules/**/*"]` copies the package tree into `Resources/app/node_modules` | Bytes on disk |
| Module table | Nothing. `dsh-client-modules` injects a `require()` that only answers platform seeds, already-registered `__ModuleLoader__` factories, and inlined (materialized) locals | A table entry for every `require()` specifier |

`abaco-analytics` is an ESM package (`"type": "module"`) with `exports["./lib/summary"]`. That export, and the file existing after electron-builder dereferences the `file:` symlink, is **necessary and insufficient**. The client factory is not Node:

```js
window.__ModuleLoader__.load({
  id: 'abaco-analytics',
  factory: (require) => {
    const { summarizeChatNodes, … } = require('./lib/summary.js')
```

`./lib/summary.js` is:

- not a platform seed (`react` / `react/jsx-runtime` / `react-dom` / `@deepseek-ai/*`)
- not a materialized module (not in `loadCache`; not inlined into this factory)
- not a registered package factory (only `client.js` is the loader entry)

The throw is exact, from `@deepseek-ai/dsh-client-modules/lib/client.js` `makeRequire`:

```js
throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`);
```

Resolution order is seed → memoized record → registered factory. Disk is never consulted. `asar` is already `false`. Safe Mode / re-enabling disabled plugins / Atena-on-authorize cannot put a specifier into that table.

## Must `lib/*.js` be listed as seeds or externals?

**No. That is the wrong fix.**

- **Seeds** are host-frozen platform ids. Adding `./lib/summary.js` there is not how the table is built, and it would not match how other plugins (`abaco-voice`, `dshmarket` tsdown `CLIENT_EXTERNALS`) work.
- **Bundler `external` / `dsh.client.external`** means “do not inline; resolve from the table at runtime”. That is the failure mode named in the throw (`build-time externals drift`). `dshmarket/tsdown.config.ts` already states: anything **not** in the table must be `noExternal` / inlined. A relative path is not a dynamic package row that `dsh.client.external` can name.

Correct packager rule (same as voice + preload `isolatedEntries`): **materialize local `require('./lib/…')` into the factory**. Keep `lib/summary.js` on disk for Node tests; do not expect the renderer to Node-require it.

## Why the 0.4.22 mcp-schema-pin test missed this

`test/abaco-packaged-local-imports.test.ts` walks `from '../pkg'` sibling ESM imports and asserts each `pkg` is a root `file:` dep so electron-builder packs it beside the importer. That pin is still correct for host-side `abaco-mcp-schema-pin` (`MODULE_NOT_FOUND` when the sibling never landed in `app/node_modules`).

It does **not** walk `__ModuleLoader__` `require()` specifiers. `require('./lib/summary.js')` is not a sibling package name, so the 0.4.22 scanner would stay green while the installed app boots into Startup recovery.

## Regression that would have caught it

`desktop/src/dsh-desktop/test/abaco-client-module-table.test.ts`:

1. Proves the 0.4.22 sibling scanner is blind to `require('./lib/summary.js')`.
2. Replays the installed-app situation: file + exports map + `asar: false` + seed-only `require()` still throws the table-miss string.
3. Shows a leaked factory fails the table, and `scripts/client-module-table.mjs` materialize makes it load.
4. Walks every packaged `client.js` and forbids non-seed `require()` ids.
5. Executes the real `abaco-analytics` factory with a seed-only `require()`.

Plugin-safe stay-outs (unchanged): disabled set in `dsh-desktop.patch.yml`, no Atena on `authorize`, `asar: false`.
