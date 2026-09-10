# SPEC — Las tres capas de contexto (ABACO DEEP HARNES)

**Estado:** especificación. No describe código existente salvo donde cita `archivo:línea`.
**Alcance:** comportamiento de memoria de contexto del harness de escritorio (`desktop/src/dsh-desktop/`).
**Base:** `main` @ `0553220` (spec original: `3ddbe73`).
**Convención de rutas:** `$DSH_NM` = `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai`.
**Decisión vigente:** el §8 es un **LOCK del dueño**, no una propuesta. Donde el §3 o el §4 digan algo distinto del §8, **manda el §8** (§3 y §4 quedan como estado medido y como diseño de fases, respectivamente).
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

**Requisito normativo derivado:** 90% de umbral, balas de una línea, primera compactación con permiso, errores nunca resumidos. **Fijado como lock en el §8** (0.90 / 0.12 / 8192); este §0 es la cita del dueño, el §8 es el número.

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
| **A** 90% | **NO CUMPLIDO** | corre 0.8 (`:13`); el preset ABACO dice 0.6 (`agent.cordis.yml:195`) y no está montado. Objetivo fijado por el lock **§8**: 0.90 — ni 0.8 ni 0.6 |
| **B** balas de una línea | **PARCIAL** | el stock ya lo pide en `$DSH_NM/dsh-compaction-basic/lib/index.js:221` ("Use terse bullets, not prose paragraphs") |
| **C** primer permiso | **NO IMPLEMENTADO** | ninguna rama ni servicio de aprobación en el camino de compactación |
| **D** errores literales | **NO IMPLEMENTADO** | el pruner **no lee `isError`**: 0 ocurrencias en `$DSH_NM/dsh-compaction-tool-result-pruner/lib/index.js`; el campo existe en `$DSH_NM/dsh-llm/lib/types/message.js:78` |

---

## 3. Especificación de los principios A/B/C/D

### 3.A — Disparo automático al 90% de la ventana

**Comportamiento exigido.** Al alcanzar el 90% de la ventana del modelo enrutado, el sistema compacta sin intervención del usuario. Por debajo del 90%, no compacta.

**Estado.** Corre 0.8, no 0.9. Dos fuentes de configuración en conflicto: el stock (`:13`) y el preset ABACO, que pide **0.6** (`agent.cordis.yml:195`) — más agresivo que el requisito.

**RESUELTO — el lock §8 (antes "decisión requerida, bloqueante").** Esta sección pedía una decisión de producto entre el 90% del dueño y el 60% del preset, y advertía que la spec debía enmendarse antes de implementar. **La decisión ya está tomada y es 0.90 / 0.12 / 8192.** Valores muertos, no candidatos: el `0.80` de fábrica del stock (`:13`), el `0.16` de fábrica (`:15`), y el `0.60 / 0.08 / 16384` del archivo muerto (`agent.cordis.yml:192-197`). El "60%" citado arriba queda como **histórico del archivo muerto**; no es una alternativa viva. Ver §8.1 y §8.9.

**Punto de enganche.** La fila `compaction-basic` de la composición (`agent.cordis.yml:192-197`), o la fila equivalente del host si se opta por política global. **No** se añade fila nueva: `compaction` ya está registrado y un segundo registro del mismo servicio en el mismo realm lanza error.

**Qué crear/modificar.** (1) Valor `thresholdRatio: 0.9` donde el preset activo lo lea. (2) La activación real del preset: crear `$DSH_HOME/.agent-presets/` + marcador, o cambiar `$DSH_HOME/settings.yaml:11-12` a `default: abaco` — **decisión de producto**, porque `default` afecta a toda sesión nueva.

**Restricción de validación.** `retainTokens` debe cumplir `retainTokens < thresholdRatio * contextWindow` (`$DSH_NM/dsh-compaction-basic/lib/index.js:105-113`); el preset usa ratios precisamente para no violarla (`agent.cordis.yml:19-24`). Cualquier cambio debe mantener ratios.

**Verificación observable.** Con telemetría de fase 0, con los nombres de campo que el lock fija en §8.5: por compactación, `used_before`, `used_after`, `thresholdTokens`, `retainTokens` y la ruta del modelo. **Criterio:** en una sesión que cruce el 90%, existe exactamente 1 evento de disparo con `used_before >= thresholdTokens`; ninguna sesión que se quede en 0.85 dispara; y `used_after < used_before` (si no, alerta — §8.5). Sin fase 0, la comprobación es **[NO VERIFICADO]** (requiere ejecutar la app).

### 3.B — Resumen en balas de una línea

