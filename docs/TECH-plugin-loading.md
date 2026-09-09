# Mecanismo de carga de plugins UI en el shell DSH — referencia para conectar ABACO

> **Propósito:** preservar los hallazgos de una investigación de solo lectura sobre cómo el shell **DSH Desktop** carga plugins de UI, como referencia accionable para la implementación que conectará los plugins `abaco-*` (voice, documents, cloud-sync, onboarding, theme, brand, device-identity, experimental).
>
> **Fuente:** reporte de subagente de investigación (solo lectura) sobre el árbol DSH Desktop.
>
> **Ancla de rutas:** salvo que se indique lo contrario, todas las rutas de archivo de este documento son **relativas al checkout del shell**:
> `abaco-deep-core/desktop/src/dsh-desktop/`
>
> Las verificaciones de los puntos de anclaje citados (`harness-runtime.ts`, `index.ts`, `build/dsh-desktop.patch.yml`, `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch`, `test/desktop-plugin-closure.test.ts`) se realizaron contra el repo y son exactas.

---

## 1. Flujo de carga

### 1.1 Diagrama de arranque

```text
Launch del .app (Electron)
  │
  ▼
src/main/index.ts:2593-2601
  crea HarnessRuntime{ dshPatchPath = <Resources>/dsh-desktop.patch.yml
                      dshSafePatchPath = <Resources>/dsh-desktop-safe.patch.yml
                      dshHome = <userData>/harness }
  │
  ▼
src/main/runtime/harness-runtime.ts:369-399
  elige patch (safe si perfil de recuperación, si no el normal)
  mkdir $DSH_HOME  · reserva puerto  · escribe log  · setState('starting')
  │
  ▼
harness-runtime.ts:184-200 (buildHarnessArguments)
  args = [ 'web', '--patch', '<Resources>/dsh-desktop.patch.yml',
           '--no-open', '--host', '127.0.0.1', '--port', <puerto> ]
  │   (perfil por defecto = 'web'; solo se usa --profile/--patch en recovery)
  ▼
dsh-app-boot (lib/index.js)
  · 847-880 : aplica el patch como OVERLAY ESTÁTICO: compone filas de loader
              (disable + insert {id, name}) sobre los bundles del perfil
              + su cordis.patch.yml. No genera ni instala nada en el perfil.
  · 588-676 : mirror de la closure de dependencias de @deepseek-ai/dsh hacia
              $DSH_HOME/profiles/node_modules (symlinks verificados).
  │
  ▼
Perfil web real:  bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]
                  deps    = { dshmarket }
                  @deepseek-ai/dsh-web-app/cordis.patch.yml = "browser plugin roster"
                  (filas ui-*, líneas 151-306)
  │
  ▼
Cada paquete con dsh.client.inject + exports["./client"] →
  el loader carga client.js en la ventana → ctx.slots.inject(...) en un slot REAL
```

### 1.2 Explicación

- **El harness arranca cada vez con `web --patch <Resources>/dsh-desktop.patch.yml`.**
  - `src/main/runtime/harness-runtime.ts:184-200` — `buildHarnessArguments()` compone los args: `web` (perfil por defecto), `--patch <patchPath>`, `--no-open`, `--host 127.0.0.1`, `--port <puerto>`.
  - `src/main/runtime/harness-runtime.ts:369-399` — en `start()`, el patch se selecciona según perfil (`dshSafePatchPath` para el perfil de recuperación, `dshPatchPath` en cualquier otro caso), se valida su existencia, se crea `$DSH_HOME`, se reserva puerto y se lanza el proceso con esos argumentos.
  - `src/main/index.ts:2597-2598` — los paths de ambos patches apuntan a recursos del bundle: `desktopResourcePath('dsh-desktop.patch.yml')` y `desktopResourcePath('dsh-desktop-safe.patch.yml')`.

- **El patch es un overlay estático**, no un generador ni un instalador de perfil:
  - `dsh-app-boot/lib/index.js:847-880` compone las **filas de loader** (`disable` + `insert {id, name}`) sobre los bundles del perfil y su `cordis.patch.yml`.
  - No crea paquetes ni los instala en el perfil: cada `name` que se inserta debe ser **resoluble desde el perfil** (ver requisitos abajo).

