/**
 * breakers.test.mjs — F2-W2 deterministic tests (circuit breakers por plugin).
 * Run: node --test tests/breakers.test.mjs
 *
 * Cobertura del contrato §W2: kill exige 2 fuentes independientes o
 * humanApproval; threat 0..3 con histéresis; breakers por plugin; salida de
 * cuarentena medible; flapping no oscila.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { record, state, resetForTests, LEVELS, CLEAN_DECAY_WINDOW } from '../breakers.js'

const A = 'plugin-a'
const B = 'plugin-b'
const SRC = { g1: 'g1-triage', g2: 'g2-sentinel', g3: 'g3-janice', host: 'host-watchdog' }

function sig(severity, source, extra = {}) {
  return { type: 'probe', severity, source, ...extra }
}

beforeEach(() => resetForTests())

describe('breakers · estado inicial y validación', () => {
  it('1 · plugin desconocido: observe/threat-0/count-0, sin throw', () => {
    assert.deepEqual(state('nunca-visto'), { level: 0, threat: 0, signalCount: 0 })
  })

  it('2 · entradas malformadas fallan cerrado (TypeError determinista)', () => {
    assert.throws(() => record('', sig(1, SRC.g1)), TypeError)
    assert.throws(() => record(A, null), TypeError)
    assert.throws(() => record(A, { type: 'x', severity: 4, source: SRC.g1 }), TypeError)
    assert.throws(() => record(A, { type: 'x', severity: -1, source: SRC.g1 }), TypeError)
    assert.throws(() => record(A, { type: 'x', severity: 1.5, source: SRC.g1 }), TypeError)
    assert.throws(() => record(A, { type: 'x', severity: 1, source: '' }), TypeError)
    assert.throws(() => state(''), TypeError)
  })

  it('3 · record devuelve el snapshot del estado resultante', () => {
    const r = record(A, sig(2, SRC.g1))
    assert.deepEqual(r, { level: LEVELS.THROTTLE, threat: 2, signalCount: 1 })
    assert.deepEqual(Object.keys(r).sort(), ['level', 'signalCount', 'threat'])
  })
})

describe('breakers · escalada graduada observe→throttle→quarantine', () => {
  it('4 · severity 1 (watch): threat 1, sigue en observe (vigilado, no limitado)', () => {
    record(A, sig(1, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.OBSERVE, threat: 1, signalCount: 1 })
  })

  it('5 · severity 2 (suspicious): threat 2 → throttle', () => {
    record(A, sig(2, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.THROTTLE, threat: 2, signalCount: 1 })
  })

  it('6 · severity 3 (critical) de UNA fuente: threat 3 → quarantine, NO kill', () => {
    record(A, sig(3, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.QUARANTINE, threat: 3, signalCount: 1 })
  })

  it('7 · ROJO: una sola fuente gritando severity 3 diez veces JAMÁS mata sola', () => {
    for (let i = 0; i < 10; i++) record(A, sig(3, SRC.g1))
    const st = state(A)
    assert.equal(st.level, LEVELS.QUARANTINE, 'debe quedarse en quarantine, no kill')
    assert.equal(st.threat, 3)
    assert.equal(st.signalCount, 10)
  })
})

describe('breakers · regla de kill: 2 fuentes independientes o humanApproval', () => {
  it('8 · dos fuentes independientes con severity 3 SÍ matan', () => {
    record(A, sig(3, SRC.g1))
    assert.equal(state(A).level, LEVELS.QUARANTINE)
    record(A, sig(3, SRC.g2))
    assert.deepEqual(state(A), { level: LEVELS.KILL, threat: 3, signalCount: 2 })
  })

  it('9 · dos fuentes independientes con severity 2 (suspicious) también matan', () => {
    record(A, sig(2, SRC.g1))
    record(A, sig(2, SRC.g2))
    assert.equal(state(A).level, LEVELS.KILL)
  })

  it('10 · dos señales watch (severity 1) de fuentes distintas NO matan', () => {
    record(A, sig(1, SRC.g1))
    record(A, sig(1, SRC.g2))
    const st = state(A)
    assert.equal(st.level, LEVELS.OBSERVE)
    assert.equal(st.threat, 1)
  })

  it('11 · flag humanApproval mata con una sola señal (vía humana explícita)', () => {
    record(A, sig(1, SRC.host, { type: 'human-kill', humanApproval: true }))
    assert.equal(state(A).level, LEVELS.KILL)
  })

  it('12 · kill es estable: 100 señales limpias no lo sacan (solo release humano)', () => {
    record(A, sig(3, SRC.g1))
    record(A, sig(3, SRC.g2))
    assert.equal(state(A).level, LEVELS.KILL)
    for (let i = 0; i < 100; i++) record(A, sig(0, SRC.g1))
    const st = state(A)
    assert.equal(st.level, LEVELS.KILL, 'kill nunca auto-sale con señales limpias')
    assert.equal(st.threat, 3, 'threat tampoco decae en kill')
  })

  it('13 · tercera fuente independiente en critical tras kill → blocklist', () => {
    record(A, sig(3, SRC.g1))
    record(A, sig(3, SRC.g2))
    assert.equal(state(A).level, LEVELS.KILL)
    record(A, sig(3, SRC.g1)) // misma fuente: sigue en kill
    assert.equal(state(A).level, LEVELS.KILL)
    record(A, sig(3, SRC.g3)) // tercera fuente independiente: blocklist
    assert.equal(state(A).level, LEVELS.BLOCKLISTED)
  })

  it('14 · blocklist terminal: ni señales limpias ni malas lo mueven; release humano sí', () => {
    record(A, { type: 'human-blocklist', severity: 2, source: 'human-op', humanApproval: true })
    assert.equal(state(A).level, LEVELS.BLOCKLISTED)
    for (let i = 0; i < 20; i++) record(A, sig(0, SRC.g1))
    assert.equal(state(A).level, LEVELS.BLOCKLISTED, 'blocklist no sale solo')
    record(A, { type: 'human-release', severity: 0, source: 'human-op', humanApproval: true })
    assert.deepEqual(state(A), { level: LEVELS.OBSERVE, threat: 0, signalCount: 22 })
  })
})

describe('breakers · histéresis: escalada rápida, desescalada lenta', () => {
  it('15 · flapping NO oscila: alternar malo/bueno nunca desescala threat', () => {
    for (let i = 0; i < 10; i++) {
      record(A, sig(2, SRC.g1))
      record(A, sig(0, SRC.g1))
    }
    const st = state(A)
    assert.equal(st.threat, 2, 'threat clavado: la ventana limpia nunca se completa')
    assert.equal(st.level, LEVELS.THROTTLE, 'nivel clavado: sin oscilación')
    assert.equal(st.signalCount, 20)
  })

  it('16 · una sola señal mala en medio de la ventana reinicia el conteo limpio', () => {
    record(A, sig(3, SRC.g1)) // quarantine, threat 3
    for (let i = 0; i < CLEAN_DECAY_WINDOW - 1; i++) record(A, sig(0, SRC.g1))
    record(A, sig(1, SRC.g1)) // rompe la racha a 1 de completarla
    for (let i = 0; i < CLEAN_DECAY_WINDOW - 1; i++) record(A, sig(0, SRC.g1))
    const st = state(A)
    assert.equal(st.threat, 3, 'ni un paso de decaimiento: la racha se reinició')
    assert.equal(st.level, LEVELS.QUARANTINE)
  })

  it('17 · salida de cuarentena: camino medible 6→throttle, 12→observe, 18→threat 0', () => {
    record(A, sig(3, SRC.g1))
    assert.equal(state(A).level, LEVELS.QUARANTINE)
    for (let i = 0; i < CLEAN_DECAY_WINDOW; i++) record(A, sig(0, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.THROTTLE, threat: 2, signalCount: 7 })
    for (let i = 0; i < CLEAN_DECAY_WINDOW; i++) record(A, sig(0, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.OBSERVE, threat: 1, signalCount: 13 })
    for (let i = 0; i < CLEAN_DECAY_WINDOW; i++) record(A, sig(0, SRC.g1))
    assert.deepEqual(state(A), { level: LEVELS.OBSERVE, threat: 0, signalCount: 19 })
  })

  it('18 · threat nunca baja de golpe: decae exactamente un paso por ventana', () => {
    record(A, sig(3, SRC.g1))
    for (let i = 0; i < CLEAN_DECAY_WINDOW; i++) record(A, sig(0, SRC.g1))
    assert.equal(state(A).threat, 2, 'un paso por ventana, ni uno más')
  })
})

describe('breakers · aislamiento por plugin y reset', () => {
  it('19 · breakers por plugin, NUNCA globales: A en kill no toca a B', () => {
    record(A, sig(3, SRC.g1))
    record(A, sig(3, SRC.g2))
    assert.equal(state(A).level, LEVELS.KILL)
    assert.deepEqual(state(B), { level: LEVELS.OBSERVE, threat: 0, signalCount: 0 })
    record(B, sig(1, SRC.g1))
    assert.deepEqual(state(B), { level: LEVELS.OBSERVE, threat: 1, signalCount: 1 })
    assert.equal(state(A).level, LEVELS.KILL, 'A sigue en kill')
  })

  it('20 · resetForTests limpia todo el estado', () => {
    record(A, sig(3, SRC.g1))
    record(A, sig(3, SRC.g2))
    resetForTests()
    assert.deepEqual(state(A), { level: 0, threat: 0, signalCount: 0 })
  })
})
