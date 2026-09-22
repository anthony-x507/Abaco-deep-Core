# Frontier — potencialidades cotidianas de Jev (punta)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — mapa de poderes; **no** runtime, **no** cliente nuevo, **no** `authorize()`, **no** `patch.yml` |
| **fecha** | 2026-09-22 |
| **teatro** | Trabajo cotidiano Abaco: briefs del Leader, forks de Cloud Agent, mesa `decide_tech.py`, Deep Harnes, Python Core Bind, cola de GAPs |
| **naming** | **Jev** rankea y aconseja con %. **Atena** aconseja en prosa, fuera de estos modos y fuera de `authorize()`. **Janice** ejecuta con grant vivo o con un breaker que CODE o Anthony ya autorizó |
| **piso** | `choice_confidence ≥ 0.55` y `safe_noul ≥ 0.5` y ausencia de conflicto de candado. Este memo no baja ningún número |
| **merge** | PR de docs + review humano. Este lane no mergea a `main` |

Una pregunta: qué cinco poderes de razonamiento cotidiano embarca Abaco, encima del desk y del pulse ya escritos, que los stacks de plugins y agentes suelen no tener.

La respuesta afina las cinco modalidades del seed del Leader (2026-09-22). No las sustituye por un sexto producto. Las deja implementables en 30 / 60 / 90 días, con clase, margen y actor.

Este memo consume, y no reescribe:

- el wire de System One — [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md)
- el PILOT del pulse — [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md)
- anillos, digest y kill — [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) (D1, D8)
- la ley de nombres — [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)

F1 queda cerrado. Connectors siguen en **HOLD**. El lane BTC queda fuera.

---

## 0. Candados que el mapa no mueve

| Candado | Cómo se ve en estos cinco poderes |
|---------|-----------------------------------|
| Jev no acuña grants, no escribe `patch.yml`, no es grantor | Ningún modo tiene una opción `grant` / `widen` / `allow` |
| Jev y Atena no viven dentro de `authorize()` ni de Bind | La mesa es un journal. Un % alto no es un allow |
| Janice ejecuta | Solo una acción que CODE o Anthony ya autorizó. El JSON de Jev no es esa autorización |
| Atenuación y promote | Jev emite consejo con caducidad. Janice atenúa, o un review promueve el anillo, en otro reloj |
| Piso G47 | Se queda. Encima del piso se apilan márgenes. Debajo del piso se toma la opción más estricta ya escrita, o `hold_for_human` |
| Tip-of-spear | Un deny a un no autorizado no congela a los admitidos. Un consejo de Jev tampoco |
| Datos ≠ control | El state lleva contadores, digests, la frase citada y un `evidence_ref`. No lleva transcripts, tool-results, secretos ni `patch.yml` |
| Pin | `jev-1.13.0`. Sin alias |
| Marketplace | Abrir connectors o un marketplace de terceros no es una potentiability de esta mesa |

`execute_ok` en toda fila cuyo origen es Jev vale `false`. El booleano heredado `apply_ok` sigue significando “el piso G47 se cumplió”. Cumplir el piso no descarga un plugin, no mueve un anillo y no publica un brief.

---

## 1. Qué suelen embarcar los stacks, y qué les falta

Un stack de agentes de frontera, hoy, suele embarcar esto:

| Hábito | Efecto en la punta |
|--------|--------------------|
| Un plan generado y una confianza en prosa | La masa de la segunda hipótesis desaparece |
| El mismo agente llama la herramienta | El consejo y el acto son la misma vuelta |
| Un revisor que cierra con una frase de paso | El anuncio se adelanta al artefacto |
| Un cron que pregunta “¿nos atacan?” en un periodo fijo | El journal se llena de `hold` y el operador deja de leer |
| Promote por temporizador, o un humano sin consejo de timing | O el blast llega a toda la flota, o el anillo no avanza |
| Un umbral único para todo error | Un journal y una cuarentena cruzan la misma puerta |
| “Este bug es más importante” como adjetivo | Nadie puede auditar el desbloqueo |
| Reescribir la pregunta hasta obtener un sí | El piso se vuelve un bucle |

Abaco ya tiene el otro piso: broker determinista, admisión sellada, desk con `choice` / `noul` / `score`, y un pulse en PILOT que solo entra en la banda gris. Eso está escrito. La punta que falta es tratar el **residuo** como producto: la segunda hipótesis, el tipo de error, la evidencia de un anuncio, el silencio cuando la ventana está sana, y un consejo que caduca sin ejecutarse.

Cinco modos, un desk, un pin, un presupuesto. Un plugin nuevo por modo parte los umbrales y el cupo. Es el mismo rechazo que “un pulse por face”.

---

## 2. Las cinco potencias

### 2.0 Estrés del seed

