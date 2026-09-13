/**
 * F2.1 quarantine policy for the ABACO durable memory (Layer 2).
 *
 * ## What it is
 *
 * The mechanical, LLM-free half of the memory trust model: every entry carries
 * a `trust` tier and a quarantine `state`, both assigned deterministically at
 * write time. Entries whose provenance cannot be attributed to the host or the
 * user (`plugin-data`, `untrusted`) are born `quarantined` and stay invisible
 * to reads until a trusted reviewer promotes them with
 * {@link MemoryStore.promote}.
 *
 * The rules here are deliberately small and total — no heuristics, no model
 * calls, no judgment — so they can be audited by reading this one file:
 *
 * 1. `trustOf` maps a validated `source` to its tier. The mapping is fixed;
 *    anything outside it maps to `undefined`, which the store refuses
 *    (fail-closed).
 * 2. `assertTrust` admits only the four tiers of {@link MEMORY_TRUST}.
 * 3. `reviewerCanPromote` is a membership test, not a judgment: only `host`
 *    and `user` reviewers promote.
 * 4. `initialStateFor` quarantines everything the host and the user did not
 *    say.
 *
 * This module imports {@link MemorySchemaError} from `./schema.js` and is
 * imported by `./store.js`; it must never import `./store.js` back.
 *
 * @module abaco-memory/lib/quarantine
 */

import { MemorySchemaError } from './schema.js'

/**
 * The four trust tiers a memory entry can carry.
 *
 * - `host` — the harness/agent plane (`agent:*`, `subagent:*`).
 * - `user` — the user, verbatim (`user:*`).
 * - `plugin-data` — data that arrived through a plugin channel (`plugin:*`).
 * - `untrusted` — tool output (`tool:*`); true until a reviewer says otherwise.
 */
export const MEMORY_TRUST = Object.freeze(['host', 'user', 'plugin-data', 'untrusted'])

/** The two lifecycle states of a collection entry under quarantine. */
export const QUARANTINE_STATES = Object.freeze(['admitted', 'quarantined'])

/**
 * Map a validated memory `source` to its trust tier.
 *
 * The mapping is mechanical and closed: the source vocabulary is already
 * validated by `assertSource` (schema.js), so this function only classifies.
 *
 * @param source - a validated provenance like `user:turn-3` or `tool:read`.
 * @returns the tier, or `undefined` when the source maps to nothing.
 */
export function trustOf(source) {
  if (typeof source !== 'string') return undefined
  const head = source.split(':')[0]
  switch (head) {
    case 'user':
      return 'user'
    case 'agent':
    case 'subagent':
      return 'host'
    case 'tool':
      return 'untrusted'
    case 'plugin':
      return 'plugin-data'
    default:
      return undefined
  }
}

/**
 * Validate a caller-supplied trust tier.
 *
 * @param trust - the candidate tier.
 * @returns the tier, unchanged.
 * @throws {MemorySchemaError} with code `MEMORY_NO_TRUST` for anything off-vocabulary.
 */
export function assertTrust(trust) {
  if (typeof trust !== 'string' || !MEMORY_TRUST.includes(trust)) {
    throw new MemorySchemaError(
      `memory trust must be one of ${MEMORY_TRUST.join(', ')}. Received ${JSON.stringify(trust ?? null)}.`,
      'MEMORY_NO_TRUST'
    )
  }
  return trust
}

/**
 * Whether a reviewer may promote a quarantined entry.
 *
 * A mechanical policy, not a judgment: the reviewer's *tier* decides, never a
 * model. Only `host` and `user` reviewers promote — a plugin or a tool can
 * never promote its own data.
 *
 * @param reviewer - `{ id: string, trust: string }`.
 * @returns true only when the reviewer's tier is `host` or `user`.
 */
export function reviewerCanPromote(reviewer) {
  if (reviewer === null || typeof reviewer !== 'object') return false
  return reviewer.trust === 'host' || reviewer.trust === 'user'
}

/**
 * The initial quarantine state for a trust tier.
 *
 * @param trust - one of {@link MEMORY_TRUST}.
 * @returns `admitted` for `host`/`user`, `quarantined` for everything else.
 */
export function initialStateFor(trust) {
  return trust === 'host' || trust === 'user' ? 'admitted' : 'quarantined'
}

/**
 * Whether an entry is currently quarantined.
 *
 * Entries written before F2.1 carry no `state` and read as admitted, so the
 * quarantine rollout never hides the user's existing memory.
 *
 * @param entry - the entry to inspect.
 * @returns true only when `entry.state === 'quarantined'`.
 */
export function isQuarantined(entry) {
  return entry?.state === 'quarantined'
}
