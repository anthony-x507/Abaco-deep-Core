# HANDOFF — FASE 5 (ABACO DEEP HARNES)

**Para:** el siguiente agente. **De:** el agente que cerró la Fase 1 (fontanería viva).
**Estado de lectura:** `main` @ `1952463`, árbol de trabajo **limpio** (`git status --short` vacío) al escribir esto.
**Regla de lectura de este documento.** Cada afirmación lleva marca: **[V]** = verificado por mí hoy, con el comando y la salida citados; **[NV]** = no verificado por mí, heredado o inferido (dilo así, no lo presentes como hecho); **[REPORTADO]** = dicho por el dueño o por un agente anterior, sin comprobación independiente.

**Documentos fuente de verdad (léelos enteros antes de tocar nada; este handoff no los sustituye):**

| Documento | Qué manda de él |
|---|---|
| `docs/SPEC-CONTEXT-3-LAYERS.md` | Las 3 capas y los principios A/B/C/D. **Su §8 (`:265`) es el LOCK del dueño** y manda sobre §3 y §4. |
| `docs/COLLABORATOR-CRITERIA.md` | Criterio del arquitecto colaborador externo y **el orden de trabajo acordado (§12)**. |
| `docs/DECOUPLING.md` | Qué es dependencia, qué es plugin, qué exige fork. |
| `docs/HANDOFF-TO-COLLABORATOR.md` | El estado que se le envió al colaborador. |
| `docs/PLAN-TRABAJO.md` | Plan vivo. **Ojo: su §2 y los números de tests están desactualizados** (ver §10). |
| `docs/DESIGN-memory-3layer.md` | Diseño de memoria, 956 líneas, validado contra el motor. |

---

## 1. Qué es ABACO y dónde vive cada cosa

**ABACO DEEP HARNES** es una app de escritorio (Electron) construida sobre **DeepSeek Harness (DSH)**, un agente cuyo sistema de extensiones es **Cordis**: todo es una fila en una composición, y cada plugin aporta servicios, tools, UI (en *slots*) y secciones de system prompt. El producto tiene además un **core en Python** (sync, voz, empaquetado, pairing).

Lo que el dueño quiere que tenga: navegador Chrome integrado **en una columna a la derecha**, botones de voz y de subir documentos **en la caja de escribir**, pairing con el teléfono por QR, grabación de pantalla que **dispare al agente a crear un skill**, y **memoria de contexto de 3 capas**.

### Rutas

| Qué | Dónde |
|---|---|
| Repo | `/Users/a507/Documents/New project/ABACO_PYTHON_CORE/abaco_core/abaco-deep-core` |
| Remote | `https://github.com/anthony-x507/Abaco-deep-Core.git` (rama `main`) |
| Fork del shell Electron | `desktop/src/dsh-desktop/` |
| Parche de composición (filas de plugins) | `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml` |
| Plugins ABACO | `desktop/src/dsh-desktop/packages/abaco-*/` |
| Parches al motor | `desktop/src/dsh-desktop/patches/` (`patch-package`) |
| Core Python | `core/` (dentro del repo de arriba) |
| **App instalada** | `/Applications/ABACO DEEP HARNES.app` |
| **Motor instalado — copia AUTORITATIVA (`$DSH_NM`)** | `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai/` — el código que ABACO **ejecuta de verdad**; es la copia que manda para citar líneas (ver §7.12) |
| **Perfil de ABACO** (`$DSH_HOME`) | `~/Library/Application Support/abaco-deep-core/harness/` |
| **Log real de la app** | `~/Library/Logs/ABACO DEEP HARNES/harness.log` |
| Preset instalado | `<perfil ABACO>/.agent-presets/abaco/agent.cordis.yml` |
| Perfil AJENO — **INTOCABLE** | `~/Library/Application Support/dsh-desktop/` (app DeepSeek; aloja otra sesión viva) |

> **Convención de rutas — `$DSH_NM`, definida aquí y no implícita.** `$DSH_NM` = `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai/` — la copia del motor que **ABACO ejecuta**, y por tanto la **AUTORITATIVA** para toda cita `archivo:línea` que describa el comportamiento de ABACO. Hay **tres** copias del árbol `@deepseek-ai` en esta máquina y dos pertenecen a **aplicaciones distintas**; el mismo nombre `$DSH_NM` se venía usando resolviéndolo a la de la app **DeepSeek Desktop**, que es **otro producto** y **no tiene autoridad** sobre ABACO. Hoy las tres son byte-idénticas, pero la cita nombra **siempre** la autoritativa. Trampa y procedimiento si algún día divergen: **§7.12**.

**Identidad instalada [V]:** `CFBundleShortVersionString` = `0.4.0`, `CFBundleIdentifier` = `io.abaco.deepcore`. `codesign -dv` → `Authority=Developer ID Application: Anthony Sanchez (GKPMCWHU2H)`, `TeamIdentifier=GKPMCWHU2H`. `spctl -a -vvv` → **`rejected`, `source=Unnotarized Developer ID` (exit 3)**.

---

## 2. El drama y la causa raíz

Durante días, **dos agentes anteriores se llenaron de contexto y empezaron a alucinar**, dejando trabajo sin terminar. La causa raíz se midió: **el plugin de contexto se escribió contra APIs imaginadas, y sus tests usaban dobles que confirmaban la imaginación.** Verde en tests (26/26), muerto en producción, y **fallando en silencio**.

