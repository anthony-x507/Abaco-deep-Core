# HANDOFF — Contexto de 3 capas en ABACO DEEP HARNES: estado real y petición de plan

**Para:** el arquitecto colaborador que diseñó el modelo de memoria de contexto de tres capas.

**De:** el equipo de ABACO DEEP HARNES.

**Base de lectura:** `main` @ `ef0c34d`. Documentos de referencia: `docs/SPEC-CONTEXT-3-LAYERS.md` (el §8 es un **LOCK** del dueño), `docs/DECOUPLING.md`, `docs/PLAN-TRABAJO.md`.

**Cómo leer esto:** es autosuficiente. No asume ninguna conversación previa y no hace falta que conozcas ni el repo ni Cordis antes de empezar: el §1 te da el terreno, el §2 te dice dónde quedó cada pieza de tu diseño, el §3 te explica por qué fallaba, el §4 qué falta, y el **§5 son ocho preguntas concretas** que solo tú puedes responder. Lo que pedimos es un **plan de encaje, no código** (§6).

> **Convención de rutas:** `$DSH_NM` = `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai` (el motor instalado).
>
> `$DSH_HOME` = `/Users/a507/Library/Application Support/abaco-deep-core/harness` — el perfil **de ABACO DEEP HARNES**, y **nadie más**. No es `~/.dsh`, y **no** es `/Users/a507/Library/Application Support/dsh-desktop/harness`, que es el perfil de la app **DeepSeek Desktop** (`dsh-desktop`), un producto distinto que comparte el mismo directorio padre. ABACO fija su `userData` a `abaco-deep-core` en `desktop/src/dsh-desktop/src/main/index.ts:533` y cuelga `harness/` de ahí (`:751`); el comentario `:523-533` declara que la separación respecto del perfil del shell upstream (`dsh-desktop`) es deliberada. Ver **R13** (§4.9): tres auditorías los han confundido.
>
> **Estado del perfil de ABACO hoy:** **no existe.** Se borró en una limpieza posterior a la escritura de este documento. Los chequeos de §4.5, §4.6 y §7 son por tanto **arqueología fechada**, no comprobaciones vivas; donde dicen "no existe" se refieren al estado medido **entonces**.
>
> **Convención de evidencia:** toda afirmación sobre código lleva cita `archivo:línea`. Lo que no se pudo determinar sin ejecutar la app está marcado **[NO VERIFICADO]**.

---

## 0. El titular

**Tu diseño no hay que inventarlo: ya está construido, y está encajado como plugins.** El modelo de tres capas vive hoy en tres paquetes `abaco-*` montados en la composición, con almacén con escritura atómica, journal de auditoría, tools registradas y una sección de system prompt que se reevalúa en cada ensamblado.

Lo que fallaba era **la fontanería**: dos defectos del mismo tipo, en el mismo plugin, escritos contra APIs que no existen, cubiertos por tests que usaban dobles que confirmaban la imaginación. Verde en tests (26/26); muerto en producción; y fallando **en silencio**. Ese es el origen real de que dos agentes anteriores se llenaran de contexto y empezaran a alucinar: no era el diseño de tres capas, era que la capa 1 nunca llegó a estar gobernada por la política de ABACO.

---

## 1. Qué es ABACO y qué es Cordis (el terreno, en corto)

**ABACO DEEP HARNES** es una app de escritorio Electron que corre sobre **DeepSeek Harness (DSH)**, un agente de IA. Repo público `anthony-x507/Abaco-deep-Core` (MIT), bundle `io.abaco.deepcore`. El reparto de piezas está decidido en `docs/DECOUPLING.md:22-28` (decisiones D1–D5) y `:166-170` (las tres capas de fork):

| Capa | Qué es | Naturaleza |
|---|---|---|
| **L1 — Parches al motor** | 20 parches `patch-package` sobre dependencias del registro | Fork mínimo legítimo, no copia |
| **L2 — Shell propio** | main + preload de Electron (~30 archivos de ABACO) | Código propio |
| **L3 — Plugins ABACO** | 14 paquetes `abaco-*` | Extensión, cero fork |

El motor (`@deepseek-ai/dsh` + 224 paquetes) es una **dependencia npm** `0.1.2-rc.1`, no una copia (`DECOUPLING.md:24`). El shell de `dsh-desktop` no está publicado, así que no puede ser dependencia: es aplicación (D2/D3).

