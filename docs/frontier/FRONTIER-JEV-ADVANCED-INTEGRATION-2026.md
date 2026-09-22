# Frontier — integración avanzada TypeSafe / Jev (wire)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — auditoría de contrato; **no** runtime, **no** `authorize()`, **no** `patch.yml` |
| **fecha** | 2026-09-22 |
| **teatro** | Mesa de decisión Abaco (`decide_tech.py`) contra System One público |
| **modelo citado** | `jev-1.13.0` (pin actual del wrapper). Alias `jev-latest` / `jev-preview` apuntan hoy al mismo id; no cambiar el pin |
| **naming** | **Jev** rankea. **Atena** aconseja. **Janice** ejecuta. **Bind** resuelve en CODE, deny-by-default. Ningún advisor vive dentro de `authorize()` ni de Bind |
| **merge** | PR de docs + review humano. Este lane no mergea a `main` |

Este memo responde una sola pregunta: el POST que Abaco manda hoy a `https://api.typesafe.ai/v1/systemone` usa las primitivas al nivel que las docs de TypeSafe llaman avanzado, o se queda en el arranque de strings.

La doctrina de *si* conviene un pulse, la cadencia, y el modelo platform+adapters ya están en [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md), [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md) y [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md). Aquí no se reabren. Bind deny-by-default y “Atena/Jev nunca entran en Bind ni en `authorize()`” están en [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md) y en [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md).

No se llamó a la API para esta auditoría. Donde el snapshot y el esquema publicado discrepan, se marca como deriva de contrato, no como un 422 observado.

---

## 0. Candados que este endurecimiento no mueve

