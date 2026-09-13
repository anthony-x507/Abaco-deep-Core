/**
 * `abaco-observability` — Phase 0 telemetry for the 3-layer context system.
 *
 * ## What it is for
 *
 * Every later step of the plan — the subagent spill cap, Principle D, Principle
 * C, the memory protocol — is argued from the claim that compaction is
 * degrading the agent. Until now that claim has been an *inference from
 * reading the engine*: nobody has ever seen a compaction happen in this
 * product, because nothing recorded one. This row makes compactions, pruning,
 * spills and context pressure **visible as data**, so the next step can be
 * judged by a measured delta instead of a story.
 *
 * Nothing here changes engine behaviour. It listens, reads projections that the
 * engine already maintains, and appends one line per observed event to
 * `<DSH_HOME>/logs/abaco-context.jsonl`. It registers no service, adds no tool,
 * writes no session event, and takes no decision on behalf of the agent.
 *
 * ## The engine contract it is written against
 *
 * Every event name, payload member and service below was read out of the engine
 * **that ABACO actually runs**:
 *
 * ```
 * $DSH_NM = /Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai
 * ```
 *
 * That path is defined here rather than abbreviated away, because the earlier
 * handoff's `$DSH_NM` was an undefined shorthand that resolved to
 * `/Applications/DSH Desktop.app/…` — the **DeepSeek** app's bundle, a different
 * product with no authority over ABACO. There are three copies of the engine on
 * this machine, and a claim is only usable when it names which one it came from:
 *
 * | Copy | Path | Authority |
 * |---|---|---|
 * | **ABACO bundle** | `/Applications/ABACO DEEP HARNES.app/…/@deepseek-ai` | **authoritative for runtime** |
 * | DeepSeek Desktop | `/Applications/DSH Desktop.app/…/@deepseek-ai` | another product |
 * | Build input (repo) | `desktop/src/dsh-desktop/node_modules/@deepseek-ai` | what the bundle is built from |
 *
 * Verified for this work: every file cited below is **md5-identical in all
 * three** copies, so the citations hold whichever one is read. They are written
 * against the ABACO bundle because that is the code ABACO executes. The three
 * copies are *not* wholly identical, and the differences are worth knowing:
 * the ABACO bundle's `dsh/package.json` carries the injected ABACO plugin
 * dependencies, its `dsh-web-frontend/dist/*.png` are the rebranded assets, and
 * its `dsh-client-ui-deliverables/lib/client.js` differs — while the repo copy
 * additionally ships `README.md` and `lib/types/` that the packaged bundle
 * prunes.
 *
 * | Contract | Source (ABACO bundle; md5-identical in all three copies) |
 * |---|---|
 * | `session/event` is a Cordis firehose emitted per append, with the session and the event as arguments | `dsh-session/lib/index.js:1427-1435` |
 * | the firehose only fires for a session entered into a `SessionStore` | `dsh-session/lib/index.js:1661` (`enter` records `emitCtx: this.ctx`) |
 * | `compaction/start`, `compaction/summary`, `compaction/end`, `compaction/prune` are real event types in a closed vocabulary | `dsh-session/lib/index.js:914-966` (`KNOWN_SESSION_EVENT_TYPES`) |
 * | `agent/status` = `{ status }`, `'idle' | 'running'` | `dsh-agent-loop/lib/index.js:386-393` |
 * | `agent/request-error` = `{ turn, step, provider, failure, retryPolicy, signal }`, a waterfall | `dsh-agent-loop/lib/index.js:660-666` |
 * | `CONTEXT_WINDOW_EXCEEDED` is the provider code that triggers overflow recovery | `dsh-llm/lib/index.js:111`; `dsh-compaction-basic/lib/index.js:805` |
 * | `ctx.tokenMeter` (`tokenMeter.measure(session).totalTokens`) | `dsh-token-meter/lib/index.js:591`, `:620`, `:658` |
 * | `ctx.sessionProjections.snapshot(session, keys).values.contextPressure` → `{ contextWindow?, pressureTokens?, projectedTokens? }` | `dsh-session-projection/lib/index.js:142`; `dsh-token-meter/lib/index.js:405-409` |
 * | `ctx.sessions.get(sessionId)` | `dsh-session/lib/index.js:1547`, `:1779` |
 * | event admission flows **up** the scope chain, so an untagged root listener sees every agent's and every session's events | `dsh-scope/lib/index.js:321-331` (`scopeTarget`), `:235-236` |
 * | one plugin body may return only a disposer or `undefined`; anything else is `TypeError: Invalid effect` and takes the tree down | `cordis/lib/index.js:1139-1143`; the ABACO post-mortem in `docs/HANDOFF-FASE5.md` §2 |
 *
 * ## Why `apply` is synchronous and why `inject` uses a callback
 *
 * The two rules that cost this project its first plugin:
 *
 * 1. **`apply` is synchronous and returns `undefined`.** An `async` body
 *    resolves to a Promise, the effect collector accepts only a function or
 *    `undefined`, and a rejected collection fails the plugin — and with it the
 *    whole tree, which sends the app to Safe Mode, which blocks third-party
 *    bundles, which is why the owner saw no ABACO feature at all. Every
 *    asynchronous thing here is *started* and its settlement is owned locally.
 * 2. **Services are reached by `ctx.inject([...], cb)`, never by an undeclared
 *    property read.** Reading `ctx.tokenMeter` without declaring `inject`
 *    throws (`cannot get property … without inject`) — the mechanism that left
 *    five ABACO rows disabled in `build/dsh-desktop.patch.yml:146-153`. The
 *    callback's return value is likewise not handed to Cordis.
 *
 * ## What it deliberately reports as unknown
 *
 * Honesty is a feature here, so the JSONL names its own gaps rather than
 * filling them with plausible numbers:
 *
 * - **`trigger`** is `'overflow'` only when a `CONTEXT_WINDOW_EXCEEDED` failure
 *   was attributed to the session moments earlier; otherwise `'pressure'`, and
 *   `triggerSource` says which of the two it was. Overflows whose attribution
 *   window has expired are reported as `'pressure'` with
 *   `alerts: ['trigger-inferred']` never being claimed as measured.
 * - **`retries`** counts compaction attempts made in the same turn. The engine
 *   has no retry event, so this is the observable definition of the number, not
 *   a counter lifted from `compactionRetries`.
 * - **`compressionRatio`** uses a code-point/4 estimate of the checkpoint,
 *   because the harness does not tokenize the checkpoint for us. Every record
 *   that carries it also carries `checkpointReported` and the code-point size
 *   it came from.
 * - **`thresholdTokens` / `retainTokens`** are the *resolved spec* values,
 *   which the engine computes per routed model inside `compactIfNeeded` and
 *   never logs. `retainTokens` is read from the composed preset when it can be
 *   found; the resolved `thresholdTokens` is reported as `null` rather than
 *   guessed. The span, the ratio and the checkpoint size — the things the
 *   acceptance criterion actually asks for — are all measured.
 *
 * @module abaco-observability
 */

