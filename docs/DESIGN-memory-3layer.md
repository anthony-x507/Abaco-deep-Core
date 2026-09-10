# DESIGN — Memoria de contexto avanzado de 3 capas (ABACO DEEP HARNES)

> **Estado:** diseño de implementación (Fase 1). **No implementado. Ninguna línea de código modificada.**
> **Base:** `docs/DESIGN-compaction.md` (diagnóstico del motor actual + 4 carriles). Este documento lo
> convierte en un plan de integración verificado contra el código real del harness.
> **Alcance:** el motor que ejecuta la app real (`desktop/src/dsh-desktop/node_modules/@deepseek-ai/`,
> paquete **0.1.2-rc.1** vendored en el fork) y el fork del shell (`desktop/src/dsh-desktop/`).
> **Fecha:** 2026-09.
>
> **Ancla de rutas.** Salvo indicación explícita, las rutas son relativas a la raíz del repo
> `abaco-deep-core/`. Las citas del harness son relativas a
> `desktop/src/dsh-desktop/node_modules/@deepseek-ai/` y las del shell a `desktop/src/dsh-desktop/`.
> Toda afirmación de mecánica interna lleva `archivo:línea` verificado en lectura directa del
> 0.1.2-rc.1 instalado (índice completo en §8).
>
> **El modelo de producto (spec del usuario).** Tres capas:
> 1. **Ventana del turno** — lo reciente (lo que dijo el usuario, lo que respondió el agente, archivos
>    abiertos, acciones recientes), con tope; al llenarse el sistema resume **solo**, el resumen se queda
>    y el detalle viejo sale de la ventana viva.
> 2. **Memoria durable** — lo que no debe morir (preferencias, datos clave, decisiones, estado de
>    proyectos), separado del chat, que sobrevive a la compactación y al cierre de la app; el agente
>    retoma al día siguiente sin repreguntar.
> 3. **No meter basura** — el contenido crudo pesado (HTML, logs, informes de 20 páginas) no entra a la
>    ventana: se delega y se guarda; a la ventana entra solo el corte.

---

## 0. Resumen ejecutivo

**Hallazgo central de viabilidad (lo que cambia el plan respecto de `DESIGN-compaction.md`):**

| Capa | Estado real en el 0.1.2-rc.1 vendored | Qué falta |
|---|---|---|
| **1. Ventana + resumen** | Motor `dsh-compaction-basic` **configurable por composición de preset de agente** (umbral, retención absoluta, `maxTokens`, modelo de resumen, políticas por modelo) y **sustituible por subclase** sin tocar el paquete (`compactIfNeeded` se despacha dinámicamente, `dsh-compaction-basic/lib/index.js:772-776`; `summarize()` es el hook documentado, `:836-846`). En la instalación actual corre **con defaults puros** y compacta en mitad del turno. | Política de disparo (no compactar en mitad de tarea, máx. 1 por tarea, nunca `retainTokens=0`), resumen jerárquico anti «resumen-de-resumen», y medición con tokens reales. |
| **2. Memoria durable** | **No existe ningún servicio de memoria** (ni `ctx.store`, ni `ctx.memory`, ni paquete `*memory*`). Sí existen las piezas para construirla: `ctx.settings` (namespaces con esquema), `ctx.storageDomain` (KV validado y durable), patrón `credentials-local` (documento con lock + escritura atómica) y `node:fs` sin restricciones para plugins host. | Todo: almacén por facetas, tools `memory_*`, inyección por request y poda. |
| **3. Delegación / no basura** | **Casi todo existe y está activo**: `ctx.spillStore.saveText()` (`dsh-spill/lib/index.js:54-59`) + `dsh-spill-local` + `dsh-spill-policy` montados en el perfil base con `maxInlineBytes: 50000` (`dsh-base/cordis.patch.yml:386-392`); el policy reemplaza resultados de tool enormes por preview head/tail + localizador + instrucción de recuperación vía el waterfall `tools/post-execute` (`dsh-spill-policy/lib/index.js:136-153`; `dsh-tools/lib/index.js:3379`). Medido: 11 avisos de spill reales en 81 sesiones. | Bajar el tope; hacer el almacén **durable** (el backend local escribe en `tmpdir()`, `dsh-spill-local/lib/index.js:17,69-70`); índice de recuperación; y **tapar el hueco del aviso `subagent-settled`**, que entra verbatim sin pasar por el spill (`dsh-subagent/lib/index.js:1761-1796`). |

**Estrategia.** Dos plugins propios del fork + un preset de agente ABACO + configuración, **sin modificar
ningún paquete publicado** (regla heredada de `DESIGN-compaction.md` §4):

1. `abaco-memory` (**Capa 2 + brazos de Capa 3**): almacén por facetas en
   `<DSH_HOME>/abaco-memory/*.json`, tools `memory_set` / `memory_get` / `memory_forget`, **inyección por
   request** mediante una sección dinámica de system prompt (`ctx.systemPrompt.section`, patrón idéntico
   a `dsh-user-approval/lib/index.js:77-90`), un brazo en `tools/post-execute` que guarda el informe
   completo de una delegación en un *vault* durable dejando solo el corte en la ventana, y un segundo
   brazo en `agent/pre-step` para el aviso `subagent-settled` (que no pasa por el spill).
2. `abaco-context` (**Capa 1**): motor de compactación propio que **hereda de `BasicCompactionEngine`**
   y sobrescribe `summarize()` (plantilla de preservación + resumen por episodios con capas
   `Previously/Newly`) y `compactIfNeeded()` / `compactNow()` (disparo en *idle*, nunca en mitad de
   tarea, máximo 1 por tarea, nunca `retainTokens = 0`), montado como `ctx.compaction` en el realm
   aislado del preset.
3. **Preset ABACO** (composición de agente, **id nuevo** porque los shipped no se pueden sombrear) que
   sube la retención verbatim, baja el umbral, sube el `maxTokens` del resumen y aporta la
   persona/protocolo de memoria (el tope de inline de la Capa 3 lo fija el brazo propio del plugin, §5).

Todo esto se apoya en tres mecanismos del harness que ya existen y están diseñados exactamente para este
uso: **secciones/contextos de system prompt dinámicos** (Capa 2), **waterfalls de extensión**
(`agent/pre-step`, `agent/request`, `tools/post-execute`, `system-prompt/assemble`) y **planes de
composición** (host plane / agent plane / preset) con *realms* aislados (Capa 1).

---

## 1. Arquitectura de las 3 capas integrada con el harness

### 1.1 Dónde vive cada cosa: planos y puntos de anclaje

El harness arranca la app con `web --patch <Resources>/dsh-desktop.patch.yml` (verificado en
`docs/TECH-plugin-loading.md` §1, `src/main/runtime/harness-runtime.ts:184-200,369-399`). La composición
real del perfil `web` es `bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]`,
y **`dsh-web-app/cordis.patch.yml` mueve el plano de agente detrás de *agent presets***
(`dsh-web-app/cordis.patch.yml:305-315`, comentario «the agent plane moves behind agent presets»):

| Plano | Qué contiene | Evidencia |
|---|---|---|
| **Host plane** (singleton por proceso) | `settings`, `credentials`, `storage`, `token-meter`, `spill-local`, `spill-policy`, `session-persistence`, `sessions`, `agents`, `subagent` registry, `agent-presets` roster | `dsh-base/cordis.patch.yml:87-98,141-156,323-332,386-397`; `dsh-web-app/cordis.patch.yml:433-444` |
| **Agent plane / preset** | persona, instrucciones, tools, **el motor de compactación** (`compaction-basic` + `command-compact` + `tool-result-pruner`), backends de delegación (tools) | `dsh-agent-presets/presets/standard/agent.cordis.yml:126-155,157-250` |
| **Realm aislado** | Cada fila de servicio dentro de un preset debe ir en un grupo `cordis:group` con `isolate:`; el grupo `compaction` aísla `compaction` y `toolResultPruner` | `presets/standard/agent.cordis.yml:137-145` |

Consecuencias prácticas para el diseño:

- Un plugin de **memoria** que sirva a todos los agentes y guarde en disco debe vivir en el **host
  plane** (singleton, con acceso a `DSH_HOME`), no en un preset.
- El **motor de compactación** debe montarse **dentro** del grupo `compaction` del preset (es el único
  lugar donde se publica `ctx.compaction`); se sustituye la fila `compaction-basic` por la fila propia.
- El **tope de inline de la Capa 3** (`spill-policy`) es una fila **host-plane** del `dsh-base`
  (`:386-392`), no una fila de preset. Cambiar su `maxInlineBytes` exige reconfigurar esa fila desde el
  patch del perfil (a verificar, §7.2-3) o —preferible y sin depender del mecanismo del overlay— poner el
  tope en un **brazo propio** dentro del plugin de memoria (ver §5), que es determinista.

**Presets — hechos verificados que condicionan el plan:**

- El fichero de composición es `agent.cordis.yml` (`dsh-agent-presets/lib/index.js:182`); el roster los
  descubre por raíces (`:392-429`), prepende la raíz *shipped* del paquete y añade la raíz de usuario
  **`$DSH_HOME/.agent-presets`** (`USER_PRESET_DIR` `:195`, defaults `includeShippedRoot/includeUserRoot`
  `:1246-1247`); la fila del roster nombra el default (`dsh-web-app/cordis.patch.yml:440-444`,
  `default: standard`).
- **En la instalación observada el preset activo es `cordis`**, no `standard`
  (`<DSH_HOME>/settings.yaml` → `agent-presets: { default: cordis }`).
- Las filas del motor existen en **`standard` (`presets/standard/agent.cordis.yml:137-155`), `ptc`
  (`:144-162`) y `cordis` (`:125-155`)**, y **no existen en `minimal`** — es decir, «sin compactación»
  ya es hoy una elección de preset.
- **Un preset shipped no se puede *sombrear* por nombre**: gana la raíz anterior
  («an earlier root wins a duplicate id: a shipped preset shadows any directory that claimed its name»,
  `dsh-agent-presets/lib/index.js:422-423,1257-1259`). Por tanto ABACO debe entregar un **id nuevo**
  (p. ej. `abaco`) en `$DSH_HOME/.agent-presets/abaco/agent.cordis.yml`, o añadir una raíz de despliegue
  por `roots: [{path, trust}]` en la fila `agent-presets`. Esa raíz de usuario es el punto limpio para
  cambiar la política de compactación **sin pisar `node_modules`**.
- **Corrección importante frente a `DESIGN-compaction.md` §3.5/§4:** el motor **ya no es una fila del
  host plane**. `dsh-web-app/cordis.patch.yml:380-394` deshabilita `compaction-basic`, `command-compact`
  y `tool-result-pruner` en el plano base y cada preset monta los suyos en un realm aislado
  (`isolate: {compaction: true, toolResultPruner: true}`). En consecuencia, **`build/dsh-desktop.patch.yml`
  NO es el sitio para retocar la política del motor**: sirve para insertar filas host-plane propias
  (como `abaco-memory`), no filas de preset. El sitio correcto son el preset (nuevo id) o la fila
  `agent-presets`.

### 1.2 Capa 1 — Ventana del turno y resumen: integración verificada

**Cómo funciona hoy (bucle real):**

1. El loop construye el system prompt en **cada pre-step**: `systemPrompt.assemble(assembleContextFor(...))`
   → `renderContextSections` → `renderPrompt` (`dsh-agent-loop/lib/index.js:497-519,616`).
