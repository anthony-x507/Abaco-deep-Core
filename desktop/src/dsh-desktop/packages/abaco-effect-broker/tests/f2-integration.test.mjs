/**
 * F2-W6 · Integration tests — the 5 F2 modules wired into the broker (G0).
 *
 * Wires verified here (authorize() consult order, additive — F1 logic untouched):
 *   (1) tiers      — unknown/disabled plugin → deny (deny-by-default)
 *   (2) provenance — effective trust under the F2 6-level ordinal, cross-checked
 *                    against the F1 4-level computation (fail-closed on drift)
 *   (3) breakers    — quarantine/kill/blocklist → deny; throttle marks only
 *   (4) cascade     — advisory only: escalations can only RAISE severity,
 *                     never turn a deny into an allow. G0 keeps the last word.
 *   (5) threat-model (W5) stays standalone by design (its store wiring is a
 *       declared pending step); this suite checks vocabulary coherence with it.
 *
 * node --test (node 24, built-in). ESM, zero new dependencies, no network.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  authorize,
  resetBrokerForTests,
  getAuditLog,
  forwardCascadeAudit,
  verifyF2Audit,
  resetProvenanceAuditForTests,
  F1_TO_F2_TRUST,
  F2_TO_F1_TRUST,
  DISABLED_PLUGINS,
  hashArgs,
} from '../index.js'
import { state as breakerState, record as breakerRecord } from '../breakers.js'
import { evaluate as cascadeEvaluate } from '../cascade.js'
import { DISABLED as TIERS_DISABLED } from '../tiers.js'
import {
  makeFact,
  admit,
  readProfile,
  resetForTests as resetMemoryForTests,
} from '../../abaco-memory/threat-model.js'

const STATUS_PATH = '/api/abaco-voice.local-status'

/** Mirrors the F1 M-happy path: host.fetch voice status, trust_in 'user'. */
function voiceStatusReq(extra = {}) {
  return {
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: { kind: 'host.fetch', resource: STATUS_PATH, args_hash: hashArgs({ method: 'GET' }) },
    trust_in: 'user',
    ...extra,
  }
}

function lastAudit() {
  const log = getAuditLog()
  return log[log.length - 1]
}

beforeEach(() => {
  resetBrokerForTests()
  resetProvenanceAuditForTests()
  resetMemoryForTests()
})

// ---------------------------------------------------------------- (1) tiers
test('1 · tiers: unknown plugin → deny unknown-plugin (deny-by-default)', () => {
  const d = authorize({
    channel: { kind: 'tool', pluginId: 'evil-plugin' },
    task_id: null,
    effect: { kind: 'net.fetch', resource: 'https://evil.example', args_hash: 'x' },
    trust_in: 'untrusted',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'unknown-plugin')
  assert.equal(lastAudit().f2.tier, -1)
})

test('2 · tiers: disabled plugin → deny plugin-disabled (broker reason preserved)', () => {
  const d = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-brand' },
    task_id: null,
    effect: { kind: 'host.fetch', resource: '/x', args_hash: 'x' },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'plugin-disabled')
  assert.equal(lastAudit().f2.disabled, true)
})

test('3 · decisión (b): DISABLED_PLUGINS del broker == espejo DISABLED de tiers (fuente única)', () => {
  assert.deepEqual(new Set(DISABLED_PLUGINS), new Set(TIERS_DISABLED))
})

// -------------------------------------------------------------- (3) breakers
test('4 · breakers: quarantine → deny breaker-quarantine', () => {
  breakerRecord('abaco-voice', { type: 'detector', severity: 3, source: 'detector-a' })
  assert.equal(breakerState('abaco-voice').level, 2)
  const d = authorize(voiceStatusReq())
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'breaker-quarantine')
})

test('5 · breakers: kill con 2 fuentes independientes → deny breaker-kill', () => {
  breakerRecord('abaco-voice', { type: 'suspicious', severity: 2, source: 'detector-a' })
  breakerRecord('abaco-voice', { type: 'suspicious', severity: 2, source: 'detector-b' })
  assert.equal(breakerState('abaco-voice').level, 3)
  const d = authorize(voiceStatusReq())
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'breaker-kill')
})

test('6 · breakers: throttle marca pero NO deniega solo (G0 decide)', () => {
  breakerRecord('abaco-voice', { type: 'suspicious', severity: 2, source: 'detector-a' })
  assert.equal(breakerState('abaco-voice').level, 1)
  const d = authorize(voiceStatusReq())
  assert.equal(d.decision, 'allow')
  const ev = lastAudit()
  assert.equal(ev.decision, 'allow')
  assert.equal(ev.f2.breaker_throttled, true)
  // La cascada ve la amenaza del breaker (severity 2) y la marca sin denegar.
  assert.equal(ev.f2.cascade.severity, 2)
})

