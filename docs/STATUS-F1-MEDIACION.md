# STATUS — F1 broker mediación (Control 1 closeout)

How to prove mediación on this tip. No notarize. No `~/Library/Application Support/dsh-desktop/`.

## One-liner
A protected effect is either `authorize() → allow` with a live grant, or it is **deny + `side_effect: false` + audit + denyCount++**. There is no third path.

## Prove deny / audit / no side-effect

From `desktop/src/dsh-desktop`:

```bash
npx vitest run test/abaco-f1-mediacion-broker.test.ts
node --test packages/abaco-effect-broker/tests/f1-mediacion-closeout.test.mjs
```

From repo root:

```bash
python3 -m unittest core.f1.tests.test_effect_broker_contract
```

| Proof | What you should see |
|---|---|
| **Deny** | M1–M10 each return `decision: 'deny'` with a contract reason |
| **0 side-effect** | every deny audit has `side_effect: false`; unload writes no `patch.yml`; revoked grant never reaches `executeAuthorized` fork |
| **Audit** | `getAuditLog()` grows; last event matches the deny |
| **Counter** | `getBrokerStats().denyCount` increments; `allowCount` does not |

M10 is the throw path (poisoned channel getter) → `policy`. The old “M10 happy” case is now **M-happy** (voice `host.fetch` status allow).

## Recorrido Janice (voice)
1. Status GET → `authorize(host.fetch, /api/abaco-voice.local-status)` allow.
2. Transcribe POST → three `authorize()` calls (fetch, `bin:mlx_whisper`, `bin:ffmpeg`) **before** `executeAuthorized`.
3. Pilot worker is executor, not grantor. Voice host has zero `spawn(`.

## Pilot removable without core restart
`unloadAdmittedPlugin('abaco-mediacion-pilot')` is session-only:

- revokes live grants
- subsequent `authorize` → `plugin-disabled`
- `executeAuthorized` refuses (`unauthorized`) with **0 forks**
- `wrote_patch_yml: false`, `wrote_dsh_desktop: false`

Re-enable requires a new process (admission graph stays sealed). This is not rehab of the disabled set.

## Doctrine delta (Anthony 2026-09-21)
Security ≠ stop evolution.

- Unauthorized effects stay fail-closed (M1–M10).
- Admitted plugins keep a **fast path** (voice status / own `ui.slot` / new grant after revoke).
- Authority grows only via explicit `proposeContractEvolution` + `acceptContractEvolution({ hitl: true })`. Silent `compose.mutate` stays deny. Pins stay frozen. Disabled set is never rehabbed (soft-apply).
- Pin rotation remains review-time (`scripts/sign-manifest.mjs`) — no `rotatePin` runtime API.

## Candados still green
- Janice = runtime; **cero Atena** in `authorize()`
- compact **0.90 / 0.12 / 8192** (`G-compact`)
- no rehab of brand / device-identity / cloud-sync / onboarding / experimental
- no Wasm / CAPMAS in this slice