**Cordis** es el sistema de extensiones del motor, y su regla es total: **absolutamente todo es una fila en un archivo de composición**. Un plugin es un objeto con `name`, `inject` opcional y `apply(ctx, config)`. Desde ahí puede aportar servicios, herramientas (`ctx.tools.register`), interfaz de navegador en *slots*, y **secciones de system prompt**. La composición de un agente es un "agent preset": un `agent.cordis.yml` bajo `$DSH_HOME/.agent-presets/<id>/`.

Seis restricciones de Cordis condicionan cualquier diseño aquí (`docs/SPEC-CONTEXT-3-LAYERS.md:443-451`):

1. **El valor de retorno del body de un plugin es un *effect*.** Solo vale una función (disposer) o `undefined`. Cualquier otra cosa lanza `TypeError: Invalid effect` (`$DSH_NM/cordis/lib/index.js:1139`) y **tumba el árbol de plugins entero** → la app cae a Safe Mode, que bloquea los bundles de terceros y deja al usuario sin ninguna función de ABACO.
2. **Un servicio por nombre y realm.** Un motor de compactación propio debe **sustituir** la fila, no añadirse.
3. **Leer un servicio no declarado en `inject` lanza.**
4. **Un tipo de evento de sesión propio produce un log que el harness rechaza reabrir.**
5. **La config de compactación se lee en el constructor y se congela**; cambiarla exige recargar el preset.
6. **Un plugin nuevo exige tocar tres sitios:** fila en el patch, dependencia en el parche de `@deepseek-ai+dsh`, y `packages/<pkg>` en `package.json` (`docs/PLAN-TRABAJO.md:149`).

---

## 2. Tu diseño, mapeado a plugins

**El mensaje central: tu diseño ya está encajado. Lo que fallaba era la fontanería.**

| Tu capa | Dónde vive en ABACO | Estado real medido |
|---|---|---|
| **Capa 1 — ventana del turno** | Motor stock `@deepseek-ai/dsh-compaction-basic` + el preset `abaco` que instala `packages/abaco-context` | El motor **funciona**, pero **el preset nunca llega a gobernar** (Bug 2, §3). Corre la política de fábrica: `0.80 / 0.16 / 8192` |
| **Capa 2 — memoria durable** | `packages/abaco-memory` | **Construida y vacía.** Almacén por ámbitos con escritura atómica tmp+rename a 0600 bajo lock, journal `audit/memory.jsonl` (`lib/store.js:13`), archivo mensual `audit/archive/<YYYY-MM>.jsonl` (`lib/store.js:14`), `maxEntryChars` 240 (`lib/store.js:256`), cap global de render 6000 (`lib/schema.js:55`), 10 facetas con `cap`/`ttlDays` (`lib/schema.js:83-92`), 4 tools (`abaco_memory_set/_get/_forget/_list`), `source` obligatorio (`lib/tools.js:128`) y una sección de system prompt `abaco:durable-memory` cuyo `text` es una **función** reevaluada en cada ensamblado. **Pero `$DSH_HOME/abaco-memory/` no existe: nunca se ha escrito un recuerdo.** |
| **Capa 3 — no meter basura** | `packages/abaco-vault` + el mecanismo de *spill* del motor | **Funciona a medias.** El fork baja el tope de spill en línea a 12000 bytes (`build/dsh-desktop.patch.yml:167`). **Hueco crítico del motor:** ver §4.7 |

Y los cuatro principios que derivaste, verificados en código:

| Principio | Estado | Evidencia |
|---|---|---|
| **A** — disparo automático al 90% | **NO CUMPLIDO** | Corre **0.80**, el default de fábrica (`$DSH_NM/dsh-compaction-basic/lib/index.js:13`). El preset ABACO decía **0.60** (`presets/abaco/agent.cordis.yml:195`) y no estaba activo. **El 0.90 del dueño no existía en ninguna parte del código** al medir. ⚠️ Estado movido: hoy la fila del preset ya lleva `0.90 / 0.12 / 8192` sin commitear — ver el aviso del §4.1. |
| **B** — resumen en balas de una línea | **PARCIAL** | El motor stock **ya lo pide**: *"Use terse bullets, not prose paragraphs"* (`.../dsh-compaction-basic/lib/index.js:221`). Pero el mismo prompt se contradice en `:248`. |
| **C** — la primera compactación pide permiso | **NO EXISTE** | Ninguna rama de aprobación en el camino de compactación. Hay que construirlo entero. |
| **D** — los errores nunca se resumen | **NO EXISTE** | El pruner **nunca lee `isError`**: **0 ocurrencias** en `$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js`, aunque el campo existe (`$DSH_NM/dsh-llm/lib/types/message.js:78`). Hoy los errores se truncan y el LLM los resume como una bala más. |

