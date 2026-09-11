/**
 * `abaco-memory` — Layer 2 (durable memory) of the ABACO DEEP HARNES 3-layer
 * context system.
 *
 * ## What this plugin is for
 *
 * The agent must come back tomorrow without re-asking. Chat history cannot do
 * that: it gets summarized, truncated and eventually dropped by the compaction
 * engine. So the things that must stay true — who the user is, how they want to
 * be answered, what was decided and why, where the project stands — are kept in
 * their own faceted sidecar store and **re-injected on every request** through a
 * system-prompt section. Compaction only ever rewrites `user/message` surfaces;
 * the system prompt travels in the `request/header` and is rebuilt from the
 * store on each assembly, so the memory is intact after N compactions by
 * construction, not by being carefully preserved.
 *
 * ## How the three pieces fit
 *
 * 1. {@link MemoryStore} (`./lib/store.js`) owns `<DSH_HOME>/abaco-memory/`:
 *    one JSON document per scope, atomic `tmp + rename` commits at `0600` under
 *    a cross-process writer lock, an append-only audit journal, and archival
 *    (never silent deletion) for anything that expires or exceeds a facet cap.
 * 2. {@link MemoryRenderer} (`./lib/render.js`) turns the snapshot into the
 *    `abaco:durable-memory` section text — a *function*, evaluated on every
 *    assembly with the agent in context
 *    (`dsh-system-prompt/lib/index.js:229-232,330`), exactly like the approval
 *    policy at `dsh-user-approval/lib/index.js:77-90`. It caches the block per
 *    session and drops the cache when the turn closes
 *    (`agent/turn-stopping`, `dsh-agent-loop/lib/index.js:570-575`), so a write
 *    made during a turn lands in the next turn's prompt instead of rewriting the
 *    header mid-task and invalidating the provider's prefix cache.
 * 3. The four `abaco_memory_*` tools (`./lib/tools.js`) are how the agent writes
 *    and reads it, registered through the harness's own `defineTool` DSL.
 *
 * ## Rules this plugin obeys
 *
 * - **Sidecar files only.** Memory is never written as a session event: the
 *   event vocabulary is closed (`assertEventsSupported`,
 *   `dsh-session-persistence/lib/index.js:1318-1323`) and `Session.append` has
 *   no `ignorable` channel, so an `abaco-memory/set` event would produce a log
 *   the harness refuses to reopen.
 * - **Only declared services.** `inject: ['tools', 'systemPrompt']`, and no
 *   property is ever assigned onto `ctx` — a plugin that writes `ctx.x = …`
 *   breaks the Cordis tree, which is why five `abaco-*` rows sit disabled in
 *   `build/dsh-desktop.patch.yml`.
 * - **Host plane.** This runs as a host-plane row so one store serves every
 *   agent and agent preset, and so `node:fs` is available (the model-facing
 *   `ctx.fs` seam is policy-jailed and must not be used for this).
 *
 * @module abaco-memory
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { MemoryRenderer } from './lib/render.js'
import { MEMORY_FACETS, MEMORY_MAX_ENTRY_CHARS, MEMORY_MAX_RENDER_CHARS, MEMORY_PHASES, MEMORY_SCOPE_BUDGETS, MEMORY_SECTION_NAME, MEMORY_SECTION_ORDER, facetsForPhase, phaseOf } from './lib/schema.js'
import { MemoryStore } from './lib/store.js'
import { ambientOf, assertParentProfileWrite, isSubagentHeader, registerMemoryTools, sourceOf } from './lib/tools.js'

/** Cordis plugin name used by loader diagnostics. */
const name = 'abaco-memory'

/**
 * The two services this half needs, and nothing else.
 *
 * The loader rejects an `inject` entry that is never read, so this list is also
 * a claim: the only members of `ctx` this plugin touches are
 * `ctx.tools.register`, `ctx.systemPrompt.section`, `ctx.on` and `ctx.logger`.
 */
const inject = ['tools', 'systemPrompt']

/** Directory created under the harness home. */
const MEMORY_DIR_NAME = 'abaco-memory'

/** How long a writer waits for the cross-process document lock. */
const DEFAULT_LOCK_WAIT_MS = 5000

