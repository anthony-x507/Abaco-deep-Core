/**
 * Types for the isolate-group compaction wrapper (Principle C + Principle D).
 * The loader only reads `name`, `inject` and `apply`.
 */

export declare const name: 'abaco-compaction'

export declare const inject: readonly ['compaction', 'toolResultPruner']

/** Synthetic tool name the approval UI attaches the prompt to. */
export declare const COMPACTION_APPROVAL_TOOL: 'abaco_compact'

/** Why the first ask is happening. */
export declare const COMPACTION_APPROVAL_REASON: string

/** Soft-warn copy after a reject. */
export declare const REJECT_SOFT_WARN: string

/** Cordis body. Synchronous, returns nothing. */
export declare function apply(ctx: unknown): void

/** Wrap `compactIfNeeded` and `summarize` on the live engine instance. */
export declare function wrapEngine(engine: object, ctx?: unknown): object

/** Ask `ctx.approval`. Fail closed. */
export declare function askCompact(ctx: unknown, agent: unknown, signal?: unknown): Promise<string>

/** Fold an approval outcome into the next consent flag. */
export declare function applyConsentOutcome(
  consent: unknown,
  outcome: unknown
): { state: 'allowed' | 'rejected' | 'unset'; armed: boolean }