2. Dispara el waterfall **`agent/pre-step`** con `{messages, turn, step, signal}` y por defecto entra con
   los mensajes reclamados + el snapshot de runtime-context (`dsh-agent-loop/lib/index.js:506-513`).
3. El motor de compactación escucha ese mismo waterfall y compacta **en mitad del turno**:
   `ctx.on("agent/pre-step", async ({agent, signal}, next) => { ... this.compactIfNeeded(agent, "pressure", signal) ... return next() })`
   (`dsh-compaction-basic/lib/index.js:782-795`); la recuperación de overflow escucha
   `agent/request-error` (`:804-830`).
4. `compactIfNeeded` mide con `ctx.tokenMeter.measure(agent.session)`, compara contra
   `thresholdTokens = floor(contextWindow × thresholdRatio)` y, **si califica**, poda tool results y
   compacta (`:857-904`; presupuestos en `:108-126`). El pruner **solo corre tras calificar**
   (`:885-889`) — no en cada step.
5. `compactRegion(start,end,agent,signal)` ejecuta la transacción durable con `owner:"current-turn"`
   (`:914-919`); el camino manual `compactNow` usa `owner:null` y `agent.runMaintenance(...)`
   (`:928-954`), es decir **solo con el agente idle**, pero con `retainTokens = 0` (`:935`).
6. En overflow, la presión ignora la retención: `selectCompactableRange(agent.session, measurement, 0)`
   (`:875`).

**Punto de sustitución (verificado):**

- El contrato es el servicio `ctx.compaction`, publicado por `CompactionEngine` con
  `super(ctx, "compaction")` (`dsh-compaction/lib/index.js:172-176`).
- `BasicCompactionEngine` declara `static inject = ["llm","tokenMeter","sessions"]`
  (`dsh-compaction-basic/lib/index.js:745-749`) y `static Config = z.object({...})` con toda la política
  (`:750-761`).
- La política de disparo **es sustituible por subclase** porque el listener despacha el método
  dinámicamente: «`compactIfNeeded` stays dynamically dispatched so subclass overrides are honored at
  event time» (`:772-776`), y `regionDependencies()` enlaza `summarize` a `this.summarize` (`:956-961`),
  con `summarize()` documentado como «the sole subclass hook» (`:836-846`).
- El reemplazo se monta cambiando una fila del preset: en
  `dsh-agent-presets/presets/standard/agent.cordis.yml:137-155` el grupo
  `- id: compaction / name: cordis:group / isolate: {compaction: true, toolResultPruner: true}` contiene
  las filas `compaction-basic`, `command-compact` y `tool-result-pruner` con su config.

**Qué implementa la Capa 1 (resumen):** un motor `abaco-context` que conserva la transacción durable del
harness (bracket, eventos, `surfaceOp: replace`, checkpoint con marca `compactCheckpointSource`,
`dsh-compaction/lib/index.js:109-133`) y cambia solo lo que hoy degrada: **cuándo** dispara y **cómo**
resume. Detalle de config y reglas en §4.

### 1.3 Capa 2 — Memoria durable: integración verificada

Es la capa que **no existe** y la de mayor valor. Piezas verificadas:

**(a) Inyección en cada request — dos vehículos reales.**

- **Sección de system prompt dinámica** (elegida como vehículo primario):
  `ctx.systemPrompt.section({name, order, text})` registra una sección ordenada en el scope del ctx
  llamante (`dsh-system-prompt/lib/index.js:229-232`); `text` **puede ser función** y se evalúa en cada
  *assembly* con el contexto del agente (`:326-334`, en particular
  `text: typeof section.text === "function" ? section.text(context) : section.text` en `:330`).
  El `context` es `{agent, scope, signal}` (`dsh-agent/lib/index.js:384-390`), así que la sección puede
  renderizar la memoria **por agente/sesión** leyendo `context.agent.session`.
  Ejemplo real de plugin con texto dinámico por agente: `dsh-user-approval/lib/index.js:77-90`
  (`scope.systemPrompt.context({name:"approval:policy", order: getContextOrder("APPROVAL_POLICY"), text: (context) => {...}})`).
  El system resultante se envía en **cada** request (`dsh-agent-loop/lib/index.js:616,770`), y la
  compactación **no puede tocarlo** (el contrato de superficie solo reemplaza `user/message`,
  `dsh-compaction/README.md`; el system vive en el `request/header`).
- **Contexto de runtime** (alternativa para estado volátil que deba verse en el transcript):
  `ctx.systemPrompt.context({name, order, text})` (`dsh-system-prompt/lib/index.js:255-258`) alimenta el
  snapshot «Current runtime context. This snapshot supersedes earlier runtime-context snapshots.»
  (`:127-131`) que el loop **proyecta como `user/message`** solo cuando cambia y **se auto-repara tras una
  compactación** (`dsh-agent-loop/lib/index.js:28-85` y `:497-519`; detección de reemplazo en `:56`).
  Órdenes reservados: `SANDBOX_POLICY 110`, `APPROVAL_POLICY 115`, `SUBAGENT_DELEGATION 120`
  (`dsh-system-prompt/lib/index.js:42-46`).

**(b) Escritura/lectura persistente.** No hay `ctx.store`, `ctx.paths` ni `ctx.home`. Sí hay:

| Vía | API real | Dónde escribe | Cuándo usarla |
|---|---|---|---|
| Ficheros JSON propios (elegida) | `node:fs/promises` + `writeFileAtomic` + `withFileLock` (patrón de `dsh-credentials-local/lib/index.js:604-630` y `dsh-settings-file/lib/index.js:163-176`) | `<DSH_HOME>/abaco-memory/…` (0600/0700) | memoria por facetas, inspeccionable y legible por el propio agente |
| KV validado del harness | `ctx.storageDomain.open(defineDomain({...}))` → tablas `get/put/update/delete/entries` (`dsh-storage-domain/lib/index.js:232-297,355-398`), backend `json` con escritura fsync+rename (`dsh-storage-json/lib/index.js:25-41`) | `<DSH_HOME>/storages/<dominio>/…` | si se prefiere esquema zod + eventos `domain/changed` (`:214-220`) |
| Settings | `ctx.settings.register(ns, schema, {base})` → `{get, watch, update, replace}` (`dsh-settings/lib/index.js:281-315`) | `<DSH_HOME>/settings.yaml` (atómico, con lock, hot-reload) | preferencias tipadas y pequeñas; visibles para la UI de settings |
| Attachments | `ctx.attachments` → blobs content-addressed en `<DSH_HOME>/attachments/v1/objects/<2hex>/<sha256>` | `<DSH_HOME>/attachments` | artefactos grandes opacos (no memoria legible) |

`<DSH_HOME>` se resuelve con `resolveDshHome()` / `dshHomePath()` (`dsh-home-paths/lib/index.js:73-84`;
el shell inyecta `DSH_HOME = <userData>/harness`, `src/main/index.ts:2591`, `harness-runtime.ts:256-258`).
**No usar `ctx.fs` para esto**: es el seam de las tools del modelo y está enjaulado por política
(`dsh-fs-sandbox/lib/index.js:153-166`; raíces escribibles = workspace + `/tmp` + `tmpdir()`,
`dsh-sandbox/lib/index.js:155-162`), mientras que un plugin host escribe con `node:fs` sin reja
(igual que todos los stores del harness).

**(c) Ciclo de vida y eventos donde engancharse.**

| Evento | Emisor (verificado) | Uso en memoria |
|---|---|---|
| `agent/created` / `agent/disposed` | `dsh-agent/lib/index.js:661-683` / `:639-653` | cargar/liberar la caché de memoria del agente |
| `agent/session-start` | `dsh-agent-loop/lib/index.js:1257` | primera carga tras `resume` desde persistencia |
| `agent/pre-step` (waterfall) | `dsh-agent-loop/lib/index.js:506-513` | punto donde el harness evalúa la memoria (vía sección) |
| `agent/turn-stopping` (serial) | `dsh-agent-loop/lib/index.js:570-575` | cierre de turno: refresco determinista de estado |
| `agent/status` (`idle`) | `dsh-agent-loop/lib/index.js:393,487-494` | disparar trabajos en *idle* (compactación, GC de memoria) |
| `session/event` (`turn/end`, `tool/result`, …) | `dsh-session/lib/index.js:1430-1435` | journaling, detección de fronteras de tarea |
| `tools/post-execute` (waterfall, scope agente) | `dsh-tools/lib/index.js:3379` | Capa 3: guardar el resultado completo y dejar el corte |

**(d) Herramientas del agente.** `defineTool({name, description, parameters, output, execute, render})`
(`dsh-tools/lib/index.js:837`) y registro con `ctx.tools.register(...)` (`:2774-2782`, registro por
capas de scope). El ejecutor recibe `(args, exec)` con `exec.agent` (agente propietario, con `session`)
— patrón real en `dsh-tool-todo/lib/index.js:95-190` (`execute(args, exec)` en `:170`,
`exec.agent.session.append(...)` en `:172`). Es exactamente lo que necesitan `memory_set/get/forget`.

### 1.4 Capa 3 — Delegación / «no meter basura»: integración verificada

- **Servicio de spill**: `ctx.spillStore` (`SpillStore`, `super(ctx, "spillStore")`,
  `dsh-spill/lib/index.js:54-59`). Contrato: `saveText({owner:{sessionId}, source, suggestedName, content})`
  persiste el texto **completo y verbatim** y devuelve `{locator, bytes, retrievalHint}`.
- **Backend local**: `dsh-spill-local` escribe en una raíz privada por proceso
  (`mkdtempSync(join(tmpdir(), "dsh-spill-"))`, `dsh-spill-local/lib/index.js:17,30-35`) con directorio
  por sesión (`session-<sha256[0:12]>`, `:69-70`), fichero 0600 (`:77-103`) y devuelve
  `retrievalHint: "Use read with offset/limit, or grep this path to search within it."` (`:564-566`).
  Config: `{root, cleanupPeriodDays=30}` (`:482-485`) — **la raíz es configurable**, por defecto temporal.
- **Política de spill**: `dsh-spill-policy` es un transformador de resultados registrado en el waterfall
  `tools/post-execute` con `{prepend: true}` (`dsh-spill-policy/lib/index.js:136-153`): si el texto plano
  supera `maxInlineBytes`, guarda el completo y sustituye el resultado por preview head/tail + aviso con
  localizador (`:66-135`). Es *no-op* sin `maxInlineBytes` (`:52,86`), salta llamadas anidadas y la tool
  `read` (`:138`), y es best-effort (`:36-38,117-122`). Hay un segundo brazo para el log durable
  (`tools/ptc-dispatch-log`, `:154-166`).
- **Está montado y activo**: `dsh-base/cordis.patch.yml:386-392`
  (`spill-local` sin config + `spill-policy` con `maxInlineBytes: 50000`).
