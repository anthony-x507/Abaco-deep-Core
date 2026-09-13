# Worker F2-W5 — Threat model de memoria 3 fases

Fecha: 2026-09-13 · Worker: F2-W5 · Contrato: `~/workspace/abaco-work/F2-CONTRACT.md` (§W5)

## Qué se hizo

Implementado el threat model de la memoria 3 fases (profile/log/note) como
módulo standalone, determinista, ESM, cero dependencias externas (hash con
`node:crypto` built-in; sin npm, sin red, sin FS):

1. **Procedencia por hecho** — `makeFact({content, provenance})` produce
   `{ content, provenance:{claim,channel,effective}, hash, state:'quarantined',
   createdAt }` con `effective = min(claim, channel)` sobre el ordinal congelado
   del contrato (`system5>developer4>guardian3>user2>plugin-data1>untrusted0`),
   misma regla que F1-P2 y coherente con W3 `provenance.js`.
2. **Cuarentena de profile** — todo hecho nace `quarantined`; `readProfile()`
   solo expone `admitted`. `admit(fact, reviewer)` rechaza con códigos
   documentados: `INTEGRITY` (hecho modificado), `STATE_POLICY` (doble
   admisión), `MASQUERADE` (claim supera al canal verificado),
   `PROVENANCE_POLICY` (effective < user), `REVIEWER_POLICY` (revisor inválido
   o con trust < guardian). Devuelve un hecho NUEVO (no muta la entrada).
3. **Hash chain** — `appendToLog(fact)` append-only (`seq, factHash, prevHash,
   entryHash, recordedAt`, génesis `GENESIS`); `verifyChain()` → false ante
   cualquier tamper (hash, enlace o secuencia).
4. **Documentación** — `THREAT-MODEL.md`: procedencia por hecho, cuarentena,
   hash chain, escenario rojo del red team (inyección indirecta→memoria),
   garantías/límites y decisiones abiertas.

## Evidencia

- Suite: `node --test .../abaco-memory/tests/threat-model.test.mjs` →
  **14/14 PASS** (mínimo del contrato: 8).
- Escenario rojo verificado en test 5: hecho inyectado con `claim:'user'` y
  `channel:'plugin-data'` → `admit` rechaza (`MASQUERADE`), queda en cuarentena,
  `readProfile()` vacío. Test 13: tamper del log (hash, prevHash, orden) →
  `verifyChain()` false en los tres casos. Test 4: camino legítimo
  cuarentena→admitido con revisor guardian funciona y `readProfile` lo expone.
- Repro antes/después: `node reports/repro-memoria.mjs` → 9/9 PASS, **exit 0**.
  ANTES: el claim `'user'` del plugin entra directo al profile (vulnerabilidad
  demostrada). DESPUÉS: cuarentena + rechazo + promoción verificada + chain
  verificable.
- Archivos tocados (solo allowed_files): `threat-model.js` (nuevo),
  `tests/threat-model.test.mjs` (nuevo), `THREAT-MODEL.md` (nuevo),
  `reports/repro-memoria.mjs` (nuevo), `reports/worker-memoria.md` (este).
  `index.js` y `lib/` del paquete: **no tocados** (solo lectura). Verificado:
  `git`-style check por listado — ningún otro archivo del paquete fue
  modificado.

## Decisiones pendientes (declaradas por escrito, no decididas por el worker)

1. **Memoria opt-in vs por defecto (Anthony).** Implementado el default seguro:
   **cuarentena ON** (todo hecho nuevo en cuarentena; la promoción exige
   revisor ≥ guardian). La decisión final del default queda pendiente de
   Anthony — ver §5 de THREAT-MODEL.md.
2. **Piso del revisor en `guardian`.** Conservador por diseño (el usuario no se
   auto-admite; coherente con Janice/G3 como auditora). El líder puede ajustarlo
   (`MIN_REVIEWER_TIER`).
3. **Cableado con el store real.** El módulo es standalone a propósito; el
   `MemoryStore` y las tools `abaco_memory_*` existentes **aún no tienen
   cuarentena**. El cableado es un paso de integración posterior (W6 o worker
   dedicado). Se declara por escrito: no asumir que el store actual está
   protegido.

## Notas

- Regla de las 3 piedras: no hizo falta invocarla (1 fallo de expectativa en
  test, corregido al primer golpe: el escenario rojo dispara `MASQUERADE`,
  no `PROVENANCE_POLICY`, porque el claim supera al canal verificado).
- Nada inventado: todo lo afirmado está cubierto por tests o declarado como
  límite/pendiente en THREAT-MODEL.md §6.