**Comportamiento exigido (fijado por el lock §8.3).** Todo checkpoint se emite como balas densas de **una línea** por sección, en orden **FIFO**; nunca prosa, nunca narrativa.

**Estado.** El stock ya lo instruye (`$DSH_NM/dsh-compaction-basic/lib/index.js:221`) **pero se contradice** en `:248` ("Write concise English engineering prose"). La contradicción está en el mismo prompt y es la causa probable de que salga prosa.

**Punto de enganche.** El prompt de compactación (`COMPACTION_INSTRUCTION`, `$DSH_NM/dsh-compaction-basic/lib/index.js:219-252`), vía plantilla propia en el motor de fase 3, o parche puntual si se hace antes.

**Qué crear/modificar.** Eliminar la instrucción de prosa de `:248` conservando su parte útil (preservar rutas, comandos, errores, identificadores, valores numéricos) y reformularla como regla de bala. Plantilla propia en fase 3.

**Verificación observable.** Test automático sobre la salida del compactador: (1) ninguna sección contiene un párrafo > 200 caracteres sin salto; (2) toda línea no vacía de cada sección empieza por `- ` (o es encabezado `## `); (3) se preservan los literales exigidos. **Criterio:** 0 violaciones en N=10 checkpoints. Es verificable sin juicio humano — es un parser, no una opinión.

### 3.C — La primera compactación pide permiso

**Comportamiento exigido (fijado por el lock §8.4).** La **primera** compactación de una sesión no ocurre sin consentimiento explícito del usuario: se pide **confirmación en la UI**. Aceptada, de ahí en adelante es **automática en esa sesión** (o hasta que cambie la preferencia). Y **antes de compactar hay que persistir los hechos importantes a memoria durable** (capa 2), no solo el summary efímero: el resumen es de la ventana y muere con ella; el hecho sobrevive.

**Estado.** No implementado en ninguna parte (ni stock ni ABACO).

**Punto de enganche.** Antes de la llamada en `$DSH_NM/dsh-compaction-basic/lib/index.js:781-783`: el listener de `agent/pre-step` es el único camino de presión. Un motor propio (fase 3) puede envolver `compactIfNeeded`. **Alternativa de bajo coste:** interceptar en el punto donde ya se consulta el pruner por `ctx.get` (`:868`), para no duplicar el registro del servicio `compaction`.

**Estado a persistir.** Necesita un flag por sesión ("ya se pidió permiso / ya se autorizó"), que debe sobrevivir a la compactación misma. **Candidato natural: capa 2** (memoria durable, ámbito `session`) — cierra el círculo entre capas y evita inventar otro almacén.

**Qué crear/modificar.** Mecanismo de aprobación + flag por sesión + política "solo la primera". El servicio exacto de aprobación **no lo he verificado** (§7) y debe confirmarse antes de escribir código.

**Verificación observable.** En una sesión nueva, al cruzar el 90%: (a) aparece una solicitud de permiso visible; (b) si el usuario **rechaza**, no se emite checkpoint y la conversación conserva el detalle íntegro; (c) si **acepta**, se emite 1 checkpoint; (d) al cruzar de nuevo el 90% en la misma sesión, **no** vuelve a pedir y compacta solo. **Criterio:** los 4 casos, en ese orden, en la misma sesión. Nótese que (b) exige manejar el rechazo sin romper el bucle de presión: si el rechazo se ignora y se reintenta en el siguiente pre-step, el sistema se convierte en un bucle de peticiones — riesgo R4.

### 3.D — Los errores NUNCA se resumen

**Comportamiento exigido (fijado por el lock §8.3).** El texto de un resultado de tool con `isError` verdadero se preserva **literal** y completo: no se trunca en el pruner y no se reescribe en el checkpoint. Un error es evidencia; parafrasearlo destruye la depuración. **Los errores nunca se resumen ni se suavizan.**

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

**Diseño.** Paquete nuevo que emite JSONL append-only con eventos de: disparo de compactación (**campos mínimos fijados por el lock §8.5**: `timestamp`, `used_before`, `used_after`, `thresholdTokens`, `retainTokens`, `model route`; se conservan además los diagnósticos `trigger`, `contextWindow`, `thresholdRatio`, `retainRatio`, `checkpointChars`, que no sustituyen a los anteriores), truncado del pruner (`bytesBefore/After`, `isError`, `tool`), spilleo (`bytesSpilled`, ruta) y **retorno de subagente** (`bytes`, truncado sí/no).