| # | Modalidad del seed | Veredicto | Qué cambia |
|---|--------------------|-----------|------------|
| 1 | Fork ranker — ≥2 caminos, choice + confianza + noul, aplicar solo sobre el piso | **Queda** | El producto es la distribución. Un runner-up más estricto se journaliza siempre. El piso no es permiso de acto |
| 2 | Gray-band / margen de error — confianza media → HITL o el contrato más estricto | **Queda** | “Media” deja de ser un adjetivo. Cada margen nombra qué haría un consejo equivocado |
| 3 | Triage / sorter de potencial | **Queda** | La potentiability es un objeto con clase cerrada. CODE prefiltra a 2–4. Jev no ordena un backlog de 20 ni inventa el ítem |
| 4 | Detector de honestidad — “¿esto pasa sin evidencia?” | **Queda, con otra pregunta** | La pregunta no contiene un veredicto de paso. CODE resuelve el artefacto ausente. Jev solo juzga si la frase se pasa del artefacto |
| 5 | Pulso ritual 60–90 s | **Queda el presupuesto; cambia el producto** | La salida por defecto en una ventana sana es el silencio. 90 s fijos con features quietas es el rechazo de los 15 s, más lento |

El seed pide aplicar el ranker solo por encima del piso. Eso se conserva para **mostrar** la fila. El acto (atenuar, promover, anunciar, acuñar) tiene otro booleano, y en Jev ese booleano queda en falso.

### 2.1 Ranker multi-hipótesis

**Poder.** Ordenar hipótesis que ya están escritas, y devolver la masa de las que no ganaron.