- **Los informes de subagente llegan por DOS caminos, y solo uno pasa por el spill** (hallazgo decisivo
  del análisis; corregiría una conclusión demasiado optimista):
  1. **Subagente en primer plano** → el resultado del tool `subagent` es texto plano y **sí** pasa por
     `tools/post-execute` (`dsh-tool-subagent/lib/index.js:271-274,314-331,480`; se incurre en el aviso
     de spill si supera el tope).
  2. **Subagente en background/continuable (aviso de liquidación)** → el hijo se entrega al padre como
     **`user/message` con `source.kind: "subagent-settled"`** que embebe `terminal.output` **verbatim y
     sin tope, sin spill y sin truncar** (`dsh-subagent/lib/index.js:1761-1796`, entrega vía
     `parent.followup/steer/inject` en `:1789-1792`), y el loop lo apenda como mensaje de usuario al
     reclamarlo en la frontera de turno (`dsh-agent-loop/lib/index.js:559`). **Ese camino nunca pasa por
     `tools/post-execute`.** El único punto de intercepción es el waterfall **`agent/pre-step`**
     reescribiendo `decision.messages` (precedente real: `dsh-session-reference/lib/index.js:361-368`).
  Además, el hijo es instruido para empujar su resultado con `send_message` (`dsh-subagent/lib/index.js:910`),
  que es otra entrada de texto largo verbatim.
  El árbol de delegación aporta `origin:'subagent'`, `parentSession`, `delegationDepth` en el header de
  sesión (`dsh-session/lib/index.js:1617-1627`), útil para decidir qué se acorta.
- **Evidencia empírica del estado actual** (medición de solo lectura sobre los logs reales del entorno):
  en 81 logs de sesión hay **11 avisos de spill reales** (de `bash`, `web_fetch`, `job_output`,
  `grep-results`, `glob-results`) con artefactos de 19-132 KB en `-rw-------` dentro de directorios
  0700, más 19 avisos de truncado del spill de subprocesos. Es decir: la Capa 3 ya funciona para tools,
  pero **no** para los avisos de subagente del camino 2.

**Lo que añade la Capa 3 ABACO:** (1) bajar el tope de inline; (2) un *vault* durable propio (el spill
local vive en `tmpdir()`, raíz por proceso creada con `mkdtemp`, y se barre a los 30 días
—`dsh-spill-local/lib/index.js:17,35,484`—); (3) convertir el informe largo en una **faceta `artifacts`**
de la memoria (título, ruta, tamaño, resumen de 3 líneas, tarea asociada) para que el agente lo recuerde
mañana sin releer 20 páginas; (4) **cubrir el camino 2** (aviso `subagent-settled`) con una intercepción
en `agent/pre-step`; (5) reglas de delegación en la persona del preset.

### 1.5 Flujo por turno (quién hace qué, en qué hook)

```
TURNO N
  ├─ agent/pre-step (turn, step=1)
  │    ├─ systemPrompt.assemble()                       [dsh-agent-loop:502]
  │    │     └─ sección "abaco:durable-memory" (text: fn) ──► memoria congelada del turno   ◄── CAPA 2
  │    ├─ waterfall agent/pre-step
  │    │     ├─ abaco-context.compactIfNeeded()  ← solo si NO hay turno abierto / <=1 por tarea ◄── CAPA 1
  │    │     ├─ abaco-memory: acorta avisos user/message gigantes
  │    │     │     (p.ej. source.kind = "subagent-settled") → corte + locator     ◄── CAPA 3 (hueco §1.4)
  │    │     └─ (motor stock: compactaría aquí dentro del turno → se sustituye)
  │    └─ append user/message(s) al log                 [dsh-agent-loop:559]
  ├─ step(): request = header(system+tools) + deriveMessages()   [dsh-agent-loop:616,700-777]
  │    └─ llm.stream()  →  assistant/message | tool/call
  ├─ executeToolCalls()
  │    ├─ tools/post-execute (waterfall, scope agente)   [dsh-tools:3379]
  │    │     ├─ abaco-memory: vault durable + faceta artifacts + corte corto   ◄── CAPA 3
  │    │     └─ spill-policy stock (preview+locator)     [dsh-spill-policy:136]
  │    └─ tool/result append                             [dsh-agent-loop:310-319]
  ├─ (si el modelo llama memory_set / memory_get / memory_forget)   ◄── CAPA 2
  └─ agent/turn-stopping → turn/end append                [dsh-agent-loop:570-597]
       ├─ abaco-memory: refresco determinista (meta, tasks, audit)   ◄── CAPA 2
       │     └─ ctx.sessions.flush() para alinear puntero y artefacto
       └─ agent/status: idle → trabajos en idle
             ├─ abaco-context: compactación (owner null, retención absoluta)   ◄── CAPA 1
             └─ abaco-memory: GC/poda por TTL y presupuesto                   ◄── CAPA 2
```

---

## 2. Esquema de datos de la Capa 2 (memoria durable)

### 2.1 Ubicación y ficheros

Raíz por defecto: **`<DSH_HOME>/abaco-memory/`** (config `root`), donde
`<DSH_HOME> = <userData>/harness` (`src/main/index.ts:2591`; en macOS de la app empaquetada,
`~/Library/Application Support/abaco-deep-core/harness/abaco-memory/`). Si el producto quiere el archivo
en `<userData>/abaco-memory/` (fuera de `harness/`), se consigue con `root` en la fila del plugin —
el diseño es agnóstico y ambas rutas son válidas.

```
<DSH_HOME>/abaco-memory/
  profile.json                      # facetas globales del usuario (todas las sesiones/proyectos)
  projects/<projectKey>.json        # facetas por proyecto (cwd real de la sesión)
  sessions/<sessionId>.json         # estado vivo de la sesión/agente (tareas, próxima acción)
  roles/<agentPreset>.json          # conocimiento del rol (p.ej. "PUNTA", "ESTRATEGA")
  vault/<sessionId>/<ts>-<slug>.txt # informes/herramientas completos (Capa 3, texto verbatim)
  audit/memory.jsonl                # journal append-only: escrituras, podas, conflictos
  audit/archive/<YYYY-MM>.jsonl     # facetas expiradas archivadas (nunca borradas en silencio)
```

`projectKey` se deriva de `session.header.cwd` con las mismas reglas que la persistencia de sesiones
(`projectKey`/`encodeSegment` en `dsh-session-persistence-jsonl/lib/index.js:92-133`): nunca se mete una
ruta cruda como nombre de fichero. El id de sesión es `session.header.id`
(`dsh-session/lib/index.js:1617-1627`); el rol sale de `header.agentPreset`.

### 2.2 Formato: facetas con claves estables

Un único documento JSON por ámbito, con facetas direccionables por **path estable**. El agente escribe
por path (`memory_set("preferences.output_format", ...)`), nunca reescribiendo el documento completo.

```jsonc
{
  "version": 1,                       // versión de esquema del fichero (migraciones explícitas)
  "scope": { "kind": "project", "key": "--Users-a507-Documents-New-project--" },
  "updatedAt": "2026-09-09T18:22:41Z",
  "facets": {
    "identity":        { "agent_role": "PUNTA", "reports_to": "LEADER", "mission": "…verbatim…" },
    "preferences_user": [
      { "id": "pref-lang", "text": "reporta siempre en español", "priority": 3,
        "pinned": true, "createdAt": "2026-09-01T09:00:00Z", "source": "user:turn-3" },
      { "id": "pref-cite", "text": "nunca inventes fuentes: cita URLs", "priority": 3, "pinned": true,
        "createdAt": "2026-09-02T11:12:00Z", "source": "user:turn-9" }
    ],
    "constraints_do_not": [
      { "id": "dnt-cost", "text": "no lances búsquedas web sin delegar antes a un subagente",
        "priority": 2, "createdAt": "2026-09-05T08:00:00Z" }
    ],
    "output_format":   { "text": "informe en Markdown con secciones Hallazgos/Fuentes/Riesgos; URLs completas" },
    "projects_state":  [
      { "id": "proj-abaco", "text": "ABACO Deep Core: fase 1 de memoria de 3 capas en diseño; repo abaco_core",
        "priority": 2, "updatedAt": "2026-09-09T18:22:41Z" }
    ],
    "decisions": [
      { "id": "dec-001", "text": "no modificar paquetes @deepseek-ai publicados",
        "rationale": "el fork ya empaqueta 0.1.2-rc.1; los cambios van por plugins y composición",
        "priority": 2, "createdAt": "2026-09-08T10:00:00Z", "source": "agent:turn-12" }
    ],
    "facts": [
      { "id": "fact-compaction", "text": "compaction-basic compacta en agent/pre-step con retainRatio 0.16",
        "priority": 1, "expiresAt": "2026-12-08T00:00:00Z", "createdAt": "2026-09-09T12:00:00Z",
        "source": "agent:tool-read" }
    ],
    "artifacts": [
      { "id": "art-report-7f3", "text": "Informe completo de investigación de mercado (subagente research-2)",
        "locator": "<DSH_HOME>/abaco-memory/vault/session-…/1757441-market.txt",
        "bytes": 184320, "taskId": "task-market", "createdAt": "2026-09-09T17:40:00Z" }
    ],
    "tasks": [
      { "id": "task-market", "text": "investigar competencia ES", "status": "done",
        "next_action": null, "updatedAt": "2026-09-09T17:41:00Z" },
      { "id": "task-design", "text": "escribir DESIGN-memory-3layer.md", "status": "in_progress",
        "next_action": "fase 2: implementar abaco-memory MVP", "updatedAt": "2026-09-09T18:22:41Z" }
    ],
    "open_questions": [
      { "id": "q-1", "text": "¿el motor propio debe soportar /compact manual?", "priority": 1 }
    ]
  },
  "meta": { "lastTurn": 42, "lastWriteReason": "turn-stop", "renders": 118, "drops": 3 }
}
```

**Facetas y ámbitos**

| Faceta | Ámbito natural | Contenido | Inyectada |
|---|---|---|---|
| `identity` | `roles/<preset>.json` + `sessions/<id>.json` | rol, a quién reporta, misión (delegación verbatim) | sí (recortada) |
| `preferences_user` | `profile.json` | preferencias/correcciones del usuario, **verbatim** | sí (completas) |
| `constraints_do_not` | `profile.json` (+ proyecto) | prohibiciones y límites | sí |
| `output_format` | `profile.json` (+ proyecto) | formato exigido de salida | sí |
| `projects_state` | `projects/<key>.json` | estado del proyecto | sí (top-N) |
| `decisions` | `projects/<key>.json` | decisión + **rationale** | sí (top-N) |
| `facts` | `projects/<key>.json` | hechos verificados, con TTL | sí (top-N, con vencimiento) |
| `artifacts` | `projects/` + `sessions/` | punteros a informes/ficheros (locator + bytes) | sí (solo punteros) |
| `tasks` | `sessions/<id>.json` | tareas, estado, próxima acción | sí |
| `open_questions` | `projects/` + `sessions/` | preguntas que bloquean | sí |

**Reglas del esquema**

1. **Claves estables**: `id` corto y estable (slug) por faceta; el `id` es la clave de upsert. Los paths
   que el agente usa son `faceta.<id>.campo` o `faceta[+].{...}` para append con id autogenerado.
2. **Procedencia obligatoria**: toda entrada lleva `source` (`user:turn-N`, `agent:turn-N`,
   `subagent:<id>`, `tool:read`) y `createdAt`/`updatedAt`. Sin procedencia no se escribe (se rechaza).
3. **Verbatim para el usuario**: las citas de preferencias/correcciones se guardan tal cual (regla
   heredada de `DESIGN-compaction.md` §3.4), nunca parafraseadas.
4. **Nada de contenido crudo pesado**: una faceta es texto corto (≤ 240 caracteres por entrada por
   defecto); el contenido grande vive en el `vault` y en la faceta queda solo el puntero.
5. **Versionado**: `version` por fichero; migraciones explícitas; los campos desconocidos se preservan
   (nunca se descartan en silencio).
