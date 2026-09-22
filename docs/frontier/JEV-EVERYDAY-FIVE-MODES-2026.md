# Jev everyday — five modes (G47)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — receta de uso. Cero runtime, cero `authorize()`, cero `patch.yml`, cero admisión |
| **fecha** | 2026-09-22 |
| **reemplaza** | Leader seed «five everyday modes» (Anthony 2026-09-22). Esa hipótesis queda absorbida aquí |
| **mesa** | `decide_tech.py` en `advanced_v1` (ya en el desk, fuera de este árbol). Pin `jev-1.13.0` |
| **pisos** | `choice_confidence ≥ 0.55` y `safe_noul ≥ 0.5`. No se bajan. El auto-apply del desk es más alto; ver §1 |
| **naming** | **Jev** rankea. Janice ejecuta. Atena aconseja. Este doc nombra modos de Jev |
| **carril BTC** | Aparte. Aquí solo se cita el patrón CODE-primero. Cero órdenes |
| **punta** | Jev es radar y ranker. La seguridad niega lo no autorizado y deja correr lo ya admitido |

Audiencia: Leader, Cloud Agent, Desk, Deep Harnes, Python Core. Una llamada, un journal, un camino.

---

## 0. Qué cambió respecto del seed

El seed acertó el número cinco y el oficio (bifurcación, margen, potencial, honestidad, cadencia). Esta página lo vuelve ejecutable y le quita tres ambigüedades:

| Seed | Aquí |
|------|------|
| Gray-band como segunda opinión sobre el mismo fork | **Gray-band radar** solo elige la *salida* fail-closed de una fila que ya no puede auto-aplicarse. No reabre el fork ni mueve el piso |
| Ritual a 60–90 s en el trabajo de cada día | Ese reloj vive en el piloto Security Pulse. El **cadence pulse** diario es corto, con ventana sucia, y se salta si la ventana está quieta |
| Aplicar con solo los dos pisos | El desk `advanced_v1` exige además candado limpio, `safe_noul ≥ 0.80`, `second_mass ≤ 0.25` y `choice ≠ hold_for_human` |

Los cinco nombres canónicos, para decirlos en voz alta:

1. **Fork ranker**
2. **Gray-band radar**
3. **Potentiality sorter**
4. **Soft-PASS detector**
5. **Cadence pulse**

---

## 1. Punto dulce (una página)

Jev entra cuando el trabajo de Abaco ya es técnico y el código no puede cerrarlo solo: hay dos caminos legales escritos, o alguien va a anunciar un PASS, o una ventana de operación ya salió sucia. Antes de la llamada, el código cortó cualquier cosa que acuñe un grant, entre en `authorize()` o en Bind, escriba admisión o `patch.yml`. La llamada devuelve una opción, una confianza y un noul por camino. El código mira esos números. Si pasan el piso y la barra del desk, Leader o Cloud siguen ese camino. Si falta un número, si la API no contesta, o si la masa está repartida, se escribe el journal y se hace el contrato más estricto que ya existe. Los plugins admitidos siguen su fast path. Un tercero negado no los para.

Llamar poco. Una pregunta de mesa cuesta del orden de \$0.0001–\$0.0002. Todas las preguntas de un modo van en **una** llamada. Un segundo POST para «enseñarle el choice al noul» no forma parte de estos cinco modos: las opciones se conocen antes de llamar.

El carril de papel BTC puede copiar este patrón (código primero, Jev solo aprieta, journal). No es uno de estos modos y no coloca órdenes.

**Abstract (EN).** Call Jev on a technical fork, a PASS announcement, or a window that code has already marked dirty — and only after code has refused grants, `authorize()`, Bind, admission writes, and `patch.yml`. One request carries every question. Auto-apply only when the G47 floors and the stricter `advanced_v1` desk gates all hold. Any miss is a journal row plus the strictest written contract. Admitted plugins keep their fast path. Jev ranks. The BTC paper lane may copy the pattern and stays off this desk.

### Fórmula