import { z } from 'zod'
import {
  DEFAULT_MAX_INLINE_BYTES,
  LOG_FILE_NAME,
  invalidConfigError,
  logPath,
  resolveDshHome,
  resolveObservabilityConfig
} from './lib/config.js'
import { readPressure, readToolResult, readTurnError } from './lib/events.js'
import { ObservabilityLog, describeError } from './lib/log.js'
import { readComposedPolicy } from './lib/policy.js'
import { CompactionTracker } from './lib/tracker.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'abaco-observability'

/**
 * The three services this row reads, and nothing else.
 *
 * `tokenMeter` and `sessionProjections` are composed by the engine's own base
 * (`dsh-base/cordis.patch.yml:138` and `:323`), and the ABACO preset's
 * compaction rows require the same pair, so depending on them cannot strand
 * this row in a profile where compaction works at all. `sessions` is what turns
 * a session back into an object when `used_after` has to be read.
 *
 * No service is registered and no property is ever assigned onto `ctx`:
 * registering a second service under a live name throws, and assigning an
 * undeclared property is rejected by Cordis.
 */
export const inject = ['tokenMeter', 'sessionProjections', 'sessions']

/**
 * Loader-facing config schema.
 *
 * Every field carries a `.catch(...)` and the object carries a whole-value
 * `.catch({})`, so no config value can make validation fail. That matters more
 * here than anywhere else in the tree: a throw while resolving a row's config
 * is FATAL in Cordis and fails the entire plugin tree, not just this row. The
 * real, per-field diagnostics live in `resolveObservabilityConfig`, which
 * reports every rejected value instead of silently repairing it.
 */