**Carga de la policy (requisito del lock).** El evento debe registrar **si la policy cargó o no** (línea `thresholdRatio`/`retainRatio` efectivos en el arranque). Sin ese dato no se puede distinguir "no compactó porque no hizo falta" de "no compactó porque la config no cargó" — que es exactamente la ambigüedad del riesgo R5.

**Dos alertas obligatorias (requisito del lock).** (1) **Alerta si `used_after >= used_before`**: la compactación ocurrió y no liberó ventana. (2) **Alerta si el motor desactiva la compactación** para una ruta — el caso de `TargetPressureConfigError` degradado a warning (§8.7): **nunca silencioso**. Hoy el motor solo escribe una línea de `warn` una vez por `targetKey` (`$DSH_NM/dsh-compaction-basic/lib/index.js:787-791`) y la UI no muestra nada: eso no cumple.

**Registro (tres sitios, obligatorio).** (1) fila en `desktop/src/dsh-desktop/build/dsh-desktop.patch.yml` (patrón en `:111-126`); (2) dependencia en `desktop/src/dsh-desktop/patches/@deepseek-ai+dsh+0.1.2-rc.1.patch:22-23`; (3) `packages/<pkg>` en `desktop/src/dsh-desktop/package.json:285-287`.

**Criterio de aceptación.** Tras una sesión que fuerce ≥1 compactación, ≥1 truncado y ≥1 delegación: el JSONL contiene ≥3 eventos con los campos arriba (**incluida ≥1 compactación real con `used_before`, `used_after`, `thresholdTokens`, `retainTokens` y `model route`** — el criterio de done 4 del lock), cada uno con `sessionId` y timestamp, y **cero** necesidad de abrir el código para saber qué pasó.

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
| 4 | **Principio A** | Es un valor de configuración, y **la decisión de producto ya está tomada por el lock §8** (0.90 / 0.12 / 8192): ya no está bloqueado por "90% vs 60%". Sigue condicionado por la telemetría (línea base) y por la activación del preset, que altera el default de toda sesión nueva. No debe hacerse antes de que la telemetría mida el estado actual, o se pierde la línea base. |
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
| R5 | **Config de presión inválida en runtime** — `retainTokens ≥ thresholdTokens` para el modelo enrutado | **CORREGIDO — ver §8.7.** Es warning-only **solo** por la ruta de capacidad por modelo: `resolveCompactSpec` lanza `TargetPressureConfigError` (`$DSH_NM/dsh-compaction-basic/lib/index.js:108,111`, invocado en `:882`) y el listener de `agent/pre-step` lo captura con `instanceof` (`:786-791`), registra **un** `warn` por `targetKey` y sigue. Síntoma: sesiones larguísimas sin un solo checkpoint, invisible en la UI. |
| R11 | **Config de presión inválida en LOAD — es fatal, no warning** | `validateRatioRetention` (`:132-134`, throw en **`:133`**) lanza un **`Error` normal**, no `TargetPressureConfigError`, desde `resolveConfig` (`:62`, `:64`), que corre en el constructor del motor (`:768`). No lo cubre el `instanceof` de `:786`. El loader lo envuelve en `updateError("apply", …)` (`cordis-plugin-loader/lib/index.js:534`), `Group.update` lo recoge como fallo único y lo **relanza** (`:87-91`) y hace **rollback de todo el grupo** (`:94-112`). Precedente exacto en este repo: `3ddbe73` ("the throw took the whole plugin tree down with it, which is why the app fell back to Safe Mode instead of booting"). Síntoma: la app no arranca / cae a Safe Mode. **Aplica a cualquier `modelPolicies` cuyo `thresholdRatio` quede ≤ `retainRatio` heredado (0.12)** — ver §8.8. |
| R12 | **Span resumido contra presupuesto de resumen** — con el lock, el tramo compactable a 1M es ~780k tokens para un resumen de ≤8192 (≈95:1) | No es un fallo del motor (no hay guarda que relacione `maxTokens` con el aire disponible; `maxTokens` solo se usa como opción del stream en `:296` y se registra en `:313`). Síntoma esperable: resumen que pierde detalle del tramo viejo. Se detecta con la alerta `used_after` de §8.5 y con el criterio de done 5; **no se corrige bajando el umbral sin preguntar** (§8.6.6). |
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

**[NO VERIFICADO — requiere ejecutar la app]:** (a) el servicio exacto del stack de aprobación y su API (`ctx.get(...)` / nombre en la composición) — **bloqueante para C**; comprobar con `grep` en las composiciones del host y con el Inspect Provider de servicios; (b) que la inyección de `abaco:durable-memory` funcione de extremo a extremo, dado que nunca hubo una entrada que inyectar; (c) que el preset `abaco` monte correctamente una vez creado el marcador; (d) que la primera compactación real ocurra y que `used_after < used_before` (criterios de done 3, 4 y 5 del §8.6 — solo se pueden cerrar ejecutando la app con la fase 0 instalada).

