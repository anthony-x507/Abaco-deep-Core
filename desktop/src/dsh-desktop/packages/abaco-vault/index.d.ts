/**
 * Types for the host half of the `abaco-vault` plugin (Layer 3).
 *
 * The Cordis surface (`name`, `inject`, `apply`) is declared against `unknown`
 * rather than Cordis's `Context`, exactly like `abaco-memory` and
 * `abaco-browser`: this half only ever touches `ctx.on` and `ctx.logger`, and
 * typing the whole service surface here would tie the declaration to a harness
 * version the plugin does not otherwise depend on.
 *
 * The planning helpers and the path resolution *are* declared precisely,
 * because `test/abaco-vault.test.ts` imports them and drives the shipped code
 * path: it mounts the plugin against a minimal recording context, feeds it real
 * `subagent-settled` message shapes and real tool results, and then reads the
 * artifacts, the index and the file modes from a temporary vault root.
 */

/** Diagnostic sink; the plugin degrades to silence when `ctx.logger` is absent. */
export interface VaultLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Resolved plugin configuration, as `resolveVaultConfig` produces it. */
export interface VaultConfig {
  /** Absolute Layer-2 memory directory, or `undefined` to derive it from `$DSH_HOME`. */
  root: string | undefined
  /** When false, neither arm is registered. */
  enabled: boolean
  /** Cap, in UTF-8 bytes, above which a settlement notice is vaulted. */
  maxSettledBytes: number
  /** How many leading lines of a vaulted notice stay inline. */
  headLines: number
  /** Cap, in UTF-8 bytes, above which a tool result earns a durable copy. */
  vaultInlineChars: number
  /** When false, the `tools/post-execute` arm is not registered. */
  vaultToolResults: boolean
}

/** Environment mapping consulted for `DSH_HOME`. */
export interface VaultEnv {
  DSH_HOME?: string | undefined
}

/** A `dshHomePath`-shaped helper: segments in, absolute path out. */
export type HomePathFn = (...segments: string[]) => string

/** The minimal Standard Schema surface Cordis reads off an exported `Config`. */
export type StandardSchemaIssue = { readonly message: string }

/**
 * The Standard Schema result union, spelled out so the declaration stays honest
 * (a success carries `value`, a failure carries `issues`) *and* structurally
 * assignable to `StandardSchemaV1`, which is what `ctx.plugin()` requires of an
 * exported `Config` (`@deepseek-ai/cordis/lib/types/registry.d.ts:52-56`).
 */
export type StandardSchemaResult<T = unknown> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[]; readonly value?: undefined }

export interface StandardSchemaLike<T = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardSchemaResult<T>
  }
}

/** Outcome of `planSettledRewrite`: either leave the text alone, or cut it. */
export type SettledRewritePlan =
  | { kind: 'keep'; reason: 'not-text' | 'under-threshold' | 'no-reduction'; bytes: number }
  | { kind: 'rewrite'; bytes: number; kept: number; omitted: number; head: string; headLines: number }

/** Index fields every vaulted artifact carries. */
export interface VaultArtifact {
  locator: string
  bytes: number
  sha256: string
  id: string
}

/** Arguments of `vaultText`. */
export interface VaultTextOptions {
  /** Absolute vault root. */
  root: string
  /** Session that owns the artifact (the artifact's directory). */
  sessionId: string
  /** Index `kind`: `'subagent-settled'` or `'tool-result'`. */
  kind: string
  /** The text written verbatim. */
  text: string
  /** Label folded into the file name. */
  slug?: string
  /** Extra index fields (`senderSessionId`, `tool`, `callId`, …). */
  extra?: Record<string, unknown>
  /** Creation time in epoch milliseconds; defaults to now. */
  now?: number
  /** Diagnostic sink for a failed index append. */
  logger?: VaultLogger
}

/** Cordis plugin name. */
export declare const name: string

/** Services this half requires. */
export declare const inject: string[]

/** Layer-2 memory directory name. */
export declare const MEMORY_DIR_NAME: string

/** Vault subdirectory name. */
export declare const VAULT_DIR_NAME: string

/** Name of the append-only index journal. */
export declare const VAULT_INDEX_FILE: string

/** Default cap for the tool-result arm, in UTF-8 bytes. */
export declare const DEFAULT_VAULT_INLINE_CHARS: number

/** The exported config schema (Standard Schema, never reports issues). */
export declare const Config: StandardSchemaLike<Record<string, unknown>>

/** Resolve the vault root, honouring `$DSH_HOME` and the harness helper. */
export declare function resolveVaultRoot(env?: VaultEnv, homePathFn?: HomePathFn): string

/** Normalize a row's `config` block; wrong values fall back to the defaults. */
export declare function resolveVaultConfig(raw: unknown): VaultConfig

/** The absolute vault root for a resolved config. */
export declare function effectiveVaultRoot(config: VaultConfig, env?: VaultEnv, homePathFn?: HomePathFn): string

/** Save one artifact verbatim and journal it. */
export declare function vaultText(options: VaultTextOptions): Promise<VaultArtifact>

/** Mount both arms; never rejects. */
export declare function apply(ctx: unknown, config?: unknown): Promise<void>

/* ── Pure planning helpers (re-exported from `./lib/plan.js`) ─────────────── */

/** UTF-8 byte length of a string. */
export declare function utf8Bytes(text: unknown): number

/** Fold arbitrary text into a filesystem-safe slug. */
export declare function slugify(value: string, fallback?: string): string

/** File name of one artifact: `<epochMs>-<slug>.txt`. */
export declare function artifactFileName(sessionId: string, epochMs: number, slug: string): string

/** The recovery line appended after the inline head. */
export declare function renderOmittedNotice(omittedBytes: number, locator: string): string

/** Decide whether and where a settlement notice is cut. */
export declare function planSettledRewrite(text: string, config?: { maxSettledBytes?: number; headLines?: number }): SettledRewritePlan

/** Parent-facing `goal / result / artifacts / errors` report. */
export declare function formatParentReport(
  text: string,
  extras?: {
    goal?: string
    result?: string
    summary?: string
    artifacts?: string[]
    errors?: string[]
    locator?: string
  }
): string

/** Parent report + blank line + recovery notice. */
export declare function composeVaultedText(
  head: string,
  omittedBytes: number,
  locator: string,
  options?: {
    fullText?: string
    summary?: string
    goal?: string
    result?: string
    artifacts?: string[]
    errors?: string[]
  }
): string

/** The text of a recognized `subagent-settled` message, else `undefined`. */
export declare function settledMessageText(message: unknown): string | undefined

/** A copy of `message` with its content replaced; `source` keeps its identity. */
export declare function withReplacedContent<T extends object>(
  message: T,
  text: string
): T & { content: Array<{ type: 'text'; text: string }> }

/** Concatenated plain text of an all-text content list, else `undefined`. */
export declare function flattenPlainText(content: unknown): string | undefined
