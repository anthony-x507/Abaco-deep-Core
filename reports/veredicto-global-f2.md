# Veredicto global F2 — Integración final (W6)

**Fecha:** 2026-09-13 · **Worker:** F2-W6 · **Coordinadora:** Atena
**Comando verificado:** `node reports/run-f2-suite.mjs` → **exit 0**

## Números finales

| Suite | Casos | Estado |
|---|---|---|
| F1 histórica (vitest, `test/abaco-f1-mediacion-broker.test.ts`) — **sin tocar** | 12/12 | 🟢 |
| F2-W1 cascada (`cascade.test.mjs`) | 13/13 | 🟢 |
| F2-W2 breakers (`breakers.test.mjs`) | 20/20 | 🟢 |
| F2-W3 provenance (`provenance.test.mjs`) | 14/14 | 🟢 |
| F2-W4 tiers (`tiers.test.mjs`) | 12/12 | 🟢 |
| F2-W5 threat-model (`threat-model.test.mjs`) | 14/14 | 🟢 |
| F2-W6 integración (`f2-integration.test.mjs`, nuevo) | 14/14 | 🟢 |
| **TOTAL** | **99/99** | 🟢 |

`run-f2-suite.mjs` corre las 7 suites en orden (F1 primero) y sale 0 **solo si
todas están verdes**; cualquier rojo → exit 1 con la salida del fallo.

## Qué quedó verde (qué se cableó)

`authorize()` en `packages/abaco-effect-broker/index.js` — **único archivo
existente tocado** — ahora consulta, en orden, antes de la lógica F1 (intacta):

1. **Tiers** — `tierOf(pluginId) === -1` → deny `unknown-plugin`; `isDisabled()`
   → deny `plugin-disabled` (razón F1 preservada).
2. **Provenance** — `effective` recalculado bajo el ordinal F2 (6 niveles) vía
   `provenance.tag()` como verificación cruzada fail-closed de la P2
   (`provenance-drift` si divergen; inalcanzable en pilot, es guarda).
3. **Breakers** — `state(pluginId)`: quarantine/kill/blocklisted → deny
   (`breaker-quarantine` / `breaker-kill` / `breaker-blocklisted`); throttle
   **marca en el audit pero no deniega solo** (G0 decide).
4. **Cascada** — corre solo en el camino que F1 aprobaría: severity 3 →
   deny `cascade-escalation` (escalada permitida); severity 2 → marca en audit;
   0/1 → sin cambios. **Un deny de F1 jamás se convierte en allow**
   (la cascada no corre en ningún camino de deny — regla de oro).

G0 mantiene la última palabra; deny-by-default en todo el camino. La lógica
P1/P2/P3 y los 12 tests históricos están **intactos** (misma suite, sin tocar).

**Decisiones del brief W6, tomadas y documentadas en código:**
- **(a) Ordinales F1↔F2:** `host`(F1) = `system`(F2) — ambos son el harness host
  (TCB), tope de su escala. `deriveChannelTrust` nunca emite guardian/developer
  en pilot: el mapeo es total y monótono, `min()` coincide en ambas escalas.
- **(b) Fuente única del disabled set:** `DISABLED_PLUGINS` del broker;
  `tiers.DISABLED` queda como espejo verificado (assert fail-closed al importar
  + test de igualdad de sets).
- **(c) `humanApproval` = flag explícito en la señal** (`req.human_approval`):
  solo se honra si el canal atestigua trust `host`/`system`; en pilot ningún
  canal lo hace → se ignora y se audita (`human_approval: 'ignored'`).
- **(d) Audit de la cascada → hash-chain de `provenance.audit()`** vía
  `forwardCascadeAudit()` (idempotente por seq; `verifyF2Audit()` lo verifica).

**Telemetría broker→breakers (diseño W6, declarado):** cada deny alimenta el
breaker del plugin (`deny:<razón>`, severidad por tabla, fuente única
`broker-authorize` — jamás dispara el kill, que exige 2 fuentes); cada allow
alimenta señal limpia (fuente de "ventana limpia" para la desescalada por
histéresis: 6 allows → throttle→observe, verificado en test 8). Los denies
`breaker-*` **no** se re-alimentan (evita auto-escalada kill→blocklist por la
propia telemetría). La telemetría jamás rompe el autorizador (try/catch).

**W5 en W6:** `threat-model.js` queda **standalone por diseño** (su propio
contrato y reporte lo exigen: el cableado con el `MemoryStore`/tools reales es
un paso posterior). La integración verifica coherencia de vocabulario
(`effective = min(claim, channel)` en ambos) en el test 14.

**Archivos cambiados:** solo los 6 `allowed_files` del brief
(`index.js` modificado; `f2-integration.test.mjs`, `run-f2-suite.mjs`,
`veredicto-global-f2.md`, `diff-stat-f2.txt`, `resumen-ejecutivo-f2.md` nuevos).
Ver `diff-stat-f2.txt`.