### Bug 1 — el árbol de plugins entero se caía (`3ddbe73`)
Cordis **recolecta el valor de retorno del body de un plugin como *effect***. Solo vale una función o `undefined`; cualquier otra cosa lanza `TypeError: Invalid effect` (`$DSH_NM/cordis/lib/index.js:1139`, vía `effect.then(safeCollect)` en `:1143`). El `apply` de `packages/abaco-context/index.js` estaba declarado **`async` y devolvía un objeto** → `Invalid effect` → **cae el árbol completo** → la app entra en **Safe Mode**, que bloquea los bundles de terceros → **el usuario no veía NINGUNA función de ABACO**.
**Arreglado en `3ddbe73`**: `apply` síncrono que devuelve `undefined`, el callback de `ctx.inject` no devuelve la promesa, y hay dos tests de regresión.

### Bug 2 — el preset se instalaba pero nunca gobernaba (`7936852`)
`packages/abaco-context/index.js:216` hacía:

```js
const registration = rosterCtx.agentPresets?.settings?.()
```

`settings` es una **PROPIEDAD** — un `SettingsScope` con `get/watch/update/replace` — **no una función**. Y además es `undefined` en el instante en que corre ese callback, porque el plugin de presets asigna su `settings` dentro de su **propio** `ctx.inject(["settings"], …)` (`$DSH_NM/dsh-agent-presets/lib/index.js:1311`). Sonda medida: en `t0` devuelve `{ status: 'unavailable' }` — **en silencio**; a los 3 s lanza `TypeError: ap?.settings is not a function`. El `catch` solo escribía un `warn` que nadie lee (`index.js:239`) y `'unavailable'` es un estado legal → **el default nunca se adopta** → el `settings.yaml` del perfil de ABACO nunca recibe `agent-presets: default: abaco` → **el preset se instala pero nunca gobierna**.
**Arreglado en `7936852`.**

### La cadena causal completa
Capa 1 gobernada por `0.80` en vez de la política del dueño → los agentes se llenan de contexto antes de lo previsto → compactaciones con un resumen que el propio prompt del motor pide en **prosa** (`dsh-compaction-basic/lib/index.js:248`, contradiciendo `:221`) → **y con los errores truncados y resumidos** (Principio D inexistente) → el agente pierde la evidencia y el hilo → **alucina**.
**Nada de eso era el diseño de tres capas. Era fontanería.**

### El patrón a desterrar: los dobles que mienten
Un test que usa un doble con una **forma inventada** es **peor que no tener test**: certifica una API que no existe y desplaza la búsqueda del bug a producción, donde falla en silencio. **El contrato real se verifica leyendo el paquete instalado**, nunca el doble. Y **todo camino de fallo tiene que ser ruidoso**.

---

## 3. Estado verificado

### Fontanería (paso 1 del orden — **HECHO**)
- Commit del cableado de la política: **`1952463`** `fix(desktop): wire the owner-locked 0.90/0.12/8192 compaction policy into the abaco preset`. Commit del Bug 2: **`7936852`**. Commit del Bug 1: **`3ddbe73`**.
- **Preset instalado y gobernando [V].** `<perfil ABACO>/settings.yaml` contiene **exactamente**:
  ```yaml
  agent-presets:
    default: abaco
  ui-onboarding:
    welcomeNoticeVersion: 2026-08-13.1
  ```
- **Preset en disco [V]:** `<perfil ABACO>/.agent-presets/abaco/agent.cordis.yml` (17.244 bytes), con **`thresholdRatio: 0.9` (`:204`), `retainRatio: 0.12` (`:205`), `maxTokens: 8192` (`:206`)**. Los valores muertos (`0.6 / 0.08 / 16384`) ya no están.
- **Marcadores de instalación [V]:** `.agent-presets/.abaco-context.json` → `{"presetId":"abaco","contentHash":"09aba127…","installedAt":"2026-09-10T21:54:36.291Z"}`; y `.abaco-context-default.json` → `{"applied":true,"presetId":"abaco","replaced":"standard","at":"2026-09-10T21:34:14.122Z"}`.
- **Log real [V]** (`~/Library/Logs/ABACO DEEP HARNES/harness.log`, 2.824 bytes): el arranque más reciente es `[desktop] starting 2026-09-10T21:54:34.196Z` **desde `/Applications/ABACO DEEP HARNES.app`** (la build instalada, no `dist/`), con `[desktop] profile web` — **NO Safe Mode** —, `DSH_HOME=/Users/a507/Library/Application Support/abaco-deep-core/harness`, `[harness-node] DSH entry loaded`, y **0 ocurrencias de la cadena `error`** en todo el fichero. Hay un arranque anterior (21:34) desde `dist/mac-arm64/` que también dice `profile web`.
- **Suite del proyecto de escritorio [V]:** la ejecuté yo: **903 tests en 95 ficheros, todos pasan** (`Test Files 95 passed (95) / Tests 903 passed (903)`, exit 0, 10,16 s). Comando real (ver §8: `npx`/`npm run` están rotos en este shell):
  ```bash
  cd desktop/src/dsh-desktop
  env -u ELECTRON_RUN_AS_NODE PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    /usr/local/bin/node node_modules/vitest/vitest.mjs run
  ```

