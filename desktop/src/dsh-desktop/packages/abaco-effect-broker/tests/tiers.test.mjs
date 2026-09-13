/**
 * F2-W4 · Deterministic tests for tiers.js (trust tiers T0–T4 + disabled list
 * + capability gate). Cero dependencias externas; node:test built-in.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TIERS,
  DISABLED,
  CAPABILITY_MIN_TIER,
  tierOf,
  isDisabled,
  canUseCapability,
} from '../tiers.js'
import { DISABLED_PLUGINS } from '../index.js'

const NATIVE_16 = [
  'abaco-agent-status',
  'abaco-brand',
  'abaco-browser',
  'abaco-cloud-sync',
  'abaco-context',
  'abaco-device-identity',
  'abaco-documents',
  'abaco-effect-broker',
  'abaco-experimental',
  'abaco-observability',
  'abaco-onboarding',
  'abaco-theme',
  'abaco-vault',
  'abaco-voice',
  'abaco-memory',
  'abaco-mediacion-pilot',
]

const EXPECTED_TIERS = {
  'abaco-theme': 0,
  'abaco-agent-status': 0,
  'abaco-brand': 0,
  'abaco-onboarding': 0,
  'abaco-cloud-sync': 0,
  'abaco-experimental': 0,
  'abaco-observability': 1,
  'abaco-documents': 1,
  'abaco-memory': 2,
  'abaco-vault': 2,
  'abaco-device-identity': 2,
  'abaco-context': 2,
  'abaco-browser': 3,
  'abaco-voice': 3,
  'abaco-mediacion-pilot': 3,
  'abaco-effect-broker': 4,
}

test('los 16 nativos clasificados, exactamente esas 16 claves, valores 0..4', () => {
  const keys = Object.keys(TIERS).sort()
  assert.deepEqual(keys, [...NATIVE_16].sort())
  assert.deepEqual(TIERS, EXPECTED_TIERS)
  for (const [id, tier] of Object.entries(TIERS)) {
    assert.ok(Number.isInteger(tier) && tier >= 0 && tier <= 4, `${id} tier ${tier} fuera de 0..4`)
  }
})

test('TIERS es inmutable (Object.freeze)', () => {
  assert.ok(Object.isFrozen(TIERS))
  assert.throws(() => {
    TIERS['abaco-theme'] = 4
  }, TypeError)
})

test('tierOf: valores conocidos', () => {
  assert.equal(tierOf('abaco-theme'), 0)
  assert.equal(tierOf('abaco-documents'), 1)
  assert.equal(tierOf('abaco-vault'), 2)
  assert.equal(tierOf('abaco-voice'), 3)
  assert.equal(tierOf('abaco-effect-broker'), 4)
})

test('tierOf: plugin desconocido -> -1 (deny-by-default)', () => {
  assert.equal(tierOf('abaco-evil'), -1)
  assert.equal(tierOf(''), -1)
  assert.equal(tierOf(undefined), -1)
  assert.equal(tierOf(null), -1)
  assert.equal(tierOf(42), -1)
})

test('self_modify exige tier >= 1: T0 denegado, T1 permitido', () => {
  const t0 = canUseCapability('abaco-theme', 'self_modify')
  assert.equal(t0.ok, false)
  assert.match(t0.reason, /^tier-insufficient/)
  const t1 = canUseCapability('abaco-documents', 'self_modify')
  assert.deepEqual(t1, { ok: true, reason: 'ok' })
})

test('plugin desconocido denegado en canUseCapability', () => {
  const r = canUseCapability('abaco-evil', 'ui.slot')
  assert.deepEqual(r, { ok: false, reason: 'unknown-plugin' })
  const r2 = canUseCapability('abaco-evil', 'grant.mutate')
  assert.deepEqual(r2, { ok: false, reason: 'unknown-plugin' })
})

test('disabled -> isDisabled true; gate deniega plugin-disabled', () => {
  for (const id of ['abaco-brand', 'abaco-device-identity', 'abaco-cloud-sync', 'abaco-onboarding', 'abaco-experimental']) {
    assert.equal(isDisabled(id), true, `${id} debe estar disabled`)
    // Incluso una capability que su tier permitiria (ui.slot @ T0) se deniega:
    // disabled gana sobre el tier.
    assert.deepEqual(canUseCapability(id, 'ui.slot'), { ok: false, reason: 'plugin-disabled' })
  }
  assert.equal(isDisabled('abaco-voice'), false)
  assert.equal(isDisabled('abaco-theme'), false)
  assert.equal(isDisabled('abaco-evil'), false) // desconocido no esta en la lista
})

test('DISABLED coherente con DISABLED_PLUGINS del broker (index.js)', () => {
  assert.deepEqual(new Set([...DISABLED].sort()), new Set([...DISABLED_PLUGINS].sort()))
  assert.equal(DISABLED.size, 5)
})

test('gate por tier: permite lo legitimo, deniega lo que excede', () => {
  // T3: voice puede spawn + net; T0 no.
  assert.deepEqual(canUseCapability('abaco-voice', 'proc.spawn'), { ok: true, reason: 'ok' })
  assert.deepEqual(canUseCapability('abaco-voice', 'net.fetch'), { ok: true, reason: 'ok' })
  const denied = canUseCapability('abaco-theme', 'net.fetch')
  assert.equal(denied.ok, false)
  assert.match(denied.reason, /^tier-insufficient/)
  // T2: vault puede fs.write; T1 no puede fs.write general (solo confined).
  assert.deepEqual(canUseCapability('abaco-vault', 'fs.write'), { ok: true, reason: 'ok' })
  assert.equal(canUseCapability('abaco-observability', 'fs.write').ok, false)
  assert.deepEqual(canUseCapability('abaco-observability', 'fs.write.confined'), { ok: true, reason: 'ok' })
  // T3: mediacion-pilot spawn ok; T1 documents solo spawn constrained.
  assert.deepEqual(canUseCapability('abaco-mediacion-pilot', 'proc.spawn'), { ok: true, reason: 'ok' })
  assert.equal(canUseCapability('abaco-documents', 'proc.spawn').ok, false)
  assert.deepEqual(canUseCapability('abaco-documents', 'proc.spawn.constrained'), { ok: true, reason: 'ok' })
})

test('grant.mutate / compose.mutate reservados a T4 (solo el broker)', () => {
  assert.deepEqual(canUseCapability('abaco-effect-broker', 'grant.mutate'), { ok: true, reason: 'ok' })
  assert.deepEqual(canUseCapability('abaco-effect-broker', 'compose.mutate'), { ok: true, reason: 'ok' })
  assert.equal(canUseCapability('abaco-voice', 'grant.mutate').ok, false)
  assert.equal(canUseCapability('abaco-mediacion-pilot', 'compose.mutate').ok, false)
})

test('capability desconocida -> deny-by-default', () => {
  const r = canUseCapability('abaco-voice', 'mind.read')
  assert.deepEqual(r, { ok: false, reason: 'unknown-capability' })
  const r2 = canUseCapability('abaco-voice', '')
  assert.deepEqual(r2, { ok: false, reason: 'unknown-capability' })
})

test('tabla CAPABILITY_MIN_TIER: self_modify >= 1 y es ordinal coherente', () => {
  assert.ok(CAPABILITY_MIN_TIER['self_modify'] >= 1)
  assert.equal(CAPABILITY_MIN_TIER['ui.slot'], 0)
  assert.equal(CAPABILITY_MIN_TIER['grant.mutate'], 4)
  assert.equal(CAPABILITY_MIN_TIER['proc.spawn'], 3)
  assert.ok(Object.isFrozen(CAPABILITY_MIN_TIER))
})