**Qué le falta al hábito de “un plan”.** La confianza resume la forma de `probabilities`. Una confianza de 0.60 puede convivir con una segunda opción estricta que todavía carga masa. El desk actual guarda la confianza y no lee esa masa ([`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) §3, hueco 13). Este modo cierra ese hueco en el trabajo de todos los días, no solo en el body del POST.

**Sweet spot.** De 2 a 4 opciones, escritas antes de la llamada, con `hold_for_human` cuando la lista puede no cubrir. Una sola llamada: un `choice` y un noul por opción (el wire ya especifica el fan-out). Jev no redacta la tercera vía: generar texto es el hueco de jaggedness que el wire ya dejó fuera.

**Quién marca qué es más estricto.** El caller, en CODE, con un `blast` cerrado (§5). La frase “si dudas, niega”, metida en el instruction, esconde el empate dentro del modelo y devuelve confianza alta. Esa frase no entra en este modo. El empate queda en `probabilities`, y CODE decide el handoff.

**Puente de 30 días, mientras `probabilities` no se lean.** Si la respuesta no trae distribución, todo margen de acto (M3–M7) va a handoff. Los márgenes de journal (M0–M2) pueden mostrarse con el piso G47. Así el modo es útil el día 30, y el día 60 hereda el dual-run del wire.

### 2.2 Radar de márgenes

**Poder.** Nombrar el daño de equivocarse, y apilar ese daño encima del piso.

**Qué le falta al umbral único.** 0.51 de noul es un empate junto al piso, no un sí holgado. El mismo 0.62 no autoriza un journal y una cuarentena. La banda gris del pulse sigue siendo el lugar donde Jev entra. Este modo dice **qué** se hace con la fila según la clase de error (§5), no según un adjetivo “medio”.

**Debajo del piso** (`choice_confidence < 0.55`, o `safe_noul < 0.5`, o conflicto de candado): CODE se queda con la opción de menor `blast` que ya estaba en la lista, o con `hold_for_human`. Nadie inventa un grant para “salir del gris”. Atena no recibe ese caso para redactar un permiso. Atena sigue fuera de `authorize()` y fuera de estos cinco modos.

### 2.3 Sorter de potentiabilities

**Poder.** Elegir, entre movimientos ya evidenciados, cuál desbloquea más trabajo de punta si el consejo es correcto.

**Potentiability** (la palabra de Anthony; en el seed, *potentiality*) es ese movimiento: clase cerrada, `evidence_ref`, desbloqueo, margen, actor. No es un grant. No es una capability nueva. No es el adjetivo “tiene potencial”.

**Qué le falta al agente que trabaja el archivo de enfrente.** Mete el backlog entero en el prompt y devuelve una prioridad en prosa. Aquí CODE prefiltra a 2–4 con una clave del caller (ejemplo, no ley: `blocking` descendente, `opened_at` ascendente). Si el prefiltro deja un ítem, no hay llamada. Jev elige entre esos ítems con criterios que separan la clase y la evidencia. La multiplicación del ranking la hace CODE (§4). Contar y ordenar fechas es código (jaggedness).

**Tope de la lista.** P8 (gusto) y P9 (reabrir lo cerrado, marketplace, bajar el piso) se caen antes del prefiltro. Una potentiability cuyo “desbloqueo” es compensar con Jev un Phase S que no existe se cae también: el siguiente paso es un contrato de provider, y ese paso no es una banda gris.

### 2.4 Honestidad adversarial

**Poder.** Sujetar una frase de cierre al artefacto que cita, antes de que el Leader la anuncie.

**La pregunta del seed** (“¿este claim pasa sin evidencia?”) nombra el daño correcto y mete un veredicto de paso dentro del instruction. El modelo está entrenado para cerrar. Este modo hace otra pregunta, en inglés, sobre el texto tal cual:

> Does `artifact_ref` state the claim in `claim.text`?

`criteria.true`: el artefacto contiene el resultado citado (id de test, digest, gate). `criteria.false`: el artefacto falta, habla de otra cosa, o la frase afirma un resultado que el artefacto no contiene. El silencio es `false`.

**Partición.** Si CODE no puede resolver `artifact_ref` a un hash que el host calculó, el veredicto es `claim_unsupported` y no hay POST. Jev entra solo cuando el archivo existe y la duda es semántica: la frase dice más que el archivo. No se traduce el claim antes de juzgarlo: una traducción es otro modelo y un lugar donde la frase se ablanda.

**Vocabulario cerrado.** `evidence_binds` · `claim_unsupported` · `hold_for_human`. No hay cuarto valor. `evidence_binds` tiene blast `announce`: la fila se le puede mostrar a Anthony. El brief sigue siendo suyo. La fila no es el anuncio.

### 2.5 Mesa de cadencia

**Poder.** Decidir si una pregunta merece un POST, y emitir consejos de atenuación y de timing de canary que caducan sin ejecutarse.

El seed describe preguntas finas cada 60–90 s. G47 ya fijó la aritmética y rechazó los 15 s fijos. Este modo no repite esa aritmética (§8). Cambia el producto: tres relojes, un advisor, cero actuadores.

| Reloj | Qué mide | Qué hace Jev | Qué hace el otro reloj |
|-------|----------|--------------|------------------------|
| Ask | Si la ventana está en duda | Un POST, o silencio | CODE calcula z/MAD, cupo e histéresis |
| Atenuar | Caducidad del consejo | `hold` / `alert` / `attenuate_budgets` / `quarantine` como consejo | Janice ejecuta solo con co-fuego de CODE o con HITL de Anthony, dentro de la caducidad |
| Canary | Si la ventana de observación que CODE fijó ya corrió | `not_yet` / `hold` / `ready_for_review` | El review mueve el anillo. Un temporizador no |

La salida legal de una ventana sana es **cero llamadas**. Un ritual que dispara con el reloj de pared, con features quietas, es el diseño que G47 rechazó a 15 s.

---

## 3. Fórmula del sweet spot

Una llamada. De dos a cuatro opciones. State como registro. Instrucciones en inglés. Pin `jev-1.13.0`. El costo citado en G47 (~$0.0001–$0.0002 por llamada corta) es **por POST**, no por pregunta: el fan-out vive dentro del mismo body. Esas cifras no se re-midieron aquí.

```text
call_ok       = (duda | empate | novelty > τ | pregunta explícita del Leader)
                AND cupo restante
                AND digest distinto al de la fila vigente
                AND CODE no lo sabe ya
                # pin, canary hit, egress no declarado, aritmética, fechas, conteos,
                # cap-diff = widen, artifact_ref irresoluble, ventana de canary aún abierta

floors_ok     = choice_confidence ≥ 0.55
                AND safe_noul ≥ 0.5
                AND NOT candado_conflict
                AND choice ∈ vocabulario cerrado del modo

show_ok       = floors_ok
                AND (margen ∈ {M0, M1, M2}
                     OR (probabilities presentes AND runner-up no es más estricto))

execute_ok    = false

debajo_piso   = opción de menor blast ya escrita, o hold_for_human
caducidad     = la pone CODE. Al vencer, el anillo y el breaker siguen donde estaban.
                Un digest igual no autoriza un segundo POST con la pregunta reescrita.
```

La fila del POST se escribe siempre: answers crudos, `margin_id`, `execute_ok: false`. `show_ok` es más estrecho. Significa que el choice ganador puede presentarse como recomendación. En M3–M7, `show_ok` verdadero sigue con handoff: la recomendación se enseña y nadie la ejecuta. Sin `probabilities`, o con un runner-up más estricto, `show_ok` queda en falso y la fila pide handoff con el choice crudo visible y la recomendación mostrada en el menor blast ya escrito.

Día de trabajo en el sweet spot: del orden de 10–30 POST explícitos (briefs, forks, un claim, una ventana en duda). El diseño rechazado, 15 s fijos, son 5 760 POST por día por instancia (G47). El dólar de esa cuenta no es el motivo del rechazo. Lo son la cola, el journal de `hold` y la ceguera del operador.

Presupuesto del pulse: se queda el tope del PILOT (40 POST / hora en una instancia tip). Los modos de brief, fork y honestidad son bajo demanda: un POST por objeto de decisión y por digest. Comparten el mismo cupo. Agotar el cupo apaga el advisor y deja CODE. No abre un allow.

---

## 4. Taxonomía de potentiabilities

Clase cerrada. Lo que no está en la tabla no entra al prefiltro.

| Id | Clase | Desbloqueo si el consejo es correcto | Margen si el consejo es equivocado | Jev | Quién actúa |
|----|-------|--------------------------------------|------------------------------------|-----|-------------|
| P1 | `fork_written` | Un humano puede mergear un camino ya escrito | M1 | Ranker | El humano mergea. Janice no “corre al ganador” |
| P2 | `residual_gap` | Un GAP abierto, con id, se cierra sin reabrir un contrato cerrado | M1 | Sorter, si hay `evidence_ref` | El dueño de ese GAP |
| P3 | `ci_red` | Un check rojo vuelve a verde sin debilitar la aserción | M1; M7 si la salida propuesta es marcarlo como superado | Sorter, para elegir cuál rojo abrir | Quien edita el test o el código. Jev no reescribe la aserción |
| P4 | `admission_drift` | Un mismatch de digest, cap o pin queda clasificado | M6 si alguien fuera a permitir el drift | Solo si CODE ya denegó y la duda residual es “skew de deploy frente a rug-pull” | El deny sigue en pie |
| P5 | `canary_observation` | La cola de review recibe un timing | M5 | Timing, con las precondiciones de §7 | Anthony o CODE en review. Jev no promueve |
| P6 | `gray_security` | `hold` frente a `alert` frente a atenuar en sombra, en la banda de duda | M2 o M3 | Mesa de cadencia | `alert` se journaliza. Atenuar espera co-fuego o HITL |
| P7 | `claim_audit` | Una frase de cierre queda atada a un artefacto, o se rechaza | M7 | Honestidad, solo con hash resuelto | Anthony anuncia si está de acuerdo con `evidence_binds` |
| P8 | `taste` | Copy, marca, gusto de producto | — | — | Anthony. La mesa no se llama |
| P9 | `reopen_closed` | Reabrir F1, sacar connectors de HOLD, abrir marketplace, bajar 0.55 o 0.5 | M6 | — | Nadie en esta mesa |

**Ranking, en CODE.** Jev devuelve scores por dimensión (encaje de la evidencia, reversibilidad), cada uno en su pregunta, en la misma llamada. CODE normaliza y pesa. Los pesos son una tabla del caller. Cambiarlos no reescribe la pregunta. Un ejemplo (no es ley, no se calibra en este memo): un P2 que bloquea un endurecimiento ya especificado pesa más que un P1 cuyo otro camino no está atascado; un P7 pesa cuando hay un brief a punto de anunciarse. Cualquier peso que empuje P8 o P9 por encima de cero es un bug del prefiltro.

`evidence_ref` vacío: la fila no se rankea. Honestidad, o CODE si el hash no resuelve, devuelve `claim_unsupported`.

El seed nombra “stress A–E” como cola residual del Leader. Este árbol no contiene esa suite. El sorter consume la lista que el Leader le pasa (id de GAP, `evidence_ref`). No inventa cinco familias de estrés para tener algo que ordenar, y no reabre F1 para fabricar un residual. El informe histórico `reports/GAP-F1-MEDIACION.md` describe un main anterior; F1 en v0.4.26 está cerrado.

### Superficies cotidianas

| Superficie | Poder que dispara | Qué no entra en el state |
|------------|-------------------|--------------------------|
| Brief del Leader, antes de anunciarlo | Honestidad; sorter si quedan ≥2 movimientos con evidencia | La frase de anuncio reescrita “más suave”; gusto (P8) |
| Forks de Cloud Agent | Ranker. Las opciones son los resúmenes ya escritos de cada fork | Cadena de pensamiento, transcripts de tools, scratchpad |
| Ship del desk | Ranker + `margin_id` + `probabilities` | Un endpoint nuevo. La forma del body es el memo de wire |
| Deep Harnes, ventana de audit | Ask-clock, solo en duda | `authorize()`; transcripts; un pulse “para compensar” T0/T1 |
| Python Core Bind | Sorter sobre huecos de contrato ya escritos | Cualquier opción `allow` / `deny` de un efecto. Bind sigue en código |
| Cola de GAPs | Sorter sobre la lista suministrada | Letras de estrés inventadas; reabrir un contrato cerrado |

---

## 5. Márgenes de error

Un margen de error, en la pregunta de Anthony, no es un ± sobre el noul. Es lo que un consejo equivocado todavía puede causar, dado quién tiene permiso de actuar.

El noul es la probabilidad del modelo. El margen es la política de Abaco sobre lo que esa probabilidad puede disparar.

| Id | Si el consejo está mal | ¿`show_ok` encima del piso? | Handoff | Quién puede actuar después |
|----|------------------------|-----------------------------|---------|----------------------------|
| M0 | Una fila de journal equivocada | Sí | No | Nadie |
| M1 | El Leader sigue el fork peor en un PR que un humano aún mergea | Sí, con el runner-up visible | Si el runner-up es más estricto y hay `probabilities` | El humano que mergea |
| M2 | Un banner de más; fatiga de alerta | Sí | No, salvo runner-up más estricto | Nadie descarga |
| M3 | Si alguien obedeciera el consejo, un plugin admitido pierde presupuesto | Solo para mostrarlo | Siempre, hasta que Anthony o un co-fuego de CODE acepten | Janice, después de esa aceptación, dentro de la caducidad |
| M4 | Un plugin admitido se descarga | Solo para mostrarlo | Siempre. El primer warn no es cuarentena | Anthony. CODE puede co-disparar por un trip que ya existe (pin, canary, egress) |
| M5 | Promover pronto reparte un digest malo; sostener de más frena a los admitidos | El timing se muestra | `ready_for_review` entra a la cola. No mueve el anillo | Review. Jev no promueve |
| M6 | El consejo acuñaría, ampliaría, entraría en `authorize()` o escribiría `patch.yml` | No | Conflicto de candado. `floors_ok` falso | Nadie. Si los flags deterministas ya son verdaderos, no hay POST |
| M7 | Un `evidence_binds` falso deja salir un anuncio | Solo para mostrarlo | Anthony lee la fila antes de anunciar | Anthony. El modo no es un check de CI |

### Bandas

| Banda | Condición | Consecuencia |
|-------|-----------|--------------|
| Debajo del piso | Confianza &lt; 0.55, o noul &lt; 0.5, o candado | Menor `blast` ya escrito, o `hold_for_human` |
| Piso cumplido, margen de journal | M0–M2 y `floors_ok` | Se muestra. No hay descarga, promote ni grant |
| Piso cumplido, margen de acto | M3–M7, `floors_ok`, `probabilities` presentes, runner-up no más estricto | `show_ok`. Handoff igual. `execute_ok` sigue en falso |
| Masa residual | El runner-up es más estricto | En M3–M7 el handoff es obligatorio. En M0–M2 el runner-up se escribe en la fila |
| Silencio | Ventana sana, o CODE ya decidió, o no hay pregunta explícita | Cero POST |

### Orden de blast (CODE)

El caller marca `blast`, o CODE lo asigna por el token. Jev no elige el blast. Más arriba en la tabla = más estricto.

| Blast | Tokens típicos |
|-------|----------------|
| `none` | `hold_for_human`, `not_yet`, `claim_unsupported`, silencio |
| `journal` | un rank registrado |
| `alert` | `alert` |
| `announce` | `evidence_binds` |
| `budget` | `attenuate_budgets` |
| `ring` | `ready_for_review` |
| `unload` | `quarantine` (consejo) |
| `authority` | `grant`, `widen`, `promote`, `authorize` — se rechazan antes del POST |

Si el caller no marcó blast y el token no está en esta tabla, la fila es M1 (journal) y no hay acto.

### Calibración

Los ejemplos de TypeSafe (0.25 de “avisar a la otra opción”, 0.8 / 0.2 de review) siguen siendo ilustraciones de otro dominio. No entran como constantes Abaco. El corte de masa residual **no se inventa en este memo**.

| Horizonte | Qué se mueve | Qué no se mueve |
|-----------|--------------|-----------------|
| 30 días | Toda fila lleva `margin_id`. Sin `probabilities`, M3–M7 van a handoff | 0.55 y 0.5 |
| 60 días | Tabla por margen: filas, desacuerdos con el humano, propuesta de listón | El listón, hasta que Anthony acepte la tabla |
| 90 días | Un listón por margen, solo donde la tabla existe, siempre ≥ piso. Un margen sin tabla se queda en “handoff siempre” | Bajar el piso para que un margen “quepa” |

Un margen que en 60 días no cambió ninguna decisión humana se retira en la revisión de 90. Se queda el journal histórico. No se sube la frecuencia para “hacerlo útil”.

---

## 6. Consejo de atenuación

Jev puede aconsejar `hold`, `alert`, `attenuate_budgets` o `quarantine` para **un** `plugin_id`. El token `*` no es legal. El primer warn no es una cuarentena: si el choice es `quarantine` y no hay co-fuego de CODE, CODE deja el choice crudo en el journal y registra el acto como `hold` con motivo `quarantine_refused_by_policy`. No hay un segundo POST para que el modelo elija una etiqueta más blanda.

```json
{
  "mode": "attenuate_advice",
  "choice": "attenuate_budgets",
  "plugin_id": "abaco-voice",
  "margin_id": "M3",
  "floors_ok": true,
  "show_ok": true,
  "execute_ok": false,
  "advice_expires_at": "CODE",
  "feature_digest": "sha256:…",
  "may_execute": "Janice, after CODE co-fire or Anthony HITL, inside expiry"
}
```

`advice_expires_at` lo calcula CODE a partir de la ventana. Jev no propone el reloj. Al caducar, el presupuesto del plugin sigue igual. Un digest repetido no reabre la pregunta.

Breakers de seguridad y breakers de SLO siguen separados (doctrina del pulse). Atenuar un admitido sano en el primer banner es el fallo que congela la evolución. Este modo no lo convierte en default.

La ausencia de Phase S en un path T0/T1 de Deep Harnes no es un argumento para obedecer `quarantine`. El aislamiento que falta se escribe como provider. El consejo de Jev no lo reemplaza.

---

## 7. Consejo de timing de canary

El anillo canary → admitidos ya está especificado: la promoción es review, no un temporizador dentro del plugin, y Jev no elige el anillo ni firma el advisory ([`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) D8). Este modo añade el consejo de **cuándo** esa review vale la pena.

