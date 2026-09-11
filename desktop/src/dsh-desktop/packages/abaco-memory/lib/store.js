/**
 * Durable sidecar store of the ABACO memory (Layer 2).
 *
 * ## What it is
 *
 * One JSON document per scope under `<DSH_HOME>/abaco-memory/`:
 *
 * ```text
 * <root>/profile.json                PHASE profile — preferences / constraints / format
 * <root>/roles/<agentPreset>.json    PHASE profile — identity of one role/preset
 * <root>/projects/<projectKey>.json  PHASE log — decisions / facts / artifacts / project state
 * <root>/sessions/<sessionId>.json   PHASE note — tasks / open questions / turn meta
 * <root>/audit/memory.jsonl          PHASE log journal — append-only of every change
 * <root>/audit/archive/<YYYY-MM>.jsonl  entries archived by TTL or by cap
 * <root>/vault/                      Layer 3 durable spill (owned by abaco-vault)
 * ```
 *
 * Write/aging phases (CONTRACT §2): **profile** (∞), **log** (durable dated),
 * **note** (TTL/session). Orthogonal to the three context layers.
 *
 * The layout is design §2.1 verbatim, and it is the *only* place memory is
 * persisted. Nothing here appends a session event: the durable log's event
 * vocabulary is closed (`assertEventsSupported`,
 * dsh-session-persistence/lib/index.js:1318-1323) and `Session.append` has no
 * `ignorable` channel (dsh-session/lib/index.js:1403-1423), so a memory event
 * would produce a session log this harness refuses to reopen — the exact
 * failure the layer exists to prevent.
 *
 * ## Durability
 *
 * Every commit is `tmp + rename` on a `wx`-created sibling (so a reader sees
 * the old or the new document, never a half-written one), guarded by a
 * cross-process writer lock, and the committed file is narrowed to `0600`
 * inside directories we create at `0700`. The pattern is the one the harness
 * itself uses (`dsh-credentials-local/lib/index.js:604-630`,
 * `dsh-settings-file/lib/index.js:163-176`); it is re-implemented on `node:fs`
 * rather than imported so this package keeps two peer dependencies.
 *
 * Every commit also **re-reads the document under the lock** and merges only
 * the facets this process changed. Two harness instances (the dev checkout and
 * the packaged app) share one `DSH_HOME`; writing the whole in-memory document
 * would let one of them resurrect state the other just replaced.
 *
 * ## Reads
 *
 * The system-prompt section is a *synchronous* function (`dsh-system-prompt`
 * evaluates `section.text(context)` without awaiting: lib/index.js:330), so the
 * store keeps one in-memory snapshot per document and renders from that.
 * {@link MemoryStore.load} warms the snapshot at boot — most-recently-modified
 * documents first, bounded by `maxBootDocs` — and {@link MemoryStore.ensure}
 * loads a document on demand for the tools. A document that is not in memory
 * renders as empty, which is the safe direction: a missing fact costs one
 * question, a stale one costs a wrong answer.
 *
 * ## Failure
 *
 * A document that is not valid JSON, or not a plausible document, is **backed
 * up** to `<file>.corrupt-<stamp>.json` (0600), journaled, and treated as empty.
 * Losing memory is bad; refusing to boot, or looping on an unreadable file, is
 * worse — and the backup means nothing is lost without a trace.
 *
 * @module abaco-memory/lib/store
 */

import { randomBytes } from 'node:crypto'
import { appendFile, chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  MEMORY_FACETS,
  MEMORY_SCHEMA_VERSION,
  MemorySchemaError,
  assertSource,
  canonicalScope,
  documentRelativePath,
  emptyDocument,
  isExpired,
  normalizeDocument,
  normalizeEntry,
  normalizeTextKey,
  parseMemoryPath,
  scopeKeyFor,
  slugify,
  sortEntries,
  splitByCap,
  valueToFields
} from './schema.js'
import { entryLine } from './render.js'

/** Permission bits: owner-only. A memory document is nobody else's business. */
const FILE_MODE = 0o600

/** Directory bits for every directory this store creates. */
const DIR_MODE = 0o700

/** Bits outside the owner. `mode & WIDE_BITS` non-zero means "too readable". */
const WIDE_BITS = 0o077

/** A document larger than this is treated as corrupt rather than parsed. */
const MAX_DOC_BYTES = 1024 * 1024

/** Retry cadence of the cross-process writer lock (same shape as `dsh-atomic-write`). */
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200

/** Default writer-lock wait; a memory commit is a small local file operation. */
const DEFAULT_LOCK_WAIT_MS = 5000

/** How many documents the boot scan loads per scope directory. */
const DEFAULT_MAX_BOOT_DOCS = 200

/* ────────────────────────────────────────────────────────────────────────────
 * Filesystem primitives
 * ──────────────────────────────────────────────────────────────────────────── */

/** Whether an exclusive create found an existing lock. */
async function isLockContention(error, lockPath) {
  const code = error?.code
  if (code === 'EEXIST') return true
  // Windows exclusive create reports EPERM; a fresh lstat tells contention
  // apart from an unrelated permission failure.
  if (code !== 'EPERM') return false
  try {
    await stat(lockPath)
    return true
  } catch {
    return false
  }
}

