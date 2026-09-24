/**
 * Ola 3 / 3.1 -- D6 provenance stamp (artifact digest + builder id).
 * Run from desktop/src/dsh-desktop:
 *   node --test packages/abaco-effect-broker/tests/d6-provenance-stamp.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OLA3_BLOQUE,
  PROVENANCE_MODE_STAMP_ONLY,
  CONFIGURED_BUILDER_IDS,
  decideD6Provenance,
  stampProvenance,
  computeProvenanceStamp,
  sealD6Provenance,
  getD6ProvenanceStatus,
  resetD6ProvenanceForTests,
  gateAuthorizeD6Provenance,
  REASON_OK,
  REASON_DIGEST_MISMATCH,
  REASON_BUILDER_UNTRUSTED,
  REASON_STAMP_MISMATCH,
  REASON_SIGSTORE_CLAIM_FORBIDDEN,
  REASON_DIGEST_MISSING,
  REASON_BUILDER_MISSING,
} from '../d6-provenance-stamp.mjs'
import {
  authorize,
  resetBrokerForTests,
  sealD6Provenance as sealFromBroker,
  hashArgs,
  OLA3_BLOQUE as BROKER_OLA3,
} from '../index.js'
import { resetAuditForTests } from '../provenance.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..', '..', '..')
const DOC = join(REPO, 'docs', 'frontier', 'OLA3-BLOQUE.md')
const GAP = join(REPO, 'docs', 'frontier', 'GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md')
const CHECKLIST = join(REPO, 'docs', 'frontier', 'MARKETPLACE-OPEN-CHECKLIST.md')
const PIN_GATE = join(REPO, 'docs', 'frontier', 'PIN-ROTATION-RELEASE-GATE.md')
const D6_SRC = join(HERE, '..', 'd6-provenance-stamp.mjs')

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const BUILDER = CONFIGURED_BUILDER_IDS[0]
const BUILDER_REVIEW = CONFIGURED_BUILDER_IDS[1]

beforeEach(() => {
  resetBrokerForTests()
  resetAuditForTests()
  resetD6ProvenanceForTests()
})

afterEach(() => {
  resetD6ProvenanceForTests()
})

test('product marker OLA3-BLOQUE present', () => {
  assert.equal(OLA3_BLOQUE, 'OLA3-BLOQUE-SUPPLY-CHAIN-D6')
  assert.equal(BROKER_OLA3, OLA3_BLOQUE)
  assert.ok(existsSync(DOC), `missing ${DOC}`)
  const text = readFileSync(DOC, 'utf8')
  assert.match(text, /OLA3-BLOQUE-SUPPLY-CHAIN-D6|3\.1|D6/)
  assert.match(text, /stamp-only/)
  assert.doesNotMatch(text, /signed by Sigstore/)
})

test('GAP Sigstore dated HOLD exists and is not soft-PASS', () => {
  assert.ok(existsSync(GAP), `missing ${GAP}`)
  const text = readFileSync(GAP, 'utf8')
  assert.match(text, /HOLD/)
  assert.match(text, /2026-09-23/)
  assert.match(text, /stamp-only|Sigstore/i)
  assert.match(text, /NOT soft-PASS|not soft-PASS|never soft-PASS/i)
  assert.doesNotMatch(text, /\|\s*\*\*status\*\*\s*\|\s*\*\*PASS\*\*/)
  assert.doesNotMatch(text, /signed by Sigstore/)
})

test('marketplace checklist and pin-rotation gate docs exist', () => {
  assert.ok(existsSync(CHECKLIST), `missing ${CHECKLIST}`)
  assert.ok(existsSync(PIN_GATE), `missing ${PIN_GATE}`)
  const checklist = readFileSync(CHECKLIST, 'utf8')
  assert.match(checklist, /INV-12|INV-AUDIT-CHAIN/)
  assert.match(checklist, /UtilityProcess|utility-process/i)
  assert.match(checklist, /digest|SBOM/i)
  assert.match(checklist, /Sigstore|GAP/i)
  assert.match(checklist, /pin/i)
  const pinDoc = readFileSync(PIN_GATE, 'utf8')
  assert.match(pinDoc, /PINNED_ARTIFACT|release gate|sign-manifest/i)
})

