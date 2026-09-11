/**
 * Pure decision logic for `abaco-vault` (Layer 3 of the 3-layer context system,
 * design §5.2). NOTHING in this module touches the filesystem, the clock, the
 * environment or the Cordis context: every function is a total function of its
 * arguments, which is what makes the rewrite rules testable without booting the
 * harness (`test/abaco-vault.test.ts`).
 *
 * The three questions this module answers:
 *
 * 1. {@link planSettledRewrite} — given the text of a `subagent-settled` notice
 *    and the thresholds, do we shorten it, and where exactly do we cut?
 * 2. {@link renderOmittedNotice} — what is the model-facing recovery line? It
 *    mirrors the wording the stock spill policy produces from
 *    `describeOmitted(…, 'bytes')` + `retrievalHint`
 *    (`dsh-spill-policy/lib/index.js:81-83`, `dsh-spill-local/lib/index.js:564-566`),
 *    so the model sees one consistent shape whether the cut came from the stock
 *    policy or from us.
 * 3. {@link settledMessageText} — is this message shape one we recognize at all?
 *    The message vocabulary is the harness's, not ours (`user/message` with
 *    `source.kind === 'subagent-settled'`, built in
 *    `dsh-subagent/lib/index.js:1761-1796`), so an unrecognized shape must yield
 *    `undefined` — the caller then leaves the message byte-identical. A vault
 *    that mangles a message it does not understand is worse than no vault.
 *
 * @module abaco-vault/lib/plan
 */

/** Default cap, in UTF-8 bytes, above which a settlement notice is vaulted. */
export const DEFAULT_MAX_SETTLED_BYTES = 12000

/** Default number of leading lines kept inline. */
export const DEFAULT_HEAD_LINES = 20

/**
 * Fraction of `maxSettledBytes` the inline head may occupy.
 *
 * Line counting alone is not a bound: a report that is one 400 KB line has
 * 1 line and would survive a "first 20 lines" rule untouched. The head is
 * therefore also byte-bounded, which makes the replacement strictly smaller
 * than `maxSettledBytes` for every possible input.
 */
export const HEAD_BYTE_BUDGET_RATIO = 0.5

/** Floor for the head byte budget, so a tiny `maxSettledBytes` still says something. */
export const HEAD_MIN_BYTES = 256

/** Longest slug accepted in an artifact file name. */
const SLUG_MAX_LENGTH = 48

/** Slug used when neither the caller's slug nor the session id yields anything. */
const SLUG_FALLBACK = 'artifact'

/** A positive integer, or the caller's fallback. */
function positiveInteger(value, fallback) {
  return Number.isFinite(value) && Math.trunc(value) > 0 ? Math.trunc(value) : fallback
}

/**
 * UTF-8 byte length of a string.
 *
 * Bytes, not UTF-16 code units: the harness measures every cap this way
 * (`maxInlineBytes`, `maxReferenceBytes`), and the vault paths hold Spanish
 * prose where the two differ by ~15%.
 *
 * @param text - the text to measure.
 * @returns the number of bytes `text` occupies when encoded as UTF-8.
 */
