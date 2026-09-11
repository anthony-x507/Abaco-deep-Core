/**
 * Schema of the ABACO durable memory (Layer 2).
 *
 * Everything that decides *what a memory path means* lives here: the facet
 * registry, the path grammar of `abaco_memory_set`/`_get`/`_forget`, the entry
 * shape and its validation rules, and the two path encodings that keep raw
 * user data out of file names.
 *
 * The schema is the design's §2.2 made executable. The rules it enforces are
 * the ones that keep the store trustworthy rather than convenient:
 *
 * 1. **Stable ids** — a short slug is the upsert key of a collection entry.
 * 2. **Mandatory provenance** — every entry carries a `source` matching
 *    {@link SOURCE_PATTERN}; a write without one is refused, because an entry
 *    nobody can attribute is an entry nobody can retract.
 * 3. **Verbatim for the user** — the store never paraphrases; it only caps
 *    length ({@link MEMORY_MAX_ENTRY_CHARS} by default) and says so.
 * 4. **No heavy raw content** — a facet entry is short text; the full artefact
 *    belongs in the vault and only its locator belongs here.
 * 5. **Versioned, additive** — `version` per document, and unknown fields on an
 *    entry are preserved rather than silently dropped.
 * 6. **Sidecar only** — nothing here ever appends a session event. The session
 *    log's vocabulary is closed (`assertEventsSupported`,
 *    dsh-session-persistence/lib/index.js:1318-1323) and an unknown type makes
 *    the log unreadable, which is the opposite of the point.
 *
 * The two encodings mirror `dsh-session-persistence-jsonl`'s
 * `projectKey`/`encodeSegment` (lib/index.js:92-133) so a memory file and a
 * session log of the same project group under the same readable key. They are
 * duplicated rather than imported because this package is resolved inside the
 * Harness profile and must not grow a dependency on a specific persistence
 * backend; `test/abaco-memory.test.ts` pins the exact output of both.
 *
 * @module abaco-memory/lib/schema
 */

/** Schema version written into every document; migrations are explicit. */
export const MEMORY_SCHEMA_VERSION = 1

/** Prompt-section name of the injected memory block. */
export const MEMORY_SECTION_NAME = 'abaco:durable-memory'

/**
 * Section order of the memory block: above the deployment persona (`0`) and
 * below `PLAN_POLICY` (`500`) in `dsh-system-prompt`'s central placement table
 * (lib/index.js:10-41), so durable facts read as deployment context and never
 * displace the plan/tool policies that follow.
 */
export const MEMORY_SECTION_ORDER = 200

/** Default cap for one entry's `text`, in characters (design §2.2 rule 4). */
export const MEMORY_MAX_ENTRY_CHARS = 240

/** Default cap for the whole injected block, in characters (design §3.3, ≈1500 tokens). */
export const MEMORY_MAX_RENDER_CHARS = 6000

/**
 * Per-scope render budgets, in characters, applied inside the global cap
 * (design §3.3). They stop one chatty scope — a project with sixty facts —
 * from starving the user's own preferences.
 */
export const MEMORY_SCOPE_BUDGETS = Object.freeze({
  profile: 1500,
  project: 2500,
  session: 1500,
  role: 500
})

/** The four scopes a memory document can live in. */
export const MEMORY_SCOPES = Object.freeze(['profile', 'project', 'session', 'role'])

/**
 * The facet registry (design §2.2).
 *
 * `scope` is the facet's natural home and the target of `scope: "auto"`;
 * `kind` is `record` for a singleton facet and `collection` for an
 * id-keyed list; `cap` is the per-facet ceiling before the oldest
 * lowest-priority entry is archived (design §3.4); `ttlDays` is the default
 * time-to-live of a *new* entry, applied only where a value genuinely goes
 * stale.
 */
/**
 * The three write/aging phases of Layer 2 (CONTRACT-MEMORY-3PHASE-SPILL-CD §2).
 * Orthogonal to context layers (window / durable / spill): this is how a durable
 * entry is classified, injected and expired.
 *
 * - profile — ∞ / pinned; identity + preferences; never paraphrase
 * - log — durable dated facts/decisions/artifacts (+ audit journal)
 * - note — TTL / session working state; may archive; must not starve profile/log
 */