```text
CALL  = technical
        AND (two_or_more_legal_options OR pass_claim_about_to_be_said OR dirty_window)
        AND code_already_cut(grant, authorize, Bind, admission, patch.yml)
        AND miss_costs_more_than_one_short_call
        AND this_title_not_already_journaled_today_unless_counters_moved

APPLY = choice_confidence >= 0.55          # piso G47, no bajar
        AND safe_noul        >= 0.50        # piso G47, leído de locks_hold__{choice}
        AND safe_noul        >= 0.80        # barra de auto-apply del desk advanced_v1
        AND second_mass      <= 0.25        # masa de la siguiente opción de choice
        AND choice != "hold_for_human"
        AND NOT candado_conflict
        AND option_is_not_a_widen
        AND answers_present
        AND NOT jev_unavailable

ELSE  = journal(apply_ok=false) + strictest_written_contract
        admitted plugins stay on the fast path
        no grant, no authorize, no admission write
```

`second_mass` es la mayor `probabilities` del choice entre las opciones que no son `choice`. Si `probabilities` o `answers` no vienen, la barra no se puede evaluar: `apply_ok = false`.

La barra `0.80` y el corte `0.25` están **encima** del piso. Los puso el desk `advanced_v1` el 2026-09-22 porque un noul cerca de 0.5 es un empate sí/no, no una magnitud. No salen de un journal de sombra de Abaco. El 0.80 no se baja. El 0.25 no se sube (subirlo afloja). Ninguno sustituye a 0.55 ni a 0.5. Moverlos por clase de acción, con filas reales y sin cruzar el piso, queda para cuando exista ese sombra. Bajar el piso no está sobre la mesa.

---

## 2. Ley compartida (los cinco modos)

### 2.1 Antes de POST

El caller pone estos booleanos. Si uno es `true`, no hay llamada y no hay `apply_ok`:

| Flag | `true` significa |
|------|------------------|
| `mints_grant` | el camino acuñaría o ensancharía un grant |
| `enters_authorize` | el camino entraría en `authorize()` o en Bind |
| `writes_patch_yml` | el camino escribiría `patch.yml` |
| `mutates_admission` | el camino escribiría o attestaría admisión o un pin |

`mutates_admission` es corte del caller, misma clase que los tres flags que el desk ya guarda. Preguntarle a Jev «¿esto acuña un grant?» pide una cuenta que hace el código.

Opciones prohibidas en cualquier `criteria`: `grant`, `widen`, `allow`, `quarantine`, `unload_admitted`, `soft_apply`.

### 2.2 State

Objeto JSON. Instrucciones y rúbricas en inglés (ahí el modelo es más exacto). El `summary` puede citar el brief; si llega en español, se mide, no se «arregla» dentro del modelo.

```json
{
  "title": "fork-ranker: deny-hard vs journal-the-edge",
  "mode": "fork_ranker",
  "proposal": {
    "summary": "Two legal readings of a broker edge. Neither mints a grant or enters authorize() or Bind.",
    "writes_patch_yml": false,
    "enters_authorize": false,
    "mints_grant": false,
    "mutates_admission": false
  },
  "locks": [
    "Jev never mints a grant",
    "Jev never runs inside authorize() or Bind",
    "Bind is deny-by-default",
    "Janice executes only with a live grant",
    "A denied third party does not freeze admitted plugins"
  ],
  "evidence": {}
}
```

`evidence` lleva contadores, hashes, ids y rutas. No lleva transcripts, tool-results, secretos, el cuerpo de `patch.yml`, ni la card de la API. `mode` es uno de: `fork_ranker`, `gray_band_radar`, `potentiality_sorter`, `soft_pass_detector`, `cadence_pulse`.

### 2.3 Forma del dict `questions`

Una llamada. Cada pregunta ve el state y no ve a las otras. Fan-out: un noul por opción, ids `locks_hold__{option_id}`, incluidos los que luego no se lean. `hold_for_human` va en el choice cuando la lista puede no cubrir el caso.

| id | type | Oficio |
|----|------|--------|
| `pick` | choice | Rúbrica por opción: `what`, `not_for`, `examples`. Siempre incluye `hold_for_human` |
| `locks_hold__{id}` | noul | ¿Esa opción deja la autoridad dentro de `locks`? `criteria.true` / `criteria.false` son objetos. El silencio (el texto no dice que la autoridad se queda) es `false` |
| `evidence_fit` | score | Array de situaciones, índice desde 0. Qué tan directo es el state |
| `reversibility` | score | Array. Un journal se revierte; un grant no |

El código lee `answers` nada más. `safe_noul` es `answers["locks_hold__" + choice].noul`. Si esa clave falta, `safe_noul = 0`.