/** How many documents per scope directory the boot scan loads. */
const DEFAULT_MAX_BOOT_DOCS = 200

/** Expand a leading `~`, mirroring `dsh-home-paths`' `expandHomePath`. */
function expandTilde(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the memory root.
 *
 * Precedence matches `resolveDshHome` (`dsh-home-paths/lib/index.js:73-84`):
 * an explicit `root`, then `$DSH_HOME`, then `~/.dsh`. The shell sets
 * `DSH_HOME = <userData>/harness` for every harness child, so a packaged app
 * stores memory at
 * `~/Library/Application Support/abaco-deep-core/harness/abaco-memory/`.
 *
 * @param config - the plugin's raw config.
 * @returns the absolute memory root.
 */
function resolveRoot(config) {
  if (typeof config.root === 'string' && config.root.trim().length > 0) {
    return resolve(expandTilde(config.root.trim()))
  }
  const fromEnv = process.env.DSH_HOME
  const home = typeof fromEnv === 'string' && fromEnv.trim().length > 0 ? resolve(expandTilde(fromEnv.trim())) : join(homedir(), '.dsh')
  return join(home, MEMORY_DIR_NAME)
}

/** A positive integer from config, or the default. */
function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/**
 * Resolve the plugin config.
 *
 * Deliberately hand-rolled rather than a `Config` schema: the plugin has two
 * runtime dependencies and no reason to add a third, and a config that is
 * merely wrong should degrade to its default instead of failing the row.
 *
 * @param raw - the row's `config` block.
 * @returns the resolved config.
 */
export function resolveMemoryConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    root: resolveRoot(config),
    enabled: config.enabled !== false,
    maxRenderChars: positiveInteger(config.maxRenderChars, MEMORY_MAX_RENDER_CHARS),
    maxEntryChars: positiveInteger(config.maxEntryChars, MEMORY_MAX_ENTRY_CHARS),
    scopeBudgets: {
      ...MEMORY_SCOPE_BUDGETS,
      ...(config.scopeBudgets !== null && typeof config.scopeBudgets === 'object' ? config.scopeBudgets : {})
    },
    freezePerTurn: config.freezePerTurn !== false,
    includeInSubagents: config.includeInSubagents === true,
    lockWaitMs: positiveInteger(config.lockWaitMs, DEFAULT_LOCK_WAIT_MS),
    maxBootDocs: positiveInteger(config.maxBootDocs, DEFAULT_MAX_BOOT_DOCS)
  }
}

/**
 * The logger to use, without assuming one is reachable.
 *
 * Cordis throws on reading a service that was not injected, so the probe is
 * guarded: a missing logger must degrade to silence, never to a plugin that
 * fails to load.
 *
 * @param ctx - the plugin context.
 * @returns a `{ info, warn, error }` sink.
 */
function safeLogger(ctx) {
  const fallback = { info: () => {}, warn: () => {}, error: () => {} }
  try {
    const logger = ctx?.logger
    if (logger !== null && typeof logger === 'object' && typeof logger.warn === 'function') {
      return {
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message)
      }
    }
  } catch {
    // An uninjected service read throws; silence is the right degradation.
  }
  return fallback
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one registration step, turning a failure into a diagnostic.
 *
 * The loader treats a rejected `apply` as a failed plugin and — for a
 * host-plane row — that is a failed boot for the whole tree. Durable memory is
 * worth a lot, but never worth that: every step below degrades to "this
 * capability is off, and the log says why".
 *
 * @param logger - the diagnostic sink.
 * @param what - what was being registered, for the message.
 * @param operation - the registration.
 * @returns whatever the operation returned, or `undefined` when it failed.
 */
function attempt(logger, what, operation) {
  try {
    return operation()
  } catch (error) {
    logger.error(`abaco-memory: ${what} failed: ${describe(error)}`)
    return undefined
  }
}

/**
 * Mount the durable memory: the store, the tools and the prompt section.
 *
 * Async because the boot snapshot is warmed here — a resumed session must have
 * its project and session documents in memory before the first assembly, and
 * that assembly is synchronous.
 *
 * @param ctx - the host-plane context that receives the registrations.
 * @param config - the row's `config` block.
 */
