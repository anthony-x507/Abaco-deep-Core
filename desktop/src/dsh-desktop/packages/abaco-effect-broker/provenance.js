/**
 * provenance.js — F2-W3 · reusable provenance module.
 *
 * claim → channel → effective provenance with integrity hash, plus an
 * append-only audit log with hash chaining (INV-AUDIT-CHAIN).
 *
 * RULE (same as F1-P2, now reusable): effective = min(claim, channel) by
 * trust ordinal. The channel is what the *broker* vouches for; a caller can
 * never upgrade its own data by claiming a higher label.
 *
 * ESM. Zero external dependencies. Hash = sha256 via node:crypto (built-in).
 * Deterministic canonicalization: object keys sorted recursively so the same
 * record always hashes the same, regardless of key insertion order.
 */

import { createHash } from 'node:crypto'

/** Frozen ordinal table (F2-CONTRACT §W3). Higher = more trusted. */
export const TRUST_ORDINAL = {
  system: 5,
  developer: 4,
  guardian: 3,
  user: 2,
  'plugin-data': 1,
  untrusted: 0,
}

/** Ordinal → label. Index by rank. */
const TRUST_LABELS = ['untrusted', 'plugin-data', 'user', 'guardian', 'developer', 'system']

/** Unknown/malformed labels fail closed at rank 0 (untrusted). */
function rankOf(label) {
  const r = TRUST_ORDINAL[label]
  return typeof r === 'number' ? r : 0
}

/** Recursively sort object keys → deterministic string for hashing. */
function canonicalize(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
}

function digestOf(obj) {
  return createHash('sha256').update(canonicalize(obj), 'utf8').digest('hex')
}

/**
 * tag({content, claim, channel}) -> { content, claim, channel, effective, hash }
 *
 * Binds a self-declared `claim` to the broker-vouched `channel`.
 * effective = the lower of the two ordinals. The hash covers
 * {content, claim, channel, effective} so any tamper breaks verify().
 */
export function tag({ content, claim, channel }) {
  const claimRank = rankOf(claim)
  const channelRank = rankOf(channel)
  const effectiveRank = Math.min(claimRank, channelRank)
  const record = {
    content,
    claim: typeof claim === 'string' ? claim : 'untrusted',
    channel: typeof channel === 'string' ? channel : 'untrusted',
    effective: TRUST_LABELS[effectiveRank],
  }
  record.hash = digestOf(record)
  return record
}

/**
 * verify(record) -> bool
 * Recomputes the hash over {content, claim, channel, effective} and compares.
 * Any tamper (content, hash, claim, channel, effective) → false.
 */
export function verify(record) {
  if (!record || typeof record !== 'object') return false
  if (typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash)) return false
  const { content, claim, channel, effective } = record
  const expected = digestOf({ content, claim, channel, effective })
  return expected === record.hash
}

/* ------------------------------------------------------------------ */
/* Audit log — append-only with hash chain                            */
/* ------------------------------------------------------------------ */

const GENESIS = 'GENESIS'
const auditLog = [] // in-memory append-only log; entries are sealed on write

/**
 * audit(entry) -> sealed audit record appended to the log.
 * Each record: { seq, entry, prevHash, hash } where
 *   hash = sha256(seq ‖ entry ‖ prevHash). Append-only: no update/delete API.
 */
export function audit(entry) {
  const prev = auditLog.length === 0 ? GENESIS : auditLog[auditLog.length - 1].hash
  const rec = {
    seq: auditLog.length,
    entry: canonicalize(entry) === 'null' ? entry : JSON.parse(canonicalize(entry)),
    prevHash: prev,
  }
  rec.hash = digestOf({ seq: rec.seq, entry: rec.entry, prevHash: rec.prevHash })
  // Append-only by design: this module exposes NO update/delete API for the log.
  auditLog.push(rec)
  return rec
}

/**
 * verifyAudit() -> bool
 * Re-validates the full chain: every record's hash recomputes, every
 * prevHash links to the previous record's hash, seqs are contiguous from 0.
 */
export function verifyAudit() {
  for (let i = 0; i < auditLog.length; i++) {
    const rec = auditLog[i]
    if (rec.seq !== i) return false
    const expectedPrev = i === 0 ? GENESIS : auditLog[i - 1].hash
    if (rec.prevHash !== expectedPrev) return false
    const expected = digestOf({ seq: rec.seq, entry: rec.entry, prevHash: rec.prevHash })
    if (rec.hash !== expected) return false
  }
  return true
}

/**
 * Test-only helper: resets the in-memory audit log so test files are
 * deterministic regardless of ordering. NOT part of the F2 §W3 interface;
 * production code never calls it.
 */
export function resetAuditForTests() {
  auditLog.length = 0
}

/* ------------------------------------------------------------------ */
/* On-disk effects.jsonl seal (Ola 2 / Bloque 2.A · INV-AUDIT-CHAIN)  */
/* Parity with in-memory audit(): each durable line carries            */
/* prev_hash + hash; verifyDurable* fail-closed.                       */
/* Wire form uses snake_case prev_hash; in-memory keeps prevHash.      */
/* ------------------------------------------------------------------ */

/** Genesis sentinel for durable effects.jsonl (same as in-memory). */
export const DURABLE_GENESIS = GENESIS

/** Normalize entry the same way audit() does. */
function normalizeEntry(entry) {
  return canonicalize(entry) === 'null' ? entry : JSON.parse(canonicalize(entry))
}

/**
 * sealDurableLine({ seq, entry, prev_hash }) -> sealed durable record.
 * hash = sha256(seq ‖ entry ‖ prev_hash). Does not mutate any log.
 */
export function sealDurableLine({ seq, entry, prev_hash }) {
  const rec = {
    seq: Number(seq),
    entry: normalizeEntry(entry),
    prev_hash: typeof prev_hash === 'string' ? prev_hash : DURABLE_GENESIS,
  }
  rec.hash = digestOf({ seq: rec.seq, entry: rec.entry, prev_hash: rec.prev_hash })
  return rec
}

/**
 * verifyDurableLine(record) -> bool
 * Recomputes hash over {seq, entry, prev_hash}. Tamper → false.
 */
export function verifyDurableLine(record) {
  if (!record || typeof record !== 'object') return false
  if (typeof record.hash !== 'string' || !/^[0-9a-f]{64}$/.test(record.hash)) return false
  if (typeof record.prev_hash !== 'string') return false
  if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq < 0) {
    return false
  }
  const expected = digestOf({
    seq: record.seq,
    entry: record.entry,
    prev_hash: record.prev_hash,
  })
  return expected === record.hash
}

/**
 * verifyDurableChain(records) -> bool (fail-closed)
 * Contiguous seq from 0, prev_hash links, each line verifies.
 * Empty chain is valid. Malformed / tampered → false (never throws).
 */
export function verifyDurableChain(records) {
  if (!Array.isArray(records)) return false
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!verifyDurableLine(rec)) return false
    if (rec.seq !== i) return false
    const expectedPrev = i === 0 ? DURABLE_GENESIS : records[i - 1].hash
    if (rec.prev_hash !== expectedPrev) return false
  }
  return true
}

/**
 * verifyDurableEffectsFile(text) -> bool
 * Parse JSONL text and verifyDurableChain. Bad JSON / tamper → false.
 */
export function verifyDurableEffectsFile(text) {
  if (typeof text !== 'string') return false
  const lines = text.split('\n').filter((l) => l.length > 0)
  const records = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line))
    } catch {
      return false
    }
  }
  return verifyDurableChain(records)
}

