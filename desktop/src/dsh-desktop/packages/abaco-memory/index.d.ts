/**
 * Types for the host half of the `abaco-memory` plugin.
 *
 * The Cordis surface (`name`, `inject`, `apply`) is declared against `unknown`
 * rather than Cordis's `Context`, exactly like `abaco-browser` and
 * `dsh-desktop-preset-transfer`: this half only ever touches
 * `ctx.tools.register`, `ctx.systemPrompt.section`, `ctx.on` and `ctx.logger`,
 * and typing the whole service surface here would tie the declaration to a
 * harness version the plugin does not otherwise depend on.
 *
 * The store, the renderer and their option/result shapes *are* declared
 * precisely, because `test/abaco-memory.test.ts` imports them and drives the
 * shipped code path directly: it mounts the plugin against a minimal context,
 * executes the registered tools against a temporary `DSH_HOME`, and reads the
 * prompt section through `MemoryRenderer.sectionText`.
 */

/** Diagnostic sink; the plugin degrades to silence when `ctx.logger` is absent. */
export interface MemoryLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Resolved plugin configuration, as `resolveMemoryConfig` produces it. */
export interface MemoryConfig {
  /** Absolute memory root. */
  root: string
  /** When false, neither the prompt section nor the tools are registered. */
  enabled: boolean
  /** Hard cap of the injected block, in characters. */
  maxRenderChars: number
  /** Cap of one entry's `text`, in characters. */
  maxEntryChars: number
  /** Per-scope share of the render budget, in characters. */
  scopeBudgets: Record<string, number>
  /** Freeze the block for the duration of a turn (writes land in the next one). */
  freezePerTurn: boolean
  /** Inject the block into delegated child agents too. */
  includeInSubagents: boolean
  /** How long a writer waits for the cross-process document lock. */
  lockWaitMs: number
  /** How many documents per scope directory the boot scan loads. */
  maxBootDocs: number
}

/** The live identity of an agent, used to pick the documents that apply to it. */
export interface MemoryAmbient {
  cwd?: string
  sessionId?: string
  agentPreset?: string
}

/** The session header fields the memory layer reads. */
export interface MemorySessionHeader {
  id?: string
  cwd?: string
  agentPreset?: string
  origin?: string
  delegationDepth?: number
}

/** The assembly context `systemPrompt` hands to a section's `text` function. */
export interface MemoryPromptContext {
  agent?: { session?: { header?: MemorySessionHeader } }
}

/** Trust tier of a memory entry: who vouches for the content. */
export type MemoryTrust = 'host' | 'user' | 'plugin-data' | 'untrusted'

/** The three durable-memory write/aging phases (F1.5 packager). */
export type MemoryPhase = 'profile' | 'log' | 'note'

/** Admission state of a collection entry. */
export type QuarantineState = 'admitted' | 'quarantined'

/**
 * Note on `lib/quarantine.js`: `index.js` does not re-export its helpers
 * (`trustOf`, `assertTrust`, `initialStateFor`, `isQuarantined`), so they are
 * intentionally not declared here. They stay store-internal; the tool layer
 * mirrors only the store's outcome and never re-derives trust or state itself.
 */

/** One entry of a list facet. */
export interface MemoryEntry {
  id: string
  text: string
  priority: number
  pinned: boolean
  source: string
  /** Who vouches for this entry; derived from `source` when the write omits it. */
  trust?: MemoryTrust
  /** Quarantined entries never reach the injected prompt block. */
  state?: QuarantineState
  createdAt: string
  updatedAt: string
  expiresAt?: string
  rationale?: string
  locator?: string
  status?: string
  next_action?: string
  bytes?: number
  taskId?: string
  [field: string]: unknown
}

/** Document-level bookkeeping, written at each turn boundary. */
export interface MemoryDocumentMeta {
  lastTurn: number
  lastWriteReason: string
  renders: number
  drops: number
  lastWriteAt?: string
  [field: string]: unknown
}

/** One scope's memory document, as persisted. */
export interface MemoryDocument {
  version: number
  scope: { kind: string; key: string }
  updatedAt: string
  facets: Record<string, unknown>
  meta: MemoryDocumentMeta
}

