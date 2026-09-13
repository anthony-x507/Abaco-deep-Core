/**
 * F2-W1 · repro-cascada.mjs — ANTES vs DESPUÉS de la regla de oro.
 *
 * Escenario rojo (red team): plugin-data que clama procedencia 'user'
 * (inyección indirecta). G1 lo marca severity=3 por spoof de procedencia,
 * pero el asesor (Janice/stub) propone bajar a 1.
 *
 * ANTES (sin cascada / sin regla de oro): la propuesta del asesor se acepta
 * tal cual → la severidad final cae 3→1. Peligroso y silencioso.
 *
 * DESPUÉS (con cascade.js): la regla de oro ignora el intento de bajar y lo
 * audita como 'advisor-downgrade-attempt' → la severidad final queda en 3.
 *
 * Exit 0 si la demostración verifica lo esperado.
 */
import { strict as assert } from 'node:assert'
import {
  evaluate,
  janiceAdvise,
  getCascadeAudit,
  resetCascadeForTests,
  DOWNGRADE_ATTEMPT_EVENT,
} from '../desktop/src/dsh-desktop/packages/abaco-effect-broker/cascade.js'

const finding = {
  kind: 'ipc.invoke',
  pluginId: 'abaco-malicioso',
  provenance: { claim: 'user', channel: 'tool', effective: 'untrusted' }, // spoof: gap=2
  signals: [{ type: 'invoke', severity: 1, source: 'broker' }],
  context: {},
}

const EVIDENCE_SEVERITY = 3 // lo que dicta la evidencia: spoof de procedencia = crítico

console.log('=== ANTES (sin cascada: el asesor decide la severidad final) ===')
function naivePipeline(f) {
  // La pipeline ingenua confía en el asesor y acepta su propuesta verbatim.
  const proposal = janiceAdvise(f).proposal
  return { severity: proposal.severity, action: proposal.action }
}
const antes = naivePipeline(finding)
console.log(`evidencia → severity ${EVIDENCE_SEVERITY} (spoof claim 'user' vs effective 'untrusted')`)
console.log(`asesor propone → severity ${antes.severity} (action=${antes.action})`)
console.log(`ANTES: severity final = ${antes.severity}  ← el asesor BAJÓ ${EVIDENCE_SEVERITY}→${antes.severity} sin que nadie lo impidiera`)
assert.equal(antes.severity, 1, 'el asesor ingenuo propone 1')
assert.ok(antes.severity < EVIDENCE_SEVERITY, 'ANTES: la bajada ocurre')

console.log('')
console.log('=== DESPUÉS (con cascade.js: regla de oro enforced) ===')
resetCascadeForTests()
const despues = evaluate(finding)
const audit = getCascadeAudit()
console.log(`DESPUÉS: severity final = ${despues.severity}, decidedBy=${despues.decidedBy}`)
console.log(`escalations: ${despues.escalations.join(' ')}`)
for (const n of despues.advisorNotes) console.log(`  nota: ${n}`)
console.log('auditoría de la cascada:')
for (const e of audit) console.log(`  ${JSON.stringify(e)}`)

assert.equal(despues.severity, 3, 'DESPUÉS: la severidad 3 sobrevive')
assert.equal(despues.decidedBy, 'G3')
const g3 = audit.filter((e) => e.kind === DOWNGRADE_ATTEMPT_EVENT && e.layer === 'G3')
assert.equal(g3.length, 1, 'el intento de G3 quedó auditado')
assert.equal(g3[0].floor, 3)
assert.equal(g3[0].attempted, 1)
const g2 = audit.filter((e) => e.kind === DOWNGRADE_ATTEMPT_EVENT && e.layer === 'G2')
assert.equal(g2.length, 1, 'el intento de G2 también quedó auditado')

console.log('')
console.log('PASS: la regla de oro bloqueó los intentos de bajar severidad (G2 y G3) y los auditó.')
process.exitCode = 0