**Cerrado desde la revisión anterior (ya no son incógnitas):**
- **El `contextWindow` del modelo enrutado** — **VERIFICADO**: `1_000_000` tokens. Ver §8.8.
- **Si el camino de overflow pasa por el pruner o por la validación de proporción** — **VERIFICADO**: `compactIfNeeded` con `trigger === "context-overflow"` (`$DSH_NM/dsh-compaction-basic/lib/index.js:869-877`) **sí** llama a `prune.pruneSession` (`:871`) pero **nunca** llama a `resolveCompactSpec`: usa `selectCompactableRange(..., 0)` y compacta. Es decir, el overflow **salta** el umbral y la validación de proporción por completo; la conclusión de §3.D se mantiene (hay que verificar aparte la guarda de `isError` en esa ruta).

**Método de comprobación propuesto para (a)–(e):** arrancar la app con la telemetría de fase 0 instalada, escribir una entrada real vía `abaco_memory_set`, y observar el system prompt ensamblado; para (a), inspeccionar los servicios del realm con el Inspect Provider antes de escribir código.

---

## 8. LOCK — Política de compactación (decisión del dueño)

**Estado: BLOQUEADO.** Esta sección **no es una propuesta y no se reinterpreta**. Es la decisión del dueño, transcrita. Cualquier otra sección de este documento que dijera algo distinto sobre el umbral, la retención o el presupuesto de resumen queda subordinada a este §8; las divergencias resueltas están listadas en §8.9.

**Alcance de este lock:** es la **especificación**. La implementación (editar la config real del preset) es una tarea aparte y **no** forma parte de este documento.

### 8.1 La policy (verbatim)

```yaml
thresholdRatio: 0.90   # disparo duro — decisión del dueño; NO 0.80 de fábrica, NO 0.60 del archivo muerto
retainRatio: 0.12      # cola viva verbatim; OBLIGATORIO < thresholdRatio
auto: true
maxTokens: 8192        # presupuesto del LLM de resumen
compactionRetries: 1
maxOverflowRetries: 1
```

| Clave | Valor | Qué es | Dónde vive hoy el valor a matar |
|---|---|---|---|
| `thresholdRatio` | **0.90** | Fracción del window enrutado que dispara | stock `0.8` (`$DSH_NM/dsh-compaction-basic/lib/index.js:13`); preset `0.6` (`agent.cordis.yml:195`) |
| `retainRatio` | **0.12** | Fracción del window que queda **verbatim** | stock `0.16` (`:15`); preset `0.08` (`agent.cordis.yml:196`) |
| `auto` | **true** | Compactación automática entre pasos | ya es el default (`:74`) |
| `maxTokens` | **8192** | Presupuesto del **LLM de resumen** | preset `16384` (`agent.cordis.yml:197`) |
| `compactionRetries` | **1** | Reintentos de la propia compactación | ya es el default (`:71`) |
| `maxOverflowRetries` | **1** | Reintentos en recuperación por overflow | ya es el default (`:72`) |

### 8.2 Qué significa el trigger

- Se **mide** `used / contextWindow` del **modelo enrutado** (no de un modelo fijo).
- **Disparo automático** cuando `used >= floor(contextWindow × 0.90)`.
- La compactación **resume lo viejo** y deja la **cola reciente verbatim = `retainRatio` 0.12 del window**.
- El par de tokens se calcula en `resolveCompactSpec` (`$DSH_NM/dsh-compaction-basic/lib/index.js:109-111`): `thresholdTokens = floor(contextWindow * thresholdRatio)`, `retainTokens = retainRatio === undefined ? policy.retainTokens : floor(contextWindow * retainRatio)`.
- **La proporción es válida**: la propia línea `:111` exige `retainTokens < thresholdTokens`, y 0.12 < 0.90 lo cumple para todo window. ✅

### 8.3 Reglas de protección — qué NUNCA entra al resumen y qué NUNCA se tira

- **FIFO de bullets de una línea.** Nada de narrar en prosa.
- **Proteger siempre** (no compactar / no borrar):
  - el **system prompt**;
  - el **mensaje de usuario actual**;
  - las **últimas 5 vueltas** (user + assistant);
  - **tool calls y tool results en vuelo**;
  - y los **errores**: nunca se resumen **ni se suavizan**.