## Qué quedó declarado pendiente de decisión (consolidado)

Todo lo cuestionable que los 5 workers dejaron por escrito, con a quién se le
pide. Lo resuelto por W6 se marca ✅; lo demás sigue abierto.

### Para el LÍDER

1. **LLM real de Janice (G3):** `janiceAdvise` es un stub determinista. Dónde
   vive el LLM, timeout, comportamiento fail-closed si no responde y quién
   autoriza su cableado. *(W1-1)*
2. **Umbrales de G2** (score ≥ 60; ≥ 40 con spoof): heurística inicial sin
   calibrar contra tráfico real. *(W1-2)*
3. **Umbral de kill:** hoy 2 fuentes independientes con severity ≥ 2 (dos
   "suspicious" ya matan). Si se quiere kill solo con doble critical, es una
   línea (`severeSources`: `>= 2` → `=== 3`). Se pide ratificación. *(W2-1)*
4. **Quién emite `humanApproval`** (fuente de verdad humana) y su canal
   autorizado. W6 la dejó como flag explícito inerte en pilot. *(W2-2, W6-c)*
5. **Ventanas del breaker** (`CLEAN_DECAY_WINDOW = 6`, anillo de 64 señales):
   razonadas, no calibradas contra tráfico real. *(W2-3)*
6. **Persistencia del audit log** de provenance (hoy in-memory por proceso):
   si F2 requiere persistencia entre reinicios, briefear el store
   (archivo append-only firmado). *(W3-2)*
7. **Firma asimétrica:** bloqueada por contrato; el hash sha256 detecta tamper
   pero no atribuye autoría. *(W3-3)*
8. **Re-tier de `abaco-cloud-sync`:** hoy T0 (skeleton); cuando el backend de
   Fase 3 aterrice (`net.fetch`) debe subir a T3. ¿Quién re-clasifica?
   *(W4-1)*
9. **Taxonomía fina vs gruesa:** mantener `proc.spawn.constrained` /
   `fs.write.confined` (documents y observability en T1) o colapsar
   (documents→T3, observability→T2). *(W4-2)*
10. **Piso del revisor de memoria** (`MIN_REVIEWER_TIER = 'guardian'`):
    conservador por diseño; ajustable. *(W5-2)*
11. **Cableado del threat model con el store real:** `MemoryStore` y las tools
    `abaco_memory_*` **aún no tienen cuarentena**. Es un paso de integración
    posterior (W6 o worker dedicado). **No asumir que el store actual está
    protegido.** *(W5-3)*

### Para ANTHONY

12. **Memoria opt-in vs por defecto:** implementado el default seguro
    (cuarentena ON; todo hecho nuevo nace en cuarentena). La decisión final
    del default la toma Anthony. *(W5-1)*

### Resuelto por W6 ✅ (ya no pendiente)

- Cableado tiers/breakers/cascada en `authorize()` *(W1-4, W2-4, W4-4)*
- Reenvío del audit de cascada al hash-chain de provenance *(W1-3, W6-d)*
- Mapeo de ordinales F1 (4) vs F2 (6) *(W3-1, W6-a)*
- Fuente única del disabled set *(W4-3, W6-b)*
- Semántica documentada de `humanApproval` como flag explícito *(W6-c)*

## Riesgos y límites declarados

- La cascada G3 es un **stub determinista**: asesora con heurística, no con
  LLM. Sus escaladas están acotadas por la regla de oro (código).
- Los breakers dependen de **fuentes de señales**; en pilot las fuentes son el
  propio broker (denies/allows) y llamadas directas de detectores. La
  calibración de ventanas/umbrales contra tráfico real está pendiente (líder).
- El hash-chain de `provenance.audit()` es **in-memory**; la durabilidad
  entre reinicios es la del JSONL F1 existente, no tamper-evident.
- `threat-model.js` protege hechos, **no** el store en uso: la memoria real
  sigue sin cuarentena hasta el cableado pendiente (punto 11).

## Criterios de terminado F2 (contrato) — estado

1. ~~Suite F2 N/N (N≥44) + F1 12/12~~ → **99/99** (73 + 12 + 14 integración). ✅
2. Repro antes/después por capacidad, verde (5 repros, exit 0). ✅
3. Verificación ciega de la coordinadora: **HECHA 2026-09-13 ~04:35 ET** —
   `node reports/run-f2-suite.mjs` re-ejecutado personalmente → 99/99 exit 0;
   scope: único archivo existente modificado = `index.js` (+345/-3 aditivo,
   resto nuevo); artefacto de vitest limpiado. ✅
4. Todo lo cuestionable: corregido con evidencia o declarado por escrito
   arriba. ✅
