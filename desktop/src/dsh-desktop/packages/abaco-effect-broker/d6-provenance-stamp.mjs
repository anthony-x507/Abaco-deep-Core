/**
 * Ola 3 / 3.1 -- D6 minimum provenance stamp.
 *
 * Subject binds:
 *   - artifact digest (sha256 hex of shippable subject bytes)
 *   - configured builder identity (builder.id string)
 *
 * The stamp is a local binding over that subject. It is NOT a Sigstore
 * signature, NOT an in-toto attestation envelope, and MUST NOT be described
 * as "Sigstore-attested". Full Sigstore/in-toto remains a dated GAP until
 * keys/OIDC exist (docs/frontier/GAP-SIGSTORE-STAMP-ONLY-2026-09-23.md).
 *
 * Mismatch of digest or builder id => refuse. Jev / Atena never grant.
 *
 * @module abaco-effect-broker/d6-provenance-stamp
 */

import { createHash } from 'node:crypto'

/** Product marker -- docs + CI grep. */
export const OLA3_BLOQUE = 'OLA3-BLOQUE-SUPPLY-CHAIN-D6'

/** Provenance mode. Only stamp-only is implemented without Sigstore keys. */
export const PROVENANCE_MODE_STAMP_ONLY = 'stamp-only'

/**
 * Configured builder root of trust (SLSA-shaped builder.id strings).
 * Review-time constant. Rotation = code review, not a runtime API.
 */
export const CONFIGURED_BUILDER_IDS = Object.freeze([
  'https://github.com/anthony-x507/Abaco-deep-Core/.github/workflows/desktop-ci.yml@refs/heads/main',
  'abaco-deep-core/review-time-sign-manifest',
])

export const REASON_OK = 'ok'
export const REASON_DIGEST_MISSING = 'artifact-digest-missing'
export const REASON_DIGEST_MISMATCH = 'artifact-digest-mismatch'
export const REASON_BUILDER_MISSING = 'builder-id-missing'
export const REASON_BUILDER_UNTRUSTED = 'builder-id-untrusted'
export const REASON_BUILDER_MISMATCH = 'builder-id-mismatch'
export const REASON_STAMP_MISSING = 'stamp-missing'
export const REASON_STAMP_MISMATCH = 'stamp-mismatch'
export const REASON_SIGSTORE_CLAIM_FORBIDDEN = 'sigstore-claim-forbidden'
export const REASON_MODE_INVALID = 'provenance-mode-invalid'

const SHA256_RE = /^[a-f0-9]{64}$/

/** @param {unknown} value */
export function isSha256Hex(value) {
  return typeof value === 'string' && SHA256_RE.test(value)
}

/**
 * @param {unknown} builderId
 * @param {readonly string[]} [trustRoot]
 */
export function isConfiguredBuilderId(builderId, trustRoot = CONFIGURED_BUILDER_IDS) {
  if (typeof builderId !== 'string' || !builderId.trim()) return false
  return trustRoot.includes(builderId)
}

/**
 * Canonical subject: artifact digest + builder identity.
 * @param {{ artifactDigest?: string, builderId?: string }} input
 */
export function provenanceSubject(input) {
  const artifactDigest = typeof input?.artifactDigest === 'string' ? input.artifactDigest : ''
  const builderId = typeof input?.builderId === 'string' ? input.builderId : ''
  return Object.freeze({ artifactDigest, builderId })
}

/**
 * Stamp = sha256(artifactDigest || builderId || mode). Binding only.
 * Never claim this is Sigstore.
 * @param {{ artifactDigest?: string, builderId?: string }} input
 */