---

## 3. Los dos bugs, y la lección que importa

Los dos son del **mismo tipo**: el plugin se escribió contra **APIs imaginadas**, y sus tests usaban **dobles que confirmaban la imaginación**.

### Bug 1 — `apply` era `async` y devolvía un objeto

`packages/abaco-context/index.js`. Cordis recolecta el **valor de retorno del body de un plugin** como *effect*: solo vale una función o nada. Una promesa que resuelve a un **objeto** lanza `TypeError: Invalid effect` (`$DSH_NM/cordis/lib/index.js:1139`, alcanzado por `effect.then(safeCollect)` en `:1143`) y **tumba el árbol de plugins entero**.

Consecuencia en producción: la app caía a **Safe Mode**, que bloquea todos los bundles de terceros, y el usuario **no veía ninguna función de ABACO** — no solo la compactación: todo.

**ARREGLADO** en `3ddbe73`. El `apply` es hoy síncrono y devuelve `undefined` (`packages/abaco-context/index.js:379` → `export function apply(ctx, config)`), el callback de `ctx.inject` no devuelve la promesa, y hay dos tests de regresión. Verificado por arranque real: sin `Invalid effect`, el árbol monta.

### Bug 2 — `agentPresets.settings` se trataba como fábrica

`packages/abaco-context/index.js:216`:

```js
const registration = rosterCtx.agentPresets?.settings?.()
```

`settings` es una **PROPIEDAD** — un `SettingsScope` con `get/watch/update/replace` — **no una función**. Y además, en el momento en que corre ese callback **todavía es `undefined`**, porque el plugin de presets asigna su `settings` dentro de su **propio** `ctx.inject(["settings"], …)` (`$DSH_NM/dsh-agent-presets/lib/index.js:1311`). Es decir: `agentPresets` ya es inyectable, el callback de esta fila ya corre, y `agentPresets.settings` aún no existe.

Medido con una sonda:

- en `t0` devuelve `{ status: 'unavailable' }` — **en silencio**;
- a los 3 s lanza `TypeError: ap?.settings is not a function`.

Las dos ramas fallan, el `catch` solo escribe un `warn` que nadie lee (`index.js:239`), y `'unavailable'` es un estado legal. Resultado: **el default nunca se adopta** → el `settings.yaml` del perfil de ABACO nunca recibe `agent-presets: default: abaco` → **el preset ABACO se instala pero nunca gobierna**, y el default efectivo se queda en el de la **composición** — `standard` (`$DSH_NM/dsh-web-app/cordis.patch.yml:437-438`; el propio plugin declara cuál está dispuesto a sustituir, `REPLACED_DEFAULT` en `packages/abaco-context/index.js:81`).

Estado al cerrar esta revisión (HEAD `7936852`): el arreglo **ya está commiteado** — `7936852 fix(desktop): abaco-context never adopted the ABACO preset — agentPresets.settings is a property, not a factory`. Se deja constancia porque este documento afirmaba antes que seguía **en vuelo, sin commitear**: eso dejó de ser cierto durante la propia revisión (ver la nota de autoría del §7). Lo que **sigue sin commitear** es otra cosa y hay que mirarla aparte: la fila `compaction-basic` del preset, que en el árbol de trabajo ya lleva `0.90 / 0.12 / 8192` en lugar de los `0.60 / 0.08 / 16384` muertos que cita el §4.1. Que el preset **gobierne de verdad en runtime** sigue **sin verificar** aquí.

### La cadena causal completa

Capa 1 gobernada por `0.80` en vez de la política de ABACO → los agentes se llenan de contexto antes de lo previsto → compactaciones con un resumen que el propio prompt pide en prosa (`:248`) → **y con los errores truncados y resumidos** (D inexistente) → el agente pierde la evidencia y el hilo → alucina. Nada de eso era el diseño de tres capas. Era fontanería.

### La lección, en una línea

**Verde en tests (26/26), muerto en producción, y fallando en silencio, porque los dobles de test implementaban la API imaginada en vez de la real.** La regla que adoptamos desde entonces: un test que usa un doble nunca prueba el contrato del servicio real; el contrato se verifica leyendo el paquete instalado, y todo camino de fallo tiene que ser **ruidoso**.