Preconditions, todas en CODE, todas sin POST si fallan:

1. CODE ya aceptó el artefacto (digest pinneado, caps leídas).
2. `cap_diff` es `unchanged`. Si es `widen`, el camino es ContractEvolution + HITL (D1). Jev no opina.
3. La ventana de observación que CODE fijó ya corrió. Si no, el resultado es `not_yet` y no hay llamada.

Vocabulario: `not_yet` · `hold` · `ready_for_review`. Tokens rechazados antes del POST: `promote`, `admit`, `widen`.

```json
{
  "mode": "canary_timing",
  "choice": "ready_for_review",
  "plugin_id": "abaco-voice",
  "digest": "sha256:…",
  "cap_diff": "unchanged",
  "window_elapsed": true,
  "margin_id": "M5",
  "floors_ok": true,
  "show_ok": true,
  "execute_ok": false
}
```

`ready_for_review` pone una fila en la cola de Anthony. El digest del anillo admitido, comparado antes y después de la fila, tiene que ser el mismo. La caducidad del consejo deja el anillo quieto. No hay un TTL que promueva al vencer.

---

## 8. Diseño de cadencia del pulse

G47 ya fijó `interval_base` 60–120 s (piloto 90 s), `interval_min` 15 s solo bajo stress, `interval_max` 5–15 min, histéresis, tope 40/h. Esos números siguen. Lo que este memo añade es la **legalidad de la pregunta según el disparador**.

