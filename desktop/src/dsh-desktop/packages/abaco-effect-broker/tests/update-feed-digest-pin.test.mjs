/**
 * Ola 2 Bloque 2.C — update feed digest pin + refuse-launch.
 * Run from desktop/src/dsh-desktop:
 *   node --test packages/abaco-effect-broker/tests/update-feed-digest-pin.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OLA2_BLOQUE_C,
  decideUpdateFeedLaunch,
  decideUpdateFeedArtifactPin,
  gateAuthorizeUpdateFeedPin,
  sealUpdateFeedLaunchPin,
  getUpdateFeedLaunchStatus,
  resetUpdateFeedLaunchPinForTests,
  pinMapsEqual,
  REASON_BINARY_DIGEST_MISMATCH,
  REASON_BROKER_PIN_MISMATCH,
  REASON_TAG_ONLY_INSUFFICIENT,
  REASON_FEED_DIGEST_MISSING,
  REASON_UNCONFIGURED_DEV,
  REASON_OK,
} from '../update-feed-digest-pin.mjs'
import { authorize, resetBrokerForTests, hashArgs, sealUpdateFeedLaunchPin as sealFromBroker } from '../index.js'
import { resetAuditForTests } from '../provenance.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..')
const DOC = join(REPO, 'docs', 'frontier', 'OLA2-BLOQUE-C.md')
const GAP = join(REPO, 'docs', 'frontier', 'GAP-NOTARIZE-2026-09-23.md')
const CONTRACT = join(REPO, 'docs', 'contracts', 'CONTRACT-INV-12.md')

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const DIGEST_C = 'c'.repeat(64)
const SHA512_A = 'd'.repeat(128)
const SHA512_B = 'e'.repeat(128)

beforeEach(() => {
  resetBrokerForTests()
  resetAuditForTests()
  resetUpdateFeedLaunchPinForTests()
})

afterEach(() => {
  resetUpdateFeedLaunchPinForTests()
})

test('product marker OLA2-BLOQUE-C present', () => {
  assert.equal(OLA2_BLOQUE_C, 'OLA2-BLOQUE-C-UPDATE-FEED-DIGEST-PIN')
  assert.ok(existsSync(DOC), `missing ${DOC}`)
  const text = readFileSync(DOC, 'utf8')
  assert.match(text, /OLA2-BLOQUE-C-UPDATE-FEED-DIGEST-PIN|2\.C\.1|refuse-launch/)
  assert.match(text, /broker pins/)
})

test('GAP notarize dated HOLD exists and is not soft-PASS', () => {
  assert.ok(existsSync(GAP), `missing ${GAP}`)
  const text = readFileSync(GAP, 'utf8')
  assert.match(text, /HOLD/)
  assert.match(text, /2026-09-23/)
  assert.match(text, /F7|quota|cred/i)
  assert.match(text, /NOT soft-PASS|not soft-PASS|never soft-PASS/i)
  // Must not claim a PASS status row; "PASS" may appear only as negation.
  assert.doesNotMatch(text, /\|\s*\*\*status\*\*\s*\|\s*\*\*PASS\*\*/)
  assert.match(text, /Notarize is \*\*not\*\* done|notarize is not done/i)
})

test('contract residual mentions update-feed pin / notarize GAP', () => {
  assert.ok(existsSync(CONTRACT), `missing ${CONTRACT}`)
  const text = readFileSync(CONTRACT, 'utf8')
  assert.match(text, /update.?feed|digest pin|notariz|GAP-NOTARIZE/i)
})

test('unconfigured unsigned-dev allows launch (not notarize PASS)', () => {
  const d = decideUpdateFeedLaunch({})
  assert.equal(d.allowLaunch, true)
  assert.equal(d.reason, REASON_UNCONFIGURED_DEV)
  assert.equal(d.configured, false)
})

test('requireConfigured without feed digest refuses launch', () => {
  const d = decideUpdateFeedLaunch({ requireConfigured: true })
  assert.equal(d.allowLaunch, false)
  assert.equal(d.reason, REASON_FEED_DIGEST_MISSING)
})

test('binary digest mismatch refuses launch', () => {
  const d = decideUpdateFeedLaunch({
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_B,
  })
  assert.equal(d.allowLaunch, false)
  assert.equal(d.reason, REASON_BINARY_DIGEST_MISMATCH)
})

test('matching binary digest allows launch', () => {
  const d = decideUpdateFeedLaunch({
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_A,
  })
  assert.equal(d.allowLaunch, true)
  assert.equal(d.reason, REASON_OK)
})

