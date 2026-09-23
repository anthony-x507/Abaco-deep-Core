/**
 * INV-TTL-BOUNDED (Ola 1 / Bloque 2 item 2.2 — deep half)
 *
 * issueTaskGrant rejects missing/immortal TTL on medium/high; clamps oversize
 * to MAX_TASK_TTL_MS with audit. authorize denies unbound grants.
 * Advisors never enter authorize / mint.
 *
 * Run: node --test packages/abaco-effect-broker/tests/ttl-bounded.test.mjs
 * (from desktop/src/dsh-desktop)
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  getAuditLog,
  hashArgs,
  issueTaskGrant,
  inspectGrant,
  MAX_TASK_TTL_MS,
  DEFAULT_TASK_TTL_MS,
  boundTaskTtlMs,
  isGrantTtlBounded,
  effectsRequireBoundedTtl,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const STATUS_PATH = '/api/abaco-voice.local-status'

beforeEach(() => {
  resetBrokerForTests()
})

function voiceGrant(over = {}) {
  return issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS_PATH],
    ...over,
  })
}

test('INV-TTL-BOUNDED · medium/high rejects missing ttl (null)', () => {
  assert.equal(effectsRequireBoundedTtl(['host.fetch']), true)
  assert.throws(
    () => voiceGrant({ ttlMs: null }),
    /ttl-missing/,
  )
  assert.equal(getBrokerStats().openGrants, 0)
})

test('INV-TTL-BOUNDED · rejects immortal ttl (Infinity / 0)', () => {
  assert.throws(() => voiceGrant({ ttlMs: Infinity }), /ttl-immortal/)
  assert.throws(() => voiceGrant({ ttlMs: Number.POSITIVE_INFINITY }), /ttl-immortal/)
  assert.throws(() => voiceGrant({ ttlMs: 0 }), /ttl-immortal/)
  assert.throws(() => voiceGrant({ ttlMs: -1 }), /ttl-immortal/)
  assert.throws(() => voiceGrant({ ttlMs: NaN }), /ttl-immortal/)
  assert.equal(getBrokerStats().openGrants, 0)
})

test('INV-TTL-BOUNDED · clamps upper bound and audits', () => {
  const huge = MAX_TASK_TTL_MS * 10
  const g = voiceGrant({ ttlMs: huge })
  assert.equal(g.ttl_ms, MAX_TASK_TTL_MS)
  assert.equal(isGrantTtlBounded(g), true)
  assert.equal(getBrokerStats().ttl.clampCount, 1)
  assert.equal(getBrokerStats().ttl.maxTaskTtlMs, MAX_TASK_TTL_MS)
  const clampEv = getAuditLog().find((e) => e.kind === 'grant.ttl_clamped')
  assert.ok(clampEv, 'clamp must be audited')
  assert.equal(clampEv.requested_ttl_ms, huge)
  assert.equal(clampEv.ttl_ms, MAX_TASK_TTL_MS)
  assert.equal(clampEv.max_ttl_ms, MAX_TASK_TTL_MS)
  assert.equal(clampEv.side_effect, false)
})

test('INV-TTL-BOUNDED · omitted ttlMs uses bounded default', () => {
  const g = voiceGrant()
  assert.equal(g.ttl_ms, DEFAULT_TASK_TTL_MS)
  assert.ok(g.ttl_ms <= MAX_TASK_TTL_MS)
  assert.equal(getBrokerStats().ttl.clampCount, 0)
})

test('INV-TTL-BOUNDED · ui.slot-only may omit null → default; still clamps oversize', () => {
  assert.equal(effectsRequireBoundedTtl(['ui.slot']), false)
  const bound = boundTaskTtlMs(null, ['ui.slot'])
  assert.equal(bound.ttlMs, DEFAULT_TASK_TTL_MS)

  const g = issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['ui.slot'],
    resources: ['abaco-voice'],
    ttlMs: MAX_TASK_TTL_MS + 1,
  })
  assert.equal(g.ttl_ms, MAX_TASK_TTL_MS)
  assert.equal(getBrokerStats().ttl.clampCount, 1)
})

test('INV-TTL-BOUNDED · authorize denies unbound grant (ttl-unbounded)', () => {
  const g = voiceGrant({ ttlMs: 60_000 })
  // Simulate a corrupt / pre-policy immortal row still in the map.
  g.ttl_ms = Number.POSITIVE_INFINITY
  assert.equal(isGrantTtlBounded(g), false)

  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'ttl-unbounded')
})

test('INV-TTL-BOUNDED · authorize auto-grant path stays bounded', () => {
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'allow')
  assert.ok(d.grant)
  assert.equal(isGrantTtlBounded(d.grant), true)
  assert.ok(d.grant.ttl_ms <= MAX_TASK_TTL_MS)
  assert.equal(inspectGrant(d.grant.grant_id).live, true)
})

test('INV-TTL-BOUNDED · authorize / mint helpers have no advisor symbols', async () => {
  const src = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  assert.match(src, /INV-TTL-BOUNDED/)
  assert.match(src, /MAX_TASK_TTL_MS/)
  assert.match(src, /ttl-unbounded/)
  assert.match(src, /ttl-immortal/)
  assert.match(src, /ttl-missing/)

  const start = src.indexOf('export function authorize')
  const end = src.indexOf('function deny(', start)
  assert.ok(start >= 0 && end > start)
  const authorizeBody = src.slice(start, end).replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(authorizeBody, /\bJev\b/)
  assert.doesNotMatch(authorizeBody, /\bAtena\b/)
  assert.doesNotMatch(authorizeBody, /\bjanice\b/i)

  const mintStart = src.indexOf('export function issueTaskGrant')
  const mintEnd = src.indexOf('export function revokeGrant', mintStart)
  assert.ok(mintStart >= 0 && mintEnd > mintStart)
  const mintBody = src.slice(mintStart, mintEnd).replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(mintBody, /\bJev\b/)
  assert.doesNotMatch(mintBody, /\bAtena\b/)
})
