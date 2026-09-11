/**
 * Best-effort spill lines into `$DSH_HOME/logs/abaco-context.jsonl`.
 *
 * Duplicates the tiny append used by `abaco-context/lib/telemetry-line.js` so
 * this package does not depend on Layer 1. A failure here is never a reason to
 * keep (or drop) the settlement inline.
 *
 * @module abaco-vault/lib/telemetry
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Directory under the harness home. */
const LOG_DIR_NAME = 'logs'

/** File name of the Phase-0 stream. */
const LOG_FILE_NAME = 'abaco-context.jsonl'

function resolveTelemetryHome(env = process.env) {
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const trimmed = fromEnv.trim()
    if (trimmed === '~') return homedir()
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2))
    return resolve(trimmed)
  }
  return join(homedir(), '.dsh')
}

/** Absolute path of the JSONL stream. */
export function contextLogPath(env = process.env) {
  return join(resolveTelemetryHome(env), LOG_DIR_NAME, LOG_FILE_NAME)
}

/**
 * Append one spill record. Never throws.
 *
 * @param record - a JSON-serializable object.
 * @param env - environment used to resolve `$DSH_HOME`.
 * @returns whether the line was written.
 */
export async function emitSpill(record, env = process.env) {
  try {
    if (record === null || typeof record !== 'object') return false
    const line = JSON.stringify({ ts: new Date().toISOString(), event: 'spill', ...record })
    if (line.includes('\n')) return false
    const file = contextLogPath(env)
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    return true
  } catch {
    return false
  }
}