6. **La memoria NO se escribe como evento de sesión propio** (restricción verificada, crítica):
   `Session.append(type, data)` acepta cualquier string (`dsh-session/lib/index.js:1403-1423`), pero el
   backend de persistencia **rechaza al cargar** todo tipo de evento que no esté en la lista conocida del
   build y no venga marcado `ignorable` — `assertEventsSupported`
   (`dsh-session-persistence/lib/index.js:1318-1323`: «contains event type … unknown to this harness and
   not marked ignorable; refusing to interpret the log»), la lista es
   `KNOWN_SESSION_EVENT_TYPES` (`dsh-session/lib/index.js:914-966`, cerrada: `todo/write`, `plan/mode`,
   `hook/*`, `goal/change`, …) y **`append` no tiene canal para `ignorable`** (el sobre que construye
   solo lleva `type/seq/time/data` + metadata de superficie, `:1418-1423`). Un evento
   `abaco-memory/set` escribiría un log que **no se podría reabrir** — justo lo contrario del objetivo
   «retomar al día siguiente». Por eso la Capa 2 persiste **solo en ficheros propios** (sidecar) y el
   journal es un JSONL aparte, no la sesión.
7. **Durabilidad**: tras escribir una faceta o un artefacto, `await ctx.sessions.flush(session)` (o un
   listener propio en `session/flush`) alinea el puntero y el artefacto en la misma barrera de
   checkpoint (`dsh-session/lib/index.js:1750-1767`; `dsh-session-checkpoint-policy/lib/index.js:61-75`
   hace flush antes de `llm/stream`, `tools/execute` y `agent/pre-step`).

---

## 3. API de la Capa 2

### 3.1 Herramientas (`abaco-memory`, registradas con `defineTool` + `ctx.tools.register`)

Registro: `ctx.tools.register(defineTool({...}))` (`dsh-tools/lib/index.js:837,2774-2782`), con
`execute(args, exec)` recibiendo el agente propietario (`exec.agent`, patrón de
`dsh-tool-todo/lib/index.js:170-190`). Detalles verificados que condicionan el código:

- `exec` = `{token, callId, rootCallId, name, signal, agent?, parent?, arguments, deferContext(context), concludeTurn()}`
  (`dsh-tools/lib/index.js:3038-3061`); `exec.agent.session.header.id` da el namespace y `exec.agent.ctx`
  el contexto con scope de agente.
- **El esquema NO es zod**: `parameters` (y `output.schema`) es un DSL propio compilado a un subconjunto
  estricto de JSON Schema (`dsh-tools/lib/index.js:791-810,846-848`); `output` es obligatorio
  (`:2777`). zod/schemastery se usan solo para el `Config` del plugin.
- **Visibilidad**: el registro cae en la capa del scope del ctx llamante; una fila host-plane registra
  en la capa **global** (todos los agentes la ven salvo restricción) y el registro por agente se hace
  desde su `ctx` (`dsh-tools/lib/index.js:2527-2539,2855-2881`; precedente de instalación por agente en
  `dsh-tool-subagent/lib/index.js:615-623`). Para que los subagentes **no** tengan tools de memoria,
  basta el filtro que ya aplica la composición del hijo (`childCtx.tools.restrict(...)`,
  `dsh-subagent/lib/index.js:710-711`).
- **Nunca** `session.append("abaco-memory/…")` desde estas tools (ver §2.2 regla 6): se escribe a fichero
  y se devuelve un resultado corto. Si en el futuro se apenda algo, hay que diferirlo, porque
  `Session.append` **rechaza la reentrada** mientras publica (`dsh-session/lib/index.js:1414`).

| Tool | Parámetros | Salida | Semántica |
|---|---|---|---|
| `memory_set` | `scope` (`auto\|profile\|project\|session`), `path` (p.ej. `preferences_user[+].text`), `value`, `kind` (opcional), `why` (opcional), `priority` (0-3) | `{ok, path, id, bytesRendered, replaced?}` | upsert de una faceta; valida esquema, tamaño y procedencia; escribe en disco (lock + atómico) y en el journal; invalida la caché de render para el **próximo turno** |
| `memory_get` | `scope`, `path` (opcional; sin path = memoria renderizada) | `{facets, rendered, locators[]}` | lectura bajo demanda: la memoria inyectada ya está en el system prompt; esto sirve para detalle, provenance y punteros |
| `memory_forget` | `scope`, `path`, `id` | `{ok, removed}` | borra/expira una faceta (con registro en `audit`) |
| `memory_note` (opcional, azúcar) | `text`, `kind`, `taskId?` | como `memory_set` | atajo para «apunta esto» sin decidir path |
| `context_recall` (Fase 5) | `query`, `scope` (`vault\|session\|memory`), `limit` | fragmentos + locators | recuperación del detalle exacto (informes guardados, eventos compactados) |

**Descripción de `memory_set` (texto del modelo, recall-first):** debe decir explícitamente (a) escribe
**en el momento** en que aprendes un dato durable (preferencia, decisión, dato verificado, estado de
proyecto, formato de salida); (b) cita verbatim lo que dijo el usuario; (c) no metas contenido largo
(para eso está el vault); (d) no dupliques: si existe, actualiza el `id`.

**Protocolo (estático, en la persona del preset, no en la sección dinámica):** «Antes de responder o de
cerrar una tarea: si algo debe seguir siendo verdad mañana, escríbelo con `memory_set`. Si el usuario
corrige algo, sobrescríbelo con `priority: 3` y `source: user`. No repitas la misión: ya está en tu
memoria.»

### 3.2 Cuándo se guarda (3 disparadores)

| # | Disparador | Mecanismo | Coste | Fase |
|---|---|---|---|---|
| 1 | **Explícito del agente** | tool `memory_set` (y `memory_note`) | 1 tool call | 2 |
| 2 | **Cierre de turno (determinista)** | listener de `agent/turn-stopping` (`dsh-agent-loop:570-575`) / `session/event` con `turn/end` (`dsh-session:1430-1435`): actualiza `meta` (lastTurn, renders), promueve `tasks` tocadas, escribe `audit`; **sin LLM** | ~ms | 2 |
| 3 | **Consolidación opcional con LLM** | en *idle* o cada N turnos: `ctx.llm.stream()` con el historial + esquema JSON estricto de operaciones (`upsert`/`forget`) contra `ctx.settings`; toda op se valida y se registra | 1 llamada barata (modelo config `consolidationModel`) | 4-5, **off por defecto** |
| 4 | **GC/poda** | en `agent/status: idle` y al arrancar: TTL, caps, dedupe, archivo | ~ms | 2 |

Notas de implementación de los disparadores:

- **Preferir `agent/turn-stopping`** (serial y *awaited*, se emite justo antes del `turn/end`,
  `dsh-agent-loop/lib/index.js:570-575`) como punto de escritura: es el sitio seguro, fuera de cualquier
  publicación de `session/event` (que es síncrona y contiene los fallos de listener por separado,
  `dsh-session/lib/index.js:1372-1374`). Si se usa `session/event`, el trabajo debe diferirse
  (microtarea) — `Session.append` **rechaza la reentrada** durante la publicación (`:1414`) — y el I/O
  debe ser best-effort y asíncrono.
- El estado por sesión también puede proyectarse (patrón `ctx.sessionProjections.register({key, init, apply})`
  + `stateOf(session, key)`, `dsh-session-projection/lib/index.js:68,127`) para que la UI lo lea, sin
  persistir nada nuevo.

Regla de oro: **las escrituras hechas durante un turno no cambian el system prompt de ese turno**
(se aplican al siguiente). Motivo técnico verificado: cambiar el system altera el `request/header` y el
harness emite `request/header` con `reason:"change"` (`dsh-agent-loop/lib/index.js:741-755`), lo que
rompe la reutilización de prefijo/KV-cache del proveedor y desestabiliza las instrucciones a mitad de
tarea. El renderizador devuelve un **snapshot congelado por turno** (se recalcula en el primer pre-step
del turno o al cerrar el anterior).

### 3.3 Qué se inyecta (lectura)

- **Vehículo primario**: sección de system prompt `abaco:durable-memory`
  (`ctx.systemPrompt.section`, `dsh-system-prompt/lib/index.js:229-232`, con `text` función `:330`),
  registrada por el plugin host con `ctx.inject(["systemPrompt"], scope => scope.systemPrompt.section({...}))`
  — mismo patrón que `dsh-user-approval/lib/index.js:77-90`.
  `order`: usar un valor numérico propio **entre `DEPLOYMENT_PERSONA` (0) y `PLAN_POLICY` (500)**
  (`dsh-system-prompt/lib/index.js:10-41`); propuesto `order: 200`.
- **Contenido**: **todo lo durable que quepa en el presupuesto** (es corto por diseño), en este orden:
  `identity` → `preferences_user` → `constraints_do_not` → `output_format` → `projects_state` →
  `tasks` (solo abiertas/en curso + `next_action`) → `decisions` → `facts` vigentes → `artifacts`
  (solo `text` + `locator`) → `open_questions`.
- **Presupuesto**: `maxRenderChars` por defecto **6000 caracteres** (~1500 tokens con la heurística
  4 chars/token, `dsh-token-meter/lib/index.js:16`), repartido por ámbitos
  (`profile ≤ 1500`, `project ≤ 2500`, `session ≤ 1500`, `roles ≤ 500`) y aplicado por prioridad y
  recencia. Si no cabe, se recorta y se registra en el journal qué se dejó fuera (`drops`), nunca en
  silencio.
- **Qué NO se inyecta**: el contenido del `vault` (solo el puntero + `retrievalHint`), el journal de
  auditoría y las facetas expiradas. Esos se recuperan bajo demanda con `memory_get` / `context_recall`
  o directamente con `read` (las lecturas del modelo no están enjauladas, `dsh-fs-sandbox:74-75`).
- **Subagentes**: el renderizador devuelve `""` cuando `context.agent` es `undefined`
  (`dsh-agent/lib/index.js:384-390`) y filtra por identidad — un subagente (`origin:'subagent'`,
  `dsh-session:1617-1627`) recibe `profile`+`project`+su propio `session`, **nunca** el estado vivo de
  otra sesión. Config `includeInSubagents` para apagarlo del todo.

### 3.4 Poda (no crecer sin límite)

| Regla | Valor por defecto | Efecto |
|---|---|---|
| Presupuesto de render | 6000 chars | lo que no cabe no se inyecta (pero sigue en disco) |
| Caps por faceta | prefs 40, do-not 40, decisions 25, facts 60, artifacts 60, tasks 20, questions 20 | al superar: se archiva el más antiguo de menor prioridad |
| TTL | facts 90 d, tasks `done` 30 d, session facets 30 d tras fin de sesión, decisions ∞, prefs ∞ | el GC archiva (nunca borra) a `audit/archive/` |
| Prioridad | 0-3; `pinned` siempre gana | selección de render y de poda |
| Dedupe | por texto normalizado + `id` | evita el mismo hecho 5 veces |
| Conflictos | `source: user` gana siempre y sube a `priority: 3` | las correcciones del usuario no se pierden |
| Versión | `version` + migración | cambios de esquema explícitos |
| Auditoría | `audit/memory.jsonl` con `{ts, op, path, id, before, after, reason, source}` | todo cambio es reversible/inspeccionable |

---

## 4. Configuración de la Capa 1 (ventana + resumen)

### 4.1 Qué es configurable HOY sin escribir código (verificado)

`BasicCompactionEngine.static Config` (`dsh-compaction-basic/lib/index.js:750-761`), resuelto en
`resolveConfig` (`:58-78`) y por modelo en `resolveTargetPolicy` (`:85-101`):