export const MEMORY_PHASES = Object.freeze(['profile', 'log', 'note'])

export const MEMORY_FACETS = Object.freeze({
  identity: Object.freeze({ scope: 'role', kind: 'record', cap: 0, injected: true, phase: 'profile' }),
  preferences_user: Object.freeze({ scope: 'profile', kind: 'collection', cap: 40, injected: true, phase: 'profile' }),
  constraints_do_not: Object.freeze({ scope: 'profile', kind: 'collection', cap: 40, injected: true, phase: 'profile' }),
  output_format: Object.freeze({ scope: 'profile', kind: 'record', cap: 0, injected: true, phase: 'profile' }),
  projects_state: Object.freeze({ scope: 'project', kind: 'collection', cap: 40, injected: true, phase: 'log' }),
  decisions: Object.freeze({ scope: 'project', kind: 'collection', cap: 25, injected: true, phase: 'log' }),
  facts: Object.freeze({ scope: 'project', kind: 'collection', cap: 60, ttlDays: 90, injected: true, phase: 'log' }),
  artifacts: Object.freeze({ scope: 'project', kind: 'collection', cap: 60, injected: true, phase: 'log' }),
  tasks: Object.freeze({ scope: 'session', kind: 'collection', cap: 20, ttlDays: 30, injected: true, phase: 'note' }),
  open_questions: Object.freeze({ scope: 'project', kind: 'collection', cap: 20, injected: true, phase: 'note' }),
  // Session working-state / Principle C flag. Not injected: it must not eat
  // the render budget, and the consent record is also mirrored on document.meta.
  meta: Object.freeze({ scope: 'session', kind: 'record', cap: 0, injected: false, phase: 'note' })
})

/**
 * Injection order of the facets (design §3.3). It is deliberately not the
 * storage order: what the agent must never contradict comes first, and the
 * pointer-only facets come last, so a truncation at the budget costs the
 * cheapest material.
 */
export const MEMORY_RENDER_ORDER = Object.freeze([
  'identity',
  'preferences_user',
  'constraints_do_not',
  'output_format',
  'projects_state',
  'tasks',
  'decisions',
  'facts',
  'artifacts',
  'open_questions'
])

/**
 * Accepted spellings of the facet names. The agent may write
 * `usuario.preferencias.idioma` or `preferencias.idioma` as readily as the
 * canonical `preferences_user.pref-lang.text`; normalizing here rather than
 * refusing is what keeps the tool callable on the first try, and the system
 * prompt always renders the canonical name back.
 */
const FACET_ALIASES = Object.freeze({
  identidad: 'identity',
  rol: 'identity',
  role: 'identity',
  preferencias: 'preferences_user',
  preferences: 'preferences_user',
  user_preferences: 'preferences_user',
  usuario: 'preferences_user',
  prohibiciones: 'constraints_do_not',
  constraints: 'constraints_do_not',
  do_not: 'constraints_do_not',
  never: 'constraints_do_not',
  formato: 'output_format',
  formato_salida: 'output_format',
  proyecto: 'projects_state',
  projects: 'projects_state',
  project_state: 'projects_state',
  estado_proyecto: 'projects_state',
  decisiones: 'decisions',
  hechos: 'facts',
  datos: 'facts',
  artefactos: 'artifacts',
  informes: 'artifacts',
  tareas: 'tasks',
  todo: 'tasks',
  preguntas: 'open_questions',
  questions: 'open_questions',
  dudas: 'open_questions',
  note: 'meta',
  notes: 'meta',
  session_meta: 'meta',
  // Multi-segment prefixes: `usuario.preferencias.idioma` is the spelling the
  // design's own example uses (§1.5), and reading it as "entry `preferencias`,
  // field `idioma`" would be a write nobody meant. Matched longest-first, so
  // `proyecto.estado` still resolves as the facet `projects_state` with the
  // entry id `estado`.
  'usuario.preferencias': 'preferences_user',
  'usuario.preferencia': 'preferences_user',
  'user.preferences': 'preferences_user',
  'user.preference': 'preferences_user'
})