export const Config = z
  .object({
    /** When false, nothing is registered and no file is written. */
    enabled: z.boolean().default(true).catch(true),
    /** Explicit harness home; unset ⇒ `$DSH_HOME` ⇒ `~/.dsh`. */
    home: z.string().optional().catch(undefined),
    /** The JSONL file name inside `<home>/logs/`. */
    logFile: z.string().optional().catch(undefined),
    /** Byte ceiling above which a tool result counts as a spill candidate. */
    maxInlineBytes: z.number().default(DEFAULT_MAX_INLINE_BYTES).catch(DEFAULT_MAX_INLINE_BYTES),
    /** Bounded session count. */
    maxSessionsTracked: z.number().default(64).catch(64),
    /** Bounded attempts retained per session. */
    maxAttemptsPerSession: z.number().default(64).catch(64),
    /** Bounded read-call identities retained per session. */
    maxReadCallsPerSession: z.number().default(32).catch(32),
    /** Emit one line per `compaction/prune`. */
    recordPrune: z.boolean().default(true).catch(true),
    /** Track spill / large-result counts. */
    recordToolResults: z.boolean().default(true).catch(true),
    /** Track repeated read calls as the measured degradation signal. */
    trackDegradation: z.boolean().default(true).catch(true),
    /** Coalesced asynchronous appends (gives up write-durable-when-returning). */
    asyncWrites: z.boolean().default(false).catch(false)
  })
  .default({})
  .catch({})

/** How often the self-check line reports that the row is alive. */
export const SELFCHECK_EVERY_MS = 5 * 60 * 1000

/** Nothing may throw before this many diagnostics have been collected. */
const MAX_RECORDED_ISSUES = 32

/**
 * The row's whole runtime, built from its seams.
 *
 * Exported so the tests can drive it without a Cordis tree — but the seams it
 * takes are the *real* engine objects (`ctx.tokenMeter`,
 * `ctx.sessionProjections`, `ctx.sessions`), so a test that substitutes them
 * for compatible fakes is still exercising this code's real control flow.
 *
 * @param options - `{ ctx, config, logger }`.
 * @returns `{ log, tracker, records, issues }`.
 */
