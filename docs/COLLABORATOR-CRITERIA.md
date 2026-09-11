# CRITERIA — Respuesta del colaborador al handoff de contexto de 3 capas

**Qué es este documento.** La respuesta del **arquitecto colaborador** (referencia de memoria de contexto) a las ocho preguntas concretas y a la petición de plan de `docs/HANDOFF-TO-COLLABORATOR.md`, **más su respuesta de seguimiento** que cerró la discrepancia de orden (§12.3). Es **criterio de diseño, no código y no una decisión del dueño**: donde el colaborador y el LOCK del dueño difieran, manda el lock (`docs/SPEC-CONTEXT-3-LAYERS.md` §8). Ver §13 para las divergencias registradas.

**Autoría.** Colaborador Abaco (referencia de memoria de contexto). El texto de §1–§11 es **suyo y verbatim**; los encabezados, la numeración y las notas de contexto son de este repo y **no** alteran su contenido.

**Base de lectura.** `main` @ `612f843` cuando se respondió el handoff; **HEAD se movió a `7936852` durante esta revisión** (`fix(desktop): abaco-context never adopted the ABACO preset…`, que **commitea el arreglo del Bug 2**), y quedó **sin commitear** la fila `compaction-basic` del preset ya cableada a `0.90 / 0.12 / 8192`. Verifica `git log -1` y `git status` antes de dar por vivos los estados que este documento describe como pendientes. Documentos que este criterio toca: `docs/HANDOFF-TO-COLLABORATOR.md` (las preguntas), `docs/SPEC-CONTEXT-3-LAYERS.md` §8 (el LOCK del dueño; §8 manda sobre §3 y §4).

**Convención de rutas — `$DSH_NM`, definida aquí porque este documento la usa (§12.1, §13.2 y §13.3) sin haberla definido nunca.** `$DSH_NM` = `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai/` — la copia del motor que **ABACO ejecuta**, y por tanto la **AUTORITATIVA** para toda cita `archivo:línea` que describa el comportamiento de ABACO. Hay **tres** copias de ese árbol en esta máquina y **dos son de aplicaciones distintas**; la de `/Applications/DSH Desktop.app/.../@deepseek-ai` es el motor de la app **DeepSeek Desktop**, **otro producto**, y **no tiene autoridad** sobre ABACO. La tercera (`desktop/src/dsh-desktop/node_modules/@deepseek-ai/`) es la **entrada de build** del repo. Hoy las tres son byte-idénticas, así que **ninguna cita de este documento está mal por esta causa**; la cita nombra **siempre** la autoritativa. Trampa y procedimiento si algún día divergen: `docs/HANDOFF-FASE5.md` §7.12.

**Cómo leerlo.** El §1–§8 responde, en orden, a las ocho preguntas del §5 del handoff. El §9 es el **plan de encaje** que se pidió — con el aviso de que su orden fue revisado después. El §10 son las **trampas** que el colaborador prohíbe. El §11 es lo que **no** se toca. El **§12 es el orden definitivo acordado**: allí hubo una discrepancia (spill en el puesto 6 contra el 3) y **quedó resuelta** a favor del 3, con la respuesta textual del colaborador. El §13 reconcilia todo esto con el §8 de la spec y registra las divergencias que siguen abiertas.

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

*Contexto: respuesta al §6.1 del handoff ("orden: qué se hace primero y por qué"). El colaborador **reordena** respecto de la hipótesis del handoff. ⚠️ **Este orden fue revisado después: el tope de spill pasó del puesto 6 al 3** — el orden vigente es el de **§12 (Orden reconciliado)**, que manda sobre los puestos (3) y (6) de este bloque; aquí se conserva verbatim lo que respondió en su momento.*

> Plan de encaje (orden): (1) Fontanería viva: bug 2 del preset → que abaco gobierne de verdad; cablear 0.90/0.12. (2) Telemetría Fase 0 (sin ella el resto es fe). (3) Principio D (isError + exclusiones fijas) — barato, alto impacto. (4) Principio C (confirm + rechazo sin bucle). (5) Protocolo de escritura a abaco-memory (dejar de estar vacía). (6) Tope de spill subagente (capa 3). (7) Recién después: recall UI / consolidación / "motor propio" si aún hace falta.

## 10. Trampas

