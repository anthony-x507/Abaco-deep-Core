/**
 * `abaco-compaction` — Principle C + Principle D wrappers around the stock
 * engine, mounted *inside* the preset's compaction isolate group.
 *
 * This is not a second `compaction` service (that throw takes the tree down).
 * It injects the live `compaction` and `toolResultPruner` instances and wraps
 * the methods `compactIfNeeded` already calls:
 *
 * - `toolResultPruner.pruneSession` — skip `isError === true` (Principle D)
 * - `compaction.summarize` — errors out of the corpus, `ERROR | tool | raw`
 *   back on the checkpoint (Principle D, overflow path)
 * - `compaction.compactIfNeeded` — first-ask via `ctx.approval`, anti-loop
 *   flag in Layer 2 session meta, persist profile/log before a granted run
 *   (Principle C + write protocol)
 *
 * `apply` is synchronous and returns nothing. A throw here would fail the
 * isolate group and disable compaction entirely, so every wrap is best-effort.
 *
 * @module abaco-context/compaction
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyConsentOutcome, guardedCompactIfNeeded, probeCrossing, REJECT_SOFT_WARN } from './lib/consent.js'
import { summarizeWithLiteralErrors } from './lib/literal-errors.js'
import { wrapPruner } from './lib/pruner-guard.js'
import { appendContextLog } from './lib/telemetry-line.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'abaco-compaction'

/**
 * The two isolated services this row wraps. `approval` is host-plane and is
 * reached by a guarded read — declaring it here would fail the row in a
 * composition that has no answerer, which is exactly the headless case that
 * must still degrade to "do not compact".
 */
export const inject = ['compaction', 'toolResultPruner']

/** Synthetic tool name the approval UI attaches the prompt to. */
export const COMPACTION_APPROVAL_TOOL = 'abaco_compact'

/** Why the first ask is happening — shown by the composed answerer. */
export const COMPACTION_APPROVAL_REASON =
  'First compaction of this session. At 90% of the model window the older span will be summarized and the last 12% kept verbatim. Accept to allow automatic compaction for the rest of this session. Decline keeps the full detail this time; you will be asked again only the next time usage crosses 90%.'

/**
 * Cordis body. Synchronous, returns nothing.
 *
 * @param ctx - the isolate-group context (`compaction` + `toolResultPruner`).
 */
export function apply(ctx) {
  try {
    const pruner = ctx.toolResultPruner
    if (pruner !== null && typeof pruner === 'object') wrapPruner(pruner)
  } catch (error) {
    warnQuietly(ctx, `abaco-compaction: could not wrap the pruner: ${describe(error)}`)
  }
  try {
    const engine = ctx.compaction
    if (engine !== null && typeof engine === 'object') wrapEngine(engine, ctx)
  } catch (error) {
    warnQuietly(ctx, `abaco-compaction: could not wrap the compaction engine: ${describe(error)}`)
  }
}

/**
 * Wrap `compactIfNeeded` and `summarize` on the live engine instance.
 *
 * @param engine - `BasicCompactionEngine` (or a subclass).
 * @param ctx - the isolate-group context, for approval and logging.
 * @returns the same engine.
 */
export function wrapEngine(engine, ctx) {
  if (typeof engine.compactIfNeeded === 'function') {
    const original = engine.compactIfNeeded.bind(engine)
    engine.compactIfNeeded = async function compactIfNeeded(agent, trigger, signal) {
      return guardedCompactIfNeeded({
        compact: original,
        agent,
        trigger,
        signal,
        hooks: compactionHooks(engine, ctx)
      })
    }
  }
  if (typeof engine.summarize === 'function') {
    const original = engine.summarize.bind(engine)
    engine.summarize = async function summarize(input, agent, signal) {
      return summarizeWithLiteralErrors(original, input, agent, signal)
    }
  }
  return engine
}

