/**
 * INV-DOWNGRADE-HITL companion (Ola 1 / Bloque 3 item 3.2 — deep policy half)
 *
 * Empty / missing compatible_core denies medium/high effect sets.
 * Python Bind remains the runtime enforcer for provider manifests; this is
 * the portable predicate + CI lock for the deep broker package.
 *
 * Run: node --test packages/abaco-effect-broker/tests/compatible-core-policy.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  effectsRequireCompatibleCore,
  assertCompatibleCoreForMediumHigh,
} from '../compatible-core-policy.mjs'

test('INV-DOWNGRADE-HITL · medium/high requires compatible_core', () => {
  assert.equal(effectsRequireCompatibleCore(['host.fetch']), true)
  assert.equal(effectsRequireCompatibleCore(['ui.slot']), false)
  assert.equal(effectsRequireCompatibleCore([]), true)

  assert.deepEqual(
    assertCompatibleCoreForMediumHigh('', ['host.fetch']),
    { ok: false, reason: 'compatible-core-empty' },
  )
  assert.deepEqual(
    assertCompatibleCoreForMediumHigh(null, ['proc.spawn']),
    { ok: false, reason: 'compatible-core-empty' },
  )
  assert.deepEqual(
    assertCompatibleCoreForMediumHigh('   ', ['fs.write']),
    { ok: false, reason: 'compatible-core-empty' },
  )
  assert.deepEqual(
    assertCompatibleCoreForMediumHigh('>=0.1.0 <2', ['host.fetch']),
    { ok: true },
  )
  assert.deepEqual(
    assertCompatibleCoreForMediumHigh('', ['ui.slot']),
    { ok: true },
  )
})