**Estado medido de estas cinco protecciones en el motor stock** (fase 0 de verificación, §8.6.5):

| Protección | Estado stock | Evidencia / hueco |
|---|---|---|
| system prompt | **Satisfecha estructuralmente** | el system se pasa **aparte** del span (`dsh-compaction-basic/lib/index.js:294`, `...input.system === undefined ? {} : { system: input.system }`); lo compactado son `input.messages` |
| tool calls/results **en vuelo** | **Satisfecha estructuralmente** | `compactRegion` exige fronteras balanceadas: `toolPairingBalancedBefore/After` (`:525-526`, mensaje literal "would split a step, or the step is still open"); la selección también ajusta la frontera (`:393`) |
| **últimas 5 vueltas** | **NO satisfecha** | la cola no es por vueltas sino por tokens: `selectCompactableRange` acumula hasta `retainTokens` (`:379-397`). A 1M eso son **120.000 tokens** de cola, que pueden ser más o menos de 5 vueltas |
| **mensaje de usuario actual** | **No cubierta como regla propia** | se protege de rebote por la frontera balanceada + el tamaño de la cola; no hay guarda explícita "el mensaje en curso no entra" |
| **errores literales** | **NO satisfecha** | ver §3.D: el pruner no lee `isError` |

### 8.4 UX del primer disparo

- La **primera vez que toca compactar en una sesión**, **pedir permiso**: confirmación en la UI.
- Si el dueño **acepta**: de ahí en adelante **automático en esa sesión** (o hasta que cambie la preferencia).
- **Antes de compactar, persistir los hechos importantes a memoria durable** (capa 2) — no solo el summary efímero.

Detalle de implementación y estado: §3.C (hoy **no implementado**; el flag por sesión debe sobrevivir a la compactación).

### 8.5 Fase 0 — telemetría (obligatoria antes de dar por bueno el 90%)

Log visible / **evento por cada compactación** con **como mínimo**:

`timestamp`, `used_before`, `used_after`, `thresholdTokens`, `retainTokens`, `model route`.

Más, explícitamente:

- **si la policy cargó o no**;
- **alerta si `used` no bajó tras compactar**;
- **alerta si el motor desactiva la compactación** — **nunca silencioso**.

Detalle y criterio de aceptación: §4 (Fase 0).

### 8.6 Criterio de done

1. Un solo número vivo en runtime: **0.90** (preset ABACO activado; el `0.80` de fábrica y el `0.60` del archivo muerto quedan **muertos**).
2. `retainRatio 0.12` **validado al boot**.
3. **Confirmación la primera vez** + automático después.
4. La telemetría demuestra **al menos una compactación real** en prueba.
5. Las **reglas de protección** (system / últimas 5 / en vuelo / errores) **verificadas**.
6. **No inventar otro umbral.** Si algo del motor impide 0.90 de forma segura, **reportar el bloqueo con evidencia; no bajar a 0.80 sin preguntar.**

**Estado del criterio 6: NO hay bloqueo.** El motor admite 0.90/0.12 y el aire del window enrutado sobra (§8.8). El único defecto abierto es de **calidad** (span ~780k → resumen ≤8192, R12), no de seguridad, y no autoriza a mover el umbral.

### 8.7 Punto A — ¿la violación de proporción es `throw` o warning que solo registra?

**Respuesta: las dos cosas, y la distinción es crítica.** La afirmación del preset (`packages/abaco-context/presets/abaco/agent.cordis.yml:19-24`: "warning-only ... that only logs") es **correcta para el caso que ese mismo comentario describe** — un `retainTokens` absoluto comparado contra el window de un modelo — y **peligrosamente falsa como afirmación general**, porque la comprobación de proporción **en tiempo de carga no se degrada: es fatal**.

| Camino | Sitio exacto | Tipo de error | ¿Se captura? | Efecto real |
|---|---|---|---|---|
| **Proporción, en LOAD** | `validateRatioRetention` definida en `$DSH_NM/dsh-compaction-basic/lib/index.js:132-134`, **throw en la línea `:133`** | **`Error` normal** (NO `TargetPressureConfigError`) | **NO.** El `instanceof` de `:786` no lo cubre, y ese listener ni siquiera existe todavía durante la construcción | **Fatal** |
| **Capacidad por modelo, en RUNTIME** | `resolveCompactSpec` `:108` y **`:111`**, invocado desde `compactIfNeeded` en `:882` | `TargetPressureConfigError` | **SÍ.** `agent/pre-step` (`:781-792`) captura con `instanceof TargetPressureConfigError` en **`:786`**, registra **un** `warn` por `targetKey` (`warnedPressureConfigTargets`, `:763`, `:787-791`) y hace `next()` | **Warning-only.** Compactación desactivada para esa ruta, con una sola línea de log |
| Sin capacidad de contexto | `:881` | `TargetPressureConfigError` | Igual que el anterior | Warning-only |
| Overflow | `compactIfNeeded` `:815-824` | cualquiera | **SÍ**, pero **sin** el caso especial de `:786` | Warning-only (solo `warn`) |