### Motor (medido sobre el paquete instalado)
- Stock de fábrica [V]: `DEFAULT_THRESHOLD_RATIO = .8` (`dsh-compaction-basic/lib/index.js:13`), `DEFAULT_RETAIN_RATIO = .16` (`:15`).
- Cálculo del par de tokens [V] (`resolveCompactSpec`, `:111-112` — la cita `:109-111` estaba desfasada para `retainTokens`): `thresholdTokens = floor(contextWindow * thresholdRatio)` (`:111`). Para la retención, **el precedente es `:112`**: `policy.retainTokens === undefined ? floor(contextWindow * policy.retainRatio) : policy.retainTokens` — el **absoluto gana si está definido**; el `floor(contextWindow × retainRatio)` es **solo el respaldo**. Con la fila del lock (solo `retainRatio 0.12`) → `1000000 × 0.90 / 0.12` → `900000 / 120000`. **La aritmética está confirmada; el `contextWindow` de 1.000.000 es [REPORTADO], no re-verificado por mí** (ver §10).
- **Camino fatal del ratio confirmado [V]:** `validateRatioRetention` (`:132-134`) lanza **`throw new Error(...)`** en **load**, que **no** es `TargetPressureConfigError` y **no se captura** → tumba el árbol entero → Safe Mode. El camino benigno (`TargetPressureConfigError`, warning-only) es el de **runtime** (`:111`). El comentario del preset que decía que esto solo registra un warning **mentía**; ya está corregido, pero **la lección es que los comentarios también alucinan**.
- **Principio D inexistente [V]:** `grep -c isError` sobre `$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js` → **0**.
- **Hueco del subagente confirmado [V]:** en `$DSH_NM/dsh-subagent/lib/index.js`, `notifySettlement` está en **`:1761`** e inyecta **`...terminal.output` sin ningún tope** en un `user/message` en **`:1777`**. Sin cap, sin pasar por `tools/post-execute`, sin spill. **⚠️ La línea citada en `COLLABORATOR-CRITERIA.md:89` y `HANDOFF-TO-COLLABORATOR.md:154` es `:1725-1742`, que NO coincide** con ninguna de las **tres copias** del motor en esta máquina (§7.12: la del bundle de ABACO, la de `DSH Desktop.app` y el `node_modules` del repo, byte-idénticas entre sí, y las tres con `:1761`/`:1777`). Usa `:1761-1777` y trata `:1725-1742` como cita desfasada.
- **Notarización [NV/EXTERNO]:** `spctl` la rechaza por no notarizada. Hay **envíos atascados del lado de Apple**, algunos de más de 9 horas (submission `7559ef09-16be-4af0-8807-e31522490938`). **Es un bloqueo externo, no de código.** No lo persigas como bug.

### Lo que NO existe
- **`abaco-observability` no existe [V]:** no está en `desktop/src/dsh-desktop/packages/` ni referenciado en `build/dsh-desktop.patch.yml` ni en `package.json`.
- **La capa 2 está construida y VACÍA [V]:** `<perfil ABACO>/abaco-memory/` existe pero **no contiene ningún fichero** (solo un subdirectorio `vault/` vacío). Cero recuerdos escritos jamás.
- **No hay grabación de pantalla [V]:** `grep -rn desktopCapturer src/ packages/` → **0 coincidencias**. Lo que existe (`abaco-voice`) pide `getUserMedia({ audio: true })`: es **micrófono**, no píxeles.
- **El core Python no se empaqueta [V]:** `core/` existe en el repo (con `pairing/`, `voice/`, `uploads/`, `skills/`, `compaction/`, `migrations/`) pero **no está en `extraResources`** (`package.json:341+`, una **lista explícita de 12 entradas**) y **no está** en `/Applications/ABACO DEEP HARNES.app/Contents/Resources/`. **Las dos mitades del producto nunca se hablan.**

---

## 4. Lo que el dueño ve hoy

### Funciona
- La app **abre y NO se bloquea** [V por log: `profile web`, cero errores de plugins].
- El perfil nuevo tiene el preset `abaco` adoptado como default [V].
- La fontanería de la política obedece [V].
- La suite pasa [V].

### Lo que reportó que NO ve [REPORTADO por el dueño]
Al abrirla: **no ve el botón de audio, ni el de documentos, ni la UI del navegador Chrome, ni el botón de linkear el teléfono**, y la **caja de escribir «no sirve»**.

**Hipótesis fuerte (ya documentada en auditorías previas y ahora con evidencia mecánica):** al limpiar el entorno se borró el perfil de la app, así que está **recién nacida y sin ningún workspace/proyecto abierto**. Los botones de voz, documentos y estado del agente se registran en slots con **alcance de sesión**, y el compositor queda **inerte** hasta que hay workspace. **Varias de esas quejas pueden desaparecer al abrir un proyecto — pero eso sigue PENDIENTE DE COMPROBAR con la app delante** (ver §6).

---

## 5. El orden de trabajo (7 pasos) y dónde estamos

De `docs/COLLABORATOR-CRITERIA.md` **§12.1**, ratificado por el colaborador. Este orden **sustituye** a los puestos (3) y (6) de su §9.

| # | Paso | Estado |
|---|---|---|
| 1 | **Fontanería viva** — que el preset `abaco` gobierne de verdad, y cablear `0.90 / 0.12` | ✅ **HECHO** (`3ddbe73`, `7936852`, `1952463`; verificado en §3) |
| 2 | **Telemetría Fase 0** — paquete `abaco-observability` | ❌ **NO EXISTE**. Sin ella no se demuestra que la compactación sirve ni que `used_after < used_before` |
| 3 | **Tope de spill de subagentes (capa 3)** — cerrar el hueco | ❌ Pendiente. Ubicación corregida: `$DSH_NM/dsh-subagent/lib/index.js:1761-1777`. Viable por `patch-package` (el repo ya lo usa) |
| 4 | **Principio D** — que el pruner lea `isError` (hoy **0 ocurrencias**) y que los errores se preserven literales (`ERROR \| tool \| mensaje crudo`; truncar bytes del stack, nunca parafrasear) | ❌ Pendiente — **alcance ajustado, ver nota bajo la tabla** |
| 5 | **Principio C** — permiso la primera vez; si el usuario rechaza, **NO compactar**, soft-warn, **no repreguntar en bucle**, y volver a preguntar solo al próximo cruce del umbral. *«Nunca compactar en silencio tras un rechazo.»* | ❌ Pendiente |
| 6 | **Protocolo de escritura a `abaco-memory`** — la capa 2 está construida y vacía; sin protocolo es decorado | ❌ Pendiente |
| 7 | Recall / consolidación / motor propio | ❌ Pendiente |

