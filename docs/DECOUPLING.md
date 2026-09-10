# DECOUPLING — ABACO DEEP HARNES ↔ DSH

> **Documento de decisión, no de implementación.** Define qué se consume como
> dependencia, qué se aporta como plugin y qué obliga a código propio. No
> modifica código.
>
> Base: `main` @ `3ddbe73`. Medido sobre el árbol de trabajo real, no sobre
> documentación previa.
>
> **Convención de evidencia:** `[V]` = verificado leyendo el archivo o
> consultando el registro; `[I]` = inferido, no ejecutado; `[NV]` = no
> verificable sin lanzar la app.

---

## 0. Resumen de la decisión

El acoplamiento actual no viene de que ABACO use DSH. Viene de **una confusión
de nombres**: hay dos artefactos distintos llamados "DSH" y el proyecto trató a
ambos igual.

| # | Decisión |
|---|---|
| D1 | **El motor (`@deepseek-ai/dsh` + 224 paquetes `@deepseek-ai/*`) es DEPENDENCIA npm `0.1.2-rc.1`.** Está publicado en el registro; los 254 tarballs vendorados en `packages/harness-0.1.2-rc.1/` se borran. |
| D2 | **El shell Electron de `dsh-desktop` NO es una dependencia: es una aplicación.** No está publicado a la versión del fork y sus paquetes son `private: true`. Copiarlo no aporta nada que no se pueda reescribir en ~30 archivos propios. |
| D3 | **ABACO tiene shell propio, no un fork del shell ajeno.** La tercera columna (`WebContentsView`) obliga a código en el proceso main, pero eso es código *de ABACO*, no una copia de DSH. |
| D4 | **Los parches `patch-package` son la forma correcta y mínima de fork del motor y se conservan.** 6 de los 20 parches tocan contratos que un plugin no puede alcanzar; el resto son UI o conveniencia y deben migrarse a filas/ocupantes de slot. |
| D5 | **La ligadura de identidad ya está casi eliminada en código** (`appId`, `productName`, `userData`, single-instance). Lo que queda son fugas concretas y enumerables (§4.4). |

---

## 1. Qué es dependencia y qué es plugin

### 1.1 El hallazgo que ordena todo: hay dos "DSH"

El repositorio llama "DSH" a dos cosas de naturaleza opuesta:

| | **El motor (Harness)** | **El shell (DSH Desktop)** |
|---|---|---|
| Paquete | `@deepseek-ai/dsh` + 224 `@deepseek-ai/*` | repo `dataelement/dsh-desktop` v0.7.2 |
| Qué es | runtime de agente: sesiones, tools, compactación, subagentes, UI web | **aplicación Electron**: main, preload, updater, market, túneles móviles |
| Publicado en npm | **sí** | **no** — `npm view dsh-desktop` → solo `0.2.0` [V]; el fork va por `0.7.2` |
| Sus paquetes propios | publicados (`publishConfig.access: public`) | `dsh-desktop-client-ui` declara `"private": true` [V] y da 404 en el registro [V] |
| Naturaleza | **biblioteca + servicio** | **producto** |

Consecuencia directa: **el motor se puede consumir; el shell no.** Se puede
depender de una biblioteca; no se puede depender de la aplicación de otro.

### 1.2 Clasificación pieza por pieza

| Pieza | Veredicto | Dónde vive hoy | Evidencia |
|---|---|---|---|
| Motor `@deepseek-ai/dsh` (224 paquetes) | **DEPENDENCIA** | `packages/harness-0.1.2-rc.1/npm-dsh/*.tgz` (243 tarballs) | `latest = 0.1.2-rc.1` en el registro, exactamente la versión vendorada [V] |
| Cordis (`@deepseek-ai/cordis`, `cordis-plugin-loader/-include/-hmr/-group`) | **DEPENDENCIA** | `npm-vendor/*.tgz` (9 tarballs) | publicados [V] |
| Client UI del motor (`@deepseek-ai/dsh-client-ui-*`, ~35 paquetes) | **DEPENDENCIA** | tarballs vendorados | publicados; `dsh-client-ui-chat` tiene `0.1.2-rc.1` [V] |
| **Registro de slots** (`@deepseek-ai/dsh-client-ui-slots`) | **DEPENDENCIA — es *el* seam de extensión** | tarball vendorado | publicado; su descripción oficial es *"Slot registry pure core: SlotMap declaration merging, single register composition API, four-share props types, store-seat types, renderer install seam"* [V] |
| **Shell Electron** (`src/main/`, `src/preload/`, `src/shared/`) | **PROPIO** — ni dependencia ni fork | `desktop/src/dsh-desktop/src/` | ver §2 |
| Paquetes del shell (`dsh-desktop-client-ui`, `-hmr-fallback`, `-market-installer`, `-preset-transfer`) | **NO SE NECESITAN** | `packages/dsh-desktop-*` | `dsh-desktop-client-ui` solo son *"brand occupants for Harness UI slots"* [V]: ABACO ocupa esos mismos slots con `abaco-*` |
| Plugins `abaco-*` (14 paquetes, 78 archivos) | **PROPIO** | `packages/abaco-*` | `[V]` |
| Preset de agente ABACO | **PROPIO** | `packages/abaco-context/presets/abaco/` → instala en `<DSH_HOME>/.agent-presets/abaco` | `preset-installer.js:37-82` [V] |
| Branding (identidad visual, iconos, tema) | **PROPIO** | `desktop/brand/`, `build/`, `abaco-theme`, `abaco-brand` | `[V]` |
| Parches `patch-package` (20) | **PROPIO — delta mínimo sobre dependencia** | `patches/` | ver §3.4 |
| `ppt-runtime` (738), `dshmarket` (386), `scripts/ppt` (78) | **AJENO — producto del shell upstream** | dentro del árbol copiado | `[V]` por diff, ver §3.1 |

