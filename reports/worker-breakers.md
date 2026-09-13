# Worker F2-W2 — Circuit breakers por plugin · Reporte

**Fecha:** 2026-09-13 · **Worker:** F2-W2 · **Estado:** COMPLETO (20/20 tests + repro verde, exit 0)

## Qué se hizo

Implementado `desktop/src/dsh-desktop/packages/abaco-effect-broker/breakers.js`
(ESM puro, cero dependencias, sin reloj/aleatoriedad/I/O/red — 100% determinista)
con la interfaz congelada del contrato §W2:

- `record(pluginId, signal)` — `signal = { type, severity: 0..3, source, humanApproval? }` → devuelve snapshot `{ level, threat, signalCount }`
- `state(pluginId)` → `{ level: 0..4, threat: 0..3, signalCount }` (plugin desconocido = observe/threat-0, sin throw)
- `resetForTests()` — limpia todo el estado

**Respuesta graduada** `observe → throttle → quarantine → kill → blocklisted`,
espejo del threat: severity 1 = watch (observe, vigilado sin limitar), severity 2 →
throttle, severity 3 de una sola fuente → quarantine. Escalada inmediata (la señal
manda); desescalada solo tras ventana limpia sostenida.

**Regla de kill (dura, en código):** nivel 3 exige **2 fuentes independientes**
(distinct `source`, severity ≥ 2, dentro de la ventana de las últimas 64 señales)
**o** flag `humanApproval`. Una sola fuente, aunque emita severity 3 mil veces,
jamás mata sola — queda en quarantine. Kill y blocklist nunca auto-salen con
señales limpias; su única salida es release humano explícito
(`severity: 0 + humanApproval: true`).

**Histéresis:** threat sube al instante (`max(threat, severity)`); baja **un paso
por cada 6 señales limpias consecutivas**, y cualquier señal severity ≥ 1 reinicia
el contador. El nivel desescala paso a paso (nunca 2→0 de golpe), así el flapping
no puede oscilar.

**Salida de cuarentena (camino medible al "sí"):** 6 señales limpias consecutivas
→ quarantine→throttle; 12 → throttle→observe; 18 → threat 0. Cualquier señal
mala en medio reinicia el conteo desde cero.

**Blocklist (nivel 4):** terminal salvo release humano. Vías: tercera fuente
independiente en critical tras un kill (ataque coordinado confirmado), o señal
humana `type: 'human-blocklist' + humanApproval`.

**Aislamiento:** `Map` por `pluginId`; ningún estado global. Entradas malformadas
→ `TypeError` determinista (fail-closed en la validación, no silenciamiento).

## Evidencia

- Suite: `node --test …/tests/breakers.test.mjs` → **20/20 PASS** (mínimo exigido: 10).
  Casos del contrato cubiertos: sola severity-3 NO mata (test 6, 7); dos fuentes
  independientes SÍ matan (test 8); flapping no oscila (test 15, 16); salida de
  cuarentena funciona y es medible (test 17); kill estable ante 100 limpias
  (test 12); aislamiento por plugin (test 19); validación fail-closed (test 2).
- Repro: `node reports/repro-breakers.mjs` → **exit 0**. ANTES: 20 señales
  severity-3 de 2 fuentes con monitor ingenuo → acción `none` (rojo: sin
  consecuencia). DESPUÉS: la misma secuencia escala
  observe→throttle→quarantine→**kill**, y un segundo plugin demuestra la salida
  de cuarentena en 6/12/18 limpias (verde).
- Solo se crearon los 4 `allowed_files`. `index.js` y el resto solo se leyeron;
  no se tocó ningún otro archivo (verificado por listado; el seed no es repo git).

## Decisiones pendientes (para el líder / la coordinadora)

1. **Umbral de kill: 2 fuentes con severity ≥ 2 (no solo severity 3).** Decisión de
   diseño del worker: dos "suspicious" independientes ya matan; dos "watch" no.
   Si el líder quiere kill solo con doble critical, es un cambio de una línea
   (`severeSources`: `>= 2` → `=== 3`). **Se pide ratificación.**
2. **Semántica de `humanApproval`:** hoy `severity ≥ 1 + humanApproval` = kill
   inmediato (cualquier tipo salvo `human-blocklist` → blocklist;
   `severity 0 + humanApproval` = release total). Queda pendiente quién está
   autorizado a emitir esa flag (fuente de verdad humana) — eso lo define la
   integración (W6), no este módulo.
3. **Ventanas:** `CLEAN_DECAY_WINDOW = 6`, anillo de 64 señales. Números
   razonados pero no calibrados contra tráfico real; W6/integración podrá
   ajustarlos con datos.
4. **Integración con `authorize()`:** fuera de alcance (W6). Este módulo solo
   computa estado; el broker decidirá deny ante quarantine/kill/blocklist.
5. **Sin LLM en este módulo por diseño:** el breaker es 100% determinista; la
   cascada asesora (W1) alimenta `signal.severity/source`, nunca decide niveles.

**Nota de proceso:** un fallo golpeó una vez (el repro mezclaba fuentes en la
escalera y el kill disparó antes de lo narrado — comportamiento correcto según
la regla documentada, error del guion del repro, no del módulo). Corregido al
primer intento; no hubo segundo golpe sobre el mismo fallo.
