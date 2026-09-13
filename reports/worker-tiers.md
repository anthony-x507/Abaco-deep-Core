# F2-W4 · Reporte — Trust tiers T0–T4 + disabled list + capability gate

**Worker:** F2-W4 · **Fecha:** 2026-09-13 · **Estado:** PASS (12/12 tests, repro 8/8, exit 0)

## Qué se hizo
- `desktop/src/dsh-desktop/packages/abaco-effect-broker/tiers.js` (nuevo): tabla
  `TIERS` con los 16 nativos, `tierOf()` (−1 si desconocido), `isDisabled()`,
  `DISABLED` (Set, espejo del broker), y `canUseCapability(pluginId, capability)`
  → `{ ok, reason }` con gate por tier mínimo por capability.
- `.../tests/tiers.test.mjs` (nuevo): 12 casos deterministas.
- `reports/repro-tiers.mjs` (nuevo): ANTES vs DESPUÉS, 8 escenarios, exit 0.

Solo cambiaron los 3 archivos permitidos. `index.js` y el resto del broker
no se tocaron (verificación: los únicos archivos nuevos bajo F2-WORK son esos tres).

## Tabla de clasificación (justificada por capabilities, evidencia leída de package.json / index.js / manifest.f1.yml)

Ordinal: T4 (broker, TCB) > T3 (red/spawn) > T2 (privilegiado local) > T1 (local confinado) > T0 (solo presentación).

| Plugin | Tier | Capabilities observadas (evidencia) | Justificación |
|---|---|---|---|
| abaco-theme | 0 | client inject, cero efectos en index.js (grep vacío) | Solo design tokens CSS; ui.slot basta |
| abaco-agent-status | 0 | client inject (`dsh-client-ui-conversation`), cero efectos | Pill "AGENTE TRABAJANDO"; ui.slot basta |
| abaco-brand | 0 | client inject sidebar; metadata/About | Presentación; ui.slot basta. **DISABLED** (broker) |
| abaco-onboarding | 0 | skeleton de 1 línea; wizard sin capabilities | Sin efectos aún. **DISABLED** |
| abaco-cloud-sync | 0 | skeleton de 15 líneas; "backend lands in Fase 3" | Sin efectos aún. **DISABLED** |
| abaco-experimental | 0 | stub de 1 línea; feature flags | Sin efectos. **DISABLED** |
| abaco-observability | 1 | append JSONL a `<DSH_HOME>/logs/abaco-context.jsonl`; "registers no service, adds no tool" | Escritura confinada append-only a su propio dir de logs → `fs.write.confined` |
| abaco-documents | 1 | extracción client-side (pdfjs-dist, mammoth en deps); `spawn('sips', [...fixed args])` index.js:188-200 | Solo lee uploads + spawn **constrainado** (binario fijo, args fijos, sin shell) → `fs.read` + `proc.spawn.constrained`. Sin red |
| abaco-memory | 2 | sidecar store bajo `<DSH_HOME>/abaco-memory` + `abaco_memory_*` agent tools | Registra tools + escribe datos de usuario → `tool.register` + `fs.write` |
| abaco-vault | 2 | `writeFile/appendFile/mkdir` (index.js:275-293,390); vault bajo `<DSH_HOME>/abaco-memory/vault` | `fs.write` general |
| abaco-device-identity | 2 | "backed by macOS Keychain" (package.json) | Identidad estable + secretos = dato sensible → `keychain`. **DISABLED** |
| abaco-context | 2 | instala preset en `<DSH_HOME>/.agent-presets/abaco/` (index.js:27-32) | Escribe configuración de usuario → `fs.write`. (Es instalación de policy owner-locked, no self_modify de código) |
| abaco-browser | 3 | ~8 tools (`navigate/click/type/read_dom/wait_for/state/grab_control/screenshot`) sobre loopback control plane | Manejar un browser web = poder equivalente a red + toma control de UI → `net.fetch`-equivalente |
| abaco-voice | 3 | manifest.f1.yml: `proc.spawn, fs.read, fs.write`; bins mlx_whisper/whisper/ffmpeg; "multi-provider registry" TTS/STT | Spawn real + proveedores externos (red) |
| abaco-mediacion-pilot | 3 | manifest.f1.yml: `proc.spawn, fs.read, fs.write`; `import { fork } from 'node:child_process'` | Celda ejecutora con spawn real |
| abaco-effect-broker | 4 | "authorize() is the only path to protected sinks"; el TCB | `grant.mutate`/`compose.mutate` reservados a T4 |

**Gate de capabilities (mínimo tier):**
`ui.slot/tool.call:0` · `host.fetch/fs.read/fs.write.confined/proc.spawn.constrained/self_modify:1` ·
`tool.register/fs.write/ipc.invoke/keychain:2` · `net.fetch/proc.spawn:3` · `grant.mutate/compose.mutate:4`.
`self_modify` exige tier ≥ 1 (regla del contrato: T0 denegado, T1+ permitido).

**Disabled:** `DISABLED` espeja exactamente `DISABLED_PLUGINS` de `index.js`
(brand, device-identity, cloud-sync, onboarding, experimental). Es copia
literal deliberada — no import — porque el broker hace verificación de
filesystem al importarse y este módulo debe ser puro. La coherencia la
verifica el test (igualdad de sets contra el export del broker).

**Deny-by-default:** `tierOf` desconocido → −1; `canUseCapability` devuelve
`{ok:false, reason:'unknown-plugin'}`; capability desconocida →
`'unknown-capability'`. Disabled gana sobre el tier (brand pide `ui.slot`
→ `plugin-disabled`).

## Evidencia
- `node --test .../tests/tiers.test.mjs` → **12/12 PASS** (incluye: self_modify
  denegado en T0 / permitido en T1; desconocido denegado; disabled →
  isDisabled true + `plugin-disabled`; los 16 clasificados; DISABLED ==
  DISABLED_PLUGINS del broker; grant.mutate solo T4).
- `node reports/repro-tiers.mjs` → **8/8, exit 0**: ANTES (sin tiers, todo
  concedido: experimental→proc.spawn, evil→net.fetch, theme→self_modify)
  vs DESPUÉS (denegado por tier/disabled/desconocido; lo legítimo —
  voice→spawn, vault→fs.write, observability→fs.write.confined, theme→ui.slot —
  sigue permitido).

## Decisiones pendientes (declaradas por escrito para el líder)
1. **cloud-sync re-tier:** hoy T0 por ser skeleton. Cuando el backend de Fase 3
   aterrice (`net.fetch` para sync), debe subir a **T3**. Decisión pedida:
   ¿quién re-clasifica al aterrizar el backend (el worker de Fase 3 o el líder)?
2. **Distinciones finas `proc.spawn.constrained` / `fs.write.confined`:**
   existen para no sobre-privilegiar a documents (T1) y observability (T1).
   Decisión pedida: ¿mantener la taxonomía fina o colapsar a la tabla gruesa?
   Colapsar movería documents→T3 y observability→T2.
3. **Fuente única del disabled set:** hoy es espejo literal verificado por test.
   Decisión pedida para W6: ¿importar `DISABLED_PLUGINS` del broker como fuente
   única o mantener el espejo desacoplado?
4. **Cableado en `authorize()`:** este worker no toca `index.js` por contrato;
   el cableado tiers→authorize (desconocido/deshabilitado→deny) queda para W6.