**Dónde estamos: paso 1 cerrado. El siguiente es el 2 (telemetría).**

**Nota de verificación sobre el paso 4 (Principio D) — la premisa era PARCIAL.** La verificación adversarial sobre el motor instalado (`$DSH_NM` = `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai`, la copia **autoritativa** — §7.12; hoy byte-idéntica a la de `DSH Desktop.app` y a `desktop/src/dsh-desktop/node_modules/@deepseek-ai`) confirma el núcleo de la premisa pero corrige su alcance. **El paso 4 sigue siendo necesario; no se reordena ni se elimina.**
- **Ya lo cubre el motor (no hay que implementarlo):** el truncado **conserva** la marca `isError` en el bloque sustituido (`dsh-compaction-tool-result-pruner/lib/index.js:157-160` + reanexo de `event.data` en `:170-172`), así que la marca **no se pierde**; y la directiva de compactación ya tiene una sección **dedicada** `"## Errors and Fixes"` (`dsh-compaction-basic/lib/index.js:234`). Los errores no se resumen «como una bala más» genérica.
- **Sigue faltando (esto es el paso 4):** (a) **ninguna guarda actúa** sobre `isError`: `pruneContent` (`:91-124`) trunca todo `tool/result` por encima de `thresholdChars` **sin condición**, error incluido; (b) `buildSummarizationInput` (`dsh-compaction-basic/lib/index.js:651-653`) **no filtra** nada: el error entra íntegro en el corpus a resumir, y «Errors and Fixes» pide condensar («how it was resolved»), no transcribir literal. Ese segundo punto (regla de transcripción literal en la plantilla) es la mitad del paso 4 que **no** se puede dar por hecha.
- **Alcance del arreglo, precisado:** una guarda dentro de `pruneSession` cubre **las dos** rutas de prune — presión (`dsh-compaction-basic:886`) y overflow (`:872`) —, porque el overflow llama a la misma función. Pero **no** protege del overflow por sí sola: tras podar, el overflow usa `selectCompactableRange(..., 0)` (`:875`) y resume **todo** el historial. Para el overflow hace falta además la regla literal del punto (b).

**Aviso del orden (§13.3 D-1):** el paso 1 va **antes** de la telemetría, lo que roza la regla del §5 de la spec («primero medir»). **Está registrado y superado por el orden acordado** en `SPEC §8.10`. El §5 de la spec **no se ha reescrito**.

---

## 6. Qué es trabajo real y qué puede ser un espejismo

### 🟡 MUY PROBABLEMENTE ESPEJISMO — se resuelve abriendo un workspace (PENDIENTE DE COMPROBAR)

**Evidencia dura recogida [V]: el perfil de ABACO tiene CERO workspaces.**

```
~/Library/Application Support/abaco-deep-core/harness/storages/workspace.json
  "global": { "initialized": true, "workspaceIds": [], "archivedSessionIds": [] },
  "tables": { "workspaces": {} }
```

Y el mecanismo del motor que lo explica **[V]**:
- `$DSH_NM/dsh-client-ui-conversation/lib/client.js:15649` → `input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.left", {})`
- ídem en `:15654` para `conversation.input.right`
- Es decir: **sin sesión, el botón de micrófono y el de subir documentos NO SE RENDERIZAN**, aunque el plugin esté montado y perfecto. `packages/abaco-voice/client.js:1077` y `packages/abaco-documents/client.js:344` se registran correctamente en esos slots.
- `placeholder.workspace: "Choose a workspace to start"` (`:13443`) es el texto del compositor sin workspace.
- El **panel «AGENTE TRABAJANDO»** también es de alcance de sesión: `conversation.session.header.actions (session scope)` (`build/dsh-desktop.patch.yml:84`).
- **La columna derecha mide 0 px si no hay sesión**: `dsh-client-ui-layout/lib/client.js:217` → `computeColumns(viewport, sidebar, detailsSession === void 0 ? 0 : panels.details)`.

**Conclusión honesta:** la causa mecánica está probada, pero **el efecto observable en la UI NO lo he comprobado con la app delante**. Es lo primero que debe hacer el siguiente agente: **abrir un proyecto en ABACO y volver a mirar**. Si los botones aparecen, tres de las cinco quejas del dueño eran un espejismo.

**⚠️ Trampa dentro de la trampa:** el workspace que el dueño *cree* abierto (`/Users/a507/Documents/New project/ABACO_PYTHON_CORE/abaco_core`) está en el `workspace.json` del perfil **`dsh-desktop`** (el de la app DeepSeek, con 3 workspaces), **no** en el de ABACO **[V]**. Es exactamente el error de los dos perfiles (§7).

