/**
 * INV-GRANT-MAP-CAP (Ola 1 / Bloque 3 item 3.3 — deep half)
 *
 * openGrants ≤ MAX_OPEN_GRANTS; per-plugin mint rate ≤ MAX_MINT_RATE_PER_SEC.
 * Excess → throw + audit. Advisors never mint.
 *
 * Run: node --test packages/abaco-effect-broker/tests/grant-map-cap.test.mjs
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  issueTaskGrant,
  revokeGrant,
  setGrantMapLimitsForTests,
  MAX_OPEN_GRANTS,
  MAX_MINT_RATE_PER_SEC,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const STATUS = '/api/abaco-voice.local-status'

beforeEach(() => {
  resetBrokerForTests()
})

function mint(over = {}) {
  return issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS],
    ttlMs: 60_000,
    ...over,
  })
}

test('INV-GRANT-MAP-CAP · rejects when open grants at cap', () => {
  setGrantMapLimitsForTests(3, 100)
  const a = mint()
  const b = mint()
  const c = mint()
  assert.equal(getBrokerStats().openGrants, 3)
  assert.throws(() => mint(), /grant-map-cap/)
  assert.equal(getBrokerStats().grantMap.grantMapCapDenyCount, 1)
  const ev = getAuditLog().find((e) => e.kind === 'grant.map_cap')
  assert.ok(ev)
  assert.equal(ev.reason, 'grant-map-cap')
  assert.equal(ev.max_open_grants, 3)
  revokeGrant(a.grant_id)
  assert.equal(getBrokerStats().openGrants, 2)
  const d = mint()
  assert.ok(d.grant_id)
  void b
  void c
})

test('INV-GRANT-MAP-CAP · rejects mint rate flood per plugin', () => {
  setGrantMapLimitsForTests(100, 2)
  mint()
  mint()
  assert.throws(() => mint(), /mint-rate/)
  assert.equal(getBrokerStats().grantMap.mintRateDenyCount, 1)
  const ev = getAuditLog().find((e) => e.kind === 'grant.mint_rate')
  assert.ok(ev)
  assert.equal(ev.max_mint_rate_per_sec, 2)
})

test('INV-GRANT-MAP-CAP · mediacion-pilot has independent rate window', () => {
  setGrantMapLimitsForTests(100, 1)
  mint() // voice
  assert.throws(() => mint(), /mint-rate/)
  // different identity — own window
  const g = issueTaskGrant({
    pluginId: 'abaco-mediacion-pilot',
    effects: ['proc.spawn'],
    resources: ['bin:ffmpeg'],
    ttlMs: 60_000,
  })
  assert.ok(g.grant_id)
})

test('INV-GRANT-MAP-CAP · defaults exported; mint has no advisors', async () => {
  assert.equal(MAX_OPEN_GRANTS, 64)
  assert.equal(MAX_MINT_RATE_PER_SEC, 8)
  const src = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const mintStart = src.indexOf('export function issueTaskGrant')
  const mintEnd = src.indexOf('export function revokeGrant')
  const body = src.slice(mintStart, mintEnd)
  assert.doesNotMatch(body, /\bjev\b/i)
  assert.doesNotMatch(body, /\batena\b/i)
})