/** One document as the renderer sees it: read synchronously, never loaded here. */
export interface MemorySnapshotEntry {
  kind: string
  key: string
  facets: Record<string, unknown>
  meta: MemoryDocumentMeta
}

/** What one facet of a `get` result holds. */
export interface MemoryGetFacet {
  facet: string
  scope: { kind: string; key: string }
  record?: Record<string, unknown>
  entries: MemoryEntry[]
}

/** Result of `MemoryStore.set`. */
export interface MemorySetOutcome {
  ok: boolean
  path: string
  facet: string
  scope: { kind: string; key: string }
  id?: string
  action: 'created' | 'updated'
  archived: number
  bytesRendered?: number
  /** The trust tier the write was stored with. */
  trust?: MemoryTrust
  /** For list facets: whether the entry is live or held in quarantine. */
  state?: QuarantineState
}

/** Result of `MemoryStore.forget`. */
export interface MemoryForgetOutcome {
  ok: boolean
  path: string
  facet: string
  scope: { kind: string; key: string }
  removed: number
}

/** Result of `MemoryStore.get`. */
export interface MemoryGetResult {
  path?: string
  scope: string
  facets: MemoryGetFacet[]
  count: number
  locators: string[]
}

/** Result of `MemoryStore.list`. */
export interface MemoryListResult {
  rows: { facet: string; scope: { kind: string; key: string }; count: number; lastWriteAt?: string }[]
  total: number
  root: string
}

/** Outcome of rendering the block, including what the budget left out. */
export interface MemoryRenderOutcome {
  text: string
  included: number
  dropped: number
}

/** Description of one facet in the registry. */
export interface MemoryFacetSpec {
  scope: 'profile' | 'project' | 'session' | 'role'
  kind: 'record' | 'collection'
  cap: number
  ttlDays?: number
  injected: boolean
}

/** The facet registry, keyed by canonical facet name. */
export declare const MEMORY_FACETS: Record<string, MemoryFacetSpec>

/** Directory created under the harness home: `abaco-memory`. */
export declare const MEMORY_DIR_NAME: string

/** Name of the injected prompt section. */
export declare const MEMORY_SECTION_NAME: string

/** Order of the injected prompt section, between the persona and the plan policy. */
export declare const MEMORY_SECTION_ORDER: number

/** Resolve the plugin's row config, applying every default. */
export declare function resolveMemoryConfig(raw?: Record<string, unknown>): MemoryConfig

/** The durable, faceted sidecar store. */
export declare class MemoryStore {
  constructor(options: {
    root: string
    maxEntryChars?: number
    lockWaitMs?: number
    maxBootDocs?: number
    logger?: MemoryLogger
  })
  readonly root: string
  readonly auditPath: string
  /** Absolute path of one scope's document. */
  pathFor(kind: string, key: string): string
  /** Warm the in-memory snapshot from disk; returns how many documents loaded. */
  load(): Promise<number>
  /** Load one document on demand. */
  ensure(kind: string, key: string): Promise<MemoryDocument>
  /** The live document of one scope, without loading it. */
  peek(kind: string, key: string): MemoryDocument | undefined
  /** The loaded documents that apply to one identity. */
  snapshot(ambient?: MemoryAmbient): MemorySnapshotEntry[]
  /** Upsert one facet value. */
  set(request: {
    path: string
    value: unknown
    scope?: string
    source: string
    /** Optional override; the store derives trust from `source` when omitted. */
    trust?: MemoryTrust
    ttlDays?: number
    priority?: number
    pinned?: boolean
    rationale?: string
    ambient?: MemoryAmbient
    reason?: string
    now?: string
  }): Promise<MemorySetOutcome>
  /** Remove a facet, one entry, or one field. */
  forget(request: {
    path: string
    scope?: string
    ambient?: MemoryAmbient
    reason?: string
  }): Promise<MemoryForgetOutcome>
  /**
   * F1.5: package a write through 3-phase provenance, then commit via `set`.
   * Additive — `set` / `promote` stay the Pack A lock.
   */
  package(request: {
    path: string
    value: unknown
    scope?: string
    source: string
    trust?: MemoryTrust
    phase?: MemoryPhase
    claim?: string
    channel?: string
    attestor?: string | { id?: string; trust?: MemoryTrust; role?: string }
    admit?: boolean
    target?: string
    ttlDays?: number
    priority?: number
    pinned?: boolean
    rationale?: string
    ambient?: MemoryAmbient
    reason?: string
    now?: string
  }): Promise<MemorySetOutcome>
  /**
   * Promote a quarantined collection entry to admitted, after human review.
   *
   * Fail-closed: only an entry whose `state` is `'quarantined'` can be
   * promoted; the reviewer is recorded in the audit journal. Async because it
   * commits to disk like every other write.
   */
  promote(request: {
    path: string
    reviewer: { id: string; trust: MemoryTrust }
  }): Promise<{ ok: true; id: string; state: 'admitted' }>
  /** Read memory back in detail. */
  get(request?: { path?: string; scope?: string; ambient?: MemoryAmbient }): Promise<MemoryGetResult>
  /** List facets and their sizes without returning the values. */
  list(request?: { ambient?: MemoryAmbient }): Promise<MemoryListResult>
  /** Deterministic turn-boundary bookkeeping, and the barrier for the render cache. */
  markTurnStop(ambient?: MemoryAmbient, turn?: number): Promise<boolean>
  /** Count one rendered block (synchronous: it runs inside `assemble`). */
  noteRender(ambient?: MemoryAmbient, drops?: number): void
  /** Archive everything that has expired. */
  gc(now?: string): Promise<number>
}

