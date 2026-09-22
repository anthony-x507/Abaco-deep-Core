# GAP — F1 Control 1 broker mediación (main @ 0.4.24 → this PR)

Stale branch `feat/f1-broker-p1-p2-p3` is **46 behind / 1 ahead**. That one commit is already absorbed on main (plus admission, Pack B, F1.5). **Do not revive it.**

## Already on main before this PR
- `authorize()` + channel identity + forged `plugin_id` ignored (M1, M8)
- Disabled set + no rehab (M2, G-plugin)
- Pinned manifests / control-3 admission graph (PR #15)
- Pack B strangler-fork cell (control 2)
- F1.5 MCP pin + memory provenance
- Voice route mediation (authorize before spawn)
- Compact 0.90 / 0.12 / 8192; cero Atena in `authorize()`

## Missing on main (closed here)
| Gap | Close |
|---|---|
| M3 only grepped client.js | + `inject-undeclared` on undeclared inject claim |
| M4 absent | + `preload-not-allowlisted` for unknown preload keys |
| M5 no #tools invariant | + registry-size assert |
| M6 only spawn | + `fs.write` / hop `ipc.invoke` |
| M7 revoke only | + `ttl-expired` + revoke ≤1s |
| M9 absent | + always-deny `compose.mutate` |
| Vitest “M10” was the happy path | real M10 = throw → `policy`; happy renamed M-happy |
| 4 asserts incomplete | denyCount++ and allowCount frozen |
| Python mirror absent | `core/f1` + JSON fixture |
| Pilot not removable without restart | `unloadAdmittedPlugin` session overlay |
| Architect #9 ui.slot | own-id `ui.slot` auto-grant |
| Contracts not in tree | checked in under `docs/contracts/` |
