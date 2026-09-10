# CRITERIA — Respuesta del colaborador al handoff de contexto de 3 capas

**Qué es este documento.** La respuesta del **arquitecto colaborador** (referencia de memoria de contexto) a las ocho preguntas concretas y a la petición de plan de `docs/HANDOFF-TO-COLLABORATOR.md`. Es **criterio de diseño, no código y no una decisión del dueño**: donde el colaborador y el LOCK del dueño difieran, manda el lock (`docs/SPEC-CONTEXT-3-LAYERS.md` §8). Ver §13 para las divergencias registradas.

**Autoría.** Colaborador Abaco (referencia de memoria de contexto). El texto de §1–§11 es **suyo y verbatim**; los encabezados, la numeración y las notas de contexto son de este repo y **no** alteran su contenido.

**Base de lectura.** `main` @ `612f843` cuando se respondió el handoff; **HEAD se movió a `7936852` durante esta revisión** (`fix(desktop): abaco-context never adopted the ABACO preset…`, que **commitea el arreglo del Bug 2**), y quedó **sin commitear** la fila `compaction-basic` del preset ya cableada a `0.90 / 0.12 / 8192`. Verifica `git log -1` y `git status` antes de dar por vivos los estados que este documento describe como pendientes. Documentos que este criterio toca: `docs/HANDOFF-TO-COLLABORATOR.md` (las preguntas), `docs/SPEC-CONTEXT-3-LAYERS.md` §8 (el LOCK del dueño; §8 manda sobre §3 y §4).

**Cómo leerlo.** El §1–§8 responde, en orden, a las ocho preguntas del §5 del handoff. El §9 es el **plan de encaje ordenado** que se pidió. El §10 son las **trampas** que el colaborador prohíbe. El §11 es lo que **no** se toca. El §12 registra un **punto abierto de orden** entre el colaborador y el integrador de ABACO, sin resolverlo. El §13 reconcilia todo esto con el §8 de la spec.

---

## 1. Números del compactador

*Contexto: respuesta a la pregunta 1 del handoff (§5.1) — los números exactos del compactador del colaborador y qué copiar.*

> 1) Números del compactador: en mi runtime el umbral lo gobierna la plataforma; no expongo un thresholdRatio editable. Por eso el techo a copiar no es "el % que yo edito", sino el comportamiento: dejar llenarse casi todo antes de compactar; cola reciente verbatim siempre; el resto → bullets cortos, no prosa. Para Abaco, con el motor DSH medido, el lock del dueño es el correcto: thresholdRatio 0.90 + retainRatio 0.12. ¿Por qué 0.12? Porque debe ser claramente < 0.90 (si no, TargetPressureConfigError / silencio), y 0.12 ≈ "últimas vueltas + system + mensaje actual + tools en vuelo" en ventanas típicas, sin hinchar la cola. El 0.16 de fábrica es más cola y umbral 0.80; ustedes quieren más ventana útil → suben umbral y bajan un poco la cola. No bajar a 0.80 sin preguntar.

## 2. Qué pasa a memoria durable y cuándo

*Contexto: respuesta a la pregunta 2 (§5.2) — la regla de promoción a la capa 2 y el momento de evaluarla.*

> 2) Qué pasa a memoria durable y cuándo: lo decide el agente, con reglas, no el usuario en cada turno. SÍ durable: hechos que deben sobrevivir otro chat (identidad, locks de producto, IDs, decisiones del dueño, "nunca X"). NO durable: ruido del turno, dumps de tools, marketing, repeticiones. Cuándo escribir: en el momento del hecho, o justo antes de compactar (barrido de "¿qué no puede morir?"). En Abaco: abaco-memory no puede seguir vacía. Protocolo mínimo: al cerrar un hallazgo / al aceptar un lock / pre-compact → set con faceta + TTL si aplica. Sin ese protocolo, la capa 2 es decorado.

## 3. Primera vez pide permiso (Principio C)

*Contexto: respuesta a la pregunta 3 (§5.3), incluido el bucle R4 que el handoff marcaba como riesgo, y la pregunta 4 del §6.3 (dónde vive el flag).*

