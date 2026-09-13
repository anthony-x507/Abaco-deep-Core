# F2-CHECKPOINT (vivo) — coordinadora F2, 2026-09-13

## Hito 1 — Siembra + contrato ✅ (04:27 ET)
- F2-WORK = copia exacta de F1-FIX/work (diff verificado). Contrato en ~/workspace/abaco-work/F2-CONTRACT.md.

## Hito 2 — Capacidades (verificación ciega propia)
- [x] W3 procedencia: VERIFIED PASS — 14/14 re-corridos por la coordinadora + repro exit 0. Scope limpio (solo provenance.js + tests/ + 2 reportes). Nota: el worker añadió `resetAuditForTests()` (helper solo-tests, fuera de la interfaz §W3; aceptable, avisar a W6).
- [x] W1 cascada: VERIFIED PASS — 13/13 re-corridos por la coordinadora + repro exit 0. Scope limpio (solo cascade.js + tests/cascade.test.mjs + 2 reportes). Regla de oro verificada: asesor intenta bajar 3→1 (G2 y G3) → ignorado + auditado. 4 decisiones pendientes en worker-cascada.md (janiceAdvise es stub — LLM real requiere decisión del líder; umbrales G2; audit→hash-chain en W6; cableado en W6).
- [x] W2 breakers: VERIFIED PASS — 20/20 re-corridos por la coordinadora + repro exit 0. Scope limpio (solo breakers.js + tests/breakers.test.mjs + 2 reportes). Regla dura verificada: kill exige 2 fuentes independientes o humanApproval; histéresis anti-flapping; salida de cuarentena medible. 4 decisiones pendientes en worker-breakers.md (ratificar umbral kill, fuente de verdad de humanApproval, calibración de ventanas 6/64, integración en W6).
- [x] W4 tiers: VERIFIED PASS — 12/12 re-corridos por la coordinadora + repro 8/8 exit 0. Scope limpio (solo tiers.js + tests/tiers.test.mjs + 2 reportes). Tabla de 16 justificada por capabilities; DISABLED espejo de DISABLED_PLUGINS verificado por test. 4 decisiones pendientes para el líder en worker-tiers.md (re-tier cloud-sync, distinciones finas de capabilities, espejo vs fuente única, cableado a authorize() en W6).
- [x] W5 memoria: VERIFIED PASS — 14/14 re-corridos por la coordinadora + repro 9/9 exit 0. Scope limpio (threat-model.js + THREAT-MODEL.md + tests/; index.js/lib intactos). Notas: (1) opt-in vs por defecto → default seguro cuarentena ON, pendiente de Anthony; (2) el MemoryStore real aún NO tiene cuarentena cableada — paso de integración posterior, declarar en veredicto.

## Hito 3 — Integración W6: COMPLETO + VERIFIED PASS — 99/99 re-corridos por la coordinadora (exit 0). Scope limpio (index.js +345/-3 aditivo; 26 archivos nuevos). Veredicto global + diff-stat + resumen ejecutivo listos. ✅
## Hito 4 — Suite final + veredicto global + resumen ejecutivo (pendiente)