---

## 4. Lo que falta para que tu diseño gobierne de verdad

### 4.1 El 0.90 no está cableado en ninguna parte

El dueño **bloqueó** la política (es un LOCK, no una propuesta — `docs/SPEC-CONTEXT-3-LAYERS.md:265`): **`thresholdRatio: 0.90`, `retainRatio: 0.12`, `auto: true`, `maxTokens: 8192`, `compactionRetries: 1`, `maxOverflowRetries: 1`** (`:271-280`). Valores muertos, no candidatos: el `0.80` de fábrica (`:13`) y el `0.60 / 0.08 / 16384` del preset (`agent.cordis.yml:192-197`).

> **Movimiento en curso (HEAD `7936852`).** Esa fila del preset **ya está cableada a `0.90 / 0.12 / 8192` en el árbol de trabajo**, sin commitear, mientras se revisaba este documento. Es decir: los `0.60 / 0.08 / 16384` citados arriba y en la tabla del §2 son el **estado medido en la auditoría**, no lo que hay hoy en disco. El 0.90 ha dejado de ser "un valor que no existe en ninguna parte del código": existe ya en la fila, pero **que el preset gobierne en runtime sigue sin verificar** (el §4.5). Cita y estado a reconfirmar con `git diff` antes de usarlos.

Con la regla explícita del criterio de done 6 (`:348`): **si algo del motor impide 0.90 de forma segura, hay que reportar el bloqueo con evidencia, nunca bajar a 0.80 sin preguntar.** Hoy **no hay bloqueo**: `retainTokens < thresholdTokens` se cumple para todo window porque se usan ratios (`:297`), y el window del modelo enrutado es `1_000_000` (`$DSH_NM/dsh-llm-deepseek/lib/index.js:1377`, `:1831`), así que al 0.90 sobran 100.000 tokens de aire para un resumen de 8192 (`SPEC:394-407`).

### 4.2 B — el stock se contradice consigo mismo

El prompt de compactación pide balas (`:221`) y en las reglas finales pide prosa (`:248`). Sospechamos que `:248` es la causa de que los checkpoints salgan narrativos. **Solo el motor propio (fase 3) permite una plantilla limpia**; antes de eso, cualquier arreglo es un parche que se pierde en la próxima actualización.

### 4.3 C — no existe nada

Ni flag, ni servicio de aprobación, ni rama. Y las decisiones abiertas son de diseño, no de código: dónde vive el flag por sesión (debe **sobrevivir a la compactación que él mismo autoriza**), y **cómo se maneja el rechazo sin convertirse en un bucle** (riesgo R4): el listener de `agent/pre-step` (`$DSH_NM/dsh-compaction-basic/lib/index.js:781-783`) corre en **cada** paso, así que un rechazo que se ignora produce una petición de permiso por turno.

### 4.4 D — no existe, y hay que cubrir tres rutas, no una

1. **Truncado mecánico:** el pruner no lee `isError` (`dsh-compaction-tool-result-pruner/lib/index.js:137` — `pruneSession`; 0 ocurrencias en todo el archivo). *La cita anterior `:141` era falsa: `:141` es un comentario `/* v8 ignore next … */` dentro del bucle.* Ojo: el prune **conserva** la marca `isError` en el bloque sustituido (`:157-160`) — lo que falta es una guarda que **actúe** sobre ella.
2. **Reescritura por LLM:** la sección "Errors and Fixes" del prompt invita a condensar (`dsh-compaction-basic/lib/index.js:234`; la cita previa `:232` estaba desfasada). Es una sección **dedicada**, no una bala genérica.
3. **Camino de overflow:** `compactIfNeeded` con `trigger === "context-overflow"` (`dsh-compaction-basic/lib/index.js:870-875`; invocado desde `:815`) **no llama nunca a `resolveCompactSpec`**: usa `selectCompactableRange(..., 0)` (`:875`) y resume todo. La guarda del pruner **sí** alcanza esta ruta (misma `prune.pruneSession`, `:872`), pero no impide que el error entre en el resumen.

### 4.5 El preset no se adopta