### 🔴 TRABAJO REAL — NO se arregla abriendo una carpeta
1. **El navegador es un overlay de ventana completa, no una columna [V].** `src/main/abaco-browser-controller.ts:686` → `pageView.setBounds({ x: 0, y: 0, width: contentWidth, height: contentHeight })`, montado con `contentView.addChildView` (`:312-315`). **El layout de 3 columnas sí existe en el motor** (`dsh-client-ui-layout/lib/client.js:243` → `gridTemplateColumns: sidebar px | 1fr | details px`), y **la columna derecha la ocupa hoy el panel de detalles del chat** (`:259` → `renderSlot("details")` bajo `SessionProvider`). **Ahí es donde debería ir el navegador.** Nota: `details` es de alcance de sesión, así que la columna derecha tampoco existe sin sesión.
2. **No existe grabación de pantalla**, y **no hay alerta automática al agente** al parar. Lo que hay graba **acciones DOM del navegador**, no píxeles; el «skill» hoy es un **botón manual** (`src/main/abaco-browser-skill-writer.ts`, canal `abaco:browser:save-skill`, botón 💾 en la chrome bar).
3. **El botón del teléfono vive en un `preload` inyectado** (`src/preload/index.ts:28`, `:231-253`), **se oculta en la barra lateral colapsada** — `:263` → `const hidden = !wide && !phoneConnected` —, y **el QR está en una página del proceso main**, no en la UI (`src/main/mobile/lan-mobile-pages.ts:280`).
4. **El micrófono transcribe pero NO envía [V]:** `packages/abaco-voice/client.js:796` → `inputActions.setDraft(...)`. Solo escribe el borrador.
5. **El botón de documentos filtra por extensión [V]:** `packages/abaco-documents/client.js:207` → `accept: '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,…'` + una lista de MIME. **No es «cualquier tipo».**
6. **El nombre dice «ABACO», no «ABACO DEEP HARNES» [V].** `packages/dsh-desktop-client-ui/client.js:109` devuelve el literal `'ABACO'` para el slot `sidebar.brand.name` (`:126-130` lo registra). **«DEEP HARNES» bajo la A no existe en ningún slot ocupado.** El paquete `abaco-brand` — el único con `productName: 'ABACO DEEP HARNES'` — está **deshabilitado**.
7. **El control del navegador es IPC-only [V].** El agente tiene 7 tools (`packages/abaco-browser/index.js:349-613`: `navigate`, `click`, `type`, `read_dom`, `wait_for`, `state`, `screenshot`), pero **ninguna cambia el modo**; `abaco_browser_state` solo **lee** quién posee el control (`:584`: *"This is the only browser tool that works while the browser is in manual mode"*). El usuario puede tomar y devolver el control; **el agente NO puede entregarlo ni pedirlo** (`:337` le dice que le pida al usuario que se lo devuelva).
8. **Cinco plugins deshabilitados [V]:** `abaco-brand`, `abaco-device-identity`, `abaco-cloud-sync`, `abaco-onboarding`, `abaco-experimental`, con la razón escrita en `build/dsh-desktop.patch.yml:145-153`: sus `index.js` hacían `ctx.abacoBrand = …` / `ctx.abacoSync = …` y leían `ctx['secureStore']` **sin `provide`/`inject`**, lo que Cordis rechaza y **rompía el árbol entero al arrancar**. **Re-habilitarlos tal cual ROMPE.** Hay que re-cablearlos con `ctx.provide(...)`/`inject` primero. (`voice` y `documents` llevan su propio fallback por `localStorage` y no dependen de ellos.)
9. **El core Python no se empaqueta** (§3). Dos mitades del producto que nunca se hablan.

---

## 7. Las trampas (esto salva días)

1. **TRAMPA DE LOS DOS PERFILES.** Existen `~/Library/Application Support/dsh-desktop/` (la app **DeepSeek**, que sirve una **conversación activa** — **INTOCABLE**) y `~/Library/Application Support/abaco-deep-core/` (la app **ABACO**). Se llaman casi igual y **ambos tienen `harness/`**. **Tres auditorías distintas los confundieron y afirmaron datos falsos.** Diferencias medidas hoy [V]: el `settings.yaml` de `dsh-desktop` dice `default: cordis`; el de `abaco-deep-core` dice `default: abaco`. **REGLA: sin nombrar el perfil, el dato no se usa.**
2. **TRAMPA DE LOS DOBLES QUE MIENTEN.** Los tests pueden estar en verde certificando una API que no existe. Un test que usa un doble con una forma inventada es **peor** que no tener test.
3. **REGLAS DE CORDIS** (todas verificadas en este repo a golpes):
   - El **retorno del body de un plugin se recolecta como *effect***: solo función o `undefined`. **Lo demás tumba el árbol y manda la app a Safe Mode.**
   - Registrar un **segundo servicio con el mismo nombre en el mismo realm lanza**.
   - **Leer un servicio no declarado en `inject` lanza.**
   - Un **throw al resolver la config de un plugin es FATAL** (no warning): también tumba el árbol.
