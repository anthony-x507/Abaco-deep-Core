/**
 * Config resolution for `abaco-observability`.
 *
 * ## Why nothing here may throw during mount
 *
 * Cordis collects a plugin body's return value as an *effect* and treats a
 * throw while **resolving a row's config** as FATAL: it fails the plugin, and
 * failing one row takes down the whole plugin tree, which is exactly how the
 * product reached Safe Mode before (`docs/HANDOFF-FASE5.md` §2, §7.3). So the
 * one job of this module is to never let a malformed config reach the engine.
 *
 * The strategy is deliberately boring: `resolveObservabilityConfig` returns a
 * frozen result on **every** path, and the object it returns always carries a
 * `valid` flag plus a list of human-readable reasons. A row whose config is
 * nonsense does not lose its telemetry — it runs with the production defaults
 * and reports the nonsense in its first log line. `invalidConfigError` exists
 * only so tests can prove the validation table is real; production code never
 * calls it.
 *
 * @module abaco-observability/lib/config
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory created under the harness home. */
export const LOG_DIR_NAME = 'logs'

/** File name of the append-only telemetry stream. */
export const LOG_FILE_NAME = 'abaco-context.jsonl'

/**
 * Default byte ceiling for the "large tool result" signal.
 *
 * 12000 is not invented: it is the value the ABACO composition gives the stock
 * spill policy (`build/dsh-desktop.patch.yml`, row `spill-policy` →
 * `maxInlineBytes: 12000`), and it is the live default in the installed
 * profile's composed config. A result above it is exactly the one the spill
 * policy is asked to lift out of the window, so it is the right bar for
 * counting candidates.
 */
export const DEFAULT_MAX_INLINE_BYTES = 12000

/**
 * The agent preset the composition installs and selects. Read only so the
 * self-check can say which policy document it inspected; the value the engine
 * actually runs is the roster's, not this one.
 */
export const DEFAULT_PRESET_ID = 'abaco'

/** Turn each option must be one of, or config resolution fails. */
const BOOLEAN_KEYS = ['enabled', 'recordPrune', 'recordToolResults', 'trackDegradation', 'asyncWrites']

/** Every integer option, with its floor. */
const INTEGER_KEYS = [
  ['maxInlineBytes', 0],
  ['maxSessionsTracked', 1],
  ['maxAttemptsPerSession', 1],
  ['maxReadCallsPerSession', 1]
]

/** Options that must be non-empty strings when present. */
const STRING_KEYS = ['home', 'logFile', 'presetId']

/** Expand a leading `~` so a hand-written config path behaves like a shell path. */
export function expandTilde(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home the same way the other ABACO host plugins do: an
 * explicit `home` in the row, then `$DSH_HOME`, then `~/.dsh`.
 *
 * The shell sets `DSH_HOME = <userData>/harness` for every harness child, so a
 * packaged app lands in
 * `~/Library/Application Support/abaco-deep-core/harness` — the ABACO profile.
 * Note that this is a *different* directory from
 * `~/Library/Application Support/dsh-desktop/harness`, the DeepSeek app's own
 * profile, and confusing the two is the mistake that produced three false
 * audits (`docs/HANDOFF-FASE5.md` §7.1).
 *
 * @param configured - the row's `home`, when it set one.
 * @param env - environment to read `DSH_HOME` from.
 * @param fallback - the home directory used when neither is present.
 * @returns an absolute path.
 */
export function resolveDshHome(configured, env = process.env, fallback = homedir()) {
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return resolve(expandTilde(configured.trim()))
  }
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(expandTilde(fromEnv.trim()))
  }
  return join(fallback, '.dsh')
}

/** The JSONL path for a resolved harness home. */
export function logPath(dshHome) {
  return join(dshHome, LOG_DIR_NAME, LOG_FILE_NAME)
}

/**
 * Resolve one row's config.
 *
 * @param raw - the row's `config` block, or `undefined`.
 * @param env - environment used for the `DSH_HOME` fallback.
 * @returns a frozen `{ valid, reasons, enabled, logPath, maxInlineBytes, … }`.
 *   Never throws: see the module note.
 */
export function resolveObservabilityConfig(raw, env = process.env) {
  const reasons = []
  const input = raw === null || typeof raw !== 'object' || Array.isArray(raw) ? {} : raw
  if (input !== raw && raw !== undefined) reasons.push('config is not a plain object; using defaults')

  for (const key of BOOLEAN_KEYS) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      reasons.push(`"${key}" must be a boolean (got ${describe(input[key])}); using the default`)
    }
  }
  for (const [key, floor] of INTEGER_KEYS) {
    const value = input[key]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < floor) {
      reasons.push(`"${key}" must be an integer >= ${String(floor)} (got ${describe(value)}); using the default`)
    }
  }
  if (input.home !== undefined && (typeof input.home !== 'string' || input.home.trim().length === 0)) {
    reasons.push(`"home" must be a non-empty string (got ${describe(input.home)}); falling back to $DSH_HOME`)
  }
  for (const key of STRING_KEYS) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].trim().length === 0)) {
      reasons.push(`"${key}" must be a non-empty string (got ${describe(input[key])}); using the default`)
    }
  }

  const bool = (key, fallback) => (typeof input[key] === 'boolean' ? input[key] : fallback)
  const int = (key, fallback) => {
    const value = input[key]
    return Number.isInteger(value) && value >= (INTEGER_KEYS.find(([k]) => k === key)?.[1] ?? 0) ? value : fallback
  }

  const dshHome = resolveDshHome(typeof input.home === 'string' ? input.home : undefined, env)
  const file = typeof input.logFile === 'string' && input.logFile.trim().length > 0 ? input.logFile.trim() : LOG_FILE_NAME

  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze(reasons),
    enabled: bool('enabled', true),
    dshHome,
    presetId: typeof input.presetId === 'string' && input.presetId.trim().length > 0 ? input.presetId.trim() : DEFAULT_PRESET_ID,
    logPath: join(dshHome, LOG_DIR_NAME, file),
    maxInlineBytes: int('maxInlineBytes', DEFAULT_MAX_INLINE_BYTES),
    maxSessionsTracked: int('maxSessionsTracked', 64),
    maxAttemptsPerSession: int('maxAttemptsPerSession', 64),
    maxReadCallsPerSession: int('maxReadCallsPerSession', 32),
    recordPrune: bool('recordPrune', true),
    recordToolResults: bool('recordToolResults', true),
    trackDegradation: bool('trackDegradation', true),
    // Synchronous by default: a record is on disk when `write()` returns, which
    // is what makes the evidence survive the crash it is meant to explain. See
    // the note in `./log.js` — this is a handful of writes per hour, not a hot
    // path, and the alternative silently loses the compactions that end badly.
    asyncWrites: bool('asyncWrites', false)
  })
}

/**
 * Build the error that *would* describe an invalid config.
 *
 * This module deliberately does not throw it. It exists so the validation
 * table above is load-bearing and testable rather than decorative: a test can
 * assert that a bad config is both rejected here and absorbed by
 * `resolveObservabilityConfig`.
 *
 * @param resolved - a result from {@link resolveObservabilityConfig}.
 * @returns an `Error`, or `undefined` when the config was valid.
 */
export function invalidConfigError(resolved) {
  if (resolved.valid) return undefined
  return new Error(`ObservabilityConfig: ${resolved.reasons.join('; ')}`)
}

/** Render an unknown value for a diagnostic message without throwing on symbols. */
function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `${typeof value} ${String(value)}`
}
