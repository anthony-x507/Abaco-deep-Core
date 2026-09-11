/**
 * Principle D — literal error transcription for the summarizer.
 *
 * `buildSummarizationInput` (`dsh-compaction-basic/lib/index.js:651-653`)
 * filters nothing, so an error enters the corpus and "## Errors and Fixes"
 * asks the model to condense ("how it was resolved"). This module:
 *
 * 1. pulls `isError` tool results *out* of the corpus
 * 2. appends them to the checkpoint as `ERROR | tool | raw message`
 *
 * Truncating a stack by bytes is allowed. Paraphrase is not.
 *
 * @module abaco-context/lib/literal-errors
 */

/** Prefix of every retained error line. */
export const ERROR_LINE_PREFIX = 'ERROR |'

/** Heading prepended to the checkpoint when any error was pulled out. */
export const LITERAL_ERRORS_HEADING = '## Errors and Fixes (literal)'

/** Longest raw error body kept on one line (bytes). Stacks past this are cut. */
export const ERROR_BODY_MAX_BYTES = 4000

/**
 * Format one retained error. Truncates the body by UTF-8 bytes; never rewrites.
 *
 * @param tool - tool name, or `'unknown'`.
 * @param message - raw error text.
 * @returns `ERROR | tool | raw`.
 */
export function formatLiteralError(tool, message) {
  const name = typeof tool === 'string' && tool.length > 0 ? tool : 'unknown'
  const raw = typeof message === 'string' ? message.replace(/\s+/gu, ' ').trim() : String(message ?? '')
  return `${ERROR_LINE_PREFIX} ${name} | ${truncateBytes(raw, ERROR_BODY_MAX_BYTES)}`
}

/**
 * Pull error tool-results out of a summarization input.
 *
 * @param input - `{ system?, tools?, messages }`.
 * @returns `{ input, literals }` — `input` is a copy with errors removed.
 */
export function extractLiteralErrors(input) {
  const messages = Array.isArray(input?.messages) ? input.messages : []
  const kept = []
  const literals = []
  for (const message of messages) {
    const extracted = literalsFromMessage(message)
    if (extracted.length === 0) {
      kept.push(message)
      continue
    }
    literals.push(...extracted)
    const remainder = messageWithoutErrorResults(message)
    if (remainder !== undefined) kept.push(remainder)
  }
  return {
    input: { ...input, messages: kept },
    literals
  }
}

/**
 * Prepend literal error lines to a summary result.
 *
 * @param result - a `SummaryResult`.
 * @param literals - lines from {@link formatLiteralError}.
 * @returns the result, with literals in front of the first text block.
 */
export function prependLiteralErrors(result, literals) {
  if (!Array.isArray(literals) || literals.length === 0) return result
  const block = `${LITERAL_ERRORS_HEADING}\n${literals.map((line) => `- ${line}`).join('\n')}\n`
  const summary = Array.isArray(result?.summary) ? [...result.summary] : []
  const first = summary[0]
  if (first !== null && typeof first === 'object' && first.type === 'text' && typeof first.text === 'string') {
    summary[0] = { ...first, text: `${block}\n${first.text}` }
  } else {
    summary.unshift({ type: 'text', text: block })
  }
  return { ...result, summary }
}

/**
 * Wrap `engine.summarize` so errors leave the corpus and land verbatim.
 *
 * @param original - the bound `summarize` method.
 * @param input - summarization input.
 * @param agent - owner of the session.
 * @param signal - cancellation.
 * @returns the original result with literals prepended.
 */
export async function summarizeWithLiteralErrors(original, input, agent, signal) {
  const { input: cleaned, literals } = extractLiteralErrors(input)
  const result = await original(cleaned, agent, signal)
  return prependLiteralErrors(result, literals)
}

/** `ERROR | …` lines from one message. */
function literalsFromMessage(message) {
  const results = toolResultsOf(message)
  const lines = []
  for (const result of results) {
    if (result.isError !== true) continue
    const text = flattenText(result.content)
    lines.push(formatLiteralError(result.name, text))
  }
  return lines
}

/**
 * A copy of `message` with error tool-results removed. `undefined` when the
 * message was only those errors (drop it from the corpus entirely).
 */
function messageWithoutErrorResults(message) {
  const content = message?.content
  if (!Array.isArray(content)) return message
  const kept = content.filter((block) => {
    if (block === null || typeof block !== 'object') return true
    if (block.type === 'tool-result' || block.type === 'tool_result') return block.isError !== true
    if (Array.isArray(block.content) && block.isError === true) return false
    return true
  })
  if (kept.length === content.length) return message
  if (kept.length === 0) return undefined
  return { ...message, content: kept }
}

/** Tool-result payloads on a message, covering the shapes the engine uses. */
function toolResultsOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return []
  const found = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.isError === true || block.type === 'tool-result' || block.type === 'tool_result') {
      found.push(block)
      continue
    }
    if (Array.isArray(block.content) && (block.isError === true || typeof block.name === 'string')) {
      found.push(block)
    }
  }
  return found
}

function flattenText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function truncateBytes(text, budget) {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= budget) return text
  let end = budget
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return `${buffer.subarray(0, end).toString('utf8')}…`
}
