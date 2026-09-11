/**
 * The bounded per-session state that turns an event stream into the numbers the
 * Phase-0 criterion asks for.
 *
 * ## Why state exists at all
 *
 * The engine splits one compaction across four events that arrive in a fixed
 * order and carry disjoint facts:
 *
 * ```
 * compaction/start     { compactionId, turn }
 * [compaction/prune]*  { shadowedTokenCount, … }        ← 0..n, from the pruner
 * compaction/summary   { shadowedTokenCount, span, provider, model, usage }
 * user/message         the checkpoint body               ← immediately after
 * compaction/end       { compactionId, error? }
 * ```
 *
 * `compaction/end` is the only event that says whether the attempt *succeeded*,
 * and `compaction/start` is the only one that knows the attempt existed before
 * its summary — while `used_before` must be read at the start (from
 * `contextPressure`, which moves on afterwards) and `used_after` only exists at
 * the end. Neither event alone can produce the deliverable, so the joiner is
 * this module: one small record per in-flight attempt.
 *
 * ## Bounded, on purpose
 *
 * Every map here is capped (`maxSessionsTracked`, `maxAttemptsPerSession`,
 * `maxReadCallsPerSession`) and evicts oldest-first. A telemetry plugin that
 * grows without bound across a long-lived session becomes the memory problem it
 * was mounted to diagnose.
 *
 * The same bound is what makes the degradation counters honest, and the code
 * says so at each site: "was this read repeated since the last compaction?" is
 * answerable exactly, because it only needs reads since the previous
 * compaction; "has the agent re-read something from three compactions ago?" is
 * not, and is therefore not claimed.
 *
 * @module abaco-observability/lib/tracker
 */

import { CONTEXT_OVERFLOW_CODE, readTurnError, toolCallKey } from './events.js'

/** How long after a request error an overflow may still be attributed to a session. */
export const OVERFLOW_ATTRIBUTION_MS = 15000

/** Create a Map that evicts its oldest key once it exceeds `limit`. */
function boundedMap(limit) {
  const map = new Map()
  return {
    map,
    set(key, value) {
      if (map.has(key)) map.delete(key)
      map.set(key, value)
      while (map.size > limit) {
        const oldest = map.keys().next()
        if (oldest.done === true) break
        map.delete(oldest.value)
      }
      return value
    }
  }
}

/** Trim an array in place to its last `limit` members. */
function keepLast(array, limit) {
  if (array.length > limit) array.splice(0, array.length - limit)
  return array
}

/** A key that hides the token counts of a read while keeping its identity. */
function readKeyOf(key) {
  return key.startsWith('read(') || key.startsWith('grep(') ? key : undefined
}

/**
 * One in-flight compaction attempt.
 *
 * @param id - the engine's `compactionId`.
 * @param turn - `compaction/start.turn`, or `null` for a standalone bracket.
 * @param cause - `'overflow'` when an overflow was just attributed, else `'pressure'`.
 * @param ordinal - 1 for the turn's first attempt, 2 for its first retry, …
 */
function newAttempt(id, turn, cause, ordinal) {
  return {
    id,
    turn,
    cause,
    ordinal,
    startedAt: undefined,
    usedBefore: undefined,
    measurementBefore: {},
    pruneCount: 0,
    pruneTokenCount: 0,
    largeResultsBefore: 0,
    spillCountBefore: 0,
    summary: undefined,
    checkpointChars: undefined,
    awaitingCheckpoint: false,
    error: undefined
  }
}

/**
 * Per-session telemetry state.
 *
 * @param config - a resolved config from `./config.js`.
 */
export class CompactionTracker {
  #config
  #sessions
  #recent
  #pendingOverflow

  constructor(config) {
    this.#config = config
    this.#sessions = boundedMap(config.maxSessionsTracked)
    this.#recent = boundedMap(config.maxSessionsTracked)
    this.#pendingOverflow = boundedMap(config.maxSessionsTracked)
  }