4. **EL COMENTARIO DEL PRESET MENTÍA.** Decía que el error de proporción solo registra un warning. Es verdad **solo en el camino de runtime**; el de **load es fatal** [V]. Ya está corregido, pero **la lección es que los comentarios también alucinan**: verifica contra el motor, no contra el comentario.
5. **NO BAJAR EL `0.90` A `0.80` SIN PREGUNTAR AL DUEÑO.** Es un criterio de done explícito (`SPEC §8.6.6`). Hoy **no hay bloqueo** que lo justifique.
6. **La cita `:1725-1742` del hueco del subagente está desfasada** [V]: la ubicación real es `:1761-1777`. Verifica **siempre** con `grep` sobre tu copia del motor antes de parchear por número de línea.
7. **`npx` / `npm run` están ROTOS en este shell** (`PLAN-TRABAJO.md:145`): `node` en PATH es un shim a Electron. Usa Node real explícito y `PATH` saneado (§8).
8. ⚠️ **`docs/AUDIT-2026-09.md` ES UN SNAPSHOT OBSOLETO.** Sus 5 P0 **ya están corregidos en disco**. Un agente que lo lea intentará arreglar lo que ya funciona.
9. **`extraResources` es una LISTA EXPLÍCITA de 12 entradas** (`package.json:341+`): cada recurso nuevo hay que añadirlo ahí o no entra en el `.app`.
10. **Nunca lanzar la app automáticamente.** El dueño la abre a mano (smoke tests con `launchctl` dejaban jobs que la reabrían sola).
11. **Nunca `git add -A`** en este repo: hay otros agentes trabajando.
12. **TRAMPA DE LAS TRES COPIAS DEL MOTOR.** Existen **tres** árboles `@deepseek-ai` en esta máquina, con **los mismos nombres de paquete dentro**, y **dos de ellos pertenecen a aplicaciones distintas**: **(1)** `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai/` — la app **ABACO**, y la copia que ABACO **ejecuta de verdad**; **(2)** `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/` — la app **DeepSeek Desktop**, que es **otro producto** y por tanto **no tiene autoridad** sobre ABACO, aunque hoy sea idéntica; **(3)** `desktop/src/dsh-desktop/node_modules/@deepseek-ai/` — la **entrada de build** del repo, que **debería producir** la (1). La abreviatura `$DSH_NM` se venía resolviendo a la **(2)** — un **accidente**, no una decisión —, y una abreviatura mal resuelta produce datos falsos **sin que nada avise**: la cita *parece* verificada porque el archivo existe y la línea existe. **REGLA: sin nombrar CUÁL de las tres copias, el dato no se usa.** Para toda cita de línea que describa el comportamiento de ABACO, **manda la (1)**.
    - **Hoy NO hay divergencia [V] — medido el 2026-09-10.** Las tres copias son **byte-idénticas** en todo lo que estos documentos citan: los **50** archivos del motor citados en `docs/` dan el mismo `md5` en las tres, y también las dos composiciones. Hashes de referencia: `dsh-compaction-basic/lib/index.js` → `a5d86c48357ec94800483808b7d576f6` (964 líneas, en las tres); `dsh-web-app/cordis.patch.yml` → `e98f32bd15cec266ce78c41e5ce8ceff` (444 líneas, en las tres); `dsh-base/cordis.patch.yml` → `730b3744210d507ce0f8180807103df5` (498 líneas, en las tres). **Conclusión: ninguna cita de estos documentos está mal hoy por esta causa.** Es un **riesgo latente**, no un defecto actual — y dejará de serlo el día que una de las dos apps se actualice por su cuenta.
    - **Procedimiento cuando diverjan** (hoy no divergen; el día que una app se actualice, sí):
      1. **Antes de confiar en cualquier cita de línea, compara hashes** de las tres copias. No leas primero la línea: comprueba primero si las copias coinciden.
      2. **Si son idénticas:** leer cualquier copia sirve, pero **la cita debe seguir nombrando la autoritativa** (la (1)) — el documento sobrevive a la próxima actualización; la cita, no.
      3. **Si difieren: manda la (1)** — la del bundle de ABACO — para **todo** lo que describa runtime. Y hay que **reportar la divergencia como incidencia**: significa que **el repo y la app construida ya no coinciden**, es decir que la entrada de build (3) dejó de producir la copia que se ejecuta (1), y toda cita de línea de estos documentos queda en duda hasta reconciliarla.
      4. **Comando para comparar las tres** (copiar y pegar):
    ```bash
    A="/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai"
    B="/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai"
    C="$PWD/desktop/src/dsh-desktop/node_modules/@deepseek-ai"
    for f in dsh-compaction-basic/lib/index.js dsh-web-app/cordis.patch.yml dsh-base/cordis.patch.yml; do
      echo "== $f"; for d in "$A" "$B" "$C"; do printf '   %s  %s\n' "$(md5 -q "$d/$f")" "$d/$f"; done
    done
    ```
    Un `md5` distinto en cualquier línea es la señal: para entonces, **la (1) manda y la divergencia se reporta**.

---

## 8. Cómo verificar cada cosa (criterios duros)

**Regla:** nada se da por terminado sin **evidencia literal**: exit code, hash, clon limpio y, para la app, **el log real**.

### Para la app → el LOG
```bash
tail -40 ~/Library/Logs/"ABACO DEEP HARNES"/harness.log
grep -c error ~/Library/Logs/"ABACO DEEP HARNES"/harness.log   # debe ser 0
grep "profile " ~/Library/Logs/"ABACO DEEP HARNES"/harness.log # debe decir: [desktop] profile web
```
Criterio: **`[desktop] profile web`** (NO Safe Mode), cero errores de plugins, `[harness-node] DSH entry loaded`. Comprueba además de qué ruta arrancó (`/Applications/...` vs `dist/...`) — no son la misma build.

### Para el preset → el `settings.yaml` del perfil ABACO
```bash
cat ~/Library/Application\ Support/abaco-deep-core/harness/settings.yaml   # agent-presets: default: abaco
cat ~/Library/Application\ Support/abaco-deep-core/harness/.agent-presets/abaco/agent.cordis.yml | grep -n "Ratio\|maxTokens"
```
Criterio: `default: abaco` **y** `0.9 / 0.12 / 8192` en la fila del preset. **Nunca leas el `settings.yaml` de `dsh-desktop`.**