*Contexto: respuesta al §6.5 del handoff ("dónde nuestro diseño te parece mal").*

> Trampas: tests con dobles que mienten; bajar a 0.80 "por seguridad" sin preguntar; compactar tras rechazo; resumir errores; meter verbatim de subagente; asumir que el preset instalado gobierna.

## 11. No tocar

> No tocar: el diseño de 3 capas en SPEC-CONTEXT-3-LAYERS.md; el contrato Cordis de plugins; la validación retain < threshold del motor.

---

## 12. Orden reconciliado (acordado)

**CERRADO. No es una pregunta abierta: hubo una discrepancia, se argumentó, y el colaborador la resolvió a favor de la recomendación del integrador.** Fijado aquí y en `docs/SPEC-CONTEXT-3-LAYERS.md` §8.10.

### 12.1 El orden definitivo

| # | Paso |
|---|---|
| 1 | **Fontanería viva** — arreglo del preset (Bug 2) para que `abaco` gobierne de verdad, y cablear `0.90 / 0.12` |
| 2 | **Telemetría Fase 0** |
| 3 | **Tope de spill de subagentes (capa 3)** — el hueco `$DSH_NM/dsh-subagent/lib/index.js:1725-1742` |
| 4 | **Principio D** (`isError` + formato literal `ERROR \| tool \| mensaje crudo`) |
| 5 | **Principio C** (permiso la primera vez / rechazo sin bucle) |
| 6 | **Protocolo de escritura a `abaco-memory`** (dejar de estar vacía) |
| 7 | Recall / consolidación / motor propio |

Este orden **sustituye** a los puestos (3) y (6) del plan que el colaborador dio en §9: allí el spill era el **6**, con D y C por delante. El §9 se conserva **verbatim** como registro de lo que respondió entonces; para el orden, manda esta tabla.

### 12.2 La discrepancia y cómo se resolvió

- **El colaborador** situaba el tope de spill en el **puesto 6**, tratando la compactación como el foco: primero D y C, y el spill después.
- **El integrador de ABACO** propuso subirlo al **3**, justo tras la telemetría: el hueco de `dsh-subagent/lib/index.js:1725-1742` — la salida terminal del subagente insertada **verbatim y sin tope** en un `user/message` (`notifySettlement` en `:1719`, `...terminal.output` en `:1735`) — es la **causa** de que la ventana se llene; compactar bien con esa manguera abierta es pelear el síntoma. Además es un cambio **pequeño y contenido**: el motor ya tiene el hook `tools/post-execute` pero el aviso del subagente **lo esquiva** (`grep` en `dsh-subagent/lib/index.js` → **0 coincidencias**), así que hay que parchear `dsh-subagent`; viable porque el repo ya usa **`patch-package`** (`DECOUPLING.md`, capa L1).
- **Resolución: gana el puesto 3.** El colaborador aceptó y lo fijó él mismo ("Fíjalo tú con esta recomendación — no hace falta otra ronda"). **C y D siguen siendo obligatorios**: solo dejan de ir *antes* del spill.

### 12.3 Respuesta textual del colaborador (seguimiento, verbatim)