### 1.3 Por qué el motor es genuinamente una dependencia (y no "casi")

El contrato shell ↔ motor es **estrecho y reimplementable**. Verificado en
`src/main/runtime/harness-runtime.ts`:

- `buildHarnessArguments()` (`:196-215`) produce exactamente:
  `['web', '--patch', <yml>, '--no-open', '--host', '127.0.0.1', '--port', <n>]`.
- El puerto **no es fijo**: `:401` `const port = await reservePort()` y
  `:800-816` `server.listen({ host: '127.0.0.1', port: 0 })` → el SO asigna el
  puerto. **El motor nunca usó un puerto fijo.** [V]
- `buildHarnessSpawnOptions()` (`:245-300`) inyecta `DSH_HOME` y el `PATH` de un
  shell de login, y **elimina `ELECTRON_RUN_AS_NODE`** del entorno del hijo. [V]
- El hijo se lanza como *Electron utility process* con
  `execArgv: ['--expose-internals']`, `serviceName: 'ABACO HARNES'`,
  `disclaim: true` (`src/main/runtime/disclaimed-utility-process.ts:33-49`), y
  `build/harness-node-entry.mjs` arranca el entry de `dsh` en modo Node. [V]

Es decir: el shell arranca un hijo que sirve HTTP en loopback, y le pasa la URL
(a `src/main/index.ts:3142` aproximadamente vía `openHarness(snapshot.url, …)`)
a la ventana. **Eso es todo el acoplamiento técnico.** [V]

---

## 2. El mínimo fork viable

### 2.1 Lo que NO requiere fork (verificado en el código de ABACO)

La pregunta crítica —*¿se puede tener UI propia sin copiar el árbol?*— tiene
respuesta medida, porque ABACO ya lo hace:

| Necesidad del producto | Cómo se resuelve hoy | Slot | Verificado |
|---|---|---|---|
| **Botón de voz** (micrófono, izquierda del composer) | plugin cliente | `conversation.input.left` | `packages/abaco-voice/client.js:1077` [V] |
| **Botón de subir documentos** (derecha del composer) | plugin cliente | `conversation.input.right` | `packages/abaco-documents/client.js:344` [V] |
| Tarjetas de documentos sobre el input | plugin cliente | `conversation.input.dock` | `abaco-documents/client.js:355` [V] |
| Botón "escuchar" en mensajes del agente | plugin cliente | `conversation.chat.assistant-actions` | `abaco-voice/client.js:1085` [V] |
| Panel de ajustes de voz | plugin cliente | `settings.section` | `abaco-voice/client.js:1093` [V] |
| Lanzador del navegador | plugin cliente | `sidebar.footer.action` | `abaco-browser/client.js:29,204` [V] |
| Indicador "AGENTE TRABAJANDO" | plugin cliente | `conversation.session.header.actions` | `build/dsh-desktop.patch.yml` [V] |
| Branding en sidebar | ocupante de slot | `sidebar.brand.mark`, `sidebar.brand.name` | declarados en `dsh-client-ui-sidebar/.../slots.d.ts:19,28` [V] |
| Marca en el hero del chat | ocupante de slot | `conversation.hero.brand.mark` | declarado en `dsh-client-ui-conversation` [V] |
| Tools, secciones de prompt, preset | plugin host | `ctx.tools`, system-prompt, fila de perfil | `abaco-memory`, `abaco-vault`, `abaco-context` [V] |

**Conclusión: los botones propios del composer y el branding NO requieren
fork.** El slot `conversation.input.left` / `.right` existe de fábrica y
cualquier paquete externo puede registrarse en él. La API es
`const inject = ['slots']` + `ctx.slots.inject(nombre, () => ctx.slots.register(…))`. [V]

El inventario completo de slots declarados de fábrica incluye:
`sidebar.brand.mark|name|workspaces|settings|footer.action`;
`conversation.session|.session.header[.lineage|.actions|.utilities]|.view|.composer|.composer.bar|.composer.dock|.hero.workspace|.hero.brand.mark|.hero.agentPreset|.input.dock|overlay|left|right|attachments|plan|model`;
`conversation.chat.node|.message.images|.chat.commandview|.chat.turnTail|.chat.assistant-actions|.details.tool`;
`settings.trigger|header|action|close|section|onboarding|plugins.tab|general.item|plugin.item|models.footer`;
`shell.overlay`, `details`, `tool.call.toolview`, `tool.view.cordis`,
`conversation.approval.detail`, `conversation.workspace.directoryFlow`. [V]

### 2.2 Las excepciones inevitables

Cinco cosas **sí** obligan a código propio en el proceso main de Electron.
Ninguna obliga a copiar DSH:

**(1) La tercera columna — `WebContentsView`.** Solo el proceso main de Electron
puede crear una `WebContentsView` y añadirla con
`window.contentView.addChildView(...)`. Está documentado en el propio repo:
*"the overlay lives in **Electron main** (only it may create a
`WebContentsView`)"* (`docs/abaco-browser.md`). [V] El renderer del Harness
sigue siendo el `webContents` de la ventana; la columna es una vista hija
hermana. **No hay slot de Cordis para el main de Electron**: Cordis corre
dentro del hijo Node, no en main.