/** Accepted spellings of the scope names. */
const SCOPE_ALIASES = Object.freeze({
  auto: 'auto',
  global: 'profile',
  usuario: 'profile',
  user: 'profile',
  perfil: 'profile',
  proyecto: 'project',
  sesion: 'session',
  role: 'role',
  rol: 'role',
  preset: 'role'
})

/**
 * Provenance vocabulary. `source` is what makes the store auditable and what
 * decides conflict resolution, so it is a closed set with a free qualifier:
 * `user:turn-3`, `agent:turn-12`, `subagent:research-2`, `tool:read`,
 * `plugin:vault`.
 */
export const SOURCE_PATTERN = /^(user|agent|subagent|tool|plugin)(?::[^\s:]+)?$/u

/** Priority bounds (0 = trivia, 3 = the user said it; design §2.2). */
export const MEMORY_PRIORITY_MIN = 0
export const MEMORY_PRIORITY_MAX = 3

/**
 * Entry fields with a defined shape. The list is documentation for readers and
 * a checklist for reviewers, not a filter: `normalizeEntry` validates these and
 * preserves every other field unchanged (design §2.2 rule 5).
 */
export const MEMORY_ENTRY_FIELDS = Object.freeze([
  'id',
  'text',
  'priority',
  'pinned',
  'source',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'rationale',
  'locator',
  'bytes',
  'taskId',
  'status',
  'next_action'
])

/** Ceiling for a non-`text` string field, so a locator cannot smuggle a report in. */
const MAX_AUX_STRING_CHARS = 4096

/** Raised for every schema violation the model can fix by calling the tool again. */
export class MemorySchemaError extends Error {
  /**
   * @param message - model-facing explanation.
   * @param code - stable machine code for tests and journals.
   */
  constructor(message, code = 'MEMORY_SCHEMA') {
    super(message)
    this.name = 'MemorySchemaError'
    this.code = code
  }
}

/** Whether a value is a plain, lossless-JSON object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject values a JSON document cannot round-trip. */
function assertJsonValue(value, label) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new MemorySchemaError(`${label} must be a JSON value (string, number, boolean, null, array or object)`)
  }
  try {
    JSON.stringify(value)
  } catch {
    throw new MemorySchemaError(`${label} is not serializable as JSON`)
  }
}

/**
 * Encode one string as a single safe path segment, mirroring
 * `encodeSegment` in `dsh-session-persistence-jsonl` (lib/index.js:95-108):
 * safe code units stay literal and every other unit becomes `~XXXX`, with `.`
 * and `..` special-cased so a name can never traverse.
 *
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw) {
  const value = String(raw)
  if (value.length === 0) throw new MemorySchemaError('cannot encode an empty path segment', 'MEMORY_BAD_KEY')
  if (value === '.') return '~002E'
  if (value === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)) out += character
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Encode a project directory as its readable grouping key, mirroring
 * `projectKey` in `dsh-session-persistence-jsonl` (lib/index.js:118-133): the
 * memory of a project sits under the same human-navigable name as its session
 * logs. An empty (or absent) cwd resolves to `--no-cwd--` rather than throwing,
 * because `memory_set` with `scope: "project"` must still work in a session
 * that never declared a directory.
 *
 * @param cwd - the session's project directory, when it declared one.
 * @returns a single filesystem-safe project key.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return '--no-cwd--'
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  const trimmed = readable.replace(/^-+/u, '') || 'root'
  return `--${trimmed.slice(0, 251)}--`
}

/**
 * Normalize one facet name, accepting the aliases above.
 *
 * @param name - raw facet name, with or without a trailing `[+]`.
 * @returns the canonical facet name, or `undefined` when nothing matches.
 */
function facetNameOf(name) {
  const raw = String(name ?? '').trim().toLowerCase()
  const bare = raw.endsWith('[+]') ? raw.slice(0, -3) : raw
  if (Object.hasOwn(MEMORY_FACETS, bare)) return bare
  return FACET_ALIASES[bare]
}