Los scores se normalizan en código (`score / (n_levels - 1)`) y se journalizan. Un composite de ejemplo (`0.5 * fit + 0.5 * reversibility`) no es ley y no es un grant. La escala se marca `score_scale: "level-index-0"` para no mezclarla con el 1–5 viejo.

Cuerpo de referencia, ya escrito con esta forma: [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) §G. Los modos de abajo solo cambian `title`, `mode`, `evidence` y las rúbricas.

### 2.4 Fail-closed común

| Hecho | Qué se escribe | Qué se hace |
|-------|----------------|-------------|
| Piso o barra en rojo, choice `hold_for_human`, `second_mass > 0.25` | `apply_ok: false` | Contrato más estricto ya escrito. Si hay dos salidas legales, modo 2. Si no, esa salida única |
| `401`, `422`, timeout, o `429`/`529` con reintentos agotados | `apply_ok: false`, `jev_unavailable` o `jev_rejected` | Solo CODE. Reintento con backoff únicamente en `429` y `529` |
| Flag de §2.1 en `true` | no hay fila de consejo | Deny escrito. Jev no opina |
| API caída en una ventana de pulso | `jev_unavailable` | CODE-only. La caída no abre un allow |

Model pin en el request: `jev-1.13.0`. El journal guarda el `model` que contestó. Sin alias `jev-latest` ni `jev-preview` mientras estos números sean la barra.

### 2.5 Presupuesto

Mesa de ingeniería: pocas llamadas por día de trabajo, una por decisión. Si este `title` ya está en el journal de hoy y los contadores no se movieron, no se repite. El piloto de pulso (base 60–90 s, tope 40 llamadas/h, una app tip, alerta y journal) es otro doc: [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md). No se importa ese reloj a Leader, Cloud ni al desk.

---

## 3. Los cinco modos

Cada modo usa la fórmula de §1 y la forma de §2. Aquí va lo que cambia.

### 3.1 Fork ranker

**Cuándo.** Hay al menos dos caminos técnicos, los dos caben en los candados, y el contrato no nombra un único siguiente paso. Empate entre dos lecturas que no se pisan el candado y sí chocan en la implementación.

**Inputs.** `proposal.summary` con los dos caminos y el límite de autoridad. `evidence`: ids de contrato, rutas de archivo, resultado de la comparación que el código ya hizo (igual/distinto), no la aritmética cruda para que Jev la rehaga.

**Questions.** `pick` entre los ids de camino más `hold_for_human`. Un `locks_hold__{id}` por cada uno. `evidence_fit` y `reversibility` como en §2.3.

Rúbrica mínima del choice:

```json
{
  "deny_hard": {
    "what": "Apply the written deny: no side effect, audit, counter. Admitted plugins stay on the fast path.",
    "not_for": "An edge the contract does not name, or any path that allows the effect.",
    "examples": ["Four asserts on a protected effect that has no live grant"]
  },
  "journal_the_edge": {
    "what": "Do not invent an allow. Journal that the contract is silent and stop the effect.",
    "not_for": "A contract that already names deny, or a write to patch.yml / admission.",
    "examples": ["Edge case absent from the deny-reason list; effect stays off"]
  },
  "hold_for_human": {
    "what": "Neither option is what the proposal describes.",
    "not_for": "A proposal that clearly matches one option.",
    "examples": ["The summary asks for a grant"]
  }
}
```

**Pisos.** Los de §1. Este modo es el que más a menudo cumple la barra, porque los caminos ya son reversibles y chicos. Eso no relaja el 0.80.

**Fail-closed.** Se ejecuta el camino más estricto de la lista que el código ya permite (`deny_hard` antes que abrir un hueco). `journal_the_edge` solo si el contrato calla. Nunca se fabrica un tercer camino «soft-apply».

**Ejemplo Abaco.** El hub Python todavía no muestra una razón de deny que Deep ya escribió. Dos lecturas, las dos con el efecto apagado: añadir esa cadena al espejo `core/f1/effect_broker_contract.py`, o dejar el enum y anotar el cruce en las reglas portables. El contrato no dice cuál de las dos se hace hoy. Fork ranker elige. Cloud lo hace solo si `apply_ok`. Si el brief pide borrar la razón para poner un test en verde, el preflight corta y no hay llamada. El deny de un efecto sin grant sigue siendo CODE (fila 2 de §4): ahí no hay fork.

