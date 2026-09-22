# CONTRACT F1 SLICE — Broker + grants + admission (Deep Harnes)

**fecha:** 2026-09-11 (checked in 2026-09-22 for Control 1 closeout)  
**padre:** `CONTRACT-F1-MEDIACION-DEEP.md`  
**repo:** `anthony-x507/Abaco-deep-Core`

Pregunta de mediación: *¿puede este plugin producir un efecto protegido sin atravesar el punto que autoriza ese efecto?* Si sí, la frontera está incompleta.

## Identidad
El caller no se cree. Se deriva del **canal**. Cualquier `plugin_id` en el body se ignora.

## Autoridad
`A_efectiva = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política`  
`A_plugin(id) = Inject(id) ∩ PatchEnabled(id) ∩ PreloadReach(id) ∩ ManifestCaps(id)`

## API
`authorize()` is the only authorizer. Timeout / throw = deny. Atena never lives there. Janice = runtime.

## Suite fail-closed (M1–M10)
| ID | Setup | Assert |
|---|---|---|
| M1 | efecto sin identidad de canal | deny `no-identity`; 0 side-effect; audit |
| M2 | plugin disabled pide `host.fetch` | deny `plugin-disabled` |
| M3 | ctx / bag no inyectado | deny `inject-undeclared`; CI grep `window.__abaco_ctx\s*=` FAIL |
| M4 | canal preload no allowlist | deny `preload-not-allowlisted` |
| M5 | skill/tool-result pide `tool.register` | deny `skill-cannot-register-tool`; #tools invariante |
| M6 | untrusted → `proc.spawn` / `fs.write` / hop | deny `data-as-control` |
| M7 | grant TTL expirado / revoked | deny; revoke→deny ≤1s |
| M8 | body `plugin_id` forjado ≠ canal | se ignora; identidad = canal |
| M9 | ampliar caps en PATCH semver sin HITL | no load / deny `compose-mutate-forbidden` |
| M10 | broker throw / timeout | deny (fail-closed) |

4 asserts en cada deny: `decision === 'deny'` · `side_effect === false` · `AuditEvent` emitido · contador (denyCount y/o breaker) movió.

Canonical reason enum: `docs/contracts/f1-broker-deny-reasons.json`.
