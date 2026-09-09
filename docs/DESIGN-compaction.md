# DESIGN — Compactación de contexto/memoria sin degradar la inteligencia del agente

> **Estado:** propuesta de diseño (solo lectura + análisis). **No implementado.**
> **Alcance:** (1) el motor de compactación del harness DeepSeek Harness / DSH Desktop que
> ejecuta la app real (evidencia en `desktop/src/dsh-desktop/node_modules/@deepseek-ai/`),
> y (2) el módulo propio `core/compaction/` de abaco-deep-core.
> **Fecha:** 2026-09.
>
> Salvo indicación explícita, todas las rutas son relativas a la raíz del repo
> `abaco-deep-core/` (= `.../abaco_core/abaco-deep-core/`).
> Las rutas de node_modules apuntan a `desktop/src/dsh-desktop/node_modules/@deepseek-ai/…`
> (paquete **0.1.2-rc.1**, vendored en el fork; el producto empaquetado
> `/Applications/ABACO Deep Core.app` embarca exactamente ese 0.1.2-rc.1).

---

## 0. Resumen ejecutivo

El usuario percibe: *"compacting context/memory is not working well — compact twice and the
agent is useless"*. La causa está en el motor del harness (`@deepseek-ai/dsh-compaction-basic`),
**no** en `core/compaction/` (Python), que hoy **no está conectado al loop del agente** y solo
produce resúmenes estadísticos deterministas.

El harness hace una sola cosa, muy agresiva: cuando la presión de tokens cruza un umbral,
**borra un rango enorme del historial (head-anchored)** y lo reemplaza por **un único mensaje
de resumen de ≤ 8.192 tokens de salida**. Con el contexto DeepSeek declarado en 1M de tokens
(`dsh-llm-deepseek/lib/index.js:1378`) y los defaults `thresholdRatio 0.8` / `retainRatio 0.16`
(`dsh-compaction-basic/lib/index.js:15-17`), una compactación resume ~640k+ tokens en ≤ 8.192
**de salida** (ratio > 80:1). La segunda compactación resume *el checkpoint anterior + ~640k
tokens nuevos* → **resumen-de-resumen**, con pérdida compuesta. El agente queda "inútil" porque:

1. un solo resumen no puede retener detalles exactos (paths, comandos, errores, cifras,
   delegaciones verbatim del LEADER) tras ratios de compresión >80:1;
2. no existe ningún "estado vivo" separado (tareas, decisiones, preferencias, identidad):
   todo vive en prosa del resumen y el modelo decide qué omitir;
3. no hay compresión selectiva previa por tipo de contenido (resultados enormes de tools,
   JSON, wall-of-text de `search`/`web_extract`) — todo se resume por igual;
4. el disparo ocurre en medio del trabajo (`agent/pre-step`) y, en overflow, mantiene
   `retainTokens = 0` (casi todo el historial se resume);
5. la medición es heurística (4 chars/token) y **subestima** código/JSON/CJK, por lo que
   puede disparar tarde y sobre un span aún mayor.

**Estrategia recomendada (sección 3):** sustituir el *single-shot full-span LLM summary* por
un sistema de 4 carriles + disparo seguro:
**A. podar/truncar antes de resumir** (solo tool outputs y resultados intermedios, nunca el
diálogo), **B. ventana reciente verbatim amplia y nunca tocar el turno/tarea en curso**,
**C. estado vivo estructurado separado que no se resume** (tareas, decisiones, preferencias,
identidad/instrucciones, correcciones del usuario verbatim, formato de salida), y
**D. resumen narrativo jerárquico por episodios/temas** con plantillas de preservación de
exact-strings, archivo completo recuperable y reglas anti "resumen-de-resumen". Todo ello
mediante un plugin propio en el fork (el motor expone un hook `summarize()` y el contrato
`CompactionEngine` permite un backend propio) + ajustes de configuración inmediatos.

---

## 1. El problema: qué hace hoy la compactación del harness y por qué degrada

### 1.1 Comportamiento observado (evidencia en node_modules del fork)

El pipeline real (paquetes `@deepseek-ai/dsh-compaction`, `dsh-compaction-basic`,
`dsh-compaction-tool-result-pruner`, `dsh-token-meter`) funciona así:

1. **Medición.** `ctx.tokenMeter.measure(session)` fija un precio heurístico a cada nodo de la
   superficie: `ceil(text.length / 4) + 4` por bloque + 4 de rol
   (`dsh-token-meter/lib/types/estimate.js`, `CHARS_PER_TOKEN = 4`). El propio README del
   medidor admite que CJK y JSON/schemas quedan *mal pagados* ("underprice badly at four
   characters per token", `@deepseek-ai/dsh-token-meter/README.md`).
2. **Disparo automático.** Un listener de `agent/pre-step` (antes de cada paso de modelo, es
   decir **en mitad de la tarea en curso**) compara `measure().totalTokens` contra
   `thresholdTokens = floor(contextWindow × thresholdRatio)` y, si cruza, compacta
   (`dsh-compaction-basic/lib/index.js:782-795`, `resolveCompactSpec` en `:108-126`).
   También hay recuperación de overflow ante `CONTEXT_WINDOW_EXCEEDED`
   (`:804-830`).
3. **Defaults** (`lib/index.js:15-17,72-76`):

   | Parámetro | Default | Efecto |
   |---|---|---|
   | `thresholdRatio` | `0.8` | compacta al 80% de la ventana del modelo |
   | `retainRatio` | `0.16` | mantiene verbatim el 16% más reciente |
   | `retainTokens` | — (mutuamente excluyente con ratio) | presupuesto absoluto de cola reciente |
   | `maxTokens` | `8192` | tope de **salida** de la llamada de resumen |
   | `compactionRetries` | `1` | reintentos extra si sigue por encima del umbral |
   | `maxOverflowRetries` | `1` | reintentos tras overflow confirmado |
   | `auto` | `true` | activa disparo automático + overflow |
4. **Ventana del modelo DeepSeek.** El adapter declara `contextWindow = 1e6` para
   `deepseek-v4-flash` / `deepseek-v4-pro`
   (`dsh-llm-deepseek/lib/index.js:1378,1829-1847`). Con defaults ⇒ compacta a ~800k medidos
   y conserva ~160k tokens verbatim.
5. **Selección del span.** `selectCompactableRange` camina desde el final acumulando tokens
   hasta cubrir `retainTokens` y compacta **todo lo anterior al índice resultante**
   (`dsh-compaction-basic/lib/index.js:381-403`): selección puramente posicional
   (head-anchored), nunca por contenido/tema. Solo respeta pares tool-call/result
   (`toolPairingBalancedBefore`, `:394-397`).
6. **Pruner opcional.** `dsh-compaction-tool-result-pruner` recorta *solo* `tool/result` que
   supere `thresholdChars=8192` dejando `headChars=4096 + tailChars=1024` y un marcador
   `[... tool result middle pruned ...]` (`lib/index.js:8-14,137-194`), y **solo corre después
   de que el disparo ya se haya cualificado** (`dsh-compaction-basic` README y
   `compactIfNeeded` `:885-889`): por debajo de presión nunca se toca nada.
7. **Llamada de resumen.** Replica verbatim system + tools + mensajes del span elegido y
   **añade la instrucción de compactación como último user message**
   (`dsh-compaction-basic/lib/index.js:269-318`, `buildSummarizationInput` `:651-659`). La
   instrucción pide una estructura Markdown fija de 8 secciones
   (`COMPACTION_INSTRUCTION`, `:220-255`): Primary Request and Intent / Key Technical Concepts /
   Files and Code / Errors and Fixes / Pending Jobs / Current Work / Next Step /
   Critical Context, con reglas "preserve exact file paths… identifiers, numeric values…",
   "capture user feedback… verbatim", "do NOT mention this summarization request", y si ya hay
   un `<compacted-summary>` previo: *"Do not copy it forward verbatim: preserve still-true
   facts, drop stale ones, and merge…"* (`:254`). El tope de salida es `maxTokens` (8.192) y,
   si el modelo usa razonamiento oculto, parte de ese presupuesto puede consumirse (README del
   paquete, "Known Limitations").
8. **Reemplazo.** El resumen se envuelve con un preámbulo + `<compacted-summary>…</compacted-summary>`
   (`frameSummary` `:324-336`) y **se inserta como un `user/message` único** con
   `surfaceOp: {op:"replace", start, end}` (`commitCompactionBody` `:586-633`; contrato en
   `@deepseek-ai/dsh-compaction/README.md`, "The surface contract": solo
   `user/message|assistant/message|tool/result` pueden estar en la superficie; los eventos
   `compaction/*` quedan solo en el log). El resumen debe ser más pequeño que el span
   sombreado, si no, la compactación falla (`:555-559`).
9. **Overflow.** Con `CONTEXT_WINDOW_EXCEEDED` el motor **no respeta retención**: llama
   `selectCompactableRange(..., retainTokens=0)` (`:875` y `compactNow` `:935`) → conserva
   únicamente el/los último(s) nodo(s) balanceado(s) y resume todo lo demás; si el reemplazo
   avanza, reintenta (`:804-830`).
10. **Reintentos.** Si tras compactar sigue por encima del umbral, repite hasta
    `compactionRetries + 1` veces (`:891-903`); si la salida se trunca en el tope, lanza error
    `MAX_TOKENS` ("incomplete checkpoint", `:346-350`) y la compactación automática continúa
    con el historial por encima de presupuesto (README, Known Limitations).

**Configuración del fork:** no hay ninguna fila de configuración de compactación en el perfil
del desktop del fork: `build/dsh-desktop.patch.yml` y `build/dsh-desktop-safe.patch.yml` no
mencionan `compaction|threshold|retain|maxTokens` (grep sin resultados), y en `patches/` **no
existe ningún patch sobre `dsh-compaction*`** (solo, p. ej., `dsh-llm-deepseek` para mapeo de
errores 401/403). Es decir: el fork corre **stock, con defaults** (`package.json:129-131`
ancla los tgz `0.1.2-rc.1`).

### 1.2 Por qué el agente se vuelve "inútil" tras 1–2 compactaciones

Pérdida de inteligencia observada → causa mecánica concreta:

| # | Síntoma | Causa raíz (evidencia) |
|---|---|---|
| 1 | **Pérdida masiva por ratio de compresión** | Un único LLM-summary de ≤ 8.192 tokens de salida sustituye un span de cientos de miles de tokens (ratio > 80:1 con defaults 0.8/0.16 sobre 1M). Ningún resumen en un solo paso retiene exact-strings (paths, comandos, ids, cifras, errores) de cientos de tool calls. |
| 2 | **"Compact twice" = resumen-de-resumen** | El checkpoint anterior es un `user/message` normal en el historial; la 2ª compactación elige el span head-anchored desde el nodo 0, que **incluye el checkpoint previo**, y pide "merge, no copies" (`:254`). Cada generación re-condensa una ya-condensada: la pérdida se compone (2ª compactación ≈ pérdida²) y, como el tope de salida es el mismo 8.192, la densidad de información no puede crecer. |
| 3 | **Se resume contenido que no debería resumirse** | La selección es posicional, no semántica (`:381-403`): se resume por igual diálogo de usuario, delegaciones del LEADER (verbatim crítico en el flujo ABACO multi-agente), errores exactos, tool outputs intermedios y resultados ya superados. El diálogo y las instrucciones del usuario sufren la misma compresión que el ruido. |
| 4 | **No hay estado fuera del historial** | Tareas en curso, decisiones, preferencias del usuario y "do-not" solo existen como prosa dentro del checkpoint. El modelo que resume decide qué conservar sin un esquema de estado; nada garantiza que "Current Work / Pending Jobs" se actualice ni sobreviva. (En ABACO existen `agents/*/memory.jsonl`, `lessons.jsonl`, `reflections.jsonl` — memoria de largo plazo — pero no un estado vivo de sesión inyectado siempre.) |
| 5 | **El disparo ocurre en mitad de la tarea** | El listener es `agent/pre-step` (`:782-795`): compacta entre pasos de un turno largo; la propia tarea en curso (y su contexto de trabajo reciente si supera `retainTokens`) queda bajo el cuchillo. En overflow, además, `retainTokens = 0` (`:875`): el agente pierde casi todo su working memory inmediato y debe continuar desde un resumen de su propio trabajo a medio hacer. |
| 6 | **Medición poco fiable → disparos mal calibrados** | Heurística 4 chars/token (`estimate.js`) que subestima JSON/código/CJK. Puede disparar tarde (span mayor a resumir) o no disparar antes de un overflow real del proveedor, que entonces aplica el modo destructivo del punto 9 de 1.1. |
| 7 | **Fallo silencioso / retry caro** | Salida truncada ⇒ `MAX_TOKENS` ⇒ la compactación falla y el sistema sigue con contexto por encima del umbral o reintenta pagando otra llamada grande (`:346-350`, `:891-903`). |
| 8 | **El checkpoint viaja como user message** | La superficie solo admite `user/message` como portador (`dsh-compaction/README.md`), de modo que el modelo ve un "turno de usuario" gigante con el resumen; si el resumen es pobre o incoherente, contamina el siguiente razonamiento. |

**Contexto de uso real que agrava todo:** en los datos locales de la app ABACO
(`~/Library/Application Support/Abaco Desk/agents/<id>/factory/session.jsonl`) se ven workers
multi-turno con decenas de `tool/call` (p. ej. `search` / `web_extract`) y mensajes de
delegación enormes del LEADER/ESTRATEGA al inicio de cada sesión; esos mensajes iniciales —
los más importantes para la tarea — están en la cabeza del historial y son **los primeros en
ser resumidos** por la selección head-anchored.

**Nota de versiones:** el motor del harness publicado que acompaña este entorno
(`/Applications/DSH Desktop.app`, `dsh-compaction-basic@0.1.2-alpha.1`) y el vendored del fork
(`0.1.2-rc.1`, también dentro de `/Applications/ABACO Deep Core.app`) comparten el mismo
diseño y defaults; cualquier corrección debe hacerse en el fork y re-empaquetarse.

---

## 2. Qué hace hoy `core/compaction` (propio) y en qué se diferencia

Módulo Python autocontenido (importa solo stdlib + `core.*`), reversible y determinista.
Lectura módulo a módulo:

| Módulo | Qué hace (path:line) |
|---|---|
| `core/compaction/README.md` | Objetivos (acotar ledgers JSONL, archivar tickets cerrados, comprimir sesiones que excedan presupuesto **sin perder contexto reciente**) y limitaciones explícitas: "Summary generation is heuristic and deterministic… does **not** call an LLM, so the output is intentionally terse" (`:122-134`). |
| `models.py` | `CompactionPolicy` (umbrales + `keep_recent=100`, `:16-43`), `SessionTurn` (solo `content: str` + `metadata`, `:97-110`), `SessionWindowSummary` (`:113-123`), `CompactionResult` (`:46-65`). |
| `summary_generator.py` | **Resumen determinista sin LLM.** Para sesiones (`summarize_session`, `:185-246`) produce estadísticas: nº de turnos, distribución de roles, top tools detectadas por regex `tool:=` (`:200-205`) y fragmentos de errores — **no** un resumen narrativo ni hechos. |
| `session_compactor.py` | `SessionCompactor(keep_recent=10)` conserva los últimos K turnos verbatim y resume el resto con `SummaryGenerator` (`compact`, `:49-80`); métrica de tokens = `words/0.75` (`:22-32`). |
| `ledger_compactor.py` | Archiva registros viejos a `archive/{ledger}-{date}.jsonl` con escritura atómica y deja un resumen de estadísticas (`compact`, `:224-381`). |
| `ticket_compactor.py` | Igual para tickets en estado terminal con más de N días (`:165-318`). |
| `retention.py` | Reglas keep/archive por orden y edad (`decide_retention`, `:47-108`). |
| `policies.py` / `scheduler.py` / `api.py` / `events.py` | Fábricas de políticas size/time/count; scheduler manual/on_write/interval; router FastAPI `/api/compaction/*`; eventos `system.compaction.{started,completed,failed}`. |
| `docs/COMPACTION.md` | Documentación en español; "Próximos pasos" ya lista "Resúmenes semánticos opcionales (configurable por el usuario)" (`:112-116`). |

**Diferencias clave con el harness:**

1. **No está cableado al agente.** Un grep en todo el repo muestra que `SessionCompactor`,
   `SessionWindowSummary`, `summarize_session`, etc. solo se referencian dentro de
   `core/compaction/` y sus tests (`core/compaction/tests/*`). El único consumidor externo es
   una mención documental en `core/events/__init__.py:5`. Es decir: **la degradación que sufre
   el usuario NO la causa este módulo**; es un feature independiente (ledgers/auditoría) con un
   "session compactor" de demostración.
2. **Resumen estadístico vs semántico.** El resumen propio es determinista y terse (conteos),
   lo que lo hace *peor* que el LLM-summary del harness como reemplazo de historial de chat:
   con él, una sesión compactada perdería incluso la narrativa. Es útil para **ledgers y
   auditoría** (`system.compaction.*`), no para contexto de agente.
3. **Filosofía inversa en reversibilidad:** el módulo propio archiva (nunca borra) y el harness
   *también* conserva los eventos shadowed en el log (`dsh-compaction/README.md`, "surface
   contract") — ambos son recuperables en bruto; lo que ninguno hace hoy es **recuperar bajo
   demanda** esos detalles para reinyectarlos.
4. **Métrica de tokens:** el propio usa una heurística aún más tosca (words/0.75,
   `session_compactor.py:22-32`) que el harness (4 chars/token). Ninguno usa tokenización real.

**Conclusión:** hay dos frentes separados — (a) el motor del harness (el que el usuario
experimenta, urgencia alta) y (b) `core/compaction` (puede evolucionar como *memoria de largo
plazo / compresión de ledgers* y como *referencia de diseño* del resumen estructurado propio).

---

## 3. Estrategia recomendada (diseño concreto)

### 3.1 Objetivo y principios

> Mantener al agente tan inteligente tras compactar como antes: el contexto que ve el modelo
> después de compactar debe contener (1) todo lo necesario para continuar la tarea en curso,
> (2) el estado durable (decisiones/preferencias/identidad) en forma estructurada e intacta,
> (3) un resumen del pasado que sea *fiel y consultable*, no una prosa selectiva irrecuperable.

Principios (alineados con la práctica publicada, ver sección 6):

- **Caro y lossy al final, barato y determinista primero** — Claude Code usa 3 niveles:
  limpiar tool results viejos (gratis) → edición de contexto a nivel API (gratis) → LLM-summary
  (caro, último recurso). Nunca al revés.
- **El resumen LLM es un último recurso y se calibra por recall primero** — Anthropic:
  "overly aggressive compaction can result in the loss of subtle but critical context… tune
  your compaction prompt on complex agent traces. Start by maximizing recall".
- **Separar memoria de trabajo (working memory) de memoria a largo plazo** — MemGPT/Letta:
  el contexto principal contiene el estado vivo; lo viejo se pagina a almacenamiento externo y
  se recupera bajo demanda. Un bloque único "todo resumido" no es memoria.
- **Menos es más: no compactar lo que no hace falta** — "find the smallest possible set of
  high-signal tokens"; el contexto degrada por saturación (context rot / attention budget).
- **El agente debe poder recuperar el detalle exacto** si el resumen lo omitió (archivo crudo +
  herramienta de recall), en vez de re-sintetizar de memoria.
- **Never stack summaries of summaries sin capas ni límite**: o se consolida con capas
  "Previously/Newly" (Claude Code) o se archiva y se deja de resumir lo ya resumido.

### 3.2 Arquitectura propuesta: 4 carriles + reglas de disparo

```
             sesión (log de eventos, inmutables y recuperables)
   ┌───────────┬───────────────────┬───────────────────┬──────────────────┐
   │ A. PRUNE  │ B. RECIENTE       │ C. ESTADO VIVO    │ D. PASADO        │
   │ (selectivo│ (verbatim,        │ (estructurado,    │ (resumen         │
   │  y barato)│  tarea en curso)  │  NO se resume)    │  jerárquico por  │
   │           │                   │                   │  episodios)      │
   └───────────┴───────────────────┴───────────────────┴──────────────────┘
        │                │                 │                  │
        ▼                ▼                 ▼                  ▼
   tool outputs     últimos N msgs    identidad/instruc.   nivel-1: por
   grandes →        completos,        tareas en curso,     episodio/tarea
   head+marker+tail nunca tocados     decisiones, pref.    nivel-2: merge
   (placeholder)    mientras el       usuario verbatim,    de nivel-1 solo
   + nota de 1-2    turno está        correcciones,        si hace falta
   líneas por tool  abierto           formato de salida    archivo crudo
   call (opcional)                    + recuperación       + recall on
                                      bajo demanda         demand (tool)
```

**A. Compresión selectiva por tipo de contenido (antes de resumir, nunca diálogo).**
- Truncar **solo** contenido de `tool/result` grande con marcador visible
  `[head… middle pruned …tail]` (el pruner del harness ya lo hace: `thresholdChars=8192`,
  `headChars=4096`, `tailChars=1024`, `pruner/lib/index.js:8-14`), pero **activarlo siempre
  (en cada pre-step), no solo tras cualificar el disparo** (hoy solo corre si la compactación
  ya se disparó: `dsh-compaction-basic/lib/index.js:885-889`).
- Regla "resultado sintetizado": cuando un tool call devuelve algo que el agente necesita
  después (hecho, path, número), el agente escribe ya una **nota corta (1–3 líneas)** en el
  estado vivo o como mensaje pequeño — *structured note-taking* (Anthropic: notas externas que
  sobreviven resets). Así, aunque el tool output crudo se pode o resuma, el dato útil quedó en
  texto denso y barato de conservar.
- Nunca truncar `user/message` ni `assistant/message` de razonamiento/diálogo; si un mensaje
  de usuario es enorme (delegación larga del LEADER), se conserva verbatim en estado vivo (ver C).

**B. Ventana reciente verbatim amplia + tarea en curso intocable.**
- Reemplazar `retainRatio` relativo por un **presupuesto absoluto de tokens recientes**
  (`retainTokens`, ya soportado) calibrado a la tarea típica ABACO (p. ej. 48–64k tokens),
  y verificar que la delegación + últimos 2–3 pasos de tool del turno abierto caben en él.
- **Nunca compactar el turno en curso:** mover el disparo automático a **idle entre tareas**
  (el contrato ya distingue manual `owner: null` con `runMaintenance`, `compactNow`
  `:928-954`); si no hay idle posible, esperar al cierre del turno. Compactar en
  `agent/pre-step` del propio turno (comportamiento actual `:782-795`) es la causa nº 5 del
  problema.
- Excepción única: overflow real (`CONTEXT_WINDOW_EXCEEDED`). En ese caso, primero A (prune),
  y solo si aún no cabe, **evictar episodios ya cerrados** (tareas previas finalizadas) en vez
  de resumir la tarea actual; nunca `retainTokens=0` sobre todo el historial.

**C. Estado vivo estructurado, separado, que NO se resume.**
Bloque persistente (YAML/JSON) mantenido incrementalmente y **reinyectado completo** en cada
request (o podado por prioridad, nunca re-resumido a prosa). Es la pieza que hoy falta y la que
más inteligencia preserva. Campos mínimos para ABACO sobre DeepSeek:

```yaml
identity:            # identidad/instrucciones del agente (rol en el equipo, protocolos)
agent_role: "PUNTA"  # quién soy, a quién reporto
mission: |           # delegación ORIGINAL verbatim (LEADER/ESTRATEGA) + evolución
  …
tasks:               # tareas en curso: id, estado, siguiente acción
  - id, status(in_progress/done/blocked), next_action
decisions:           # decisiones + rationale (qué y POR QUÉ)
preferences_user:    # preferencias/correcciones del usuario VERBATIM
  - "nunca inventes fuentes", "reporta con URLs", "en español"…
constraints_do_not:  # restricciones y prohibiciones
artifacts:           # hechos clave/artefactos: paths exactos, ids, cifras, errores activos
output_format:       # formato de salida requerido
open_questions:      # preguntas abiertas que bloquean
```

- Mecánica: el agente lo actualiza al final de cada turno (o un paso automático post-turno con
  una llamada corta "extract state diff"); la instrucción de sistema le dice *"antes de cada
  tool call y de responder, si cambia el estado, actualiza ESTADO VIVO"*.
- Este bloque es análogo al **core memory block** de MemGPT y a la **memory tool / CLAUDE.md**
  de Anthropic: contexto pequeño, siempre presente, durable.
- ABACO ya persiste memoria de largo plazo por agente (`agents/<id>/memory.jsonl`, `lessons`,
  `reflections` en los datos de la app): el estado vivo de sesión debe **alimentarse** de esos
  ficheros (leer al inicio) y no duplicarlos.

**D. Resumen narrativo jerárquico del pasado + archivo recuperable.**
- **Compactar por episodios**, no por bytes desde la cabeza: un episodio = una tarea/delegación
  completada (delimitado por user-message con rol del emisor o por turn/end en el log). El
  harness solo conoce pares tool-call/result; el diseño debe detectar límites de tarea.
- **Map-reduce para spans grandes:** nunca un único LLM-summary de 600k tokens. Segmentar el
  span a resumir en chunks de ~30–60k tokens, producir un resumen nivel-1 por chunk con la
  plantilla de preservación (3.4), y solo cuando haya muchos episodios, un nivel-2 que consolide
  nivel-1 (resumen de resúmenes **acotado y con capas**, nunca destructivo sin archivo).
- **Plantilla de preservación (recall-first):** cada resumen nivel-1 debe incluir, como listas
  de *exact strings* (no parafraseadas): delegaciones/instrucciones del usuario que sigan
  vigentes; paths/archivos y por qué importan; errores activos y su fix; decisiones y
  rationale; valores numéricos/ids/firmas; y `next_action`.
- **Anti resumen-de-resumen:** si el span a compactar ya contiene un `<compacted-summary>`
  previo (o estado vivo), el nuevo resumen debe **fusionar con capas explícitas** —
  `Previously compacted:` (se copia solo lo aún verdadero) / `Newly compacted:` — como hace el
  merge multi-round de Claude Code, en lugar de pedir "merge" libre; y **debe poder saltarse**
  re-resumir el checkpoint previo si no aporta: compactar solo desde el final del checkpoint
  anterior hacia delante.
- **Recuperación bajo demanda (recall):** los eventos shadowed ya permanecen en el log crudo
  (`dsh-compaction/README.md`, surface contract). Exponer una **herramienta del agente**
  ("recall"/"context-search") que consulte ese log y devuelva el detalle exacto (mensaje de
  usuario, tool output truncado, error) cuando el agente lo necesite — *just-in-time context*.
  Esto convierte la pérdida "dura" en pérdida "blanda" (recuperable) y es lo que más reduce el
  impacto de cualquier resumen imperfecto.

### 3.3 Reglas de disparo

1. **Medir con tokens reales** siempre que el proveedor los devuelva (el meter ya "reusa el
   usage del proveedor cuando el envelope coincide"; en el fork, activar y registrar
   `provider usage`); corregir el umbral con tokenización real de DeepSeek en lugar de
   `len/4`.
2. **Umbral con margen:** compactar a ~60–70% (no 80%) y *en idle*; el margen evita que un
   turno largo cruce el límite real del proveedor en medio del trabajo.
3. **Compactación proactiva barata primero:** A (prune) en cada pre-step cuando la sesión
   supere ~30–40% del contexto; B nunca se toca; C se mantiene siempre.
4. **Límite por tarea:** máximo 1 compactación automática por tarea/episodio abierto; si tras
   A+B+C+D la presión sigue por encima, **devolver un error claro** ("esta tarea excede el
   contexto; ciérrala y continúa en un hilo nuevo") en lugar de volver a resumir el resumen.
5. **Idle/time-based:** compactar episodios cerrados cuando el agente está idle o al empezar
   una tarea nueva, no entre tool steps de la misma tarea.
6. **Overflow real:** A → evictar episodios cerrados → y *solo entonces* resumir; nunca
   `retainTokens=0`.

### 3.4 Formato del resumen para DeepSeek (qué debe preservar y cómo)

La plantilla del harness ya es razonable (8 secciones, `lib/index.js:220-255`) pero **no es
suficiente** para el flujo ABACO y para los puntos débiles de un LLM al resumir. Cambios
concretos de plantilla (instrucción de sistema del summarizer y/o texto de la instrucción):

1. **Identidad/instrucciones del agente** → nunca se resumen: viven en `C.identity` (inyectado
   aparte). El resumen **no debe** reescribir el system prompt (el harness tampoco puede
   compactarlo: `dsh-compaction/README.md` "An envelope that alone approaches the window is
   not surface-compaction work").
2. **Tareas en curso / estado** → prohibido parafrasear: se copia de `C.tasks`/`C.decisions`.
   El resumen solo cubre *episodios terminados*.
3. **Preferencias del usuario / correcciones** → "quote verbatim" obligatorio; DeepSeek tiende
   a generalizar ("user prefers…") perdiendo el matiz; exigir lista de citas textuales.
4. **Hechos clave** → listas con backticks: `path:línea`, ids, comandos, cifras, errores
   exactos. Regla explícita: *si un hecho no cabe, muévelo al log de recall en vez de
   omitirlo en silencio* (el summarizer puede marcar `(recall: <nodo-seq>)`).
5. **Formato de salida** (si la tarea lo exige: "reporta con URLs", JSON schema) → línea exacta
   en `C.output_format`, no en prosa.
6. **Instrucciones para el próximo turno** → la sección "Next Step" debe ser *una acción
   ejecutable concreta* (tool call esperada, archivo, criterio de terminación), no "continuar".
7. **Mecánica anti-drift:** output máximo mayor (config `maxTokens` del summarizer, p. ej.
   16k), desactivar/limitar el razonamiento en la llamada de resumen si consume presupuesto
   (purpose `compaction`), y **validar estructura** (secciones presentes, sin "(none)" donde
   haya contenido; si la salida se trunca → reintentar con chunk más pequeño, no fallar).
8. **Idioma/modo:** DeepSeek responde bien a bullets densas y JSON frontmatter; usar la
   plantilla del harness (Markdown) pero con **frontmatter YAML corto** (task ids, decisiones
   ids, fechas) + cuerpo de bullets; mantener el `<compacted-summary>` tag para que el
   consumidor (y la UI) lo reconozca.

### 3.5 Punto de integración en el harness (sin tocar npm packages)

El contrato `@deepseek-ai/dsh-compaction` define `CompactionEngine` con tres operaciones
(`compactIfNeeded` / `compactNow` / `compactRegion`) y `dsh-compaction-basic` expone
**`summarize()` como único hook de subclase** ("summarize() is the sole subclass hook",
README y `lib/index.js:842-846`). Por tanto:

- **Opción 1 (rápida):** subclase de `BasicCompactionEngine` en un plugin propio del fork que
  sobrescriba `summarize()` (plantilla nueva, maxTokens mayor, sin razonamiento) y ajuste
  política (`resolveConfig` vía su `Config`), manteniendo toda la transacción durable
  (bracket, eventos, replace) intacta.
- **Opción 2 (completa):** implementar `CompactionEngine` propio (selección por episodios,
  prune siempre, estado vivo, recall), montado como servicio `ctx.compaction` en el perfil del
  fork (`build/dsh-desktop.patch.yml`, patrón ya usado por `abaco-theme`/`abaco-brand`/etc. y
  `dsh-desktop-*`). No se modifica ningún paquete publicado: el fork ya aplica la estrategia
  patches+plugins (sin patches sobre `dsh-compaction*` hoy).

---

## 4. Plan de implementación por fases

Regla general: **no modificar los paquetes `@deepseek-ai/*` publicados**; cambios de
comportamiento vía (a) configuración del plugin en el perfil, (b) plugins propios que
extienden/implementan el contrato, (c) `core/compaction` Python para su propio feature.

| Fase | Qué se hace | Archivos a tocar | Criterio de salida |
|---|---|---|---|
| **0. Telemetría** (1–2 d) | Registrar en cada compactación: disparo, tokens medidos vs reales (provider usage), tamaño del span, ratio de compresión, salida truncada, nº de reintentos, tamaño del checkpoint. Capturar sesiones reales de workers (search/web_extract) como corpus. | fork: plugin de logging en `desktop/src/dsh-desktop/src/…` o `build/dsh-desktop.patch.yml`; `core/compaction/events.py` (extender payload `system.compaction.completed`); `docs/` | Visibilidad de cuándo/por qué se compacta; corpus de N≥10 sesiones reales guardado |
| **1. Config inmediata (sin código nuevo en el motor)** | Montar `dsh-compaction-tool-result-pruner` (o plugin equivalente) **siempre**; subir `retainTokens` absoluto (48–64k) y bajar umbral (0.6–0.7) por modelo vía `modelPolicies`; `maxTokens` de resumen a 16k; si la tarea es crítica, `auto:false` temporal. | perfil del fork (filas del plugin en `build/dsh-desktop.patch.yml` o config del app profile); ninguna línea de npm packages | Reproducción del "compact twice useless" reducida a simple vista en 1 sesión larga |
| **2. Plugin de compactación propio (núcleo)** | Subclase de `BasicCompactionEngine` (hook `summarize()`): plantilla DeepSeek de 3.4; sin razonamiento en la llamada; `maxTokens` 16k; fallo = chunk menor en vez de error. Después `CompactionEngine` completo: selección por episodios, prune siempre-on, no compactar turno abierto, límite de 1 compactación/tarea, nunca `retainTokens=0` en overflow (evictar episodios cerrados). | fork: `desktop/src/dsh-desktop/src/…/compaction-abaco/` (nuevo), registro en `build/dsh-desktop.patch.yml`, tests en `desktop/src/dsh-desktop/test/` | Suite de tests del motor propio; sin regresión en flujo normal; 2 compactaciones consecutivas NO degradan (criterios §5) |
| **3. Estado vivo + recall** | Bloque `ESTADO VIVO` (3.2.C): extracción/upsert por el agente (o llamada corta post-turno), reinyección siempre; herramienta `recall` sobre el log crudo; integración con `agents/<id>/memory.jsonl|lessons|reflections` ya existentes (leer al inicio del turno). | fork (plugin de herramientas + instrucción del agente ABACO), `core/compaction/` si se reusa para persistir el bloque | El bloque sobrevive N compactaciones idéntico; recall devuelve detalles exactos de spans compactados |
| **4. core/compaction Python** | (i) `SummaryGenerator` con modo LLM opcional (config `semantic=True`) que genere el resumen estructurado de 3.4 en vez de estadísticas; (ii) `SessionCompactor` con `retainTokens` real y estado vivo; (iii) políticas por tokens con tokenizador de DeepSeek. Conectarlo si algún día alimenta el chat real; hoy queda como servicio de auditoría/archivo + referencia. | `core/compaction/summary_generator.py`, `session_compactor.py`, `models.py`, `policies.py`, `retention.py`, `api.py`, `events.py`, `core/compaction/tests/*` | Tests verdes (71 existentes + nuevos); modo LLM opcional documentado |
| **5. Eval + CI** | Suite de evaluación: golden sessions pre/post compactación (recall de hechos), probe automático post-compactación, métricas de telemetría; correr en CI. | `tests/` del fork y `core/compaction/tests/`; script de eval en `scripts/` | §5 criterios de aceptación cumplidos en 2 modelos (flash/pro) |

---

## 5. Riesgos y cómo medir el éxito ("no degradar")

### 5.1 Riesgos

| Riesgo | Mitigación |
|---|---|
| Pérdida dura irrecuperable si el log crudo se purga | Los eventos shadowed ya persisten (`compaction/*` log-only); mantener retención del log ≥ sesión + política de archivado de `core/compaction`; recall tool como red de seguridad |
| Resumen-de-resumen compuesto (causa principal) | Regla anti: no re-resumir checkpoints previos sin capas; límite de compactaciones por tarea; estado vivo fuera del resumen |
| Cache KV de DeepSeek rota tras cada replace (costo) | La compactación ya replica el prefijo para la llamada de resumen (diseño del harness); el replace invalida desde el primer token reemplazado — aceptar en automático idle, evitar en medio de turno |
| La selección por episodios falla si no hay marcadores claros de tarea | Fallback a límites turn/end + user-message del emisor (rol LEADER/ESTRATEGA en ABACO); si no hay límites, no compactar |
| El agente escribe estado vivo mal/incompleto | Plantilla rígida + validación estructural + extracción automática post-turno (segunda opinión) |
| Coste: llamadas extra de resumen/estado | Solo D usa LLM; A/B/C baratos; resumir en idle; presupuesto por tarea |
| Falsa sensación de éxito (resumen "bonito" pero sin hechos) | Eval recall de exact-strings (§5.2), no calidad percibida del texto |
| Modelo de producción empaquetado desactualizado | Re-empaquetar `ABACO Deep Core.app` desde el fork (ya embarca rc.1); validar en la app real (Abaco Desk) |

### 5.2 Cómo medir que NO se degrada

1. **Recall test por sesión (unitario/CI):** de cada sesión de prueba se extrae una lista
   dorada de exact-strings (paths, cifras, correcciones del usuario, ids, comandos, fragmentos
   de delegación). Tras cada compactación se pregunta al agente (o a un evaluador) por ellos
   y se mide acierto. Objetivo: **≥ 90% recall tras 1 compactación y ≥ 85% tras 2** (hoy,
   con el comportamiento stock, cae muy por debajo).
2. **Probe automático post-compactación:** tras compactar, el sistema hace una llamada corta
   de verificación ("lista 5 hechos clave que debes retener de la tarea") y compara contra el
   estado vivo + resumen; si el probe falla, reintenta con chunk menor o sube el estado a vivo.
3. **Golden trace de tarea ABACO:** ejecutar una tarea tipo (delegación LEADER → investigación
   con search/web_extract → reporte) 3 veces: sin compactar, con compactación stock, con la
   nueva; comparar calidad del reporte final (URLs correctas, sin inventar fuentes, estructura
   pedida) y nº de pasos.
4. **Métricas de telemetría (Fase 0):** compression ratio medio por compactación (objetivo
   ≤ 40:1 por episodio, hoy > 80:1), % de compactaciones truncadas (objetivo 0), % de
   compactaciones en medio de turno (objetivo 0), nº de reintentos de tool tras compactar
   (proxy de "no recuerdo"), nº de "no lo recuerdo/no puedo" en respuestas.
5. **Criterio de aceptación funcional:** ejecutar **dos compactaciones seguidas** sobre una
   sesión larga real y verificar que el agente sigue la tarea en curso sin re-preguntar la
   delegación, sin perder paths/cifras y sin repetir trabajo ya hecho.
6. **Tests del motor (harness):** unit tests de selección de episodios, prune-always, límite
   por tarea, anti-retainTokens=0, y merge con capas; + los 71 tests existentes de
   `core/compaction` intactos.

---

## 6. Evidencia y fuentes

### 6.1 Código del harness (rutas relativas a `abaco-deep-core/desktop/src/dsh-desktop/node_modules/@deepseek-ai/`)

- `dsh-compaction-basic/lib/index.js:15,17` defaults `thresholdRatio=0.8`, `retainRatio=0.16`;
  `:72-76` `maxTokens=8192`, `compactionRetries=1`, `maxOverflowRetries=1`, `auto=true`
  (resueltos en `resolveConfig` `:58-78`; `auto` arma los listeners en el constructor `:767-771`).
- `dsh-compaction-basic/lib/index.js:108-126` (`resolveCompactSpec`) presupuestos de tokens.
- `dsh-compaction-basic/lib/index.js:381-403` (`selectCompactableRange`) selección posicional head-anchored + balance de pares tool.
- `dsh-compaction-basic/lib/index.js:220-255` instrucción de compactación (8 secciones + reglas + merge de checkpoint previo en `:254`); `:211-212,257,324-336` tags `<compacted-summary>` y preámbulo.
- `dsh-compaction-basic/lib/index.js:269-318` llamada LLM de resumen (replay prefix, `purpose:"compaction"`, cap `maxTokens`); `:346-350` error `MAX_TOKENS` por truncamiento.
- `dsh-compaction-basic/lib/index.js:555-559` el resumen debe ser menor que el span; `:586-633` reemplazo por un único `user/message`; `:651-659` construcción del input.
- `dsh-compaction-basic/lib/index.js:782-795` disparo automático en `agent/pre-step`; `:804-830` recuperación de `CONTEXT_WINDOW_EXCEEDED`; `:875` y `:935` `retainTokens=0` en overflow/manual; `:891-903` reintentos.
- `dsh-compaction-basic/lib/index.js:842-846` hook `summarize()` subclaseable; README del paquete: filosofía, tablas de config, "summarize() is the sole subclass hook".
- `dsh-compaction-tool-result-pruner/lib/index.js:8-14` defaults de pruning (`thresholdChars=8192`, `head=4096`, `tail=1024`, marcador); `:137-194` `pruneSession` solo sobre `tool/result`.
- `dsh-token-meter/lib/types/estimate.js` heurística `CHARS_PER_TOKEN=4`, `BLOCK_OVERHEAD=4`, `ROLE_OVERHEAD=4`; README del paquete: "CJK text and JSON schemas underprice badly at four characters per token".
- `dsh-llm-deepseek/lib/index.js:1378` `DEFAULT_CONTEXT_WINDOW = 1e6`; `:1829-1847` modelos `deepseek-v4-flash`/`deepseek-v4-pro`.
- `dsh-compaction/README.md` contrato: surface events, `compaction/*` log-only, reemplazo en `user/message`, límites ("cannot split one indivisible unit… cannot shrink system/tools/prefix").
- Fork: `desktop/src/dsh-desktop/package.json:129-131` (tgz 0.1.2-rc.1); `patches/` sin parches de `dsh-compaction*`; `build/dsh-desktop.patch.yml` sin configuración de compactación; paquetes empaquetados `/Applications/ABACO Deep Core.app` (rc.1) y `/Applications/DSH Desktop.app` (alpha.1).

### 6.2 `core/compaction` (propio)

- `core/compaction/README.md:6-15` objetivos; `:122-134` limitaciones (sumario determinista sin LLM).
- `core/compaction/summary_generator.py:1-25,185-246` resumen estadístico de sesiones (roles/tools/errores), no narrativo.
- `core/compaction/session_compactor.py:22-32,49-80` keep_recent + estimación words/0.75.
- `core/compaction/models.py:97-123` `SessionTurn`/`SessionWindowSummary`; `core/compaction/ledger_compactor.py:224-381` y `ticket_compactor.py:165-318` flujo reversible.
- Uso real: grep del repo → `SessionCompactor`/`summarize_session` solo en `core/compaction/**` y tests; no hay consumidor en el loop del agente.
- `docs/COMPACTION.md:112-116` "Próximos pasos: resúmenes semánticos opcionales".

### 6.3 Fuentes web (mejores prácticas)

- Anthropic Engineering — *Effective context engineering for AI agents* (compaction, structured note-taking, subagents; "maximize recall… tune your compaction prompt on complex agent traces"): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude Code docs — *Explore the context window* (qué sobrevive a la compactación, re-lectura de hasta 5 archivos, `/compact focus`, `/rewind … Summarize from here`, `/autocompact`, subagentes): https://code.claude.com/docs/en/context-window
- Anthropic — *Using Claude Code: session management and 1M context*: https://claude.com/blog/using-claude-code-session-management-and-1m-context
- Anthropic — *Context management* (tool result clearing, memory tool): https://www.anthropic.com/news/context-management
- Anthropic Platform docs — *Compaction* (compaction server-side, bloques previos al `compaction` block descartados): https://platform.claude.com/docs/en/build-with-claude/compaction
- LangChain LangMem — *How to Manage Long Context with Summarization* (running summary que se sobrescribe, presupuestos `max_tokens_before_summary`/`max_summary_tokens`): https://langchain-ai.github.io/langmem/guides/summarization/
- Packer et al. — *MemGPT: Towards LLMs as Operating Systems* (tiers de memoria, paging, contexto principal vs almacenamiento): https://arxiv.org/abs/2310.08560
- Trellis research notes sobre internals de Claude Code (3 niveles de compactación, resumen estructurado, placeholders `[Old tool result content cleared]`, merge multi-round con capas "Previously/Newly", trigger >10k tokens, preserve 4 mensajes recientes): https://raw.githubusercontent.com/ronsse/trellis-ai/main/docs/research/compaction-and-agent-patterns.md
- Zylos Research — *Agent Context Compaction for Long-Running Sessions: Techniques and Tradeoffs*: https://zylos.ai/research/2026-04-21-agent-context-compaction-long-running-sessions/
