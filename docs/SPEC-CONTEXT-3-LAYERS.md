# SPEC — Las tres capas de contexto (ABACO DEEP HARNES)

**Estado:** especificación. No describe código existente salvo donde cita `archivo:línea`.
**Alcance:** comportamiento de memoria de contexto del harness de escritorio (`desktop/src/dsh-desktop/`).
**Base:** `main` @ `3ddbe73`.
**Convención de rutas:** `$DSH_NM` = `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai`.
**Verificado vs inferido:** cada afirmación del §2 lleva cita `archivo:línea` (verificado por lectura directa). Todo lo que no se pudo determinar sin ejecutar la app está marcado **[INFERIDO]** o **[NO VERIFICADO]** y trae su método de comprobación.

---

## 0. Requisito del dueño (fuente de verdad)

> Tu chat no guarda cada palabra para siempre en la ventana viva. Hay tres capas.
>
> La primera es la ventana del turno. Ahí entra lo reciente: lo que dijiste, lo que contesté, archivos abiertos, y lo que acabamos de hacer. Esa ventana tiene un tope. Cuando se llena, el sistema resume solo. El resumen se queda. El detalle viejo sale de la ventana viva. Por eso a veces no "recuerdo" una frase exacta de hace muchos turnos, pero sí el hilo.
>
> La segunda es la memoria durable. Lo que conviene que no muera lo guardo ahí: locks, repos, cómo quieres el audio, la cédula, la quincena. Eso no es el chat. Sobrevive aunque el chat se compacte. Por eso puedo retomar el proyecto mañana sin repreguntarte todo.
>
> La tercera es no meter basura en la ventana. Cuando me pidiste investigar Panamá, no abrí yo las veinte páginas. Mandé un agente, él leyó, y me devolvió el corte. Así la ventana mía no se llena de HTML. Yo solo guardo el resultado útil.
>
> Compactar, en corto: el sistema resume lo viejo solo. Yo decido qué pasa a memoria durable. Y delego lo pesado para no saturar. No es magia. Es ventana chica, resumen automático, memoria a propósito, y trabajo afuera cuando el tema es largo.
>
> El compactador que metimos es esa misma idea hecha producto: al noventa por ciento, balas de una línea, el primero pide permiso, y los errores no se resumen.

**Requisito normativo derivado:** 90% de umbral, balas de una línea, primera compactación con permiso, errores nunca resumidos.

---

## 1. Qué es cada capa (producto)

### Capa 1 — Ventana del turno (compactación automática)
Es la ventana viva: mensajes recientes, lecturas de archivos, resultados de tools del turno en curso. Tiene un tope duro (la ventana del modelo). Al acercarse al tope, el sistema resume **solo**, sin preguntar, y sustituye el tramo viejo por un checkpoint. El resumen se queda; el detalle viejo sale. Efecto de producto aceptado explícitamente por el dueño: *"a veces no recuerdo una frase exacta de hace muchos turnos, pero sí el hilo"*.

### Capa 2 — Memoria durable (a propósito)
Lo que no debe morir vive fuera del chat: preferencias, locks, repos, formato de audio, cédula, quincena. Sobrevive a la compactación y al reinicio del proceso. **La decisión de qué entra es del usuario/agente, no del compactador.** Efecto de producto: retomar el proyecto mañana sin repreguntar todo.

### Capa 3 — No meter basura en la ventana (delegación)
El trabajo pesado (leer veinte páginas, parsear HTML) ocurre **fuera** de la ventana principal, en un subagente, y a la ventana solo vuelve el corte útil. La ventana nunca se llena de detalle crudo. Complemento mecánico: *spill* (volcar salidas enormes a disco y dejar una referencia).

Las tres capas son **ortogonales**: 1 es automática y destructiva del detalle; 2 es deliberada y persistente; 3 es preventiva.

---

## 2. Estado actual medido

### 2.1 Capa 1 — ventana del turno

| Hecho | Cita |
|---|---|
| Único motor es el stock | `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml` (fila `compaction-basic`); no existe paquete propio de motor |
| `thresholdRatio` default 0.8 | `$DSH_NM/dsh-compaction-basic/lib/index.js:13` |
| `retainRatio` default 0.16 | `$DSH_NM/dsh-compaction-basic/lib/index.js:15` |
| `maxTokens` default 8192 | `$DSH_NM/dsh-compaction-basic/lib/index.js:70` |
| Se dispara solo desde `agent/pre-step` | `$DSH_NM/dsh-compaction-basic/lib/index.js:781-783` (`compactIfNeeded(agent, "pressure", signal)`) |
| Segundo disparo por overflow | `$DSH_NM/dsh-compaction-basic/lib/index.js:814` (`"context-overflow"`) |

