/**
 * The agent-facing surface of the durable memory: `abaco_memory_set`,
 * `abaco_memory_get`, `abaco_memory_forget` and `abaco_memory_list`.
 *
 * Registration is `ctx.tools.register(defineTool({...}))`, the harness's own
 * DSL (`dsh-tools/lib/index.js:837,2774-2782`) — **not** zod, and not raw JSON
 * Schema: `parameters` is compiled by the harness into a strict JSON Schema
 * subset, and `output` is mandatory (`:2777`). This mirrors
 * `packages/abaco-browser/index.js`, the fork's working example.
 *
 * Two decisions here are load-bearing:
 *
 * - **Provenance is derived, never trusted.** `exec.agent.session.header`
 *   supplies the ambient identity (cwd, session id, preset) and the session's
 *   current turn supplies the default `source` (`agent:turn-N`). A caller may
 *   override it — that is how a user correction is marked `user` — but there is
 *   always a provenance, so the store's "no source, no write" rule can never be
 *   dodged by leaving the argument out.
 * - **No session events.** The tools write files and return a short result.
 *   `Session.append` has no channel for an unknown type marked ignorable
 *   (`dsh-session/lib/index.js:1403-1423`) and the persistence backend refuses
 *   to reopen a log containing one
 *   (`dsh-session-persistence/lib/index.js:1318-1323`), so a memory event would
 *   make the session unreadable — the exact opposite of "come back tomorrow".
 *
 * @module abaco-memory/lib/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { MEMORY_FACETS, MEMORY_PHASES, MEMORY_SCOPES, MemorySchemaError, canonicalScope, parseMemoryPath, phaseOf } from './schema.js'

/** Local file work; generous for a slow disk, far below any network timeout. */
const TOOL_TIMEOUT_MS = 15000

/** Model-facing catalogue of the facets, reused by the descriptions. */
const FACET_GUIDE = Object.entries(MEMORY_FACETS)
  .map(([facet, spec]) => `${facet} (${spec.scope}${spec.kind === 'collection' ? ', list' : ', single'})`)
  .join(', ')

/** The scope vocabulary, as the enum the model sees. */
const SCOPE_ENUM = ['auto', ...MEMORY_SCOPES]

/**
 * The ambient identity of the calling agent.
 *
 * @param exec - the tool execution context.
 * @returns `{ cwd, sessionId, agentPreset }`, with `undefined` for whatever the
 *   session never declared (a standalone harness, a seeded session).
 */
export function ambientOf(exec) {
  const header = exec?.agent?.session?.header
  if (header === undefined || header === null) return {}
  return {
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
    sessionId: typeof header.id === 'string' ? header.id : undefined,
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : undefined,
    origin: typeof header.origin === 'string' ? header.origin : undefined,
    delegationDepth: typeof header.delegationDepth === 'number' ? header.delegationDepth : undefined
  }
}

/**
 * Whether the calling session is a delegated child.
 *
 * Matches the renderer (`lib/render.js`): `origin: 'subagent'` or a positive
 * `delegationDepth`. Those children must not write the parent profile.
 *
 * @param header - session header, or anything else.
 * @returns true when the caller is a subagent.
 */