/** Renders the store's snapshot into the `abaco:durable-memory` section. */
export declare class MemoryRenderer {
  constructor(options: { store: MemoryStore; config: MemoryConfig; logger?: MemoryLogger })
  /** The section's `text` function; never throws. */
  sectionText(context: MemoryPromptContext): string
  /** Render for an identity, bypassing the per-turn cache. */
  render(ambient?: MemoryAmbient): MemoryRenderOutcome
  /** Drop one session's frozen block. */
  invalidate(sessionId: string): void
  /** Drop every frozen block. */
  clear(): void
}

/** The three durable-memory phases. */
export declare const MEMORY_PHASES: readonly MemoryPhase[]

/** Scope → phase map. */
export declare const PHASE_OF_SCOPE: Readonly<Record<string, MemoryPhase>>

/** Facet → phase map. */
export declare const FACET_PHASE: Readonly<Record<string, MemoryPhase>>

/** Janice = runtime; Atena never grants. */
export declare const PACKAGER_ROLES: Readonly<{ janice: 'runtime'; atena: 'advisor-never-grants' }>

/** Phase of a scope kind or facet name. Unknown → undefined. */
export declare function phaseOf(scopeOrFacet: string): MemoryPhase | undefined

/** Verified F2 channel from a Pack A source. */
export declare function channelFromSource(source: string): string | undefined

/** effective = min(claim, channel) on the F2 ordinal. */
export declare function effectiveTier(claim: string, channel: string): string | undefined

/** Seal a fact into one phase. Deny-by-default. */
export declare function packageMemory(input?: Record<string, unknown>): {
  decision: 'allow' | 'deny'
  reason: string | null
  side_effect: false
  control: false
  hash?: string
  phase?: MemoryPhase
  trust?: MemoryTrust
  state?: QuarantineState
  [field: string]: unknown
}

/** Recompute the integrity hash. Tamper → false. */
export declare function verifyPackage(pkg: object): boolean

/** Move a sealed package between phases. Escalation requires host|user. */
export declare function advancePhase(
  pkg: object,
  request?: { toPhase?: string; attestor?: unknown; admit?: boolean }
): ReturnType<typeof packageMemory>

/** Memory packages must never enter the admission graph. Always deny. */
export declare function proposeControl(pkg?: object, action?: string): {
  decision: 'deny'
  reason: 'memory-cannot-enter-control'
  side_effect: false
  control: false
}

/** Register `abaco_memory_set/get/forget/list` in the calling scope. */
export declare function registerMemoryTools(
  ctx: { tools: { register(definition: never): unknown } },
  options: { store: MemoryStore; config: MemoryConfig }
): void

/** Cordis plugin name. */
export declare const name: string

/** The services this half reads. */
export declare const inject: readonly string[]

/** Mount the store, the tools and the prompt section. */
export declare function apply(ctx: unknown, config?: Record<string, unknown>): Promise<void>