**El preset `abaco` nunca se activó.** El repo lo define con 0.6/0.08/16384:

- `desktop/src/dsh-desktop/packages/abaco-context/presets/abaco/agent.cordis.yml:192-197` — `compaction-basic` con `thresholdRatio: 0.6`, `retainRatio: 0.08`, `maxTokens: 16384`.
- `.../agent.cordis.yml:204-205` — `tool-result-pruner` propio.

**Corrección a la auditoría previa (verificado hoy):**

- El marcador de instalación **no existe**: no hay `$DSH_HOME/.abaco-context-default.json` ni el directorio `$DSH_HOME/.agent-presets/` (ausente por completo). El marcador que el propio preset documenta es `$DSH_HOME/.agent-presets/.abaco-context.json` (`.../agent.cordis.yml:26-29`) y tampoco existe.
- **`settings.yaml` SÍ tiene la clave `agent-presets`**: `$DSH_HOME/settings.yaml:11-12` → `default: cordis`. La auditoría afirmaba que faltaba. La conclusión de fondo no cambia (el preset activo no es `abaco`), pero **la causa sí**: el roster no cae a `standard` por ausencia de clave, cae al preset `cordis` por valor explícito.
- `$DSH_HOME` real = `/Users/a507/Library/Application Support/dsh-desktop/harness` (no `~/.dsh`).

**Conclusión Capa 1:** hoy corre 0.8/0.16/8192 del stock, no la política ABACO, y **0.6 tampoco es el 90% que pide el dueño** (ver §3.A).

### 2.2 Capa 2 — memoria durable

| Hecho | Cita |
|---|---|
| Almacén por ámbitos, escritura atómica | `desktop/src/dsh-desktop/packages/abaco-memory/lib/store.js:13` (journal `audit/memory.jsonl`) |
| Archivo mensual | `.../lib/store.js:14` (`audit/archive/<YYYY-MM>.jsonl`) |
| `maxEntryChars` default 240 | `.../lib/store.js:256` |
| Cap global de render 6000 | `desktop/src/dsh-desktop/packages/abaco-memory/lib/schema.js:55` (`MEMORY_MAX_RENDER_CHARS`) |
| Facetas con `cap`/`ttlDays` | `.../lib/schema.js:83-92` — 10 facetas; `facts` cap 60 / TTL 90d y `tasks` cap 20 / TTL 30d en `:89` y `:91` |
| `source` obligatorio | `.../lib/tools.js:128` (descripción de `abaco_memory_set`) |
| 4 tools | `desktop/src/dsh-desktop/packages/abaco-memory/index.js` + `lib/tools.js` |

**Está VACÍA.** `$DSH_HOME/abaco-memory/` **no existe** (la auditoría decía "0 ficheros"; lo verificado hoy es más fuerte: el directorio no existe). Nunca se escribió un recuerdo. Existe además `packages/abaco-vault/` con almacén propio (`desktop/src/dsh-desktop/build/dsh-desktop.patch.yml:125-126`).

**Conclusión Capa 2:** capacidad construida, **uso cero**. No hay evidencia de que la inyección de system prompt funcione en producción, porque nunca hubo nada que inyectar.

### 2.3 Capa 3 — no meter basura

| Hecho | Cita |
|---|---|
| Spill a temporal, no durable | `$DSH_NM/dsh-spill-local/lib/index.js:35` (`mkdtempSync(join(tmpdir(), …))`) |
| API de escritura | `$DSH_NM/dsh-spill-local/lib/index.js:556` (`saveText`) |
| Política en `tools/post-execute` | `$DSH_NM/dsh-spill-policy/lib/index.js:118` (`spillStore.saveText`) |
| El fork baja el tope a 12000 | `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml:167` (`maxInlineBytes: 12000`) |

**Hueco crítico confirmado:** la salida terminal de un subagente se inserta **verbatim y sin tope** en un `user/message`, y **no pasa por `tools/post-execute`**: `$DSH_NM/dsh-subagent/lib/index.js:1725-1742` (`...terminal.output` en `:1729` y `:1735`). Solo `abaco-vault` acota algo (>12000 bytes).

