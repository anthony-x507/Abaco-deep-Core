/**
 * F2-W5 · threat model for the 3-phase memory (profile/log/note).
 *
 * The memory layer is the highest-value target in the harness: anything that
 * lands in `profile` is re-injected into the system prompt on EVERY request and
 * survives compaction. The red team's finding ("inyección indirecta→RCE" and
 * specifically "memoria 3-fases necesita threat model propio") is implemented
 * here as three deterministic mechanisms:
 *
 *   1. Per-fact provenance  — every fact carries { claim, channel, effective }
 *      with `effective = min(claim, channel)` on the frozen trust ordinal
 *      (same rule as F1-P2, now reusable; coherent with W3 provenance.js).
 *   2. Profile quarantine  — every new fact is born `quarantined`; `readProfile`
 *      NEVER exposes quarantined facts. Promotion requires a verified
 *      provenance (effective >= user) AND a valid reviewer (trust >= guardian).
 *   3. Hash-chained log    — append-only journal; `verifyChain()` detects any
 *      tampering with entries, linkage or ordering.
 *
 * OPEN DECISION (Anthony, pending): memory opt-in vs. on-by-default. This
 * module ships the SAFE default (quarantine ON). The final default is NOT
 * decided here — see THREAT-MODEL.md and reports/worker-memoria.md.
 *
 * ESM. Zero external dependencies. Hash via node:crypto (built-in).
 * No npm, no network, no filesystem. Pure in-memory; wiring into the real
 * MemoryStore/tools is an integration step and is deliberately NOT done here.
 *
 * @module threat-model
 */

import { createHash } from 'node:crypto'

/** Frozen trust ordinal — identical to F2-CONTRACT §Vocabulario compartido. */
export const TRUST_ORDINAL = Object.freeze({
  system: 5,
  developer: 4,
  guardian: 3,
  user: 2,
  'plugin-data': 1,
  untrusted: 0
})

/** A fact may only be admitted when its EFFECTIVE provenance is at least this. */
export const MIN_ADMIT_TIER = 'user'

/** A reviewer may only promote facts when their trust is at least this. */
export const MIN_REVIEWER_TIER = 'guardian'

/** prevHash of the first log entry. */
export const GENESIS = 'GENESIS'

/* ── internal state ─────────────────────────────────────────────── */

const chain = []   // append-only hash chain (log entries)
const profile = [] // admitted facts only — readProfile()'s entire world

