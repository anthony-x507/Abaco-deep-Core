# Agent D — soft-apply coverage + boot escalation (abaco-analytics)

**Date:** 2026-09-18 · **Branch:** `cursor/analytics-soft-boot-module-table-8092` · **Independent of other RCA agents**

## Verdict

PR #23 soft-apply **does not cover `abaco-analytics`**. It only wrapped host `apply()` for `abaco-voice`, `abaco-documents`, and `abaco-observability`. Analytics host `apply()` was already a no-op, so that wrap could never have saved this boot.

The real failure is a **client module-table miss** at factory import time:

```
failed to import loader entry 8009188ec (abaco-analytics):
client-modules: require("./lib/summary.js") missed the module table
– not a platform seed word, not a materialized module, and no registered package factory
```

That throw happens **before** `apply()` runs. Cordis treats one failed loader import as a dead plugin tree → Harness "Failed to load plugins" → desktop **Startup recovery**. Recovery then says **"No specific plugin could be identified"** even though the log names `abaco-analytics`, because attribution only uninstalls *profile* third-party bundles, not first-party desktop patch rows.

## Why PR #23 missed this

| Plugin | PR #23 change | Failure class it can catch | Analytics 0.4.22+ boot |
|---|---|---|---|
| `abaco-voice` | host `apply()` try/catch | host `connection.fetch` / register throw | n/a |
| `abaco-documents` | host `apply()` try/catch | same | n/a |
| `abaco-observability` | host `apply()` try/catch | `ctx.inject` throw | n/a |
| `abaco-analytics` | **unchanged** | host apply is empty | **client `require('./lib/summary.js')`** |

Soft-apply on the host half is the wrong layer for a renderer factory `require`.

## Root cause (require / module table)

`docs/TECH-plugin-loading.md` and the voice client already state the rule: the web module table only seeds `react` and `@deepseek-ai/*`. Relative `require('./lib/…')` is not a seed, not a materialized module, and not a registered package factory.

- `abaco-voice/client.js` and `abaco-documents/client.js` were already inlined.
- `abaco-analytics/client.js` still did `require('./lib/summary.js')` so Node tests could import helpers. That split is legal on the host; it is fatal in the renderer factory.

This is a **packaging / client-closure bug**, not a damaged file and not a third-party install.

## Why recovery looked unidentified

1. Extractor **does** read `failed to import loader entry … (abaco-analytics)`.
2. `resolveProfileRecoveryPlugins` only returns names that are **configured third-party profile bundles**.
3. `abaco-analytics` is a `dsh-desktop.patch.yml` insert, not a user-installed bundle → `plugins = []`.
4. View model with empty `plugins` prints "No specific plugin could be identified" and offers Safe Mode.

Safe Mode is the correct *action* (the safe patch omits analytics; uninstall would be a lie). Claiming the plugin is unknown is not honest.

## What this change does

1. **Fix the packaging bug:** inline `lib/summary.js` into `client.js`. Keep `lib/summary.js` for Node tests. CI fails if any mounted `client.js` relative-requires again — the bug stays visible.
2. **Fail soft after a successful import:** renderer `apply()` and host `apply()` catch, warn, skip Analytics. They do **not** rewrite the patch layer, do **not** re-enable `DISABLED_PLUGINS` (brand / device-identity / cloud-sync / onboarding / experimental), and do **not** put Atena on `authorize` (analytics has no authorize path).
3. **Honest recovery:** if the log names a loader entry that is not uninstallable, the overlay names it and still offers only Safe Mode.

## What this change does not do

- Does not re-enable disabled first-party plugins.
- Does not add analytics to F1 `PATCH_ENABLED` or put Atena on authorize.
- Does not teach Cordis to survive a failed *import* of an arbitrary third-party client. The durable fix for this row is a self-contained factory.
- Does not uninstall first-party patch rows from Startup recovery.