async function start(ctx, config) {
  const logger = safeLogger(ctx)
  const resolved = resolveMemoryConfig(config)
  const store = new MemoryStore({
    root: resolved.root,
    maxEntryChars: resolved.maxEntryChars,
    lockWaitMs: resolved.lockWaitMs,
    maxBootDocs: resolved.maxBootDocs,
    logger
  })
  const renderer = new MemoryRenderer({ store, config: resolved, logger })

  if (resolved.enabled === false) {
    logger.info('abaco-memory: disabled by config; no memory section and no memory tools')
    return
  }

  // Warm the snapshot. Best-effort by contract: an unwritable or unreadable
  // root leaves memory empty for this launch, and the tools report the real
  // error if the model tries to write.
  try {
    const loaded = await store.load()
    logger.info(`abaco-memory: ${loaded} document(s) loaded from ${resolved.root}`)
  } catch (error) {
    logger.warn(`abaco-memory: could not warm the memory snapshot from ${resolved.root}: ${describe(error)}`)
  }
  await store.gc().catch((error) => logger.warn(`abaco-memory: startup gc failed: ${describe(error)}`))

  // A dynamic section: `text` is a function, evaluated on every assembly with
  // the agent in context (dsh-system-prompt/lib/index.js:229-232,330).
  attempt(logger, 'the durable-memory prompt section', () =>
    ctx.systemPrompt.section({
      name: MEMORY_SECTION_NAME,
      order: MEMORY_SECTION_ORDER,
      text: (context) => renderer.sectionText(context)
    })
  )

  attempt(logger, 'the abaco_memory_* tools', () => registerMemoryTools(ctx, { store, config: resolved, logger }))

  // The turn boundary is the barrier that makes this turn's writes visible to
  // the next turn's prompt, and the deterministic, LLM-free place to record
  // that the turn happened (design §3.2, trigger 2).
  attempt(logger, 'the turn-boundary listener', () =>
    ctx.on('agent/turn-stopping', async (payload) => {
      try {
        const header = payload?.agent?.session?.header
        if (header === undefined || header === null) return
        if (header.id !== undefined) renderer.invalidate(header.id)
        await store.markTurnStop(
          { cwd: header.cwd, sessionId: header.id, agentPreset: header.agentPreset },
          payload.turn
        )
      } catch (error) {
        logger.warn(`abaco-memory: turn-stop bookkeeping failed: ${describe(error)}`)
      }
    })
  )

  // Bound the per-turn cache to live sessions.
  attempt(logger, 'the disposal listener', () =>
    ctx.on('agent/disposed', (payload) => {
      try {
        const id = payload?.agent?.session?.header?.id
        if (id !== undefined) renderer.invalidate(id)
      } catch {
        // Disposal is not worth a diagnostic of its own.
      }
    })
  )
}

/**
 * Cordis entry point.
 *
 * Never rejects. Every failure below — an unwritable `<DSH_HOME>`, a corrupt
 * document, a configuration that cannot be resolved, a duplicate mount — is
 * reported through `ctx.logger` and leaves the rest of the plugin tree
 * running. A memory layer that can prevent the app from booting would be a
 * worse failure than having no memory at all.
 *
 * @param ctx - the host-plane context that receives the registrations.
 * @param config - the row's `config` block.
 */
async function apply(ctx, config) {
  try {
    await start(ctx, config)
  } catch (error) {
    safeLogger(ctx).error(
      `abaco-memory: failed to start; durable memory is off for this launch: ${describe(error)}`
    )
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Cordis surface, plus the seam `test/abaco-memory.test.ts` drives directly.
 *
 * The test imports the real store and renderer rather than re-implementing
 * them, so what it exercises is the shipped code path; the extra named exports
 * are inert to the loader, which only reads `name`, `inject`, `apply` and
 * `Config`.
 * ──────────────────────────────────────────────────────────────────────────── */

export {
  apply,
  inject,
  name,
  MEMORY_DIR_NAME,
  MEMORY_FACETS,
  MEMORY_PHASES,
  facetsForPhase,
  phaseOf,
  MEMORY_SECTION_NAME,
  MEMORY_SECTION_ORDER,
  MemoryRenderer,
  MemoryStore,
  ambientOf,
  assertParentProfileWrite,
  isSubagentHeader,
  registerMemoryTools,
  sourceOf
}