En el perfil **de ABACO** (`$DSH_HOME` = `…/abaco-deep-core/harness`), `.agent-presets/` **no existía** (ni el directorio ni el marcador), y su `settings.yaml` contenía **solo** la sección `ui-onboarding` y **ninguna** clave `agent-presets`: **no decía `default: cordis` en ninguna parte**. Y ahí está el detalle que importa: al **faltar** la clave, el roster no se queda sin default — cae al de la **composición**, que es **`standard`** (`$DSH_NM/dsh-web-app/cordis.patch.yml:437-438`), porque el registro del scope usa `config.default` de la fila como base (`$DSH_NM/dsh-agent-presets/lib/index.js:1250`). Es decir: el default efectivo era `standard`, **no** `cordis`, y el archivo de ABACO nunca afirmó lo contrario. Es el Bug 2 (§3). Sin esto, nada de lo anterior importa: la política de ABACO no llega a ejecutarse.

> **Corrección de un dato falso (retirado en este commit).** Una versión anterior de este documento afirmaba: *"`$DSH_HOME/settings.yaml:11-12` dice `default: cordis`"*. **Era falso, y era el perfil equivocado.** `default: cordis` existe, sí, pero en `/Users/a507/Library/Application Support/dsh-desktop/harness/settings.yaml:11-12` — el perfil de la app **DeepSeek Desktop**, que no es ABACO. Se corrige porque este documento se envía a un arquitecto externo y no puede llevar datos falsos. Ver **R13** (§4.9).
>
> **Nota de verificabilidad:** como el perfil de ABACO se borró después, el contenido exacto de su `settings.yaml` **ya no se puede re-comprobar en disco** — solo consta por lectura directa en el momento de la auditoría. Esa es precisamente la razón por la que la confusión con el otro perfil se repite: el archivo que sí se puede abrir hoy (`dsh-desktop`) contiene justo el dato que el de ABACO no tenía.
>
> ⚠️ **La spec dice hoy lo contrario, y hay que leerlo.** `docs/SPEC-CONTEXT-3-LAYERS.md:66` afirma que *"`settings.yaml` **SÍ** tiene la clave `agent-presets`: `$DSH_HOME/settings.yaml:11-12` → `default: cordis`"*, presentándolo como corrección a una auditoría anterior; y `:251` añade que *"`$DSH_HOME` real es `…/dsh-desktop/harness`"*. Las dos lecturas **no pueden ser ciertas a la vez**: la que corresponde al perfil que **sí** existe es la de `dsh-desktop`, que no es ABACO. Queda registrado como **D-5** en `docs/COLLABORATOR-CRITERIA.md` §13.3, **sin resolver** y sin tocar la spec en esta revisión.

### 4.6 La capa 2 está vacía

`$DSH_HOME/abaco-memory/` — en el perfil **de ABACO**, `…/abaco-deep-core/harness` (R13) — **no existía**. La capacidad está construida y probada; el uso es **cero**. No hay evidencia de que la inyección de system prompt funcione de extremo a extremo, porque nunca hubo nada que inyectar.

### 4.7 El hueco del subagente: retorno verbatim y sin tope

`$DSH_NM/dsh-subagent/lib/index.js:1725-1742` inserta la salida terminal de un subagente **verbatim y sin ningún tope** en un `user/message` — y **no pasa por `tools/post-execute`**, así que el spill no lo toca. Solo `packages/abaco-vault` acota algo, y solo por encima de 12000 bytes. Un subagente puede devolver 200 KB y entran completos a la ventana viva: justo lo que tu capa 3 existe para evitar.

### 4.8 Las fases pendientes

`docs/PLAN-TRABAJO.md:85-91` y `:125-129`:

| Fase | Qué | Estado |
|---|---|---|
| **0** | Telemetría (`abaco-observability`): JSONL de compactaciones, truncados, spilleos | **PENDIENTE — el paquete no existe.** Sin esto ningún cambio es demostrable |
| 1 | Preset ABACO con política propia | Hecho, pero **no gobierna** (§4.5) |
| 2 | `abaco-memory` MVP (capa 2) | Hecho, **vacío** (§4.6) |
| **3** | Motor propio (subclase: nunca compactar con turno abierto, máx. 1 por tarea, sin `retainTokens=0` en overflow, plantilla propia) | **PENDIENTE** |
| 4 | Capa 3: vault + corte del aviso `subagent-settled` | Corriendo |
| **5** | `context_recall` sobre el vault + eval + CI | **PENDIENTE** |
| **6** | Consolidación con LLM + UI `/memory` | **PENDIENTE** |

### 4.9 Tensiones abiertas que un plan tiene que resolver