**(2) La identidad del producto.** `appId`, `productName`, `app.setName`,
`app.setPath('userData')`, el icono, el menú y el lock de instancia única viven
en el main + la config de electron-builder. Ningún plugin los alcanza. [V]

**(3) El puente preload.** `window.dshAbacoBrowser` es el preload del shell
(`src/preload/index.ts`, `src/preload/abaco-browser-chrome.ts`), cargado en la
ventana. Es código de ABACO. [V]

**(4) Los seams de host que necesitan los plugins.** Las tools del agente viven
en el hijo Node (`ctx.tools`); la vista vive en main. Los une un **RPC loopback
en puerto efímero con bearer token** (`src/main/abaco-browser-rpc.ts`), cuyo
puerto y token debe inyectar el shell en el entorno del hijo. Ese seam es del
shell. [V]

**(5) Declarar un slot NUEVO es imposible desde un plugin.** `slots.register`
lanza si la clave no fue declarada antes por el dueño que la renderiza
(`dsh-client-ui-slots/lib/index.js:74`), y a nivel de `ctx` solo `'root'` es
renderizable (`dsh-client-ui-renderer/lib/client.js:1178`). Por eso el parche 7
sobre `dsh-client-ui-conversation` **declara** `conversation.hero.modeActions` y
`conversation.input.accessory`. Un plugin externo puede ocupar slots
declarados; **no puede crear nombres de slot**. [V]

> Nota importante: ABACO **no necesita** esas dos zonas nuevas para lo que hoy
> envía (mic + upload usan slots de fábrica). Si se abandonan, desaparece la
> necesidad de ese parche. [I]

### 2.3 La forma más pequeña posible de fork: tres capas

No hay que elegir entre "copiar todo" y "no personalizar nada". Hay tres capas,
y solo una es un fork:

| Capa | Qué es | Tamaño | Naturaleza |
|---|---|---|---|
| **L1 — Parches al motor** | `patch-package` sobre dependencias del registro | 20 parches | **Fork mínimo legítimo**: delta versionado, no copia |
| **L2 — Shell propio** | main + preload de ABACO | ~30 archivos propios | **Código propio**, no fork |
| **L3 — Plugins ABACO** | `abaco-*` en slots | 14 paquetes | **Extensión**, cero fork |

**El shell propio es la pieza que hay que escribir.** Su núcleo es pequeño:
arrancar `dsh web --patch <yml> --no-open --host 127.0.0.1 --port 0`, leer la
línea `dsh web: <url>?token=…` de stdout (`extractLaunchToken`,
`harness-runtime.ts:185-194`) [V], cargarla en una `BrowserWindow` con el
preload de ABACO, aplicar identidad, y montar el `WebContentsView` de la tercera
columna. Lo demás del `src/main/index.ts` actual (124 KB) es producto del shell
ajeno, no de ABACO.

### 2.4 Lo que hoy se copia y NO hace falta

Estos bloques viven dentro de `desktop/src/dsh-desktop/` pero son **producto de
DSH Desktop**, no capacidades que ABACO consuma: `dsh-desktop-market-installer`,
`dsh-desktop-preset-transfer`, `dsh-desktop-hmr-fallback`,
`packages/dshmarket`, `packages/ppt-runtime`, `scripts/ppt`, los túneles móviles
(`mobile/cloudflared-tunnel.ts`, `pinggy-tunnel.ts`), `safe-mode*`,
`plugin-recovery*`, `state/generation-*`, `update/version-catalog.ts`,
`windows-menu*`, y las 41 modificaciones en `test/` que solo ajustan el fork del
shell. [V] Mantenerlos es coste puro: hay que rebasarlos en cada release de
upstream y no aportan nada al producto ABACO.

---

## 3. Cómo se elimina la copia

### 3.1 Medición del delta real (esto decide el plan)

Comparado con `dataelement/dsh-desktop` **v0.7.2** (repo público, tag existente;
descargado y comparado archivo por archivo):

| Métrica | Valor |
|---|---|
| Archivos rastreados en `desktop/src/dsh-desktop/` | **1.598** (`git ls-files`) [V] |
| Archivos en disco (sin `node_modules`/`dist`/`out`) | **2.180** [V] |
| Archivos del upstream v0.7.2 | **486** [V] |
| Añadidos (están en el fork, no en upstream) | **1.963** [V] |
| Borrados (están en upstream, no en el fork) | **269** [V] — son los tarballs `harness-0.1.2-alpha.1` + 16 parches viejos, reemplazados por `rc.1` |
| **Modificados** | **97** [V] |

Desglose de los 1.963 añadidos:

| Bloque | Archivos | Veredicto |
|---|---|---|
| `packages/ppt-runtime` | 738 | ajeno (shell upstream) |
| `packages/dshmarket` | 386 | ajeno |
| `packages/abaco-documents` | 373 | propio (incluye parsers empaquetados) |
| `packages/harness-0.1.2-rc.1` | 254 | **motor vendorado → se borra** |
| `scripts/ppt` | 78 | ajeno |
| `packages/abaco-*` (13 restantes) | ~65 | propio |
| `src/main|preload|shared` (código de ABACO) | 12 | **propio → se conserva** |
| `test/`, `docs/`, config | ~57 | mezcla |

De los 97 modificados, **solo 21 son fuente del shell** (`src/`), y 41 son tests
del propio fork del shell. Delta real de código en `src/`:

| Archivo | Líneas cambiadas |
|---|---|
| `src/main/index.ts` | **801** |
| `src/preload/index.ts` | **572** |
| `src/main/mobile/lan-mobile-bridge.ts` | 159 |
| `src/main/state/plugin-recovery.ts` | 73 |
| `src/main/safe-mode.ts` | 70 |
| … (16 más) | 1–61 cada uno |