**Cadena del caso fatal, paso a paso.** `resolveConfig` (`:56`) llama a `validateRatioRetention` en **`:62`** (defaults) y **`:64`** (cada `modelPolicies[i]`). `resolveConfig` se ejecuta en el **constructor** del motor (`:768`), es decir **dentro del body del plugin**. Cuando lanza:

1. el loader lo envuelve: `updateError("apply", this.options, error)` — `cordis-plugin-loader/lib/index.js:534` (y `:493` en el camino de update);
2. la entrada se marca como fallida; `Group.update` recoge los resultados con `Promise.allSettled` (`:87`), filtra los rechazados (`:89`) y **relanza el fallo único** (`:90`) o un `AggregateError` si hay más de uno (`:91`);
3. el `catch` de `:94` **hace rollback de todo el grupo**: elimina las entradas nuevas (`:96-103`) y recrea las viejas (`:104-108`), y **vuelve a lanzar** (`:110`/`:111`).

Es decir: **un throw en la resolución de config de un plugin no tumba solo la entrada del plugin — tumba el árbol entero** y devuelve la app a Safe Mode. **No es inferencia: es el precedente ya registrado en este repo** (`3ddbe73`): *"The loader failed the entry (`failed to apply loader entry abaco-context`) and the throw took the whole plugin tree down with it, which is why the app fell back to Safe Mode instead of booting."*

**¿Aplica a la policy bloqueada 0.90/0.12?** **No.** `validateRatioRetention(0.90, { retainRatio: 0.12 }, …)` evalúa `0.12 >= 0.90` → falso → no lanza. Y como se usan **ratios** (no un `retainTokens` absoluto), `retainTokens` < `thresholdTokens` se cumple para todo window, así que el throw de runtime `:111` es **inalcanzable** con esta policy. La policy del lock es segura en ambos caminos. ✅

**Mitigación (obligatoria para la tarea de implementación):**

1. **Validar la proporción antes de escribir la config** — chequeo estático `retainRatio < thresholdRatio` sobre la fila que se va a escribir, y sobre cada `modelPolicies` **incluyendo la herencia** (ver §8.8). Un valor inválido debe fallar en el repo, no al arrancar la app.
2. **Nunca usar `retainTokens` absoluto.** Un absoluto depende del window del modelo enrutado y puede cruzar `:111` sin que nadie lo note hasta el primer turno largo.
3. **No envolver el constructor a ciegas.** Envolver un `throw` de config en un `try/catch` que lo degrade a warning convertiría un error de configuración en "compactación desactivada en silencio" — exactamente lo que el criterio de done 6 y la telemetría de §8.5 prohíben.
4. **Test que fije la regla**: la fila del preset debe cumplir `retainRatio < thresholdRatio` (valores del lock: `0.12 < 0.90`).

### 8.8 Punto B — ¿el 90% deja aire suficiente para el resumen de 8192 tokens?

**Respuesta: sí, con margen amplio, en la ruta enrutada por defecto.** No hace falta `modelPolicies` hoy.

**El window real del modelo enrutado está declarado en el catálogo del adapter:** `1_000_000` tokens.

| Hecho | Cita |
|---|---|
| `DEFAULT_CONTEXT_WINDOW = 1e6` | `$DSH_NM/dsh-llm-deepseek/lib/index.js:1377` |
| `deepseek-v4-flash` declara `contextWindow: DEFAULT_CONTEXT_WINDOW` | `.../dsh-llm-deepseek/lib/index.js:1826-1832` |
| Default del adapter para cualquier modelo del catálogo | `.../dsh-llm-deepseek/lib/index.js:1870` (`defaultContextWindow`), `:1971` |
| Modelo enrutado por defecto = `deepseek-official/deepseek-v4-flash` | `$DSH_HOME/settings.yaml` sección `agent-default-model`; también `$DSH_NM/dsh-base/cordis.patch.yml:75-79` |
| **Sin override de window en este fork** | `grep -rn "contextWindow\|defaultContextWindow" desktop/src/dsh-desktop/build/` → **0 resultados**; y `settings.yaml` no tiene sección `llm-deepseek` |