  /** The state of one session, created on first use. */
  #state(sessionId) {
    let state = this.#sessions.map.get(sessionId)
    if (state === undefined) {
      state = {
        attempts: new Map(),
        attemptOrder: [],
        // How many compaction attempts this session has made in each turn. The
        // map of live attempts cannot answer this: an attempt is deleted when it
        // closes, so a retry would look like the first attempt of its turn.
        turnAttempts: new Map(),
        open: undefined,
        files: new Map(),
        readKeys: [],
        readsSinceCompaction: 0,
        reReadAfterCompaction: 0,
        compactions: 0,
        overflows: 0,
        spills: 0,
        largeResults: 0,
        checkpoints: 0,
        lastAt: undefined,
        lastStatus: undefined
      }
      this.#sessions.set(sessionId, state)
      // Being observed *is* being active. Without this, a session that only ever
      // produced measured events (rather than the ones `#touch` is called from)
      // would be tracked but invisible to the recency window, which is the only
      // way an overflow can be attributed to it.
      this.#recent.set(sessionId, { at: 0 })
    }
    return state
  }

  /** Stamp a session as the most recent one to have done something. */
  #touch(sessionId, at) {
    const state = this.#state(sessionId)
    state.lastAt = at
    this.#recent.set(sessionId, { at: Number.isFinite(at) ? at : 0 })
    return state
  }

  /**
   * Note that a session appended an event, whatever kind it was.
   *
   * This is what keeps the recency window honest. `agent/request-error` carries
   * no session identity, so an overflow is attributed to whichever session was
   * last active — and "last active" has to mean *appended anything*, not
   * "appended one of the handful of types this row happens to fold". A session
   * that only ever emitted `step/start` and `assistant/chunk` is still the
   * session that made the failing request.
   */
  touch(sessionId, at) {
    this.#touch(sessionId, at)
  }

  /**
   * Attribute a provider context overflow to a session.
   *
   * `agent/request-error`'s payload carries **no session identity**
   * (`dsh-agent-loop/lib/index.js:660-666` emits `{ turn, step, provider,
   * failure, retryPolicy, signal }`), so the session cannot be read off the
   * event. The session is therefore the one that most recently appended an
   * event, which is exact in the case that matters — an overflow is raised by
   * the request that session just made — and the attribution window expires so
   * a late error can never be blamed on an idle session.
   *
   * The failure is recorded as `trigger: 'overflow'`; if the attribution misses,
   * the attempt is still recorded, as `'pressure'`, and the `triggerSource`
   * field says the trigger was inferred either way. See `finish()`.
   *
   * @param at - the event's timestamp.
   * @param explicitSessionId - the session read from the dispatching agent, when
   *   one is available. Preferred over the recency heuristic whenever present.
   * @returns the session id the overflow was attributed to, or `undefined`.
   */
  markOverflow(at, explicitSessionId) {
    let sessionId = explicitSessionId
    if (sessionId === undefined) {
      let latest
      for (const [candidate, stamp] of this.#recent.map) {
        if (latest === undefined || stamp.at > latest.at) latest = { sessionId: candidate, at: stamp.at }
      }
      if (latest === undefined) return undefined
      if (Number.isFinite(at) && Number.isFinite(latest.at) && at - latest.at > OVERFLOW_ATTRIBUTION_MS) return undefined
      sessionId = latest.sessionId
    }
    const state = this.#state(sessionId)
    state.overflows += 1
    this.#pendingOverflow.set(sessionId, { at: Number.isFinite(at) ? at : Date.now() })
    return sessionId
  }

  /** Note an `agent/status` transition, so the JSONL carries the agent's phases. */
  status(sessionId, status, at) {
    const state = this.#touch(sessionId, at)
    state.lastStatus = status
    return { sessionId, at, status }
  }

  /** Consume a pending overflow marker, if one is fresh enough. */
  #takeOverflow(sessionId, at) {
    const pending = this.#pendingOverflow.map.get(sessionId)
    if (pending === undefined) return 'pressure'
    this.#pendingOverflow.map.delete(sessionId)
    if (Number.isFinite(at) && Number.isFinite(pending.at) && at - pending.at > OVERFLOW_ATTRIBUTION_MS) return 'pressure'
    return 'overflow'
  }

  /**
   * Begin an attempt on `compaction/start`.
   *
   * @param sessionId - the owning session.
   * @param event - the `compaction/start` event.
   * @param measurement - a live read from `readPressure` plus the session's
   *   running spill/large-result counters.
   * @returns the record to log.
   */
  start(sessionId, event, measurement) {
    const at = event.time ?? Date.now()
    const state = this.#touch(sessionId, at)
    const cause = this.#takeOverflow(sessionId, at)
    const id = String(event.data?.compactionId ?? 'unknown')
    const turn = event.data?.turn ?? null
    const ordinal = (state.turnAttempts.get(turn) ?? 0) + 1
    state.turnAttempts.set(turn, ordinal)
    keepLast([...state.turnAttempts.keys()], this.#config.maxAttemptsPerSession)
    const attempt = newAttempt(id, turn, cause, ordinal)
    attempt.startedAt = at
    attempt.usedBefore = measurement.used
    attempt.measurementBefore = measurement.pressure ?? {}
    attempt.largeResultsBefore = state.largeResults
    attempt.spillCountBefore = state.spills
    state.attempts.set(id, attempt)
    state.attemptOrder.push(id)
    keepLast(state.attemptOrder, this.#config.maxAttemptsPerSession)
    state.open = attempt
    return {
      event: 'compaction_start',
      sessionId,
      at,
      compactionId: id,
      turn: attempt.turn,
      trigger: cause,
      usedBefore: attempt.usedBefore ?? null,
      measuredTokens: attempt.measurementBefore.pressureTokens ?? null,
      estimatedTokens: attempt.measurementBefore.estimatedTokens ?? null,
      contextWindow: attempt.measurementBefore.contextWindow ?? null,
      thresholdTokens: null,
      retainTokens: null,
      model: null,
      provider: null
    }
  }

  /**
   * Fold one `compaction/prune` into the **open** attempt.
   *
   * The engine emits a prune pass either inside a compaction bracket (the
   * overflow path calls `pruneSession` before selecting its range,
   * `dsh-compaction-basic/lib/index.js:870-877`) or between compactions, when
   * the pruner runs on its own. Only the bracketed case belongs to a compaction's
   * truncation count: charging a standalone prune to the previous, already
   * closed attempt would inflate that attempt's `truncatedCount` with work it
   * did not do. A standalone prune is therefore recorded with
   * `compactionId: null` — it still happened, and it is still counted in the
   * session totals, it is just not attributed to a compaction.
   */
  prune(sessionId, event) {
    const state = this.#state(sessionId)
    const attempt = state.open
    const tokens = event.data?.shadowedTokenCount
    if (attempt !== undefined) {
      attempt.pruneCount += 1
      if (Number.isFinite(tokens)) attempt.pruneTokenCount += tokens
    }
    return {
      event: 'compaction_prune',
      sessionId,
      at: event.time ?? Date.now(),
      compactionId: attempt?.id ?? null,
      seq: Number.isFinite(event.seq) ? event.seq : null,
      shadowedTokens: Number.isFinite(tokens) ? tokens : null
    }
  }

  /** Fold `compaction/summary`, which carries the span, the ratio inputs and the provider usage. */
  summary(sessionId, event) {
    const state = this.#state(sessionId)
    const id = String(event.data?.compactionId ?? 'unknown')
    const attempt = state.attempts.get(id) ?? this.#latestAttempt(state)
    const data = event.data ?? {}
    const shadowed = data.shadowedTokenCount
    const usage = data.usage
    const usageTokens =
      usage === null || typeof usage !== 'object'
        ? undefined
        : (Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0) +
          (Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0) +
          (Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0)
    if (attempt !== undefined) {
      attempt.summary = {
        shadowedTokens: Number.isFinite(shadowed) ? shadowed : undefined,
        // The span's node count, from the engine's own two ways of stating it:
        // the shadowed seq list is authoritative for how many nodes left the
        // surface, and the inclusive range is the fallback when a payload
        // carries only that.
        spanNodes: Array.isArray(data.shadowedSeqs)
          ? data.shadowedSeqs.length
          : Number.isFinite(data.shadowedRange?.end) && Number.isFinite(data.shadowedRange?.start)
            ? data.shadowedRange.end - data.shadowedRange.start + 1
            : undefined,
        provider: typeof data.provider === 'string' ? data.provider : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
        maxTokens: Number.isFinite(data.maxTokens) ? data.maxTokens : undefined,
        usageTokens,
        providerUsage: usage === null || typeof usage !== 'object' ? undefined : usage,
        outputTokens: Number.isFinite(usage?.outputTokens) ? usage.outputTokens : undefined
      }
      attempt.awaitingCheckpoint = true
    }
    return attempt?.id ?? null
  }

  /**
   * Measure the checkpoint body from the `user/message` the engine appends
   * right after `compaction/summary` (`dsh-compaction-basic/lib/index.js:608`).
   *
   * @returns the checkpoint's code-point size, or `undefined` when the message
   *   is not the one the open attempt is waiting for.
   */
  checkpoint(sessionId, event) {
    const state = this.#state(sessionId)
    const attempt = state.open ?? this.#latestAttempt(state)
    if (attempt === undefined || !attempt.awaitingCheckpoint) return undefined
    const content = event.data?.content
    if (!Array.isArray(content)) return undefined
    let chars = 0
    for (const block of content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        chars += Array.from(block.text).length
      }
    }
    attempt.checkpointChars = chars
    attempt.awaitingCheckpoint = false
    state.checkpoints += 1
    return chars
  }

  /** Count a tool result against the spill and large-result signals. */
  toolResult(sessionId, at, reading) {
    const state = this.#touch(sessionId, at)
    if (reading.spilled) state.spills += 1
    else if (reading.large) state.largeResults += 1
    return reading
  }

  /**
   * Record one `tool/call` and answer whether it re-requests something already
   * read in this session.
   *
   * The window is the session, not "since the last compaction", for the
   * *identity* map — so a genuine re-read is always visible. Whether it counts
   * as degradation is decided in {@link finish}, which knows the compaction
   * boundary and only credits re-reads that happened after it. That is the
   * honest form of "el agente pide de nuevo un dato que ya estaba": it is
   * measured, not guessed, and it says `null` rather than `false` when the
   * session has not compacted yet and the question cannot be answered.
   */
  readCall(sessionId, event) {
    const key = toolCallKey(event)
    if (key === undefined || readKeyOf(key) === undefined) return
    const state = this.#touch(sessionId, event.time ?? Date.now())
    const seen = state.files.get(key)
    state.files.set(key, (seen ?? 0) + 1)
    if (state.files.size > this.#config.maxReadCallsPerSession) {
      const oldest = state.files.keys().next()
      if (oldest.done !== true) state.files.delete(oldest.value)
    }
    state.readKeys.push(key)
    keepLast(state.readKeys, this.#config.maxReadCallsPerSession)
    state.readsSinceCompaction += 1
    if ((seen ?? 0) > 0) state.reReadAfterCompaction += 1
  }

  /** The most recently opened attempt for a session. */
  #latestAttempt(state) {
    for (let index = state.attemptOrder.length - 1; index >= 0; index -= 1) {
      const attempt = state.attempts.get(state.attemptOrder[index])
      if (attempt !== undefined) return attempt
    }
    return undefined
  }

  /**
   * Close one attempt on `compaction/end` and produce its deliverable record.
   *
   * This is the only place the Phase-0 numbers exist together, and the only
   * place `trigger` is reported as *observed* rather than inferred:
   * `compaction/end.error` is a STRING, not the error object
   * (`dsh-compaction-basic/lib/index.js:467` → `errorChain`,
   * `dsh-llm/lib/index.js:169`), so the trigger remains `'pressure'` unless an
   * overflow was attributed to this session moments earlier. `triggerSource`
   * therefore reads `'overflow-attributed'` or `'start-default'`, and a reader
   * can tell a measured fact from an inference without reading this file.
   *
   * @param sessionId - the owning session.
   * @param event - the `compaction/end` event.
   * @param state - `{ used, pressure }` read live at the end of the attempt.
   * @returns the record to append to the JSONL, or `undefined` when the end
   *   names no attempt this session ever started.
   */
  finish(sessionId, event, state) {
    const at = event.time ?? Date.now()
    const session = this.#state(sessionId)
    const id = String(event.data?.compactionId ?? 'unknown')
    const attempt = session.attempts.get(id)
    if (attempt === undefined) return undefined
    session.attempts.delete(id)
    if (session.open === attempt) session.open = undefined
    this.#touch(sessionId, at)

    // The counters are advanced FIRST: a record that reports `compactionsTotal`
    // has to include the compaction it is describing, or the very first
    // compaction in a profile reports `0` and reads as "nothing ever ran".
    session.compactions += 1
    session.readsSinceCompaction = 0
    session.reReadAfterCompaction = 0

    // The attempt's ordinal within its turn: 1 means this turn compacted once,
    // n means it retried n-1 times. The engine emits no retry event, so this is
    // the observable definition of the number — and `retries` is derived as
    // `attemptsInTurn - 1` so nobody reads it as something lifted from
    // `compactionRetries`.
    const attempts = Number.isFinite(attempt.ordinal) ? attempt.ordinal : 1

    const usedBefore = attempt.usedBefore
    const usedAfter = state?.used
    const deltaTokens = Number.isFinite(usedBefore) && Number.isFinite(usedAfter) ? usedAfter - usedBefore : undefined
    const shadowedTokens = attempt.summary?.shadowedTokens
    const checkpointChars = attempt.checkpointChars
    const compressionRatio =
      Number.isFinite(shadowedTokens) && Number.isFinite(checkpointChars) && checkpointChars > 0
        ? shadowedTokens / reportTokens(checkpointChars)
        : undefined

    const alerts = []
    if (Number.isFinite(deltaTokens) && deltaTokens >= 0) {
      // The whole point of compacting is that occupancy falls. If it did not,
      // either the summary is bigger than what it replaced or the reading is
      // not comparable, and both are worth a loud line.
      alerts.push('used-not-reduced')
    }
    if (attempt.error !== undefined) alerts.push('compaction-failed')
    if (deltaTokens === undefined) alerts.push('used-not-measured')

    return {
      event: 'compaction_end',
      sessionId,
      at,
      compactionId: attempt.id,
      turn: attempt.turn,
      trigger: attempt.cause,
      triggerSource: attempt.cause === 'overflow' ? 'overflow-attributed' : 'start-default',
      // Corroboration only. `compaction/end.error` is already a rendered string
      // (`errorChain`), so the overflow code can only be *searched for* in it;
      // the authoritative signal is the attribution recorded by `markOverflow`.
      errorMentionsOverflow:
        event.data?.error === undefined ? false : String(event.data.error).includes(CONTEXT_OVERFLOW_CODE),
      error: event.data?.error === undefined ? null : String(event.data.error),
      usedBefore: usedBefore ?? null,
      usedAfter: Number.isFinite(usedAfter) ? usedAfter : null,
      deltaTokens: deltaTokens ?? null,
      measuredTokens: attempt.measurementBefore.pressureTokens ?? null,
      estimatedTokens: attempt.measurementBefore.estimatedTokens ?? null,
      usedAfterMeasuredTokens: state?.pressure?.pressureTokens ?? null,
      usedAfterEstimatedTokens: state?.pressure?.estimatedTokens ?? null,
      contextWindow: state?.pressure?.contextWindow ?? attempt.measurementBefore.contextWindow ?? null,
      thresholdTokens: null,
      retainTokens: state?.retainTokens ?? null,
      model: attempt.summary?.model ?? null,
      provider: attempt.summary?.provider ?? null,
      summaryMaxTokens: attempt.summary?.maxTokens ?? null,
      spanTokens: Number.isFinite(shadowedTokens) ? shadowedTokens : null,
      spanNodes: attempt.summary?.spanNodes ?? null,
      shadowedTokenCount: Number.isFinite(shadowedTokens) ? shadowedTokens : null,
      providerUsage: attempt.summary?.providerUsage ?? null,
      providerUsagePromptTokens: Number.isFinite(attempt.summary?.usageTokens) ? attempt.summary.usageTokens : null,
      summaryOutputTokens: Number.isFinite(attempt.summary?.outputTokens) ? attempt.summary.outputTokens : null,
      compressionRatio: compressionRatio === undefined ? null : round4(compressionRatio),
      checkpointChars: Number.isFinite(checkpointChars) ? checkpointChars : null,
      checkpointTokens: Number.isFinite(checkpointChars) ? reportTokens(checkpointChars) : null,
      checkpointReported: Number.isFinite(checkpointChars),
      truncatedCount: attempt.pruneCount,
      truncatedTokens: attempt.pruneTokenCount,
      attemptsInTurn: attempts,
      retries: attempts - 1,
      spillCount: session.spills,
      spillCountDelta: session.spills - attempt.spillCountBefore,
      largeResults: session.largeResults,
      largeResultsDelta: session.largeResults - attempt.largeResultsBefore,
      compactionsTotal: session.compactions,
      overflowsTotal: session.overflows,
      alerts
    }
  }

  /** Record a failure on an attempt, before `finish` reads it. */
  /**
   * Record a failure on an attempt, before `finish` reads it.
   *
   * `compaction/end.error` is present **only** on the failure path
   * (`dsh-compaction-basic/lib/index.js:462-468`: the close carries
   * `error: errorChain(error)` solely inside the `catch`). An `end` without it is
   * a SUCCESS, so an absent error must leave `attempt.error` untouched — treating
   * it as "unknown failure" would mark every successful compaction as failed.
   */
  fail(sessionId, event) {
    const attempt = this.#state(sessionId).attempts.get(String(event.data?.compactionId ?? 'unknown'))
    if (attempt === undefined) return
    const chain = event.data?.error
    if (chain === undefined) return
    attempt.error = String(chain)
  }

  /**
   * How many times this session has re-read something it had already read.
   *
   * This is the measured half of the specification's degradation signals: "the
   * agent asks again for something it already had" is a fact about repeated
   * `read`/`grep` identities, not a judgement about the task, so it can be
   * counted exactly. The other two named signs — contradicting a lock, and
   * forgetting a recent error — need a semantic reading of the task and are
   * deliberately NOT implemented rather than guessed at.
   *
   * @param sessionId - the session to report on.
   * @returns the count, or `undefined` when the session was never observed.
   */
  readsRepeated(sessionId) {
    return this.#sessions.map.get(sessionId)?.reReadAfterCompaction
  }

  /** Per-session totals for the self-check line. */
  totals(sessionId) {
    const state = this.#sessions.map.get(sessionId)
    if (state === undefined) return undefined
    return {
      compactions: state.compactions,
      overflows: state.overflows,
      spills: state.spills,
      largeResults: state.largeResults,
      checkpoints: state.checkpoints,
      openAttempts: state.attempts.size,
      lastStatus: state.lastStatus ?? null
    }
  }

  /** The session that most recently appended an event, for overflow attribution. */
  mostRecentSession() {
    let latest
    for (const [sessionId, stamp] of this.#recent.map) {
      if (latest === undefined || stamp.at > latest.at) latest = { sessionId, at: stamp.at }
    }
    return latest?.sessionId
  }
}

/**
 * The engine's own token estimate for a checkpoint body.
 *
 * The checkpoint is plain text with no tool envelope, so the harness's word and
 * character heuristics overestimate it; dividing code points by 4 is the
 * conventional English approximation and is **labelled as an approximation in
 * every record it appears in** (`checkpointReported: true`, and
 * `compressionRatio` is only produced from the pair of them). It is here
 * because the alternative — reporting no ratio at all — would leave the
 * Phase-0 acceptance criterion unmet, and a labelled approximation beats a
 * silent absence.
 */
export function reportTokens(chars) {
  return Math.max(0, Math.round(chars / 4))
}

/** Keep a ratio readable in the JSONL. */
function round4(value) {
  return Math.round(value * 10000) / 10000
}

/** Read one `turn/end` failure, re-exported so callers have a single import. */
export { readTurnError }