- **Requisitos para que un paquete con `dsh.client.inject` aparezca en la UI** (los cuatro son obligatorios):
  1. **(a) Fila de loader**: una entrada `insert: [{id, name}]` en `build/dsh-desktop.patch.yml` (o en el patch que componga el arranque).
  2. **(b) Resoluble desde el perfil**: el paquete debe alcanzarse desde `$DSH_HOME/profiles/...`. Hay dos vías válidas:
     - **Inyección en el manifiesto de `@deepseek-ai/dsh`** → el boot lo *mirror* a `$DSH_HOME/profiles/node_modules` (symlinks), o
     - **dependency pnpm del perfil** (cuando el perfil se instala con su propio manifiesto).
  3. **(c) Manifiesto correcto**: `package.json` con `dsh.client.platform: "web"` y `exports["./client"]` que apunte al client del plugin.
  4. **(d) `client.js` autocontenido**: la factory solo puede `require` ids de la *module-table* del runtime (`react`, `@deepseek-ai/*`) — **nunca** rutas relativas a otros módulos del paquete ni librerías externas.

- **Cómo llegan los 4 `dsh-desktop-*` legítimos** (patrón de referencia a replicar con `abaco-*`):
  1. **Inyección build-time**: `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch:7-14` añade `dsh-desktop-client-ui`, `dsh-desktop-hmr-fallback`, `dsh-desktop-market-installer` y `dsh-desktop-preset-transfer` (además de `dsh-ppt-composer`) a las `dependencies` del manifiesto de `@deepseek-ai/dsh`. Se aplica con **patch-package en el postinstall** de `npm i`.
  2. **Mirror en boot**: `dsh-app-boot/lib/index.js:588-676` replica la closure de dependencias de `@deepseek-ai/dsh` (incluidos los inyectados) en `$DSH_HOME/profiles/node_modules` como symlinks.
  3. **Filas `insert` del `--patch`**: `build/dsh-desktop.patch.yml` los monta como filas de loader en el arranque.

- **El perfil web real**: `bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]` con `deps: { dshmarket }`. El `cordis.patch.yml` de `@deepseek-ai/dsh-web-app` actúa como **"browser plugin roster"**: sus filas `ui-*` (líneas 151-306) son las que montan la UI de conversación, layout, sidebar, settings, etc.

---

## 2. Slots REALES disponibles (tabla)

> **Verificado en:** `node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js` del árbol instalado (la verificación se hizo sobre los paquetes instalados, no sobre fuentes del repo).

### 2.1 Slots clave (confirmados)

| Slot | Dónde | kind / scope | props |
|---|---|---|---|
| `conversation.composer.bar` | barra del composer | single / session-maybe | — |
| `conversation.input.left` | lado izquierdo del input (iconos) | list / session | `{}` |
| `conversation.input.right` | lado derecho del input (iconos) | list / session | `{}` |
| `conversation.input.plan` | — | single / session | — |
| `conversation.input.model` | selector de modelo junto al input | single / session | — |
| `conversation.input.attachments` | zona de adjuntos del input | single / session | **ocupado por `ui-attachment`** (tiene su propia API de imágenes) |
| `conversation.input.overlay` | overlay del input | single / session | — |
| `conversation.input.dock` | dock del input | single / session | — |
| `conversation.composer.dock` | dock del composer | single / session | — |
| `conversation.input.dock` | — | single / session | — |
| `conversation.composer` | cadena del composer | chain / session | claim por `pendingInteraction` (flujo de approval / subagent) |
| `conversation.chat.assistant-actions` | acciones bajo un mensaje del asistente | list / session | `{messageId}` |
| `conversation.chat.node` | nodos del chat | keyed | — |
| `conversation.turnTail` | cola del turno | chain | — |
| `conversation.hero.brand.mark` | marca en el hero | — | — |
| `conversation.workspace` | — | — | — |
| `conversation.hero.agentPreset` | preset de agente en el hero | — | — |
| `sidebar.brand.mark` | marca en el sidebar | — | — |
| `sidebar.brand.name` | nombre en el sidebar | — | — |
| `sidebar.workspaces` | lista de workspaces | — | — |
| `sidebar.settings` | entrada de settings en el sidebar | — | — |
| `sidebar.footer.action` | acciones del pie del sidebar | — | — |
| `settings.section` | páginas de settings | — | — |
| `settings.general.item` | filas del panel *General* | — | — |
| `settings.plugins.tab` | pestaña de plugins en settings | — | — |
| `plugin.item` | ítem de plugin | — | — |