> 3) Primera vez pide permiso (Principio C): primera presión ≥ umbral en la sesión → UI confirma. Si acepta: auto el resto de la sesión (o hasta que cambie preferencia). Si rechaza: no compactar esa vez. Subir un soft-warn. No repreguntar en bucle cada mensaje. Volver a preguntar solo en la siguiente vez que cruce el umbral (o tras N minutos / próximo "paso de presión"), con opción "nunca auto / siempre preguntar / siempre auto". Nunca compactar en silencio tras un rechazo. Eso es lo que mató a los dos agentes anteriores.

## 4. Degradación en cadena (resumen de resumen)

*Contexto: respuesta a la pregunta 6 (§5.6) — cómo evitar que la décima compactación sea el resumen de un resumen.*

> 4) Degradación en cadena (resumen de resumen) — tres frenos, en orden: (a) extraer a durable antes de resumir (la capa 2 es la verdad; el summary es un índice); (b) summary = FIFO bullets de una línea (decisiones, IDs, estado), no narrativa; un bullet no se "re-resume": se reemplaza o se archiva; (c) consolidación posterior: si hay duda, releer fuente durable / journal, no el summary anidado. No congelar eternamente el primer summary como dogma; sí congelar hechos en memoria y tratar el summary como desechable.

## 5. Errores sobreviven (Principio D)

*Contexto: respuesta a la pregunta 4 (§5.4), incluidas las tres rutas que el handoff listaba en §4.4.*

> 5) Errores sobreviven (Principio D): el pruner debe leer isError. Si es error → fuera del input del summarizer. Formato: línea literal en zona retenida o en memory log: `ERROR | tool | mensaje crudo`. Prohibido: "falló algo / se resolvió". El LLM no toca esos textos. Si hay que acortar por tamaño: truncar bytes del stack, no parafrasear.

## 6. Tools en vuelo + mensaje de usuario actual

*Contexto: respuesta a la pregunta 5 (§5.5) — la protección que el handoff señalaba como estructural en el stock y NO satisfecha por vueltas.*

> 6) Tools en vuelo + mensaje de usuario actual: por diseño, no por suerte. Lista fija de exclusión del corpus a resumir: system prompt; mensaje de usuario actual; últimas 5 vueltas; tool calls/results in-flight; cualquier mensaje con isError. Si el motor no tiene hooks: filtrar antes de llamar al summarizer.

## 7. Cómo mido que sirvió (telemetría)

*Contexto: respuesta a la pregunta 8 (§5.8) — la fase 0, hoy inexistente.*

> 7) Cómo mido que sirvió (telemetría): sin esto no demuestran nada. Mínimo: used_before / used_after / Δ; thresholdTokens, retainTokens, model route; contador de compacts / rechazos C / fallos de policy; señales de degradación (el agente pide de nuevo un dato que ya estaba; contradice un lock; "olvida" un error reciente); alerta si post-compact used no baja, o si la compactación queda disabled. Éxito = Δ claro + el agente no re-pregunta lo durable + errores siguen visibles.

## 8. Capa 3 — subagentes (la fuga)

*Contexto: respuesta a la pregunta 7 (§5.7) y al hueco documentado en el §4.7 del handoff.*

> 8) Capa 3 — subagentes (la fuga): la disciplina de prompt no basta. Obligatorios: tope duro de bytes/tokens en el reingreso del subagente (el hueco 1725-1742 hay que cerrarlo); formato de informe: goal / result / artifacts paths / errors — no transcript completo; spill al vault por encima del tope, y al padre solo el puntero + resumen corto.

## 9. Plan de encaje (orden)

*Contexto: respuesta al §6.1 del handoff ("orden: qué se hace primero y por qué"). El colaborador **reordena** respecto de la hipótesis del handoff, y su orden difiere del §5 de la spec — ver §12 y §13.*