| Disparador | Pregunta legal | Pregunta ilegal |
|------------|----------------|-----------------|
| Ventana sana | Ninguna. Silencio | Cualquiera, incluido “¿seguimos bien?” |
| Deny-spike o novelty &gt; τ, sin trip de CODE | `hold` / `alert` / `attenuate_budgets` | `grant`, `quarantine` como primer acto, “¿levantamos el deny?” |
| Trip de CODE (pin, canary hit, egress no declarado, presupuesto, TTL) | Ninguna | “¿el deny fue excesivo?” |
| Ventana de canary cumplida, caps iguales, artefacto aceptado | `not_yet` / `hold` / `ready_for_review` | `promote` |
| Pregunta explícita del Leader | El modo de la clase P* de esa pregunta | Un segundo modo colado en el mismo choice |
| Reloj de pared a 15 s, sin stress de CODE | Ninguna | El pulse entero |

El stress score (z/MAD de deny-rate, egress, novelty) lo calcula CODE. Jev no calcula el z. Subir un escalón de cadencia cuando el score cruza warn, y bajar solo tras varias ventanas quietas, es la histéresis que G47 ya pide y no numera. Partida de este mapa, como parámetro de CODE: 3 ventanas quietas. No es un número del PILOT ya publicado, ni un noul. Se revisa a los 60 días con la tabla de flapping.