- **R12 — span contra presupuesto:** a 1M, el tramo compactable al 0.90 es ≈ **780.000 tokens** para un resumen de **≤8192** (≈ **95:1**). Es riesgo de **calidad**, no de seguridad, y el lock no lo reabre (`SPEC:409`).
- **R8 — error literal infla:** preservar errores completos hace que la ventana se llene más rápido. Contrapresión legítima de D, que se mide, no se desactiva.
- **R7 — spill no durable:** `mkdtempSync(tmpdir())` (`$DSH_NM/dsh-spill-local/lib/index.js:35`): tras reiniciar, las referencias apuntan a ficheros borrados.
- **R10 — el preset es copia verbatim de `standard`:** un upgrade del motor introduce filas que el preset `abaco` no tiene, y esa capacidad "desaparece" solo en modo ABACO.
- **R13 — la trampa de los dos perfiles (documentada, no resuelta).** Los dos perfiles **se llaman casi igual**, viven en el **mismo directorio padre** (`~/Library/Application Support/`) y **ambos contienen una carpeta `harness/`**. Tres auditorías distintas los han confundido, y este documento fue una de ellas: leyó `agent-presets: default: cordis` del perfil de **DeepSeek Desktop** y se lo atribuyó al de ABACO (§4.5). Forma exacta de distinguirlos — listar el directorio padre y mirar el **nombre**:
  ```bash
  ls -la "$HOME/Library/Application Support" | grep -i 'abaco\|dsh'
  ```
  - `abaco-deep-core/` → perfil **de ABACO**, y su harness es `abaco-deep-core/harness`. Es **el nuestro**. Hoy **no existe**: se borró en una limpieza posterior. Fijado en código en `desktop/src/dsh-desktop/src/main/index.ts:533`, con la separación explicada en `:523-533`.
  - `dsh-desktop/` → perfil de la **app DeepSeek Desktop** (harness en `dsh-desktop/harness`). **No es ABACO.** Es el que **sí** existe hoy y el que contiene `agent-presets: default: cordis` (`settings.yaml:11-12`).
  Regla operativa: **ninguna afirmación sobre `settings.yaml`, `.agent-presets/` o `abaco-memory/` vale sin nombrar antes el perfil del que se leyó.** Si el perfil no se nombra, el dato no se usa.

---

## 5. PREGUNTAS CONCRETAS PARA TI

Estas ocho son las que bloquean el plan. Ninguna es retórica: cada una tiene una respuesta que solo tú tienes.

**1. Los números exactos de tu compactador.** ¿Qué `thresholdRatio` y `retainRatio` usas, sobre qué ventana los calculas (el window del modelo enrutado o uno propio), y cuál es tu presupuesto de resumen? El lock fija 0.90 / 0.12 / 8192 sobre un window verificado de 1.000.000, y a esa escala el tramo a resumir es ≈780.000 tokens contra un presupuesto de 8192 ≈ **95:1** (`SPEC:409`, R12). ¿Tú subes el presupuesto, resumes por tramos, o aceptas la pérdida? Si la aceptas, **¿cómo evitas que el hilo se degrade en cadena?**

**2. Cómo decides qué pasa a memoria durable, y cuándo.** ¿Qué regla promueve un hecho a la capa 2, y en qué momento del turno se evalúa: instrucción en el system prompt (decide el modelo), post-proceso determinista, o heurística? En ABACO la tool `abaco_memory_set` está montada (`build/dsh-desktop.patch.yml:111-112`) y el almacén tiene **cero entradas**. ¿Qué hace que en tu caso sí se escriba, y qué evita que se escriban tonterías?

**3. Cómo implementas "pide permiso la primera vez".** ¿Qué API usas para preguntar, dónde guardas el flag, y cómo sobrevive ese flag al evento que él mismo autoriza (la compactación sustituye el tramo viejo, así que el flag no puede vivir ahí)? Y sobre todo: **si el usuario rechaza, ¿qué pasa en el siguiente `agent/pre-step` con la presión aún por encima del umbral?** El listener corre en cada paso (`dsh-compaction-basic/lib/index.js:781-783`): ¿cómo evitas exactamente el bucle R4 (N peticiones para 1 sesión)?

