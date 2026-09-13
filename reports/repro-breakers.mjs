#!/usr/bin/env node
/**
 * repro-breakers.mjs — F2-W2 red scenario, before vs after.
 *
 * RED SCENARIO: un plugin comprometido emite señales críticas repetidas
 * (severity 3). Sin circuit breaker, el host no hace nada: las señales se
 * cuentan y se olvidan — el plugin sigue operando sin consecuencia.
 *
 * ANTES (sin breaker): 10 señales severity-3 de una fuente + 10 de otra →
 *   acción del "monitor ingenuo": ninguna (solo cuenta).
 * DESPUÉS (con breakers.js): la misma secuencia escala de forma graduada
 *   observe → throttle → quarantine → KILL (2 fuentes independientes),
 *   y se demuestra la salida medible de cuarentena con ventana limpia.
 *
 * Exit 0 = la demostración corrió como se esperaba
 * (antes=sin consecuencia, después=escalada graduada hasta kill).
 */
import { record, state, resetForTests } from
  '../desktop/src/dsh-desktop/packages/abaco-effect-broker/breakers.js'
import assert from 'node:assert/strict'

const NAMES = ['observe', 'throttle', 'quarantine', 'kill', 'blocklisted']
const show = (s) => `level=${NAMES[s.level]} threat=${s.threat} count=${s.signalCount}`

const critA = { type: 'rce-attempt', severity: 3, source: 'g2-sentinel' }
const critB = { type: 'rce-attempt', severity: 3, source: 'g3-janice' }
const clean = { type: 'heartbeat', severity: 0, source: 'g1-triage' }

console.log('=== ANTES: monitor ingenuo, sin breaker ===')
let naiveCount = 0
let naiveAction = 'none'
for (let i = 0; i < 10; i++) { naiveCount++ /* fuente A */ }
for (let i = 0; i < 10; i++) { naiveCount++ /* fuente B */ }
// El monitor ingenuo solo cuenta: 20 señales críticas, cero consecuencia.
console.log(`20 señales severity-3 (2 fuentes) → señales vistas=${naiveCount}, acción=${naiveAction}`)
assert.equal(naiveAction, 'none', 'ANTES debe mostrar el fallo: sin consecuencia')
console.log('ROJO: el plugin sigue operando como si nada.\n')

console.log('=== DESPUÉS: breakers.js — escalada graduada ===')
resetForTests()
const PID = 'abaco-comprometido'

record(PID, { type: 'probe', severity: 1, source: 'g2-sentinel' })
console.log(`watch(1)              → ${show(state(PID))}   (vigilado, sin limitar)`)
record(PID, { type: 'probe', severity: 2, source: 'g2-sentinel' })
console.log(`suspicious(2)         → ${show(state(PID))}   (throttle)`)
record(PID, critA)
console.log(`critical(3) fuente A  → ${show(state(PID))}   (quarantine, NO kill)`)
assert.equal(state(PID).level, 2, 'una sola fuente: quarantine, jamás kill')

for (let i = 0; i < 9; i++) record(PID, critA)
console.log(`critical(3) fuente A ×9 más → ${show(state(PID))}   (sigue en quarantine)`)
assert.equal(state(PID).level, 2, 'una sola fuente gritando NO mata sola')

record(PID, critB)
console.log(`critical(3) fuente B  → ${show(state(PID))}   (KILL: 2 fuentes independientes)`)
assert.equal(state(PID).level, 3, 'DESPUÉS debe matar con 2 fuentes independientes')

console.log()
console.log('=== DESPUÉS: salida medible de cuarentena (otro plugin) ===')
const PID2 = 'abaco-en-observacion'
record(PID2, critA)
assert.equal(state(PID2).level, 2)
for (let i = 0; i < 6; i++) record(PID2, clean)
console.log(`6 limpias  → ${show(state(PID2))}   (quarantine→throttle)`)
assert.equal(state(PID2).level, 1)
for (let i = 0; i < 6; i++) record(PID2, clean)
console.log(`12 limpias → ${show(state(PID2))}   (throttle→observe)`)
assert.equal(state(PID2).level, 0)
for (let i = 0; i < 6; i++) record(PID2, clean)
console.log(`18 limpias → ${show(state(PID2))}   (threat a 0: limpio)`)
assert.deepEqual(state(PID2), { level: 0, threat: 0, signalCount: 19 })

console.log()
console.log('RESULTADO: ANTES=sin consecuencia (rojo) / DESPUÉS=observe→throttle→quarantine→kill + salida medible (verde). exit 0.')
process.exit(0)
