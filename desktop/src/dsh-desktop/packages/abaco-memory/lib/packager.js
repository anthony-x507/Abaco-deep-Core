/**
 * F1.5 — fail-closed provenance for the 3-phase memory packager.
 *
 * Phases (orthogonal to the 3 context layers):
 *   profile — ∞, injectable (preferences, constraints, identity, output)
 *   log     — durable dated (decisions, facts, artifacts)
 *   note    — TTL / session working state (tasks, open_questions)
 *
 * Provenance: `effective = min(claim, channel)` on the frozen F2 ordinal
 * (same rule as F1-P2 / F2-W3 / threat-model). The channel is what the
 * harness vouches for; a caller cannot upgrade itself.
 *
 * This module does **not** replace Pack A (`lib/quarantine.js` + `MemoryStore`).
 * It consults `initialStateFor` / `trustOf` and never admits `plugin-data` or
 * `untrusted` as profile-admitted. `MemoryStore.set` / `promote` stay the
 * write lock.
 *
 * Untrusted phases cannot escalate to control (admission graph / preload /
 * patch.yml). Atena never grants. Janice = runtime only.
 *
 * ESM. Zero external dependencies. Hash via `node:crypto`. No network, no
 * dsh-desktop profile, no MCP pin files.
 *
 * @module abaco-memory/lib/packager
 */

import { createHash } from 'node:crypto'
import { initialStateFor, reviewerCanPromote, trustOf } from './quarantine.js'

/** The three durable-memory write/aging phases. */
export const MEMORY_PHASES = Object.freeze(['profile', 'log', 'note'])

/** Scope → phase. `role` ages with profile (identity is ∞). */
export const PHASE_OF_SCOPE = Object.freeze({
  profile: 'profile',
  role: 'profile',
  project: 'log',
  session: 'note'
})

/** Canonical facet → phase (CONTRACT memory 3-phase). */
export const FACET_PHASE = Object.freeze({
  identity: 'profile',
  preferences_user: 'profile',
  constraints_do_not: 'profile',
  output_format: 'profile',
  projects_state: 'log',
  decisions: 'log',
  facts: 'log',
  artifacts: 'log',
  tasks: 'note',
  open_questions: 'note'
})

/** Durability rank: note < log < profile. Escalation = a higher rank. */
export const PHASE_RANK = Object.freeze({ note: 0, log: 1, profile: 2 })

/**
 * Frozen F2 trust ordinal. Higher = more trusted.
 * `host` is an alias of `system` (Pack A host-plane ≡ F2 system).
 */
export const PACKAGER_TRUST_ORDINAL = Object.freeze({
  system: 5,
  host: 5,
  developer: 4,
  guardian: 3,
  user: 2,
  'plugin-data': 1,
  untrusted: 0
})

/** Host session roles. Atena is advisory and is never a grantor. */
export const PACKAGER_ROLES = Object.freeze({
  janice: 'runtime',
  atena: 'advisor-never-grants'
})

/** Closed deny reasons. Unknown reasons are not invented at the sink. */
export const PACKAGER_DENY_REASONS = Object.freeze([
  'no-identity',
  'phase-unknown',
  'phase-mismatch',
  'phase-escalation',
  'phase-masquerade',
  'provenance-policy',
  'integrity',
  'atena-cannot-grant',
  'janice-is-runtime',
  'memory-cannot-enter-control',
  'reviewer-policy'
])

/** Stable reason the runtime executor gets when it tries to grant. */
export const RUNTIME_GRANT_DENY = PACKAGER_DENY_REASONS[8]

