# Jev — fórmula del sweet spot cotidiano (márgenes de error)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — fórmula operativa para Leader. **Sin** runtime, **sin** `authorize()`, **sin** `patch.yml`, **sin** cliente nuevo |
| **fecha** | 2026-09-22 |
| **teatro** | Mesa técnica Abaco (`decide_tech` / `advanced_v1`) + trabajo diario Deep Core / Harnes. El pulse de seguridad sigue en su piloto; esta página no lo reabre |
| **modelo** | Pin `jev-1.13.0`. `jev-latest` y `jev-preview` apuntan hoy al mismo id y **no** se usan para umbrales |
| **naming** | **Jev** rankea. **Janice** ejecuta. **Atena** aconseja. **Bind** niega en CODE. Jev **nunca** otorga |
| **pisos** | **Candado:** `choice_confidence ≥ 0.55` y `safe_noul ≥ 0.5`. Este memo **no** los baja |
| **árbol** | `decide_tech.py`, `UPGRADE-advanced-v1.md` y `historial/` **no** están en Deep Core. El contrato de cuerpo que Leader debe usar es el de [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) §G |

El sweet spot es el corte en el que un número de Jev **cambia el orden de un trabajo técnico** que CODE no puede cerrar, y ese número se queda en journal o en un camino reversible. Grant, PASS y calma quedan fuera de ese corte.

Por debajo de los pisos, el camino es el contrato más estricto. Por encima de los pisos, el piso solo dice que auto-aplicar **no está prohibido**. El uso cotidiano apila bandas más altas. Esas bandas son **propuesta** hasta que el journal las calibre. Bajar 0.55 o 0.5 para “hacer útil” una llamada rompe el candado.

---

## 0. Leyenda

| Marca | Significado |
|-------|-------------|
| **CANDADO** | No se mueve en este memo ni en un journal corto |
| **PLAN** | Regla ya escrita (PLAN de mesa, 2026-09-21; pulse firmado 2026-09-22). Sigue vigente como mínimo legal |
| **PROPUESTA** | Sweet spot cotidiano. Más estricto que el piso. Se revisa con journal; no es ley hasta un corte de calibración explícito |
| **ILUSTRACIÓN** | Número de un ejemplo TypeSafe u otro dominio. No es umbral Abaco |

---

## 1. Fórmula

Una llamada existe solo si el pre-gate de CODE da `CALL`. Una sola petición `POST /v1/systemone` con las preguntas ya conocidas (fan-out). El `if` que aplica vive en código.

```text
CALL =
    fork_técnico                 # ≥2 caminos, o ≥3 residuales cuyo orden no está escrito
    AND code_no_decide           # no es aritmética, fecha, conteo, grep, assert ya verde/rojo
    AND conjunto_cerrado         # cada opción tiene what / not_for; existe hold_for_human
    AND sin_trip_determinista    # flags de grant, authorize, patch.yml, Bind, rehab = false
    AND clase ∈ {J, A}           # J = journal reversible; A = luego puede tocar admisión o anuncio de PASS
    AND presupuesto_ok           # §7
    AND no_es_duplicado          # mismo digest de state + mismos ids, ventana anti-spam

# Mínimo legal. CANDADO. No bajar.
APPLY_OK =
    answers_present
    AND choice_confidence ≥ 0.55
    AND safe_noul         ≥ 0.5          # noul de la opción elegida, no 1 − otro noul
    AND NOT candado_conflict             # lo calcula el código, no la frase del modelo
    AND choice ≠ hold_for_human

# Sweet spot de auto-aplicación. Solo clase J. PROPUESTA apilada encima del candado.
SWEET_AUTO =
    APPLY_OK
    AND choice_confidence ≥ 0.75
    AND safe_noul         ≥ 0.80
    AND max(probabilidad de otra opción) ≤ 0.25
    AND clase = J

# Clase A: Jev puede rankear. SWEET_AUTO = false siempre.
# Quien ya tiene el carril (Leader / autopilot escrito) ejecuta. Jev no mergea ni otorga.

# Piso pasado y SWEET_AUTO falso → journal + HITL. apply auto = false.
# Piso no pasado → contrato más estricto. No se “completa” con otra llamada.
```