### Para el motor → los tokens resueltos
```bash
dsh --profile web --patch desktop/src/dsh-desktop/build/dsh-desktop.patch.yml --dump-config
```
Compone el perfil **sin lanzar la app** (regla ya usada en el proyecto). Criterio: `thresholdTokens` y `retainTokens` coherentes con `thresholdRatio`/`retainRatio` × `contextWindow`. **Y para el `contextWindow` real, haz una sonda en vivo**: no hay ningún literal `1000000` en el motor — se resuelve como `configured?.contextWindow ?? connection.defaultContextWindow` (`dsh-llm-deepseek/lib/index.js:1567`), o sea que **viene de configuración**, no del código.

### Para los tests → que FALLEN con el bug restaurado
Un test que pasa no prueba nada por sí solo. **Restaura el bug (por ejemplo, vuelve a poner `async` en el `apply` de `abaco-context`, o `settings?.()`) y comprueba que el test se pone rojo.** Si sigue verde, el test es decorado. Para el contrato de un servicio, **lee el paquete instalado en `node_modules`**, no el doble.

### Comando de la suite (con las reglas de oro 8 aplicadas) [V]
```bash
cd desktop/src/dsh-desktop
env -u ELECTRON_RUN_AS_NODE PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  /usr/local/bin/node node_modules/vitest/vitest.mjs run
```
Resultado hoy: **95 ficheros / 903 tests / 0 fallos**.
⚠️ **No uses `--reporter=basic`**: en esta versión de vitest es un reporter inexistente y el proceso **sale con código 0 sin ejecutar ni un test**. Un falso verde perfecto — exactamente el patrón de esta casa.

### Para el estado del producto desde el lado del usuario
```bash
cat ~/Library/Application\ Support/abaco-deep-core/harness/storages/workspace.json  # ¿hay workspace?
ls -la ~/Library/Application\ Support/abaco-deep-core/harness/abaco-memory/         # ¿capa 2 vacía?
```

---

## 9. Reglas de trabajo que el dueño exige

1. **EL PRODUCTOR NUNCA VERIFICA.** Cada tarea se cierra con **otro** agente que **re-ejecuta desde cero**. Tú no declaras tu propio trabajo terminado.
2. **Nada se da por terminado sin evidencia literal:** exit code, hash, clon limpio y, para la app, **el log real**.
3. **DELEGAR el trabajo pesado**, y **NUNCA** creerse un «está terminado» sin comprobarlo.
4. **El contexto vive en el repo (documentos versionados), no en el chat.** Un brief pegado en una conversación **muere con el agente**.
5. Documenta **lo que no sabes** con la misma claridad que lo que sabes. **Un handoff que exagera es peor que no tenerlo.**

---

## 10. Cabos sueltos conocidos

### Divergencias abiertas con el colaborador (`COLLABORATOR-CRITERIA.md` §13.3)
- **D-1 — El orden: cablear 0.90/0.12 *antes* de la telemetría.** ✅ **RESUELTA** por decisión (§12): manda el orden acordado, registrado en `SPEC §8.10`. El §5 de la spec **sigue sin reescribir** y convive con el §8.10.
- **D-2 — Modo de fallo de `retainRatio >= thresholdRatio`: ¿warning o fatal?** ❌ **ABIERTA.** El colaborador solo nombra el camino benigno; la spec documenta además uno **fatal** en load. **Yo confirmé el `throw` fatal [V]** (§3). El colaborador se equivoca aquí.
- **D-3 — Qué escribe el flag de C cuando el usuario rechaza.** ❌ **ABIERTA.** La spec no fija la semántica del rechazo; el colaborador sí. Leída literal, la verificación (d) de la spec produciría justo lo que el colaborador prohíbe.
- **D-4 — Preservación byte-idéntica del error frente a truncado por bytes.** ❌ **ABIERTA.** Divergencia de **grado**: la spec exige texto íntegro y verificación byte a byte; el colaborador autoriza recortar bytes bajo presión.
- **D-5 — De qué perfil es `$DSH_HOME` y si su `settings.yaml` tenía la clave `agent-presets`.** ✅ **RESUELTA** (2026-09-10). Era un conflicto de HECHO entre documentos que afectaba a la causa raíz del Bug 2, y se ha fallado **a favor del handoff corregido**: la spec leyó el perfil vecino. Detalle y evidencia en disco: `docs/COLLABORATOR-CRITERIA.md` §13.3 D-5.

### Las tres afirmaciones de `docs/SPEC-CONTEXT-3-LAYERS.md` que afirmaban el perfil EQUIVOCADO — ✅ CORREGIDAS

> **Ejecutado en el árbol de trabajo el 2026-09-10, sin commit.** Las líneas citadas abajo llevan **cita desfasada**: al retractarlas, la propia corrección desplazó el resto del documento. El texto retractado se conserva **citado dentro** de cada retractación, y las ubicaciones vigentes son las de la última columna.

- **`SPEC:66`** → *«`settings.yaml` SÍ tiene la clave `agent-presets`: `$DSH_HOME/settings.yaml:11-12` → `default: cordis`»* — **retractado**; el texto vigente está en **`SPEC:68`**.
- **`SPEC:67`** → *«`$DSH_HOME` real = `/Users/a507/Library/Application Support/dsh-desktop/harness` (no `~/.dsh`)»* — **retractado**; el texto vigente está en **`SPEC:67`** *(coincide el número de línea)*.
- **`SPEC:251`** → repite las dos: *«(1) `settings.yaml` **sí** contiene `agent-presets` (`:11-12`, `default: cordis`); […] (3) **`$DSH_HOME` real es `…/dsh-desktop/harness`**, no `~/.dsh`»* — **retractado**; el texto vigente está en **`SPEC:261`**. *(La cita `:251` era correcta cuando se escribió este handoff: el commit `71d9518`, que añadió 6 líneas en `:156`, la desplazó a `:257` primero y a `:261` con esta corrección.)*

