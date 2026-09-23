/**
 * INV-NO-WIDEN (Ola 1 / Bloque 3 item 3.1 — deep)
 *
 * sessionCaps ⊆ pin. Widening beyond the pinned manifest requires HITL +
 * pinRevision. Digest change clears session overlays. Advisors never grant.
 *
 * Run: node --test packages/abaco-effect-broker/tests/no-widen-sessioncaps.test.mjs
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
  getAuditLog,
  hashArgs,
  proposeContractEvolution,
  acceptContractEvolution,
  getSessionCapsForTests,
  clearSessionCapsForDigestChange,
  sessionCapsSubsetOfPin,
  MANIFEST_CAPS,
} from '../index.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(THIS_DIR, '..')
const STATUS = '/api/abaco-voice.local-status'
const EXTRA = '/api/abaco-voice.local-extra'

beforeEach(() => {
  resetBrokerForTests()
})

test('INV-NO-WIDEN · subset-of-pin helper', () => {
  assert.equal(
    sessionCapsSubsetOfPin('abaco-voice', ['host.fetch'], [STATUS]),
    true,
  )
  assert.equal(
    sessionCapsSubsetOfPin('abaco-voice', ['host.fetch'], [EXTRA]),
    false,
  )
  assert.equal(
    sessionCapsSubsetOfPin('abaco-voice', ['grant.mutate'], [STATUS]),
    false,
  )
})

test('INV-NO-WIDEN · HITL alone cannot widen beyond pin', () => {
  const proposed = proposeContractEvolution({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [EXTRA],
  })
  assert.equal(proposed.decision, 'proposed')
  assert.equal(proposed.widen, true)

  const denied = acceptContractEvolution({
    proposal_id: proposed.proposal_id,
    hitl: true,
  })
  assert.equal(denied.decision, 'deny')
  assert.equal(denied.reason, 'caps-widen-requires-pin-revision')
  assert.equal(getSessionCapsForTests('abaco-voice').resources.length, 0)
  const ev = getAuditLog().find((e) => e.kind === 'contract.widen_denied')
  assert.ok(ev)
})

test('INV-NO-WIDEN · HITL + pinRevision widens session overlay only', () => {
  const proposed = proposeContractEvolution({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [EXTRA],
  })
  const accepted = acceptContractEvolution({
    proposal_id: proposed.proposal_id,
    hitl: true,
    pinRevision: true,
  })
  assert.equal(accepted.decision, 'ok')
  assert.equal(accepted.pin_revision, true)
  assert.equal(accepted.wrote_patch_yml, false)
  assert.ok(!MANIFEST_CAPS['abaco-voice'].resources.includes(EXTRA))
  const overlay = getSessionCapsForTests('abaco-voice')
  assert.ok(overlay.resources.includes(EXTRA))
  assert.equal(overlay.pin_revision, true)
  const rev = getAuditLog().find((e) => e.kind === 'contract.pin_revision')
  assert.ok(rev)

  const d = authorize({
    channel: { kind: 'host.fetch', path: STATUS, pluginId: 'abaco-voice' },
    task_id: null,
    effect: {
      kind: 'host.fetch',
      resource: EXTRA,
      args_hash: hashArgs({ method: 'GET' }),
    },
    trust_in: 'user',
  })
  assert.equal(d.decision, 'allow', d.reason)
})

test('INV-NO-WIDEN · non-widen (⊆ pin) still needs HITL, not pinRevision', () => {
  const proposed = proposeContractEvolution({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [STATUS],
  })
  assert.equal(proposed.widen, false)
  const noHitl = acceptContractEvolution({
    proposal_id: proposed.proposal_id,
    hitl: false,
  })
  assert.equal(noHitl.decision, 'deny')
  const ok = acceptContractEvolution({
    proposal_id: proposed.proposal_id,
    hitl: true,
  })
  assert.equal(ok.decision, 'ok')
  assert.equal(ok.pin_revision, false)
})

test('INV-NO-WIDEN · digest change clears session overlays', () => {
  const proposed = proposeContractEvolution({
    pluginId: 'abaco-voice',
    effects: ['host.fetch'],
    resources: [EXTRA],
  })
  acceptContractEvolution({
    proposal_id: proposed.proposal_id,
    hitl: true,
    pinRevision: true,
  })
  assert.ok(getSessionCapsForTests('abaco-voice').resources.includes(EXTRA))
  const cleared = clearSessionCapsForDigestChange('abaco-voice')
  assert.equal(cleared, true)
  assert.deepEqual(getSessionCapsForTests('abaco-voice').resources, [])
  const ev = getAuditLog().find((e) => e.kind === 'contract.session_caps_cleared')
  assert.ok(ev)
  assert.equal(ev.reason, 'digest-change')
})

test('INV-NO-WIDEN · authorize / accept have no advisor symbols', async () => {
  const src = await readFile(join(PKG_DIR, 'index.js'), 'utf8')
  const acceptStart = src.indexOf('export function acceptContractEvolution')
  const acceptEnd = src.indexOf('export function getContractEvolution')
  const body = src.slice(acceptStart, acceptEnd)
  assert.doesNotMatch(body, /\bjev\b/i)
  assert.doesNotMatch(body, /\batena\b/i)
  assert.doesNotMatch(body, /\bJanice\b/)
})