`safe_noul` es el `noul` de `locks_hold__{choice}`. Si esa clave no vuelve, el código escribe `0` y `APPLY_OK` queda falso. No se fabrica con `1 - hazard_noul` (jaggedness #8 de `jev-1.13`).

El composite (`evidence_fit`, `reversibility`, pesos en código) **no sube** `APPLY_OK`. Puede mandar un caso de clase J a HITL. Hasta haber etiquetas, el composite no entra en `SWEET_AUTO`: se journaliza y se queda fuera del booleano. Así no se porta el 0.55 del Choice a un Score.

### Qué hace cada banda

| Situación | Choice `confidence` | `safe_noul` | Efecto |
|-----------|---------------------|-------------|--------|
| Bajo piso | `< 0.55` **CANDADO** | o `< 0.5` **CANDADO** | No aplicar. Contrato más estricto. Journal |
| Piso legal, fuera del sweet spot | `≥ 0.55` y `< 0.75` | o `≥ 0.5` y `< 0.80` | **PLAN** permite auto en clase J. **PROPUESTA** cotidiana: HITL, no auto. Es la zona de falsa calma |
| Sweet auto | `≥ 0.75` **PROPUESTA** | `≥ 0.80` **PROPUESTA** | Auto solo clase J, y solo si ningún rival pasa de 0.25 **PROPUESTA** |
| Rival con masa | cualquiera ≥ piso | cualquiera ≥ piso | Si otra opción tiene probabilidad `> 0.25` **ILUSTRACIÓN TypeSafe / PROPUESTA Abaco**, HITL. El 0.25 no es piso |
| Clase A | aunque sea 0.99 / 0.99 | | Rankeo en journal. Auto = false. Humano o carril ya escrito |
| `hold_for_human` o conflicto de candado | cualquiera | cualquiera | Auto = false |
| HTTP 401 / 422 / 429 / 529 / timeout | — | — | Fila `apply_ok: false`, `jev_unavailable` o `jev_rejected`. Reintento con backoff solo en 429/529. Agotar reintentos sigue siendo no-apply |

La frase del PLAN (“si `confidence ≥ 0.55` y no choca candado, Leader ejecuta sin preguntar a Anthony”) sigue siendo el **mínimo legal** de la mesa. El sweet spot cotidiano es más estrecho: entre 0.55 y 0.75 el número ya no es “incumple”, y todavía no es “actúa”. Tratar 0.56 / 0.51 como luz verde es el uso que gasta tokens para darse calma.

### Noul, aparte del Choice

Un Noul no trae `confidence`. El número **es** la probabilidad de la frase escrita. Cerca de 0.5 es empate sí/no.

| `noul` de “esta opción se queda dentro de los candados” | Marca | Lectura |
|----------------------------------------------------------|-------|---------|
| `< 0.20` | **ILUSTRACIÓN** TypeSafe (`NO = 0.2`) | La frase escrita sale “no”. No otorga lo contrario |
| `≥ 0.20` y `< 0.50` | bajo el **CANDADO** 0.5 | No aplicar. Aún no es el “no” claro del ejemplo |
| `≥ 0.50` y `< 0.80` | sobre el piso, dentro del ejemplo TypeSafe de revisión (`YES = 0.8`) | **PROPUESTA:** HITL |
| `≥ 0.80` | **PROPUESTA** de “sí” a la frase | Hace falta además el Choice en banda alta. Sigue sin ser grant |

Esos 0.20 y 0.80 salen del ejemplo de soporte de [Noul](https://docs.typesafe.ai/primitives/noul) (mensaje de escalado 0.99 / 0.93; “reset password” 0.07). No son ley Abaco. El único noul que es ley aquí es **no aplicar por debajo de 0.5**.

No se reutiliza 0.55 como umbral de Noul. No se reutiliza 0.80 como umbral de Choice. Cada pregunta tiene su corte ([jaggedness #8](https://docs.typesafe.ai/model-jaggedness/jev-1.13)).

---

## 2. Árbol de decisión

```text
¿El efecto es grant, authorize(), Bind, patch.yml, rehab del disabled set,
 notarize, credencial, o escribir ~/Library/Application Support/dsh-desktop/?
        sí → CODE / HITL Anthony. No hay POST
        no ↓
¿CODE ya tiene el veredicto (assert, grep de import, digest, cuatro asertos,
 aritmética, fecha, conteo, TTL, presupuesto)?
        sí → ejecutar CODE. Un POST solo añadiría calma
        no ↓
¿Hay una sola opción legal, o la doctrina ya nombra el camino
 (p. ej. “falta de canary = GAP”, “flag de flota = FAIL”)?
        sí → escribir ese veredicto. No hay POST
        no ↓
¿El anuncio que saldría de la llamada sería un PASS / HOLD de un candado
 (blast, admisión, “Jev está fuera”)?
        sí → clase A. POST permitido para rankear; SWEET_AUTO prohibido
        no → clase J
        ↓
¿Presupuesto del día y anti-spam dejan la llamada?
        no → contrato más estricto, sin POST
        sí → un POST advanced_v1 (§6)
              ↓
        bajo piso → contrato más estricto
        piso sí, sweet auto no → journal + HITL
        sweet auto (solo J) → Leader sigue ese camino
        clase A con números altos → el carril humano ya autorizado decide; el JSON no mergea
```

---

## 3. Márgenes de error

`confidence` no es un intervalo de error. Es un resumen de lo picuda que está `probabilities`. [Confidence](https://docs.typesafe.ai/confidence) dice que el estadístico exacto no está fijado en esa página; el demo de tres opciones aproxima `(3 × p_max − 1) / 2`, que es `(K × p_max − 1) / (K − 1)` para `K = 3`. La tabla siguiente usa **esa aproximación del demo** para mostrar un hueco. No es la fórmula de producción de TypeSafe.

| K opciones | `confidence ≥ 0.55` implica, en el demo | ¿Cabe un rival `> 0.25`? |
|------------|------------------------------------------|---------------------------|
| 2 | `p_max ≥ 0.775` (rival ≤ 0.225) | No. El 0.25 queda por debajo del piso |
| 3 | `p_max ≥ 0.700` | Sí. Ejemplo: 0.70 / 0.25 / 0.05 → confidence de demo = 0.55 |
| 4 | `p_max ≥ 0.6625` | Sí. Ejemplo: 0.67 / 0.26 / 0.04 / 0.03 → demo ≈ 0.56 |

Con `hold_for_human` el Choice tiene como mínimo 3 opciones. Ahí un `confidence` de 0.55 puede esconder un segundo camino al 0.25. El sweet spot **lee `probabilities`**. Quedarse en el escalar es el agujero que el wrapper de strings ya tiene.

| Margen | Qué mide | Cómo se usa |
|--------|----------|-------------|
| `confidence` | Forma de la distribución del Choice o del Score. No es P(correcto) | Piso **CANDADO** 0.55 en el Choice. Banda alta **PROPUESTA** 0.75 |
| `\|noul − 0.5\|` | Distancia al empate sí/no. En 0.51 el margen es 0.01 y el piso **igual pasa** | Sweet spot **PROPUESTA:** margen ≥ 0.30, o sea `noul ≥ 0.80`, para auto de clase J |
| `p_ganador − p_segundo` | Separación real | Se journaliza. No sustituye al piso |
| `rival > 0.25` | Masa en otra opción | **PROPUESTA** de HITL. Origen: ejemplo de copia de ticket en TypeSafe, no constante G47 |
| Wilson 95 % del cubo etiquetado | Error de calibración del uso Abaco | **PROPUESTA** de revisión. No mueve 0.55 ni 0.5 |

### Qué no es un margen

- `conviction_score` interpolado entre dos niveles. [Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13): el Score no reconstruye una magnitud exacta.
- `confidence == 1`. Describe la distribución, no la verdad.
- Un Noul alto en una frase con dos condiciones y una negación (“does NOT expand authority **and** respects Janice/Atena”). El número significa menos. Una proposición por Noul.
- ECE, Brier o “±X %” de Abaco. **No hay journal etiquetado en este repo.** Inventar un ECE de mesa sería falsa precisión.

### Evidencia externa (no es piso, no es Abaco)

TypeSafe no publica ECE ni Brier en la página de Confidence. El texto oficial es: el umbral correcto depende del dominio y del rendimiento en **tu** caso; se empieza conservador y se mueve con datos propios.

Mediciones de terceros, distintas entre sí, consultadas 2026-09-22:

| Fuente | Qué reporta | Lectura para la mesa |
|--------|-------------|----------------------|
| [learnjev.com/concepts/calibration](https://learnjev.com/concepts/calibration) | ECE 0.0204 en CLINC150 y 0.0936 en Banking77 (sobreconfianza). En 126 filas con confidence ≥ 0.9, acierto 72.2 %. El umbral óptimo pasó de 0.67 a 0.37 entre datasets. Por debajo de ~100 filas etiquetadas por pregunta, no esperar portabilidad | Un 0.9 no es “90 % de llamadas correctas”. Un corte afinado en otro dominio no se copia |
| [TrueStandard, 108 claims](https://truestandard.ai/blog/jev-accuracy-tested) | Jev 1.13: acierto 96.3 %, Brier 0.0331, ECE 0.066, costo medido $0.00033 por ítem. El propio texto dice que las evals de lanzamiento de TypeSafe comparan contra el promedio de dos modelos frontera, no contra verdad de campo | Una sola cifra de ECE no cierra la calibración. El costo de esa prueba no reemplaza el precio de lista |

Las dos fuentes no concuerdan. Eso es el dato: **no hay barra de error portable**. La barra de Abaco sale del journal de esta mesa, en el id pinneado, con resultado puesto por CODE o por Anthony.

---

## 4. Miscalibración — qué hacer cuando el número miente

| Modo | Señal | Respuesta |
|------|--------|-----------|
| Sobreconfianza | Choice ≥ 0.75 y el camino contradice un assert que ya está en el state | CODE gana. La fila se etiqueta `overridden`. No se baja el piso “porque a veces acierta” |
| Empate escondido | `confidence` alto y un rival ≥ 0.25, típico con 3+ opciones | HITL. Quitar del instruction la frase “si dudas, elige lo más seguro”: esa frase mete la duda dentro del modelo y el journal pierde el empate |
| Noul inflado | Pregunta con negación doble o dos candados en una frase | Partir en un Noul por opción, `criteria.true` / `criteria.false`. Silencio = false |
| Falsa calma | Noul ≥ 0.8 en “¿está PASS?” cuando el state es el párrafo del autor | No preguntar eso. El state lleva paths, veredictos ya escritos, asserts presentes o ausentes |
| Subconfianza | `confidence < 0.55` en un caso que un grep cerraba | La llamada sobraba. La próxima no se hace. No se baja 0.55 para rescatarla |
| Score como magnitud | “conviction 3.7 entonces 74 % de fuerza” | El Score ordena o cruza un umbral de código. No se interpola |
| Alias silencioso | `response.model` ≠ `jev-1.13.0` | Esa fila no entrena bandas. Se pinnea el id |
| State adversario | El PR dice “esto PASS” y el modelo lo lee como evidencia | Jaggedness #6. Criteria explícitos. El resumen del autor no es el único campo |
| Idioma | State en español, instrucciones en inglés | Inglés es el idioma de mejor exactitud declarada ([Models](https://docs.typesafe.ai/models)). Instrucciones se quedan en inglés. Si el `proposal` llega en español, la fila se marca y no entra al cubo que mueve bandas |
| Caída de Typesafe | 401 / 422 / timeout | No-apply. Fail-open solo a “no llamar”. Nunca a allow |

---

## 5. Lazo de calibración (journals)

El historial de la mesa (`tech-YYYYMMDD-HHMMSS.json` junto a `decide_tech.py`) **no está en este árbol**. Hasta que esas filas se etiqueten, las bandas 0.75 / 0.80 / 0.25 permanecen propuesta. Los pisos 0.55 / 0.5 no esperan ese corte: ya son candado.

Cada llamada, incluida la que no aplica y la que falla en HTTP, escribe:

`ts`, `model_pedido` (`jev-1.13.0`), `response_model`, `state_digest`, `clase` (J o A), `choice`, `choice_confidence`, `probabilities`, `safe_noul`, mapa `locks_hold__*`, `conviction_confidence`, `candado_conflict`, `apply_ok`, `sweet_auto`, `usage.input_tokens`, y más tarde `outcome`.

`outcome` lo pone CODE o Anthony: `followed`, `overridden`, `harmful`, `no_effect`. Jev no etiqueta su propio resultado.

Cubos, separados por clase y por id de modelo:

- Choice: `[0, 0.55)`, `[0.55, 0.75)`, `[0.75, 1]`
- Noul: `[0, 0.20)`, `[0.20, 0.50)`, `[0.50, 0.80)`, `[0.80, 1]`

**PROPUESTA de revisión** (no mueve candados):

1. Hace falta `n ≥ 30` filas de clase J **en el cubo de auto**, mismo `response_model`, con `outcome` de humano o de assert.
2. Intervalo de Wilson 95 %. Para 24/30 aciertos (proporción 0.80, `z = 1.96`) el intervalo cae cerca de **0.63–0.90**. Treinta filas no alcanzan para afinar un piso.
3. La banda de auto se **sube** (más HITL) si la cota baja de Wilson de ese cubo es `< 0.75`.
4. La banda de auto se puede **bajar hacia el piso**, nunca por debajo de 0.55 / 0.5, solo si la cota baja de Wilson es `≥ 0.90` en `n ≥ 30`.
5. Un id de modelo nuevo vacía los cubos. `jev-latest` no hereda las etiquetas de `jev-1.13.0`.

Ejemplo numérico del paso 2, para no tratar 30 filas como ciencia cerrada: Wilson con `z = 1.96`, `n = 30`, `p̂ = 0.80` da un intervalo cercano a 0.63–0.90. Un cubo así deja la propuesta 0.75 quieta, y el candado quieto.

Ritual semanal de Leader, en CODE, sin otra llamada a Jev: contar `CALL` / `SKIP` / duplicados / `$` desde `input_tokens`, y cuántos anuncios de PASS citaron un `choice` en vez de un assert. Duplicados `> 30 %` de las llamadas del día, o más de 12 llamadas de mesa, es spam de proceso.

---

## 6. `advanced_v1` en las rutinas de Leader

El PLAN de mesa (2026-09-22 12:06 ET) nombra `advanced_v1`: pisos iguales, paper only, detalle en `UPGRADE-advanced-v1.md`. Ese archivo no está en Deep Core. La auditoría de cable ([`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md)) describe el wrapper que sí se revisó: state en un solo string, criteria `"Choose {o}"`, un Noul para “the chosen path”, Score con objeto `"1"`–`"5"`, `apply_ok = conf >= 0.55 and noul >= 0.5`, y el conflicto de candado solo dentro del string `rule`.

Las rutinas de Leader usan el cuerpo **estructurado** de esa auditoría (§G), no el cuerpo de strings:

1. **CODE antes del POST.** Si `mints_grant`, `enters_authorize` o `writes_patch_yml` es verdadero, no hay llamada. `apply_ok = false`.
2. **State objeto.** `proposal.summary`, flags, `locks`. Sin transcripciones, sin secretos, sin `patch.yml`, sin la card de la API. Paths entre backticks: `` `proposal.summary` ``, `` `locks` ``.
3. **Choice con rúbrica.** Cada opción es `{what, not_for, examples}`. Siempre `hold_for_human` si la lista puede no cubrir. Sin `"Choose X"`. Sin “if unsure, prefer deny” dentro del instruction.
4. **Un Noul por opción** en la misma llamada: `locks_hold__{id}`, `criteria.true` y `criteria.false` como objetos. Valor alto = la opción **se queda** dentro de los candados listados. Silencio = false.
5. **Score, si hace falta, como array de situaciones** (`evidence_fit`, `reversibility`). Índice desde 0. El journal marca `score_scale: "level-index-0"`. Pesos del composite en código. Un Score no ve el `choice` de otra pregunta.
6. **Una sola petición.** Pin `"model": "jev-1.13.0"`. Se lee `answers`. Un `confidence` ausente cuenta como 0.
7. **`APPLY_OK` con el candado intacto**, más `SWEET_AUTO` de §1. `probabilities` siempre al journal.
8. **Errores** journalizados en fail-closed. Ningún allow.
9. **La rutina no se importa** desde `authorize()`, Bind, admisión ni pin. Janice no interpreta el JSON.

El cuerpo de strings puede seguir en shadow el tiempo que el dual-run de la auditoría pide. No es el cuerpo con el que Leader auto-aplica. Un dual-run que afloje el piso (más `apply_ok` true que el cuerpo viejo, a igualdad de state) se queda en shadow.

---

## 7. Presupuesto de un día de Leader

Precio de lista, [Models](https://docs.typesafe.ai/models), `jev-1.13.0`, leído 2026-09-22:

| Pieza | Valor |
|-------|--------|
| Precio | **$0.042 / millón de tokens de entrada**. Salida gratis. Un Mtok es un millón; un Btok es mil millones ($42) |
| Contexto | 64k tokens por request (state + todas las preguntas). 32k para state + la pregunta más larga |
| Cupo publicado | 250 000 tokens/s y 1 200 requests/min. La misma página dice que el cupo se mueve sin aviso |
| PLAN de mesa | ~$0.0001–0.0002 por llamada corta. A $0.042/Mtok eso es ~2 400–4 800 tokens de entrada. Sigue siendo un orden de magnitud creíble para el cuerpo corto |

Estimación de esta página (no es un `usage` medido aquí; no se llamó a la API):

| Cuerpo | Tokens de entrada | $ / llamada |
|--------|-------------------|-------------|
| Strings, 3 preguntas, state corto | 1 500–4 000 | $0.00006–$0.00017 |
| `advanced_v1` (Choice + 3 Nouls + 2 Scores) | 3 000–8 000 | $0.00013–$0.00034 |

| Día | Llamadas | Tokens | $ |
|-----|----------|--------|---|
| Sweet spot de Leader, 8 × ~6k | 8 | 48k | **~$0.002** |
| Tope propuesto, 12 × 8k | 12 | 96k | **~$0.004** |
| Pulso a 40/h durante 8 h, 4k c/u | 320 | 1.28M | ~$0.054 |
| Guardian cada 15 s, 4k c/u | 5 760 | 23.0M | **~$0.97 / instancia / día** |

El dólar no es el freno de la mesa. El freno es el journal que nadie lee y el PASS que se apoya en un 0.62.

**PROPUESTA — presupuesto de un día de Leader** (distinto del cap de pulso):

| Tope | Número | Si se cruza |
|------|--------|-------------|
| Llamadas de mesa | **12** | El resto del día es CODE |
| Dólares de mesa | **$0.05**, contados con `usage.input_tokens × 0.042 / 1e6` | Igual |
| Ritual de Leader | **≤ 2** preguntas delgadas (apertura del día, y antes de anunciar un veredicto), y solo si §2 ya dijo `CALL` | Un tick de 90 s no es rutina de Leader |
| Duplicado | Mismo `state_digest` + mismos ids de opción en **6 h** | Se reusa la fila. No hay segundo POST |

**PLAN / piloto de pulso, intacto:** base 60–90 s (preferencia Deep **90 s**), `interval_min` 15 s solo bajo stress, cap **40 Jev/h** por instancia, costo de punta `< $5 / semana`, mayoría de ventanas **sin** Jev. Ese cap no es licencia para 40 decisiones de Leader por hora. Quince segundos fijos en la flota sigue rechazado.

A 12 llamadas y $0.05, un día de Leader cuesta menos que una hora del guardian de 15 s. La escasez es a propósito: cada POST tiene que cambiar un orden que CODE no cerró.

---

## 8. Anti-spam

| Regla | Por qué |
|-------|---------|
| Una petición, todas las preguntas | La segunda llamada “para que el Noul vea el choice” está fuera de contrato: las opciones ya se conocen |
| No confirmar un verde | Re-preguntar M1–M10 después del suite es calma, no rankeo |
| No preguntar el rojo que el log ya nombra | `typecheck` en main está rojo **a propósito** y no es gate (`.github/workflows/desktop-ci.yml`) |
| Ventana de 6 h por digest | El mismo fork no se re-rankea para subir el número |
| Clase A no entra en el cupo de auto | Rankear sí; “Jev dijo merge” no suma una llamada extra para convencerse |
| Pulso: duda o empate, no tick | La mayoría de ventanas sin Jev es gate del piloto |
| State corto | Jaggedness #5: el relleno baja la exactitud y sube el token |
| Instrucción atómica | Una pregunta con tres juicios devuelve un número que no se sabe descomponer, y se vuelve a llamar |

---

## 9. Matriz de las cinco modos

Los cinco modos del seed de Leader (2026-09-22) entran por la misma fórmula. No son cinco clientes.

| Modo | `CALL` cuando | Quién cierra | Ejemplo de skip |
|------|----------------|--------------|-----------------|
| **1. Fork ranker** | ≥2 caminos técnicos, doctrina muda, conjunto cerrado | `SWEET_AUTO` solo clase J; clase A → HITL | “¿soft-apply o deny?” si el disabled set ya dice deny |
| **2. Radar de margen** | El piso pasa y el sweet auto no, o hay rival > 0.25 | HITL. El número se journaliza, no se anuncia | Pedir otro POST para “aclarar” el mismo state |
| **3. Triage** | ≥2 rojos o ≥3 GAP residuales, y el orden no sale del log | Clase J si el orden solo abre el siguiente PR de evidencia; clase A si el orden cambia admisión o un PASS | Elegir entre un gate y un `tsc` que CI ya ignoró |
| **4. Detector de PASS blando** | Alguien va a decir PASS y el assert no está | Casi siempre **skip**: el veredicto es GAP / PARTIAL / HOLD escrito. POST solo si hay dos lecturas de contrato que no chocan candado | “¿Jev confirma que Phase S está PASS?” |
| **5. Pulso de cadencia** | Ventana 60–90 s **y** features en banda de duda, bajo el cap 40/h | CODE en el trip duro; Jev solo en el empate | Tick de 15 s en quiet |

Tip-of-spear: el modo 1 no elige “congelar admitidos para estar más seguro”. Esa opción no entra al Choice. El modo 4 existe para que un rankeo no reescriba GAP como PASS.

---

## 10. Ejemplos trabajados (realidad Abaco)

Ningún ejemplo de esta sección es una respuesta observada de System One. Donde aparecen 0.62 o 0.91, son **ilustración de banda** para mostrar el `if`. No se llamó a la API para escribir esta página.

### 10.1 Triage de CI

Hechos en el árbol y en el historial de PRs:

- El workflow que corre es `.github/workflows/desktop-ci.yml` en la raíz. Un workflow anidado bajo `desktop/src/dsh-desktop/.github/` no corre.
- El propio workflow dice que `npm run typecheck` **ya está rojo en main** (errores previos en tests de voice / observability / browser) y **no** es gate.
- La serie de PRs #24–#28 fue el mismo fallo de empaquetado: el cliente de analytics no estaba en la tabla de módulos de Cordis y el boot de 0.4.22 moría. Cinco parches competían. El que cierra el rojo es el que materializa el módulo (PR #28, merged). El log ya decía module-table / `MODULE_NOT_FOUND`.

| Pregunta | Veredicto de la fórmula |
|----------|-------------------------|
| “¿Arreglo typecheck o el contract test rojo?” | **SKIP.** CODE ya sacó typecheck del gate. Llamar a Jev para ponderarlo gasta la llamada en un rojo que no bloquea la punta |
| “De estos cinco parches de analytics, ¿cuál?” cuando el log nombra la tabla de módulos | **SKIP.** Un solo camino cierra el assert. Los otros cuatro son historia |
| Dos contract tests rojos a la vez, los dos son gate, y el log no dice cuál desbloquea admisión (pin de digest vs contador de deny) | **CALL**, clase J, modo 3. Opciones: `pin_first`, `deny_counter_first`, `hold_for_human`. State = nombres de test + primera línea del fallo, no el ensayo del PR |

Ilustración, no observada: `pin_first` con confidence 0.62, `deny_counter_first` en 0.27, `safe_noul` 0.71. Piso legal (0.62 ≥ 0.55 y 0.71 ≥ 0.5). Sweet auto **no**: 0.62 < 0.75 y el rival 0.27 > 0.25. Efecto propuesto: journal + HITL, no abrir el PR “porque Jev eligió el pin”.

### 10.2 Broker: GAP frente a PASS

[`reports/GAP-F1-MEDIACION.md`](../../reports/GAP-F1-MEDIACION.md) describe el hueco **antes** del cierre (rama vieja 46 atrás, M3–M10 incompletos). [`docs/STATUS-F1-MEDIACION.md`](../STATUS-F1-MEDIACION.md) y [`docs/contracts/MATRIX-F1-DAY14-ACCEPTANCE.md`](../contracts/MATRIX-F1-DAY14-ACCEPTANCE.md) son el cierre: M1–M10 deny con razón de contrato, `side_effect: false`, audit, `denyCount++`.

Ese PASS **no** se re-pregunta. Lo que sigue abierto está escrito, y no es un soft-PASS:

| Residual | Veredicto ya escrito | ¿Jev? |
|----------|----------------------|-------|
| E2 espejo Python del mismo STT | **N-A** (la voz mediada es el camino TS; `core/voice/` no llama `authorize()`) | SKIP. N-A no se promociona |
| A2 contención | **PASS** en la celda / **PARTIAL** en Electron. L4 es smoke en el Mac | SKIP. PARTIAL ya es el veredicto honesto |
| E4 retiro del piloto | **PASS** in-process. L3 es smoke en la app instalada | SKIP |
| A3 revoke ≤ 1 s | **PASS** en el test síncrono. L5 es el UI | SKIP |
| `PINNED_MCP_SCHEMAS` vacío (`Object.freeze({})` en `abaco-mcp-schema-pin`) | Terceros sin witness. Honestidad del memo de defensa §0.2 | SKIP. La pregunta “¿el pin de MCP está PASS?” no se manda |

**CALL** (modo 4, clase A) solo si un PR dice “GAP cerrado” y el diff no muestra los cuatro asertos. Opciones: `keep_gap`, `accept_pass`, `hold_for_human`. El state lista qué asserts existen (`decision`, `side_effect`, audit, contador), no la frase “this closes the gap”. `accept_pass` con un assert ausente es `candado_conflict` en código: `APPLY_OK` falso aunque el modelo devuelva 0.95.

### 10.3 Merge ahora o esperar (solo técnico)

El PLAN de mesa nombra este fork: merge ahora frente a esperar otro test, en el carril que el autopilot de Frontier ya permite por escrito. Jev no es ese permiso. Jev no pulsa el botón.

Hecho de hoy, fuera de `main`: PR #46 (`cursor/sweet-spot-stress-c-afc4`) implementa el pin de artefacto + SBOM. Su informe marca C1–C5 **PASS** y deja GAPs que no son PASS de otra cosa (firma de autor ≠ Sigstore, TCB del host fuera del hash del plugin, `tests/` y markdown fuera del sujeto). En `main` @ `820cc0d` ese pin **no** está: la admisión sigue en el digest del manifest.

| Opción | Qué es | Clase |
|--------|--------|-------|
| `merge_pin_now` | Entra el fail-closed de C2/C3 con los GAP nombrados | A — toca broker |
| `wait_sigstore` | No entra el pin hasta D6 | Fuera del Choice: es el freeze que la doctrina de punta prohíbe como “más seguro” |
| `wait_one_contract_test` | Esperar un test más que aún no está rojo | A, si ese test es real y no es typecheck |
| `hold_for_human` | Ninguna de las anteriores | siempre presente |

`wait_sigstore` no se le ofrece a Jev. Meterla y luego “confiar en que elegirá no congelar” es esconder la doctrina dentro del modelo.

Doctrina ya escrita: no congelar la evolución admitida mientras se espera una firma más fuerte, **si** los GAP quedan nombrados y CI del pin está verde. Cuando eso es todo el fork, **SKIP** — el camino ya tiene nombre. El POST aparece solo si `wait_one_contract_test` es un test de contrato concreto (por ejemplo el ángulo D “un % de banda gris no acuña cap”, que **no** está como test en `main`) y alguien sostiene que mergear el broker sin ese test rompe un candado. Eso es clase A: aunque la ilustración fuera confidence 0.91 y noul 0.88, `SWEET_AUTO` es falso. El merge, si ocurre, lo hace el carril humano ya escrito.

### 10.4 Ranking de GAP residuales del stress A–E

El plan de stress (brief del agente de Test C, no un archivo de este repo) define cinco pruebas. Estado comprobable desde `main` @ `820cc0d` más el PR #46 abierto. No hay informe merged de B, D ni E.

| Test | Qué exige el plan | Qué hay ahora | Residual que no es soft-PASS |
|------|-------------------|---------------|------------------------------|
| **A** mediación | Sin grant → deny; grant válido → allow; revocado → deny; canal cruzado → deny; tool expuesto ≠ autorizado; carrera | Matriz día-14: A1 **PASS**, A2 **PARTIAL** (celda / Electron). Cruce en el PR #46: `cordis.host` sin grant → deny, prompt y `advisor: jev` no otorgan | Smoke L3–L5 en el Mac. Electron sigue PARTIAL |
| **B** matar uno, no la flota | Unload de uno; freeze por feature-flag de la flota = **FAIL** de punta | K2 celda `strangler-fork` **PASS** en la matriz. No es `utilityProcess` de Electron | No hay informe de stress B en `main`. La doctrina ya marca el freeze de flota como FAIL |
| **C** digest + SBOM | Digest malo rechaza; tag igual con bytes distintos rechaza; SBOM ausente = fail-closed o **HOLD**; pin+SBOM admite; rename no es identidad | PR #46, no merged: C1–C5 **PASS**. Antes del corte, tag `0.1.0` con otros bytes y SBOM ausente admitían: **FAIL de C2 y de C3** | Firma ≠ Sigstore (D6). TCB host no re-hasheado. Markdown y `tests/` fuera del sujeto. Ids sin pin de manifest no los admite este corte |
| **D** Jev / Atena fuera de authorize | Cero Jev en authorize / mint; un % de banda gris no acuña; confidence alta sigue necesitando grant CODE; prompt ≠ grant | `authorize()` en `packages/abaco-effect-broker/index.js` documenta cero Atena. Un grep de `Jev` en ese archivo no encuentra el identificador. Día-14 C1 **PASS** para Atena | El test “gray-band % cannot mint” **no** está en `main`. Ausencia de test ≠ PASS de D |
| **E** anillo canary | Entrar, fallar ≠ admitir del todo, promover con gate, degradar. **Sin camino de canary = GAP, no soft-PASS** | D8 en el memo de defensa es apuesta de 90 días, no un path | **GAP.** El pin de C no es un anillo |

Pre-orden de CODE, sin POST. Sirve para no pedirle a Jev que reordene lo ya escrito:

1. **E** se anuncia **GAP**. Escribirlo es honestidad, no un fork.
2. **D** sin test de “no acuña” se cierra con un test. Es CODE.
3. **C** en `main` sigue con el agujero de C2/C3 hasta que #46 entre. Esperar Sigstore para tapar ese agujero es freeze. El informe de #46 ya nombra los GAP.
4. **A2** se queda **PARTIAL**. Un modelo no lo sube a PASS.
5. **B**: un PR que apague la flota con un flag no entra al Choice. Es FAIL de punta por doctrina.

El **CALL** que sí es sweet spot (modo 3, clase A) es el empate entre residuales que la doctrina no ordena, cuando solo cabe un PR siguiente y los tres son P1 en papeles distintos:

- `next_land_c` — entrar el pin ya verde en CI, GAP nombrados
- `next_write_e_gap` — dejar constancia de que no hay anillo, para que nadie diga “el pin cubre E”
- `next_hold` — no rankear todavía

`claim_e_pass` y `claim_a2_pass` no son opciones. Ilustración: si el modelo devuelve `next_land_c` a 0.81 con noul 0.84 y `next_write_e_gap` a 0.11, el sweet auto de **clase J** se cumpliría y el de **clase A** no. Efecto: journal; el humano decide el orden. Anunciar “Jev rankeó, entonces C está PASS y E también” es el fallo que el modo 4 existe para cortar.

### 10.5 Desk F7 — honestidad del HOLD

**Desk F7** aquí es la fila 7 de la tabla de honestidad en [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) §0.2. No es un id de contrato nuevo.

| # | Control | Conocido | No reclamado |
|---|---------|----------|--------------|
| 7 | **Phase S** | El brief dice que los providers de alto riesgo van en sandbox. Los docs de frontera nombran providers enchufables (subprocess / Wasm / container) detrás del mismo broker | La pregunta abierta 6 del paper sigue: los caminos in-process T0/T1 **no** ganan “blast = un plugin”. [`SECURITY.md`](../SECURITY.md) sigue listando el sandbox general como trabajo futuro. El memo no cierra eso por afirmación |

La pregunta que no se hace: “Jev, ¿Phase S está PASS y el blast es un plugin?”.

El veredicto escrito es HOLD de esa reclamación. Un Noul alto sería o una pregunta mal hecha (“¿el diseño es sano?”) o state que solo contiene el deseo. **SKIP.**

Si un borrador ya dice PASS, el detector no llama para confirmar. El código marca `candado_conflict` porque la fila 7 prohíbe la reclamación. Opciones si aun así se rankea la redacción, clase A: `keep_hold`, `schedule_isolation_pr`, `hold_for_human`. `claim_blast_one_plugin` no está en el conjunto. Ilustración extrema: confidence 0.95 y noul 0.90 sobre `claim_blast_one_plugin` seguiría con `APPLY_OK` falso por el conflicto que calcula el código.

La misma regla vale para connectors **HOLD**, Wasm/CAPMAS **HOLD**, y el SBOM ausente del Test C: HOLD es un veredicto, no una banda media esperando un porcentaje.

---

## 11. Qué no preguntarle a Jev

| # | No preguntar | Cierra en |
|---|--------------|-----------|
| 1 | ¿`authorize()` debe permitir? | CODE. Jev no vive ahí |
| 2 | ¿Acuñamos un grant, escribimos `patch.yml`, o ensanchamos caps? | HITL + ContractEvolution. El Choice no incluye `grant` ni `widen` |
| 3 | ¿Este % alto es el grant? | Nunca. `APPLY_OK` no es `source: jev` |
| 4 | ¿M1–M10 pasaron? | El suite. Ya está verde o no |
| 5 | ¿El typecheck rojo bloquea el merge? | CI ya dijo que no es gate |
| 6 | ¿Cuántos denies, cuántos tokens, qué fecha es posterior, el TTL venció? | Aritmética en código |
| 7 | ¿Rehab de brand / device-identity / cloud-sync / onboarding / experimental? | Disabled set. Rehab = FAIL |
| 8 | ¿Congelamos la flota por si acaso? | Doctrina. Es FAIL de punta |
| 9 | ¿Phase S / Desk F7 ya es “blast = un plugin”? | HOLD escrito. SKIP |
| 10 | ¿El anillo canary está PASS porque el pin de manifest existe? | E es GAP |
| 11 | ¿Este PARTIAL de Electron es PASS si el Noul es alto? | PARTIAL se queda |
| 12 | ¿Merge, notarize, credencial, borrar data, tocar `dsh-desktop`? | Fuera de la mesa. El autopilot escrito no se delega en el JSON |
| 13 | ¿Logo, copy, branding, gusto de producto? | Anthony |
| 14 | ¿El plugin dice que está sano? | Sensor de host. S8: el auto-reporte no es feature |
| 15 | ¿Transcripción, tool-result crudo, secreto, card de API? | No entran al state |
| 16 | ¿Genera el párrafo del anuncio, o encadena Choices para escribir texto? | Jaggedness #9. Jev no genera |
| 17 | ¿`safe_noul = 1 - noul_de_peligro`? | Identidad no garantizada. Umbral por pregunta |
| 18 | ¿Confirmas el PASS que estoy por anunciar? | Modo 4 en skip. El anuncio cita el assert |
| 19 | ¿Otra vez el mismo digest, a ver si sube de 0.62 a 0.80? | Anti-spam. Se reusa la fila |
| 20 | ¿Cada 15 s, en quiet, “¿hay ataque?”? | Rechazo de diseño del pulso |

Sustituto cuando el pre-gate dice SKIP: el contrato más estricto que ya está escrito (deny, GAP, HOLD, PARTIAL, N-A), no una segunda opinión.

---

## 12. Dónde Jev suma punta, y dónde solo calma

| Suma | Calma o desperdicio |
|------|---------------------|
| Tres o más caminos, doctrina en silencio, evidencia en campos con nombre | Un camino, o la doctrina ya eligió |
| Orden de residuales que no reescribe veredictos | Subir GAP / HOLD / PARTIAL / N-A a PASS |
| Empate de telemetría **después** de un trip CODE (pulso, banda de duda) | Preguntar el pin miss, el canary, el egress no declarado |
| Rankeo clase A que un humano todavía acepta | Auto-aplicar ese rankeo |
| Journal que luego se etiqueta `followed` / `overridden` | Llamada sin fila, o fila sin outcome, usada como prueba en un status |

La punta que los laboratorios de “guardian LLM” dejan fuera, y que esta mesa sí puede sostener: el número no entra al autorizador; el piso es público y no se afloja; la banda media va a una persona; el veredicto de producto sigue siendo el del assert. Un modelo calibrado en un benchmark ajeno no reemplaza esa forma.

---

## 13. Qué no hace este memo

- No implementa `decide_tech.py` ni un hook.
- No llama a `https://api.typesafe.ai`.
- No mueve 0.55 ni 0.5.
- No convierte 0.75, 0.80 ni 0.25 en candado.
- No mergea el PR #46 ni anuncia PASS de A–E.
- No reabre F1. Connectors, Wasm/CAPMAS y Phase S-como-blast siguen donde ya estaban.
- No copia la card ni la ruta del secreto.

---

## Fuentes

En este repo:

- [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) — cuerpo `advanced_v1` que Leader usa; pisos intactos
- [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) — piloto, 40/h, 90 s, nunca grants
- [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) — `apply_ok`, anti-patrones, gates de widen
- [`FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md`](FRONTIER-PLUGIN-DEFENSE-SUPPLYCHAIN-2026.md) — §0.2 fila Phase S (Desk F7), D6, D8
- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)
- [`docs/STATUS-F1-MEDIACION.md`](../STATUS-F1-MEDIACION.md), [`docs/contracts/MATRIX-F1-DAY14-ACCEPTANCE.md`](../contracts/MATRIX-F1-DAY14-ACCEPTANCE.md), [`reports/GAP-F1-MEDIACION.md`](../../reports/GAP-F1-MEDIACION.md)
- `.github/workflows/desktop-ci.yml` — typecheck rojo y fuera de gate
- PR #46 — stress C, no merged a la fecha de esta página

Públicas, leídas 2026-09-22, sin POST a la API:

- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/confidence
- https://docs.typesafe.ai/primitives/noul
- https://docs.typesafe.ai/patterns/confidence-routing
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
- https://learnjev.com/concepts/calibration
- https://truestandard.ai/blog/jev-accuracy-tested

PLAN de mesa (adjunto de Leader, 2026-09-21, nota `advanced_v1` 2026-09-22 12:06 ET): pisos 0.55 / 0.5, costo ~$0.0001–0.0002, Jev nunca escribe `patch.yml`.