Los 12 archivos de `src/` escritos por ABACO son:
`abaco-browser-controller.ts`, `abaco-browser-page-scripts.ts`,
`abaco-browser-recorder.ts`, `abaco-browser-rpc.ts`,
`abaco-browser-skill-writer.ts`, `safe-mode-overlay.ts`,
`state/desktop-storage.ts`, `state/plugin-market-check.ts`,
`state/plugin-upgrade.ts`, `preload/abaco-browser-chrome.ts`,
`preload/desktop-storage.ts`, `shared/abaco-browser.ts`. [V]

**Lectura de ingeniería:** de 486 archivos de upstream, **465 están intactos**.
Se mantienen 2.180 archivos para entregar ~2.200 líneas de delta propio. Ese es
el coste, y es el argumento decisivo para D3.

### 3.2 Pasos para que el motor sea dependencia versionada

1. En el `package.json` del shell, sustituir las 226 entradas
   `"file:packages/harness-0.1.2-rc.1/npm-dsh/…tgz"` por versiones de registro
   fijadas y exactas: `"@deepseek-ai/dsh": "0.1.2-rc.1"`, etc. (sin `^`).
   [V] que cada versión existe en el registro para los paquetes muestreados.
2. Borrar `packages/harness-0.1.2-rc.1/` completo (254 archivos, 8,1 MB). [V]
3. Regenerar `package-lock.json` y confirmar el árbol con
   `npm ls @deepseek-ai/dsh --all`. **Verificación:** debe reportar una sola
   versión, `0.1.2-rc.1`, y cero entradas `file:`.
4. **No perder `patch-package`:** los 20 parches se siguen aplicando sobre
   `node_modules` tras el install; el mecanismo es independiente de si la
   dependencia vino de tarball o de registro. **Verificación:**
   `npx patch-package --error-on-fail` en un `node_modules` limpio.
5. Repetir para `npm-vendor/` (9 tarballs de Cordis). [V]

**Qué se pierde:** nada funcional — es el mismo código, la misma versión. Se
gana resolución de dependencias transitivas real (hoy el tarball no las declara
y por eso el parche 2 las inyecta a mano).

**Qué hay que reescribir:** nada del motor. Pero si algún día se salta a
`0.1.5-rc.1` (`next`) o `0.1.5-alpha.2`, hay que revalidar los 20 parches — de
ahí la matriz de §3.4.

### 3.3 Pasos para sustituir el shell copiado por shell propio