/** Hooks the state machine needs, bound to this process's services. */
function compactionHooks(engine, ctx) {
  return {
    probe: (agent, trigger) => probeCrossing(engine, agent, trigger),
    ask: (agent, signal) => askCompact(ctx, agent, signal),
    readConsent: (agent) => readConsentFor(agent),
    writeConsent: (agent, consent) => writeConsentFor(agent, consent),
    persistBeforeCompact: (agent) => persistBeforeCompactFor(agent),
    warn: (message) => warnQuietly(ctx, message),
    telemetry: (record) => {
      appendContextLog({
        ...record,
        thresholdRatio: engine?.config?.thresholdRatio ?? 0.9,
        retainRatio: engine?.config?.retainRatio ?? 0.12
      }).catch(() => {})
    }
  }
}

/**
 * Ask `ctx.approval`. Fail closed: a missing answerer, a throw, or a
 * non-grant is a decline. That is Principle C, not a retry loop.
 *
 * @param ctx - isolate-group context (approval is inherited from the host).
 * @param agent - the agent whose session is about to compact.
 * @param signal - live turn cancellation.
 * @returns an approval outcome.
 */
export async function askCompact(ctx, agent, signal) {
  const approval = tryService(ctx, 'approval')
  if (approval === undefined || typeof approval.request !== 'function') return 'unavailable'
  try {
    return await approval.request({
      agent,
      toolName: COMPACTION_APPROVAL_TOOL,
      reason: COMPACTION_APPROVAL_REASON,
      signal
    })
  } catch (error) {
    warnQuietly(ctx, `abaco-compaction: approval.request failed: ${describe(error)}`)
    return 'unavailable'
  }
}

/** Read the session consent flag from Layer 2. */
async function readConsentFor(agent) {
  const memory = await loadMemory()
  if (memory === undefined) return { state: 'unset', armed: true }
  const store = await storeFor(memory, agent)
  if (store === undefined || typeof store.readConsent !== 'function') return { state: 'unset', armed: true }
  return store.readConsent(ambientOf(agent))
}

/** Persist the session consent flag. */
async function writeConsentFor(agent, consent) {
  const memory = await loadMemory()
  if (memory === undefined) return consent
  const store = await storeFor(memory, agent)
  if (store === undefined || typeof store.writeConsent !== 'function') return consent
  return store.writeConsent(ambientOf(agent), consent)
}

/** Flush profile/log and journal a pre-compact audit line. */
async function persistBeforeCompactFor(agent) {
  const memory = await loadMemory()
  if (memory === undefined) return
  const store = await storeFor(memory, agent)
  if (store === undefined || typeof store.persistBeforeCompact !== 'function') return
  await store.persistBeforeCompact(ambientOf(agent), 'pre-compact')
}

async function storeFor(memory, agent) {
  try {
    const root = memoryRoot()
    const store = new memory.MemoryStore({ root })
    await store.load()
    return store
  } catch {
    return undefined
  }
}

function ambientOf(agent) {
  const header = agent?.session?.header
  return {
    cwd: typeof header?.cwd === 'string' ? header.cwd : undefined,
    sessionId: typeof header?.id === 'string' ? header.id : sessionIdOf(agent),
    agentPreset: typeof header?.agentPreset === 'string' ? header.agentPreset : undefined
  }
}

function sessionIdOf(agent) {
  const id = agent?.session?.header?.id ?? agent?.session?.id
  return typeof id === 'string' ? id : undefined
}

function memoryRoot() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const trimmed = fromEnv.trim()
    const home = trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : resolve(trimmed)
    return join(home, 'abaco-memory')
  }
  return join(homedir(), '.dsh', 'abaco-memory')
}

async function loadMemory() {
  try {
    return await import('abaco-memory')
  } catch {
    return undefined
  }
}

function tryService(ctx, name) {
  try {
    const value = ctx?.[name]
    return value === null || value === undefined ? undefined : value
  } catch {
    return undefined
  }
}

function warnQuietly(ctx, message) {
  try {
    ctx?.logger?.warn?.(message)
  } catch {
    // A logger that throws must not be able to fail the wrap.
  }
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

export { applyConsentOutcome, REJECT_SOFT_WARN }