const PHASES = new Set(MEMORY_PHASES)
const F2_LABELS = Object.freeze(['untrusted', 'plugin-data', 'user', 'guardian', 'developer', 'system'])

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function canonicalize(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`
}

function rankOf(label) {
  const rank = PACKAGER_TRUST_ORDINAL[label]
  return typeof rank === 'number' ? rank : undefined
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item)
    return Object.freeze(value)
  }
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/**
 * Map a Pack A / F2 label onto the F2 channel vocabulary.
 * Unknown labels fail closed (caller must not invent a tier).
 */
export function toF2Channel(label) {
  if (label === 'host') return 'system'
  if (rankOf(label) === undefined) return undefined
  if (label === 'system' || label === 'developer' || label === 'guardian' || label === 'user') return label
  if (label === 'plugin-data' || label === 'untrusted') return label
  return undefined
}

/**
 * Map an F2 effective tier onto Pack A `MEMORY_TRUST`.
 * system/developer/guardian collapse to `host` — memory never becomes control.
 */
export function toPackATrust(effective) {
  if (effective === 'system' || effective === 'developer' || effective === 'guardian' || effective === 'host') {
    return 'host'
  }
  if (effective === 'user') return 'user'
  if (effective === 'plugin-data') return 'plugin-data'
  if (effective === 'untrusted') return 'untrusted'
  return undefined
}

/** Verified channel from a Pack A `source` (`user:turn-3`, `tool:read`, …). */
export function channelFromSource(source) {
  return toF2Channel(trustOf(source))
}

/** Phase of a scope kind or a facet name. Unknown → undefined (fail-closed). */
export function phaseOf(scopeOrFacet) {
  if (typeof scopeOrFacet !== 'string') return undefined
  if (PHASE_OF_SCOPE[scopeOrFacet]) return PHASE_OF_SCOPE[scopeOrFacet]
  if (FACET_PHASE[scopeOrFacet]) return FACET_PHASE[scopeOrFacet]
  if (PHASES.has(scopeOrFacet)) return scopeOrFacet
  return undefined
}

/**
 * effective = min(claim, channel) on the F2 ordinal.
 * Unknown labels return undefined so the packager can fail closed.
 */
export function effectiveTier(claim, channel) {
  const claimRank = rankOf(claim)
  const channelRank = rankOf(channel)
  if (claimRank === undefined || channelRank === undefined) return undefined
  return claimRank <= channelRank ? (claim === 'host' ? 'system' : claim) : (channel === 'host' ? 'system' : channel)
}

function attestorKind(attestor) {
  if (attestor === undefined || attestor === null) return undefined
  if (typeof attestor === 'string') return attestor.trim().toLowerCase() || undefined
  if (typeof attestor !== 'object') return undefined
  if (typeof attestor.role === 'string' && attestor.role.trim()) return attestor.role.trim().toLowerCase()
  if (typeof attestor.trust === 'string' && attestor.trust.trim()) return attestor.trust.trim().toLowerCase()
  return undefined
}

function attestorId(attestor) {
  if (attestor !== null && typeof attestor === 'object' && typeof attestor.id === 'string') return attestor.id
  if (typeof attestor === 'string') return attestor
  return undefined
}

/**
 * Whether this attestor may grant a phase escalation or an admit.
 * Mechanical membership — never a model judgment.
 * Atena never grants. Janice is runtime and never grants.
 */
export function attestorCanGrant(attestor) {
  const kind = attestorKind(attestor)
  if (kind === 'atena' || kind === 'janice') return false
  if (attestor !== null && typeof attestor === 'object') {
    return reviewerCanPromote({ id: attestorId(attestor) ?? 'x', trust: attestor.trust })
  }
  return kind === 'host' || kind === 'user'
}

function deny(reason, extra = {}) {
  return deepFreeze({
    decision: 'deny',
    reason,
    side_effect: false,
    control: false,
    graph_mutated: false,
    wrote_patch_yml: false,
    activated_preload: false,
    ...extra
  })
}

function grantGate(attestor) {
  const kind = attestorKind(attestor)
  if (kind === 'atena') return deny('atena-cannot-grant', { attestor: kind })
  if (kind === 'janice') return deny('janice-is-runtime', { attestor: kind })
  return null
}

function identityFields(pkg) {
  return {
    content: pkg.content,
    phase: pkg.phase,
    provenance: {
      claim: pkg.provenance.claim,
      channel: pkg.provenance.channel,
      effective: pkg.provenance.effective
    },
    trust: pkg.trust,
    state: pkg.state
  }
}

function hashPackage(pkg) {
  return sha256Hex(canonicalize(identityFields(pkg)))
}

function extractContent(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text
  if (value === undefined || value === null) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/**
 * Seal a memory fact into one of the three phases.
 *
 * Deny-by-default on unknown phase, missing identity, Atena/Janice grant,
 * control target, masquerade-as-admitted, or trust that outranks the channel.
 *
 * A successful seal is **not** a Pack A admission: `state` still comes from
 * {@link initialStateFor}. plugin-data / untrusted stay `quarantined`.
 *
 * @param {object} input
 * @returns {object} frozen allow | deny
 */
export function packageMemory(input = {}) {
  const target = input.target
  if (target === 'control' || target === 'admission' || target === 'preload' || target === 'patch.yml') {
    return deny('memory-cannot-enter-control', { target })
  }

  const grantDeny = grantGate(input.attestor)
  if (grantDeny && (input.admit === true || input.escalate === true)) return grantDeny

  const content = typeof input.content === 'string' ? input.content : extractContent(input.value)
  if (typeof content !== 'string' || content.length === 0) {
    return deny('no-identity', { field: 'content' })
  }

  const source = typeof input.source === 'string' ? input.source : undefined
  const channel = toF2Channel(input.channel) ?? (source ? channelFromSource(source) : undefined)
  const claim = toF2Channel(input.claim) ?? channel
  if (claim === undefined || channel === undefined) {
    return deny('no-identity', { field: 'provenance', claim: input.claim ?? null, channel: input.channel ?? null })
  }

  const effective = effectiveTier(claim, channel)
  if (effective === undefined) return deny('no-identity', { field: 'effective' })

  const claimRank = rankOf(claim)
  const channelRank = rankOf(channel)
  const masquerade = claimRank > channelRank

  const facet = typeof input.facet === 'string' ? input.facet : undefined
  const derived = facet ? phaseOf(facet) : undefined
  const requested = typeof input.phase === 'string' ? input.phase : derived
  if (!PHASES.has(requested)) return deny('phase-unknown', { phase: requested ?? null })
  if (derived && requested !== derived) {
    return deny('phase-mismatch', { phase: requested, facet, expected: derived })
  }

  const trust = toPackATrust(effective)
  if (trust === undefined) return deny('provenance-policy', { effective })

  if (typeof input.trust === 'string') {
    const asked = input.trust === 'host' ? 'system' : input.trust
    if (rankOf(asked) === undefined) return deny('provenance-policy', { trust: input.trust })
    if (rankOf(asked) > rankOf(effective)) {
      return deny('phase-masquerade', { trust: input.trust, effective })
    }
  }

  const state = initialStateFor(trust)
  if (input.admit === true) {
    const grantDenyAdmit = grantGate(input.attestor)
    if (grantDenyAdmit) return grantDenyAdmit
    if (!attestorCanGrant(input.attestor)) {
      return deny('reviewer-policy', { attestor: attestorKind(input.attestor) ?? null })
    }
    if (masquerade) return deny('phase-masquerade', { claim, channel, effective })
    if (state !== 'admitted') return deny('provenance-policy', { trust, state, effective })
  }

  const sealed = {
    decision: 'allow',
    reason: null,
    side_effect: false,
    control: false,
    graph_mutated: false,
    wrote_patch_yml: false,
    activated_preload: false,
    content,
    phase: requested,
    provenance: { claim, channel, effective },
    trust,
    state,
    masquerade,
    source: source ?? null,
    attestor: attestorKind(input.attestor) ?? null
  }
  sealed.hash = hashPackage(sealed)
  return deepFreeze(sealed)
}

/**
 * Recompute the integrity hash. Any tamper (content, phase, provenance,
 * trust, state, hash) → false.
 */
export function verifyPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false
  if (typeof pkg.hash !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.hash)) return false
  if (pkg.decision !== 'allow') return false
  return hashPackage(pkg) === pkg.hash
}

/**
 * Move a sealed package between phases.
 *
 * Demotion (profile → log → note) is always allowed and keeps provenance.
 * Escalation requires a host/user attestor. Atena / Janice cannot grant.
 * Destination `control` is always denied. Escalating untrusted into profile
 * as admitted is denied; the package may land quarantined when `admit` is off.
 *
 * @param {object} pkg - a previously sealed allow-package
 * @param {object} request - `{ toPhase, attestor?, admit? }`
 */
export function advancePhase(pkg, request = {}) {
  if (!verifyPackage(pkg)) return deny('integrity')
  const toPhase = request.toPhase
  if (toPhase === 'control' || toPhase === 'admission' || toPhase === 'preload') {
    return deny('memory-cannot-enter-control', { target: toPhase })
  }
  if (!PHASES.has(toPhase)) return deny('phase-unknown', { phase: toPhase ?? null })

  const fromRank = PHASE_RANK[pkg.phase]
  const toRank = PHASE_RANK[toPhase]
  if (toRank > fromRank) {
    const grantDeny = grantGate(request.attestor)
    if (grantDeny) return grantDeny
    if (!attestorCanGrant(request.attestor)) {
      return deny('phase-escalation', { from: pkg.phase, to: toPhase, attestor: attestorKind(request.attestor) ?? null })
    }
  }

  return packageMemory({
    content: pkg.content,
    claim: pkg.provenance.claim,
    channel: pkg.provenance.channel,
    phase: toPhase,
    attestor: request.attestor,
    admit: request.admit === true,
    source: pkg.source ?? undefined
  })
}

/**
 * Memory packages must never enter the session admission graph, activate
 * preload, or add patch.yml rows. Always deny, zero side-effect.
 */
export function proposeControl(pkg = {}, action = 'enter-graph') {
  return deny('memory-cannot-enter-control', {
    action,
    phase: pkg.phase ?? null,
    effective: pkg.provenance?.effective ?? null
  })
}

/**
 * Roles table — Janice is runtime; Atena never grants. Exported so tests
 * and the F1 naming gate can pin the contract without reading comments.
 */
export function packagerRoles() {
  return PACKAGER_ROLES
}

/** F2 labels in rank order (index = ordinal). */
export function packagerTrustLabels() {
  return F2_LABELS
}