| Clave | Default (línea) | Valor ABACO propuesto | Por qué |
|---|---|---|---|
| `thresholdRatio` | `0.8` (`:15,62`) | **`0.6`** (0.65) | compactar antes de la zona de riesgo; margen para turnos largos con `search`/`web_extract` |
| `retainRatio` | `0.16` (`:17,63`) | *(no usar si se fija `retainTokens`)* | es relativo a 1M ⇒ 160k; demasiado y a la vez mal repartido. **`retainRatio` y `retainTokens` son mutuamente excluyentes** (configurar ambos lanza en `:169`) |
| `retainTokens` | — (`:112,128-132`) | **`64000`** | ventana reciente verbatim **absoluta** (delegación + últimos pasos de tool siempre intactos). Debe cumplir `retainTokens < thresholdTokens` (`:113`); el conflicto se detecta en el primer uso, no al cargar (`:108-113`) |
| `maxTokens` | `8192` (`:72`) | **`16384`** | el resumen es el cuello de botella real (ratio >80:1); doblar la salida mejora recall |
| `compactionRetries` | `1` (`:73`) | `1` | mantener; con umbral 0.6 y retención 64k no debería re-dispararse |
| `maxOverflowRetries` | `1` (`:74`) | `1` | mantener |
| `summarizationModel` / `summarizationProvider` | `""` (`:70-71`) | modelo fuerte (p.ej. `deepseek-v4-pro`) | el resumen decide qué se pierde para siempre |
| `modelPolicies` | `[]` (`:75`) | política por modelo (`deepseek-v4-flash` vs `-pro`) | el adapter declara `contextWindow = 1e6` (`dsh-llm-deepseek/lib/index.js:1378,1829-1843`) |
| `auto` | `true` (`:76`) | `true` | el resumen debe seguir siendo automático (spec del producto) |

Además, filas vecinas del mismo realm:

- `tool-result-pruner`: `{thresholdChars: 8192, headChars: 4096, tailChars: 1024}`
  (`presets/standard/agent.cordis.yml:150-155`; defaults en `dsh-compaction-tool-result-pruner/lib/index.js:10-14`).
  **Propuesta**: `thresholdChars: 6000`, `headChars: 3000`, `tailChars: 800` — el prune es gratis y hoy
  solo corre tras calificar (`dsh-compaction-basic:885-889`), con la matización de que en el camino
  `pressure` la comprobación de umbral (`:884`) **precede** al prune (`:885-888`) y el prune puede por sí
  solo evitar el resumen (`:889`), mientras que en `context-overflow` el prune es incondicional antes de
  elegir rango con retención 0 (`:870-874`).
- `spill-policy.maxInlineBytes` (**Capa 3**): hoy `50000` (`dsh-base/cordis.patch.yml:389-392`).
  **Propuesta**: `12000-16000` (≈3-4k tokens por resultado).

**Dónde se escribe esa config (verificado).** El motor se configura **solo por la fila del preset**: la
config llega al constructor, se valida contra `static Config` (`:750-761`) y `resolveConfig` la
`deepFreeze`a una sola vez (`:67,769`); `this.config` es `readonly` y **no existe API de runtime, ni
settings namespace, ni clave `compaction:` en ningún `.yml` del árbol**. Cambiar la política exige
re-montar la fila (o reiniciar/HMR). Opciones, de menos a más invasiva:

1. **Preset ABACO propio con id nuevo** en `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`, copiando el
   preset activo y añadiendo `config:` a la fila `compaction-basic` (y al pruner), y seleccionándolo
   (`agent-presets.default` en `<DSH_HOME>/settings.yaml`). **Recomendada**: no toca `node_modules`,
   sobrevive a reinstalaciones, el usuario puede editarlo, y es la única vía soportada para *cambiar
   política* (los ids shipped no se pueden sombrear, `dsh-agent-presets/lib/index.js:422-423,1257-1259`).
2. **Raíz de despliegue** vía `roots: [{path, trust}]` en la fila `agent-presets` del patch del perfil
   (`dsh-web-app/cordis.patch.yml:440-444` es la fila que nombra el default), si el fork quiere
   *entregar* el preset en lugar de que el usuario lo copie.
3. Edición vendorizada (`patches/`) del `cordis.patch.yml` del paquete o del preset *shipped* —
   **no recomendada**: se pierde en cada actualización y el fork ya evita parchear `dsh-compaction*`.

Nota: `build/dsh-desktop.patch.yml` **no** sirve para esto (§1.1); se usa para insertar las filas
host-plane de los plugins ABACO (`abaco-memory`, `abaco-observability`).

### 4.2 Qué exige código propio: `abaco-context` (motor de compactación)

Dos niveles posibles, ambos **sin tocar paquetes publicados**:

**Opción A (rápida, recomendada para Fase 3): subclase de `BasicCompactionEngine`.**
Viable por diseño del propio paquete (el listener llama `this.compactIfNeeded(...)`, y el comentario del
código garantiza que la subclase se honra, `:772-776`; `summarize()` es el hook documentado, `:836-846`).

```js
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';

export const name = 'abaco-context';
export const inject = ['llm', 'tokenMeter', 'sessions', 'sessionProjections'];

export default class AbacoCompactionEngine extends BasicCompactionEngine {
  // 1) CUÁNDO: política propia de disparo (nunca en mitad de tarea, máx. 1 por tarea)
  async compactIfNeeded(agent, trigger, signal) { /* ver §4.3 */ }

  // 2) CÓMO: plantilla de preservación + resumen por episodios con capas
  async summarize(input, agent, signal) { /* ver §4.4 */ }

  // 3) manual: retención absoluta en vez de 0 (el stock usa 0 en :935)
  compactNow(agent, signal, sourceCommandId) { /* variante de §4.3 */ }
}
```