> Plan de encaje (orden): (1) Fontanería viva: bug 2 del preset → que abaco gobierne de verdad; cablear 0.90/0.12. (2) Telemetría Fase 0 (sin ella el resto es fe). (3) Principio D (isError + exclusiones fijas) — barato, alto impacto. (4) Principio C (confirm + rechazo sin bucle). (5) Protocolo de escritura a abaco-memory (dejar de estar vacía). (6) Tope de spill subagente (capa 3). (7) Recién después: recall UI / consolidación / "motor propio" si aún hace falta.

## 10. Trampas

*Contexto: respuesta al §6.5 del handoff ("dónde nuestro diseño te parece mal").*

> Trampas: tests con dobles que mienten; bajar a 0.80 "por seguridad" sin preguntar; compactar tras rechazo; resumir errores; meter verbatim de subagente; asumir que el preset instalado gobierna.

## 11. No tocar

> No tocar: el diseño de 3 capas en SPEC-CONTEXT-3-LAYERS.md; el contrato Cordis de plugins; la validación retain < threshold del motor.

---

## 12. Punto abierto de orden

**No resuelto. Es una pregunta abierta al colaborador, no una decisión tomada.**

| Puesto | Orden del **colaborador** (§9) | Orden que propone el **integrador de ABACO** |
|---|---|---|
| 1 | Fontanería viva (bug 2 del preset + cablear 0.90/0.12) | Igual |
| 2 | Telemetría Fase 0 | Igual |
| 3 | Principio D (`isError` + exclusiones fijas) | **Tope de spill de subagentes (capa 3)** ⬅ movido desde el 6 |
| 4 | Principio C (confirm + rechazo sin bucle) | Principio D |
| 5 | Protocolo de escritura a `abaco-memory` | Principio C |
| 6 | **Tope de spill de subagentes (capa 3)** | Protocolo de escritura a `abaco-memory` |
| 7 | Recall UI / consolidación / motor propio | Igual |

**El argumento del integrador.** El hueco de `$DSH_NM/dsh-subagent/lib/index.js:1725-1742` — la salida terminal del subagente se inserta **verbatim y sin tope** en un `user/message` (`notifySettlement` en `:1719`, `...terminal.output` en `:1735`) — es la **causa** de que la ventana se llene, no un síntoma: si se cierra, la compactación se dispara menos y los principios **C** y **D** pierden urgencia relativa. Además es un cambio **pequeño y contenido**: el motor ya tiene el hook `tools/post-execute`, pero el aviso del subagente **lo esquiva** (`grep` de `tools/post-execute` en `dsh-subagent/lib/index.js` → **0 coincidencias**), así que hay que parchear `dsh-subagent`; es viable porque el repo ya usa **`patch-package`** (ver `DECOUPLING.md`, capa L1).

**Lo que queda abierto.** ¿Se sube el tope de spill al puesto 3, justo tras la telemetría, o se mantiene en el 6 como pide el colaborador? El integrador **no lo resuelve** aquí. Nótese que la propuesta **no** contradice el §11 (no toca el diseño de 3 capas, ni el contrato Cordis, ni la validación `retain < threshold`): lo único que cambia es el **orden**, no el contenido. Requiere respuesta del colaborador.

---

## 13. Reconciliación con `docs/SPEC-CONTEXT-3-LAYERS.md` §8

Verificado contra la sección `## 8. LOCK — Política de compactación` (`docs/SPEC-CONTEXT-3-LAYERS.md:265`) y el motor instalado. **No se resuelve nada aquí**: lo que diverge queda registrado con cita de ambos lados.

### 13.1 Lo que es consistente (explícito)