**4. Cómo garantizas que los errores sobrevivan.** En ABACO fallan las tres rutas: el pruner no lee `isError` (`dsh-compaction-tool-result-pruner/lib/index.js:137`; la cita `:141` era falsa, y el prune **conserva** la marca aunque no la lea), la sección "Errors and Fixes" invita a condensar (`dsh-compaction-basic/lib/index.js:234`), y el camino de overflow **salta** umbral y validación (`:870-875`). ¿Cubres las tres o solo una? ¿Qué haces cuando el error literal mide 9000 caracteres (R8)?

**5. Qué haces con las tool results en vuelo y el mensaje en curso.** En el stock la protección es **estructural** (fronteras balanceadas: `compactRegion` lanza si partiría un par tool-call/result, `:525-526`), pero **la cola viva se mide por tokens, no por vueltas**: `selectCompactableRange` acumula hasta `retainTokens` (`:379-397`), que a 1M con `retainRatio 0.12` son **120.000 tokens** de cola — pueden ser más o menos de las 5 vueltas que exige el lock (`SPEC:315`, donde consta como **NO satisfecha**). ¿Cómo mides tú "las últimas 5 vueltas" en vueltas y no en tokens?

**6. Cómo evitas que el resumen se degrade en cadena.** El prompt del stock ordena explícitamente **no copiar el checkpoint anterior verbatim** (`dsh-compaction-basic/lib/index.js:251`), lo que implica que cada compactación resume un resumen. En una sesión larga, la décima compactación es un resumen de un resumen de un resumen. ¿Qué haces tú: checkpoint acumulativo, reanclaje a las fuentes originales, o prohibición de compactar un checkpoint?

**7. Cómo acotas el retorno de un subagente.** Tu capa 3 dice que el trabajo pesado vuelve "en corte". En ABACO el corte **no existe**: la salida terminal entra verbatim y sin tope en un `user/message` (`dsh-subagent/lib/index.js:1725-1742`) y no pasa por el spill. ¿Tope duro, resumen obligatorio del subagente, o spill con locator? ¿Y si el subagente devuelve 200 KB?

**8. Cómo mides que la compactación sirvió.** ABACO no tiene telemetría: la fase 0 no existe. El lock fija los campos mínimos (`timestamp`, `used_before`, `used_after`, `thresholdTokens`, `retainTokens`, `model route`) y dos alertas (si `used_after >= used_before`; si el motor desactiva la compactación — **nunca en silencio**). Pero "liberó tokens" no es "el agente ya no alucina". ¿Qué métrica te dice a ti que un checkpoint fue **útil**? ¿Evalúas la calidad del resumen con sesiones doradas y preguntas cuya respuesta debe sobrevivir a la compactación?

---

## 6. Qué necesitamos de ti

**Un plan de encaje, no código.** Concretamente:

1. **Orden.** Qué se hace primero y por qué. Nuestra hipótesis actual es: fase 0 (telemetría) → **D** (la guarda `isError`, la más barata y determinista) → **C** (barata en lógica, cara en integración) → **A** (el valor, ya desbloqueado) → fase 3 (motor propio) → **B** (plantilla, limpia solo dentro del motor propio) → fase 5 → fase 6. Dinos dónde te equivocamos.
2. **Sustituir o añadir**, por pieza. Cordis solo admite un servicio por nombre y realm: el motor propio **sustituye** la fila `compaction-basic`. Para C y D, ¿parche al stock, subclase en fase 3, o fila nueva con otro nombre? ¿Qué se pierde en cada caso en la próxima actualización del motor?
3. **Dónde vive cada estado nuevo**, sobre todo el flag de C y el punto de persistencia a capa 2 ("antes de compactar, persistir los hechos a memoria durable" — `SPEC:323`).
4. **Cómo se verifica cada pieza** sin juicio humano, con criterio de aceptación observable. Los nuestros están en `SPEC:341-350` y en el §3 de la spec.
5. **Dónde nuestro diseño te parece mal.** Si alguna de tus propias capas no encaja como la hemos encajado, dilo: preferimos discutirlo ahora que descubrirlo en un Safe Mode.

---

## 7. Estado del repo: dónde mirar

**Repo:** `https://github.com/anthony-x507/Abaco-deep-Core` — rama `main`, base de lectura `ef0c34d`.

> **Nota de autoría:** HEAD se movió mientras se escribía este documento (`0553220` → `a3708a3` → `ef0c34d`) porque otro frente estaba commiteando la spec y el LOCK. Y **volvió a moverse durante la revisión de los datos de perfil**: al cerrar, HEAD es **`7936852`** (`fix(desktop): abaco-context never adopted the ABACO preset…`), que **commitea el arreglo del Bug 2** — el documento decía que estaba sin commitear, y ese arreglo también cambió de estado a mitad de la revisión. Queda **sin commitear** la fila `compaction-basic` del preset con `0.90 / 0.12 / 8192`. Verifica `git log -1` y `git status` antes de dar por buena cualquier cita, incluida esta nota.