export function utf8Bytes(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * Fold arbitrary text into a filesystem-safe slug.
 *
 * Accents are decomposed and dropped (`informe-ejecutivo`, not `informe-ejecutivó`)
 * so a locator stays readable in any terminal, and every character that is not
 * `[a-z0-9]` collapses to a single dash.
 *
 * @param value - the raw label (a summary, a tool name, a session id).
 * @param fallback - returned when nothing survives the fold.
 * @returns a lowercase slug of at most 48 characters.
 */
export function slugify(value, fallback = SLUG_FALLBACK) {
  const source = typeof value === 'string' ? value.normalize('NFKD') : ''
  const slug = source
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
  return slug.length > 0 ? slug : fallback
}

/**
 * File name of one vault artifact.
 *
 * The design fixes the shape `<epochMs>-<slug>.txt` (design §2.1, §5.2): the
 * timestamp makes a directory listing chronological without reading the index,
 * and the slug makes it greppable. `sessionId` is the fallback label when the
 * caller has no better slug — the session id itself is already the directory
 * name, so it is never repeated in the file name otherwise.
 *
 * @param sessionId - the session that owns the artifact.
 * @param epochMs - creation time, in epoch milliseconds.
 * @param slug - human-readable label for this artifact.
 * @returns the bare file name, never a path.
 */
export function artifactFileName(sessionId, epochMs, slug) {
  const stamp = Number.isFinite(epochMs) ? Math.max(0, Math.trunc(epochMs)) : 0
  const label = slugify(slug, '')
  const fallback = slugify(sessionId, SLUG_FALLBACK)
  return `${stamp}-${label.length > 0 ? label : fallback}.txt`
}

/**
 * The recovery line appended after the inline head.
 *
 * Same shape as the stock spill notice — an omission clause naming the exact
 * byte count, the absolute locator, and the retrieval hint — so the model
 * applies one recovery habit to both arms.
 *
 * @param omittedBytes - how many bytes of the original are not inline.
 * @param locator - absolute path of the durable artifact.
 * @returns the one-line notice.
 */
export function renderOmittedNotice(omittedBytes, locator) {
  const omitted = Number.isFinite(omittedBytes) ? Math.max(0, Math.trunc(omittedBytes)) : 0
  return `(se omitieron ${omitted} bytes. Resultado completo en: ${locator}. Usa read con offset/limit o grep sobre esa ruta.)`
}

/**
 * Cut `text` to at most `budget` UTF-8 bytes without splitting a character, and
 * prefer the last line break inside the budget so the head reads as whole lines.
 *
 * @param text - the text to cut.
 * @param budget - maximum number of UTF-8 bytes to keep.
 * @returns the cut text, always at most `budget` bytes.
 */
function cutToBytes(text, budget) {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= budget) return text
  let end = budget
  // Step back off a multi-byte sequence we would otherwise cut in half.
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  let slice = buffer.subarray(0, end).toString('utf8')
  const lastBreak = slice.lastIndexOf('\n')
  if (lastBreak > 0 && lastBreak >= Math.floor(slice.length / 2)) slice = slice.slice(0, lastBreak)
  return slice
}

/** The first `count` lines of `text`, additionally bounded to `byteBudget` bytes. */
function headOf(text, count, byteBudget) {
  const head = text.split('\n').slice(0, count).join('\n')
  return utf8Bytes(head) <= byteBudget ? head : cutToBytes(head, byteBudget)
}

/**
 * Decide how a settlement notice is shortened.
 *
 * `keep` is the answer for everything this function does not positively
 * recognize as worth cutting: a non-string, an empty text, a text within the
 * threshold, and — defensively — a cut that would not actually remove bytes.
 *
 * @param text - the full model-facing text of the notice.
 * @param config - `{ maxSettledBytes, headLines }`; both optional.
 * @returns `{ kind: 'keep', reason, bytes }` or
 *   `{ kind: 'rewrite', bytes, kept, omitted, head, headLines }`.
 */
export function planSettledRewrite(text, config) {
  const maxSettledBytes = positiveInteger(config?.maxSettledBytes, DEFAULT_MAX_SETTLED_BYTES)
  const headLines = positiveInteger(config?.headLines, DEFAULT_HEAD_LINES)
  if (typeof text !== 'string' || text.length === 0) return { kind: 'keep', reason: 'not-text', bytes: 0 }
  const bytes = utf8Bytes(text)
  if (bytes <= maxSettledBytes) return { kind: 'keep', reason: 'under-threshold', bytes }
  const headBudget = Math.max(HEAD_MIN_BYTES, Math.ceil(maxSettledBytes * HEAD_BYTE_BUDGET_RATIO))
  const head = headOf(text, headLines, headBudget)
  const kept = utf8Bytes(head)
  const omitted = bytes - kept
  if (omitted <= 0) return { kind: 'keep', reason: 'no-reduction', bytes }
  return { kind: 'rewrite', bytes, kept, omitted, head, headLines }
}

/**
 * Compose the replacement text: inline head, blank line, recovery notice.
 *
 * @param head - the leading text kept inline.
 * @param omittedBytes - how many bytes were omitted.
 * @param locator - absolute path of the durable artifact.
 * @returns the model-facing replacement text.
 */
export function composeVaultedText(head, omittedBytes, locator) {
  const notice = renderOmittedNotice(omittedBytes, locator)
  return typeof head === 'string' && head.length > 0 ? `${head}\n\n${notice}` : notice
}

