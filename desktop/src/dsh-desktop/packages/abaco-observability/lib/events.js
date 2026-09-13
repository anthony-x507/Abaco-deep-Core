/**
 * Pure readers over the engine's own event and projection shapes.
 *
 * Every function here is written against a shape that was read out of the
 * engine **ABACO actually runs** — the packaged bundle, not the DeepSeek app's
 * copy and not a repository copy presented as if it were the runtime:
 *
 * ```
 * $DSH_NM = /Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai
 * ```
 *
 * **Rule: without naming which of the three copies, the datum is not used.**
 * The three are the ABACO bundle (authoritative for runtime), the DeepSeek
 * Desktop bundle (another product), and `desktop/src/dsh-desktop/node_modules`
 * (the build input). Every file cited in the table below was verified
 * md5-identical across all three at the time of writing, so each citation names
 * the authoritative one and holds for any of them.
 *
 * | Shape | Source (ABACO bundle; md5-identical in all three copies) |
 * |---|---|
 * | `SessionEvent = { type, seq, time, data }` | `dsh-session/lib/index.js:1416-1422` |
 * | `compaction/start` = `{ compactionId, sourceCommandId?, turn }` | `dsh-compaction-basic/lib/index.js:434-439` |
 * | `compaction/summary` = `{ compactionId, summary, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | `dsh-compaction-basic/lib/index.js:592-602` |
 * | `compaction/end` = `{ compactionId, turn, error? }` where `error` is a STRING | `dsh-compaction-basic/lib/index.js:454`, `:462-468` + `errorChain` (`dsh-llm/lib/index.js:169`) |
 * | `compaction/prune` = `{ shadowedRange, shadowedSeqs, shadowedTokenCount }` | `dsh-compaction-tool-result-pruner/lib/index.js:162-168` |
 * | the compact checkpoint is the `user/message` that immediately follows `compaction/summary` | `dsh-compaction-basic/lib/index.js:608-615` |
 * | `contextPressure` view = `{ contextWindow?, pressureTokens?, projectedTokens? }` | `dsh-token-meter/lib/index.js:405-409` |
 * | spill notice text = `(N bytes omitted… Full formatted result stored at: <locator>. <hint>)` | `dsh-spill-policy/lib/index.js:81-83` |
 *
 * Nothing in this module throws on a missing field. A telemetry reader that
 * dies on an unexpected payload is worse than one that records `null` and says
 * so: the whole point is to observe a system whose payloads are not fully
 * specified.
 *
 * @module abaco-observability/lib/events
 */

/**
 * The substrings the stock spill policy puts in place of an oversized result.
 *
 * Both come from `dsh-spill-policy/lib/index.js:81-83`; the second is the
 * absolute locator the model is told to `read`. Matching on the pair rather
 * than on either alone keeps an ordinary tool result that merely mentions the
 * phrase from being counted as a spill.
 */
export const SPILL_MARKERS = Object.freeze([
  'Full formatted result stored at:',
  'bytes omitted'
])

/**
 * Count the code points of a tool result's text blocks, exactly as the pruner
 * prices them (`dsh-compaction-tool-result-pruner/lib/index.js:79-83`).
 *
 * Code points, not UTF-16 units: `Array.from` is the same primitive the engine
 * uses, so a record's size and the engine's own budget agree on astral text.
 *
 * @param content - a `ToolResult.content` block array, or anything else.
 * @returns the code-point count of its text blocks.
 */
export function measureTextBlocks(content) {
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      chars += Array.from(block.text).length
    }
  }
  return chars
}

/**
 * Flatten the text of a block array the way the spill policy does before it
 * decides to spill (`flattenPlainText`, `dsh-spill-policy/lib/index.js`).
 *
 * @param content - a `ToolResult.content` block array.
 * @returns the concatenated text, or `undefined` when the result carries no
 *   plain text at all — the policy only ever spills plain-text results.
 */