**Cálculo al 90%** (`thresholdTokens = floor(window × 0.90)`; aire = `window − thresholdTokens`; presupuesto de resumen = `maxTokens 8192`):

| Window | `thresholdTokens` al 0.90 | **Aire** | ¿Cabe un resumen de 8192? |
|---|---|---|---|
| **1.000.000 (la enrutada)** | **900.000** | **100.000** | **SÍ — 12,2× el presupuesto** |
| 200.000 | 180.000 | 20.000 | SÍ — 2,4× |
| 128.000 | 115.200 | 12.800 | SÍ — 1,56× (justo) |
| 100.000 | 90.000 | 10.000 | SÍ — 1,22× (justo) |
| 81.920 | 73.728 | 8.192 | **Empate exacto** |
| 64.000 | 57.600 | 6.400 | **NO** — falta aire |
| 32.000 | 28.800 | 3.200 | **NO** |
| 16.384 | 14.745 | 1.639 | **NO** |

**Umbral de seguridad:** el 90% con resumen de 8192 solo es seguro si `window × 0.10 > 8192`, es decir **`window > 81.920` tokens**. Por encima de eso, 0.90 deja aire de sobra.

**Nota sobre el 8192 vs el 16384 del archivo muerto.** El comentario del preset descartado (`agent.cordis.yml:188-191`) argumentaba que `8192` trunca resúmenes en spans grandes y por eso subió a 16384. Con el lock, a 1M el tramo a resumir es ≈ `900.000 − 120.000 = 780.000` tokens para un resumen de ≤8192 (≈**95:1**). **Esto es un riesgo de calidad, no de seguridad, y el lock no lo reabre** (R12): se vigila con la alerta `used_after` y con el criterio de done 5, y **no** se corrige bajando el umbral (§8.6.6). Queda constancia del hallazgo, no una propuesta de cambio.

**¿Hace falta `modelPolicies`?** **Hoy no** — la ruta por defecto tiene 1M y sobran 100.000 tokens de aire; el resumen cabe 12 veces. `modelPolicies` **existe y es la herramienta correcta** (`:64`, `:83-98`) si algún día se enruta un modelo de ventana pequeña, pero **como guarda preventiva, no como sustituto del 0.90**:

> **Regla: 0.90 se queda global. `modelPolicies` solo se usa para fijar un valor propio donde 0.90 no quepa, y nunca baja el global sin preguntar.**

**Trampa crítica si se usa `modelPolicies`** (deriva del Punto A): la herencia de retención es por **ratio**, no por modelo. `resolveTargetPolicy` construye `inheritedRetention = { retainRatio: config.retainRatio }` (`:85`) y lo aplica al override (`:92`); luego `resolveConfig` valida **cada** override contra el ratio heredado con `validateRatioRetention(policy.thresholdRatio ?? thresholdRatio, resolveRetention(policy, retention), …)` (`:64`). Consecuencia: **un `modelPolicies` con `thresholdRatio: 0.10` y sin `retainRatio` explícito lanza el `Error` fatal de `:133` al cargar** (0.12 ≥ 0.10) y se lleva el árbol por delante (R11). Un override para ventana pequeña debe:
1. mantener `thresholdRatio > 0.12`, **o**
2. declarar también su propio `retainRatio` menor.

Ejemplo de forma **segura** (ilustrativo, no implementado ni autorizado aquí): bajar `thresholdRatio` a ~0.75 **solo** para un modelo de ventana pequeña, con `retainRatio` explícito por debajo, dejando el global en 0.90.

### 8.9 Divergencias resueltas por este lock

Cambios aplicados en este mismo documento para que no haya dos versiones de la verdad:

