# F2 — Resumen ejecutivo para el líder

**Fecha:** 2026-09-13 · **Autorización:** Anthony · **Estado: TODO VERDE (99/99)**

## Alcance

F2 pone inteligencia sobre el broker determinista que cerró F1, sin tocarlo:
cascada asesora G1→G2→G3/Janice (el LLM solo asesora y solo puede **escalar**
severidad, nunca reducirla), circuit breakers por plugin con histéresis,
procedencia completa reutilizable, trust tiers T0–T4 para los 16 plugins
nativos y threat model para la memoria de 3 fases. W6 cableó los 5 módulos en
`authorize()`: tiers → procedencia efectiva → breakers → cascada asesora.
**G0 (el broker) mantiene la última palabra; deny-by-default en todo el camino.**
La lógica P1/P2/P3 de F1 y sus 12 tests están intactos.

## Evidencia

- **99/99 tests verdes**, un solo comando: `node reports/run-f2-suite.mjs`
  (exit 0 solo si todo está verde): F1 12/12 sin modificar + F2 73 casos
  (13+20+14+12+14) + 14 de integración del cableado.
- **5 repros antes/después** (exit 0): cada capacidad demuestra el escenario
  rojo sin el módulo vs. protegido con el módulo.
- Decisiones de diseño del brief, tomadas y documentadas en código: mapeo de
  ordinales F1↔F2 (`host` = `system`); `DISABLED_PLUGINS` del broker como fuente
  única (tiers = espejo verificado); `humanApproval` como flag explícito
  (inerte en pilot hasta que se defina la fuente humana); audit de la cascada
  reenviado al hash-chain de procedencia.
- Solo cambiaron los 6 archivos autorizados (`diff-stat-f2.txt`).

## Pendientes que requieren tu decisión

1. **Janice real:** el G3 es un stub; falta dónde vive el LLM, timeout y
   fail-closed. 2. **Calibración:** umbrales de G2, de kill (hoy 2 fuentes
   sev≥2) y ventanas del breaker — razonados, sin tráfico real. 3. **Quién
   emite `humanApproval`.** 4. **Firma asimétrica** (bloqueada por contrato) y
   **persistencia** del audit log. 5. **Re-tier de cloud-sync** al aterrizar su
   backend; taxonomía fina vs gruesa de capabilities. 6. **Cablear la
   cuarentena al `MemoryStore` real** (hoy el store sigue sin protección:
   no asumirlo cubierto). 7. **Piso del revisor** de memoria (hoy `guardian`).

**Para Anthony:** memoria opt-in vs por defecto (default seguro con
cuarentena ON ya implementado).

Detalle completo: `reports/veredicto-global-f2.md`.
