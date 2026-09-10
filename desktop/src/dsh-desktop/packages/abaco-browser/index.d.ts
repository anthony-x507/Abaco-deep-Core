/**
 * Types for the host half of the `abaco-browser` plugin.
 *
 * `apply` is declared against `unknown` rather than Cordis's `Context`, exactly
 * like `dsh-desktop-preset-transfer`: the host half only ever touches
 * `ctx.tools.register`, and typing the whole service surface here would tie this
 * plugin's declaration to a harness version it does not otherwise depend on.
 * `test/abaco-browser.test.ts` imports this module and drives the *real*
 * `defineTool` schemas through a minimal `ctx`, which is where the tool surface
 * is actually verified.
 */
export declare const name: string
export declare const inject: readonly string[]
export declare function apply(ctx: unknown): void