| Sección | Decía antes | Dice ahora (a favor del lock) |
|---|---|---|
| Cabecera | Base `3ddbe73` | Base `0553220` + nota de que **el §8 manda** sobre §3 y §4 |
| §2.4 (A) | "NO CUMPLIDO — corre 0.8, preset 0.6" | Igual como **estado medido**, + objetivo fijado por el lock: **0.90, ni 0.8 ni 0.6** |
| §3.A | "**Decisión requerida (bloqueante)**" entre 90% y 60%; "si el dueño prefiere 60%, enmendar" | **RESUELTO**: 0.90/0.12/8192 decidido; 0.80 y 0.60 quedan **muertos**, no candidatos |
| §3.A verificación | `tokensBefore` / `ratio` | Nombres del lock: `used_before`, `used_after`, `thresholdTokens`, `retainTokens`, `model route` |
| §3.B | "balas de una línea, nunca prosa" | + **FIFO** explícito |
| §3.C | "primera pide permiso; de la segunda en adelante, solo" | + **confirmación en UI**, automático **tras aceptar en esa sesión**, y **persistir hechos a memoria durable antes de compactar** |
| §3.D | "errores literales" | + "**nunca se resumen ni se suavizan**" (textual del lock) |
| §4 Fase 0 | campos `tokensBefore`, `checkpointChars`… | **campos mínimos del lock** + **carga de la policy** + **2 alertas obligatorias** (no bajó `used`; motor desactiva compactación) |
| §5 fila 4 | A "bloqueado por decisión de producto (90% vs 60%)" | A **desbloqueado** por el lock; sigue condicionado por la telemetría |
| §6 R5 | `TargetPressureConfigError` "solo registra un warning" | **Corregido**: warning-only **solo** en runtime por capacidad de modelo (`:786`); la proporción en load es **fatal** |
| §6 | (no existía) | **R11** (load fatal) y **R12** (span ~780k vs resumen 8192) añadidos |
| §7 | `contextWindow` en "[NO VERIFICADO]" | **VERIFICADO = 1.000.000**; también cerrado el camino de overflow |
| §9 / §10 | numeradas 8 y 9 | renumeradas (este §8 se inserta) |

---

## 9. Restricciones de Cordis que condicionan el diseño

1. **El retorno de `apply` es un effect.** Solo función o `undefined`; cualquier otra cosa lanza `TypeError: Invalid effect` (`$DSH_NM/cordis/lib/index.js:1139-1165`) y tumba el árbol completo. Precedente real: `3ddbe73`.
2. **Un servicio por nombre y realm.** El motor propio **sustituye** la fila; no se añade.
3. **Leer un servicio no declarado en `inject` lanza.** La telemetría debe declarar sus dependencias.
4. **Tres sitios por paquete nuevo:** fila en `build/dsh-desktop.patch.yml`, dependencia en el parche de `@deepseek-ai+dsh`, y `packages/<pkg>` en `package.json`.
5. **Todo efecto debe ser reversible:** timers, listeners y registros pertenecen al Fiber; usar `ctx.effect()` / `ctx.on()` para que stop y update limpien.
6. **Un throw en la resolución de config es fatal, no un warning.** `resolveConfig` corre en el constructor del motor, dentro del body del plugin: la entrada falla y `Group.update` relanza y hace **rollback de todo el grupo** (`cordis-plugin-loader/lib/index.js:87-112`) → Safe Mode. La proporción se valida **antes** de escribir la config. Detalle y cita de línea: **§8.7 / R11**.

---

## 10. Resumen ejecutivo

| Capa | Construido | En uso | Falta |
|---|---|---|---|
| 1 — ventana | Sí (stock) | Sí, con política equivocada (0.8, no 0.9) | Activar preset + escribir la policy **ya bloqueada** en §8 (0.90/0.12/8192) + motor propio (fase 3) |
| 2 — memoria durable | Sí | **No — cero entradas** | Uso real, luego consolidación y UI (fase 6) |
| 3 — delegación | Parcial | Parcial | Tope al retorno de subagente; recall (fase 5) |

**Los cuatro principios, en una línea:** A no se cumple (corre 0.8; el preset dice 0.6) pero **ya no está bloqueado: el lock §8 fija 0.90**; B lo pide el stock pero se contradice consigo mismo; C no existe; D no existe y el pruner ignora `isError`.

**La decisión, en una línea:** `thresholdRatio 0.90` / `retainRatio 0.12` / `maxTokens 8192`, `auto: true`, 1 reintento de cada tipo; disparo a `used >= floor(window × 0.90)`; bullets FIFO de una línea; se protegen system, mensaje actual, últimas 5 vueltas, tool calls en vuelo y errores literales; la primera compactación de la sesión pide permiso en la UI y luego es automática; **fase 0 primero** (telemetría con `used_before`/`used_after`/`thresholdTokens`/`retainTokens`/`model route`, alerta si no baja `used` y alerta si el motor desactiva la compactación); y **no se inventa otro umbral** — si algo impide el 90% de forma segura, se reporta con evidencia (§8.6.6). Los dos puntos técnicos abiertos quedaron cerrados: la violación de proporción **sí puede tumbar el arranque** (load-time, §8.7/R11) pero **no aplica al 0.90/0.12**; y el window enrutado es **1.000.000**, así que el 90% deja **100.000 tokens de aire** para un resumen de 8192 (§8.8) — **no hace falta `modelPolicies` hoy**.