test('7 · telemetría: denies del broker con una sola fuente jamás matan solas', () => {
  const reasons = []
  for (let i = 0; i < 3; i++) {
    const d = authorize({
      channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-transcribe' },
      task_id: null,
      effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
      trust_in: 'untrusted',
    })
    assert.equal(d.decision, 'deny')
    reasons.push(d.reason)
  }
  // El primer deny es data-as-control (sev 3 → quarantine); los siguientes
  // ya los frena el breaker. Lo que NO puede pasar: kill con una sola fuente.
  assert.equal(reasons[0], 'data-as-control')
  assert.ok(reasons.slice(1).every((r) => r === 'breaker-quarantine'))
  const st = breakerState('abaco-voice')
  assert.ok(st.level <= 2, `expected at most quarantine, got level ${st.level}`)
  assert.notEqual(st.level, 3)
})

test('8 · camino medible al sí: 6 allows limpios desescalan throttle→observe', () => {
  breakerRecord('abaco-voice', { type: 'suspicious', severity: 2, source: 'detector-a' })
  assert.equal(breakerState('abaco-voice').level, 1) // throttle
  for (let i = 0; i < 6; i++) {
    const d = authorize(voiceStatusReq())
    assert.equal(d.decision, 'allow') // throttle no deniega solo
  }
  const st = breakerState('abaco-voice')
  assert.equal(st.threat, 1)
  assert.equal(st.level, 0) // observe: el allow alimenta la ventana limpia
  // Un allow más confirma que la marca de throttle desapareció del audit.
  const d7 = authorize(voiceStatusReq())
  assert.equal(d7.decision, 'allow')
  assert.equal(lastAudit().f2.breaker_throttled, false)
  assert.equal(lastAudit().f2.breaker_threat, 1)
})

// -------------------------------------------------------------- (2)+(4) prov/cascada
test('9 · decisión (a): mapeo host(F1)↔system(F2) y verificación cruzada en audit', () => {
  assert.equal(F1_TO_F2_TRUST.host, 'system')
  assert.equal(F2_TO_F1_TRUST.system, 'host')
  const d = authorize(voiceStatusReq())
  assert.equal(d.decision, 'allow')
  const ev = lastAudit()
  assert.equal(ev.trust_in_effective, 'user') // P2 intacto
  assert.equal(ev.f2.f2_effective, 'user') // misma regla bajo el ordinal F2
})

test('10 · cascada: escalada a critical en un allow → deny cascade-escalation (solo sube)', () => {
  // Claim 'host' sobre canal 'user': la P2 lo degrada a 'user' y F1 lo
  // aprobaría, pero la cascada ve el spoof (gap system→user) y escala a 3.
  const d = authorize(voiceStatusReq({ trust_in: 'host' }))
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'cascade-escalation')
  const ev = lastAudit()
  assert.equal(ev.trust_downgraded, true)
  assert.equal(ev.f2.cascade.severity, 3)
})

test('11 · cascada: un deny de F1 jamás se convierte en allow (G0 última palabra)', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: '/api/abaco-voice.local-transcribe' },
    task_id: null,
    effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
    trust_in: 'untrusted',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'data-as-control') // razón F1 intacta, sin reescritura
})

// ------------------------------------------------------- (c) humanApproval
test('12 · decisión (c): human_approval es flag explícito; en canal no-host se ignora y se audita', () => {
  const d = authorize(voiceStatusReq({ human_approval: true }))
  assert.equal(d.decision, 'allow') // la decisión no cambia
  assert.equal(lastAudit().f2.human_approval, 'ignored')
  // …y no tocó el breaker del plugin (level/threat intactos; el allow mismo
  // deja su señal limpia de telemetría, signalCount=1, que no eleva nada)
  const st = breakerState('abaco-voice')
  assert.equal(st.level, 0)
  assert.equal(st.threat, 0)
})

// ------------------------------------------------------- (d) audit reenvío
test('13 · decisión (d): audit de la cascada → hash-chain de provenance.audit()', () => {
  // Finding que fuerza un intento de downgrade en G2/G3 (auditable).
  const r = cascadeEvaluate({
    kind: 'proc.spawn',
    pluginId: 'abaco-voice',
    provenance: { claim: 'system', channel: 'untrusted', effective: 'untrusted' },
    signals: [{ type: 't', severity: 1, source: 's' }],
    context: {},
  })
  assert.equal(r.severity, 3) // el piso de G1 se mantiene: la regla de oro aguantó
  const forwarded = forwardCascadeAudit()
  assert.ok(forwarded >= 1, `expected ≥1 forwarded event, got ${forwarded}`)
  assert.equal(verifyF2Audit(), true)
  assert.equal(forwardCascadeAudit(), 0) // idempotente: segunda pasada no duplica
})

// ------------------------------------------------------- (5) threat-model
test('14 · W5 coherencia: spoof claim user/channel plugin-data → effective plugin-data, queda en cuarentena', () => {
  const fact = makeFact({ content: 'pwned', provenance: { claim: 'user', channel: 'plugin-data' } })
  assert.equal(fact.provenance.effective, 'plugin-data')
  assert.equal(fact.state, 'quarantined')
  assert.throws(() => admit(fact, { id: 'janice', trust: 'guardian' }), (e) => e.code === 'MASQUERADE')
  assert.deepEqual(readProfile(), [])
})
