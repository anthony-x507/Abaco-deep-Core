/**
 * F1 Control 1 closeout — node:test mirror of the day-14 fail-closed suite.
 * Vitest owns the Janice/desktop recorrido; this file keeps contract CI green
 * even when someone runs only `node --test` on the broker package.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorize,
  resetBrokerForTests,
  getBrokerStats,
  issueTaskGrant,
  revokeGrant,
  unloadAdmittedPlugin,
  hashArgs,
  SEALED_PRELOAD_KEYS,
} from '../index.js'

const STATUS = '/api/abaco-voice.local-status'
const CONTRACT = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../../docs/contracts/f1-broker-deny-reasons.json'),
    'utf8',
  ),
)

function assertDenyFour(d, denyBefore, allowBefore) {
  assert.equal(d.decision, 'deny')
  assert.ok(d.audit)
  assert.equal(d.audit.decision, 'deny')
  assert.equal(d.audit.side_effect, false)
  assert.ok(d.audit.reason)
  assert.equal(getBrokerStats().denyCount, denyBefore + 1)
  assert.equal(getBrokerStats().allowCount, allowBefore)
  assert.ok(CONTRACT.deny_reasons.includes(d.audit.reason), d.audit.reason)
}

beforeEach(() => {
  resetBrokerForTests()
})

test('M1 no-identity', () => {
  const denyBefore = getBrokerStats().denyCount
  const allowBefore = getBrokerStats().allowCount
  const d = authorize({
    channel: null,
    task_id: null,
    effect: { kind: 'proc.spawn', resource: 'bin:mlx_whisper', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyFour(d, denyBefore, allowBefore)
  assert.equal(d.reason, 'no-identity')
})

test('M4 preload-not-allowlisted', () => {
  assert.ok(!SEALED_PRELOAD_KEYS.includes('evil-new-channel'))
  const denyBefore = getBrokerStats().denyCount
  const allowBefore = getBrokerStats().allowCount
  const d = authorize({
    channel: { kind: 'preload', preloadKey: 'evil-new-channel' },
    task_id: null,
    effect: { kind: 'ipc.invoke', resource: 'evil-new-channel', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyFour(d, denyBefore, allowBefore)
  assert.equal(d.reason, 'preload-not-allowlisted')
})

test('M7 revoke ≤1s', () => {
  const g = issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS],
  })
  const t0 = Date.now()
  revokeGrant(g.grant_id)
  const denyBefore = getBrokerStats().denyCount
  const allowBefore = getBrokerStats().allowCount
  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS },
    task_id: g.task_id,
    grant_id: g.grant_id,
    effect: { kind: 'host.fetch', resource: STATUS, args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyFour(d, denyBefore, allowBefore)
  assert.equal(d.reason, 'grant-revoked')
  assert.ok(Date.now() - t0 < 1000)
})

test('M9 compose-mutate-forbidden', () => {
  const denyBefore = getBrokerStats().denyCount
  const allowBefore = getBrokerStats().allowCount
  const d = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: null,
    effect: { kind: 'compose.mutate', resource: 'caps:abaco-voice', args_hash: 'x' },
    trust_in: 'user',
  })
  assertDenyFour(d, denyBefore, allowBefore)
  assert.equal(d.reason, 'compose-mutate-forbidden')
})

test('M10 throw → policy', () => {
  const denyBefore = getBrokerStats().denyCount
  const allowBefore = getBrokerStats().allowCount
  const d = authorize({
    channel: {
      get kind() {
        throw new Error('forced')
      },
    },
    task_id: null,
    effect: { kind: 'host.fetch', resource: STATUS, args_hash: hashArgs({ method: 'GET' }) },
    trust_in: 'user',
  })
  assertDenyFour(d, denyBefore, allowBefore)
  assert.equal(d.reason, 'policy')
})

test('session unload does not write patch.yml', () => {
  const u = unloadAdmittedPlugin('abaco-mediacion-pilot')
  assert.equal(u.decision, 'ok')
  assert.equal(u.wrote_patch_yml, false)
  assert.equal(u.wrote_dsh_desktop, false)
  const d = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-mediacion-pilot' },
    task_id: null,
    effect: { kind: 'proc.spawn', resource: 'bin:ffmpeg', args_hash: 'x' },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'deny')
  assert.equal(d.reason, 'plugin-disabled')
})