/**
 * Hold the cross-process writer lock for `file` around one read-merge-commit.
 *
 * @param file - the document whose writers this lock serializes.
 * @param operation - the locked operation.
 * @param waitMs - how long a contender waits before failing.
 * @returns the operation's result.
 */
async function withFileLock(file, operation, waitMs) {
  const lockPath = `${file}.lock`
  const deadline = Date.now() + waitMs
  let delay = LOCK_RETRY_INITIAL_MS
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: FILE_MODE, flag: 'wx' })
      break
    } catch (error) {
      if (!(await isLockContention(error, lockPath))) throw error
    }
    if (Date.now() >= deadline) {
      throw new Error(`abaco-memory: timed out waiting for the writer lock at ${lockPath}`)
    }
    await new Promise((settle) => setTimeout(settle, delay))
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}

/**
 * Replace `file` with `content` in one atomic step.
 *
 * The content lands in a random-suffix sibling opened with `wx` — which the
 * rename then carries, at the requested mode, over the target — so the target
 * is never observed half-written and never briefly wider than the mode asked
 * for. The caller owns the enclosing lock when a read-modify-write is involved.
 *
 * @param file - destination path.
 * @param content - complete next content.
 * @param mode - permission bits of the replacement inode.
 */
async function writeFileAtomic(file, content, mode) {
  const directory = dirname(file)
  await mkdir(directory, { recursive: true, mode: DIR_MODE })
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode, flag: 'wx' })
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/**
 * Narrow a path that is readable beyond its owner, and say whether it was.
 *
 * Called after a write rather than before a read: the commit is what creates
 * the file, and re-narrowing on every read would stat the whole store on every
 * prompt assembly.
 *
 * @param file - path to inspect.
 * @param logger - sink for the warning.
 * @returns whether the mode had to be narrowed.
 */
async function healPermissions(file, logger) {
  try {
    const info = await stat(file)
    if ((info.mode & WIDE_BITS) === 0) return false
    await chmod(file, FILE_MODE)
    logger.warn(`abaco-memory: narrowed ${file} to 0600 (it was ${(info.mode & 0o777).toString(8)})`)
    return true
  } catch {
    return false
  }
}

/** A structured clone of a JSON document, with a readable failure. */
function cloneDocument(value) {
  return JSON.parse(JSON.stringify(value))
}

/** The document key used in the in-memory map. */
function documentKey(kind, key) {
  return `${kind}:${key}`
}