**Conclusión Capa 3:** la delegación existe; la **protección del retorno** no. El subagente puede devolver 200 KB y entran completos a la ventana viva.

### 2.4 Estado de los 4 principios

| Principio | Estado | Evidencia |
|---|---|---|
| **A** 90% | **NO CUMPLIDO** | corre 0.8 (`:13`); el preset ABACO dice 0.6 (`agent.cordis.yml:195`) y no está montado |
| **B** balas de una línea | **PARCIAL** | el stock ya lo pide en `$DSH_NM/dsh-compaction-basic/lib/index.js:221` ("Use terse bullets, not prose paragraphs") |
| **C** primer permiso | **NO IMPLEMENTADO** | ninguna rama ni servicio de aprobación en el camino de compactación |
| **D** errores literales | **NO IMPLEMENTADO** | el pruner **no lee `isError`**: 0 ocurrencias en `$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js`; el campo existe en `$DSH_NM/dsh-llm/lib/types/message.js:78` |

---

## 3. Especificación de los principios A/B/C/D

### 3.A — Disparo automático al 90% de la ventana

**Comportamiento exigido.** Al alcanzar el 90% de la ventana del modelo enrutado, el sistema compacta sin intervención del usuario. Por debajo del 90%, no compacta.

**Estado.** Corre 0.8, no 0.9. Dos fuentes de configuración en conflicto: el stock (`:13`) y el preset ABACO, que pide **0.6** (`agent.cordis.yml:195`) — más agresivo que el requisito.

**Decisión requerida (bloqueante).** El requisito del dueño dice 90%. El preset dice 60%. **No se puede cumplir ambos.** Propuesta normativa: `thresholdRatio: 0.9` en la fila `compaction-basic` del preset `abaco`, y dejar 0.6 documentado como valor descartado. Si el dueño prefiere 60%, esta spec debe enmendarse antes de implementar.

**Punto de enganche.** La fila `compaction-basic` de la composición (`agent.cordis.yml:192-197`), o la fila equivalente del host si se opta por política global. **No** se añade fila nueva: `compaction` ya está registrado y un segundo registro del mismo servicio en el mismo realm lanza error.

**Qué crear/modificar.** (1) Valor `thresholdRatio: 0.9` donde el preset activo lo lea. (2) La activación real del preset: crear `$DSH_HOME/.agent-presets/` + marcador, o cambiar `$DSH_HOME/settings.yaml:11-12` a `default: abaco` — **decisión de producto**, porque `default` afecta a toda sesión nueva.

**Restricción de validación.** `retainTokens` debe cumplir `retainTokens < thresholdRatio * contextWindow` (`$DSH_NM/dsh-compaction-basic/lib/index.js:105-113`); el preset usa ratios precisamente para no violarla (`agent.cordis.yml:19-24`). Cualquier cambio debe mantener ratios.

**Verificación observable.** Con telemetría de fase 0: traza por sesión con `tokensBefore`, `contextWindow`, `ratio = tokensBefore/contextWindow` y `thresholdRatio` efectivo. **Criterio:** en una sesión que cruce el 90%, existe exactamente 1 evento de disparo y su `ratio` está en `[0.9, umbral_de_overflow)`; ninguna sesión que se quede en 0.85 dispara. Sin fase 0, la comprobación es **[NO VERIFICADO]** (requiere ejecutar la app).

### 3.B — Resumen en balas de una línea

**Comportamiento exigido.** Todo checkpoint se emite como balas densas de una línea por sección; nunca prosa.

**Estado.** El stock ya lo instruye (`$DSH_NM/dsh-compaction-basic/lib/index.js:221`) **pero se contradice** en `:248` ("Write concise English engineering prose"). La contradicción está en el mismo prompt y es la causa probable de que salga prosa.

**Punto de enganche.** El prompt de compactación (`COMPACTION_INSTRUCTION`, `$DSH_NM/dsh-compaction-basic/lib/index.js:219-252`), vía plantilla propia en el motor de fase 3, o parche puntual si se hace antes.

**Qué crear/modificar.** Eliminar la instrucción de prosa de `:248` conservando su parte útil (preservar rutas, comandos, errores, identificadores, valores numéricos) y reformularla como regla de bala. Plantilla propia en fase 3.

