/**
 * Ola 2 Bloque 2.C — Update feed digest pin + refuse-launch
 *
 * Extends the partial plugin pin path (PINNED_ARTIFACT / verifyAdmissions):
 * when an update-feed / build stamp binds a host binary digest to broker pins,
 * launch and authorize refuse if:
 *   - running binaryDigest !== feed-pinned binary digest
 *   - embedded broker pins !== feed-bound broker pins
 *
 * A version/tag match alone never allows launch (same doctrine as supply-chain
 * admission: tag-match-digest-mismatch is deny).
 *
 * Unsigned-dev with no stamp configured stays allow (ADR-003); notarize itself
 * is a dated GAP (Desk F7 HOLD), never soft-PASS.
 *
 * Jev / Atena never grant a pin widen.
 *
 * @module abaco-effect-broker/update-feed-digest-pin
 */

/** Product marker — docs + CI grep. */
export const OLA2_BLOQUE_C = 'OLA2-BLOQUE-C-UPDATE-FEED-DIGEST-PIN'

/** Deny / refuse reasons (authorize + issueTaskGrant). */
export const REFUSE_LAUNCH_REASON = 'refuse-launch'
export const REASON_BINARY_DIGEST_MISSING = 'binary-digest-missing'
export const REASON_BINARY_DIGEST_MISMATCH = 'binary-digest-mismatch'
export const REASON_BROKER_PINS_MISSING = 'broker-pins-missing'
export const REASON_BROKER_PIN_MISMATCH = 'broker-pin-mismatch'
export const REASON_BROKER_PIN_UNEXPECTED = 'broker-pin-unexpected'
export const REASON_TAG_ONLY_INSUFFICIENT = 'tag-only-insufficient'
export const REASON_FEED_DIGEST_MISSING = 'feed-digest-missing'
export const REASON_UNCONFIGURED_DEV = 'unconfigured-dev'
export const REASON_OK = 'ok'

const SHA256_RE = /^[a-f0-9]{64}$/
const SHA512_RE = /^[a-f0-9]{128}$/

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSha256Hex(value) {
  return typeof value === 'string' && SHA256_RE.test(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSha512Hex(value) {
  return typeof value === 'string' && SHA512_RE.test(value)
}

/**
 * Normalize pin map: string digests only, sorted keys for stable compare.
 * @param {unknown} pins
 * @returns {Record<string, string> | null}
 */
export function normalizePinMap(pins) {
  if (pins == null) return null
  if (typeof pins !== 'object' || Array.isArray(pins)) return null
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(pins)) {
    const id = String(k || '').trim()
    if (!id) continue
    if (typeof v !== 'string' || !SHA256_RE.test(v)) return null
    out[id] = v
  }
  return out
}

/**
 * Deep equality of pin maps (same keys, same digests).
 * @param {Record<string, string> | null} a
 * @param {Record<string, string> | null} b
 */
export function pinMapsEqual(a, b) {
  if (a == null || b == null) return false
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    if (a[ak[i]] !== b[bk[i]]) return false
  }
  return true
}

/**
 * Pure launch gate. CODE decides; advisors ignored.
 *
 * @param {{
 *   binaryDigest?: unknown,
 *   feedBinaryDigest?: unknown,
 *   brokerPins?: unknown,
 *   feedBrokerPins?: unknown,
 *   versionMatch?: boolean,
 *   requireConfigured?: boolean,
 * }} [input]
 * @returns {{
 *   allowLaunch: boolean,
 *   reason: string,
 *   configured: boolean,
 *   advisor_ignored: true,
 * }}
 */