| Candado | Se queda así |
|---------|----------------|
| Jev no crea grants, no escribe `patch.yml`, no es grantor | Igual. Un request más rico sigue siendo consejo |
| Jev y Atena no viven dentro de `authorize()` ni de Bind | Igual. La mesa es un CLI de journal, fuera del hot-path |
| Bind = deny-by-default | El código niega. Jev no vota el bind |
| Janice = runtime | Ejecuta con grant vivo. No interpreta el JSON de System One |
| Piso G47 | `apply_ok` exige `choice_confidence ≥ 0.55` **y** `safe_noul ≥ 0.5` **y** ausencia de conflicto de candado escrito. Este memo no baja ningún número |
| F1 | No se reabre. Connectors siguen en **HOLD** |
| Pin de modelo | Se queda `jev-1.13.0`. Los umbrales están calibrados contra un id versionado; un alias se mueve solo cuando TypeSafe publica otro release ([Models](https://docs.typesafe.ai/models)) |

Subir el listón de auto-apply, partir preguntas, o exigir el conflicto de candado en código **encima** de ese piso es endurecer. Bajar 0.55 o 0.5 sería romper el candado.

---

## 1. Qué manda el wrapper hoy

Artefacto: snapshot de `decide_tech.py` auditado en este lane (el archivo no está en este árbol). G47 ya lo cita como mesa de decisión. El cuerpo relevante es este:

```python
body = {
    "model": "jev-1.13.0",
    "state": f"TITLE: {title}\n\n{state}\n\nOPTIONS:\n" + "\n".join(f"- {o}" for o in options),
    "questions": {
        "pick": {
            "type": "choice",
            "instructions": "Pick the best technical option under Abaco fail-closed plugin candados. Prefer deny/safer if unsure.",
            "criteria": {o: f"Choose {o}" for o in options},
        },
        "safe_under_locks": {
            "type": "noul",
            "instructions": "Probability that the chosen path does NOT expand plugin authority without a grant and respects Janice=runtime Atena≠authorize compact locks.",
        },
        "conviction": {
            "type": "score",
            "instructions": "Strength of recommendation for the chosen path.",
            "criteria": {
                "1": "Weak / toss-up",
                "2": "Slight lean",
                "3": "Clear lean",
                "4": "Strong",
                "5": "Very strong",
            },
        },
    },
}
apply_ok = conf >= 0.55 and noul >= 0.5
```

Hechos del mismo archivo, sin secretos:

- `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer` + `Content-Type: application/json`. La clave sale de una card local y no se cita aquí.
- Tres preguntas en **una** llamada: `choice`, `noul`, `score`.
- Lectura: `answers` con fallback a `questions`. De ahí `choice`, `confidence`, `noul`, `score`, `confidence` del score.
- `apply_ok` usa solo dos números. La cadena `rule` menciona “no written candado conflict”; el booleano no calcula ese conflicto.
- `conviction_confidence` se guarda en el journal y no entra en `apply_ok`. `probabilities` no se lee.
- `opts = {o: o for o in options}` se construye y no se usa. El criterio real es la plantilla `"Choose {o}"`.
- Un error HTTP sale por `urlopen` (excepción). No hay fila de journal con `apply_ok: false`.

Eso es uso real de primitivas, en la capa de strings del quick start. La capa avanzada (EntryType estructurado, state objeto, fan-out especulativo, umbrales por riesgo, score compuesto) está sin usar o a medias.

---

## 2. Contrato público que aplica (sin APIs inventadas)

Endpoint y cuerpo, [API reference](https://docs.typesafe.ai/api):

| Pieza | Forma publicada |
|-------|-----------------|
| Método | `POST https://api.typesafe.ai/v1/systemone` |
| Top-level | `state`, `model`, `questions` |
| `state` | string, objeto JSON, o array de texto. [State](https://docs.typesafe.ai/concepts/state): objeto para casi todo; string cuando hay un solo texto. Jev es solo texto: sin imagen, audio ni vídeo |
| `questions` | mapa id → pregunta. El id no entra al modelo. La respuesta vuelve en `answers` bajo el mismo id |
| Choice | `type: "choice"`, `instructions`, `criteria` mapa opción → descripción (`string`, objeto, array o `null`). Máximo 255 opciones |
| Score | `type: "score"`, `instructions`, `criteria` **array ordenado** de niveles (mínimo 2, máximo 10). El índice del nivel empieza en **0**. `score` es la media ponderada y puede caer entre niveles |
| Noul | `type: "noul"`, `instructions`, `criteria` opcional con **solo** `true` y `false`. Respuesta: `noul` en 0–1. No hay `confidence` aparte |
| EntryType | `string \| object \| array \| null` en `instructions`, en los valores de un Choice, en cada nivel de un Score, y en `criteria.true` / `criteria.false` de un Noul ([Advanced: structure](https://docs.typesafe.ai/primitives/advanced), [EntryType](https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EntryType)) |
| Nombres de campo dentro del JSON | `question`, `focus`, `what`, `not_for`, `examples` **no** son campos reservados de la API. Los elige quien escribe la pregunta; el modelo ve el nombre ([Choice](https://docs.typesafe.ai/primitives/choice)) |
| Errores | `401`, `422` (cuerpo inválido), `429`, `529` |

El esquema Python publicado coincide: `Score.criteria` es un array; `Choice.criteria` es un mapa; `Noul.criteria` es un objeto con `additionalProperties: false` y claves `true` / `false` ([Questions](https://docs.typesafe.ai/sdk/python/api/types/questions)).

Independencia, [Primitives](https://docs.typesafe.ai/primitives) y [Introduction](https://docs.typesafe.ai/introduction): cada pregunta ve el mismo state, se evalúa en paralelo y **en aislamiento**. La respuesta de una no es contexto de otra. Si el código puede construir todas las preguntas antes de ver una respuesta, van en la misma llamada. Una segunda llamada hace falta solo cuando la respuesta decide qué datos o qué opciones existen.

`confidence` (Choice y Score) resume la forma de `probabilities`. Una masa concentrada → cerca de 1; una masa repartida → baja. El número es cómodo para un umbral; la distribución completa sigue en la respuesta por si otro estadístico sirve mejor ([Confidence](https://docs.typesafe.ai/confidence)). Un Noul cerca de 0.5 es un empate sí/no, no una magnitud media.

Patrones que este memo usa como barra, y solo esos:

| Patrón | Página | Qué pide |
|--------|--------|----------|
| Speculative fan-out | [fan-out](https://docs.typesafe.ai/patterns/fan-out) | Todas las preguntas que el código *podría* necesitar, en una llamada; el `if` descarta las que no aplican |
| Confidence-gated routing | [confidence-routing](https://docs.typesafe.ai/patterns/confidence-routing) | La respuesta dice *qué*; la confianza dice *si actuar*. El umbral sube con el daño de equivocarse |
| Composite scoring | [composite-scoring](https://docs.typesafe.ai/patterns/composite-scoring) | Un Score por dimensión, normalizar por el nivel máximo, pesos en código |

[How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) repite el orden: código para lo determinista, state con solo el contexto que la pregunta usa, paths entre backticks (`ticket.messages[0].text`), preguntas atómicas, combinar en código, escalar lo incierto.

Jaggedness de `jev-1.13` (revisión TypeSafe 2026-09-17, [jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13)): lectura literal; aritmética y conteo en código; fechas partidas y comparadas en código; poca indirección; state sin relleno; contenido adversario se prueba; `instructions` y `criteria` alineados; no exigir identidades del tipo `noul + noul_negado = 1`; no usar el modelo para generar texto; no interpolar una magnitud exacta entre dos niveles de un Score.

Inglés es el idioma de entrenamiento principal ([Models](https://docs.typesafe.ai/models)). Otras lenguas se aceptan con menos exactitud. Las instrucciones del wrapper ya están en inglés; conviene dejarlas ahí y medir si el `proposal` llega en español.

La captura de `docs.typesafe.ai/primitives/advanced` adjunta a este lane muestra la misma tabla EntryType que devolvió la página: `instructions`, valores de Choice, entradas de Score, y `criteria.true` / `criteria.false` aceptan `string`, `object`, `array` o `null`.

---

## 3. Tabla de huecos (hoy vs docs)

| # | Pieza | Hoy | Docs | Lectura |
|---|--------|-----|------|---------|
| 1 | Endpoint, mezcla de tres tipos, una llamada | `POST /v1/systemone` con choice+noul+score | Misma forma. Añadir preguntas apenas mueve la latencia | **Alineado.** Es el único fan-out que ya existe |
| 2 | Pin `jev-1.13.0` | Id versionado | Si hay umbrales afinados, pinnear el id; el alias puede moverse | **Alineado.** No pasar a `jev-latest` |
| 3 | `state` | Un string `TITLE + prosa + OPTIONS` | Objeto con campos con nombre. El string vale para un solo texto. No serializar un registro a plantilla | **A medias / señal perdida.** Las opciones están otra vez dentro del state |
| 4 | Separar contenido y pregunta | Las opciones viven en el state y en `criteria` | El state es el material; las opciones son `criteria` | **Señal perdida.** Copia débil que el modelo también lee |
| 5 | `instructions` | Tres strings que juntan varios juicios | String si la pregunta es una. Objeto cuando hay partes, datos de apoyo, o un registro ya JSON | **A medias.** La forma es legal; el contenido no es atómico |
| 6 | Choice `criteria` | `"{opcion}": "Choose {opcion}"` | La descripción separa opciones. Objeto con qué cubre, qué no, ejemplos, cuando el borde es fino. `null` si el nombre basta | **Señal perdida.** Esquema válido, rúbrica vacía. `null` informa más que “Choose X” |
| 7 | “Prefer deny/safer if unsure” dentro del Choice | Va en `instructions` | Incertidumbre → `confidence` / `probabilities` y un `if` en código. La respuesta dice el qué | **A medias.** El modelo puede cerrar un empate eligiendo la opción segura y devolver confianza alta. El empate desaparece del journal |
| 8 | Score `criteria` | Objeto `{"1": …, "5": …}` | Array ordenado. Índice desde 0. Hasta 10 niveles | **Contrato publicado roto.** El esquema Python y la API reference exigen array. Un 422 no se observó en este lane |
| 9 | Texto de los niveles | “Weak / toss-up”, “Slight lean”, … | Situaciones, no grados. Niveles que son solo números parten la probabilidad y bajan la confianza | **Señal perdida**, aunque el contenedor se arregle |
| 10 | Pregunta del Score y del Noul | “the chosen path” / “Strength of recommendation for the chosen path” | Aislamiento: ninguna pregunta ve el `choice` de otra | **Mal planteado.** Esas dos preguntas juzgan el state entero, no la opción elegida |
| 11 | Noul `criteria` | Ausente. Una frase con dos condiciones y una negación (“does NOT expand … without a grant” **y** Janice/Atena) | Una proposición por Noul. `criteria.true` / `criteria.false` cuando el borde es fino. Valor alto = sí a lo escrito | **A medias, y el borde de seguridad es exactamente el caso que pide estructura** |
| 12 | Banda media del Noul | `safe_noul >= 0.5` deja pasar 0.51 | Cerca de 0.5 = inseguro. Falso sí caro → subir el umbral. La banda media va a una persona (ejemplo de docs: sí > 0.8, no < 0.2, medio = review) | **El piso 0.5 se queda.** Auto-aplicar en la banda 0.5–alta es más laxo que el patrón de TypeSafe para un sí caro |
| 13 | `probabilities` | No se leen | Choice de ticket: otra opción con probabilidad > 0.25 recibe copia. La distribución es el dato; `confidence` es el resumen | **A medias.** Un segundo camino estricto puede tener masa y el desk igual auto-aplica el ganador |
| 14 | `conviction_confidence` | Solo journal | Un Score partido (confianza baja) no se lee como un 4 entero | **A medias** |
| 15 | Conflicto de candado escrito | Está en el string `rule`, no en `apply_ok` | Lo determinista va en código ([How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one): “use code when you can”) | **A medias respecto del propio candado G47** |
| 16 | Clave de respuesta | `answers` o, si falta, `questions` | La clave publicada es `answers` | **A medias.** El fallback no está en el contrato |
| 17 | 401 / 422 / 429 / 529 / timeout | Excepción | Reintentar 429/529 con backoff (el SDK lo hace). Para Abaco, caída de Typesafe = fila fail-closed, nunca un allow | **Hueco operativo.** Ya dicho en G47 para el pulse; el desk CLI todavía no lo journaliza |
| 18 | Hot-path, grants, Bind | Este wrapper no entra en `authorize()` | TypeSafe dice ~100 ms y lo presenta como viable en un request path. Abaco igual lo deja fuera: el autorizador es determinista | **Alineado con el candado.** La latencia de TypeSafe no abre Bind |

---

## 4. Respuestas A–G

### A. ¿`instructions` y `criteria` como JSON o como strings?

Las dos formas son legales. EntryType es `string`, `object`, `array` o `null`. TypeSafe pide **empezar** por un string cuando la pregunta es corta y el borde es obvio, y pasar a objeto cuando:

- la pregunta tiene partes (el objeto etiqueta cada parte);
- el apoyo ya es JSON (schema, taxonomía, fila) y no hace falta aplastarlo a plantilla;
- hay que separar opciones parecidas (`what`, `not_for`, `examples`, mismos nombres en todas);
- un nivel de Score necesita la situación y unos ejemplos.

El wrapper está en el escalón de strings, con preguntas que las propias docs marcan para objeto: el Choice mezcla “mejor opción técnica” + “fail-closed” + “si dudas, niega”; el Noul mezcla autoridad, grant, Janice y Atena. Eso es el caso “cuando ayuda a la claridad”.

Recomendación: dejar strings solo en la pregunta de una línea que ya separe sola. El resto del desk pasa a objetos con los nombres que las docs ya usan (`question`, `focus`, `what`, `not_for`, `examples`, `compare`). Esos nombres no se registran como API nueva.

### B. ¿`state` schema/JSON o prosa?

[State](https://docs.typesafe.ai/concepts/state) acepta string, objeto o array, y dice usar objeto en la mayoría de las llamadas para que cada parte tenga nombre. El string queda para un único texto. [Advanced](https://docs.typesafe.ai/primitives/advanced): si el material ya es un registro, pasar el JSON o los subcampos, no una plantilla.

El wrapper aplasta título, prosa y la lista de opciones en un solo string. Las opciones no son “contenido”: son el cerrado del Choice. Repetirlas en el state es relleno, y el jaggedness #5 dice que el relleno baja la exactitud.

Recomendación de state (campos Abaco; la forma es la del doc):

```json
{
  "title": "shadow structured desk",
  "proposal": {
    "summary": "Change only the System One request body. Journal the new answers. Do not call authorize().",
    "writes_patch_yml": false,
    "enters_authorize": false,
    "mints_grant": false
  },
  "locks": [
    "Jev never mints a grant",
    "Jev and Atena never run inside authorize() or Bind",
    "Bind is deny-by-default",
    "Janice executes only with a live grant"
  ]
}
```

Los booleanos que el caller ya conoce (`writes_patch_yml`, `enters_authorize`, `mints_grant`) los corta **código** antes de la llamada. Si uno es `true`, no hay `apply_ok`. Preguntarle eso a Jev es pedirle una cuenta que el jaggedness #2 reserva al código. Jev ve el `summary` y los `locks` para el residuo semántico: ¿el texto pide un widen aunque los flags digan que no?

Las preguntas apuntan con paths entre backticks, como en [Primitives](https://docs.typesafe.ai/primitives): `` `proposal.summary` ``, `` `locks` ``.

### C. ¿`criteria: "Choose X"` pierde señal?

Sí. [Choice](https://docs.typesafe.ai/primitives/choice): “option names and their descriptions are both sent to the model, so write descriptions that separate the options from each other.” `"Choose keep_string_desk"` repite la clave. No dice qué cubre ni qué queda fuera.

`null` es la forma publicada cuando el nombre ya es la rúbrica. Para caminos técnicos de Abaco el nombre no basta: hace falta el objeto de borde. Un Choice sin opción de salida (`hold_for_human` / `none of the above`) obliga al modelo a elegir entre las que el caller pasó, aunque ninguna encaje. Las docs piden esa opción de resto cuando la lista puede no cubrir.

La frase “Prefer deny/safer if unsure” no repara la rúbrica. Mueve la incertidumbre adentro del modelo, que es el eje que `confidence` ya devuelve para que el código decida.

### D. ¿Faltan fan-out, confidence-gated routing y composite scoring?

**Fan-out.** Hay una llamada con tres preguntas. Falta el fan-out que las docs describen: preguntas **especulativas y atómicas**, una por factor, incluidas las que solo importan para algunas opciones. Como las opciones se conocen antes de la respuesta, el patrón correcto es una sola llamada con un Noul (y, si hace falta, un Score) **por opción**. El código lee el Noul cuyo id corresponde al `choice`. Una segunda llamada no hace falta: las opciones no dependen de la respuesta ([Primitives](https://docs.typesafe.ai/primitives), “When one question depends on another”).

El multiplicador de coste del cookbook de preguntas paralelas no se re-midió aquí. La página de primitivas cita 11.5× más barato y 9.6× más rápido para 13 preguntas en una llamada; el índice de cookbooks cita 12.2× y 10.0×. Las dos cifras son de TypeSafe; este memo no elige una.

**Confidence-gated routing.** Hay un umbral global. Falta el segundo eje de verdad: bandas (actuar / confirmar / no actuar) y umbral distinto según el daño. Los ejemplos de TypeSafe (0.5, 0.6, 0.85, 0.9, y el 0.25 de “avisar a la otra opción”) son ilustraciones de dominio, no números Abaco. El piso que sí es ley aquí sigue siendo 0.55 y 0.5. Encima de ese piso, un camino que pudiera ampliar autoridad no se auto-aplica: va a HITL. Un consejo que no toca Bind puede quedarse en el piso.

**Composite scoring.** `conviction` es un solo Score de “fuerza de la recomendación”, con palabras de grado. Las docs parten ese juicio en Scores de una dimensión, normalizan dividiendo por `len(criteria) - 1`, y pesan en código. Los pesos viven en Abaco, así que cambiar prioridad no reescribe la pregunta.

### E. ¿Noul `true`/`false` estructurado y fail-closed?

El Noul actual no tiene `criteria`. La instrucción es una probabilidad narrada, con negación y con dos condiciones. [Noul](https://docs.typesafe.ai/primitives/noul): una pregunta sí/no; si hay dos condiciones, el número significa menos; un valor alto significa sí a la frase escrita; el borde fino se clava con `true` y `false`.

Fail-closed, sin invertir el Noul en código vía `1 - p` (el jaggedness #8 prohíbe exigir esa identidad):

1. Código: si los flags deterministas dicen grant, `patch.yml`, `authorize()` o Bind → `apply_ok = false`. Jev no opina.
2. Una proposición por opción, en la misma llamada. Valor alto = la opción **se queda** dentro de los candados que el state lista. `criteria.true` y `criteria.false` son objetos (definición + ejemplos). `criteria.false` incluye el silencio: si el texto no dice que la autoridad se queda, eso es no.
3. El código lee el Noul de la opción elegida. `safe_noul` del journal sigue siendo ese número, para no cambiar el significado del campo G47 a escondidas.
4. Por debajo de 0.5: no aplicar (piso intacto). Entre 0.5 y un listón más alto de auto-apply: journal + HITL, no apply. El listón alto se fija en el PR de runtime con datos de shadow; no se inventa aquí.
5. Preguntas de peligro (“¿esto acuña un grant?”) pueden ir **al lado**, como fan-out, y el código las exige bajas. No se restan del Noul de seguridad para fabricar `safe_noul`.

`criteria` de Noul solo admite `true` y `false`. Los ejemplos van **dentro** de esos valores, no como claves hermanas.

### F. ¿Qué no adoptar?

| No adoptar | Por qué |
|------------|---------|
| Jev o Atena dentro de `authorize()` o de Bind; grants; escribir `patch.yml`; attest de admisión | Candado Abaco. ~100 ms en el doc de TypeSafe no lo abre |
| Alias `jev-latest` / `jev-preview` mientras los umbrales sean los de G47 | [Models](https://docs.typesafe.ai/models): el alias se mueve solo. El pin actual es el comportamiento correcto |
| Fine-tune / LoRA por cuenta | La misma página: los pesos son compartidos. El dominio entra por `state` y por `criteria` |
| Generar texto encadenando Choices | Jaggedness #9. Extracción = regex o modelo generativo, y Jev elige entre candidatos |
| Interpolar una cifra exacta con `score` | Jaggedness, “Math using score”. El `score` ordena o cruza un umbral |
| Contar, comparar fechas, o hacer la media de los Nouls dentro del modelo | Jaggedness #2 y #3. La media compuesta es código |
| Exigir `safe_noul = 1 - hazard_noul`, o portar el 0.55 de un Choice a un Noul | Jaggedness #8. Umbrales por pregunta |
| `confidence == 1` como “correcto” | [Score](https://docs.typesafe.ai/primitives/score): confianza 1 describe la distribución, no la verdad |
| State con transcripts, tool-results, secretos, `patch.yml`, o la card de la API | Datos ≠ control, jaggedness #5 y #6, y el propio wrapper (“Never echoes secrets”) |
| Imagen / audio / vídeo en `state` | [Models](https://docs.typesafe.ai/models): solo texto |
| Beam search de taxonomía, cascade SDE, autoresearch dentro del TCB | Cookbooks de otro trabajo (clasificar un árbol, verificar una extracción, entrenar un modelo clásico). El desk no es ese trabajo. Las probabilidades pueden ser features **fuera** del TCB más adelante; no en este endurecimiento |
| Intent routing como sustituto de `authorize()` | [Patterns](https://docs.typesafe.ai/patterns): clasifica y enruta a un handler. El handler de un efecto protegido sigue siendo Bind / `authorize()` |
| Bajar 0.55 o 0.5, o tratar los 0.6 / 0.85 / 0.25 de los ejemplos TypeSafe como ley Abaco | Esos números son de otros dominios. El piso G47 se queda; lo nuevo se apila encima |
| Guardian cada 15 s, o quarantine solo porque Jev lo dijo | Ya rechazado en G47. Este memo no lo revive |
| Segunda llamada “para que el Noul vea el choice” | Las opciones ya se conocen. La segunda llamada es la excepción del doc, no el arreglo |
| Copiar el teatro Deep (Cordis, compact, preload) a este request | Ley portable sí; árbol DSH no. Connectors **HOLD** |

### G. Parches recomendados a `decide_tech.py` (no van en este PR)

Solo el constructor del body y la lectura. Cero imports desde `authorize()` o Bind. Cero claves en el ejemplo.

**1. State objeto.** Dejar de concatenar `TITLE` / `OPTIONS`. Flags deterministas fuera de Jev.

**2. Choice con rúbrica.** Cada opción es un objeto. Añadir `hold_for_human` cuando la lista pueda no cubrir. Borrar `"Choose {o}"` y la frase “if unsure” del instruction: esa frase pasa al `if` de `apply_ok`.

**3. Un Noul por opción, con `true`/`false` estructurados.** El id lo arma el código (`locks_hold__{option_id}`), patrón publicado de ids generados. `safe_noul` = el Noul de la opción en `choice`.

**4. Score como array de situaciones, o dos Scores atómicos.** No objeto `"1"`–`"5"`. No niveles que son solo el número. Documentar en el journal `score_scale: "level-index-0"` porque un array de 5 niveles devuelve un real en `[0, 4]`, no un entero 1–5. No comparar el `conviction_score` viejo con el nuevo sin esa marca.

**5. `apply_ok` completo, piso intacto.**

```text
candado_conflict  = código (flags, o la opción elegida está en la lista de conflictos del caller)
choice_ok         = choice_confidence >= 0.55
locks_ok          = safe_noul >= 0.5          # piso; no bajar
auto_apply        = choice_ok AND locks_ok AND NOT candado_conflict
                    AND choice != "hold_for_human"
                    AND la opción no es un widen
# banda media y "otra opción estricta con masa":
#   journal + HITL, apply_ok false
#   el margen de probabilidad se calibra en shadow; 0.25 es el ejemplo TypeSafe, no una constante nueva
```

`probabilities` y `conviction_confidence` entran al journal siempre. Un Score con confianza baja no se trata como convicción entera.

**6. Errores.** `401`, `422`, `429`, `529`, timeout: journal `apply_ok: false`, `jev_unavailable` o `jev_rejected`. Ningún allow. Reintento con backoff solo en 429/529, como dice la API reference; agotar reintentos sigue siendo no-apply. Leer solo `answers`.

**7. Pin.** Seguir enviando `"model": "jev-1.13.0"`. Guardar el `model` de la respuesta (id que contestó).

Ejemplo de body. Los textos de rúbrica son de Abaco, escritos con la forma de [How to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) (Choice con `what` / `not_for` / `examples`, Noul con `criteria.true` / `criteria.false` objetos, Score con array de objetos). No es un sample pegado de la doc.

```json
{
  "model": "jev-1.13.0",
  "state": {
    "title": "shadow structured desk",
    "proposal": {
      "summary": "Replace the flat System One body with a JSON state and structured questions. Journal only. No authorize(), no Bind, no patch.yml, no new grant.",
      "writes_patch_yml": false,
      "enters_authorize": false,
      "mints_grant": false
    },
    "locks": [
      "Jev never mints a grant",
      "Jev and Atena never run inside authorize() or Bind",
      "Bind is deny-by-default",
      "Janice executes only with a live grant"
    ]
  },
  "questions": {
    "pick": {
      "type": "choice",
      "instructions": {
        "question": "Which option best matches `proposal.summary` under `locks`?",
        "focus": "Judge the written proposal. Uncertainty stays in confidence; do not hide a tie by preferring the safer label."
      },
      "criteria": {
        "keep_string_desk": {
          "what": "Leave the decision desk on a single prose state and string criteria.",
          "not_for": "A body that already sends JSON state or per-option nouls.",
          "examples": ["TITLE plus OPTIONS pasted into one string"]
        },
        "structured_desk_shadow": {
          "what": "Send the structured body and journal both answers. No runtime authority change.",
          "not_for": "Turning Jev on inside authorize() or Bind, minting a grant, or writing patch.yml.",
          "examples": ["Shadow log of the new request, apply_ok still computed in code"]
        },
        "hold_for_human": {
          "what": "Neither option is what the proposal describes.",
          "not_for": "A proposal that clearly matches one of the other options.",
          "examples": ["The summary asks for a grant, which neither option is allowed to do"]
        }
      }
    },
    "locks_hold__keep_string_desk": {
      "type": "noul",
      "instructions": {
        "question": "Does `keep_string_desk` leave authority inside `locks`?",
        "focus": "Silence is not evidence of safety."
      },
      "criteria": {
        "true": {
          "what": "The option only advises. Janice would still need a live grant. Jev stays outside authorize() and Bind.",
          "examples": ["Journal a technical preference and stop"]
        },
        "false": {
          "what": "The option mints a grant, writes patch.yml, enters authorize() or Bind, or the text never says authority stays put.",
          "examples": ["Apply the choice by calling authorize()"]
        }
      }
    },
    "locks_hold__structured_desk_shadow": {
      "type": "noul",
      "instructions": {
        "question": "Does `structured_desk_shadow` leave authority inside `locks`?",
        "focus": "Silence is not evidence of safety."
      },
      "criteria": {
        "true": {
          "what": "Structured questions, same desk, journal only. No new grant and no call into authorize() or Bind.",
          "examples": ["Shadow the JSON body beside the old journal row"]
        },
        "false": {
          "what": "Uses the richer answers to widen caps, start a plugin, or enter the authorizer.",
          "examples": ["choice structured_desk_shadow implies authorize() may now import Jev"]
        }
      }
    },
    "locks_hold__hold_for_human": {
      "type": "noul",
      "instructions": {
        "question": "Does `hold_for_human` leave authority inside `locks`?",
        "focus": "Holding for a person does not itself grant."
      },
      "criteria": {
        "true": {
          "what": "No effect is applied. A person decides later, through the existing authorizer.",
          "examples": ["apply_ok false, journal the tie"]
        },
        "false": {
          "what": "Holding is implemented by minting a temporary grant or by relaxing Bind.",
          "examples": ["hold_for_human still calls authorize() to pre-approve"]
        }
      }
    },
    "evidence_fit": {
      "type": "score",
      "instructions": {
        "question": "How directly does `proposal.summary` state both the change and the authority boundary in `locks`?",
        "focus": "Score the written evidence in the state. This question does not see any other answer."
      },
      "criteria": [
        {
          "what": "The summary does not mention this decision.",
          "examples": ["An unrelated ops note"]
        },
        {
          "what": "The summary is adjacent but omits the authority boundary.",
          "examples": ["Talks about Jev without saying journal-only"]
        },
        {
          "what": "The summary names the change and names what it does not touch.",
          "examples": ["JSON body, journal only, no authorize()"]
        }
      ]
    },
    "reversibility": {
      "type": "score",
      "instructions": {
        "question": "How reversible is the proposal if the journal is wrong?",
        "focus": "A journal row is reversible. A grant or a patch.yml write is not."
      },
      "criteria": [
        {
          "what": "A wrong reading would already be a live grant, a Bind allow, or a patch.yml write.",
          "examples": ["authorize() called because apply_ok was true"]
        },
        {
          "what": "A wrong reading changes a review checklist that a person still accepts.",
          "examples": ["A doc PR sits unmerged"]
        },
        {
          "what": "A wrong reading is a journal row and nothing else.",
          "examples": ["Delete the tech-*.json note"]
        }
      ]
    }
  }
}
```

Composición en código (ilustración del PR futuro; los pesos son un ejemplo, no una ley nueva). El piso no se toca. `evidence_fit` y `reversibility` se normalizan como en [Score](https://docs.typesafe.ai/primitives/score): dividir por `len(criteria) - 1` (aquí 2).

```python
answers = response["answers"]
picked = answers["pick"]
choice = picked["choice"]
conf = float(picked["confidence"])
probs = picked["probabilities"]

lock_key = f"locks_hold__{choice}"
safe = float(answers[lock_key]["noul"]) if lock_key in answers else 0.0

def norm(score_answer, n_levels):
    return float(score_answer["score"]) / (n_levels - 1)

# Pesos del caller. Cambiarlos no reescribe la pregunta.
fit = norm(answers["evidence_fit"], 3)
reversible = norm(answers["reversibility"], 3)
composite = 0.5 * fit + 0.5 * reversible

flags = state["proposal"]
candado_conflict = bool(flags["mints_grant"] or flags["enters_authorize"] or flags["writes_patch_yml"])
apply_ok = (
    conf >= 0.55
    and safe >= 0.5
    and not candado_conflict
    and choice != "hold_for_human"
)
# Por encima del piso: si el composite o la confianza del Score son bajos,
# o si otra opción más estricta carga probabilidad, apply_ok queda false
# y el journal pide HITL. No se baja 0.55 ni 0.5 para “dejar pasar” ese caso.
```

`evidence_fit` en este bosquejo puntúa el state, no la opción ya elegida: un solo Score compartido es honesto con el aislamiento. Si más adelante cada opción necesita su propio encaje, se duplica el Score por id en la **misma** llamada (fan-out), igual que los Nouls. No se hace una segunda request para “pasarle el choice”.

El journal añade, sin borrar las claves G47: `probabilities`, `score_scale`, `evidence_fit`, `reversibility`, `composite`, `candado_conflict`, `response_model`, y el mapa `locks_hold__*`. `safe_noul` sigue siendo el Noul de la opción elegida.

---

## 5. Top 5 — punta, en 7 / 30 / 90 días

Horizonte de trabajo del PR de runtime que siga a este memo. Este PR no lo implementa.

| # | Punta | 7 días | 30 días | 90 días |
|---|--------|--------|---------|---------|
| 1 | **Cuerpo legal.** State objeto. Score en array. Choice con `what` / `not_for` / `examples`. Sin `"Choose X"` | Spec cerrada (este memo). El PR de código toca solo el constructor y el journal, en shadow, con el piso G47 igual | Dual-run: body viejo y body nuevo sobre los mismos inputs de mesa. Comparar `choice` y `apply_ok`. Guardar `response.model` | El body estructurado queda como única llamada si el shadow no afloja el piso. El body de strings sale |
| 2 | **Noul por opción.** Matar “the chosen path” | Preguntas `locks_hold__{id}` especificadas, `true`/`false` con silencio = no | El journal escribe el mapa de Nouls al lado del `safe_noul` legado | `safe_noul` se lee solo del id elegido. La frase compuesta con negación sale |
| 3 | **Routing por confianza, piso intacto** | Dejar escrito que hoy `apply_ok` ignora `probabilities`, la confianza del Score, y el conflicto de candado que la propia `rule` nombra | Código calcula `candado_conflict`. Banda media → HITL, `apply_ok false`. Widen → nunca auto-apply | Umbral de auto-apply **por clase de acción**, siempre ≥ 0.55 y ≥ 0.5. Consejo de journal puede vivir en el piso; cualquier cosa que luego pueda ampliar autoridad, no |
| 4 | **Composite en vez de “Weak / Strong”** | Niveles situacionales en el spec. Marca `score_scale: "level-index-0"` para no mezclar el 1–5 viejo con el índice desde 0 | Dos Scores (`evidence_fit`, `reversibility`), pesos en código, confianza del Score visible | Pesos ajustados con el shadow. El composite no es un grant ni un input de Bind |
| 5 | **Lo que se queda fuera** | Lista §F en el review del PR de código: pin `jev-1.13.0`, sin alias, sin generación, sin `1 - p`, sin hot-path | 401/422/429/529/timeout → journal fail-closed, nunca allow. Backoff solo en 429/529 | Cero imports de Jev en `authorize()` y en Bind. Janice sigue siendo runtime. Connectors en HOLD. F1 cerrado |

---

## 6. Qué ya está bien (para no rehacerlo)

- Una llamada, tres tipos, endpoint correcto.
- Modelo pinneado a `jev-1.13.0`.
- El booleano de apply vive en código, con un piso numérico, y un `confidence` ausente cae a 0 (no aplica).
- El wrapper de mesa no es `authorize()`.
- Instrucciones en inglés, que es el idioma donde TypeSafe declara mejor exactitud.
- G47 ya prohíbe el guardian de tick y el grant “porque Jev lo dijo”. Este endurecimiento no los trae de vuelta.

---

## Fuentes

Públicas (consultadas 2026-09-22, sin llamar a la API):

- https://docs.typesafe.ai/
- https://docs.typesafe.ai/llms.txt
- https://docs.typesafe.ai/introduction
- https://docs.typesafe.ai/concepts/state
- https://docs.typesafe.ai/concepts/how-to-build-with-system-one
- https://docs.typesafe.ai/primitives
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/primitives/score
- https://docs.typesafe.ai/primitives/noul
- https://docs.typesafe.ai/primitives/advanced
- https://docs.typesafe.ai/confidence
- https://docs.typesafe.ai/patterns
- https://docs.typesafe.ai/patterns/fan-out
- https://docs.typesafe.ai/patterns/confidence-routing
- https://docs.typesafe.ai/patterns/composite-scoring
- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
- https://docs.typesafe.ai/sdk/python/api/types/questions
- https://docs.typesafe.ai/sdk/javascript/api/type-aliases/EntryType

Repo:

- Snapshot `decide_tech.py` de este lane (no está en el árbol; no se copia aquí la card ni la ruta del secreto).
- [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md)
- [`JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md`](JEV_PLUGIN_VS_TRADITIONAL_SECURITY_G47.md)
- [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md)
- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md)
- [`FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md`](FRONTIER-CLEAN-PLUGIN-HOST-ARCHITECTURE-2026.md)
- [`PLUGIN_FRONTIERS_CONTRACT_INDEX.md`](PLUGIN_FRONTIERS_CONTRACT_INDEX.md)