**Verificación observable.** Test automático sobre la salida del compactador: (1) ninguna sección contiene un párrafo > 200 caracteres sin salto; (2) toda línea no vacía de cada sección empieza por `- ` (o es encabezado `## `); (3) se preservan los literales exigidos. **Criterio:** 0 violaciones en N=10 checkpoints. Es verificable sin juicio humano — es un parser, no una opinión.

### 3.C — La primera compactación pide permiso

**Comportamiento exigido.** La **primera** compactación de una sesión no ocurre sin consentimiento explícito del usuario. A partir de la segunda en adelante, el sistema compacta solo (como hoy).

**Estado.** No implementado en ninguna parte (ni stock ni ABACO).

**Punto de enganche.** Antes de la llamada en `$DSH_NM/dsh-compaction-basic/lib/index.js:781-783`: el listener de `agent/pre-step` es el único camino de presión. Un motor propio (fase 3) puede envolver `compactIfNeeded`. **Alternativa de bajo coste:** interceptar en el punto donde ya se consulta el pruner por `ctx.get` (`:868`), para no duplicar el registro del servicio `compaction`.

**Estado a persistir.** Necesita un flag por sesión ("ya se pidió permiso / ya se autorizó"), que debe sobrevivir a la compactación misma. **Candidato natural: capa 2** (memoria durable, ámbito `session`) — cierra el círculo entre capas y evita inventar otro almacén.

**Qué crear/modificar.** Mecanismo de aprobación + flag por sesión + política "solo la primera". El servicio exacto de aprobación **no lo he verificado** (§7) y debe confirmarse antes de escribir código.

**Verificación observable.** En una sesión nueva, al cruzar el 90%: (a) aparece una solicitud de permiso visible; (b) si el usuario **rechaza**, no se emite checkpoint y la conversación conserva el detalle íntegro; (c) si **acepta**, se emite 1 checkpoint; (d) al cruzar de nuevo el 90% en la misma sesión, **no** vuelve a pedir y compacta solo. **Criterio:** los 4 casos, en ese orden, en la misma sesión. Nótese que (b) exige manejar el rechazo sin romper el bucle de presión: si el rechazo se ignora y se reintenta en el siguiente pre-step, el sistema se convierte en un bucle de peticiones — riesgo R4.

### 3.D — Los errores NUNCA se resumen

**Comportamiento exigido.** El texto de un resultado de tool con `isError` verdadero se preserva **literal** y completo: no se trunca en el pruner y no se reescribe en el checkpoint. Un error es evidencia; parafrasearlo destruye la depuración.

**Estado.** No implementado. El pruner **nunca lee `isError`** (`$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js:141` — `pruneSession`), aunque el campo existe (`$DSH_NM/dsh-llm/lib/types/message.js:78`). Hoy los errores se truncan y el LLM los resume como una bala más.

**Punto de enganche (dos sitios, ambos necesarios).**
1. **Truncado mecánico:** `pruneSession`, `$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js:136-150`. Se invoca desde el motor vía `ctx.get("toolResultPruner")` en `$DSH_NM/dsh-compaction-basic/lib/index.js:868-885`. Añadir guarda: si `event.data.message.content[0].isError === true`, no truncar.
2. **Reescritura por LLM:** el prompt de compactación (`:219-252`), cuya sección "Errors and Fixes" hoy invita a condensar. Debe exigir transcripción literal del mensaje de error.

**Qué crear/modificar.** Guarda `isError` en el pruner (parche del fork o subclase propia en fase 3) + regla literal en la plantilla. **Ojo:** una guarda en el pruner del stock solo cubre la ruta del motor; si el error entra por el camino de overflow (`:814`), hay que verificarlo por separado.

**Verificación observable.** Test determinista: sesión sintética con una tool que devuelve un error de cadena conocida (> thresholdChars, p. ej. 9000 caracteres con un marcador único en el carácter 8500). Tras forzar la compactación, el marcador **sigue presente** en la sesión y el texto del error es byte-idéntico. **Criterio:** el marcador del carácter 8500 aparece; y en el test gemelo con `isError: false`, ese mismo marcador **desaparece** (prueba de que la guarda discrimina y no simplemente desactiva el pruner).

---

## 4. Diseño de las fases pendientes

Origen: `docs/PLAN-TRABAJO.md:85-90` y `:126-129`.

### Fase 0 — Telemetría (`abaco-observability`)
**Problema.** El paquete **no existe** (no figura en `desktop/src/dsh-desktop/packages/`). Hoy es imposible demostrar que una compactación ocurrió, cuándo, con qué ratio, ni cuánto se truncó.