export function computeProvenanceStamp(input) {
  const subject = provenanceSubject(input)
  const payload = `${subject.artifactDigest}\n${subject.builderId}\n${PROVENANCE_MODE_STAMP_ONLY}`
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/**
 * Build a stamp-only provenance record. Explicitly marks sigstoreClaim=false.
 * @param {{ artifactDigest: string, builderId: string }} input
 */
export function stampProvenance(input) {
  const subject = provenanceSubject(input)
  const stamp = computeProvenanceStamp(subject)
  return Object.freeze({
    mode: PROVENANCE_MODE_STAMP_ONLY,
    subject,
    stamp,
    sigstoreClaim: false,
    inTotoClaim: false,
    note: 'stamp-only; not Sigstore-attested',
  })
}

function closed(admit, reason, extra = {}) {
  return Object.freeze({
    admit,
    reason,
    mode: PROVENANCE_MODE_STAMP_ONLY,
    sigstoreClaim: false,
    advisor_ignored: true,
    ...extra,
  })
}

/**
 * Pure D6 gate. Subject must bind digest + configured builder id; stamp must
 * match. Claiming Sigstore while running stamp-only is always refuse.
 *
 * @param {{
 *   artifactDigest?: unknown,
 *   expectedArtifactDigest?: unknown,
 *   builderId?: unknown,
 *   stamp?: unknown,
 *   configuredBuilderIds?: readonly string[],
 *   claimSignedBySigstore?: boolean,
 *   claimInToto?: boolean,
 *   mode?: unknown,
 * }} [input]
 */
export function decideD6Provenance(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const trustRoot = Array.isArray(src.configuredBuilderIds)
    ? src.configuredBuilderIds
    : CONFIGURED_BUILDER_IDS

  if (src.claimSignedBySigstore === true || src.claimInToto === true) {
    return closed(false, REASON_SIGSTORE_CLAIM_FORBIDDEN)
  }
  if (src.mode != null && src.mode !== PROVENANCE_MODE_STAMP_ONLY) {
    return closed(false, REASON_MODE_INVALID)
  }

  const artifactDigest = typeof src.artifactDigest === 'string' ? src.artifactDigest : ''
  if (!isSha256Hex(artifactDigest)) {
    return closed(false, REASON_DIGEST_MISSING)
  }

  const expected =
    typeof src.expectedArtifactDigest === 'string' ? src.expectedArtifactDigest : artifactDigest
  if (!isSha256Hex(expected)) {
    return closed(false, REASON_DIGEST_MISSING)
  }
  if (artifactDigest !== expected) {
    return closed(false, REASON_DIGEST_MISMATCH)
  }

  const builderId = typeof src.builderId === 'string' ? src.builderId : ''
  if (!builderId.trim()) {
    return closed(false, REASON_BUILDER_MISSING)
  }
  if (!isConfiguredBuilderId(builderId, trustRoot)) {
    return closed(false, REASON_BUILDER_UNTRUSTED)
  }

  const stamp = typeof src.stamp === 'string' ? src.stamp : ''
  if (!isSha256Hex(stamp)) {
    return closed(false, REASON_STAMP_MISSING)
  }
  const expectedStamp = computeProvenanceStamp({ artifactDigest, builderId })
  if (stamp !== expectedStamp) {
    return closed(false, REASON_STAMP_MISMATCH)
  }

  return closed(true, REASON_OK, {
    subject: provenanceSubject({ artifactDigest, builderId }),
  })
}

/** @type {null | { artifactDigest: string, builderId: string, stamp: string, refused: boolean, reason: string }} */
let sealedD6 = null

/**
 * Seal a D6 stamp for the process. Fail-closed when decide refuses.
 * @param {{ artifactDigest: string, builderId: string, stamp?: string } | null | undefined} record
 */
export function sealD6Provenance(record) {
  if (record == null) {
    sealedD6 = null
    return closed(true, 'unconfigured')
  }
  const stamp =
    typeof record.stamp === 'string' && record.stamp
      ? record.stamp
      : computeProvenanceStamp(record)
  const decision = decideD6Provenance({ ...record, stamp })
  if (!decision.admit) {
    sealedD6 = Object.freeze({
      artifactDigest: String(record.artifactDigest || ''),
      builderId: String(record.builderId || ''),
      stamp,
      refused: true,
      reason: decision.reason,
    })
    return decision
  }
  sealedD6 = Object.freeze({
    artifactDigest: record.artifactDigest,
    builderId: record.builderId,
    stamp,
    refused: false,
    reason: REASON_OK,
  })
  return decision
}

export function getD6ProvenanceStatus() {
  return sealedD6
}

export function resetD6ProvenanceForTests() {
  sealedD6 = null
}

/**
 * Authorize helper: sealed refuse blocks; unconfigured does not.
 */
export function gateAuthorizeD6Provenance() {
  if (sealedD6 == null) {
    return { ok: true, reason: 'unconfigured' }
  }
  if (sealedD6.refused) {
    return { ok: false, reason: sealedD6.reason || REASON_STAMP_MISMATCH }
  }
  return { ok: true, reason: REASON_OK }
}
