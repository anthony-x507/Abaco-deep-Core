# CONTRACT F1.5 — MCP schema pin/witness (Deep Harnes)

| Campo | Valor |
|-------|--------|
| **fecha** | 2026-09-17 (ET) |
| **autor** | ARQUITECTO (Plugins Frontier) · gate tip = UNIVERSAL ARQUITECTO PASS escrito |
| **impl** | UNIVERSAL INGENIERO |
| **repo** | `anthony-x507/Abaco-deep-Core` |
| **padre** | `CONTRACT-F1-MEDIACION-DEEP.md` · `CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md` · `CONTRACT-F2.1-C-STT-MAC.md` (lista F1.5 como siguiente) · voto Astra Frontier |
| **orden** | Leader: finish ALL Plugins Frontier — after F2.1 A+B+C (utilityProcess strangler) → **F1.5 MCP schema pin/witness** |
| **estado** | **LOCK de gate** (listo cuando el PR esté verde). Merge = **HOLD** hasta Leader. |

## Meta

Un servidor MCP no puede **ampliar autoridad** mutando el `inputSchema` que publicó en `tools/list`, ni registrando un tool `mcp__*` que nadie atestiguó.

El harness **hashea y fija** (pin) el schema canónico de cada tool MCP testigo. Listados posteriores cuyo digest no coincide, o nombres sin pin, se **niegan fail-closed**. El deny queda en audit (`side_effect: false`).

**Janice** = runtime (piloto + wrap de `ctx.tools.register` + este módulo). **Atena** = asesor, **cero** en `authorize()` y **cero** en `verifyMcpToolSchema` / wrap.

## Alcance (solo esto)

| In | Out |
|----|-----|
| Pin/witness de schemas MCP (`mcp__<server>__<tool>`) | Fork / patch de `@deepseek-ai/dsh-mcp-client` |
| Wrap fail-closed de `ctx.tools.register` (servicio compartido) | Activar conectores third-party / filas `mcp-client` en el patch |
| `authorize()` niega `tool.register`/`tool.call` MCP sin pin o con drift | Atena en hot-path · rehab de `DISABLED_PLUGINS` |
| Audit en deny (memoria + JSONL bajo `$DSH_HOME`, **no** perfil dsh-desktop) | Bump de versión · Release · tocar perfil usuario |
| Tests del pin API + wrap + gates G1–G9 | Re-pin UX, wrap de `tools/call` execute |

## Qué se fija (pin)

Para cada tool MCP, el pin es `sha256` del JSON **canónico** (claves ordenadas, recursivo) de **`parameters` / `inputSchema`**.

| Campo | ¿Entra en el digest? | Por qué |
|---|---|---|
| `name` público (`mcp__…`) | clave del almacén, no del hash | identidad estable |
| `parameters` / MCP `inputSchema` | **sí** | es la autoridad del call |
| `description` | no (vive fuera del objeto hasheado si el host no la mete en `parameters`) | no amplía el call |
| `output` / `outputSchema` | no | no amplía lo que el modelo puede *pedir* |

**Set shipped = `{}`.** No hay pines de terceros. Un MCP que aparezca sin `pinMcpTool({ attestor: 'host' \| 'user' })` es `schema-unwitnessed`.

Attestors que **no** pueden pin: `plugin-data`, `untrusted`. Rotar un pin existente exige `rotate: true` **y** `attestor: 'host'`.

## Camino

```
mcp-client syncTools
    tools/list  →  ctx.tools.register(definition)
                       │
                       ▼
         wrap (Janice, abaco-mediacion-pilot.apply)
              name starts with mcp__ ?
                 no  → register as today (abaco_*, stock)
                 yes → verifyMcpToolSchema(name, parameters)
                         pin miss     → throw fail-closed  (0 registry write)
                         digest drift → throw fail-closed
                         match        → original.register

authorize(tool.register|tool.call, resource=mcp__*)
    same verify  → deny reason + audit   (Atena no se llama)
```

El wrap muta el **servicio** `tools` (no un wrapper local), así un `dsh-mcp-client` que cargue después — si el operador lo añade — choca con el mismo testigo. Este pack **no** añade esa fila.