/**
 * Normalize a scope name, accepting the aliases above.
 *
 * @param name - raw scope argument.
 * @returns one of `auto`, `profile`, `project`, `session`, `role`.
 * @throws {MemorySchemaError} for an unknown scope.
 */
export function canonicalScope(name) {
  const raw = String(name ?? 'auto').trim().toLowerCase()
  const canonical = Object.hasOwn(SCOPE_ALIASES, raw) ? SCOPE_ALIASES[raw] : raw
  if (canonical !== 'auto' && !MEMORY_SCOPES.includes(canonical)) {
    throw new MemorySchemaError(
      `unknown memory scope "${raw}". Use one of: auto, ${MEMORY_SCOPES.join(', ')}.`,
      'MEMORY_UNKNOWN_SCOPE'
    )
  }
  return canonical
}

/**
 * Resolve the leading segments of a path to a canonical facet.
 *
 * Longest prefix first, so an explicit `usuario.preferencias` beats the
 * one-segment `usuario`, while `proyecto.estado` still resolves through
 * `proyecto` and keeps `estado` as its entry id.
 *
 * @param segments - the path's segments.
 * @returns the facet and the segments that follow it.
 * @throws {MemorySchemaError} when nothing in the path names a known facet.
 */
function resolveFacetPrefix(segments) {
  for (let length = Math.min(segments.length, 3); length >= 1; length -= 1) {
    const head = segments.slice(0, length).join('.')
    const canonical = facetNameOf(head)
    if (canonical !== undefined) {
      return { facet: canonical, append: head.endsWith('[+]'), rest: segments.slice(length) }
    }
  }
  throw new MemorySchemaError(
    `unknown memory facet "${segments[0]}". Known facets: ${Object.keys(MEMORY_FACETS).join(', ')}.`,
    'MEMORY_UNKNOWN_FACET'
  )
}

/**
 * Parse one memory path into its parts.
 *
 * Grammar (design §2.2 rule 1):
 *
 * ```text
 * <facet>              singleton record: replace the whole value
 * <facet>.<field>      singleton record: set one field
 * <facet>.<id>         collection: upsert the entry (merge, never clobber)
 * <facet>.<id>.<field> collection: set one field of one entry
 * <facet>[+]           collection: append, minting an id
 * <facet>[+].<field>   collection: append, then set one field
 * ```
 *
 * A collection path with no id at all (`preferences_user`) is treated as an
 * append: appending with dedupe is what the caller means, and refusing it would
 * only cost a round trip.
 *
 * @param raw - the model-supplied path.
 * @returns the parsed path: canonical facet, resolved kind, optional id/field.
 * @throws {MemorySchemaError} for an empty, malformed or unknown-facet path.
 */
export function parseMemoryPath(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new MemorySchemaError('memory path is required, e.g. "preferences_user.pref-lang.text"', 'MEMORY_BAD_PATH')
  }
  const trimmed = raw.trim()
  const segments = trimmed.split('.')
  for (const segment of segments) {
    if (segment.length === 0) throw new MemorySchemaError(`memory path "${trimmed}" has an empty segment`, 'MEMORY_BAD_PATH')
  }
  const { facet, append, rest } = resolveFacetPrefix(segments)
  const spec = MEMORY_FACETS[facet]
  if (spec.kind === 'record') {
    if (append) throw new MemorySchemaError(`"${facet}" is a single-value facet; drop the "[+]"`, 'MEMORY_BAD_PATH')
    if (rest.length > 1) {
      throw new MemorySchemaError(`"${facet}" holds one record; use "${facet}.<field>"`, 'MEMORY_BAD_PATH')
    }
    return { path: trimmed, facet, kind: 'record', append: false, id: undefined, field: rest[0] }
  }
  return {
    path: trimmed,
    facet,
    kind: 'collection',
    append: append || rest.length === 0,
    id: append ? undefined : rest[0],
    field: append ? rest[0] : rest[1]
  }
}

/**
 * Build the stable id of an appended entry from its own text, so the same fact
 * written twice lands on the same entry instead of creating a twin.
 *
 * @param text - the entry text.
 * @param fallback - id used when the text has no usable characters.
 * @returns a lowercase slug of at most 48 characters.
 */