1. Crear `desktop/shell/` con su propio Electron main + preload, **de ABACO**,
   no una copia. Portar desde `harness-runtime.ts` únicamente el contrato de
   arranque (construcción de argv, reserva de puerto efímero, `DSH_HOME`, PATH
   de login, parseo del token, watchdog de arranque) y desde `src/main/` los 12
   archivos `abaco-*` ya escritos. El archivo de origen es MIT; conservar el
   aviso de licencia/NOTICE al portar. El proyecto ya declara la atribución en
   `package.json:410-416` (`NSHumanReadableCopyright`: *"ABACO DEEP HARNES —
   Copyright © 2026 Anthony Sanchez. Fork of DataElement/dsh-desktop (MIT)."*)
   [V] — mantenerla aunque se deje de copiar el árbol.
2. Conservar del shell ajeno **solo** lo que el producto usa de verdad. Candidato
   mínimo: ventana + preload, instancia única, identidad, bandeja, safe-mode
   (porque un perfil roto en campo es irrecuperable sin él), y `harness-runtime`
   con sus tests (`test/runtime.test.ts` es una especificación de ~200 líneas ya
   escrita — es el mejor material de partida). [I]
3. **Descartar** explícitamente: market, PPT, preset-transfer, túneles móviles,
   generation-migration, plugin-recovery-view, windows-menu. Si el producto los
   quiere, son filas de plugin o features nuevas, no código heredado. [I]
4. Borrar `desktop/src/dsh-desktop/` completo. **Verificación:** `git grep -l
   "dsh-desktop"` no debe devolver nada fuera de `docs/` y del CHANGELOG.

**Qué se pierde (explícito):** auto-update del shell, PM de plugins con UI de
recuperación, instalador de market, runtime de PPT, pairing móvil por QR/túnel,
y el soporte Windows específico (`windows-child-process-hide.mjs`,
`windows-hidden-console.mjs`, `installer.nsh`). Si ABACO no distribuye en
Windows ni usa market/PPT, la pérdida es cero. **Decisión pendiente del dueño
del producto:** qué de esa lista es requisito real. [I]

**Riesgo de este paso:** es el único paso grande del plan. Por eso va en la
fase F4, después de que F1–F3 hayan hecho el motor dependencia y hayan dejado el
árbol copiado sin función crítica.

### 3.4 Los 20 parches: cómo se conservan

Clasificación real medida (no estimada):

| Categoría | Nº | Parches |
|---|---|---|
| **(a) UI/visual** (dentro de componentes upstream) | 9 | `client-ui-agent-preset`, `client-ui-chat`, `client-ui-deliverables`, `client-ui-layout`, `client-ui-model-selection`, `client-ui-settings-models`, `client-ui-sidebar`, `client-ui-trajectory`, `client-ui-workspace` |
| **(b) Seam/API nuevo** | 7 | `cordis-plugin-loader`, `dsh-api-session-controller`, `dsh-client-modules`, `dsh-client-ui-conversation`, `dsh-session-persistence`, `dsh-session-persistence-jsonl`, `dsh-workspace` |
| **(c) Fix que upstream no tiene** | 2 | `dsh-llm-deepseek`, `dsh-llm-pi-ai` (HTTP 403 → `FORBIDDEN`; cuota antes de auth) |
| **(d) Branding (strings)** | **0** | — |
| **(e) Otro** | 2 | `dsh` (inyecta 18 deps para que las filas resuelvan), `client-ui-directory-picker-native` |

**De los 7 de la categoría (b), seis tocan contratos que un plugin NO puede
alcanzar** y son, por tanto, fork inevitable:

- `dsh-api-session-controller` — `session/delete` está compilado dentro del
  contrato Typert generado por paquete (`lib/typert.host.js`,
  `lib/typert.remote-client.js`, `lib/client.js`); ninguna API pública añade un
  método a la tabla de descriptores de otro servicio. [V]
- `dsh-session-persistence` + `-jsonl` — `delete` es un método nuevo en la clase
  base del almacenamiento; un backend externo puede implementar el contrato
  existente, pero no puede hacer que el coordinador lo llame, y llamar a
  `deleteStored` directo se salta el orden de retirada de escrituras. [V]
- `dsh-workspace` — `forgetSession()` muta índices privados (`headers`,
  `sessionPaths`, `invalidSessionPaths`); la API pública deja basura. [V]
- `dsh-client-ui-conversation` — declara slots nuevos (§2.2-5). [V]
- `dsh-client-modules` — cambia cómo el registro atribuye módulos cliente de
  *otros* paquetes; necesario para que paquetes cliente no publicados se
  descubran. [V]
- `cordis-plugin-loader` — fallback de import por bare-specifier.
  **Matiz escéptico:** el objetivo (cargar un paquete externo) es alcanzable sin
  el parche apuntando la fila a una ruta `file:`/absoluta (rama
  `name.startsWith(".")`, `lib/index.js:265`). Es un seam del loader, no la
  única ruta. [V]

**Regla de conservación:** cada parche se anota con (i) versión exacta del motor
contra la que se validó, (ii) test que lo cubre (`test/*-patch.test.ts` ya
existen para varios), y (iii) alternativa sin parche si existe. Un parche sin
test y sin justificación de seam se elimina. Los 9 de categoría (a) deben
migrarse a ocupantes de slot cuando el slot existe, y borrarse cuando no aporten
al producto.

**Verificación barata ya disponible (no requiere lanzar la app):**
`dsh --profile web --patch <yml> --dump-config` compone el perfil sin arrancar
el motor. Es la forma de validar composición y filas en CI. [V] (ya usado en el
proyecto según `docs/PLAN-TRABAJO.md:97`)

### 3.5 `vendor/` en Abaco Desk

El otro repo (`Abaco Desk`) empotra `vendor/deepseek-harness` pinado a un SHA.
No está en esta máquina [V] (no existe ningún directorio `vendor/` ni
`deepseek-harness/` bajo `~/Documents`), así que se decide por principio, no por
inspección: **se sustituye por la misma dependencia de registro fijada en el
lockfile.** Un SHA de git pinado y un número de versión exacto dan la misma
reproducibilidad, pero la versión exacta además resuelve transitivas, admite
`npm audit`, y permite que dos repos del mismo dueño consuman *el mismo* motor.
Si Abaco Desk necesita un fork real del motor, debe declararlo como fork con
`remote upstream` — no como directorio copiado.

---

## 4. Cómo se elimina la ligadura de identidad

### 4.1 El daño medido

Síntomas observados: lock de instancia compartido, apps superponiéndose, la app
abriéndose sola, `EADDRINUSE` en 43127/44127. Causa: misma `userData` (`dsh-desktop`).

En disco hoy [V]:

```
~/Library/Application Support/abaco-deep-core    ← ABACO (correcto)
~/Library/Application Support/dsh-desktop        ← DSH Desktop vanilla
~/Library/Application Support/dsh-desktop-dev    ← DSH Desktop dev
```

### 4.2 Dónde vive cada eje de identidad

| Eje | Dónde vive | Valor actual | Estado |
|---|---|---|---|
| `appId` / `CFBundleIdentifier` | `package.json:318` | `io.abaco.deepcore` | ✅ |
| `appId` dev | `electron-builder.dev.cjs:5` | `io.abaco.deepcore.dev` | ✅ |
| `productName` | `package.json:319` | `ABACO DEEP HARNES` | ✅ |
| Nombre de app | `src/main/index.ts:523` (dev `:518`) | `app.setName('ABACO DEEP HARNES')` | ✅ |
| **`userData`** | `src/main/index.ts:533` (dev `:519`) | `appData/abaco-deep-core` | ✅ |
| Lock de instancia única | `src/main/index.ts:3158` | derivado de `userData`; `configureAppIdentity()` (`:3154`) corre **antes** | ✅ [I] semántica Electron |
| Puerto del motor | `harness-runtime.ts:401,805` | **efímero** (`port: 0`) | ✅ |
| Puerto del bridge móvil | `src/main/index.ts:2939` | `44127` (dev `44128`) | ⚠️ fijo, con fallback |
| Menú macOS | `src/main/index.ts:2711` | `label: app.name` → ABACO | ✅ |
| Icono | `package.json:407,426,343` | `build/icon.icns` / `.ico` / `app-icon.png` | ✅ |
| Feed de update | `update/version-catalog.ts:5-6,10,17`; `package.json:395-402` | `github.com/anthony-x507/Abaco-deep-Core/releases/…` | ✅ |
| Nombres de artefacto | `package.json:404,438` | `abaco-deep-harnes-${os}-${arch}` | ✅ |
| URLs de vendor `dshdesktop.com` | — | **ninguna presente** | ✅ |

Verificado además en el artefacto construido, no solo en la fuente [V]:

| Bundle | `CFBundleIdentifier` | `CFBundleName` | Versión |
|---|---|---|---|
| `~/Desktop/ABACO DEEP HARNES.app` | `io.abaco.deepcore` | `ABACO DEEP HARNES` | 0.4.0 |
| `~/Desktop/ABACO DEEP HARNES 2.app` | `io.abaco.deepcore` | `ABACO DEEP HARNES` | 0.3.0 |
| `dist/mac-arm64/ABACO DEEP HARNES.app` | `io.abaco.deepcore` | `ABACO DEEP HARNES` | 0.4.0 |
| `/Applications/DSH Desktop.app` | `io.dsh.desktop` | `DSH Desktop` | 0.7.2 |

**Las dos apps pueden coexistir: sus bundle ids ya difieren.** [V]

### 4.3 El caso del puerto 44127

El puerto fijo no es del motor, es **del bridge LAN de pairing móvil**, y es una
desviación introducida por el fork:

- Upstream: `this.options.port ?? 0` → **efímero** por defecto
  (`src/main/mobile/lan-mobile-bridge.ts`, upstream v0.7.2). [V]
- Fork: pasa `port: developmentBuild ? 44128 : 44127` desde
  `src/main/index.ts:2939`. [V]
- El build instalado de DSH Desktop 0.7.2 contiene el literal `43127` (y
  `43128`) en `out/main/index.js`. [V]
- El fork añadió además un fallback: si el puerto pedido está ocupado hace
  `console.warn('[lan-mobile-bridge] port … is already in use; using an
  ephemeral port')` y escucha en efímero. [V] — por eso hoy degrada en lugar de
  romper.
- `43127` **ya no aparece** en `src/`, `out/` ni `dist/` del fork: sobrevive solo
  en tests, y el propio test documenta la causa —
  `test/lan-mobile-bridge.test.ts:1190`: *"stock DSH Desktop holds the 43127
  LAN-bridge seat on 0.0.0.0"*. [V] Eso confirma que el asiento en disputa era
  el bridge LAN, no el motor.

**Acción recomendada:** volver a `?? 0`. El puerto fijo no aporta nada (el
bridge publica su URL por QR) y reintroduce exactamente el modo de fallo
original. Si se quiere puerto estable por firewall, debe ser un valor propio de
ABACO y configurable, no una constante en el código. [I]

### 4.4 Fugas de identidad que quedan (lista accionable)

Todas verificadas por lectura [V]:

| Fuga | Ubicación | Visible para el usuario |
|---|---|---|
| Páginas de pairing móvil dicen `DSH Mobile` | `src/main/mobile/lan-mobile-pages.ts:15,18,194,305,312` (`<title>DSH Mobile</title>`, `Reconnect DSH`, `Pairing DSH`, `Connected. Opening DSH…`) | **sí** (móvil) |
| Fallback a `~/.dsh` cuando `DSH_HOME` no está definido | `packages/abaco-vault/index.js:159`, `packages/dshmarket/lib/home-paths.js:9` | no, pero **comparte perfil con cualquier DSH** |
| POC de desarrollo apunta al perfil viejo | `scripts/generation-poc.mjs:45` → `AppData/Roaming/dsh-desktop/harness` | no |
| Logos de marca con nombre DSH | `src/main/index.ts:642-650` lee `dsh-desktop-logo-{light,dark}.png` de `@deepseek-ai/dsh-web-frontend`; los copia `scripts/install-brand-assets.mjs:17-18` | **sí** (sidebar/hero) |
| `app.setAppUserModelId` **no se llama en ningún sitio** | 0 ocurrencias en `src/` | Windows: agrupación en taskbar |
| Etiqueta de menú `Harness` / `HARNESS` | `src/main/index.ts:2737`, `src/preload/windows-menu.ts:186` | sí (neutro, no "DSH") |
| Título de ventana vacío | `src/main/index.ts:946` | sí |
| Mensaje de recuperación dice "compatible DSH plugin" | `src/main/plugin-recovery-view.ts:110,114` | sí (solo en fallo) |
| Tooltip de la barra del navegador menciona `$DSH_HOME/skills` | `build/abaco-browser-chrome.html:506` | sí |
| Vars NSIS `Dsh*` | `build/installer.nsh:6-8,15-19` | no (Windows) |
| Nombres de archivo de parche | `package.json:359-364` → `dsh-desktop.patch.yml`, `dsh-desktop-safe.patch.yml` | no |
| Ids de fila `dsh-desktop-*` | `build/dsh-desktop.patch.yml:15,21,47,55` | no |
| **Registros fantasma en LaunchServices** | builds borrados/antiguos: `~/Desktop/ABACO DEEP HARNES 2.app` (0.3.0), rutas en `/Volumes/…` | sí (abre la app equivocada) |

### 4.5 Cómo se comprueba cada uno

```bash
# 1. Identidad del bundle construido
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "dist/mac-arm64/ABACO DEEP HARNES.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Print :CFBundleName"       "dist/mac-arm64/ABACO DEEP HARNES.app/Contents/Info.plist"
# esperado: io.abaco.deepcore / ABACO DEEP HARNES   (nunca io.dsh.desktop)

# 2. Perfiles separados: las dos apps vivas a la vez, cada una con su carpeta
ls -d ~/Library/Application\ Support/abaco-deep-core ~/Library/Application\ Support/dsh-desktop
# esperado: ambas existen y son directorios distintos

# 3. Cero puertos fijos nuevos + motor efímero
grep -rnE "port:\s*[0-9]{4,5}" desktop/*/src --include=*.ts
# esperado: solo el bridge móvil, y con fallback a efímero

# 4. Registros fantasma de LaunchServices
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump \
  | grep -iE "abaco deep harnes" 
# limpiar con: lsregister -u "<ruta de la build borrada>"

# 5. Cero rastros de vendor en config y código
git grep -nE "dshdesktop\.com|file:packages/harness" -- . ':!docs' ':!CHANGELOG.md'
# esperado: sin resultados
```

---

## 5. Plan de migración por fases

Orden elegido: **primero hacer el motor dependencia (barato, reversible, sin
tocar UI), después el shell, y la identidad en paralelo porque es de bajo
riesgo.** Ninguna fase rompe la anterior.

### F0 — Congelar la línea base y hacer el delta visible
- Registrar el diff contra `v0.7.2` como artefacto (`git remote add upstream
  https://github.com/dataelement/dsh-desktop` + tag) y anotar los 6 parches de
  categoría (b) como "seam inevitable" en la matriz de §3.4.
- **Verificación:** `git log --oneline upstream/main ^HEAD` muestra los commits
  de upstream que faltan; existe la matriz con 20 entradas.

### F1 — Motor como dependencia versionada
- Sustituir `file:packages/harness-0.1.2-rc.1/**/*.tgz` por `0.1.2-rc.1` exacto;
  borrar los 254 tarballs y `npm-vendor`.
- **Verificación:** `npm ls @deepseek-ai/dsh --all` → una sola versión, cero
  `file:`; `patch-package --error-on-fail` limpio en `node_modules` nuevo;
  `dsh --profile web --patch build/dsh-desktop.patch.yml --dump-config` compone
  sin error; suite de tests del shell en verde.
- **Rollback:** revertir el commit. No toca UI.

### F2 — Los parches, justificados uno por uno
- Clasificar los 9 de categoría (a): migrar a ocupante de slot o borrar. Los 2
  de (c) se mantienen (son fixes que upstream no tiene). El de (e)
  `directory-picker-native` se reevalúa: los slots
  `conversation.workspace.directoryFlow` son `single` y documentados como
  ocupables por el shell; un plugin debería poder ocuparlos.
- **Verificación:** cada parche restante tiene (versión, test, motivo); el
  conteo debe bajar de 20. Los tests `test/*-patch.test.ts` siguen en verde.

### F3 — Shell propio, en paralelo, sin borrar nada todavía
- Crear `desktop/shell/` con main + preload propios. Portar
  `harness-runtime.ts` + los 12 archivos `abaco-*`. Arrancar la app desde el
  shell nuevo apuntando al motor de registro.
- **Verificación:** la app abre desde `desktop/shell/`, sirve el mismo perfil
  `--patch`, y el agente responde. La tercera columna se abre y el navegador
  navega. Los 20 archivos de test del browser siguen pasando.
- **[NV]** Este es el paso que exige lanzar la app. Nada de F3 se puede dar por
  bueno sin ejecución real.

### F4 — Retirar la copia
- Borrar `desktop/src/dsh-desktop/`. Mover a `docs/` lo que sea documentación
  propia (`docs/abaco-browser.md`) y preservar `NOTICE`/`LICENSE` del upstream
  si queda código derivado.
- **Verificación:** `git grep -l "dsh-desktop"` vacío fuera de `docs/`;
  `npm install` limpio; build del `.app` y `PlistBuddy` correcto; arranque
  manual con sesión creada, micrófono, upload y browser operativos.

### F5 — Identidad: cerrar las fugas de §4.4
- `lan-mobile-pages.ts` a marca ABACO; `~/.dsh` fuera (exigir `DSH_HOME`
  explícito); borrar/reapuntar `scripts/generation-poc.mjs`; renombrar los logos
  inyectados; llamar `app.setAppUserModelId`; decidir el puerto del bridge
  (recomendado: efímero).
- **Verificación:** las 5 comprobaciones de §4.5; limpieza de LaunchServices con
  `lsregister -u` para builds borradas.

### F6 — Verificación de independencia total
- Con **DSH Desktop abierto y en uso**, abrir ABACO: debe abrir su propia
  ventana, con su propio perfil, sin traerse al frente la otra app, sin
  `EADDRINUSE`, y sin que ninguna escriba en la `userData` de la otra.
- **Verificación:** `lsof -nP -iTCP -sTCP:LISTEN | grep -E "ABACO|DSH"` muestra
  conjuntos de puertos disjuntos; comparar mtime de ambas carpetas de `userData`
  antes/después para probar que no se cruzan.

---

## 6. Riesgos

| # | Riesgo | Síntoma observable | Mitigación |
|---|---|---|---|
| R1 | El shell propio reimplementa mal el arranque del motor (token, PATH de login, `DSH_HOME`) | ventana en blanco, "Cannot reach Harness", herramientas que no encuentran `git`/`rg` | Portar `harness-runtime.ts` con sus tests; probar en macOS y con PATH mínimo (`launchd`) |
| R2 | Perder `safe-mode` / recuperación de plugins | un plugin roto deja la app **irrecuperable**, sin UI de rescate | Conservar safe-mode en el shell mínimo; es la única pieza "de producto ajeno" con valor defensivo real |
| R3 | Se borra sin querer una capacidad usada (market, PPT, pairing móvil) | el usuario reporta que "desapareció" una función que creía del producto | Decisión explícita del dueño antes de F4; los removidos van a backlog, no se borran del historial |
| R4 | `patch-package` se rompe al subir de versión del motor | `npm install` falla o el parche aplica a medias; la UI muestra comportamiento híbrido | Matriz §3.4 con versión+test por parche; `--error-on-fail` en CI; **nunca** dejar `node_modules` con una revisión ya parcheada al reinstalar |
| R5 | Los parches de categoría (a) se vuelven deuda invisible | tras un rebase, la UI "pierde" un retoque sin que ningún test falle | Cada parche con test propio (`test/*-patch.test.ts`); contar parches en CI |
| R6 | Un plugin `abaco-*` viola el contrato de Cordis y mata el árbol | **toda** la UI deja de cargar (ya ocurrió: `abaco-context`) | Regla ya aprendida (`PLAN-TRABAJO.md` regla 2): en `client.js` nunca `ctx.algo = X`; usar `inject: ['slots']` + `ctx.slots.register`. `abaco-brand/client.js` **sí** hace `ctx.abacoBrand = BRAND` — corregirlo antes de rehabilitarlo |
| R7 | `userData` vuelve a colisionar por un cambio de `app.getName()` | la app "se abre sola", las dos se superponen, `EADDRINUSE` | `app.setPath('userData', …)` con literal fijo, nunca derivado del nombre (ya correcto, `index.ts:533`); test que lo afirme |
| R8 | El motor sube a `0.1.5-rc.1` sin revalidar parches | fallos raros de sesión/borrado, contratos Typert desalineados | Fijar versión exacta; actualizar solo en un commit dedicado con la matriz revalidada y `--dump-config` |
| R9 | Se confunde de nuevo qué árbol se está tocando | un agente edita la copia en vez de la fuente de verdad | Eliminar la copia es la mitigación; mientras exista, marcar `desktop/src/dsh-desktop/README.md` como **copia de terceros** |
| R10 | El harness dentro de `utilityProcess` de Electron carece de internals de Node | fallo de arranque del perfil en builds firmados — ya documentado en `build/dsh-desktop.patch.yml` (motivo del plugin `dsh-desktop-hmr-fallback`) | Si el shell propio lanza el motor con un Node real, el fallback puede no hacer falta; **verificarlo**, no asumirlo [NV] |
| R11 | Third column: `-webkit-app-region: drag` en una vista hija | la barra del navegador no arrastra la ventana | Ya anotado como no verificado en `docs/abaco-browser.md`; probar al primer lanzamiento |

---

## 7. Anexo: verificado, inferido y no verificado

### Verificado en esta investigación
- Publicación en npm de `@deepseek-ai/dsh` (`latest = 0.1.2-rc.1`, `next =
  0.1.5-rc.1`, `alpha = 0.1.5-alpha.2`) y de los paquetes muestreados
  (`dsh-base`, `dsh-agent-presets`, `dsh-client-ui-layout`, `dsh-client-ui-sidebar`,
  `dsh-client-ui-chat`, `dsh-compaction-basic`, `dsh-client-ui-slots`).
- `dsh-desktop` publicado solo hasta `0.2.0`; `dsh-desktop-client-ui`,
  `dsh-desktop-hmr-fallback`, `dsh-desktop-preset-transfer` **no publicados**;
  `dsh-desktop-client-ui` declara `"private": true`.
- Contrato de arranque del motor y puerto efímero (`harness-runtime.ts`).
- Delta exacto contra `dsh-desktop` v0.7.2 (486 / 97 / 1.963 / 269).
- Registros de slot usados por `abaco-voice`, `abaco-documents`, `abaco-browser`.
- `slots.register` exige declaración previa del nombre.
- Identidad: `appId`, `productName`, `app.setName`, `app.setPath('userData')`,
  orden respecto al lock de instancia, y los `Info.plist` reales de 4 bundles.
- Fugas de identidad de §4.4.
- Inventario y clasificación de los 20 parches.

### Inferido (no ejecutado)
- Que el lock de instancia única se derive de `userData` (semántica documentada
  de Electron; no probado aquí).
- Que la colisión de puerto original fuera el bridge LAN compartido en 43127, y
  que volver a puerto efímero la elimina.
- Que el shell propio puede prescindir de `dsh-desktop-hmr-fallback` si el motor
  corre sobre un Node real.
- La lista de "lo que se pierde" en §3.3 depende de qué use el producto: falta
  confirmación del dueño.
- Esfuerzo/tamaño del shell mínimo (~30 archivos): estimación a partir del delta
  medido, no un plan detallado.

### No verificable sin lanzar la app
- Que la tercera columna funcione íntegra desde un main propio sin el código de
  `dsh-desktop` (arrastre de la barra, timing de `capturePage()`, foco).
- Latencia de descubrimiento del `SKILL.md` generado por el browser
  (`dsh-skill-filesystem` con watcher chidori a profundidad 1).
- Que dos apps convivan sin interferencia bajo uso simultáneo real (F6).
- Que `window.dshAbacoBrowser.saveSkill()` esté efectivamente alcanzable desde la
  página del Harness (el canal existe; nadie lo llama todavía).

### Cómo se verificaría lo no verificado
Lanzamiento manual (nunca automático: `PLAN-TRABAJO.md` regla 1) con la checklist
de F3/F6; `--dump-config` para composición; `lsof` para puertos; comparación de
mtime en ambas carpetas de `userData` para aislamiento; y `PlistBuddy` para
identidad del bundle.