export function isSubagentHeader(header) {
  if (header === null || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Refuse a profile write that came from a delegated child.
 *
 * @param path - the memory path the tool was asked to write.
 * @param scope - the requested scope, or `'auto'`.
 * @param header - the calling session header.
 */
export function assertParentProfileWrite(path, scope, header) {
  if (!isSubagentHeader(header)) return
  let parsed
  try {
    parsed = parseMemoryPath(path)
  } catch {
    return
  }
  const requested = canonicalScope(scope ?? 'auto')
  const kind = requested === 'auto' ? MEMORY_FACETS[parsed.facet]?.scope : requested
  if (kind === 'profile') {
    throw new MemorySchemaError(
      'subagents cannot write the parent profile; persist project (log) or session (note) facts instead.',
      'MEMORY_SUBAGENT_PROFILE'
    )
  }
}

/**
 * The turn the calling agent is inside, read from its own durable log.
 *
 * Read from the log rather than tracked in memory so it stays correct across a
 * resume, and bounded by `turn/end` so a long session cannot scan its whole
 * history on every write.
 *
 * @param session - the owning session, when there is one.
 * @returns the turn number, or `0` when it cannot be determined.
 */
export function currentTurn(session) {
  try {
    if (session === undefined || typeof session.seq !== 'number' || typeof session.eventAt !== 'function') return 0
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      const event = session.eventAt(seq)
      if (event?.type === 'turn/start') return Number.isInteger(event.data?.turn) ? event.data.turn : 0
      if (event?.type === 'turn/end') break
    }
  } catch {
    // A session shape this harness does not have must not fail a memory write.
  }
  return 0
}

/**
 * The provenance of one write.
 *
 * @param exec - the tool execution context.
 * @param explicit - the caller's `source`, when it supplied one.
 * @returns a provenance accepted by the store's vocabulary.
 */
export function sourceOf(exec, explicit) {
  const header = exec?.agent?.session?.header
  if (isSubagentHeader(header)) {
    if (typeof explicit === 'string' && explicit.trim().startsWith('subagent:')) return explicit.trim()
    const turn = currentTurn(exec?.agent?.session)
    return turn > 0 ? `subagent:turn-${turn}` : 'subagent:tool'
  }
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
  const turn = currentTurn(exec?.agent?.session)
  return turn > 0 ? `agent:turn-${turn}` : 'agent:tool'
}

/** One text content block. */
function textBlock(text) {
  return [{ type: 'text', text }]
}

/** The `scope` parameter shared by every tool. */
function scopeParameter() {
  return {
    type: 'string',
    enum: SCOPE_ENUM,
    description: `Which memory document to use: ${MEMORY_SCOPES.join(' | ')}, or "auto" (default) to let the facet decide.`
  }
}

/**
 * Register the four memory tools in the calling context's scope.
 *
 * A host-plane caller registers globally, so every agent sees them. That is
 * deliberate: an agent that cannot write memory cannot use Layer 2. Delegated
 * children are expected to be filtered by the composition that builds them
 * (`childCtx.tools.restrict(...)`, `dsh-subagent/lib/index.js:710-711`).
 *
 * @param ctx - the context whose `tools` registry receives the tools.
 * @param options - the store to read and write, and the resolved config.
 */
export function registerMemoryTools(ctx, options) {
  const { store, config } = options

  ctx.tools.register(
    defineTool({
      name: 'abaco_memory_set',
      description: `Write one durable fact into ABACO persistent memory. Use it the moment you learn something that must still be true tomorrow: a user preference or correction (quote the user's words verbatim), a decision with its rationale, a verified fact, the state of a project or a task, the output format the user requires, or the locator of a long report. Memory is injected into your system prompt on every request, so it survives context compaction and app restarts — do not rely on the conversation to remember anything. Keep one entry short (at most ${config.maxEntryChars} characters): for a long document, save the file and store only its path. Do not duplicate: reuse the same key (facet.entry-id) to update an entry instead of creating a twin. Facets: ${FACET_GUIDE}. Paths: "<facet>.<entry-id>.<field>" to set one field, "<facet>.<entry-id>" to upsert an entry, "<facet>[+]" to append one. Pass source "user" whenever the content came from the user or corrects you — it always wins and is never pruned.`,
      parameters: {
        key: {
          type: 'string',
          required: true,
          description:
            'Memory path, e.g. "preferences_user.pref-lang.text", "decisions.dec-001", "facts[+]", "output_format.text".'
        },
        value: {
          type: 'json',
          required: true,
          description:
            'The value: a string (the entry text) or an object of entry fields such as { text, rationale, priority, locator, taskId, status, next_action }.'
        },
        scope: scopeParameter(),
        ttl: {
          type: 'integer',
          description:
            'Days until this entry expires and is archived. Omit for the facet default (facts 90, tasks 30; preferences and decisions never expire).'
        },
        priority: {
          type: 'integer',
          description:
            'Importance from 0 (trivia) to 3 (the user said it). Higher-priority and pinned entries are the ones kept when the prompt budget runs out. Default 1.'
        },
        source: {
          type: 'string',
          description:
            'Provenance: "user" for anything the user said or corrected; otherwise omit it and the agent and turn are recorded.'
        },
        why: {
          type: 'string',
          description: 'Short rationale, stored as the entry\'s "why" and rendered next to it. Use it for decisions.'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            key: { type: 'string', required: true, description: 'The memory path that was written.' },
            facet: { type: 'string', required: true },
            scope: {
              type: 'string',
              required: true,
              description: 'The document it landed in: profile, project, session or role.'
            },
            id: { type: 'string', description: 'The entry id, for list facets.' },
            action: { type: 'string', required: true, enum: ['created', 'updated'] },
            archived: {
              type: 'integer',
              required: true,
              description: 'Entries archived to make room (expired, or over the facet cap).'
            },
            bytesRendered: {
              type: 'integer',
              description: 'Characters this entry will occupy in the injected block.'
            }
          }
        },
        render: (_args, value) => {
          const where = value.id === undefined ? value.facet : `${value.facet}.${value.id}`
          const archived =
            value.archived > 0
              ? ` ${value.archived} older entr${value.archived === 1 ? 'y was' : 'ies were'} archived to make room.`
              : ''
          return textBlock(
            `Memory ${value.action}: ${value.key} → ${where} in ${value.scope} memory.${archived} It will be in your system prompt from the next turn on.`
          )
        }
      },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args, exec) {
        try {
          assertParentProfileWrite(args.key, args.scope, exec?.agent?.session?.header)
          const outcome = await store.set({
            path: args.key,
            value: args.value,
            scope: args.scope,
            source: sourceOf(exec, args.source),
            ttlDays: args.ttl,
            priority: args.priority,
            rationale: args.why,
            ambient: ambientOf(exec),
            reason: 'memory_set'
          })
          return {
            ok: true,
            key: outcome.path,
            facet: outcome.facet,
            scope: outcome.scope.kind,
            action: outcome.action,
            archived: outcome.archived,
            ...(outcome.id === undefined ? {} : { id: outcome.id }),
            ...(outcome.bytesRendered === undefined ? {} : { bytesRendered: outcome.bytesRendered })
          }
        } catch (error) {
          throw explain(error, 'abaco_memory_set')
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_memory_get',
      description:
        'Read ABACO persistent memory back in detail. The same memory is already in your system prompt in condensed form; use this when you need an exact entry, its provenance (who wrote it, when, and why), entries the prompt budget left out, or the locator of a stored report. Omit key to read everything that applies to the current user, project, session and role.',
      parameters: {
        key: {
          type: 'string',
          description:
            'Optional memory path: a facet ("decisions"), one entry ("decisions.dec-001"), or one field. Omit for everything.'
        },
        scope: scopeParameter()
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            entries: {
              type: 'array',
              required: true,
              description: 'List-facet entries, most important first.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  facet: { type: 'string', required: true },
                  scope: { type: 'string', required: true },
                  id: { type: 'string', required: true },
                  text: { type: 'string', required: true },
                  priority: { type: 'integer', required: true },
                  pinned: { type: 'boolean', required: true },
                  source: { type: 'string', required: true },
                  updatedAt: { type: 'string', required: true },
                  expiresAt: { type: 'string' },
                  locator: { type: 'string' }
                }
              }
            },
            records: {
              type: 'array',
              required: true,
              description: 'Single-value facets (identity, output_format), one row per facet.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  facet: { type: 'string', required: true },
                  scope: { type: 'string', required: true },
                  text: { type: 'string', required: true, description: 'Field-by-field rendering of the facet.' }
                }
              }
            },
            locators: {
              type: 'array',
              required: true,
              description: 'Paths of stored artefacts referenced by the result; read them with the read tool.',
              items: { type: 'string' }
            },
            count: { type: 'integer', required: true, description: 'Number of entries returned.' }
          }
        },
        render: (_args, value) => {
          const lines = []
          for (const record of value.records) {
            lines.push(`${record.facet} (${record.scope}): ${record.text}`)
          }
          for (const entry of value.entries) {
            const details = [
              `priority ${entry.priority}`,
              entry.pinned ? 'pinned' : undefined,
              entry.source,
              entry.updatedAt.slice(0, 10),
              entry.locator
            ].filter((part) => part !== undefined)
            lines.push(`${entry.facet}.${entry.id}: ${entry.text} [${details.join(', ')}]`)
          }
          if (lines.length === 0) return textBlock('No durable memory matches that request yet.')
          if (value.locators.length > 0) lines.push(`Stored artefacts: ${value.locators.join(', ')}`)
          return textBlock(lines.join('\n'))
        }
      },
      timeoutMs: TOOL_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        try {
          const result = await store.get({
            path: args.key,
            scope: args.scope,
            ambient: ambientOf(exec)
          })
          const entries = []
          const records = []
          for (const facet of result.facets) {
            if (facet.record !== undefined) {
              records.push({
                facet: facet.facet,
                scope: facet.scope.kind,
                text: Object.entries(facet.record)
                  .filter(([, value]) => value !== null && typeof value !== 'object')
                  .map(([field, value]) => `${field}=${String(value)}`)
                  .join(', ')
              })
              continue
            }
            for (const entry of facet.entries) {
              entries.push({
                facet: facet.facet,
                scope: facet.scope.kind,
                id: String(entry.id),
                text: String(entry.text ?? ''),
                priority: Number.isInteger(entry.priority) ? entry.priority : 1,
                pinned: entry.pinned === true,
                source: typeof entry.source === 'string' ? entry.source : 'unknown',
                updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
                ...(typeof entry.expiresAt === 'string' ? { expiresAt: entry.expiresAt } : {}),
                ...(typeof entry.locator === 'string' ? { locator: entry.locator } : {})
              })
            }
          }
          return {
            found: entries.length > 0 || records.length > 0,
            entries,
            records,
            locators: result.locators,
            count: entries.length
          }
        } catch (error) {
          throw explain(error, 'abaco_memory_get')
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_memory_forget',
      description:
        'Delete durable memory that is wrong, obsolete, or that the user asked you to drop. Pass a facet to clear it, "facet.entry-id" to remove one entry, or "facet.entry-id.field" to remove one field of a single-value facet. The removal is journaled, so it stays inspectable afterwards.',
      parameters: {
        key: {
          type: 'string',
          required: true,
          description: 'Memory path to remove, e.g. "facts.fact-old" or "preferences_user".'
        },
        scope: scopeParameter()
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            key: { type: 'string', required: true },
            facet: { type: 'string', required: true },
            scope: { type: 'string', required: true },
            removed: {
              type: 'integer',
              required: true,
              description: 'How many values were removed (0 when nothing matched).'
            }
          }
        },
        render: (_args, value) =>
          textBlock(
            value.removed === 0
              ? `Nothing in memory matched ${value.key}; nothing was removed.`
              : `Forgot ${value.removed} value${value.removed === 1 ? '' : 's'} at ${value.key} (${value.scope} memory).`
          )
      },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args, exec) {
        try {
          const outcome = await store.forget({
            path: args.key,
            scope: args.scope,
            ambient: ambientOf(exec),
            reason: 'memory_forget'
          })
          return {
            ok: true,
            key: outcome.path,
            facet: outcome.facet,
            scope: outcome.scope.kind,
            removed: outcome.removed
          }
        } catch (error) {
          throw explain(error, 'abaco_memory_forget')
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_memory_list',
      description:
        'List what ABACO persistent memory currently holds: every facet with its document and entry count, without returning the values. Use it to see whether memory already has something on a topic before reading or writing it.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            facets: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  facet: { type: 'string', required: true },
                  scope: { type: 'string', required: true },
                  phase: { type: 'string', required: true, description: 'Write/aging phase: profile | log | note.' },
                  count: { type: 'integer', required: true }
                }
              }
            },
            total: { type: 'integer', required: true },
            root: { type: 'string', required: true, description: 'Directory holding the memory documents.' },
            phases: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: 'The three write/aging phases: profile, log, note.'
            }
          }
        },
        render: (_args, value) =>
          textBlock(
            value.total === 0
              ? `Durable memory is empty. It is stored under ${value.root}. Phases: profile / log / note.`
              : `${value.total} durable memory value${value.total === 1 ? '' : 's'} in ${value.facets.length} facet${value.facets.length === 1 ? '' : 's'}:\n${value.facets
                  .map((row) => `- [${row.phase}] ${row.facet} (${row.scope}): ${row.count}`)
                  .join('\n')}`
          )
      },
      timeoutMs: TOOL_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const result = await store.list({ ambient: ambientOf(exec) })
        return {
          facets: result.rows.map((row) => ({
            facet: row.facet,
            scope: row.scope.kind,
            phase: phaseOf(row.facet) ?? 'log',
            count: row.count
          })),
          total: result.total,
          root: result.root,
          phases: MEMORY_PHASES
        }
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'abaco_memory_note',
      description:
        'Quick note into ABACO durable memory without picking a full path. phase "note" (default) writes a session task; "log" writes a project fact; "profile" writes a user preference. Prefer abaco_memory_set when you know the exact facet path. Keep text short and factual.',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'The note text, quoted verbatim when it came from the user.'
        },
        phase: {
          type: 'string',
          enum: ['profile', 'log', 'note'],
          description: 'Write/aging phase. Default "note" (session working state).'
        },
        source: {
          type: 'string',
          description: 'Pass "user" when the text came from the user or corrects you.'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            key: { type: 'string', required: true },
            facet: { type: 'string', required: true },
            phase: { type: 'string', required: true },
            scope: { type: 'string', required: true },
            id: { type: 'string' },
            action: { type: 'string', required: true, enum: ['created', 'updated'] }
          }
        },
        render: (_args, value) =>
          textBlock(
            `Memory note ${value.action}: [${value.phase}] ${value.key} in ${value.scope}. Visible in the system prompt from the next turn.`
          )
      },
      timeoutMs: TOOL_TIMEOUT_MS,
      async execute(args, exec) {
        const phase = MEMORY_PHASES.includes(args.phase) ? args.phase : 'note'
        const pathByPhase = {
          profile: 'preferences_user[+]',
          log: 'facts[+]',
          note: 'tasks[+]'
        }
        const path = pathByPhase[phase]
        try {
          assertParentProfileWrite(path, 'auto', exec?.agent?.session?.header)
          const outcome = await store.set({
            path,
            value: args.text,
            scope: 'auto',
            source: sourceOf(exec, args.source),
            priority: args.source === 'user' ? 3 : 1,
            ambient: ambientOf(exec),
            reason: 'memory_note'
          })
          return {
            ok: true,
            key: outcome.path,
            facet: outcome.facet,
            phase,
            scope: outcome.scope.kind,
            action: outcome.action,
            ...(outcome.id === undefined ? {} : { id: outcome.id })
          }
        } catch (error) {
          throw explain(error, 'abaco_memory_note')
        }
      }
    })
  )

}

/**
 * Turn a rejection into a message the model can act on.
 *
 * `MemorySchemaError` messages are already written for the model — they name the
 * known facets, the cap, and what to do instead — so they pass through
 * untouched; every other failure is IO, and its own message is the only
 * diagnostic there is.
 *
 * @param error - the thrown value.
 * @param tool - the tool name, for context.
 * @returns the error to throw.
 */
function explain(error, tool) {
  if (error instanceof MemorySchemaError) return error
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(`${tool} failed: ${detail}`)
}