export function slugify(text, fallback = 'entry') {
  const slug = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : fallback
}

/**
 * Normalize one entry text for dedupe: whitespace-collapsed and
 * case-insensitive, so "No  inventes fuentes" and "no inventes fuentes" are one
 * entry rather than two (design §3.4, "Dedupe por texto normalizado").
 *
 * @param text - the entry text.
 * @returns the comparison key.
 */
export function normalizeTextKey(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

/**
 * Validate one `source` string.
 *
 * @param source - the candidate provenance.
 * @returns the validated provenance.
 * @throws {MemorySchemaError} when the provenance is missing or off-vocabulary.
 */
export function assertSource(source) {
  if (typeof source !== 'string' || !SOURCE_PATTERN.test(source)) {
    throw new MemorySchemaError(
      `memory entries need a provenance: pass source as one of user|agent|subagent|tool|plugin, optionally qualified (e.g. "user:turn-3"). Received ${JSON.stringify(source ?? null)}.`,
      'MEMORY_NO_SOURCE'
    )
  }
  return source
}

/**
 * Coerce an arbitrary JSON value into the fields of one collection entry.
 *
 * A scalar is the entry's `text`; an object is merged as fields. This is the
 * affordance that makes both `memory_set("facts", "the build needs Node 20")`
 * and `memory_set("facts.fact-node", { text: "...", locator: "..." })` work.
 *
 * @param value - the model-supplied value.
 * @param label - where the value came from, for the error message.
 * @returns a field patch.
 */
export function valueToFields(value, label = 'value') {
  assertJsonValue(value, label)
  if (isPlainObject(value)) return { ...value }
  if (Array.isArray(value)) {
    throw new MemorySchemaError(`${label} must be a string or an object, not an array`, 'MEMORY_BAD_VALUE')
  }
  return { text: value === null ? '' : String(value) }
}

/**
 * Validate a scalar field that is not `text`.
 *
 * @param key - field name, for the message.
 * @param value - field value.
 * @returns the value, unchanged.
 */
function assertAuxField(key, value) {
  if (key === 'priority') {
    if (!Number.isInteger(value) || value < MEMORY_PRIORITY_MIN || value > MEMORY_PRIORITY_MAX) {
      throw new MemorySchemaError(`priority must be an integer between 0 and 3, received ${JSON.stringify(value)}`, 'MEMORY_BAD_VALUE')
    }
    return value
  }
  if (key === 'pinned') {
    if (typeof value !== 'boolean') throw new MemorySchemaError('pinned must be a boolean', 'MEMORY_BAD_VALUE')
    return value
  }
  if (key === 'bytes') {
    if (!Number.isFinite(value)) throw new MemorySchemaError('bytes must be a number', 'MEMORY_BAD_VALUE')
    return value
  }
  if (typeof value === 'string' && value.length > MAX_AUX_STRING_CHARS) {
    throw new MemorySchemaError(
      `"${key}" is ${value.length} characters; memory fields stay short. Put the full content in a file and keep only its path here.`,
      'MEMORY_TOO_LONG'
    )
  }
  return value
}

/**
 * Build or update one entry.
 *
 * The rules applied here are the design's conflict and retention rules
 * (§2.2, §3.4): provenance is mandatory, `text` is capped, a user-sourced entry
 * always wins and sits at `priority: 3`, and the facet's default TTL is stamped
 * as an absolute `expiresAt`.
 *
 * One rule is worth spelling out, because it is the difference between "the
 * user's words survive" and "they survive until the agent next touches them":
 * **user provenance is sticky**. An agent that later rewrites the wording of a
 * preference keeps `source: user`, and therefore keeps its top priority and its
 * pin — otherwise the first agent-side correction would quietly demote the
 * user's own words to prunable trivia.
 *
 * @param existing - the entry being updated, when there is one.
 * @param patch - the fields the caller supplied.
 * @param options - id, source, timestamps, caps and facet defaults.
 * @returns the next entry.
 */
export function normalizeEntry(existing, patch, options) {
  const { id, source, now, maxEntryChars, ttlDays } = options
  if (!isPlainObject(patch)) throw new MemorySchemaError('an entry patch must be an object', 'MEMORY_BAD_VALUE')
  const incoming = assertSource(source)
  const inherited = typeof existing?.source === 'string' ? existing.source : undefined
  const provenance =
    inherited !== undefined && inherited.startsWith('user') && !incoming.startsWith('user') ? inherited : incoming
  const next = existing === undefined ? { id, createdAt: now, updatedAt: now } : { ...existing, updatedAt: now }
  for (const [key, value] of Object.entries(patch)) {
    // `id` is the upsert key, never a patchable field: a caller that wants a
    // different id writes to a different path.
    if (value === undefined || key === 'id') continue
    assertJsonValue(value, `"${key}"`)
    next[key] = key === 'text' ? value : assertAuxField(key, value)
  }
  if (typeof next.text !== 'string' || next.text.trim().length === 0) {
    throw new MemorySchemaError(
      'an entry needs a non-empty "text". Pass a string value, or an object with a "text" field.',
      'MEMORY_NO_TEXT'
    )
  }
  next.text = next.text.trim()
  if (next.text.length > maxEntryChars) {
    throw new MemorySchemaError(
      `entry text is ${next.text.length} characters, over the ${maxEntryChars}-character cap. Durable memory keeps short facts: store the full content in a file (or the vault) and keep its path or a summary here.`,
      'MEMORY_TOO_LONG'
    )
  }
  next.source = provenance
  next.id = String(next.id)
  if (next.priority === undefined) next.priority = 1
  if (next.pinned === undefined) next.pinned = false
  // A user correction is never outranked and never dropped: the user's words
  // win the render budget and the pruning order by construction.
  if (next.source.startsWith('user')) {
    next.priority = MEMORY_PRIORITY_MAX
    next.pinned = true
  }
  if (next.expiresAt === undefined && existing?.expiresAt !== undefined) next.expiresAt = existing.expiresAt
  if (ttlDays !== undefined) next.expiresAt = new Date(Date.parse(now) + ttlDays * 86400000).toISOString()
  else if (next.expiresAt === undefined && specTtlDays(options.facet) !== undefined) {
    next.expiresAt = new Date(Date.parse(now) + specTtlDays(options.facet) * 86400000).toISOString()
  }
  return next
}

/** Default TTL of a facet, when it declares one. */
function specTtlDays(facet) {
  return facet === undefined ? undefined : MEMORY_FACETS[facet]?.ttlDays
}

/** Whether an entry has passed its `expiresAt` as of `now`. */
export function isExpired(entry, nowMs) {
  if (typeof entry?.expiresAt !== 'string') return false
  const at = Date.parse(entry.expiresAt)
  return Number.isFinite(at) && at <= nowMs
}

/**
 * Order entries for both rendering and pruning: pinned first, then priority,
 * then recency (design §3.3, "aplicado por prioridad y recencia").
 *
 * @param entries - entries to order; not mutated.
 * @returns a new, ordered array.
 */
export function sortEntries(entries) {
  const recency = (entry) => Date.parse(entry.updatedAt ?? entry.createdAt ?? '') || 0
  return [...entries].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1
    const priority = (right.priority ?? 1) - (left.priority ?? 1)
    if (priority !== 0) return priority
    return recency(right) - recency(left)
  })
}

