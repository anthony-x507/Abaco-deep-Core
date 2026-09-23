/**
 * INV-DOWNGRADE-HITL (Ola 1 / Bloque 3 item 3.2 — deep market half)
 * Run: node --test src/main/state/tests/plugin-upgrade-downgrade.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertUpgradeDirection } from '../plugin-upgrade-policy.mjs'

test('INV-DOWNGRADE-HITL · allows upgrade and equal without grant', () => {
  assert.deepEqual(
    assertUpgradeDirection({
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      allowDowngrade: false,
    }),
    { ok: true },
  )
  assert.deepEqual(
    assertUpgradeDirection({ currentVersion: '1.0.0', targetVersion: '1.0.0' }),
    { ok: true },
  )
})

test('INV-DOWNGRADE-HITL · fresh install when current missing', () => {
  assert.deepEqual(
    assertUpgradeDirection({ targetVersion: '0.9.0', allowDowngrade: false }),
    { ok: true },
  )
})

test('INV-DOWNGRADE-HITL · denies downgrade without explicit grant', () => {
  const r = assertUpgradeDirection({
    currentVersion: '2.0.0',
    targetVersion: '1.5.0',
    allowDowngrade: false,
  })
  assert.equal(r.ok, false)
  assert.match(r.detail, /downgrade-requires-explicit-grant/)
  assert.match(r.detail, /1\.5\.0/)
  assert.match(r.detail, /2\.0\.0/)
})

test('INV-DOWNGRADE-HITL · allowDowngrade === true permits older target', () => {
  assert.deepEqual(
    assertUpgradeDirection({
      currentVersion: '2.0.0',
      targetVersion: '1.0.0',
      allowDowngrade: true,
    }),
    { ok: true },
  )
  assert.equal(
    assertUpgradeDirection({
      currentVersion: '2.0.0',
      targetVersion: '1.0.0',
      allowDowngrade: false,
    }).ok,
    false,
  )
})