/**
 * Gate for settlement `terminal.output` / notice text blocks (CONTRACT §3 FAIL fix).
 *
 * Order is mandatory: **vault full verbatim first**, then cut the window copy.
 * This helper never truncates without a locator — that was the destructive hole
 * in the old `dsh-subagent` notifySettlement patch.
 *
 * @param blocks - content blocks (`{type:'text', text}`) or a single string.
 * @param options - `{ maxBytes?, locator? }`. `locator` is required to truncate.
 * @returns
 *   - `{ kind: 'keep', blocks, bytes }` under budget
 *   - `{ kind: 'needs-vault', blocks, bytes, text }` over budget, no locator yet
 *   - `{ kind: 'capped', blocks, bytes, kept, omitted, locator }` over budget with locator
 */
export function capSettlementOutput(blocks, options = {}) {
  const maxBytes = positiveInteger(options?.maxBytes, DEFAULT_MAX_SETTLED_BYTES)
  const locator = typeof options?.locator === 'string' && options.locator.length > 0 ? options.locator : undefined
  const list = typeof blocks === 'string'
    ? [{ type: 'text', text: blocks }]
    : Array.isArray(blocks) ? blocks : []
  const parts = []
  for (const block of list) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  const text = parts.join('\n')
  const bytes = utf8Bytes(text)
  if (bytes <= maxBytes) {
    return { kind: 'keep', blocks: typeof blocks === 'string' ? list : blocks, bytes }
  }
  if (locator === undefined) {
    return { kind: 'needs-vault', blocks: typeof blocks === 'string' ? list : blocks, bytes, text }
  }
  const plan = planSettledRewrite(text, { maxSettledBytes: maxBytes, headLines: options?.headLines })
  if (plan.kind !== 'rewrite') {
    return { kind: 'keep', blocks: typeof blocks === 'string' ? list : blocks, bytes }
  }
  const cappedText = composeVaultedText(plan.head, plan.omitted, locator)
  return {
    kind: 'capped',
    blocks: [{ type: 'text', text: cappedText }],
    bytes,
    kept: plan.kept,
    omitted: plan.omitted,
    locator
  }
}


/**
 * The model-facing text of a settlement notice, or `undefined` when the message
 * is not one we recognize.
 *
 * Recognition is deliberately strict (source kind, a non-empty block list, and
 * every block a `text` block with a string body): the harness may grow new
 * block kinds, and the correct response to an unfamiliar shape is to leave the
 * message untouched rather than to guess which parts are prose.
 *
 * @param message - a candidate `user/message` payload.
 * @returns the concatenated text, or `undefined`.
 */
export function settledMessageText(message) {
  if (message === null || typeof message !== 'object') return undefined
  const source = message.source
  if (source === null || typeof source !== 'object') return undefined
  if (source.kind !== 'subagent-settled') return undefined
  const content = message.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') return undefined
    if (block.type !== 'text' || typeof block.text !== 'string') return undefined
    parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * A copy of `message` whose content is one text block.
 *
 * The spread is the point: `id`, `timestamp` and — above all — `source` keep
 * their identity, so `{ kind: 'subagent-settled', form: 'notice', summary,
 * senderSessionId }` still attributes the notice to the child that produced it
 * and the client's settlement card keeps rendering.
 *
 * @param message - the recognized settlement message.
 * @param text - the replacement text.
 * @returns a new message object; the input is not mutated.
 */
export function withReplacedContent(message, text) {
  return { ...message, content: [{ type: 'text', text }] }
}

/**
 * Flatten an all-text content list, mirroring the stock policy's rule
 * (`dsh-spill-policy/lib/index.js:52-58`): a result carrying any non-text block
 * is not something this policy understands, so it returns `undefined` and the
 * caller keeps the result untouched.
 *
 * @param content - a tool result's content blocks.
 * @returns the concatenated plain text, or `undefined`.
 */
export function flattenPlainText(content) {
  if (!Array.isArray(content) || content.length === 0) return undefined
  let text = ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') return undefined
    if (block.type !== 'text' || typeof block.text !== 'string') return undefined
    text += block.text
  }
  return text
}