export function decideUpdateFeedLaunch(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const base = { advisor_ignored: true }

  // Tag/version alone is never enough (harden the partial hole).
  if (src.versionMatch === true) {
    const hasBinaryPin =
      isSha256Hex(src.feedBinaryDigest) || isSha256Hex(src.binaryDigest)
    const feedPins = normalizePinMap(src.feedBrokerPins)
    const livePins = normalizePinMap(src.brokerPins)
    const hasPinPair = feedPins != null && livePins != null
    if (!hasBinaryPin && !hasPinPair) {
      return {
        allowLaunch: false,
        reason: REASON_TAG_ONLY_INSUFFICIENT,
        configured: false,
        ...base,
      }
    }
  }

  const feedBinary = typeof src.feedBinaryDigest === 'string' ? src.feedBinaryDigest : ''
  const liveBinary = typeof src.binaryDigest === 'string' ? src.binaryDigest : ''
  const feedPins = normalizePinMap(src.feedBrokerPins)
  const livePins = normalizePinMap(src.brokerPins)

  const configured =
    isSha256Hex(feedBinary) ||
    (feedPins != null && Object.keys(feedPins).length > 0)

  if (!configured) {
    if (src.requireConfigured === true) {
      return {
        allowLaunch: false,
        reason: REASON_FEED_DIGEST_MISSING,
        configured: false,
        ...base,
      }
    }
    // Unsigned-dev / no stamp: allow, but never claim notarize PASS.
    return {
      allowLaunch: true,
      reason: REASON_UNCONFIGURED_DEV,
      configured: false,
      ...base,
    }
  }

  if (isSha256Hex(feedBinary)) {
    if (!isSha256Hex(liveBinary)) {
      return {
        allowLaunch: false,
        reason: REASON_BINARY_DIGEST_MISSING,
        configured: true,
        ...base,
      }
    }
    if (liveBinary !== feedBinary) {
      return {
        allowLaunch: false,
        reason: REASON_BINARY_DIGEST_MISMATCH,
        configured: true,
        ...base,
      }
    }
  }

  if (feedPins != null && Object.keys(feedPins).length > 0) {
    if (livePins == null) {
      return {
        allowLaunch: false,
        reason: REASON_BROKER_PINS_MISSING,
        configured: true,
        ...base,
      }
    }
    const feedKeys = Object.keys(feedPins).sort()
    const liveKeys = Object.keys(livePins).sort()
    for (const id of feedKeys) {
      if (!Object.prototype.hasOwnProperty.call(livePins, id) || livePins[id] !== feedPins[id]) {
        return {
          allowLaunch: false,
          reason: REASON_BROKER_PIN_MISMATCH,
          configured: true,
          ...base,
        }
      }
    }
    for (const id of liveKeys) {
      if (!Object.prototype.hasOwnProperty.call(feedPins, id)) {
        return {
          allowLaunch: false,
          reason: REASON_BROKER_PIN_UNEXPECTED,
          configured: true,
          ...base,
        }
      }
    }
    if (!pinMapsEqual(feedPins, livePins)) {
      return {
        allowLaunch: false,
        reason: REASON_BROKER_PIN_MISMATCH,
        configured: true,
        ...base,
      }
    }
  }

  return {
    allowLaunch: true,
    reason: REASON_OK,
    configured: true,
    ...base,
  }
}

/**
 * Update-feed artifact digest check (install / download path).
 * electron-updater latest*.yml carries sha512; pin tables may use sha256.
 *
 * @param {{
 *   feedSha512?: unknown,
 *   expectedSha512?: unknown,
 *   feedSha256?: unknown,
 *   expectedSha256?: unknown,
 *   requireDigest?: boolean,
 * }} [input]
 * @returns {{ allowInstall: boolean, reason: string }}
 */