**Anti-patrón.** Meter `soft_apply` o `grant` como opción para que el ranker «pueda ser útil».

### 3.2 Gray-band radar

**Cuándo.** Una fila de mesa ya tiene `apply_ok: false` por banda media (`0.50 ≤ safe_noul < 0.80`), por `second_mass > 0.25`, o por `hold_for_human`, **y** existen dos salidas fail-closed distintas, las dos ya escritas. Si el contrato nombra una sola salida, se hace esa y este modo no se llama.

**Inputs.** La fila previa (choice, confidence, safe_noul, second_mass, title) dentro de `evidence`. El summary describe las salidas, no el fork original.

**Questions.** `pick` entre salidas, no entre features:

```json
{
  "strictest_contract": {
    "what": "Do the stricter action the written contract already names. No new authority.",
    "not_for": "Inventing a stricter rule that is not written, or unloading admitted plugins.",
    "examples": ["Deny the new effect, audit it, leave admitted fast paths running"]
  },
  "journal_stop": {
    "what": "Write the gray row and stop. No broker change, no announcement.",
    "not_for": "A contract that already names the deny or the edit.",
    "examples": ["Docs PR left in draft because two sentences are both legal"]
  },
  "hitl_anthony": {
    "what": "The residue is product taste, credentials, data deletion, or an unwritten product call.",
    "not_for": "A technical residue that a written contract already closes.",
    "examples": ["Logo framing, notarize, delete user data"]
  },
  "hold_for_human": {
    "what": "None of the exits match the row.",
    "not_for": "A row whose exit is already one of the options.",
    "examples": ["The earlier choice was itself hold_for_human and no contract sentence exists"]
  }
}
```

Noul por salida, con la misma forma `true`/`false`. `hitl_anthony` es seguro solo si «preguntar» no pre-aprueba: el `false` incluye «abrir un grant temporal mientras Anthony lee».

**Pisos.** Los de §1, otra vez. Una segunda llamada gris no «promedia» con la primera ni sube el noul viejo. Si esta llamada también cae bajo la barra, el default es: contrato escrito si existe; si no, `journal_stop`. Anthony entra por la tabla de §4, no por costumbre.

**Fail-closed.** No se aplica el fork original «porque ya casi pasaba». No se baja 0.80 para esta fila.

**Ejemplo Abaco.** Fork ranker devolvió `deny_hard` con confianza 0.71, `safe_noul` 0.66 y `second_mass` 0.29. El contrato de mediación ya nombra deny, `side_effect: false`, audit y contador. La salida única es esa: el radar **no se llama**. Se llama solo si la otra salida también está escrita — por ejemplo, parar un PR de docs en draft frente a aterrizar la frase más estricta que la ley de nombres ya tiene.

**Anti-patrón.** Usar el radar para retocar 0.55, 0.5, 0.80 o 0.25 con una fila incómoda. Usarlo para volver a votar el fork.

### 3.3 Potentiality sorter

**Cuándo.** Hay dos o más ítems técnicos abiertos (bug, CI rojo, GAP, PR) y la pregunta es el orden: cuál desbloquea más punta si se hace primero. El arreglo de cada ítem, si es determinista, lo hace CODE después.

**Inputs.** Lista corta en `evidence.items[]`: `id`, `unblock` (una frase), `reversible` (bool que puso el caller), `touches_authority` (bool). El caller saca de la lista cualquier ítem con `touches_authority: true` antes del POST. Esos van a contrato + HITL, no al sorter.

**Questions.** `pick` entre los ids que sobrevivieron el corte, más `hold_for_human`. Cada `what` dice el desbloqueo. Cada `not_for` nombra apagar el gate para ponerse en verde, y ensanchar caps. Noul por ítem: hacerlo primero deja la autoridad dentro de `locks`. Forma de una rúbrica:

```json
{
  "pin_witness_red": {
    "what": "Fix the F1.5 catalog/runtime schema drift first. The pin keeps denying until the digests match.",
    "not_for": "Disabling the pin, skipping the witness, or granting the tool so CI goes green.",
    "examples": ["Edit the drifted schema; leave authorize() untouched"]
  }
}
```

**Pisos.** Los de §1. El ranking se journaliza siempre. Cloud empieza el ítem elegido solo cuando APPLY de §1 pasa entero. Si la barra no pasa, el orden gris no se obedece: se empieza el ítem reversible más chico que el código ya puede probar, o se para. No se abre un subsistema nuevo para desempatar.

