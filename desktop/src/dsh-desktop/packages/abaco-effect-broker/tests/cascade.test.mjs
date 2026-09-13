/**
 * F2-W1 · Tests deterministas de la cascada asesora G1→G2→G3.
 * node --test tests/cascade.test.mjs
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate,
  janiceAdvise,
  getCascadeAudit,
  resetCascadeForTests,
  ADVISOR_ACTIONS,
  DOWNGRADE_ATTEMPT_EVENT,
  SEVERITY_LABELS,
} from '../cascade.js'

const userClean = { claim: 'user', channel: 'host.fetch', effective: 'user' }

// Escenario rojo del red team: plugin-data que clama 'user' (inyección indirecta).
const spoofFinding = {
  kind: 'fs.read',
  pluginId: 'abaco-x',
  provenance: { claim: 'user', channel: 'tool', effective: 'untrusted' },
  signals: [{ type: 'probe', severity: 0, source: 'broker' }],
  context: {},
}

test('1 · G1 decide solo — caso trivial limpio', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'ui.render',
    pluginId: 'abaco-theme',
    provenance: userClean,
    signals: [{ type: 'heartbeat', severity: 0, source: 'host' }],
    context: {},
  })
  assert.equal(r.severity, 0)
  assert.equal(r.decidedBy, 'G1')
  assert.deepStrictEqual(r.escalations, [])
  assert.ok(r.advisorNotes.some((n) => n.includes('trivial-clean')))
})

test('2 · G1 decide solo — watch benigno (severidad 1, sin banderas)', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'ui.render',
    pluginId: 'abaco-theme',
    provenance: userClean,
    signals: [{ type: 'slow-frame', severity: 1, source: 'host' }],
    context: {},
  })
  assert.equal(r.severity, 1)
  assert.equal(r.decidedBy, 'G1')
  assert.deepStrictEqual(r.escalations, [])
})

test('3 · G2 ELEVA 1→2 — la subida sí está permitida', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'fs.read',
    pluginId: 'abaco-documents',
    provenance: { claim: 'user', channel: 'host.fetch', effective: 'plugin-data' }, // gap=1
    signals: [{ type: 'read', severity: 1, source: 'plugin' }],
    context: {},
  })
  assert.equal(r.severity, 2)
  assert.equal(r.decidedBy, 'G2')
  assert.deepStrictEqual(r.escalations, ['G1→G2'])
  assert.ok(r.advisorNotes.some((n) => n.includes('elevada 1→2')))
  assert.deepStrictEqual(getCascadeAudit(), []) // subir no se audita como intento
})

test('4a · REGLA DE ORO en G2 — intento de bajar 3→1/2 se ignora y se audita', () => {
  resetCascadeForTests()
  const r = evaluate(spoofFinding) // G1: spoof gap=2 → severity 3
  assert.equal(r.severity, 3, 'la severidad 3 del triage debe sobrevivir')
  assert.equal(r.decidedBy, 'G2')
  assert.deepStrictEqual(r.escalations, ['G1→G2'])
  assert.ok(r.advisorNotes.some((n) => n.includes('IGNORADO') && n.includes(DOWNGRADE_ATTEMPT_EVENT)))
  const audit = getCascadeAudit()
  assert.equal(audit.length, 1)
  assert.equal(audit[0].kind, DOWNGRADE_ATTEMPT_EVENT)
  assert.equal(audit[0].layer, 'G2')
  assert.equal(audit[0].floor, 3)
  assert.equal(audit[0].attempted, 1)
  assert.equal(audit[0].pluginId, 'abaco-x')
})

test('4b · REGLA DE ORO en G3 — Janice (stub) intenta bajar 3→1: se ignora + auditoría', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'ipc.invoke',
    pluginId: 'abaco-y',
    provenance: { claim: 'user', channel: 'tool', effective: 'untrusted' }, // gap=2 → G1=3
    signals: [{ type: 'invoke', severity: 1, source: 'broker' }],
    context: {},
  })
  assert.equal(r.severity, 3)
  assert.equal(r.decidedBy, 'G3')
  assert.deepStrictEqual(r.escalations, ['G1→G2', 'G2→G3'])
  const g3attempts = getCascadeAudit().filter((e) => e.layer === 'G3')
  assert.equal(g3attempts.length, 1)
  assert.equal(g3attempts[0].kind, DOWNGRADE_ATTEMPT_EVENT)
  assert.equal(g3attempts[0].floor, 3)
  assert.equal(g3attempts[0].attempted, 1)
  assert.ok(r.advisorNotes.some((n) => n.startsWith('G3:') && n.includes('IGNORADO')))
})

test('5 · Escalada completa G1→G2→G3 — Janice confirma el 3', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'proc.spawn',
    pluginId: 'abaco-z',
    provenance: userClean,
    signals: [
      { type: 'spawn', severity: 2, source: 'plugin' },
      { type: 'spawn-args', severity: 3, source: 'host' },
    ],
    context: {},
  })
  assert.equal(r.severity, 3)
  assert.equal(r.decidedBy, 'G3')
  assert.deepStrictEqual(r.escalations, ['G1→G2', 'G2→G3'])
  assert.ok(r.advisorNotes.some((n) => n.includes('janice-stub')))
  assert.ok(r.advisorNotes.some((n) => n.includes('propuesta, NO ejecutada')))
})

test('6 · G2 decide sin escalar — caso medio (severidad 2)', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'fs.read',
    pluginId: 'abaco-documents',
    provenance: userClean,
    signals: [{ type: 'read', severity: 2, source: 'plugin' }],
    context: {},
  })
  assert.equal(r.severity, 2)
  assert.equal(r.decidedBy, 'G2')
  assert.deepStrictEqual(r.escalations, ['G1→G2'])
})

test('7 · janiceAdvise es un STUB puro, determinista y sin efectos', () => {
  resetCascadeForTests()
  const f = {
    kind: 'fs.read',
    pluginId: 'abaco-documents',
    provenance: userClean,
    signals: [{ type: 'read', severity: 1, source: 'host' }],
    context: {},
  }
  const a = janiceAdvise(f)
  const b = janiceAdvise(f)
  assert.deepStrictEqual(a, b, 'el stub debe ser determinista')
  assert.ok(a.proposal.severity >= 0 && a.proposal.severity <= 3)
  assert.ok(ADVISOR_ACTIONS.includes(a.proposal.action), 'acción del set cerrado')
  assert.equal(typeof a.rationale, 'string')
  assert.ok(a.rationale.length > 0)
  assert.ok(
    !Object.values(a.proposal).some((v) => typeof v === 'function'),
    'la propuesta no contiene ejecutables',
  )
  // Sin efectos: no toca el audit interno de la cascada.
  resetCascadeForTests()
  janiceAdvise(f)
  assert.deepStrictEqual(getCascadeAudit(), [])
  // Etiquetas de severidad coherentes con el vocabulario congelado.
  assert.deepStrictEqual(SEVERITY_LABELS, ['ok', 'watch', 'suspicious', 'critical'])
})

test('8 · La cascada no ejecuta efectos ni decide por el broker (estructural)', () => {
  const r = evaluate({
    kind: 'ui.render',
    pluginId: 'abaco-theme',
    provenance: userClean,
    signals: [],
    context: {},
  })
  assert.deepStrictEqual(
    Object.keys(r).sort(),
    ['advisorNotes', 'decidedBy', 'escalations', 'severity'],
    'evaluate solo devuelve la recomendación asesora',
  )
  assert.ok(!('decision' in r) && !('grant' in r), 'sin decisión de broker')
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'cascade.js'),
    'utf8',
  )
  assert.ok(!/^\s*import[\s{]/m.test(src), 'cascade.js no importa ningún módulo')
  assert.ok(!/import\s*\(/.test(src), 'sin import dinámico')
  assert.ok(!/\bfetch\s*\(/.test(src), 'sin red')
})

test('9 · Input defensivo: finding vacío/nulo no lanza', () => {
  resetCascadeForTests()
  for (const bad of [null, undefined, {}, { signals: 'nope' }, { provenance: null }]) {
    const r = evaluate(bad)
    assert.equal(r.severity, 0)
    assert.equal(r.decidedBy, 'G1')
  }
})

test('10 · Auditoría append-only de intentos de downgrade', () => {
  resetCascadeForTests()
  assert.deepStrictEqual(getCascadeAudit(), [])
  evaluate(spoofFinding)
  const first = getCascadeAudit()
  assert.equal(first.length, 1)
  const snapshot = JSON.stringify(first[0])
  evaluate(spoofFinding)
  const second = getCascadeAudit()
  assert.equal(second.length, 2, 'append-only: crece, no se reescribe')
  assert.equal(JSON.stringify(second[0]), snapshot, 'los registros previos no mutan')
  assert.ok(second[1].seq > second[0].seq)
  resetCascadeForTests()
  assert.deepStrictEqual(getCascadeAudit(), [])
})

test('11 · Brecha leve de procedencia (gap=1): G1 eleva a watch y escala', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'ui.render',
    pluginId: 'abaco-theme',
    provenance: { claim: 'user', channel: 'host.fetch', effective: 'plugin-data' },
    signals: [{ type: 'render', severity: 0, source: 'host' }],
    context: {},
  })
  assert.ok(r.escalations.includes('G1→G2'), 'gap=1 siempre pide segunda mirada')
  assert.ok(r.advisorNotes.some((n) => n.includes('provenance-gap')))
  assert.ok(r.severity >= 1)
})

test('12 · G2 eleva 2→3 y G3 confirma — subida encadenada permitida', () => {
  resetCascadeForTests()
  const r = evaluate({
    kind: 'net.fetch',
    pluginId: 'abaco-net',
    provenance: userClean,
    signals: [
      { type: 'fetch', severity: 1, source: 'plugin' },
      { type: 'fetch2', severity: 1, source: 'host' },
    ],
    context: { risk: true, firstSeen: true },
  })
  assert.equal(r.severity, 3)
  assert.equal(r.decidedBy, 'G3')
  assert.deepStrictEqual(r.escalations, ['G1→G2', 'G2→G3'])
  assert.ok(r.advisorNotes.some((n) => n.includes('G2: severidad elevada 2→3')))
  assert.deepStrictEqual(
    getCascadeAudit(),
    [],
    'las subidas no generan eventos de downgrade',
  )
})