export function createObservability({ ctx, config, logger }) {
  const resolved = resolveObservabilityConfig(config)
  const sink = new ObservabilityLog({
    path: resolved.logPath,
    logger,
    asyncWrites: resolved.asyncWrites
  })
  const tracker = new CompactionTracker(resolved)
  const issues = []
  const records = { written: 0, skipped: 0 }
  const startedAt = Date.now()
  /** The most recent non-null pressure reading, for the disabled-engine alert. */
  let lastPressure
  /** The most recent measurement, reused inside one event's handling. */
  let lastMeasurement

  const note = (message) => {
    if (issues.length < MAX_RECORDED_ISSUES) issues.push(message)
  }

  // Config problems are configuration facts, not events, so they are stated
  // once, loudly, and then the row runs with the defaults. Swallowing them is
  // what made an earlier defect in this codebase survive a whole session.
  for (const reason of resolved.reasons) {
    note(reason)
    logger?.warn?.(`abaco-observability: ${reason}`)
  }

  const emit = (record) => {
    if (record === undefined) {
      records.skipped += 1
      return
    }
    if (sink.write(record)) records.written += 1
    else records.skipped += 1
  }

  /** Live services, resolved lazily so a late-published service still appears. */
  const services = () => ({
    tokenMeter: ctx?.tokenMeter,
    sessionProjections: ctx?.sessionProjections,
    sessions: ctx?.sessions
  })

  /** Read the pressure and the estimate for a session, tolerating absence. */
  const measure = (session) => {
    const { tokenMeter, sessionProjections } = services()
    const pressure = readPressure({ sessionProjections, tokenMeter, session })
    const used = Number.isFinite(pressure.projectedTokens)
      ? pressure.projectedTokens
      : Number.isFinite(pressure.estimatedTokens)
        ? pressure.estimatedTokens
        : pressure.pressureTokens
    if (Number.isFinite(pressure.pressureTokens)) lastPressure = pressure.pressureTokens
    return { used, pressure }
  }

  /** The live session object for an id, when the store still has it. */
  const sessionOf = (sessionId) => {
    const store = services().sessions
    if (store === undefined || typeof store.get !== 'function') return undefined
    try {
      return store.get(sessionId)
    } catch {
      return undefined
    }
  }

  return {
    resolved,
    log: sink,
    tracker,
    records,
    issues,

    /**
     * One `session/event` from the engine firehose.
     *
     * The listener is synchronous by design. Every read it makes — the
     * `contextPressure` projection, the token meter — is a synchronous read
     * that the projection registry folds lazily to the session's current
     * cursor (`dsh-session-projection/lib/index.js:378-399`), so the values are
     * already correct for the event being handled. Returning a promise from
     * here would buy nothing and risk the one thing that must not happen: an
     * unhandled rejection in a telemetry path.
     *
     * @param session - the session that appended.
     * @param event - the appended event.
     */
    onSessionEvent(session, event) {
      try {
        const sessionId = typeof session?.id === 'string' ? session.id : undefined
        if (sessionId === undefined || event === null || typeof event !== 'object') return
        // Every appended event marks the session active, not just the handful of
        // types folded below: an overflow is attributed to the most recently
        // active session, and that has to mean "appended anything".
        tracker.touch(sessionId, event.time)
        // The engine's own measurement is refreshed on EVERY event, not only on
        // the compaction ones. A profile where compaction is silently disabled
        // produces no compaction events at all, so the only way the "under
        // pressure but never compacting" alert can ever fire is if ordinary
        // traffic keeps the reading current. Measuring only inside the
        // compaction paths made that alert unreachable — which is exactly the
        // kind of quiet hole this row exists to close.
        lastMeasurement = measure(session)
        switch (event.type) {
          case 'compaction/start': {
            emit(tracker.start(sessionId, event, lastMeasurement))
            return
          }
          case 'compaction/prune': {
            const pruned = tracker.prune(sessionId, event)
            if (resolved.recordPrune) emit(pruned)
            return
          }
          case 'compaction/summary': {
            tracker.summary(sessionId, event)
            return
          }
          case 'compaction/end': {
            tracker.fail(sessionId, event)
            // Re-measured here on purpose: the surface has just been replaced,
            // so `used_after` has to be a fresh reading of the live session, not
            // the one taken when the closing event was appended.
            const live = sessionOf(sessionId) ?? session
            // The session counters are read INSIDE `finish`, after it advances
            // them. Reading them here would report the totals as they stood
            // *before* this compaction, so the first compaction in a profile
            // would report zero compactions — a record that contradicts itself.
            emit(tracker.finish(sessionId, event, measure(live)))
            return
          }
          case 'user/message': {
            tracker.checkpoint(sessionId, event)
            return
          }
          case 'tool/call': {
            if (resolved.trackDegradation) tracker.readCall(sessionId, event)
            return
          }
          case 'tool/result': {
            if (resolved.recordToolResults) {
              const reading = readToolResult(event, resolved.maxInlineBytes)
              if (reading !== undefined) tracker.toolResult(sessionId, event.time ?? Date.now(), reading)
            }
            return
          }
          case 'turn/end': {
            const failure = readTurnError(event)
            if (failure !== undefined) {
              recordTurnFailure(sessionId, failure, event.time ?? Date.now())
            }
            return
          }
          default:
            return
        }
      } catch (error) {
        // A telemetry listener that can throw into the engine's append path
        // would be a new way for the product to fail. It cannot, by
        // construction, and this catch is the guarantee.
        recordFailure(`session/event ${String(event?.type)}: ${describeError(error)}`)
      }
    },

    /**
     * One `agent/status` transition.
     *
     * Emitted per agent over a scoped dispatch, and a root listener is admitted
     * for every descendant scope (`dsh-scope/lib/index.js:235-236`, verified by
     * `dsh-compaction-basic/lib/index.js:796` doing exactly this). The session
     * is read off the agent; when an agent has no session the transition is
     * recorded without one rather than dropped.
     */
    onAgentStatus(payload, receiver) {
      try {
        const status = payload?.status
        if (typeof status !== 'string') return
        const sessionId = sessionIdOfAgent(payload?.agent ?? receiver?.agent)
        if (sessionId === undefined) return
        emit({ event: 'agent_status', sessionId, at: Date.now(), status })
      } catch (error) {
        recordFailure(`agent/status: ${describeError(error)}`)
      }
    },

    /**
     * One `agent/request-error`, used only to attribute a context overflow.
     *
     * The payload has no session identity, so the session is taken from the
     * dispatching context (`listener.apply(this, args)` binds the emitting
     * scope as `this` — `cordis/lib/index.js:392`) and, failing that, from the
     * tracker's most recently active session inside the attribution window.
     */
    onRequestError(payload, receiver) {
      try {
        const code = payload?.failure?.code
        if (code !== 'CONTEXT_WINDOW_EXCEEDED') return
        const fromAgent = sessionIdOfAgent(payload?.agent ?? receiver?.agent)
        const sessionId = tracker.markOverflow(Date.now(), fromAgent)
        if (sessionId === undefined) {
          // An overflow with no session to blame is still a fact worth one
          // line: it says the attribution window missed, which is exactly the
          // case where `trigger` in a later record will read `'pressure'`.
          emit({ event: 'context_overflow', sessionId: null, at: Date.now(), code: String(code), attribution: 'unattributed' })
          return
        }
        emit({
          event: 'context_overflow',
          sessionId,
          at: Date.now(),
          code: String(code),
          turn: Number.isFinite(payload?.turn) ? payload.turn : null,
          step: Number.isFinite(payload?.step) ? payload.step : null,
          attribution: fromAgent === undefined ? 'recent-session' : 'agent'
        })
      } catch (error) {
        recordFailure(`agent/request-error: ${describeError(error)}`)
      }
    },

    /** The self-check line: proof the row is mounted and how much it has seen. */
    selfCheck(sessionId) {
      const totals = sessionId === undefined ? undefined : tracker.totals(sessionId)
      const policy = readComposedPolicy({ dshHome: resolved.dshHome, presetId: resolved.presetId })
      const alerts = [...policy.alerts]
      // The second half of §8.5's "nunca silencioso": a profile where the engine
      // has not compacted once while a request reported real prompt-side
      // pressure is a disabled engine, whether the policy document says so or
      // not. Only live numbers are used here — nothing is inferred from the
      // file, and `null` pressure proves nothing either way.
      if (totals !== undefined && totals.compactions === 0 && Number.isFinite(lastPressure) && lastPressure > 0) {
        alerts.push('no-compaction-under-pressure')
      }
      emit({
        event: 'self_check',
        sessionId: sessionId ?? null,
        at: Date.now(),
        uptimeMs: Date.now() - startedAt,
        logPath: resolved.logPath,
        valid: resolved.valid,
        issues,
        records: { ...records, ...sink.stats() },
        totals: totals ?? null,
        lastPressureTokens: Number.isFinite(lastPressure) ? lastPressure : null,
        composedPolicy: {
          found: policy.found,
          policySource: policy.policySource,
          presetId: policy.presetId,
          path: policy.path,
          engineRowFound: policy.engineRowFound ?? false,
          prunerRowFound: policy.prunerRowFound ?? false,
          ...(policy.policy === undefined ? {} : { policy: policy.policy }),
          ...(policy.reason === undefined ? {} : { reason: policy.reason })
        },
        alerts
      })
    },

    /** Start periodic self-check lines; returns a disposer. */
    startSelfCheck(intervalMs = SELFCHECK_EVERY_MS) {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {}
      const timer = setInterval(() => {
        this.selfCheck(tracker.mostRecentSession())
      }, intervalMs)
      // A telemetry timer must never be the reason a closing harness stays up.
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    },

    /** Resolve once everything written so far has been attempted. */
    async flush() {
      await sink.flush()
    },

    /** Release the sink's descriptor. */
    close() {
      sink.close()
    }
  }

  /** Record a turn-level failure, which is where overflow shows up first. */
  function recordTurnFailure(sessionId, failure, at) {
    emit({
      event: 'turn_failure',
      sessionId,
      at,
      code: failure.code,
      message: failure.message ?? null,
      isContextOverflow: failure.code === 'CONTEXT_WINDOW_EXCEEDED'
    })
  }

  /** Record an internal failure of this row, without failing anything else. */
  function recordFailure(message) {
    note(message)
    logger?.warn?.(`abaco-observability: ${message}`)
  }
}