**Fail-closed.** Ningún ítem de la lista se «arregla» desactivando pin, broker, admisión o un test de mediación. Si todos los ítems tocaban autoridad, la lista queda vacía y no hay llamada.

**Ejemplo Abaco.** Brief con tres restos: un rojo del pin/witness F1.5, URLs residuales del version-catalog en Deep Harnes, un enlace roto del índice frontier. El sorter ordena cuál se hace primero. El pin en rojo ya niega por CODE; el ítem es «arreglar el drift», y la rúbrica `not_for` incluye apagar el pin para que el CI pase. F1 day-14 no se reabre como ítem.

**Anti-patrón.** Ordenar «quitar el candado» contra «mantener el candado». Eso no es potencial: es un widen, y el preflight lo corta.

### 3.4 Soft-PASS detector

**Cuándo.** Alguien (Leader, PR, nota de handoff) está a punto de decir PASS, FAIL, o «sigue verde», y hace falta saber si esa frase cabe en la evidencia escrita. Correr la suite es CODE. Este modo lee el claim contra el state.

**Inputs.** `evidence.claim` (la frase exacta). `evidence.cites[]` (rutas, ids de test, filas de matriz que el caller pegó). Si el caller no tiene citas, el state lo dice con una lista vacía: no se rellena de memoria.

**Questions.**

```json
{
  "claim_matches_evidence": {
    "what": "Every material part of `evidence.claim` is supported by `evidence.cites`.",
    "not_for": "A PASS whose suite was not cited, or a claim about code this diff does not touch.",
    "examples": ["Docs-only diff; claim says the broker was not modified; cites name the paths"]
  },
  "claim_ahead_of_evidence": {
    "what": "The claim says more than the cites show. Do not announce it.",
    "not_for": "A claim that quotes a matrix row or a test id present in state.",
    "examples": ["Announcing day-14 PASS when cites are empty"]
  },
  "hold_for_human": {
    "what": "The claim is taste, branding, or outside the cites and the two labels.",
    "not_for": "A technical PASS/FAIL sentence.",
    "examples": ["This logo feels finished"]
  }
}
```

Noul de `claim_matches_evidence`: anunciarlo no ensancha autoridad. El `false` incluye «anunciar PASS implica que un grant quedó vivo» cuando el state no lo enseña.

**Pisos.** Los de §1. Anunciar es barato de revertir solo si no salió del cuarto. Por eso la barra de auto-apply se respeta igual: un PASS a medias no se redondea hacia arriba.

**Fail-closed.** No se anuncia. Se dice la frase más corta que las citas aguantan («docs-only; suite no re-corrida» cuando eso es lo que hay). Un `claim_matches_evidence` bajo la barra tampoco se anuncia.

**Ejemplo Abaco.** Frase propuesta: «F1 day-14 sigue en PASS tras este cambio de docs.» Citas en el state: la matriz day-14 y el diff limitado a `docs/frontier/`. El detector mira si la frase cabe en esas citas. No relanza Vitest. Si `cites` está vacío, la opción honesta es `claim_ahead_of_evidence`.

**Anti-patrón.** Pedirle a Jev que genere el párrafo del anuncio, o tratar `confidence == 1` como «el PASS es verdad». La confianza describe la masa de la distribución.

### 3.5 Cadence pulse

**Cuándo.** Una ventana de operación que el código ya marcó sucia, y la suciedad no es un trip duro. Trip duro (pin miss, canary, egress no declarado, digest de catálogo distinto del de runtime): lo actúa CODE y este modo no se llama. Ventana quieta: no se llama.

Este doc no inventa el umbral numérico del «sucio». Lo pone el sensor de CODE que ya existe. Sin sensor, la ventana cuenta como quieta.

El reloj de 60–90 s y el tope de 40/h pertenecen al piloto de una app tip, no a este pulso de escritorio. Aquí: como mucho unas pocas llamadas por día de trabajo, y solo si el contador se movió desde la fila anterior.

**Inputs.** Contadores y hashes del host (`deny_count`, `deny_reason` ya agregado, digests). Cero auto-reporte del plugin. Cero transcript.

**Questions.** Opciones cerradas:

```json
{
  "hold": {
    "what": "Journal the window. Admitted plugins keep the fast path. No new action.",
    "not_for": "A hard CODE trip, which should not reach this question.",
    "examples": ["Deny rate rose inside an already-alerted policy bucket"]
  },
  "alert": {
    "what": "Local alert plus journal. No unload, no quarantine, no grant change.",
    "not_for": "Alerting again when CODE already alerted this window.",
    "examples": ["Novel deny reason, host counters only, admitted set untouched"]
  },
  "journal_gap": {
    "what": "Record a named GAP for the next potentiality sort. Do not change runtime.",
    "not_for": "Using the GAP note as a temporary allow.",
    "examples": ["Residual list left by a stress pass, none of the rows are hard trips"]
  },
  "hold_for_human": {
    "what": "The window is not one of these three.",
    "not_for": "A clear hold, alert, or GAP.",
    "examples": ["Counters missing from state"]
  }
}
```

El seed nombra «stress A–E» como superficie. Este repo no define esa suite. Si un pase humano o un test deja una lista de GAPs residuales, entra como `evidence.gaps[]` y la opción `journal_gap` la apunta al modo 3 en el **siguiente** brief. Un solo GAP con arreglo determinista no necesita Jev.

**Pisos.** Los de §1. `alert` con barra en rojo se guarda como `hold`. Quarantine no está en la lista: en el piloto sigue apagada, y en el día a día ni siquiera es opción.

**Fail-closed.** `hold`. Plugins admitidos siguen. Un tercero negado no congela el fast path. Si Typesafe no contesta: CODE-only y `jev_unavailable`.

**Ejemplo Abaco.** Fin de un bloque en Deep Harnes. El código ve el digest de catálogo distinto del de runtime para un `plugin_id`: eso es trip de CODE (deny de ese id, admitidos quietos). Cadence pulse no opina. Sí opina cuando el rate de deny subió, la razón agregada no es un trip de integridad, y CODE todavía no alertó: `hold` contra `alert` contra `journal_gap`, con contadores nada más. Salud del broker y drift de admisión se leen del audit del host. Python Core, cuando el sensor de Phase B exista, cuelga el mismo pulso del audit de bind/`authorize`, no del «bind ok» que cuente el plugin.

**Anti-patrón.** Guardian de tick. Preguntar cada minuto en quieto. Dejar que un porcentaje pare el conjunto admitido. Poner a Jev dentro de `authorize()`.

---

## 4. Esquema de categorías

Una fila, un balde primario. Donde hay orden, el balde es el primero que manda.

| # | Situación | Balde | Modo, si hay llamada |
|---|-----------|-------|----------------------|
| 1 | Cuenta, fecha, conteo, comparar hashes, TTL, tamaño de diff | **CODE** | — |
| 2 | Un contrato ya nombra el único paso | **CODE** | — |
| 3 | Flag de §2.1 en true (grant, authorize, Bind, `patch.yml`, admisión, pin) | **CODE** | no llamar |
| 4 | Efecto no autorizado | **CODE** | deny, `side_effect: false`, audit, contador. Admitidos siguen |
| 5 | Plugin admitido, ventana quieta, sin novedad | **skip** | el fast path no se congela para «checar con Jev» |
| 6 | Trip duro: pin, canary, egress no declarado, digest catálogo ≠ runtime | **CODE** | el pulso no vota el trip |
| 7 | Dos o más caminos técnicos legales, flags limpios | **Jev** | Fork ranker |
| 8 | Fila bajo la barra y dos salidas fail-closed escritas | **Jev** | Gray-band radar |
| 9 | Fila bajo la barra y una sola salida escrita | **CODE** | esa salida. No llamar al radar |
| 10 | Dos o más bugs, CI, GAPs o PRs; la pregunta es el orden; ninguno toca autoridad | **Jev** | Potentiality sorter |
| 11 | Ítem que solo se «arregla» apagando un gate | **CODE** | fuera de la lista. Contrato + HITL si alguien pide el widen |
| 12 | Van a anunciar PASS / FAIL / «sigue verde» | **Jev** | Soft-PASS detector. La suite, si corre, es CODE |
| 13 | Ventana sucia que no es trip duro | **Jev** | Cadence pulse |
| 14 | Gusto de producto, copy, marca, logo | **HITL-Anthony** | — |
| 15 | Merge fuera del autopilot escrito, notarize, credenciales, borrar datos, tocar `dsh-desktop` / userData | **HITL-Anthony** | — |
| 16 | Widen de contrato (`proposeContractEvolution` / accept con HITL) | **HITL-Anthony** | Jev no firma el accept |
| 17 | API caída, cuerpo inválido, cuota, timeout | **skip** la aplicación | journal fail-closed; camino CODE |
| 18 | Orden o eval del carril BTC de papel | **skip** este doc | otro carril; el patrón CODE-primero se puede citar |
| 19 | «Que Jev permita» | **skip** | pregunta prohibida. Sin opción `grant` ni `allow` |