### 2.2 Slots que NO existen (no buscar usarlos)

| Slot inexistente | Alternativa real |
|---|---|
| `message.actions` | `conversation.chat.assistant-actions` |
| `settings.advanced.item` | `settings.section` propia o `settings.general.item` |
| `conversation.submit` | la cadena `conversation.composer` (verificar empíricamente) o inyectar draft |
| `sidebar.item` / `sidebar.nav.item` | `sidebar.footer.action`, `sidebar.workspaces`, … |

---

## 3. Patrón exacto de un plugin funcional

### 3.1 `package.json`

```jsonc
{
  "name": "<package-name>",
  "version": "…",
  "dsh": {
    "client": {
      "inject": ["<lista-de-targets-o-slots-objetivo>"],
      "platform": "web"
    }
  },
  "exports": {
    "./client": "./client.js"
  }
}
```

### 3.2 `index.js` (host / half)

```js
export function apply() {}
```

### 3.3 `client.js` (cargado por el loader en la ventana)

```js
window.__ModuleLoader__.load({
  id: '<package-name>',
  factory: (require) => {
    const React = require('react')
    function apply(ctx) {
      // ctx.slots.inject('<slot-real>', () => ctx.slots.inject(…))
    }
    exports.apply = apply
    return module.exports
  }
})
```

### 3.4 Inyección con "face" + cleanup (patrón del ejemplo `message-feedback`)

```js
const dispose = ctx.slots.register(
  { name: '<slot>', id, order, inject: (sessionId) => ({ …hooks }) },
  Component
)
// devolver dispose para limpiar al desmontar
```

Notas:

- El `require` disponible en la factory es el de la **module-table** del runtime: solo ids como `react` o `@deepseek-ai/*`. Cualquier `require('./lib/…')` o dependencia externa no registrada rompe el cierre.
- `inject` puede recibir el `sessionId` (y la API varía por slot: `register`/`inject` devuelve un `dispose` para cleanup).
- El bloque ABACO actual en `build/dsh-desktop.patch.yml` (líneas 64-109) ya monta filas `insert` para `abaco-theme`, `abaco-brand`, `abaco-device-identity`, `abaco-voice`, `abaco-documents`, `abaco-cloud-sync`, `abaco-onboarding` y `abaco-experimental`; además define filas `disabled` para los occupants sustituidos.

---

## 4. Vía MÍNIMA para conectar ABACO (5 pasos)

1. **Inyección build-time** de los paquetes `abaco-*`:
   - Añadir las deps `abaco-*` a `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` (bloque `dependencies` de `@deepseek-ai/dsh`), exactamente como ya se hace con los `dsh-desktop-*` (líneas 7-14 del patch).
   - **El test `test/desktop-plugin-closure.test.ts:35-49` lo exige**: comprueba que cada `name` montado en `build/dsh-desktop.patch.yml` aparezca como `+    "<name>":` en el patch del `dsh`, y que esté declarado como dependency local `file:packages/…` en el `package.json` del shell. Sin la inyección el test falla.
   - Reinstalar (`npm i` → corre el postinstall → patch-package aplica el patch) y **re-empaquetar** el .app → `Resources/app/node_modules/abaco-*` + symlinks en `$DSH_HOME/profiles/node_modules`.

2. **Reescribir cada `client.js` como bundle autocontenido**:
   - Eliminar `require('./lib/…')` y toda dependencia externa pesada (p. ej. `pdfjs`, `mammoth`).
   - Mover la extracción de documentos/texto al **host half** / IPC o a workers (fuera del `client.js`), dejando en el cliente solo lo que requiera `react` / `@deepseek-ai/*`.