## Reglas

1. **Fail-closed.** Un-witnessed, drift, o expansión de autoridad → deny. Cero side-effect. El usuario/host ve el error; el tool no entra al catálogo.
2. **Expansión de autoridad** (clasificación de audit, igual de deny que el drift): property extra, `additionalProperties: true` cuando el pin no lo era, `required` caído, type widened, enum extra.
3. **Cero Atena en authorize / verify / wrap.** El stub `atena-advise.js` existe para que el asesor **no** se cuele por un import. Janice = runtime.
4. **Broker intacto.** `authorize()` sigue siendo el único grantor. El wrap no emite grants. El piloto sigue sin `issueTaskGrant`.
5. **Candados.** Compact 0.90 / 0.12 / 8192 intacto. No `~/Library/Application Support/dsh-desktop/`. No reactivar `DISABLED_PLUGINS`. No bump. No Release. No conectores third-party.

## Gates de aceptación (PASS tip)

| # | Gate | PASS cuando |
|---|------|-------------|
| G1 | Canonical | mismo schema, distinto orden de claves → mismo sha256 |
| G2 | Pin vacío shipped | `PINNED_MCP_SCHEMAS === {}`; pin host + listado idéntico → allow |
| G3 | Un-witnessed | `mcp__*` sin pin → `schema-unwitnessed` + audit `side_effect: false` |
| G4 | Attestor | `plugin-data` / `untrusted` no pueden pin (`schema-pin-unattested`) |
| G5 | Drift / expansión | property extra o `additionalProperties: true` → `schema-authority-expansion`; pin write-once |
| G6 | Wrap | `abaco_*` pasa; `mcp__*` sin pin lanza fail-closed (0 write); piloto `apply` instala el wrap |
| G7 | Broker | `authorize(tool.register, mcp__*)` sin pin → deny + audit; M5 no-MCP intacto |
| G8 | Naming | Atena ∉ `authorize()` ni `index.js` del pin; Janice = runtime |
| G9 | Plugin-safe | disabled set intacto; patch **sin** `dsh-mcp-client`; compact lock; version 0.4.26 |

## HOST WIRING NEXT (no este slice)

El registro MCP **sí** queda cubierto: `dsh-mcp-client` llama `ctx.tools.register` y el wrap del piloto (ya en `dsh-desktop.patch.yml`) intercepta el servicio compartido. **No** hace falta fork del tgz.

Lo que **falta** a propósito:

1. **Execute-time (`tools/call`).** El pin cubre el schema *publicado*. Un server que ignore su propio schema en el call no se re-verifica aquí. Siguiente: wrap del `execute` / args contra el pin (sigue sin fork si se hace en el wrap o en el broker `tool.call` con `schema`).
2. **Rotación de pines.** Hoy write-once salvo `rotate && attestor==='host'`. Falta UX / HITL para re-testigo tras un cambio legítimo de schema.
3. **Defense in depth en `syncTools`.** Un patch de `@deepseek-ai/dsh-mcp-client` que llame `verifyMcpToolSchema` *antes* del swap sería redundante con el wrap. No se hace en F1.5 (sería fork del tgz).
4. **No habilitar `mcp-client` en el patch / perfil.** Sigue opt-in del operador. Un-witnessed = deny.

## Anclas en el árbol (no son el contrato; el contrato manda)

| Pieza | Dónde |
|---|---|
| Pin / verify / wrap | `desktop/src/dsh-desktop/packages/abaco-mcp-schema-pin/index.js` |
| Atena stub (fuera del hot-path) | `…/abaco-mcp-schema-pin/atena-advise.js` |
| Tests G1–G9 | `…/abaco-mcp-schema-pin/tests/schema-pin.test.mjs` |
| Install wrap (Janice host) | `…/abaco-mediacion-pilot/index.js` `apply(ctx)` |
| Broker consult | `…/abaco-effect-broker/index.js` `authorize()` — razones `schema-*` |
| MCP host (no forkeado) | tgz `@deepseek-ai/dsh-mcp-client` → `syncTools` → `ctx.tools.register` |

*Fin CONTRACT F1.5 — ARQUITECTO Frontier.*
