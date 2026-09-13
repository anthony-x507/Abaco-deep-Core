# Worker procedencia F2 (W3) — reporte

Fecha: 2026-09-13 · Worker: W3 (procedencia completa) · Coordinadora: Atena (F2)

## Qué se hizo
- Implementado el módulo reusable de procedencia en
  `desktop/src/dsh-desktop/packages/abaco-effect-broker/provenance.js`:
  - `TRUST_ORDINAL` congelado según §W3: system(5) > developer(4) > guardian(3) > user(2) > plugin-data(1) > untrusted(0).
  - `tag({content, claim, channel})` → `{ content, claim, channel, effective, hash }`, con
    `effective = min(ordinal(claim), ordinal(channel))` — misma regla que F1-P2, ahora como módulo reusable.
  - Claims desconocidos/malformados fallan cerrados a `untrusted` (ordinal 0).
  - Hash de integridad: sha256 (node:crypto built-in, cero dependencias externas) sobre la
    canonización determinista de `{content, claim, channel, effective}` (claves ordenadas
    recursivamente, orden de inserción irrelevante).
  - `verify(record)` → bool: recalcula el hash; cualquier tamper (contenido, claim, channel,
    effective, hash) → `false`.
  - `audit(entry)` → registro sellado `{ seq, entry, prevHash, hash }` append-only
    (sin API de update/delete); `hash = sha256(seq ‖ entry ‖ prevHash)`, génesis `GENESIS`.
  - `verifyAudit()` → bool: valida toda la cadena (seqs contiguos desde 0, cada `prevHash`
    encadena al hash previo, cada hash recalcula).
  - `resetAuditForTests()` — helper SOLO para tests (no forma parte de la interfaz §W3);
    producción nunca lo llama.
- 14 casos deterministas en `tests/provenance.test.mjs` (mínimo exigido: 8). 14/14 verdes.
- Repro antes/después en `reports/repro-provenance.mjs`, exit 0.

## Evidencia
- `node --test tests/provenance.test.mjs` → **tests 14 · pass 14 · fail 0**.
- `node reports/repro-provenance.mjs` → **exit 0**; salida:
  - ANTES (claim autodeclarado `user`, sin atar al canal): sink = **GRANT** (vulnerable).
  - DESPUÉS (`tag()` → effective=`plugin-data`): sink = **DENY** (protegido), `verify()=true`, `verifyAudit()=true`.
- Escenarios rojos cubiertos en tests:
  1. Inyección indirecta: `claim='user'` sobre canal `plugin-data` → `effective='plugin-data'` (test 2).
  2. Tamper de contenido → `verify` false (test 8); tamper del hash → false (test 9);
     forgery de upgrade `effective:'user'` con hash viejo → false (test 10).
  3. Cadena de auditoría manipulada (contenido reescrito, test 13; `prevHash` forjado, test 14)
     → `verifyAudit` false.
- Solo cambiaron los 4 `allowed_files`; `index.js` y el resto del árbol intactos (lectura solamente).
- Sin `npm install`, sin red; ESM puro; node v24.20.0.

## Decisiones pendientes (por escrito)
1. **Ordinales F1 vs F2**: `index.js` (F1-P2) usa una escala de 4 niveles (`host`=3) mientras que el
   contrato F2 §W3 fija 6 niveles (`system`=5, `developer`=4, `guardian`=3). Este módulo implementa
   la escala F2 congelada. En W6 (integración) habrá que decidir el mapeo — p. ej. el `host` de F1
   equivale a `system` de F2, y `deriveChannelTrust` deberá hablar el vocabulario de 6 niveles.
   Decisión para la coordinadora / líder.
2. **Persistencia del audit log**: el log es in-memory (proceso). Si F2 requiere persistencia
   entre reinicios, la coordinadora debe briefear el store (archivo append-only firmado) — fuera
   del alcance de este módulo por diseño.
3. **Firma asimétrica**: fuera de alcance por orden explícita del contrato (bloqueado). El hash
   sha256 detecta tamper, no atribuye autoría; eso queda como decisión pendiente del líder.