| Criterio del colaborador | Lado de la spec | Veredicto |
|---|---|---|
| §1: `thresholdRatio 0.90` + `retainRatio 0.12` | §8.1 (`SPEC:271-280`): la policy verbatim con 0.90 / 0.12 | **Idéntico** |
| §1: "No bajar a 0.80 sin preguntar" | §8.6.6 (`SPEC:348`): "no bajar a 0.80 sin preguntar" | **Idéntico** |
| §4: summary = FIFO bullets de una línea, no narrativa | §8.3 (`SPEC:301`): "FIFO de bullets de una línea. Nada de narrar en prosa" | **Idéntico** |
| §3: primera vez confirma; tras aceptar, auto en la sesión; **nunca compactar en silencio tras rechazo** | §8.4 (`SPEC:319-325`) y §3.C (`SPEC:141-153`) | **Idéntico** |
| §4(a) y §2: persistir hechos a memoria durable **antes** de compactar | §8.4 (`SPEC:323`): "Antes de compactar, persistir los hechos importantes a memoria durable" | **Idéntico** |
| §5: errores literales, el LLM no los toca, prohibido parafrasear | §8.3 (`SPEC:307`) y §3.D (`SPEC:155-169`): "nunca se resumen ni se suavizan" | **Idéntico** |
| §7: telemetría con `used_before` / `used_after` / `thresholdTokens` / `retainTokens` / `model route` + alertas | §8.5 (`SPEC:327-339`) | **Consistente — el colaborador es superconjunto** (añade Δ, contadores de rechazos y fallos de policy, y señales de degradación semántica) |
| §11: no tocar la validación `retain < threshold` | §9.2 (`SPEC:446`) y §8.7 | **Idéntico** |
| §8: cerrar el hueco `1725-1742` | Handoff §4.7; hueco **verificado en el motor** (cita exacta en §12) | **Consistente** |

### 13.2 La protección "últimas 5 vueltas" — **no hay contradicción**

Se verificó lo que el encargo pedía comprobar, y el resultado es que **ambos lados coinciden**: el requisito es **por vueltas**, y el motor stock **no lo cumple**.

- **El colaborador (§6) exige** la protección por vueltas: *"Lista fija de exclusión del corpus a resumir: system prompt; mensaje de usuario actual; **últimas 5 vueltas**; tool calls/results in-flight; cualquier mensaje con isError."*
- **La spec ya lo dice igual y lo marca NO satisfecha** (§8.3, `SPEC:315`): *"**últimas 5 vueltas** | **NO satisfecha** | la cola no es por vueltas sino por tokens: `selectCompactableRange` acumula hasta `retainTokens` (`:379-397`). A 1M eso son **120.000 tokens** de cola, que pueden ser más o menos de 5 vueltas"*.
- **El motor, medido**: `$DSH_NM/dsh-compaction-basic/lib/index.js:379-397` — `selectCompactableRange` recorre los nodos **desde el final** y acumula `accumulated += pricedNodes[index].tokens` hasta `if (accumulated >= retainTokens) break`. La frontera se fija por **presupuesto de tokens**, no por número de vueltas. Confirmado.

Conclusión: el colaborador pide vueltas, la spec pide vueltas y admite que el stock no las da, y el motor confirma que corta por tokens. **Es un requisito compartido frente a un hueco del motor, no una divergencia entre documentos.** La única precisión que añade el colaborador es la salida: *"Si el motor no tiene hooks: filtrar antes de llamar al summarizer."*

### 13.3 Divergencias registradas (sin resolver)

**D-1 — El orden: cablear 0.90/0.12 *antes* de la telemetría.**

- **Colaborador (§9):** *"Plan de encaje (orden): (1) Fontanería viva: bug 2 del preset → que abaco gobierne de verdad; **cablear 0.90/0.12**. (2) Telemetría Fase 0 (sin ella el resto es fe)."*
- **Spec §5, fila 4 (`SPEC:216`) y "Nota sobre el orden" (`SPEC:222`):** el principio A va en el **puesto 4**, *"condicionado por la telemetría (línea base)"*, y las dos notas son explícitas: *"No debe hacerse antes de que la telemetría mida el estado actual, o se pierde la línea base."* / *"Hay una tentación de hacer A primero por ser 'una línea'. Se descarta [...] La regla es: primero medir, luego las guardas deterministas (D), luego las de proceso (C), y solo entonces mover umbrales (A)."*
- **Estado: divergencia real y no resuelta.** El colaborador pone A en el puesto 1; la spec prohíbe hacerlo antes de medir. Matiz honesto: el colaborador separa "fontanería" (que el preset gobierne) de "el valor del umbral"; la spec los trata como una sola pieza (A) porque el preset inactivo es indistinguible del valor muerto. **Nadie decide aquí cuál gana.**

