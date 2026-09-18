/**
 * Pure session-analytics helpers. Node tests import this file directly.
 *
 * The renderer `__ModuleLoader__` factory cannot `require('./lib/summary.js')`:
 * that specifier is not a platform seed, and electron-builder copying this
 * file into `Resources/app/node_modules` (asar:false) does not register it
 * on the client module table. Materialize these bindings into `client.js`
 * (`scripts/client-module-table.mjs`). Do not list this path as a seed or
 * bundler external.
 */

/** A composer-dock / footer strip that belongs in Settings, not under the box. */
export const ANALYTICS_STRIP_MARKERS = [
  /\bturns?\b/i,
  /\bsteps?\b/i,
  /\bTTFT\b/i,
  /cache\s*hit/i,
  /tool\s*call/i,
  /tok\/s/i,
  /\bLLM\b/,
]

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isAnalyticsStripText(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length < 8) return false
  let hits = 0
  for (const marker of ANALYTICS_STRIP_MARKERS) {
    if (marker.test(value)) hits += 1
  }
  return hits >= 2
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function asFiniteNumber(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Provider usage blobs are not one shape. Read the common token fields.
 * @param {unknown} usage
 * @returns {{ input: number, cached: number, output: number }}
 */
export function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return { input: 0, cached: 0, output: 0 }
  const row = /** @type {Record<string, unknown>} */ (usage)
  const input = firstNumber(row, [
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
    'input_tokens',
    'promptCacheMissTokens',
  ])
  const cached = firstNumber(row, [
    'cacheReadTokens',
    'cached_tokens',
    'prompt_cache_hit_tokens',
    'cache_read_input_tokens',
    'cacheHits',
    'cachedTokens',
  ])
  const output = firstNumber(row, [
    'outputTokens',
    'completion_tokens',
    'completionTokens',
    'output_tokens',
  ])
  return { input, cached, output }
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keys
 */
function firstNumber(row, keys) {
  for (const key of keys) {
    const n = asFiniteNumber(row[key])
    if (n != null) return n
  }
  return 0
}

/**
 * @param {unknown} nodes
 * @returns {{
 *   turns: number,
 *   steps: number,
 *   llmMs: number,
 *   toolMs: number,
 *   ttftAvgMs: number | null,
 *   ttftMinMs: number | null,
 *   ttftMaxMs: number | null,
 *   inputTokens: number,
 *   cachedTokens: number,
 *   outputTokens: number,
 *   cacheHitRate: number | null,
 *   requestCount: number,
 * }}
 */
export function summarizeChatNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  const assistants = list.filter((node) => node && node.kind === 'assistant')
  let maxTurn = 0
  let maxStep = 0
  let llmMs = 0
  let toolMs = 0
  /** @type {number[]} */
  const ttfts = []
  let inputTokens = 0
  let cachedTokens = 0
  let outputTokens = 0

  for (const node of assistants) {
    const turn = asFiniteNumber(node.turn)
    const step = asFiniteNumber(node.step)
    if (turn != null) maxTurn = Math.max(maxTurn, turn)
    if (step != null) maxStep = Math.max(maxStep, step)

    const timing = node.timing && typeof node.timing === 'object' ? node.timing : {}
    const start = asFiniteNumber(timing.stepStartTime)
    const first = asFiniteNumber(timing.firstTokenTime)
    const done = asFiniteNumber(timing.completedTime)
    if (start != null && first != null && first >= start) ttfts.push(first - start)
    if (first != null && done != null && done >= first) llmMs += done - first
    else if (start != null && done != null && done >= start) llmMs += done - start

    const usage = readUsage(node.usage)
    inputTokens += usage.input
    cachedTokens += usage.cached
    outputTokens += usage.output
  }

  toolMs = sumToolMs(list, assistants)

  const billed = inputTokens + cachedTokens
  return {
    turns: maxTurn || assistants.length,
    steps: maxStep || assistants.length,
    llmMs,
    toolMs,
    ttftAvgMs: average(ttfts),
    ttftMinMs: ttfts.length ? Math.min(...ttfts) : null,
    ttftMaxMs: ttfts.length ? Math.max(...ttfts) : null,
    inputTokens,
    cachedTokens,
    outputTokens,
    cacheHitRate: billed > 0 ? cachedTokens / billed : null,
    requestCount: assistants.length,
  }
}

/**
 * Tool-call duration when the chat/trajectory nodes carry timestamps.
 * @param {unknown[]} list
 * @param {unknown[]} assistants
 */
function sumToolMs(list, assistants) {
  let total = 0
  for (const node of list) {
    if (!node || typeof node !== 'object') continue
    const kind = node.kind
    if (kind !== 'tool' && kind !== 'tool-call' && kind !== 'tool_call') continue
    const start = asFiniteNumber(node.startedAt ?? node.startTime ?? node.time)
    const end = asFiniteNumber(node.endedAt ?? node.endTime ?? node.completedTime)
    if (start != null && end != null && end >= start) total += end - start
  }
  if (total > 0) return total
  // Fallback: time-to-first-token is the wait that is not model decode.
  for (const node of assistants) {
    const timing = node && node.timing && typeof node.timing === 'object' ? node.timing : {}
    const start = asFiniteNumber(timing.stepStartTime)
    const first = asFiniteNumber(timing.firstTokenTime)
    if (start != null && first != null && first >= start) total += first - start
  }
  return total
}

/**
 * @param {number[]} values
 * @returns {number | null}
 */
function average(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return minutes ? `${hours}h${minutes}m` : `${hours}h`
  if (minutes > 0) return seconds ? `${minutes}m${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

/**
 * @param {number | null | undefined} n
 * @returns {string}
 */
export function formatTokens(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M tok`
  if (n >= 1e3) return `${Math.round(n / 100) / 10}K tok`
  return `${Math.round(n)} tok`
}

/**
 * @param {number | null | undefined} rate
 * @returns {string}
 */
export function formatPercent(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 1000) / 10}%`
}

/**
 * @param {number | null | undefined} minMs
 * @param {number | null | undefined} maxMs
 * @returns {string}
 */
export function formatTtftRange(minMs, maxMs) {
  if (minMs == null && maxMs == null) return '—'
  if (minMs != null && maxMs != null && minMs !== maxMs) {
    return `${formatDuration(minMs)}–${formatDuration(maxMs)}`
  }
  return formatDuration(minMs ?? maxMs)
}