Caída de Typesafe (`401`, `422`, `429`, `529`, timeout): fila `jev_unavailable`, `execute_ok: false`, CODE sigue. Reintento con backoff solo en 429/529. Agotar reintentos no reescribe la pregunta. Un 422 de body inválido no se “arregla” pidiendo un sí con otra rúbrica en caliente: se journaliza y se corrige el constructor en un PR.

---

## 9. Matriz de actores

| Situación | Jev | CODE | Anthony | Janice |
|-----------|-----|------|---------|--------|
| Dos forks escritos, ninguno amplía autoridad | Rankea | Piso, runner-up, journal | Lee si hay handoff M1 | — |
| Un solo camino escrito | — | — | Escribe el segundo si quiere un rank | — |
| Pin miss, canary hit, egress no declarado | — | Trip | — | Ejecuta el deny ya autorizado |
| Debajo del piso | — | Menor blast, o `hold_for_human` | Solo si esa opción aún es una decisión de producto | — |
| Consejo de atenuar, sin co-fuego | Aconseja | Journal `would-attenuate` | Acepta o descarta dentro de la caducidad | Ejecuta solo después |
| Canary, caps iguales, ventana abierta | — | `not_yet` | — | — |
| Canary, caps que amplían | — | — | HITL / ContractEvolution | Carga solo tras el admit |
| Canary, caps iguales, ventana corrida, sin trip | Timing | El anillo no se mueve con la fila | Promueve en review si está de acuerdo | Carga el anillo admitido tras el review |
| Claim, hash ausente | — | `claim_unsupported` | — | — |
| Claim, hash presente, la frase puede pasarse | Honestidad | — | Anuncia solo si acuerda | — |
| Ventana sana | — | Silencio | — | — |
| Gusto, marca, copy | — | — | Decide | — |
| Marketplace, connectors fuera de HOLD, reabrir F1, bajar el piso | — | — | — | — |
| Aritmética, fechas, conteos, z-score | — | Calcula | — | — |
| “Segunda opinión” de Atena dentro de `authorize()` | — | — | — | — |

La última fila no tiene actor porque los dos advisors se quedan fuera. El autorizador sigue siendo `authorize()`.

---

## 10. Anti-patrones

Estos tres ya están rechazados en G47. Se listan porque un diseño “más avanzado” los vuelve a vestir.

| Anti-patrón | Cómo se disfraza de punta | Por qué mata la punta |
|-------------|---------------------------|------------------------|
| **Guardián LLM** | “El modelo entiende el ataque mejor que las reglas” | El allow sale del advisor. El TCB crece. M1–M10 dejan de ser deterministas |
| **Spam a 15 s** | “Más muestras, mejor radar” | 5 760 filas/día de `hold`. El operador apaga el pulse. La evolución admitida se lee como ruido |
| **Jev dentro de `authorize()`** | “100 ms caben en el request path” | El timeout no determinista aletea el deny. El candado de Atena/Jev se rompe. La latencia publicada de TypeSafe no abre Bind |

Estos otros se ven igual de avanzados y hacen el mismo daño.