export function flattenText(content) {
  if (!Array.isArray(content)) return undefined
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object' || block.type !== 'text') continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** Whether a tool-result's text carries the stock spill notice. */
export function looksSpilled(text) {
  if (typeof text !== 'string') return false
  return SPILL_MARKERS.every((marker) => text.includes(marker))
}

/**
 * Read one `tool/result` event into the spill/large-result signals.
 *
 * @param event - a `tool/result` session event.
 * @param maxInlineBytes - the composed spill policy's ceiling.
 * @returns `{ bytes, chars, name, isError, spilled, large }`, or `undefined`
 *   when the event is not a well-formed tool result.
 */
export function readToolResult(event, maxInlineBytes) {
  const message = event?.data?.message
  const result = Array.isArray(message?.content) ? message.content[0] : undefined
  if (result === null || typeof result !== 'object') return undefined
  const content = result.content
  const text = flattenText(content)
  const chars = measureTextBlocks(content)
  const bytes = text === undefined ? 0 : Buffer.byteLength(text, 'utf8')
  return {
    name: typeof result.name === 'string' ? result.name : 'unknown',
    chars,
    bytes,
    isError: result.isError === true,
    spilled: looksSpilled(text),
    large: Number.isFinite(maxInlineBytes) && bytes > maxInlineBytes
  }
}

/**
 * The identity of a tool call for "did the agent ask for this twice?" purposes.
 *
 * The engine's own `tool/call` payload is
 * `{ turn, step, callId, name, arguments }` with `arguments` a JSON **string**
 * (`dsh-session` `SessionEventMap`). Only the arguments that name a thing are
 * kept: for `read`/`grep` the path, for `bash`/`pwsh` the command, otherwise
 * the whole argument string. Two calls that differ in an offset are still the
 * same read of the same file, which is precisely the re-request this measures.
 *
 * @param event - a `tool/call` session event.
 * @returns an opaque key, or `undefined` when the call cannot be keyed.
 */
export function toolCallKey(event) {
  const name = event?.data?.name
  if (typeof name !== 'string') return undefined
  const raw = event.data.arguments
  if (typeof raw !== 'string') return `${name}()`
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return `${name}(${raw})`
  }
  if (parsed === null || typeof parsed !== 'object') return `${name}(${raw})`
  const subject = typeof parsed.path === 'string' ? parsed.path : typeof parsed.command === 'string' ? parsed.command : undefined
  return subject === undefined ? `${name}(${raw})` : `${name}(${subject})`
}

/**
 * Read the `error` leg of a `turn/end` reason.
 *
 * `turn/end.reason` is a `TurnEndReasonMap` member; the agent loop writes
 * `{ kind: 'error', error: { message, code } }` on the failure path
 * (`dsh-agent-loop/lib/index.js:586-592`). Any other `kind` yields `undefined`.
 *
 * @param event - a `turn/end` session event.
 * @returns `{ code, message }`, or `undefined`.
 */
export function readTurnError(event) {
  const reason = event?.data?.reason
  if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') return undefined
  const failure = reason.error
  if (failure === null || typeof failure !== 'object') return { code: 'UNKNOWN', message: undefined }
  return {
    code: typeof failure.code === 'string' ? failure.code : 'UNKNOWN',
    message: typeof failure.message === 'string' ? failure.message : undefined
  }
}

/**
 * Read `contextPressure` for one session.
 *
 * Two sources, tried in order, because they answer at different times:
 *
 * 1. `sessionProjections.snapshot(session, ['contextPressure'])` — the registry
 *    folds lazily up to the session's own cursor (`cellFor` →
 *    `advanceCell(… cursorBefore(session.seq))`,
 *    `dsh-session-projection/lib/index.js:378-399`), so a synchronous read from
 *    inside a `session/event` listener already includes the event that fired
 *    the listener. That is what makes `pressureTokens` readable at
 *    `compaction/start` instead of one event late.
 * 2. `tokenMeter.measure(session).totalTokens` — the engine's own estimate,
 *    which is what the compaction threshold is actually compared against
 *    (`dsh-compaction-basic/lib/index.js:883-888`). Recorded separately so
 *    `pressureTokens` and the estimate can be compared rather than conflated.
 *
 * @param options - `{ sessionProjections, tokenMeter, session }`.
 * @returns `{ contextWindow, pressureTokens, projectedTokens, estimatedTokens }`
 *   with absent members omitted.
 */
export function readPressure({ sessionProjections, tokenMeter, session }) {
  const out = {}
  if (sessionProjections !== undefined && typeof sessionProjections.snapshot === 'function') {
    try {
      const snapshot = sessionProjections.snapshot(session, ['contextPressure'])
      const pressure = snapshot?.values?.contextPressure
      if (pressure !== null && typeof pressure === 'object') {
        if (Number.isFinite(pressure.contextWindow)) out.contextWindow = pressure.contextWindow
        if (Number.isFinite(pressure.pressureTokens)) out.pressureTokens = pressure.pressureTokens
        if (Number.isFinite(pressure.projectedTokens)) out.projectedTokens = pressure.projectedTokens
      }
    } catch {
      // A projection that cannot be read is reported as absent, never fatal.
    }
  }
  if (tokenMeter !== undefined && typeof tokenMeter.measure === 'function') {
    try {
      const measurement = tokenMeter.measure(session)
      if (Number.isFinite(measurement?.totalTokens)) out.estimatedTokens = measurement.totalTokens
    } catch {
      // Same rule: telemetry degrades, the turn does not.
    }
  }
  return out
}

/**
 * Whether an observed failure is the provider saying the request did not fit.
 *
 * The constant is the engine's own
 * (`CONTEXT_WINDOW_EXCEEDED_CODE`, `dsh-llm/lib/index.js:111`), and it is
 * exactly the condition under which `compaction-basic` runs its
 * `context-overflow` recovery (`dsh-compaction-basic/lib/index.js:805`).
 */
export const CONTEXT_OVERFLOW_CODE = 'CONTEXT_WINDOW_EXCEEDED'