/**
 * Choose which entries survive a per-facet cap.
 *
 * @param entries - the facet's entries.
 * @param cap - the facet's ceiling; `0` means the facet holds a single record.
 * @returns the entries to keep and the ones to archive, both in render order.
 */
export function splitByCap(entries, cap) {
  const ordered = sortEntries(entries)
  if (!Number.isInteger(cap) || cap <= 0 || ordered.length <= cap) return { keep: ordered, evict: [] }
  const keep = ordered.slice(0, cap)
  const keepIds = new Set(keep.map((entry) => entry.id))
  // Recompute the eviction list from the original array so two entries sharing
  // an id (possible only through a hand-edited file) cannot both survive.
  const evict = ordered.filter((entry) => !keepIds.has(entry.id))
  return { keep, evict }
}


/**
 * Resolve the write/aging phase of a facet (profile | log | note).
 * @param facet - canonical facet name.
 * @returns the phase, or undefined when the facet is unknown.
 */
export function phaseOf(facet) {
  return MEMORY_FACETS[facet]?.phase
}

/**
 * Facets that belong to one phase, in {@link MEMORY_RENDER_ORDER}.
 * @param phase - one of {@link MEMORY_PHASES}.
 * @returns facet names.
 */
export function facetsForPhase(phase) {
  return MEMORY_RENDER_ORDER.filter((facet) => MEMORY_FACETS[facet]?.phase === phase)
}

