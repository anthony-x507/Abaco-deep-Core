/**
 * Rendering of the durable memory into the system prompt (design §3.3).
 *
 * ## Why a system-prompt section
 *
 * The block is registered as an ordered prompt section whose `text` is a
 * function (`dsh-system-prompt/lib/index.js:229-232`; the function form is
 * evaluated on every assembly at `:330`), exactly like the approval policy at
 * `dsh-user-approval/lib/index.js:77-90`. That is the whole point of Layer 2:
 * the section is rebuilt from disk-backed state on **every** request and lives
 * in the `request/header`, which the compaction contract cannot touch — it only
 * ever replaces `user/message` surfaces. Memory therefore survives compaction
 * by construction rather than by being carefully preserved.
 *
 * ## The frozen snapshot per turn
 *
 * A write during a turn must not change that turn's system prompt (design
 * §3.2, "regla de oro"): changing the system alters `request/header` with
 * `reason: "change"` (`dsh-agent-loop/lib/index.js:741-755`), which breaks the
 * provider's prefix/KV-cache reuse and edits the instructions mid-task. So the
 * renderer caches the block per session and drops the cache when the turn
 * closes (`agent/turn-stopping`, `dsh-agent-loop/lib/index.js:570-575`) — the
 * next turn renders the writes made during this one.
 *
 * ## Budget
 *
 * The block is capped twice: per scope, so a chatty project cannot starve the
 * user's own preferences, and globally, so the section cannot outgrow its
 * place in the prompt. What does not fit is counted and reported — in the
 * block's own footer and in the session document's `meta.drops` — because a
 * silently truncated memory reads exactly like a complete one.
 *
 * @module abaco-memory/lib/render
 */

import { MEMORY_FACETS, MEMORY_RENDER_ORDER } from './schema.js'

/** Heading of the injected block. */
const HEADING = '## ABACO DURABLE MEMORY'

/** One sentence that tells the model how to treat the block, and how to update it. */
const GUIDANCE =
  'Durable facts about this user, project and session. They are re-injected on every request and survive context compaction: treat them as authoritative, do not re-ask for what is already here, and update them with abaco_memory_set instead of restating them in the conversation.'

/** Prefix of the footer that reports what the budget left out. */
const DROP_FOOTER = 'more memory entries did not fit this block; call abaco_memory_get to read them.'

/**
 * One bullet body for a collection entry.
 *
 * Shared with the store so the `bytesRendered` a tool reports is measured on
 * exactly the text the model will read, not on an approximation of it.
 *
 * @param facet - the entry's facet.
 * @param entry - the entry.
 * @returns the bullet body, without the leading "- ".
 */
export function entryLine(facet, entry) {
  const id = typeof entry?.id === 'string' && entry.id.length > 0 ? `${facet}.${entry.id}` : facet
  const parts = [`${id}: ${String(entry?.text ?? '')}`]
  if (typeof entry?.status === 'string' && entry.status.length > 0) parts.push(`[${entry.status}]`)
  if (typeof entry?.next_action === 'string' && entry.next_action.length > 0) {
    parts.push(`next: ${entry.next_action}`)
  }
  if (typeof entry?.rationale === 'string' && entry.rationale.length > 0) parts.push(`why: ${entry.rationale}`)
  // Only the pointer is injected; the artefact itself stays in the vault
  // (design §3.3, "Qué NO se inyecta").
  if (typeof entry?.locator === 'string' && entry.locator.length > 0) parts.push(`-> ${entry.locator}`)
  if (typeof entry?.expiresAt === 'string') parts.push(`(expires ${entry.expiresAt.slice(0, 10)})`)
  return parts.join(' ')
}

/** Bullet bodies for a single-value facet, one per populated field. */
function recordLines(facet, record) {
  const lines = []
  for (const [field, value] of Object.entries(record ?? {})) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') continue
    lines.push(`${facet}.${field}: ${String(value)}`)
  }
  return lines
}

/** Bullet bodies for a facet value, whatever its kind. */
function facetLines(facet, value) {
  if (Array.isArray(value)) return value.map((entry) => entryLine(facet, entry))
  if (typeof value === 'object' && value !== null) return recordLines(facet, value)
  return []
}

/**
 * Build the injected block.
 *
 * @param options - the snapshot to render and the two budgets.
 * @returns the block, plus how much of the memory it actually carries.
 */