**Diseño.** Paquete nuevo que emite JSONL append-only con eventos de: disparo de compactación (`trigger`, `tokensBefore`, `contextWindow`, `thresholdRatio`, `retainRatio`, `checkpointChars`), truncado del pruner (`bytesBefore/After`, `isError`, `tool`), spilleo (`bytesSpilled`, ruta) y **retorno de subagente** (`bytes`, truncado sí/no).

**Registro (tres sitios, obligatorio).** (1) fila en `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml` (patrón en `:111-126`); (2) dependencia en `desktop/src/dsh-desktop/patches/@deepseek-ai+dsh+0.1.2-rc.1.patch:22-23`; (3) `packages/<pkg>` en `desktop/src/dsh-desktop/package.json:285-287`.

**Criterio de aceptación.** Tras una sesión que fuerce ≥1 compactación, ≥1 truncado y ≥1 delegación: el JSONL contiene ≥3 eventos con los campos arriba, cada uno con `sessionId` y timestamp, y **cero** necesidad de abrir el código para saber qué pasó.

### Fase 3 — Motor de compactación propio
**Diseño.** Subclase de `BasicCompactionEngine` en `abaco-context`, con tres invariantes: (i) **nunca** compactar con turno abierto; (ii) **máximo 1** compactación por tarea; (iii) plantilla de resumen propia (principio B) y sin `retainTokens=0` en overflow.

**Restricción Cordis (crítica).** El motor propio debe **sustituir** la fila `compaction-basic`, no añadirse: registrar un segundo servicio con el mismo nombre en el mismo realm lanza error. `compaction` ya está registrado.

**Restricción Cordis (efectos).** El retorno de `apply` solo admite función o `undefined`: `$DSH_NM/cordis/lib/index.js:1139-1165` (`throw new TypeError("Invalid effect")`). Una promesa que resuelva a objeto **tumba el árbol entero** (precedente: Safe Mode, arreglado en `3ddbe73`).

**Criterio de aceptación.** (a) La app arranca sin Safe Mode y `compaction` sigue resolviendo a un único proveedor; (b) en una sesión con turno abierto, la compactación se **posterga** y ocurre al cerrar el turno, no en medio; (c) en una tarea larga que cruce el umbral 3 veces, el telemetraje de fase 0 muestra **exactamente 1** compactación por tarea.

### Fase 5 — Recall (`context_recall`) sobre el vault + eval + CI
**Diseño.** Tool `context_recall` que consulta `vault/index.jsonl` y devuelve el corte relevante — es el principio de capa 3 aplicado a la memoria: traer el fragmento, no el documento. Eval con sesiones doradas + job de CI.

**Criterio de aceptación.** Sobre N sesiones doradas con pregunta y respuesta esperada, `context_recall` recupera el artefacto correcto en ≥ X% (X a fijar por el dueño; propuesta: 80%) **y** el coste medio en caracteres inyectados es ≤ 10% del coste de leer el documento completo. CI falla si baja del umbral.

### Fase 6 — Consolidación con LLM + UI `/memory`
**Diseño.** Consolidación opcional (fusionar duplicados, promover `facts`→`decisions`) + sección de UI en `settings.section` + comando `/memory`.

**Criterio de aceptación.** Desde la UI se ven, editan y borran entradas reales de `$DSH_HOME/abaco-memory/`; `/memory` lista lo inyectado en el prompt actual; tras una consolidación, el nº de entradas baja y ninguna entrada con `source: user` desaparece (hoy `source: user` siempre gana y nunca se poda — `desktop/src/dsh-desktop/packages/abaco-memory/lib/tools.js:128`).

---

## 5. Orden de implementación

