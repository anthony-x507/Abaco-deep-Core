/**
 * INV-DURABLE-AUDIT-FAIL-CLOSED (Ola 1 / Bloque 1 item 1.3)
 *
 * Stub FS errors on durable effects.jsonl append → after K consecutive
 * failures, authorize denies NEW effects with reason `audit-unavailable`.
 * Tip-of-spear: already-admitted ui.slot may continue; no mass unload.
 * In-memory auditLog keeps growing. Advisors never enter authorize.
 *
 * Run: node --test packages/abaco-effect-broker/tests/durable-audit-fail-closed.test.mjs
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
  getDurableAuditStatus,
  setDurableAppendForTests,
  isDurableAuditUnavailable,
  DURABLE_AUDIT_FAIL_THRESHOLD,
  hashArgs,
  issueTaskGrant,
  inspectGrant,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const STATUS_PATH = '/api/abaco-voice.local-status'

beforeEach(() => {
  resetBrokerForTests()
})

function voiceStatusReq(extra = {}) {
  return {
    channel: { kind: 'host.fetch', path: STATUS_PATH },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: STATUS_PATH,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
    ...extra,
  }
}

function voiceUiSlotReq() {
  return {
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: null,
    effect: {
      kind: 'ui.slot',
      resource: 'abaco-voice',
      args_hash: hashArgs({ slot: 'voice' }),
    },
    trust_in: 'user',
  }
}

function stubFsAlwaysFail(message = 'ENOSPC: stub durable append failure') {
  setDurableAppendForTests(() => {
    throw new Error(message)
  })
}

function tripDurableBreaker() {
  stubFsAlwaysFail()
  let guard = 0
  while (!isDurableAuditUnavailable() && guard < DURABLE_AUDIT_FAIL_THRESHOLD + 5) {
    authorize(voiceStatusReq())
    guard += 1
  }
  assert.equal(isDurableAuditUnavailable(), true, 'breaker must open after K failures')
}

test('INV-DURABLE-AUDIT-FAIL-CLOSED · stub FS error → deny after K failures', () => {
  stubFsAlwaysFail()

  for (let i = 0; i < DURABLE_AUDIT_FAIL_THRESHOLD - 1; i++) {
    const d = authorize(voiceStatusReq())
    assert.equal(d.decision, 'allow', `pre-threshold allow #${i + 1}`)
    assert.equal(isDurableAuditUnavailable(), false)
  }

  const statusAfterWarm = getDurableAuditStatus()
  assert.ok(
    statusAfterWarm.consecutiveFailures >= DURABLE_AUDIT_FAIL_THRESHOLD - 1 ||
      statusAfterWarm.failureTotal >= DURABLE_AUDIT_FAIL_THRESHOLD - 1,
  )

  let guard = 0
  while (!isDurableAuditUnavailable() && guard < DURABLE_AUDIT_FAIL_THRESHOLD + 3) {
    authorize(voiceStatusReq())
    guard += 1
  }
  assert.equal(isDurableAuditUnavailable(), true, 'breaker must open after K failures')
  assert.ok(getDurableAuditStatus().alertCount >= 1, 'operator alert counter must tick')
  assert.ok(getBrokerStats().durableAudit.unavailable)

  const memBefore = getAuditLog().length
  const openBefore = getBrokerStats().openGrants

  const denied = authorize(voiceStatusReq())
  assert.equal(denied.decision, 'deny')
  assert.equal(denied.reason, 'audit-unavailable')
  assert.equal(denied.audit?.reason || getAuditLog().at(-1)?.reason, 'audit-unavailable')
  assert.equal(denied.audit?.side_effect ?? getAuditLog().at(-1)?.side_effect, false)
  assert.ok(getAuditLog().length > memBefore, 'in-memory audit must keep growing')
  assert.equal(
    getBrokerStats().openGrants,
    openBefore,
    'fail-closed must not mass-revoke existing grants',
  )
})

test('INV-DURABLE-AUDIT-FAIL-CLOSED · tip-of-spear: admitted ui.slot not frozen', () => {
  tripDurableBreaker()

  const ui = authorize(voiceUiSlotReq())
  assert.equal(ui.decision, 'allow', 'already-admitted ui.slot must keep painting')
  assert.equal(ui.grant.plugin_id, 'abaco-voice')

  const stillDenied = authorize(voiceStatusReq())
  assert.equal(stillDenied.decision, 'deny')
  assert.equal(stillDenied.reason, 'audit-unavailable')
})

test('INV-DURABLE-AUDIT-FAIL-CLOSED · recovery on durable success clears breaker', () => {
  tripDurableBreaker()

  setDurableAppendForTests(() => {
    /* sync success */
  })
  const ui = authorize(voiceUiSlotReq())
  assert.equal(ui.decision, 'allow')
  assert.equal(isDurableAuditUnavailable(), false)
  assert.equal(getDurableAuditStatus().consecutiveFailures, 0)

  const happy = authorize(voiceStatusReq())
  assert.equal(happy.decision, 'allow')
})

test('INV-DURABLE-AUDIT-FAIL-CLOSED · existing grant stays inspectable (no fleet freeze)', () => {
  const g = issueTaskGrant({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS_PATH],
  })
  tripDurableBreaker()
  const snap = inspectGrant(g.grant_id)
  assert.equal(snap.live, true)
  assert.equal(snap.grant.plugin_id, 'abaco-voice')
})

test('INV-DURABLE-AUDIT-FAIL-CLOSED · authorize body has no advisor calls and no empty catch', async () => {
  const src = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  assert.match(src, /INV-DURABLE-AUDIT-FAIL-CLOSED/)
  assert.match(src, /audit-unavailable/)
  assert.doesNotMatch(src, /appendFile\([\s\S]{0,80}?\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/)
  const start = src.indexOf('export function authorize')
  const end = src.indexOf('function deny(', start)
  assert.ok(start >= 0 && end > start)
  const authorizeBody = src.slice(start, end)
  const codeOnly = authorizeBody.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(codeOnly, /\bJev\b/)
  assert.doesNotMatch(codeOnly, /\bAtena\b/)
  assert.doesNotMatch(codeOnly, /\bAtena\b/)
  assert.doesNotMatch(codeOnly, /\bjanice\b/i)
  assert.doesNotMatch(codeOnly, /from ['"][^'"]*jev/i)
  assert.doesNotMatch(codeOnly, /from ['"][^'"]*atena/i)
})