**Por qué estaban mal [V]:** describen el perfil **vecino**, `dsh-desktop`. El `$DSH_HOME` de ABACO es `…/abaco-deep-core/harness`, y su `settings.yaml` dice `default: abaco` — de hecho **la clave sí está hoy**, porque **el arreglo del Bug 2 la escribió** (`7936852` funcionando). La lectura del §13.3 D-5 es la correcta: la «corrección» de la spec leyó el perfil equivocado y revirtió un hallazgo que era cierto — **en el perfil de ABACO la clave FALTABA**, y por eso el default efectivo era el de la composición, `standard`. **Prueba en disco añadida el 2026-09-10 [V]:** `…/abaco-deep-core/harness/.agent-presets/.abaco-context-default.json` → `{"applied": true, "presetId": "abaco", "replaced": "standard", "at": "2026-09-10T21:34:14.122Z"}` — el `"replaced": "standard"` es el default efectivo anterior, registrado por el propio plugin al sustituirlo.

**Acción ejecutada:** esas líneas **quedaron corregidas y retractadas en el árbol de trabajo el 2026-09-10** (ver la tabla de arriba). **Falta el commit**, que debe ser propio. Este handoff sí las toca, solo para anotar el resultado; el texto vive en `docs/SPEC-CONTEXT-3-LAYERS.md`. Detalle: `docs/COLLABORATOR-CRITERIA.md` §13.3 D-5.

### Otros cabos sueltos
- **El hallazgo de que «el QR no transporta el secret» — NO lo he podido confirmar; la evidencia que tengo lo CONTRADICE [V].** El QR que sirve el shell se construye desde `pairingUrl` = `http://<lan>:<port>/pair?token=${this.pairingToken}` (`src/main/mobile/lan-mobile-bridge.ts:407-414`), y `pairingToken = randomBytes(32).toString('base64url')` (`:430`) — un token de 256 bits **dentro del QR**. Y el core Python, por su parte, documenta *«Option A — secret in the QR, hardened»* y pone `"secret": code.secret` en el payload (`core/pairing/api.py:13`, `:16`, `:315`). **Un QR sin el secret no permitiría completar el pairing en ninguno de los dos.** → **Reabre la investigación del hallazgo original**: puede referirse a otro QR, a otra versión, o ser simplemente falso. **No lo heredes como verdad.**
- **`contextWindow 1000000 / thresholdTokens 900000 / retainTokens 120000` [REPORTADO, NV].** La fórmula y los valores de política están verificados [V], pero **no he ejecutado una sonda en vivo** y el `1000000` no es un literal del motor. Confírmalo con `--dump-config` o con una sonda antes de citarlo como medición.
- **`docs/PLAN-TRABAJO.md` está desactualizado [V]:** su §2 dice «sin commitear» de cosas ya commiteadas (`679b225d`, `e46f8db1`, `d852612`), cita el preset con `0.6 / 0.08 / 16384` (muerto), dice «898 tests» (hoy **903**) y lista `abaco-vault` como «corriendo». Trátalo como plan, no como estado; el estado es este documento + `git log`.
- **El diseño del `logo.svg` tiene un defecto documentado (`8f0d490`):** el borde cálido `#D9A48B` nunca se renderiza (`plate-right` sin `transform` tapa `plate-left`). **FIX PENDIENTE** con opciones a/b/c.
- **Notarización:** bloqueo externo (Apple). No es código.
- **Build x64** no existe en el release v0.4.0 (la máquina es arm64).
- **Deuda de rebrand no tocada:** `release.yml:542,721` y `backfill-archive.yml:76` usan el host `dshdesktop.com`; `MODELSCOPE_REPO_ID` publica pre-releases en el repo del upstream; `serviceName` dice `ABACO HARNES` (sin DEEP); READMEs ja/ru/es/pt sin rebrandear.
- **`docs/DECOUPLING.md` tiene inconsistencias internas menores [V]:** cita 254 vs 243 tarballs del motor (`:24` vs `:53`), y «6 de los 20 parches» vs «de los 7 de la categoría (b), seis» (`:27` vs `:316-317`). No cambian sus decisiones; no las cites como número exacto.

---

## 11. Primeras tres acciones recomendadas

1. **Abrir un proyecto en ABACO** y volver a mirar los cinco botones que el dueño no ve. Es lo más barato y puede cerrar tres quejas. Evidencia dura del antes/después: `workspace.json` + el log.
2. **Telemetría Fase 0 (`abaco-observability`)** — paso 2. Sin ella, nada de lo que venga después es demostrable.
3. ✅ **Corregir o retractar `SPEC:66-67` y `SPEC:251`** — **hecho el 2026-09-10 en el árbol de trabajo**; falta el commit propio. Se hizo con la evidencia de los dos perfiles de §7.1 y con el marcador `.abaco-context-default.json`. Ver §10 y `docs/COLLABORATOR-CRITERIA.md` §13.3 D-5.

**Cierre.** El diseño de tres capas es correcto y está construido; la fontanería ya obedece y está probada. Lo que falta no es una idea nueva: es **telemetría**, el **tope de spill**, y **dos guardas que hoy no existen (C y D)**. Y antes de tocar nada: **verifica de qué perfil estás leyendo.**
