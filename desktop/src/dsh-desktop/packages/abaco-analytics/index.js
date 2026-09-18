/**
 * Host half for the browser-only Analytics settings page.
 *
 * Session numbers are collected in the renderer from the stock chat / projection
 * seats and shown under Settings → Analytics. Nothing is written to disk here,
 * and this row does not change engine behaviour. There is no host.fetch route
 * and no authorize() path — Janice stays the runtime; Atena is not on this row.
 *
 * PR #23 soft-apply only wrapped host apply() for voice / documents /
 * observability. This apply() was already a no-op, so that change never
 * covered the 0.4.22+ boot: the *client* factory required `./lib/summary.js`,
 * which is not a module-table seed, and Cordis escalated `failed to import
 * loader entry` into Startup recovery. Soft-wrapping this empty host apply()
 * still cannot hide that packaging bug; the client bundle must stay
 * self-contained.
 */
export const name = 'abaco-analytics'

function warnApply(ctx, message) {
  try {
    ctx?.logger?.warn?.(`abaco-analytics: ${message}`)
  } catch {
    /* a logger that throws must not fail boot */
  }
}

/**
 * Host apply. Analytics has no host routes. A throw here must not take the
 * plugin tree to Startup recovery / Safe Mode, and must not re-enable any
 * disabled plugin.
 *
 * @param {any} [ctx]
 */
export function apply(ctx) {
  try {
    if (ctx == null) return
  } catch (error) {
    warnApply(
      ctx,
      `failed to start; host half is off: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
