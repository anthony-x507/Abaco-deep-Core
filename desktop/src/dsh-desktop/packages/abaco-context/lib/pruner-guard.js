/**
 * Principle D — the guard that *acts* on `isError`.
 *
 * The stock pruner (`dsh-compaction-tool-result-pruner/lib/index.js:137-194`)
 * walks every `tool/result` on the current surface and calls `pruneContent`
 * (`:91-124`) with no condition. The `isError` mark survives the replace
 * (`:157-160`) but nothing reads it. This module is the missing guard: if
 * `content[0].isError === true`, do not prune.
 *
 * The loop is the stock one plus that one `continue`. Pressure (`:886`) and
 * overflow (`:872`) both call `pruneSession`, so wrapping the method covers
 * both routes.
 *
 * @module abaco-context/lib/pruner-guard
 */

/**
 * Whether a tool-result payload must stay verbatim.
 *
 * @param result - `event.data.message.content[0]`.
 * @returns true when Principle D forbids `pruneContent`.
 */
export function isProtectedErrorResult(result) {
  return result !== null && typeof result === 'object' && result.isError === true
}

/**
 * Stock `pruneSession` with the isError guard.
 *
 * @param pruner - a `toolResultPruner` instance (uses `pruneContent`,
 *   `measureContent`, `ctx.tokenMeter`).
 * @param session - the session whose current surface is rewritten.
 * @returns `{ pruned, charsRemoved, skippedErrors }` in the stock shape, plus
 *   how many error results were left untouched.
 */
export function pruneSessionGuarded(pruner, session) {
  const candidates = []
  const nodes = session?.surface?.nodes
  if (nodes === undefined || typeof session.eventAt !== 'function') {
    return { pruned: [], charsRemoved: 0, skippedErrors: 0 }
  }
  for (const seq of [...nodes]) {
    const event = session.eventAt(seq)
    if (event?.type === 'tool/result') candidates.push({ seq, event })
  }
  const pruned = []
  let charsRemoved = 0
  let skippedErrors = 0
  for (const { seq, event } of candidates) {
    const result = event?.data?.message?.content?.[0]
    if (isProtectedErrorResult(result)) {
      skippedErrors += 1
      continue
    }
    if (result === null || typeof result !== 'object' || !Array.isArray(result.content)) continue
    const content = pruner.pruneContent(result.content)
    if (content === null) continue
    const charsBefore = pruner.measureContent(result.content)
    const charsAfter = pruner.measureContent(content)
    const message = freezeLike(pruner, {
      ...event.data.message,
      content: [{ ...result, content }]
    })
    if (typeof session.append === 'function') {
      session.append(
        'compaction/prune',
        {
          shadowedRange: { start: seq, end: seq },
          shadowedSeqs: [seq],
          shadowedTokenCount: estimateMessage(pruner, event.data.message),
          isError: false
        }
      )
      const replacement = session.append(
        'tool/result',
        { ...event.data, message },
        {
          surfaceOp: { op: 'replace', start: seq, end: seq },
          sourceEventSeqs: [seq]
        }
      )
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement?.seq,
        callId: event.data?.message?.source?.callId,
        charsBefore,
        charsAfter
      })
    }
    charsRemoved += charsBefore - charsAfter
  }
  return { pruned, charsRemoved, skippedErrors }
}

/**
 * Install the guard on a live pruner. The instance method is what
 * `compactIfNeeded` calls via `ctx.get("toolResultPruner")`.
 *
 * @param pruner - the composed `toolResultPruner`.
 * @returns the same instance.
 */
export function wrapPruner(pruner) {
  if (pruner === null || typeof pruner !== 'object') return pruner
  pruner.pruneSession = function pruneSession(session) {
    return pruneSessionGuarded(pruner, session)
  }
  return pruner
}

/** Prefer the engine's freezer; fall back to a structured clone. */
function freezeLike(pruner, message) {
  const freeze = pruner?.ctx?.llm === undefined ? undefined : undefined
  if (typeof pruner?.freezeMessage === 'function') return pruner.freezeMessage(message)
  if (typeof freeze === 'function') return freeze(message)
  return message
}

/** Token estimate for the prune event; zero when the meter is absent. */
function estimateMessage(pruner, message) {
  try {
    const estimate = pruner?.ctx?.tokenMeter?.estimateMessage
    if (typeof estimate === 'function') return estimate(message)
  } catch {
    // Telemetry of a missing meter is not worth failing a prune.
  }
  return 0
}