3. **Corregir los slots objetivo** (mapeo concreto):
   - **voice · mic** → `conversation.input.left`.
   - **voice · speak** → `conversation.chat.assistant-actions` (filtrar por contenido del mensaje; props `{messageId}`).
   - **settings** → `settings.general.item` o una `settings.section` propia.
   - **documents**: **NO registrar en `conversation.input.attachments`** — es `single` y ya lo ocupa `ui-attachment` (con API de imágenes propia). Alternativas: `conversation.input.left/right`, `conversation.input.dock` o `conversation.composer.dock`; o **deshabilitar `ui-attachment`** vía patch y registrar un `single` propio.
   - `conversation.submit` **no existe** — para intervenir el submit, verificar empíricamente la cadena `conversation.composer` o inyectar draft en el input.

4. **Mantener el bloque ABACO** en `build/dsh-desktop.patch.yml:64-109` y conservar las filas `disabled` para los occupants sustituidos (los plugins upstream que se reemplazan o quitan).

5. **Rebuild + verificación empírica**:
   - Symlinks presentes en `$DSH_HOME/profiles/node_modules/abaco-*`.
   - `GET /plugins/abaco-*/client.js` → HTTP 200 en la sesión del harness.
   - Filas `__DSH_BOOT__` contienen los `abaco-*`.
   - La UI muestra los elementos inyectados en los slots reales.
   - Logs del harness sin errores de loader (`Cannot find package …`, factory throw, etc.).

---

## 5. Riesgos y ambigüedades (resumen)

| # | Riesgo / ambigüedad | Impacto | Mitigación |
|---|---|---|---|
| 1 | **Sin inyección, el fork empaquetado no arranca con filas `abaco-*`**: boot a `Cannot find package` | Todo el árbol de plugins falla, no solo la fila | Mantener paso 4.1 + test `desktop-plugin-closure.test.ts` verde antes de empaquetar |
| 2 | **El `.app` instalado actual es la build vieja `0.1.2-alpha.1`** sin `abaco-*` | Las pruebas sobre el binario instalado no reflejan el código nuevo | Verificar contra la build re-empaquetada (nunca contra el `.app` instalado histórico) |
| 3 | **`client.js` con formato incompatible** (`require` relativos, libs externas) | El loader no resuelve la factory; la UI queda sin el plugin y ensucia los logs | Paso 4.2: bundle autocontenido; extracción al host half / IPC / workers |
| 4 | **`conversation.input.left/right` solo se renderizan con session activa** | El plugin parece "no cargar" si no hay conversación abierta al validar | Validar con una sesión activa; elegir slots no condicionados cuando aplique |
| 5 | **El mirror `$DSH_HOME/profiles/node_modules` se reconcilia en boot** | Cambiar el manifiesto de `@deepseek-ai/dsh` (o añadir deps) no tiene efecto hasta un **re-boot limpio** del harness | Tras tocar manifiestos/patches: reiniciar el harness por completo antes de validar |

---

## Apéndice A — Puntos de anclaje verificados

| Qué | Dónde (relativo al shell) | Estado |
|---|---|---|
| Args `web --patch …` | `src/main/runtime/harness-runtime.ts:184-200` | ✅ verificado |
| Selección de patch + arranque | `src/main/runtime/harness-runtime.ts:369-399` | ✅ verificado |
| Paths de patch en el bundle | `src/main/index.ts:2597-2598` | ✅ verificado |
| Composición del overlay (loader rows) | `dsh-app-boot/lib/index.js:847-880` (fuera del repo) | según reporte |
| Mirror de closure → `profiles/node_modules` | `dsh-app-boot/lib/index.js:588-676` (fuera del repo) | según reporte |
| Inyección build-time de los 4 `dsh-desktop-*` | `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch:7-14` | ✅ verificado |
| Roster `ui-*` del perfil web | `node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:151-306` (fuera del repo) | según reporte |
| Bloque ABACO + inserts | `build/dsh-desktop.patch.yml:64-109` | ✅ verificado |
| Test de cierre (inyección obligatoria) | `test/desktop-plugin-closure.test.ts:35-49` | ✅ verificado |