export function decideUpdateFeedArtifactPin(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const feed512 = typeof src.feedSha512 === 'string' ? src.feedSha512.trim().toLowerCase() : ''
  const exp512 = typeof src.expectedSha512 === 'string' ? src.expectedSha512.trim().toLowerCase() : ''
  const feed256 = typeof src.feedSha256 === 'string' ? src.feedSha256.trim().toLowerCase() : ''
  const exp256 = typeof src.expectedSha256 === 'string' ? src.expectedSha256.trim().toLowerCase() : ''

  const hasAny =
    isSha512Hex(feed512) ||
    isSha512Hex(exp512) ||
    isSha256Hex(feed256) ||
    isSha256Hex(exp256)

  if (!hasAny) {
    if (src.requireDigest === true) {
      return { allowInstall: false, reason: REASON_FEED_DIGEST_MISSING }
    }
    return { allowInstall: true, reason: REASON_UNCONFIGURED_DEV }
  }

  if (isSha512Hex(exp512)) {
    if (!isSha512Hex(feed512)) {
      return { allowInstall: false, reason: REASON_FEED_DIGEST_MISSING }
    }
    if (feed512 !== exp512) {
      return { allowInstall: false, reason: REASON_BINARY_DIGEST_MISMATCH }
    }
  }

  if (isSha256Hex(exp256)) {
    if (!isSha256Hex(feed256)) {
      return { allowInstall: false, reason: REASON_FEED_DIGEST_MISSING }
    }
    if (feed256 !== exp256) {
      return { allowInstall: false, reason: REASON_BINARY_DIGEST_MISMATCH }
    }
  }

  // Digest present on feed but no expected pin yet: requireDigest refuses;
  // otherwise HOLD-style allow only when requireDigest is false.
  if (src.requireDigest === true && !isSha512Hex(exp512) && !isSha256Hex(exp256)) {
    return { allowInstall: false, reason: REASON_FEED_DIGEST_MISSING }
  }

  return { allowInstall: true, reason: REASON_OK }
}

/**
 * Authorize gate helper. Uses sealed stamp when present; also honors
 * req.update_feed / req.launch_pin overlays for tests.
 *
 * @param {object | null | undefined} req
 * @param {{
 *   binaryDigest?: string,
 *   feedBinaryDigest?: string,
 *   brokerPins?: Record<string, string>,
 *   feedBrokerPins?: Record<string, string>,
 *   requireConfigured?: boolean,
 * } | null} [sealed]
 * @returns {{ ok: true, reason: string } | { ok: false, reason: string }}
 */
export function gateAuthorizeUpdateFeedPin(req, sealed = null) {
  const overlay =
    req && typeof req === 'object'
      ? req.update_feed || req.launch_pin || req.updateFeed || null
      : null

  if (!sealed && !overlay) {
    return { ok: true, reason: REASON_UNCONFIGURED_DEV }
  }

  const merged = {
    ...(sealed && typeof sealed === 'object' ? sealed : {}),
    ...(overlay && typeof overlay === 'object' ? overlay : {}),
  }

  const decision = decideUpdateFeedLaunch(merged)
  if (!decision.allowLaunch) {
    return { ok: false, reason: decision.reason }
  }
  return { ok: true, reason: decision.reason }
}

/** @type {{
 *   binaryDigest?: string,
 *   feedBinaryDigest?: string,
 *   brokerPins?: Record<string, string>,
 *   feedBrokerPins?: Record<string, string>,
 *   requireConfigured?: boolean,
 * } | null} */
let sealedLaunchPin = null

/** @type {string | null} */
let launchPinFailure = null

/**
 * Seal the launch pin stamp (build / update-feed binding). Fail-closed when
 * requireConfigured and decideUpdateFeedLaunch refuses.
 *
 * @param {{
 *   binaryDigest?: string,
 *   feedBinaryDigest?: string,
 *   brokerPins?: Record<string, string>,
 *   feedBrokerPins?: Record<string, string>,
 *   requireConfigured?: boolean,
 * } | null} stamp
 */
export function sealUpdateFeedLaunchPin(stamp) {
  if (stamp == null) {
    sealedLaunchPin = null
    launchPinFailure = null
    return decideUpdateFeedLaunch({})
  }
  const decision = decideUpdateFeedLaunch(stamp)
  sealedLaunchPin = Object.freeze({ ...stamp })
  launchPinFailure = decision.allowLaunch ? null : decision.reason
  return decision
}

/** Introspection for tests/ops. */
export function getUpdateFeedLaunchStatus() {
  return {
    ok: launchPinFailure === null,
    failure: launchPinFailure,
    sealed: sealedLaunchPin,
    marker: OLA2_BLOQUE_C,
  }
}

/** Test-only reset. */
export function resetUpdateFeedLaunchPinForTests() {
  sealedLaunchPin = null
  launchPinFailure = null
}

/**
 * Current sealed stamp (or null). Used by authorize().
 */
export function getSealedUpdateFeedLaunchPin() {
  return sealedLaunchPin
}

/**
 * Failure reason if sealed stamp refused launch; else null.
 */
export function getUpdateFeedLaunchFailure() {
  return launchPinFailure
}