Lectura rápida: **CODE** cierra lo determinista y lo no autorizado. **Jev** ordena el resto técnico. **HITL-Anthony** es gusto, credencial, destrucción y evolución de contrato. **skip** es quietud, carril ajeno, o llamada que no aporta un segundo camino.

---

## 5. Recetas del día

Misma fórmula en las cinco caras. Cambia el state, no el candado.

### Leader

1. Si el brief anuncia PASS o «sigue verde», correr el detector (§3.4) antes de decirlo.
2. Si el brief deja un fork técnico, correr el ranker (§3.1) o dejar el fork escrito para Cloud. No pedir gusto a Anthony en un fork que puede pasar la barra.
3. Si la fila vuelve gris y hay una sola salida escrita, hacerla. El radar es para dos salidas.
4. Al cerrar el día, si un sensor marcó sucio y no es trip duro, una llamada de cadence pulse. Si está quieto, cero llamadas.
5. Ítems abiertos de más de uno: potentiality sorter, después de sacar los que tocan autoridad.

### Cloud Agent

1. El brief trae las opciones. El agente no inventa un `grant` para completar la lista.
2. Preflight §2.1. Luego un POST con la forma §2.3, journal `advanced_v1`.
3. `apply_ok` true: hacer ese camino. No preguntar a Anthony por un fork técnico que ya pasó la barra (regla de mesa, con la barra de `advanced_v1`, no con el piso pelado).
4. `apply_ok` false: contrato más estricto. Escalar a Anthony solo en filas 14–16 de §4.
5. No tocar `dsh-desktop`, no notarizar, no borrar datos, no escribir admisión.

### Desk

1. Cuerpo legal: state objeto, choice con `what` / `not_for` / `examples`, noul por opción, scores en array. Es el desk `advanced_v1`. El cuerpo de strings (`Choose X`, un solo noul «del camino elegido») no es esta receta.
2. `schema_version: advanced_v1` en el journal, más `probabilities`, `second_mass`, `safe_noul`, `score_scale`, `candado_conflict`, `response_model`, y el mapa `locks_hold__*`.
3. Paper / journal. La mesa no es `authorize()`.
4. HTTP de error: fila con `apply_ok: false`. No se traga la excepción en silencio.
5. La card de la API se queda en el desk. Este doc no la cita ni la copia.

### Deep Harnes

1. F1 day-14, broker, admisión, F1.5 y F2.1 están cerrados en el tip. Un modo de Jev no los reabre.
2. Salud del broker y drift de admisión: contadores y digests del host. El digest distinto es CODE (§4 fila 6).
3. Un deny a un tercero no para a los admitidos. Ningún modo tiene la opción «congelar el fast path».
4. El piloto de pulso, si se enciende, sigue su propio doc (alerta, journal, sin quarantine auto). Este cadence pulse de escritorio es más lento y no lo sustituye.

### Python Core

1. Los cinco modos viajan igual. No viaja el árbol Cordis ni el compact del face Electron.
2. Bind sigue deny-by-default. `planned` / `blocked` no arrancan. Riesgo medium/high de un start lo firma un humano. Jev no attesta el bind.
3. El pulso, cuando haya sensor, lee el audit del host sobre bind y `authorize`. No lee el parte del plugin.
4. Espejo de razones de deny: si el trabajo es «añadir una razón ya escrita» frente a «dejarla solo en un doc», eso es Fork ranker. Si el trabajo es «borrar una razón para que pase un test», el preflight lo corta.

---

## 6. Márgenes, calibración, costo