| # | Fase / principio | Justificación |
|---|---|---|
| 1 | **Fase 0 — telemetría** | Sin telemetría ningún otro cambio es demostrable: no se puede probar A (ratio real), B (nº de violaciones), C (rechazo respetado) ni D (marcador preservado). Es el andamio de verificación de todo lo demás. |
| 2 | **Principio D** | El más barato y determinista de los cuatro: una guarda booleana sobre un campo que ya existe (`isError`) en un único punto de truncado. Sin dependencia de UI ni de permisos. |
| 3 | **Principio C** | Barato en lógica (una rama + un flag), pero **caro en integración**: depende del servicio de aprobación y debe persistir el flag sobreviviendo a la compactación. Requiere decisión de dónde vive el flag. |
| 4 | **Principio A** | Es un valor de configuración, pero está **bloqueado por una decisión de producto** (90% vs 60% del preset) y por la activación del preset, que altera el default de toda sesión nueva. No debe hacerse antes de que la telemetría mida el estado actual, o se pierde la línea base. |
| 5 | **Fase 3 — motor propio** | Es el contenedor natural de B y de las invariantes (1 por tarea, sin turno abierto). Hacerlo antes obliga a escribir dos veces las guardas de C y D. |
| 6 | **Principio B** | Necesita plantilla propia: en fase 3 es una edición de texto limpia; antes sería un parche al stock que se pierde en la próxima actualización. |
| 7 | **Fase 5 — recall** | Aporta valor nuevo (no corrige un defecto) y depende de que el vault tenga contenido indexado. |
| 8 | **Fase 6 — consolidación + UI** | Lo último: sin datos reales en memoria (hoy **cero** entradas) no hay nada que consolidar ni que mostrar. Antes hay que garantizar que algo se escribe. |

**Nota sobre el orden.** Hay una tentación de hacer A primero por ser "una línea". Se descarta: A **cambia el comportamiento por defecto de toda sesión nueva** y hoy no hay instrumento para saber si empeora. La regla es: primero medir, luego las guardas deterministas (D), luego las de proceso (C), y solo entonces mover umbrales (A).

**Trabajo paralelizable:** D y la activación de capa 2 (que hoy tiene **cero uso**) no dependen de A ni de C. Forzar al menos un recuerdo real en `$DSH_HOME/abaco-memory/` es un requisito previo de fase 6 y puede hacerse en cualquier momento.

---

## 6. Riesgos

| # | Riesgo | Síntoma observable |
|---|---|---|
| R1 | **Efecto inválido en Cordis tumba el árbol** — un `apply` que devuelva promesa/objeto | La app cae a **Safe Mode** al arrancar; el plugin nuevo no monta y los demás desaparecen. Precedente: `3ddbe73`. Síntoma: mismo fallo que ya ocurrió con `abaco-context`. |
| R2 | **Doble registro del servicio `compaction`** | Error de arranque por servicio duplicado; la compactación deja de funcionar **entera** (ni stock ni propio). Síntoma: ninguna compactación ocurre y la ventana desborda hasta el overflow. |
| R3 | **Leer un servicio no declarado en `inject`** | Excepción al cargar el plugin. Síntoma: el plugin no aparece en el roster; la telemetría (o el motor) simplemente no emite nada. |
| R4 | **Bucle de peticiones de permiso (C)** — el rechazo no detiene el reintento | El usuario ve la solicitud de permiso **repetida en cada turno** y la sesión se vuelve inusable. Síntoma: N solicitudes para 1 sesión, en vez de 1. |
| R5 | **Config de presión inválida** — `retainTokens ≥ thresholdRatio × contextWindow` | `TargetPressureConfigError` que **solo registra un warning** (`$DSH_NM/dsh-compaction-basic/lib/index.js:105-113`): la compactación se desactiva **en silencio**. Síntoma: sesiones larguísimas sin un solo checkpoint y ningún error visible en la UI. |
| R6 | **Salida de subagente sin tope** (hueco de §2.3) | La ventana viva se llena de golpe tras una delegación (`$DSH_NM/dsh-subagent/lib/index.js:1725-1742`, sin paso por `tools/post-execute`). Síntoma: salto brusco de uso de contexto seguido de compactación inmediata, o fallo por overflow. |
| R7 | **Spill no durable** (`mkdtempSync(tmpdir())`, `$DSH_NM/dsh-spill-local/lib/index.js:35`) | Tras reiniciar, las referencias de spill apuntan a ficheros **borrados** por el SO. Síntoma: el agente cita una ruta que ya no existe. |
| R8 | **Errores preservados literalmente inflan el contexto (D)** | Al no truncar errores, un error de 9000 caracteres se conserva entero. Síntoma: la ventana se llena más rápido y A dispara antes; contrapresión legítima que debe medirse con fase 0, no resolverse desactivando D. |
| R9 | **Duplicar la política en dos sitios** (`settings.yaml:11-12` y el preset `abaco`) | Cambiar el umbral en un sitio y no en el otro produce un comportamiento que no coincide con la configuración visible. Síntoma: el ratio medido no corresponde al valor editado. |
| R10 | **Regresión al actualizar el motor** — el preset es copia verbatim de `standard` (`agent.cordis.yml:16-17`) | Un upgrade del harness introduce filas nuevas en `standard` que el preset `abaco` no tiene. Síntoma: una capacidad del harness "desaparece" solo en modo ABACO. |

