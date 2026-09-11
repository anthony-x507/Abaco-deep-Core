# CONTRACT — Memoria 3 fases (profile / log / note) + Principle C/D + spill cap

**Estado:** LOCK de arquitectura. Branch `feat/memory-3phase-spill-cd` @ tip `972b866` (base `fase5-paso2-telemetria`).
**Autor:** UNIVERSAL ARQUITECTO · 2026-09-10 · reporta a ABACO LEADER.
**Fuentes que manda este contrato (no las reescribe):** `docs/SPEC-CONTEXT-3-LAYERS.md` §8 (candado 0.90/0.12/8192 + §8.10 orden), `docs/COLLABORATOR-CRITERIA.md` §12, `docs/HANDOFF-FASE5.md` §5 y §7.12.
**Fuera de alcance explícito:** no editar `abaco-voice`, `abaco-documents`, ni layout del browser.

---

## 0. Candado vivo (no reabrir)

| Clave | Valor | Nota |
|---|---|---|
| `thresholdRatio` | **0.90** | Disparo duro. NO 0.80 stock, NO 0.60 archivo muerto. |
| `retainRatio` | **0.12** | Debe ser `< thresholdRatio`. Solo ratios — **prohibido** `retainTokens` absoluto. |
| `maxTokens` | **8192** | Presupuesto del LLM de resumen. |
| Preset | `abaco` | Ya cableado en `packages/abaco-context/presets/abaco/agent.cordis.yml:207-208`. |
| Criterio done §8.6.6 | — | Si algo impide 0.90 seguro → **reportar con evidencia; no bajar a 0.80 sin preguntar**. |

---

## 1. Tres copias del motor — `$DSH_NM`

| Copia | Ruta | Autoridad |
|---|---|---|
| **AUTORITATIVA** | `/Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai` | **Única** para citar `archivo:línea` del comportamiento de ABACO. Alias: `$DSH_NM`. |
| Build del repo | `desktop/src/dsh-desktop/node_modules/@deepseek-ai` | Entrada de build; no manda si diverge. |
| App ajena | `/Applications/DSH Desktop.app/.../@deepseek-ai` | **Otro producto.** Sin autoridad. |

**Perfiles (R13):** `$DSH_HOME` ABACO = `~/Library/Application Support/abaco-deep-core/harness/`. Perfil `…/dsh-desktop/` = **INTOCABLE**. Sin nombrar el perfil, el dato no se usa.

**Cita spill corregida:** hueco subagente = `$DSH_NM/dsh-subagent/lib/index.js:1761-1777` (`notifySettlement` + `...terminal.output`). La cita `:1725-1742` de docs viejos es **desfasada**.

---

## 2. Tres fases de memoria durable — `profile` / `log` / `note`

Ortogonal a las 3 **capas de contexto** (ventana / durable / spill). Esto fija **cómo se escribe y se envejece** la Capa 2 (`abaco-memory`), sin inventar almacén nuevo ni eventos de sesión (sidecar only; vocabulario de sesión cerrado).

| Fase | Persistencia | Scopes / facets canónicos (`lib/schema.js`) | Regla |
|---|---|---|---|
| **profile** | ∞, `pinned` gana | scope `profile`+`role`: `preferences_user`, `constraints_do_not`, `output_format`, `identity` | Siempre inyectable. Nunca parafrasear. `source: user` → priority 3. |
| **log** | durable fechado | scope `project`: `decisions`, `facts` (TTL 90d), `artifacts` (solo locator), + `audit/memory.jsonl` | Hechos verificables con `source`+`createdAt`. Sobrevive compactación y reinicio. |
| **note** | TTL / sesión | scope `session`: `tasks` (TTL 30d done), `open_questions`, `meta` de turno | Working state. Puede expirar/archivar. No satura el presupuesto de render. |

**Presupuestos (ya en schema, no cambiar sin Leader):** `MEMORY_MAX_RENDER_CHARS=6000`; budgets profile 1500 / project 2500 / session 1500 / role 500; `MEMORY_MAX_ENTRY_CHARS=240`.

**Protocolo de escritura (paso 6 del orden):**

1. Explícito: tools `abaco_memory_set|get|forget|list` (nombres vivos; no inventar `memory_*` sin alias).
2. Antes de **cualquier** compactación autorizada (Principle C): persistir hechos **profile/log** relevantes — no solo el summary efímero.
3. Snapshot congelado por turno: escrituras en el turno N afectan el system prompt en N+1 (no invalidar KV-cache a mitad de turno).
4. **Prohibido** `session.append("abaco-memory/…")` — sidecar only.
5. Subagentes: no escriben profile del padre; restrict tools o filtrar por `origin:'subagent'`.

**Gates de aceptación (fase memory):**

- Tras `abaco_memory_set` en profile → reinicio app → sección `abaco:durable-memory` contiene el texto verbatim.
- Tras 1 compactación, entradas profile/log siguen en disco byte-idénticas; notes de sesión pueden podarse por TTL/cap, nunca en silencio (journal).
- 0 tipos de evento nuevos en el log de sesión (reapertura OK).