Se monta sustituyendo la fila en el preset (mismo grupo, mismo realm, mismo nombre de servicio):

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate: { compaction: true, toolResultPruner: true }
  config:
    - id: compaction-abaco
      name: 'abaco-context'            # paquete del fork
      config:
        thresholdRatio: 0.6
        retainTokens: 64000
        maxTokens: 16384
        summarizationModel: deepseek-v4-pro
        maxCompactionsPerTask: 1
        compactOnlyWhenIdle: true
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config: { thresholdChars: 6000, headChars: 3000, tailChars: 800 }
```

(`/compact` sigue funcionando porque `dsh-command-compact` llama exactamente
`ctx.compaction.compactNow(agent, signal, commandId)` — `dsh-command-compact/lib/index.js:54` — y
`ctx.compaction` es el nombre que publica `CompactionEngine`, `dsh-compaction/lib/index.js:172-176`.)

**Restricciones verificadas de la Opción A (hay que respetarlas):**

- **Un solo proveedor del servicio por realm**: registrar un segundo `compaction` en el mismo realm
  lanza `service "compaction" has been registered at <fiber>` (`cordis/lib/index.js:799-813`). Por eso
  la fila `compaction-basic` **se retira/sustituye** dentro del mismo grupo, no se añade al lado.
- La subclase **no puede reajustar la política después de construirse**: `config` es `readonly`
  (`dsh-compaction-basic/lib/types/index.d.ts:28`) y `_registerAutomaticCompaction`/`regionDependencies`
  son privados (`:38,81`). La política entra por la fila (o el override la recalcula dentro de sus
  propios métodos).
- Los listeners automáticos siguen siendo los del paquete y llaman a **`this.compactIfNeeded`**
  (`:784`): sobrescribirlo es suficiente para gobernar el disparo, sin reimplementar la transacción.
- Si se implementa la Opción B, se heredan las obligaciones del contrato: bracket
  `compaction/start → compaction/summary → user/message(replace) → compaction/end`
  (`dsh-compaction-basic:586-633`; eventos e invariantes en `dsh-compaction/lib/invariant.js:112-173`),
  bordes balanceados por pares tool-call/result (`dsh-compaction/lib/index.js:80-93`), resumen más
  pequeño que el span sombreado (`dsh-compaction-basic:558-559`) y `ManualCompactionError` con sus
  códigos para los fallos esperados del camino manual (`dsh-compaction/lib/index.js:149-162`).

**Opción B (completa, Fase 5+): `CompactionEngine` propio** con selección por episodios, prune
*always-on*, recall y política de presupuesto. Requiere implementar
`compactIfNeeded` / `compactNow` / `compactRegion` (los tres puntos de entrada usados por el listener
automático y por el comando manual) y reimplementar la transacción durable (bracket, eventos
`compaction/*`, claim de shadow-price del medidor, `sourceEventSeqs`), que es donde está el valor
probado del paquete stock. Sólo se justifica si la subclase se queda corta.

### 4.3 Regla de disparo mejorada

| Regla | Cómo se implementa | Evidencia de partida |
|---|---|---|
| **Nunca en mitad de tarea** | `compactIfNeeded` con `trigger === "pressure"` comprueba la fase: si `agent.status !== "idle"` no compacta y **difiere**; el trabajo real se agenda en `agent/status: idle` (`dsh-agent-loop/lib/index.js:393,487-494`) usando `agent.runMaintenance(...)` (`:417-440`), que es lo que ya hace el camino manual (`compactNow`, `:928-954`) | hoy el disparo es `agent/pre-step` (`:782-795`) y `compactRegion` usa `owner:"current-turn"` (`:914-919`) |
| **Máx. 1 compactación automática por tarea** | contador por `turn/start` desde el último `turn/end` y por episodio detectado (frontera = `turn/end` con tarea cerrada); si se supera y sigue por encima del umbral → **error claro** («esta tarea excede el contexto: ciérrala y continúa en un hilo nuevo») en lugar de resumir el resumen | hoy no hay límite: bucle `compactionRetries + 1` (`:891-903`) |
| **Nunca `retainTokens = 0`** | en overflow: 1º prune (`pruneSession`, `dsh-compaction-tool-result-pruner/lib/index.js:137`), 2º evacuar **episodios cerrados** (rango elegido por fronteras de tarea, no desde la cabeza), 3º resumir; sólo si aún no cabe | hoy: overflow usa `selectCompactableRange(..., 0)` (`:875`) y el manual también (`:935`) |
| **Medir con tokens reales cuando existan** | usar `ctx.tokenMeter` (`measure(session)`) pero **preferir la presión reportada por el proveedor**: el medidor ya ancla la medición en el `usage` del proveedor cuando el envelope canónico coincide y el total no es menor que el coste estimado del mismo call (`baseline.kind = 'usage'`, `dsh-token-meter/lib/index.js:573-575,626-640`), y publica las proyecciones `contextPressure` (`pressureTokens` = tamaño real del prompt reportado, `projectedTokens`) y `contextBreakdown` (`README.md:47-49`; folds `lib/index.js:280-385`) | heurística `CHARS_PER_TOKEN = 4` (`lib/index.js:16`) que «underprice badly» en CJK/JSON (`README.md:147-148`) |
| **Umbral con margen + validación** | disparar al 60-65 % de la capacidad resuelta por el adapter (`DEFAULT_CONTEXT_WINDOW = 1e6`, `dsh-llm-deepseek:1378`) y validar `retainTokens < thresholdTokens` (`:113`) | defaults 0.8 / 0.16 |
| **Prune barato primero** | el pruner (`ctx.toolResultPruner`, `pruneSession`, `dsh-compaction-tool-result-pruner/lib/index.js:137-194`) es una dependencia **opcional** que el motor resuelve con `ctx.get` (`dsh-compaction-basic:869`) y hoy solo se invoca tras calificar; «prune siempre» exige que **nuestro** motor/listener lo llame al cerrar cada turno por encima de ~40 % de presión | `DESIGN-compaction.md` §3.2.A; `dsh-output-retention` es una **librería** sin `ctx`, hooks ni sesión (`dsh-output-retention/lib/index.js:18-21`) y no sirve como podador de historial |

### 4.4 Formato del resumen (plantilla propia)

Sobre `summarize(input, agent, signal)` (`:836-846`), replicando el envelope para no invalidar la caché
KV (el stock ya replica system+tools+mensajes, `:832-835`):

1. **Frontmatter YAML corto** (`task_ids`, `decision_ids`, `fechas`) + cuerpo de bullets densos.
2. **Bloques obligatorios con exact-strings en backticks**: delegación/instrucciones vigentes,
   `path:línea` y para qué, errores activos + fix, decisiones + rationale, ids/cifras/comandos, y
   `next_action` **ejecutable** (tool call esperada, archivo, criterio de fin).
3. **Citas verbatim** de correcciones del usuario (prohibido parafrasear).
4. **Anti resumen-de-resumen**: si el span contiene un `<compacted-summary>` previo, fusionar con capas
   explícitas `Previously compacted:` (sólo lo aún verdadero) / `Newly compacted:`, y **no re-resumir**
   el checkpoint previo: compactar desde su final hacia delante.
5. **Map-reduce para spans grandes**: segmentar por episodios/fronteras de tarea (≈30-60k tokens por
   chunk) y resumir nivel-1 por chunk; nivel-2 sólo si hay muchos episodios y siempre referenciando los
   nivel-1 (no destructivo).
6. **Estado vivo fuera del resumen**: tareas/decisiones/preferencias vigentes las inyecta la Capa 2; el
   resumen **no** las reescribe (evita la pérdida compuesta).
7. **Fallo = chunk menor, no error**: hoy una salida truncada lanza `MAX_TOKENS` y deja el historial por
   encima del umbral (`:346-350`); el motor propio reintenta con span menor y valida estructura.
8. `maxTokens: 16384` y sin razonamiento oculto en la llamada de resumen (el presupuesto de salida se
   consume con `reasoning`, README «Known Limitations»).

---

## 5. Mecanismo de la Capa 3 (delegación y «no meter basura»)

### 5.1 Lo que ya existe (usar, no reimplementar)

1. **Delegación**: las tools `subagent` / `subagent_fork` devuelven **sólo** el resultado final del
   hijo, no sus pasos intermedios (`dsh-tool-subagent/lib/index.js:340-350`), y el modo
   `backgroundMode: continuable` entrega un id durable + aviso posterior
   (`presets/standard/agent.cordis.yml:178-200`). El hijo recibe su propia composición (persona y filtro
   de tools) con `childCtx.systemPrompt.*` (`dsh-subagent/lib/index.js:701-712`).
2. **Spill de resultados enormes**: `tools/post-execute` → preview + localizador + `retrievalHint`
   (`dsh-spill-policy/lib/index.js:136-153`), con `maxInlineBytes` configurable y activo hoy a 50000
   (`dsh-base/cordis.patch.yml:389-392`). El localizador es una ruta absoluta legible por `read`/`grep`
   (`dsh-spill-local/lib/index.js:564-566`). **Ya hay uso real**: 11 avisos de spill en los 81 logs de
   sesión del entorno, de `bash`, `web_fetch`, `job_output`, `grep` y `glob`.
3. **Persistencia de sesión**: log JSONL (zstd) por sesión en
   `<DSH_HOME>/sessions/<projectKey>/<id>/session.jsonl.zstd` (`dsh-session-persistence-jsonl/lib/index.js:114-166`;
   `root: dshHomePath('sessions')` en `dsh-base/cordis.patch.yml:110-113`), con los eventos sombreados
   conservados (recuperables), escritura *write-behind* con `flush()` como barrera (`:398-407`) y
   `locate(meta)` que resuelve la ruta del directorio de sesión sin tocar disco (`:853-858`). El propio
   backend documenta ese directorio como *«available for future session-local artifacts»* (`:153-155`).
4. **Un hueco que hay que cubrir** (medido, no supuesto): el **aviso de liquidación** de un subagente en
   background entrega `terminal.output` **verbatim y sin tope** como `user/message`
   (`source.kind:"subagent-settled"`, `dsh-subagent/lib/index.js:1761-1796`) y **no pasa por
   `tools/post-execute`**; hoy nada lo acorta salvo la compactación. Es la fuga principal de «basura» que
   queda (§1.4).

### 5.2 Lo que añade ABACO: *vault* durable + nota de memoria

**Brazo propio en `tools/post-execute`** (mismo waterfall que usa el policy stock; es el punto de
extensión oficial: `dsh-tools/lib/index.js:3379`). Para cada resultado plano que supere
`vaultInlineChars` (config; propuesta **12000** bytes ≈ 3k tokens):

1. **Guardar el texto completo verbatim** en
   `<DSH_HOME>/abaco-memory/vault/<sessionId>/<epoch>-<slug>.txt` (0600, escritura atómica; **durable**,
   a diferencia del spill local que vive en `tmpdir()`, `dsh-spill-local:17,69-70`).
2. **Escribir una faceta `artifacts`** con `{text: título/tarea, locator, bytes, taskId, summary}` —
   la nota de 3 líneas que sobrevive a todo.
3. **Sustituir el contenido model-facing** por: N primeras líneas + `(se omitieron X bytes. Resultado
   completo en: <locator>. Usa read con offset/limit o grep sobre esa ruta.)` — mismo formato de aviso
   que usa el harness (`dsh-spill-policy:81-83`), para que el modelo sepa recuperarlo.
4. **Nunca** actuar sobre `read` (evita el bucle `read → spill → read`, mismo criterio que
   `dsh-spill-policy:32-35,138`) ni sobre llamadas anidadas (`exec.parent !== undefined`).
5. Si el `saveText`/vault falla → **best-effort**: se conserva el inline (mismo contrato del stock,
   `:36-38,117-122`).

**Reparto con el policy stock.** Ambos son listeners de `tools/post-execute` con `{prepend: true}`
(`dsh-spill-policy:153`). Dos opciones: (a) bajar `maxInlineBytes` por config y dejar que el
stock haga el trabajo, usando nuestro brazo **sólo** para el vault+faceta (leyendo el texto original de
`result.content`, que el waterfall siempre entrega, `dsh-tools:3379`); o (b) registrar el nuestro con
umbral menor y que el stock vea ya un texto corto (no-op). **Recomendación: (a)**, más robusta ante el
orden de listeners. El orden real de prepends debe verificarse empíricamente (§7.2). Si el policy stock
no se puede reconfigurar (§7.2 verificación 3), nuestra variante debe cubrir también llamadas anidadas
por el otro brazo del waterfall (`tools/ptc-dispatch-log`, `dsh-spill-policy:154-166`).

**Segundo brazo: avisos `subagent-settled` (el hueco).** Para el camino 2 de §1.4, el único punto de
intercepción es el waterfall **`agent/pre-step`**: nuestro listener (registrado después del de
compactación, que es host/preset-plane) reescribe `decision.messages` sustituyendo el aviso gigante por
`resumen acotado + locator del vault`, exactamente el patrón que ya usa `dsh-session-reference`
(`dsh-session-reference/lib/index.js:361-368`; contrato del waterfall y `messages` reescritos en
`dsh-agent-loop/lib/index.js:506-518,559`). Reglas: conservar el `source` original del mensaje
(`{kind:'subagent-settled', senderSessionId}`) para no romper la atribución, dejar intactos los mensajes
de usuario reales, y no tocar mensajes por debajo del umbral.

**Dónde vive el vault (dos variantes válidas).**

| Variante | Ruta | Ventajas | Coste |
|---|---|---|---|
| **A. Raíz propia (recomendada)** | `<DSH_HOME>/abaco-memory/vault/<sessionId>/<epoch>-<slug>.txt` + `vault/index.jsonl` | independiente del backend de persistencia; sobrevive a cambios de perfil/backend; listable e indexable por nosotros; misma raíz que la memoria (un solo backup/GC) | hay que mantener naming, permisos 0600 y GC propios (patrón `credentials-local:604-630`) |
| **B. Sidecar junto al log** | `<sessionDir>/spill/<id>.txt` con `sessionDir = join(projectDir(root, cwd), encodeSegment(id))` (`dsh-session-persistence-jsonl/lib/index.js:141-155`), resuelto con `sessionPersistence.locate(meta).path` (`:853-858`) | el artefacto queda literalmente junto a `session.jsonl`; la barrera `session/flush` (`dsh-session/lib/index.js:1750-1767`) commitea puntero y artefacto juntos | acopla a la disposición de un backend concreto (otro backend puede no tener directorio por sesión) |

En ambas: escribir **índice** propio (`index.jsonl` con `{id, sessionId, seq, tool, callId, bytes, sha256,
locator, summary, taskId, createdAt}`) porque el seam de spill **no tiene índice ni API de recuperación**
por diseño («`saveText` and nothing else», `dsh-spill/lib/index.js:28`); y `await ctx.sessions.flush(session)`
tras escribir el artefacto para que el puntero del log y el fichero se confirmen en el mismo checkpoint.

### 5.3 Política de delegación (instrucciones, no código)

En la persona/instrucciones del preset ABACO (texto estático):

- «Delegación obligatoria para volumen»: investigar/leer/escanear con `subagent` (o `glob`/`grep` con
  salida acotada) y devolver al hilo principal sólo conclusiones; nunca pegar HTML, logs ni informes
  completos.
- «Pide al subagente un informe acotado» (≤ 60 líneas o JSON) y pide explícitamente fuentes/URLs.
- «Si necesitas el detalle, está en el vault: `read`/`grep` sobre el locator» — apoya la recuperación
  *just-in-time*.
- «Al cerrar una delegación, deja una línea en memoria» (`memory_set` sobre `artifacts` si no lo hizo el
  brazo automático).

### 5.4 Recall (Fase 5)

Tres superficies de recuperación, en este orden de coste:

1. **`read`/`grep` del modelo sobre el locator** — ya funciona sin código nuevo: las lecturas no están
   enjauladas por política (`dsh-fs-sandbox/lib/index.js:74-75`) y el propio backend devuelve el
   `retrievalHint` («Use read with offset/limit, or grep this path…», `dsh-spill-local:564-566`).
2. **`context_recall` (tool propia)** sobre el `vault/index.jsonl` y los ficheros de memoria: busca por
   texto, tarea, tool y sesión. Es la pieza que el harness **deliberadamente no trae** (el seam de spill
   no tiene API de recuperación, `dsh-spill/lib/index.js:28-32`).
3. **Búsqueda en el log de sesión compactado**: existe `ctx.sessionQuery` (`dsh-session-query/lib/index.js:32-117`)
   y el read-model FTS5 `dsh-session-query-sqlite` (`persisted_docs USING fts5(...)`, schema v8,
   `dsh-session-query-sqlite/lib/index.js:11-13,105-116`), pero **viene desactivado por defecto**:
   la fila shipped usa `path: ':memory:'` con `openAt: never` (`dsh-base/cordis.patch.yml:129-133`), así
   que solo funcionan las lecturas exactas. Habilitar índice persistente es una decisión aparte
   (coste de indexado y de disco) que la Fase 5 puede evaluar; el `vault` ya cubre el caso «recupera el
   informe completo».

---

## 6. Plan de implementación por fases

Convención de esfuerzo: **S** ≤ 1 día, **M** 2-4 días, **L** > 1 semana (1 persona con acceso a la app).
Regla transversal: **no se modifica ningún paquete `@deepseek-ai/*`**; los cambios viven en el fork
(`packages/abaco-*`, `build/dsh-desktop.patch.yml`, preset) y se reempaquetan.

| Fase | Objetivo | Archivos a crear/tocar | Esfuerzo | Criterio de salida |
|---|---|---|---|---|
| **0. Telemetría** | Poder *ver* compactaciones, spilleos y memoria antes de cambiar nada | `packages/abaco-observability/index.js` (nuevo): listeners `session/event` (`compaction/*`, `tool/result` grandes), `agent/status`; log a `<DSH_HOME>/logs/abaco-context.jsonl`; fila en `build/dsh-desktop.patch.yml`; inyección en `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` | S | 1 sesión larga real produce un JSONL con: disparo, tokens medidos vs `contextPressure.pressureTokens`, span, ratio, truncados, reintentos, spill counts |
| **1. Config inmediata + preset ABACO** | Quitar el «compact twice useless» sólo con composición | **Preset nuevo con id propio** (los ids shipped no se pueden sombrear, §1.1): `$DSH_HOME/.agent-presets/abaco/agent.cordis.yml`, copia del preset activo (`cordis` en la instalación observada) con `config:` en las filas `compaction-basic` (`thresholdRatio 0.6`, `retainTokens 64000`, `maxTokens 16384`, `summarizationModel` fuerte, `modelPolicies`) y `tool-result-pruner` (6000/3000/800); selección por `agent-presets.default` en `<DSH_HOME>/settings.yaml`. Tope de inline de la Capa 3: verificar si el `--patch` puede reconfigurar la fila `spill-policy`; si no, el brazo propio de la Fase 4 la sustituye | S | Sesión larga: 2 compactaciones seguidas y el agente sigue la tarea sin repreguntar la delegación; el JSONL de la Fase 0 muestra el `spec` nuevo |
| **2. `abaco-memory` MVP (Capa 2)** | Almacén por facetas + tools + inyección | `packages/abaco-memory/{package.json,index.js,lib/store.js,lib/render.js,lib/tools.js,lib/schema.js}`, fila en `build/dsh-desktop.patch.yml`, inyección build-time en el patch de `@deepseek-ai/dsh` (patrón `docs/TECH-plugin-loading.md` §4.1; test de cierre `test/desktop-plugin-closure.test.ts:35-49`), protocolo en la persona del preset | M | El agente escribe con `memory_set`; al reabrir la app al día siguiente la sección contiene preferencias/decisiones y el agente **no** repregunta; memoria idéntica tras N compactaciones; el log se sigue reabriendo (sin tipos de evento nuevos) |
| **3. `abaco-context` (Capa 1 núcleo)** | Motor propio: disparo seguro + resumen jerárquico | `packages/abaco-context/{package.json,index.js,lib/summarize.js,lib/policy.js}` (subclase de `BasicCompactionEngine`), **sustitución** (no adición) de la fila `compaction-basic` en el grupo `compaction` del preset, tests unitarios de política (`test/`) | M-L | Prohibido compactar con turno abierto; máx. 1/tarea; sin `retainTokens=0`; 2 compactaciones seguidas con recall ≥ 85 % de exact-strings (§7.2-5) |
| **4. Capa 3 (vault + delegación)** | Informe completo a disco durable, corte en ventana | `lib/vault.js` + `index.jsonl`, brazo `tools/post-execute` **y** brazo `agent/pre-step` para los avisos `subagent-settled` (el hueco de §1.4), faceta `artifacts`, reglas en la persona | M | Un informe de subagente de 200 KB (foreground **y** background) no entra a la ventana; aparece 1 línea + locator; `read` recupera el texto íntegro; la faceta y el artefacto sobreviven al reinicio |
| **5. Recall + eval + CI** | Recuperación y medida objetiva de no-degradación | `context_recall` en `abaco-memory`; `scripts/eval-context.mjs`; golden sessions; métricas de la Fase 0 en CI | M | Recall ≥ 90 % tras 1 compactación y ≥ 85 % tras 2; informe de ratios (objetivo ≤ 40:1 por episodio) |
| **6. (Opcional) Consolidación LLM + UI + comando** | Extracción automática de facetas, panel de memoria y comando humano | `lib/consolidate.js` (llamada barata con JSON estricto), cliente `client.js` en `settings.section` para ver/editar/olvidar, y comando `/memory` sobre `ctx.commands` (`dsh-commands/lib/index.js:248`; precedente `dsh-plan-mode/lib/index.js:179-228`) | M-L | Consolidación off por defecto; al activarla, las facetas escritas se auditan y son reversibles; el usuario puede listar/olvidar memoria sin hablar con el agente |

**Empaquetado de un plugin host nuevo (mecánica exacta, ya documentada en el repo):** paquete en
`desktop/src/dsh-desktop/packages/<nombre>/` con `package.json` (`main`, `exports`, `peerDependencies`
`@deepseek-ai/cordis`) e `index.js` que exporta `name`, `inject`, `Config`/`apply`
(patrón real: `packages/abaco-documents/index.js:23-28,142`); dependencia local `file:packages/…` en el
manifiesto del shell + inyección en las `dependencies` de `@deepseek-ai/dsh` vía
`patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` (lo exige `test/desktop-plugin-closure.test.ts:35-49`); fila
`insert: [{id, name, config}]` en `build/dsh-desktop.patch.yml` (bloque ABACO actual en `:64-97`); y
`npm i` + reempaquetado del `.app`. Los plugins host corren en el proceso Node del harness con
`node:fs` completo (patrón `packages/dsh-desktop-preset-transfer/index.js:1-3,22-26`).

---

## 7. Riesgos y verificaciones empíricas pendientes

### 7.1 Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| 1 | **Cambiar el system prompt a mitad de turno** (memoria escrita durante el turno) invalida el prefijo/KV-cache del proveedor y altera instrucciones en caliente: el harness registra `request/header` con `reason:"change"` (`dsh-agent-loop:741-755`) | coste alto + deriva | **snapshot de memoria congelado por turno**; las escrituras se aplican al turno siguiente |
| 2 | La sección de memoria engorda el prompt real (no cuenta en el umbral de compactación, que mide mensajes: `tokenMeter.measure(session)`) | coste y dilución de atención | presupuesto duro (6000 chars), poda por prioridad, y medir `contextBreakdown.systemTokens` |
| 3 | Subagentes pagan la memoria del padre | coste × N | filtrar por identidad (`origin:'subagent'`, `delegationDepth`), `includeInSubagents:false` |
| 4 | El vault/policy propio se ejecuta **después** del spill stock (orden de prepends) y el texto original se pierde | Capa 3 no guarda el completo | leer siempre `result.content` original; verificar orden (§7.2); alternativa: registrar sin `prepend` y detectar avisos de spill existentes |
| 5 | `spill-local` escribe en `tmpdir()` con limpieza de 30 días (`:17,482-485`) | pérdida de artefactos | vault propio durable en `abaco-memory`; o configurar `root` de `spill-local` |
| 6 | Editar `node_modules/*/cordis.patch.yml` o el preset shipped se pierde al reinstalar/actualizar | el tuning desaparece en silencio | preset ABACO en la raíz de usuario (`$DSH_HOME/.agent-presets`) + self-check de arranque que avise si el motor propio no está montado |
| 7 | Config de compactación leída en el constructor (`:767-771`) | cambios requieren recarga | usar HMR (`patchReload: live`) o reiniciar; documentarlo |
| 8 | Dos instancias (dev + app empaquetada) comparten `DSH_HOME` | escrituras concurrentes del documento de memoria | `withFileLock` + escritura atómica + lectura-antes-de-escribir (patrón `credentials-local:604-630`); nunca escribir el fichero entero sin releer |
| 9 | Memoria incorrecta o envenenada (el agente escribe un hecho falso) y dirige turnos futuros | degradación silenciosa | `source`+`why` obligatorios, TTL en `facts`, `priority`, journal auditable, `memory_forget`, revisión visible (Fase 6) |
| 10 | La compactación sigue degradando si no se mide | «sensación» de mejora sin datos | eval de recall (§7.2) + métricas Fase 0 en CI; criterio objetivo de aceptación |
| 11 | El sandbox del modelo impide escribir en `<DSH_HOME>` (solo lectura) | el agente no puede editar la memoria a mano | es **deseable**: las escrituras pasan sólo por `memory_set` (validado y auditado); documentarlo |
| 12 | Un `retainTokens` mal configurado (≥ umbral) lanza `TargetPressureConfigError` y la compactación automática deja de actuar (`:113`) | contexto crece hasta overflow | validar en arranque (el propio plugin valida y avisa), test de config en CI |
| 13 | **Escribir memoria como evento de sesión propio** (`abaco-memory/set`) hace que el log **no se pueda reabrir**: el vocabulario es cerrado y `append` no permite marcar `ignorable` (`dsh-session/lib/index.js:914-966,1418-1423`; `dsh-session-persistence:1318-1323`) | pérdida total de la sesión al resumir (justo el caso «al día siguiente») | **prohibido**: la Capa 2 persiste solo en ficheros sidecar (§2.2 regla 6); test de reapertura en CI |
| 14 | **El aviso de liquidación de un subagente en background entra verbatim** (sin tope ni spill) como `user/message` (`dsh-subagent:1761-1796`) | la ventana se llena con un informe de 20 páginas y el agente se degrada | intercepción en `agent/pre-step` (§5.2) + política de delegación (§5.3); verificación §7.2-11 |
| 15 | El preset activo puede ser `minimal`, **sin motor de compactación** (no tiene esas filas), y los presets shipped no se pueden sombrear por nombre | «no compacta» o «mi tuning no se aplica» sin aviso | self-check de arranque: registrar el preset y el `spec` resuelto, y avisar si no hay motor propio; usar un id de preset nuevo |
| 16 | Las tools `memory_*` registradas en el host son **globales**: también las ven los subagentes | un subagente puede escribir memoria del padre | `childCtx.tools.restrict(...)` en la composición del hijo (`dsh-subagent:710-711`) o validación por identidad en el ejecutor |

### 7.2 Verificaciones empíricas pendientes (antes/después de cada fase)

1. **Orden real de listeners** en `tools/post-execute` (nuestro brazo vs `spill-policy`): log con
   `exec.name` y decisión; decidir `prepend`/orden definitivo. *(Fase 4)*
2. **Efecto del cambio de system a mitad de turno**: escribir memoria durante un turno y observar
   `request/header` (`reason:"change"`) y `usage.cacheReadTokens` (proyección `tokenUsage`,
   `dsh-token-meter/README.md:47`). Confirma o refuta la regla de congelado por turno. *(Fase 2)*
3. **¿El overlay `--patch` puede reconfigurar una fila existente** (p.ej. `spill-policy`) o sólo
   `disable`/`insert`? Verificar en `dsh-app-boot/lib/index.js:847-880` y empíricamente. Si no, usar
   brazo propio (plan ya previsto). *(Fase 1)*
4. **Config del preset realmente aplicada**: log en el motor propio con el `spec` resuelto
   (`thresholdTokens`, `retainTokens`, `maxTokens`) tras cada medición. *(Fase 1/3)*
5. **Recall tras compactar** (criterio de aceptación del producto): golden session con una lista de
   exact-strings (paths, cifras, URLs, correcciones del usuario) y preguntas al agente tras 1 y 2
   compactaciones; objetivo ≥ 90 % / ≥ 85 %. *(Fase 3/5)*
6. **Presión real vs heurística** en sesiones ABACO (`search`/`web_extract`): comparar
   `contextPressure.pressureTokens` con `contextBreakdown.*` y con `measure().totalTokens`; calibrar el
   umbral con datos, no con la teoría. *(Fase 0/3)*
7. **`agent.runMaintenance` desde un plugin** (compactación en idle sin deadlock con el driver):
   prueba con un job trivial antes de usarlo para compactar. *(Fase 3)*
8. **Raíz de usuario de presets**: crear `$DSH_HOME/.agent-presets/abaco/agent.cordis.yml` y confirmar
   que aparece y se puede seleccionar (descubrimiento `dsh-agent-presets:392-429`). *(Fase 1)*
9. **Persistencia de memoria a través del reinicio de la app** (no sólo de la sesión): matar la app,
   reabrir, comprobar que el system prompt del primer request contiene la memoria. *(Fase 2)*
10. **Tamaño real de la memoria renderizada** en tokens (no chars) con la ruta DeepSeek: usar la
    proyección `contextBreakdown.systemTokens` antes/después. *(Fase 2)*
11. **Intercepción del aviso `subagent-settled`**: lanzar un subagente en background que devuelva un
    informe > 50 KB y comprobar (a) que el `user/message` llega verbatim hoy, (b) que nuestro listener de
    `agent/pre-step` lo sustituye por resumen+locator **antes** del append del log
    (`dsh-agent-loop:559`), y (c) que el texto completo quedó en el vault. *(Fase 4)*
12. **Reapertura del log tras escribir memoria**: cerrar y reabrir la app con memoria escrita y
    comprobar que la sesión carga (test de no-regresión de la restricción §2.2 regla 6: ningún tipo de
    evento nuevo en el log). *(Fase 2/5)*
13. **Retención real del vault**: medir cuántos artefactos se generan por semana y su tamaño para fijar
    el GC (caps/TTL) antes de que crezca sin control. *(Fase 4/5)*

---

## 8. Apéndice — Índice de evidencia verificada

Rutas relativas a `desktop/src/dsh-desktop/node_modules/@deepseek-ai/` salvo indicación.

| Qué prueba | Cita |
|---|---|
| Defaults de compactación + esquema de config + resolución | `dsh-compaction-basic/lib/index.js:15,17,19-40,58-78,108-126,135,716-761` |
| Disparo automático en `agent/pre-step` y recuperación de overflow | `dsh-compaction-basic/lib/index.js:772-776,782-795,796-803,804-830` |
| Prune solo tras calificar / overflow con retención 0 | `dsh-compaction-basic/lib/index.js:869-877,885-889,891-903` |
| Hooks de subclase (`summarize`) y despacho dinámico | `dsh-compaction-basic/lib/index.js:740-743,836-846,955-961` |
| Transacción durable: `compactRegion` (owner `current-turn`) y `compactNow` (owner `null`, idle) | `dsh-compaction-basic/lib/index.js:914-919,928-954` |
| Contrato del servicio `ctx.compaction` + checkpoint | `dsh-compaction/lib/index.js:109-133,136-176` |
| Rows del plano host (token-meter, compaction-basic, spill) | `dsh-base/cordis.patch.yml:323-332,386-397` |
| El plano de agente se mueve a presets; filas deshabilitadas | `dsh-web-app/cordis.patch.yml:305-315,371-394,433-444` |
| Grupo `compaction` con realm aislado + config por fila | `dsh-agent-presets/presets/standard/agent.cordis.yml:126-155,157-250` |
| Descubrimiento de presets y raíz de usuario | `dsh-agent-presets/lib/index.js:182,203,392-429,482-483` |
| Motor de secciones/contextos/variables + assembly por request | `dsh-system-prompt/lib/index.js:10-46,108-146,196-201,229-232,255-258,275-289,299-349` |
| Prefijo «Current runtime context…» y snapshot que se auto-repara | `dsh-system-prompt/lib/index.js:127-131`; `dsh-agent-loop/lib/index.js:28-85,497-519` |
| Ejemplo real de contexto dinámico por agente (plugin) | `dsh-user-approval/lib/index.js:77-90`; `dsh-sandbox-policy/lib/index.js:122-124`; `dsh-subagent/lib/index.js:701-712` |
| Ciclo del loop: pre-step, turno, step, request, eventos | `dsh-agent-loop/lib/index.js:393,417-440,487-494,497-519,521-610,611-695,700-777` |
| Eventos de agente y scope carrier | `dsh-agent/lib/index.js:335-366,384-390,639-653,661-683` |
| Registro de agentes (`ctx.agents`) y settings section pattern | `dsh-agent/lib/index.js:415-451`; `dsh-agent-loop/lib/index.js:1039-1095` |
| Superficie de sesión, `append`, `deriveMessages`, `session/event` | `dsh-session/lib/index.js:71-73,1228,1403,1430-1435,1456,1502,1543-1627` |
| Tools: `defineTool`, registro por capas, `tools/post-execute` | `dsh-tools/lib/index.js:837,2774-2782,3378-3407`; `dsh-tool-todo/lib/index.js:95-190` |
| Medición: heurística 4 chars/token, usage del proveedor, proyecciones | `dsh-token-meter/lib/index.js:16,27-42,66,75,236-243,280-385`; `README.md:43,47-49,134-137,147-148` |
| Ventana de contexto DeepSeek | `dsh-llm-deepseek/lib/index.js:1378,1829-1843` |
| Spill: servicio, backend local, política y filas activas | `dsh-spill/lib/index.js:54-59`; `dsh-spill-local/lib/index.js:17,69-103,482-485,564-566`; `dsh-spill-policy/lib/index.js:36-52,66-153`; `dsh-base/cordis.patch.yml:386-392` |
| Resultado de subagente como texto de tool | `dsh-tool-subagent/lib/index.js:173-193` |
| Rutas de datos del usuario (`DSH_HOME`) | `dsh-home-paths/lib/index.js:73-84`; shell: `src/main/index.ts:2591`, `src/main/runtime/harness-runtime.ts:256-258` |
| Patrones de escritura durable 0600 + lock + atómico | `dsh-credentials-local/lib/index.js:58,604-630`; `dsh-settings-file/lib/index.js:32,163-176` |
| KV validado del harness (alternativa a ficheros propios) | `dsh-storage-domain/lib/index.js:214-220,232-297,355-398`; `dsh-storage-json/lib/index.js:25-41,178-179,302,312-313` |
| `ctx.fs` enjaulado (no usar para la memoria) | `dsh-fs-sandbox/lib/index.js:74-75,153-166`; `dsh-sandbox/lib/index.js:155-162` |
| Carga/empaquetado de plugins del fork | `docs/TECH-plugin-loading.md` §1,§3,§4; `packages/abaco-documents/index.js:23-28,142`; `packages/dsh-desktop-preset-transfer/index.js:1-3,22-26`; `test/desktop-plugin-closure.test.ts:35-49`; `build/dsh-desktop.patch.yml:64-97` |
| Diagnóstico y carriles A/B/C/D previos | `docs/DESIGN-compaction.md` §1,§3,§4 |

**Evidencia añadida en la segunda pasada de verificación (correcciones que cambian el plan):**

| Qué prueba | Cita |
|---|---|
| El motor de compactación NO es fila host-plane: se deshabilita en el plano base y cada preset monta el suyo en realm aislado | `dsh-web-app/cordis.patch.yml:368-394`; `dsh-base/cordis.patch.yml:326-327,400-406`; `dsh-agent-presets/presets/standard/agent.cordis.yml:137-155`, `presets/ptc/agent.cordis.yml:144-162`, `presets/cordis/agent.cordis.yml:125-155`; ausente en `presets/minimal/agent.cordis.yml` |
| Los ids de preset *shipped* no se pueden sombrear (gana la raíz anterior) y existe raíz de usuario | `dsh-agent-presets/lib/index.js:195,422-423,1246-1247,1257-1259` |
| Config del motor: inmutable tras el constructor, sin API de runtime, exclusividad `retainRatio`/`retainTokens`, conflicto de capacidad diferido | `dsh-compaction-basic/lib/index.js:30-40,58-78,108-113,169,750-761,763-771,769`; `lib/types/index.d.ts:28,38,81` |
| `/compact` resuelve el motor montado | `dsh-command-compact/lib/index.js:54` |
| Colisión de servicio por realm (`service "compaction" has been registered`) | `cordis/lib/index.js:799-813` |
| Medidor sin config y con anclaje de usage del proveedor | `dsh-token-meter/lib/index.js:16,573-575,582-584,591,626-640` |
| Vocabulario cerrado de eventos de sesión + `append` sin canal `ignorable` (prohibición de eventos propios) | `dsh-session/lib/index.js:914-966,1403-1423`; `dsh-session-persistence/lib/index.js:1318-1323` |
| Reentrada prohibida en `Session.append` (diferir escrituras desde listeners) | `dsh-session/lib/index.js:1414` |
| Persistencia: ruta del log, write-behind, barrera `flush`, `locate`, directorio por sesión «for future artifacts» | `dsh-session-persistence-jsonl/lib/index.js:114-166,398-407,783,818,853-858`; `dsh-session/lib/index.js:1750-1767`; `dsh-session-checkpoint-policy/lib/index.js:61-75` |
| El aviso `subagent-settled` embebe el informe verbatim como `user/message` (fuera del spill) | `dsh-subagent/lib/index.js:1761-1796,910`; `dsh-agent-loop/lib/index.js:559` |
| Intercepción de mensajes entrantes en `agent/pre-step` (precedente) | `dsh-session-reference/lib/index.js:361-368`; `dsh-agent-loop/lib/index.js:506-518` |
| Índice FTS de sesiones existe pero viene desactivado (`:memory:`, `openAt: never`) | `dsh-session-query-sqlite/lib/index.js:11-13,84-146`; `dsh-session-query/lib/index.js:32-117`; `dsh-base/cordis.patch.yml:129-133` |
| `exec` del tool y DSL de esquemas (no zod) | `dsh-tools/lib/index.js:791-810,846-848,3038-3061`; `dsh-tool-todo/lib/index.js:170-190` |
| Visibilidad de tools por capas + restricción por scope (subagentes) | `dsh-tools/lib/index.js:2527-2539,2774-2782,2855-2881`; `dsh-tool-subagent/lib/index.js:615-623`; `dsh-subagent/lib/index.js:710-711` |
| El policy de spill es reconfigurable solo por config de fila; `spill-policy` es no-op sin `maxInlineBytes` | `dsh-spill-policy/lib/index.js:52,86-88,136-166`; `dsh-base/cordis.patch.yml:386-392` |
| Eventos/contrato que debe respetar un motor propio (bracket, invariantes, bordes balanceados, código de error manual) | `dsh-compaction-basic/lib/index.js:558-559,586-633`; `dsh-compaction/lib/invariant.js:112-173`; `dsh-compaction/lib/index.js:80-93,149-162` |

**Fuera de alcance de esta fase (Fase 1 = diseño):** no se ha modificado ningún archivo de código, no se
ha arrancado la app y no se ha ejecutado ningún cambio en el harness. Las cifras propuestas (umbrales,
presupuestos, TTL) son puntos de partida a calibrar con las verificaciones de §7.2.