/** ISO timestamp, or the caller's fixed clock (tests pass an explicit `now`). */
function stamp(now) {
  if (typeof now !== 'string') return new Date().toISOString()
  const parsed = Date.parse(now)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

/**
 * The durable memory store.
 *
 * Instances are cheap and hold no OS resources beyond the in-memory snapshot;
 * `apply()` creates exactly one for the lifetime of the plugin.
 */
export class MemoryStore {
  /** @type {string} */
  #root
  /** @type {Map<string, Record<string, any>>} */
  #documents = new Map()
  /** @type {Set<string>} */
  #loaded = new Set()
  /** @type {Map<string, Promise<unknown>>} */
  #queues = new Map()
  /** @type {Map<string, { renders: number, drops: number }>} */
  #pendingCounters = new Map()
  /** Document keys whose file exists on disk, so bookkeeping can skip empty ones. */
  #materialized = new Set()
  #maxEntryChars
  #lockWaitMs
  #maxBootDocs
  #logger
  #auditReady = false

  /**
   * @param options - root, caps and the diagnostic sink.
   */
  constructor(options = {}) {
    if (typeof options.root !== 'string' || options.root.length === 0) {
      throw new Error('abaco-memory: a store root is required')
    }
    this.#root = resolve(options.root)
    this.#maxEntryChars = Number.isInteger(options.maxEntryChars) ? options.maxEntryChars : 240
    this.#lockWaitMs = Number.isInteger(options.lockWaitMs) ? options.lockWaitMs : DEFAULT_LOCK_WAIT_MS
    this.#maxBootDocs = Number.isInteger(options.maxBootDocs) ? options.maxBootDocs : DEFAULT_MAX_BOOT_DOCS
    this.#logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {}
    }
  }

  /** Absolute memory root. */
  get root() {
    return this.#root
  }

  /** Absolute path of the append-only audit journal. */
  get auditPath() {
    return join(this.#root, 'audit', 'memory.jsonl')
  }

  /** Absolute path of one scope's document. */
  pathFor(kind, key) {
    return join(this.#root, documentRelativePath(kind, key))
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Loading
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Warm the in-memory snapshot from disk.
   *
   * Always loads `profile.json` and `roles/*.json` (a handful of small files).
   * `projects/` and `sessions/` are capped at `maxBootDocs` each, newest first
   * by modification time, because that ordering is what makes "reopen the app
   * tomorrow and continue" work: the documents that matter are the ones just
   * written. Anything outside the cap still loads on demand through
   * {@link MemoryStore.ensure}.
   *
   * Best-effort by contract: an unreadable root leaves an empty store rather
   * than failing the plugin, because a plugin that fails to load takes the
   * whole Cordis tree down with it.
   *
   * @returns the number of documents loaded.
   */
  /**
   * Create the on-disk skeleton for the three phases so a fresh install is not
   * "projects/ + audit/ only". sessions/ and roles/ are mkdir'd here; profile.json
   * appears on first profile write; audit/ comes from the journal path. Idempotent.
   */
  async ensurePhaseLayout() {
    for (const dir of ['projects', 'sessions', 'roles', 'audit', join('audit', 'archive'), 'vault']) {
      try {
        await mkdir(join(this.#root, dir), { recursive: true, mode: DIR_MODE })
      } catch (error) {
        this.#logger.warn(`abaco-memory: could not create ${dir}/: ${describe(error)}`)
      }
    }
  }

  async load() {
    await this.ensurePhaseLayout()
    let loaded = 0
    try {
      const profile = await this.#readDocumentFile(this.pathFor('profile', ''), 'profile', '')
      if (profile !== undefined) {
        this.#remember('profile', '', profile)
        loaded += 1
      }
      this.#loaded.add(documentKey('profile', ''))
      if (profile !== undefined) this.#materialized.add(documentKey('profile', ''))
      loaded += await this.#loadDirectory('roles', 'role')
      loaded += await this.#loadDirectory('projects', 'project')
      loaded += await this.#loadDirectory('sessions', 'session')
    } catch (error) {
      this.#logger.warn(`abaco-memory: could not warm the memory snapshot: ${describe(error)}`)
    }
    return loaded
  }

  /** Load a bounded, newest-first slice of one scope directory. */
  async #loadDirectory(directory, kind) {
    const base = join(this.#root, directory)
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 0
      throw error
    }
    const candidates = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const file = join(base, entry.name)
      try {
        const info = await stat(file)
        candidates.push({ file, mtimeMs: info.mtimeMs })
      } catch {
        // A file that vanished between readdir and stat is simply not loaded.
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
    let loaded = 0
    for (const candidate of candidates.slice(0, this.#maxBootDocs)) {
      const key = candidate.file.slice(base.length + 1, -'.json'.length)
      const document = await this.#readDocumentFile(candidate.file, kind, key)
      if (document !== undefined) {
        this.#remember(kind, key, document)
        this.#materialized.add(documentKey(kind, key))
        loaded += 1
      }
      this.#loaded.add(documentKey(kind, key))
    }
    return loaded
  }

  /**
   * Load one document if it is not already in the snapshot.
   *
   * @param kind - scope kind.
   * @param key - scope key.
   * @returns the in-memory document (a fresh empty one when nothing is on disk).
   */
  async ensure(kind, key) {
    const id = documentKey(kind, key)
    if (this.#loaded.has(id) && this.#documents.has(id)) return this.#documents.get(id)
    if (this.#loaded.has(id)) {
      const document = emptyDocument(kind, key)
      this.#applyPendingCounters(id, document)
      this.#documents.set(id, document)
      return document
    }
    const file = this.pathFor(kind, key)
    const loaded = await this.#readDocumentFile(file, kind, key)
    const document = loaded ?? emptyDocument(kind, key)
    this.#applyPendingCounters(id, document)
    this.#remember(kind, key, document)
    if (loaded !== undefined) this.#materialized.add(id)
    this.#loaded.add(id)
    return this.#documents.get(id)
  }

  /** Install a loaded document. */
  #remember(kind, key, document) {
    this.#documents.set(documentKey(kind, key), document)
  }

  /**
   * Read and validate one document file.
   *
   * @param file - absolute path.
   * @param kind - expected scope kind.
   * @param key - expected scope key.
   * @returns the document, or `undefined` when it is absent or quarantined.
   */
  async #readDocumentFile(file, kind, key) {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
      await this.#quarantine(file, text, `document exceeds ${MAX_DOC_BYTES} bytes`)
      return undefined
    }
    try {
      return normalizeDocument(JSON.parse(text), kind, key)
    } catch (error) {
      await this.#quarantine(file, text, describe(error))
      return undefined
    }
  }

  /**
   * Move an unusable document aside and journal why.
   *
   * The original file is left in place; the next successful commit replaces it.
   * The backup is what makes "treat it as empty" safe rather than destructive.
   */
  async #quarantine(file, text, reason) {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`
    try {
      await writeFileAtomic(backup, text, FILE_MODE)
    } catch (error) {
      this.#logger.warn(`abaco-memory: could not back up the unreadable document ${file}: ${describe(error)}`)
    }
    this.#logger.warn(`abaco-memory: ${file} is not valid memory (${reason}); backed it up and started empty`)
    await this.#audit({
      op: 'quarantine',
      file: relative(this.#root, file),
      backup: relative(this.#root, backup),
      reason
    })
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Snapshot reads (synchronous, for the prompt section)
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * The documents that apply to one live identity, as loaded.
   *
   * Synchronous by necessity: the prompt section renders inside `assemble()`,
   * which never awaits. A document the boot scan did not reach is reported as
   * absent, and {@link MemoryStore.ensure} will have loaded the ones a running
   * agent touches.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @returns one entry per scope, always in profile → project → session → role order.
   */
  snapshot(ambient = {}) {
    const scopes = [
      ['profile', ''],
      ['project', scopeKeyFor('project', ambient)],
      ['session', scopeKeyFor('session', ambient)],
      ['role', scopeKeyFor('role', ambient)]
    ]
    const found = []
    for (const [kind, key] of scopes) {
      const document = this.#documents.get(documentKey(kind, key))
      if (document === undefined) continue
      found.push({ kind, key, facets: document.facets, meta: document.meta })
    }
    return found
  }

  /**
   * The live document of one scope, or `undefined` when it is not loaded.
   *
   * @param kind - scope kind.
   * @param key - scope key.
   * @returns the document, without loading it.
   */
  peek(kind, key) {
    return this.#documents.get(documentKey(kind, key))
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Writes
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Upsert one facet value.
   *
   * @param request - `{ path, value, scope?, source, ttlDays?, ambient?, now?, reason? }`.
   * @returns a model-facing summary of what changed.
   */
  async set(request) {
    const parsed = parseMemoryPath(request.path)
    const spec = MEMORY_FACETS[parsed.facet]
    const scope = canonicalScope(request.scope ?? 'auto')
    const kind = scope === 'auto' ? spec.scope : scope
    const key = scopeKeyFor(kind, request.ambient ?? {})
    if (isSubagentAmbient(request.ambient) && kind === 'profile') {
      throw new MemorySchemaError(
        'subagents cannot write the parent profile; persist project (log) or session (note) facts instead.',
        'MEMORY_SUBAGENT_PROFILE'
      )
    }
    const source = assertSource(request.source)
    const now = stamp(request.now)
    const document = await this.ensure(kind, key)
    const before = cloneDocument(document)
    const facet = parsed.facet
    const previous = document.facets[facet]
    let action = 'created'
    let id = parsed.id
    let archived = 0
    /** @type {{entry: Record<string, any>, reason: string}[]} */
    let evictions = []

    if (parsed.kind === 'record') {
      const current = previous !== undefined && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {}
      const next = applyRecordPatch(current, parsed, request.value, this.#maxEntryChars)
      if (Object.keys(current).length > 0) action = 'updated'
      document.facets[facet] = next
    } else {
      const entries = Array.isArray(previous) ? [...previous] : []
      const outcome = applyCollectionPatch(entries, parsed, request, { now, source, maxEntryChars: this.#maxEntryChars, facet })
      action = outcome.action
      id = outcome.id
      const survivor = outcome.entries
      // Evict what has expired before deciding what the cap evicts, so a dead
      // entry never displaces a live one.
      const expired = survivor.filter((entry) => isExpired(entry, Date.parse(now)))
      const live = survivor.filter((entry) => !isExpired(entry, Date.parse(now)))
      const { keep, evict } = splitByCap(live, spec.cap)
      document.facets[facet] = keep
      // Archiving is deferred until after the commit: a failed commit rolls the
      // document back, and the journal must not claim to hold what is still there.
      evictions = [
        ...expired.map((entry) => ({ entry, reason: 'expired' })),
        ...evict.map((entry) => ({ entry, reason: 'over-cap' }))
      ]
      archived = evictions.length
    }

    document.meta = { ...document.meta, lastWriteReason: request.reason ?? 'memory_set', lastWriteAt: now }
    try {
      await this.#commit(kind, key, new Set([facet]))
    } catch (error) {
      this.#documents.set(documentKey(kind, key), before)
      throw error
    }
    for (const eviction of evictions) {
      await this.#archive(kind, key, facet, [eviction.entry], eviction.reason)
    }
    const entry = parsed.kind === 'collection'
      ? document.facets[facet]?.find((candidate) => candidate.id === id)
      : undefined
    await this.#audit({
      op: 'set',
      scope: { kind, key },
      path: parsed.path,
      facet,
      id,
      action,
      source,
      archived,
      reason: request.reason ?? 'memory_set'
    })
    return {
      ok: true,
      path: parsed.path,
      facet,
      scope: { kind, key },
      id,
      action,
      archived,
      bytesRendered: entry === undefined ? undefined : entryLine(facet, entry).length
    }
  }

  /**
   * Remove a facet, one entry, or one field of one entry.
   *
   * @param request - `{ path, scope?, ambient?, reason? }`.
   * @returns how many values were removed.
   */
  async forget(request) {
    const parsed = parseMemoryPath(request.path)
    const spec = MEMORY_FACETS[parsed.facet]
    const scope = canonicalScope(request.scope ?? 'auto')
    const kind = scope === 'auto' ? spec.scope : scope
    const key = scopeKeyFor(kind, request.ambient ?? {})
    const document = await this.ensure(kind, key)
    const before = cloneDocument(document)
    const facet = parsed.facet
    const previous = document.facets[facet]
    let removed = 0

    if (parsed.kind === 'record') {
      if (previous === undefined) removed = 0
      else if (parsed.field !== undefined) {
        if (Object.hasOwn(previous, parsed.field)) {
          const next = { ...previous }
          delete next[parsed.field]
          if (Object.keys(next).length === 0) delete document.facets[facet]
          else document.facets[facet] = next
          removed = 1
        }
      } else {
        delete document.facets[facet]
        removed = 1
      }
    } else if (Array.isArray(previous)) {
      const selector = parsed.id
      const textKey = normalizeTextKey(parsed.id ?? '')
      const kept = previous.filter((entry) => {
        const matches = selector === undefined
          ? true
          : entry.id === selector || normalizeTextKey(entry.text) === textKey
        if (matches) removed += 1
        return !matches
      })
      if (kept.length === 0) delete document.facets[facet]
      else document.facets[facet] = kept
    }

    if (removed === 0) return { ok: true, path: parsed.path, facet, scope: { kind, key }, removed: 0 }
    document.meta = { ...document.meta, lastWriteReason: request.reason ?? 'memory_forget' }
    try {
      await this.#commit(kind, key, new Set([facet]))
    } catch (error) {
      this.#documents.set(documentKey(kind, key), before)
      throw error
    }
    await this.#audit({
      op: 'forget',
      scope: { kind, key },
      path: parsed.path,
      facet,
      id: parsed.id,
      removed,
      reason: request.reason ?? 'memory_forget'
    })
    return { ok: true, path: parsed.path, facet, scope: { kind, key }, removed }
  }

  /**
   * Read memory back: a whole facet, one entry, or everything that applies to
   * the caller. The injected block is already in the system prompt; this is the
   * on-demand view with provenance and locators (design §3.1).
   *
   * @param request - `{ path?, scope?, ambient? }`.
   * @returns the selection, in render order.
   */
  async get(request = {}) {
    const ambient = request.ambient ?? {}
    const scope = canonicalScope(request.scope ?? 'auto')
    const parsed = request.path === undefined || request.path === null || request.path === ''
      ? undefined
      : parseMemoryPath(request.path)

    const targets = []
    if (parsed === undefined) {
      const kinds = scope === 'auto' ? ['profile', 'project', 'session', 'role'] : [scope]
      for (const kind of kinds) targets.push({ kind, key: scopeKeyFor(kind, ambient), facet: undefined })
    } else {
      const spec = MEMORY_FACETS[parsed.facet]
      const kind = scope === 'auto' ? spec.scope : scope
      targets.push({ kind, key: scopeKeyFor(kind, ambient), facet: parsed.facet, parsed })
    }

    const results = []
    const locators = []
    let entries = 0
    for (const target of targets) {
      const document = await this.ensure(target.kind, target.key)
      const names = target.facet === undefined ? Object.keys(document.facets) : [target.facet]
      for (const name of names) {
        if (target.facet === undefined && !MEMORY_FACETS[name]?.injected) continue
        if (MEMORY_FACETS[name] === undefined) continue
        const value = document.facets[name]
        if (value === undefined) continue
        if (MEMORY_FACETS[name].kind === 'record') {
          if (!isPlainObject(value)) continue
          results.push({ facet: name, scope: { kind: target.kind, key: target.key }, record: value, entries: [] })
          continue
        }
        const selected = target.parsed?.id === undefined
          ? sortEntries(value)
          : sortEntries(value.filter((entry) => entry.id === target.parsed.id || normalizeTextKey(entry.text) === normalizeTextKey(target.parsed.id)))
        if (selected.length === 0) continue
        entries += selected.length
        for (const entry of selected) if (typeof entry.locator === 'string') locators.push(entry.locator)
        results.push({ facet: name, scope: { kind: target.kind, key: target.key }, record: undefined, entries: selected })
      }
    }
    return { path: parsed?.path, scope, facets: results, count: entries, locators }
  }

  /**
   * List what the store holds, without returning the values.
   *
   * @param request - `{ ambient? }`.
   * @returns one row per facet found across every scope document.
   */
  async list(request = {}) {
    const ambient = request.ambient ?? {}
    const scopes = [
      ['profile', ''],
      ['project', scopeKeyFor('project', ambient)],
      ['session', scopeKeyFor('session', ambient)],
      ['role', scopeKeyFor('role', ambient)]
    ]
    const rows = []
    for (const [kind, key] of scopes) {
      const document = await this.ensure(kind, key)
      for (const [facet, value] of Object.entries(document.facets)) {
        if (!MEMORY_FACETS[facet]?.injected) continue
        const count = MEMORY_FACETS[facet].kind === 'record' ? Object.keys(value ?? {}).length : (value?.length ?? 0)
        const lastWrite = MEMORY_FACETS[facet].kind === 'record'
          ? undefined
          : sortEntries(value ?? [])[0]?.updatedAt
        rows.push({ facet, scope: { kind, key }, count, lastWriteAt: lastWrite })
      }
    }
    return {
      rows,
      total: rows.reduce((sum, row) => sum + row.count, 0),
      root: this.#root
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Deterministic turn-boundary bookkeeping (design §3.2 trigger 2, no LLM)
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Record the end of a turn on the session document: this is the barrier that
   * lets the next turn's render see this turn's writes (design §3.2, "regla de
   * oro"), and it is where a reviewer can see how much memory the agent has
   * actually been reading.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @param turn - the turn that just closed.
   * @returns whether anything was written.
   */
  async markTurnStop(ambient = {}, turn = 0) {
    const key = scopeKeyFor('session', ambient)
    const id = documentKey('session', key)
    const document = await this.ensure('session', key)
    document.meta = {
      ...document.meta,
      lastTurn: Number.isInteger(turn) ? turn : document.meta.lastTurn,
      lastWriteReason: 'turn-stop',
      lastWriteAt: new Date().toISOString()
    }
    // A session that never remembered anything is bookkeeping without content.
    // Its counters stay live in memory, but no file is created: otherwise every
    // session the user ever opens would collect one, and the boot scan's
    // bounded newest-first window would slowly fill with empty documents.
    if (Object.keys(document.facets).length === 0 && !this.#materialized.has(id)) return false
    await this.#commit('session', key, new Set())
    return true
  }

  /**
   * Count one rendered block. Synchronous: it runs inside `assemble()`, so it
   * only touches memory and the persistence happens at the turn boundary.
   *
   * The counter is buffered when the session document does not exist yet — the
   * ordinary case for a session's first turn, which is exactly the turn whose
   * renders are worth counting.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @param drops - how many entries the budget left out.
   */
  noteRender(ambient = {}, drops = 0) {
    const id = documentKey('session', scopeKeyFor('session', ambient))
    const document = this.#documents.get(id)
    if (document === undefined) {
      const pending = this.#pendingCounters.get(id) ?? { renders: 0, drops: 0 }
      this.#pendingCounters.set(id, { renders: pending.renders + 1, drops: pending.drops + drops })
      return
    }
    document.meta = {
      ...document.meta,
      renders: (document.meta.renders ?? 0) + 1,
      drops: (document.meta.drops ?? 0) + drops
    }
  }

  /** Fold a buffered render count into the document that just appeared. */
  #applyPendingCounters(id, document) {
    const pending = this.#pendingCounters.get(id)
    if (pending === undefined) return
    document.meta = {
      ...document.meta,
      renders: (document.meta.renders ?? 0) + pending.renders,
      drops: (document.meta.drops ?? 0) + pending.drops
    }
    this.#pendingCounters.delete(id)
  }

  /**
   * Principle C flag: read the session document's `meta.compactionConsent`.
   * Lives on the sidecar so it survives the compaction it is gating.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @returns `{ state, armed }`.
   */
  async readConsent(ambient = {}) {
    const key = scopeKeyFor('session', ambient)
    const document = await this.ensure('session', key)
    return normalizeConsentRecord(document.meta?.compactionConsent)
  }

  /**
   * Principle C flag: persist the session consent record.
   *
   * Always commits, even on an otherwise empty session document: the flag
   * must outlive the compaction it allows.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @param consent - `{ state, armed }` or a legacy string.
   * @returns the stored record.
   */
  async writeConsent(ambient = {}, consent) {
    const key = scopeKeyFor('session', ambient)
    const document = await this.ensure('session', key)
    const next = normalizeConsentRecord(consent)
    document.meta = {
      ...document.meta,
      compactionConsent: next,
      lastWriteReason: 'compaction-consent',
      lastWriteAt: new Date().toISOString()
    }
    await this.#commit('session', key, new Set())
    await this.#audit({
      op: 'compaction-consent',
      scope: { kind: 'session', key },
      state: next.state,
      armed: next.armed
    })
    return next
  }

  /**
   * Write-protocol step 2: before an authorized compaction, make sure
   * profile / project (log) documents are on disk and journal the flush.
   * Does not invent facts — it persists what is already in the store.
   *
   * @param ambient - `{ cwd, sessionId, agentPreset }`.
   * @param reason - audit reason; default `pre-compact`.
   * @returns `{ ok, persisted }` naming the documents that were committed.
   */
  async persistBeforeCompact(ambient = {}, reason = 'pre-compact') {
    const now = new Date().toISOString()
    const scopes = [
      ['profile', ''],
      ['project', scopeKeyFor('project', ambient)],
      ['session', scopeKeyFor('session', ambient)]
    ]
    const persisted = []
    for (const [kind, key] of scopes) {
      const document = await this.ensure(kind, key)
      const id = `${kind}:${key}`
      const hasFacets = Object.keys(document.facets ?? {}).length > 0
      if (!hasFacets && !this.#materialized.has(id) && kind !== 'profile') continue
      document.meta = { ...document.meta, lastWriteReason: reason, lastWriteAt: now }
      await this.#commit(kind, key, new Set())
      persisted.push({ kind, key, path: this.pathFor(kind, key) })
    }
    await this.#audit({
      op: 'pre-compact',
      ambient: { cwd: ambient.cwd, sessionId: ambient.sessionId },
      persisted,
      reason
    })
    return { ok: true, persisted }
  }

  async gc(now = new Date().toISOString()) {
    const nowMs = Date.parse(now)
    let archived = 0
    for (const [id, document] of [...this.#documents.entries()]) {
      const changed = new Set()
      for (const [facet, value] of Object.entries(document.facets)) {
        if (!Array.isArray(value)) continue
        const expired = value.filter((entry) => isExpired(entry, nowMs))
        if (expired.length === 0) continue
        const live = value.filter((entry) => !isExpired(entry, nowMs))
        await this.#archive(document.scope.kind, document.scope.key, facet, expired, 'expired')
        if (live.length === 0) delete document.facets[facet]
        else document.facets[facet] = live
        changed.add(facet)
        archived += expired.length
      }
      if (changed.size === 0) continue
      document.meta = { ...document.meta, lastWriteReason: 'gc', lastWriteAt: stamp(now) }
      try {
        await this.#commit(document.scope.kind, document.scope.key, changed)
      } catch (error) {
        this.#logger.warn(`abaco-memory: gc commit failed for ${id}: ${describe(error)}`)
      }
    }
    return archived
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Commit, journal, archive
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Persist the facets this process changed, merged into what is on disk.
   *
   * The read inside the lock is the point: it is what keeps a second harness
   * instance from losing state it never touched (design §7.1 risk 8).
   */
  async #commit(kind, key, changedFacets) {
    const id = documentKey(kind, key)
    const memory = this.#documents.get(id)
    if (memory === undefined) return
    const file = this.pathFor(kind, key)
    // The writer lock is a `wx`-created sibling, so its directory has to exist
    // before the lock is taken — the atomic write creates it too late.
    await mkdir(dirname(file), { recursive: true, mode: DIR_MODE })
    await this.#serialize(file, async () => {
      const disk = await this.#readDocumentFile(file, kind, key)
      const base = disk ?? emptyDocument(kind, key)
      for (const facet of changedFacets) {
        const value = memory.facets[facet]
        if (value === undefined) delete base.facets[facet]
        else base.facets[facet] = cloneDocument(value)
      }
      base.version = MEMORY_SCHEMA_VERSION
      base.scope = { kind, key }
      base.updatedAt = stamp(memory.meta?.lastWriteAt)
      base.meta = { ...base.meta, ...memory.meta }
      await writeFileAtomic(file, `${JSON.stringify(base, null, 2)}\n`, FILE_MODE)
      await healPermissions(file, this.#logger)
      this.#documents.set(id, base)
      this.#loaded.add(id)
      this.#materialized.add(id)
    })
  }

  /** Serialize operations on one file inside this process, then across processes. */
  #serialize(file, operation) {
    const previous = this.#queues.get(file) ?? Promise.resolve()
    const next = previous.then(
      () => withFileLock(file, operation, this.#lockWaitMs),
      () => withFileLock(file, operation, this.#lockWaitMs)
    )
    this.#queues.set(
      file,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }

  /** Append one journal record. Best-effort: it never fails a memory write. */
  async #audit(record) {
    try {
      const file = this.auditPath
      await mkdir(dirname(file), { recursive: true, mode: DIR_MODE })
      await appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, {
        mode: FILE_MODE
      })
      if (!this.#auditReady) {
        await healPermissions(file, this.#logger)
        this.#auditReady = true
      }
    } catch (error) {
      this.#logger.warn(`abaco-memory: could not write the audit journal: ${describe(error)}`)
    }
  }

  /**
   * Move entries out of a document into the monthly archive.
   *
   * Archived, never deleted: design §3.4 requires that nothing leaves the store
   * without a copy an operator can read.
   */
  async #archive(kind, key, facet, entries, reason) {
    const month = new Date().toISOString().slice(0, 7)
    const file = join(this.#root, 'audit', 'archive', `${month}.jsonl`)
    try {
      await mkdir(dirname(file), { recursive: true, mode: DIR_MODE })
      const lines = entries.map((entry) =>
        JSON.stringify({
          ts: new Date().toISOString(),
          op: 'archive',
          reason,
          scope: { kind, key },
          facet,
          entry
        })
      )
      await appendFile(file, `${lines.join('\n')}\n`, { mode: FILE_MODE })
      await healPermissions(file, this.#logger)
    } catch (error) {
      this.#logger.warn(`abaco-memory: could not archive from ${facet}: ${describe(error)}`)
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Patch application
 * ──────────────────────────────────────────────────────────────────────────── */

/** Whether a value is a plain JSON object. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether the caller is a delegated child (must not write the parent profile). */
function isSubagentAmbient(ambient) {
  if (ambient === null || typeof ambient !== 'object') return false
  if (ambient.origin === 'subagent') return true
  return typeof ambient.delegationDepth === 'number' && ambient.delegationDepth > 0
}

/**
 * Normalize a stored Principle C flag. Mirrors `abaco-context/lib/consent.js`
 * so the sidecar and the wrapper agree on the same three states.
 */
function normalizeConsentRecord(value) {
  if (value === 'allowed' || value === 'accepted' || value === true) {
    return { state: 'allowed', armed: true }
  }
  if (value === 'rejected' || value === false) {
    return { state: 'rejected', armed: false }
  }
  if (isPlainObject(value)) {
    const state =
      value.state === 'allowed' || value.state === 'rejected' || value.state === 'unset' ? value.state : 'unset'
    return { state, armed: value.armed !== false }
  }
  return { state: 'unset', armed: true }
}

/** A readable message out of an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Apply a write to a single-value facet.
 *
 * @param current - the facet's current record.
 * @param parsed - the parsed path.
 * @param value - the model-supplied value.
 * @param maxEntryChars - the cap for the `text` field.
 * @returns the next record.
 */
function applyRecordPatch(current, parsed, value, maxEntryChars) {
  if (parsed.field !== undefined) {
    assertJsonValue(value, `"${parsed.field}"`)
    if (parsed.field === 'text' && typeof value !== 'string') {
      throw new MemorySchemaError('"text" must be a string', 'MEMORY_BAD_VALUE')
    }
    if (typeof value === 'string' && value.length > maxEntryChars) {
      throw new MemorySchemaError(
        `"${parsed.field}" is ${value.length} characters, over the ${maxEntryChars}-character cap. Keep the memory entry short and put the full content in a file.`,
        'MEMORY_TOO_LONG'
      )
    }
    return { ...current, [parsed.field]: value }
  }
  const fields = valueToFields(value)
  const next = { ...current }
  for (const [field, fieldValue] of Object.entries(fields)) {
    assertJsonValue(fieldValue, `"${field}"`)
    if (typeof fieldValue === 'string' && fieldValue.length > maxEntryChars) {
      throw new MemorySchemaError(
        `"${field}" is ${fieldValue.length} characters, over the ${maxEntryChars}-character cap. Keep the memory entry short and put the full content in a file.`,
        'MEMORY_TOO_LONG'
      )
    }
    next[field] = fieldValue
  }
  return next
}

/** Reject values JSON cannot carry. */
function assertJsonValue(value, label) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new MemorySchemaError(`${label} must be a JSON value`, 'MEMORY_BAD_VALUE')
  }
}

/**
 * Apply a write to an id-keyed collection facet.
 *
 * Appending dedupes on normalized text (design §3.4), so a fact written twice
 * updates one entry instead of creating a twin; an explicit id always upserts
 * that entry.
 *
 * @param entries - the facet's current entries.
 * @param parsed - the parsed path.
 * @param request - the caller's request (for value, priority, ttl…).
 * @param context - clock, provenance, cap and facet name.
 * @returns the next entries plus what happened.
 */
function applyCollectionPatch(entries, parsed, request, context) {
  const { now, source, maxEntryChars, facet } = context
  const patchFields = {}
  let id = parsed.id

  if (parsed.append) {
    if (parsed.field !== undefined && parsed.field !== 'text') {
      throw new MemorySchemaError(
        `appending to "${facet}" with a field is not supported; append the entry and then write "${facet}.<id>.${parsed.field}"`,
        'MEMORY_BAD_PATH'
      )
    }
    const fields = parsed.field === 'text' ? { text: request.value } : valueToFields(request.value)
    if (isPlainObject(request.value) && typeof request.value.id === 'string' && request.value.id.length > 0) {
      id = slugify(request.value.id, 'entry')
    } else {
      const textKey = normalizeTextKey(fields.text)
      const twin = textKey.length === 0
        ? undefined
        : entries.find((entry) => normalizeTextKey(entry.text) === textKey)
      id = twin?.id ?? slugify(fields.text ?? '', `entry-${entries.length + 1}`)
    }
    Object.assign(patchFields, fields)
  } else if (parsed.field !== undefined) {
    assertJsonValue(request.value, `"${parsed.field}"`)
    patchFields[parsed.field] = request.value
  } else {
    Object.assign(patchFields, valueToFields(request.value))
  }

  if (request.priority !== undefined) patchFields.priority = request.priority
  if (request.pinned !== undefined) patchFields.pinned = request.pinned
  if (request.rationale !== undefined) patchFields.rationale = request.rationale
  if (typeof id !== 'string' || id.length === 0) {
    throw new MemorySchemaError(
      `"${parsed.path}" does not name an entry; use "${facet}.<id>" or "${facet}[+]"`,
      'MEMORY_BAD_PATH'
    )
  }
  const existing = entries.find((entry) => entry.id === id)
  const next = normalizeEntry(existing, { ...patchFields }, {
    id,
    source,
    now,
    maxEntryChars,
    ttlDays: request.ttlDays,
    facet
  })
  const replaced = existing === undefined ? [...entries, next] : entries.map((entry) => (entry.id === id ? next : entry))
  return { entries: replaced, id, action: existing === undefined ? 'created' : 'updated' }
}