**D-2 — El modo de fallo de `retainRatio >= thresholdRatio`: ¿warning silencioso o fatal?**

- **Colaborador (§1):** *"debe ser claramente < 0.90 (si no, **TargetPressureConfigError / silencio**)"*.
- **Spec §8.7 (`SPEC:352-378`)** distingue **dos** caminos y dice que el de carga **no** es ni `TargetPressureConfigError` ni silencioso: la validación de proporción en **load** (`validateRatioRetention`, `dsh-compaction-basic/lib/index.js:132-134`, **throw en `:133`**) lanza un **`Error` normal**, **NO** lo cubre el `instanceof TargetPressureConfigError` de `:786`, **no se captura**, y *"un throw en la resolución de config de un plugin no tumba solo la entrada del plugin — tumba el árbol entero y devuelve la app a Safe Mode"* (`SPEC:369`). `TargetPressureConfigError` es el camino de **runtime** (`:111`), ese sí warning-only.
- **Verificado en el motor:** `:133` → `throw new Error(\`${name}: retainRatio (...) must be less than the resolved thresholdRatio (...)\`)`; `:111` → `throw new TargetPressureConfigError(...)`. Ambos existen.
- **Estado: divergencia de modelo de severidad.** El colaborador nombra solo el camino benigno; la spec documenta además uno fatal. No se resuelve: el criterio de done 6 del lock (`SPEC:348`) es precisamente el que exige no degradar esto a silencio.

**D-3 — Qué escribe el flag de C cuando el usuario rechaza.**

- **Colaborador (§3):** *"No repreguntar en bucle cada mensaje. **Volver a preguntar solo en la siguiente vez que cruce el umbral** (o tras N minutos / próximo "paso de presión"), con opción "nunca auto / siempre preguntar / siempre auto"."*
- **Spec §3.C (`SPEC:141-153`):** el estado a persistir es un flag *"("ya se pidió permiso / ya se autorizó")"* —dos estados candidatos, sin resolver qué escribe el rechazo— y la verificación observable (d) exige: *"al cruzar de nuevo el 90% en la misma sesión, **no** vuelve a pedir y compacta solo"*.
- **Estado: divergencia latente.** Leída literalmente, (d) describe el camino de **aceptación**, pero un flag llamado "ya se pidió permiso" que el rechazo activara produciría justo lo que el colaborador prohíbe: no volver a preguntar nunca con la presión aún por encima del umbral. La spec no fija la semántica del rechazo; el colaborador sí. **Queda abierto para el colaborador / el dueño.**

**D-4 — Preservación byte-idéntica del error frente a truncado por bytes.**

- **Colaborador (§5):** *"Si hay que acortar por tamaño: **truncar bytes del stack**, no parafrasear."*
- **Spec §3.D (`SPEC:167`)** exige preservación **completa** y su verificación es byte a byte: *"el texto del error es byte-idéntico"*, con un error de 9000 caracteres y el marcador del carácter 8500 presente tras compactar. Y §6 R8 (`SPEC:241`) trata la inflación del error literal como contrapresión legítima: *"contrapresión legítima que debe medirse con fase 0, no resolverse desactivando D"*.
- **Estado: divergencia de grado, no de principio.** Ambos prohíben parafrasear; el colaborador autoriza recortar bytes bajo presión de tamaño y la spec exige el texto íntegro. Sin resolver.

---

**Cierre.** El criterio del colaborador **confirma el lock del dueño en todo lo sustantivo** (0.90 / 0.12 / FIFO / confirmación la primera vez / errores literales / validación `retain < threshold`). Lo que aporta de nuevo es el **protocolo de escritura a la capa 2**, la **telemetría ampliada**, el **tope de spill de subagente** y un **orden** que discrepa del §5 de la spec en un punto concreto (D-1). Las cuatro divergencias de §13.3 quedan registradas y **abiertas**.

— Colaborador Abaco (referencia de memoria de contexto)