---

## 7. Verificado, inferido y no verificado

**Verificado por lectura directa (con cita):** todo el §2, incluidos los tres sitios de registro (`build/dsh-desktop.patch.yml:111-126`, `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch:22-23`, `package.json:285-287`), la regla de efectos de Cordis (`$DSH_NM/cordis/lib/index.js:1139-1165`), la ausencia de `isError` en el pruner, y el camino de invocación `pruner.pruneSession` desde el motor (`$DSH_NM/dsh-compaction-basic/lib/index.js:868-885`).

**Correcciones a la auditoría recibida:** (1) `settings.yaml` **sí** contiene `agent-presets` (`:11-12`, `default: cordis`); (2) `$DSH_HOME/abaco-memory/` no existe como directorio (no es "0 ficheros"); (3) `$DSH_HOME` real es `…/dsh-desktop/harness`, no `~/.dsh`; (4) el marcador documentado por el propio preset es `.agent-presets/.abaco-context.json`, no `.abaco-context-default.json` — **ambos ausentes**, y `$DSH_HOME/.agent-presets/` no existe.

**[INFERIDO]:** que la causa principal de la prosa en los checkpoints sea la línea `:248`; que el flag de C deba vivir en capa 2; que R5 sea la explicación de sesiones largas sin compactar en el pasado.

**[NO VERIFICADO — requiere ejecutar la app]:** (a) el servicio exacto del stack de aprobación y su API (`ctx.get(...)` / nombre en la composición) — **bloqueante para C**; comprobar con `grep` en las composiciones del host y con el Inspect Provider de servicios; (b) si el camino de overflow (`:814`) también pasa por el pruner, o solo el de presión; (c) el `contextWindow` real del modelo enrutado (`deepseek-v4-flash`, `$DSH_HOME/settings.yaml:7-10`), necesario para saber a cuántos tokens equivale el 90%; (d) que la inyección de `abaco:durable-memory` funcione de extremo a extremo, dado que nunca hubo una entrada que inyectar; (e) que el preset `abaco` monte correctamente una vez creado el marcador.

**Método de comprobación propuesto para (a)–(e):** arrancar la app con la telemetría de fase 0 instalada, escribir una entrada real vía `abaco_memory_set`, y observar el system prompt ensamblado; para (a), inspeccionar los servicios del realm con el Inspect Provider antes de escribir código.

---

## 8. Restricciones de Cordis que condicionan el diseño

1. **El retorno de `apply` es un effect.** Solo función o `undefined`; cualquier otra cosa lanza `TypeError: Invalid effect` (`$DSH_NM/cordis/lib/index.js:1139-1165`) y tumba el árbol completo. Precedente real: `3ddbe73`.
2. **Un servicio por nombre y realm.** El motor propio **sustituye** la fila; no se añade.
3. **Leer un servicio no declarado en `inject` lanza.** La telemetría debe declarar sus dependencias.
4. **Tres sitios por paquete nuevo:** fila en `build/dsh-desktop.patch.yml`, dependencia en el parche de `@deepseek-ai+dsh`, y `packages/<pkg>` en `package.json`.
5. **Todo efecto debe ser reversible:** timers, listeners y registros pertenecen al Fiber; usar `ctx.effect()` / `ctx.on()` para que stop y update limpien.

---

## 9. Resumen ejecutivo

| Capa | Construido | En uso | Falta |
|---|---|---|---|
| 1 — ventana | Sí (stock) | Sí, con política equivocada (0.8, no 0.9) | Activar preset + decidir 90% vs 60% + motor propio (fase 3) |
| 2 — memoria durable | Sí | **No — cero entradas** | Uso real, luego consolidación y UI (fase 6) |
| 3 — delegación | Parcial | Parcial | Tope al retorno de subagente; recall (fase 5) |

**Los cuatro principios, en una línea:** A no se cumple (corre 0.8 y el preset dice 0.6); B lo pide el stock pero se contradice consigo mismo; C no existe; D no existe y el pruner ignora `isError`.
