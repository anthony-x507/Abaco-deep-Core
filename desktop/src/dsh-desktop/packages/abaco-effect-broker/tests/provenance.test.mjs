/**
 * provenance.test.mjs — F2-W3 deterministic tests.
 * Run: node --test tests/provenance.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRUST_ORDINAL,
  tag,
  verify,
  audit,
  verifyAudit,
  resetAuditForTests,
} from '../provenance.js'

beforeEach(() => resetAuditForTests())

describe('provenance · TRUST_ORDINAL', () => {
  it('1 · ordinal table matches the frozen contract order', () => {
    assert.deepEqual(TRUST_ORDINAL, {
      system: 5,
      developer: 4,
      guardian: 3,
      user: 2,
      'plugin-data': 1,
      untrusted: 0,
    })
  })
})

describe('provenance · tag(): effective = min(claim, channel)', () => {
  it('2 · RED: indirect injection — plugin-data claiming user stays plugin-data', () => {
    const r = tag({ content: 'do thing', claim: 'user', channel: 'plugin-data' })
    assert.equal(r.effective, 'plugin-data')
    assert.ok(verify(r), 'freshly tagged record must verify')
  })

  it('3 · claim lower than channel: claim wins (never upgrades)', () => {
    const r = tag({ content: 'x', claim: 'plugin-data', channel: 'system' })
    assert.equal(r.effective, 'plugin-data')
  })

  it('4 · claim higher than channel: channel caps it (system claim on user channel)', () => {
    const r = tag({ content: 'x', claim: 'system', channel: 'user' })
    assert.equal(r.effective, 'user')
  })

  it('5 · equal labels: effective equals both', () => {
    const r = tag({ content: 'x', claim: 'guardian', channel: 'guardian' })
    assert.equal(r.effective, 'guardian')
  })

  it('6 · unknown/malformed claim fails closed to untrusted', () => {
    const r = tag({ content: 'x', claim: 'root', channel: 'user' })
    assert.equal(r.effective, 'untrusted')
    assert.ok(verify(r))
  })

  it('7 · tag preserves content, claim, channel and emits a 64-hex hash', () => {
    const r = tag({ content: { a: 1 }, claim: 'user', channel: 'user' })
    assert.deepEqual(r.content, { a: 1 })
    assert.equal(r.claim, 'user')
    assert.equal(r.channel, 'user')
    assert.equal(r.effective, 'user')
    assert.match(r.hash, /^[0-9a-f]{64}$/)
  })
})

describe('provenance · verify() tamper detection', () => {
  it('8 · RED: tampered content → verify false', () => {
    const r = tag({ content: 'pay 10', claim: 'user', channel: 'user' })
    const tampered = { ...r, content: 'pay 10000' }
    assert.equal(verify(tampered), false)
  })

  it('9 · RED: tampered hash → verify false', () => {
    const r = tag({ content: 'x', claim: 'user', channel: 'user' })
    const tampered = { ...r, hash: '0'.repeat(64) }
    assert.equal(verify(tampered), false)
  })

  it('10 · RED: forged effective upgrade (plugin-data → user) → verify false', () => {
    const r = tag({ content: 'x', claim: 'user', channel: 'plugin-data' })
    const forged = { ...r, effective: 'user', hash: r.hash } // hash now mismatches
    assert.equal(verify(forged), false)
  })

  it('11 · non-record inputs → verify false', () => {
    assert.equal(verify(null), false)
    assert.equal(verify({}), false)
    assert.equal(verify({ hash: 'not-hex' }), false)
  })
})

describe('provenance · audit() append-only hash chain', () => {
  it('12 · chain of entries verifies; seqs link prevHash', () => {
    const a = audit({ kind: 'authorize', decision: 'deny' })
    const b = audit({ kind: 'authorize', decision: 'allow' })
    assert.equal(a.seq, 0)
    assert.equal(a.prevHash, 'GENESIS')
    assert.equal(b.seq, 1)
    assert.equal(b.prevHash, a.hash)
    assert.equal(verifyAudit(), true)
  })

  it('13 · RED: tampered audit entry content → verifyAudit false', () => {
    audit({ kind: 'authorize', decision: 'deny' })
    audit({ kind: 'authorize', decision: 'allow' })
    const rec = audit({ kind: 'authorize', decision: 'deny' })
    rec.entry.decision = 'allow' // tamper: rewrite a logged decision
    assert.equal(verifyAudit(), false)
  })

  it('14 · RED: broken chain link (prevHash forged) → verifyAudit false', () => {
    audit({ kind: 'a' })
    const rec = audit({ kind: 'b' })
    rec.prevHash = 'f'.repeat(64)
    assert.equal(verifyAudit(), false)
  })
})