test('subject binds artifact digest + configured builder id', () => {
  const rec = stampProvenance({ artifactDigest: DIGEST_A, builderId: BUILDER })
  assert.equal(rec.mode, PROVENANCE_MODE_STAMP_ONLY)
  assert.equal(rec.sigstoreClaim, false)
  assert.equal(rec.inTotoClaim, false)
  assert.equal(rec.subject.artifactDigest, DIGEST_A)
  assert.equal(rec.subject.builderId, BUILDER)
  assert.match(rec.note, /not a Sigstore signature|stamp-only/i)
  const d = decideD6Provenance({
    artifactDigest: DIGEST_A,
    builderId: BUILDER,
    stamp: rec.stamp,
  })
  assert.equal(d.admit, true)
  assert.equal(d.reason, REASON_OK)
  assert.equal(d.sigstoreClaim, false)
})

test('digest mismatch refuses', () => {
  const stamp = computeProvenanceStamp({ artifactDigest: DIGEST_A, builderId: BUILDER })
  const d = decideD6Provenance({
    artifactDigest: DIGEST_A,
    expectedArtifactDigest: DIGEST_B,
    builderId: BUILDER,
    stamp,
  })
  assert.equal(d.admit, false)
  assert.equal(d.reason, REASON_DIGEST_MISMATCH)
})

test('untrusted builder id refuses', () => {
  const stamp = computeProvenanceStamp({
    artifactDigest: DIGEST_A,
    builderId: 'https://evil.example/builder',
  })
  const d = decideD6Provenance({
    artifactDigest: DIGEST_A,
    builderId: 'https://evil.example/builder',
    stamp,
  })
  assert.equal(d.admit, false)
  assert.equal(d.reason, REASON_BUILDER_UNTRUSTED)
})

test('builder missing / digest missing refuse', () => {
  assert.equal(
    decideD6Provenance({ artifactDigest: DIGEST_A, builderId: '', stamp: 'c'.repeat(64) }).reason,
    REASON_BUILDER_MISSING,
  )
  assert.equal(
    decideD6Provenance({ artifactDigest: 'nope', builderId: BUILDER, stamp: 'c'.repeat(64) }).reason,
    REASON_DIGEST_MISSING,
  )
})

test('stamp mismatch refuses', () => {
  const d = decideD6Provenance({
    artifactDigest: DIGEST_A,
    builderId: BUILDER,
    stamp: 'f'.repeat(64),
  })
  assert.equal(d.admit, false)
  assert.equal(d.reason, REASON_STAMP_MISMATCH)
})

test('claimSignedBySigstore under stamp-only is refuse (never fake)', () => {
  const rec = stampProvenance({ artifactDigest: DIGEST_A, builderId: BUILDER_REVIEW })
  const d = decideD6Provenance({
    artifactDigest: DIGEST_A,
    builderId: BUILDER_REVIEW,
    stamp: rec.stamp,
    claimSignedBySigstore: true,
  })
  assert.equal(d.admit, false)
  assert.equal(d.reason, REASON_SIGSTORE_CLAIM_FORBIDDEN)
})

test('module source never claims signed by Sigstore', () => {
  const src = readFileSync(D6_SRC, 'utf8')
  assert.doesNotMatch(src, /signed by Sigstore/)
  assert.match(src, /MUST NOT be described|not signed by Sigstore|NOT a Sigstore/i)
})

test('seal refuse blocks authorize; matching seal allows gate', () => {
  const bad = sealD6Provenance({
    artifactDigest: DIGEST_A,
    builderId: 'not-a-configured-builder',
  })
  assert.equal(bad.admit, false)
  assert.equal(gateAuthorizeD6Provenance().ok, false)
  assert.equal(getD6ProvenanceStatus().refused, true)

  const denied = authorize({
    channel: { kind: 'cordis.host', pluginId: 'abaco-voice' },
    task_id: null,
    effect: {
      kind: 'ui.slot',
      resource: 'abaco-voice',
      args_hash: hashArgs({}),
    },
    trust_in: 'user',
  })
  assert.equal(denied.decision, 'deny')
  assert.match(String(denied.reason || ''), /builder|stamp|digest|d6|provenance|untrusted/i)

  resetD6ProvenanceForTests()
  const rec = stampProvenance({ artifactDigest: DIGEST_A, builderId: BUILDER })
  const ok = sealFromBroker({ ...rec.subject, stamp: rec.stamp })
  assert.equal(ok.admit, true)
  assert.equal(gateAuthorizeD6Provenance().ok, true)
})

test('unconfigured D6 does not block authorize path by itself', () => {
  assert.equal(gateAuthorizeD6Provenance().ok, true)
  assert.equal(gateAuthorizeD6Provenance().reason, 'unconfigured')
})
