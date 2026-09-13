# F2-W1 · Reporte worker-cascada — Cascada asesora G1→G2→G3

**Worker:** F2-W1 · **Fecha:** 2026-09-13 · **Estado:** COMPLETO (12/12 tests + repro verde)

## Qué se hizo

Implementada la cascada asesora en `desktop/src/dsh-desktop/packages/abaco-effect-broker/cascade.js`
(ESM, cero dependencias externas, sin red), con la interfaz congelada del contrato:

- `evaluate(finding)` → `{ severity:0..3, escalations, advisorNotes, decidedBy:'G1'|'G2'|'G3' }`
- `janiceAdvise(finding)` → `{ proposal:{severity, action}, rationale }` — **STUB determinista**,
  función pura sin acceso a ningún sink: solo propone, nunca ejecuta.

Capas:

- **G1 — triage determinista barato, función pura.** Tabla de reglas ordenada: spoof de
  procedencia (gap claim−effective ≥ 2 → severity 3, escenario rojo del red team), kind crítico
  caliente, kind crítico, señal crítica/sospechosa, brecha leve (gap=1 → watch + escalar),
  context-risk, y caso trivial (G1 decide solo con severity 0/1 y sin banderas).
- **G2 — sentinel heurístico determinista (scoring 0..100, SIN LLM).** Pondera severidad máx.
  de señales (×20), gap de procedencia (×10), multi-fuente, señales en conflicto, kind crítico,
  context-risk y firstSeen. Escala a G3 si score ≥ 60, o si hay spoof confirmado (gap ≥ 2) con
  score ≥ 40. Puro: mismo finding → mismo score.
- **G3 — `janiceAdvise` (stub).** Propone severity = evidencia directa + kind crítico + riesgo,
  acción de un set cerrado (`none|observe|quarantine|deny-and-escalate-human`) y rationale
  trazable. A propósito NO replica la lógica de spoof de G1 — G1 ya fijó el piso y la regla
  de oro impide que el stub lo baje (esto se ejercita en los tests 4b y el repro).
- **REGLA DE ORO en código** (`applyAdvisorResult`): G2 y G3 solo pueden SUBIR la severidad
  vigente al ser consultados. Todo intento de bajarla se ignora y se audita como
  `advisor-downgrade-attempt` (audit interno append-only, observable vía `getCascadeAudit()`,
  limpiable solo con `resetCascadeForTests()`).
- La cascada **nunca ejecuta efectos ni decide por el broker**: `evaluate` devuelve solo la
  recomendación asesora (test 8 lo verifica estructuralmente: sin imports, sin red, sin claves
  de decisión). G0 (`authorize` en `index.js`) sigue teniendo la última palabra — `index.js`
  **no se tocó**.

## Evidencia

- `node --test .../tests/cascade.test.mjs` → **13/13 PASS** (12 casos + resumen), exit 0.
  Incluye los exigidos: asesor intenta bajar 3→1 en G2 (test 4a) y en G3 (test 4b) — ambos
  ignorados + auditados; escalada completa G1→G2→G3 (tests 5 y 12); G1 decide solo en caso
  trivial (tests 1, 2); stub puro/determinista/sin efectos (test 7); input defensivo (test 9);
  auditoría append-only (test 10).
- `node reports/repro-cascada.mjs` → **exit 0**. ANTES: pipeline ingenua que acepta la
  propuesta del asesor verbatim → severity final **1** (la bajada 3→1 ocurre, silenciosa).
  DESPUÉS: `evaluate()` sobre el mismo finding → severity final **3**, `decidedBy='G3'`,
  con dos eventos `advisor-downgrade-attempt` auditados (G2 intentaba 3→2, G3 intentaba 3→1).
- Solo cambiaron los 4 `allowed_files` del brief. Archivos vecinos modificados hoy
  (`breakers.js`, `tiers.js`, `provenance.js`, `threat-model.js`, …) pertenecen a los workers
  hermanos W2–W5 en paralelo; este worker no los tocó.

## Decisiones pendientes (declaradas por escrito)

1. **`janiceAdvise` es un stub.** El LLM real de Janice se conecta después manteniendo la
   interfaz congelada. Pide decisión del líder: dónde vive el LLM, timeout y comportamiento
   fail-closed si no responde, y quién autoriza su cableado. El stub actual es determinista
   para que la suite F2 sea reproducible.
2. **Umbrales de G2 (60, y 40 con spoof) son heurística inicial.** Pendiente de afinado con
   datos reales o criterio del líder; están centralizados en `g2Score` para cambiarlos sin
   tocar la interfaz.
3. **Audit de cascada es en memoria** (proceso). W6 (integración) deberá reenviar los eventos
   `advisor-downgrade-attempt` al audit append-only con hash chain de W3 (`provenance.js`)
   para durabilidad. Declarado aquí como hook pendiente, no implementado (fuera de alcance W1).
4. **La cascada aún no es consultada por `authorize`.** El cableado asesor (solo-escala) en
   `index.js` corresponde a W6; ningún comportamiento del broker cambió en este worker.
5. Si un finding llega sin `provenance.effective`, se deriva como `min(claim, channel)` por
   ordinal — misma regla que F1-P2 y W3. Documentado como comportamiento, no como cambio
   de interfaz.