/**
 * The scope key one document is filed under.
 *
 * @param kind - one of `profile`, `project`, `session`, `role`.
 * @param ambient - the live identity: `{ cwd, sessionId, agentPreset }`.
 * @returns the key; `profile` is a singleton and uses the empty key.
 */
export function scopeKeyFor(kind, ambient = {}) {
  switch (kind) {
    case 'profile':
      return ''
    case 'project':
      return projectKey(ambient.cwd)
    case 'session':
      return encodeSegment(ambient.sessionId ?? '--no-session--')
    case 'role':
      return encodeSegment(ambient.agentPreset ?? '--no-role--')
    default:
      throw new MemorySchemaError(`unknown memory scope "${String(kind)}"`, 'MEMORY_UNKNOWN_SCOPE')
  }
}

/**
 * The document path of one scope, relative to the memory root.
 *
 * @param kind - one of `profile`, `project`, `session`, `role`.
 * @param key - the scope key from {@link scopeKeyFor}.
 * @returns the relative path, always inside the root.
 */
export function documentRelativePath(kind, key) {
  switch (kind) {
    case 'profile':
      return 'profile.json'
    case 'project':
      return `projects/${key}.json`
    case 'session':
      return `sessions/${key}.json`
    case 'role':
      return `roles/${key}.json`
    default:
      throw new MemorySchemaError(`unknown memory scope "${String(kind)}"`, 'MEMORY_UNKNOWN_SCOPE')
  }
}

/** A fresh, empty document for one scope. */
export function emptyDocument(kind, key) {
  return {
    version: MEMORY_SCHEMA_VERSION,
    scope: { kind, key },
    updatedAt: new Date(0).toISOString(),
    facets: {},
    meta: { lastTurn: 0, lastWriteReason: 'boot', renders: 0, drops: 0 }
  }
}

/**
 * Coerce a parsed document into the shape the store expects, preserving
 * unknown fields (design §2.2 rule 5). A document whose facet values have the
 * wrong shape is repaired in memory rather than rejected: it is still the
 * user's durable memory, and the next write fixes the file.
 *
 * @param value - the parsed JSON.
 * @param kind - the document's expected scope kind.
 * @param key - the document's expected scope key.
 * @returns the normalized document.
 * @throws {MemorySchemaError} when the value is not a plausible document at all.
 */
export function normalizeDocument(value, kind, key) {
  if (!isPlainObject(value)) throw new MemorySchemaError('memory document is not a JSON object', 'MEMORY_BAD_DOC')
  const facets = {}
  if (isPlainObject(value.facets)) {
    for (const [name, facetValue] of Object.entries(value.facets)) {
      const spec = MEMORY_FACETS[name]
      if (spec?.kind === 'record') {
        if (isPlainObject(facetValue)) facets[name] = { ...facetValue }
      } else if (Array.isArray(facetValue)) {
        facets[name] = facetValue.filter(isPlainObject).map((entry) => ({ ...entry }))
      } else if (isPlainObject(facetValue)) {
        facets[name] = [{ ...facetValue }]
      }
    }
  }
  const meta = isPlainObject(value.meta) ? { ...value.meta } : {}
  return {
    ...value,
    version: Number.isInteger(value.version) ? value.version : MEMORY_SCHEMA_VERSION,
    scope: { kind, key },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    facets,
    meta: { lastTurn: 0, lastWriteReason: 'load', renders: 0, drops: 0, ...meta }
  }
}
