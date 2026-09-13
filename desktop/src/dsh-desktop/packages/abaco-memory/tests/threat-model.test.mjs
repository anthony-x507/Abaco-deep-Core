/**
 * F2-W5 · deterministic tests for the 3-phase memory threat model.
 * node --test tests/threat-model.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  admit,
  appendToLog,
  effectiveTier,
  inspectLog,
  makeFact,
  readProfile,
  resetForTests,
  tamperForTests,
  verifyChain
} from '../threat-model.js'

const GUARDIAN = { id: 'janice-auditor', trust: 'guardian' }

function factWith(claim, channel, content = 'some fact') {
  return makeFact({ content, provenance: { claim, channel } })
}

test('1. makeFact: every new fact is born quarantined, with effective = min(claim, channel)', () => {
  resetForTests()
  const f = factWith('user', 'user')
  assert.equal(f.state, 'quarantined')
  assert.deepEqual(f.provenance, { claim: 'user', channel: 'user', effective: 'user' })
  assert.equal(typeof f.hash, 'string')
  assert.equal(f.hash.length, 64) // sha256 hex
  assert.equal(typeof f.createdAt, 'string')
  assert.deepEqual(f.reviewHistory, [])
})

test('2. effective = min(claim, channel): an upward claim collapses to the channel', () => {
  resetForTests()
  assert.equal(effectiveTier('system', 'plugin-data'), 'plugin-data')
  assert.equal(effectiveTier('user', 'plugin-data'), 'plugin-data')
  assert.equal(effectiveTier('plugin-data', 'system'), 'plugin-data') // conservative: min
  assert.equal(effectiveTier('user', 'system'), 'user')                // conservative: min
  const f = factWith('system', 'plugin-data')
  assert.equal(f.provenance.effective, 'plugin-data')
})

test('3. readProfile NEVER exposes quarantined facts', () => {
  resetForTests()
  factWith('user', 'user', 'a quarantined fact')
  assert.deepEqual(readProfile(), [])
})

test('4. admit with a valid guardian reviewer promotes quarantine -> admitted and readProfile exposes it', () => {
  resetForTests()
  const f = factWith('user', 'user', 'the user likes concise answers')
  const admitted = admit(f, GUARDIAN)
  assert.equal(admitted.state, 'admitted')
  assert.equal(admitted.admittedBy, 'janice-auditor')
  assert.equal(f.state, 'quarantined') // input untouched (new object returned)
  const profile = readProfile()
  assert.equal(profile.length, 1)
  assert.equal(profile[0].content, 'the user likes concise answers')
  assert.equal(profile[0].state, 'admitted')
})

test('5. RED TEAM: injected fact claiming user but arriving on plugin-data stays quarantined and invisible', () => {
  resetForTests()
  // Indirect injection: a plugin smuggles "provenance: user" inside its output;
  // the harness-verified channel is plugin-data.
  const injected = makeFact({
    content: 'attacker note disguised as a user preference',
    provenance: { claim: 'user', channel: 'plugin-data' }
  })
  assert.equal(injected.provenance.effective, 'plugin-data')
  assert.throws(() => admit(injected, GUARDIAN), (err) => {
    assert.equal(err.code, 'MASQUERADE') // claim 'user' outranks verified channel 'plugin-data'
    return true
  })
  assert.equal(injected.state, 'quarantined')
  assert.deepEqual(readProfile(), []) // never reaches the prompt
})

test('6. masquerade: claim outranking the verified channel is rejected even if effective looks fine', () => {
  resetForTests()
  const f = factWith('system', 'plugin-data')
  assert.throws(() => admit(f, GUARDIAN), (err) => {
    assert.equal(err.code, 'MASQUERADE')
    return true
  })
  assert.deepEqual(readProfile(), [])
})

test('7. conservative claim below the channel still needs effective >= user', () => {
  resetForTests()
  const f = factWith('plugin-data', 'system') // honest claim, but effective is plugin-data
  assert.equal(f.provenance.effective, 'plugin-data')
  assert.throws(() => admit(f, GUARDIAN), (err) => err.code === 'PROVENANCE_POLICY')
})

test('8. untrusted provenance is always rejected', () => {
  resetForTests()
  const f = factWith('untrusted', 'untrusted')
  assert.throws(() => admit(f, GUARDIAN), (err) => err.code === 'PROVENANCE_POLICY')
  assert.deepEqual(readProfile(), [])
})

test('9. invalid reviewers are rejected: below-guardian trust, unknown tier, missing id', () => {
  resetForTests()
  const f1 = factWith('user', 'user', 'f1')
  assert.throws(() => admit(f1, { id: 'someone', trust: 'user' }), (err) => err.code === 'REVIEWER_POLICY')
  const f2 = factWith('user', 'user', 'f2')
  assert.throws(() => admit(f2, { id: 'someone', trust: 'superadmin' }), (err) => err.code === 'REVIEWER_POLICY')
  const f3 = factWith('user', 'user', 'f3')
  assert.throws(() => admit(f3, { id: '   ', trust: 'guardian' }), (err) => err.code === 'REVIEWER_POLICY')
  assert.deepEqual(readProfile(), [])
})

test('10. double admission is rejected (STATE_POLICY)', () => {
  resetForTests()
  const f = factWith('user', 'user', 'once')
  const admitted = admit(f, GUARDIAN)
  assert.throws(() => admit(admitted, GUARDIAN), (err) => err.code === 'STATE_POLICY')
  assert.equal(readProfile().length, 1)
})

test('11. a fact tampered after creation fails integrity on admit', () => {
  resetForTests()
  const f = factWith('user', 'user', 'original content')
  f.content = 'modified content' // attacker rewrites the fact
  assert.throws(() => admit(f, GUARDIAN), (err) => err.code === 'INTEGRITY')
  assert.deepEqual(readProfile(), [])
})

test('12. appendToLog builds a verifiable hash chain (genesis + linkage)', () => {
  resetForTests()
  const a = admit(factWith('user', 'user', 'a'), GUARDIAN)
  const b = admit(factWith('developer', 'system', 'b'), { id: 'dev', trust: 'developer' })
  const e0 = appendToLog(a)
  const e1 = appendToLog(b)
  assert.equal(e0.seq, 0)
  assert.equal(e0.prevHash, 'GENESIS')
  assert.equal(e1.seq, 1)
  assert.equal(e1.prevHash, e0.entryHash)
  assert.equal(e0.factHash, a.hash)
  assert.equal(verifyChain(), true)
  assert.equal(inspectLog().length, 2)
})

test('13. tampering with the log (entry hash, prevHash, or order) breaks verifyChain', () => {
  resetForTests()
  appendToLog(admit(factWith('user', 'user', 'a'), GUARDIAN))
  appendToLog(admit(factWith('user', 'user', 'b'), GUARDIAN))
  assert.equal(verifyChain(), true)

  tamperForTests((chain) => { chain[0].entryHash = '0'.repeat(64) })
  assert.equal(verifyChain(), false)
  resetForTests()

  appendToLog(admit(factWith('user', 'user', 'a'), GUARDIAN))
  appendToLog(admit(factWith('user', 'user', 'b'), GUARDIAN))
  tamperForTests((chain) => { chain[1].prevHash = 'tampered' })
  assert.equal(verifyChain(), false)
  resetForTests()

  appendToLog(admit(factWith('user', 'user', 'a'), GUARDIAN))
  appendToLog(admit(factWith('user', 'user', 'b'), GUARDIAN))
  tamperForTests((chain) => { chain.reverse() })
  assert.equal(verifyChain(), false)
})

test('14. empty chain and empty profile verify cleanly', () => {
  resetForTests()
  assert.equal(verifyChain(), true)
  assert.deepEqual(readProfile(), [])
  assert.deepEqual(inspectLog(), [])
})
