# Control-2 cell — explicit strangler (Pack B)

**fecha:** 2026-09-16  
**paquete:** `abaco-mediacion-pilot`  
**kind:** `strangler-fork` (`CELL_KIND`)  
**NOT** Electron `utilityProcess`. Do not treat this file as evidence of that API.

## Why this is a strangler, not utilityProcess

1. Electron `utilityProcess.fork` / `launchDisclaimedUtilityProcess` live in
   **Electron main** (`src/main/index.ts` imports
   `./runtime/disclaimed-utility-process`). That launcher isolates the whole
   Harness Node (Janice runtime) on Darwin. The `src/main/runtime/` tree is
   gitignored by the repo-root `runtime/` rule and is **not in this checkout**.
2. The piloto (`local-transcribe`) is a Janice host fiber: `abaco-voice`
   registers `connection.fetch` **inside** that Harness child. From inside
   Janice there is no Electron `utilityProcess` API.
3. Faking `utilityProcess.fork` from this package would be a lie. Pack B
   therefore **names the cell**: `child_process.fork` of `worker.js` after
   `authorize()` + `inspectGrant()`.

```
Electron main
  └─ launchDisclaimedUtilityProcess (Darwin) / spawn Node (other)
       └─ Janice host (abaco-voice + broker)
            authorize() ──allow──► inspectGrant() ──live──► fork(worker.js)
                                      │                         │
                                      deny / missing            IPC {op,args,grantId}
                                      (no spawn)                no keys, no grants
```

## Isolation that is real

| Property | Behaviour |
|---|---|
| Host vs worker | Separate OS process. Worker `exit` / `SIGKILL` / timeout cannot kill the Janice host. |
| Authority | Worker never imports the broker, never issues grants. Host refuses IPC without a live grant. |
| Envelope | Only `{id, op, args, grantId}`. Extra keys (forged `plugin_id`, trust flags) are stripped. |
| Environment | Cloud/API keys stripped (`OPENAI_*`, Deepgram, Eleven, Anthropic, AWS, GH/NPM tokens). `ELECTRON_RUN_AS_NODE` stripped. `HF_HUB_OFFLINE=1`. |
| Fail-closed | Crash / timeout / missing tools → error + hint. **No silent OpenAI/cloud fallback.** |
| Compact lock | Untouched: 0.90 / 0.12 / 8192. |
| Plugins | `provide`/`inject`/`patch.yml` only. Disabled brand/onboarding/sync/device/experimental stay disabled. |
| MCP schema pin (F1.5) | `inject: ['tools']`. `apply(ctx)` wraps shared `ctx.tools.register`. `mcp__*` un-witnessed/mutated schemas fail closed. Not a grantor. |

## Promotion path (not this PR)

To replace the strangler with a true Electron utilityProcess cell, Electron
main would have to spawn the worker and expose a **host-owned** IPC seam
(security-reviewed; no new preload channel without a contract). Pack C / a
later slice. Until then, `CELL_KIND === 'strangler-fork'`.

## Janice / Atena

Janice = plugin runtime (this fiber + F1.5 register wrap). Atena = advisory SLM, **never** in
`authorize()`, never in the schema-pin verify/wrap, and never in this cell.

## Market reuse (Ola 2.B)

Cordis / market community plugins **must not** default to same-process main.
They reuse this cell's isolation class (`strangler-fork`) or a true Electron
`UtilityProcess` worker. Admission is enforced by
`abaco-effect-broker/isolation-class.mjs` (`admitMarketPluginLoad` /
`gateAuthorizeIsolation`). In-process market load is fail-closed deny unless
`ABACO_LAB_ALLOW_INPROCESS_MARKET=1`.