| Anti-patrón | Cómo se disfraza | Regla de este memo |
|-------------|------------------|--------------------|
| Ritual a 90 s en ventana sana | “Cumple el intervalo de G47” | Ventana sana = silencio. El intervalo es un techo, no una cita |
| Veredicto con calificativo de paso | Un estado intermedio entre `claim_unsupported` y `evidence_binds` | El vocabulario tiene tres tokens. Un estado cuyo sentido sea “pasa, con un pero” no se escribe en el journal ni en el brief. Las cadenas `soft-PASS` y `soft pass` están prohibidas como estado |
| `apply_ok: true` leído como acto | “El piso se cumplió, descarga” | `execute_ok: false` en toda fila de Jev. El acto es otro registro, de CODE o de Janice |
| Reescribir la pregunta hasta un sí | Persistencia del agente | Mismo `feature_digest` dentro de la caducidad = cero POST |
| Voto de varios modelos | “Multi-hipótesis” | Multi-hipótesis es la distribución de **una** llamada, leída por CODE. Una mayoría de advisors no es un grant |
| Juez LLM como check de merge | Honestidad “en CI” | M1–M10 y el build siguen verdes sin red. Una caída de Typesafe no enrojece el contrato ni lo abre |
| Un umbral para todo blast | “0.55 es la ley, luego atenúa” | 0.55 muestra la fila. M3–M7 esperan handoff |
| Segunda llamada para que el noul vea el choice | Fan-out “de verdad” | Las opciones se conocen antes. El wire ya lo cerró |
| Beam search de taxonomía dentro del TCB | Sorter exhaustivo | CODE prefiltra a 2–4. El resto espera |
| State con transcripts o secretos | “Más contexto, mejor %” | Contadores, digests, la frase citada, locks |
| Cinco plugins, cinco cupos | Cobertura por modo | Un desk, un pin, un cupo |
| Composite o score como input de Bind | “El número ya está calibrado” | El composite no entra a `authorize()` ni a Bind |
| Promote por TTL | “`ready_for_review` venció, luego entra” | Al vencer, el anillo sigue quieto |
| Cuarentena en el primer warn | Tip-of-spear “rápida” | CODE reescribe el acto a `hold` y conserva el choice crudo |
| Compensar Phase S con un pulse más listo | P6 con desbloqueo “aislar por consejo” | El provider se especifica. Jev no aísla |
| Prefiltro que deja pasar P9 | “Abrir el marketplace desbloquea el ecosistema” | P9 se cae. Connectors siguen en HOLD |
| Gusto de producto en la mesa técnica | Un choice más, total | P8 es de Anthony |
| Pedirle a Jev el z-score, la fecha o `1 - p` | Un noul “de peligro” restado al noul de seguridad | Esas cuentas son CODE. No se fabrica `safe_noul` por aritmética de nouls |
| Confianza 1 leída como verdad | El journal “cerró” | La confianza describe la masa, no el mundo |
| Alias `jev-latest` | “Siempre el mejor” | El pin sigue en `jev-1.13.0` mientras el piso sea el de G47 |

---

## 11. Mapa 30 / 60 / 90

Todo el mapa es consejo y journal. Ningún día de esta tabla autoriza a Jev a ejecutar un grant, una atenuación o un promote. El PR de runtime que siga, si Anthony lo pide, toca el constructor del desk y el journal. No toca `authorize()`, Bind, `patch.yml`, ni el catálogo de connectors.

Dependencia honesta: el dual-run del ranker con body estructurado vive en el memo de wire. Si ese PR aún no está, el día 60 del ranker espera. Los otros cuatro modos no lo necesitan para journalizar margen, vocabulario y `execute_ok`.

| Potencia | 30 días | 60 días | 90 días |
|----------|---------|---------|---------|
| **1. Ranker** | La fila guarda `probabilities` cuando existen, el id del runner-up y su blast. Sin distribución, M3–M7 = handoff. Piso intacto. Shadow, sin acto | Dual-run sobre inputs reales del desk, cuando el PR de wire esté. Comparar choice y `floors_ok`. Contar cuántas veces el runner-up más estricto habría cambiado el handoff | El runner-up más estricto queda en la regla de `show_ok`. Si en 60 días nunca cambió una decisión, el gate se documenta como inerte y se retira, y las `probabilities` siguen en el journal |
| **2. Márgenes** | Toda fila lleva `margin_id` M0–M7. Debajo del piso: menor blast ya escrito. Cero constantes nuevas | Tabla por margen: n, desacuerdos con el humano, listón propuesto ≥ piso. Anthony tiene que aceptar la tabla para que exista | Listón por margen solo donde hubo tabla. El resto se queda en handoff siempre. Un margen sin efecto sobre decisiones se retira |
| **3. Sorter** | Enum P1–P9 en el checklist del Leader. P8 y P9 fuera. Prefiltro a 2–4. Un ejemplo trabajado por superficie (§4), a mano, sobre la cola real de esa semana | ¿El ítem que salió primero fue el que de hecho desbloqueó? Journal de acierto/fallo. Si el prefiltro mete P9, es bug de CODE, no un desacuerdo de Jev | Los pesos del caller se ajustan con ese journal. Siguen en código. Un peso no crea un grant |
| **4. Honestidad** | Vocabulario de tres tokens. Hash ausente → `claim_unsupported` sin POST. Checklist manual sobre los próximos briefs de frontier antes de anunciarlos | Muestra de frases frente a artefactos. Contar `evidence_binds` que Anthony considere excesivos | El modo sigue siendo journal, salvo que Anthony acepte otra cosa con esa muestra en la mano. No se vuelve check de merge. Si los falsos `evidence_binds` no son raros, se queda en journal y no se anuncia con él |
| **5. Cadencia** | Tabla de legalidad (§8) como allowlist. Campos `advice_expires_at`, `feature_digest`, `execute_ok: false`. Atenuación en sombra. Timing de canary en journal. El anillo no se mueve | Auditar POST/día. Un día disparado por reloj de pared con features quietas falla el modo. Cero unloads atribuidos a una fila de Jev. Cero promotes en el mismo proceso que un timing advice. Flapping anotado | `ready_for_review` puede vivir en la cola de review de Anthony, como enlace. El botón de promote sigue en el review. La atenuación sale de la sombra solo bajo las condiciones ya escritas en G47 (co-fuego de CODE o HITL). Este memo no adelanta esa salida |