/** The session id behind an agent-shaped value, if it has one. */
function sessionIdOfAgent(agent) {
  const id = agent?.session?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * The Cordis plugin body.
 *
 * Synchronous, and it returns nothing. See the module note: an `async` body
 * resolving to anything but `undefined` is the defect that sent this product to
 * Safe Mode, and returning nothing at all makes that structural rather than a
 * property of each return path.
 *
 * @param ctx - the host-plane context this row is applied to.
 * @param config - the row's `config` block.
 */
export function apply(ctx, config) {
  const logger = safeLogger(ctx)
  // Resolution happens once, before any I/O and before `inject`, so a disabled
  // row costs nothing and creates nothing. `resolveObservabilityConfig` is
  // total: it returns a frozen result on every path and never throws.
  //
  // `resolveObservabilityConfig` is total, so this cannot throw. Only the
  // resolution is done here — no sink is constructed and no file is touched
  // until the services exist, so a disabled row creates nothing at all and an
  // enabled one builds exactly one runtime.
  const resolved = resolveObservabilityConfig(config)
  if (resolved.enabled === false) {
    logger.info('abaco-observability: disabled by config; no telemetry is written')
    return
  }
  for (const reason of resolved.reasons) logger.warn(`abaco-observability: ${reason}`)

  // `ctx.inject` runs the callback once every declared service is published and
  // hands back that fiber as the plugin's disposal handle. The callback keeps a
  // block body and returns nothing, so no promise and no object can escape as
  // this plugin's effect.
  ctx.inject(inject, (scoped) => {
    let service
    try {
      service = createObservability({ ctx: scoped, config, logger })
      scoped.on('session/event', function (session, event) {
        service.onSessionEvent(session, event)
      })
      scoped.on('agent/status', function (payload) {
        service.onAgentStatus(payload, this)
      })
      scoped.on('agent/request-error', function (payload) {
        service.onRequestError(payload, this)
      })
      service.selfCheck()
      service.startSelfCheck()
      logger.info(`abaco-observability: telemetry appending to ${service.resolved.logPath}`)
    } catch (error) {
      logger.warn(`abaco-observability: telemetry could not start: ${describeError(error)}`)
    }
  })
}

/** A logger that cannot throw, whatever the engine hands us. */
function safeLogger(ctx) {
  const logger = ctx?.logger
  return {
    info: (...args) => {
      try {
        logger?.info?.(...args)
      } catch {
        /* a logger that throws must not be able to fail the mount */
      }
    },
    warn: (...args) => {
      try {
        logger?.warn?.(...args)
      } catch {
        /* as above */
      }
    }
  }
}

export {
  DEFAULT_MAX_INLINE_BYTES,
  LOG_FILE_NAME,
  resolveObservabilityConfig,
  resolveDshHome,
  logPath,
  invalidConfigError,
  ObservabilityLog,
  CompactionTracker,
  readPressure,
  readToolResult,
  readTurnError
}