test('broker pin mismatch refuses launch (extends partial plugin pins)', () => {
  const d = decideUpdateFeedLaunch({
    feedBrokerPins: { 'abaco-voice': DIGEST_A },
    brokerPins: { 'abaco-voice': DIGEST_B },
  })
  assert.equal(d.allowLaunch, false)
  assert.equal(d.reason, REASON_BROKER_PIN_MISMATCH)
})

test('broker pins equal + binary match allows launch', () => {
  const pins = { 'abaco-voice': DIGEST_A, 'abaco-mediacion-pilot': DIGEST_C }
  assert.equal(pinMapsEqual(pins, { ...pins }), true)
  const d = decideUpdateFeedLaunch({
    feedBinaryDigest: DIGEST_B,
    binaryDigest: DIGEST_B,
    feedBrokerPins: pins,
    brokerPins: pins,
  })
  assert.equal(d.allowLaunch, true)
  assert.equal(d.reason, REASON_OK)
})

test('version/tag match alone NEVER allows launch', () => {
  const d = decideUpdateFeedLaunch({ versionMatch: true })
  assert.equal(d.allowLaunch, false)
  assert.equal(d.reason, REASON_TAG_ONLY_INSUFFICIENT)
})

test('versionMatch + digest mismatch still refuses (harden partial)', () => {
  const d = decideUpdateFeedLaunch({
    versionMatch: true,
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_B,
  })
  assert.equal(d.allowLaunch, false)
  assert.equal(d.reason, REASON_BINARY_DIGEST_MISMATCH)
})

test('CI lock: pin mismatch must not allow launch', () => {
  const mismatch = decideUpdateFeedLaunch({
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_B,
    feedBrokerPins: { 'abaco-voice': DIGEST_A },
    brokerPins: { 'abaco-voice': DIGEST_A },
  })
  // Binary mismatch alone is enough to refuse — wouldAllowLaunch must be false.
  assert.equal(mismatch.allowLaunch, false, 'pin mismatch must refuse launch')
  assert.notEqual(mismatch.reason, REASON_OK)
  assert.notEqual(mismatch.reason, REASON_UNCONFIGURED_DEV)
})

test('update feed artifact sha512 mismatch refuses install', () => {
  const bad = decideUpdateFeedArtifactPin({
    feedSha512: SHA512_A,
    expectedSha512: SHA512_B,
  })
  assert.equal(bad.allowInstall, false)
  assert.equal(bad.reason, REASON_BINARY_DIGEST_MISMATCH)

  const good = decideUpdateFeedArtifactPin({
    feedSha512: SHA512_A,
    expectedSha512: SHA512_A,
  })
  assert.equal(good.allowInstall, true)
  assert.equal(good.reason, REASON_OK)
})

test('requireDigest without pin refuses install', () => {
  const d = decideUpdateFeedArtifactPin({ requireDigest: true })
  assert.equal(d.allowInstall, false)
  assert.equal(d.reason, REASON_FEED_DIGEST_MISSING)
})

test('seal + authorize refuses when broker pins != binary stamp', () => {
  const decision = sealFromBroker({
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_B,
    requireConfigured: true,
  })
  assert.equal(decision.allowLaunch, false)
  const status = getUpdateFeedLaunchStatus()
  assert.equal(status.ok, false)
  assert.equal(status.failure, REASON_BINARY_DIGEST_MISMATCH)

  const res = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: null,
    effect: {
      kind: 'ui.slot',
      resource: 'abaco-voice',
      args_hash: hashArgs({}),
    },
    trust_in: 'user',
  })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reason, REASON_BINARY_DIGEST_MISMATCH)
})

test('authorize denies req.update_feed overlay pin mismatch without seal', () => {
  const res = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    update_feed: {
      feedBrokerPins: { 'abaco-voice': DIGEST_A },
      brokerPins: { 'abaco-voice': DIGEST_B },
    },
    task_id: null,
    effect: {
      kind: 'ui.slot',
      resource: 'abaco-voice',
      args_hash: hashArgs({}),
    },
    trust_in: 'user',
  })
  assert.equal(res.decision, 'deny')
  assert.equal(res.reason, REASON_BROKER_PIN_MISMATCH)
})

test('gateAuthorizeUpdateFeedPin unconfigured ok', () => {
  const g = gateAuthorizeUpdateFeedPin({}, null)
  assert.equal(g.ok, true)
  assert.equal(g.reason, REASON_UNCONFIGURED_DEV)
})

test('seal matching pins clears failure', () => {
  sealUpdateFeedLaunchPin({
    feedBinaryDigest: DIGEST_A,
    binaryDigest: DIGEST_A,
    feedBrokerPins: { 'abaco-voice': DIGEST_C },
    brokerPins: { 'abaco-voice': DIGEST_C },
  })
  assert.equal(getUpdateFeedLaunchStatus().ok, true)
  assert.equal(getUpdateFeedLaunchStatus().failure, null)
})