### Puertas que cierran el modo

| Señal | Consecuencia |
|-------|--------------|
| Una fila con `execute_ok: true` y origen Jev | El lane se detiene. Review de import graph |
| `source: jev` o `attestor: jev` en un grant, una admisión o un pin | Igual. Espejo del deny `atena-cannot-grant` |
| Import de Jev o Atena en `authorize()`, pin verify o Bind | Igual |
| Un digest de anillo admitido cambia en el mismo proceso que `canary_timing` | El modo de timing se detiene |
| Un unload o un revoke cuyo único motivo es la fila de Jev, sin co-fuego ni HITL | El modo de atenuación vuelve a sombra, o se retira |
| POST en ventana sana | Falla de cadencia. No se “aprovecha ya que llamamos” |
| Segundo POST con el mismo digest y la pregunta reescrita | Falla anti-spam |
| Un estado de paso con calificativo en el journal o en el brief | Falla de honestidad. La fila se reescribe a `hold_for_human` o a `claim_unsupported` por CODE, sin otro POST |
| Bajar 0.55 o 0.5 para que un margen nuevo aplique | Rechazo. El margen se apila encima o no existe |

### Qué cabe en un PR de código posterior, y qué no

Cabe: campos de journal, enums, el rechazo previo de tokens prohibidos, leer `probabilities`, `execute_ok: false`, la allowlist de disparadores, líneas `would-attenuate`.

No cabe: un servicio nuevo `abaco-potentialities`, un plugin por modo, una clave de API dentro del tip, un check de CI que llame a Typesafe, un movimiento de anillo, un breaker disparado por la fila, abrir connectors.

---

## 12. Qué no hace este memo

- No implementa el desk ni el pulse.
- No baja el piso, no mueve el pin, no adopta `jev-latest`.
- No reabre F1, no reabre el wire, no reabre la aritmética de los 15 s.
- No abre marketplace ni saca connectors de HOLD.
- No pone a Jev ni a Atena en `authorize()` ni en Bind.
- No ejecuta grants, atenuaciones ni promotes.
- No declara una suite stress A–E que este árbol no contiene.
- No mezcla el lane BTC.
- No trata un T0/T1 sin Phase S como si el radar lo aislara.
- No usa un veredicto de paso con calificativo para describir sus propias puertas.

---

## 13. Checklist de review

- [ ] Cinco modos, un desk, un cupo. Cero plugin nuevo en este PR.
- [ ] `execute_ok` descrito como falso en toda fila de Jev. `apply_ok` no se reinterpreta como acto.
- [ ] P1–P9 cubren la taxonomía. P8 y P9 no tienen llamada.
- [ ] M0–M7 cubren los márgenes. M3–M7 no se ejecutan desde Jev.
- [ ] Atenuación: un `plugin_id`, caducidad de CODE, Janice solo tras co-fuego o HITL.
- [ ] Canary: `ready_for_review` no mueve el anillo. `widen` no llama a Jev.
- [ ] Ventana sana = silencio. 15 s de reloj de pared sigue rechazado.
- [ ] Honestidad: tres tokens. Hash ausente, sin POST. Sin estado de paso con calificativo.
- [ ] 0.55 y 0.5 intactos. Cero constante nueva tomada de un ejemplo de TypeSafe.
- [ ] Naming: Jev rankea, Atena fuera de estos modos y de `authorize()`, Janice ejecuta lo ya autorizado.
- [ ] F1 cerrado. Connectors en HOLD. Sin marketplace.

---

## Fuentes

Repo:

- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)
- [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md)
- [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md)
- [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md)
- [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md)
- [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md)
- [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
- Seed del Leader, 2026-09-22: cinco modos cotidianos (fork ranker, gray-band, sorter, honesty, ritual pulse). Este memo es el estrés de ese seed.

El wire de System One (state objeto, noul por opción, `probabilities`, jaggedness de `jev-1.13`) se cita vía el memo de integración. Este lane no volvió a llamar a la API ni a re-auditar `docs.typesafe.ai`.