export function renderMemory(options) {
  const documents = Array.isArray(options.documents) ? options.documents : []
  const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : 6000
  const scopeBudgets = options.scopeBudgets ?? {}

  const header = `${HEADING}\n${GUIDANCE}`
  const selected = []
  const usedByKind = new Map()
  let dropped = 0

  for (const facet of MEMORY_RENDER_ORDER) {
    for (const document of documents) {
      const value = document?.facets?.[facet]
      if (value === undefined) continue
      const spec = MEMORY_FACETS[facet]
      if (spec === undefined || spec.injected !== true) continue
      const lines = facetLines(facet, value)
      for (const line of lines) {
        const kind = document.kind ?? 'profile'
        const budget = Number.isInteger(scopeBudgets[kind]) ? scopeBudgets[kind] : maxChars
        const used = usedByKind.get(kind) ?? 0
        if (used + line.length + 3 > budget) {
          dropped += 1
          continue
        }
        usedByKind.set(kind, used + line.length + 3)
        selected.push(line)
      }
    }
  }

  if (selected.length === 0) return { text: '', included: 0, dropped: 0 }

  const join = (lines) => `${header}${lines.map((line) => `\n- ${line}`).join('')}`
  const footerFor = (count) => `\n(${count} ${DROP_FOOTER})`
  const kept = []
  for (const line of selected) {
    if (`${join(kept)}\n- ${line}`.length > maxChars) {
      dropped += 1
      continue
    }
    kept.push(line)
  }
  if (kept.length === 0) return { text: '', included: 0, dropped }

  let text = join(kept)
  if (dropped > 0) {
    // The budget is spent on entries first, so the footer that says "there is
    // more, ask for it" can itself be squeezed out — and a truncated memory
    // that reads as a complete one is the failure this layer exists to avoid.
    // Buy the footer's room back from the cheapest bullets instead.
    while (kept.length > 1 && join(kept).length + footerFor(dropped).length > maxChars) {
      kept.pop()
      dropped += 1
    }
    const candidate = join(kept) + footerFor(dropped)
    if (candidate.length <= maxChars) text = candidate
    else text = join(kept)
  }
  return { text, included: kept.length, dropped }
}

/** Whether a session header belongs to a delegated child. */
function isSubagent(header) {
  if (header === undefined || header === null) return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Turns the store's snapshot into the text of the `abaco:durable-memory`
 * prompt section.
 *
 * The renderer is the only object that knows about agents, so the store stays a
 * pure persistence layer and this class stays a pure presentation layer that
 * happens to hold one cache.
 */
export class MemoryRenderer {
  #store
  #config
  #logger
  /** @type {Map<string, string>} */
  #frozen = new Map()

  /**
   * @param options - the store to read, the resolved config, and a logger.
   */
  constructor(options) {
    this.#store = options.store
    this.#config = options.config
    this.#logger = options.logger ?? { info: () => {}, warn: () => {}, error: () => {} }
  }

  /**
   * The `text` function of the prompt section: evaluated on every assembly with
   * the agent in context.
   *
   * Never throws. A section that throws would fail `systemPrompt.assemble` and
   * therefore every model step of the session; an empty memory block costs one
   * repeated question, which is strictly better.
   *
   * @param context - the assembly context `{ agent, scope, signal }`.
   * @returns the block, or `''` when there is nothing to inject.
   */
  sectionText(context) {
    try {
      const agent = context?.agent
      const header = agent?.session?.header
      if (agent === undefined || header === undefined || header === null) return ''
      if (this.#config.includeInSubagents !== true && isSubagent(header)) return ''
      const sessionId = String(header.id ?? '')
      if (this.#config.freezePerTurn !== false) {
        const frozen = this.#frozen.get(sessionId)
        if (frozen !== undefined) return frozen
      }
      const ambient = { cwd: header.cwd, sessionId, agentPreset: header.agentPreset }
      const outcome = this.render(ambient)
      this.#store.noteRender(ambient, outcome.dropped)
      if (this.#config.freezePerTurn !== false) this.#frozen.set(sessionId, outcome.text)
      return outcome.text
    } catch (error) {
      this.#logger.warn(`abaco-memory: the durable-memory section failed to render: ${describe(error)}`)
      return ''
    }
  }

  /**
   * Render the block for an identity, bypassing the per-turn cache.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @returns the render outcome.
   */
  render(ambient = {}) {
    return renderMemory({
      documents: this.#store.snapshot(ambient),
      maxChars: this.#config.maxRenderChars,
      scopeBudgets: this.#config.scopeBudgets
    })
  }

  /**
   * Drop one session's frozen block, so the next assembly sees the writes made
   * during the turn that just closed.
   *
   * @param sessionId - the session whose cache entry to drop.
   */
  invalidate(sessionId) {
    this.#frozen.delete(String(sessionId))
  }

  /** Drop every frozen block, e.g. when the plugin reloads. */
  clear() {
    this.#frozen.clear()
  }
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