/* ── helpers ────────────────────────────────────────────────────── */

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Canonical JSON with sorted keys, so identical facts hash identically. */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`
}

/** Ordinal of a tier name, or undefined when unknown. */
function ordinalOf(tier) {
  const v = TRUST_ORDINAL[tier]
  return typeof v === 'number' ? v : undefined
}

/**
 * effective = min(claim, channel) on the trust ordinal.
 * A plugin that CLAIMS 'user' while arriving on a 'plugin-data' channel
 * gets effective='plugin-data' — the red-team masquerade collapses here.
 */
export function effectiveTier(claim, channel) {
  const c = ordinalOf(claim)
  const h = ordinalOf(channel)
  if (c === undefined || h === undefined) return undefined
  return c <= h ? claim : channel
}

/** Identity fields covered by fact.hash. reviewHistory is audit metadata, not identity. */
function hashFact(fact) {
  return sha256Hex(canonicalize({
    content: fact.content,
    provenance: {
      claim: fact.provenance.claim,
      channel: fact.provenance.channel,
      effective: fact.provenance.effective
    },
    state: fact.state,
    createdAt: fact.createdAt,
    admittedBy: fact.admittedBy === undefined ? null : fact.admittedBy,
    admittedAt: fact.admittedAt === undefined ? null : fact.admittedAt
  }))
}

function rejection(code, message) {
  const error = new Error(`threat-model: ${message}`)
  error.code = code
  return error
}

/** Throws when the fact is malformed or its hash does not match (tampered fact). */
function assertFactIntegrity(fact) {
  if (fact === null || typeof fact !== 'object') {
    throw rejection('MALFORMED_FACT', 'fact must be an object')
  }
  if (typeof fact.content !== 'string' || typeof fact.hash !== 'string') {
    throw rejection('MALFORMED_FACT', 'fact must carry content and hash')
  }
  const p = fact.provenance
  if (p === null || typeof p !== 'object' || ordinalOf(p.claim) === undefined || ordinalOf(p.channel) === undefined) {
    throw rejection('MALFORMED_FACT', 'fact must carry a provenance with known claim and channel tiers')
  }
  if (hashFact(fact) !== fact.hash) {
    throw rejection('INTEGRITY', 'fact hash mismatch — the fact was modified after creation')
  }
}

function assertReviewer(reviewer) {
  if (reviewer === null || typeof reviewer !== 'object') {
    throw rejection('REVIEWER_POLICY', 'reviewer must be an object { id, trust }')
  }
  if (typeof reviewer.id !== 'string' || reviewer.id.trim().length === 0) {
    throw rejection('REVIEWER_POLICY', 'reviewer.id must be a non-empty string')
  }
  const t = ordinalOf(reviewer.trust)
  if (t === undefined) {
    throw rejection('REVIEWER_POLICY', `unknown reviewer trust tier '${reviewer.trust}'`)
  }
  if (t < ordinalOf(MIN_REVIEWER_TIER)) {
    throw rejection(
      'REVIEWER_POLICY',
      `reviewer trust '${reviewer.trust}' is below the minimum '${MIN_REVIEWER_TIER}'`
    )
  }
}

/* ── public API ─────────────────────────────────────────────────── */

/**
 * Create a new fact. EVERY fact is born quarantined — nothing reaches the
 * profile without an explicit, policy-checked admission.
 *
 * @param {{content:string, provenance:{claim:string, channel:string}}} input
 * @returns {{content, provenance:{claim,channel,effective}, hash, state:'quarantined', createdAt, reviewHistory:[]}}
 */
export function makeFact({ content, provenance } = {}) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('threat-model: content must be a non-empty string')
  }
  const claim = provenance?.claim
  const channel = provenance?.channel
  if (ordinalOf(claim) === undefined || ordinalOf(channel) === undefined) {
    throw new Error('threat-model: provenance must declare known claim and channel tiers')
  }
  const fact = {
    content,
    provenance: { claim, channel, effective: effectiveTier(claim, channel) },
    state: 'quarantined',
    createdAt: new Date().toISOString(),
    reviewHistory: []
  }
  fact.hash = hashFact(fact)
  return fact
}

/**
 * Promote a quarantined fact to the profile.
 *
 * Rejects (throws, with error.code) when:
 *   - the fact fails integrity (hash mismatch / malformed)      → INTEGRITY / MALFORMED_FACT
 *   - the fact is not quarantined (double admission)            → STATE_POLICY
 *   - claim outranks the verified channel (masquerade)          → MASQUERADE
 *   - effective provenance is below 'user'                     → PROVENANCE_POLICY
 *   - the reviewer is invalid or below 'guardian'               → REVIEWER_POLICY
 *
 * Returns a NEW fact object with state 'admitted' (the input is untouched);
 * the admitted fact is registered in the profile readable via readProfile().
 */
export function admit(fact, reviewer) {
  assertFactIntegrity(fact)
  if (fact.state !== 'quarantined') {
    throw rejection('STATE_POLICY', `only quarantined facts can be admitted (state='${fact.state}')`)
  }
  const { claim, channel, effective } = fact.provenance
  if (ordinalOf(claim) > ordinalOf(channel)) {
    throw rejection(
      'MASQUERADE',
      `claim '${claim}' outranks verified channel '${channel}' — provenance masquerade`
    )
  }
  if (ordinalOf(effective) < ordinalOf(MIN_ADMIT_TIER)) {
    throw rejection(
      'PROVENANCE_POLICY',
      `effective provenance '${effective}' is below the minimum '${MIN_ADMIT_TIER}'`
    )
  }
  assertReviewer(reviewer)

  const admittedAt = new Date().toISOString()
  const admitted = {
    content: fact.content,
    provenance: { ...fact.provenance },
    state: 'admitted',
    createdAt: fact.createdAt,
    admittedBy: reviewer.id,
    admittedAt,
    reviewHistory: [
      ...fact.reviewHistory,
      { action: 'admitted', reviewer: reviewer.id, reviewerTrust: reviewer.trust, at: admittedAt }
    ]
  }
  admitted.hash = hashFact(admitted)
  profile.push(admitted)
  return admitted
}

/**
 * Append a fact to the hash-chained, append-only log.
 * Entries are { seq, factHash, prevHash, entryHash, recordedAt };
 * there is intentionally no delete or edit API.
 */
export function appendToLog(fact) {
  assertFactIntegrity(fact)
  const prevHash = chain.length === 0 ? GENESIS : chain[chain.length - 1].entryHash
  const seq = chain.length
  const recordedAt = new Date().toISOString()
  const entryHash = sha256Hex([seq, fact.hash, prevHash, recordedAt].join('|'))
  const entry = { seq, factHash: fact.hash, prevHash, entryHash, recordedAt }
  chain.push(entry)
  return { ...entry }
}

/**
 * Verify the whole hash chain: sequence continuity, prevHash linkage back to
 * GENESIS, and entry-hash integrity. Returns false on ANY tampering.
 */
export function verifyChain() {
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]
    if (entry.seq !== i) return false
    const expectedPrev = i === 0 ? GENESIS : chain[i - 1].entryHash
    if (entry.prevHash !== expectedPrev) return false
    const recomputed = sha256Hex([entry.seq, entry.factHash, entry.prevHash, entry.recordedAt].join('|'))
    if (recomputed !== entry.entryHash) return false
  }
  return true
}

/**
 * Read the profile. ONLY admitted facts are ever exposed — quarantined facts
 * are invisible here by construction. Returns deep copies.
 */
export function readProfile() {
  return profile.map((fact) => JSON.parse(JSON.stringify(fact)))
}

/** Read-only view of the log (deep copies), for inspection and audit. */
export function inspectLog() {
  return chain.map((entry) => ({ ...entry }))
}

/**
 * Attack simulator for tests: hand the LIVE chain to a mutator, emulating an
 * attacker with write access to the journal. verifyChain() must then fail.
 */
export function tamperForTests(mutator) {
  if (typeof mutator !== 'function') throw new Error('threat-model: mutator must be a function')
  mutator(chain)
  return chain.length
}

/** Clear the chain and the profile. Test-only. */
export function resetForTests() {
  chain.length = 0
  profile.length = 0
}