| Número | Papel | Evidencia | ¿Moverlo? |
|--------|--------|-----------|-----------|
| `0.55` | Piso de `choice_confidence` | Lock G47. La confianza resume la forma de `probabilities`; no es «verdad» | No bajar. No hay sombra Abaco en este árbol que justifique otro piso |
| `0.50` | Piso de `safe_noul` | Lock G47. Por debajo, el noul no dice que los candados aguantan | No bajar |
| `0.80` | Barra de auto-apply del noul en `advanced_v1` | El upgrade del desk (2026-09-22) manda a HITL la banda `[0.5, 0.8)`. Un noul cerca de 0.5 es empate sí/no en el contrato público de TypeSafe, no una media | No bajar. Subir por clase de acción solo con journal, y siempre ≥ 0.5 |
| `0.25` | `second_mass` máxima para auto-apply | El mismo upgrade. El 0.25 nace como ejemplo de routing por confianza en TypeSafe y el desk lo adoptó como corte | No subirlo sin filas (eso afloja). Bajarlo es endurecer y puede esperar al sombra |

Los ejemplos 0.6 / 0.85 / 0.9 de las docs de TypeSafe son de otros dominios. No son ley Abaco.

Calibrar es comparar, en sombra, el cuerpo viejo de strings contra `advanced_v1` sobre los mismos inputs, y mirar si el piso se afloja. Eso está marcado LATER en el upgrade. Hasta entonces la fórmula de §1 es la receta. Una fila sorprendente no retoca los números al día siguiente.

Costo. Una llamada corta, pocas questions: ~\$0.0001–\$0.0002 (plan de mesa, 2026-09-21). El fan-out (un noul por opción, dos scores) sigue siendo **una** llamada; el precio de partirlo en N POST no se paga. Tope práctico de la mesa: unas pocas decisiones por día. El tope de 40/h es del piloto de pulso, no una meta para llenar.

Anti-spam, en orden:

1. ¿CODE ya decidió? Parar.
2. ¿Hay un solo camino legal? Hacerlo.
3. ¿Este `title` ya está hoy y los contadores no se movieron? Parar.
4. ¿La lista de opciones trae un widen? Cortar antes del POST.
5. ¿La fila gris tiene una sola salida? Hacerla, sin segundo POST.

---

## 7. Punta

Lo que esta receta deja escrito, y que un laboratorio suele saltarse al poner un modelo junto a un broker:

- El modelo no es el autorizador. El autorizador es código, y sigue siéndolo cuando Jev tiene razón.
- Lo no autorizado se niega. Lo admitido no se congela porque un tercero hizo ruido.
- Hay un piso numérico en código, una barra más alta para el auto-apply, y una fila de journal cuando la API calla. El callar no es un allow.
- El choice tiene puerta de salida (`hold_for_human`). El modelo no está obligado a bendecir una lista mala.
- Cada opción trae su propio noul, armado antes de ver la respuesta. No hay segunda llamada «para confirmar».
- El pulso de cada minuto y la mesa de ingeniería no comparten reloj. El papel de BTC no comparte cola.

Eso es el uso de todos los días. El endurecimiento del cuerpo HTTP está en el memo de integración. El piloto de sensores está en el análisis de Security Pulse. Aquí no se reescriben.

---

## 8. Límites

- No añade cliente, clave, ni import en `authorize()`, Bind, admisión o pin.
- No mergea a `main` por sí solo.
- No define la suite «stress A–E». Solo dice dónde cae una lista residual de GAPs.
- No mueve F1, connectors (siguen **HOLD**), ni el pin `jev-1.13.0`.

## Fuentes

- Plan de mesa (2026-09-21) y upgrade `advanced_v1` (2026-09-22): desk fuera de este árbol; pisos y barra citados aquí.
- [`FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md`](FRONTIER-JEV-ADVANCED-INTEGRATION-2026.md) — forma del body y por qué no se baja el piso.
- [`JANICE_ATENA_NAMING_LAW.md`](JANICE_ATENA_NAMING_LAW.md) — Janice ejecuta, Atena aconseja, seguridad ≠ parar la evolución.
- [`JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md`](JEV_SECURITY_PULSE_PLUGIN_ANALYSIS_G47.md) — piloto 60–90 s / 40/h. No es el reloj de estos cinco modos.
- [`PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md`](PAPER-PLUGINS-VS-TRADITIONAL-JEV-PULSE.md) — trips duros que no esperan a Jev.
- [`PORTABLE_RULES_FOR_PYTHON_CORE.md`](PORTABLE_RULES_FOR_PYTHON_CORE.md) — la misma ley, sin teatro Cordis.