> Sobre el orden — spill vs C/D. Tienes razón. Subo el tope de spill de subagente al puesto 3, justo después de telemetría. Mi orden original (D → C → spill) trataba la compactación como el foco. Tu medición cambia la prioridad: el verbatim en dsh-subagent (1725–1742) es la manguera; compactar bien con la manguera abierta es pelear el síntoma. Cerrar el spill es cambio pequeño, contenido, y vía patch-package ya viable. C/D siguen siendo obligatorios; solo dejan de ser "antes del spill". Sin telemetría no demuestran el Δ; sin spill cap la telemetría solo mostrará compactaciones de emergencia. Fíjalo tú con esta recomendación — no hace falta otra ronda. Déjenlo constando en docs/COLLABORATOR-CRITERIA.md y en el §8 del SPEC (coincidencias + discrepancia del orden resuelta a favor del spill en #3).

**Nota sobre el punto 1.** El paso 1 (fontanería + `0.90 / 0.12`) también va **antes** de la telemetría, lo que roza la regla del §5 de la spec ("primero medir [...] y solo entonces mover umbrales"). No lo resuelvo aquí: queda registrado en §13.3 D-1 como superado por este orden acordado.

---

## 13. Reconciliación con `docs/SPEC-CONTEXT-3-LAYERS.md` §8

Verificado contra la sección `## 8. LOCK — Política de compactación` (`docs/SPEC-CONTEXT-3-LAYERS.md:265`) y el motor instalado. **Este documento no resuelve divergencias por su cuenta**: lo que diverge queda registrado con cita de ambos lados. La única excepción es **D-1**, que **ya no está abierta porque la resolvió el colaborador** (§12), y se registra aquí como tal.

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

### 13.3 Divergencias registradas (D-1 resuelta; D-2 a D-5 abiertas — **D-5 resuelta el 2026-09-10**)

**D-1 — El orden: cablear 0.90/0.12 *antes* de la telemetría. — RESUELTA (por decisión, no por medición).**

- **Lados en conflicto.** El colaborador (§9) ponía *"cablear 0.90/0.12"* en el puesto 1; la spec §5 (`SPEC:216` y la "Nota sobre el orden" en `SPEC:222`) situaba el principio A en el **puesto 4** y prohibía hacerlo antes de medir: *"No debe hacerse antes de que la telemetría mida el estado actual, o se pierde la línea base"* / *"primero medir, luego las guardas deterministas (D), luego las de proceso (C), y solo entonces mover umbrales (A)"*.
- **Cómo quedó.** El **orden reconciliado** de §12 —ratificado por el colaborador, que además subió el tope de spill al puesto 3— mantiene la fontanería y el cableado de `0.90 / 0.12` en el **puesto 1**, antes de la telemetría. Es decir: **el orden acordado supera la regla del §5** para las filas 1–5, y así queda registrado en `docs/SPEC-CONTEXT-3-LAYERS.md` **§8.10**.
- **Matiz honesto.** El colaborador argumentó explícitamente el punto **spill vs C/D**; la colocación de A en el puesto 1 viene del orden acordado y no de un argumento suyo sobre la línea base. La razón que sí dio y que sostiene el conjunto: *"Sin telemetría no demuestran el Δ; sin spill cap la telemetría solo mostrará compactaciones de emergencia."* §12.3. **El §5 de la spec no se ha reescrito** (queda fuera de los documentos tocados en esta revisión): su nota de orden convive hoy con el §8.10, y el §8.10 es el que refleja la decisión vigente.

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

**D-5 — De qué perfil es `$DSH_HOME`, y si su `settings.yaml` tenía la clave `agent-presets` (conflicto de hecho entre documentos).**

*No es una divergencia del colaborador: es un conflicto entre el handoff corregido y la spec, y afecta a la causa raíz del Bug 2. Se registra porque el handoff corregido y la spec hoy no pueden ser ciertos a la vez.*

- **Handoff corregido (`docs/HANDOFF-TO-COLLABORATOR.md` §4.5, §4.9 R13):** el `$DSH_HOME` de ABACO es `…/abaco-deep-core/harness`; su `settings.yaml` **no tenía clave `agent-presets`**, y por ausencia de clave el default efectivo era el de la **composición**, `standard`. → **CONFIRMADO el 2026-09-10 [V]: ésta era la lectura correcta.**
- **Spec (`SPEC:66`; ese texto vive hoy en `SPEC:68`), en tono de corrección a una auditoría anterior:** *"**`settings.yaml` SÍ tiene la clave `agent-presets`**: `$DSH_HOME/settings.yaml:11-12` → `default: cordis`. La auditoría afirmaba que faltaba. La conclusión de fondo no cambia (el preset activo no es `abaco`), pero **la causa sí**: el roster no cae a `standard` por ausencia de clave, cae al preset `cordis` por valor explícito."* — ⚠️ **Texto RETRACTADO en la spec el 2026-09-10: era falso, porque leyó el perfil vecino. Se conserva aquí como registro del conflicto, no como cita vigente.**
- **Spec (`SPEC:251`; cita desfasada — ese párrafo vive hoy en `SPEC:261`), "Correcciones a la auditoría recibida":** *"(1) `settings.yaml` **sí** contiene `agent-presets` (`:11-12`, `default: cordis`); [...] (3) **`$DSH_HOME` real es `…/dsh-desktop/harness`**, no `~/.dsh`."* — ⚠️ **Sus apartados (1) y (3) quedan RETRACTADOS en la spec el 2026-09-10.**
- **Evidencia recogida entonces:** (a) `…/dsh-desktop/harness/settings.yaml:11-12` dice hoy `agent-presets: default: cordis` — **pero ese es el perfil de la app DeepSeek Desktop**, no el de ABACO; (b) ~~`…/abaco-deep-core/` **no existe** hoy~~ → **CORREGIDO el 2026-09-10: el perfil de ABACO SÍ existe** (volvió a crearse al arrancar la app; `settings.yaml` con fecha `Sep 10 17:34`), y su `userData` está fijado a `abaco-deep-core` en el código de ABACO (`desktop/src/dsh-desktop/src/main/index.ts:533`, con la separación respecto de `dsh-desktop` explicada en `:523-533`); (c) el default de la composición es **`standard`** (`$DSH_NM/dsh-web-app/cordis.patch.yml:440-444`), el mismo valor que el propio plugin nombra como `REPLACED_DEFAULT` (`packages/abaco-context/index.js:81`).
- **Lectura probable, dicha entonces como hipótesis y no como veredicto:** la "corrección" de `SPEC:66`/**`:251`** parece haber leído el perfil **vecino** (`dsh-desktop`) y revertido así un hallazgo que era correcto — que en el perfil de ABACO la clave **faltaba**. Encaja con R13: los dos perfiles se confunden con facilidad. Si eso es cierto, la causa del Bug 2 es "**ausencia** de clave → default de composición (`standard`)", y no "valor explícito `cordis`"; y `SPEC:251(3)` sería incorrecto al afirmar que el `$DSH_HOME` real es el del shell upstream. → **CONFIRMADA el 2026-09-10 [V]. Era exactamente eso.**
- **Estado: RESUELTA (2026-09-10) — a favor del handoff.** La spec quedó corregida y retractada en `docs/SPEC-CONTEXT-3-LAYERS.md` §2.1 (`SPEC:68`, `SPEC:69`), §2.2 y §7 (`SPEC:261`), y se añadió **R13** a su tabla de riesgos. **Nota de límite retirada:** el `settings.yaml` del perfil de ABACO **sí se pudo re-comprobar en disco** — el directorio existe, se recreó al arrancar la app —, así que la evidencia (a)-(c) ya no es indirecta. Medido hoy:
  - `~/Library/Application Support/abaco-deep-core/harness/settings.yaml:1-2` → `agent-presets:` / `  default: abaco` — **el `$DSH_HOME` de ABACO, y dice `abaco`**.
  - `~/Library/Application Support/dsh-desktop/harness/settings.yaml:11-12` → `agent-presets:` / `  default: cordis` — **el perfil vecino (DeepSeek Desktop)**, que es de donde salió la cita falsa.
  - `~/.dsh` → **no existe** (la única mitad cierta de `SPEC:67`).
  - `~/Library/Application Support/abaco-deep-core/harness/.agent-presets/.abaco-context-default.json` → `{"applied": true, "presetId": "abaco", "replaced": "standard", "at": "2026-09-10T21:34:14.122Z"}`. Ese **`"replaced": "standard"`** es la prueba en disco de que el default efectivo **anterior** era el de la composición, `standard` — esto es, de que el hallazgo original era cierto y de que **hoy la clave está porque el arreglo del Bug 2 (`7936852`) la escribió**.

---

**Cierre.** El criterio del colaborador **confirma el lock del dueño en todo lo sustantivo** (0.90 / 0.12 / FIFO / confirmación la primera vez / errores literales / validación `retain < threshold`). Lo que aporta de nuevo es el **protocolo de escritura a la capa 2**, la **telemetría ampliada**, el **tope de spill de subagente** y un **orden** que discrepa del §5 de la spec (D-1, hoy **superado por el orden acordado** de §12). De las cinco divergencias de §13.3, **una queda resuelta** (D-1) y **cuatro siguen abiertas** (D-2 a D-5); ninguna de esas cuatro se resuelve aquí. → **Actualización 2026-09-10: D-5 queda también RESUELTA** (a favor del handoff; ver el detalle arriba), de modo que hoy quedan **tres** abiertas — D-2, D-3 y D-4.

— Colaborador Abaco (referencia de memoria de contexto)