**Documentos:**

| Archivo | Qué contiene |
|---|---|
| `docs/SPEC-CONTEXT-3-LAYERS.md` | La spec de las 3 capas y los principios A/B/C/D. **El §8 (`:265`) es el LOCK del dueño y manda sobre §3 y §4.** El §8.1 fija la policy; §8.3 las protecciones; §8.4 la UX del primer permiso; §8.5 la telemetría; §8.6 el criterio de done; §8.7 y §8.8 cierran si el 0.90 es seguro; **§8.10 registra las coincidencias contigo y el orden de implementación acordado** |
| `docs/COLLABORATOR-CRITERIA.md` | Tu respuesta al §5, verbatim y ordenada, con la reconciliación contra el §8 de la spec, las divergencias registradas y el **orden reconciliado** (§12) |
| `docs/DECOUPLING.md` | Qué es dependencia, qué es plugin y qué exige fork (§1.2 pieza por pieza; §2.3 las tres capas L1/L2/L3) |
| `docs/PLAN-TRABAJO.md` | Plan vivo. Fases de memoria en `:83-91`; reglas de oro (incluida la de los tres sitios) en `:137-150` |
| `docs/DESIGN-memory-3layer.md` | Diseño de memoria de 956 líneas, validado contra el motor |
| `docs/DESIGN-compaction.md`, `docs/COMPACTION.md`, `docs/TECH-plugin-loading.md` | Diseño de compactación y carga de plugins |

**Código a leer primero:**

| Ruta | Por qué |
|---|---|
| `desktop/src/dsh-desktop/packages/abaco-context/index.js` | El plugin de la capa 1. Bug 1 arreglado (`:273`); Bug 2 en `:216` |
| `desktop/src/dsh-desktop/packages/abaco-context/presets/abaco/agent.cordis.yml:192-197` | La fila de compactación (en la auditoría 0.6/0.08/16384: valores muertos; **hoy cableada a 0.90/0.12/8192 sin commitear** — ver el aviso del §4.1) y `:204-207` el pruner propio |
| `desktop/src/dsh-desktop/packages/abaco-memory/{index.js,lib/}` | Capa 2 completa: `store.js`, `schema.js`, `render.js`, `tools.js` |
| `desktop/src/dsh-desktop/packages/abaco-vault/` | Capa 3: corte del aviso `subagent-settled` |
| `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml` | La composición: filas de `abaco-memory` (`:111-112`), `abaco-vault` (`:125-126`), `abaco-context` (`:142-143`), spill 12000 (`:167`) |
| `desktop/src/dsh-desktop/test/abaco-context.test.ts`, `abaco-memory.test.ts` | Los tests verdes que **no** detectaron nada de lo anterior |

**Cómo se valida un cambio de composición sin lanzar la app** (regla ya verificada, `PLAN-TRABAJO.md:97`):

```bash
dsh --profile web --patch <yml> --dump-config
```

**Cómo se comprueba el estado de la capa 2 y del preset en la máquina:**

```bash
# 0) Antes que nada: ¿de qué perfil estoy leyendo? El de ABACO se llama abaco-deep-core (R13).
ls -la "$HOME/Library/Application Support" | grep -i 'abaco\|dsh'

# Perfil de ABACO — estado medido ENTONCES; el perfil se borró después, así que esto es arqueología.
ls "$DSH_HOME/.agent-presets"       # entonces: no existía → el preset no se adopta
ls "$DSH_HOME/abaco-memory"         # entonces: no existía → la capa 2 está vacía
grep -n 'agent-presets' "$DSH_HOME/settings.yaml"
#   entonces: 0 coincidencias — la clave NO estaba. El default efectivo era el de la
#   composición (`standard`), NO `cordis`. El `default: cordis` que se citaba antes
#   estaba en el perfil de DeepSeek Desktop, que no es este (R13).
```

---

**Cierre.** El diseño de tres capas es correcto y está construido. Lo que falta no es una idea nueva: es fontanería, telemetría, y dos guardas que hoy no existen (C y D). Tu plan nos dice en qué orden hacerlo sin volver a caer en un Safe Mode.