---

## 3. Spill cap (paso 3 del orden) — Capa 3

| Superficie | Contrato |
|---|---|
| Tools `post-execute` | Ya: `spill-policy.maxInlineBytes: 12000` en `build/dsh-desktop.patch.yml`. No subir sin Leader. |
| **Hueco obligatorio** | `notifySettlement` (`$DSH_NM/dsh-subagent/lib/index.js:1761-1777`): `terminal.output` **verbatim sin tope** como `user/message`. **Debe** cortarse / vault + locator **antes** del append (`agent/pre-step` o patch contenido). |
| Vault | Durable bajo `$DSH_HOME/abaco-memory/vault/` (no `tmpdir` del spill-local). Faceta `artifacts` = puntero, no body. |
| Formato al padre | `goal / result / artifacts paths / errors` — no transcript completo. |
| Best-effort | Si vault falla → conservar inline (mismo contrato stock); telemetría registra el fallo. |

**Gate:** subagente background con output > 12 KB → ventana recibe corte+locator; vault tiene el verbatim; telemetría `abaco-context.jsonl` registra spill/truncado.

---

## 4. Principle D — errores literales (paso 4)

| Sitio | Contrato |
|---|---|
| Pruner | Guarda: si `isError === true` → **no** `pruneContent`. Cubre presión (`:886`) y overflow prune (`:872`). |
| Summarizer | Errores **fuera** del corpus a condensar, o sección con **transcripción literal** (no «how it was resolved»). Formato retenido: `ERROR \| tool \| mensaje crudo`. Truncar bytes de stack OK; parafrasear **prohibido**. |
| Ya cubierto (no reimplementar) | La marca `isError` sobrevive al replace del pruner; existe sección `"## Errors and Fixes"`. El paso 4 es la **guarda que actúa** + regla literal. |

**Gate:** tool/result `isError` con marcador único en char 8500 (> thresholdChars) → tras compactar el marcador sigue; gemelo `isError:false` → marcador desaparece.

---

## 5. Principle C — primer permiso (paso 5)

| Regla | Contrato |
|---|---|
| Primera compactación de la **sesión** | Pedir confirmación UI. Sin aceptar → **no** compactar. |
| Tras aceptar | Automático en esa sesión (o hasta cambio de preferencia). |
| Rechazo | Soft-warn; **no** repreguntar en bucle cada pre-step; volver a preguntar solo al **próximo** cruce de umbral. Flag anti-bucle obligatorio (R4). |
| Flag | Sobrevive a la compactación; candidato: Capa 2 scope `session` (fase **note**/meta). |
| Antes de compactar | Persist profile/log relevantes (enlace con §2). |

**Gate:** sesión nueva cruza 0.90 → (a) UI pide; (b) reject = 0 checkpoints + detalle íntegro; (c) accept = 1 checkpoint; (d) segundo cruce = sin pedir de nuevo.

**Bloqueante [NO VERIFICADO]:** servicio exacto de aprobación en el stack — confirmar con Inspect/`grep` composiciones **antes** de cablear.

---

## 6. Orden de implementación vigente (pasos 3–7)

Pasos 1–2 **cerrados** en la línea `fase5-paso2-telemetria` (fontanería 0.90/0.12 + `abaco-observability`).

| # | Paso | Owner típico |
|---|---|---|
| 3 | Spill cap subagente (`:1761-1777`) | INGENIERO (patch / pre-step) |
| 4 | Principle D (`isError` + literal) | INGENIERO |
| 5 | Principle C (UI confirm + anti-bucle) | INGENIERO (+ UI mínima; **no** layout browser/voice/docs) |
| 6 | Protocolo escritura profile/log/note | INGENIERO sobre `abaco-memory` |
| 7 | Recall / consolidación / motor propio | Más tarde; no empezar antes de 3–6 medidos en jsonl |

**Regla de medición:** cada paso deja huella en `$DSH_HOME/logs/abaco-context.jsonl` (campos lock: `used_before`/`used_after`/`thresholdTokens`/`retainTokens`/`model route` + spill/`isError` según el paso).

---

## 7. Qué NO se toca en este track

- `packages/abaco-voice/**`
- `packages/abaco-documents/**`
- Layout / columna browser (`abaco-browser` panel, overlay → details) — carril P1 aparte
- Perfil `~/Library/Application Support/dsh-desktop/`
- Bajar el candado 0.90/0.12 sin preguntar a Leader
- Notarización chase; `--reporter=basic`

---

## 8. Entrega de este LOCK

- Archivo: `docs/CONTRACT-MEMORY-3PHASE-SPILL-CD.md` (este).
- Branch: `feat/memory-3phase-spill-cd`.
- Siguiente: INGENIERO implementa **paso 3** contra este contrato; ARQUITECTO no escribe código de motor salvo enmienda del LOCK pedida por Leader.
